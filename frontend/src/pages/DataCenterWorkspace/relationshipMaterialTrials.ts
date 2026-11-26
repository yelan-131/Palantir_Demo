import { listObjectRecords, objectTypeId, type RuntimeObjectType } from '../../services/objectRuntime';
import { MAX_LOCAL_NODES, loadRelationshipGraph, type RelationshipGraph, type RelationshipNode } from './relationshipGraph';
import {
  buildRelationshipTrialComparisonEdges, readMaterialTrials, relationshipTrialPeerKeys,
  type MaterialTrial,
} from './relationshipTrialComparison';

const trialTypeCode = 'demo_relation_material_trial';
const materialTypeCode = 'demo_relation_valve_material';
const pageSize = 100;
const requestBatchSize = 4;

export async function loadRelationshipMaterialTrials(
  graph: RelationshipGraph, models: readonly RuntimeObjectType[], signal: AbortSignal,
) {
  const trialModel = models.find(model => model.code === trialTypeCode);
  const materialModel = models.find(model => model.code === materialTypeCode);
  if (!trialModel || !materialModel) return undefined;
  const materialTypeId = objectTypeId(materialModel);
  if (!graph.nodes.some(node => node.typeId === materialTypeId)) return undefined;

  const { data: { data: page } } = await listObjectRecords(objectTypeId(trialModel), { page: 1, page_size: pageSize }, signal);
  signal.throwIfAborted();
  const records = page.items;
  const root = graph.nodes.find(node => node.id === graph.rootId);
  const peerKeys = root?.typeId === materialTypeId ? relationshipTrialPeerKeys({ nodes: [root] }, records, materialTypeId) : [];
  const visiblePeerKeys = peerKeys.slice(0, Math.max(0, MAX_LOCAL_NODES - graph.nodes.length));
  const peers: RelationshipNode[] = [];
  for (let offset = 0; offset < visiblePeerKeys.length; offset += requestBatchSize) {
    const results = await Promise.allSettled(visiblePeerKeys.slice(offset, offset + requestBatchSize).map(key =>
      loadRelationshipGraph({ typeId: materialTypeId, typeName: materialModel.name, key }, 1, signal)));
    signal.throwIfAborted();
    for (const result of results) {
      if (result.status !== 'fulfilled') continue;
      const peer = result.value.nodes.find(node => node.id === result.value.rootId);
      if (peer) peers.push({ ...peer, level: 1 });
    }
  }

  const trialsByGrade = new Map<string, MaterialTrial[]>();
  for (const trial of readMaterialTrials(records)) {
    const existing = trialsByGrade.get(trial.materialGrade);
    if (existing) existing.push(trial);
    else trialsByGrade.set(trial.materialGrade, [trial]);
  }
  return {
    materialTypeId,
    peers,
    edges: buildRelationshipTrialComparisonEdges({ nodes: [...graph.nodes, ...peers] }, records, materialTypeId),
    trialsByGrade,
    trialsComplete: page.total === records.length,
    truncated: page.total > records.length || visiblePeerKeys.length < peerKeys.length,
  };
}
