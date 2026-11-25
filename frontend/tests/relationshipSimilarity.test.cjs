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
  assert.ok(distance(fartherPositions, work.id, near.id) > 1.25 * distance(closePositions, work.id, near.id));
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

test('automatic comparisons pull workshops with similar text and numeric values closer', () => {
  const features = [
    { code: 'name', kind: 'text', automatic: true },
    { code: 'area', kind: 'text', automatic: true },
    { code: 'shift_count', kind: 'number', automatic: true },
  ];
  const workshop = (id, name, area, shift_count) => ({ id, features, values: { name, area, shift_count } });
  const source = workshop('DEMO-SHOP-01', '精密制造车间', '华东示范工厂 A 区', 2);
  const near = workshop('near', '精密制造二车间', '华东示范工厂 B 区', 3);
  const far = workshop('far', '重型焊接车间', '华南生产基地', 8);
  const closeComparison = compareRelationshipNodes(source, near);
  const distantComparison = compareRelationshipNodes(source, far);
  assert.equal(closeComparison.coverage, 1);
  assert.ok(closeComparison.similarity > distantComparison.similarity);
  assert.ok(closeComparison.features.find(feature => feature.sourceCode === 'name').similarity > 0.5);
  assert.ok(Math.abs(closeComparison.features.find(feature => feature.sourceCode === 'shift_count').similarity - 2 / 3) < 1e-9);
  assert.equal(closeComparison.similarity, compareRelationshipNodes(near, source).similarity);

  const seeds = new Map([
    [source.id, { x: 0, y: 0, z: 0 }],
    [near.id, { x: 1.3, y: 0, z: 0 }],
    [far.id, { x: -1.3, y: 0, z: 0 }],
  ]);
  const result = layoutRelationshipSimilarity([source, near, far], seeds);
  assert.ok(distance(result, source.id, near.id) < distance(seeds, source.id, near.id));
  assert.ok(distance(result, source.id, near.id) < distance(result, source.id, far.id));
});

test('high-similarity records can move beyond their old anchors to become neighbors', () => {
  const features = [{ code: 'planned_qty', kind: 'number', tolerance: 100 }];
  const first = { id: 'DEMO-WO-04', features, values: { planned_qty: 160 } };
  const second = { id: 'DEMO-WO-02', features, values: { planned_qty: 180 } };
  const unrelated = { id: 'other', features: [], values: {} };
  const previous = new Map([
    [first.id, { x: -1.4, y: 0, z: 0 }],
    [second.id, { x: 1.4, y: 0, z: 0 }],
    [unrelated.id, { x: 0, y: 1.4, z: 0 }],
  ]);
  const layout = layoutRelationshipSimilarity([first, second, unrelated], previous, previous);
  assert.equal(compareRelationshipNodes(first, second).similarity, 0.8);
  assert.ok(distance(layout, first.id, second.id) < 0.55);
  assert.ok(Math.abs(layout.get(first.id).x - previous.get(first.id).x) > 0.48);
  assert.deepEqual(layout.get(unrelated.id), previous.get(unrelated.id));
});

test('mutual best matches with moderate similarity move close even from distant cached positions', () => {
  const features = [
    { code: 'name', kind: 'text', automatic: true },
    { code: 'workshop_no', kind: 'category', automatic: true },
    { code: 'process', kind: 'text', automatic: true },
  ];
  const first = { id: 'a', features, values: { name: '数控加工 A 线', workshop_no: '东区', process: '车削、精铣' } };
  const second = { id: 'b', features, values: { name: '热处理 B 线', workshop_no: '东区', process: '渗碳淬火、回火' } };
  const third = { id: 'c', features, values: { name: '表面喷涂', workshop_no: '西区', process: '抛光、喷粉' } };
  const seeds = new Map([
    ['a', { x: -1.4, y: 0, z: 0 }],
    ['b', { x: 1.4, y: 0, z: 0 }],
    ['c', { x: 0, y: 1.25, z: 0 }],
  ]);
  const comparison = compareRelationshipNodes(first, second);
  assert.ok(comparison.similarity > 0.35 && comparison.similarity < 0.4);
  assert.equal(comparison.coverage, 1);
  for (const previous of [undefined, seeds]) {
    const positions = layoutRelationshipSimilarity([first, second, third], seeds, previous);
    assert.ok(distance(positions, 'a', 'b') < 0.65);
    assert.ok(distance(positions, 'a', 'c') > 1.15);
    assert.ok(distance(positions, 'b', 'c') > 1.15);
  }
});

test('a single matching attribute with low coverage does not collapse the pair', () => {
  const features = ['state', 'line', 'area', 'part'].map(code => ({ code, kind: 'category' }));
  const first = { id: 'a', features, values: { state: '已完工', line: 'A', area: 'A1', part: '联轴套' } };
  const second = { id: 'b', features, values: { state: '已完工' } };
  const seeds = new Map([['a', { x: -1, y: 0, z: 0 }], ['b', { x: 1, y: 0, z: 0 }]]);
  const comparison = compareRelationshipNodes(first, second);
  assert.equal(comparison.similarity, 1);
  assert.equal(comparison.coverage, 0.25);
  assert.ok(distance(layoutRelationshipSimilarity([first, second], seeds), 'a', 'b') > 0.9);
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
