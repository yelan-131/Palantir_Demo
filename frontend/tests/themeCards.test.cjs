const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/theme/cards.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const context = { exports: {} };
vm.runInNewContext(code, context);
const { THEME_CARDS, DEFAULT_THEME_CARD, UI_TYPE, resolveThemeCardId, getThemeCard, themeCardCssVariables, contrastRatio } = context.exports;

test('type scale: 12px minimum, 2px line grid, three weights, descending sizes', () => {
  const roles = Object.entries(UI_TYPE.role);
  assert.deepEqual(roles.map(([name]) => name), ['display', 'title', 'heading', 'section', 'body', 'control', 'caption']);
  for (let i = 0; i < roles.length; i += 1) {
    const [name, t] = roles[i];
    assert.ok(t.size >= UI_TYPE.minSize, `${name} size ${t.size}`);
    assert.equal(t.line % 2, 0, `${name} line ${t.line}`);
    assert.ok(t.line >= t.size && (t.size > 20 || t.line / t.size >= 1.4), `${name} line ${t.line} is tight for CJK at ${t.size}px`);
    assert.ok([400, 500, 600].includes(t.weight), `${name} weight ${t.weight}`);
    if (i) assert.ok(t.size < roles[i - 1][1].size, `${name} is not smaller than ${roles[i - 1][0]}`);
  }
  const vars = themeCardCssVariables(getThemeCard('graphite'));
  assert.equal(vars['--ui-text-body-size'], '14px');
  assert.equal(vars['--ui-text-caption-line'], '18px');
  assert.match(vars['--ui-font-sans'], /Microsoft YaHei UI/);
  assert.match(vars['--ui-font-numeric'], /^Bahnschrift/);
  assert.match(vars['--ui-font-mono'], /monospace$/);
});

const TEXT_PAIRS = [
  ['text', 'canvas'], ['text', 'surface'], ['muted', 'canvas'], ['muted', 'surface'], ['text2', 'surface'],
  ['accentText', 'accent'], ['accent', 'surface'],
  ['sideText', 'side'], ['sideMuted', 'side'], ['sideActiveText', 'sideActive'],
  ['success', 'successBg'], ['warning', 'warningBg'], ['danger', 'dangerBg'], ['info', 'infoBg'], ['neutral', 'neutralBg'],
  ['success', 'surface'], ['warning', 'surface'], ['danger', 'surface'],
];
const ICON_PAIRS = [['railIcon', 'rail'], ['railIconActive', 'railActive'], ['focus', 'canvas'], ['focus', 'surface']];

for (const card of THEME_CARDS) {
  test(`${card.id}: text reaches WCAG AA and icons reach 3:1`, () => {
    const p = card.palette;
    for (const [fg, bg] of TEXT_PAIRS) {
      const ratio = contrastRatio(p[fg], p[bg]);
      assert.ok(ratio >= 4.5, `${card.id} ${fg} on ${bg} is ${ratio.toFixed(2)}`);
    }
    for (const [fg, bg] of ICON_PAIRS) {
      const ratio = contrastRatio(p[fg], p[bg]);
      assert.ok(ratio >= 3, `${card.id} ${fg} on ${bg} is ${ratio.toFixed(2)}`);
    }
  });
}

test('every card defines the same complete set of colors', () => {
  const keys = Object.keys(THEME_CARDS[0].palette).sort();
  for (const card of THEME_CARDS) {
    assert.deepEqual(Object.keys(card.palette).sort(), keys, card.id);
    for (const [key, value] of Object.entries(card.palette)) {
      if (!key.startsWith('shadow')) assert.match(value, /^#[0-9A-F]{6}$/, `${card.id}.${key}`);
    }
  }
});

test('legacy, unknown and unavailable values fall back to the default card', () => {
  assert.equal(DEFAULT_THEME_CARD, 'graphite');
  assert.equal(resolveThemeCardId('tech-white'), 'graphite');
  assert.equal(resolveThemeCardId(undefined), 'graphite');
  assert.equal(resolveThemeCardId('__proto__'), 'graphite');
  assert.equal(resolveThemeCardId('control-room'), 'graphite');
  assert.equal(resolveThemeCardId('mist'), 'mist');
  assert.equal(resolveThemeCardId('pine'), 'pine');
  assert.equal(getThemeCard('porcelain').palette.accent, '#2440E6');
});

test('css variables keep legacy names and map the rail to the dark navigation color', () => {
  const vars = themeCardCssVariables(getThemeCard('graphite'));
  for (const name of ['--mf-primary', '--mf-bg', '--mf-rail', '--canon-primary', '--canon-rail', '--canon-radius-panel', '--ui-rail-bg', '--ui-side-bg']) {
    assert.ok(vars[name], name);
  }
  assert.equal(vars['--mf-primary'], vars['--canon-primary']);
  assert.equal(vars['--ui-rail-bg'], '#15171B');
  assert.notEqual(vars['--canon-rail'], vars['--ui-rail-bg'], 'light fills must not turn dark');
});
