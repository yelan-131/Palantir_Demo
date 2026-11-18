import { FLOW_NODE_SIZE } from './flowNodeSnap';
import { widgetFontOptions } from '../AppPrograms/analyticsWidgetAppearance';
import { translateFlowRoute, type FlowRoutePoint } from './flowEdgeRoute';
import type { FlowDesignerEdge } from './ProfessionalFlowDesigner';

interface FlowAnnotationTitleStyle {
  fontFamily?: string;
  fontSize?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

export type FlowAnnotationBorderStyle = 'solid' | 'dashed' | 'dotted' | 'none';

interface FlowAnnotationFrameStyle {
  backgroundColor?: string;
  backgroundOpacity?: number;
  borderColor?: string;
  borderStyle?: FlowAnnotationBorderStyle;
  borderWidth?: number;
  borderRadius?: number;
}

export interface FlowAnnotation {
  id: string;
  nodeIds: string[];
  title: string;
  color: string;
  titleStyle?: FlowAnnotationTitleStyle;
  frameStyle?: FlowAnnotationFrameStyle;
  size?: FlowAnnotationSize;
}

export type FlowAnnotationSize = { width: number; height: number };
type FlowAnnotationBounds = FlowAnnotationSize & { left: number; top: number };

export const DEFAULT_FLOW_ANNOTATION_COLOR = '#527d9b';
export const FLOW_ANNOTATION_TITLE_LIMIT = 80;
export const FLOW_ANNOTATION_APPEARANCE = {
  fontSize: { min: 10, max: 32, initial: 12 },
  backgroundOpacity: { min: 0, max: 100, initial: 8 },
  borderWidth: { min: 1, max: 8, initial: 1 },
  borderRadius: { min: 0, max: 32, initial: 9 },
  borderStyles: ['solid', 'dashed', 'dotted', 'none'] as const,
};

const readHex = (value: unknown) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : undefined;
const readBoolean = (value: unknown) => typeof value === 'boolean' ? value : undefined;
const readNumber = (value: unknown, limits: { min: number; max: number }) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(limits.max, Math.max(limits.min, Math.round(value))) : undefined;

function readSize(size: FlowAnnotationSize | undefined) {
  if (!size || !Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) return undefined;
  return { width: size.width, height: size.height };
}

export function resizeFlowAnnotation(size: FlowAnnotationSize, delta: FlowRoutePoint, minimum: FlowAnnotationSize): FlowAnnotationSize {
  return {
    width: Math.max(minimum.width, Math.round(size.width + delta.x)),
    height: Math.max(minimum.height, Math.round(size.height + delta.y)),
  };
}

function readTitleStyle(style: FlowAnnotationTitleStyle | undefined) {
  if (!style) return undefined;
  return {
    fontFamily: widgetFontOptions.some(({ value }) => value === style.fontFamily) ? style.fontFamily : undefined,
    fontSize: readNumber(style.fontSize, FLOW_ANNOTATION_APPEARANCE.fontSize),
    color: readHex(style.color),
    bold: readBoolean(style.bold),
    italic: readBoolean(style.italic),
    underline: readBoolean(style.underline),
  };
}

function readFrameStyle(style: FlowAnnotationFrameStyle | undefined) {
  if (!style) return undefined;
  return {
    backgroundColor: readHex(style.backgroundColor),
    backgroundOpacity: readNumber(style.backgroundOpacity, FLOW_ANNOTATION_APPEARANCE.backgroundOpacity),
    borderColor: readHex(style.borderColor),
    borderStyle: style.borderStyle && FLOW_ANNOTATION_APPEARANCE.borderStyles.includes(style.borderStyle) ? style.borderStyle : undefined,
    borderWidth: readNumber(style.borderWidth, FLOW_ANNOTATION_APPEARANCE.borderWidth),
    borderRadius: readNumber(style.borderRadius, FLOW_ANNOTATION_APPEARANCE.borderRadius),
  };
}

export function readFlowAnnotations(value: unknown, nodes: ReadonlyArray<{ id: string }>) {
  if (!Array.isArray(value)) return undefined;
  const nodeIds = new Set(nodes.map((node) => node.id));
  const annotationIds = new Set<string>();
  const annotations: FlowAnnotation[] = [];
  for (const annotation of value as Array<Partial<FlowAnnotation> | null>) {
    if (!annotation || typeof annotation.id !== 'string' || !annotation.id
      || annotationIds.has(annotation.id) || !Array.isArray(annotation.nodeIds)) continue;
    const members = [...new Set(annotation.nodeIds.filter((id) => nodeIds.has(id)))];
    if (!members.length) continue;
    annotationIds.add(annotation.id);
    const size = readSize(annotation.size);
    annotations.push({
      id: annotation.id,
      nodeIds: members,
      title: typeof annotation.title === 'string' ? annotation.title.slice(0, FLOW_ANNOTATION_TITLE_LIMIT) : '',
      color: readHex(annotation.color) ?? DEFAULT_FLOW_ANNOTATION_COLOR,
      ...(annotation.titleStyle && { titleStyle: readTitleStyle(annotation.titleStyle) }),
      ...(annotation.frameStyle && { frameStyle: readFrameStyle(annotation.frameStyle) }),
      ...(size && { size }),
    });
  }
  return annotations.length ? annotations : undefined;
}

export function getFlowAnnotationTitleSpace(annotation: FlowAnnotation) {
  const fontSize = annotation.titleStyle?.fontSize ?? FLOW_ANNOTATION_APPEARANCE.fontSize.initial;
  const borderWidth = annotation.frameStyle?.borderWidth ?? FLOW_ANNOTATION_APPEARANCE.borderWidth.initial;
  return Math.max(40, Math.ceil(fontSize * 1.25) + borderWidth + 18);
}

export function getFlowAnnotationFrames(annotations: FlowAnnotation[], nodes: ReadonlyArray<{ id: string; x: number; y: number }>) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  return annotations.flatMap((annotation) => {
    const members = annotation.nodeIds.map((id) => nodeById.get(id)).filter((node) => node !== undefined);
    if (!members.length) return [];
    const left = Math.max(0, Math.min(...members.map((node) => node.x)) - 16);
    const top = Math.max(0, Math.min(...members.map((node) => node.y)) - getFlowAnnotationTitleSpace(annotation));
    const right = Math.max(...members.map((node) => node.x)) + FLOW_NODE_SIZE.width + 16;
    const bottom = Math.max(...members.map((node) => node.y)) + FLOW_NODE_SIZE.height + 16;
    const minimum = { width: right - left, height: bottom - top };
    const size = annotation.size ? resizeFlowAnnotation(annotation.size, { x: 0, y: 0 }, minimum) : minimum;
    return [{ annotation, minimum, bounds: { left, top, ...size } }];
  });
}

export function getFlowMarqueeItems(
  area: FlowAnnotationBounds,
  nodes: ReadonlyArray<{ id: string; x: number; y: number }>,
  frames: ReadonlyArray<{ annotation: FlowAnnotation; bounds: FlowAnnotationBounds }>,
) {
  const right = area.left + area.width;
  const bottom = area.top + area.height;
  const nodeIds = nodes.filter(({ x, y }) => x < right && x + FLOW_NODE_SIZE.width > area.left
    && y < bottom && y + FLOW_NODE_SIZE.height > area.top).map(({ id }) => id);
  // Enclose the frame to select it. A marquee around only some of its nodes still selects those nodes independently.
  const annotationIds = frames.filter(({ bounds }) => bounds.left >= area.left && bounds.top >= area.top
    && bounds.left + bounds.width <= right && bounds.top + bounds.height <= bottom).map(({ annotation }) => annotation.id);
  return { nodeIds, annotationIds };
}

export function translateAnnotationRoutes(edges: FlowDesignerEdge[], nodeIds: ReadonlySet<string>, delta: FlowRoutePoint) {
  return edges.map((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target) ? translateFlowRoute(edge, delta) : edge);
}
