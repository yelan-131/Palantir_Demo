import type { PlatformFormVersion } from '@/services/api';

type Snapshot = Record<string, unknown> | null | undefined;
type JsonRecord = Record<string, unknown>;

export interface VersionField {
  key: string;
  name: string;
  type: string;
  required: boolean;
  archived: boolean;
  visible: boolean;
  order: number;
}

export interface VersionChange {
  key: 'fields' | 'layout' | 'views' | 'workflow' | 'permissions' | 'analytics';
  label: string;
  changed: boolean;
  details: string[];
  added?: string[];
  removed?: string[];
  modified?: string[];
}

const record = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
const records = (value: unknown): JsonRecord[] => Array.isArray(value) ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) : [];
const text = (value: unknown): string => typeof value === 'string' ? value : '';
const configOf = (snapshot: Snapshot): JsonRecord => record(record(snapshot?.form).config);
const fieldsOf = (snapshot: Snapshot): JsonRecord[] => records(snapshot?.fields);
const bindingsOf = (snapshot: Snapshot): JsonRecord[] => records(snapshot?.workflow_bindings ?? snapshot?.workflowBindings);
const fieldKey = (field: JsonRecord): string => text(field.field_name || field.key);

export function sortVersions(versions: readonly PlatformFormVersion[]): PlatformFormVersion[] {
  return [...versions].sort((a, b) => Number(b.version) - Number(a.version));
}

export function filterVersions(versions: readonly PlatformFormVersion[], query: string): PlatformFormVersion[] {
  const normalized = query.trim().replace(/^v\s*/i, '');
  return sortVersions(versions).filter(version => !normalized || String(version.version).includes(normalized));
}

/** Naive backend timestamps retain their recorded wall time; do not guess their zone. */
export function formatVersionTime(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '未记录';
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?(Z|[+-]\d{2}:?\d{2})?$/i.exec(value.trim());
  if (!match) return '未记录';
  const [, year, month, day, hour = '00', minute = '00', second = '00', zone] = match;
  const check = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
  if (!Number.isFinite(check.getTime()) || check.getUTCFullYear() !== Number(year) || check.getUTCMonth() + 1 !== Number(month) || check.getUTCDate() !== Number(day) || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return '未记录';
  if (!match[4]) return zone ? '未记录' : `${year}-${month}-${day}`;
  if (!zone) return `${year}-${month}-${day} ${hour}:${minute}`;
  const parsed = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}${zone.toUpperCase()}`);
  if (!Number.isFinite(parsed.getTime())) return '未记录';
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(parsed);
  const part = (type: string) => parts.find(item => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}`;
}

export function getVersionFields(snapshot: Snapshot): VersionField[] {
  return fieldsOf(snapshot).filter(field => fieldKey(field)).map((field, index) => ({
    key: fieldKey(field),
    name: text(field.label || field.name) || fieldKey(field),
    type: text(field.business_type || field.field_type || field.type) || '未记录',
    required: field.required === true,
    archived: field.archived === true,
    visible: field.visible_in_form !== false,
    order: typeof field.sort_order === 'number' ? field.sort_order : index,
  })).sort((a, b) => a.order - b.order);
}

function layoutConfig(snapshot: Snapshot, type: string): unknown {
  const layout = records(snapshot?.layouts).find(item => item.layout_type === type);
  if (!layout) return undefined;
  const config = record(layout.config);
  return config.published ?? config.draft ?? config;
}

export function summarizeVersion(snapshot: Snapshot) {
  const config = configOf(snapshot);
  const fields = getVersionFields(snapshot);
  const view = record(config.viewConfig ?? config.viewConfigDraft ?? layoutConfig(snapshot, 'view'));
  const analytics = record(config.analyticsDesign ?? config.analyticsDesignDraft ?? layoutConfig(snapshot, 'analytics'));
  return {
    fieldCount: fields.length,
    requiredFieldCount: fields.filter(field => field.required).length,
    layoutCount: records(snapshot?.layouts).length,
    permissionCount: records(snapshot?.permissions).length,
    workflowCount: bindingsOf(snapshot).length,
    viewCount: Array.isArray(view.tabs) ? view.tabs.length : Object.keys(view).length ? 1 : 0,
    analyticsWidgetCount: records(analytics.widgets).length,
  };
}

const ignoredMetadata = new Set(['meta', 'created_at', 'updated_at', 'published_at', 'createdAt', 'updatedAt', 'publishedAt', 'draftSavedAt', 'savedAt', 'publishedSchemaVersion']);

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as JsonRecord)
      .filter(([key, item]) => item !== undefined && !ignoredMetadata.has(key) && !key.endsWith('Meta'))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

function stable(value: unknown): string {
  return JSON.stringify(canonical(value ?? null));
}

function withoutRecordIdentity(value: JsonRecord): JsonRecord {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !['id', 'form_id', 'meta_field_id'].includes(key)));
}

function sortedRecords(value: JsonRecord[]): JsonRecord[] {
  return value.map(withoutRecordIdentity).sort((a, b) => stable(a).localeCompare(stable(b)));
}

function sectionValues(snapshot: Snapshot): Record<VersionChange['key'], unknown> {
  const config = configOf(snapshot);
  return {
    fields: fieldsOf(snapshot),
    layout: {
      layout: config.formLayout ?? layoutConfig(snapshot, 'form') ?? null,
      controls: config.formDesignerControls ?? null,
      canvas: config.canvasSettings ?? null,
    },
    views: config.viewConfig ?? config.viewConfigDraft ?? layoutConfig(snapshot, 'view') ?? null,
    workflow: sortedRecords(bindingsOf(snapshot)),
    permissions: {
      design: config.permissionDesign ?? config.permissionDesignDraft ?? null,
      rules: sortedRecords(records(snapshot?.permissions)),
    },
    analytics: config.analyticsDesign ?? config.analyticsDesignDraft ?? layoutConfig(snapshot, 'analytics') ?? null,
  };
}

/** Compare persisted snapshots only; a first release has no fabricated predecessor. */
export function compareVersions(current: Snapshot, previous?: Snapshot): VersionChange[] {
  if (!current || !previous) return [];
  const before = new Map(fieldsOf(previous).filter(field => fieldKey(field)).map(field => [fieldKey(field), field]));
  const after = new Map(fieldsOf(current).filter(field => fieldKey(field)).map(field => [fieldKey(field), field]));
  const name = (field: JsonRecord) => text(field.label || field.name) || fieldKey(field);
  const added = [...after].filter(([key]) => !before.has(key)).map(([, field]) => name(field));
  const removed = [...before].filter(([key]) => !after.has(key)).map(([, field]) => name(field));
  const modified = [...after].filter(([key, field]) => before.has(key) && stable(withoutRecordIdentity(field)) !== stable(withoutRecordIdentity(before.get(key)!))).map(([, field]) => name(field));
  const fieldDetails = [added.length ? `新增：${added.join('、')}` : '', removed.length ? `移除：${removed.join('、')}` : '', modified.length ? `调整：${modified.join('、')}` : ''].filter(Boolean);
  const currentSections = sectionValues(current);
  const previousSections = sectionValues(previous);
  const sections: Array<[VersionChange['key'], string, string]> = [
    ['layout', '表单布局', '表单布局、控件或画布设置有调整'],
    ['views', '数据视图', '数据视图配置有调整'],
    ['workflow', '流程绑定', '绑定流程、触发条件或流程配置有调整'],
    ['permissions', '权限', '角色权限或字段权限有调整'],
    ['analytics', '分析看板', '分析看板配置有调整'],
  ];
  return [{ key: 'fields', label: '字段', changed: fieldDetails.length > 0, details: fieldDetails, added, removed, modified }, ...sections.map(([key, label, detail]) => {
    const changed = stable(currentSections[key]) !== stable(previousSections[key]);
    return { key, label, changed, details: changed ? [detail] : [] };
  })];
}
