import type { RelationshipEdge, RelationshipGraph } from './relationshipGraph';
import type { RelationshipMatchEvidence } from './relationshipMatchEvidence';

export interface RelationshipCandidateEdge {
  edge: RelationshipEdge & { kind: 'candidate' };
  match: RelationshipMatchEvidence;
}

const candidateRelations = [
  { from: 'product', to: 'material', label: '候选材料' },
  { from: 'product', to: 'process', label: '候选工艺' },
  { from: 'material', to: 'process', label: '候选配套工艺' },
] as const;

export function buildRelationshipCandidateEdges(
  graph: Pick<RelationshipGraph, 'nodes'>,
  byNode?: ReadonlyMap<string, readonly RelationshipMatchEvidence[]>,
): RelationshipCandidateEdge[] {
  if (!byNode?.size) return [];
  const visible = new Set(graph.nodes.map(node => node.id));
  const visitedFits = new Set<string>();
  const candidates: RelationshipCandidateEdge[] = [];
  for (const matches of byNode.values()) {
    for (const match of matches) {
      const { fit, participants, result } = match;
      if (visitedFits.has(fit.id) || result.status !== 'candidate' || !result.selectedTrial
          || !result.checks.length || result.checks.some(check => check.status !== 'pass')) continue;
      visitedFits.add(fit.id);
      for (const { from, to, label } of candidateRelations) {
        const source = participants[from].id;
        const target = participants[to].id;
        if (!visible.has(source) || !visible.has(target)) continue;
        const code = `manufacturing-match:${from}:${to}`;
        const id = JSON.stringify([code, fit.id, source, target]);
        candidates.push({ edge: { id, source, target, label, relationId: code, code, kind: 'candidate' }, match });
      }
    }
  }
  return candidates;
}
