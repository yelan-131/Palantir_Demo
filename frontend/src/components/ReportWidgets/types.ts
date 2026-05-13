export interface WidgetPosition {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DataSourceConfig {
  endpoint: string;
  path?: string;
  params?: Record<string, unknown>;
}

export interface ChartSeriesConfig {
  name: string;
  dataField: string;
}

export interface WidgetInstance {
  id: string;
  type: WidgetType;
  title: string;
  position: WidgetPosition;
  dataSource?: DataSourceConfig;
  style?: Record<string, unknown>;
  chartConfig?: Record<string, unknown>;
  fieldConfig?: WidgetFieldConfig;
}

export interface WidgetFieldConfig {
  model_name?: string;
  field_name?: string;
  label?: string;
  field_type?: string;
  required?: boolean;
  enum_values?: string;
  relation_config?: string;
}

export interface FilterConfig {
  id: string;
  type: 'date-range' | 'select' | 'number';
  label: string;
  paramName: string;
  defaultValue?: unknown;
  options?: string[];
}

export interface ReportConfig {
  canvas: { gridSize: number };
  widgets: WidgetInstance[];
  filters: FilterConfig[];
}

export type WidgetType =
  // Data display (existing)
  | 'kpi-card'
  | 'line-chart'
  | 'bar-chart'
  | 'pie-chart'
  | 'gauge'
  | 'data-table'
  | 'text'
  // Form field (new)
  | 'form-input'
  | 'form-number'
  | 'form-select'
  | 'form-date'
  | 'form-switch'
  | 'form-textarea'
  | 'form-relation';

export type WidgetCategory = 'display' | 'form';

export interface WidgetMeta {
  type: WidgetType;
  label: string;
  icon: string;
  category: WidgetCategory;
  defaultWidth: number;
  defaultHeight: number;
}

export const WIDGET_REGISTRY: WidgetMeta[] = [
  // Data display
  { type: 'kpi-card', label: 'KPI 指标卡', icon: 'DashboardOutlined', category: 'display', defaultWidth: 6, defaultHeight: 4 },
  { type: 'line-chart', label: '折线图', icon: 'LineChartOutlined', category: 'display', defaultWidth: 12, defaultHeight: 8 },
  { type: 'bar-chart', label: '柱状图', icon: 'BarChartOutlined', category: 'display', defaultWidth: 12, defaultHeight: 8 },
  { type: 'pie-chart', label: '饼图', icon: 'PieChartOutlined', category: 'display', defaultWidth: 8, defaultHeight: 8 },
  { type: 'gauge', label: '仪表盘', icon: 'DashboardOutlined', category: 'display', defaultWidth: 8, defaultHeight: 8 },
  { type: 'data-table', label: '数据表格', icon: 'TableOutlined', category: 'display', defaultWidth: 24, defaultHeight: 8 },
  { type: 'text', label: '文本标注', icon: 'FontSizeOutlined', category: 'display', defaultWidth: 8, defaultHeight: 4 },
  // Form fields
  { type: 'form-input', label: '文本输入', icon: 'FormOutlined', category: 'form', defaultWidth: 12, defaultHeight: 2 },
  { type: 'form-number', label: '数字输入', icon: 'NumberOutlined', category: 'form', defaultWidth: 12, defaultHeight: 2 },
  { type: 'form-select', label: '下拉选择', icon: 'DownCircleOutlined', category: 'form', defaultWidth: 12, defaultHeight: 2 },
  { type: 'form-date', label: '日期选择', icon: 'CalendarOutlined', category: 'form', defaultWidth: 12, defaultHeight: 2 },
  { type: 'form-switch', label: '开关', icon: 'SwapOutlined', category: 'form', defaultWidth: 12, defaultHeight: 2 },
  { type: 'form-textarea', label: '多行文本', icon: 'AlignLeftOutlined', category: 'form', defaultWidth: 12, defaultHeight: 3 },
  { type: 'form-relation', label: '关联选择', icon: 'LinkOutlined', category: 'form', defaultWidth: 12, defaultHeight: 2 },
];

export const WIDGET_CATEGORIES: { key: WidgetCategory; label: string }[] = [
  { key: 'display', label: '数据展示' },
  { key: 'form', label: '表单录入' },
];
