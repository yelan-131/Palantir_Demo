import { encodingSegmentTypeOptions } from './designerOptions';
import type { DesignerField, EncodingPadding, EncodingRule, EncodingSegment, EncodingSegmentType } from './designerTypes';
import { isEncodingField } from './fieldBusinessType';

export function makeEncodingRule(field?: DesignerField): EncodingRule {
  const prefix = field?.key.toLowerCase().includes('alert') ? 'AL' : field?.key.toLowerCase().includes('risk') ? 'SR' : 'NO';
  const defaultSegments: EncodingSegment[] = [
    {
      id: 'segment-prefix',
      name: '业务前缀',
      type: 'fixed',
      length: prefix.length,
      value: prefix,
      padding: 'none',
      lockAfterGenerated: true,
    },
    {
      id: 'segment-date',
      name: '年月',
      type: 'date',
      length: 4,
      datePattern: 'YYMM',
      padding: 'none',
      lockAfterGenerated: true,
    },
    {
      id: 'segment-sequence',
      name: '流水号',
      type: 'sequence',
      length: 3,
      resetCycle: 'month',
      padding: 'leftZero',
      sequenceStart: 1,
      sequenceStep: 1,
      lockAfterGenerated: true,
    },
  ];
  return {
    enabled: true,
    template: `{PREFIX}-{YYMM}-{SEQ3}`,
    prefix,
    datePattern: 'YYMM',
    dependencies: [],
    resetCycle: 'month',
    sequenceLength: 3,
    fixedLength: 13,
    dependencySegmentLength: 2,
    regenerateOnDependencyChange: true,
    allowManualOverride: false,
    unique: true,
    segments: defaultSegments,
    generationMode: 'auto',
    generationTiming: 'create',
    uniquenessScope: 'form',
  };
}

export function getEncodingRules(rule?: EncodingRule): EncodingRule[] {
  if (!rule) return [];
  if (Array.isArray(rule.rules)) return rule.rules;
  return [{ ...rule, id: 'default-rule', name: '默认编码规则', conditions: [] }];
}

export function makeEncodingSegment(type: EncodingSegmentType = 'fixed', fields: DesignerField[] = []): EncodingSegment {
  const firstSourceField = fields.find((field) => !isEncodingField(field));
  const base: EncodingSegment = {
    id: `segment-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    name: encodingSegmentTypeOptions.find((item) => item.value === type)?.label || '编码段',
    type,
    length: type === 'sequence' ? 3 : type === 'date' ? 4 : 2,
    padding: type === 'sequence' ? 'leftZero' : 'truncate',
    lockAfterGenerated: true,
  };
  if (type === 'fixed') return { ...base, name: '固定文本', value: 'AL', length: 2, padding: 'none' };
  if (type === 'date') return { ...base, name: '日期', datePattern: 'YYMM', length: 4, padding: 'none' };
  if (type === 'sequence') return { ...base, name: '流水号', resetCycle: 'month', sequenceStart: 1, sequenceStep: 1 };
  if (type === 'organization') return { ...base, name: '组织编码', sourceAttribute: 'org_code', length: 3 };
  return { ...base, name: type === 'masterData' ? '档案编码' : '字段取值', sourceField: firstSourceField?.key, sourceAttribute: 'code' };
}

export function getLegacyEncodingSegments(rule: EncodingRule): EncodingSegment[] {
  const segments: EncodingSegment[] = [];
  if (rule.prefix) {
    segments.push({
      id: 'legacy-prefix',
      name: '业务前缀',
      type: 'fixed',
      length: rule.prefix.length,
      value: rule.prefix,
      padding: 'none',
    });
  }
  if (rule.datePattern && rule.datePattern !== 'none') {
    segments.push({
      id: 'legacy-date',
      name: '日期',
      type: 'date',
      length: getDateSegmentLength(rule.datePattern),
      datePattern: rule.datePattern,
      padding: 'none',
    });
  }
  rule.dependencies.forEach((sourceField, index) => {
    segments.push({
      id: `legacy-field-${sourceField}`,
      name: index === 0 ? '依赖字段' : `依赖字段 ${index + 1}`,
      type: 'field',
      length: rule.dependencySegmentLength || 2,
      sourceField,
      sourceAttribute: 'code',
      padding: 'truncate',
      regenerateOnChange: true,
    });
  });
  segments.push({
    id: 'legacy-sequence',
    name: '流水号',
    type: 'sequence',
    length: rule.sequenceLength || 3,
    resetCycle: rule.resetCycle,
    padding: 'leftZero',
    sequenceStart: 1,
    sequenceStep: 1,
  });
  return segments;
}

export function getEncodingSegments(rule?: EncodingRule): EncodingSegment[] {
  if (!rule) return [];
  if (rule.segments?.length) return rule.segments;
  return getLegacyEncodingSegments(rule);
}

export function getEncodingSegmentTypeLabel(type: EncodingSegmentType) {
  return encodingSegmentTypeOptions.find((item) => item.value === type)?.label || '编码段';
}

export function renderDateSample(pattern?: string) {
  if (pattern === 'none') return '';
  const now = new Date();
  return (pattern || 'YYMM').replace(/YYYY|YY|MM|DD/g, (token) => ({
    YYYY: String(now.getFullYear()), YY: String(now.getFullYear()).slice(-2),
    MM: String(now.getMonth() + 1).padStart(2, '0'), DD: String(now.getDate()).padStart(2, '0'),
  }[token] || token));
}

export function fitSegmentSample(value: string, length: number, padding?: EncodingPadding) {
  if (!length || length <= 0) return '';
  if (value.length === length) return value;
  if (value.length > length) return padding === 'truncate' ? value.slice(0, length) : value;
  if (padding === 'leftZero') return value.padStart(length, '0');
  if (padding === 'rightZero') return value.padEnd(length, '0');
  return value;
}

export function encodingSegmentLengthError(segment: EncodingSegment) {
  const raw = segment.type === 'fixed' ? segment.value || ''
    : segment.type === 'date' ? renderDateSample(segment.datePattern)
    : segment.type === 'sequence' ? String(segment.sequenceStart ?? 1) : '';
  const size = Array.from(raw).length;
  return size > segment.length && segment.padding !== 'truncate' ? `内容 ${size} 个字符，超过 ${segment.length} 位` : '';
}

export function renderEncodingSegmentSample(segment: EncodingSegment, fields: DesignerField[] = []) {
  const length = segment.length || 0;
  if (segment.type === 'fixed') return fitSegmentSample(segment.value || '', length, segment.padding);
  if (segment.type === 'date') return fitSegmentSample(renderDateSample(segment.datePattern), length, segment.padding);
  if (segment.type === 'sequence') return fitSegmentSample(String(segment.sequenceStart || 1), length, segment.padding || 'leftZero');
  if (segment.type === 'organization') return fitSegmentSample(segment.sourceAttribute === 'org_name' ? '制造部' : 'MF', length, segment.padding);
  const sourceField = fields.find((field) => field.key === segment.sourceField);
  return fitSegmentSample(sourceField?.key?.toUpperCase() || 'FIELD', length, segment.padding);
}

export function renderEncodingSample(rule?: EncodingRule, fields: DesignerField[] = []) {
  if (!rule?.enabled) return '不自动生成';
  const segments = getEncodingSegments(rule);
  if (!segments.length) return '请新增编码段';
  return segments.map((segment) => renderEncodingSegmentSample(segment, fields)).join('');
}

export function getDateSegmentLength(pattern?: string) {
  if (!pattern || pattern === 'none') return 0;
  return pattern.length;
}

export function getEncodingComposition(rule?: EncodingRule, fields: DesignerField[] = []) {
  if (!rule?.enabled) return '未启用自动编码';
  const segments = getEncodingSegments(rule);
  if (!segments.length) return '尚未配置编码段';
  const parts = segments.map((segment) => {
    const field = fields.find((item) => item.key === segment.sourceField);
    const source = field ? `：${field.name}` : '';
    return `${segment.name || getEncodingSegmentTypeLabel(segment.type)}${source} ${segment.length || 0} 位`;
  });
  const expected = segments.reduce((total, segment) => total + (segment.length || 0), 0);
  return `${parts.join(' + ')} = ${expected} 位`;
}
