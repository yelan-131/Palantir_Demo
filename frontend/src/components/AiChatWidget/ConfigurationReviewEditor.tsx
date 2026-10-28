import { useState } from 'react';
import { Alert, Button, Checkbox, Input, Modal, Space, Typography } from 'antd';
import { reviseAgentConfiguration } from '@/services/api';

type DraftField = { index: number; label: string; required: boolean };
type Props = {
  runId: string;
  token: string;
  actionIndex: number;
  payload: Record<string, unknown>;
  disabled: boolean;
  onSaved: (items: Array<Record<string, unknown>>) => void;
};

export function ConfigurationReviewEditor({ runId, token, actionIndex, payload, disabled, onSaved }: Props) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [fields, setFields] = useState<DraftField[]>([]);
  const [error, setError] = useState('');
  const begin = () => {
    const form = payload.form as Record<string, unknown> | undefined;
    setName(String(form?.name || ''));
    setFields((Array.isArray(payload.fields) ? payload.fields : []).map((field, index) => ({
      index, label: String(field.label || ''), required: Boolean(field.required),
    })));
    setError('');
    setOpen(true);
  };
  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const { data } = await reviseAgentConfiguration(runId, {
        confirmation_token: token, action_index: actionIndex, form_name: name.trim(), fields,
      });
      onSaved(data.items);
      setOpen(false);
    } catch (failure) {
      const detail = (failure as { response?: { data?: { detail?: unknown } } }).response?.data?.detail;
      setError(typeof detail === 'string' ? detail : '保存修改失败，请检查配置或刷新卡片后重试。');
    } finally {
      setSaving(false);
    }
  };
  return <>
    <Button size="small" disabled={disabled || !token} onClick={begin}>直接编辑</Button>
    <Modal title="编辑待确认配置" open={open} onCancel={() => { if (!saving) setOpen(false); }}
      onOk={() => { void save(); }} okText="保存修改" confirmLoading={saving}
      okButtonProps={{ disabled: disabled || !name.trim() || fields.some(field => !field.label.trim()) }}
      cancelButtonProps={{ disabled: saving }} maskClosable={!saving} closable={!saving}>
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <Typography.Text type="secondary">修改后仍需确认写入；保存修改不会创建表单。</Typography.Text>
        {error ? <Alert type="error" message={error} /> : null}
        <label>表单名称<Input aria-label="表单名称" value={name} maxLength={200} disabled={saving}
          onChange={event => setName(event.target.value)} /></label>
        {fields.map((field, index) => <Space key={field.index} style={{ display: 'flex' }}>
          <Input aria-label={`字段 ${index + 1} 名称`} value={field.label} maxLength={200} disabled={saving}
            onChange={event => setFields(current => current.map(item => item.index === field.index ? { ...item, label: event.target.value } : item))} />
          <Checkbox checked={field.required} disabled={saving}
            onChange={event => setFields(current => current.map(item => item.index === field.index ? { ...item, required: event.target.checked } : item))}>必填</Checkbox>
        </Space>)}
      </Space>
    </Modal>
  </>;
}
