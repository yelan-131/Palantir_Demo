import type { PlatformForm } from '@/services/api';

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
  const config = {
    ...(latest?.config || current.config || {}),
    assemblyKind: values.category === 'analytics' ? 'analysis' : 'interaction',
    analyticsMode: values.mode, entityLabel: values.entity, ownerLabel: values.owner,
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
