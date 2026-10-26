export type ExplorerFolder = { id: string; name: string; icon: 'folder' | 'book' | 'project'; color: 'primary' | 'success' | 'warning' | 'focus' };
export type ExplorerPreferences = {
  grouping: 'type' | 'custom' | 'flat';
  sort: 'manual' | 'name' | 'recent';
  density: 'compact' | 'comfortable';
  wrapTitles: boolean;
  favorites: string[];
  folders: ExplorerFolder[];
  assignments: Record<string, string>;
  order: string[];
};
export type ExplorerDocument = { id: string; title: string; filename: string; type: string; typeLabel: string; updatedAt: string; searchText: string };
export const explorerDefaults = (): ExplorerPreferences => ({ grouping: 'type', sort: 'manual', density: 'compact', wrapTitles: false, favorites: [], folders: [], assignments: {}, order: [] });
const strings = (value: unknown) => Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0 && item.length < 200))].slice(0, 5000) : [];
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function normalizeExplorerPreferences(value: unknown): ExplorerPreferences {
  const input = record(value);
  const folders: ExplorerFolder[] = [];
  for (const raw of Array.isArray(input.folders) ? input.folders.slice(0, 100) : []) {
    const folder = record(raw);
    if (typeof folder.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(folder.id) || folders.some(item => item.id === folder.id)) continue;
    const name = typeof folder.name === 'string' ? folder.name.trim().slice(0, 40) : '';
    if (!name) continue;
    folders.push({ id: folder.id, name, icon: ['book', 'project'].includes(String(folder.icon)) ? folder.icon as ExplorerFolder['icon'] : 'folder', color: ['success', 'warning', 'focus'].includes(String(folder.color)) ? folder.color as ExplorerFolder['color'] : 'primary' });
  }
  const assignments = Object.fromEntries(Object.entries(record(input.assignments)).filter(([id, folder]) => id.length < 200 && !['__proto__', 'constructor', 'prototype'].includes(id) && folders.some(item => item.id === folder)).slice(0, 5000)) as Record<string, string>;
  return {
    grouping: input.grouping === 'custom' || input.grouping === 'flat' ? input.grouping : 'type',
    sort: input.sort === 'name' || input.sort === 'recent' ? input.sort : 'manual',
    density: input.density === 'comfortable' ? 'comfortable' : 'compact',
    wrapTitles: input.wrapTitles === true,
    favorites: strings(input.favorites), folders, assignments, order: strings(input.order),
  };
}

export function explorerStorageKey(tenantId: number | undefined, userId: number | undefined) {
  return `mf_knowledge_explorer:v1:${tenantId ?? 'default'}:${userId ?? 'anonymous'}`;
}

export function sortExplorerDocuments(documents: ExplorerDocument[], preferences: ExplorerPreferences) {
  const positions = new Map(preferences.order.map((id, index) => [id, index]));
  return [...documents].sort((a, b) => {
    if (preferences.sort === 'name') return a.title.localeCompare(b.title, 'zh-CN', { numeric: true });
    if (preferences.sort === 'recent') return (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0);
    return (positions.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (positions.get(b.id) ?? Number.MAX_SAFE_INTEGER);
  });
}

/** Move personal references only; document data and access permissions stay with the server. */
export function moveExplorerDocument(preferences: ExplorerPreferences, id: string, folderId: string, orderedIds: string[], beforeId?: string): ExplorerPreferences {
  if (folderId && !preferences.folders.some(folder => folder.id === folderId)) return preferences;
  const assignments = { ...preferences.assignments };
  if (folderId) assignments[id] = folderId; else delete assignments[id];
  const order = [...new Set([...preferences.order, ...orderedIds])].filter(item => item !== id);
  const before = beforeId ? order.indexOf(beforeId) : -1;
  order.splice(before < 0 ? order.length : before, 0, id);
  return { ...preferences, grouping: 'custom', sort: 'manual', assignments, order };
}

export function removeExplorerFolder(preferences: ExplorerPreferences, folderId: string): ExplorerPreferences {
  return { ...preferences, folders: preferences.folders.filter(folder => folder.id !== folderId), assignments: Object.fromEntries(Object.entries(preferences.assignments).filter(([, folder]) => folder !== folderId)) };
}
