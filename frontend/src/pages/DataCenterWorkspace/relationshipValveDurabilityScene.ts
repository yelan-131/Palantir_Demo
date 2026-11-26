import { listObjectRecords, objectTypeId, type RuntimeObjectType } from '../../services/objectRuntime';
import { relationshipNodeId, type RelationshipGraph } from './relationshipGraph';
import type { MaterialTrial } from './relationshipTrialComparison';
import {
  evaluateValveDurability, readValveDurabilityRequirements,
  type ValveDurabilityRequirement, type ValveDurabilityResult,
} from './relationshipValveDurability';

interface RelationshipValveRequirements {
  productTypeId: number;
  requirementTypeId: number;
  materialTypeId?: number;
  requirements: readonly ValveDurabilityRequirement[];
}

export interface RelationshipValveDurabilityEvidence {
  result: ValveDurabilityResult;
  requirementNodeId?: string;
  materialNodeId?: string;
}

const useRelationCodes = new Set(['demo_relation_valve_cover_material', 'demo_relation_valve_body_material']);
const pageSize = 100;

export async function loadRelationshipValveRequirements(
  graph: Pick<RelationshipGraph, 'nodes'>, models: readonly RuntimeObjectType[], signal: AbortSignal,
): Promise<RelationshipValveRequirements | undefined> {
  const productModel = models.find(model => model.code === 'demo_relation_valve_product');
  const requirementModel = models.find(model => model.code === 'demo_relation_valve_durability');
  if (!productModel || !requirementModel) return undefined;
  const productTypeId = objectTypeId(productModel);
  const visibleValves = new Set(graph.nodes.filter(node => node.typeId === productTypeId).map(node => node.key));
  if (!visibleValves.size) return undefined;

  const requirementTypeId = objectTypeId(requirementModel);
  const { data: { data: first } } = await listObjectRecords(requirementTypeId, { page: 1, page_size: pageSize }, signal);
  signal.throwIfAborted();
  const records = new Map(first.items.map(record => [record.key, record]));
  const pages = Math.ceil(first.total / pageSize);
  for (let page = 2; page <= pages; page++) {
    const { data: { data: next } } = await listObjectRecords(requirementTypeId, { page, page_size: pageSize }, signal);
    signal.throwIfAborted();
    for (const record of next.items) records.set(record.key, record);
  }
  const materialModel = models.find(model => model.code === 'demo_relation_valve_material');
  return {
    productTypeId,
    requirementTypeId,
    materialTypeId: materialModel && objectTypeId(materialModel),
    requirements: readValveDurabilityRequirements([...records.values()]).filter(requirement => visibleValves.has(requirement.valveNo)),
  };
}

export function buildRelationshipValveDurability(
  graph: Pick<RelationshipGraph, 'nodes' | 'edges'> | undefined,
  requirements?: RelationshipValveRequirements,
  trialsByGrade?: ReadonlyMap<string, readonly MaterialTrial[]>,
  trialsComplete = false,
): {
  byProduct: ReadonlyMap<string, readonly RelationshipValveDurabilityEvidence[]>;
  byEdge: ReadonlyMap<string, readonly RelationshipValveDurabilityEvidence[]>;
} {
  const byProduct = new Map<string, RelationshipValveDurabilityEvidence[]>();
  const byEdge = new Map<string, RelationshipValveDurabilityEvidence[]>();
  if (!graph || !requirements?.requirements.length) return { byProduct, byEdge };

  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const usesByProduct = new Map<string, Map<string, string[]>>();
  for (const edge of graph.edges) {
    if (edge.kind === 'candidate' || !useRelationCodes.has(edge.code)) continue;
    const product = nodes.get(edge.source);
    const material = nodes.get(edge.target);
    if (product?.typeId !== requirements.productTypeId || !material || material.typeId !== requirements.materialTypeId) continue;
    const usesByGrade = usesByProduct.get(product.id) ?? new Map<string, string[]>();
    const sameGrade = usesByGrade.get(material.key) ?? [];
    sameGrade.push(edge.id);
    usesByGrade.set(material.key, sameGrade);
    usesByProduct.set(product.id, usesByGrade);
  }

  for (const requirement of requirements.requirements) {
    const productId = relationshipNodeId(requirements.productTypeId, requirement.valveNo);
    if (!nodes.has(productId)) continue;
    const requirementId = relationshipNodeId(requirements.requirementTypeId, requirement.key);
    const requirementNodeId = nodes.has(requirementId) ? requirementId : undefined;
    const usesByGrade = usesByProduct.get(productId) ?? new Map<string, string[]>([['', []]]);
    const productEvidence = byProduct.get(productId) ?? [];
    for (const [grade, edgeIds] of usesByGrade) {
      const result = evaluateValveDurability(requirement, grade, trialsByGrade?.get(grade) ?? [], trialsComplete);
      const materialNodeId = grade && requirements.materialTypeId ? relationshipNodeId(requirements.materialTypeId, grade) : undefined;
      const evidence = { result, requirementNodeId, materialNodeId };
      productEvidence.push(evidence);
      for (const edgeId of edgeIds) {
        const edgeEvidence = byEdge.get(edgeId) ?? [];
        edgeEvidence.push(evidence);
        byEdge.set(edgeId, edgeEvidence);
      }
    }
    byProduct.set(productId, productEvidence);
  }
  return { byProduct, byEdge };
}
