const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInThisContext } = require('node:vm');
const ts = require('typescript');

function loadModule(name, modules = {}) {
  const source = readFileSync(join(__dirname, '../src/pages/DataCenterWorkspace', name + '.ts'), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  runInThisContext('(function(exports, require) {' + outputText + '\n})')(exports, key => modules[key]);
  return exports;
}

const matcher = loadModule('manufacturingMatch');
const { buildRelationshipCandidateEdges } = loadModule('relationshipCandidateEdges');
function runtime(listObjectRecords) {
  return loadModule('relationshipMatchEvidence', {
    '../../services/objectRuntime': { listObjectRecords, objectTypeId: entry => entry.db_id ?? Number(entry.id) },
    './manufacturingMatch': matcher,
  }).loadRelationshipMatchEvidence;
}

function node(typeId, object) {
  return { id: `${typeId}:${object.key}`, typeId, ...object };
}

const fit = node(1, { key: 'FIT', values: {} });
const product = node(2, { key: 'SPEC-01', values: {
  operation: '成型', aging_method: '热老化', aging_temperature: 85, aging_hours: 168, strength_min: 45,
  forming_temperature_min: 180, forming_temperature_max: 190,
} });
const material = node(3, { key: 'GRADE-A', values: {
  grade_code: 'GRADE-A', operation: '成型', forming_temperature_min: 175, forming_temperature_max: 190,
} });
const process = node(4, { key: 'PROCESS-V1', values: { operation: '成型', forming_temperature: 185 } });
const trials = [
  { key: 'AGE-085:A85-01', values: { grade_code: 'GRADE-A', aging_method: '热老化', aging_temperature: 85,
    aging_hours: 0, tensile_strength: 50, specimen_code: 'A85-01' } },
  { key: 'AGE-085:A85-02', values: { grade_code: 'GRADE-A', aging_method: '热老化', aging_temperature: 85,
    aging_hours: 168, tensile_strength: 46, specimen_code: 'A85-02' } },
];
const models = ['process_fit', 'product_spec', 'material_grade', 'process_version', 'aging_test'].map((code, index) => ({
  code, id: String(index + 1), status: 'published', record_bound: true,
}));

const edges = [
  { source: fit.id, target: product.id },
  { source: material.id, target: fit.id },
  { source: fit.id, target: process.id },
];
const graph = { nodes: [fit, product, material, process], edges, truncated: false, failedExpansions: 0 };
const binding = { id: 1, name: '样本', code: 'trials' };
const trialPage = (total = trials.length) => ({ data: { data: { items: trials, total, binding_form: binding } } });

test('indexes real linked combinations in both edge directions and reads one complete trial page', async () => {
  const calls = [];
  const load = runtime(async (...args) => { calls.push(args); return trialPage(); });
  const controller = new AbortController();
  const data = await load({ ...graph, edges: [...edges, edges[0]] }, models, controller.signal);
  assert.deepEqual(calls, [[5, { page: 1, page_size: 100 }, controller.signal]]);
  const [evidence] = data.get(fit.id);
  assert.equal(evidence.result.status, 'candidate');
  assert.equal(evidence.result.selectedTrial.values.specimen_code, 'A85-02');
  assert.equal(evidence.result.selectedTrial.bindingForm, binding);
  for (const participant of [product, material, process]) assert.deepEqual(data.get(participant.id), [evidence]);
});

test('draws stable, scoped candidates for a complete business fit and skips pending fits', async () => {
  const matches = await runtime(async () => trialPage())(graph, models);
  const full = buildRelationshipCandidateEdges(graph, matches);
  assert.deepEqual(full.map(({ edge }) => [edge.source, edge.target, edge.kind]), [
    [product.id, material.id, 'candidate'], [product.id, process.id, 'candidate'], [material.id, process.id, 'candidate'],
  ]);
  assert.equal(new Set(full.map(({ edge }) => edge.id)).size, 3);
  assert.ok(full.every(({ match }) => match === matches.get(fit.id)[0]));
  assert.deepEqual(buildRelationshipCandidateEdges({ nodes: [product, material] }, matches), [full[0]]);

  const pending = await runtime(async () => trialPage(100))(graph, models);
  assert.deepEqual(buildRelationshipCandidateEdges(graph, pending), []);
});

test('leaves disconnected or ambiguous participants out of the evaluation', async () => {
  let calls = 0;
  const load = runtime(async () => { calls++; return trialPage(); });
  const otherProduct = node(2, { key: 'OTHER', values: product.values });
  const unlinked = await load({ ...graph, edges: edges.slice(1) }, models);
  const ambiguous = await load({
    ...graph, nodes: [...graph.nodes, otherProduct], edges: [...edges, { source: otherProduct.id, target: fit.id }],
  }, models);
  assert.equal(unlinked.size, 0);
  assert.equal(ambiguous.size, 0);
  assert.equal(calls, 0);
});

test('missing, capped, or incomplete sources leave the existing combination pending', async () => {
  const capped = runtime(async () => trialPage(100));
  const loaded = runtime(async () => trialPage());
  const unavailable = runtime(async () => { throw new Error('request failed'); });
  const results = await Promise.all([
    capped(graph, models), loaded(graph, models.slice(0, -1)), loaded({ ...graph, truncated: true }, models), unavailable(graph, models),
  ]);
  for (const map of results) {
    const [evidence] = map.get(fit.id);
    assert.equal(evidence.result.status, 'pending');
    assert.equal(evidence.result.selectedTrial, undefined);
  }
  const controller = new AbortController();
  const cancel = runtime(async () => { controller.abort(); return trialPage(); });
  await assert.rejects(cancel(graph, models, controller.signal), { name: 'AbortError' });
});
