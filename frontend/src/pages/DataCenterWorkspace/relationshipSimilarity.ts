import { relationshipPositions, type Point3 } from './relationshipLayout';

export interface SimilarityFeature {
  code: string;
  dimension?: string;
  kind: 'number' | 'category';
  tolerance?: number;
  weight?: number;
  scale?: number;
  offset?: number;
}

export interface SimilarityNode {
  id: string;
  values: Readonly<Record<string, unknown>>;
  features: readonly SimilarityFeature[];
}

type ComparableValue = number | string | boolean;

export interface RelationshipSimilarity {
  similarity: number;
  coverage: number;
  features: readonly {
    dimension: string;
    sourceCode: string;
    targetCode: string;
    sourceValue: ComparableValue;
    targetValue: ComparableValue;
    similarity: number;
  }[];
}

interface PreparedFeature extends SimilarityFeature {
  value?: ComparableValue;
  metricValue?: number;
  weight: number;
}

type Profile = ReadonlyMap<string, PreparedFeature>;

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function prepareProfile({ features, values }: SimilarityNode): Profile {
  const profile = new Map<string, PreparedFeature>();
  for (const feature of features) {
    const dimension = feature.dimension?.trim() || feature.code;
    if (!dimension || profile.has(dimension)) continue;
    const raw = Object.prototype.hasOwnProperty.call(values, feature.code) ? values[feature.code] : undefined;
    const numeric = typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
    const scale = feature.scale ?? 1;
    const metricValue = numeric !== undefined && scale !== 0 ? numeric * scale + (feature.offset ?? 0) : undefined;
    const value = feature.kind === 'number' ? Number.isFinite(metricValue) ? numeric : undefined
      : typeof raw === 'boolean' || (typeof raw === 'string' && raw.trim() !== '') ? raw : numeric;
    profile.set(dimension, { ...feature, value, metricValue, weight: positiveNumber(feature.weight) ?? 1 });
  }
  return profile;
}

function featureScore(left: PreparedFeature, right: PreparedFeature, leftValue: ComparableValue, rightValue: ComparableValue): number {
  if (left.kind === 'category') return Number(leftValue === rightValue);
  if (left.metricValue === undefined || right.metricValue === undefined) return 0;
  if (left.metricValue === right.metricValue) return 1;
  const tolerance = Math.min(positiveNumber(left.tolerance) ?? Infinity, positiveNumber(right.tolerance) ?? Infinity);
  return Number.isFinite(tolerance) ? Math.max(0, 1 - Math.abs(left.metricValue - right.metricValue) / tolerance) : 0;
}

function compareProfiles(source: Profile, target: Profile): RelationshipSimilarity | undefined {
  if (!source.size || !target.size) return undefined;
  const dimensions = new Set([...source.keys(), ...target.keys()]);
  let scale = 0;
  for (const dimension of dimensions) {
    scale = Math.max(scale, source.get(dimension)?.weight ?? 0, target.get(dimension)?.weight ?? 0);
  }
  let availableWeight = 0;
  let comparedWeight = 0;
  let similaritySum = 0;
  const features: RelationshipSimilarity['features'][number][] = [];
  for (const dimension of dimensions) {
    const left = source.get(dimension);
    const right = target.get(dimension);
    availableWeight += Math.max(left?.weight ?? 0, right?.weight ?? 0) / scale;
    if (left?.value === undefined || right?.value === undefined || left.kind !== right.kind) continue;
    const weight = Math.sqrt(left.weight / scale) * Math.sqrt(right.weight / scale);
    const similarity = featureScore(left, right, left.value, right.value);
    comparedWeight += weight;
    similaritySum += similarity * weight;
    features.push({ dimension, sourceCode: left.code, targetCode: right.code, sourceValue: left.value, targetValue: right.value, similarity });
  }
  if (!comparedWeight) return undefined;
  return { similarity: similaritySum / comparedWeight, coverage: Math.min(1, comparedWeight / availableWeight), features };
}

export function compareRelationshipNodes(source: SimilarityNode, target: SimilarityNode): RelationshipSimilarity | undefined {
  return compareProfiles(prepareProfile(source), prepareProfile(target));
}

const origin: Point3 = { x: 0, y: 0, z: 0 };
const volumeRadius = 1.5;
const collisionDistance = 0.24;
const minTargetDistance = 0.32;
const maxTargetDistance = 1.64;
const maxIncrementalMovement = 0.48;
const iterations = 60;

function validPoint(point: Point3 | undefined): point is Point3 {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z);
}

function boundPoint(point: Point3, center: Point3, radius: number): Point3 {
  const x = point.x - center.x;
  const y = point.y - center.y;
  const z = point.z - center.z;
  const distance = Math.hypot(x, y, z);
  if (distance <= radius) return point;
  const scale = radius / distance;
  return { x: center.x + x * scale, y: center.y + y * scale, z: center.z + z * scale };
}

interface Particle {
  id: string;
  profile: Profile;
  anchor: Point3;
  anchored: boolean;
  position: Point3;
  velocity: Point3;
  force: Point3;
  compatibleNeighbors: number;
}

interface Pair {
  a: Particle;
  b: Particle;
  fallbackAxis: 'x' | 'y' | 'z';
  comparison?: RelationshipSimilarity;
}

export function layoutRelationshipSimilarity(
  nodes: readonly SimilarityNode[],
  seeds: ReadonlyMap<string, Point3>,
  previous?: ReadonlyMap<string, Point3>,
): Map<string, Point3> {
  const uniqueNodes = [...new Map(nodes.map(node => [node.id, node])).values()]
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const missing = uniqueNodes.filter(node => !validPoint(previous?.get(node.id)) && !validPoint(seeds.get(node.id)));
  const fallback = relationshipPositions(missing.map(node => node.id));
  const particles: Particle[] = uniqueNodes.map(node => {
    const prior = previous?.get(node.id);
    const seed = seeds.get(node.id);
    const initial = validPoint(prior) ? prior : validPoint(seed) ? seed : fallback.get(node.id) ?? origin;
    const anchor = boundPoint(initial, origin, volumeRadius);
    return { id: node.id, profile: prepareProfile(node), anchor, anchored: validPoint(prior), position: anchor,
      velocity: { ...origin }, force: { ...origin }, compatibleNeighbors: 0 };
  });

  const pairs: Pair[] = [];
  const nearPrevious = new Map<string, { neighbor: Particle; score: number }>();
  for (const [index, a] of particles.entries()) {
    for (let i = index + 1; i < particles.length; i++) {
      const b = particles[i];
      const fallbackAxis = (['x', 'y', 'z'] as const)[(index + i) % 3];
      const comparison = compareProfiles(a.profile, b.profile);
      pairs.push({ a, b, fallbackAxis, comparison });
      if (!comparison) continue;
      a.compatibleNeighbors++;
      b.compatibleNeighbors++;
      if (a.anchored === b.anchored) continue;
      const score = comparison.similarity * comparison.coverage;
      const newcomer = a.anchored ? b : a;
      const neighbor = a.anchored ? a : b;
      if (score >= 0.65 && score > (nearPrevious.get(newcomer.id)?.score ?? 0)) {
        nearPrevious.set(newcomer.id, { neighbor, score });
      }
    }
  }

  for (const point of particles) {
    const nearby = nearPrevious.get(point.id);
    if (!nearby) continue;
    const center = nearby.neighbor.anchor;
    const distance = Math.hypot(point.anchor.x - center.x, point.anchor.y - center.y, point.anchor.z - center.z);
    if (distance <= minTargetDistance) continue;
    const fraction = minTargetDistance / distance;
    point.position = {
      x: center.x + (point.anchor.x - center.x) * fraction,
      y: center.y + (point.anchor.y - center.y) * fraction,
      z: center.z + (point.anchor.z - center.z) * fraction,
    };
  }

  for (let frame = 0; frame < iterations; frame++) {
    for (const point of particles) {
      const anchorForce = point.anchored ? 0.035 : 0.005;
      point.force = {
        x: (point.anchor.x - point.position.x) * anchorForce,
        y: (point.anchor.y - point.position.y) * anchorForce,
        z: (point.anchor.z - point.position.z) * anchorForce,
      };
    }

    for (const { a, b, comparison, fallbackAxis } of pairs) {
      const x = b.position.x - a.position.x;
      const y = b.position.y - a.position.y;
      const z = b.position.z - a.position.z;
      const distance = Math.hypot(x, y, z);
      let pull = -0.42 * Math.max(0, collisionDistance - distance);
      if (comparison) {
        const target = maxTargetDistance - comparison.similarity * (maxTargetDistance - minTargetDistance);
        const displacement = distance - target;
        const attraction = displacement > 0 ? comparison.similarity : 1;
        const divisor = Math.sqrt(Math.max(a.compatibleNeighbors, b.compatibleNeighbors));
        pull += 0.28 * comparison.coverage * attraction * displacement / divisor;
      }
      if (!pull) continue;
      const direction = distance > 1e-8 ? { x: x / distance, y: y / distance, z: z / distance }
        : { ...origin, [fallbackAxis]: 1 };
      a.force.x += direction.x * pull;
      a.force.y += direction.y * pull;
      a.force.z += direction.z * pull;
      b.force.x -= direction.x * pull;
      b.force.y -= direction.y * pull;
      b.force.z -= direction.z * pull;
    }

    let largestMovement = 0;
    for (const point of particles) {
      const { position, velocity, force } = point;
      const step = boundPoint({ x: velocity.x * 0.55 + force.x, y: velocity.y * 0.55 + force.y,
        z: velocity.z * 0.55 + force.z }, origin, 0.11);
      let next = { x: position.x + step.x, y: position.y + step.y, z: position.z + step.z };
      if (point.anchored) next = boundPoint(next, point.anchor, maxIncrementalMovement);
      point.position = boundPoint(next, origin, volumeRadius);
      point.velocity = { x: point.position.x - position.x, y: point.position.y - position.y, z: point.position.z - position.z };
      largestMovement = Math.max(largestMovement, Math.hypot(point.velocity.x, point.velocity.y, point.velocity.z));
    }
    if (largestMovement < 0.0005) break;
  }

  return new Map(particles.map(point => [point.id, point.position]));
}
