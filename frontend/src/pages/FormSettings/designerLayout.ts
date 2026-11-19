import { buildRuntimeLayout, normalizeLayout, type FormLayoutNode } from '@/utils/formLayout';
import { makeAiLayoutControl, makeFieldControl, normalizeControlRules } from './fieldModel';
import type { ControlWidth, DesignerField, LayoutControl } from './designerTypes';

function layoutNodes(value: unknown): FormLayoutNode[] | undefined {
  const layout = value as { version?: unknown; nodes?: unknown } | undefined;
  return layout?.version === 2 && Array.isArray(layout.nodes) ? layout.nodes : undefined;
}

const widths: readonly string[] = ['quarter', 'third', 'half', 'twoThird', 'threeQuarter', 'full'];

export function restoreDesignerLayout(fields: DesignerField[], saved: unknown, inlineLayout: unknown, storedLayout: unknown): LayoutControl[] {
  const byField = new Map(fields.map(field => [field.key, field]));
  const savedControls = Array.isArray(saved) ? normalizeLayout((saved as LayoutControl[])
    .filter(control => control && typeof control.id === 'string' && typeof control.controlType === 'string'
      && ['field', 'component'].includes(control.source) && (control.source !== 'field' || byField.has(String(control.fieldKey))))
    .map(control => ({ ...control, computed: control.computed === undefined ? byField.get(String(control.fieldKey))?.calculationRule : control.computed,
      rules: normalizeControlRules(control.rules) }))) : undefined;
  const inlineNodes = layoutNodes(inlineLayout);
  const nodes = layoutNodes(storedLayout) ?? inlineNodes;
  if (!nodes || (savedControls && JSON.stringify(nodes) === JSON.stringify(inlineNodes))) {
    return savedControls ?? fields.map(makeFieldControl);
  }

  const current = savedControls ?? [];
  const byId = new Map(current.map(control => [control.id, control]));
  const savedFields = new Map(current.filter(control => control.fieldKey).map(control => [control.fieldKey, control]));
  const projectedIds = new Set<string>();
  function recordProjectedIds(items: FormLayoutNode[]) {
    for (const node of items) {
      if (!node) continue;
      projectedIds.add(node.id);
      if (Array.isArray(node.children)) recordProjectedIds(node.children);
    }
  }
  recordProjectedIds(inlineNodes ?? buildRuntimeLayout(current, () => ({})).nodes);

  const restored: LayoutControl[] = [];
  const reused = new Set<string>();
  const nodeIds = new Set<string>();
  function restore(items: FormLayoutNode[], parentId?: string) {
    for (const node of items) {
      if (!node || typeof node.id !== 'string' || !node.id || nodeIds.has(node.id)) continue;
      const matching = byId.get(node.id);
      let previous: LayoutControl | undefined;
      let control: LayoutControl;
      if (node.kind === 'field') {
        const field = typeof node.fieldName === 'string' ? byField.get(node.fieldName) : undefined;
        if (!field) continue;
        previous = matching?.fieldKey === field.key ? matching : savedFields.get(field.key);
        control = previous ?? makeFieldControl(field);
      } else if (node.kind === 'container' || node.kind === 'two-columns' || node.kind === 'tabs' || node.kind === 'divider') {
        previous = matching?.controlType === node.kind ? matching : undefined;
        control = previous ?? makeAiLayoutControl(node.kind, node.id);
      } else continue;
      nodeIds.add(node.id);
      if (previous) reused.add(previous.id);
      restored.push({ ...control, id: node.id, parentId, slotId: node.slotId,
        name: typeof node.label === 'string' ? node.label : control.name,
        width: widths.includes(node.width ?? '') ? node.width as ControlWidth : control.width,
        layout: node.layout ?? control.layout, presentation: node.presentation ?? control.presentation,
        rules: !previous && node.readonly ? normalizeControlRules({ ...control.rules, readonly: { ...control.rules.readonly, enabled: true } }) : control.rules });
      if (Array.isArray(node.children)) restore(node.children, node.id);
    }
  }
  restore(nodes);
  // Runtime layouts omit hidden controls and editor-only components.
  return normalizeLayout([...restored, ...current.filter(control => !reused.has(control.id) && !projectedIds.has(control.id))]);
}
