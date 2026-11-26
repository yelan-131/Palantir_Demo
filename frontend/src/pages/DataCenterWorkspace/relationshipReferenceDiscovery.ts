import type { RuntimeObjectType } from '../../services/objectRuntime';
import type { AttributeDiscoveryComparison, AttributeDiscoveryEvidence } from './relationshipAttributeDiscovery';
import type { RelationshipNode } from './relationshipGraph';

type ReferenceRecord = Pick<RelationshipNode, 'typeId' | 'key' | 'values' | 'maskedFields' | 'recordMetadata'>;
type ReferenceModel = Pick<RuntimeObjectType, 'fields' | 'record_binding'>;

interface ReferenceField {
  code: string;
  label: string;
  dimension: string;
  value: string | number;
  normalizedValue: string;
}

export interface RelationshipReferenceProfile {
  typeId: number;
  identifier?: ReferenceField;
  references: readonly ReferenceField[];
}

const identifierName = /(?:编号|编码|代码|标识|牌号|型号|料号|批号|件号|货号|\s(?:id|key|no|code|identifier|number|serial))$/u;
const genericIdentifier = /^(?:记录|对象|表单|数据|内部|唯一)(?:编号|编码|代码|标识)$/u;
const genericEnglishIdentifier = /^(?:record|object|form|data|internal|unique)\s(?:id|key|no|code|identifier|number|serial)$/u;
const placeholder = /^(?:未知|待确认|未填写|未记录|unknown|n\/?a|null|undefined|[-–—]+|\*+|[•●]+)$/iu;

function identifierDimension(label: string) {
  const normalized = label.normalize('NFKC').replace(/([a-z\d])([A-Z])/g, '$1 $2').toLowerCase()
    .replace(/[\s_-]+/gu, ' ').trim();
  const suffix = identifierName.exec(normalized);
  if (!suffix || suffix.index === 0 || genericIdentifier.test(normalized) || genericEnglishIdentifier.test(normalized)) return undefined;
  return normalized;
}

function normalizeIdentifier(value: string | number) {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? String(value) : undefined;
  const normalized = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  return normalized && !placeholder.test(normalized) ? normalized : undefined;
}

export function prepareRelationshipReferenceProfile(record: ReferenceRecord, model: ReferenceModel): RelationshipReferenceProfile {
  const hidden = new Set([...(record.maskedFields ?? []), ...(record.recordMetadata?.hidden_property_codes ?? [])]);
  const fields: ReferenceField[] = [];
  const binding = model.record_binding;
  for (const field of model.fields) {
    const code = field.code || field.name;
    if (!code || hidden.has(code) || (field.status !== undefined && field.status !== 'published')) continue;
    if (binding && !binding.property_fields[code]) continue;
    if (!Object.prototype.hasOwnProperty.call(record.values, code)) continue;
    const label = field.label?.trim() || field.name?.trim() || code;
    const dimension = identifierDimension(label);
    const value = record.values[code];
    if (!dimension || (typeof value !== 'string' && typeof value !== 'number')) continue;
    const normalizedValue = normalizeIdentifier(value);
    if (normalizedValue) fields.push({ code, label, dimension, value, normalizedValue });
  }

  const key = normalizeIdentifier(record.key);
  const identifierFields = fields.filter(field => binding
    ? binding.property_fields[field.code] === binding.key_field : field.normalizedValue === key);
  const [candidate] = identifierFields;
  return {
    typeId: record.typeId,
    identifier: identifierFields.length === 1 && candidate.normalizedValue === key ? candidate : undefined,
    references: fields.filter(field => !identifierFields.includes(field)),
  };
}

function referencesIdentifier(reference: ReferenceField, identifier: ReferenceField) {
  if (reference.normalizedValue !== identifier.normalizedValue) return false;
  return reference.dimension === identifier.dimension || reference.dimension.endsWith(` ${identifier.dimension}`)
    || (/^\p{Script=Han}/u.test(identifier.dimension) && reference.dimension.endsWith(identifier.dimension));
}

function referenceEvidence(source: ReferenceField, target: ReferenceField, identifier: ReferenceField): AttributeDiscoveryEvidence {
  return {
    dimension: identifier.dimension,
    sourceCode: source.code, sourceLabel: source.label, sourceValue: source.value,
    targetCode: target.code, targetLabel: target.label, targetValue: target.value,
    rule: 'record-reference', score: 1,
  };
}

export function compareRelationshipReferenceProfiles(
  source: RelationshipReferenceProfile, target: RelationshipReferenceProfile,
): AttributeDiscoveryComparison | undefined {
  if (source.typeId === target.typeId) return undefined;
  const evidence: AttributeDiscoveryEvidence[] = [];
  if (target.identifier) {
    for (const field of source.references) {
      if (referencesIdentifier(field, target.identifier)) evidence.push(referenceEvidence(field, target.identifier, target.identifier));
    }
  }
  if (source.identifier) {
    for (const field of target.references) {
      if (referencesIdentifier(field, source.identifier)) evidence.push(referenceEvidence(source.identifier, field, source.identifier));
    }
  }
  if (!evidence.length) return undefined;
  return { strength: 1, matchingCount: evidence.length, comparedCount: evidence.length, evidence, matchedContext: [] };
}
