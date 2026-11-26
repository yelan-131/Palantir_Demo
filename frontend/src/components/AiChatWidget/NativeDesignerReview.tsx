import { useRef, useState } from 'react';
import { Alert, Button } from 'antd';
import { CheckCircleOutlined } from '@/components/Icon/ant';
import { useAiWorkbench } from './context';
import { createUuid } from '@/utils/uuid';
import type { NewFormDraft } from './pageControls';

interface ReviewField {
  field_name: string;
  label: string;
  required: boolean;
  conditional_required?: boolean;
  conditional_visibility?: boolean;
  readonly?: boolean;
  computed?: boolean;
  min?: number;
  max?: number;
  control_type?: string;
  options?: Array<{ label: string }>;
  settings?: { precision?: number; rows?: number; maxFiles?: number; maxFileSize?: number };
}

const controlLabels: Record<string, string> = {
  text: '短文本', textarea: '多行文本', code: '自动编号', select: '选择', relation: '关联记录',
  number: '数值', datetime: '日期与时间', upload: '附件', switch: '是 / 否',
  'editable-table': '明细表格', 'readonly-table': '关联表格',
};

function FieldDetails({ fields }: { fields: ReviewField[] }) {
  if (!fields.length) return null;

  return <details className="ai-confirmation-details">
    <summary>查看 {fields.length} 个字段</summary>
    <dl className="ai-confirmation-field-list">
      {fields.map(field => (
        <div key={field.field_name}>
          <dt>{field.label}</dt>
          <dd>{[
            controlLabels[field.control_type || ''],
            field.conditional_required ? '条件必填' : field.required ? '必填' : '选填',
            field.conditional_visibility && '条件显示',
            field.computed && '公式计算',
            field.readonly && '只读',
            field.settings?.precision !== undefined && `保留 ${field.settings.precision} 位小数`,
            field.settings?.rows && `${field.settings.rows} 行`,
            field.settings?.maxFiles && `最多 ${field.settings.maxFiles} 个文件`,
            field.settings?.maxFileSize && `单个文件最多 ${field.settings.maxFileSize} MB`,
            field.options?.length && field.options.map(option => option.label).join(' / '),
            (field.min !== undefined || field.max !== undefined) && `范围 ${field.min ?? '不限'}～${field.max ?? '不限'}`,
          ].filter(Boolean).join(' · ')}</dd>
        </div>
      ))}
    </dl>
  </details>;
}

/** A review of the live native editor, never a second configuration form. */
export function NativeDesignerReview({ draftId, disabled, applicationName, menuTarget, onSaved }: {
  draftId: string; disabled: boolean; applicationName?: string; menuTarget?: NewFormDraft['menu_target']; onSaved: (formId: number) => void;
}) {
  const { designerContext, getPageController } = useAiWorkbench();
  const locked = useRef(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  if (saved) return <details className="ai-confirmation-receipt">
    <summary><span className="ai-confirmation-receipt-title">表单草稿已创建</span></summary>
    <div className="ai-confirmation-receipt-body">
      {applicationName && <div>草稿已关联应用「{applicationName}」。</div>}
      {menuTarget ? `发布并挂载到「${menuTarget.destination}」需要另行确认。`
        : applicationName ? '应用菜单可另行配置。' : '可继续指定要挂载草稿的应用菜单。'}
    </div>
  </details>;
  if (designerContext?.draft_id !== draftId || !designerContext.review_ready) return null;
  const fields = (designerContext.fields || []) as ReviewField[];
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
      onSaved(Number(state.form_id));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '创建失败，请重试。');
    } finally {
      locked.current = false;
      setSaving(false);
    }
  };
  return <article className="ai-confirmation-card" aria-label="表单搭建最终确认">
    <header className="ai-confirmation-head">
      <h4>创建表单草稿</h4>
      <span className="ai-confirmation-status">待确认</span>
    </header>
    <p className="ai-confirmation-subject">{String(designerContext.form_name || '新表单')}</p>
    <p className="ai-confirmation-meta">
      {applicationName && `确认后将草稿关联到应用「${applicationName}」。`}
      {menuTarget ? `保存后准备「${menuTarget.destination}」的发布挂载确认。`
        : applicationName ? '菜单发布需要另行确认。' : '请复核设计器中的草稿，应用菜单待指定。'}
    </p>
    <FieldDetails fields={fields} />
    {error && <Alert type="error" message={error} />}
    <footer className="ai-confirmation-footer">
      <Button size="small" type="primary" icon={<CheckCircleOutlined />} disabled={disabled || !fields.length} loading={saving} onClick={() => void confirm()}>确认创建草稿</Button>
    </footer>
  </article>;
}

export function NativeLayoutReview({ reviewId, formId, operationCount, fieldName, disabled }: {
  reviewId: string; formId: number; operationCount: number; fieldName?: string; disabled: boolean;
}) {
  const { designerContext, getPageController } = useAiWorkbench();
  const locked = useRef(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  if (saved) return <details className="ai-confirmation-receipt">
    <summary><span className="ai-confirmation-receipt-title">表单草稿已保存</span></summary>
    <div className="ai-confirmation-receipt-body">已保存确认时表单设计器中的全部未保存修改。</div>
  </details>;
  if (designerContext?.form_id !== formId || designerContext.layout_review_id !== reviewId) return null;
  const fields = (designerContext.fields || []) as ReviewField[];

  const confirm = async () => {
    if (locked.current || disabled) return;
    const controller = getPageController(formId);
    if (!controller) { setError('请打开对应的表单设计器。'); return; }
    locked.current = true;
    setSaving(true);
    setError('');
    try {
      const state = await controller({ id: reviewId, type: 'form_designer', form_id: formId, action: 'confirm_layout_draft' });
      if (state.saved !== true || state.form_id !== formId) throw new Error('草稿保存未完成，请检查设计器提示后重试。');
      setSaved(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '草稿保存失败，请重试。');
    } finally {
      locked.current = false;
      setSaving(false);
    }
  };
  const title = fieldName ? '保存表单字段草稿' : '保存表单布局草稿';
  return <article className="ai-confirmation-card" aria-label={title}>
    <header className="ai-confirmation-head">
      <h4>{title}</h4>
      <span className="ai-confirmation-status">待确认</span>
    </header>
    <p className="ai-confirmation-subject">{String(designerContext.form_name || '表单')}</p>
    <p className="ai-confirmation-meta">
      {fieldName ? `已更新字段「${fields.find(field => field.field_name === fieldName)?.label || fieldName}」。` : `已应用 ${operationCount} 项布局操作。`}
      确认将保存设计器中的全部未保存修改。
    </p>
    <FieldDetails fields={fields} />
    {error && <Alert type="error" message={error} />}
    <footer className="ai-confirmation-footer">
      <Button size="small" type="primary" icon={<CheckCircleOutlined />} disabled={disabled} loading={saving} onClick={() => void confirm()}>确认保存草稿</Button>
    </footer>
  </article>;
}
