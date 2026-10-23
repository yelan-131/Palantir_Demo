const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const context = {exports:{}, require: name => {assert.equal(name,'./analyticsEditorState');return {copyAnalyticsDesign:value=>JSON.parse(JSON.stringify(value))};}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/pages/AppPrograms/analyticsMetricLibraryState.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
const {bindSharedMetricToBoard,detachSharedMetric,sharedDefinitionKey}=context.exports;
const plain=value=>JSON.parse(JSON.stringify(value));
const definition={name:'合格率',source:'production',sourceFormId:7,sourceName:'生产记录',expression:'sum(good) / sum(total)',format:'percent',description:'加权合格率',unit:'',threshold:'',dimensions:['status'],measures:['good','total']};
const entry={id:'company-yield',publishedVersion:3,published:definition,draft:{...definition,expression:'avg(good)'},revision:'r3'};
const board={datasets:[{id:'source',source:'7',sourceType:'businessForm',dimensions:['line'],measures:['good']}],metrics:[{id:'local',datasetId:'source',name:'原指标',expression:'count(*)'}],widgets:[{id:'trend',datasetId:'source',metricIds:['local'],dimension:'line'}],interactions:[{sourceWidgetId:'trend',targetWidgetId:'detail',action:'filter'}]};

test('replacing a local metric retains chart bindings and dataset identity while importing only the published definition',()=>{
 const before=JSON.stringify(board);
 const result=bindSharedMetricToBoard(board,entry,'local');
 assert.equal(result.metricId,'local');
 assert.deepEqual(plain(result.design.widgets),board.widgets);
 assert.deepEqual(plain(result.design.interactions),board.interactions);
 assert.equal(result.design.metrics[0].expression,definition.expression);
 assert.equal(result.design.metrics[0].sharedMetricId,entry.id);
 assert.equal(result.design.metrics[0].sharedMetricVersion,3);
 assert.deepEqual(plain(result.design.datasets[0].dimensions),['line','status']);
 assert.deepEqual(plain(result.design.datasets[0].measures),['good','total']);
 assert.equal(JSON.stringify(board),before);
});
test('different boards reference the same shared identity using their own dataset and metric aliases',()=>{
 const result=bindSharedMetricToBoard({},entry,'',{metricId:'alias-B',datasetId:'source-B'}).design;
 assert.equal(result.metrics[0].sharedMetricId,entry.id);
 assert.equal(result.metrics[0].id,'alias-B');
 assert.equal(result.metrics[0].datasetId,'source-B');
 assert.equal(result.datasets[0].source,'production');
 assert.deepEqual(plain(result.datasets[0].measures),definition.measures);
 const twice=bindSharedMetricToBoard(result,entry,'alias-B').design;
 assert.equal(twice.metrics.length,1);assert.equal(twice.datasets.length,1);
});
test('same field names from a different source cannot replace an existing metric; unpublished library drafts cannot bind',()=>{
 const wrong=plain(board);wrong.datasets[0].source='another-form';
 assert.throws(()=>bindSharedMetricToBoard(wrong,entry,'local'),/来源不同/);
 assert.throws(()=>bindSharedMetricToBoard(board,{...entry,published:null,publishedVersion:0}),/先发布/);
 assert.throws(()=>bindSharedMetricToBoard(board,entry,'deleted'),/不存在/);
});
test('detaching retains the exact snapshot definition and removes the shared identity without mutating the source',()=>{
 const bound=bindSharedMetricToBoard(board,entry,'local').design.metrics[0];
 const local=detachSharedMetric(bound);
 assert.equal(local.expression,definition.expression);assert.equal(local.id,'local');
 assert.equal('sharedMetricId' in local,false);assert.equal('sharedMetricVersion' in local,false);
 assert.equal(bound.sharedMetricVersion,3);
 assert.equal(sharedDefinitionKey(definition),sharedDefinitionKey({...definition,sourceName:'改名',measures:['ignored']}));
 assert.notEqual(sharedDefinitionKey(definition),sharedDefinitionKey({...definition,expression:'count(*)'}));
});
