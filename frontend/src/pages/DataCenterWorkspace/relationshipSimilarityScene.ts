import { useLayoutEffect, useMemo, useState } from 'react';
import { objectTypeId, type RuntimeObjectType } from '../../services/objectRuntime';
import type { RelationshipNode } from './relationshipGraph';
import { relationshipPositions, type Point3 } from './relationshipLayout';
import { compareRelationshipNodes, layoutRelationshipSimilarity, type RelationshipSimilarity, type SimilarityNode } from './relationshipSimilarity';

type ComparableNode = SimilarityNode & { record: RelationshipNode };
export type RelationshipNeighbor = RelationshipSimilarity & { node: RelationshipNode };

const maxCachedPositions = 400;

function recordSignature(node: SimilarityNode) {
  return JSON.stringify(node.features.map(feature => [feature, node.values[feature.code]]));
}

export function useRelationshipSimilarityScene(records: readonly RelationshipNode[] | undefined, models: readonly RuntimeObjectType[]) {
  const nodes = useMemo(() => {
    const byId = new Map(models.map(model => [objectTypeId(model), model]));
    return (records ?? []).map((record): ComparableNode => {
      const features = byId.get(record.typeId)?.similarity_features ?? [];
      const values = { ...record.values };
      for (const code of record.maskedFields ?? []) delete values[code];
      return {
        id: record.id, record, values,
        features: features.map(feature => ({ ...feature, dimension: feature.dimension
          ? JSON.stringify(['shared', feature.dimension]) : JSON.stringify([record.typeId, feature.code]) })),
      };
    });
  }, [records, models]);
  const [scene, setScene] = useState(() => ({ signatures: new Map<string, string>(), positions: new Map<string, Point3>() }));
  useLayoutEffect(() => {
    if (!nodes.length) return;
    const signatures = new Map(nodes.map(node => [node.id, recordSignature(node)]));
    setScene(previous => {
      if ([...signatures].every(([id, signature]) => previous.signatures.get(id) === signature)) return previous;
      const ids = [...signatures.keys()];
      const updated = layoutRelationshipSimilarity(nodes, relationshipPositions(ids), previous.positions);
      const positions = new Map(previous.positions);
      const nextSignatures = new Map(previous.signatures);
      for (const [id, point] of updated) {
        positions.delete(id);
        nextSignatures.delete(id);
        positions.set(id, point);
        nextSignatures.set(id, signatures.get(id)!);
      }
      for (const id of positions.keys()) {
        if (positions.size <= maxCachedPositions) break;
        positions.delete(id);
        nextSignatures.delete(id);
      }
      return { signatures: nextSignatures, positions };
    });
  }, [nodes]);

  const nearby = (id: string): RelationshipNeighbor[] => {
    const source = nodes.find(node => node.id === id);
    if (!source?.features.length) return [];
    return nodes.flatMap(target => {
      if (source === target) return [];
      const comparison = compareRelationshipNodes(source, target);
      return comparison ? [{ ...comparison, node: target.record }] : [];
    }).sort((a, b) => b.similarity * b.coverage - a.similarity * a.coverage || a.node.key.localeCompare(b.node.key)).slice(0, 3);
  };
  return { positions: scene.positions, nearby };
}
