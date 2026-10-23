import { useRef, useState, type CSSProperties, type DragEvent } from 'react';
import { Input, InputNumber, Select } from 'antd';
import { HolderOutlined, LockOutlined } from '@ant-design/icons';
import type { FormDesign } from './model';

interface FormSurfaceProps {
  design: FormDesign;
  mode: 'use' | 'design';
  selectedId: string | null;
  values: Record<string, string | number>;
  errors?: Record<string, string>;
  onSelect: (id: string | null) => void;
  onValueChange: (key: string, value: string | number) => void;
  onMove: (sourceId: string, targetId: string) => void;
}

const dragType = 'application/x-unified-form-field';
const fieldSpan = (width: number) => ({ 25: 3, 33: 4, 50: 6, 75: 9, 100: 12 }[width] || 12);

export default function FormSurface({ design, mode, selectedId, values, errors = {}, onSelect, onValueChange, onMove }: FormSurfaceProps) {
  const isDesign = mode === 'design';
  const draggedId = useRef<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const finishDrag = () => { draggedId.current = null; setDropTarget(null); };
  const isFieldDrag = (event: DragEvent) => Boolean(draggedId.current || event.dataTransfer.types.includes(dragType));

  return <form className={`uf-form-card ${isDesign ? 'uf-form-card-design' : 'uf-form-card-use'}`} noValidate onSubmit={event => event.preventDefault()}
    onClick={() => { if (isDesign) onSelect(null); }}>
    <header className="uf-form-heading"><small>基本信息</small><h2>{design.title}</h2>{design.description && <p>{design.description}</p>}</header>
    <div className="uf-fields">
      {design.fields.filter(field => isDesign || !field.hidden).map(field => {
        const value = values[field.key] ?? '';
        const disabled = isDesign || Boolean(field.readonly);
        const error = isDesign ? undefined : errors[field.key];
        const inputId = `uf-input-${field.id}`;
        const helpId = `uf-help-${field.id}`;
        const errorId = `uf-error-${field.id}`;
        const describedBy = [field.helpText && helpId, error && errorId].filter(Boolean).join(' ') || undefined;
        const inputProps = { id: inputId, disabled, placeholder: field.placeholder, 'aria-required': field.required, 'aria-invalid': Boolean(error), 'aria-describedby': describedBy, status: error ? 'error' as const : undefined };
        const classes = ['uf-field', isDesign && 'uf-field-design', isDesign && selectedId === field.id && 'uf-field-selected', field.hidden && 'uf-field-hidden', field.labelPosition === 'left' && 'uf-field-label-left', error && 'uf-field-has-error', isDesign && dropTarget === field.id && 'uf-field-drop-target'].filter(Boolean).join(' ');
        return <div key={field.id} className={classes} style={{ gridColumn: `span ${fieldSpan(field.width)}`, '--uf-field-span': fieldSpan(field.width) } as CSSProperties}
          onClick={event => { event.stopPropagation(); if (isDesign) onSelect(field.id); }}
          onDragOver={event => {
            if (!isDesign || !isFieldDrag(event) || draggedId.current === field.id) return;
            event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget(field.id);
          }}
          onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(current => current === field.id ? null : current); }}
          onDrop={event => {
            if (!isDesign || !isFieldDrag(event)) return;
            event.preventDefault(); event.stopPropagation();
            const sourceId = draggedId.current || event.dataTransfer.getData(dragType);
            if (sourceId !== field.id && design.fields.some(item => item.id === sourceId)) onMove(sourceId, field.id);
            finishDrag();
          }}>
          <div className="uf-field-topline"><label className="uf-field-label" htmlFor={inputId}>{field.required && <span className="uf-field-required" aria-hidden="true">*</span>}{field.label}{field.readonly && <LockOutlined className="uf-field-readonly" aria-label="只读" />}</label>{isDesign && field.hidden && <span className="uf-field-hidden-badge">已隐藏</span>}</div>
          <div className="uf-field-input">
            {field.type === 'select' ? <Select {...inputProps} value={value === '' ? undefined : String(value)} options={(field.options || []).map(option => ({ label: option, value: option }))} allowClear onChange={next => { if (!disabled) onValueChange(field.key, next ?? ''); }} style={{ width: '100%' }} />
              : field.type === 'number' ? <InputNumber {...inputProps} value={value === '' ? null : Number(value)} min={field.key === 'safety_stock' ? 0 : undefined} onChange={next => { if (!disabled) onValueChange(field.key, next ?? ''); }} style={{ width: '100%' }} />
                : field.type === 'textarea' ? <Input.TextArea {...inputProps} value={String(value)} rows={3} onChange={event => { if (!disabled) onValueChange(field.key, event.target.value); }} />
                  : <Input {...inputProps} value={String(value)} onChange={event => { if (!disabled) onValueChange(field.key, event.target.value); }} />}
          </div>
          {field.helpText && <p className="uf-field-help" id={helpId}>{field.helpText}</p>}
          {error && <p className="uf-field-error" id={errorId} role="alert">{error}</p>}
          {isDesign && <>
            <button type="button" className="uf-field-overlay" aria-label={`选择字段：${field.label}`} aria-pressed={selectedId === field.id} onClick={event => { event.stopPropagation(); onSelect(field.id); }} />
            <div className="uf-field-tools">
              <button type="button" className="uf-field-drag-handle" draggable aria-label={`移动${field.label}，可按上下方向键`} title="拖动排序，或使用上下方向键"
                onClick={event => { event.stopPropagation(); onSelect(field.id); }}
                onDragStart={event => { draggedId.current = field.id; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData(dragType, field.id); onSelect(field.id); }}
                onDragEnd={finishDrag}
                onKeyDown={event => {
                  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
                  event.preventDefault(); event.stopPropagation();
                  onSelect(field.id);
                  const index = design.fields.findIndex(item => item.id === field.id);
                  const target = design.fields[index + (event.key === 'ArrowUp' ? -1 : 1)];
                  if (target) onMove(field.id, target.id);
                }}><HolderOutlined /></button>
              <span className="uf-field-width">{field.width}%</span>
            </div>
          </>}
        </div>;
      })}
    </div>
    {!design.fields.some(field => isDesign || !field.hidden) && <div className="uf-form-empty">{isDesign ? '从左侧添加字段，开始设计表单' : '暂无可填写的字段'}</div>}
  </form>;
}
