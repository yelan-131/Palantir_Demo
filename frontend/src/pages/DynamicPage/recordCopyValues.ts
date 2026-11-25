import type {FieldPolicy} from '@/components/FieldProtection';

export interface RecordCopySource {
  data: Record<string, unknown>;
  field_states?: Record<string, FieldPolicy & {visible?: boolean; readonly?: boolean}>;
}

export function recordCopyValues(
  source: RecordCopySource,
  fields: ReadonlyArray<{field_name: string; skipOnCopy?: boolean}>,
): Record<string, unknown> {
  const entries = fields.flatMap(({field_name, skipOnCopy}) => {
    const policy = source.field_states?.[field_name];
    const value = source.data[field_name];
    if (skipOnCopy || policy?.copyMode !== 'normal' || policy.masked || policy.readonly || policy.visible === false
      || !Object.prototype.hasOwnProperty.call(source.data, field_name) || value === undefined) return [];
    return [[field_name, value] as const];
  });
  return Object.fromEntries(entries);
}
