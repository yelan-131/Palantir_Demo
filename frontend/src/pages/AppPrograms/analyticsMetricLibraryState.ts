import {copyAnalyticsDesign} from './analyticsEditorState';
import type {RuntimeAnalyticsDataset, RuntimeAnalyticsDesign, RuntimeAnalyticsMetric, SharedMetricDefinition, SharedMetricEntry} from './analyticsTypes';

export const sharedMetricFields = ['name', 'expression', 'format', 'unit', 'description', 'threshold'] as const;

export function sharedDefinitionKey(value: SharedMetricDefinition): string {
  return JSON.stringify([value.source, ...sharedMetricFields.map(key => value[key] || (key === 'format' ? 'number' : ''))]);
}

export function sharedMetricSeed(metric: RuntimeAnalyticsMetric, dataset: RuntimeAnalyticsDataset): SharedMetricDefinition {
  return {name: metric.name, source: dataset.source, expression: metric.expression || '', format: metric.format || 'number',
    unit: metric.unit || '', description: metric.description || '', threshold: metric.threshold || ''};
}

export function compatibleMetricSource(dataset: RuntimeAnalyticsDataset, definition: SharedMetricDefinition) {
  return dataset.sourceType === 'businessForm' && (dataset.source === definition.source ||
    definition.sourceFormId != null && dataset.source === String(definition.sourceFormId));
}

const newId = (prefix: string) => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2,9)}`}`;

export function bindSharedMetricToBoard(design: RuntimeAnalyticsDesign, item: SharedMetricEntry, replaceId = '', ids?: {metricId: string; datasetId: string}) {
  if (!item.published || item.publishedVersion < 1) throw new Error('请先发布共享指标，再引用到看板。');
  const definition = item.published;
  const next = copyAnalyticsDesign(design);
  next.datasets ||= []; next.metrics ||= [];
  const previous = replaceId ? next.metrics.find(metric => metric.id === replaceId) : undefined;
  if (replaceId && !previous) throw new Error('要替换的看板指标已不存在，请重新选择。');
  let dataset = previous ? next.datasets.find(value => value.id === previous.datasetId) : next.datasets.find(value => compatibleMetricSource(value, definition));
  if (previous && (!dataset || !compatibleMetricSource(dataset, definition))) throw new Error('指标来源不同，不能替换；请作为新指标引用。');
  if (!dataset) {
    dataset = {id: ids?.datasetId || newId('shared-source'), name: definition.sourceName || definition.source,
      sourceType:'businessForm', source:definition.source, refreshMode:'manual', dimensions:[], measures:[]};
    next.datasets.push(dataset);
  }
  dataset.dimensions = [...new Set([...(dataset.dimensions || []), ...(definition.dimensions || [])])];
  dataset.measures = [...new Set([...(dataset.measures || []), ...(definition.measures || [])])];
  const metric: RuntimeAnalyticsMetric = {id: previous?.id || ids?.metricId || newId('shared-metric'), datasetId:dataset.id,
    ...Object.fromEntries(sharedMetricFields.map(key => [key, definition[key]])), name:definition.name,
    sharedMetricId:item.id, sharedMetricVersion:item.publishedVersion};
  next.metrics = previous ? next.metrics.map(value => value.id === previous.id ? metric : value) : [...next.metrics, metric];
  return {design:next, metricId:metric.id};
}

export function detachSharedMetric(metric: RuntimeAnalyticsMetric): RuntimeAnalyticsMetric {
  const {sharedMetricId: _id, sharedMetricVersion: _version, ...local} = metric;
  return local;
}
