const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const context = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname, '../src/utils/formCalculations.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
const { calculationSources } = context.exports;
const { buildFormula, readFormulaBuilder } = context.exports;
const fields = ['quantity','price','total','taxed','ROUND'].map(key => ({ key }));
const keys = result => Array.from(result, field => field.key);
test('trial inputs resolve to editable leaf fields across calculation chains', () => {
  const rules = { total: { expression: 'quantity * price' } };
  assert.deepEqual(keys(calculationSources('ROUND(total * 1.13, 2)', fields, rules)), ['quantity','price']);
  assert.deepEqual(keys(calculationSources('"price" + quantity', fields)), ['quantity']);
  assert.deepEqual(keys(calculationSources('ROUND + 1', fields)), ['ROUND']);
});
test('cyclic and missing references do not hang the trial input builder', () => {
  const rules = { total: { expression: 'taxed + price' }, taxed: { expression: 'total + 1' } };
  assert.deepEqual(keys(calculationSources('total', fields, rules)), ['price']);
  assert.deepEqual(keys(calculationSources('missing + quantity', fields)), ['quantity']);
});

test('visual arithmetic handles constants, operator precedence and incomplete rows', () => {
  const builder={mode:'number',items:[{kind:'field',value:'quantity'},{kind:'field',value:'price'},{kind:'value',value:'0.9'}],operators:['*','*']};
  const formula=buildFormula(builder,true,['quantity','price']);
  assert.equal(formula,'quantity * price * 0.9');
  assert.equal(buildFormula(readFormulaBuilder(formula,true),true,['quantity','price']),formula);
  assert.equal(buildFormula(readFormulaBuilder('quantity * -2 + 1e-3',true),true,[]),'quantity * -2 + 1e-3');
  assert.equal(buildFormula({...builder,items:[{kind:'field',value:''}]},true,[]),'');
  assert.equal(buildFormula({...builder,items:[{kind:'value',value:'1 / 0'}],operators:[]},true,[]),'');
});
test('text builder forces concatenation for numeric fields and safely quotes literal text', () => {
  const formula=buildFormula({mode:'text',items:[{kind:'field',value:'quantity'},{kind:'value',value:'件 "现货"\n'},{kind:'field',value:'price'}]},false,[]);
  assert.ok(formula.startsWith('"" + quantity + '));
  assert.equal(buildFormula(readFormulaBuilder(formula,false),false,[]),formula);
  assert.equal(readFormulaBuilder("name + '-' + batch",false).mode,'text');
  assert.equal(readFormulaBuilder('quantity + price + "-"',false),null);
  assert.equal(readFormulaBuilder('"a" +',false),null);
});
test('conditional builder round trips numeric and text branches, including commas inside text', () => {
  for(const [numericResult,builder,numericFields] of [
    [true,{mode:'condition',source:'quantity',operator:'>=',expected:'10',yes:{kind:'field',value:'price'},no:{kind:'value',value:'0'}},['quantity','price']],
    [false,{mode:'condition',source:'category',operator:'==',expected:'RAW',yes:{kind:'value',value:'原料,待检'},no:{kind:'field',value:'name'}},[]],
  ]){
    const formula=buildFormula(builder,numericResult,numericFields);
    assert.equal(buildFormula(readFormulaBuilder(formula,numericResult,numericFields),numericResult,numericFields),formula);
  }
});
test('advanced formulas remain advanced instead of being silently simplified', () => {
  for(const expression of ['ROUND(quantity * price, 2)','(quantity + price) * 2','IF(quantity > 1, price * 2, price)','-quantity','price ** 2'])assert.equal(readFormulaBuilder(expression,true,['quantity','price']),null);
});
