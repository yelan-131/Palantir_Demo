import type {RuntimeAnalyticsDesign, RuntimeAnalyticsWidget} from './analyticsTypes';

/** Reuse the existing subtitle, metric definitions and source instead of inventing business facts. */
export function widgetInfoText(widget:RuntimeAnalyticsWidget, design:RuntimeAnalyticsDesign):string {
  if(widget.appearance?.infoTextMode==='custom' || widget.appearance?.infoText?.trim()) return widget.appearance.infoText || '';
  const purpose:Record<string,string>={
    'metric-card':'汇总当前筛选范围内的关键指标。',line:'展示指标随分组维度变化的趋势。',
    bar:'对比各分组的指标数值。',pie:'展示首个指标在各分组中的构成。',
    'rank-table':'按首个指标从高到低展示各分组排行。','detail-table':'展示当前筛选范围内的授权明细记录。',
  };
  const metrics=(design.metrics || []).filter(metric=>widget.metricIds?.includes(metric.id));
  const dataset=design.datasets?.find(item=>item.id===widget.datasetId);
  return [widget.appearance?.subtitle || purpose[widget.type],dataset?.name?`数据来源：${dataset.name}。`:'',...metrics.map(metric=>metric.description || `${metric.name}：${metric.expression || '尚未配置计算公式'}${metric.unit?`（${metric.unit}）`:''}。`)].filter(Boolean).join('\n').slice(0,500);
}
