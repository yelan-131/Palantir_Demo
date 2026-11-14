const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function draftHarness(unsaved = false) {
  const slots = [];
  let cursor = 0, changed = false, effects = [], store = {}, source = {name:'Original'}, token = 'v1', key = 'one';
  const dependenciesChanged = (a, b) => !a || b.some((value, index) => value !== a[index]);
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = {value:initial};
      return [slots[index].value, next => { slots[index].value = next; changed = true; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = {current:initial};
      return slots[index];
    },
    useCallback(callback, deps) {
      const index = cursor++;
      if (!slots[index] || dependenciesChanged(slots[index].deps, deps)) slots[index] = {value:callback, deps};
      return slots[index].value;
    },
    useEffect(callback, deps) {
      const index = cursor++;
      if (!slots[index] || dependenciesChanged(slots[index].deps, deps)) {
        slots[index] = {deps};
        effects.push(callback);
      }
    },
  };
  const form = {
    getFieldsValue: () => ({...store}),
    resetFields: () => {store = {};},
    setFieldsValue: values => {store = {...store, ...values};},
  };
  const context = {exports:{}, require:name => name === 'react' ? react : {Form:{useWatch:()=>({...store})}}};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/pages/SystemAdmin/useSettingsDraft.ts'),'utf8'),
    {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, context);
  const render = () => {
    let result;
    for (let iteration = 0; iteration < 10; iteration++) {
      cursor = 0; changed = false; effects = [];
      result = context.exports.default(form,key,source,token,unsaved);
      effects.forEach(effect => effect());
      if (!changed) return result;
    }
    throw new Error('Draft effect did not settle');
  };
  return {
    render,
    edit: values => form.setFieldsValue(values),
    incoming: (values, version, nextKey = key) => {source = values; token = version; key = nextKey;},
    values: () => store,
  };
}

test('local edits survive background refresh and retain the original concurrency token', () => {
  const h = draftHarness();
  assert.equal(h.render().dirty,false);
  h.edit({name:'Local edit'});
  assert.equal(h.render().dirty,true);
  h.incoming({name:'Remote edit'},'v2');
  const draft = h.render();
  assert.equal(h.values().name,'Local edit');
  assert.equal(draft.token(),'v1');
  draft.discard();
  assert.equal(h.render().dirty,false);
});

test('successful save becomes the new baseline and subsequent object selection loads cleanly', () => {
  const h = draftHarness();
  h.render();
  h.edit({name:'Saved'});
  h.render().accept('one',{name:'Saved'},'v2');
  h.incoming({name:'Saved'},'v2');
  assert.equal(h.render().dirty,false);
  assert.equal(h.render().token(),'v2');
  h.incoming({name:'Another object'},'v3','two');
  assert.equal(h.render().dirty,false);
  assert.equal(h.values().name,'Another object');
});

test('a change reverted to its original value does not prompt to discard', () => {
  const h = draftHarness();
  h.render();
  h.edit({name:'Temporary'});
  assert.equal(h.render().isDirty(),true);
  h.edit({name:'Original'});
  assert.equal(h.render().dirty,false);
});


test('a new unsaved object prompts even when its initial values were never edited', () => {
  const h = draftHarness(true);
  assert.equal(h.render().dirty,true);
  assert.equal(h.render().isDirty(),true);
  h.render().discard();
  assert.equal(h.render().isDirty(),false);
});

test('saving a newly created object clears the unsaved status', () => {
  const h = draftHarness(true);
  h.render().accept('saved',{name:'Saved'},'server-version');
  assert.equal(h.render().dirty,false);
});
