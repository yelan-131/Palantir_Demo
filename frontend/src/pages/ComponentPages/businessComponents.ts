import type {ViewConfig} from '@/utils/viewConfig';

export interface FilterSettings {
  queryMode?: 'submit' | 'change';
  resetMode?: 'defaults' | 'clear';
  showKeyword?: boolean;
  expandAdvanced?: boolean;
  requiredFields?: string[];
  queryLabel?: string;
  resetLabel?: string;
}
export interface ListSettings {
  columns?: string[] | null;
  pageSize?: number | null;
  defaultSort?: {field: string; order: 'asc' | 'desc'} | null;
  rowClick?: 'none' | 'detail' | 'edit' | null;
  toolbarActions?: string[] | null;
  rowActions?: string[] | null;
  selection?: 'none' | 'single' | 'multiple';
  emptyText?: string;
}
/** Component options may narrow the published view, never introduce fields or actions. */
export function resolveListView(view: ViewConfig | null, settings?: ListSettings): ViewConfig | null {
  if (!view || !settings) return view;
  const allowed = view.table.columns.filter(column=>column.enabled);
  const columns = settings.columns == null ? view.table.columns : settings.columns.flatMap(name=>allowed.filter(column=>column.fieldName===name)).map((column,index)=>({...column,sortOrder:index}));
  const sort = settings.defaultSort && allowed.find(column=>column.fieldName===settings.defaultSort?.field&&column.sortable);
  return {...view, table:{...view.table, columns,
    pageSize: settings.pageSize ?? view.table.pageSize,
    defaultSort: sort ? {fieldName:sort.fieldName,order:settings.defaultSort!.order==='asc'?'ascend':'descend'} : view.table.defaultSort,
    rowClickAction: settings.rowClick == null ? view.table.rowClickAction : settings.rowClick === 'none' || view.table.rowActions.includes(settings.rowClick) || view.table.rowClickAction === settings.rowClick ? settings.rowClick : 'none',
    toolbarActions: settings.toolbarActions == null ? view.table.toolbarActions : view.table.toolbarActions.filter(action=>settings.toolbarActions!.includes(action)),
    rowActions: settings.rowActions == null ? view.table.rowActions : view.table.rowActions.filter(action=>settings.rowActions!.includes(action)),
  }};
}
export function emptyFilterValue(value: unknown): boolean {
  return value == null || typeof value === 'string' && value.trim() === '' || Array.isArray(value) && (value.length === 0 || value.some(emptyFilterValue));
}

/** Explicit empties prevent published defaults being silently applied again after clear. */
export function clearedFilterValues(filters: Array<{id:string; controlType:string}>) {
  return Object.fromEntries(filters.map(filter=>[filter.id,['text','keyword'].includes(filter.controlType)?'':null]));
}
