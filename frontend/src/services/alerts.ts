import axios from 'axios';
import api from './api';

export type AlertStatus = 'pending' | 'acknowledged' | 'in_progress' | 'resolved' | 'closed';
export type AlertAction = 'acknowledge' | 'assign' | 'start' | 'resolve' | 'close';
export interface AlertHistory {
  action?: string;
  actor_name?: string;
  actor?: string;
  comment?: string;
  created_at?: string;
  at?: string;
  time?: string;
  from_status?: string;
  to_status?: string;
  status?: string;
}
export interface AlertRecord {
  id: number;
  alert_id: string;
  title: string;
  device?: string | null;
  level: string;
  source?: string | null;
  occurred_at?: string | null;
  due_at?: string | null;
  owner_id?: number | null;
  owner_name?: string | null;
  status: AlertStatus;
  history?: AlertHistory[];
  resolution?: string | null;
}
export interface AlertList {
  data: AlertRecord[];
  total: number;
  counts: Record<AlertStatus | 'overdue', number>;
  page: number;
  page_size: number;
}
export interface CreateAlert {
  title: string;
  device?: string;
  level: string;
  source: string;
  occurred_at: string;
  due_at?: string;
}
export const listAlerts = (params: { q?: string; status?: string; page: number; page_size: number }) => api.get<AlertList>('/alerts', { params });
export const getAlert = (id: number) => api.get<{ data: AlertRecord }>(`/alerts/${id}`);
export const createAlert = (data: CreateAlert) => api.post<{ data: AlertRecord }>('/alerts', data);
export const actOnAlert = (id: number, data: { action: AlertAction; expected_status: AlertStatus; owner_id?: number; comment: string }) => api.post<{ data: AlertRecord }>(`/alerts/${id}/actions`, data);

export function alertError(error: unknown): string {
  if (!axios.isAxiosError(error)) return '操作失败，请稍后重试。';
  const status = error.response?.status;
  if (status === 403) return '你没有处理此告警的权限，请联系管理员或责任人。';
  if (status === 409) return '告警状态已被其他人更新，已重新加载，请确认最新状态后操作。';
  const detail = error.response?.data?.detail;
  if ((status === 400 || status === 422) && typeof detail === 'string') return detail;
  if (status === 400 || status === 422) return '信息不完整或当前状态不支持此操作，请检查填写内容。';
  if (status === 404) return '告警不存在或已移除，请刷新列表。';
  return error.response ? '告警服务暂时不可用，请稍后重试。' : '无法连接告警服务，请检查本地服务是否运行。';
}
