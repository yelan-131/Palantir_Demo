const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/pages/SystemAdmin/assemblyOrdering.ts'), 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const context = { exports: {} };
vm.runInNewContext(code, context);
const { menuRowDrop, moveAppOrder, moveMenuNode } = context.exports;
const keys = nodes => Array.from(nodes, node => node.key);
const canContain = node => node.group === true;

test('application order supports insertion before the first and after the last item', () => {
  const order = [1, 2, 3];
  assert.deepEqual(Array.from(moveAppOrder(order, 2, 1, false)), [2, 1, 3]);
  assert.deepEqual(Array.from(moveAppOrder(order, 2, 3, true)), [1, 3, 2]);
  assert.equal(moveAppOrder(order, 1, 2, false), order);
});

test('menu gaps use the target sibling index instead of the sign of the absolute drop position', () => {
  const nodes = [{ key: 'group', group: true, children: ['a', 'b', 'c', 'd'].map(key => ({ key })) }];
  const before = menuRowDrop('d', 'c', 1, '0-0-2', true);
  assert.deepEqual(keys(moveMenuNode(nodes, before, canContain)[0].children), ['a', 'b', 'd', 'c']);
  const after = menuRowDrop('a', 'd', 4, '0-0-3', true);
  assert.deepEqual(keys(moveMenuNode(nodes, after, canContain)[0].children), ['b', 'c', 'd', 'a']);
});

test('menu boundaries can move nodes to either end of the root or back into a group', () => {
  const nodes = [{ key: 'group', group: true, children: [{ key: 'child' }] }, { key: 'leaf' }];
  const first = moveMenuNode(nodes, { source: 'child', placement: 'first' }, canContain);
  assert.deepEqual(keys(first), ['child', 'group', 'leaf']);
  const last = moveMenuNode(first, { source: 'child', placement: 'last' }, canContain);
  assert.deepEqual(keys(last), ['group', 'leaf', 'child']);
  const nested = moveMenuNode(last, { source: 'child', target: 'group', placement: 'inside' }, canContain);
  assert.deepEqual(keys(nested), ['group', 'leaf']);
  assert.deepEqual(keys(nested[0].children), ['child']);
  assert.equal(moveMenuNode(nodes, { source: 'group', target: 'child', placement: 'after' }, canContain), nodes);
  assert.equal(moveMenuNode(nodes, { source: 'child', target: 'leaf', placement: 'inside' }, canContain), nodes);
});
