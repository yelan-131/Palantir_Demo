import { DeleteOutlined, UploadOutlined } from '@/components/Icon/ant';
import { Button, Form, Input, InputNumber, message } from 'antd';
import { useLayoutEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import FieldControl from '../../components/FormWidgets/FieldControl';
import type { RelationshipObjectEditSnapshot } from '../../services/objectRuntime';
import { normalizeText, type ControlSettings } from '../../utils/formControls';
import './relationshipObjectEditor.css';

export type { RelationshipObjectEditSnapshot } from '../../services/objectRuntime';

export const RELATIONSHIP_OBJECT_EDITOR_FORM_ID = 'relationship-object-editor';

interface RelationshipObjectEditorFormProps {
  snapshot?: RelationshipObjectEditSnapshot;
  onSubmit?: (data: Record<string, unknown>, expectedValues: Record<string, unknown>) => void;
  disabled?: boolean;
  children: ReactNode;
}

type EditField = RelationshipObjectEditSnapshot['fields'][number];

const integerTypes = new Set(['int', 'integer']);
const numberTypes = new Set(['int', 'integer', 'float', 'decimal', 'number']);

export function isRelationshipMarkdownField(field: EditField) {
  return field.code === 'wiki_markdown' || field.control_type === 'markdown';
}

function controlType(field: EditField) {
  if (isRelationshipMarkdownField(field)) return 'textarea';
  if (field.field_type === 'enum' || field.control_type === 'select') return 'select';
  if (numberTypes.has(field.field_type)) return 'number';
  if (field.field_type === 'boolean') return 'switch';
  if (field.field_type === 'date' || field.field_type === 'datetime') return 'datetime';
  if (field.control_type === 'text' || field.control_type === 'textarea') return field.control_type;
  return field.field_type === 'text' ? 'textarea' : 'text';
}

function controlSettings(field: EditField): ControlSettings {
  const settings = field.type_settings ?? {};
  if (field.field_type === 'date' || field.control_type === 'date') return { ...settings, dateMode: 'date' };
  if (integerTypes.has(field.field_type)) return { ...settings, precision: 0 };
  if (isRelationshipMarkdownField(field)) {
    return { rows: 5, ...settings, trimMode: undefined, caseMode: undefined };
  }
  return settings;
}

export function RelationshipMarkdownInput({ value, onChange, disabled, maxLength, importTarget, onImportingChange }: {
  value?: string | null;
  onChange?: (value: string) => void;
  disabled?: boolean;
  maxLength?: number;
  importTarget?: HTMLElement | null;
  onImportingChange?: (importing: boolean) => void;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const importRevision = useRef(0);
  const latestOnChange = useRef(onChange);
  const [importing, setImporting] = useState(false);
  useLayoutEffect(() => { latestOnChange.current = onChange; }, [onChange]);
  useLayoutEffect(() => () => { importRevision.current += 1; }, []);

  async function importMarkdown(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || !onChange || disabled) return;
    const revision = ++importRevision.current;
    setImporting(true);
    onImportingChange?.(true);
    try {
      const source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer());
      if (revision !== importRevision.current) return;
      if (maxLength !== undefined && source.length > maxLength) {
        message.error(`Markdown 最多 ${maxLength} 个字符。`);
        return;
      }
      latestOnChange.current?.(source);
    } catch {
      if (revision === importRevision.current) message.error('无法读取文件，请选择 UTF-8 编码的 Markdown。');
    } finally {
      if (revision === importRevision.current) {
        setImporting(false);
        onImportingChange?.(false);
      }
    }
  }

  return <div className="relationship-object-editor__markdown">
    {importTarget && createPortal(<>
      <Button type="text" htmlType="button" icon={<UploadOutlined />} loading={importing}
        aria-label="导入 Markdown" title="导入 Markdown" disabled={disabled} onClick={() => picker.current?.click()}>导入</Button>
      <input ref={picker} className="relationship-object-editor__file-picker" type="file"
        accept=".md,.markdown,text/markdown" hidden onChange={event => void importMarkdown(event)} />
    </>, importTarget)}
    <Input.TextArea aria-label="Markdown" value={value ?? ''} onChange={event => onChange?.(event.target.value)}
      rows={6} maxLength={maxLength} disabled={disabled || importing} />
  </div>;
}

function normalizedValue(field: EditField, value: unknown): unknown {
  if (value == null || value === '' || (Array.isArray(value) && !value.length)) return null;
  if (typeof value === 'string' && numberTypes.has(field.field_type)) {
    const number = Number(value);
    return value.trim() && Number.isFinite(number) ? number : value;
  }
  if (typeof value === 'string' && ['text', 'textarea'].includes(controlType(field))) {
    return normalizeText(value, controlSettings(field)) || null;
  }
  return value;
}

function sameValue(left: unknown, right: unknown) {
  return left === right || (Array.isArray(left) && Array.isArray(right)
    && left.length === right.length && left.every((value, index) => value === right[index]));
}

function validationMessage(field: EditField, value: unknown) {
  const next = normalizedValue(field, value);
  if (next === null) return field.required ? `请填写${field.label}` : undefined;
  const settings = controlSettings(field);
  if (numberTypes.has(field.field_type)) {
    if (typeof next !== 'number' || !Number.isFinite(next)) return '请输入有效数字';
    if (integerTypes.has(field.field_type) && !Number.isInteger(next)) return '请输入整数';
    if (settings.min !== undefined && next < settings.min) return `最小值为 ${settings.min}`;
    if (settings.max !== undefined && next > settings.max) return `最大值为 ${settings.max}`;
  }
  if (typeof next === 'string' && ['text', 'textarea'].includes(controlType(field))) {
    if (settings.minLength !== undefined && next.length < settings.minLength) return `至少输入 ${settings.minLength} 个字符`;
    if (settings.maxLength !== undefined && next.length > settings.maxLength) return `最多输入 ${settings.maxLength} 个字符`;
  }
}

export function RelationshipObjectEditorForm({ snapshot, onSubmit, disabled = false, children }: RelationshipObjectEditorFormProps) {
  const [form] = Form.useForm<Record<string, unknown>>();

  useLayoutEffect(() => {
    form.resetFields();
    if (snapshot) form.setFields(snapshot.fields.map(({ code }) => ({ name: code, value: snapshot.values[code] })));
  }, [form, snapshot]);

  function submit(values: Record<string, unknown>) {
    if (disabled || !snapshot || !onSubmit) return;
    const data: Record<string, unknown> = {};
    const expectedValues: Record<string, unknown> = {};
    for (const field of snapshot.fields) {
      if (!Object.prototype.hasOwnProperty.call(values, field.code)) continue;
      const original = snapshot.values[field.code] ?? null;
      const next = normalizedValue(field, values[field.code]);
      if (sameValue(next, normalizedValue(field, original))) continue;
      data[field.code] = next;
      expectedValues[field.code] = original;
    }
    onSubmit(data, expectedValues);
  }

  return <Form<Record<string, unknown>>
    form={form}
    id={RELATIONSHIP_OBJECT_EDITOR_FORM_ID}
    name={RELATIONSHIP_OBJECT_EDITOR_FORM_ID}
    className="relationship-object-editor"
    size="small"
    disabled={disabled}
    onFinish={submit}
  >
    {children}
  </Form>;
}

export function RelationshipObjectEditField({ field, disabled, markdownImportTarget, onMarkdownImportingChange }: {
  field: EditField;
  disabled?: boolean;
  markdownImportTarget?: HTMLElement | null;
  onMarkdownImportingChange?: (importing: boolean) => void;
}) {
  const type = controlType(field);
  const settings = controlSettings(field);
  const nullableBoolean = type === 'switch' && !field.required;
  const inlineSettings: ControlSettings = type === 'select' ? {
    ...settings,
    displayMode: settings.displayMode === 'radio' ? undefined : settings.displayMode,
    tagCollapse: 'responsive',
  } : settings;
  const booleanOptions = [
    { value: 'true', label: settings.checkedText || '是' },
    { value: 'false', label: settings.uncheckedText || '否' },
  ];

  return <Form.Item
    name={field.code}
    className="relationship-object-editor__field"
    required={field.required}
    getValueProps={nullableBoolean ? (value: boolean | null) => ({ value: value == null ? undefined : String(value) }) : undefined}
    getValueFromEvent={nullableBoolean ? (value?: string) => value == null ? null : value === 'true' : undefined}
    rules={[{ validator: async (_, value) => {
      const error = validationMessage(field, value);
      if (error) throw new Error(error);
    } }]}
  >
    {isRelationshipMarkdownField(field)
      ? <RelationshipMarkdownInput maxLength={settings.maxLength} disabled={disabled}
        importTarget={markdownImportTarget} onImportingChange={onMarkdownImportingChange} />
      : type === 'number' ? <InputNumber className="relationship-object-editor__number" aria-label={field.label}
      min={settings.min} max={settings.max} precision={settings.precision} suffix={settings.unit} disabled={disabled}
      formatter={settings.thousandSeparator ? (value, info) => info.userTyping ? info.input
        : String(value ?? '').replace(/\B(?=(\d{3})+(?!\d))/g, ',') : undefined} />
      : <FieldControl type={nullableBoolean ? 'select' : type}
        settings={nullableBoolean ? { allowClear: true } : inlineSettings}
        options={nullableBoolean ? booleanOptions : field.options} label={field.label} disabled={disabled} />}
  </Form.Item>;
}

export function RelationshipObjectClearField({ field, disabled }: { field: EditField; disabled?: boolean }) {
  const form = Form.useFormInstance();
  const label = `清空${field.label}`;
  return <Button type="text" size="small" htmlType="button" icon={<DeleteOutlined />}
    aria-label={label} title={label} disabled={disabled} onClick={() => form.setFieldValue(field.code, null)} />;
}
