import axios from 'axios';
import api from './api';

export interface ApprovalStage {
  name: string;
  approver_ids: number[];
  approval_mode: 'single' | 'countersign';
}

export interface FormApprovalSettings {
  enabled: boolean;
  managed: boolean;
  editable: boolean;
  stages: ApprovalStage[];
  available_users: { id: number; name: string }[];
  workflow_id?: number | null;
  workflow_version?: number | null;
  version?: number | null;
  trigger_action?: string | null;
  requires_replacement: boolean;
  existing_workflows: { id: number; name: string; trigger_action: string }[];
}

export const getFormApprovalSettings = (formId: number) =>
  api.get<{ data: FormApprovalSettings }>(`/forms/${formId}/approval-settings`);

export const saveFormApprovalSettings = (formId: number, data: {
  enabled: boolean;
  stages: ApprovalStage[];
  replace_existing: boolean;
  expected_version?: number | null;
}) => api.put<{ data: FormApprovalSettings }>(`/forms/${formId}/approval-settings`, data);

export function formApprovalError(error: unknown): string {
  if (!axios.isAxiosError(error)) return '审批设置保存失败，请稍后重试。';
  const detail = error.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (error.response?.status === 403) return '仅管理员可查看和修改审批设置。';
  if (error.response?.status === 409) return '审批配置已发生变化，请刷新后重新设置。';
  return '无法加载或保存审批设置，请检查服务连接后重试。';
}
