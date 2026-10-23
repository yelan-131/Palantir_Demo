const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/utils/knowledgeMarkdown.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const context = { exports: {} };
vm.runInNewContext(code, context);
const { parseKnowledgeMarkdown: parse, prepareKnowledgeMarkdown: prepare, safeKnowledgeHref } = context.exports;

test('converted documents render loose tables with escaped pipes and preserve heading anchors', () => {
  const source = '# SOP.docx\n\n> Word source converted to Markdown text.\n\n# 复检流程\n\n| 项目 | 内容 |\n\n| --- | --- |\n\n| 批次 | A\\|B |\n\n## 放行标准\n\n证据齐全';
  const reading = prepare(source, '复检流程');
  assert.ok(!reading.includes('converted'));
  const blocks = parse(reading);
  assert.equal(blocks[0].type, 'table');
  assert.equal(JSON.stringify(blocks[0].rows), '[["批次","A|B"]]');
  assert.equal(blocks[1].id, 'knowledge-heading-0');
  assert.equal(blocks[1].text, '放行标准');
  assert.ok(source.includes('SOP.docx'));
});

test('fenced headings stay out of outline and ordinary markdown supports lists and quotes', () => {
  const blocks = parse('## 说明\n\n```md\n# example\n<script>alert(1)</script>\n```\n\n- 复检\n- 归档\n\n> 备注\n\n1. 确认\n2. 发布');
  assert.equal(blocks.filter(block => block.type === 'heading').length, 1);
  assert.equal(blocks[1].type, 'code');
  assert.ok(blocks[1].text.includes('<script>'));
  assert.equal(JSON.stringify(blocks[2].items), '["复检","归档"]');
  assert.equal(blocks[3].type, 'quote');
  assert.equal(blocks[4].ordered, true);
});

test('untrusted document links only allow normal web and email destinations', () => {
  for (const href of ['javascript:alert(1)', 'data:text/html,hello', '//untrusted.test', 'file:///etc/passwd', ' vbscript:foo']) assert.equal(safeKnowledgeHref(href), undefined);
  assert.equal(safeKnowledgeHref(' https://example.com/reference '), 'https://example.com/reference');
  assert.equal(safeKnowledgeHref('mailto:qa@example.com'), 'mailto:qa@example.com');
  assert.equal(prepare('# 原有标题\n\n正文', '另一篇文档'), '# 原有标题\n\n正文');
  assert.equal(JSON.stringify(parse('')), '[]');
});
