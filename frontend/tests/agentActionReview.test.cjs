const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/components/AiChatWidget/index.tsx'), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ['mapServerMessage', 'mapAgentActions', 'getConfirmationItemPayload', 'getConfirmationActions',
  'normalizeAgentItems', 'formatActionValue', 'asRecord', 'asRecordArray', 'getLowCodeReview', 'getExecutionResult'];
const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text))
  .map(node => node.getText(ast)).join('\n');
const context = { mapAgentSteps: () => [], mapTraceFromItems: () => [], formatServerTime: () => '', getContextSources: () => ({}) };
vm.createContext(context);
vm.runInContext(ts.transpileModule(functions, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);

function message(run_status) {
  return { role: 'assistant', run_status, requires_confirmation: false, items: [{ type: 'confirmation', payload: {
    confirmation_token: 'previously-consumed-token', actions: [{ skill: 'forms.create_form_definition', requires_confirmation: true,
      payload: { form: { name: '来料检验单', code: 'incoming_inspection' }, fields: [
        { field_name: 'inspection_result', label: '检验结论', field_type: 'enum', required: true, enum_values: ['合格', '不合格', '待复检'] },
      ] } }],
  } }] };
}

test('reopening a completed run never reactivates its consumed confirmation token', () => {
  const restored = context.mapServerMessage(message('completed'));
  assert.equal(restored.requiresConfirmation, false);
  assert.equal(restored.confirmationPayload, undefined);
  assert.equal(restored.actions[0].status, 'completed');
  assert.equal(restored.actions[0].nextSteps.length, 0);
});

test('cancelled runs stay closed while an active proposal still permits confirmation', () => {
  assert.equal(context.mapServerMessage(message('cancelled')).actions, undefined);
  assert.equal(context.mapServerMessage(message('waiting_confirmation')).requiresConfirmation, true);
});

test('a failed confirmation stays failed after reopening and cannot be resubmitted', () => {
  const restored = context.mapServerMessage(message('failed'));
  assert.equal(restored.requiresConfirmation, false);
  assert.equal(restored.confirmationPayload, undefined);
  assert.equal(restored.actions[0].status, 'failed');
  assert.equal(restored.actions[0].nextSteps.length, 0);
});

test('DSH form actions use structured review with required fields and enum choices', () => {
  const action = message('waiting_confirmation').items[0].payload.actions[0];
  const review = context.getLowCodeReview(action);
  assert.equal(review.formName, '来料检验单');
  assert.equal(review.fields[0].required, true);
  assert.equal(review.fields[0].options, '合格 / 不合格 / 待复检');
});

test('record updates open the original record and report an update', () => {
  const result = context.getExecutionResult({ operation: 'update', form_code: 'inbound', record_id: 2 });
  assert.equal(result.title, '记录已更新');
  assert.equal(result.href, '/dynamic/inbound?recordId=2');
});
