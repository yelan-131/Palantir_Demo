import { isAxiosError } from 'axios';
import api, { type OntologyObjectInfo, type OntologyRelationInfo } from './api';

export interface ObjectRecordBinding {
  form_id: number;
  key_field: string;
  property_fields: Record<string, string>;
}

export interface ObjectRecordLink {
  source_field: string;
  target_field: string;
}

export interface RuntimeObjectType extends OntologyObjectInfo {
  record_bound?: boolean;
  record_binding?: ObjectRecordBinding | null;
}

export interface RuntimeRelationType extends OntologyRelationInfo {
  record_link?: ObjectRecordLink | null;
}

export interface ObjectBindingForm {
  id: number;
  name: string;
  code: string;
}

export interface ObjectRecord {
  instance_id: string;
  key: string;
  values: Record<string, unknown>;
  updated_at?: string | null;
}

export interface ObjectRecordPage {
  items: ObjectRecord[];
  total: number;
  page: number;
  page_size: number;
  binding_form?: ObjectBindingForm;
}

export interface ObjectPropertySource {
  source_id?: number;
  source_name?: string;
  source_entity?: string;
  source_field?: string;
}

export interface ObjectRelationRecords {
  id: number | string;
  code: string;
  name: string;
  direction: 'outgoing' | 'incoming';
  related_object_id: number;
  related_object_name: string;
  state: 'matched' | 'missing' | 'ambiguous' | 'unbound' | 'restricted';
  total: number;
  records: ObjectRecord[];
}

export interface ObjectRecordDetail extends ObjectRecord {
  binding_form?: ObjectBindingForm;
  sources?: Record<string, ObjectPropertySource | ObjectPropertySource[]>;
  relations: ObjectRelationRecords[];
}

export const objectTypeId = (entry: { id: string; db_id?: number }) => entry.db_id ?? Number(entry.id);

export const loadObjectTypes = () => api.get<{ data: RuntimeObjectType[] }>('/semantic-assets/ontology-objects');

export const loadRelationTypes = () => api.get<{ data: RuntimeRelationType[] }>('/semantic-assets/ontology-relations');

export const bindObjectRecords = (id: number, binding: ObjectRecordBinding) =>
  api.put<{ data: RuntimeObjectType }>(`/semantic-assets/ontology-objects/${id}/record-binding`, binding);

export const bindRelationRecords = (id: number, link: ObjectRecordLink) =>
  api.put<{ data: RuntimeRelationType }>(`/semantic-assets/ontology-relations/${id}/record-link`, link);

export const listObjectRecords = (id: number, params: { q?: string; page: number; page_size: number }) =>
  api.get<{ data: ObjectRecordPage }>(`/semantic-assets/ontology-objects/${id}/records`, { params });

export const readObjectRecord = (id: number, key: string) =>
  api.get<{ data: ObjectRecordDetail }>(`/semantic-assets/ontology-objects/${id}/record`, { params: { key } });

export function objectRuntimeError(error: unknown, fallback: string) {
  if (!isAxiosError(error)) return fallback;
  if (error.response?.status === 403) return '没有查看或配置此对象的权限。';
  if (typeof error.response?.data?.detail === 'string') return error.response.data.detail;
  return fallback;
}
