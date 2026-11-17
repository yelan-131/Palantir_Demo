import { isLayoutContainer, layoutDescendants, layoutSlots, placeLayoutControl, type LayoutPlacement } from './formLayout';

export type AiLayoutControlType = 'container' | 'two-columns' | 'tabs' | 'divider';

interface Placement {
  parent_id?: string;
  slot_id?: string;
  before_id?: string;
}

interface Properties {
  name?: string;
  width?: 'quarter' | 'third' | 'half' | 'twoThird' | 'threeQuarter' | 'full';
  visible?: boolean;
  layout?: NonNullable<LayoutPlacement['layout']>;
}

export type AiLayoutOperation =
  | ({ op: 'add'; control_id: string; control_type: AiLayoutControlType; properties?: Properties } & Placement)
  | { op: 'update'; control_id: string; properties: Properties }
  | ({ op: 'move' } & ({ control_id: string; field_name?: never } | { field_name: string; control_id?: never }) & Placement);

const layoutKeys: Record<AiLayoutControlType, readonly string[]> = {
  container: ['gap', 'collapsible', 'defaultCollapsed'],
  'two-columns': ['gap', 'columns', 'ratios'],
  tabs: ['gap', 'tabs'],
  divider: [],
};

function isAiLayoutControlType(value: string): value is AiLayoutControlType {
  return Object.prototype.hasOwnProperty.call(layoutKeys, value);
}

function patchControl<T extends LayoutPlacement>(control: T, properties: Properties = {}): T {
  const type = control.controlType;
  if (!isAiLayoutControlType(type) || control.fieldKey) throw new Error('只能修改布局控件的属性');
  const patch = properties.layout;
  if (patch && Object.keys(patch).some(key => !layoutKeys[type].includes(key))) {
    throw new Error(`「${control.name}」不支持指定的布局属性`);
  }
  if (type === 'divider' && properties.width && properties.width !== 'full') {
    throw new Error('分割符必须占满一行');
  }

  const layout = patch ? { ...control.layout, ...patch } : control.layout;
  if (type === 'two-columns' && patch && layout) {
    const columns = layout.columns ?? 2;
    if (patch.ratios && patch.ratios.length !== columns) throw new Error('列比例数量必须等于列数');
    if (patch.columns && !patch.ratios) {
      layout.ratios = Array.from({ length: columns }, (_, index) => control.layout?.ratios?.[index] ?? 1);
    }
  }
  if (type === 'container' && patch?.defaultCollapsed && !layout?.collapsible) {
    throw new Error('设置默认收起前，需要允许容器折叠');
  }

  return {
    ...control,
    ...(properties.name !== undefined && { name: properties.name }),
    ...(properties.width !== undefined && { width: properties.width }),
    ...(patch && { layout }),
    ...(properties.visible !== undefined && {
      rules: { ...control.rules, visible: { ...control.rules?.visible, enabled: properties.visible } },
    }),
  };
}

function placeControl<T extends LayoutPlacement>(controls: T[], control: T, placement: Placement): T[] {
  const parent = controls.find(item => item.id === placement.parent_id);
  if (placement.parent_id && (!parent || !isLayoutContainer(parent))) {
    throw new Error('目标父级不存在或不能容纳控件');
  }
  if (parent && layoutDescendants(controls, control.id).has(parent.id)) {
    throw new Error('不能将控件移入自身或其子控件');
  }
  const slot = parent ? placement.slot_id ?? layoutSlots(parent)[0].id : undefined;
  if (placement.slot_id && (!parent || !layoutSlots(parent).some(item => item.id === slot))) {
    throw new Error('目标列或页签不存在');
  }
  if (placement.before_id) {
    const before = controls.find(item => item.id === placement.before_id);
    if (!before || before.id === control.id || before.parentId !== parent?.id || before.slotId !== slot) {
      throw new Error('排序目标必须是同一位置中的另一个控件');
    }
  }
  return placeLayoutControl(controls, control.id, parent?.id, slot, placement.before_id);
}

/** Build and validate the whole batch before the designer commits a single undo entry. */
export function applyAiLayoutOperations<T extends LayoutPlacement>(
  current: T[],
  operations: AiLayoutOperation[],
  createControl: (type: AiLayoutControlType, id: string) => T,
): T[] {
  let next = current;
  for (const operation of operations) {
    if (operation.op === 'add') {
      if (next.some(item => item.id === operation.control_id)) throw new Error('控件 ID 已存在，请先读取当前画布');
      const control = patchControl(createControl(operation.control_type, operation.control_id), operation.properties);
      next = placeControl([...next, control], control, operation);
      continue;
    }

    const matches = next.filter(item => operation.control_id
      ? item.id === operation.control_id
      : operation.op === 'move' && item.fieldKey === operation.field_name);
    if (matches.length !== 1) throw new Error('控件不存在或匹配了多个控件，请先读取当前画布');
    const [control] = matches;
    if (operation.op === 'move') {
      next = placeControl(next, control, operation);
      continue;
    }

    const updated = patchControl(control, operation.properties);
    const slots = layoutSlots(updated);
    if (next.some(item => item.parentId === updated.id && !slots.some(slot => slot.id === item.slotId))) {
      throw new Error('请先移出将被移除的列或页签中的控件');
    }
    next = next.map(item => item.id === updated.id ? updated : item);
  }
  return next;
}

export function describeAiLayout(controls: LayoutPlacement[]) {
  return controls.map(control => ({
    control_id: control.id,
    control_type: control.controlType,
    name: control.name,
    field_name: control.fieldKey,
    parent_id: control.parentId,
    slot_id: control.slotId,
    width: control.width,
    visible: control.rules?.visible?.enabled !== false,
    ...(isLayoutContainer(control) && { slots: layoutSlots(control), layout: control.layout }),
  }));
}
