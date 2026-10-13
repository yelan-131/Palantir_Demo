import React, { useEffect, useState } from 'react';
import { Spin, Empty } from 'antd';
import ReactECharts from 'echarts-for-react';
import { TECH_WHITE_CHART_THEME_NAME } from '../../theme/charts';
import type { EChartsOption } from 'echarts';
import { TECH_WHITE_PALETTE as colors } from '../../theme/techWhite';
import type { WidgetInstance } from './types';
import { fetchDataFromApi } from './WidgetRegistry';

interface Props {
  widget: WidgetInstance;
  isEditing: boolean;
}

export default function LineChartWidget({ widget, isEditing }: Props) {
  const [data, setData] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isEditing || !widget.dataSource?.endpoint) return;
    let cancelled = false;
    setLoading(true);
    fetchDataFromApi(widget.dataSource!)
      .then((res) => { if (!cancelled) setData(Array.isArray(res) ? res : res?.data || []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [widget.dataSource, isEditing]);

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}><Spin /></div>;
  if (!data.length && !isEditing) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}><Empty description="暂无数据" /></div>;

  const cfg = widget.chartConfig || {};
  const xField = (cfg.xField as string) || 'date';
  const series = (cfg.series as { name: string; dataField: string }[]) || [];
  const controlLimits = cfg.controlLimits as { ucl?: string; lcl?: string; cl?: string } | undefined;

  const option: EChartsOption = {
    tooltip: { trigger: 'axis' },
    legend: { data: series.map(s => s.name) },
    grid: { left: 40, right: 20, top: 30, bottom: 30 },
    xAxis: { type: 'category', data: data.map((d: any) => d[xField]) },
    yAxis: { type: 'value' },
    series: series.map(s => ({
      name: s.name,
      type: 'line' as const,
      data: data.map((d: any) => d[s.dataField]),
      smooth: true,
    })),
  };

  if (controlLimits && data.length > 0) {
    const uclData = controlLimits.ucl ? data.map((d: any) => d[controlLimits.ucl!]) : [];
    const lclData = controlLimits.lcl ? data.map((d: any) => d[controlLimits.lcl!]) : [];
    const clData = controlLimits.cl ? data.map((d: any) => d[controlLimits.cl!]) : [];
    if (uclData.length) (option.series as any[]).push({ name: 'UCL', type: 'line', data: uclData, itemStyle: { color: colors.danger }, lineStyle: { type: 'dashed', color: colors.danger }, symbol: 'none' });
    if (lclData.length) (option.series as any[]).push({ name: 'LCL', type: 'line', data: lclData, itemStyle: { color: colors.danger }, lineStyle: { type: 'dashed', color: colors.danger }, symbol: 'none' });
    if (clData.length) (option.series as any[]).push({ name: 'CL', type: 'line', data: clData, itemStyle: { color: colors.warning }, lineStyle: { type: 'dashed', color: colors.warning }, symbol: 'none' });
    if (option.legend) (option.legend as any).data = [...(option.legend as any).data, 'UCL', 'LCL', 'CL'];
  }

  return <ReactECharts theme={TECH_WHITE_CHART_THEME_NAME} option={option} style={{ height: '100%', width: '100%' }} />;
}
