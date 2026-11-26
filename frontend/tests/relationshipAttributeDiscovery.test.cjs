const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');

function loadDiscoveryModule(name) {
  const source = readFileSync(join(__dirname, '../src/pages/DataCenterWorkspace', `${name}.ts`), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const loaded = {};
  new Function('exports', outputText)(loaded);
  return loaded;
}

const { prepareAttributeDiscoveryProfile, compareAttributeDiscoveryProfiles } = loadDiscoveryModule('relationshipAttributeDiscovery');
const { prepareRelationshipReferenceProfile, compareRelationshipReferenceProfiles } = loadDiscoveryModule('relationshipReferenceDiscovery');

const fixture = JSON.parse(readFileSync(join(__dirname, '../../data/seed/valve_welding_exploration.json'), 'utf8'));
const { fields, records } = fixture.objects.find(object => object.code === 'demo_relation_valve_burst');
const model = {
  fields,
  record_binding: { key_field: 'record_no', property_fields: Object.fromEntries(fields.map(field => [field.code, field.code])) },
};
const threeWay = records.find(record => record.record_no === 'BURST-03-GAS');
const fiveWay = records.find(record => record.record_no === 'BURST-05-GAS');
const threeWayLiquid = records.find(record => record.record_no === 'BURST-03-LIQUID');

function profile(values, maskedFields = []) {
  return prepareAttributeDiscoveryProfile({ key: values.record_no, values, maskedFields }, model);
}

function referenceProfile(code, recordKey, maskedFields = []) {
  const index = fixture.objects.findIndex(object => object.code === code);
  const { fields, records } = fixture.objects[index];
  const values = records.find(record => record.record_no === recordKey);
  return prepareRelationshipReferenceProfile({ typeId: index + 1, key: recordKey, values, maskedFields }, {
    fields,
    record_binding: { key_field: 'record_no', property_fields: Object.fromEntries(fields.map(field => [field.code, field.code])) },
  });
}

test('三通阀 discovers the actual material and both of its own tests using independently defined fields', () => {
  const valve = referenceProfile('demo_relation_valve_product', 'VALVE-03');
  const material = referenceProfile('demo_relation_valve_material', 'A280G6 RH');
  const materialMatch = compareRelationshipReferenceProfiles(valve, material);

  assert.equal(materialMatch.strength, 1);
  assert.deepEqual(materialMatch.evidence.map(({ sourceCode, targetCode }) => [sourceCode, targetCode]).sort(), [
    ['body_grade_no', 'record_no'], ['cover_grade_no', 'record_no'],
  ]);
  for (const testKey of ['BURST-03-GAS', 'BURST-03-LIQUID']) {
    const burst = referenceProfile('demo_relation_valve_burst', testKey);
    const match = compareRelationshipReferenceProfiles(valve, burst);
    assert.equal(match.strength, 1);
    assert.equal(match.evidence[0].targetCode, 'valve_no');
  }
  const unrelated = referenceProfile('demo_relation_valve_burst', 'BURST-05-GAS');
  assert.equal(compareRelationshipReferenceProfiles(valve, unrelated), undefined);
});

test('masked material identifiers do not produce a material reference', () => {
  const valve = referenceProfile('demo_relation_valve_product', 'VALVE-03', ['cover_grade_no', 'body_grade_no']);
  const material = referenceProfile('demo_relation_valve_material', 'A280G6 RH');
  assert.equal(compareRelationshipReferenceProfiles(valve, material), undefined);
});

test('actual same-condition burst records match by complete ranges with both original fields as evidence', () => {
  const match = compareAttributeDiscoveryProfiles(profile(threeWay), profile(fiveWay));

  assert.ok(Math.abs(match.strength - 2 / 3) < 1e-12);
  assert.equal(match.matchingCount, 1);
  assert.equal(match.comparedCount, 1);
  assert.deepEqual(match.matchedContext.map(item => item.sourceValue).sort(), ['区间', '室温', '气体', '车间']);
  const [evidence] = match.evidence;
  assert.equal(evidence.rule, 'interval-overlap');
  assert.equal(evidence.unit, 'MPa');
  assert.deepEqual(evidence.overlap, [1.4, 1.6]);
  assert.deepEqual(evidence.union, [1.3, 1.6]);
  assert.deepEqual(evidence.sourceFields.map(({ code, value }) => [code, value]), [
    ['burst_min_mpa', 1.4], ['burst_max_mpa', 1.6],
  ]);
  assert.deepEqual(evidence.targetFields.map(({ code, value }) => [code, value]), [
    ['burst_min_mpa', 1.3], ['burst_max_mpa', 1.6],
  ]);
});

test('overlap cannot form a candidate across different protocols, result types or inaccessible context', () => {
  const sourceProfile = profile(threeWay);

  assert.equal(compareAttributeDiscoveryProfiles(sourceProfile, profile(threeWayLiquid)), undefined);
  for (const patch of [{ test_location: '试验室' }, { test_temperature: '85 ℃' }, { result_type: '逐次读数' }]) {
    assert.equal(compareAttributeDiscoveryProfiles(sourceProfile, profile({ ...fiveWay, ...patch })), undefined);
  }
  assert.equal(compareAttributeDiscoveryProfiles(sourceProfile, profile(fiveWay, ['test_medium'])), undefined);
});

test('a lone endpoint or a boundary-only overlap does not create a candidate', () => {
  const sourceProfile = profile(threeWay);

  assert.equal(compareAttributeDiscoveryProfiles(sourceProfile, profile(fiveWay, ['burst_min_mpa'])), undefined);
  assert.equal(compareAttributeDiscoveryProfiles(sourceProfile, profile({ ...fiveWay, burst_min_mpa: 1.7 })), undefined);
  assert.equal(compareAttributeDiscoveryProfiles(sourceProfile, profile({ ...fiveWay, burst_min_mpa: 1.6, burst_max_mpa: 2 })), undefined);
});
