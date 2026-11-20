import { useEffect, useId, useRef, useState } from 'react';
import { Button, Input, Spin } from 'antd';
import axios from 'axios';
import FieldControl, { type FieldA11yProps } from '@/components/FormWidgets/FieldControl';
import RelationPicker from '@/components/FormWidgets/RelationPicker';
import { getAgentRecordReview, type RecordReviewField, type RecordReviewResponse } from '@/services/api';

interface RecordConfirmationReviewProps {
  runId: string;
  token: string;
  actionIndex: number;
  disabled?: boolean;
  changes: Record<string, unknown>;
  onChange: (changes: Record<string, unknown>, valid: boolean, displayValues?: Record<string, string>) => void;
  onReview: (review: RecordReviewResponse, valid: boolean) => void;
}

function isReadonly(field: RecordReviewField) {
  return field.readonly || field.kind === 'readonly';
}

function isEmpty(value: unknown) {
  return value == null || (typeof value === 'string' && !value.trim()) || (Array.isArray(value) && !value.length);
}

function sameValue(left: unknown, right: unknown): boolean {
  if ((left == null && right == null) || Object.is(left, right)) return true;
  return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
}

function currentValue(field: RecordReviewField, changes: Record<string, unknown>) {
  return !isReadonly(field) && Object.prototype.hasOwnProperty.call(changes, field.name)
    ? changes[field.name]
    : field.value;
}

function decimalValue(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) return;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function fieldError(field: RecordReviewField, value: unknown): string | undefined {
  if (isReadonly(field)) return;
  if (isEmpty(value)) {
    if (field.required) return `请填写${field.label}`;
    return;
  }
  if (field.kind === 'text' || field.kind === 'textarea') {
    if (typeof value !== 'string') return '请输入文本';
    if (typeof field.max_length === 'number' && [...value].length > field.max_length) {
      return `最多输入 ${field.max_length} 个字符`;
    }
  }
  if (field.kind === 'number') {
    const number = decimalValue(value);
    if (number === undefined) return '请输入有效的数值';
    if (typeof field.min === 'number' && number < field.min) return `不得小于 ${field.min}`;
    if (typeof field.max === 'number' && number > field.max) return `不得超过 ${field.max}`;
    const precision = field.precision;
    if (typeof precision === 'number' && precision >= 0 && precision <= 100 && Number(number.toFixed(precision)) !== number) {
      return `最多保留 ${precision} 位小数`;
    }
  }
  if (field.kind === 'select') {
    const selected = field.multiple && Array.isArray(value) ? value : [value];
    if (selected.some(item => !field.options?.some(option => String(option.value) === String(item)))) {
      return '请选择当前可用的选项';
    }
  }
  if (field.kind === 'relation' && typeof value !== 'string' && typeof value !== 'number') return '请选择有效的关联记录';
}

function validReview(review: RecordReviewResponse, changes: Record<string, unknown>) {
  return review.fields.every(field => !fieldError(field, currentValue(field, changes)))
    && Object.keys(changes).every(name => review.fields.some(field => field.name === name && !isReadonly(field)));
}

function displayText(value: unknown): string {
  if (isEmpty(value)) return '—';
  if (Array.isArray(value)) return value.map(displayText).join('、');
  if (typeof value === 'boolean') return value ? '是' : '否';
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '—';
}

function changedDisplayValue(field: RecordReviewField, value: unknown) {
  if (field.kind === 'select' || field.kind === 'relation') {
    const optionLabel = (choice: unknown) => field.options?.find(option => String(option.value) === String(choice))?.label ?? displayText(choice);
    return Array.isArray(value) ? value.map(optionLabel).join('、') || '—' : optionLabel(value);
  }
  return displayText(value);
}

function selectValue(field: RecordReviewField, value: unknown) {
  const optionValue = (choice: unknown) => field.options?.find(option => String(option.value) === String(choice))?.value ?? choice;
  if (field.multiple) return Array.isArray(value) ? value.map(optionValue) : value == null ? [] : [optionValue(value)];
  return value == null ? undefined : optionValue(value);
}

function matchesOriginal(field: RecordReviewField, value: unknown) {
  if (field.kind === 'number') {
    if (fieldError(field, value)) return false;
    if (isEmpty(value)) return isEmpty(field.value);
    return decimalValue(value) === decimalValue(field.value);
  }
  return sameValue(value, field.kind === 'select' ? selectValue(field, field.value) : field.value);
}

function NumberReviewInput({ value, label, unit, disabled, onChange, ...a11y }: FieldA11yProps & {
  value: unknown;
  label: string;
  unit?: string;
  disabled?: boolean;
  onChange: (text: string) => void;
}) {
  const [focusedText, setFocusedText] = useState<string | null>(null);
  const originalText = typeof value === 'number' || typeof value === 'string' ? String(value) : '';
  return <Input
    {...a11y}
    aria-label={label}
    inputMode="decimal"
    value={focusedText ?? originalText}
    suffix={unit}
    disabled={disabled}
    status={a11y['aria-invalid'] === true ? 'error' : undefined}
    onChange={event => {
      const text = event.target.value;
      setFocusedText(text);
      onChange(text);
    }}
    onBlur={() => setFocusedText(null)}
  />;
}

function ReviewEditor({ runId, token, actionIndex, disabled, changes, onChange, onReview }: RecordConfirmationReviewProps) {
  const [review, setReview] = useState<RecordReviewResponse>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const current = useRef({ changes, onReview });
  current.current = { changes, onReview };
  const relationLabels = useRef(new Map<string, { value: unknown; label: string }>());
  const idPrefix = useId();

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    void getAgentRecordReview(runId, { confirmation_token: token, action_index: actionIndex }, controller.signal)
      .then(({ data }) => {
        if (controller.signal.aborted) return;
        if (!Array.isArray(data?.fields)) throw new Error('字段定义无效');
        setReview(data);
        current.current.onReview(data, validReview(data, current.current.changes));
      }).catch(failure => {
        if (controller.signal.aborted) return;
        const detail = axios.isAxiosError(failure) ? failure.response?.data?.detail : undefined;
        const reason = typeof detail === 'string' ? detail : detail?.message;
        setError(typeof reason === 'string' && reason.trim() ? reason : '无法加载可编辑字段，请重试。');
      });
    return () => controller.abort();
  }, [runId, token, actionIndex, retry]);

  if (error) return <div className="ai-record-review">
    <p className="ai-confirmation-error" role="alert">{error}</p>
    <Button size="small" onClick={() => setRetry(value => value + 1)} disabled={disabled}>重新加载</Button>
  </div>;
  if (!review) return <div className="ai-record-review-loading" role="status"><Spin size="small" /> 正在加载可编辑字段</div>;
  if (!review.fields.length) return <p className="ai-confirmation-meta">没有可查看的字段。</p>;

  const visibleValues = {
    ...review.context_data,
    ...Object.fromEntries(review.fields.map(field => [field.name, currentValue(field, changes)])),
  };
  const setValue = (field: RecordReviewField, selection: unknown, label?: string) => {
    const value = selection ?? null;
    const next = { ...changes, [field.name]: value };
    if (matchesOriginal(field, value)) delete next[field.name];
    if (label) relationLabels.current.set(field.name, { value, label });
    else relationLabels.current.delete(field.name);

    const displayValues = Object.fromEntries(review.fields
      .filter(item => Object.prototype.hasOwnProperty.call(next, item.name))
      .map(item => {
        const selected = relationLabels.current.get(item.name);
        return [item.name, selected && sameValue(selected.value, next[item.name])
          ? selected.label : changedDisplayValue(item, next[item.name])];
      }));
    onChange(next, validReview(review, next), displayValues);
  };

  return <div className="ai-record-review">
    {review.fields.map((field, index) => {
      const id = `${idPrefix}-${index}`;
      const value = currentValue(field, changes);
      const invalid = fieldError(field, value);
      const readonly = isReadonly(field);
      const a11y = {
        id,
        'aria-required': field.required || undefined,
        'aria-invalid': Boolean(invalid) || undefined,
        'aria-describedby': invalid ? `${id}-error` : undefined,
      };
      const placeholder = field.kind === 'select' || field.kind === 'relation' ? `请选择${field.label}` : `请输入${field.label}`;
      return <div className="ai-record-review-field" key={field.name}>
        <label className="ai-record-review-label" htmlFor={id}>
          {field.label}{!readonly && field.required && <span aria-hidden="true"> *</span>}
        </label>
        {readonly ? <output id={id} className="ai-record-review-readonly">
          {field.display_value || displayText(field.value)} <small>只读</small>
        </output> : field.kind === 'relation' ? <RelationPicker
          {...a11y}
          modelName=""
          formId={review.form_id}
          fieldName={field.name}
          contextData={visibleValues}
          placeholder={placeholder}
          value={typeof value === 'number' || typeof value === 'string' ? value : undefined}
          onChange={(next, label) => setValue(field, next, label)}
          allowClear={!field.required}
          disabled={disabled}
        /> : field.kind === 'number' ? <NumberReviewInput
          {...a11y}
          label={field.label}
          unit={field.unit}
          value={value}
          onChange={text => setValue(field, text)}
          disabled={disabled}
        /> : <FieldControl
          {...a11y}
          type={field.kind}
          label={field.label}
          value={field.kind === 'select' ? selectValue(field, value) : value}
          onChange={next => setValue(field, next)}
          placeholder={placeholder}
          options={field.options}
          disabled={disabled}
          settings={{
            maxLength: field.max_length,
            rows: 2,
            displayMode: field.kind === 'select' ? 'search' : undefined,
            selectionMode: field.multiple ? 'multiple' : undefined,
            allowClear: !field.required,
          }}
        />}
        {invalid && <p id={`${id}-error`} className="ai-confirmation-error" role="alert">{invalid}</p>}
      </div>;
    })}
  </div>;
}

export default function RecordConfirmationReview(props: RecordConfirmationReviewProps) {
  return <ReviewEditor key={`${props.runId}:${props.actionIndex}:${props.token}`} {...props} />;
}
