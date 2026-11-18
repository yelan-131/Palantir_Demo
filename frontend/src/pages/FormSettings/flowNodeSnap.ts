import type { FlowRoutePoint } from './flowEdgeRoute';

export const FLOW_NODE_GRID = { step: 24, x: 32, y: 82 };
export const FLOW_NODE_SIZE = { width: 144, height: 48 };
const ALIGN_DISTANCE = 10;

type Axis = 'x' | 'y';
type Bounds = { min: FlowRoutePoint; max: FlowRoutePoint };

export type FlowNodeSnap = {
  point: FlowRoutePoint;
  alignX?: FlowRoutePoint;
  alignY?: FlowRoutePoint;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function snapFlowAxis(
  axis: Axis,
  position: FlowRoutePoint,
  bounds: Bounds,
  neighbors: readonly FlowRoutePoint[],
  scale: number,
) {
  const { min, max } = bounds;
  const otherAxis = axis === 'x' ? 'y' : 'x';
  let target: FlowRoutePoint | undefined;
  let closest = ALIGN_DISTANCE / scale;
  for (const node of neighbors) {
    if (node[axis] < min[axis] || node[axis] > max[axis]) continue;
    const distance = Math.abs(node[axis] - position[axis]);
    if (distance > closest) continue;
    if (target && distance === closest
      && Math.abs(node[otherAxis] - position[otherAxis]) >= Math.abs(target[otherAxis] - position[otherAxis])) continue;
    closest = distance;
    target = node;
  }

  const origin = FLOW_NODE_GRID[axis];
  const { step } = FLOW_NODE_GRID;
  const first = Math.ceil((min[axis] - origin) / step);
  const last = Math.floor((max[axis] - origin) / step);
  const grid = Math.round((position[axis] - origin) / step);
  const fallback = first <= last
    ? origin + clamp(grid, first, last) * step
    : clamp(position[axis], min[axis], max[axis]);
  return { value: target?.[axis] ?? fallback, target };
}

export function snapFlowNode(
  position: FlowRoutePoint,
  bounds: Bounds,
  neighbors: readonly FlowRoutePoint[] = [],
  scale: FlowRoutePoint = { x: 1, y: 1 },
): FlowNodeSnap {
  const x = snapFlowAxis('x', position, bounds, neighbors, scale.x);
  const y = snapFlowAxis('y', position, bounds, neighbors, scale.y);
  return { point: { x: x.value, y: y.value }, alignX: x.target, alignY: y.target };
}
