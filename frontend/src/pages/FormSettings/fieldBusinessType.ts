import { fieldBusinessTypeOptions } from './designerOptions';
import type { DesignerField, FieldBusinessType } from './designerTypes';

export function inferBusinessTypeFromLegacyType(type = ''): FieldBusinessType {
  if (type === 'code' || type.includes('编码')) return 'code';
  if (type.includes('日期')) return 'datetime';
  if (type.includes('数字') || type.includes('数值')) return 'number';
  if (type.includes('下拉') || type.includes('选择')) return 'enum';
  if (type.includes('人员')) return 'person';
  if (type.includes('关联')) return 'relation';
  if (type.includes('附件')) return 'attachment';
  if (type.includes('多行')) return 'longText';
  return 'text';
}

export function getFieldBusinessType(field?: DesignerField): FieldBusinessType {
  if (!field) return 'text';
  return field.businessType || inferBusinessTypeFromLegacyType(field.type);
}

export function getFieldBusinessTypeLabel(field?: DesignerField) {
  const businessType = getFieldBusinessType(field);
  return fieldBusinessTypeOptions.find((item) => item.value === businessType)?.label || '文本';
}

export const fieldStorageTypeLabels: Record<string, string> = {
  string: '文本 string',
  text: '长文本 text',
  number: '数值 number',
  integer: '整数 integer',
  decimal: '小数 decimal',
  float: '浮点 float',
  boolean: '布尔 boolean',
  date: '日期 date',
  datetime: '日期时间 datetime',
  enum: '枚举 enum',
  relation: '关联 relation',
  json: 'JSON json',
};

export function getFieldStorageTypeLabel(field?: DesignerField) {
  if (!field) return '未绑定字段';
  const storageType = mapDesignerFieldType(field);
  return fieldStorageTypeLabels[storageType] || storageType;
}

export function isEncodingField(field?: DesignerField) {
  return getFieldBusinessType(field) === 'code';
}

export function mapDesignerFieldType(field: DesignerField) {
  if (field.storageType) return field.storageType;
  const businessType = getFieldBusinessType(field);
  if (businessType === 'code') return 'string';
  if (businessType === 'date' || businessType === 'datetime') return 'datetime';
  if (businessType === 'number') return 'number';
  if (businessType === 'enum') return 'enum';
  if (businessType === 'attachment') return 'json';
  if (businessType === 'longText') return 'text';
  return 'string';
}
