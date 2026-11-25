const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '../src');

function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

test('application code draws icons with Lucide, not @ant-design/icons', () => {
  const offenders = sources(SRC).filter(file => /from\s+['"]@ant-design\/icons|require\(\s*['"]@ant-design\/icons/.test(fs.readFileSync(file, 'utf8')));
  assert.deepEqual(offenders.map(file => path.relative(SRC, file)), [],
    'Import icons from lucide-react through @/components/Icon (or the Ant-named shims in @/components/Icon/ant).');
});

test('each Ant-named shim is exported once and backed by a Lucide icon', () => {
  const text = fs.readFileSync(path.join(SRC, 'components/Icon/ant.tsx'), 'utf8');
  const exports = [...text.matchAll(/^export const (\w+) = lucideIcon\((\w+),/gm)];
  const names = exports.map(match => match[1]);
  assert.equal(new Set(names).size, names.length, 'duplicate shim export');
  const imported = new Set(text.match(/import \{([^}]*)\} from 'lucide-react'/)[1].split(',').map(name => name.trim()).filter(Boolean));
  for (const [, name, lucide] of exports) assert.ok(imported.has(lucide), `${name} uses ${lucide}, which is not imported from lucide-react`);
});
