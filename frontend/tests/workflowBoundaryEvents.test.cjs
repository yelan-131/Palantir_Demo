const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, modules = {}) {
  const exportsObject = {};
  const source = fs.readFileSync(path.join(__dirname, '../src/pages/FormSettings', file), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
  }).outputText, {
    exports: exportsObject,
    structuredClone,
    require: (name) => modules[name] ?? (name.startsWith('@/') || name.endsWith('.css') ? {} : require(name)),
  });
  return exportsObject;
}

const route = load('flowEdgeRoute.ts');
const snap = load('flowNodeSnap.ts');
const widgetAppearance = load('../AppPrograms/analyticsWidgetAppearance.ts');
const annotations = load('flowAnnotations.ts', {
  './flowNodeSnap': snap, './flowEdgeRoute': route, '../AppPrograms/analyticsWidgetAppearance': widgetAppearance,
});
const clipboard = load('flowClipboard.ts', { './flowEdgeRoute': route });
const designer = load('ProfessionalFlowDesigner.tsx', {
  './flowEdgeRoute': route, './flowNodeSnap': snap, './flowAnnotations': annotations, './FlowAnnotationProperties': {},
  './flowClipboard': clipboard,
});
const {
  createDefaultFlowConfig, getRemovableFlowNodeIds, preserveWorkflowStartBindings,
  setWorkflowStartTrigger, validateFlowDesignerConfig, workflowTriggerStartId,
} = designer;
const { makeWorkflowConfigPayload, normalizeProfessionalFlowConfig } = load('workflowConfig.ts', {
  './ProfessionalFlowDesigner': designer, './flowEdgeRoute': route, './flowNodeSnap': snap,
  './flowAnnotations': annotations, './fieldBusinessType': {}, './fieldModel': {},
});
const params = { formId: 'inspection', formName: '巡检记录', version: 'v1', fields: [], steps: [] };
const plain = (value) => JSON.parse(JSON.stringify(value));

test('workflow annotations survive a save and load and discard references to deleted nodes', () => {
  const fallback = createDefaultFlowConfig(params);
  const [start, task] = fallback.nodes;
  const annotation = { id: 'note-1', nodeIds: [start.id, task.id], title: '审批阶段', color: '#8b5e38' };
  const payload = makeWorkflowConfigPayload({ ...fallback, annotations: [annotation] }, { id: 1, code: params.formId }, { name: params.formName });
  const restored = normalizeProfessionalFlowConfig(plain(payload), fallback);
  assert.deepEqual(plain(restored.annotations), [annotation]);
  assert.deepEqual(plain(restored.edges), plain(fallback.edges));
  assert.equal(normalizeProfessionalFlowConfig({}, fallback).annotations, undefined);
  assert.deepEqual(plain(annotations.readFlowAnnotations(restored.annotations, [task])), [
    { ...annotation, nodeIds: [task.id] },
  ]);
  assert.equal(annotations.readFlowAnnotations(restored.annotations, []), undefined);
});

test('approval result rules survive a save and reload independently of the line name', () => {
  const workflow = createDefaultFlowConfig(params);
  const [start, task, end] = workflow.nodes;
  const rejectionEnd = { ...end, id: 'rejection-end', label: '结束' };
  workflow.nodes.push(rejectionEnd);
  workflow.edges.push({
    ...workflow.edges[1], id: 'rejection', source: task.id, target: rejectionEnd.id,
    label: '退回申请', approvalOutcome: 'reject',
  });
  const payload = makeWorkflowConfigPayload(workflow, { id: 1, code: params.formId }, { name: params.formName });
  const restored = normalizeProfessionalFlowConfig(plain(payload), workflow);
  assert.equal(restored.edges.at(-1).approvalOutcome, 'reject');
  assert.equal(restored.edges.at(-1).label, '退回申请');
  const invalidApprovalRoutes = () => validateFlowDesignerConfig(restored)
    .some((check) => check.title === '审批结果连线' && check.level === 'error');
  assert.equal(invalidApprovalRoutes(), false);
  restored.edges.at(-1).source = start.id;
  assert.equal(invalidApprovalRoutes(), true);
});

test('custom rejection targets include only adjacent nodes and are remapped when copied', () => {
  const workflow = createDefaultFlowConfig(params);
  const [start, review, end] = workflow.nodes;
  const unrelated = { ...end, id: 'unrelated' };
  workflow.nodes.push(unrelated);
  review.rejectionTargetId = start.id;
  const neighbors = designer.approvalRejectionTargets(workflow, review.id);
  assert.deepEqual(plain(neighbors.previous.map((node) => node.id)), [start.id]);
  assert.deepEqual(plain(neighbors.next.map((node) => node.id)), [end.id]);
  const payload = makeWorkflowConfigPayload(workflow, { id: 1, code: params.formId }, { name: params.formName });
  const restored = normalizeProfessionalFlowConfig(plain(payload), workflow);
  assert.equal(restored.nodes.find((node) => node.id === review.id).rejectionTargetId, start.id);
  let nextId = 0;
  const copied = clipboard.cloneFlowSelection(clipboard.copyFlowSelection(workflow,
    new Set([start.id, review.id]), new Set()), { x: 24, y: 24 }, (prefix) => `${prefix}-${++nextId}`);
  assert.equal(copied.nodes[1].rejectionTargetId, copied.nodes[0].id);
  review.rejectionTargetId = unrelated.id;
  assert.ok(validateFlowDesignerConfig(workflow).some((check) => check.title === '自定义驳回' && check.level === 'error'));
});

test('annotation frames stay behind and resize to fit their current members', () => {
  const annotation = { id: 'note-1', nodeIds: ['a', 'b'], title: '审批阶段', color: '#527d9b' };
  const fixed = { id: 'a', x: 90, y: 120 };
  const moving = { id: 'b', x: 90, y: 216 };
  const bounds = (node) => plain(annotations.getFlowAnnotationFrames([annotation], [fixed, node])[0].bounds);
  assert.deepEqual(bounds(moving), { left: 74, top: 80, width: 176, height: 200 });
  assert.deepEqual(bounds({ ...moving, x: 138, y: 240 }), { left: 74, top: 80, width: 224, height: 224 });
});

test('marquee selects enclosed annotation frames and still selects nodes inside a partial frame', () => {
  const nodes = [{ id: 'a', x: 100, y: 160 }, { id: 'b', x: 100, y: 256 }, { id: 'c', x: 480, y: 256 }];
  const annotation = { id: 'note-1', nodeIds: ['a', 'b'], title: '审批阶段', color: '#527d9b', size: { width: 300, height: 240 } };
  const frames = annotations.getFlowAnnotationFrames([annotation], nodes);
  const select = (area) => plain(annotations.getFlowMarqueeItems(area, nodes, frames));
  assert.deepEqual(select({ left: 70, top: 105, width: 200, height: 245 }), { nodeIds: ['a', 'b'], annotationIds: [] });
  assert.deepEqual(select({ left: 70, top: 105, width: 320, height: 260 }), { nodeIds: ['a', 'b'], annotationIds: ['note-1'] });
});

test('resized annotation size survives save and clamps to the member bounds', () => {
  const workflow = createDefaultFlowConfig(params);
  const [node] = workflow.nodes;
  const annotation = { id: 'note-1', nodeIds: [node.id], title: '审批阶段', color: '#527d9b', size: { width: 320, height: 280 } };
  const payload = makeWorkflowConfigPayload({ ...workflow, annotations: [annotation] }, { id: 1, code: params.formId }, { name: params.formName });
  const restored = normalizeProfessionalFlowConfig(plain(payload), workflow);
  const [frame] = annotations.getFlowAnnotationFrames(restored.annotations, restored.nodes);
  assert.deepEqual(plain(frame.annotation.size), annotation.size);
  assert.equal(frame.bounds.width, 320);
  assert.equal(frame.bounds.height, 280);
  assert.deepEqual(plain(annotations.resizeFlowAnnotation(frame.bounds, { x: -400, y: -400 }, frame.minimum)), plain(frame.minimum));
  assert.equal(restored.nodes[0].x, node.x);
  assert.equal(restored.nodes[0].y, node.y);
});

test('node clipboard preserves selection spacing and remaps only internal paths to fresh nodes', () => {
  const workflow = createDefaultFlowConfig(params);
  const [start, task] = workflow.nodes;
  workflow.edges[0].waypoints = [{ x: 144, y: 176 }];
  workflow.edges[0].routeY = 160;
  const selection = clipboard.copyFlowSelection(workflow, new Set([start.id, task.id]), new Set());
  let counter = 0;
  const copied = clipboard.cloneFlowSelection(selection, { x: 48, y: 72 }, (type) => `${type}-copy-${++counter}`);
  assert.equal(copied.nodes.length, 2);
  assert.equal(copied.edges.length, 1);
  assert.equal(copied.nodes[1].y - copied.nodes[0].y, task.y - start.y);
  assert.equal(copied.nodes[0].id, 'startEvent-copy-1');
  assert.equal(copied.edges[0].id, 'edge-copy-3');
  assert.equal(copied.edges[0].source, copied.nodes[0].id);
  assert.equal(copied.edges[0].target, copied.nodes[1].id);
  assert.deepEqual(plain(copied.edges[0].waypoints), [{ x: 192, y: 248 }]);
  assert.equal(copied.edges[0].routeY, 232);
  assert.deepEqual(workflow.edges[0].waypoints, [{ x: 144, y: 176 }]);
});

test('annotation clipboard keeps appearance and links the copied frame to the new member IDs', () => {
  const workflow = createDefaultFlowConfig(params);
  const [start, task] = workflow.nodes;
  const frame = {
    id: 'note-1', title: '审批阶段', color: '#527d9b', nodeIds: [start.id, task.id],
    titleStyle: { bold: false, underline: true },
    frameStyle: { borderStyle: 'dashed', backgroundOpacity: 22 },
    size: { width: 320, height: 280 },
  };
  workflow.annotations = [frame];
  const selection = clipboard.copyFlowSelection(workflow, new Set([task.id]), new Set([frame.id]));
  assert.equal(selection.nodes.length, 2);
  assert.equal(selection.edges.length, 1);
  assert.equal(clipboard.copyFlowSelection(workflow, new Set(), new Set([frame.id])).nodes.length, 2);
  assert.equal(clipboard.copyFlowSelection(workflow, new Set(frame.nodeIds), new Set()).annotations.length, 0);
  let counter = 0;
  const pasted = clipboard.cloneFlowSelection(selection, { x: 360, y: 0 }, (type) => `${type}-copy-${++counter}`);
  assert.deepEqual(plain(pasted.annotations), [
    { ...frame, id: 'annotation-copy-4', nodeIds: [pasted.nodes[0].id, pasted.nodes[1].id] },
  ]);
  assert.notEqual(pasted.annotations[0].size, frame.size);
  assert.deepEqual(frame.nodeIds, [start.id, task.id]);
});

test('annotation appearance survives a save and reserves space for larger titles', () => {
  const workflow = createDefaultFlowConfig(params);
  const [start] = workflow.nodes;
  const annotation = {
    id: 'note-1', nodeIds: [start.id], title: '审批阶段', color: '#527d9b',
    titleStyle: { fontSize: 32, fontFamily: 'serif', color: '#573b22', bold: false, italic: true, underline: true },
    frameStyle: { backgroundColor: '#b87f48', backgroundOpacity: 0, borderColor: '#8b5e38', borderStyle: 'dashed', borderWidth: 4, borderRadius: 0 },
  };
  const payload = makeWorkflowConfigPayload({ ...workflow, annotations: [annotation] }, { id: 1, code: params.formId }, { name: params.formName });
  const restored = normalizeProfessionalFlowConfig(plain(payload), workflow);
  assert.deepEqual(plain(restored.annotations), [annotation]);
  const [{ bounds }] = annotations.getFlowAnnotationFrames(restored.annotations, restored.nodes);
  assert.equal(bounds.top, restored.nodes[0].y - 62);
});

test('annotation dragging translates custom paths whose endpoints both move with the container', () => {
  const internal = { source: 'a', target: 'b', waypoints: [{ x: 32, y: 124 }] };
  const legacy = { source: 'b', target: 'a', routeY: 180 };
  const external = { source: 'b', target: 'c', waypoints: [{ x: 72, y: 228 }] };
  const automatic = { source: 'a', target: 'b' };
  const [moved, movedLegacy, outside, auto] = annotations.translateAnnotationRoutes(
    [internal, legacy, external, automatic], new Set(['a', 'b']), { x: 24, y: -48 },
  );
  assert.deepEqual(plain(moved.waypoints), [{ x: 56, y: 76 }]);
  assert.equal(movedLegacy.routeY, 132);
  assert.equal(outside, external);
  assert.equal(auto, automatic);
  assert.equal(internal.waypoints[0].x, 32);
});

test('loading a single legacy approval inserts and connects both events while retaining the approval', () => {
  const workflow = normalizeProfessionalFlowConfig({ steps: [{
    node_id: 'review', type: 'approval', name: '值班主管审核', approval_mode: 'single',
    assignee_rules: [{ type: 'user', value: ['7'] }],
    field_permissions: { note: { visible: true, editable: false, required: false } },
  }] }, createDefaultFlowConfig(params));

  assert.deepEqual(plain(workflow.nodes.map((node) => node.type)), ['startEvent', 'userTask', 'endEvent']);
  assert.equal(workflow.nodes[1].id, 'review');
  assert.equal(workflow.nodes[1].label, '值班主管审核');
  assert.equal(workflow.nodes[1].assigneeRules[0].value, '7');
  assert.equal(workflow.nodes[1].fieldPermissions.note.editable, false);
  assert.deepEqual(plain(workflow.edges.map(({ source, target }) => [source, target])), [
    [workflow.nodes[0].id, 'review'], ['review', workflow.nodes[2].id],
  ]);
  assert.ok(workflow.nodes[0].y < workflow.nodes[1].y && workflow.nodes[1].y < workflow.nodes[2].y);
  assert.ok(!validateFlowDesignerConfig(workflow).some((check) => check.level === 'error'));
});

test('a workflow with multiple possible entries is left for the designer to wire', () => {
  const fallback = createDefaultFlowConfig(params);
  const workflow = normalizeProfessionalFlowConfig({
    nodes: [{ id: 'a', type: 'userTask', x: 360, y: 140 }, { id: 'b', type: 'userTask', x: 360, y: 260 }],
    edges: [],
  }, fallback);

  assert.deepEqual(plain(workflow.nodes.map((node) => node.type)), ['startEvent', 'userTask', 'userTask', 'endEvent']);
  assert.equal(workflow.edges.length, 0);
  assert.ok(validateFlowDesignerConfig(workflow).some((check) => check.title === '起止路径' && check.level === 'error'));
});

test('a new workflow using a single step label retains its task between both events', () => {
  const workflow = createDefaultFlowConfig({ ...params, steps: ['值班主管审核'] });
  assert.deepEqual(plain(workflow.nodes.map((node) => node.label)), ['提交', '值班主管审核', '归档']);
  assert.equal(workflow.edges.length, 2);
});

test('multiple start events require reachable endings and a start for the enabled trigger', () => {
  const workflow = createDefaultFlowConfig(params);
  const alternate = { ...workflow.nodes[0], id: 'alternate', label: '备用入口' };
  workflow.nodes.push(alternate);
  const errors = () => validateFlowDesignerConfig(workflow).filter((check) => check.level === 'error');
  assert.ok(errors().some((check) => check.title === '起止路径'));
  workflow.edges.push({ ...workflow.edges[0], id: 'alternate-entry', source: alternate.id });
  assert.ok(errors().some((check) => check.title === '触发绑定'));
  workflow.triggerBindings[0].startNodeId = alternate.id;
  assert.equal(errors().length, 0);
});

test('adding a second start keeps the formerly implicit submit binding on the original node', () => {
  const flow = createDefaultFlowConfig(params);
  const original = flow.nodes[0];
  const alternate = { ...original, id: 'alternate' };
  assert.equal(workflowTriggerStartId(flow.triggerBindings[0], [original]), original.id);

  const next = preserveWorkflowStartBindings(flow, { ...flow, nodes: [...flow.nodes, alternate] });
  assert.equal(next.triggerBindings[0].startNodeId, original.id);
  assert.equal(flow.triggerBindings[0].startNodeId, undefined);
});

test('binding a form action at another start moves it there and can be switched off there', () => {
  const flow = createDefaultFlowConfig(params);
  const original = flow.nodes[0];
  const alternate = { ...original, id: 'alternate' };
  const next = preserveWorkflowStartBindings(flow, { ...flow, nodes: [...flow.nodes, alternate] });
  next.triggerBindings = setWorkflowStartTrigger(next, 'submit', alternate.id, true);
  assert.equal(next.triggerBindings.length, 1);
  assert.equal(next.triggerBindings[0].startNodeId, alternate.id);
  assert.equal(setWorkflowStartTrigger(next, 'submit', original.id, false)[0].enabled, true);
  assert.equal(setWorkflowStartTrigger(next, 'submit', alternate.id, false)[0].enabled, false);
});

test('box deletion keeps required events and can still remove the other selected nodes', () => {
  const workflow = createDefaultFlowConfig(params);
  const start = workflow.nodes[0];
  const task = workflow.nodes[1];
  const end = workflow.nodes[2];

  assert.equal(getRemovableFlowNodeIds(workflow, [start.id]).size, 0);
  assert.deepEqual([...getRemovableFlowNodeIds(workflow, [start.id, task.id, end.id])], [task.id]);
});

test('box deletion prefers to keep the start configured for an enabled trigger', () => {
  const workflow = createDefaultFlowConfig(params);
  const alternate = { ...workflow.nodes[0], id: 'alternate', label: '备用入口' };
  workflow.nodes.push(alternate);
  workflow.triggerBindings[0].startNodeId = alternate.id;
  assert.deepEqual([...getRemovableFlowNodeIds(workflow, [workflow.nodes[0].id, alternate.id])], [workflow.nodes[0].id]);
});

test('a CC node blocks publication until recipients are configured and preserves them on reload', () => {
  const flow = createDefaultFlowConfig(params);
  flow.nodes[1].type = 'ccTask';
  const ccError = (config) => validateFlowDesignerConfig(config).some((check) => check.title === '抄送对象');
  assert.ok(ccError(flow));
  flow.nodes[1].ccRecipients = [{ id: 'notify-1', type: 'role', value: 'planner' }];
  const saved = normalizeProfessionalFlowConfig(plain(flow), createDefaultFlowConfig(params));
  assert.deepEqual(plain(saved.nodes[1].ccRecipients), plain(flow.nodes[1].ccRecipients));
  assert.ok(!ccError(saved));
});
