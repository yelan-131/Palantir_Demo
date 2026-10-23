const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');
const context = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/pages/Workspace/workspaceData.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, context);
const { workspaceGroups, workspaceItemRoute } = context.exports;
const ids = list => Array.from(list, item => item.id);
test('only own drafts and returned applications become continuation work', () => {
  const groups = workspaceGroups([
    { id: 'other', status: 'draft', views: ['pending'] },
    { id: 'mine', status: 'draft', views: ['initiated'] },
    { id: 'returned', status: 'returned', views: ['initiated'], updated_at: '2026-10-21T02:00:00' },
    { id: 'waiting', status: 'running', views: ['initiated'] },
    { id: 'closed', status: 'rejected', views: ['initiated'] },
  ]);
  assert.deepEqual(ids(groups.unfinished), ['returned', 'mine']);
  assert.deepEqual(ids(groups.waiting), ['waiting']);
  assert.deepEqual(ids(groups.pending), ['other']);
  assert(!ids(groups.recent).includes('mine'));
  assert(!ids(groups.recent).includes('returned'));
  assert(ids(groups.recent).includes('closed'));
});
test('offsets and missing timestamps sort safely without mutating input', () => {
  const items = [
    { id: 'invalid', status: 'done', updated_at: 'invalid' },
    { id: 'earlier', status: 'done', updated_at: '2026-10-21T09:00:00+08:00' },
    { id: 'later', status: 'done', updated_at: '2026-10-21T02:00:00' },
  ];
  assert.deepEqual(ids(workspaceGroups(items).recent), ['later', 'earlier', 'invalid']);
  assert.deepEqual(items.map(item => item.id), ['invalid', 'earlier', 'later']);
});
test('pending opens its workflow; drafts retain the source record route', () => {
  const item = { id: 'one', status: 'draft', workflow: { id: 8 }, route_path: '/program/material-application?recordId=7' };
  assert.equal(workspaceItemRoute(item), '/program/material-application?recordId=7');
  assert.equal(workspaceItemRoute(item, 'pending'), '/workflow?tab=pending&instance_id=8');
  assert.equal(workspaceItemRoute({ ...item, route_path: '//outside.example' }), '/workflow?tab=initiated&instance_id=8');
  assert.equal(workspaceItemRoute({ id: 'two', status: 'done' }), '/workflow?tab=initiated');
});
test('ordinary saved records are not misreported as unfinished approval applications', () => {
  const items = [
    { id: 'saved', status: 'draft', views: ['initiated'], form: { id: 1 } },
    { id: 'approval', status: 'draft', views: ['initiated'], form: { id: 2 } },
  ];
  const groups = workspaceGroups(items, [{ id: 1, approval_configured: false }, { id: 2, approval_configured: true }]);
  assert.deepEqual(ids(groups.unfinished), ['approval']);
  assert.deepEqual(ids(groups.recent), ['saved']);
});
test('a bare form route cannot masquerade as a specific application record', () => {
  assert.equal(workspaceItemRoute({ id: 'missing', status: 'running', route_path: '/program/some-form' }), '/workflow?tab=initiated');
  assert.equal(workspaceItemRoute({ id: 'record', status: 'draft', form: { id: 4 }, record: { id: 9 }, route_path: '/program/some-form' }), '/program/some-form?recordId=9');
});

test('overview counts unique updated records in the rolling seven-day window', () => {
  const now = Date.parse('2026-10-23T10:00:00Z');
  const { recentUpdates } = context.exports.workspaceOverview([
    { id: 'old-submission', form: { id: 1 }, record: { id: 7 }, updated_at: '2026-10-20T08:00:00Z' },
    { id: 'new-submission', form: { id: 1 }, record: { id: 7 }, updated_at: '2026-10-22T08:00:00Z' },
    { id: 'other-form', form: { id: 2 }, record: { id: 7 }, updated_at: '2026-10-21T08:00:00Z' },
    { id: 'boundary', updated_at: '2026-10-16T18:00:00+08:00' },
    { id: 'old', updated_at: '2026-10-16T09:59:59Z' },
    { id: 'future', updated_at: '2026-10-24T08:00:00Z' },
    { id: 'invalid', updated_at: 'invalid' },
  ], now);
  assert.deepEqual(ids(recentUpdates), ['new-submission', 'other-form', 'boundary']);
});

test('stale application metric only considers own active applications with valid dates', () => {
  const now = Date.parse('2026-10-23T10:00:00Z');
  const result = context.exports.workspaceOverview([
    { id: 'mine', status: 'running', views: ['initiated'], updated_at: '2026-10-10T10:00:00Z' },
    { id: 'newer', status: 'pending', views: ['initiated'], updated_at: '2026-10-20T10:00:00Z' },
    { id: 'approval', status: 'running', views: ['pending'], updated_at: '2026-10-01T10:00:00Z' },
    { id: 'closed', status: 'done', views: ['initiated'], updated_at: '2026-10-01T10:00:00Z' },
    { id: 'draft', status: 'draft', views: ['initiated'], updated_at: '2026-10-01T10:00:00Z' },
    { id: 'undated', status: 'running', views: ['initiated'] },
  ], now);
  assert.equal(result.oldestWaiting.id, 'mine');
  assert.equal(result.unchangedDays, 13);
  assert.equal(context.exports.workspaceOverview([], now).oldestWaiting, undefined);
});
