interface RelationshipQueryRecord {
  object_type_id: number;
  object_key: string;
}

interface RelationshipQueryEdge {
  relation_id: number;
  source_type_id: number;
  source_key: string;
  target_type_id: number;
  target_key: string;
  label: string;
}

export interface RelationshipQuery extends RelationshipQueryRecord {
  object_name: string;
  intent: 'relationships' | 'material_review';
  relation_depth: 1;
  material_parameter_review: boolean;
  evidence_records: Array<RelationshipQueryRecord & { label: string }>;
  comparison_materials: RelationshipQueryRecord[];
  edges?: RelationshipQueryEdge[];
  truncated: boolean;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function parseRecord(value: unknown): RelationshipQueryRecord | undefined {
  const record = asObject(value);
  const typeId = record.object_type_id;
  const key = nonEmptyString(record.object_key);
  if (!positiveInteger(typeId) || !key) return undefined;
  return { object_type_id: typeId, object_key: key };
}

function parseEdge(value: unknown): RelationshipQueryEdge | undefined {
  const { relation_id, source_type_id, source_key, target_type_id, target_key, label } = asObject(value);
  const source = nonEmptyString(source_key);
  const target = nonEmptyString(target_key);
  const name = nonEmptyString(label);
  if (!positiveInteger(relation_id) || !positiveInteger(source_type_id) || !positiveInteger(target_type_id)
    || !source || !target || !name) return undefined;
  return { relation_id, source_type_id, source_key: source, target_type_id, target_key: target, label: name };
}

function parseRelationshipQuery(query: Record<string, unknown>): RelationshipQuery | undefined {
  const source = parseRecord(query);
  const name = nonEmptyString(query.object_name);
  if (!source || !name || query.relation_depth !== 1 || typeof query.material_parameter_review !== 'boolean') return undefined;
  const intent = query.intent ?? 'material_review';
  if (intent !== 'relationships' && intent !== 'material_review') return undefined;
  const evidence = Array.isArray(query.evidence_records) ? query.evidence_records : [];
  const materials = Array.isArray(query.comparison_materials) ? query.comparison_materials : [];
  return {
    ...source,
    object_name: name,
    intent,
    relation_depth: 1,
    material_parameter_review: query.material_parameter_review,
    evidence_records: evidence.flatMap(value => {
      const record = parseRecord(value);
      const label = nonEmptyString(asObject(value).label);
      return record && label ? [{ ...record, label }] : [];
    }),
    comparison_materials: materials.map(parseRecord).filter((record): record is RelationshipQueryRecord => Boolean(record)),
    edges: Array.isArray(query.edges) ? query.edges.map(parseEdge).filter((edge): edge is RelationshipQueryEdge => Boolean(edge)) : undefined,
    truncated: query.truncated === true,
  };
}

export function getRelationshipQuery(payload: unknown): RelationshipQuery | undefined {
  const response = asObject(payload);
  const live = parseRelationshipQuery(asObject(response.relationship_query));
  if (live || !Array.isArray(response.items)) return live;
  const stored = response.items.map(asObject).reverse().find(item =>
    item.type === 'tool_result' && item.status === 'completed'
    && (item.tool === 'graph.query_object_relationships' || item.tool === 'graph.query_material_candidates'));
  return parseRelationshipQuery(asObject(asObject(stored?.payload).relationship_query));
}

export function relationshipQueryParams(query: RelationshipQuery): URLSearchParams {
  const params = new URLSearchParams({
    view: 'graph', relationDepth: String(query.relation_depth), objectType: String(query.object_type_id),
    objectKey: query.object_key, relationshipQuery: query.intent === 'relationships' ? 'relationships' : 'materials',
  });
  if (query.material_parameter_review) params.set('materialParameterReview', '1');
  return params;
}

export function relationshipQueryPath(query: RelationshipQuery): string {
  return `/data-center/objects?${relationshipQueryParams(query)}`;
}

export function isRelationshipGraphLocation(location: { pathname: string; search: string }): boolean {
  return location.pathname === '/data-center/objects' && new URLSearchParams(location.search).get('view') === 'graph';
}
