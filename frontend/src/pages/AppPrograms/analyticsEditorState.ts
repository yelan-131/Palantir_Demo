import type { RuntimeAnalyticsDesign, RuntimeAnalyticsDataset, RuntimeAnalyticsMetric } from './analyticsTypes';

export function copyAnalyticsDesign(design: RuntimeAnalyticsDesign): RuntimeAnalyticsDesign {
  return JSON.parse(JSON.stringify(design));
}

export function normalizeAnalyticsDesign(design: RuntimeAnalyticsDesign): RuntimeAnalyticsDesign {
  const value = copyAnalyticsDesign(design);
  return { ...value, datasets: value.datasets || [], metrics: value.metrics || [], widgets: value.widgets || [], globalFilters: value.globalFilters || [], interactions: value.interactions || [], style: value.style || {} };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}

export function sameAnalyticsDesign(left: RuntimeAnalyticsDesign, right: RuntimeAnalyticsDesign): boolean {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

export function moveAnalyticsWidget(design: RuntimeAnalyticsDesign, source: string, target: string): RuntimeAnalyticsDesign {
  const widgets = [...(design.widgets || [])];
  const from = widgets.findIndex(item => item.id === source);
  const to = widgets.findIndex(item => item.id === target);
  if (from < 0 || to < 0 || from === to) return design;
  const [widget] = widgets.splice(from, 1);
  widgets.splice(to, 0, widget);
  return { ...design, widgets };
}

export function analyticsErrorMessage(error: unknown, fallback: string): string {
  const detail = (error as {response?: {data?: {detail?: unknown}}})?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (detail && typeof detail === 'object') {
    const value = detail as {message?: string; errors?: unknown[]};
    return [value.message, ...(value.errors || []).map(String)].filter(Boolean).join('；') || fallback;
  }
  return fallback;
}

// Only remove bindings that can no longer resolve after an explicit schema change.
export function reconcileAnalyticsBindings(next: RuntimeAnalyticsDesign): RuntimeAnalyticsDesign {
  const datasets = next.datasets || [];
  const widgets = (next.widgets || []).map(widget => {
    const dataset = datasets.find(item => item.id === widget.datasetId);
    return {
      ...widget,
      dimension: dataset?.dimensions?.includes(widget.dimension || '') ? widget.dimension : undefined,
      metricIds: (widget.metricIds || []).filter(id => next.metrics?.some(metric => metric.id === id && metric.datasetId === widget.datasetId)),
    };
  });
  const dimensions = new Set(datasets.flatMap(dataset => dataset.dimensions || []));
  return {
    ...next,
    widgets,
    globalFilters: (next.globalFilters || []).filter(field => dimensions.has(field === 'dateRange' ? 'date' : field)),
    interactions: (next.interactions || []).filter(link => {
      const source = widgets.find(widget => widget.id === link.sourceWidgetId);
      const target = widgets.find(widget => widget.id === link.targetWidgetId);
      const targetDataset = datasets.find(dataset => dataset.id === target?.datasetId);
      return !!source && !!target && source.id !== target.id && !!source.dimension
        && (link.action === 'navigate' || !!targetDataset?.dimensions?.includes(source.dimension));
    }),
  };
}


/** Apply one isolated dataset editor without overwriting unrelated board changes. */
export function applyAnalyticsDataset(current: RuntimeAnalyticsDesign, dataset: RuntimeAnalyticsDataset, nextMetrics: RuntimeAnalyticsMetric[]): RuntimeAnalyticsDesign {
  const present = current.datasets?.some(item => item.id === dataset.id);
  const replacements = new Map(nextMetrics.map(metric => [metric.id, metric]));
  const previousIds = new Set((current.metrics || []).map(metric => metric.id));
  const metrics = (current.metrics || []).flatMap(metric => metric.datasetId !== dataset.id ? [metric] : replacements.has(metric.id) ? [replacements.get(metric.id)!] : []);
  return reconcileAnalyticsBindings({...current,
    datasets: present ? current.datasets!.map(item => item.id === dataset.id ? dataset : item) : [...(current.datasets || []),dataset],
    metrics:[...metrics,...nextMetrics.filter(metric => !previousIds.has(metric.id))],
  });
}
