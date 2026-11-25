import { Button, Checkbox, Form, Input, InputNumber, Select, Switch } from 'antd';
import type { FormInstance } from 'antd';
import { CopyOutlined, DeleteOutlined, HolderOutlined, PlusOutlined } from '@/components/Icon/ant';
import FieldControl from '@/components/FormWidgets/FieldControl';
import RelationPicker from '@/components/FormWidgets/RelationPicker';
import { PropertyGroup, PropertyHelp } from '@/components/PropertyInspector';
import { protectCopy } from '@/components/FieldProtection';
import { getControlAppearance, getControlColumnSpan, getControlPresentation, isLayoutContainer, layoutDescendants, layoutSlots, placeLayoutControl } from '@/utils/formLayout';
import { parseStaticOptions, selectionCountError } from '@/utils/selectOptions';
import React from 'react';
import { createUuid } from '@/utils/uuid';
import type { PlatformForm } from '@/services/api';
import type { PreviewFieldPermission } from './previewPermissions';
import type { ControlTypeSettings, DesignerConfig, DropPosition, LayoutControl } from './designerTypes';
import { isEncodingField } from './fieldBusinessType';
import { controlWidthClass, fieldInput, getEffectiveControlTypeForControl, optionSourceToOptions } from './fieldModel';

export interface CanvasScope {
  embedded: boolean;
  baseConfig: DesignerConfig;
  layoutControls: LayoutControl[];
  platformForm: PlatformForm | null;
  selectedControl?: LayoutControl;
  selectedControlId: string;
  containerTabs: Record<string, string>;
  draggedControlId: string;
  dropHint: { controlId: string; position: DropPosition } | null;
  previewStates: Record<string, { visible: boolean; required: boolean; readonly: boolean; masked?: boolean; copyMode?: 'normal' | 'maskedCopy' | 'disabled'; copyText?: string }>;
  previewValues: Record<string, unknown>;
  previewForm: FormInstance;
  previewRuleError: string;
  canvasSettings: { columns: number; gap: number };
  previewControls: LayoutControl[];
}

export interface CanvasActions {
  duplicateControl: (control?: LayoutControl | null) => void;
  removeControl: (controlId?: string) => void;
  getCanvasControlDragProps: (control: LayoutControl) => React.HTMLAttributes<HTMLDivElement>;
  handleContainerDrop: (event: React.DragEvent, parentId: string, slotId: string) => void;
  updateSelectedControl: (patch: Partial<LayoutControl>) => void;
  commitLayoutChange: (updater: (current: LayoutControl[]) => LayoutControl[]) => void;
  setContainerTabs: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setSelectedControlId: (id: string) => void;
  setSelectedAssetKey: (key: string) => void;
  updateSelectedTypeSettings: (patch: Partial<ControlTypeSettings>) => void;
  getPreviewFieldPermission: (fieldKey?: string) => PreviewFieldPermission | undefined;
  setPreviewValues: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
}

export interface CanvasStageProps {
  scope: CanvasScope;
  actions: CanvasActions;
}

export interface CanvasControlProps extends CanvasStageProps {
  control: LayoutControl;
  trial?: boolean;
  inheritedReadonly?: boolean;
}

function createCanvasRenderers(scope: CanvasScope, actions: CanvasActions) {
  const {
    embedded,
    baseConfig,
    layoutControls,
    platformForm,
    selectedControl,
    selectedControlId,
    containerTabs,
    draggedControlId,
    dropHint,
    previewStates,
    previewValues,
    previewForm,
    previewRuleError,
    canvasSettings,
    previewControls,
  } = scope;
  const {
    duplicateControl,
    removeControl,
    getCanvasControlDragProps,
    handleContainerDrop,
    updateSelectedControl,
    commitLayoutChange,
    setContainerTabs,
    setSelectedControlId,
    setSelectedAssetKey,
    updateSelectedTypeSettings,
    getPreviewFieldPermission,
    setPreviewValues,
  } = actions;

  const renderControlActions = (control: LayoutControl) => (
    <span className="designer-control-actions" onClick={(event) => event.stopPropagation()}>
      <HolderOutlined className="designer-drag-handle" title="拖动调整位置" />
      <Button size="small" type="text" title="复制" aria-label={`复制${control.name}`} icon={<CopyOutlined />} onClick={() => duplicateControl(control)} />
      <Button size="small" type="text" danger title="移出画布" aria-label={`移出${control.name}`} icon={<DeleteOutlined />} onClick={() => removeControl(control.id)} />
    </span>
  );

  const renderControlLabel = (control: LayoutControl) => (
    <span className={`designer-field-title ${control.rules.required.enabled ? 'designer-required-label' : ''}`}>{control.name}</span>
  );

  const renderComponentInput = (control: LayoutControl) => <FieldControl preview type={control.controlType} label={control.name} disabled={embedded || control.rules.readonly.enabled} placeholder={control.placeholder} settings={control.typeSettings} options={optionSourceToOptions(control.optionSource)} />;

  const renderContainerProperties = () => {
    if (!selectedControl) return null;
    const control = selectedControl;
    const updateLayout = (patch: NonNullable<LayoutControl['layout']>) => updateSelectedControl({ layout: { ...control.layout, ...patch } });
    const parentOptions = layoutControls.filter(item => isLayoutContainer(item) && !layoutDescendants(layoutControls, control.id).has(item.id));
    const parent = layoutControls.find(item => item.id === control.parentId);
    return <>
      <label><span>所属容器</span><Select aria-label="所属容器" value={control.parentId || 'root'} options={[{ value: 'root', label: '画布顶层' }, ...parentOptions.map(item => ({ value: item.id, label: item.name }))]} onChange={value => commitLayoutChange(current => placeLayoutControl(current, control.id, value === 'root' ? undefined : value))} /></label>
      {parent && <label><span>容器位置</span><Select aria-label="容器位置" value={control.slotId} options={layoutSlots(parent).map(slot => ({ value: slot.id, label: slot.label }))} onChange={value => { commitLayoutChange(current => placeLayoutControl(current, control.id, parent.id, value)); if (parent.controlType === 'tabs') setContainerTabs(current => ({ ...current, [parent.id]: value })); }} /></label>}
      {isLayoutContainer(control) && <>
        <label><span>内容间距</span><InputNumber aria-label="内容间距" min={0} max={40} value={control.layout?.gap ?? 12} onChange={gap => updateLayout({ gap: gap ?? 12 })} suffix="px" /></label>
        {control.controlType === 'container' && <><label><span>允许折叠</span><Switch size="small" checked={Boolean(control.layout?.collapsible)} onChange={collapsible => updateLayout({ collapsible })} /></label>{control.layout?.collapsible && <label><span>默认收起</span><Switch size="small" checked={Boolean(control.layout.defaultCollapsed)} onChange={defaultCollapsed => updateLayout({ defaultCollapsed })} /></label>}</>}
        {control.controlType === 'two-columns' && <><label><span>列数</span><Select aria-label="列数" value={control.layout?.columns || 2} options={[2,3,4].map(value => ({ value, label: `${value} 列` }))} onChange={columns => updateLayout({ columns, ratios: Array.from({ length: columns }, (_, i) => control.layout?.ratios?.[i] || 1) })} /></label><PropertyHelp>减少列数时，原列中的控件会移至第一列。</PropertyHelp>{layoutSlots(control).map((slot, index) => <label key={slot.id}><span>{slot.label}比例</span><InputNumber min={1} max={12} value={control.layout?.ratios?.[index] || 1} onChange={value => updateLayout({ ratios: layoutSlots(control).map((_, i) => i === index ? value || 1 : control.layout?.ratios?.[i] || 1) })} /></label>)}</>}
        {control.controlType === 'tabs' && <><div className="designer-container-tab-settings">{layoutSlots(control).map(slot => <div key={slot.id}><Input aria-label={`页签名称：${slot.label}`} value={slot.label} onChange={event => updateLayout({ tabs: layoutSlots(control).map(tab => tab.id === slot.id ? { ...tab, label: event.target.value } : tab) })} /><Button danger size="small" disabled={layoutSlots(control).length < 2} onClick={() => { const remaining = layoutSlots(control).filter(tab => tab.id !== slot.id); updateLayout({ tabs: remaining }); setContainerTabs(current => ({ ...current, [control.id]: remaining[0].id })); }}>移除</Button></div>)}</div><Button size="small" icon={<PlusOutlined />} onClick={() => updateLayout({ tabs: [...layoutSlots(control), { id: `tab-${createUuid()}`, label: `页签 ${layoutSlots(control).length + 1}` }] })}>新增页签</Button><PropertyHelp>移除页签后，其控件会保留在第一个页签。</PropertyHelp></>}
      </>}
    </>;
  };

  const renderCanvasControl = (control: LayoutControl, trial = false, inheritedReadonly = false): React.ReactNode => {
    const permission = trial ? getPreviewFieldPermission(control.fieldKey) : undefined;
    const state = trial ? previewStates[String(control.fieldKey)] : undefined;
    if (trial && (permission?.visible === false || (state?.visible ?? control.rules.visible.enabled) === false)) return null;
    const readonly = inheritedReadonly || control.rules.readonly.enabled || Boolean(state?.readonly || (permission && !permission.editable));
    const field = baseConfig.fields.find((item) => item.key === control.fieldKey);
    const effectiveControlType = getEffectiveControlTypeForControl(control, field);
    const presentation = getControlPresentation(control.presentation);
    const appearance = getControlAppearance(control.presentation);
    const placementStyle = { ...appearance.style, '--layout-span': getControlColumnSpan(control.width), marginBottom: presentation.spacingAfter } as React.CSSProperties;
    const labelProps = {
      className: `designer-field-label ${presentation.labelPosition === 'left' ? 'is-label-left' : ''} ${presentation.labelAlign === 'right' ? 'is-label-right' : ''}`,
      style: { '--designer-label-width': `${presentation.labelWidth}px` } as React.CSSProperties,
    };
    const renderTrialInput = () => {
      const encoding = control.encodingRule || field?.encodingRule;
      const generatedCode = (isEncodingField(field) || control.controlType === 'code') && encoding?.enabled !== false && encoding?.generationMode !== 'manual' && !encoding?.allowManualOverride;
      const placeholder = control.placeholder || field?.placeholder;
      if (generatedCode) return <Input aria-label={control.name} disabled placeholder={placeholder} />;
      return <Form.Item name={control.fieldKey || control.id} rules={[{ required: permission?.required || state?.required || control.rules.required.enabled, message: `请填写${control.name}` }, { validator: (_, value) => { const error = !readonly && effectiveControlType === 'select' ? selectionCountError(value, control.typeSettings) : undefined; return error ? Promise.reject(new Error(error)) : Promise.resolve(); } }]}>
        {platformForm && control.dataSourceKind && control.dataSourceKind !== 'static' && control.fieldKey && !state?.masked
          ? <RelationPicker formId={platformForm.id} fieldName={control.fieldKey} draftControls={layoutControls} contextData={previewValues} modelName={control.optionSource || ''} placeholder={placeholder || `请选择${control.name}`} disabled={readonly} allowClear={control.typeSettings?.allowClear !== false} showSearch={control.typeSettings?.displayMode !== 'dropdown'} copyMode={state?.copyMode} copyText={state?.copyText} />
          : <FieldControl preview masked={state?.masked} copyMode={state?.copyMode} copyText={state?.copyText} type={effectiveControlType} label={control.name} settings={control.typeSettings} options={parseStaticOptions(control.optionSource, field?.enumValues)} placeholder={placeholder} disabled={readonly} />}
      </Form.Item>;
    };
    const dragClass = `${presentation.startNewRow ? 'is-start-new-row' : ''} ${!trial && draggedControlId === control.id ? 'canvas-control-dragging' : ''} ${!trial && dropHint?.controlId === control.id ? `canvas-drop-${dropHint.position}` : ''}`;
    const ruleClass = `${!trial && !control.rules.visible.enabled ? 'canvas-control-hidden-preview' : ''} ${(trial ? readonly : control.rules.readonly.enabled) ? 'canvas-control-readonly-preview' : ''}`;
    if (control.source === 'field' && field) {
      return (
        <div
          {...(trial ? {} : getCanvasControlDragProps(control))}
          style={placementStyle}
          className={`designer-field-control ${appearance.className} ${controlWidthClass(control.width)} ${!trial && selectedControlId === control.id ? 'canvas-field-active' : ''} ${dragClass} ${ruleClass}`}
          key={control.id}
          onClick={(event) => {
            event.stopPropagation(); if (trial) return;
            setSelectedControlId(control.id);
            setSelectedAssetKey(field.key);
          }}
        >
          {!trial && renderControlActions(control)}
          <label {...labelProps}>
            {renderControlLabel(trial ? { ...control, rules: { ...control.rules, required: { ...control.rules.required, enabled: Boolean(permission?.required || state?.required || control.rules.required.enabled) } } } : control)}
            <div className="designer-field-input">{trial ? renderTrialInput() : fieldInput(field, control.placeholder, embedded || control.rules.readonly.enabled, control.optionSource, effectiveControlType, control.typeSettings)}</div>
            {control.helpText && <small className="designer-control-help">{control.helpText}</small>}
          </label>
        </div>
      );
    }

    if (['text', 'textarea', 'number', 'select', 'relation', 'datetime', 'upload', 'switch', 'readonly-text', 'code'].includes(control.controlType)) {
      return (
        <div
          {...(trial ? {} : getCanvasControlDragProps(control))}
          style={placementStyle}
          className={`designer-field-control ${appearance.className} ${controlWidthClass(control.width)} ${!trial && selectedControlId === control.id ? 'canvas-field-active' : ''} ${dragClass} ${ruleClass}`}
          key={control.id}
          onClick={(event) => { event.stopPropagation(); if (trial) return; setSelectedControlId(control.id); }}
        >
          {!trial && renderControlActions(control)}
          <label {...labelProps}>
            {renderControlLabel(trial ? { ...control, rules: { ...control.rules, required: { ...control.rules.required, enabled: Boolean(permission?.required || state?.required || control.rules.required.enabled) } } } : control)}
            <div className="designer-field-input">{trial ? renderTrialInput() : renderComponentInput(control)}</div>
            {control.helpText && <small className="designer-control-help">{control.helpText}</small>}
          </label>
        </div>
      );
    }

    if (isLayoutContainer(control)) {
      const slots = layoutSlots(control);
      const activeTab = slots.find(slot => slot.id === containerTabs[control.id])?.id || slots[0].id;
      const renderedSlots = control.controlType === 'tabs' ? slots.filter(slot => slot.id === activeTab) : slots;
      return <div {...(trial ? {} : getCanvasControlDragProps(control))} style={placementStyle} key={control.id} data-layout-id={control.id}
        className={`designer-layout-control ${controlWidthClass(control.width)} ${!trial && selectedControlId === control.id ? 'canvas-field-active' : ''} ${dragClass} ${ruleClass}`}
        onClick={event => { event.stopPropagation(); if (trial) return; setSelectedControlId(control.id); }}>
        {!trial && renderControlActions(control)}
        <div className="designer-layout-control-head"><strong>{control.name}</strong><small>{control.controlType === 'tabs' ? '页签容器' : control.controlType === 'two-columns' ? `${slots.length} 列布局` : '字段分组'}</small></div>
        {control.controlType === 'tabs' && <div className="designer-container-tabbar">{slots.map(slot => <Button size="small" key={slot.id} type={slot.id === activeTab ? 'primary' : 'text'} onClick={event => { event.stopPropagation(); setContainerTabs(current => ({ ...current, [control.id]: slot.id })); setSelectedControlId(control.id); }}>{slot.label}</Button>)}</div>}
        <div className={control.controlType === 'two-columns' ? 'designer-container-columns' : ''} style={{ gap: control.layout?.gap ?? 12, gridTemplateColumns: slots.map((_, index) => `${control.layout?.ratios?.[index] || 1}fr`).join(' ') }}>
          {renderedSlots.map(slot => {
            const children = layoutControls.filter(child => child.parentId === control.id && child.slotId === slot.id);
            return <div className="designer-container-slot" key={slot.id} data-container-id={control.id} data-slot-id={slot.id}
              onDragOver={event => { event.preventDefault(); event.stopPropagation(); if (trial) return; event.dataTransfer.dropEffect = 'move'; }}
              onDrop={trial ? undefined : event => handleContainerDrop(event, control.id, slot.id)}>
              {control.controlType === 'two-columns' && <small className="designer-slot-title">{slot.label}</small>}
              <div className="create-form-grid">{children.map(child => renderCanvasControl(child, trial, readonly))}</div>
              {!trial && !children.length && <div className="designer-container-empty">拖入字段或控件到{slot.label}</div>}
            </div>;
          })}
        </div>
      </div>;
    }

    if (control.controlType === 'editable-table' || control.controlType === 'readonly-table') {
      return (
        <div
          {...(trial ? {} : getCanvasControlDragProps(control))}
          style={placementStyle}
          className={`designer-table-control ${controlWidthClass(control.width)} ${!trial && selectedControlId === control.id ? 'canvas-field-active' : ''} ${dragClass} ${ruleClass}`}
          key={control.id}
          onClick={(event) => { event.stopPropagation(); if (trial) return; setSelectedControlId(control.id); }}
        >
          {!trial && renderControlActions(control)}
          <strong className={control.rules.required.enabled ? 'designer-required-label' : undefined}>{control.name}</strong>
          <div className="designer-mini-table">
            <span>列配置</span>
            <span>数据来源</span>
            <span>{control.controlType === 'editable-table' ? '可新增/删除行' : '分页/点击详情'}</span>
          </div>
        </div>
      );
    }

    if (control.controlType === 'divider') {
      return (
        <div
          {...(trial ? {} : getCanvasControlDragProps(control))}
          style={placementStyle}
          className={`designer-divider-control ${controlWidthClass(control.width)} ${!trial && selectedControlId === control.id ? 'canvas-field-active' : ''} ${dragClass} ${ruleClass}`}
          key={control.id}
          onClick={(event) => { event.stopPropagation(); if (trial) return; setSelectedControlId(control.id); }}
        >
          {!trial && renderControlActions(control)}
          <span>{control.name}</span>
        </div>
      );
    }

    if (['summary-card', 'status-tag', 'file-preview', 'approval-comment', 'operation-log', 'status-flow', 'risk-level'].includes(control.controlType)) {
      return (
        <div
          {...(trial ? {} : getCanvasControlDragProps(control))}
          style={placementStyle}
          className={`designer-business-control ${controlWidthClass(control.width)} ${!trial && selectedControlId === control.id ? 'canvas-field-active' : ''} ${dragClass} ${ruleClass}`}
          key={control.id}
          onClick={(event) => { event.stopPropagation(); if (trial) return; setSelectedControlId(control.id); }}
        >
          {!trial && renderControlActions(control)}
          <strong>{control.name}</strong>
          <span>{control.desc}</span>
        </div>
      );
    }

    return (
      <div
        {...(trial ? {} : getCanvasControlDragProps(control))}
        style={placementStyle}
        className={`designer-placeholder-control ${controlWidthClass(control.width)} ${!trial && selectedControlId === control.id ? 'canvas-field-active' : ''} ${dragClass} ${ruleClass}`}
        key={control.id}
        onClick={(event) => { event.stopPropagation(); if (trial) return; setSelectedControlId(control.id); }}
      >
        {!trial && renderControlActions(control)}
        <strong className={control.rules.required.enabled ? 'designer-required-label' : undefined}>{control.name}</strong>
        <span>{control.desc || '纯 UI 控件，可在右侧绑定字段或配置展示方式。'}</span>
      </div>
    );
  };

  const renderTableProperties = () => {
    if (!selectedControl || !['editable-table','readonly-table'].includes(selectedControl.controlType)) return null;
    const editable=selectedControl.controlType==='editable-table';const settings=selectedControl.typeSettings||{};const columns=settings.columns||[];
    return <PropertyGroup title="控件参数" className="designer-prop-section" titleClassName="designer-prop-section-title">
      <small>{editable?'绑定 JSON 字段后，明细随主记录一起保存。':'绑定 JSON 字段并填写来源表单 ID，按当前用户权限读取关联记录。'}</small>
      {!editable&&<label><span>来源表单 ID</span><InputNumber min={1} value={settings.sourceFormId} onChange={value=>updateSelectedTypeSettings({sourceFormId:value||undefined})}/></label>}
      {columns.map((column,index)=><div className="designer-detail-column" key={index}>
        <Input aria-label={`第 ${index+1} 列名称`} placeholder="列名称" value={column.label} onChange={e=>updateSelectedTypeSettings({columns:columns.map((c,i)=>i===index?{...c,label:e.target.value}:c)})}/>
        <Input aria-label={`第 ${index+1} 列编码`} placeholder="字段编码" value={column.key} onChange={e=>updateSelectedTypeSettings({columns:columns.map((c,i)=>i===index?{...c,key:e.target.value}:c)})}/>
        <Select value={column.type} options={[{value:'string',label:'文本'},{value:'number',label:'数值'},{value:'boolean',label:'开关'}]} onChange={type=>updateSelectedTypeSettings({columns:columns.map((c,i)=>i===index?{...c,type}:c)})}/>
        {editable&&<Checkbox checked={column.required} onChange={e=>updateSelectedTypeSettings({columns:columns.map((c,i)=>i===index?{...c,required:e.target.checked}:c)})}>必填</Checkbox>}
        <Button danger size="small" onClick={()=>updateSelectedTypeSettings({columns:columns.filter((_,i)=>i!==index)})}>移除列</Button>
      </div>)}
      <Button size="small" icon={<PlusOutlined/>} onClick={()=>updateSelectedTypeSettings({columns:[...columns,{key:`column_${columns.length+1}`,label:`字段 ${columns.length+1}`,type:'string'}]})}>新增明细列</Button>
      {editable&&<><label><span>允许新增行</span><Switch size="small" checked={settings.allowAdd!==false} onChange={allowAdd=>updateSelectedTypeSettings({allowAdd})}/></label><label><span>允许删除行</span><Switch size="small" checked={settings.allowDelete!==false} onChange={allowDelete=>updateSelectedTypeSettings({allowDelete})}/></label><label><span>最少行数</span><InputNumber min={0} max={200} value={settings.minRows||0} onChange={value=>updateSelectedTypeSettings({minRows:value||0})}/></label><label><span>最多行数</span><InputNumber min={1} max={200} value={settings.maxRows||200} onChange={value=>updateSelectedTypeSettings({maxRows:value||200})}/></label></>}
    </PropertyGroup>;
  };

  const renderPreviewContent = () => {
    return <Form onCopyCapture={protectCopy} onCutCapture={protectCopy} form={previewForm} layout="vertical" onValuesChange={(_,values)=>setPreviewValues(values)}>
      {previewRuleError&&<small role="alert">{previewRuleError}</small>}
      <div className="create-form-grid" style={{ gap: canvasSettings.gap }}>
        {previewControls.filter(control => !control.parentId).map(control => renderCanvasControl(control, true))}
      </div>
    </Form>;
  };

  return {
    renderContainerProperties,
    renderCanvasControl,
    renderTableProperties,
    renderPreviewContent,
  };
}

export function ContainerProperties({ scope, actions }: CanvasStageProps) {
  return <>{createCanvasRenderers(scope, actions).renderContainerProperties()}</>;
}

export function TableProperties({ scope, actions }: CanvasStageProps) {
  return <>{createCanvasRenderers(scope, actions).renderTableProperties()}</>;
}

export function CanvasControl({ control, trial = false, inheritedReadonly = false, scope, actions }: CanvasControlProps) {
  return <>{createCanvasRenderers(scope, actions).renderCanvasControl(control, trial, inheritedReadonly)}</>;
}

export function PreviewContent({ scope, actions }: CanvasStageProps) {
  return <>{createCanvasRenderers(scope, actions).renderPreviewContent()}</>;
}
