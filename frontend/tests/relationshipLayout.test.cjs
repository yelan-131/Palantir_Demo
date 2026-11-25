const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const ts = require('typescript');

const source = readFileSync(join(__dirname, '../src/pages/DataCenterWorkspace/relationshipLayout.ts'), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const { relationshipPositions, projectRelationshipPoint } = runInNewContext('(function () { const exports = {};\n' + outputText + '\nreturn exports; })()');

test('the same object keeps its world position across scopes and list order', () => {
  const material = JSON.stringify([1, 'DEMO-MAT-A']);
  const process = JSON.stringify([2, '工艺版本 A']);
  const product = JSON.stringify([3, 'DEMO-PROD-01']);
  const initial = relationshipPositions([material, process]);
  const expanded = relationshipPositions([product, process, material, material]);
  const filtered = relationshipPositions([material]);

  assert.equal(expanded.size, 3);
  assert.deepEqual(initial.get(material), expanded.get(material));
  assert.deepEqual(initial.get(process), expanded.get(process));
  assert.deepEqual(initial.get(material), filtered.get(material));
});

test('different object IDs disperse through a finite three-dimensional volume', () => {
  const ids = Array.from({ length: 96 }, (_, index) => JSON.stringify([1, `WO-${index}`]));
  const points = [...relationshipPositions(ids).values()];

  assert.equal(new Set(points.map(({ x, y, z }) => `${x},${y},${z}`)).size, ids.length);
  for (const { x, y, z } of points) assert.ok(Math.hypot(x, y, z) <= 1.500001);
  for (const axis of ['x', 'y', 'z']) {
    assert.ok(points.some(point => point[axis] < -0.75));
    assert.ok(points.some(point => point[axis] > 0.75));
  }
});

test('perspective changes apparent scale with depth', () => {
  const camera = { yaw: 0, pitch: 0, zoom: 1, offsetX: 0, offsetY: 0 };
  const viewport = { width: 800, height: 600 };
  const near = projectRelationshipPoint({ x: 1, y: 0, z: 1 }, camera, viewport);
  const far = projectRelationshipPoint({ x: 1, y: 0, z: -1 }, camera, viewport);

  assert.ok(near.x > far.x);
  assert.ok(near.scale > far.scale);
  assert.equal(near.y, far.y);
});
