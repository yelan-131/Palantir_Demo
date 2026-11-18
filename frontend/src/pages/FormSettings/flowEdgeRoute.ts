export type FlowPortSide = 'top' | 'right' | 'bottom' | 'left';
export type FlowRoutePoint = { x: number; y: number };

export function translateFlowRoute<T extends { waypoints?: FlowRoutePoint[]; routeY?: number }>(route: T, { x, y }: FlowRoutePoint): T {
  if (!route.waypoints?.length && route.routeY === undefined) return route;
  return {
    ...route,
    waypoints: route.waypoints?.map((point) => ({ x: point.x + x, y: point.y + y })),
    routeY: route.routeY === undefined ? undefined : route.routeY + y,
  };
}

const vectors: Record<FlowPortSide, FlowRoutePoint> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

const distance = (a: FlowRoutePoint, b: FlowRoutePoint) => Math.hypot(b.x - a.x, b.y - a.y);
const offset = (point: FlowRoutePoint, vector: FlowRoutePoint, amount: number) => ({
  x: point.x + vector.x * amount,
  y: point.y + vector.y * amount,
});
const interpolate = (a: FlowRoutePoint, b: FlowRoutePoint, t: number) => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

function simplify(points: FlowRoutePoint[]) {
  const result: FlowRoutePoint[] = [];
  for (const point of points) {
    const end = result[result.length - 1];
    if (end && !distance(end, point)) continue;
    const start = result[result.length - 2];
    if (start && end && (
      (start.x === end.x && end.x === point.x && (end.y - start.y) * (point.y - end.y) > 0)
      || (start.y === end.y && end.y === point.y && (end.x - start.x) * (point.x - end.x) > 0)
    )) result.pop();
    result.push(point);
  }
  return result;
}

function automaticPoints(start: FlowRoutePoint, from: FlowRoutePoint, end: FlowRoutePoint, to: FlowRoutePoint, legacyY?: number) {
  const delta = { x: end.x - start.x, y: end.y - start.y };
  const fromDistance = delta.x * from.x + delta.y * from.y;
  const toDistance = -delta.x * to.x - delta.y * to.y;
  const lead = (forward: number) => forward > 0 ? Math.min(18, forward / 2) : 18;
  const first = offset(start, from, lead(fromDistance));
  const last = offset(end, to, lead(toDistance));
  if (legacyY !== undefined) {
    return simplify([start, first, { x: first.x, y: legacyY }, { x: last.x, y: legacyY }, last, end]);
  }
  if (from.x !== 0 && to.x !== 0) {
    const x = from.x === to.x ? (from.x > 0 ? Math.max(first.x, last.x) : Math.min(first.x, last.x)) : (first.x + last.x) / 2;
    if (!(fromDistance < 0 && toDistance < 0)) {
      return simplify([start, first, { x, y: first.y }, { x, y: last.y }, last, end]);
    }
    const y = Math.min(first.y, last.y) - 32;
    return simplify([start, first, { x: first.x, y }, { x: x, y }, { x, y: last.y }, last, end]);
  }
  if (from.y !== 0 && to.y !== 0) {
    const y = from.y === to.y ? (from.y > 0 ? Math.max(first.y, last.y) : Math.min(first.y, last.y)) : (first.y + last.y) / 2;
    const x = fromDistance < 0 && toDistance < 0 ? Math.max(first.x, last.x) + 32 : last.x;
    return simplify([start, first, { x: first.x, y }, { x, y }, { x, y: last.y }, last, end]);
  }
  const elbow = from.x ? { x: last.x, y: first.y } : { x: first.x, y: last.y };
  return simplify([start, first, elbow, last, end]);
}

function roundedPath(points: FlowRoutePoint[]) {
  const [first, ...rest] = points;
  if (!first) return '';
  const commands = [`M ${first.x} ${first.y}`];
  rest.forEach((point, index) => {
    const previous = points[index];
    const next = rest[index + 1];
    const incoming = distance(previous, point);
    const outgoing = next ? distance(point, next) : 0;
    const radius = Math.min(8, incoming / 2, outgoing / 2);
    if (!next || !radius || (previous.x === point.x && point.x === next.x) || (previous.y === point.y && point.y === next.y)) {
      commands.push(`L ${point.x} ${point.y}`);
      return;
    }
    const enter = interpolate(point, previous, radius / incoming);
    const exit = interpolate(point, next, radius / outgoing);
    commands.push(`L ${enter.x} ${enter.y} Q ${point.x} ${point.y} ${exit.x} ${exit.y}`);
  });
  return commands.join(' ');
}

export function getFlowEdgeRoute(
  start: FlowRoutePoint,
  sourceSide: FlowPortSide,
  end: FlowRoutePoint,
  targetSide: FlowPortSide,
  waypoints?: FlowRoutePoint[],
  legacyY?: number,
) {
  const from = vectors[sourceSide];
  const to = vectors[targetSide];
  const automatic = waypoints?.length ? [] : automaticPoints(start, from, end, to, legacyY);
  const anchors = waypoints?.length ? waypoints : automatic.slice(1, -1);
  const endpoints = [start, ...anchors, end];
  const legs = endpoints.slice(1).map((next, index) => {
    const current = endpoints[index];
    if (automatic.length || current.x === next.x || current.y === next.y) return [current, next];
    if (index === 0) {
      const first = offset(start, from, 12);
      return simplify([start, first, from.x ? { x: first.x, y: next.y } : { x: next.x, y: first.y }, next]);
    }
    if (index === anchors.length) {
      const last = offset(end, to, 12);
      return simplify([current, to.x ? { x: last.x, y: current.y } : { x: current.x, y: last.y }, last, end]);
    }
    return [current, { x: next.x, y: current.y }, next];
  });
  const points = simplify(legs.flatMap((leg, index) => index === 0 ? leg : leg.slice(1)));
  const segments = legs.flatMap((leg, index) => leg.slice(1).map((b, i) => ({
    a: leg[i], b, index, length: distance(leg[i], b),
  })));
  const labelSegments = points.slice(1).map((b, index) => ({ a: points[index], b, length: distance(points[index], b) }));
  const longest = labelSegments.reduce((best, segment) => segment.length > best.length ? segment : best,
    { a: start, b: start, length: 0 });
  const label = interpolate(longest.a, longest.b, 0.5);
  return {
    d: roundedPath(points),
    anchors,
    segments,
    label: longest.a.x === longest.b.x
      ? { x: label.x + 9, y: label.y, vertical: true, anchor: label }
      : { x: label.x, y: label.y - 7, vertical: false, anchor: label },
  };
}

export function insertFlowWaypoint(route: ReturnType<typeof getFlowEdgeRoute>, point?: FlowRoutePoint) {
  let closest: { point: FlowRoutePoint; index: number; score: number } | undefined;
  for (const { a, b, index, length } of route.segments) {
    if (length < 12) continue;
    const margin = Math.min(0.3, 8 / length);
    const fraction = point ? ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / length ** 2 : 0.5;
    const candidate = interpolate(a, b, Math.min(1 - margin, Math.max(margin, fraction)));
    const score = point ? distance(point, candidate) : -length;
    if (!closest || score < closest.score) closest = { point: candidate, index, score };
  }
  if (!closest) return undefined;
  const waypoints = [...route.anchors];
  waypoints.splice(closest.index, 0, closest.point);
  return { waypoints, index: closest.index };
}

export function getFlowSegmentDrag(
  route: ReturnType<typeof getFlowEdgeRoute>,
  pointer: FlowRoutePoint,
): { axis: keyof FlowRoutePoint; origin: FlowRoutePoint; move: (value: number) => FlowRoutePoint[] } | undefined {
  let selected: { index: number; score: number } | undefined;
  route.segments.forEach(({ a, b, length }, index) => {
    if (!length) return;
    const fraction = ((pointer.x - a.x) * (b.x - a.x) + (pointer.y - a.y) * (b.y - a.y)) / length ** 2;
    const score = distance(pointer, interpolate(a, b, Math.max(0, Math.min(1, fraction))));
    if (!selected || score < selected.score) selected = { index, score };
  });
  if (!selected) return undefined;

  const { index } = selected;
  const { a, b, length } = route.segments[index];
  const points = [route.segments[0].a, ...route.segments.map((segment) => segment.b)];
  const atStart = index === 0;
  const atEnd = index === route.segments.length - 1;
  const lead = Math.min(12, length / 4) / length;
  const from = atStart ? interpolate(a, b, lead) : a;
  const to = atEnd ? interpolate(b, a, lead) : b;
  const axis = a.x === b.x ? 'x' : 'y';

  return {
    axis,
    origin: interpolate(a, b, 0.5),
    move(value: number) {
      const before = points.slice(0, atStart ? 1 : index);
      const after = points.slice(atEnd ? -1 : index + 2);
      return [...before, { ...from, [axis]: value }, { ...to, [axis]: value }, ...after].slice(1, -1);
    },
  };
}

export function readFlowWaypoints(value: unknown): FlowRoutePoint[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const points = value.filter((point): point is FlowRoutePoint =>
    point && Number.isFinite(point.x) && Number.isFinite(point.y));
  return points.length ? points : undefined;
}
