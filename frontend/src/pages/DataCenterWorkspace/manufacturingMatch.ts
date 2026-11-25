import type { ObjectBindingForm } from '../../services/objectRuntime';

export const MANUFACTURING_MATCH_TYPES = {
  product: { code: 'product_spec', label: '产品' },
  material: { code: 'material_grade', label: '材料牌号' },
  process: { code: 'process_version', label: '工艺版本' },
  trial: { code: 'aging_test', label: '老化试验' },
} as const;

export type ManufacturingMatchRole = keyof typeof MANUFACTURING_MATCH_TYPES;

export interface ManufacturingMatchRecord {
  key: string;
  values: Readonly<Record<string, unknown>>;
  bindingForm?: ObjectBindingForm;
}

export interface ManufacturingMatchInputs {
  product?: ManufacturingMatchRecord;
  material?: ManufacturingMatchRecord;
  process?: ManufacturingMatchRecord;
  trials: readonly ManufacturingMatchRecord[];
  /** Whether all accessible records for the selected material were loaded. */
  trialsComplete?: boolean;
}

export interface ManufacturingMatchCheck {
  code: 'condition' | 'strength' | 'operation' | 'product-temperature' | 'material-temperature';
  label: string;
  status: 'pass' | 'pending' | 'fail';
  explanation: string;
}

export interface ManufacturingMatchResult {
  status: 'candidate' | 'pending' | 'rejected';
  checks: ManufacturingMatchCheck[];
  selectedTrial?: ManufacturingMatchRecord;
}

function textValue(value: unknown) {
  const text = typeof value === 'string' ? value.trim() : '';
  // Object records expose the form's projected strings, including presentation masks.
  return text && !text.includes('****') && text !== '••••••' ? text : undefined;
}

export function matchIdentifier(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : textValue(value);
}

function numericValue(value: unknown) {
  const literal = textValue(value);
  const number = typeof value === 'number' ? value
    : literal && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(literal) ? Number(literal) : NaN;
  return Number.isFinite(number) ? number : undefined;
}

function trialCondition(record: ManufacturingMatchRecord | undefined) {
  // These mapped fields use degrees Celsius and hours. Strength values use MPa.
  const values = record?.values;
  return {
    method: textValue(values?.aging_method),
    temperature: numericValue(values?.aging_temperature),
    hours: numericValue(values?.aging_hours),
  };
}

function trialSnapshot(record: ManufacturingMatchRecord) {
  return JSON.stringify([
    matchIdentifier(record.values.grade_code), trialCondition(record),
    numericValue(record.values.tensile_strength), matchIdentifier(record.values.specimen_code),
  ]);
}

function selectTrial({ product, material, trials, trialsComplete }: ManufacturingMatchInputs) {
  const { method, temperature, hours } = trialCondition(product);
  const grade = matchIdentifier(material?.values.grade_code);
  if (!grade || !method || temperature === undefined || hours === undefined || hours < 0) {
    return { explanation: '待补齐材料牌号及产品要求的试验类型、温度与时长。' };
  }
  if (trialsComplete === false) {
    return { explanation: '当前可用试验记录不完整，待核对同条件试验。' };
  }

  const condition = `${method} · ${temperature} ℃ · ${hours} h`;
  const matches: ManufacturingMatchRecord[] = [];
  let unresolvedTrial = false;
  for (const trial of trials) {
    const trialGrade = matchIdentifier(trial.values.grade_code);
    const candidate = trialCondition(trial);
    if ((trialGrade !== undefined && trialGrade !== grade)
      || (candidate.method !== undefined && candidate.method !== method)
      || (candidate.temperature !== undefined && candidate.temperature !== temperature)
      || (candidate.hours !== undefined && candidate.hours !== hours)) continue;
    if (!matchIdentifier(trial.key) || trialGrade === undefined || candidate.method === undefined
      || candidate.temperature === undefined || candidate.hours === undefined) {
      unresolvedTrial = true;
      continue;
    }
    matches.push(trial);
  }
  if (unresolvedTrial) {
    return { explanation: `${condition}。可能符合条件的试验缺少记录标识、牌号或试验条件，待核对。` };
  }
  const [trial] = matches;
  if (!trial) return { explanation: `${condition}。待补齐该牌号的同条件试验。` };
  if (new Set(matches.map(item => item.key)).size > 1) {
    return { explanation: `${condition}。有多条同条件试验，待确认取值规则。` };
  }
  const snapshot = trialSnapshot(trial);
  if (trials.some(item => item.key === trial.key && trialSnapshot(item) !== snapshot)) {
    return { explanation: `${condition}。同一试验记录的数据有冲突，待核对数据来源。` };
  }
  const specimen = matchIdentifier(trial.values.specimen_code);
  const source = specimen ? `记录 ${trial.key}，试样 ${specimen}` : `记录 ${trial.key}`;
  return { trial, explanation: `${condition}，取自${source}。` };
}

type TemperatureCheckCode = Extract<ManufacturingMatchCheck['code'], 'product-temperature' | 'material-temperature'>;

function checkTemperature(
  code: TemperatureCheckCode, label: string, requirement: ManufacturingMatchRecord | undefined, setpoint: number | undefined,
): ManufacturingMatchCheck {
  const minimum = numericValue(requirement?.values.forming_temperature_min);
  const maximum = numericValue(requirement?.values.forming_temperature_max);
  if (minimum === undefined || maximum === undefined || setpoint === undefined) {
    return { code, label, status: 'pending', explanation: '待补齐工艺设定温度和允许范围。' };
  }
  if (minimum > maximum) {
    return { code, label, status: 'pending', explanation: '温度范围上下限待核对。' };
  }
  const pass = minimum <= setpoint && setpoint <= maximum;
  return {
    code, label, status: pass ? 'pass' : 'fail',
    explanation: `设定 ${setpoint} ℃${pass ? '在' : '超出'}允许范围 ${minimum}–${maximum} ℃。`,
  };
}

export function evaluateManufacturingMatch(inputs: ManufacturingMatchInputs): ManufacturingMatchResult {
  const { product, material, process } = inputs;
  const { trial, explanation } = selectTrial(inputs);
  const strength = numericValue(trial?.values.tensile_strength);
  const strengthMinimum = numericValue(product?.values.strength_min);
  const measured = strength !== undefined && strength >= 0 && strengthMinimum !== undefined && strengthMinimum >= 0;
  const operations = [product, material, process].map(record => textValue(record?.values.operation));
  const operationsKnown = operations.every(Boolean);
  const sameOperation = operations.every(operation => operation === operations[0]);
  const setpoint = numericValue(process?.values.forming_temperature);
  const checks: ManufacturingMatchCheck[] = [
    { code: 'condition', label: '筛选同条件试验', status: trial ? 'pass' : 'pending', explanation },
    {
      code: 'strength', label: '比较老化后抗拉强度',
      status: measured ? strength >= strengthMinimum ? 'pass' : 'fail' : 'pending',
      explanation: measured
        ? `实测 ${strength} MPa ${strength >= strengthMinimum ? '≥' : '<'} 产品下限 ${strengthMinimum} MPa。`
        : '待核对同条件实测强度和产品下限。',
    },
    {
      code: 'operation', label: '核对工序',
      status: operationsKnown ? sameOperation ? 'pass' : 'fail' : 'pending',
      explanation: operationsKnown ? `产品 ${operations[0]} · 材料 ${operations[1]} · 工艺 ${operations[2]}。`
        : '待补齐产品、材料和工艺的工序。',
    },
    checkTemperature('product-temperature', '核对产品温度范围', product, setpoint),
    checkTemperature('material-temperature', '核对材料加工窗口', material, setpoint),
  ];
  const status = checks.some(check => check.status === 'fail') ? 'rejected'
    : checks.every(check => check.status === 'pass') ? 'candidate' : 'pending';
  return { status, checks, selectedTrial: trial };
}
