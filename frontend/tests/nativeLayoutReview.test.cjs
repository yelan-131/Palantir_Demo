const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const ts = require('typescript');

const source = readFileSync(join(__dirname, '../src/components/AiChatWidget/NativeDesignerReview.tsx'), 'utf8');
const script = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function harness() {
  const actions = [];
  const states = [];
  const lock = { current: false };
  let hook = 0;
  let finishSave;
  const designerContext = { form_id: 7, form_name: '物料', layout_review_id: 'review-1' };
  const imports = {
    react: {
      useRef: () => lock,
      useState: initial => {
        const index = hook++;
        return [states[index] ?? initial, value => { states[index] = value; }];
      },
    },
    'react/jsx-runtime': require('react/jsx-runtime'),
    antd: { Alert: 'alert', Button: 'button', Space: 'div', Tag: 'span' },
    '@ant-design/icons': { CheckCircleOutlined: 'i' },
    '@/utils/uuid': {},
    './context': { useAiWorkbench: () => ({
      designerContext,
      getPageController: formId => {
        assert.equal(formId, 7);
        return action => {
          actions.push({ ...action });
          return new Promise(resolve => { finishSave = resolve; });
        };
      },
    }) },
  };
  const exports = {};
  runInNewContext(script, { exports, require: name => imports[name] });
  return {
    actions, designerContext,
    finish: result => finishSave(result),
    render: () => {
      hook = 0;
      return exports.NativeLayoutReview({ reviewId: 'review-1', formId: 7, operationCount: 2, disabled: false });
    },
  };
}

test('a matching review saves only when clicked and waits for the save receipt', async () => {
  const { render, actions, finish } = harness();
  const card = render();
  const footer = card.props.children.find(child => child?.type === 'footer');
  const button = footer.props.children;
  assert.equal(button.props.children, '确认保存草稿');
  assert.equal(actions.length, 0);
  button.props.onClick();
  button.props.onClick();
  assert.deepEqual(actions, [{ id: 'review-1', type: 'form_designer', form_id: 7, action: 'confirm_layout_draft' }]);
  assert.equal(render().props['aria-label'], '保存表单布局草稿');
  finish({ form_id: 7, saved: true, published: false });
  await new Promise(setImmediate);
  const receipt = render();
  assert.equal(receipt.type, 'details');
  assert.equal(receipt.props.open, undefined);
  assert.equal(receipt.props.children[0].props.children.props.children, '表单草稿已保存');
});

test('a review is hidden when the designer moves on to a different draft', () => {
  const { render, actions, designerContext } = harness();
  designerContext.layout_review_id = 'review-2';
  assert.equal(render(), null);
  assert.equal(actions.length, 0);
});
