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
    flowLoadError: '', isPersistingFlow: false, isAnalysisDesigner: analysis,
    storedViewConfig: {}, analyticsDesign: {}, layoutControls: [], baseConfig: { fields: [] }, console: { error() {} },
    message: { error: value => calls.push(['error', value]), success: () => calls.push(['success']) },
    ensurePlatformForm: async () => { calls.push(['ensure']); return form; },
    syncFieldDefaultValues: async () => { calls.push(['fields']); },
    updateFormViewConfig: async () => { calls.push(['view']); return savedView; },
    getWorkflowDesignerMeta: () => ({ draftWorkflowId: 8, publishedWorkflowId: 8 }),
    saveWorkflowDefinition: async (status, received, id) => { calls.push(['workflow', status, received, id]); return { id: 9 }; },
    updateFormWorkflowMeta: async () => { calls.push(['workflow-meta']); return savedWorkflow; },
    updateFormAnalyticsDesign: async received => { calls.push(['analytics', received]); return savedView; },
    setHasUnsavedChanges: value => { calls.push(['unsaved', value]); },
    setPersistingFlow: value => { ctx.isPersistingFlow = value; },
    previewPlatformFormPublish: async () => { calls.push(['preview']); return { data: { data: { blocking_count: 0 } } }; },
    setServerPublishReport: () => calls.push(['report']),
    setPublishCheckOpen: value => calls.push(['confirmation', value]),
  };
  vm.createContext(ctx); vm.runInContext(script, ctx);
  return { ctx, calls, savedView };
}
test('prepare release saves the full draft before checking, and never publishes directly', async () => {
  const { ctx, calls, savedView } = harness();
  assert.equal(await ctx.actions.publishConfig(), true);
  assert.deepEqual(calls.map(call => call[0]), ['ensure', 'fields', 'view', 'workflow', 'workflow-meta', 'unsaved', 'preview', 'report', 'confirmation']);
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
test('a failed draft write preserves unsaved state and does not open publish confirmation', async () => {
  const { ctx, calls } = harness();
  ctx.saveWorkflowDefinition = async () => { throw Error('offline'); };
  assert.equal(await ctx.actions.publishConfig(), false);
  assert.equal(calls.some(call => ['unsaved', 'preview', 'confirmation'].includes(call[0])), false);
  assert.equal(ctx.isPersistingFlow, false);
});
test('failed publish check retains a saved draft and returns failure to keep the workbench open', async () => {
  const { ctx, calls } = harness();
  ctx.previewPlatformFormPublish = async () => { throw Error('offline'); };
  assert.equal(await ctx.actions.publishConfig(), false);
  assert.ok(calls.some(call => call[0] === 'unsaved' && call[1] === false));
  assert.equal(calls.some(call => call[0] === 'confirmation'), false);
  assert.equal(ctx.isPersistingFlow, false);
});
test('an ongoing save prevents a second prepare-release request', async () => {
  const { ctx, calls } = harness(); ctx.isPersistingFlow = true;
  assert.equal(await ctx.actions.publishConfig(), false);
  assert.equal(calls.length, 0);
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
