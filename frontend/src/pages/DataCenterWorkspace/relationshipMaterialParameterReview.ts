import type { RuntimeObjectType } from '../../services/objectRuntime';
import {
  compareAttributeDiscoveryProfiles, prepareAttributeDiscoveryProfile,
  type AttributeDiscoveryComparison, type AttributeDiscoveryProfile,
} from './relationshipAttributeDiscovery';
import type { RelationshipNode } from './relationshipGraph';

export interface ParameterEvidence {
  key: string;
  label: string;
  value: string;
}

export interface MissingMaterialRequirement {
  key: string;
  label: string;
  requirement: string;
}

export interface MaterialMetricCheck {
  key: string;
  label: string;
  status: 'different-measure' | 'unit-mismatch' | 'needs-condition';
  reason: string;
  productValues: readonly ParameterEvidence[];
}

export interface RelationshipMaterialParameterReview {
  comparableCount: number;
  comparison?: AttributeDiscoveryComparison;
  productMeasurements: readonly ParameterEvidence[];
  materialEvidence: readonly ParameterEvidence[];
  missingRequirements: readonly MissingMaterialRequirement[];
  metricChecks: readonly MaterialMetricCheck[];
}

const decimal = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?`;
const notes = String.raw`\s*\([^()]+\)`;
const pattern = (body: string) => new RegExp(`^${body}$`, 'u');
const propertyPatterns: Readonly<Record<string, RegExp>> = {
  密度: pattern(`${decimal} g/cm3${notes}`),
  拉伸模量: pattern(`干态 ${decimal} MPa / 湿态 ${decimal} MPa${notes}`),
  冲击强度: pattern(`简支梁缺口 ${decimal} / ${decimal} kJ/m2${notes},无缺口 ${decimal} / ${decimal} kJ/m2${notes}。均按干态 / 湿态列示,.*`),
  热变形温度: pattern(`${decimal} °C${notes}`),
  成型收缩率: pattern(`平行 (${decimal})[–~-](${decimal})%,垂直 (${decimal})[–~-](${decimal})%${notes}`),
};

// These are inputs for a possible selection criterion when that property matters to the product.
const requirementForMetric: Readonly<Record<string, string>> = {
  密度: '允许的材料密度范围，或目标重量与净塑料体积。',
  拉伸模量: '允许的拉伸模量范围及干湿态、测试标准。',
  拉伸强度: '对应干湿态、测试标准下的材料拉伸强度下限。',
  弯曲强度: '对应干湿态、测试标准下的材料弯曲强度下限。',
  冲击强度: '冲击强度下限、试样状态、缺口类型和测试温度。',
  热变形温度: '热变形温度下限和试验载荷。设计如有耐热要求，还需约定实际使用温度。',
  成型收缩率: '沿流动方向和横向的允许收缩率，以及对应的成型条件。',
};

const metricUnits: Readonly<Record<string, readonly string[]>> = {
  密度: ['g/cm3', 'kg/m3', 'g/mL'],
  拉伸模量: ['Pa', 'kPa', 'MPa', 'GPa'],
  拉伸强度: ['Pa', 'kPa', 'MPa', 'GPa'],
  弯曲强度: ['Pa', 'kPa', 'MPa', 'GPa'],
  冲击强度: ['J/m2', 'kJ/m2'],
  热变形温度: ['°C', '°F', 'K'],
  成型收缩率: ['%'],
};

const requirementLabel = /下限|上限|要求|允许|目标/u;
const numericReadings = new RegExp(`^${decimal}(?:\\s*[–~至-]\\s*${decimal})?(?:\\s*([a-zA-Z°%][a-zA-Z0-9/%°]*))?$`, 'u');

function metricName(label: string) {
  const name = label.normalize('NFKC').replace(/\(.*$/u, '').trim()
    .replace(/^(?:材料|允许|目标|要求)\s*/u, '')
    .replace(/\s*(?:实测值?|要求|下限|上限|范围|区间)$/u, '');
  if (name === '抗拉强度') return '拉伸强度';
  if (name === '拉伸弹性模量') return '拉伸模量';
  return name;
}

function matchesMetricUnit(field: ParameterEvidence, units: readonly string[]) {
  const sourceLabel = field.label.normalize('NFKC').replace(/\^([23])/gu, '$1');
  const sourceValue = field.value.normalize('NFKC').replace(/\^([23])/gu, '$1');
  const labelTokens = sourceLabel.split(/[\s(),、·]+/u);
  const inlineUnit = numericReadings.exec(sourceValue)?.[1];
  return units.some(unit => inlineUnit === unit || labelTokens.includes(unit));
}

function compareDocumentMetric(evidence: ParameterEvidence, productFields: readonly ParameterEvidence[]): MaterialMetricCheck {
  const { key, label } = evidence;
  const knownValues = productFields.filter(field => metricName(field.label) === label && numericReadings.test(field.value.normalize('NFKC')));
  if (!knownValues.length) {
    return { key, label, status: 'different-measure', reason: `产品侧缺可与物性表${label}对齐的同指标数值。`, productValues: knownValues };
  }
  const unitMatched = knownValues.some(field => matchesMetricUnit(field, metricUnits[label]));
  if (!unitMatched) {
    return { key, label, status: 'unit-mismatch', reason: `已找到同指标数值，${label}的比较单位待核对。`, productValues: knownValues };
  }
  return { key, label, status: 'needs-condition', reason: `已找到同指标、同量纲的数值，${label}的要求口径与物性表测试条件待核对。`, productValues: knownValues };
}

function usableProperty(node: RelationshipNode, code: string) {
  if (node.maskedFields?.includes(code) || node.recordMetadata?.hidden_property_codes?.includes(code)) return undefined;
  const value = node.values[code];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && !/^[-–—*•]+$/u.test(value.trim())) return value.trim();
  return undefined;
}

function productValues(node: RelationshipNode, model: RuntimeObjectType) {
  return model.fields.flatMap(field => {
    const key = field.code || field.name;
    const label = field.label?.trim() || field.name;
    if (!key || !label || (field.status && field.status !== 'published') || /牌号/u.test(label)) return [];
    const value = usableProperty(node, key);
    if (value === undefined) return [];
    return [{ key, label, value: String(value), numeric: typeof value === 'number' }];
  });
}

function measuredBurst(record: RelationshipNode, productKey: string): ParameterEvidence[] {
  if (usableProperty(record, 'valve_no') !== productKey) return [];
  const lower = usableProperty(record, 'burst_min_mpa');
  const upper = usableProperty(record, 'burst_max_mpa');
  const readings = usableProperty(record, 'readings_mpa');
  const validReadings = typeof readings === 'string' && readings.split('、').every(value => pattern(decimal).test(value.trim()));
  const interval = typeof lower === 'number' && typeof upper === 'number' && lower <= upper ? `${lower}–${upper}` : undefined;
  const value = validReadings ? readings : interval;
  if (!value) return [];
  const label = usableProperty(record, 'name');
  const condition = ['test_temperature', 'test_medium', 'test_location'].map(key => usableProperty(record, key)).filter(Boolean).join(' · ');
  return [{ key: record.id, label: typeof label === 'string' ? label : '整阀爆破压力', value: `${value} MPa${condition ? `（${condition}）` : ''}` }];
}

function propertyEvidence(material: RelationshipNode, metric: string) {
  const property = material.recordMetadata?.properties.find(item => item.name.trim() === metric);
  const numeric = property && propertyPatterns[metric].exec(property.value.normalize('NFKC').trim());
  if (!property || !numeric) return undefined;
  if (metric === '成型收缩率' && (Number(numeric[1]) > Number(numeric[2]) || Number(numeric[3]) > Number(numeric[4]))) return undefined;
  return { key: property.id, label: metric, value: property.value };
}

function strengthEvidence(note: string | undefined): ParameterEvidence[] {
  if (!note) return [];
  const rows = note.split(/\r?\n/u).map(line => /^\s*\|(.*)\|\s*$/u.exec(line)?.[1].split('|').map(cell => cell.trim()));
  const header = rows.findIndex(row => row?.length === 4 && row[0] === '强度指标' && row[1] === '干态（MPa）' && row[2] === '湿态（MPa）' && row[3] === '标准与速度');
  if (header < 0 || rows[header + 1]?.length !== 4 || !rows[header + 1]?.every(cell => /^:?-{3,}:?$/u.test(cell))) return [];
  const evidence: ParameterEvidence[] = [];
  for (const row of rows.slice(header + 2)) {
    if (!row || row.length !== 4) break;
    const [metric, dry, wet, condition] = row;
    if ((metric === '拉伸强度' || metric === '弯曲强度') && pattern(decimal).test(dry) && pattern(decimal).test(wet) && /^ISO \d/u.test(condition)) {
      evidence.push({ key: metric, label: metric, value: `干态 ${dry} MPa / 湿态 ${wet} MPa（${condition}）` });
    }
  }
  return evidence;
}

function comparableDimensions(source: AttributeDiscoveryProfile, target: AttributeDiscoveryProfile) {
  if (!source.contextComplete || !target.contextComplete || source.context.size !== target.context.size
    || [...source.context].some(([key, item]) => target.context.get(key)?.normalized !== item.normalized)) return 0;
  return [...source.attributes].filter(([key, item]) => item.value.kind === 'numeric' && target.attributes.get(key)?.value.kind === 'numeric').length;
}

export function reviewRelationshipMaterialParameters(
  product: RelationshipNode,
  productModel: RuntimeObjectType,
  material: RelationshipNode,
  materialModel: RuntimeObjectType,
  relatedTests: readonly RelationshipNode[] = [],
): RelationshipMaterialParameterReview {
  const values = productValues(product, productModel);
  const productMeasurements = [...values.filter(field => field.numeric), ...relatedTests.flatMap(record => measuredBurst(record, product.key))];
  const materialEvidence = Object.keys(propertyPatterns).flatMap(metric => {
    const evidence = propertyEvidence(material, metric);
    return evidence ? [evidence] : [];
  }).concat(strengthEvidence(material.recordMetadata?.note_markdown));
  const missingRequirements = materialEvidence.flatMap(({ label }) => {
    const requirement = requirementForMetric[label];
    const populated = values.some(field => metricName(field.label) === label && requirementLabel.test(field.label));
    return requirement && !populated ? [{ key: label, label, requirement }] : [];
  });
  const metricChecks = materialEvidence.map(evidence => compareDocumentMetric(evidence, values));

  // Compare only the measurements with structured definitions and aligned conditions. Typical
  // document values with separate specimen states remain individual evidence rather than a range.
  const sourceProfile = prepareAttributeDiscoveryProfile(product, productModel);
  const targetProfile = prepareAttributeDiscoveryProfile(material, materialModel);
  const comparableCount = comparableDimensions(sourceProfile, targetProfile);
  const comparison = comparableCount ? compareAttributeDiscoveryProfiles(sourceProfile, targetProfile) : undefined;
  return { comparableCount, comparison, productMeasurements, materialEvidence, missingRequirements, metricChecks };
}
