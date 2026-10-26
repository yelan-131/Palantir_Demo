import { choiceLabel } from '@/utils/formControls';

export interface DisplayField {
  value?: unknown;
  enum_values?: unknown;
  ui_config?: Record<string, any> | null;
  value_labels?: Record<string, string>;
}

export function displayWorkflowValue(field: DisplayField, value: unknown): string {
  if (value == null || value === '') return '-';
  if (field.value_labels) {
    if (Array.isArray(value)) return value.map(item => field.value_labels![String(item)] ?? String(item)).join('、');
    if (String(value) in field.value_labels) return field.value_labels[String(value)];
  }
  if (field.enum_values) return choiceLabel(value, field.enum_values);
  if (typeof value === 'boolean') {
    const settings = field.ui_config?.typeSettings || {};
    return value ? settings.checkedText || '是' : settings.uncheckedText || '否';
  }
  if (Array.isArray(value)) return value.map(item => displayWorkflowValue(field, item)).join('、');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
