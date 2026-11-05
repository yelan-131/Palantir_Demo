import type {RuntimeAnalyticsWidget} from './analyticsTypes';

// Shared by the runtime and both designers. Missing values in older boards inherit these.
export const dashboardStyleDefaults = {
  gridSize: 44, cardOpacity: 0.78, cardBlur: 12,
  background: '#f6f8fa', componentGap: 16, cardRadius: 12,
};

export const widgetPalettes = {
  manufacturing: ['#2c6e84', '#24986b', '#718d38'],
  business: ['#3867b0', '#b27d32', '#7e62a3'],
  warning: ['#cb494b', '#cc8a23', '#6d8d35'],
  mono: ['#2c6e84', '#628fa1', '#99b4be'],
};
export const widgetFontOptions = [
  {value:'inherit',label:'跟随主题'},
  {value:'sans-serif',label:'无衬线字体'},
  {value:'serif',label:'衬线字体'},
  {value:'monospace',label:'等宽字体'},
  {value:'PingFang SC, Microsoft YaHei, sans-serif',label:'苹方 / 微软雅黑'},
];
export type AnalyticsWidgetAppearance = {
  showTooltip?: boolean;
  animate?: boolean;
  enableZoom?: boolean;
  showSymbol?: boolean;
  symbolShape?: 'circle' | 'rect' | 'diamond' | 'triangle';
  pieLabelContent?: 'value' | 'percent' | 'both';
  pieCenterX?: number;
  pieCenterY?: number;
  tableColumnWidth?: number;
  tableScrollHeight?: number;
  tableHeaderAlign?: 'left' | 'center' | 'right';
  metricGap?: number;
  metricLabelGap?: number;
  tableColumns?: string[];
  tableRowNumbers?: boolean;
  tablePagination?: boolean;
  tableWrap?: boolean;
  tableFontSize?: number;
  tableHeaderColor?: string;
  rankAscending?: boolean;
  rankLimit?: number;
  metricLabelSize?: number;
  metricValueColor?: string;
  connectNulls?: boolean;
  stepLine?: boolean;
  barGap?: number;
  pieRose?: boolean;
  pieStartAngle?: number;
  seriesMode?: 'single' | 'multiple';
  areaFill?: boolean;
  stacked?: boolean;
  lineType?: 'solid' | 'dashed' | 'dotted';
  titleAlign?: 'left' | 'center' | 'right';
  titleColor?: string;
  titleFontFamily?: string;
  titleWeight?: 'normal' | 'bold';
  titleItalic?: boolean;
  titleGap?: number;
  chartFontFamily?: string;
  chartTextColor?: string;
  gridTop?: number;
  gridBottom?: number;
  gridLeft?: number;
  gridRight?: number;
  widthColumns?: number;
  cardHeight?: number;
  infoText?: string;
  infoTextMode?: 'auto' | 'custom';
  legendFontSize?: number;
  legendItemGap?: number;
  legendSelectable?: boolean;
  legendOrient?: 'auto' | 'horizontal' | 'vertical';
  labelFontSize?: number;
  labelPosition?: 'top' | 'bottom' | 'inside' | 'outside' | 'right';
  gridLineType?: 'solid' | 'dashed' | 'dotted';
  axisLabelFontSize?: number;
  axisLabelRotate?: number;
  legendPosition?: 'top' | 'bottom' | 'left' | 'right';
  showGrid?: boolean;
  showAxisLabels?: boolean;
  horizontal?: boolean;
  barWidth?: number;
  lineWidth?: number;
  symbolSize?: number;
  pieInnerRadius?: number;
  pieOuterRadius?: number;
  tableDensity?: 'compact' | 'standard' | 'comfortable';
  tablePageSize?: number;
  showTableHeader?: boolean;
  tableStriped?: boolean;
  tableBordered?: boolean;
  tableAlign?: 'left' | 'center' | 'right';
  cardOpacity?: number;
  cardBlur?: number;
  groupBackground?: boolean;
  showTitle?: boolean;
  showMetricLabel?: boolean;
  showMetricInfo?: boolean;
  titleFontSize?: number;
  valueFontSize?: number;
  contentPadding?: number;
  contentAlign?: 'left' | 'center' | 'right';
  metricColumns?: number;
  subtitle?: string;
  showSubtitle?: boolean;
  subtitleFontSize?: number;
  subtitleColor?: string;
  subtitleAlign?: 'left' | 'center' | 'right';
  palette?: keyof typeof widgetPalettes;
  height?: number;
  radius?: number;
  showLegend?: boolean;
  showLabels?: boolean;
  smooth?: boolean;
};

// Old snapshots inherit the page theme; malformed optional values cannot break the canvas.
export function widgetAppearance(widget: RuntimeAnalyticsWidget, page: Record<string, unknown> = {}) {
  const raw = widget.appearance && typeof widget.appearance === 'object' ? widget.appearance : {};
  const bounded = (value: unknown, fallback: number, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max,Math.max(min,value)) : fallback;
  const palette = Object.prototype.hasOwnProperty.call(widgetPalettes, raw.palette || '') ? raw.palette! : Object.prototype.hasOwnProperty.call(widgetPalettes, String(page.chartPalette)) ? String(page.chartPalette) as keyof typeof widgetPalettes : 'manufacturing';
  return {
    showTooltip:raw.showTooltip!==false,animate:raw.animate!==false,enableZoom:raw.enableZoom===true,
    showSymbol:raw.showSymbol!==false,symbolShape:['rect','diamond','triangle'].includes(raw.symbolShape || '')?raw.symbolShape!:'circle',
    pieLabelContent:raw.pieLabelContent==='percent' || raw.pieLabelContent==='both'?raw.pieLabelContent:'value',
    pieCenterX:bounded(raw.pieCenterX,50,10,90),pieCenterY:bounded(raw.pieCenterY,55,10,90),
    tableColumnWidth:typeof raw.tableColumnWidth==='number'?Math.round(bounded(raw.tableColumnWidth,140,60,600)):undefined,
    tableScrollHeight:typeof raw.tableScrollHeight==='number'?Math.round(bounded(raw.tableScrollHeight,320,120,800)):undefined,
    tableHeaderAlign:raw.tableHeaderAlign==='center' || raw.tableHeaderAlign==='right'?raw.tableHeaderAlign:raw.tableHeaderAlign==='left'?'left' as const:undefined,
    metricGap:bounded(raw.metricGap,16,0,48),metricLabelGap:bounded(raw.metricLabelGap,0,0,32),
    tableColumns:Array.isArray(raw.tableColumns)?raw.tableColumns.filter(value=>typeof value==='string'):undefined,
    tableRowNumbers:raw.tableRowNumbers===true,tablePagination:raw.tablePagination!==false,tableWrap:raw.tableWrap===true,
    tableFontSize:bounded(raw.tableFontSize,12,10,24),tableHeaderColor:raw.tableHeaderColor || undefined,
    rankAscending:raw.rankAscending===true,rankLimit:typeof raw.rankLimit==='number'?Math.round(bounded(raw.rankLimit,10,1,500)):undefined,
    metricLabelSize:bounded(raw.metricLabelSize,12,10,24),metricValueColor:raw.metricValueColor || undefined,
    connectNulls:raw.connectNulls===true,stepLine:raw.stepLine===true,barGap:bounded(raw.barGap,30,0,100),
    pieRose:raw.pieRose===true,pieStartAngle:bounded(raw.pieStartAngle,90,0,360),
    seriesMode:raw.seriesMode === 'single' ? 'single' : 'multiple',
    areaFill:raw.areaFill === true,stacked:raw.stacked === true,
    lineType:raw.lineType === 'dashed' || raw.lineType === 'dotted' ? raw.lineType : 'solid',
    titleAlign:raw.titleAlign === 'center' || raw.titleAlign === 'right' ? raw.titleAlign : 'left',
    titleColor:raw.titleColor || undefined,titleFontFamily:raw.titleFontFamily || 'inherit',
    titleWeight:raw.titleWeight === 'normal' ? 'normal' : 'bold',titleItalic:raw.titleItalic === true,
    titleGap:bounded(raw.titleGap,0,0,40),chartFontFamily:raw.chartFontFamily || 'sans-serif',chartTextColor:raw.chartTextColor || undefined,
    gridTop:typeof raw.gridTop==='number'?bounded(raw.gridTop,40,0,160):undefined,
    gridBottom:typeof raw.gridBottom==='number'?bounded(raw.gridBottom,55,0,160):undefined,
    gridLeft:typeof raw.gridLeft==='number'?bounded(raw.gridLeft,55,0,160):undefined,
    gridRight:typeof raw.gridRight==='number'?bounded(raw.gridRight,25,0,160):undefined,
    widthColumns:Math.round(bounded(raw.widthColumns,({quarter:3,half:6,wide:9,full:12} as Record<string,number>)[widget.width || 'half'] || 6,3,12)),cardHeight:typeof raw.cardHeight==='number'?bounded(raw.cardHeight,360,160,960):undefined,
    infoText:typeof raw.infoText==='string'?raw.infoText.slice(0,500):'',
    legendFontSize:bounded(raw.legendFontSize,11,10,20),legendItemGap:bounded(raw.legendItemGap,10,4,32),legendSelectable:raw.legendSelectable!==false,
    legendOrient:raw.legendOrient==='horizontal' || raw.legendOrient==='vertical' ? raw.legendOrient : 'auto',
    labelFontSize:bounded(raw.labelFontSize,11,10,20),labelPosition:raw.labelPosition || (widget.type==='pie'?'outside':'top'),
    gridLineType:raw.gridLineType==='solid' || raw.gridLineType==='dotted'?raw.gridLineType:'dashed',
    axisLabelFontSize:bounded(raw.axisLabelFontSize,11,10,20),axisLabelRotate:bounded(raw.axisLabelRotate,0,0,90),
    legendPosition:['bottom','left','right'].includes(raw.legendPosition || '') ? raw.legendPosition! : 'top',
    showGrid:raw.showGrid !== false, showAxisLabels:raw.showAxisLabels !== false, horizontal:raw.horizontal === true,
    barWidth:bounded(raw.barWidth,42,8,80),lineWidth:bounded(raw.lineWidth,2.5,1,8),symbolSize:bounded(raw.symbolSize,6,0,16),
    pieOuterRadius:bounded(raw.pieOuterRadius,70,40,90),pieInnerRadius:Math.min(bounded(raw.pieInnerRadius,48,0,80),bounded(raw.pieOuterRadius,70,40,90)-10),
    tableDensity:raw.tableDensity || page.tableDensity || 'standard', tablePageSize:bounded(raw.tablePageSize,10,5,100),
    showTableHeader:raw.showTableHeader !== false,tableStriped:raw.tableStriped === true,tableBordered:raw.tableBordered === true,
    tableAlign:raw.tableAlign === 'center' || raw.tableAlign === 'right' ? raw.tableAlign : 'left' as const,
    cardOpacity:bounded(raw.cardOpacity,bounded(page.cardOpacity,.78,.3,1),.3,1), cardBlur:bounded(raw.cardBlur,bounded(page.cardBlur,12,0,24),0,24), groupBackground:raw.groupBackground === true, showTitle:raw.showTitle !== false, showMetricLabel:raw.showMetricLabel !== false, showMetricInfo:raw.showMetricInfo !== false,
    titleFontSize:bounded(raw.titleFontSize,12,10,24), valueFontSize:bounded(raw.valueFontSize,30,16,64),
    contentPadding:bounded(raw.contentPadding,18,0,40), metricColumns:typeof raw.metricColumns === 'number' ? bounded(raw.metricColumns,3,1,6) : undefined,
    contentAlign:raw.contentAlign === 'center' || raw.contentAlign === 'right' ? raw.contentAlign : 'left' as const,
    palette, colors:widgetPalettes[palette], height:bounded(raw.height,280,200,640),
    radius:bounded(raw.radius,bounded(page.cardRadius,dashboardStyleDefaults.cardRadius,0,24),0,24),
    subtitle:typeof raw.subtitle === 'string' ? raw.subtitle : '',
    showLegend:raw.showLegend !== false, showLabels:typeof raw.showLabels === 'boolean' ? raw.showLabels : widget.type === 'pie', smooth:raw.smooth === true};
}
