import type { RuntimeObjectType } from '../../services/objectRuntime';
import type { RelationshipNode } from './relationshipGraph';

type NumericInterval = readonly [number, number];
type DiscoveryRecord = Pick<RelationshipNode, 'key' | 'values' | 'maskedFields'>;
type DiscoveryModel = Pick<RuntimeObjectType, 'fields' | 'record_binding'>;

interface Unit {
  symbol: string;
  scale: number;
  offset?: number;
}

interface NumericValue {
  kind: 'numeric';
  range: NumericInterval;
  unit?: string;
}

interface CategoryValue {
  kind: 'category';
  category: string;
}

interface DiscoveryAttribute {
  code: string;
  label: string;
  dimension: string;
  raw: string | number;
  value: NumericValue | CategoryValue;
  fields?: readonly AttributeDiscoveryField[];
}

interface AttributeDiscoveryField {
  code: string;
  label: string;
  value: string | number;
}

interface ContextAttribute extends AttributeDiscoveryField {
  normalized: string;
}

interface RangeBound extends AttributeDiscoveryField {
  point: number;
}

interface SplitRange {
  dimension: string;
  unit?: string;
  lower?: RangeBound;
  upper?: RangeBound;
  ambiguous?: boolean;
}

export interface AttributeDiscoveryProfile {
  attributes: ReadonlyMap<string, DiscoveryAttribute>;
  context: ReadonlyMap<string, ContextAttribute>;
  contextComplete: boolean;
}

export interface AttributeDiscoveryEvidence {
  dimension: string;
  sourceCode: string;
  sourceLabel: string;
  sourceValue: string | number;
  targetCode: string;
  targetLabel: string;
  targetValue: string | number;
  sourceFields?: readonly AttributeDiscoveryField[];
  targetFields?: readonly AttributeDiscoveryField[];
  rule: 'interval-overlap' | 'numeric-equality' | 'point-in-interval' | 'category-equality' | 'record-reference';
  score: number;
  unit?: string;
  sourceRange?: NumericInterval;
  targetRange?: NumericInterval;
  overlap?: NumericInterval;
  union?: NumericInterval;
}

export interface AttributeDiscoveryComparison {
  strength: number;
  matchingCount: number;
  comparedCount: number;
  evidence: readonly AttributeDiscoveryEvidence[];
  matchedContext: readonly {
    sourceLabel: string;
    sourceValue: string | number;
    targetLabel: string;
    targetValue: string | number;
  }[];
}

const numericTypes = new Set(['number', 'int', 'integer', 'smallint', 'bigint', 'float', 'float32', 'float64',
  'decimal', 'numeric', 'double', 'double_precision', 'real']);
const textTypes = new Set(['string', 'text', 'short_text', 'long_text', 'varchar', 'char']);
const categoryTypes = new Set(['enum', 'select', 'single_select', 'radio', 'category', 'categorical']);
const genericAttribute = /^(?:id|key|uuid|name|title|description|status|state|type|kind|category|名称|标题|描述|状态|类型|种类|分类)$/u;
const identifier = /(?:^|[\s_])(?:id|key|uuid|ref|no|code|identifier|serial|record_number|serial_number)$|(?:编号|编码|代码|序号|标识|主键|牌号|型号|名称)$/iu;

const contextAliases = new Map([
  ['工况', 'condition'], ['试验条件', 'condition'], ['测试条件', 'condition'], ['operating condition', 'condition'],
  ['test condition', 'condition'], ['condition', 'condition'],
  ['测试方法', 'method'], ['试验方法', 'method'], ['test method', 'method'],
  ['测试标准', 'standard'], ['试验标准', 'standard'], ['test standard', 'standard'],
  ['测试介质', 'medium'], ['试验介质', 'medium'], ['test medium', 'medium'],
  ['测试场所', 'location'], ['试验场所', 'location'], ['test location', 'location'],
  ['试样状态', 'specimen state'], ['试样状态说明', 'specimen state'], ['specimen state', 'specimen state'],
  ['测试温度', 'temperature'], ['试验温度', 'temperature'], ['test temperature', 'temperature'],
  ['测试湿度', 'humidity'], ['试验湿度', 'humidity'], ['test humidity', 'humidity'],
  ['测试时长', 'duration'], ['试验时长', 'duration'], ['test duration', 'duration'],
  ['结果类型', 'result type'], ['记录类型', 'result type'], ['result type', 'result type'],
]);
const unknownContext = /^(?:未知|待确认|未记录|未填写|unknown|n\/a|-|—|\*+|•+)$/u;

const supportedUnits: ReadonlyMap<string, Unit> = new Map([
  ['μm', { symbol: 'mm', scale: 0.001 }], ['um', { symbol: 'mm', scale: 0.001 }],
  ['mm', { symbol: 'mm', scale: 1 }], ['cm', { symbol: 'mm', scale: 10 }], ['m', { symbol: 'mm', scale: 1000 }],
  ['mm2', { symbol: 'mm²', scale: 1 }], ['cm2', { symbol: 'mm²', scale: 100 }], ['m2', { symbol: 'mm²', scale: 1000000 }],
  ['mm3', { symbol: 'mm³', scale: 1 }], ['cm3', { symbol: 'mm³', scale: 1000 }], ['m3', { symbol: 'mm³', scale: 1000000000 }],
  ['g', { symbol: 'g', scale: 1 }], ['kg', { symbol: 'g', scale: 1000 }],
  ['Pa', { symbol: 'MPa', scale: 0.000001 }], ['kPa', { symbol: 'MPa', scale: 0.001 }],
  ['MPa', { symbol: 'MPa', scale: 1 }], ['mPa', { symbol: 'MPa', scale: 1e-9 }],
  ['GPa', { symbol: 'MPa', scale: 1000 }], ['bar', { symbol: 'MPa', scale: 0.1 }],
  ['°C', { symbol: '℃', scale: 1 }], ['°F', { symbol: '℃', scale: 5 / 9, offset: -32 * 5 / 9 }],
  ['s', { symbol: 's', scale: 1 }], ['min', { symbol: 's', scale: 60 }], ['h', { symbol: 's', scale: 3600 }],
  ['%', { symbol: '%', scale: 1 }],
]);

const numberLiteral = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[+-]?\\d+)?';
const scalarLiteral = new RegExp(`^(${numberLiteral})(?:\\s*([^\\d\\s].*))?$`, 'iu');
const intervalLiteral = new RegExp(`^(${numberLiteral})\\s*(?:[-–—〜~]|至|到)\\s*(${numberLiteral})(?:\\s*([^\\d\\s].*))?$`, 'iu');

function normalizeName(value: string) {
  return value.normalize('NFKC').replace(/([a-z\d])([A-Z])/g, '$1 $2').toLowerCase()
    .replace(/[_\s]+/gu, ' ').trim();
}

function normalizeUnit(value: string) {
  return value.normalize('NFKC').replace(/\s+/gu, '').replace(/\^([23])$/u, '$1');
}

function stripRangeSuffix(name: string) {
  return name.replace(/(?:\s+(?:range|interval)|范围|区间)$/u, '').trim();
}

function describeLabel(label: string) {
  const normalized = label.normalize('NFKC').trim();
  const suffix = /\s*\(([^()]*)\)$/u.exec(normalized);
  const unit = suffix ? supportedUnits.get(normalizeUnit(suffix[1])) : undefined;
  const name = normalizeName(suffix ? normalized.slice(0, suffix.index) : normalized);
  // Strip only a range suffix. Measurement roles and unrecognized qualifiers remain part of the meaning.
  const meaning = stripRangeSuffix(name);
  const qualifier = suffix && !unit ? suffix[1].trim() : '';
  const dimension = qualifier ? `${meaning} (${qualifier})` : meaning;
  return { meaning, dimension, qualifier, unit };
}

function describeBound(meaning: string, qualifier: string): { dimension: string; side: 'lower' | 'upper' } | undefined {
  const suffix = /(?:下界|下限|最小值|\s(?:lower bound|lower limit|minimum|min))$|(?:上界|上限|最大值|\s(?:upper bound|upper limit|maximum|max))$/u.exec(meaning);
  if (!suffix) return undefined;
  const name = stripRangeSuffix(meaning.slice(0, suffix.index));
  if (!name) return undefined;
  const side = /下界|下限|最小值|lower|minimum|min/u.test(suffix[0]) ? 'lower' : 'upper';
  return { dimension: qualifier ? `${name} (${qualifier})` : name, side };
}

function asText(value: unknown) {
  return typeof value === 'string' ? value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase() : '';
}

function readNumeric(raw: string | number, defaultUnit?: Unit, bound = false): NumericValue | undefined {
  const text = String(raw).normalize('NFKC').replace(/−/gu, '-').trim();
  const interval = bound ? null : intervalLiteral.exec(text);
  const scalar = interval ? null : scalarLiteral.exec(text);
  if (!interval && !scalar) return undefined;
  const suffix = interval?.[3] ?? scalar?.[2];
  const inputUnit = suffix && supportedUnits.get(normalizeUnit(suffix));
  if (suffix && !inputUnit) return undefined;
  if (inputUnit && defaultUnit && inputUnit.symbol !== defaultUnit.symbol) return undefined;
  const unit = inputUnit || defaultUnit;
  // An unqualified interval can be compared with the same unqualified interval dimension.
  // Scalar points need a known unit because this version does not infer tolerances.
  if (!interval && !unit && !bound) return undefined;
  const lower = Number(interval?.[1] ?? scalar?.[1]);
  const upper = Number(interval?.[2] ?? scalar?.[1]);
  const low = lower * (unit?.scale ?? 1) + (unit?.offset ?? 0);
  const high = upper * (unit?.scale ?? 1) + (unit?.offset ?? 0);
  if (low > high || ![low, high, high - low].every(Number.isFinite)) return undefined;
  return { kind: 'numeric', range: [low, high], unit: unit?.symbol };
}

function readContext(raw: unknown, unit: Unit | undefined, qualifier: string) {
  if (typeof raw !== 'string' && typeof raw !== 'number') return undefined;
  const numeric = readNumeric(raw, unit);
  if (numeric) return JSON.stringify([qualifier, numeric.unit, numeric.range]);
  const text = !unit && (typeof raw === 'string' ? asText(raw) : Number.isFinite(raw) && String(raw));
  return text && !unknownContext.test(text) ? JSON.stringify([qualifier, text]) : undefined;
}

function attributeKey(dimension: string, value: DiscoveryAttribute['value']) {
  return JSON.stringify([dimension, value.kind, value.kind === 'numeric' ? value.unit : null]);
}

export function prepareAttributeDiscoveryProfile(
  record: DiscoveryRecord, model: DiscoveryModel,
): AttributeDiscoveryProfile {
  const attributes = new Map<string, DiscoveryAttribute>();
  const ambiguous = new Set<string>();
  const context = new Map<string, ContextAttribute>();
  const ranges = new Map<string, SplitRange>();
  let contextComplete = true;
  const binding = model.record_binding;

  function addAttribute(attribute: DiscoveryAttribute) {
    const key = attributeKey(attribute.dimension, attribute.value);
    if (attributes.has(key)) {
      attributes.delete(key);
      ambiguous.add(key);
    } else if (!ambiguous.has(key)) {
      attributes.set(key, attribute);
    }
  }

  for (const field of model.fields) {
    const code = field.code || field.name;
    if (!code || code === 'wiki_markdown' || (field.status !== undefined && field.status !== 'published')) continue;
    const mapped = binding?.property_fields[code];
    if (binding && (!mapped || mapped === binding.key_field)) continue;
    const label = field.label?.trim() || field.name?.trim() || code;
    const raw = !record.maskedFields?.includes(code) && Object.prototype.hasOwnProperty.call(record.values, code)
      ? record.values[code] : undefined;
    const { meaning, dimension, qualifier, unit } = describeLabel(label);
    const condition = contextAliases.get(meaning) ?? contextAliases.get(normalizeName(code));
    if (condition) {
      const normalized = readContext(raw, unit, qualifier);
      const previous = context.get(condition);
      if (!normalized || (previous && previous.normalized !== normalized)) contextComplete = false;
      else if (!previous && (typeof raw === 'string' || typeof raw === 'number')) {
        context.set(condition, { code, label, value: raw, normalized });
      }
      continue;
    }
    if (typeof raw !== 'string' && typeof raw !== 'number') continue;
    const names = [label, code, mapped ?? ''].map(normalizeName);
    if (names.some(name => genericAttribute.test(name) || identifier.test(name))) continue;
    if (!meaning || genericAttribute.test(meaning) || identifier.test(meaning)) continue;
    const type = normalizeName(field.type).replace(/ /gu, '_');
    const isNumeric = numericTypes.has(type) || textTypes.has(type);
    const bound = isNumeric ? describeBound(meaning, qualifier) : undefined;
    if (bound) {
      const value = readNumeric(raw, unit, true);
      if (!value) continue;
      const key = attributeKey(bound.dimension, value);
      const range = ranges.get(key) ?? { dimension: bound.dimension, unit: value.unit };
      if (range[bound.side]) range.ambiguous = true;
      else range[bound.side] = { code, label, value: raw, point: value.range[0] };
      ranges.set(key, range);
      continue;
    }
    const category = typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : asText(raw);
    const value = categoryTypes.has(type) && category && category.length <= 120
      ? { kind: 'category', category } as const
      : isNumeric ? readNumeric(raw, unit) : undefined;
    if (!value) continue;
    addAttribute({ code, label, dimension, raw, value });
  }
  for (const { dimension, unit, lower, upper, ambiguous } of ranges.values()) {
    if (ambiguous || !lower || !upper || lower.point > upper.point || !Number.isFinite(upper.point - lower.point)) continue;
    addAttribute({
      code: `${lower.code} / ${upper.code}`, label: `${lower.label} / ${upper.label}`,
      dimension, raw: `${lower.value}–${upper.value}`, value: { kind: 'numeric', range: [lower.point, upper.point], unit },
      fields: [lower, upper].map(({ code, label, value }) => ({ code, label, value })),
    });
  }
  return { attributes, context, contextComplete };
}

function almostEqual(left: number, right: number) {
  return Math.abs(left - right) <= 4 * Number.EPSILON * Math.max(Math.abs(left), Math.abs(right));
}

type NumericEvidence = Pick<AttributeDiscoveryEvidence, 'rule' | 'score' | 'unit' | 'sourceRange' | 'targetRange' | 'overlap' | 'union'>;

function compareNumeric(source: NumericValue, target: NumericValue): NumericEvidence {
  const [lowA, highA] = source.range;
  const [lowB, highB] = target.range;
  const limits = { unit: source.unit, sourceRange: source.range, targetRange: target.range };
  const pointA = lowA === highA;
  const pointB = lowB === highB;
  if (pointA && pointB) return { ...limits, rule: 'numeric-equality', score: Number(almostEqual(lowA, lowB)) };
  if (pointA || pointB) {
    const [point, low, high] = pointA ? [lowA, lowB, highB] : [lowB, lowA, highA];
    const contains = (point >= low || almostEqual(point, low)) && (point <= high || almostEqual(point, high));
    return { ...limits, rule: 'point-in-interval', score: Number(contains), ...(contains && { overlap: [point, point] }) };
  }
  const low = Math.max(lowA, lowB);
  const high = Math.min(highA, highB);
  if (low > high) return { ...limits, rule: 'interval-overlap', score: 0 };
  const union: NumericInterval = [Math.min(lowA, lowB), Math.max(highA, highB)];
  const span = union[1] - union[0];
  const score = Number.isFinite(span) && span > 0 ? (high - low) / span : 0;
  return { ...limits, rule: 'interval-overlap', score, overlap: [low, high], union };
}

export function compareAttributeDiscoveryProfiles(
  source: AttributeDiscoveryProfile, target: AttributeDiscoveryProfile,
): AttributeDiscoveryComparison | undefined {
  if (!source.contextComplete || !target.contextComplete || source.context.size !== target.context.size
      || [...source.context].some(([key, value]) => target.context.get(key)?.normalized !== value.normalized)) return undefined;
  const evidence: AttributeDiscoveryEvidence[] = [];
  for (const [key, left] of source.attributes) {
    const right = target.attributes.get(key);
    if (!right) continue;
    let result: NumericEvidence;
    if (left.value.kind === 'numeric' && right.value.kind === 'numeric') {
      result = compareNumeric(left.value, right.value);
    } else if (left.value.kind === 'category' && right.value.kind === 'category') {
      result = { rule: 'category-equality', score: Number(left.value.category === right.value.category) };
    } else {
      continue;
    }
    evidence.push({
      dimension: left.dimension,
      sourceCode: left.code, sourceLabel: left.label, sourceValue: left.raw,
      targetCode: right.code, targetLabel: right.label, targetValue: right.raw,
      sourceFields: left.fields, targetFields: right.fields,
      ...result,
    });
  }
  const matchingCount = evidence.filter(item => item.score > 0).length;
  if (!matchingCount) return undefined;
  return {
    strength: evidence.reduce((sum, item) => sum + item.score, 0) / evidence.length,
    matchingCount,
    comparedCount: evidence.length,
    evidence,
    matchedContext: [...source.context].map(([key, left]) => {
      const right = target.context.get(key)!;
      return { sourceLabel: left.label, sourceValue: left.value, targetLabel: right.label, targetValue: right.value };
    }),
  };
}
