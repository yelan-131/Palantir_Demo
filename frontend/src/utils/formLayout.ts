/** Flat editor storage with stable parent/slot references; old controls remain roots. */
export interface ControlPresentation {
  startNewRow?: boolean;
  labelPosition?: 'top' | 'left';
  labelAlign?: 'left' | 'right';
  labelWidth?: number;
  spacingAfter?: number;
  borderRadius?: number;
  fontSize?: number;
  labelFontSize?: number;
  controlHeight?: number;
  controlWidth?: number;
}

/** Old and malformed saved configurations share the same safe display defaults. */
export function getControlPresentation(presentation?: ControlPresentation): Required<Pick<ControlPresentation, 'startNewRow' | 'labelPosition' | 'labelAlign' | 'labelWidth' | 'spacingAfter'>> & ControlPresentation {
  const value = presentation && typeof presentation === 'object' ? presentation : {};
  const bounded = (number: unknown, fallback: number, min: number, max: number) => typeof number === 'number' && Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
  return {
    startNewRow: value.startNewRow === true,
    labelPosition: value.labelPosition === 'left' ? 'left' : 'top',
    labelAlign: value.labelAlign === 'right' ? 'right' : 'left',
    labelWidth: bounded(value.labelWidth, 96, 64, 240),
    spacingAfter: bounded(value.spacingAfter, 0, 0, 48),
    ...Object.fromEntries(([
      ['borderRadius', 0, 24], ['fontSize', 10, 24], ['labelFontSize', 10, 24], ['controlHeight', 24, 64],
      ['controlWidth', 80, 1600],
    ] as const).flatMap(([key, min, max]) => typeof value[key] === 'number' && Number.isFinite(value[key]) ? [[key, bounded(value[key], min, min, max)]] : [])),
  };
}

/** Only explicit overrides affect appearance; existing forms keep the current theme. */
export function getControlAppearance(presentation?: ControlPresentation) {
  const value = getControlPresentation(presentation);
  const keys = ['borderRadius', 'fontSize', 'labelFontSize', 'controlHeight', 'controlWidth'] as const;
  return {
    className: ['form-control-presentation', ...keys.filter(key => value[key] !== undefined).map(key => `has-${key}`)].join(' '),
    style: Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [`--field-${key}`, `${value[key]}px`])),
  };
}

export function getControlColumnSpan(width?: string): number {
  return ({ quarter: 3, third: 4, half: 6, twoThird: 8, threeQuarter: 9 } as Record<string, number>)[width || ''] || 12;
}

export interface LayoutPlacement {
  id: string; controlType: string; parentId?: string; slotId?: string;
  name?: string; fieldKey?: string; width?: string;
  presentation?: ControlPresentation;
  layout?: { columns?: number; ratios?: number[]; gap?: number; collapsible?: boolean; defaultCollapsed?: boolean; tabs?: { id: string; label: string }[] };
  rules?: { visible?: { enabled?: boolean }; readonly?: { enabled?: boolean } };
}
export const isLayoutContainer = (control?: Pick<LayoutPlacement, 'controlType'>) => Boolean(control && ['container', 'two-columns', 'tabs'].includes(control.controlType));
export function layoutSlots(control: LayoutPlacement): { id: string; label: string }[] {
  if (control.controlType === 'tabs') return control.layout?.tabs?.length ? control.layout.tabs : [{ id: 'tab-1', label: '基础信息' }, { id: 'tab-2', label: '扩展信息' }];
  if (control.controlType === 'two-columns') return Array.from({ length: Math.min(4, Math.max(2, control.layout?.columns || 2)) }, (_, index) => ({ id: String(index), label: `第 ${index + 1} 列` }));
  return [{ id: 'body', label: '内容区' }];
}
export function normalizeLayout<T extends LayoutPlacement>(controls: T[]): T[] {
  const ids = new Set<string>();
  const clean = controls.filter(item => item?.id && !ids.has(item.id) && Boolean(ids.add(item.id))).map(item => ({ ...item, ...(item.presentation !== undefined ? { presentation: getControlPresentation(item.presentation) } : {}) }));
  const byId = new Map(clean.map(item => [item.id, item]));
  for (const item of clean) {
    const parent = item.parentId ? byId.get(item.parentId) : undefined;
    const seen = new Set([item.id]); let cursor = parent; let invalid = false;
    while (cursor) { if (seen.has(cursor.id)) { invalid = true; break; } seen.add(cursor.id); cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined; }
    if (!isLayoutContainer(parent) || invalid) { delete item.parentId; delete item.slotId; }
    else item.slotId = layoutSlots(parent!).some(slot => slot.id === item.slotId) ? item.slotId : layoutSlots(parent!)[0].id;
  }
  return clean;
}
export function layoutDescendants(controls: LayoutPlacement[], id: string): Set<string> {
  const result = new Set([id]); let changed = true;
  while (changed) { changed = false; for (const item of controls) if (item.parentId && result.has(item.parentId) && !result.has(item.id)) { result.add(item.id); changed = true; } }
  return result;
}
export function placeLayoutControl<T extends LayoutPlacement>(controls: T[], id: string, parentId?: string, slotId?: string, beforeId?: string): T[] {
  const moving = controls.find(item => item.id === id); if (!moving) return controls;
  if (parentId && layoutDescendants(controls, id).has(parentId)) return controls;
  const parent = controls.find(item => item.id === parentId);
  if (parentId && !isLayoutContainer(parent)) return controls;
  const next = controls.filter(item => item.id !== id);
  const placed = { ...moving, parentId, slotId: parent ? (slotId || layoutSlots(parent)[0].id) : undefined };
  const index = beforeId ? next.findIndex(item => item.id === beforeId) : -1;
  next.splice(index < 0 ? next.length : index, 0, placed);
  return normalizeLayout(next);
}
/** Removing a group unwraps its children, keeping every field and its order. */
export function unwrapLayoutControl<T extends LayoutPlacement>(controls: T[], id: string): T[] {
  const target = controls.find(item => item.id === id); if (!target) return controls;
  const children = controls.filter(item => item.parentId === id).map(item => ({ ...item, parentId: target.parentId, slotId: target.slotId }));
  const next = controls.filter(item => item.id !== id && item.parentId !== id);
  const position = controls.findIndex(item => item.id === id);
  next.splice(Math.min(position, next.length), 0, ...children);
  return normalizeLayout(next);
}
export function cloneLayoutSubtree<T extends LayoutPlacement>(controls: T[], id: string, newId: () => string): T[] {
  const descendants = layoutDescendants(controls, id);
  const originals = controls.filter(item => descendants.has(item.id));
  const ids = new Map(originals.map(item => [item.id, newId()]));
  return originals.map(item => ({ ...JSON.parse(JSON.stringify(item)), id: ids.get(item.id)!, parentId: item.id === id ? item.parentId : ids.get(item.parentId!) }));
}
export interface FormLayoutNode {
  id: string; kind: 'field' | 'container' | 'two-columns' | 'tabs' | 'divider';
  label?: string; width?: string; fieldName?: string; slotId?: string; readonly?: boolean;
  presentation?: ControlPresentation;
  layout?: LayoutPlacement['layout']; children?: FormLayoutNode[];
}
export function buildRuntimeLayout<T extends LayoutPlacement>(controls: T[], fieldPayload: (control: T, inheritedReadonly: boolean) => Record<string, unknown>) {
  const normalized = normalizeLayout(controls); const flat: Record<string, unknown>[] = [];
  const walk = (parentId?: string, readonly = false): FormLayoutNode[] => normalized.filter(item => item.parentId === parentId && item.rules?.visible?.enabled !== false).flatMap<FormLayoutNode>(item => {
    const inherited = readonly || item.rules?.readonly?.enabled === true;
    const presentation = getControlPresentation(item.presentation);
    if (item.fieldKey) { const payload = { ...fieldPayload(item, inherited), presentation: { ...presentation } }; flat.push(payload); return [{ id: item.id, kind: 'field' as const, width: item.width, fieldName: item.fieldKey, label: item.name, readonly: inherited, slotId: item.slotId, presentation }]; }
    if (isLayoutContainer(item)) return [{ id: item.id, kind: item.controlType as 'container', label: item.name, width: item.width, slotId: item.slotId, layout: item.layout, presentation, children: walk(item.id, inherited) }];
    return item.controlType === 'divider' ? [{ id: item.id, kind: 'divider' as const, label: item.name, width: 'full', slotId: item.slotId, presentation }] : [];
  });
  const nodes = walk();
  return { version: 2, nodes, sections: [{ id: 'section-business-info', title: '业务信息', fields: flat }] };
}
