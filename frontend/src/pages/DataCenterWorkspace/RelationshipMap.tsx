import { useCallback, useLayoutEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { projectRelationshipPoint, relationshipPositions, type Point3, type RelationshipCamera } from './relationshipLayout';
import './relationshipMap.css';

interface RelationshipMapNode {
  id: string;
  label: string;
  color: string;
}

interface RelationshipMapEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  kind?: 'candidate';
  symmetric?: boolean;
  strength?: number;
}

interface RelationshipMapProps {
  nodes: readonly RelationshipMapNode[];
  edges: readonly RelationshipMapEdge[];
  positions?: Positions;
  selectedNodeId?: string;
  selectedEdgeId?: string;
  highlightedEdgeIds?: ReadonlySet<string>;
  onSelectNode: (id: string) => void;
  onSelectEdge: (id: string) => void;
  resetSignal: number;
}

type Point = { x: number; y: number };
type Bounds = Point & { width: number; height: number };
type Viewport = { width: number; height: number; pixelRatio: number };
type ProjectedNode = RelationshipMapNode & Point & { depth: number; radius: number };
type EdgePath = { start: Point; control: Point; end: Point };
type Hit = { kind: 'node' | 'edge'; id: string };
type Positions = ReadonlyMap<string, Point3>;
type Drag = {
  id: number;
  button: 0 | 1 | 2;
  mode: 'rotate' | 'pan' | 'zoom';
  start: Point;
  last: Point;
  moved: boolean;
};

const pressedButtonMasks = [1, 4, 2] as const;
const dragThreshold = 4;
const labelSettleDelay = 140;
const startCamera = (): RelationshipCamera => ({ yaw: -0.45, pitch: 0.22, zoom: 1, offsetX: 0, offsetY: 0 });
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const noPositions: Positions = new Map();
const spatialOrigin: Point3 = { x: 0, y: 0, z: 0 };
const spatialAxes: readonly { label: string; end: Point3 }[] = [
  { label: 'X', end: { x: 1.56, y: 0, z: 0 } },
  { label: 'Y', end: { x: 0, y: -1.56, z: 0 } },
  { label: 'Z', end: { x: 0, y: 0, z: 1.56 } },
];
const inBounds = (a: Bounds, b: Bounds) => a.x < b.x + b.width + 3 && a.x + a.width + 3 > b.x
  && a.y < b.y + b.height + 3 && a.y + a.height + 3 > b.y;

function edgePath(source: ProjectedNode, target: ProjectedNode, lane: number): EdgePath {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= 0.1) {
    const height = source.radius + 30 + Math.abs(lane) * 12;
    return {
      start: { x: source.x - source.radius * 0.7, y: source.y - source.radius * 0.7 },
      control: { x: source.x + lane * 15, y: source.y - height },
      end: { x: source.x + source.radius * 0.7, y: source.y - source.radius * 0.7 },
    };
  }
  const ux = dx / distance;
  const uy = dy / distance;
  const start = { x: source.x + ux * Math.min(source.radius + 1, distance * 0.29), y: source.y + uy * Math.min(source.radius + 1, distance * 0.29) };
  const end = { x: target.x - ux * Math.min(target.radius + 2, distance * 0.29), y: target.y - uy * Math.min(target.radius + 2, distance * 0.29) };
  const bend = lane * 17 + clamp((source.depth - target.depth) * 8, -14, 14);
  return {
    start,
    control: { x: (start.x + end.x) / 2 - uy * bend, y: (start.y + end.y) / 2 + ux * bend },
    end,
  };
}

function atCurve({ start, control, end }: EdgePath, t: number) {
  const u = 1 - t;
  return { x: u * u * start.x + 2 * u * t * control.x + t * t * end.x,
    y: u * u * start.y + 2 * u * t * control.y + t * t * end.y };
}

function pointSegmentDistance(point: Point, a: Point, b: Point) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / Math.max(dx * dx + dy * dy, 0.001), 0, 1);
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
}

function edgeLanes(edges: readonly RelationshipMapEdge[]) {
  const groups = new Map<string, RelationshipMapEdge[]>();
  for (const edge of edges) {
    const key = JSON.stringify([edge.source, edge.target].sort());
    const matching = groups.get(key) ?? [];
    matching.push(edge);
    groups.set(key, matching);
  }
  return new Map([...groups.values()].flatMap(group => group.map((edge, index) => [
    edge.id, (index - (group.length - 1) / 2) * (edge.source <= edge.target ? 1 : -1),
  ])));
}

function colorPalette(canvas: HTMLCanvasElement) {
  const style = getComputedStyle(canvas);
  const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    panel: token('--mf-panel', '#ffffff'),
    tag: token('--mf-panel-soft', '#f0f4fb'),
    text: token('--mf-text', '#2b4367'),
    muted: token('--mf-muted', '#637d9c'),
    line: token('--mf-border-strong', '#a4b5ca'),
    focus: token('--mf-primary', '#476791'),
  };
}

function fitCamera(positions: Positions, viewport: Viewport) {
  const camera = startCamera();
  if (!positions.size || !viewport.width || !viewport.height) return camera;
  const framePoints = [...positions.values(), ...spatialAxes.flatMap(({ end }) => [end, { x: -end.x, y: -end.y, z: -end.z }])];
  const projected = framePoints.map(point => projectRelationshipPoint(point, camera, viewport));
  const xs = projected.map(point => point.x);
  const ys = projected.map(point => point.y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  const horizontalPadding = Math.min(viewport.width * 0.45, clamp(viewport.width * 0.22, 66, 135));
  const verticalPadding = Math.min(viewport.height * 0.42, 64);
  camera.zoom = Math.min(
    (viewport.width - horizontalPadding) / Math.max(40, right - left),
    (viewport.height - verticalPadding) / Math.max(40, bottom - top),
    2.25,
  );
  camera.offsetX = (viewport.width / 2 - (left + right) / 2) * camera.zoom;
  camera.offsetY = (viewport.height / 2 - (top + bottom) / 2) * camera.zoom;
  return camera;
}

function drawSpatialAxes(
  context: CanvasRenderingContext2D,
  camera: RelationshipCamera,
  viewport: Viewport,
  ink: string,
  fontFamily: string,
): Bounds[] {
  const project = (point: Point3) => projectRelationshipPoint(point, camera, viewport);
  const origin = project(spatialOrigin);
  const labels: Bounds[] = [];
  context.save();
  context.strokeStyle = ink;
  context.fillStyle = ink;
  context.lineWidth = 1;
  context.font = `600 11px ${fontFamily}`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  for (const { label, end } of spatialAxes) {
    const positive = project(end);
    const negative = project({ x: -end.x, y: -end.y, z: -end.z });
    const length = Math.hypot(positive.x - origin.x, positive.y - origin.y);
    if (length < 10) continue;
    const dx = (positive.x - origin.x) / length;
    const dy = (positive.y - origin.y) / length;
    context.globalAlpha = 0.27;
    context.setLineDash([3, 4]);
    context.beginPath();
    context.moveTo(negative.x, negative.y);
    context.lineTo(origin.x, origin.y);
    context.stroke();

    context.globalAlpha = 0.48;
    context.setLineDash([]);
    context.beginPath();
    context.moveTo(origin.x, origin.y);
    context.lineTo(positive.x, positive.y);
    context.moveTo(positive.x - 5 * dx + 2.5 * dy, positive.y - 5 * dy - 2.5 * dx);
    context.lineTo(positive.x, positive.y);
    context.lineTo(positive.x - 5 * dx - 2.5 * dy, positive.y - 5 * dy + 2.5 * dx);
    context.stroke();

    const x = positive.x + 11 * dx;
    const y = positive.y + 11 * dy;
    context.globalAlpha = 1;
    context.fillText(label, x, y);
    labels.push({ x: x - 6, y: y - 7, width: 12, height: 14 });
  }
  context.restore();
  return labels;
}

function nodeDegrees(edges: readonly RelationshipMapEdge[]) {
  const neighbors = new Map<string, Set<string>>();
  function add(a: string, b: string) {
    const related = neighbors.get(a) ?? new Set<string>();
    related.add(b);
    neighbors.set(a, related);
  }
  for (const edge of edges) {
    add(edge.source, edge.target);
    add(edge.target, edge.source);
  }
  return new Map([...neighbors].map(([id, list]) => [id, list.size]));
}

export default function RelationshipMap(props: RelationshipMapProps) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef(props);
  const viewport = useRef<Viewport>({ width: 0, height: 0, pixelRatio: 1 });
  const camera = useRef(startCamera());
  const minZoom = useRef(0.42);
  const points = useRef<Positions>(noPositions);
  const scene = useRef<{ edgeTopology: string; resetSignal: number; positions?: Positions }>({
    edgeTopology: '', resetSignal: props.resetSignal,
  });
  const frame = useRef<number>();
  const hover = useRef<Hit>();
  const drag = useRef<Drag>();
  const labelSlots = useRef(new Map<string, number>());
  const labelSettleTimer = useRef<number>();
  const degrees = useRef(new Map<string, number>());
  const lanes = useRef(new Map<string, number>());
  const drawn = useRef({
    nodes: [] as ProjectedNode[],
    edges: [] as { id: string; path: EdgePath }[],
    labels: [] as { hit: Hit; bounds: Bounds }[],
  });

  const schedule = useCallback(() => {
    if (frame.current !== undefined) return;
    frame.current = window.requestAnimationFrame(() => {
      frame.current = undefined;
      const element = canvas.current;
      const context = element?.getContext('2d');
      const current = viewport.current;
      if (!element || !context || !current.width || !current.height) return;
      const model = live.current;
      const palette = colorPalette(element);
      const fontFamily = getComputedStyle(element).fontFamily;
      context.setTransform(current.pixelRatio, 0, 0, current.pixelRatio, 0, 0);
      context.clearRect(0, 0, current.width, current.height);
      const reserved = drawSpatialAxes(context, camera.current, current, palette.muted, fontFamily);
      const projected = model.nodes.flatMap(node => {
        const position = points.current.get(node.id);
        if (!position) return [];
        const point = projectRelationshipPoint(position, camera.current, current);
        const radius = (4.5 + Math.sqrt(degrees.current.get(node.id) ?? 0) * 1.9)
          * clamp(1 + point.depth * 0.13, 0.79, 1.25) * clamp(Math.sqrt(camera.current.zoom), 0.72, 1.34);
        return [{ ...node, ...point, radius }];
      }).sort((a, b) => a.depth - b.depth);
      const positions = new Map(projected.map(node => [node.id, node]));
      drawn.current = { nodes: projected, edges: [], labels: [] };

      const captions: { id: string; center: Point; text: string }[] = [];
      const interactive = (id: string) => id === model.selectedEdgeId || id === hover.current?.id;
      const highlight = (id: string) => model.highlightedEdgeIds?.has(id) ?? false;
      const edgePriority = (id: string) => interactive(id) ? 2 : Number(highlight(id));
      const edgeOrder = [...model.edges].sort((a, b) => edgePriority(a.id) - edgePriority(b.id));
      const adjacent = new Set<string>();
      const highlightedNodes = new Set<string>();
      for (const edge of edgeOrder) {
        const source = positions.get(edge.source);
        const destination = positions.get(edge.target);
        if (!source || !destination) continue;
        const path = edgePath(source, destination, lanes.current.get(edge.id) ?? 0);
        drawn.current.edges.push({ id: edge.id, path });
        const highlightedEdge = highlight(edge.id);
        const emphasizedEdge = interactive(edge.id) || highlightedEdge;
        const adjacentEdge = edge.source === model.selectedNodeId || edge.target === model.selectedNodeId;
        if (highlightedEdge) {
          highlightedNodes.add(edge.source);
          highlightedNodes.add(edge.target);
        }
        if (adjacentEdge) {
          adjacent.add(edge.source);
          adjacent.add(edge.target);
        }
        const tint = emphasizedEdge ? palette.focus : adjacentEdge ? palette.muted : palette.line;
        context.strokeStyle = tint;
        context.fillStyle = tint;
        const baseWidth = edge.strength === undefined
          ? emphasizedEdge ? 2.15 : adjacentEdge ? 1.65 : 1
          : 1 + 2 * clamp(edge.strength, 0, 1) + (emphasizedEdge ? 0.55 : 0);
        context.lineWidth = baseWidth + (highlightedEdge ? 0.65 : 0);
        context.globalAlpha = emphasizedEdge || adjacentEdge ? 1 : clamp(0.53 + (source.depth + destination.depth) * 0.1, 0.35, 0.72);
        context.beginPath();
        context.moveTo(path.start.x, path.start.y);
        context.quadraticCurveTo(path.control.x, path.control.y, path.end.x, path.end.y);
        if (edge.kind === 'candidate') context.setLineDash([5, 4]);
        context.stroke();
        if (edge.kind === 'candidate') context.setLineDash([]);
        if (!edge.symmetric && (emphasizedEdge || adjacentEdge || model.edges.length < 16)) {
          const angle = Math.atan2(path.end.y - path.control.y, path.end.x - path.control.x);
          const size = emphasizedEdge ? 7.3 : 5.6;
          context.beginPath();
          context.moveTo(path.end.x, path.end.y);
          context.lineTo(path.end.x - size * Math.cos(angle - 0.44), path.end.y - size * Math.sin(angle - 0.44));
          context.lineTo(path.end.x - size * Math.cos(angle + 0.44), path.end.y - size * Math.sin(angle + 0.44));
          context.closePath();
          context.fill();
        }
        if (emphasizedEdge) {
          captions.push({
            id: edge.id, center: atCurve(path, 0.5),
            text: edge.label,
          });
        }
      }
      context.globalAlpha = 1;

      for (const node of projected) {
        const active = node.id === model.selectedNodeId || node.id === hover.current?.id;
        const highlighted = highlightedNodes.has(node.id);
        context.globalAlpha = active || highlighted ? 1 : clamp(0.94 + node.depth * 0.12, 0.73, 1);
        if (active || highlighted) {
          context.strokeStyle = palette.focus;
          context.lineWidth = active ? 1.5 : 1;
          context.beginPath();
          context.arc(node.x, node.y, node.radius + (active ? 4 : 2.5), 0, Math.PI * 2);
          context.stroke();
        }
        context.fillStyle = node.color;
        context.beginPath();
        context.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        context.fill();
      }
      context.globalAlpha = 1;

      const marks = projected.map(node => ({ id: node.id, x: node.x - node.radius - 2, y: node.y - node.radius - 2,
        width: 2 * node.radius + 4, height: 2 * node.radius + 4 }));
      function available(bounds: Bounds, ownMark?: string) {
        return bounds.x >= 5 && bounds.y >= 5 && bounds.x + bounds.width <= current.width - 5
          && bounds.y + bounds.height <= current.height - 5 && !reserved.some(area => inBounds(area, bounds))
          && !marks.some(mark => mark.id !== ownMark && inBounds(mark, bounds));
      }
      const caption = (text: string, bounds: Bounds, hit: Hit, background: string, color: string) => {
        context.fillStyle = background;
        context.beginPath();
        context.roundRect(bounds.x, bounds.y, bounds.width, bounds.height, 4);
        context.fill();
        context.fillStyle = color;
        context.textBaseline = 'middle';
        context.textAlign = 'left';
        context.fillText(text, bounds.x + 4, bounds.y + bounds.height / 2);
        reserved.push(bounds);
        drawn.current.labels.push({ hit, bounds });
      };
      // Keep label sizes and placement order independent of pointer and selection highlights.
      context.font = `500 12px ${fontFamily}`;
      const orderedNodes = [...projected].sort((left, right) =>
        (degrees.current.get(right.id) ?? 0) - (degrees.current.get(left.id) ?? 0) || left.id.localeCompare(right.id));
      const unplaced: { node: ProjectedNode; label: string; candidates: Bounds[] }[] = [];
      const drawNodeLabel = (node: ProjectedNode, label: string, bounds: Bounds) => {
        const highlighted = node.id === model.selectedNodeId || node.id === hover.current?.id
          || adjacent.has(node.id) || highlightedNodes.has(node.id);
        caption(label, bounds, { kind: 'node', id: node.id }, palette.panel, highlighted ? palette.text : palette.muted);
      };
      for (const node of orderedNodes) {
        const label = node.label.length > 30 ? node.label.slice(0, 29) + '…' : node.label;
        const width = context.measureText(label).width + 8;
        const height = 17;
        const gap = node.radius + 7;
        const candidates = [
          { x: node.x + gap, y: node.y - height / 2 },
          { x: node.x - width - gap, y: node.y - height / 2 },
          { x: node.x - width / 2, y: node.y + gap },
          { x: node.x - width / 2, y: node.y - height - gap },
        ].map(point => ({ ...point, width, height }));
        const previous = labelSlots.current.get(node.id);
        const bounds = previous === undefined ? undefined : candidates[previous];
        if (bounds && available(bounds, node.id)) drawNodeLabel(node, label, bounds);
        else if (labelSettleTimer.current === undefined) unplaced.push({ node, label, candidates });
      }
      // Resolve collisions after camera motion stops, giving established labels their space first.
      for (const { node, label, candidates } of unplaced) {
        const slot = candidates.findIndex(bounds => available(bounds, node.id));
        if (slot < 0) continue;
        labelSlots.current.set(node.id, slot);
        drawNodeLabel(node, label, candidates[slot]);
      }

      if (highlightedNodes.size) captions.reverse();
      for (const edge of captions) {
        const width = context.measureText(edge.text).width + 8;
        const textX = edge.center.x - width / 2;
        const preferred = [-15, 5, -30, 20].map(offset => ({
          x: textX, y: edge.center.y + offset, width, height: 19,
        })).find(bounds => available(bounds));
        if (preferred) caption(edge.text, preferred, { kind: 'edge', id: edge.id }, palette.tag, palette.text);
      }

    });
  }, []);

  const updateHover = useCallback((hit?: Hit) => {
    const previous = hover.current;
    if (previous?.kind === hit?.kind && previous?.id === hit?.id) return;
    hover.current = hit;
    schedule();
  }, [schedule]);

  const fitView = useCallback(() => {
    const fitted = fitCamera(points.current, viewport.current);
    camera.current = fitted;
    minZoom.current = Math.min(0.42, fitted.zoom * 0.8);
    window.clearTimeout(labelSettleTimer.current);
    labelSettleTimer.current = undefined;
  }, []);

  useLayoutEffect(() => {
    live.current = props;
    const nodeIds = new Set(props.nodes.map(node => node.id));
    const nodesChanged = points.current.size !== nodeIds.size || [...nodeIds].some(id => !points.current.has(id));
    const edgeTopology = JSON.stringify(props.edges.map(edge => [edge.id, edge.source, edge.target]));
    const edgesChanged = scene.current.edgeTopology !== edgeTopology;
    const positionsChanged = scene.current.positions !== props.positions;
    const reset = scene.current.resetSignal !== props.resetSignal;
    if (nodesChanged || edgesChanged || positionsChanged || reset) updateHover();
    if (reset) labelSlots.current.clear();
    else if (nodesChanged) for (const id of labelSlots.current.keys()) {
      if (!nodeIds.has(id)) labelSlots.current.delete(id);
    }
    if (nodesChanged || positionsChanged) {
      const supplied = props.positions;
      const visible = relationshipPositions([...nodeIds].filter(id => !supplied?.has(id)));
      if (supplied) for (const id of nodeIds) {
        const point = supplied.get(id);
        if (point) visible.set(id, point);
      }
      points.current = visible;
    }
    if (edgesChanged) {
      degrees.current = nodeDegrees(props.edges);
      lanes.current = edgeLanes(props.edges);
    }
    if (nodesChanged || reset) fitView();
    scene.current = { edgeTopology, positions: props.positions, resetSignal: props.resetSignal };
    schedule();
  }, [props, fitView, schedule, updateHover]);

  useLayoutEffect(() => {
    const wrapper = host.current;
    const element = canvas.current;
    if (!wrapper || !element) return;
    function resize() {
      if (!wrapper || !element) return;
      const width = wrapper.clientWidth;
      const height = wrapper.clientHeight;
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      viewport.current = { width, height, pixelRatio };
      element.width = Math.round(width * pixelRatio);
      element.height = Math.round(height * pixelRatio);
      fitView();
      updateHover();
      schedule();
    }
    const observer = new ResizeObserver(resize);
    observer.observe(wrapper);
    resize();
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      updateHover();
      const rect = element.getBoundingClientRect();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1);
      changeZoom(Math.exp(-clamp(delta, -300, 300) * 0.0016), {
        x: event.clientX - rect.left, y: event.clientY - rect.top,
      });
    };
    element.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      observer.disconnect();
      element.removeEventListener('wheel', handleWheel);
      updateHover();
      if (frame.current !== undefined) window.cancelAnimationFrame(frame.current);
      frame.current = undefined;
      window.clearTimeout(labelSettleTimer.current);
      labelSettleTimer.current = undefined;
    };
  }, [fitView, schedule, updateHover]);

  function deferLabelPlacement() {
    window.clearTimeout(labelSettleTimer.current);
    labelSettleTimer.current = window.setTimeout(() => {
      labelSettleTimer.current = undefined;
      schedule();
    }, labelSettleDelay);
  }

  function changeZoom(factor: number, anchor: Point = { x: viewport.current.width / 2, y: viewport.current.height / 2 }) {
    const view = camera.current;
    const next = clamp(view.zoom * factor, minZoom.current, 3.8);
    if (next === view.zoom) return;
    const ratio = next / view.zoom;
    const dx = anchor.x - viewport.current.width / 2;
    const dy = anchor.y - viewport.current.height / 2;
    view.offsetX = dx + (view.offsetX - dx) * ratio;
    view.offsetY = dy + (view.offsetY - dy) * ratio;
    view.zoom = next;
    deferLabelPlacement();
    schedule();
  }

  function pointerPoint(event: PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function hitAt(point: Point): Hit | undefined {
    for (const node of [...drawn.current.nodes].reverse()) {
      if (Math.hypot(point.x - node.x, point.y - node.y) <= node.radius + 4) return { kind: 'node', id: node.id };
    }
    for (const { bounds, hit } of drawn.current.labels) {
      if (point.x >= bounds.x && point.x <= bounds.x + bounds.width && point.y >= bounds.y && point.y <= bounds.y + bounds.height) return hit;
    }
    let distance = 7;
    let found: string | undefined;
    for (const { id, path } of drawn.current.edges) {
      let prev = path.start;
      for (let step = 1; step <= 9; step++) {
        const next = atCurve(path, step / 9);
        const against = pointSegmentDistance(point, prev, next);
        if (against < distance) {
          distance = against;
          found = id;
        }
        prev = next;
      }
    }
    return found ? { kind: 'edge', id: found } : undefined;
  }

  function beginDrag(event: PointerEvent<HTMLCanvasElement>) {
    const { button, currentTarget, pointerId, shiftKey } = event;
    if (drag.current || (button !== 0 && button !== 1 && button !== 2)) return;
    if (button !== 0) event.preventDefault();
    updateHover();
    const start = pointerPoint(event);
    const mode = button === 1 ? 'zoom' : button === 2 || shiftKey ? 'pan' : 'rotate';
    drag.current = { id: pointerId, button, mode, start, last: start, moved: false };
    currentTarget.setPointerCapture(pointerId);
  }

  function movePointer(event: PointerEvent<HTMLCanvasElement>) {
    const point = pointerPoint(event);
    const origin = drag.current;
    if (origin) {
      if (origin.id !== event.pointerId) return;
      if (event.pointerType === 'mouse' && !(event.buttons & pressedButtonMasks[origin.button])) {
        finishDrag(event, true);
        return;
      }
      const offsetX = point.x - origin.start.x;
      const offsetY = point.y - origin.start.y;
      const distance = origin.mode === 'zoom' ? Math.abs(offsetY) : Math.hypot(offsetX, offsetY);
      if (!origin.moved && distance < dragThreshold) return;
      origin.moved = true;
      event.currentTarget.style.cursor = origin.mode === 'zoom' ? 'ns-resize' : 'grabbing';
      const dx = point.x - origin.last.x;
      const dy = point.y - origin.last.y;
      origin.last = point;
      if (origin.mode === 'zoom') {
        if (dy) changeZoom(Math.exp(-dy * 0.008), origin.start);
        return;
      }
      if (origin.mode === 'pan') {
        camera.current.offsetX += dx;
        camera.current.offsetY += dy;
      } else {
        camera.current.yaw += dx * 0.008;
        camera.current.pitch = clamp(camera.current.pitch - dy * 0.008, -1.38, 1.38);
      }
      deferLabelPlacement();
      schedule();
      return;
    }
    const hit = event.pointerType === 'touch' || event.buttons !== 0 ? undefined : hitAt(point);
    event.currentTarget.style.cursor = hit ? 'pointer' : '';
    updateHover(hit);
  }

  function finishDrag(event: PointerEvent<HTMLCanvasElement>, cancelled = false) {
    const origin = drag.current;
    if (origin?.id !== event.pointerId) return;
    drag.current = undefined;
    const { currentTarget, pointerId } = event;
    if (currentTarget.hasPointerCapture(pointerId)) currentTarget.releasePointerCapture(pointerId);
    let hit: Hit | undefined;
    if (!cancelled && !origin.moved && origin.button === 0 && event.button === 0) {
      const point = pointerPoint(event);
      if (Math.hypot(point.x - origin.start.x, point.y - origin.start.y) < dragThreshold) hit = hitAt(point);
    }
    currentTarget.style.cursor = hit ? 'pointer' : '';
    if (hit?.kind === 'node') live.current.onSelectNode(hit.id);
    if (hit?.kind === 'edge') live.current.onSelectEdge(hit.id);
    schedule();
  }

  function onKeyDown(event: KeyboardEvent<HTMLCanvasElement>) {
    switch (event.key) {
      case 'ArrowLeft': camera.current.yaw -= 0.15; break;
      case 'ArrowRight': camera.current.yaw += 0.15; break;
      case 'ArrowUp': camera.current.pitch = clamp(camera.current.pitch + 0.15, -1.38, 1.38); break;
      case 'ArrowDown': camera.current.pitch = clamp(camera.current.pitch - 0.15, -1.38, 1.38); break;
      case '+':
      case '=': changeZoom(1.15); break;
      case '-': changeZoom(1 / 1.15); break;
      case '0': labelSlots.current.clear(); fitView(); break;
      default: return;
    }
    event.preventDefault();
    if (event.key.startsWith('Arrow')) deferLabelPlacement();
    updateHover();
    schedule();
  }

  const highlightedEdgeCount = props.edges.filter(edge => props.highlightedEdgeIds?.has(edge.id)).length;
  return <div className="relationship-map" ref={host}>
    <canvas
      ref={canvas}
      tabIndex={0}
      aria-label={`带 X、Y、Z 方位轴的对象空间关系图。实线表示记录关联，虚线表示候选关系。${
        highlightedEdgeCount ? `已高亮 ${highlightedEdgeCount} 条查询关系。` : ''
      }左键拖动旋转，右键拖动平移，中键上下拖动或滚轮缩放。方向键旋转，加减键缩放，数字零重置视角。`}
      onPointerDown={beginDrag}
      onPointerMove={movePointer}
      onPointerUp={finishDrag}
      onPointerCancel={event => finishDrag(event, true)}
      onLostPointerCapture={event => finishDrag(event, true)}
      onContextMenu={event => event.preventDefault()}
      onMouseDown={event => { if (event.button === 1) event.preventDefault(); }}
      onAuxClick={event => { if (event.button === 1) event.preventDefault(); }}
      onPointerLeave={event => {
        if (!drag.current) event.currentTarget.style.cursor = '';
        updateHover();
      }}
      onKeyDown={onKeyDown}
    />
  </div>;
}
