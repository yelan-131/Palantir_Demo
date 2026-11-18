const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const exportsObject = {};
const source = fs.readFileSync(path.join(__dirname, '../src/pages/FormSettings/flowEdgeRoute.ts'), 'utf8');
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: exportsObject });
const { getFlowEdgeRoute, getFlowSegmentDrag, insertFlowWaypoint, readFlowWaypoints } = exportsObject;
const plain = (value) => JSON.parse(JSON.stringify(value));

test('short aligned connectors do not double back or move their label when inserting a waypoint', () => {
  const from = { x: 160, y: 100 };
  const to = { x: 160, y: 148 };
  const route = getFlowEdgeRoute(from, 'bottom', to, 'top');
  assert.equal(route.d, 'M 160 100 L 160 148');
  const added = insertFlowWaypoint(route, { x: 164, y: 120 });
  assert.deepEqual(plain(added.waypoints), [{ x: 160, y: 120 }]);
  const updated = getFlowEdgeRoute(from, 'bottom', to, 'top', added.waypoints);
  assert.equal(updated.d, route.d);
  assert.deepEqual(plain(updated.label), plain(route.label));
});

test('multiple waypoints can be inserted and reloaded in route order', () => {
  const from = { x: 100, y: 100 };
  const to = { x: 260, y: 260 };
  const route = getFlowEdgeRoute(from, 'bottom', to, 'top');
  const first = insertFlowWaypoint(route, { x: 180, y: 180 });
  const custom = first.waypoints.map((point, index) => index === first.index ? { x: 180, y: 210 } : point);
  const edited = getFlowEdgeRoute(from, 'bottom', to, 'top', custom);
  const second = insertFlowWaypoint(edited, { x: 260, y: 220 });
  assert.ok(second.index > first.index);
  const loaded = readFlowWaypoints(JSON.parse(JSON.stringify([...second.waypoints, null, { x: 10 }])));
  assert.deepEqual(plain(loaded), plain(second.waypoints));
  assert.match(getFlowEdgeRoute(from, 'bottom', to, 'top', loaded).d, /Q .* L 260 260$/);
});

test('an old custom routeY is kept when adding the first waypoint', () => {
  const from = { x: 100, y: 100 };
  const to = { x: 260, y: 260 };
  const legacy = getFlowEdgeRoute(from, 'bottom', to, 'top', undefined, 144);
  const updated = insertFlowWaypoint(legacy, { x: 180, y: 144 });
  assert.deepEqual(plain(updated.waypoints), [
    { x: 100, y: 144 }, { x: 180, y: 144 }, { x: 260, y: 144 },
  ]);
  assert.equal(getFlowEdgeRoute(from, 'bottom', to, 'top', updated.waypoints).d, legacy.d);
});

test('dragging a straight segment offsets the middle while holding both ports fixed', () => {
  const from = { x: 160, y: 100 };
  const to = { x: 160, y: 148 };
  const route = getFlowEdgeRoute(from, 'bottom', to, 'top');
  const drag = getFlowSegmentDrag(route, { x: 161, y: 124 });

  assert.equal(drag.axis, 'x');
  const waypoints = drag.move(190);
  assert.deepEqual(plain(waypoints), [{ x: 190, y: 112 }, { x: 190, y: 136 }]);
  assert.match(getFlowEdgeRoute(from, 'bottom', to, 'top', waypoints).d, /^M 160 100 .* L 160 148$/);
});

test('dragging the horizontal middle segment moves only its two bends', () => {
  const route = getFlowEdgeRoute({ x: 100, y: 100 }, 'bottom', { x: 280, y: 240 }, 'top');
  const drag = getFlowSegmentDrag(route, { x: 190, y: 169 });
  assert.equal(drag.axis, 'y');
  assert.deepEqual(plain(drag.move(190)), [{ x: 100, y: 190 }, { x: 280, y: 190 }]);
});

test('connector labels target the segment center for both vertical and horizontal dragging', () => {
  const vertical = getFlowEdgeRoute({ x: 160, y: 100 }, 'bottom', { x: 160, y: 196 }, 'top');
  assert.deepEqual(plain(vertical.label.anchor), { x: 160, y: 148 });
  assert.equal(getFlowSegmentDrag(vertical, vertical.label.anchor).axis, 'x');

  const horizontal = getFlowEdgeRoute({ x: 100, y: 100 }, 'bottom', { x: 280, y: 240 }, 'top');
  assert.deepEqual(plain(horizontal.label.anchor), { x: 190, y: 170 });
  assert.deepEqual(plain(getFlowSegmentDrag(horizontal, horizontal.label.anchor).move(190)), [
    { x: 100, y: 190 }, { x: 280, y: 190 },
  ]);
});
