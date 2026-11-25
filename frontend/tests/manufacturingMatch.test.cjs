const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInThisContext } = require('node:vm');
const ts = require('typescript');

function loadMatchModule(name, dependencies = {}) {
  const source = readFileSync(join(__dirname, `../src/pages/DataCenterWorkspace/${name}.ts`), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  runInThisContext('(function(exports, require) {' + code + '\n})')(exports, path => dependencies[path]);
  return exports;
}

const { evaluateManufacturingMatch } = loadMatchModule('manufacturingMatch');

const record = (key, values) => ({ key, values });
const product = record('DEMO-PROD-01', {
  operation: '成型', aging_method: '热老化', aging_temperature: 85, aging_hours: 168, strength_min: 45,
  forming_temperature_min: 180, forming_temperature_max: 190,
});
const material = record('DEMO-MAT-A', {
  grade_code: 'DEMO-MAT-A', operation: '成型', forming_temperature_min: 175, forming_temperature_max: 190,
});
const processVersion = record('DEMO-PROC-V1', { operation: '成型', forming_temperature: '185.0' });
const exactTrial = record('DEMO-AGE-085', {
  grade_code: 'DEMO-MAT-A', aging_method: '热老化', aging_temperature: 85, aging_hours: '168',
  tensile_strength: '46.0', specimen_code: 'A85-02',
});
const input = (overrides = {}) => ({ product, material, process: processVersion, trials: [exactTrial], ...overrides });

test('uses only evidence for the selected grade and exact aging method, temperature and duration', () => {
  const trials = [
    record('unrelated-grade', { ...exactTrial.values, grade_code: 'DEMO-MAT-B' }),
    record('other-method', { ...exactTrial.values, aging_method: '湿热老化' }),
    record('higher-temperature', { ...exactTrial.values, aging_temperature: 105 }),
    record('longer-test', { ...exactTrial.values, aging_hours: 500 }),
    exactTrial,
  ];
  const result = evaluateManufacturingMatch(input({ trials }));
  assert.equal(result.status, 'candidate');
  assert.equal(result.selectedTrial, exactTrial);
  assert(result.checks.every(check => check.status === 'pass'));
  assert.match(result.checks.find(check => check.code === 'strength').explanation, /46 MPa ≥ 产品下限 45 MPa/);
});

test('missing, ambiguous and incomplete evidence does not produce a candidate', () => {
  const anotherSpecimen = record('another-test', exactTrial.values);
  const conflicting = record(exactTrial.key, { ...exactTrial.values, tensile_strength: 47 });
  for (const overrides of [{ trials: [] }, { trials: [exactTrial, anotherSpecimen] }, { trials: [exactTrial, conflicting] }, { trialsComplete: false }]) {
    const result = evaluateManufacturingMatch(input(overrides));
    assert.equal(result.status, 'pending');
    assert.equal(result.selectedTrial, undefined);
    assert.equal(result.checks.find(check => check.code === 'condition').status, 'pending');
  }
  assert.equal(evaluateManufacturingMatch(input({ trials: [exactTrial, { ...exactTrial }] })).status, 'candidate');
  const draftNote = record('draft-note', { ...exactTrial.values, tensile_strength: '', wiki_markdown: '实测 46 MPa' });
  assert.equal(evaluateManufacturingMatch(input({ trials: [draftNote] })).status, 'pending');
});

test('masked or missing fields cannot turn possible trial conflicts or unknown operations into a match', () => {
  for (const hiddenField of [{ grade_code: 'DE****-A' }, { aging_method: '****' }, { aging_temperature: '••••••' }, { aging_hours: undefined }]) {
    const result = evaluateManufacturingMatch(input({ trials: [exactTrial, record('partial-trial', { ...exactTrial.values, ...hiddenField })] }));
    assert.equal(result.status, 'pending');
    assert.equal(result.selectedTrial, undefined);
    assert.match(result.checks.find(check => check.code === 'condition').explanation, /待核对/);
  }
  const noKey = evaluateManufacturingMatch(input({ trials: [exactTrial, record('', exactTrial.values)] }));
  assert.equal(noKey.status, 'pending');
  const knownOtherTemperature = record('partial-other-temperature', { ...exactTrial.values, aging_method: '****', aging_temperature: 105 });
  assert.equal(evaluateManufacturingMatch(input({ trials: [exactTrial, knownOtherTemperature] })).status, 'candidate');

  const masked = item => record(item.key, { ...item.values, operation: '****' });
  const result = evaluateManufacturingMatch(input({ product: masked(product), material: masked(material), process: masked(processVersion) }));
  assert.equal(result.status, 'pending');
  assert.equal(result.checks.find(check => check.code === 'operation').status, 'pending');
});

test('reports confirmed failures and accepts setpoints and strength on inclusive bounds', () => {
  const boundary = evaluateManufacturingMatch(input({
    trials: [record(exactTrial.key, { ...exactTrial.values, tensile_strength: 45 })],
    process: record(processVersion.key, { ...processVersion.values, forming_temperature: 190 }),
  }));
  assert.equal(boundary.status, 'candidate');

  const result = evaluateManufacturingMatch(input({
    trials: [record(exactTrial.key, { ...exactTrial.values, tensile_strength: 44 })],
    process: record(processVersion.key, { operation: '挤出', forming_temperature: 178 }),
  }));
  assert.equal(result.status, 'rejected');
  assert.deepEqual(result.checks.filter(item => item.status === 'fail').map(item => item.code), [
    'strength', 'operation', 'product-temperature',
  ]);

  const invalidRange = evaluateManufacturingMatch(input({ material: record(material.key, {
    ...material.values, forming_temperature_min: 200,
  }) }));
  assert.equal(invalidRange.status, 'pending');
  assert.equal(evaluateManufacturingMatch(input({
    material: record(material.key, { ...material.values, operation: undefined }),
    trialsComplete: false,
    process: record(processVersion.key, { ...processVersion.values, forming_temperature: 191 }),
  })).status, 'rejected');
});
