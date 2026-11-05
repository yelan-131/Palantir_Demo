import React from 'react';
import {Empty, Statistic, Table} from 'antd';
import ReactECharts from 'echarts-for-react';
import {widgetAppearance} from '../AppPrograms/analyticsWidgetAppearance';
import {formatAnalyticsValue} from '../AppPrograms/analyticsExploration';
import type {AnalyticsWidgetData} from '../AppPrograms/analyticsTypes';
import type {PageDefinition, PageWidget} from './model';

export function thresholdColor(value: number | null | undefined, threshold?: string) {
  if (value == null || !threshold) return undefined;
  const match = threshold.match(/(红色|绿色|黄色|橙色|正常)\s*(>=|<=|>|<|=)\s*(-?\d+(?:\.\d+)?)%?/);
  if (!match) return undefined;
  const target = Number(match[3]);
  const pass = match[2] === '>=' ? value >= target : match[2] === '<=' ? value <= target : match[2] === '>' ? value > target : match[2] === '<' ? value < target : value === target;
  return pass ? ({红色:'#dc4446',绿色:'#24986b',黄色:'#ad8700',橙色:'#c26b18',正常:undefined})[match[1]] : undefined;
}

export default function StatisticalWidget({widget, result, style, labels, onInteract}: {
  widget: PageWidget; result: AnalyticsWidgetData; style: PageDefinition['style']; labels: Record<string,string>; onInteract: (name: string)=>void;
}) {
  const appearance = widgetAppearance({id:widget.id,title:widget.title,type:widget.chartType??widget.type,appearance:widget.appearance},style);
  const metric = {id:widget.id,name:widget.title,format:widget.format,unit:widget.unit};
  const format = (value: unknown) => formatAnalyticsValue(value,metric);
  if (widget.type === 'metric') return <div style={{textAlign:appearance.contentAlign,padding:appearance.contentPadding}}><Statistic title={appearance.showMetricLabel?(widget.expression?widget.title:widget.aggregate==='count'?'当前筛选范围':labels[widget.measure||'']):undefined} value={result.metricValues[widget.id]??'—'} formatter={value=>format(value)} valueStyle={{fontSize:appearance.valueFontSize,color:thresholdColor(result.metricValues[widget.id],widget.threshold)||(widget.appearance?.palette?appearance.colors[0]:undefined)}} /></div>;
  if (!result.series.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前筛选下没有数据" />;
  const type = widget.chartType??'bar';
  if (type==='rank-table') return <Table size={appearance.tableDensity==='comfortable'?'large':appearance.tableDensity==='standard'?'middle':'small'} rowKey="name" showHeader={appearance.showTableHeader} bordered={appearance.tableBordered} rowClassName={(_,index)=>appearance.tableStriped&&index%2?'component-table-striped':''} dataSource={[...result.series].sort((a,b)=>Number(b[widget.id]??0)-Number(a[widget.id]??0))} columns={[{title:labels[widget.dimension||'']||'分类',dataIndex:'name',align:appearance.tableAlign},{title:widget.title,dataIndex:widget.id,render:format,align:appearance.tableAlign}]} pagination={{pageSize:appearance.tablePageSize,hideOnSinglePage:true}} onRow={record=>({onClick:()=>onInteract(record.name),tabIndex:0,onKeyDown:event=>{if(event.key==='Enter')onInteract(record.name);},style:{cursor:'pointer'}})} />;
  const pie = type==='pie';
  const horizontal = !pie&&appearance.horizontal;
  const categoryAxis={type:'category',axisLine:{lineStyle:{color:'#dce3ec'}},axisTick:{show:false},axisLabel:{show:appearance.showAxisLabels,color:'#788596',fontSize:appearance.axisLabelFontSize,rotate:appearance.axisLabelRotate,hideOverlap:true},nameTextStyle:{color:'#788596'},name:labels[widget.dimension||''],nameLocation:'middle',nameGap:30,data:result.series.map(point=>point.name)};
  const valueAxis={type:'value',minInterval:!widget.expression&&widget.aggregate==='count'&&widget.format!=='percent'?1:undefined,axisLabel:{show:appearance.showAxisLabels,color:'#788596',fontSize:appearance.axisLabelFontSize,formatter:format},nameTextStyle:{color:'#788596'},splitLine:{show:appearance.showGrid,lineStyle:{color:'#edf0f5',type:appearance.gridLineType}},name:widget.unit||(widget.format==='percent'?'百分比（%）':widget.expression?widget.title:widget.aggregate==='count'?'记录数（条）':labels[widget.measure||''])};
  const legendVertical=appearance.legendOrient==='vertical'||(appearance.legendOrient==='auto'&&['left','right'].includes(appearance.legendPosition));
  return <ReactECharts notMerge style={{height:widget.height??appearance.height}} option={{
    backgroundColor:'transparent',color:appearance.colors,
    tooltip:{trigger:pie?'item':'axis',confine:true,valueFormatter:format},
    legend:{show:appearance.showLegend,orient:legendVertical?'vertical':'horizontal',selectedMode:appearance.legendSelectable,itemGap:appearance.legendItemGap,...(appearance.legendPosition==='bottom'?{bottom:0,left:'center'}:appearance.legendPosition==='left'?{left:0,top:'middle'}:appearance.legendPosition==='right'?{right:0,top:'middle'}:{top:0,left:'center'}),icon:'roundRect',itemWidth:12,itemHeight:8,textStyle:{color:'#788596',fontSize:appearance.legendFontSize},data:pie?result.series.map(point=>point.name):[widget.title]},
    grid:{left:appearance.showLegend&&appearance.legendPosition==='left'?100:16,right:appearance.showLegend&&appearance.legendPosition==='right'?100:20,bottom:appearance.showLegend&&appearance.legendPosition==='bottom'?65:40,top:appearance.showLegend&&appearance.legendPosition==='top'?44:30,containLabel:true},
    ...(pie?{}:{xAxis:horizontal?valueAxis:categoryAxis,yAxis:horizontal?categoryAxis:valueAxis}),
    series:pie?[{name:widget.title,type:'pie',radius:[`${appearance.pieInnerRadius}%`,`${appearance.pieOuterRadius}%`],center:['50%','55%'],label:{show:appearance.showLabels,fontSize:appearance.labelFontSize,position:appearance.labelPosition,formatter:(point:{name:string;value:unknown})=>`${point.name}\n${format(point.value)}`},itemStyle:{borderRadius:4,borderColor:'#fff',borderWidth:2},data:result.series.map(point=>({name:point.name,value:point[widget.id]}))}]:[{name:widget.title,type:type==='line'?'line':'bar',smooth:appearance.smooth,connectNulls:false,barMaxWidth:appearance.barWidth,symbolSize:appearance.symbolSize,lineStyle:{width:appearance.lineWidth},itemStyle:{borderRadius:type==='line'?0:[4,4,0,0]},label:{show:appearance.showLabels,fontSize:appearance.labelFontSize,position:appearance.labelPosition==='outside'?'top':appearance.labelPosition,formatter:(point:{value:unknown})=>format(point.value)},data:result.series.map(point=>point[widget.id])}],
  }} onEvents={{click:(event:{name:string})=>onInteract(event.name)}} />;
}
