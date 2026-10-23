import { registerTheme } from 'echarts';
import { TECH_WHITE_PALETTE as colors, TECH_WHITE_TYPOGRAPHY as typography } from './techWhite';

export const TECH_WHITE_CHART_THEME_NAME = 'manufoundry-tech-white';
// Categorical series remain distinguishable from the semantic status palette.
export const CHART_SERIES_COLORS = [colors.primary, '#548985', '#B29258', '#877394', '#5981A5', '#AD7770'];

const axis = {
  axisLine: { lineStyle: { color: colors.borderStrong } },
  axisTick: { lineStyle: { color: colors.borderStrong } },
  axisLabel: { color: colors.muted, fontSize: typography.auxiliary, fontFamily: typography.fontFamily },
  nameTextStyle: { color: colors.muted, fontSize: typography.auxiliary },
  splitLine: { lineStyle: { color: colors.border, type: 'dashed' } },
};

registerTheme(TECH_WHITE_CHART_THEME_NAME, {
  color: CHART_SERIES_COLORS,
  backgroundColor: 'transparent',
  textStyle: { color: colors.text, fontFamily: typography.fontFamily, fontSize: typography.compact },
  title: {
    textStyle: { color: colors.text, fontSize: typography.sectionTitle, fontWeight: 600 },
    subtextStyle: { color: colors.muted, fontSize: typography.auxiliary },
  },
  legend: {
    textStyle: { color: colors.muted, fontSize: typography.auxiliary },
    inactiveColor: colors.borderStrong,
    itemWidth: 14,
    itemHeight: 8,
    itemGap: 16,
  },
  tooltip: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    padding: [10, 12],
    textStyle: { color: colors.text, fontFamily: typography.fontFamily, fontSize: typography.compact },
    extraCssText: 'border-radius:8px;box-shadow:0 6px 20px rgba(32,35,38,.08);',
    axisPointer: { lineStyle: { color: colors.borderStrong }, crossStyle: { color: colors.muted }, shadowStyle: { color: 'rgba(82,107,134,.06)' } },
  },
  categoryAxis: { ...axis, splitLine: { show: false } },
  valueAxis: axis,
  timeAxis: axis,
  logAxis: axis,
  line: { symbol: 'emptyCircle', symbolSize: 6, lineStyle: { width: 2 } },
  pie: { label: { color: colors.muted, fontSize: typography.auxiliary }, labelLine: { lineStyle: { color: colors.borderStrong } } },
  gauge: {
    axisLabel: { color: colors.muted },
    title: { color: colors.muted, fontSize: typography.compact },
    detail: { color: colors.text, fontSize: 24, fontWeight: 600 },
  },
});
