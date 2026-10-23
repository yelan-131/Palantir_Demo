const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const vm = require('node:vm');
const context = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname, '../src/pages/FormSettings/previewPermissions.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
const { previewFieldPermission, previewFlowNodes } = context.exports;
const field = (overrides = {}) => ({ visible: true, editable: true, required: false, ...overrides });

test('trial nodes come only from an associated workflow, with no daily or template fallback', () => {
  const nodes = [{ type: 'startEvent', executable: false }, { type: 'userTask', executable: true }, { type: 'exclusiveGateway', executable: false }, { type: 'endEvent', executable: false }];
  assert.equal(previewFlowNodes(nodes, false).length, 0);
  assert.deepEqual(Array.from(previewFlowNodes(nodes, true)), [nodes[0], nodes[1], nodes[3]]);
  assert.equal(previewFlowNodes([], true).length, 0);
});

test('role selection cannot restore fields hidden or locked by the selected node', () => {
  assert.equal(previewFieldPermission(field({visible:false}), field()).visible, false);
  assert.equal(previewFieldPermission(field(), field({visible:false})).visible, false);
  assert.equal(previewFieldPermission(field({editable:false}), field()).editable, false);
  assert.equal(previewFieldPermission(field(), field({editable:false})).editable, false);
});

test('role and node requirements combine while page and action restrictions still apply', () => {
  assert.equal(previewFieldPermission(field(), field({required:true})).required, true);
  assert.equal(previewFieldPermission(field({required:true}), field()).required, true);
  const denied = previewFieldPermission(field({required:true}), field(), false);
  assert.equal(denied.visible, false);
  assert.equal(denied.editable, false);
  assert.equal(denied.required, false);
  assert.equal(previewFieldPermission(undefined, field(), true, false).editable, false);
});
