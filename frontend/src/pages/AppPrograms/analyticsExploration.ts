import type { AnalyticsFilters, RuntimeAnalyticsData, RuntimeAnalyticsDesign, RuntimeAnalyticsMetric } from './analyticsTypes';

export function analyticsDataSignature(design: RuntimeAnalyticsDesign): string {
  return JSON.stringify({
    datasets: (design.datasets || []).map(({id, sourceType, source, dimensions, measures, rangeFilters}) => ({id, sourceType, source, dimensions, measures, rangeFilters})),
    metrics: (design.metrics || []).map(({id, datasetId, expression, format, sharedMetricId, sharedMetricVersion}) => ({id, datasetId, expression, format, sharedMetricId, sharedMetricVersion})),
    widgets: (design.widgets || []).map(({id, type, datasetId, metricIds, dimension}) => ({id, type, datasetId, metricIds, dimension})),
    filters: design.globalFilters || [],
  });
}

const defaultLabels: Record<string, string> = {name: '对象', date: '日期', dateRange: '日期范围', category: '品类', subject: '对象', status: '状态', owner: '负责人', actual: '实际值', target: '目标值'};

export function analyticsFieldLabel(data: RuntimeAnalyticsData | undefined, field: string, datasetId?: string): string {
  if (field === 'dateRange') return `${analyticsFieldLabel(data, 'date', datasetId)}范围`;
  const labels = datasetId ? [data?.fieldLabels?.[datasetId]?.[field]] : Object.values(data?.fieldLabels || {}).map(fields => fields[field]);
  const names = [...new Set(labels.filter(Boolean))];
  return names.length === 1 ? names[0]! : defaultLabels[field] || field;
}

export function formatAnalyticsValue(value: unknown, metric?: RuntimeAnalyticsMetric): string {
  if (value == null) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  const result = numeric.toLocaleString('zh-CN', {maximumFractionDigits: 2});
  return metric?.format === 'percent' ? `${result}%` : metric?.format === 'currency' ? `¥${result}` : metric?.format === 'duration' ? `${result} 秒` : `${result}${metric?.unit ? ` ${metric.unit}` : ''}`;
}

export function removeAnalyticsWidgetFilter(current: Record<string, AnalyticsFilters>, widgetId: string, field?: string) {
  const next = {...current};
  if (field) {
    const conditions = {...next[widgetId]};
    delete conditions[field];
    if (Object.keys(conditions).length) next[widgetId] = conditions;
    else delete next[widgetId];
  } else delete next[widgetId];
  return next;
}

export function analyticsDrilldownQuery(query: {filters: AnalyticsFilters; widget_filters: Record<string, AnalyticsFilters>}, widgetId: string, dimension: string, value: string) {
  return {filters: {...query.filters}, widget_filters: {...query.widget_filters, [widgetId]: {...query.widget_filters[widgetId], [dimension]: value}}};
}
