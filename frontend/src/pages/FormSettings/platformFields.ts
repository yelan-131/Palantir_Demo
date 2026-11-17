import type { CalculationRule } from '@/utils/formCalculations';
import type { DefaultValueRule } from '@/utils/formDefaults';
import type { PlatformFormField } from '@/services/api';
import { enumOptions } from '@/utils/formControls';
import type { DesignerField, EncodingRule, FieldBusinessType } from './designerTypes';
import { makeEncodingRule } from './encodingRules';

export function getPlatformUiString(field: PlatformFormField, key: string) {
  const value = field.ui_config?.[key];
  return typeof value === 'string' ? value : undefined;
}

export function getPlatformFieldString(field: PlatformFormField, key: 'business_type' | 'control_type' | 'data_source') {
  const value = field[key];
  return typeof value === 'string' ? value : undefined;
}

export function getPlatformEnumValues(field: PlatformFormField) {
  return enumOptions(field.enum_values).map(item=>String(item.value));
}

export function getPlatformValidationText(field: PlatformFormField) {
  const validation = field.validation;
  if (!validation) return undefined;
  const messageText = validation.message || validation.detail || validation.rule;
  if (typeof messageText === 'string') return messageText;
  return undefined;
}

export function getPlatformEncodingRule(field: PlatformFormField): EncodingRule | undefined {
  const rawRule = field.encoding_rule || field.ui_config?.encodingRule;
  if (!rawRule || typeof rawRule !== 'object' || Array.isArray(rawRule)) return undefined;
  const fallbackField: DesignerField = {
    key: field.field_name,
    name: field.label || field.field_name,
    type: '文本 / 自动编号',
    businessType: 'code',
    placeholder: `自动生成${field.label || field.field_name}`,
  };
  const fallback = makeEncodingRule(fallbackField);
  const rule = rawRule as Partial<EncodingRule>;
  return {
    ...fallback,
    ...rule,
    segments: Array.isArray(rule.segments) ? rule.segments : fallback.segments,
  };
}

export function mapPlatformBusinessType(rawBusinessType: string | undefined, rawType: string, controlType?: string, dataSource?: string, widget?: string): FieldBusinessType {
  if (rawBusinessType === 'code' || controlType === 'code' || rawType === 'code') return 'code';
  if (rawBusinessType === 'enum' || rawType === 'enum') return 'enum';
  if (rawBusinessType === 'datetime' || rawType === 'datetime') return 'datetime';
  if (rawBusinessType === 'date' || rawType === 'date') return 'date';
  if (['number', 'integer', 'int', 'decimal', 'float'].includes(rawBusinessType || '') || ['number', 'integer', 'int', 'decimal', 'float'].includes(rawType)) return 'number';
  if (rawBusinessType === 'person') return 'person';
  if (rawBusinessType === 'attachment') return 'attachment';
  if (dataSource === 'users') return 'person';
  if (rawBusinessType === 'relation' || rawType === 'relation' || Boolean(dataSource)) return 'relation';
  if (widget === 'upload') return 'attachment';
  if (rawType === 'json' && dataSource) return 'relation';
  if (rawType === 'text') return 'longText';
  return 'text';
}

export function mapPlatformFieldType(field: PlatformFormField): Pick<DesignerField, 'type' | 'businessType' | 'optionSource' | 'placeholder' | 'encodingRule'> {
  const rawType = String(field.field_type || 'string');
  const controlType = getPlatformFieldString(field, 'control_type') || getPlatformUiString(field, 'controlType');
  const widget = getPlatformUiString(field, 'widget');
  const dataSource = getPlatformFieldString(field, 'data_source') || getPlatformUiString(field, 'dataSource') || getPlatformUiString(field, 'relation');
  const rawBusinessType = getPlatformFieldString(field, 'business_type') || getPlatformUiString(field, 'businessType');
  const encodingRule = getPlatformEncodingRule(field);
  const businessType = encodingRule ? 'code' : mapPlatformBusinessType(rawBusinessType, rawType, controlType, dataSource, widget);
  const enumChoices = enumOptions(field.enum_values);
  const enumSource = enumChoices.length ? JSON.stringify(enumChoices) : getPlatformEnumValues(field).join('、') || undefined;
  const label = field.label || field.field_name;

  if (businessType === 'code') {
    return { type: '文本 / 自动编号', businessType, placeholder: `自动生成${label}`, encodingRule };
  }
  if (businessType === 'enum') {
    return { type: '下拉选择', businessType, optionSource: enumSource, placeholder: `请选择${label}` };
  }
  if (businessType === 'datetime' || businessType === 'date') {
    return { type: '日期控件', businessType, placeholder: `选择${label}` };
  }
  if (businessType === 'number') {
    return { type: '数值控件', businessType, placeholder: `请输入${label}` };
  }
  if (businessType === 'person' || businessType === 'relation') {
    return {
      type: '关联对象',
      businessType,
      optionSource: businessType === 'person' ? '组织人员' : dataSource,
      placeholder: `选择${label}`,
    };
  }
  if (businessType === 'attachment' || (rawType === 'json' && field.field_name.toLowerCase().includes('evidence'))) {
    return { type: '附件控件', businessType: 'attachment', placeholder: `上传${label}` };
  }
  if (businessType === 'longText') {
    return { type: '多行文本', businessType, placeholder: `填写${label}` };
  }
  return { type: '文本输入', businessType, placeholder: `请输入${label}` };
}

export function platformFieldsToDesignerFields(fields?: PlatformFormField[]) {
  return (fields || [])
    .filter((field) => !field.archived)
    .sort((left, right) => (left.sort_order || 0) - (right.sort_order || 0))
    .map((field): DesignerField => {
      const mapped = mapPlatformFieldType(field);
      return {
        key: field.field_name,
        enumValues: field.enum_values,
        storageType: field.field_type,
        maxBytes: typeof field.validation?.maxBytes === 'number' ? field.validation.maxBytes : undefined,
        defaultRule: field.ui_config?.defaultRule as DefaultValueRule | undefined,
        computed: Boolean(field.ui_config?.computed),
        calculationRule: field.ui_config?.computed as CalculationRule | undefined,
        name: field.label || field.field_name,
        type: mapped.type,
        businessType: mapped.businessType,
        placeholder: mapped.placeholder,
        locked: mapped.businessType === 'code',
        required: field.required,
        listVisible: field.visible_in_list,
        searchable: field.searchable,
        sortable: field.sortable,
        defaultValue: field.default_value || undefined,
        validation: getPlatformValidationText(field),
        optionSource: mapped.optionSource,
        encodingRule: mapped.encodingRule,
      };
    });
}

export function areDesignerFieldsSame(left?: DesignerField[], right?: DesignerField[]) {
  if (!left || !right) return false;
  if (left.length !== right.length) return false;
  return left.every((field, index) => {
    const other = right[index];
    return other
      && field.key === other.key
      && field.name === other.name
      && field.storageType === other.storageType
      && field.maxBytes === other.maxBytes
      && field.computed === other.computed
      && JSON.stringify(field.calculationRule) === JSON.stringify(other.calculationRule)
      && JSON.stringify(field.defaultRule) === JSON.stringify(other.defaultRule)
      && field.type === other.type
      && field.businessType === other.businessType
      && field.placeholder === other.placeholder
      && field.locked === other.locked
      && field.required === other.required
      && field.listVisible === other.listVisible
      && field.searchable === other.searchable
      && field.sortable === other.sortable
      && field.defaultValue === other.defaultValue
      && field.validation === other.validation
      && field.optionSource === other.optionSource
      && JSON.stringify(field.encodingRule || null) === JSON.stringify(other.encodingRule || null);
  });
}
