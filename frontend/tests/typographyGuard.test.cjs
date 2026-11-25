const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Debt left after the 2026-11-25 convergence. Never raise these.
const BASELINE = { belowMinimumSize: 0, nonScaleWeight: 0, nonScaleRadius: 0 };
const MIN_SIZE = 12;
const SCALE_WEIGHTS = new Set(['400', '500', '600', 'normal', 'inherit']);
// Radius scale: tag 4, control 6, panel 10, overlay 14; 999px for pills. The Taobao page imitates a consumer app on purpose.
const SCALE_RADII = new Set([0, 4, 6, 10, 14]);
const RADIUS_EXEMPT_DIRS = ['TaobaoPrototype'];
// Standalone design-review prototypes (ui-review.html, unified-form-design.html) are not part of the app build.
const PROTOTYPE_DIRS = new Set(['design-review', 'design-preview']);
// A declaration on a line carrying this marker is a deliberate, scaled-down miniature, not readable UI text.
const EXEMPT = 'type-exempt';

function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return PROTOTYPE_DIRS.has(entry.name) ? [] : sources(full);
    return /\.(css|tsx?)$/.test(entry.name) ? [full] : [];
  });
}

function measure() {
  const result = { belowMinimumSize: [], nonScaleWeight: [], nonScaleRadius: [] };
  for (const file of sources(path.join(__dirname, '../src'))) {
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split('\n');
    const lineOf = index => text.slice(0, index).split('\n').length;
    const where = index => `${path.relative(path.join(__dirname, '..'), file)}:${lineOf(index)}`;
    const exempt = index => lines[lineOf(index) - 1].includes(EXEMPT);
    for (const match of text.matchAll(/font-size:\s*([0-9.]+)px|fontSize:\s*([0-9.]+)/g)) {
      if (Number(match[1] ?? match[2]) < MIN_SIZE && !exempt(match.index)) result.belowMinimumSize.push(where(match.index));
    }
    for (const match of text.matchAll(/font-weight:\s*([0-9a-z]+)|fontWeight:\s*([0-9]+)/g)) {
      if (!SCALE_WEIGHTS.has(match[1] ?? match[2]) && !exempt(match.index)) result.nonScaleWeight.push(where(match.index));
    }
    if (RADIUS_EXEMPT_DIRS.some(dir => file.split(path.sep).includes(dir))) continue;
    for (const match of text.matchAll(/radius:\s*([^;}\n'"`]+)|borderRadius:\s*([0-9.]+)/g)) {
      const values = match[2] ? [Number(match[2])] : [...match[1].matchAll(/(?<![\w.-])([0-9.]+)px/g)].map(px => Number(px[1]));
      if (values.some(value => !SCALE_RADII.has(value) && value < 999)) result.nonScaleRadius.push(where(match.index));
    }
  }
  return result;
}

test('font sizes, weights and radii stay on the UI scale', () => {
  const found = measure();
  for (const key of Object.keys(BASELINE)) {
    assert.ok(found[key].length <= BASELINE[key],
      `${key}: ${found[key].length} > baseline ${BASELINE[key]}. Use the UI_TYPE roles (minimum ${MIN_SIZE}px; weights 400/500/600) and radii 4/6/10/14 or 999px. Latest: ${found[key].slice(-5).join(', ')}`);
  }
});
