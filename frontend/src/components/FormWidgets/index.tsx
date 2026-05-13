import React from 'react';
import { Input, InputNumber, Select, DatePicker, Switch } from 'antd';
import type { WidgetFieldConfig } from '../ReportWidgets/types';

interface Props {
  type: string;
  fieldConfig?: WidgetFieldConfig;
  value?: unknown;
  onChange?: (val: unknown) => void;
  isEditing?: boolean;
}

export default function FormWidget({ type, fieldConfig, value, onChange, isEditing }: Props) {
  const label = fieldConfig?.label || type;

  if (!isEditing && value === undefined) {
    return <div style={{ padding: 8, color: '#bbb' }}>{label}: 未绑定</div>;
  }

  switch (type) {
    case 'form-number':
      return (
        <div style={{ padding: '0 8px' }}>
          <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>{label}</div>
          <InputNumber
            value={value as number | undefined}
            onChange={(v) => onChange?.(v)}
            style={{ width: '100%' }}
            placeholder={`请输入${label}`}
            disabled={!isEditing}
          />
        </div>
      );
    case 'form-select': {
      let opts: { label: string; value: string }[] = [];
      if (fieldConfig?.enum_values) {
        try {
          const parsed = JSON.parse(fieldConfig.enum_values);
          opts = (Array.isArray(parsed) ? parsed : []).map((o: string) => ({ label: o, value: o }));
        } catch { /* ignore */ }
      }
      return (
        <div style={{ padding: '0 8px' }}>
          <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>{label}</div>
          <Select
            value={value as string | undefined}
            onChange={(v) => onChange?.(v)}
            options={opts}
            style={{ width: '100%' }}
            placeholder={`请选择${label}`}
            disabled={!isEditing}
          />
        </div>
      );
    }
    case 'form-date':
      return (
        <div style={{ padding: '0 8px' }}>
          <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>{label}</div>
          <DatePicker
            value={value as any}
            onChange={(v) => onChange?.(v)}
            style={{ width: '100%' }}
            placeholder={`请选择${label}`}
            disabled={!isEditing}
          />
        </div>
      );
    case 'form-switch':
      return (
        <div style={{ padding: '0 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontSize: 12, color: '#666' }}>{label}</div>
          <Switch checked={!!value} onChange={(v) => onChange?.(v)} disabled={!isEditing} />
        </div>
      );
    case 'form-textarea':
      return (
        <div style={{ padding: '0 8px' }}>
          <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>{label}</div>
          <Input.TextArea
            value={value as string | undefined}
            onChange={(e) => onChange?.(e.target.value)}
            rows={3}
            placeholder={`请输入${label}`}
            disabled={!isEditing}
          />
        </div>
      );
    case 'form-relation':
      return (
        <div style={{ padding: '0 8px' }}>
          <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>{label} (关联)</div>
          <Select
            value={value as number | undefined}
            onChange={(v) => onChange?.(v)}
            style={{ width: '100%' }}
            placeholder={`请选择${label}`}
            disabled={!isEditing}
          />
        </div>
      );
    default:
      return (
        <div style={{ padding: '0 8px' }}>
          <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>{label}</div>
          <Input
            value={value as string | undefined}
            onChange={(e) => onChange?.(e.target.value)}
            placeholder={`请输入${label}`}
            disabled={!isEditing}
          />
        </div>
      );
  }
}
