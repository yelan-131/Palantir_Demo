export interface CalculationRule {
  expression: string;
  precision?: number | null;
  emptyBehavior?: 'empty' | 'zero';
}

export type FormulaOperand = { kind: 'field' | 'value'; value: string };
export type FormulaBuilder =
  | { mode: 'number'; items: FormulaOperand[]; operators: string[] }
  | { mode: 'text'; items: FormulaOperand[] }
  | { mode: 'condition'; source: string; operator: string; expected: string; yes: FormulaOperand; no: FormulaOperand };

const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/;
const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
export function buildFormula(builder: FormulaBuilder, numericResult: boolean, numericFields: string[]): string {
  const operand = (item: FormulaOperand, number: boolean) => item.kind === 'field'
    ? identifier.test(item.value) ? item.value : ''
    : number ? numeric.test(item.value) ? item.value : '' : JSON.stringify(item.value);
  if (builder.mode === 'condition') {
    const expected = numericFields.includes(builder.source) ? numeric.test(builder.expected) ? builder.expected : '' : JSON.stringify(builder.expected);
    const yes = operand(builder.yes, numericResult), no = operand(builder.no, numericResult);
    return identifier.test(builder.source) && ['==','!=','>','>=','<','<='].includes(builder.operator) && expected && yes && no
      ? `IF(${builder.source} ${builder.operator} ${expected}, ${yes}, ${no})` : '';
  }
  const parts = builder.items.map(item => operand(item, builder.mode === 'number'));
  if (!parts.length || parts.some(part => !part)) return '';
  if (builder.mode === 'text') return ['""', ...parts].join(' + ');
  if (builder.operators.length !== parts.length - 1 || builder.operators.some(op => !['+','-','*','/','%'].includes(op))) return '';
  return parts.map((part, index) => index ? `${builder.operators[index - 1]} ${part}` : part).join(' ');
}

/** Recover only the simple expressions this builder can represent losslessly. */
export function readFormulaBuilder(expression: string, numericResult: boolean, numericFields: string[] = []): FormulaBuilder | null {
  if (expression.startsWith('IF(') && expression.endsWith(')')) {
    const arguments_: string[] = []; let start = 3, quote = false, escaped = false, depth = 0;
    for (let i = 3; i < expression.length - 1; i++) {
      const char = expression[i];
      if (quote) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quote = false; }
      else if (char === '"') quote = true;
      else if (char === '(') depth++;
      else if (char === ')') depth--;
      else if (char === ',' && !depth) { arguments_.push(expression.slice(start, i).trim()); start = i + 1; }
    }
    arguments_.push(expression.slice(start, -1).trim());
    const condition = arguments_[0]?.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
    const literal = (value: string, number: boolean): string | null => {
      if (number) return numeric.test(value) ? value : null;
      try { const parsed = JSON.parse(value); return typeof parsed === 'string' ? parsed : null; } catch { return null; }
    };
    const operand = (value: string): FormulaOperand | null => identifier.test(value) ? {kind:'field',value} : literal(value,numericResult) == null ? null : {kind:'value',value:literal(value,numericResult)!};
    if (arguments_.length === 3 && condition) {
      const expected = literal(condition[3], numericFields.includes(condition[1])), yes = operand(arguments_[1]), no = operand(arguments_[2]);
      if (expected != null && yes && no) return {mode:'condition',source:condition[1],operator:condition[2],expected,yes,no};
    }
    return null;
  }
  const textTokens = expression.match(/"(?:\\.|[^"\\])*"|'[^'\\]*'|[A-Za-z_][A-Za-z0-9_]*|\+/g);
  const isText = (token?: string) => token?.startsWith('"') || token?.startsWith("'");
  if (textTokens && textTokens.length % 2 === 1 && textTokens.join('').replace(/\s/g, '') === expression.replace(/\s/g, '') && textTokens.some(isText)) {
    const items: FormulaOperand[] = [];
    for (let index = 0; index < textTokens.length; index++) {
      const token = textTokens[index];
      if (index % 2) { if (token !== '+') return null; }
      else if (isText(token)) { try { items.push({kind:'value',value:token.startsWith("'")?token.slice(1,-1):JSON.parse(token)}); } catch { return null; } }
      else if (identifier.test(token)) items.push({kind:'field',value:token});
      else return null;
    }
    if (items[0]?.kind === 'value' && items[0].value === '') items.shift();
    // Without an initial text operand, two numeric field references mean addition.
    if (items.length && (isText(textTokens[0]) || isText(textTokens[2]))) return { mode:'text',items };
  }
  const items: FormulaOperand[] = [], operators: string[] = [];
  let remaining = expression.trim();
  while (remaining) {
    const term = remaining.match(/^([A-Za-z_][A-Za-z0-9_]*|[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)/);
    if (!term) return null;
    items.push({kind:identifier.test(term[1])?'field':'value',value:term[1]});
    remaining = remaining.slice(term[0].length).trimStart();
    if (!remaining) break;
    const operator = remaining.match(/^([+*/%\-])\s*/);
    if (!operator) return null;
    operators.push(operator[1]); remaining = remaining.slice(operator[0].length);
    if (!remaining) return null;
  }
  if (items.length && (numericResult || operators.some(operator=>operator!=='+'))) return {mode:'number',items,operators};

  return null;
}

export function calculationSources<T extends { key: string }>(expression: string, fields: T[], rules: Record<string, CalculationRule | null | undefined> = {}): T[] {
  const leaves = new Set<string>(), visited = new Set<string>();
  const visit = (formula: string) => {
    const tokens = new Set(formula.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '').replace(/\b(?:IF|ROUND|ABS|MIN|MAX|COALESCE)\s*(?=\()/g, '').match(/[A-Za-z_][A-Za-z0-9_]*/g) || []);
    for (const key of tokens) {
      if (visited.has(key)) continue;
      visited.add(key);
      if (rules[key]?.expression) visit(rules[key]!.expression);
      else leaves.add(key);
    }
  };
  visit(expression);
  return fields.filter(field => leaves.has(field.key));
}
