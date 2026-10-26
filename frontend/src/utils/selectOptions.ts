import { enumOptions, type ControlSettings } from './formControls';

export type SelectOption = { label: string; value: string | number };
/** JSON preserves labels, numeric codes and delimiters; old delimited lists remain readable. */
export function parseStaticOptions(source?: string, fallback?: unknown): SelectOption[] {
  if (source === undefined) return enumOptions(fallback);
  if (!source.trim()) return [];
  try { return enumOptions(JSON.parse(source)); } catch {
    const values = source.split(/[、,/，|\n]/).map(value => value.trim()).filter(Boolean);
    const existing = enumOptions(fallback);
    if (existing.length === values.length && existing.every((option, index) => String(option.value) === values[index])) return existing;
    return values.map(value => ({ label: value, value }));
  }
}
export function staticOptionErrors(options: SelectOption[]): string[] {
  const errors: string[] = [];
  if (!options.length) errors.push('请至少添加一个选项');
  const values = new Set<string>();
  options.forEach((option, index) => {
    if (!option.label.trim()) errors.push(`第 ${index + 1} 项缺少显示名称`);
    const key = String(option.value).trim();
    if (!key) errors.push(`第 ${index + 1} 项缺少存储值`);
    if (values.has(key)) errors.push(`第 ${index + 1} 项存储值重复：${key}`);
    values.add(key);
  });
  return errors;
}
export function normalizeSelection(settings: ControlSettings, patch: Partial<ControlSettings>, isStatic: boolean): ControlSettings {
  const next = { ...settings, ...patch };
  if (!isStatic) return { ...next, selectionMode: 'single', displayMode: ['dropdown', 'search'].includes(next.displayMode || '') ? next.displayMode : 'search', allowCreateOption: false };
  if (patch.displayMode === 'tags') next.selectionMode = 'multiple';
  if (patch.selectionMode === 'single' && next.displayMode === 'tags') next.displayMode = 'dropdown';
  if (next.selectionMode !== 'multiple' || next.displayMode === 'radio') next.allowCreateOption = false;
  return next;
}

export function selectionCountError(value: unknown, settings: ControlSettings = {}): string | undefined {
  if (settings.selectionMode !== 'multiple' && settings.displayMode !== 'tags') return;
  const count = Array.isArray(value) ? value.length : 0;
  if (settings.minSelections !== undefined && count < settings.minSelections) return `至少选择 ${settings.minSelections} 项`;
  if (settings.maxSelections !== undefined && count > settings.maxSelections) return `最多选择 ${settings.maxSelections} 项`;
}
export function selectionConfigErrors(settings: ControlSettings, optionCount?: number): string[] {
  if (settings.selectionMode !== 'multiple' && settings.displayMode !== 'tags') return [];
  const errors: string[] = [];
  for (const [key, title, min] of [['minSelections', '最少选择', 0], ['maxSelections', '最多选择', 1], ['maxVisibleTags', '显示标签数', 1]] as const) {
    const value = settings[key];
    if (value !== undefined && (!Number.isInteger(value) || value < min || value > 1000)) errors.push(`${title}需要是 ${min}～1000 的整数`);
  }
  if (settings.minSelections !== undefined && settings.maxSelections !== undefined && settings.minSelections > settings.maxSelections) errors.push('最少选择不能大于最多选择');
  if (!settings.allowCreateOption && optionCount !== undefined && (settings.minSelections || 0) > optionCount) errors.push('最少选择不能超过候选选项数量');
  if (settings.tagCollapse && !['none', 'responsive', 'fixed'].includes(settings.tagCollapse)) errors.push('标签折叠方式无效');
  return errors;
}
