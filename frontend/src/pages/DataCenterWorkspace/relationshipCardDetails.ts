import type { RuntimeObjectType } from '../../services/objectRuntime';
import type { ManufacturingMatchResult } from './manufacturingMatch';
import type { RelationshipNode } from './relationshipGraph';

export type RelationshipCardMatch = {
  status: ManufacturingMatchResult['status'];
  checks: readonly ManufacturingMatchResult['checks'][number][];
  context: string;
};

const propertyLabels: Record<string, string> = {
  product_code: '产品编号', product_name: '产品名称', product_version: '规格版本', grade_code: '牌号编号', grade_name: '牌号名称',
  grade_family: '材料类别', process_version_code: '工艺版本编号', process_name: '规程名称', version_label: '版本',
  fit_code: '方案编号', fit_status: '方案状态', conditions: '适用条件', operation: '工序', aging_method: '试验类型',
  aging_temperature: '老化温度（℃）', aging_hours: '老化时长（h）', strength_min: '强度下限（MPa）',
  forming_temperature_min: '成型温度下限（℃）', forming_temperature_max: '成型温度上限（℃）',
  forming_temperature: '成型设定温度（℃）', tensile_strength: '抗拉强度（MPa）', specimen_code: '试样编号',
  production_line: '产线', planned_quantity: '计划数量', completed_quantity: '完成数量', work_order_id: '工单号', defect_id: '缺陷编号',
};

export function relationshipPropertyLabel(code: string, model?: RuntimeObjectType) {
  const field = model?.fields.find(item => (item.code || item.name) === code);
  const label = field?.label || field?.name;
  return label && label !== code ? label : propertyLabels[code] || code;
}

export function relationshipValue(value: unknown): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'boolean') return value ? '是' : '否';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

export function relationshipNodeLabel(node: RelationshipNode) {
  for (const code of ['name', 'product_name', 'grade_name', 'process_name']) {
    const value = node.values[code];
    if (!node.maskedFields?.includes(code) && typeof value === 'string' && value.trim()) return value.trim();
  }
  return node.key;
}

export const relationshipMatchStatus = {
  candidate: { label: '候选组合', color: 'green' }, pending: { label: '待验证', color: 'gold' }, rejected: { label: '未满足规则', color: 'red' },
};
