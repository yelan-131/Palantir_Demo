import { useRef, useState } from 'react';
import { Alert, Button, Space, Tag } from 'antd';
import { CheckCircleOutlined } from '@ant-design/icons';
import { useAiWorkbench } from './context';
import { createUuid } from '@/utils/uuid';

/** A review of the live native editor, never a second configuration form. */
export function NativeDesignerReview({ draftId, disabled }: { draftId: string; disabled: boolean }) {
  const { designerContext, getPageController } = useAiWorkbench();
  const locked = useRef(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  if (saved) return <article className="ai-skill-action-card ai-confirm-review"><Tag color="green">表单草稿已确认创建</Tag><p>已保存工作区中的最新配置，可在原设计器继续发布。</p></article>;
  if (designerContext?.draft_id !== draftId || !designerContext.review_ready) return null;
  const fields = (designerContext.fields || []) as Array<{ field_name: string; label: string; required: boolean; min?: number; max?: number }>;
  const confirm = async () => {
    if (locked.current || disabled) return;
    const controller = getPageController(0);
    if (!controller) { setError('请先打开此草稿的设计器。'); return; }
    locked.current = true;
    setSaving(true);
    setError('');
    try {
      // This command is deliberately absent from the model's tool schema and SSE queue.
      const state = await controller({ id: createUuid(), type: 'form_designer', form_id: 0, draft_id: draftId, action: 'confirm_draft' });
      if (!state.saved || !state.form_id) throw new Error('创建尚未完成，请检查工作区提示后重试。');
      setSaved(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '创建失败，请重试。');
    } finally {
      locked.current = false;
      setSaving(false);
    }
  };
  return <article className="ai-skill-action-card ai-confirm-review" aria-label="表单搭建最终确认">
    <Space><strong>{String(designerContext.form_name || '新表单')}</strong><Tag color="orange">待最终确认</Tag></Space>
    <p>请复核工作区。确认后创建并保存当前草稿。</p>
    <div className="ai-confirm-field-list">{fields.map(field => <div className="ai-confirm-field-item" key={field.field_name}>
      <span>{field.label}</span><small>{field.required ? '必填' : '选填'}{field.min !== undefined || field.max !== undefined ? ` · 范围 ${field.min ?? '不限'}～${field.max ?? '不限'}` : ''}</small>
    </div>)}</div>
    {error && <Alert type="error" message={error} />}
    <div className="ai-confirm-actions"><Button type="primary" icon={<CheckCircleOutlined />} disabled={disabled || !fields.length} loading={saving} onClick={() => void confirm()}>确认创建草稿</Button></div>
  </article>;
}
