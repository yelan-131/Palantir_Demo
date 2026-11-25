const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');

const source = readFileSync(join(__dirname, '../src/pages/DataCenterWorkspace/relationshipSimilarityFeatures.ts'), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});
const loaded = {};
new Function('exports', outputText)(loaded);
const { relationshipSimilarityInputs } = loaded;

function field(code, type = 'string', overrides = {}) {
  return { code, name: code, label: code, type, status: 'published', ...overrides };
}

function featureKinds(profile) {
  return Object.fromEntries(profile.features.map(({ code, kind }) => [code, kind]));
}

test('published, visible workshop fields supply text, numbers and categorical features', () => {
  const model = {
    fields: [
      field('workshop_identity'), field('name'), field('area'), field('shift_count', 'integer'), field('parent_workshop'),
      field('status'), field('is_active', 'boolean'), field('priority', 'enum'), field('wiki_markdown', 'text'),
      field('phone'), field('private_note'), field('empty_text'), field('invalid_number', 'decimal'),
      field('structured_value', 'json'), field('unbound'), field('draft_value', 'string', { status: 'draft' }),
    ],
    similarity_features: [],
  };
  const propertyFields = Object.fromEntries(model.fields.map(({ code }) => [code, code]));
  delete propertyFields.unbound;
  propertyFields.workshop_identity = 'internal_pk';
  propertyFields.parent_workshop = 'parent_workshop_no';
  model.record_binding = { form_id: 1, key_field: 'internal_pk', property_fields: propertyFields };
  const record = {
    typeId: 14,
    key: 'DEMO-SHOP-01',
    maskedFields: ['phone'],
    values: {
      workshop_identity: 'DEMO-SHOP-01', name: '精密制造车间', area: '一楼东区', shift_count: 2, parent_workshop: 'CAMPUS-01',
      status: '启用', is_active: false, priority: 0, wiki_markdown: '# 记录', phone: '*******1234',
      empty_text: ' ', invalid_number: Infinity, structured_value: { priority: 1 }, unbound: '未绑定',
      draft_value: '未发布',
    },
  };

  const result = relationshipSimilarityInputs(record, model);
  assert.deepEqual(featureKinds(result), {
    name: 'text', area: 'text', shift_count: 'number', parent_workshop: 'category',
    status: 'category', is_active: 'category', priority: 'category',
  });
  assert.ok(result.features.every(feature => feature.automatic && feature.dimension === JSON.stringify([14, feature.code])));
  assert.equal(result.values.phone, undefined);
  assert.equal(result.values.private_note, undefined);
  assert.equal(record.values.phone, '*******1234');
});

test('non-admin projections omit key-like values matching the record identity and keep references', () => {
  const fields = [
    field('record_number'), field('legacyId', 'integer'), field('workshop_no'),
    field('process'), field('linkedOrder', 'relation'), field('requested_number', 'integer'),
  ];
  const values = {
    record_number: '42', legacyId: 42, workshop_no: 'DEMO-SHOP-01',
    process: '42', linkedOrder: 23, requested_number: 400,
  };
  const model = { fields };
  const first = relationshipSimilarityInputs({ typeId: 10, key: '42', values }, model);
  const second = relationshipSimilarityInputs({ typeId: 11, key: '42', values }, model);
  assert.deepEqual(featureKinds(first), {
    workshop_no: 'category', process: 'text', linkedOrder: 'category', requested_number: 'number',
  });
  assert.ok(first.features.every(feature => !second.features.some(other => other.dimension === feature.dimension)));
});

test('explicit configuration wins and only explicit shared dimensions cross object types', () => {
  const explicit = [
    { code: 'quantity', kind: 'number', tolerance: 100, weight: 3, dimension: 'planned_qty' },
    { code: 'private_name', kind: 'category' },
  ];
  const record = {
    typeId: 3, key: 'DEMO-WO-01', maskedFields: ['private_name'],
    values: { quantity: 200, private_name: '***', description: '精加工', workshop_no: 'DEMO-SHOP-01' },
  };
  const model = {
    fields: [field('quantity', 'integer'), field('private_name'), field('description'), field('workshop_no')],
    similarity_features: explicit,
  };
  const first = relationshipSimilarityInputs(record, model);
  const second = relationshipSimilarityInputs({ ...record, typeId: 4 }, model);
  assert.deepEqual(first.features, [
    { ...explicit[0], dimension: JSON.stringify(['shared', 'planned_qty']) },
    { ...explicit[1], dimension: JSON.stringify([3, 'private_name']) },
  ]);
  assert.equal(first.values.private_name, undefined);
  assert.equal(second.features[0].dimension, first.features[0].dimension);
  assert.notEqual(second.features[1].dimension, first.features[1].dimension);
});
