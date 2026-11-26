import { isAxiosError } from 'axios';
import { listObjectRecords, objectTypeId, type RuntimeObjectType } from '../../services/objectRuntime';
import {
  compareAttributeDiscoveryProfiles, prepareAttributeDiscoveryProfile, type AttributeDiscoveryComparison,
} from './relationshipAttributeDiscovery';
import { compareRelationshipReferenceProfiles, prepareRelationshipReferenceProfile } from './relationshipReferenceDiscovery';
import { MAX_LOCAL_NODES, relationshipNodeId, type RelationshipEdge, type RelationshipGraph, type RelationshipNode } from './relationshipGraph';

const relationCode = 'attribute-discovery';
const recordLimitPerType = 100;
const typeLimit = 20;
const requestBatchSize = 4;
const candidateLimit = 3;

interface AttributeDiscoveryMatch {
  target: RelationshipNode;
  match: AttributeDiscoveryComparison;
  reference: boolean;
}

export interface RelationshipAttributeDiscovery {
  source: RelationshipNode;
  peers: RelationshipNode[];
  matches: (AttributeDiscoveryMatch & {
    edge: RelationshipEdge & { kind: 'candidate'; symmetric: true; strength: number };
  })[];
  truncated: boolean;
  scannedRecords: number;
  failedTypes: number;
}

function isUnavailable(error: unknown) {
  return isAxiosError(error) && (error.response?.status === 403 || error.response?.status === 404);
}

export async function loadRelationshipAttributeDiscovery(
  source: RelationshipNode,
  graph: Pick<RelationshipGraph, 'nodes' | 'rootId'>,
  models: readonly RuntimeObjectType[],
  signal?: AbortSignal,
): Promise<RelationshipAttributeDiscovery> {
  signal?.throwIfAborted();
  const discovery: RelationshipAttributeDiscovery = { source, peers: [], matches: [], truncated: false, scannedRecords: 0, failedTypes: 0 };
  const types = models.filter(model => model.status === 'published' && (model.record_bound ?? Boolean(model.record_binding)))
    .map(model => ({ model, typeId: objectTypeId(model) }))
    .filter(({ typeId }) => Number.isSafeInteger(typeId) && typeId > 0)
    .sort((first, second) => first.typeId - second.typeId);
  const sourceModel = types.find(type => type.typeId === source.typeId)?.model;
  if (!sourceModel) return discovery;

  const sourceProfile = prepareAttributeDiscoveryProfile(source, sourceModel);
  const sourceReferences = prepareRelationshipReferenceProfile(source, sourceModel);
  const hasComparableAttributes = sourceProfile.contextComplete && sourceProfile.attributes.size > 0;
  if (!hasComparableAttributes && !sourceReferences.identifier && !sourceReferences.references.length) return discovery;
  const candidates: AttributeDiscoveryMatch[] = [];
  const seen = new Set([source.id]);
  const visible = new Set(graph.nodes.map(node => node.id));
  visible.add(source.id);
  const peerLimit = graph.rootId ? Math.max(0, MAX_LOCAL_NODES - visible.size) : candidateLimit;
  const otherTypes = types.filter(type => type.typeId !== source.typeId);
  const searchedTypes = otherTypes.slice(0, typeLimit);
  discovery.truncated = searchedTypes.length < otherTypes.length;

  for (let offset = 0; offset < searchedTypes.length; offset += requestBatchSize) {
    const batch = searchedTypes.slice(offset, offset + requestBatchSize);
    const outcomes = await Promise.allSettled(batch.map(({ typeId }) =>
      listObjectRecords(typeId, { page: 1, page_size: recordLimitPerType }, signal)));
    signal?.throwIfAborted();
    for (const [position, outcome] of outcomes.entries()) {
      if (outcome.status === 'rejected') {
        if (!isUnavailable(outcome.reason)) discovery.failedTypes++;
        continue;
      }
      const { model, typeId } = batch[position];
      const page = outcome.value.data.data;
      const records = page.items.slice(0, recordLimitPerType);
      if (page.total > records.length || page.items.length > records.length) discovery.truncated = true;
      for (const record of records) {
        const id = relationshipNodeId(typeId, record.key);
        if (seen.has(id)) continue;
        seen.add(id);
        discovery.scannedRecords++;
        const target: RelationshipNode = {
          id, typeId, typeName: model.name, key: record.key, values: record.values, level: 1,
          maskedFields: record.masked_fields, bindingForm: page.binding_form, updatedAt: record.updated_at,
          recordMetadata: record.record_metadata,
        };
        const referenceMatch = compareRelationshipReferenceProfiles(sourceReferences, prepareRelationshipReferenceProfile(target, model));
        const match = referenceMatch ?? (hasComparableAttributes
          ? compareAttributeDiscoveryProfiles(sourceProfile, prepareAttributeDiscoveryProfile(target, model)) : undefined);
        if (match) candidates.push({ target, match, reference: Boolean(referenceMatch) });
      }
    }
  }

  if (discovery.failedTypes) discovery.truncated = true;
  candidates.sort((left, right) => right.match.strength - left.match.strength
    || right.match.matchingCount - left.match.matchingCount || left.target.id.localeCompare(right.target.id));
  for (const candidate of candidates) {
    const { target, match } = candidate;
    if (!visible.has(target.id)) {
      if (discovery.peers.length >= peerLimit) {
        discovery.truncated = true;
        continue;
      }
      discovery.peers.push(target);
    }
    const id = JSON.stringify([relationCode, ...[source.id, target.id].sort()]);
    discovery.matches.push({
      ...candidate,
      edge: {
        id, source: source.id, target: target.id, label: candidate.reference ? '引用匹配' : '属性匹配', relationId: relationCode, code: relationCode,
        kind: 'candidate', symmetric: true, strength: match.strength,
      },
    });
    if (discovery.matches.length === candidateLimit) break;
  }
  return discovery;
}
