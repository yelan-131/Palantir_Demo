import { translateFlowRoute, type FlowRoutePoint } from './flowEdgeRoute';
import type { FlowDesignerConfig } from './ProfessionalFlowDesigner';

type FlowGraph = Pick<FlowDesignerConfig, 'nodes' | 'edges' | 'annotations'>;
export type FlowClipboard = Required<FlowGraph>;

export function copyFlowSelection(graph: FlowGraph, nodeIds: ReadonlySet<string>, annotationIds: ReadonlySet<string>): FlowClipboard {
  const annotations = graph.annotations?.filter((annotation) => annotationIds.has(annotation.id)) ?? [];
  const members = new Set([...nodeIds, ...annotations.flatMap((annotation) => annotation.nodeIds)]);
  return structuredClone({
    nodes: graph.nodes.filter((node) => members.has(node.id)),
    edges: graph.edges.filter((edge) => members.has(edge.source) && members.has(edge.target)),
    annotations,
  });
}

export function cloneFlowSelection(selection: FlowClipboard, delta: FlowRoutePoint, makeId: (prefix: string) => string): FlowClipboard {
  const graph = structuredClone(selection);
  const newIds = new Map<string, string>();
  const nodes = graph.nodes.map((node) => {
    const id = makeId(node.type);
    newIds.set(node.id, id);
    return { ...node, id, label: `${node.label} 副本`, x: node.x + delta.x, y: node.y + delta.y };
  });
  const edges = graph.edges.flatMap((edge) => {
    const source = newIds.get(edge.source);
    const target = newIds.get(edge.target);
    if (!source || !target) return [];
    return [translateFlowRoute({ ...edge, id: makeId('edge'), source, target }, delta)];
  });
  const annotations = graph.annotations.flatMap((annotation) => {
    const nodeIds = annotation.nodeIds.map((id) => newIds.get(id)).filter((id) => id !== undefined);
    return nodeIds.length ? [{ ...annotation, id: makeId('annotation'), nodeIds }] : [];
  });
  return { nodes, edges, annotations };
}
