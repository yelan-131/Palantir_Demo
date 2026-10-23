export type FieldType = 'text' | 'select' | 'number' | 'textarea';

export interface DesignField {
  id: string;
  key: string;
  label: string;
  type: FieldType;
  width: 25 | 33 | 50 | 75 | 100;
  required: boolean;
  hidden?: boolean;
  readonly?: boolean;
  placeholder?: string;
  helpText?: string;
  options?: string[];
  labelPosition?: 'top' | 'left';
}

export interface FormDesign {
  title: string;
  description: string;
  fields: DesignField[];
}

export const initialDesign: FormDesign = {
  title: '物料主数据',
  description: '统一维护物料信息，为采购、库存与生产提供基础数据。',
  fields: [
    { id: 'material-code', key: 'material_code', label: '物料编码', type: 'text', width: 50, required: true, readonly: true, placeholder: '系统自动生成', helpText: '物料编码由系统生成，用于唯一识别物料。' },
    { id: 'material-name', key: 'material_name', label: '物料名称', type: 'text', width: 50, required: true, placeholder: '例如：冷轧钢板' },
    { id: 'material-type', key: 'material_type', label: '物料类型', type: 'select', width: 50, required: false, placeholder: '请选择物料类型', options: ['原材料', '半成品', '成品', '辅料'] },
    { id: 'spec-model', key: 'spec_model', label: '规格型号', type: 'text', width: 50, required: false, placeholder: '例如：SPCC 1.2 × 1250 mm' },
    { id: 'unit', key: 'unit', label: '计量单位', type: 'select', width: 33, required: false, placeholder: '请选择单位', options: ['件', '千克', '吨', '米', '平方米'] },
    { id: 'safety-stock', key: 'safety_stock', label: '安全库存', type: 'number', width: 33, required: false, placeholder: '0', helpText: '库存低于此数量时提醒补货。' },
    { id: 'status', key: 'status', label: '物料状态', type: 'select', width: 33, required: false, options: ['启用', '停用'] },
  ],
};

let fallbackSequence = 0;

export function createField(type: FieldType): DesignField {
  const token = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${++fallbackSequence}`;
  const labels: Record<FieldType, string> = { text: '文本字段', select: '下拉选择', number: '数字字段', textarea: '多行文本' };
  return {
    id: `field-${token}`,
    key: `field_${token.replace(/-/g, '_')}`,
    label: labels[type],
    type,
    width: type === 'textarea' ? 100 : 50,
    required: false,
    labelPosition: 'top',
    placeholder: type === 'select' ? '请选择' : '请输入',
    ...(type === 'select' ? { options: ['选项一', '选项二'] } : {}),
  };
}

/** Move to the target's original position; never edit the supplied field array. */
export function moveField(fields: DesignField[], sourceId: string, targetId: string): DesignField[] {
  const sourceIndex = fields.findIndex(field => field.id === sourceId);
  const targetIndex = fields.findIndex(field => field.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return fields;
  const moved = [...fields];
  const [source] = moved.splice(sourceIndex, 1);
  moved.splice(targetIndex, 0, source);
  return moved;
}

export function validateRecord(design: FormDesign, values: Record<string, string | number>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of design.fields) {
    if (field.hidden) continue;
    const value = values[field.key];
    const empty = value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
    if (empty) {
      if (field.required) errors[field.key] = `${field.type === 'select' ? '请选择' : '请填写'}${field.label}`;
      continue;
    }
    if (field.type === 'number') {
      const numeric = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(numeric)) errors[field.key] = `请输入有效的${field.label}`;
      else if (field.key === 'safety_stock' && numeric < 0) errors[field.key] = '安全库存不能小于 0';
    } else if (field.type === 'select' && field.options && !field.options.includes(String(value))) {
      errors[field.key] = `请重新选择${field.label}`;
    }
  }
  return errors;
}
