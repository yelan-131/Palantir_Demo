import type {ViewConfig} from '@/utils/viewConfig';

export const APPROVAL_STATUS_FIELD = '_approval_status';
export const APPROVAL_STATUS_LABEL = '审批状态';

export const RECORD_METADATA_FIELDS = [
  {fieldName: '_record_id', label: '记录编号', width: 96, controlType: 'number', operator: 'equals', controlLabel: '数字输入'},
  {fieldName: '_created_at', label: '创建时间', width: 160, controlType: 'dateRange', operator: 'between', controlLabel: '日期范围'},
  {fieldName: '_updated_at', label: '更新时间', width: 160, controlType: 'dateRange', operator: 'between', controlLabel: '日期范围'},
  {fieldName: '_created_by', label: '创建人', width: 116, controlType: 'select', operator: 'equals', controlLabel: '人员选择'},
  {fieldName: '_updated_by', label: '最后修改人', width: 116, controlType: 'select', operator: 'equals', controlLabel: '人员选择'},
] as const;
type RecordMetadataField = typeof RECORD_METADATA_FIELDS[number]['fieldName'];

export function isRecordMetadataField(name: string): name is RecordMetadataField {
  return RECORD_METADATA_FIELDS.some(field=>field.fieldName===name);
}

export function withDefaultRecordMetadata(columns: string[], configured?: boolean | null): string[] {
  return configured ? columns : [...new Set([...columns, ...RECORD_METADATA_FIELDS.map(field=>field.fieldName)])];
}

export type FilterControlMode = "dropdown" | "radio" | "multi-dropdown" | "checkbox";
export interface FilterScheme {
  id: string;
  name: string;
  showKeyword: boolean;
  groups: ToolbarGroup[];
  fieldControls?: Record<string, FilterControlMode>;
  defaultRows?: number | null;
  fieldsPerRow?: number | null;
}
export const DEFAULT_FILTER_LAYOUT = {rows: 2, columns: 4};
export interface FilterSettings {
  schemes?: FilterScheme[] | null;
  toolbarGroups?: ToolbarGroup[] | null;
  queryMode?: 'submit' | 'change';
  resetMode?: 'defaults' | 'clear';
  showKeyword?: boolean;
  expandAdvanced?: boolean;
  requiredFields?: string[];
  queryLabel?: string;
  resetLabel?: string;
}
export interface ToolbarGroup {
  pageSize?:number|null; emptyText?:string|null;
  defaultSort?: {field:string;order:'asc'|'desc'} | null; inheritDefaultSort?: boolean;
  approvalStatusConfigured?: boolean;
  recordMetadataConfigured?: boolean;
  sortableColumns?:string[]|null; columns?:string[]|null; id:string; name:string; userIds?:number[]; orgUnitIds?:number[]; roleIds:number[]; actions:string[];
}
export interface ListSettings {
  sortableColumns?:string[]|null;
  displayGroups?: ToolbarGroup[] | null;
  toolbarGroups?: ToolbarGroup[] | null;
  columns?: string[] | null;
  pageSize?: number | null;
  defaultSort?: {field: string; order: 'asc' | 'desc'} | null;
  rowClick?: 'none' | 'detail' | 'edit' | null;
  toolbarActions?: string[] | null;
  rowActions?: string[] | null;
  selection?: 'none' | 'single' | 'multiple';
  emptyText?: string;
}
/** Display groups are projected to the current audience by the page API. */
export function resolveListPresentation(settings?: ListSettings | null) {
  return {
    pageSize: settings?.displayGroups?.find(group=>group.pageSize!=null)?.pageSize ?? settings?.pageSize,
    emptyText: settings?.displayGroups?.find(group=>!!group.emptyText?.trim())?.emptyText ?? settings?.emptyText,
  };
}
export function hasImplicitApprovalStatus(settings?: ListSettings | null): boolean {
  return settings?.displayGroups?.some(group => !group.approvalStatusConfigured) ?? true;
}

const approvalStatusColumn: ViewConfig['table']['columns'][number] = {
  id: APPROVAL_STATUS_FIELD,
  fieldName: APPROVAL_STATUS_FIELD,
  label: APPROVAL_STATUS_LABEL,
  enabled: true,
  sortable: false,
  width: 88,
  renderType: 'tag',
  emptyText: '—',
  sortOrder: 0,
};

/** Component toolbar configuration is independent; runtime authorization still applies. */
export function resolveListView(view: ViewConfig | null, settings?: ListSettings, approvalStatusAvailable = false, showRecordMetadata = false, indexedSortFields?: ReadonlySet<string>): ViewConfig | null {
  if (!view || (!settings && !showRecordMetadata)) return view;
  settings ??= {};
  const allowed = view.table.columns.filter(column=>column.enabled);
  const sourceColumnNames = allowed.map(column=>column.fieldName);
  if (approvalStatusAvailable) allowed.push(approvalStatusColumn);
  if (showRecordMetadata) {
    allowed.push(...RECORD_METADATA_FIELDS.map(({fieldName,label,width})=>({
      ...approvalStatusColumn, fieldName, label, width, id:fieldName, renderType:'text' as const,
    })));
  }
  const selectedColumns = settings.displayGroups == null
    ? showRecordMetadata ? withDefaultRecordMetadata(settings.columns ?? sourceColumnNames) : settings.columns
    : [...new Set(settings.displayGroups.flatMap(group=>showRecordMetadata
        ? withDefaultRecordMetadata(group.columns ?? [], group.recordMetadataConfigured) : group.columns ?? []))];
  const sourceSortable = view.table.columns.filter(column=>column.sortable).map(column=>column.fieldName);
  const groupSortable = (group: ToolbarGroup) => group.sortableColumns??settings.sortableColumns??sourceSortable;
  const sortableColumns = settings.displayGroups == null ? settings.sortableColumns : [...new Set(settings.displayGroups.flatMap(group=>groupSortable(group).filter(name=>group.columns?.includes(name))))];
  const columns = selectedColumns == null ? view.table.columns : selectedColumns.flatMap(name=>allowed.filter(column=>column.fieldName===name)).map((column,index)=>({...column,sortOrder:index}));
  const resolvedColumns = columns.map(column=>({...column,sortable:column.fieldName!==APPROVAL_STATUS_FIELD&&!isRecordMetadataField(column.fieldName)&&(indexedSortFields?.has(column.fieldName)??true)&&(sortableColumns==null?column.sortable:sortableColumns.includes(column.fieldName))}));
  const sourceDefault = view.table.defaultSort ? {field:view.table.defaultSort.fieldName,order:view.table.defaultSort.order==='ascend'?'asc' as const:'desc' as const} : null;
  const groupDefault = settings.displayGroups?.map(group=>{
    const candidate=group.defaultSort??(group.inheritDefaultSort!==false?(settings.defaultSort??sourceDefault):null);
    const sortable=groupSortable(group);
    return candidate&&group.columns?.includes(candidate.field)&&sortable.includes(candidate.field)&&resolvedColumns.some(column=>column.fieldName===candidate.field&&column.sortable)?candidate:null;
  }).find(Boolean);
  const requestedSort = settings.displayGroups == null ? settings.defaultSort??sourceDefault : groupDefault;
  const sort = requestedSort && resolvedColumns.find(column=>column.fieldName===requestedSort.field&&column.sortable);
  const toolbarActions = settings.toolbarGroups == null ? settings.toolbarActions : [...new Set(settings.toolbarGroups.flatMap(group=>group.actions))];
  return {...view, table:{...view.table, columns:resolvedColumns,
    pageSize: resolveListPresentation(settings).pageSize ?? view.table.pageSize,
    defaultSort: sort && requestedSort ? {fieldName:sort.fieldName,order:requestedSort.order==='asc'?'ascend':'descend'} : undefined,
    rowClickAction: settings.rowClick == null ? view.table.rowClickAction : settings.rowClick === 'none' || view.table.rowActions.includes(settings.rowClick) || view.table.rowClickAction === settings.rowClick ? settings.rowClick : 'none',
    toolbarActions: toolbarActions == null ? view.table.toolbarActions : toolbarActions.filter(action=>['create','refresh','import','export','copy','delete'].includes(action)),
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

/** List button actions apply to every visible filter scheme. Legacy standalone groups are projected by the server. */
export function filterButtonActions(settings?: FilterSettings): string[] {
  return settings?.toolbarGroups == null ? ['query','reset'] : [...new Set(settings.toolbarGroups.flatMap(group=>group.actions).filter(action=>action==='query'||action==='reset'))];
}

/** Import subjects into the current group without changing fields or button actions. */
export function mergePermissionAudience(current:ToolbarGroup, imported:ToolbarGroup[]) {
  const groups=[current,...imported];
  return {
    roleIds:[...new Set(groups.flatMap(group=>group.roleIds||[]))],
    userIds:[...new Set(groups.flatMap(group=>group.userIds||[]))],
    orgUnitIds:[...new Set(groups.flatMap(group=>group.orgUnitIds||[]))],
  };
}
