export type AnalyticsRow = Record<string, unknown>;
export type AnalyticsFilters = Record<string, string | [string, string]>;
export interface AnalyticsDatasetCondition {
  field: string;
  operator: 'eq' | 'ne' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte' | 'isEmpty' | 'notEmpty';
  value?: string;
}
export interface RuntimeAnalyticsDataset {
  id: string;
  name?: string;
  sourceType?: string;
  source: string;
  refreshMode: string;
  refreshInterval?: number;
  dimensions?: string[];
  measures?: string[];
  rangeFilters?: AnalyticsDatasetCondition[];
}
export interface RuntimeAnalyticsMetric {
  id: string;
  name: string;
  expression?: string;
  datasetId?: string;
  format?: string;
  threshold?: string;
  description?: string;
  unit?: string;
  sharedMetricId?: string;
  sharedMetricVersion?: number;
}
export interface RuntimeAnalyticsWidget {
  id: string;
  title: string;
  type: string;
  datasetId?: string;
  metricIds?: string[];
  dimension?: string;
  width?: string;
  interaction?: string;
  appearance?: import('./analyticsWidgetAppearance').AnalyticsWidgetAppearance;
}
export interface RuntimeAnalyticsDesign {
  datasets?: RuntimeAnalyticsDataset[];
  metrics?: RuntimeAnalyticsMetric[];
  widgets?: RuntimeAnalyticsWidget[];
  globalFilters?: string[];
  interactions?: Array<{sourceWidgetId: string; targetWidgetId: string; action: string}>;
  style?: Record<string, unknown>;
  [key: string]: unknown;
}
export interface AnalyticsWidgetData {
  metricValues: Record<string, number | null>;
  series: Array<{name: string; [key: string]: string | number | null}>;
  rows: AnalyticsRow[];
  total: number;
  truncated?: boolean;
}
export interface RuntimeAnalyticsData {
  metricValues?: Record<string, number | null>;
  widgets?: Record<string, AnalyticsWidgetData>;
  filterOptions?: Record<string, string[]>;
  errors?: string[];
  datasetSources?: Record<string, string>;
  fieldLabels?: Record<string, Record<string, string>>;
}
export interface AnalyticsEditorState {
  formId: number;
  design: RuntimeAnalyticsDesign;
  publishedDesign: RuntimeAnalyticsDesign | null;
  revision: string;
  publishedVersion?: number | null;
  draftSavedAt?: string | null;
  publishedAt?: string | null;
}
export interface AnalyticsVersion {
  version: number;
  publishedAt?: string | null;
  publishedBy?: string | number | null;
  publishedByName?: string | null;
  scope: string;
  note: string | null;
  current: boolean;
  summary: { widgets: number; datasets: number; metrics: number };
}
export interface AnalyticsVersionDetail extends AnalyticsVersion { design: RuntimeAnalyticsDesign }
export type AnalyticsEditorPanelName = 'widget' | 'data' | 'filters' | 'style' | 'add' | 'permissions' | 'versions' | 'library';
export type AnalyticsWidgetTabName = 'data' | 'style' | 'interaction';

export interface SharedMetricDefinition {
  name: string;
  source: string;
  expression: string;
  format: string;
  unit: string;
  description: string;
  threshold: string;
  sourceFormId?: number;
  sourceName?: string;
  dimensions?: string[];
  measures?: string[];
}
export interface SharedMetricEntry {
  id: string;
  draft: SharedMetricDefinition;
  published: SharedMetricDefinition | null;
  publishedVersion: number;
  revision: string;
  updatedAt?: string | null;
  versions?: Array<{version: number; definition: SharedMetricDefinition; publishedAt: string; note: string | null}>;
}
export interface SharedMetricReferences {
  counts: {publishedBoards: number; publishedCharts: number; draftBoards: number; draftCharts: number};
  references: Array<{formId: number; programId: string; boardName: string; state: 'published' | 'draft'; version?: number | null; metricCount: number; widgets: Array<{id: string; title: string; type: string}>}>;
}
export interface SharedMetricImpact extends SharedMetricReferences {
  definition: SharedMetricDefinition;
  nextVersion: number;
  impactToken: string;
  unchanged: boolean;
  errors: string[];
}
