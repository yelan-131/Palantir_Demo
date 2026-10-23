const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const context = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname, '../src/utils/qualityTimeline.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, context);
const { timelineRange, timelinePosition, timelineTime } = context.exports;

test('time filtering follows actual record timestamps, ignoring invalid and missing dates', () => {
  const range = timelineRange([{ occurred_at: '2026-05-21T08:30:00' }, {}, { occurred_at: 'invalid' }, { occurred_at: '2026-05-21T10:00:00' }]);
  assert.equal(timelinePosition('2026-05-21T09:15:00', range), 50);
  assert.equal(timelineTime(50, range), '09:15');
  assert.equal(timelinePosition('2026-05-20T09:15:00', range), 0);
  assert.equal(timelinePosition('2026-05-22T09:15:00', range), 100);
  assert.equal(timelinePosition(undefined, range), undefined);
});

test('single timestamp has a nonzero span; absent timestamps use the legacy range', () => {
  const range = timelineRange([{ occurred_at: '2026-05-21T08:30:00' }]);
  assert.equal(range.end - range.start, 60000);
  assert.equal(timelineRange([{}]), undefined);
  assert.equal(timelineTime(100), '10:00');
});
