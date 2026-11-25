import { listObjectRecords, objectTypeId, type RuntimeObjectType } from '../../services/objectRuntime';
import {
  evaluateManufacturingMatch, MANUFACTURING_MATCH_TYPES, matchIdentifier,
  type ManufacturingMatchRecord, type ManufacturingMatchResult,
} from './manufacturingMatch';
import type { RelationshipGraph, RelationshipNode } from './relationshipGraph';

interface RelationshipMatchCombination {
  fit: RelationshipNode;
  participants: { product: RelationshipNode; material: RelationshipNode; process: RelationshipNode };
}

export interface RelationshipMatchEvidence extends RelationshipMatchCombination {
  result: ManufacturingMatchResult;
  trials: readonly ManufacturingMatchRecord[];
}

function boundTypeId(models: readonly RuntimeObjectType[], code: string) {
  const model = models.find(item => item.code === code && item.status === 'published'
    && (item.record_bound ?? Boolean(item.record_binding)));
  if (!model) return undefined;
  const id = objectTypeId(model);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

function fitCombinations(graph: RelationshipGraph, models: readonly RuntimeObjectType[]): RelationshipMatchCombination[] {
  const fitType = boundTypeId(models, 'process_fit');
  const productType = boundTypeId(models, MANUFACTURING_MATCH_TYPES.product.code);
  const materialType = boundTypeId(models, MANUFACTURING_MATCH_TYPES.material.code);
  const processType = boundTypeId(models, MANUFACTURING_MATCH_TYPES.process.code);
  if (!fitType || !productType || !materialType || !processType) return [];

  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const fitNeighbors = new Map<string, Set<RelationshipNode>>();
  for (const edge of graph.edges) {
    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    if (!source || !target) continue;
    const fit: RelationshipNode = target.typeId === fitType ? target : source;
    const neighbor = fit === target ? source : target;
    if (fit.typeId !== fitType) continue;
    const neighbors = fitNeighbors.get(fit.id) ?? new Set<RelationshipNode>();
    neighbors.add(neighbor);
    fitNeighbors.set(fit.id, neighbors);
  }

  const combinations: RelationshipMatchCombination[] = [];
  for (const fit of graph.nodes) {
    const neighbors = [...(fitNeighbors.get(fit.id) ?? [])];
    const product = neighbors.filter(node => node.typeId === productType);
    const material = neighbors.filter(node => node.typeId === materialType);
    const process = neighbors.filter(node => node.typeId === processType);
    if (product.length === 1 && material.length === 1 && process.length === 1) {
      combinations.push({ fit, participants: { product: product[0], material: material[0], process: process[0] } });
    }
  }
  return combinations;
}

export async function loadRelationshipMatchEvidence(
  graph: RelationshipGraph, models: readonly RuntimeObjectType[], signal?: AbortSignal,
): Promise<ReadonlyMap<string, readonly RelationshipMatchEvidence[]>> {
  signal?.throwIfAborted();
  const byNode = new Map<string, RelationshipMatchEvidence[]>();
  const combinations = fitCombinations(graph, models);
  if (!combinations.length) return byNode;

  let trials: ManufacturingMatchRecord[] = [];
  let trialsComplete = false;
  const trialType = boundTypeId(models, MANUFACTURING_MATCH_TYPES.trial.code);
  if (trialType) {
    try {
      const { data: { data: page } } = await listObjectRecords(trialType, { page: 1, page_size: 100 }, signal);
      trials = page.items.map(({ key, values }) => ({ key, values, bindingForm: page.binding_form }));
      // A partial graph may omit a competing linked participant, even if the trial list is complete.
      trialsComplete = page.total === page.items.length && !graph.truncated && graph.failedExpansions === 0;
    } catch {
      signal?.throwIfAborted();
      // Keep the linked objects visible while the unavailable trials leave the check pending.
    }
  }
  signal?.throwIfAborted();

  for (const combination of combinations) {
    const { fit, participants } = combination;
    const grade = matchIdentifier(participants.material.values.grade_code);
    const evidence: RelationshipMatchEvidence = {
      ...combination,
      result: evaluateManufacturingMatch({ ...participants, trials, trialsComplete }),
      trials: grade === undefined ? [] : trials.filter(trial => matchIdentifier(trial.values.grade_code) === grade),
    };
    for (const node of [fit, ...Object.values(participants)]) {
      const existing = byNode.get(node.id);
      if (existing) existing.push(evidence);
      else byNode.set(node.id, [evidence]);
    }
  }
  return byNode;
}
