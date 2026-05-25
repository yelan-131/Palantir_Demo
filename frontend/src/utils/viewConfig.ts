export type ViewControlType = 'keyword' | 'text' | 'select' | 'dateRange' | 'date' | 'number' | 'relation';
export type ViewFilterOperator = 'contains' | 'equals' | 'between' | 'gte' | 'lte';
export type ViewTableDensity = 'compact' | 'middle' | 'large';
export type ViewColumnRenderType = 'text' | 'tag' | 'date' | 'number' | 'progress';

export interface ViewFieldLike {
  fieldName: string;
  label: string;
  fieldType?: string;
  searchable?: boolean;
  sortable?: boolean;
  visibleInList?: boolean;
}

export interface ViewFilterConfig {
  id: string;
  fieldName: string;
  label: string;
  controlType: ViewControlType;
  operator: ViewFilterOperator;
  defaultValue?: string | string[] | number | null;
  placeholder?: string;
  enabled: boolean;
  advanced: boolean;
  sortOrder: number;
}

export interface ViewTableColumnConfig {
  id: string;
  fieldName: string;
  label: string;
  enabled: boolean;
  width?: number;
  fixed?: 'left' | 'right';
  sortable: boolean;
  renderType: ViewColumnRenderType;
  emptyText: string;
  sortOrder: number;
}

export interface ViewTableConfig {
  columns: ViewTableColumnConfig[];
  defaultSort?: { fieldName: string; order: 'ascend' | 'descend' };
  pageSize: number;
  density: ViewTableDensity;
  rowClickAction: 'detail' | 'edit' | 'none';
  toolbarActions: string[];
  rowActions: string[];
}

export interface ViewConfig {
  filters: ViewFilterConfig[];
  table: ViewTableConfig;
}

export function controlTypeForField(fieldType = ''): ViewControlType {
  const normalized = fieldType.toLowerCase();
  if (normalized.includes('date') || fieldType.includes('日期') || fieldType.includes('时间')) return 'dateRange';
  if (normalized.includes('enum') || normalized.includes('select') || fieldType.includes('下拉') || fieldType.includes('状态') || fieldType.includes('等级')) return 'select';
  if (normalized.includes('relation') || fieldType.includes('关联') || fieldType.includes('人员') || fieldType.includes('设备')) return 'relation';
  if (normalized.includes('number') || normalized.includes('int') || normalized.includes('float') || normalized.includes('decimal') || fieldType.includes('数值')) return 'number';
  return 'text';
}

export function defaultOperatorForControl(controlType: ViewControlType): ViewFilterOperator {
  if (controlType === 'dateRange') return 'between';
  if (controlType === 'number') return 'equals';
  if (controlType === 'select' || controlType === 'relation') return 'equals';
  return 'contains';
}

export function renderTypeForField(fieldType = ''): ViewColumnRenderType {
  const normalized = fieldType.toLowerCase();
  if (normalized.includes('date') || fieldType.includes('日期') || fieldType.includes('时间')) return 'date';
  if (normalized.includes('number') || normalized.includes('int') || normalized.includes('float') || normalized.includes('decimal')) return 'number';
  if (normalized.includes('enum') || fieldType.includes('状态') || fieldType.includes('等级') || fieldType.includes('下拉')) return 'tag';
  return 'text';
}

export function makeDefaultViewConfig(fields: ViewFieldLike[], filterFieldNames?: string[]): ViewConfig {
  const filterNames = filterFieldNames?.length
    ? filterFieldNames
    : fields.filter((field) => field.searchable).map((field) => field.fieldName);
  const filters = filterNames
    .map((fieldName, index) => fields.find((field) => field.fieldName === fieldName) ?? fields[index])
    .filter((field): field is ViewFieldLike => Boolean(field))
    .map((field, index) => {
      const controlType = index === 0 && controlTypeForField(field.fieldType) === 'text'
        ? 'keyword'
        : controlTypeForField(field.fieldType);
      return {
        id: `filter-${field.fieldName}`,
        fieldName: field.fieldName,
        label: field.label,
        controlType,
        operator: defaultOperatorForControl(controlType),
        placeholder: controlType === 'keyword' ? `搜索${field.label}` : `请选择${field.label}`,
        enabled: true,
        advanced: index > 3,
        sortOrder: index,
      };
    });

  const visibleFields = fields.filter((field) => field.visibleInList !== false);
  const columns = visibleFields.map((field, index) => ({
    id: `column-${field.fieldName}`,
    fieldName: field.fieldName,
    label: field.label,
    enabled: true,
    width: index === 0 ? 180 : 140,
    sortable: Boolean(field.sortable),
    renderType: renderTypeForField(field.fieldType),
    emptyText: '-',
    sortOrder: index,
  }));

  return {
    filters,
    table: {
      columns,
      pageSize: 20,
      density: 'middle',
      rowClickAction: 'detail',
      toolbarActions: ['create', 'refresh', 'export', 'settings'],
      rowActions: ['detail', 'edit'],
    },
  };
}

export function normalizeViewConfig(config: unknown, fields: ViewFieldLike[], filterFieldNames?: string[]): ViewConfig {
  const fallback = makeDefaultViewConfig(fields, filterFieldNames);
  if (!config || typeof config !== 'object') return fallback;
  const source = config as Partial<ViewConfig>;
  return {
    filters: Array.isArray(source.filters) && source.filters.length ? source.filters.map((filter, index) => ({
      ...fallback.filters[index],
      ...filter,
      id: filter.id || `filter-${filter.fieldName || index}`,
      enabled: filter.enabled !== false,
      advanced: Boolean(filter.advanced),
      sortOrder: Number.isFinite(filter.sortOrder) ? filter.sortOrder : index,
    })) : fallback.filters,
    table: {
      ...fallback.table,
      ...(source.table || {}),
      columns: Array.isArray(source.table?.columns) && source.table.columns.length
        ? source.table.columns.map((column, index) => ({
          ...fallback.table.columns[index],
          ...column,
          id: column.id || `column-${column.fieldName || index}`,
          enabled: column.enabled !== false,
          sortable: Boolean(column.sortable),
          emptyText: column.emptyText || '-',
          sortOrder: Number.isFinite(column.sortOrder) ? column.sortOrder : index,
        }))
        : fallback.table.columns,
    },
  };
}

export function sortByOrder<T extends { sortOrder: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.sortOrder - b.sortOrder);
}
