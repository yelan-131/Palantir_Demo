import api, { type MappedFormSyncRequest, type MappedFormSyncResult } from './api';

type BindingSpec = Omit<MappedFormSyncRequest, 'source_key'>;

export interface MappedFormSyncRun extends MappedFormSyncResult {
  id: number;
  binding_id: number;
  source_key: string | null;
  status: 'completed' | 'failed';
  started_at: string;
  finished_at: string;
  error_message?: string | null;
}

export interface MappedFormSyncBinding extends BindingSpec {
  id: number;
  source_id: number;
  last_run?: MappedFormSyncRun | null;
}

const bindingsPath = (sourceId: number) => `/data-sources/${sourceId}/mapped-form-sync-bindings`;

export const listMappedFormSyncBindings = (sourceId: number) =>
  api.get<{ data: MappedFormSyncBinding[] }>(bindingsPath(sourceId));

export const saveMappedFormSyncBinding = (sourceId: number, binding: BindingSpec) =>
  api.post<{ data: MappedFormSyncBinding }>(bindingsPath(sourceId), binding);

export const listMappedFormSyncRuns = (sourceId: number, bindingId: number) =>
  api.get<{ data: MappedFormSyncRun[] }>(`${bindingsPath(sourceId)}/${bindingId}/runs`);

export const runMappedFormSync = (sourceId: number, bindingId: number, sourceKey?: string) =>
  api.post<{ data: MappedFormSyncRun }>(`${bindingsPath(sourceId)}/${bindingId}/runs`, { source_key: sourceKey });
