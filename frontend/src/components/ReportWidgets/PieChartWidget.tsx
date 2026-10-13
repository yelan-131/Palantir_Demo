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

export default function PieChartWidget({ widget, isEditing }: Props) {
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
  const nameField = (cfg.nameField as string) || 'name';
  const valueField = (cfg.valueField as string) || 'value';

  const option: EChartsOption = {
    tooltip: { trigger: 'item' },
    series: [{
      type: 'pie',
      radius: ['40%', '70%'],
      data: data.map((d: any) => ({ name: d[nameField], value: d[valueField] })),
      emphasis: { itemStyle: { shadowBlur: 8, shadowOffsetX: 0, shadowColor: 'rgba(32, 35, 38, 0.12)' } },
    }],
  };

  return <ReactECharts theme={TECH_WHITE_CHART_THEME_NAME} option={option} style={{ height: '100%', width: '100%' }} />;
}
