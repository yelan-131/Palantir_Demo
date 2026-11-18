const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../src/pages/FormSettings/index.tsx'), 'utf8');
const ast = ts.createSourceFile('index.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ['persistDesignerDraft', 'checkSelectionConfiguration', 'saveDraft', 'publishConfig'];
const declarations = [];
function visit(node) {
  if (ts.isVariableDeclaration(node) && names.includes(node.name.getText(ast))) declarations.push(`const ${node.getText(ast)};`);
  ts.forEachChild(node, visit);
}
visit(ast);
const script = ts.transpileModule(declarations.join('\n') + '\nthis.actions = {saveDraft, publishConfig};', { fileName: 'actions.tsx', compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
function harness(analysis = false) {
  const calls = [];
  const form = { id: 1, config: { initial: true } };
  const savedView = { ...form, config: { view: true } };
  const savedWorkflow = { ...form, config: { workflow: true } };
  const ctx = {
    lastSavedForm: { current: null },
    aiFormDraft: undefined, platformForm: form,
    flowLoadError: '', isPersistingFlow: false, isAnalysisDesigner: analysis,
    storedViewConfig: {}, analyticsDesign: {}, layoutControls: [], baseConfig: { fields: [] }, console: { error() {} },
    message: { error: value => calls.push(['error', value]), success: () => calls.push(['success']) },
    ensurePlatformForm: async () => { calls.push(['ensure']); return form; },
    syncFieldDefaultValues: async () => { calls.push(['fields']); },
    updateFormViewConfig: async () => { calls.push(['view']); return savedView; },
    getWorkflowDesignerMeta: received => ({ draftWorkflowId: received === savedWorkflow ? 9 : 8, publishedWorkflowId: 8 }),
    saveWorkflowDefinition: async (status, received, id) => { calls.push(['workflow', status, received, id]); return { id: 9 }; },
    updateFormWorkflowMeta: async () => { calls.push(['workflow-meta']); return savedWorkflow; },
    updateFormAnalyticsDesign: async received => { calls.push(['analytics', received]); return savedView; },
    setHasUnsavedChanges: value => { calls.push(['unsaved', value]); },
    setPersistingFlow: value => { ctx.isPersistingFlow = value; },
    publishPlatformForm: async (...args) => { calls.push(['publish', ...args]); return { data: { data: { version: 2 } } }; },
    getPlatformForm: async () => ({ data: { data: { ...savedWorkflow, status: 'published' } } }),
    setPlatformForm: value => calls.push(['form', value]),
    setWorkflowMeta: () => {},
    setVersion: value => calls.push(['version', value]),
    onPublished: undefined,
  };
  vm.createContext(ctx); vm.runInContext(script, ctx);
  return { ctx, calls, savedView };
}
test('publish saves the full draft and submits its workflow directly', async () => {
  const { ctx, calls, savedView } = harness();
  assert.equal(await ctx.actions.publishConfig(), true);
  assert.deepEqual(calls.map(call => call[0]), ['ensure', 'fields', 'view', 'workflow', 'workflow-meta', 'unsaved', 'publish', 'form', 'version', 'unsaved', 'success']);
  assert.deepEqual(calls.find(call => call[0] === 'publish'), ['publish', 1, 9]);
  const workflow = calls.find(call => call[0] === 'workflow');
  assert.equal(workflow[1], 'draft');
  assert.equal(workflow[2], savedView);
  assert.equal(workflow[3], undefined, 'editing a published workflow must create a separate draft');
  assert.equal(ctx.isPersistingFlow, false);
  assert.equal(ctx.lastSavedForm.current.config.workflow, true);
});
test('analytics save uses the updated form so saving charts cannot overwrite saved form layout', async () => {
  const { ctx, calls, savedView } = harness(true);
  assert.equal(await ctx.actions.saveDraft(), true);
  assert.equal(calls.find(call => call[0] === 'analytics')[1], savedView);
});
test('a failed draft write preserves unsaved state and skips publication', async () => {
  const { ctx, calls } = harness();
  ctx.saveWorkflowDefinition = async () => { throw Error('offline'); };
  assert.equal(await ctx.actions.publishConfig(), false);
  assert.equal(calls.some(call => ['unsaved', 'publish'].includes(call[0])), false);
  assert.equal(ctx.isPersistingFlow, false);
});
test('a rejected publish retains the saved draft and reports the field that blocked it', async () => {
  const { ctx, calls } = harness();
  ctx.publishPlatformForm = async () => { throw { response: { data: { detail: { report: {
    items: [{ level: 'blocking', label: '组织', detail: '已有记录缺值' }],
  } } } } }; };
  assert.equal(await ctx.actions.publishConfig(), false);
  assert.ok(calls.some(call => call[0] === 'unsaved' && call[1] === false));
  assert.deepEqual(calls.at(-1), ['error', '发布失败，「组织」：已有记录缺值']);
  assert.equal(calls.some(call => call[0] === 'success'), false);
  assert.equal(ctx.isPersistingFlow, false);
});
test('an ongoing save prevents a second publish request', async () => {
  const { ctx, calls } = harness(); ctx.isPersistingFlow = true;
  assert.equal(await ctx.actions.publishConfig(), false);
  assert.equal(calls.length, 0);
});

test('analytics publish saves and publishes without a workflow', async () => {
  const { ctx, calls, savedView } = harness(true);
  assert.equal(await ctx.actions.publishConfig(), true);
  assert.equal(calls.find(call => call[0] === 'analytics')[1], savedView);
  assert.deepEqual(calls.find(call => call[0] === 'publish'), ['publish', 1, undefined]);
});

test('invalid selection configuration blocks draft saving and publication before writes', async () => {
  for (const action of ['saveDraft', 'publishConfig']) {
    const { ctx, calls } = harness();
    Object.assign(ctx, {
      React: require('react'),
      layoutControls: [{ fieldKey: 'status', name: '状态', dataSourceKind: 'static' }],
      getEffectiveControlTypeForControl: () => 'select',
      parseStaticOptions: () => [], staticOptionErrors: () => ['请配置选项'],
      selectionConfigErrors: () => [], getFieldDefaultValue: () => '',
      Modal: { error: () => calls.push(['validation']) },
    });
    assert.equal(await ctx.actions[action](), false);
    assert.deepEqual(calls.map(call => call[0]), ['validation']);
  }
});
