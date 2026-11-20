import { getToolHelp } from '../../pages/AccountCenter/aiRegistryHelp';

export interface TracePresentationInput {
  id: string;
  kind: 'note' | 'tool' | 'result' | 'page' | 'skill';
  content: string;
  status?: string;
  tool?: string;
  skillId?: string;
  toolCallId?: string;
  stepId?: string;
  pageTitle?: string;
  resultCount?: number;
  resultPayload?: unknown;
  summary?: string;
  error?: string;
  queryContext?: string;
  source?: 'dsh' | 'validation' | 'reasoning';
}

interface TraceResultPreviewItem {
  label: string;
  secondary?: string;
}

export interface TraceResultPreview {
  items: TraceResultPreviewItem[];
  remaining: number;
}

export interface TracePresentationRow {
  id: string;
  kind: 'note' | 'tool' | 'page' | 'skill';
  content: string;
  status?: string;
  statusLabel?: string;
  tool?: string;
  skillId?: string;
  title?: string;
  resultCount?: number;
  resultPreview?: TraceResultPreview;
  detail?: string;
  queryContext?: string;
  hasResult?: boolean;
  source?: 'dsh' | 'validation' | 'reasoning';
}

const statusLabels: Record<string, string> = {
  active: '执行中',
  running: '执行中',
  completed: '已完成',
  waiting_confirmation: '待确认',
  validation_failed: '参数校验失败',
  blocked: '操作受阻',
  failed: '执行失败',
  error: '执行失败',
  timeout: '执行超时',
  cancelled: '已取消',
  interrupted: '未收到结果',
  stopped: '已停止',
};

export function getTraceStatusLabel(status?: string): string | undefined {
  return status && Object.prototype.hasOwnProperty.call(statusLabels, status) ? statusLabels[status] : undefined;
}

export function getTraceQueryContext(tool: string | undefined, payload: unknown): string | undefined {
  if (tool !== 'platform.form_settings.query') return undefined;
  const args = resultObject(payload);
  if (!args) return undefined;
  const { form_id, form_code, form_name, application_id, subject } = args;
  if (form_id) return '按表单 ID 查找';
  if (typeof form_code === 'string' && form_code.trim()) return '按表单编码查找';
  if (typeof form_name === 'string' && form_name.trim()) return '按表单名称查找';
  if (application_id) return '按应用列出表单';
  if (subject === 'fields') return '列出表单和字段';
  return '列出表单';
}

const genericCountSummary = /^(?:Result count:\s*|结果(?:数)?[：:]?\s*)(\d+)[。.]?$/i;
const genericCompletedSummary = /^(?:Tool completed|工具已完成)[。.]?$/i;
const resultPreviewLimit = 6;

function resultObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function previewText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > 72 ? `${text.slice(0, 71)}…` : text || undefined;
}

function previewForm(value: unknown): TraceResultPreviewItem | undefined {
  const form = resultObject(value);
  const name = previewText(form?.name);
  const code = previewText(form?.code);
  if (name) return { label: name, secondary: code === name ? undefined : code };
  return code ? { label: code } : undefined;
}

function previewRecord(value: unknown): TraceResultPreviewItem | undefined {
  const id = resultObject(value)?.id;
  if (typeof id === 'number' && Number.isSafeInteger(id) && id > 0) return { label: `记录 #${id}` };
  if (typeof id === 'string' && /^[1-9]\d{0,15}$/.test(id)) return { label: `记录 #${id}` };
  return undefined;
}

function getResultPreview(tool: string | undefined, value: unknown): TraceResultPreview | undefined {
  const payload = resultObject(value);
  if (!payload) return undefined;

  let candidates: (TraceResultPreviewItem | undefined)[];
  if (tool === 'platform.form_settings.query' && Array.isArray(payload.items)) {
    candidates = payload.items.map(previewForm);
  } else if (tool === 'forms.query_records' && Array.isArray(payload.records)) {
    candidates = payload.records.map(previewRecord);
  } else if (tool === 'forms.get_record') {
    candidates = [previewRecord(payload.record)];
  } else {
    return undefined;
  }

  const items = candidates.filter((item): item is TraceResultPreviewItem => item !== undefined);
  if (!items.length) return undefined;
  return { items: items.slice(0, resultPreviewLimit), remaining: Math.max(0, items.length - resultPreviewLimit) };
}

function toolRow(item: TracePresentationInput): TracePresentationRow {
  const hasResult = item.kind === 'result';
  const status = item.status || (hasResult ? 'completed' : 'running');
  const summary = item.summary?.trim();
  const countMatch = summary?.match(genericCountSummary);
  const resultCount = item.resultCount ?? (countMatch ? Number(countMatch[1]) : undefined);
  const detail = item.error?.trim() || (summary && !countMatch && !genericCompletedSummary.test(summary) ? summary : undefined);
  const title = (item.tool && (getToolHelp(item.tool)?.title || item.tool)) || '工具';
  const statusLabel = getTraceStatusLabel(status) || (hasResult ? '已收到结果' : '执行中');
  return {
    id: item.toolCallId ? `trace-call:${item.toolCallId}:${item.tool ?? ''}` : item.id,
    kind: 'tool',
    content: title,
    tool: item.tool,
    title,
    status,
    statusLabel,
    resultCount,
    resultPreview: hasResult && status === 'completed' && resultCount !== 0 ? getResultPreview(item.tool, item.resultPayload) : undefined,
    detail,
    queryContext: item.queryContext,
    hasResult,
  };
}

function mergeToolRows(previous: TracePresentationRow, next: TracePresentationRow): TracePresentationRow {
  const outcome = next.hasResult ? next : previous;
  return {
    ...outcome,
    id: previous.id,
    queryContext: previous.queryContext ?? next.queryContext,
  };
}

export function buildTracePresentation(items: TracePresentationInput[] = []) {
  const rows: TracePresentationRow[] = [];
  const correlatedRows = new Map<string, number>();
  const pendingLegacyCalls = new Map<string, number>();

  for (const [index, item] of items.entries()) {
    if (item.kind !== 'tool' && item.kind !== 'result') {
      rows.push({
        id: item.id, kind: item.kind, content: item.content, status: item.status,
        statusLabel: getTraceStatusLabel(item.status), skillId: item.skillId, source: item.source,
      });
      continue;
    }

    const row = toolRow(item);
    if (item.toolCallId) {
      const offset = correlatedRows.get(row.id);
      if (offset === undefined) {
        correlatedRows.set(row.id, rows.length);
        rows.push(row);
      } else {
        rows[offset] = mergeToolRows(rows[offset], row);
      }
      continue;
    }

    const previous = items[index - 1];
    const legacyPending = item.tool ? pendingLegacyCalls.get(item.tool) || 0 : 0;
    const adjacentLegacyPair = item.kind === 'result' && item.tool && legacyPending === 1
      && previous?.kind === 'tool' && previous.tool === item.tool && !previous.toolCallId;
    if (adjacentLegacyPair) {
      rows[rows.length - 1] = mergeToolRows(rows[rows.length - 1], row);
    } else {
      rows.push(row);
    }
    if (item.tool && (item.kind === 'tool' || legacyPending > 0)) {
      pendingLegacyCalls.set(item.tool, legacyPending + (item.kind === 'tool' ? 1 : -1));
    }
  }

  return { rows };
}
