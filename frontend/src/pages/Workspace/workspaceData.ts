export interface WorkspaceItem {
  id: string;
  title: string;
  status: string;
  views?: string[];
  summary?: string;
  route_path?: string | null;
  form?: { id: number; name: string; code?: string } | null;
  application?: { name: string } | null;
  record?: { id: number } | null;
  workflow?: { id: number } | null;
  fields?: Array<{ label: string; value?: unknown }>;
  current_node?: string;
  updated_at?: string | null;
  created_at?: string | null;
}

export function itemTime(item: WorkspaceItem) {
  const raw = item.updated_at || item.created_at;
  if (!raw) return 0;
  const time = Date.parse(/T/.test(raw) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw) ? `${raw}Z` : raw);
  return Number.isFinite(time) ? time : 0;
}

export function workspaceGroups(items: WorkspaceItem[], forms?: Array<{ id: number; approval_configured?: boolean }>) {
  const sorted = [...items].sort((a, b) => itemTime(b) - itemTime(a));
  const initiated = sorted.filter(item => item.views?.includes('initiated'));
  const needsContinuation = (item: WorkspaceItem) => item.status === 'returned' || item.status === 'draft' && (!forms || Boolean(item.workflow?.id) || forms.some(form => form.id === item.form?.id && form.approval_configured));
  return {
    unfinished: initiated.filter(needsContinuation),
    waiting: initiated.filter(item => ['pending', 'running'].includes(item.status)),
    pending: sorted.filter(item => item.views?.includes('pending')),
    recent: sorted.filter(item => !(item.views?.includes('initiated') && needsContinuation(item))),
  };
}

export function workspaceOverview(items: WorkspaceItem[], now = Date.now()) {
  const day = 24 * 60 * 60 * 1000;
  const datedItems = items.filter(item => Number.isFinite(itemTime(item)) && itemTime(item) > 0 && itemTime(item) <= now);
  const recentItems = datedItems.filter(item => itemTime(item) >= now - 7 * day)
    .sort((a, b) => itemTime(b) - itemTime(a));
  // Re-submitting a source record can produce more than one workflow item.
  const seen = new Set<string>();
  const recentUpdates = recentItems.filter(item => {
    const key = item.form?.id && item.record?.id ? `record:${item.form.id}:${item.record.id}` : `item:${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const oldestWaiting = datedItems.filter(item => item.views?.includes('initiated') && ['pending', 'running'].includes(item.status))
    .sort((a, b) => itemTime(a) - itemTime(b))[0];
  return {
    recentUpdates,
    oldestWaiting,
    unchangedDays: oldestWaiting ? Math.floor((now - itemTime(oldestWaiting)) / day) : 0,
  };
}

export function workspaceItemRoute(item: WorkspaceItem, view: 'initiated' | 'pending' = 'initiated') {
  if (item.workflow?.id && (view === 'pending' || ['pending', 'running', 'done', 'rejected'].includes(item.status))) return `/workflow?tab=${view}&instance_id=${item.workflow.id}`;
  // Runtime record pages preserve their existing permission checks and edit flow.
  if (item.route_path?.startsWith('/') && !item.route_path.startsWith('//')) {
    if (/[?&](recordId|record_id)=\d+/.test(item.route_path)) return item.route_path;
    if (item.record?.id && item.form?.id) return `${item.route_path}${item.route_path.includes('?') ? '&' : '?'}recordId=${item.record.id}`;
  }
  if (item.workflow?.id) return `/workflow?tab=${view}&instance_id=${item.workflow.id}`;
  return `/workflow?tab=${view}`;
}

export const workspaceStatus: Record<string, string> = {
  draft: '草稿', returned: '已退回', rejected: '已驳回', pending: '待审批', running: '审批中', done: '已通过',
};
