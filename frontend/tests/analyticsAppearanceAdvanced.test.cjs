const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const context={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname,'../src/pages/AppPrograms/analyticsWidgetAppearance.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,context);
const {widgetAppearance}=context.exports;
test('existing charts retain multiple series and unfilled solid lines',()=>{
 const value=widgetAppearance({type:'line'});
 assert.equal(value.seriesMode,'multiple');
 assert.equal(value.areaFill,false);
 assert.equal(value.stacked,false);
 assert.equal(value.lineType,'solid');
 assert.equal(value.gridLeft,undefined);
});
test('advanced chart options survive normalization and constrain geometry',()=>{
 const value=widgetAppearance({type:'line',appearance:{seriesMode:'single',areaFill:true,stacked:true,lineType:'dashed',titleAlign:'center',titleFontFamily:'serif',titleColor:'#123456',titleItalic:true,titleGap:200,gridLeft:-20,gridRight:999,gridTop:NaN}});
 assert.equal(value.seriesMode,'single');
 assert.equal(value.areaFill,true);
 assert.equal(value.stacked,true);
 assert.equal(value.titleAlign,'center');
 assert.equal(value.titleColor,'#123456');
 assert.equal(value.titleFontFamily,'serif');
 assert.equal(value.titleItalic,true);
 assert.equal(value.titleGap,40);
 assert.equal(value.gridLeft,0);
 assert.equal(value.gridRight,160);
 assert.equal(value.gridTop,40);
});

test('type-specific additions preserve legacy defaults and bound optional values',()=>{
 const legacy=widgetAppearance({type:'detail-table'});
 assert.equal(legacy.tablePagination,true);
 assert.equal(legacy.tableRowNumbers,false);
 assert.equal(legacy.tableColumns,undefined);
 const value=widgetAppearance({type:'rank-table',appearance:{tableColumns:['name',42,'actual'],rankLimit:999,tableFontSize:90,rankAscending:true,tablePagination:false,pieStartAngle:-20,barGap:999}});
 assert.equal(JSON.stringify(value.tableColumns),JSON.stringify(['name','actual']));
 assert.equal(value.rankLimit,500);
 assert.equal(value.tableFontSize,24);
 assert.equal(value.rankAscending,true);
 assert.equal(value.tablePagination,false);
 assert.equal(value.pieStartAngle,0);
 assert.equal(value.barGap,100);
});

test('presentation controls keep defaults and normalize extreme layout values',()=>{
 const defaults=widgetAppearance({type:'pie'});
 assert.equal(defaults.showTooltip,true);
 assert.equal(defaults.animate,true);
 assert.equal(defaults.enableZoom,false);
 assert.equal(defaults.pieLabelContent,'value');
 assert.equal(defaults.tableColumnWidth,undefined);
 assert.equal(defaults.tableScrollHeight,undefined);
 assert.equal(defaults.metricGap,16);
 const value=widgetAppearance({type:'line',appearance:{showTooltip:false,animate:false,showSymbol:false,symbolShape:'bad',pieCenterX:-10,pieCenterY:999,tableScrollHeight:0,tableColumnWidth:Infinity,metricGap:-1,metricLabelGap:100,tableHeaderAlign:'center'}});
 assert.equal(value.showTooltip,false);
 assert.equal(value.animate,false);
 assert.equal(value.showSymbol,false);
 assert.equal(value.symbolShape,'circle');
 assert.equal(value.pieCenterX,10);
 assert.equal(value.pieCenterY,90);
 assert.equal(value.tableScrollHeight,120);
 assert.equal(value.tableColumnWidth,140);
 assert.equal(value.metricGap,0);
 assert.equal(value.metricLabelGap,32);
 assert.equal(value.tableHeaderAlign,'center');
});
