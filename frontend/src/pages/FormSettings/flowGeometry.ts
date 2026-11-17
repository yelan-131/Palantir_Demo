import { FLOW_NODE_HEIGHT, FLOW_NODE_WIDTH } from './designerOptions';
import type { FlowConnection, FlowNode, FlowPortSide } from './designerTypes';

export function makeFlowNodes(steps: string[]): FlowNode[] {
  return steps.map((step, index) => ({
    id: `flow-${index}`,
    label: step,
    role: index === 0 ? 'start' : index === steps.length - 1 ? 'end' : 'task',
    x: 300,
    y: 112 + index * 126,
  }));
}

export function makeFlowConnections(nodes: FlowNode[]): FlowConnection[] {
  return nodes.slice(0, -1).map((node, index) => ({
    id: `${node.id}-${nodes[index + 1].id}`,
    fromId: node.id,
    fromSide: 'bottom',
    toId: nodes[index + 1].id,
    toSide: 'top',
  }));
}

export function getFlowNodePorts(node: FlowNode): FlowPortSide[] {
  if (node.role === 'start') return ['right', 'bottom', 'left'];
  if (node.role === 'end') return ['top', 'right', 'left'];
  return ['top', 'right', 'bottom', 'left'];
}

export function getFlowPortPoint(node: FlowNode, side: FlowPortSide) {
  const points: Record<FlowPortSide, { x: number; y: number }> = {
    top: { x: node.x + FLOW_NODE_WIDTH / 2, y: node.y },
    right: { x: node.x + FLOW_NODE_WIDTH, y: node.y + FLOW_NODE_HEIGHT / 2 },
    bottom: { x: node.x + FLOW_NODE_WIDTH / 2, y: node.y + FLOW_NODE_HEIGHT },
    left: { x: node.x, y: node.y + FLOW_NODE_HEIGHT / 2 },
  };
  return points[side];
}

export function getFlowPortVector(side: FlowPortSide) {
  const vectors: Record<FlowPortSide, { x: number; y: number }> = {
    top: { x: 0, y: -1 },
    right: { x: 1, y: 0 },
    bottom: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
  };
  return vectors[side];
}

export function roundedOrthogonalPath(points: Array<{ x: number; y: number }>, radius = 14) {
  const compactPoints = points.filter((point, index) => {
    const previous = points[index - 1];
    return !previous || previous.x !== point.x || previous.y !== point.y;
  });
  if (compactPoints.length < 2) return '';
  const commands = [`M ${compactPoints[0].x} ${compactPoints[0].y}`];
  for (let index = 1; index < compactPoints.length - 1; index += 1) {
    const previous = compactPoints[index - 1];
    const current = compactPoints[index];
    const next = compactPoints[index + 1];
    const prevLength = Math.abs(current.x - previous.x) + Math.abs(current.y - previous.y);
    const nextLength = Math.abs(next.x - current.x) + Math.abs(next.y - current.y);
    const cornerRadius = Math.min(radius, prevLength / 2, nextLength / 2);
    const before = {
      x: current.x + Math.sign(previous.x - current.x) * cornerRadius,
      y: current.y + Math.sign(previous.y - current.y) * cornerRadius,
    };
    const after = {
      x: current.x + Math.sign(next.x - current.x) * cornerRadius,
      y: current.y + Math.sign(next.y - current.y) * cornerRadius,
    };
    commands.push(`L ${before.x} ${before.y}`);
    commands.push(`Q ${current.x} ${current.y} ${after.x} ${after.y}`);
  }
  const end = compactPoints[compactPoints.length - 1];
  commands.push(`L ${end.x} ${end.y}`);
  return commands.join(' ');
}

export function getFlowConnectorPath(from: FlowNode, fromSide: FlowPortSide, to: FlowNode, toSide: FlowPortSide) {
  const start = getFlowPortPoint(from, fromSide);
  const end = getFlowPortPoint(to, toSide);
  const offset = 32;
  const fromVector = getFlowPortVector(fromSide);
  const toVector = getFlowPortVector(toSide);
  const startLead = { x: start.x + fromVector.x * offset, y: start.y + fromVector.y * offset };
  const endLead = { x: end.x + toVector.x * offset, y: end.y + toVector.y * offset };
  const fromIsVertical = fromSide === 'top' || fromSide === 'bottom';
  const bridge = fromIsVertical
    ? [
        { x: startLead.x, y: (startLead.y + endLead.y) / 2 },
        { x: endLead.x, y: (startLead.y + endLead.y) / 2 },
      ]
    : [
        { x: (startLead.x + endLead.x) / 2, y: startLead.y },
        { x: (startLead.x + endLead.x) / 2, y: endLead.y },
      ];
  return roundedOrthogonalPath([start, startLead, ...bridge, endLead, end]);
}
