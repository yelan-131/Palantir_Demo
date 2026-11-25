const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const context = {exports:{}};
const sourcePath = require.resolve('../src/pages/DynamicPage/recordCopyValues.ts');
vm.runInNewContext(ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: {module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022},
}).outputText, context);
const {recordCopyValues} = context.exports;

test('copy prefills only eligible values from the source record into the create schema', () => {
  const data = {
    name:'测试物料', quantity:0, enabled:false, note:null, tags:['test'],
    masked:'••••••', hidden:'隐藏', redacted:'限制脱敏复制', blocked:'禁止复制',
    readonly:'只读', unknown:'缺少策略', code:'自动编码', serial:'唯一编号', attachment:[{id:'file'}],
    id:123,
  };
  const normal = {copyMode:'normal'};
  const fieldStates = {
    name:normal, quantity:normal, enabled:normal, note:normal, tags:normal, id:normal,
    masked:{...normal, masked:true}, hidden:{...normal, visible:false}, redacted:{copyMode:'maskedCopy'},
    blocked:{copyMode:'disabled'}, readonly:{...normal, readonly:true},
    code:normal, serial:normal, attachment:normal, absent:normal,
  };
  const fields = [...Object.keys(data).filter(key=>key!=='id'), 'absent'].map(field_name=>({
    field_name, skipOnCopy:['code','serial','attachment'].includes(field_name),
  }));
  assert.deepEqual({...recordCopyValues({data, field_states:fieldStates}, fields)}, {
    name:'测试物料', quantity:0, enabled:false, note:null, tags:['test'],
  });
});
