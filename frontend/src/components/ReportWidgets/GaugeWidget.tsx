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

export default function GaugeWidget({ widget, isEditing }: Props) {
  const [value, setValue] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isEditing || !widget.dataSource?.endpoint) return;
    let cancelled = false;
    setLoading(true);
    fetchDataFromApi(widget.dataSource!)
      .then((data) => {
        if (cancelled) return;
        const cfg = widget.chartConfig || {};
        const field = (cfg.valueField as string) || 'avg_health';
        if (Array.isArray(data)) {
          setValue(data[0]?.[field] ?? data[0]?.value ?? 0);
        } else {
          const d = data as Record<string, any>;
          setValue(d?.[field] ?? d?.data?.[0]?.[field] ?? 75);
        }
      })
      .catch(() => { if (!cancelled) setValue(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [widget.dataSource, isEditing]);

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}><Spin /></div>;
  if (value === null && !isEditing) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}><Empty description="暂无数据" /></div>;

  const cfg = widget.chartConfig || {};
  const max = (cfg.max as number) || 100;
  const displayValue = value ?? 75;

  const option: EChartsOption = {
    series: [{
      type: 'gauge',
      min: 0,
      max,
      progress: { show: true, width: 14 },
      axisLine: { lineStyle: { width: 14 } },
      axisTick: { show: false },
      splitLine: { length: 8, lineStyle: { width: 2, color: colors.borderStrong } },
      axisLabel: { distance: 20, fontSize: 11 },
      pointer: { itemStyle: { color: 'auto' } },
      detail: { valueAnimation: true, formatter: '{value}%', fontSize: 20, offsetCenter: [0, '70%'] },
      data: [{ value: displayValue }],
    }],
  };

  return <ReactECharts theme={TECH_WHITE_CHART_THEME_NAME} option={option} style={{ height: '100%', width: '100%' }} />;
}
