import type { RuntimeAnalyticsDesign } from './analyticsTypes';

export type AnalyticsVersionChangeKind = 'added' | 'removed' | 'modified' | 'reordered';
export interface AnalyticsVersionChange {
  key: string;
  name: string;
  kind: AnalyticsVersionChangeKind;
}
export interface AnalyticsVersionChangeGroup {
  key: string;
  name: string;
  changes: AnalyticsVersionChange[];
}
export interface AnalyticsVersionDiff {
  changed: boolean;
  groups: AnalyticsVersionChangeGroup[];
  counts: Record<AnalyticsVersionChangeKind, number>;
  incompatibleSections: string[];
  snapshotCompatible: boolean;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

const same = (left: unknown, right: unknown) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));

type NamedItem = { id: string; title?: string; name?: string };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const stringList = (value: unknown) => value == null || Array.isArray(value) && value.every(item => typeof item === 'string');
function namedList(value: unknown): value is NamedItem[] {
  return Array.isArray(value) && value.every(item => record(item) && typeof item.id === 'string'
    && ['title', 'name'].every(key => item[key] == null || typeof item[key] === 'string'));
}

function incompatibleSections(design: RuntimeAnalyticsDesign): string[] {
  const sections: string[] = [];
  for (const [key, name, strings, lists] of [
    ['widgets', '组件', ['type', 'datasetId', 'dimension', 'width', 'interaction'], ['metricIds']],
    ['datasets', '数据集', ['sourceType', 'source', 'refreshMode'], ['dimensions', 'measures']],
    ['metrics', '指标', ['expression', 'datasetId', 'format', 'threshold', 'description', 'unit', 'sharedMetricId'], []],
  ] as const) {
    const value = design[key] ?? [];
    if (!namedList(value) || !value.every(item => {
      const data = item as unknown as Record<string, unknown>;
      return (key !== 'metrics' || data.sharedMetricVersion == null || Number.isInteger(data.sharedMetricVersion) && Number(data.sharedMetricVersion) > 0) && strings.every(field => data[field] == null || typeof data[field] === 'string') && lists.every(field => stringList(data[field]));
    })) sections.push(name);
  }
  if (!stringList(design.globalFilters)) sections.push('全局筛选');
  if (design.style != null && !record(design.style)) sections.push('看板样式');
  if (design.interactions != null && (!Array.isArray(design.interactions) || !design.interactions.every(item => record(item)
    && (['sourceWidgetId', 'targetWidgetId', 'action'] as const).every(key => typeof item[key] === 'string')))) sections.push('联动规则');
  return sections;
}

function compareCollection(key: string, name: string, before: unknown, after: unknown): AnalyticsVersionChangeGroup {
  const changes: AnalyticsVersionChange[] = [];
  if (same(before, after)) return { key, name, changes };
  if (!namedList(before) || !namedList(after)) return { key, name, changes: [{ key: `${key}-config`, name: `${name}配置`, kind: 'modified' }] };
  const previous = new Map(before.map(item => [item.id, item]));
  const next = new Map(after.map(item => [item.id, item]));
  const label = (item: NamedItem) => item.title || item.name || item.id;
  for (const item of after) {
    if (!previous.has(item.id)) changes.push({ key: item.id, name: label(item), kind: 'added' });
    else if (!same(previous.get(item.id), item)) changes.push({ key: item.id, name: label(item), kind: 'modified' });
  }
  for (const item of before) {
    if (!next.has(item.id)) changes.push({ key: item.id, name: label(item), kind: 'removed' });
  }
  // Adding/removing an item does not itself reorder the surviving items.
  const previousOrder = before.filter(item => next.has(item.id)).map(item => item.id);
  const nextOrder = after.filter(item => previous.has(item.id)).map(item => item.id);
  if (!same(previousOrder, nextOrder)) changes.push({ key: `${key}-order`, name: `${name}顺序`, kind: 'reordered' });
  // Keep malformed legacy snapshots visible in the comparison as well.
  if (!changes.length) changes.push({ key: `${key}-config`, name: `${name}配置`, kind: 'modified' });
  return { key, name, changes };
}

/** Describe changes from a published snapshot to the current draft. */
export function compareAnalyticsVersions(snapshot: RuntimeAnalyticsDesign, draft: RuntimeAnalyticsDesign): AnalyticsVersionDiff {
  const snapshotIssues = incompatibleSections(snapshot);
  const draftIssues = incompatibleSections(draft);
  const groups = [
    compareCollection('widgets', '组件', snapshot.widgets || [], draft.widgets || []),
    compareCollection('datasets', '数据集', snapshot.datasets || [], draft.datasets || []),
    compareCollection('metrics', '指标', snapshot.metrics || [], draft.metrics || []),
  ];
  const settings: AnalyticsVersionChange[] = [];
  for (const [key, name, fallback] of [
    ['globalFilters', '全局筛选', []], ['style', '看板样式', {}], ['interactions', '联动规则', []],
  ] as const) {
    if (!same(snapshot[key] ?? fallback, draft[key] ?? fallback)) settings.push({ key, name, kind: 'modified' });
  }
  const knownKeys = new Set(['widgets', 'datasets', 'metrics', 'globalFilters', 'style', 'interactions']);
  const extensions = (design: RuntimeAnalyticsDesign) => Object.fromEntries(Object.entries(design).filter(([key]) => !knownKeys.has(key)));
  if (!same(extensions(snapshot), extensions(draft))) settings.push({ key: 'extensions', name: '其他配置', kind: 'modified' });
  groups.push({ key: 'settings', name: '看板设置', changes: settings });
  const changedGroups = groups.filter(group => group.changes.length);
  const counts = { added: 0, removed: 0, modified: 0, reordered: 0 };
  for (const group of changedGroups) for (const change of group.changes) counts[change.kind] += 1;
  return {
    changed: changedGroups.length > 0, groups: changedGroups, counts,
    incompatibleSections: [...snapshotIssues.map(name => `历史版本的${name}`), ...draftIssues.map(name => `当前草稿的${name}`)],
    snapshotCompatible: snapshotIssues.length === 0,
  };
}

export function formatAnalyticsVersionTime(value?: string | null): string {
  if (!value) return '时间未记录';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间未记录';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}
