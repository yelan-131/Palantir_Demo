import type { RuntimeObjectType } from '../../services/objectRuntime';
import type { RelationshipNode } from './relationshipGraph';
import type { SimilarityFeature, SimilarityNode } from './relationshipSimilarity';

const numericTypes = new Set([
  'number', 'int', 'integer', 'smallint', 'bigint', 'float', 'float32', 'float64',
  'decimal', 'numeric', 'double', 'double_precision', 'real',
]);
const textTypes = new Set(['string', 'text', 'short_text', 'long_text', 'varchar', 'char']);
const categoricalTypes = new Set([
  'enum', 'select', 'single_select', 'boolean', 'bool', 'radio', 'category', 'categorical',
]);
const referenceTypes = new Set(['reference', 'relation', 'foreign_key', 'code', 'uuid']);
const referenceName = /(?:^|_)(?:id|key|uuid|ref|code|no|identifier|record_number|object_number|serial_number)$|(?:编号|编码|代码|主键)$/;
const categoryName = /(?:^|_)(?:status|state|type|category|kind)$|(?:状态|类型|分类)$/;

type FeatureRecord = Pick<RelationshipNode, 'typeId' | 'key' | 'values' | 'maskedFields'>;
type FeatureModel = Pick<RuntimeObjectType, 'fields' | 'similarity_features' | 'record_binding'>;

function normalizedName(name: string): string {
  return name.trim().replace(/([a-z\d])([A-Z])/g, '$1_$2').toLowerCase().replace(/[.\s-]+/g, '_');
}

function inferKind(type: string, value: unknown, reference: boolean, category: boolean): SimilarityFeature['kind'] | undefined {
  const numeric = typeof value === 'number' && Number.isFinite(value);
  const text = typeof value === 'string' && value.trim() !== '';
  if (typeof value === 'boolean') return 'category';
  if (!numeric && !text) return undefined;
  if (categoricalTypes.has(type) || referenceTypes.has(type) || ((reference || category) && textTypes.has(type))) return 'category';
  if (numeric && numericTypes.has(type)) return reference ? 'category' : 'number';
  if (text && textTypes.has(type)) return 'text';
  return undefined;
}

export function relationshipSimilarityInputs(
  record: FeatureRecord,
  model?: FeatureModel,
): Pick<SimilarityNode, 'values' | 'features'> {
  const values = { ...record.values };
  for (const code of record.maskedFields ?? []) delete values[code];

  if (model?.similarity_features?.length) {
    return {
      values,
      features: model.similarity_features.map(feature => ({
        ...feature,
        dimension: feature.dimension
          ? JSON.stringify(['shared', feature.dimension])
          : JSON.stringify([record.typeId, feature.code]),
      })),
    };
  }

  const features: SimilarityFeature[] = [];
  const binding = model?.record_binding;
  for (const field of model?.fields ?? []) {
    const code = field.code || field.name;
    if (!code || code === 'wiki_markdown' || (field.status !== undefined && field.status !== 'published')
      || !Object.prototype.hasOwnProperty.call(values, code)) continue;

    const mappedField = binding?.property_fields[code];
    if (binding && (typeof mappedField !== 'string' || !mappedField || mappedField === binding.key_field)) continue;

    const names = [code, field.label, field.source_field ?? '', mappedField ?? ''].map(normalizedName);
    const type = normalizedName(field.type);
    const reference = referenceTypes.has(type) || names.some(name => referenceName.test(name));
    const value = values[code];
    if (!binding && reference && (typeof value === 'string' || typeof value === 'number') && String(value) === record.key) continue;

    const kind = inferKind(type, value, reference, names.some(name => categoryName.test(name)));
    if (kind) features.push({ code, kind, automatic: true, dimension: JSON.stringify([record.typeId, code]) });
  }

  return { values, features };
}
