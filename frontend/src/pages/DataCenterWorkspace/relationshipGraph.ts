import { isAxiosError } from 'axios';
import {
  listObjectRecords, objectTypeId, readObjectRecord, type ObjectBindingForm,
  type ObjectRecord, type ObjectRecordDetail, type ObjectRecordPage, type ObjectRelationRecords,
  type RuntimeObjectType,
} from '../../services/objectRuntime';

export const MAX_LOCAL_NODES = 60;
const MAX_LOCAL_EDGES = 120;
const MAX_OVERVIEW_NODES = 150;
const MAX_OVERVIEW_EDGES = 320;
const OVERVIEW_PAGE_SIZE = 100;
const MAX_EXPANSIONS = 12;
const REQUEST_BATCH_SIZE = 4;

export interface RelationshipRoot {
  typeId: number;
  typeName: string;
  key: string;
}

export interface RelationshipNode extends RelationshipRoot {
  id: string;
  values: ObjectRecord['values'];
  maskedFields?: readonly string[];
  updatedAt?: string | null;
  level: 0 | 1 | 2;
  bindingForm?: ObjectBindingForm;
  sources?: ObjectRecordDetail['sources'];
  recordMetadata?: ObjectRecord['record_metadata'];
}

export interface RelationshipEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  relationId: number | string;
  code: string;
  kind?: 'candidate';
  symmetric?: boolean;
  strength?: number;
  evidence?: {
    sourceField: string;
    sourceValue: string;
    targetField: string;
    targetValue: string;
  };
}

export interface RelationshipGraph {
  rootId?: string;
  nodes: RelationshipNode[];
  edges: RelationshipEdge[];
  truncated: boolean;
  failedExpansions: number;
  unresolvedRelations: number;
}

export const relationshipNodeId = (typeId: number, key: string) => JSON.stringify([typeId, key]);
export const relationshipEdgeId = (relationId: number | string, source: string, target: string) => JSON.stringify([String(relationId), source, target]);

export function renameRelationshipNode(graph: RelationshipGraph, record: RelationshipNode, key: string, values: Record<string, unknown>): RelationshipGraph {
  const id = relationshipNodeId(record.typeId, key);
  return {
    ...graph,
    rootId: graph.rootId === record.id ? id : graph.rootId,
    nodes: graph.nodes.map(node => node.id === record.id ? { ...node, id, key, values: { ...node.values, ...values } } : node),
    edges: graph.edges.map(edge => {
      const source = edge.source === record.id ? id : edge.source;
      const target = edge.target === record.id ? id : edge.target;
      return source === edge.source && target === edge.target ? edge : { ...edge, id: relationshipEdgeId(edge.relationId, source, target), source, target };
    }),
  };
}

function makeNode(
  typeId: number, typeName: string, record: ObjectRecord, level: RelationshipNode['level'],
): RelationshipNode {
  return {
    id: relationshipNodeId(typeId, record.key),
    typeId,
    typeName,
    key: record.key,
    values: record.values,
    ...(record.masked_fields?.length && { maskedFields: record.masked_fields }),
    ...(record.record_metadata && { recordMetadata: record.record_metadata }),
    updatedAt: record.updated_at,
    level,
  };
}

function addRecordDetail(node: RelationshipNode, detail: ObjectRecordDetail) {
  node.values = detail.values;
  node.maskedFields = detail.masked_fields;
  node.updatedAt = detail.updated_at;
  node.bindingForm = detail.binding_form;
  node.sources = detail.sources;
  if (detail.record_metadata) node.recordMetadata = detail.record_metadata;
}

function makeEdge(nodeId: string, relatedId: string, relation: ObjectRelationRecords): RelationshipEdge {
  const [source, target] = relation.direction === 'outgoing' ? [nodeId, relatedId] : [relatedId, nodeId];
  const id = relationshipEdgeId(relation.id, source, target);
  const { evidence } = relation;
  return {
    id, source, target, label: relation.name, relationId: relation.id, code: relation.code,
    ...(evidence && { evidence: {
      sourceField: evidence.source_field, sourceValue: evidence.source_value,
      targetField: evidence.target_field, targetValue: evidence.target_value,
    } }),
  };
}

export async function loadRelationshipGraph(
  root: RelationshipRoot, depth: 1 | 2, signal?: AbortSignal,
): Promise<RelationshipGraph> {
  signal?.throwIfAborted();
  const { data: { data: rootRecord } } = await readObjectRecord(root.typeId, root.key, signal);
  signal?.throwIfAborted();
  const rootNode = makeNode(root.typeId, root.typeName, rootRecord, 0);
  addRecordDetail(rootNode, rootRecord);

  const nodes = new Map([[rootNode.id, rootNode]]);
  const edges = new Map<string, RelationshipEdge>();
  let truncated = false;
  let failedExpansions = 0;
  let unresolvedRelations = 0;

  function collectRelations(node: RelationshipNode, detail: ObjectRecordDetail, level: 1 | 2) {
    for (const relation of detail.relations) {
      if (relation.state !== 'matched') {
        unresolvedRelations++;
        continue;
      }
      if (relation.total > relation.records.length) truncated = true;
      for (const record of relation.records) {
        const typeId = relation.related_object_id;
        const relatedId = relationshipNodeId(typeId, record.key);
        const edge = makeEdge(node.id, relatedId, relation);
        if (edges.has(edge.id)) continue;
        if (edges.size >= MAX_LOCAL_EDGES || (!nodes.has(relatedId) && nodes.size >= MAX_LOCAL_NODES)) {
          truncated = true;
          continue;
        }
        if (!nodes.has(relatedId)) {
          nodes.set(relatedId, makeNode(typeId, relation.related_object_name, record, level));
        }
        edges.set(edge.id, edge);
      }
    }
  }

  collectRelations(rootNode, rootRecord, 1);
  if (depth === 2) {
    const neighbors = [...nodes.values()].filter(node => node.level === 1);
    const expand = neighbors.slice(0, MAX_EXPANSIONS);
    if (neighbors.length > expand.length) truncated = true;

    for (let index = 0; index < expand.length; index += REQUEST_BATCH_SIZE) {
      signal?.throwIfAborted();
      const batch = expand.slice(index, index + REQUEST_BATCH_SIZE);
      const outcomes = await Promise.allSettled(batch.map(node => readObjectRecord(node.typeId, node.key, signal)));
      signal?.throwIfAborted();
      for (const [position, outcome] of outcomes.entries()) {
        if (outcome.status === 'rejected') {
          failedExpansions++;
          continue;
        }
        const node = batch[position];
        const detail = outcome.value.data.data;
        addRecordDetail(node, detail);
        collectRelations(node, detail, 2);
      }
    }
  }

  return { rootId: rootNode.id, nodes: [...nodes.values()], edges: [...edges.values()], truncated,
    failedExpansions, unresolvedRelations };
}

function isForbidden(error: unknown) {
  return isAxiosError(error) && error.response?.status === 403;
}

export async function loadRelationshipOverview(
  models: readonly RuntimeObjectType[], signal?: AbortSignal,
): Promise<RelationshipGraph> {
  signal?.throwIfAborted();
  const types = models.map(model => ({ typeId: objectTypeId(model), typeName: model.name }))
    .filter(({ typeId }) => Number.isSafeInteger(typeId) && typeId > 0)
    .sort((first, second) => first.typeId - second.typeId);
  const pages: { typeId: number; typeName: string; page: ObjectRecordPage }[] = [];
  let truncated = false;
  let failedExpansions = 0;
  let unresolvedRelations = 0;

  for (let index = 0; index < types.length; index += REQUEST_BATCH_SIZE) {
    const batch = types.slice(index, index + REQUEST_BATCH_SIZE);
    const outcomes = await Promise.allSettled(batch.map(({ typeId }) =>
      listObjectRecords(typeId, { page: 1, page_size: OVERVIEW_PAGE_SIZE }, signal)));
    signal?.throwIfAborted();
    for (const [position, outcome] of outcomes.entries()) {
      if (outcome.status === 'fulfilled') {
        pages.push({ ...batch[position], page: outcome.value.data.data });
      } else if (!isForbidden(outcome.reason)) {
        failedExpansions++;
      }
    }
  }

  // Two pages cover the overview limit. Only read the second when the first pages cannot fill it.
  if (pages.reduce((total, { page }) => total + page.items.length, 0) < MAX_OVERVIEW_NODES) {
    const remaining = pages.filter(({ page }) => page.total > page.items.length);
    for (let index = 0; index < remaining.length; index += REQUEST_BATCH_SIZE) {
      const batch = remaining.slice(index, index + REQUEST_BATCH_SIZE);
      const outcomes = await Promise.allSettled(batch.map(({ typeId }) =>
        listObjectRecords(typeId, { page: 2, page_size: OVERVIEW_PAGE_SIZE }, signal)));
      signal?.throwIfAborted();
      for (const [position, outcome] of outcomes.entries()) {
        const entry = batch[position];
        if (outcome.status === 'fulfilled') {
          const next = outcome.value.data.data;
          const items = new Map([...entry.page.items, ...next.items].map(record => [record.key, record]));
          entry.page = {
            ...entry.page,
            total: Math.max(entry.page.total, next.total),
            items: [...items.values()].slice(0, MAX_OVERVIEW_NODES),
          };
        } else if (isForbidden(outcome.reason)) {
          pages.splice(pages.indexOf(entry), 1);
        } else {
          failedExpansions++;
        }
      }
    }
  }
  if (pages.some(({ page }) => page.total > page.items.length)
      || pages.reduce((total, { page }) => total + page.total, 0) > MAX_OVERVIEW_NODES) truncated = true;

  const nodes = new Map<string, RelationshipNode>();
  // Take one record per type per pass so a large table cannot consume the graph by itself.
  for (let index = 0; index < MAX_OVERVIEW_NODES && nodes.size < MAX_OVERVIEW_NODES; index++) {
    for (const { typeId, typeName, page } of pages) {
      const record = page.items[index];
      if (!record) continue;
      const id = relationshipNodeId(typeId, record.key);
      if (nodes.has(id)) continue;
      const node = makeNode(typeId, typeName, record, 0);
      node.bindingForm = page.binding_form;
      nodes.set(id, node);
      if (nodes.size === MAX_OVERVIEW_NODES) break;
    }
  }
  const details = new Map<string, ObjectRecordDetail>();
  const selected = [...nodes.values()];
  for (let index = 0; index < selected.length; index += REQUEST_BATCH_SIZE) {
    const batch = selected.slice(index, index + REQUEST_BATCH_SIZE);
    const outcomes = await Promise.allSettled(batch.map(node => readObjectRecord(node.typeId, node.key, signal)));
    signal?.throwIfAborted();
    for (const [position, outcome] of outcomes.entries()) {
      const node = batch[position];
      if (outcome.status === 'fulfilled') {
        const detail = outcome.value.data.data;
        addRecordDetail(node, detail);
        details.set(node.id, detail);
      } else if (isForbidden(outcome.reason)) {
        nodes.delete(node.id);
      } else {
        failedExpansions++;
      }
    }
  }

  const edges = new Map<string, RelationshipEdge>();
  const partialPreviews: { nodeId: string; relation: ObjectRelationRecords }[] = [];
  for (const [nodeId, detail] of details) {
    for (const relation of detail.relations) {
      if (relation.state === 'restricted') continue;
      if (relation.state !== 'matched') {
        unresolvedRelations++;
        continue;
      }
      if (relation.total > relation.records.length) partialPreviews.push({ nodeId, relation });
      for (const record of relation.records) {
        const relatedId = relationshipNodeId(relation.related_object_id, record.key);
        const edge = makeEdge(nodeId, relatedId, relation);
        if (edges.has(edge.id)) continue;
        if (!nodes.has(relatedId) || edges.size === MAX_OVERVIEW_EDGES) {
          truncated = true;
          continue;
        }
        edges.set(edge.id, edge);
      }
    }
  }

  const visibleEdges = [...edges.values()];
  // Reading both ends can recover matches omitted from an individual relation preview.
  if (!truncated) truncated = partialPreviews.some(({ nodeId, relation }) => {
    const end = relation.direction === 'outgoing' ? 'source' : 'target';
    const visibleCount = visibleEdges.filter(edge => edge[end] === nodeId && String(edge.relationId) === String(relation.id)).length;
    return visibleCount < relation.total;
  });

  return { nodes: [...nodes.values()], edges: visibleEdges, truncated: truncated || failedExpansions > 0,
    failedExpansions, unresolvedRelations };
}
