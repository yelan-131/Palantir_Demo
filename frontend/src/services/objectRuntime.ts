import { isAxiosError } from 'axios';
import type { ControlSettings } from '../utils/formControls';
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

export interface RelationshipRecordMetadata {
  tags: string[] | null;
  properties: { id: string; name: string; value: string }[];
  property_labels?: Record<string, string>;
  hidden_property_codes?: string[];
  note_markdown?: string;
}

export const relationshipRecordMetadataLimits = {
  tags: 30, tagLength: 60, properties: 60, nameLength: 120, valueLength: 4096, markdownLength: 100_000,
} as const;

export interface ObjectRecord {
  instance_id: string;
  key: string;
  values: Record<string, unknown>;
  masked_fields?: string[];
  updated_at?: string | null;
  record_metadata?: RelationshipRecordMetadata;
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
  evidence?: ObjectRecordLink & { source_value: string; target_value: string };
}

export interface ObjectRecordDetail extends ObjectRecord {
  binding_form?: ObjectBindingForm;
  sources?: Record<string, ObjectPropertySource | ObjectPropertySource[]>;
  relations: ObjectRelationRecords[];
}

export interface RelationshipObjectEditSnapshot {
  fields: {
    code: string;
    label: string;
    field_type: string;
    required: boolean;
    control_type?: string;
    type_settings?: ControlSettings;
    options?: unknown;
  }[];
  values: Record<string, unknown>;
  token: string;
  record_metadata?: RelationshipRecordMetadata;
  can_edit_note_markdown?: boolean;
}

export const objectTypeId = (entry: { id: string; db_id?: number }) => entry.db_id ?? Number(entry.id);

export const loadObjectTypes = (signal?: AbortSignal) =>
  api.get<{ data: RuntimeObjectType[] }>('/semantic-assets/ontology-objects', { signal });

export const loadRelationTypes = () => api.get<{ data: RuntimeRelationType[] }>('/semantic-assets/ontology-relations');

export const bindObjectRecords = (id: number, binding: ObjectRecordBinding) =>
  api.put<{ data: RuntimeObjectType }>(`/semantic-assets/ontology-objects/${id}/record-binding`, binding);

export const bindRelationRecords = (id: number, link: ObjectRecordLink) =>
  api.put<{ data: RuntimeRelationType }>(`/semantic-assets/ontology-relations/${id}/record-link`, link);

export const listObjectRecords = (id: number, params: { q?: string; page: number; page_size: number }, signal?: AbortSignal) =>
  api.get<{ data: ObjectRecordPage }>(`/semantic-assets/ontology-objects/${id}/records`, { params, signal });

export const readObjectRecord = (id: number, key: string, signal?: AbortSignal) =>
  api.get<{ data: ObjectRecordDetail }>(`/semantic-assets/ontology-objects/${id}/record`, { params: { key }, signal });

export const readObjectRecordAttachment = (id: number, key: string, property: string, fileId: string, signal?: AbortSignal) =>
  api.get<Blob>(`/semantic-assets/ontology-objects/${id}/attachments/${encodeURIComponent(property)}/${encodeURIComponent(fileId)}`,
    { params: { key }, responseType: 'blob', signal });

export const readObjectRecordForEdit = (id: number, key: string, signal?: AbortSignal) =>
  api.get<{ data: RelationshipObjectEditSnapshot }>(`/semantic-assets/ontology-objects/${id}/record-edit`, { params: { key }, signal });

export const updateObjectRecord = (id: number, key: string, token: string, data: Record<string, unknown>, expectedValues: Record<string, unknown>,
  metadata?: { record_metadata: RelationshipRecordMetadata; expected_record_metadata: RelationshipRecordMetadata }) =>
  api.put<{ data: { key: string } }>(`/semantic-assets/ontology-objects/${id}/record-edit`,
    { token, data, expected_values: expectedValues, ...metadata }, { params: { key } });

export function objectRuntimeError(error: unknown, fallback: string) {
  if (!isAxiosError(error)) return fallback;
  if (error.response?.status === 403) return '没有查看或配置此对象的权限。';
  if (typeof error.response?.data?.detail === 'string') return error.response.data.detail;
  return fallback;
}
