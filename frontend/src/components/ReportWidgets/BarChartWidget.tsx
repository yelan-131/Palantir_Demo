import React, { useEffect, useState } from 'react';
import { Spin, Empty } from 'antd';
import ReactECharts from 'echarts-for-react';
import { TECH_WHITE_CHART_THEME_NAME } from '../../theme/charts';
import type { EChartsOption } from 'echarts';
import type { WidgetInstance } from './types';
import { fetchDataFromApi } from './WidgetRegistry';

interface Props {
  widget: WidgetInstance;
  isEditing: boolean;
}

export default function BarChartWidget({ widget, isEditing }: Props) {
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
  const xField = (cfg.xField as string) || 'name';
  const series = (cfg.series as { name: string; dataField: string }[]) || [];

  const option: EChartsOption = {
    tooltip: { trigger: 'axis' },
    legend: { data: series.map(s => s.name) },
    grid: { left: 40, right: 20, top: 30, bottom: 30 },
    xAxis: { type: 'category', data: data.map((d: any) => d[xField]) },
    yAxis: { type: 'value' },
    series: series.map(s => ({
      name: s.name,
      type: 'bar' as const,
      data: data.map((d: any) => d[s.dataField]),
    })),
  };

  return <ReactECharts theme={TECH_WHITE_CHART_THEME_NAME} option={option} style={{ height: '100%', width: '100%' }} />;
}
