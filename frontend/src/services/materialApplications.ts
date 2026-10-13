import axios from 'axios';
import api from './api';

export type MaterialStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'legacy';
export type MaterialAction = 'submit' | 'approve' | 'reject';
export interface MaterialHistory {
  action: string;
  actor_name?: string;
  created_at?: string;
  comment?: string;
  from_status?: string;
  to_status?: string;
  workflow_id?: number;
}
export interface MaterialApplication {
  id: number;
  request_no: string;
  part_no: string;
  title: string;
  applicant?: string;
  created_by?: number;
  status: MaterialStatus;
  applied_at?: string;
  workflow_id?: number;
  workflow_version?: number;
  current_assignees?: { id: number; name: string }[];
  history?: MaterialHistory[];
  is_legacy: boolean;
  legacy_status?: string;
  approval_source?: string | { route?: string; form_id?: number; record_id?: number };
  can_edit: boolean;
  can_submit: boolean;
  can_approve: boolean;
}
export interface MaterialList {
  data: MaterialApplication[];
  total: number;
  counts: Record<MaterialStatus, number>;
}
export const listMaterialApplications = (params: { q?: string; status?: string; page: number; page_size: number }) => api.get<MaterialList>('/material-applications', { params });
export const getMaterialApplication = (id: number) => api.get<{ data: MaterialApplication }>(`/material-applications/${id}`);
export const createMaterialApplication = (data: { part_no: string; title: string }) => api.post<{ data: MaterialApplication }>('/material-applications', data);
export const editMaterialApplication = (id: number, data: { part_no: string; title: string; expected_status: MaterialStatus }) => api.put<{ data: MaterialApplication }>(`/material-applications/${id}`, data);
export const actOnMaterialApplication = (id: number, action: MaterialAction, data: { expected_status: MaterialStatus; comment?: string }) => api.post<{ data: MaterialApplication }>(`/material-applications/${id}/${action}`, data).then(response => { window.dispatchEvent(new CustomEvent('approval-notifications-changed')); return response; });
export function materialError(error: unknown): string {
  if (!axios.isAxiosError(error)) return '操作失败，请稍后重试。';
  const status = error.response?.status;
  if (status === 403) return '你没有执行此操作的权限，请查看申请人和当前审批人。';
  if (status === 409) {
    const detail = error.response?.data?.detail;
    return typeof detail === 'string' ? `${detail}。正在刷新，请确认最新申请状态。` : '申请状态或审批任务已变化，正在刷新。请按最新状态重新操作。';
  }
  if (status === 404) return '申请不存在或已移除，请刷新列表。';
  const detail = error.response?.data?.detail;
  if ((status === 400 || status === 422) && typeof detail === 'string') return detail;
  if (status === 400 || status === 422) return '填写内容不完整或不符合要求，请检查料号、标题和审批意见。';
  return error.response ? '料号申请服务暂时不可用，请稍后重试。' : '无法连接本地料号申请服务，请检查服务是否运行。';
}
