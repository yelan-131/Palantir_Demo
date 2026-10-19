import type { PlatformForm, PlatformFormField } from '@/services/api';

type Response<T> = { data: { data: T } };
export interface ApplicationProperties {
  id: number; name: string; code: string; status: string; default_route: string;
}
export type PropertyValues = Record<string, any>;
type ApplicationApi = {
  adminCreateApplication: (payload: PropertyValues) => Promise<Response<any>>;
  adminUpdateApplication: (id: number, payload: PropertyValues) => Promise<Response<any>>;
};
type FormApi = {
  getPlatformForm: (id: string | number, params: { schema: 'draft'; scope: 'designer' }) => Promise<Response<PlatformForm>>;
  createPlatformForm: (payload: PropertyValues) => Promise<Response<PlatformForm>>;
  updatePlatformForm: (id: string | number, payload: PropertyValues) => Promise<Response<PlatformForm>>;
};

export async function persistApplication(api: ApplicationApi, current: ApplicationProperties, values: PropertyValues, status = current.status) {
  const payload = {
    name: values.name, code: values.code, description: values.description,
    icon: values.icon, default_route: values.default_route || current.default_route || '/',
    sort_order: Number(values.sort_order || 0), is_pinned: Boolean(values.is_pinned), status,
  };
  const response = current.id < 0
    ? await api.adminCreateApplication(payload)
    : await api.adminUpdateApplication(current.id, payload);
  if (!response.data.data?.id) throw new Error('应用保存接口未返回有效编号');
  return response.data.data;
}

export async function persistForm(api: FormApi, current: { id: string; status: string; config?: PropertyValues }, values: PropertyValues): Promise<PlatformForm> {
  // Read the current draft before patching assembly metadata. A separate designer
  // may have saved layouts, labels or rules since this page was opened.
  const latest = /^\d+$/.test(current.id)
    ? (await api.getPlatformForm(current.id, { schema: 'draft', scope: 'designer' })).data.data
    : undefined;
  if (latest && values.code !== undefined && values.code !== latest.code) {
    throw new Error('已保存的表单编码不能修改，请创建新的表单或看板');
  }
  const config = {
    ...(latest?.config || current.config || {}),
    assemblyKind: values.category === 'analytics' ? 'analysis' : 'interaction',
    analyticsMode: values.mode, entityLabel: values.entity,
    structureLocked: true,
  };
  // Publication must use /publish so that the schema/layout version is saved.
  // Editing the metadata must never change a form's lifecycle state.
  const payload = { name: values.name, description: values.description, status: latest?.status || 'draft', config };
  const response = latest
    ? await api.updatePlatformForm(current.id, payload)
    : await api.createPlatformForm({ ...payload, code: values.code });
  const saved = response.data.data;
  if (!saved?.id) throw new Error('表单保存接口未返回有效编号');
  return { ...saved, fields: saved.fields ?? latest?.fields ?? [] };
}

export function propertyError(error: any, fallback: string): string {
  const detail = error?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (detail?.message) return detail.message;
  return error?.message || fallback;
}

export function assemblyFieldPayload(values: { label: string; code: string; type: string; maxBytes?: number | null; options?: string }, order: number) {
  const businessType = values.type;
  const storage = businessType === 'person' ? 'string' : businessType === 'attachment' ? 'json' : businessType;
  const options = [...new Set((values.options || '').split(/\r?\n/).map(value => value.trim()).filter(Boolean))];
  if (businessType === 'enum' && !options.length) throw new Error('请至少填写一个单选选项');
  return {
    field_name: values.code.trim(), label: values.label.trim(), field_type: storage, business_type: businessType,
    ...(supportsFieldByteLimit(values.type) && values.maxBytes != null ? { validation: fieldByteValidation({}, values.maxBytes) } : {}),
    sort_order: order, ...(businessType === 'enum' ? { enum_values: { values: options } } : {}),
  };
}

// Patch only controls exposed by this drawer. Designer settings and storage
// identifiers must survive ordinary label/visibility edits unchanged.
export function assemblyFieldUpdatePayload(values: { label: string; maxBytes?: number | null; options?: string }, current: PlatformFormField) {
  if (current.archived) throw new Error('此字段已删除，请刷新后重试');
  const payload: Record<string, unknown> = {
    label: values.label.trim(),
  };
  if (supportsFieldByteLimit(current.business_type || current.field_type)) {
    payload.validation = fieldByteValidation(current.validation || {}, values.maxBytes);
  }
  if ((current.business_type || current.field_type) === 'enum' && values.options !== undefined) {
    const options = [...new Set(values.options.split(/\r?\n/).map(value => value.trim()).filter(Boolean))];
    if (!options.length) throw new Error('请至少填写一个单选选项');
    payload.enum_values = { ...current.enum_values, values: options };
  }
  return payload;
}

export function supportsFieldByteLimit(type?: string) {
  return ['string', 'text', 'enum', 'code', 'person'].includes(type || '');
}
export function fieldStorageSize(type?: string, maxBytes?: unknown): string {
  const fixed: Record<string, number> = { integer: 4, int: 4, number: 8, decimal: 8, float: 8, boolean: 1, date: 4, datetime: 8 };
  if (type && fixed[type]) return `${fixed[type]} 字节`;
  return typeof maxBytes === 'number' && maxBytes > 0 ? `最多 ${maxBytes} 字节` : '变长 · 未设上限';
}
function fieldByteValidation(current: Record<string, unknown>, maxBytes?: number | null) {
  const validation = { ...current };
  delete validation.maxBytes;
  if (maxBytes != null) {
    if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 1073741823) throw new Error('字段字节上限必须为 1 至 1073741823 之间的整数');
    validation.maxBytes = maxBytes;
  }
  return validation;
}
