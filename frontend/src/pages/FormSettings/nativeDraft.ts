import type { NewFormDraft, PageAction } from '@/components/AiChatWidget/pageControls';
import type { DesignerField, EncodingRule, FieldBusinessType, LayoutControl } from './designerTypes';
import { makeEncodingRule } from './encodingRules';
import { isEncodingField } from './fieldBusinessType';
import { getDefaultTypeSettings, getEffectiveControlTypeForControl } from './fieldModel';

export function nativeDraftEncoding(settings: NonNullable<PageAction['properties']>['encoding']): EncodingRule | undefined {
  if (!settings) return undefined;
  const rule = makeEncodingRule();
  const dateLength = settings.date_pattern.length;
  return { ...rule, prefix: settings.prefix, datePattern: settings.date_pattern,
    template: `{PREFIX}-{${settings.date_pattern}}-{SEQ${settings.sequence_length}}`,
    sequenceLength: settings.sequence_length, resetCycle: settings.reset_cycle,
    fixedLength: settings.prefix.length + dateLength + settings.sequence_length + 2,
    segments: [
      { id: 'prefix', name: '业务前缀', type: 'fixed', value: settings.prefix, length: settings.prefix.length, padding: 'none', lockAfterGenerated: true },
      { id: 'date', name: '日期', type: 'date', datePattern: settings.date_pattern, length: dateLength, padding: 'none', lockAfterGenerated: true },
      { id: 'sequence', name: '流水号', type: 'sequence', length: settings.sequence_length, resetCycle: settings.reset_cycle,
        padding: 'leftZero', sequenceStart: 1, sequenceStep: 1, lockAfterGenerated: true },
    ] };
}

export function draftFieldToDesignerField(field: NewFormDraft['fields'][number]): DesignerField {
  const numeric = ['integer', 'decimal'].includes(field.field_type);
  const date = ['date', 'datetime'].includes(field.field_type);
  const types: Record<string, [string, FieldBusinessType]> = {
    text: ['多行文本', 'longText'], code: ['文本 / 自动编号', 'code'],
    enum: ['下拉选择', 'enum'], attachment: ['附件控件', 'attachment'],
    relation: ['关联对象', 'relation'], person: ['人员选择', 'person'],
  };
  const [type, businessType] = types[field.field_type] || (numeric ? ['数值控件', 'number'] : date ? ['日期控件', field.field_type] : ['文本输入', 'text']);
  return { key: field.field_name, name: field.label,
    storageType: field.field_type === 'code' ? 'string' : field.field_type === 'attachment' ? 'json'
      : field.field_type === 'person' ? 'relation' : field.field_type,
    type, businessType: businessType as FieldBusinessType, locked: field.field_type === 'code',
    encodingRule: nativeDraftEncoding(field.encoding),
    defaultValue: field.default_value === undefined ? undefined : String(field.default_value),
    calculationRule: field.computed,
    computed: Boolean(field.computed),
    enumValues: field.options ? { values: field.options } : undefined,
    optionSource: field.reference?.source ?? (field.field_type === 'person' ? 'users'
      : field.options ? JSON.stringify(field.options) : undefined),
    required: field.required, placeholder: field.placeholder || (field.field_type === 'code' ? '保存时自动生成' : `请输入${field.label}`), listVisible: true };
}

export function applyNativeFieldProperties(control: LayoutControl, field: DesignerField | undefined, properties: NonNullable<PageAction['properties']>): LayoutControl {
  const kind = properties.reference ? 'relation' : properties.control_type || getEffectiveControlTypeForControl(control, field);
  const reference = properties.reference;
  const person = field?.businessType === 'person';
  if (properties.label !== undefined && !properties.label.trim()) throw new Error('字段名称不能为空');
  if (properties.readonly === false && (control.encodingRule || isEncodingField(field) || control.computed)) throw new Error('自动生成字段的只读状态不能直接取消');
  if (properties.encoding && !isEncodingField(field)) throw new Error('编号规则只能用于编码字段');
  if (properties.options && kind !== 'select') throw new Error('候选项只能用于选择控件');
  if (properties.computed && !['text', 'textarea', 'number'].includes(kind)) throw new Error('计算字段需要文本或数值控件');
  const settings = { ...(properties.control_type ? getDefaultTypeSettings(kind, field) : control.typeSettings),
    ...properties.settings, ...(properties.min !== undefined ? { min: properties.min } : {}), ...(properties.max !== undefined ? { max: properties.max } : {}) };
  if (settings.min !== undefined && settings.max !== undefined && settings.min > settings.max) throw new Error('最小值不能大于最大值');
  if ((properties.min !== undefined || properties.max !== undefined || properties.settings?.precision !== undefined) && kind !== 'number') throw new Error('只有数字控件支持数值范围和精度');
  if (properties.settings?.rows !== undefined && kind !== 'textarea') throw new Error('只有多行文本支持行数');
  if (settings.displayMode === 'tags' && settings.selectionMode !== 'multiple') throw new Error('标签样式需要多选模式');
  return { ...control, controlType: kind,
    ...(properties.label !== undefined ? { name: properties.label.trim() } : {}),
    ...(properties.width ? { width: properties.width } : {}),
    ...(properties.help_text !== undefined ? { helpText: properties.help_text } : {}),
    ...(properties.options ? { optionSource: JSON.stringify(properties.options), dataSourceKind: 'static' as const } : {}),
    ...(reference ? {
      dataSourceKind: reference.kind,
      optionSource: reference.source,
      referenceLabelField: reference.label_field,
      assignmentRulesEnabled: true,
      assignmentRules: Object.entries(reference.backfill || {}).map(([targetField, sourceField]) => ({
        id: `ai-backfill-${targetField}`, sourceAttribute: `record.${sourceField}`, targetField,
      })),
    } : person && !control.optionSource ? { dataSourceKind: 'organization', optionSource: 'users', referenceLabelField: 'display_name' } : {}),
    ...(properties.computed ? { computed: properties.computed, calculationRulesEnabled: true } : {}),
    ...(properties.presentation ? { presentation: { ...control.presentation, ...properties.presentation } } : {}),
    ...(properties.encoding ? { encodingRule: nativeDraftEncoding(properties.encoding) } : {}),
    ...(properties.placeholder !== undefined ? { placeholder: properties.placeholder }
      : properties.required === true && /^选填/.test(control.placeholder || '')
        ? { placeholder: control.placeholder!.replace(/^选填[，,、：:\s]*/, '') || `请输入${control.name}` } : {}),
    typeSettings: settings,
    rules: { ...control.rules,
      ...(properties.visible_when ? { visible: { enabled: true, conditions: properties.visible_when } } : {}),
      ...(properties.required_when ? { required: { enabled: true, conditions: properties.required_when } }
        : properties.required !== undefined ? { required: { ...control.rules.required, enabled: properties.required } } : {}),
      ...(properties.readonly !== undefined || isEncodingField(field) || properties.computed
        ? { readonly: { ...control.rules.readonly, enabled: isEncodingField(field) || Boolean(properties.computed || properties.readonly) } } : {}) },
  };
}
