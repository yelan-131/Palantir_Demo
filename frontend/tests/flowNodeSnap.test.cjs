const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const exportsObject = {};
const source = fs.readFileSync(path.join(__dirname, '../src/pages/FormSettings/flowNodeSnap.ts'), 'utf8');
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: exportsObject });
const { FLOW_NODE_GRID, snapFlowAxis, snapFlowNode } = exportsObject;
const bounds = { min: { x: 32, y: 82 }, max: { x: 515, y: 435 } };

test('nearby nodes take precedence over the grid independently for both axes', () => {
  const column = { x: 195, y: 320 };
  const row = { x: 408, y: 200 };
  const result = snapFlowNode({ x: 199, y: 194 }, bounds, [column, row]);

  assert.equal(result.point.x, 195);
  assert.equal(result.point.y, 200);
  assert.equal(result.alignX, column);
  assert.equal(result.alignY, row);
});

test('grid fallback stays on visible grid lines within the bounds', () => {
  const result = snapFlowNode({ x: 514, y: 130 }, bounds, [{ x: 516, y: 230 }]);

  assert.equal(result.point.x, 512);
  assert.equal(result.point.y, 130);
  assert.equal((result.point.x - FLOW_NODE_GRID.x) % FLOW_NODE_GRID.step, 0);
  assert.equal(result.alignX, undefined);
  assert.equal(result.alignY, undefined);
});

test('alignment distance is measured in screen pixels and ties prefer the closer neighbor', () => {
  const far = { x: 205, y: 400 };
  const near = { x: 205, y: 216 };
  const position = { x: 192, y: 179 };

  assert.equal(snapFlowNode(position, bounds, [far, near]).alignX, undefined);
  assert.equal(snapFlowNode(position, bounds, [far, near], { x: 0.75, y: 0.75 }).alignX, near);
});

test('a line segment uses the same grid but can align with an off-grid parallel segment', () => {
  const parallel = { x: 260, y: 219 };
  const position = { x: 105, y: 216 };
  const aligned = snapFlowAxis('y', position, bounds, [parallel], 1);
  assert.equal(aligned.value, 219);
  assert.equal(aligned.target, parallel);

  const grid = snapFlowAxis('y', { ...position, y: 254 }, bounds, [parallel], 1);
  assert.equal(grid.value, 250);
  assert.equal(grid.target, undefined);
});
