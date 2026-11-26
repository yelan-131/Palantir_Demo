import type { RelationshipEdge, RelationshipGraph } from './relationshipGraph';

export interface MaterialTrialRecord {
  key: string;
  values: Readonly<Record<string, unknown>>;
  masked_fields?: readonly string[];
}

export interface MaterialTrialCondition {
  medium: string;
  temperatureC: number;
  durationH: number;
}

export interface MaterialTrial {
  key: string;
  materialGrade: string;
  condition: MaterialTrialCondition;
  fluidFormulation?: string;
  testMethod?: string;
  comparisonGroup?: string;
  tensileInitialMpa?: number;
  tensileAfterMpa?: number;
  flexuralInitialMpa?: number;
  flexuralAfterMpa?: number;
  sourceName: string;
  sourceUrl: string;
}

export interface RelationshipTrialComparison {
  condition: MaterialTrialCondition;
  trials: readonly [MaterialTrial, MaterialTrial];
  basis: '同一来源对照试验' | '试验方法与介质配方一致';
}

export interface RelationshipTrialComparisonEdge {
  edge: RelationshipEdge & { kind: 'candidate'; symmetric: true };
  comparison: RelationshipTrialComparison;
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

function normalizedText(value: string) {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

function sourceHttpUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return undefined;
    return url.href.replace(/\(/g, '%28').replace(/\)/g, '%29');
  } catch {
    return undefined;
  }
}

function readMaterialTrial(record: MaterialTrialRecord): MaterialTrial | undefined {
  const field = (name: string) => record.masked_fields?.includes(name) ? undefined : record.values[name];
  const materialGrade = fieldText(field('material_grade'));
  const medium = fieldText(field('medium'));
  const temperatureC = fieldNumber(field('temperature_c'));
  const durationH = fieldNumber(field('duration_h'));
  const sourceName = fieldText(field('source_name'));
  const sourceUrl = sourceHttpUrl(fieldText(field('source_url')));
  if (!record.key || !materialGrade || !medium || temperatureC === undefined || temperatureC < -273.15
      || durationH === undefined || durationH <= 0 || !sourceName || !sourceUrl) return undefined;

  const strength = (name: string) => {
    const value = fieldNumber(field(name));
    return value !== undefined && value >= 0 ? value : undefined;
  };
  return {
    key: record.key,
    materialGrade,
    condition: { medium, temperatureC, durationH },
    fluidFormulation: fieldText(field('fluid_formulation')),
    testMethod: fieldText(field('test_method')),
    comparisonGroup: fieldText(field('comparison_group')),
    tensileInitialMpa: strength('tensile_initial_mpa'),
    tensileAfterMpa: strength('tensile_after_mpa'),
    flexuralInitialMpa: strength('flexural_initial_mpa'),
    flexuralAfterMpa: strength('flexural_after_mpa'),
    sourceName,
    sourceUrl,
  };
}

export function readMaterialTrials(records: readonly MaterialTrialRecord[]): MaterialTrial[] {
  return records.flatMap(record => {
    const trial = readMaterialTrial(record);
    return trial ? [trial] : [];
  });
}

function sameKnownValue(left: string | undefined, right: string | undefined) {
  return left && right ? normalizedText(left) === normalizedText(right) : undefined;
}

function comparisonBasis(left: MaterialTrial, right: MaterialTrial): RelationshipTrialComparison['basis'] | undefined {
  const sameMethod = sameKnownValue(left.testMethod, right.testMethod);
  const sameFormulation = sameKnownValue(left.fluidFormulation, right.fluidFormulation);
  if (sameMethod === false || sameFormulation === false) return undefined;
  if (left.comparisonGroup && left.comparisonGroup === right.comparisonGroup && left.sourceUrl === right.sourceUrl) {
    return '同一来源对照试验';
  }
  return sameMethod && sameFormulation ? '试验方法与介质配方一致' : undefined;
}

function matchingTrialPairs(records: readonly MaterialTrialRecord[], visibleGrades: ReadonlySet<string>) {
  if (!visibleGrades.size) return [];
  const trialsByCondition = new Map<string, MaterialTrial[]>();
  for (const trial of readMaterialTrials(records)) {
    if (trial.tensileAfterMpa === undefined && trial.flexuralAfterMpa === undefined) continue;
    const { medium, temperatureC, durationH } = trial.condition;
    const key = JSON.stringify([normalizedText(medium), temperatureC, durationH]);
    const sameCondition = trialsByCondition.get(key);
    if (sameCondition) sameCondition.push(trial);
    else trialsByCondition.set(key, [trial]);
  }

  const comparisons: RelationshipTrialComparison[] = [];
  for (const trials of trialsByCondition.values()) {
    for (let i = 0; i < trials.length; i++) {
      for (let j = i + 1; j < trials.length; j++) {
        const [left, right] = [trials[i], trials[j]];
        if (left.materialGrade === right.materialGrade
            || (!visibleGrades.has(left.materialGrade) && !visibleGrades.has(right.materialGrade))) continue;
        const comparableTensile = left.tensileAfterMpa !== undefined && right.tensileAfterMpa !== undefined;
        const comparableFlexural = left.flexuralAfterMpa !== undefined && right.flexuralAfterMpa !== undefined;
        if (!comparableTensile && !comparableFlexural) continue;
        const basis = comparisonBasis(left, right);
        if (basis) comparisons.push({ condition: left.condition, trials: [left, right], basis });
      }
    }
  }
  return comparisons;
}

function materialNodes(graph: Pick<RelationshipGraph, 'nodes'>, materialTypeId: number) {
  return new Map(graph.nodes.filter(node => node.typeId === materialTypeId).map(node => [node.key, node.id]));
}

export function relationshipTrialPeerKeys(
  graph: Pick<RelationshipGraph, 'nodes'>, records: readonly MaterialTrialRecord[], materialTypeId: number,
): string[] {
  const visible = new Set(materialNodes(graph, materialTypeId).keys());
  const peers = new Set<string>();
  for (const { trials } of matchingTrialPairs(records, visible)) {
    for (const { materialGrade } of trials) {
      if (!visible.has(materialGrade)) peers.add(materialGrade);
    }
  }
  return [...peers];
}

export function buildRelationshipTrialComparisonEdges(
  graph: Pick<RelationshipGraph, 'nodes'>, records: readonly MaterialTrialRecord[], materialTypeId: number,
): RelationshipTrialComparisonEdge[] {
  const nodes = materialNodes(graph, materialTypeId);
  const results = new Map<string, RelationshipTrialComparisonEdge>();
  const code = 'material-trial-comparison';
  for (const { trials: [left, right], basis } of matchingTrialPairs(records, new Set(nodes.keys()))) {
    const leftId = nodes.get(left.materialGrade);
    const rightId = nodes.get(right.materialGrade);
    if (!leftId || !rightId) continue;
    const [source, target, sourceTrial, targetTrial] = leftId < rightId
      ? [leftId, rightId, left, right] : [rightId, leftId, right, left];
    const id = JSON.stringify([code, source, target, sourceTrial.key, targetTrial.key]);
    results.set(id, {
      edge: { id, source, target, label: '同工况可比较', relationId: code, code, kind: 'candidate', symmetric: true },
      comparison: { condition: sourceTrial.condition, trials: [sourceTrial, targetTrial], basis },
    });
  }
  return [...results.values()];
}
