export interface Point3 {
  x: number;
  y: number;
  z: number;
}

export interface RelationshipCamera {
  yaw: number;
  pitch: number;
  zoom: number;
  offsetX: number;
  offsetY: number;
}

function samplePosition(id: string, salt: number): number {
  let hash = salt;
  for (let index = 0; index < id.length; index++) {
    hash = Math.imul(hash ^ id.charCodeAt(index), 0x01000193);
  }
  hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d);
  hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b);
  return ((hash ^ (hash >>> 16)) >>> 0) / 0x1_0000_0000;
}

export function relationshipPositions(nodeIds: Iterable<string>): Map<string, Point3> {
  const positions = new Map<string, Point3>();
  for (const id of nodeIds) {
    // Sample a bounded volume from the object's ID alone, without fitting its neighbors.
    const depth = 2 * samplePosition(id, 0x811c9dc5) - 1;
    const angle = Math.PI * 2 * samplePosition(id, 0x9e3779b9);
    const radius = 1.5 * Math.cbrt(0.14 + 0.86 * samplePosition(id, 0x85ebca6b));
    const crossSection = radius * Math.sqrt(1 - depth * depth);
    positions.set(id, { x: crossSection * Math.cos(angle), y: crossSection * Math.sin(angle), z: radius * depth });
  }
  return positions;
}

export function projectRelationshipPoint(
  point: Point3,
  camera: RelationshipCamera,
  viewport: { width: number; height: number },
): { x: number; y: number; depth: number; scale: number } {
  const { yaw, pitch, zoom, offsetX, offsetY } = camera;
  const { width, height } = viewport;
  const yawSin = Math.sin(yaw);
  const yawCos = Math.cos(yaw);
  const pitchSin = Math.sin(pitch);
  const pitchCos = Math.cos(pitch);
  const x = point.x * yawCos + point.z * yawSin;
  const yawDepth = point.z * yawCos - point.x * yawSin;
  const y = point.y * pitchCos - yawDepth * pitchSin;
  const depth = point.y * pitchSin + yawDepth * pitchCos;
  const cameraDistance = 6.5;
  const scale = zoom * cameraDistance / Math.max(1.5, cameraDistance - depth);
  const unit = Math.min(width, height) * 0.29;

  return {
    x: width / 2 + offsetX + x * unit * scale,
    y: height / 2 + offsetY + y * unit * scale,
    depth,
    scale,
  };
}
