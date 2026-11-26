import type { MaterialTrial, MaterialTrialRecord } from './relationshipTrialComparison';

export interface ValveDurabilityRequirement {
  key: string;
  name: string;
  valveNo: string;
  medium?: string;
  temperatureC?: number;
  durationH?: number;
  conditionBasis: 'reference' | 'confirmed' | 'unconfirmed';
  fluidFormulation?: string;
  testMethod?: string;
  tensileMinMpa?: number;
  flexuralMinMpa?: number;
  sourceName?: string;
  sourceUrl?: string;
}

type DurabilityStatus = 'pending' | 'pass' | 'fail';

export interface ValveDurabilityCheck {
  key: 'tensile' | 'flexural';
  label: string;
  minimumMpa?: number;
  actualMpa?: number;
  status: DurabilityStatus;
}

export interface ValveDurabilityResult {
  status: DurabilityStatus;
  requirement: ValveDurabilityRequirement;
  materialGrade: string;
  trial?: MaterialTrial;
  checks: readonly [ValveDurabilityCheck, ValveDurabilityCheck];
  reasons: string[];
}

function fieldText(value: unknown) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text && !text.includes('****') && text !== '••••••' ? text : undefined;
}

function fieldNumber(value: unknown) {
  const text = fieldText(value);
  const number = typeof value === 'number' ? value
    : text && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text) ? Number(text) : NaN;
  return Number.isFinite(number) ? number : undefined;
}

function sourceHttpUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if ((url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password) return url.href;
  } catch {
    return undefined;
  }
  return undefined;
}

export function readValveDurabilityRequirements(records: readonly MaterialTrialRecord[]): ValveDurabilityRequirement[] {
  return records.flatMap(record => {
    const field = (name: string) => record.masked_fields?.includes(name) ? undefined : record.values[name];
    const valveNo = fieldText(field('valve_no'));
    if (!record.key || !valveNo) return [];

    const temperatureC = fieldNumber(field('temperature_c'));
    const durationH = fieldNumber(field('duration_h'));
    const basis = fieldText(field('condition_basis'));
    const minimum = (name: string) => {
      const strength = fieldNumber(field(name));
      return strength !== undefined && strength >= 0 ? strength : undefined;
    };
    const requirement: ValveDurabilityRequirement = {
      key: record.key,
      name: fieldText(field('name')) ?? record.key,
      valveNo,
      medium: fieldText(field('medium')),
      temperatureC: temperatureC !== undefined && temperatureC >= -273.15 ? temperatureC : undefined,
      durationH: durationH !== undefined && durationH > 0 ? durationH : undefined,
      conditionBasis: basis === 'reference' || basis === 'confirmed' ? basis : 'unconfirmed',
      fluidFormulation: fieldText(field('fluid_formulation')),
      testMethod: fieldText(field('test_method')),
      tensileMinMpa: minimum('tensile_min_mpa'),
      flexuralMinMpa: minimum('flexural_min_mpa'),
      sourceName: fieldText(field('source_name')),
      sourceUrl: sourceHttpUrl(fieldText(field('source_url'))),
    };
    return [requirement];
  });
}

function normalizedText(value: string) {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

function sameProtocolValue(left?: string, right?: string) {
  const unknown = /^(?:-|—|未知|未披露|未指定|待确认|待补充|n\/?a)$/i;
  if (!left || !right || unknown.test(left) || unknown.test(right)) return undefined;
  return normalizedText(left) === normalizedText(right);
}

export function evaluateValveDurability(
  requirement: ValveDurabilityRequirement, materialGrade: string, trials: readonly MaterialTrial[],
  trialsComplete = true,
): ValveDurabilityResult {
  const { medium, temperatureC, durationH, conditionBasis, fluidFormulation, testMethod, tensileMinMpa, flexuralMinMpa } = requirement;
  const hasConditions = Boolean(medium && temperatureC !== undefined && durationH !== undefined);
  const nominalMatches = materialGrade && medium && hasConditions
    ? trials.filter(trial => trial.materialGrade === materialGrade
      && normalizedText(trial.condition.medium) === normalizedText(medium)
      && trial.condition.temperatureC === temperatureC && trial.condition.durationH === durationH)
    : [];
  const possibleTrials: MaterialTrial[] = [];
  const protocolMatches: MaterialTrial[] = [];
  for (const candidate of nominalMatches) {
    const sameFluid = sameProtocolValue(fluidFormulation, candidate.fluidFormulation);
    const sameMethod = sameProtocolValue(testMethod, candidate.testMethod);
    if (sameFluid === false || sameMethod === false) continue;
    possibleTrials.push(candidate);
    if (sameFluid && sameMethod) protocolMatches.push(candidate);
  }

  const candidates = protocolMatches.length ? protocolMatches : possibleTrials;
  const trial = candidates.length === 1 ? candidates[0] : undefined;
  const comparable = conditionBasis === 'confirmed' && protocolMatches.length === 1 && trialsComplete;
  const reasons: string[] = [];
  if (conditionBasis !== 'confirmed') reasons.push(conditionBasis === 'reference'
    ? '当前工况来自材料试验，产品要求待确认。' : '待确认产品试验工况。');
  if (!trialsComplete) reasons.push('材料试验记录读取不完整，待核对全部同工况记录。');
  if (!hasConditions) reasons.push('待补齐试验介质、温度和时长。');
  if (!materialGrade) reasons.push('待补产品的材料牌号。');
  else if (hasConditions) {
    if (!nominalMatches.length) reasons.push('待补同介质、温度和时长的材料试验。');
    else if (!candidates.length) reasons.push('待补介质配方及试验方法均可比的材料试验。');
    else if (candidates.length > 1) reasons.push('有多条可能可比的材料试验，待确认适用记录。');
    else if (!protocolMatches.length) reasons.push('待核对介质配方和试验方法，本次试验结果可供参考。');
  }

  function check(key: ValveDurabilityCheck['key'], label: string, minimumMpa?: number, actualMpa?: number): ValveDurabilityCheck {
    if (minimumMpa === undefined) reasons.push(`待补${label}下限。`);
    if (trial && actualMpa === undefined) reasons.push(`待补材料试验的${label}。`);
    const status = minimumMpa === undefined || actualMpa === undefined || !comparable ? 'pending'
      : actualMpa >= minimumMpa ? 'pass' : 'fail';
    return { key, label, minimumMpa, actualMpa, status };
  }

  const tensile = check('tensile', '老化后拉伸强度', tensileMinMpa, trial?.tensileAfterMpa);
  const flexural = check('flexural', '老化后弯曲强度', flexuralMinMpa, trial?.flexuralAfterMpa);
  const checks = [tensile, flexural] as const;
  const status = checks.some(item => item.status === 'pending') ? 'pending'
    : checks.some(item => item.status === 'fail') ? 'fail' : 'pass';
  return { status, requirement, materialGrade, trial, checks, reasons };
}
