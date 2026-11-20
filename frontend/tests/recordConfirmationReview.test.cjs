const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

test('record review uses scoped typed controls and returns validated edits with human labels', () => {
  const review = {
    form_id: 14, form_code: 'work_order', form_name: '工单', record_id: 27,
    context_data: { department: 'maintenance' },
    fields: [
      { name: 'quantity', label: '数量', kind: 'number', value: 3, required: true, min: 1, max: 5, precision: 0, unit: '件' },
      { name: 'status', label: '状态', kind: 'select', value: '1', options: [{ value: 1, label: '待派工' }, { value: 2, label: '处理中' }] },
      { name: 'assignee', label: '处理人', kind: 'relation', value: 31, required: true },
      { name: 'protected', label: '保护字段', kind: 'readonly', value: null, readonly: true, display_value: '受权限保护' },
    ],
  };
  const source = fs.readFileSync(path.join(__dirname, '../src/components/AiChatWidget/RecordConfirmationReview.tsx'), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
  } });
  const renderedFields = new Map();
  const widget = (key, props) => {
    renderedFields.set(key, props);
    return React.createElement('input', { id: props.id, 'aria-required': props['aria-required'] });
  };
  const module = { exports: {} };
  vm.runInNewContext(outputText, { exports: module.exports, require(name) {
    if (name === 'react') return { ...React, useState: initial => React.useState(initial === undefined ? review : initial) };
    if (name === 'antd') return { Input: props => widget(props['aria-label'], props) };
    if (name === 'axios') return {};
    if (name === '@/components/FormWidgets/FieldControl') return props => widget(props.label, props);
    if (name === '@/components/FormWidgets/RelationPicker') return props => widget(props.fieldName, props);
    if (name === '@/services/api') return {};
    return require(name);
  } });
  const edits = [];
  const props = { runId: 'review-test', token: 'isolated-test-token', actionIndex: 0, changes: {},
    onChange: (...edit) => edits.push(edit), onReview: () => {} };
  const render = nextProps => renderToStaticMarkup(React.createElement(module.exports.default, nextProps));
  const markup = render(props);
  assert.match(markup, /<label[^>]*for="[^"]+">数量/);
  assert.match(markup, /<output[^>]*>受权限保护/);
  assert.equal(renderedFields.has('保护字段'), false);
  assert.equal(renderedFields.get('状态').type, 'select');
  assert.equal(renderedFields.get('状态').value, 1);
  assert.equal(renderedFields.get('数量').inputMode, 'decimal');
  assert.equal(renderedFields.get('数量').suffix, '件');
  const relation = renderedFields.get('assignee');
  assert.equal(relation.formId, 14);
  assert.equal(relation.contextData.department, 'maintenance');
  assert.equal(relation.contextData.protected, null);

  relation.onChange(32, '验收维修员');
  assert.equal(edits.at(-1)[0].assignee, 32);
  assert.equal(edits.at(-1)[1], true);
  assert.equal(edits.at(-1)[2].assignee, '验收维修员');
  renderedFields.get('状态').onChange(2);
  assert.equal(edits.at(-1)[2].status, '处理中');
  renderedFields.get('状态').onChange(1);
  assert.equal(Object.hasOwn(edits.at(-1)[0], 'status'), false);
  const enterQuantity = value => renderedFields.get('数量').onChange({ target: { value } });
  enterQuantity('0');
  assert.equal(edits.at(-1)[0].quantity, '0');
  assert.equal(edits.at(-1)[1], false);
  assert.match(render({ ...props, changes: edits.at(-1)[0] }), /不得小于 1/);
  assert.equal(renderedFields.get('数量').value, '0');
  enterQuantity('8');
  assert.equal(edits.at(-1)[0].quantity, '8');
  assert.equal(edits.at(-1)[1], false);
  assert.match(render({ ...props, changes: edits.at(-1)[0] }), /不得超过 5/);
  enterQuantity('3.');
  assert.equal(edits.at(-1)[0].quantity, '3.');
  assert.equal(edits.at(-1)[1], false);
  assert.match(render({ ...props, changes: edits.at(-1)[0] }), /请输入有效的数值/);
  assert.equal(renderedFields.get('数量').value, '3.');
  enterQuantity('4');
  assert.equal(edits.at(-1)[0].quantity, '4');
  assert.equal(edits.at(-1)[1], true);
  enterQuantity('3.0');
  assert.equal(Object.hasOwn(edits.at(-1)[0], 'quantity'), false);
  assert.equal(edits.at(-1)[1], true);
});
