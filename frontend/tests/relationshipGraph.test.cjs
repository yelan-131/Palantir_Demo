const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInThisContext } = require('node:vm');
const ts = require('typescript');

const source = readFileSync(join(__dirname, '../src/pages/DataCenterWorkspace/relationshipGraph.ts'), 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function runtime(readObjectRecord, listObjectRecords) {
  const exports = {};
  const modules = {
    axios: require('axios'),
    '../../services/objectRuntime': {
      readObjectRecord,
      listObjectRecords,
      objectTypeId: model => model.db_id ?? Number(model.id),
    },
  };
  runInThisContext('(function(exports, require) {' + code + '\n})')(exports, key => modules[key]);
  return exports;
}

function record(type, key, relations = []) {
  return { instance_id: type + ':' + key, key, values: { code: key }, relations };
}

function relation(id, direction, relatedType, typeName, records, extra = {}) {
  return {
    id, code: 'rel-' + id, name: '关系 ' + id, direction, related_object_id: relatedType, related_object_name: typeName,
    state: 'matched', total: records.length, records, ...extra,
  };
}

const wrap = data => ({ data: { data } });
const model = typeId => ({ id: String(typeId), name: `对象类型 ${typeId}` });

function denyAccess() {
  throw Object.assign(new Error('Forbidden'), { isAxiosError: true, response: { status: 403 } });
}

test('a saved record key change follows the selected node and its incoming and outgoing edges', async () => {
  const { loadRelationshipGraph, relationshipNodeId, renameRelationshipNode } = runtime(async () => wrap(record(1, 'old', [
    relation(7, 'incoming', 2, '方案', [record(2, 'old')]),
    relation(8, 'outgoing', 3, '工艺', [record(3, 'process')]),
  ])));
  const graph = await loadRelationshipGraph({ typeId: 1, typeName: '材料', key: 'old' }, 1);
  const renamed = renameRelationshipNode(graph, graph.nodes[0], 'new', { code: 'new' });
  const id = relationshipNodeId(1, 'new');
  assert.equal(graph.rootId, relationshipNodeId(1, 'old'));
  assert.equal(renamed.rootId, id);
  assert.deepEqual(renamed.nodes.map(node => [node.key, node.values.code]), [['new', 'new'], ['old', 'old'], ['process', 'process']]);
  assert.deepEqual(renamed.edges.map(edge => JSON.parse(edge.id)), [
    ['7', relationshipNodeId(2, 'old'), id],
    ['8', id, relationshipNodeId(3, 'process')],
  ]);
});

test('two layers preserve typed direction while deduplicating the same relationship returned from both ends', async () => {
  const sharedKey = 'DEMO::01';
  const material = record(1, sharedKey);
  const plan = record(2, sharedKey);
  const process = record(3, 'process-A');
  const inaccessible = record(4, 'hidden');
  const calls = [];
  const { loadRelationshipGraph, relationshipNodeId } = runtime(async (type, key) => {
    calls.push([type, key]);
    return wrap(type === 1 ? {
      ...material,
      relations: [
        relation(7, 'incoming', 2, '适配方案', [plan], { evidence: {
          source_field: 'material_ref', source_value: sharedKey, target_field: 'material_key', target_value: sharedKey,
        } }),
        relation(8, 'incoming', 4, '受限类型', [inaccessible], { state: 'restricted' }),
      ],
    } : {
      ...plan,
      relations: [
        relation('7', 'outgoing', 1, '材料牌号', [material]),
        relation(9, 'outgoing', 3, '工艺规程', [process]),
        relation(10, 'outgoing', 3, '工艺规程', [process]),
      ],
    });
  });

  const root = { typeId: 1, typeName: '材料牌号', key: sharedKey };
  const first = await loadRelationshipGraph(root, 1);
  assert.equal(first.edges.length, 1);
  assert.deepEqual(calls, [[1, sharedKey]]);
  calls.length = 0;

  const graph = await loadRelationshipGraph(root, 2);
  const rootId = relationshipNodeId(1, sharedKey);
  const planId = relationshipNodeId(2, sharedKey);
  const processId = relationshipNodeId(3, 'process-A');
  assert.deepEqual(calls, [[1, sharedKey], [2, sharedKey]]);
  assert.deepEqual(graph.nodes.map(({ id, level }) => [id, level]), [[rootId, 0], [planId, 1], [processId, 2]]);
  assert.deepEqual(graph.edges.map(({ relationId, source, target }) => [relationId, source, target]), [
    [7, planId, rootId], [9, planId, processId], [10, planId, processId],
  ]);
  assert.deepEqual(graph.edges[0].evidence, {
    sourceField: 'material_ref', sourceValue: sharedKey, targetField: 'material_key', targetValue: sharedKey,
  });
  assert.equal(graph.edges[1].evidence, undefined);
  assert.equal(graph.unresolvedRelations, 1);
});

test('the expansion budget and stage errors report partial results without hiding the permitted previews', async () => {
  const firstLayer = Array.from({ length: 20 }, (_, index) => record(2, String(index)));
  const calls = [];
  const { loadRelationshipGraph } = runtime(async (type, key) => {
    calls.push([type, key]);
    if (type === 1) return wrap(record(1, key, [relation(7, 'incoming', 2, '适配方案', firstLayer, { total: 25 })]));
    if (key === '0') throw new Error('temporarily unavailable');
    return wrap(record(2, key));
  });

  const graph = await loadRelationshipGraph({ typeId: 1, typeName: '材料牌号', key: 'A' }, 2);
  assert.equal(calls.length, 13);
  assert.equal(graph.nodes.length, 21);
  assert.equal(graph.edges.length, 20);
  assert.equal(graph.truncated, true);
  assert.equal(graph.failedExpansions, 1);

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(loadRelationshipGraph({ typeId: 1, typeName: '材料牌号', key: 'A' }, 2, controller.signal), {
    name: 'AbortError',
  });
  assert.equal(calls.length, 13);
});

test('overview includes disconnected and isolated records and deduplicates typed links from both ends', async () => {
  const material = record(1, 'shared');
  const firstPlan = record(2, 'shared');
  const secondPlan = record(2, 'other-plan');
  const order = record(3, 'order');
  const isolated = record(3, 'isolated');
  const delivery = record(4, 'delivery');
  const records = new Map([[1, [material]], [2, [firstPlan, secondPlan]], [3, [order, isolated]], [4, [delivery]]]);
  const relations = new Map([
    [material, [relation(7, 'incoming', 2, '方案', [firstPlan], { total: 2 }),
      relation(8, 'incoming', 5, '受限类型', [record(5, 'hidden')], { state: 'restricted' })]],
    [firstPlan, [relation('7', 'outgoing', 1, '材料', [material])]],
    [secondPlan, [relation('7', 'outgoing', 1, '材料', [material])]],
    [delivery, [relation(9, 'outgoing', 3, '订单', [order])]],
  ]);
  const bindingForm = { id: 4, name: '送货记录', code: 'delivery' };
  const { loadRelationshipOverview, relationshipNodeId } = runtime(async (type, key) => {
    const item = records.get(type).find(entry => entry.key === key);
    return wrap({ ...item, relations: relations.get(item) ?? [], binding_form: type === 4 ? bindingForm : undefined });
  }, async type => {
    if (type === 5) denyAccess();
    const items = records.get(type);
    return wrap({ items, total: items.length });
  });

  const graph = await loadRelationshipOverview([4, 2, 5, 3, 1].map(model));
  assert.equal(graph.rootId, undefined);
  assert.deepEqual(graph.nodes.map(({ id }) => id), [
    relationshipNodeId(1, material.key), relationshipNodeId(2, firstPlan.key), relationshipNodeId(3, order.key),
    relationshipNodeId(4, delivery.key), relationshipNodeId(2, secondPlan.key), relationshipNodeId(3, isolated.key),
  ]);
  assert.deepEqual(graph.edges.map(({ source, target }) => [source, target]), [
    [relationshipNodeId(2, firstPlan.key), relationshipNodeId(1, material.key)],
    [relationshipNodeId(4, delivery.key), relationshipNodeId(3, order.key)],
    [relationshipNodeId(2, secondPlan.key), relationshipNodeId(1, material.key)],
  ]);
  assert.deepEqual(graph.nodes.find(node => node.typeId === 4).bindingForm, bindingForm);
  assert.equal(graph.truncated, false);
  assert.equal(graph.failedExpansions, 0);
  assert.equal(graph.unresolvedRelations, 0);
});

test('overview shares the node limit, bounds request concurrency, and reports incomplete results', async () => {
  const records = new Map([
    [1, Array.from({ length: 61 }, (_, index) => record(1, String(index)))],
    [2, Array.from({ length: 60 }, (_, index) => record(2, String(index)))],
    [3, [record(3, 'isolated')]],
  ]);
  let pending = 0;
  let peak = 0;
  const tracked = (handler) => async (...args) => {
    peak = Math.max(peak, ++pending);
    try {
      await new Promise(resolve => setImmediate(resolve));
      return handler(...args);
    } finally {
      pending--;
    }
  };
  const bindingForm = { id: 2, name: '方案记录', code: 'plan' };
  const { loadRelationshipOverview } = runtime(tracked((type, key) => {
    if (type === 2 && key === '0') throw new Error('detail unavailable');
    const item = records.get(type).find(entry => entry.key === key);
    const links = type === 1 && key === '0'
      ? Array.from({ length: 121 }, (_, index) => relation(index, 'outgoing', 2, '方案', [records.get(2)[1]]))
      : [];
    return wrap({ ...item, relations: links });
  }), tracked((type, { page_size: pageSize }) => {
    if (type === 4) denyAccess();
    if (type === 5) throw new Error('listing unavailable');
    const items = records.get(type);
    return wrap({ items: items.slice(0, pageSize), total: items.length, binding_form: bindingForm });
  }));

  const graph = await loadRelationshipOverview([1, 2, 3, 4, 5].map(model));
  assert.equal(peak, 4);
  assert.deepEqual([1, 2, 3].map(type => graph.nodes.filter(node => node.typeId === type).length), [30, 29, 1]);
  assert.equal(graph.nodes.length, 60);
  assert.equal(graph.edges.length, 120);
  assert.deepEqual(graph.nodes.find(node => node.typeId === 2 && node.key === '0').bindingForm, bindingForm);
  assert.equal(graph.truncated, true);
  assert.equal(graph.failedExpansions, 2);
});

test('aborting an overview stops later requests', async () => {
  const controller = new AbortController();
  const calls = [];
  const { loadRelationshipOverview } = runtime(async () => assert.fail('should not read details'), async (type, _params, signal) => {
    assert.equal(signal, controller.signal);
    calls.push(type);
    controller.abort();
    signal.throwIfAborted();
  });
  await assert.rejects(loadRelationshipOverview([1, 2, 3, 4, 5].map(model), controller.signal), { name: 'AbortError' });
  assert.deepEqual(calls, [1, 2, 3, 4]);
});
