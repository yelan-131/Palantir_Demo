const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');

const modules = new Map();
for (const name of ['relationshipLayout', 'relationshipSimilarity']) {
  const source = readFileSync(join(__dirname, '../src/pages/DataCenterWorkspace', `${name}.ts`), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const loaded = {};
  new Function('exports', 'require', outputText)(loaded, specifier => modules.get(specifier));
  modules.set(`./${name}`, loaded);
}

const { relationshipPositions } = modules.get('./relationshipLayout');
const { compareRelationshipNodes, layoutRelationshipSimilarity } = modules.get('./relationshipSimilarity');

const workOrderFeatures = [
  { code: 'line', kind: 'category' },
  { code: 'operation', kind: 'category' },
  { code: 'planned', kind: 'number', tolerance: 100, weight: 2 },
];

function workOrder(id, planned) {
  return { id, features: workOrderFeatures, values: { line: 'L-01', operation: '成型', planned } };
}

function distance(map, first, second) {
  const a = map.get(first);
  const b = map.get(second);
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

test('changing a comparable value changes the pair distance while IDs stay the same', () => {
  const work = workOrder('WO-260521-017', 800);
  const near = workOrder('comparison', 780);
  const far = workOrder('comparison', 3000);
  const seeds = relationshipPositions([work.id, near.id]);
  const compareNear = compareRelationshipNodes(work, near);
  const compareFar = compareRelationshipNodes(work, far);
  assert.equal(compareNear.coverage, 1);
  assert.ok(compareNear.similarity > compareFar.similarity);

  const closePositions = layoutRelationshipSimilarity([work, near], seeds);
  const fartherPositions = layoutRelationshipSimilarity([work, far], seeds, closePositions);
  assert.ok(distance(fartherPositions, work.id, near.id) > distance(closePositions, work.id, near.id) + 0.25);
  assert.deepEqual(layoutRelationshipSimilarity([near, work], seeds), closePositions);
});

test('mapped dimensions normalize units and keep typed raw values for comparison evidence', () => {
  const source = { id: 'source', features: [
    { code: 'mass_t', dimension: 'mass_kg', kind: 'number', scale: 1000 },
    { code: 'temp_f', dimension: 'temp_c', kind: 'number', scale: 5 / 9, offset: -160 / 9, tolerance: 1 },
  ], values: { mass_t: 0.8, temp_f: 212 } };
  const target = { id: 'target', features: [
    { code: 'mass_kg', kind: 'number' },
    { code: 'temp_c', kind: 'number' },
  ], values: { mass_kg: 800, temp_c: 100 } };
  const comparison = compareRelationshipNodes(source, target);
  assert.ok(comparison.similarity > 0.9999);
  assert.deepEqual(comparison.features[0], {
    dimension: 'mass_kg', sourceCode: 'mass_t', targetCode: 'mass_kg', sourceValue: 0.8, targetValue: 800, similarity: 1,
  });
  assert.equal(compareRelationshipNodes(target, source).similarity, comparison.similarity);
  assert.equal(compareRelationshipNodes(source, { ...target, values: { mass_kg: Infinity, temp_c: '100' } }), undefined);
  assert.equal(compareRelationshipNodes(source, { ...target, features: [{ code: 'mass_kg', kind: 'number', offset: Infinity }] }), undefined);
});

test('categories preserve types and absent values reduce comparison coverage', () => {
  const left = { id: 'a', features: [
    { code: 'state', kind: 'category' },
    { code: 'enabled', kind: 'category' },
    { code: 'quantity', kind: 'number' },
  ], values: { state: '1', enabled: false, quantity: 10 } };
  const right = { ...left, id: 'b', values: { state: 1, enabled: false, quantity: '' } };
  const comparison = compareRelationshipNodes(left, right);
  assert.equal(comparison.similarity, 0.5);
  assert.equal(comparison.coverage, 2 / 3);
  assert.deepEqual(comparison.features.map(feature => feature.sourceCode), ['state', 'enabled']);
});

test('unconfigured or incomparable objects retain their position outside collisions', () => {
  const a = workOrder('a', null);
  const b = { id: 'b', features: [], values: { planned: 800 } };
  const seeds = new Map([['a', { x: -1, y: 0, z: 0 }], ['b', { x: 1, y: 0, z: 0 }]]);
  assert.equal(compareRelationshipNodes(a, b), undefined);
  assert.deepEqual(layoutRelationshipSimilarity([a, b], seeds), seeds);

  const overlapping = new Map([['a', { x: 0, y: 0, z: 0 }], ['b', { x: 0, y: 0, z: 0 }]]);
  const spaced = layoutRelationshipSimilarity([a, b], overlapping);
  assert.ok(distance(spaced, 'a', 'b') > 0.2);
  for (const { x, y, z } of spaced.values()) assert.ok(Math.hypot(x, y, z) <= 1.5);
});

test('new records start near an established similar neighbor and leave unrelated points stable', () => {
  const original = workOrder('a', 800);
  const newRecord = workOrder('b', 780);
  const unrelated = { id: 'c', features: [], values: {} };
  const previous = new Map([['a', { x: 0.8, y: 0, z: 0 }], ['c', { x: 0, y: -1.2, z: 0 }]]);
  const seeds = new Map([['b', { x: -1.5, y: 0, z: 0 }]]);
  const layout = layoutRelationshipSimilarity([original, newRecord, unrelated], seeds, previous);
  assert.ok(distance(layout, 'a', 'b') < 0.65);
  assert.deepEqual(layout.get('c'), previous.get('c'));
  assert.ok(Math.abs(layout.get('a').x - 0.8) <= 0.48);
});
