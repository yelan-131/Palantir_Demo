import { Alert, Button, Input, InputNumber, Modal, Select, Space, Switch, Table, Tag, Tooltip, message } from 'antd';
import { DeleteOutlined, PlusOutlined, QuestionCircleOutlined, SearchOutlined, SettingOutlined } from '@ant-design/icons';
import { calculationSources } from '@/utils/formCalculations';
import type { CalculationRule } from '@/utils/formCalculations';
import type { OptionSearchSettings } from '@/utils/formControls';
import { defaultRuleErrors, defaultRuleSummary, newDefaultPart } from '@/utils/formDefaults';
import type { DefaultValueRule } from '@/utils/formDefaults';
import { isLayoutContainer, isLayoutControl, getControlPresentation } from '@/utils/formLayout';
import type { ControlPresentation } from '@/utils/formLayout';
import { DEFAULT_FIELD_BYTES, fieldStorageSize } from '../SystemAdmin/assemblyPersistence';
import { PropertyAdvanced, PropertyGroup, PropertyHelp, PropertyRow } from '@/components/PropertyInspector';
import React from 'react';
import { parseStaticOptions } from '@/utils/selectOptions';
import { previewFormReferenceOptions } from '@/services/api';
import type { PlatformForm } from '@/services/api';
import { createUuid } from '@/utils/uuid';
import CalculationExpressionEditor from './CalculationExpressionEditor';
import { RuleInlineSelect } from './RuleInlineCell';
import StaticOptionsEditor from './StaticOptionsEditor';
import { controlWidthOptions, referenceSourceKindOptions } from './designerOptions';
import type { AssignmentRule, ControlRuleKey, ControlTypeSettings, ControlWidth, DesignerConfig, DesignerField, DesignerOption, EncodingRule, LayoutControl, ReferenceSourceKind, SearchSettingsDraft } from './designerTypes';
import { getEncodingRules, makeEncodingRule } from './encodingRules';
import { getFieldStorageTypeLabel, isEncodingField, mapDesignerFieldType } from './fieldBusinessType';
import { getDefaultTypeSettings, getReferenceConfig } from './fieldModel';

export interface PropertyPanelScope {
  embedded: boolean;
  baseConfig: DesignerConfig;
  layoutControls: LayoutControl[];
  platformForm: PlatformForm | null;
  selectedControl?: LayoutControl;
  selectedControlId: string;
  selectedField?: DesignerField;
  selectedEffectiveControlType: string;
  selectedControlUsesDataSource: boolean;
  selectedReferenceSourceKind: ReferenceSourceKind;
  selectedReferenceConfig: ReturnType<typeof getReferenceConfig>;
  selectedControlUsesEncoding: boolean;
  selectedEncodingRule?: EncodingRule;
  optionCatalog: { dictionaries: Array<{ code: string; name: string }>; externalApis: Array<{ id: number; name: string }> };
  referenceForms: PlatformForm[];
  referenceLabelOptions: Array<{ value: string; label: string }>;
  testingOptionSource: boolean;
  hiddenRequiredControls: LayoutControl[];
  controlTypeOptions: DesignerOption[];
  textFormatOptions: DesignerOption[];
  textTrimModeOptions: DesignerOption[];
  textCaseModeOptions: DesignerOption[];
  selectionModeOptions: DesignerOption[];
  selectionDisplayOptions: DesignerOption[];
  dateModeOptions: DesignerOption[];
  defaultDateOptions: DesignerOption[];
  searchDraft: SearchSettingsDraft | null;
  assignmentDraft: { controlId: string; rules: AssignmentRule[] } | null;
  assignmentSourceAttributeOptions: Array<{ value: string; label: string }>;
  assignmentTargetFieldOptions: Array<{ value: string; label: string }>;
  defaultValueDraft: { controlId: string; rule: DefaultValueRule; fixed: string } | null;
  calculationDraft: { controlId: string; rule: CalculationRule; samples: Record<string, unknown> } | null;
  calculationBusy: boolean;
  calculationError: string;
  calculationResult: { value: unknown } | null;
}

export interface PropertyPanelActions {
  updateSelectedControl: (patch: Partial<LayoutControl>) => void;
  updateSelectedTypeSettings: (patch: Partial<ControlTypeSettings>) => void;
  updateSelectedEncodingRule: (patch: Partial<EncodingRule>) => void;
  controlRuleToggle: (ruleKey: ControlRuleKey) => React.ReactNode;
  openSearchSettings: () => void | Promise<void>;
  updateSearchSettings: (patch: Partial<OptionSearchSettings>) => void;
  updateSearchSample: (patch: Partial<SearchSettingsDraft>) => void;
  testOptionSearch: (page?: number) => void | Promise<void>;
  setTestingOptionSource: React.Dispatch<React.SetStateAction<boolean>>;
  setEncodingSettingsDraft: React.Dispatch<React.SetStateAction<EncodingRule | null>>;
  encodingRuleTargetRef: React.MutableRefObject<{ controlId: string; rule: EncodingRule } | null>;
  setAssignmentDraft: React.Dispatch<React.SetStateAction<{ controlId: string; rules: AssignmentRule[] } | null>>;
  addAssignmentRule: () => void;
  updateAssignmentRule: (ruleId: string, patch: Partial<AssignmentRule>) => void;
  removeAssignmentRule: (ruleId: string) => void;
  setDefaultValueDraft: React.Dispatch<React.SetStateAction<{ controlId: string; rule: DefaultValueRule; fixed: string } | null>>;
  getFieldDefaultValue: (field?: DesignerField) => string;
  setCalculationDraft: React.Dispatch<React.SetStateAction<{ controlId: string; rule: CalculationRule; samples: Record<string, unknown> } | null>>;
  setCalculationError: React.Dispatch<React.SetStateAction<string>>;
  setCalculationResult: React.Dispatch<React.SetStateAction<{ value: unknown } | null>>;
  updateCalculationDraft: (patch: Partial<CalculationRule>, samples?: Record<string, unknown>) => void;
  checkCalculation: (save: boolean) => void | Promise<void>;
}

export interface PropertyPanelProps {
  scope: PropertyPanelScope;
  actions: PropertyPanelActions;
}

function createPropertyRenderers(scope: PropertyPanelScope, actions: PropertyPanelActions) {
  const {
    baseConfig,
    layoutControls,
    platformForm,
    selectedControl,
    selectedControlId,
    selectedField,
    selectedEffectiveControlType,
    selectedControlUsesDataSource,
    selectedReferenceSourceKind,
    selectedReferenceConfig,
    selectedControlUsesEncoding,
    selectedEncodingRule,
    optionCatalog,
    referenceForms,
    referenceLabelOptions,
    testingOptionSource,
    hiddenRequiredControls,
    controlTypeOptions,
    textFormatOptions,
    textTrimModeOptions,
    textCaseModeOptions,
    selectionModeOptions,
    selectionDisplayOptions,
    dateModeOptions,
    defaultDateOptions,
    searchDraft,
    assignmentDraft,
    assignmentSourceAttributeOptions,
    assignmentTargetFieldOptions,
    defaultValueDraft,
    calculationDraft,
    calculationBusy,
    calculationError,
    calculationResult,
  } = scope;
  const {
    updateSelectedControl,
    updateSelectedTypeSettings,
    updateSelectedEncodingRule,
    controlRuleToggle,
    openSearchSettings,
    updateSearchSettings,
    updateSearchSample,
    testOptionSearch,
    setTestingOptionSource,
    setEncodingSettingsDraft,
    encodingRuleTargetRef,
    setAssignmentDraft,
    addAssignmentRule,
    updateAssignmentRule,
    removeAssignmentRule,
    setDefaultValueDraft,
    getFieldDefaultValue,
    setCalculationDraft,
    setCalculationError,
    setCalculationResult,
    updateCalculationDraft,
    checkCalculation,
  } = actions;

  const renderTypeSpecificProperties = () => {
    if (!selectedControl) return null;
    const typeSettings = {
      ...getDefaultTypeSettings(selectedEffectiveControlType, selectedField),
      ...(selectedControl.typeSettings || {}),
    };
    if (selectedEffectiveControlType === 'text' || selectedEffectiveControlType === 'textarea') {
      return (
        <PropertyGroup title="控件参数" className="designer-prop-section" titleClassName="designer-prop-section-title">
          <label>
            <span>字符范围</span>
            <div className="designer-inline-fields">
              <InputNumber
                min={0}
                placeholder="最少"
                value={typeSettings.minLength}
                onChange={(minLength) => updateSelectedTypeSettings({ minLength: Number(minLength || 0) })}
              />
              <InputNumber
                min={1}
                placeholder="最多"
                value={typeSettings.maxLength}
                onChange={(maxLength) => updateSelectedTypeSettings({ maxLength: Number(maxLength || 0) })}
              />
            </div>
          </label>
          <label><span>文本格式</span><Select value={typeSettings.textFormat || 'plain'} options={textFormatOptions.filter(option=>['plain','email','phone','url','idNo','password'].includes(String(option.value)))} onChange={(textFormat) => updateSelectedTypeSettings({ textFormat })} /></label>
          <label><span>空格处理</span><Select value={typeSettings.trimMode || 'trim'} options={textTrimModeOptions} onChange={(trimMode) => updateSelectedTypeSettings({ trimMode })} /></label>
          <label><span>大小写</span><Select value={typeSettings.caseMode || 'original'} options={textCaseModeOptions} onChange={(caseMode) => updateSelectedTypeSettings({ caseMode })} /></label>
          {selectedEffectiveControlType === 'textarea' && (
            <label><span>默认行数</span><InputNumber min={2} max={12} value={typeSettings.rows || 3} onChange={(rows) => updateSelectedTypeSettings({ rows: Number(rows || 3) })} /></label>
          )}
        </PropertyGroup>
      );
    }
    if (selectedEffectiveControlType === 'number') {
      return (
        <PropertyGroup title="控件参数" className="designer-prop-section" titleClassName="designer-prop-section-title">
          <label>
            <span>取值范围</span>
            <div className="designer-inline-fields">
              <InputNumber placeholder="最小" value={typeSettings.min} onChange={(min) => updateSelectedTypeSettings({ min: min === null ? undefined : Number(min) })} />
              <InputNumber placeholder="最大" value={typeSettings.max} onChange={(max) => updateSelectedTypeSettings({ max: max === null ? undefined : Number(max) })} />
            </div>
          </label>
          <label><span>小数位</span><InputNumber min={0} max={6} value={typeSettings.precision ?? 0} onChange={(precision) => updateSelectedTypeSettings({ precision: Number(precision || 0) })} /></label>
          <label><span>单位后缀</span><Input allowClear placeholder="例如：小时、件、%" value={typeSettings.unit || ''} onChange={(event) => updateSelectedTypeSettings({ unit: event.target.value })} /></label>
          <label><span>千分位</span><Switch size="small" checked={Boolean(typeSettings.thousandSeparator)} onChange={(thousandSeparator) => updateSelectedTypeSettings({ thousandSeparator })} /></label>
        </PropertyGroup>
      );
    }
    if (selectedEffectiveControlType === 'select' || selectedEffectiveControlType === 'relation') {
      return (
        <PropertyGroup title="控件参数" hint="选择方式和展示方式。选项内容在数据属性中配置。" className="designer-prop-section" titleClassName="designer-prop-section-title">
          <div className="designer-property-rule-row">{renderRuleLabel('选择模式', '单选每次选择一项，多选可同时选择多项。固定选项支持多选；字典和关联记录来源当前仅支持单选。', true)}<Select aria-label="选择模式" value={typeSettings.selectionMode || 'single'} options={(selectedReferenceSourceKind !== 'static')?selectionModeOptions.filter(option=>option.value==='single'):selectionModeOptions} onChange={(selectionMode) => updateSelectedTypeSettings({ selectionMode })} /></div>
          <div className="designer-property-rule-row">{renderRuleLabel('展示方式', '下拉适合普通选项；搜索可按选项文字查找；单复选会直接铺开选项；标签按多选方式填写。', true)}<Select aria-label="展示方式" value={typeSettings.displayMode || (selectedReferenceSourceKind !== 'static' ? 'search' : 'dropdown')} options={(selectedReferenceSourceKind !== 'static')?selectionDisplayOptions.filter(option=>['dropdown','search'].includes(String(option.value))):selectionDisplayOptions.map(option => option.value === 'radio' ? { ...option, label: typeSettings.selectionMode === 'multiple' ? '平铺复选' : '平铺单选' } : option)} onChange={(displayMode) => updateSelectedTypeSettings({ displayMode })} /></div>
          {(typeSettings.displayMode || (selectedReferenceSourceKind !== 'static' ? 'search' : 'dropdown')) === 'search' && <div className="designer-property-rule-row">
            {renderRuleLabel('搜索设置', '配置搜索字段、匹配方式和候选范围；齿轮中可输入关键词试搜。', true)}
            <div className="designer-rule-toggle"><Button className="designer-rule-config-button" aria-label="设置搜索规则" type="text" size="small" icon={<SettingOutlined />} disabled={!selectedControl?.fieldKey} onClick={openSearchSettings} /></div>
          </div>}
          <div className="designer-property-rule-row">{renderRuleLabel('允许清空', '下拉或搜索框中可一键移除已选内容。关闭后隐藏清空按钮；必填字段清空后仍需重新选择才能提交。', true)}<Switch aria-label="允许清空" size="small" checked={typeSettings.allowClear !== false} onChange={(allowClear) => updateSelectedTypeSettings({ allowClear })} /></div>
          {selectedReferenceSourceKind === 'static' && typeSettings.selectionMode === 'multiple' && <>
            <div className="designer-property-rule-row">{renderRuleLabel('最少选择', '提交时至少选择的数量；留空或 0 表示不限制，草稿可暂不满足。', true)}<InputNumber aria-label="最少选择数量" min={0} max={1000} precision={0} placeholder="不限" value={typeSettings.minSelections} onChange={value => updateSelectedTypeSettings({ minSelections: value ?? undefined })} /></div>
            <div className="designer-property-rule-row">{renderRuleLabel('最多选择', '最多允许选择的数量，留空表示不限制。达到上限后仍可取消已选项。', true)}<InputNumber aria-label="最多选择数量" min={1} max={1000} precision={0} placeholder="不限" value={typeSettings.maxSelections} onChange={value => updateSelectedTypeSettings({ maxSelections: value ?? undefined })} /></div>
            {typeSettings.displayMode !== 'radio' && <>
              <div className="designer-property-rule-row">{renderRuleLabel('标签折叠', '只控制已选标签的显示，不改变选择结果；折叠后悬停可查看其余名称。', true)}<Select aria-label="标签折叠方式" value={typeSettings.tagCollapse || 'none'} options={[{ value: 'none', label: '不折叠' }, { value: 'responsive', label: '按宽度折叠' }, { value: 'fixed', label: '按数量折叠' }]} onChange={tagCollapse => updateSelectedTypeSettings({ tagCollapse })} /></div>
              {typeSettings.tagCollapse === 'fixed' && <div className="designer-property-rule-row"><span>显示标签数</span><InputNumber aria-label="显示标签数量" min={1} max={1000} precision={0} value={typeSettings.maxVisibleTags ?? 3} onChange={value => updateSelectedTypeSettings({ maxVisibleTags: value ?? undefined })} /></div>}
            </>}
          </>}
          {selectedReferenceSourceKind === 'static' && typeSettings.selectionMode === 'multiple' && typeSettings.displayMode !== 'radio' && (
            <div className="designer-property-rule-row">{renderRuleLabel('允许临时项', '多选或标签模式下，可输入候选项以外的新值；单选及单复选展示不支持。新值只保存到当前记录，不会自动新增来源数据。', true)}<Switch aria-label="允许临时项" size="small" checked={Boolean(typeSettings.allowCreateOption)} onChange={(allowCreateOption) => updateSelectedTypeSettings({ allowCreateOption })} /></div>
          )}
        </PropertyGroup>
      );
    }
    if (selectedEffectiveControlType === 'datetime') {
      return (
        <PropertyGroup title="控件参数" className="designer-prop-section" titleClassName="designer-prop-section-title">
          <label><span>日期类型</span><Select value={typeSettings.dateMode || 'datetime'} options={dateModeOptions} onChange={(dateMode) => updateSelectedTypeSettings({ dateMode })} /></label>
          <label><span>默认值</span><Select value={typeSettings.defaultDate || 'none'} options={defaultDateOptions} onChange={(defaultDate) => updateSelectedTypeSettings({ defaultDate })} /></label>
          <label><span>禁选过去</span><Switch size="small" checked={Boolean(typeSettings.disablePast)} onChange={(disablePast) => updateSelectedTypeSettings({ disablePast })} /></label>
        </PropertyGroup>
      );
    }
    if (selectedEffectiveControlType === 'upload') {
      return (
        <PropertyGroup title="控件参数" className="designer-prop-section" titleClassName="designer-prop-section-title">
          <label><span>文件数量</span><InputNumber min={1} max={20} value={typeSettings.maxFiles || 5} onChange={(maxFiles) => updateSelectedTypeSettings({ maxFiles: Number(maxFiles || 1) })} /></label>
          <label><span>单个大小</span><InputNumber min={1} max={200} addonAfter="MB" value={typeSettings.maxFileSize || 20} onChange={(maxFileSize) => updateSelectedTypeSettings({ maxFileSize: Number(maxFileSize || 1) })} /></label>
          <label><span>文件类型</span><Input allowClear value={typeSettings.fileTypes || ''} onChange={(event) => updateSelectedTypeSettings({ fileTypes: event.target.value })} /></label>
        </PropertyGroup>
      );
    }
    if (selectedEffectiveControlType === 'switch') {
      return (
        <PropertyGroup title="控件参数" className="designer-prop-section" titleClassName="designer-prop-section-title">
          <label><span>默认状态</span><Switch size="small" checked={Boolean(typeSettings.defaultChecked)} onChange={(defaultChecked) => updateSelectedTypeSettings({ defaultChecked })} /></label>
          <label><span>开启文案</span><Input value={typeSettings.checkedText || '是'} onChange={(event) => updateSelectedTypeSettings({ checkedText: event.target.value })} /></label>
          <label><span>关闭文案</span><Input value={typeSettings.uncheckedText || '否'} onChange={(event) => updateSelectedTypeSettings({ uncheckedText: event.target.value })} /></label>
        </PropertyGroup>
      );
    }
    return null;
  };

  const formatStorageBudget = (bytes: number) => bytes >= 1048576 && bytes % 1048576 === 0 ? `${bytes / 1048576} MiB` : bytes >= 1024 && bytes % 1024 === 0 ? `${bytes / 1024} KiB` : `${bytes} 字节`;

  const renderFieldBindingProperties = () => selectedControl && !isLayoutControl(selectedControl) ? <>
    <label className="designer-prop-locked">
      <span>绑定字段</span>
      <Select aria-label="绑定字段" allowClear value={selectedControl.fieldKey} placeholder="请选择存储字段" options={baseConfig.fields.map(f => ({ value: f.key, label: `${f.name} (${f.key})` }))} onChange={fieldKey => updateSelectedControl({ fieldKey, source: 'field' })} />
    </label>
    <label className="designer-prop-locked"><span>字段类型</span><Input value={getFieldStorageTypeLabel(selectedField)} disabled suffix="数据库字段" /></label>
    {selectedField && (DEFAULT_FIELD_BYTES[mapDesignerFieldType(selectedField)] ? <label className="designer-prop-locked">
      {renderRuleLabel('存储上限', '短文本默认 1 KiB（1024 字节），长文本 64 KiB，明细 1 MiB。系统统一管理，设计中不可修改；上限不会预占空间。字符范围在文本设置中单独限制。')}
      <Input aria-label="存储上限" readOnly value={`${selectedField.maxBytes ? '已设' : '默认'} ${formatStorageBudget(selectedField.maxBytes ?? DEFAULT_FIELD_BYTES[mapDesignerFieldType(selectedField)])}`} />
    </label> : <label className="designer-prop-locked"><span>字段大小</span><Input value={fieldStorageSize(mapDesignerFieldType(selectedField), selectedField.maxBytes)} readOnly /></label>)}
  </> : null;

  const renderControlIdentityProperties = () => {
    if (!selectedControl) return null;
    return (
      <PropertyGroup title="基础属性" className="designer-prop-section designer-prop-section-identity" titleClassName="designer-prop-section-title">
        <PropertyRow label="名称" className="designer-prop-row-key">
          <Input
            aria-label="显示名称"
            value={selectedControl.name}
            onChange={(event) => updateSelectedControl({ name: event.target.value })}
          />
        </PropertyRow>
        <label>
          <span>控件类型</span>
          {isLayoutControl(selectedControl) ? <Input readOnly value={selectedControl.controlType === 'divider' ? '分割符' : selectedControl.controlType === 'container' ? '分组容器' : selectedControl.controlType === 'tabs' ? '页签容器' : '多列布局'} /> : <Select
            value={selectedEffectiveControlType === 'relation' ? 'select' : selectedEffectiveControlType}
            options={isEncodingField(selectedField) ? controlTypeOptions.filter((option) => ['code', 'text', 'textarea', 'readonly-text'].includes(String(option.value))) : controlTypeOptions}
            onChange={(controlType) => {
              const nextWidth = controlType === 'textarea' || controlType === 'upload' ? 'full' : selectedControl.width;
              updateSelectedControl({
                controlType,
                width: nextWidth as ControlWidth,
                typeSettings: getDefaultTypeSettings(controlType, selectedField),
              });
            }}
          />}
        </label>
        {renderFieldBindingProperties()}
        {!isLayoutControl(selectedControl) && !selectedControl.fieldKey && <Alert type="warning" showIcon message="请先绑定存储字段" description="选择绑定字段后，填写内容才能保存。" />}
      </PropertyGroup>
    );
  };

  const referenceObjectOptions=selectedReferenceSourceKind==='dictionary'?optionCatalog.dictionaries.map(item=>({value:item.code,label:item.name})):selectedReferenceSourceKind==='externalApi'?optionCatalog.externalApis.map(item=>({value:String(item.id),label:item.name})):selectedReferenceSourceKind==='businessForm'?referenceForms.filter(form=>form.id!==platformForm?.id).map(form=>({value:form.code,label:form.name})):selectedReferenceConfig.objects;
  const renderDataSourceProperties = () => {
    if (!selectedControl || !selectedControlUsesDataSource) return null;
    return (
      <>
        <label>
          <span>来源类型</span>
          <Select
            value={selectedReferenceSourceKind}
            options={referenceSourceKindOptions}
            onChange={(dataSourceKind) => {
              const config = getReferenceConfig(dataSourceKind);
              updateSelectedControl({
                dataSourceKind,
                optionSource: dataSourceKind==='static'?'[]':dataSourceKind==='dictionary'?optionCatalog.dictionaries[0]?.code:dataSourceKind==='externalApi'?String(optionCatalog.externalApis[0]?.id||''):dataSourceKind==='businessForm'?referenceForms[0]?.code:config.objects[0]?.value,
                referenceValueField:undefined,referenceItemsPath:'data',
                typeSettings:{...selectedControl.typeSettings,search:undefined,...(dataSourceKind !== 'static'?{selectionMode:'single',displayMode:'search',allowCreateOption:false}:{displayMode:'dropdown'})},
                referenceLabelField:undefined,
              });
            }}
          />
        </label>
        {selectedReferenceSourceKind === 'static' ? (
          <StaticOptionsEditor
            options={parseStaticOptions(selectedControl.optionSource, selectedField?.enumValues)}
            onChange={options => updateSelectedControl({ optionSource: JSON.stringify(options) })}
          />
        ) : (
          <label>
            <span>引用对象</span>
            <Select
              value={selectedControl.optionSource || undefined}
              options={referenceObjectOptions}
              placeholder={selectedReferenceConfig.placeholder}
              onChange={(optionSource) => updateSelectedControl({ optionSource,referenceLabelField:undefined,typeSettings:{...selectedControl.typeSettings,search:undefined} })}
            />
          </label>
        )}
        <label>
          <span>显示字段</span>
          {selectedReferenceSourceKind==='externalApi'?<Input aria-label="API 显示字段" value={selectedControl.referenceLabelField||'name'} onChange={event=>updateSelectedControl({referenceLabelField:event.target.value})}/>:<Select
            value={selectedControl.referenceLabelField || referenceLabelOptions[0]?.value} onChange={referenceLabelField=>updateSelectedControl({referenceLabelField})}
            options={referenceLabelOptions} disabled={['static','dictionary'].includes(selectedReferenceSourceKind)}
          />}
        </label>
        <label>
          <span>值字段</span>
          {selectedReferenceSourceKind==='externalApi'?<Input aria-label="API 值字段" value={selectedControl.referenceValueField||'id'} onChange={event=>updateSelectedControl({referenceValueField:event.target.value})}/>:<Input readOnly value={selectedReferenceSourceKind==='static'?'value（选项值）':selectedReferenceSourceKind==='dictionary'?'value（字典项编码）':'id（记录 ID）'}/>}

        </label>
        {selectedReferenceSourceKind==='externalApi'&&<><label><span>选项数组路径</span><Input aria-label="API 数组路径" placeholder="data.items；根数组留空" value={selectedControl.referenceItemsPath??'data'} onChange={event=>updateSelectedControl({referenceItemsPath:event.target.value})}/></label><PropertyHelp>只读 GET；接口 URL、认证头及内网访问许可在数据连接中维护，表单只保存数据源 ID 和映射。最多 1000 项。</PropertyHelp></>}
        {selectedReferenceSourceKind!=='static'&&<Button loading={testingOptionSource} disabled={!platformForm||!selectedControl.optionSource} onClick={async()=>{if(!platformForm||!selectedControl.fieldKey)return;setTestingOptionSource(true);try{const response=await previewFormReferenceOptions(platformForm.id,selectedControl.fieldKey,layoutControls,{});const options=response.data.data||[];Modal.info({className:'form-designer-dialog',title:`真实选项预览（${options.length} 项）`,content:<div style={{maxHeight:300,overflow:'auto'}}>{options.slice(0,20).map((option:any)=><div key={String(option.id)}>{option.label} · {String(option.id)}</div>)}{!options.length&&'当前来源没有启用的选项'}</div>});}catch(error:any){message.error(error?.response?.data?.detail||'选项读取失败');}finally{setTestingOptionSource(false);}}}>读取真实选项</Button>}
      </>
    );
  };

  const renderEncodingProperties = () => {
    if (!selectedControlUsesEncoding || !selectedEncodingRule) return null;
    return (
      <div className="designer-encoding-block"><div className="designer-encoding-heading"><span>编码规则</span><Button className="encoding-heading-add" aria-label="新增编码规则" title="新增编码规则"
            icon={<PlusOutlined />} onClick={() => { encodingRuleTargetRef.current = { controlId: selectedControlId, rule: selectedEncodingRule }; setEncodingSettingsDraft({ ...makeEncodingRule(selectedField),
              id: `rule-${createUuid()}`, name: `编码规则 ${getEncodingRules(selectedEncodingRule).length + 1}`, conditions: [] }); }} size="small" type="text" /></div>
        {getEncodingRules(selectedEncodingRule).map((rule, index) => (
          <label key={rule.id || index}>
            <span title={rule.name}>{rule.name || `编码规则 ${index + 1}`}</span>
            <div className="designer-rule-toggle">

              <Button className="designer-rule-config-button" aria-label={`设置编码规则：${rule.name}`}
                title="设置编码规则" icon={<SettingOutlined />} size="small" type="text"
                onClick={() => { encodingRuleTargetRef.current = { controlId: selectedControlId, rule: selectedEncodingRule }; setEncodingSettingsDraft(structuredClone(rule)); }} />
              <button type="button" role="switch" aria-label={`启用编码规则：${rule.name}`} aria-checked={rule.enabled !== false}
                className={`designer-rule-check ${rule.enabled !== false ? 'designer-rule-check-on' : ''}`}
                title={rule.enabled !== false ? '已启用' : '已停用'}
                onClick={(event) => { event.preventDefault(); event.stopPropagation(); updateSelectedEncodingRule({ enabled: true,
                  rules: getEncodingRules(selectedEncodingRule).map((item, i) => i === index ? { ...item, enabled: item.enabled === false } : item) }); }}>
                <span className="designer-rule-check-box" aria-hidden="true" />
              </button>
            </div>
          </label>
        ))}
      </div>
    );
  };

  const renderLayoutWidth = () => {
    if (!selectedControl) return null;
    return (
      <PropertyRow label="宽度" hint="宽度相对于所在容器，空间不足时自动换行。" className="designer-width-setting">
        <Select aria-label="宽度" value={selectedControl.width} options={controlWidthOptions}
          onChange={width => updateSelectedControl({ width: width as ControlWidth, presentation: { ...selectedControl.presentation, startNewRow: false } })} />
      </PropertyRow>
    );
  };

  const renderLayoutAppearance = () => {
    if (!selectedControl) return null;
    const presentation = getControlPresentation(selectedControl.presentation);
    const updatePresentation = (patch: Partial<ControlPresentation>) => updateSelectedControl({ presentation: { ...selectedControl.presentation, ...patch } });
    const hasFieldLabel = Boolean(selectedControl.fieldKey) || ['text', 'textarea', 'number', 'select', 'relation', 'datetime', 'upload', 'switch', 'readonly-text', 'code'].includes(selectedControl.controlType);
    return (
      <PropertyAdvanced className="designer-appearance-advanced" title="外观" key={selectedControl.id}>
        {hasFieldLabel && <>
          <label><span>标题位置</span><Select aria-label="标题位置" value={presentation.labelPosition} options={[{ value: 'top', label: '上方' }, { value: 'left', label: '左侧' }]} onChange={labelPosition => updatePresentation({ labelPosition, labelAlign: labelPosition === 'left' ? 'right' : 'left', labelWidth: labelPosition === 'left' ? 80 : presentation.labelWidth })} /></label>
          <label><span>标题对齐</span><Select aria-label="标题对齐" value={presentation.labelAlign} options={[{ value: 'left', label: '左对齐' }, { value: 'right', label: '右对齐' }]} onChange={labelAlign => updatePresentation({ labelAlign })} /></label>
          {presentation.labelPosition === 'left' && <label><span>标题宽度</span><InputNumber aria-label="标题宽度" min={64} max={240} step={8} value={presentation.labelWidth} suffix="px" onChange={labelWidth => updatePresentation({ labelWidth: labelWidth ?? 96 })} /></label>}
        </>}
        {hasFieldLabel && <>
          <label><span>输入框高度</span><InputNumber aria-label="输入框高度" min={24} max={64} placeholder="跟随主题" value={presentation.controlHeight} suffix="px" onChange={controlHeight => updatePresentation({ controlHeight: controlHeight ?? undefined })} /></label>
          <label><span>输入框宽度</span><InputNumber aria-label="输入框宽度" min={80} max={1600} placeholder="填满可用空间" value={presentation.controlWidth} suffix="px" onChange={controlWidth => updatePresentation({ controlWidth: controlWidth ?? undefined })} /></label>
        </>}
          <label><span>下方留白</span><InputNumber aria-label="下方留白" min={0} max={48} step={4} value={presentation.spacingAfter} suffix="px" onChange={spacingAfter => updatePresentation({ spacingAfter: spacingAfter ?? 0 })} /></label>
          {hasFieldLabel && <>
            <label><span>控件圆角</span><InputNumber aria-label="控件圆角" min={0} max={24} placeholder="跟随主题" value={presentation.borderRadius} suffix="px" onChange={borderRadius => updatePresentation({ borderRadius: borderRadius ?? undefined })} /></label>
            <label><span>输入字号</span><InputNumber aria-label="输入字号" min={10} max={24} placeholder="跟随主题" value={presentation.fontSize} suffix="px" onChange={fontSize => updatePresentation({ fontSize: fontSize ?? undefined })} /></label>
            <label><span>标题字号</span><InputNumber aria-label="标题字号" min={10} max={24} placeholder="跟随主题" value={presentation.labelFontSize} suffix="px" onChange={labelFontSize => updatePresentation({ labelFontSize: labelFontSize ?? undefined })} /></label>
          </>}
      </PropertyAdvanced>
    );
  };

  const renderSearchSettingsEditor = () => {
    if (!searchDraft) return null;
    const { schema, settings } = searchDraft;
    const filters = settings.filters || [];
    const updateFilter = (id:string, patch:Partial<NonNullable<OptionSearchSettings['filters']>[number]>) => updateSearchSettings({filters:filters.map(filter => filter.id===id?{...filter,...patch}:filter)});
    const linked = [...new Set(filters.filter(filter=>filter.source==='field'&&!['isEmpty','notEmpty'].includes(filter.operator)&&filter.sourceField).map(filter=>filter.sourceField!))];
    return <div className="encoding-rule-workspace search-rule-workspace">
      <section className="encoding-editor-section">
        <div className="encoding-section-title"><strong>搜索内容</strong><span>{selectedControl?.name}</span></div>
        <div className="search-source-note">数据来源：{schema?.kind==='static'?'当前字段的静态选项':referenceObjectOptions.find(option=>option.value===selectedControl?.optionSource)?.label||selectedControl?.optionSource||'尚未选择来源'}</div>
        <div className="encoding-basics-fields">
          <label className="encoding-editor-field"><span>搜索字段（任意字段匹配即可）</span><Select aria-label="搜索字段" mode="multiple" maxCount={8} loading={searchDraft.metaLoading} disabled={!schema||schema.kind==='static'} value={settings.fields} options={schema?.fields||[]} onChange={fields=>updateSearchSettings({fields})}/></label>
          <label className="encoding-editor-field"><span>匹配方式</span><Select aria-label="搜索匹配方式" disabled={searchDraft.metaLoading} value={settings.match||'contains'} options={[{value:'contains',label:'包含'},{value:'prefix',label:'开头匹配'},{value:'exact',label:'完全匹配'}]} onChange={match=>updateSearchSettings({match})}/></label>
        </div>
        {schema?.note&&<p className="encoding-editor-hint">{schema.note}</p>}
      </section>
      {schema&&schema.kind!=='static'&&<section className="encoding-editor-section search-range-section">
        <div className="encoding-section-title"><strong>候选范围 <span className="encoding-section-count">全部条件满足</span></strong><Button type="text" size="small" icon={<PlusOutlined/>} disabled={filters.length>=20} onClick={()=>updateSearchSettings({filters:[...filters,{id:createUuid(),field:schema.fields[0]?.value||'',operator:'eq',source:'fixed',value:''}]})}>添加范围条件</Button></div>
        <p className="encoding-editor-hint">始终限定在当前用户有权查看的数据内；不添加条件时使用全部授权候选。引用字段未填写时，不返回候选。</p>
        {filters.map((filter,index)=><div key={filter.id} className="search-range-row">
          <Select aria-label={`范围字段 ${index+1}`} value={filter.field} options={schema.fields} onChange={field=>updateFilter(filter.id,{field})}/>
          <Select aria-label={`范围条件 ${index+1}`} value={filter.operator} options={[{value:'eq',label:'等于'},{value:'ne',label:'不等于'},{value:'isEmpty',label:'为空'},{value:'notEmpty',label:'不为空'}]} onChange={operator=>updateFilter(filter.id,{operator})}/>
          {!['isEmpty','notEmpty'].includes(filter.operator)?<><Select aria-label={`范围取值方式 ${index+1}`} value={filter.source} options={[{value:'fixed',label:'固定值'},{value:'field',label:'当前表单字段'}]} onChange={source=>updateFilter(filter.id,{source})}/>
          {filter.source==='fixed'?<Input aria-label={`范围固定值 ${index+1}`} placeholder="例如：启用" value={filter.value} onChange={event=>updateFilter(filter.id,{value:event.target.value})}/>:<Select aria-label={`范围引用字段 ${index+1}`} placeholder="选择表单字段" value={filter.sourceField} options={baseConfig.fields.filter(field=>field.storageType!=='json'&&field.key!==selectedControl?.fieldKey).map(field=>({value:field.key,label:field.name}))} onChange={sourceField=>updateFilter(filter.id,{sourceField})}/>}</>:<span className="search-range-no-value">无需取值</span>}
          <Button type="text" size="small" aria-label={`删除范围条件 ${index+1}`} icon={<DeleteOutlined/>} onClick={()=>updateSearchSettings({filters:filters.filter(item=>item.id!==filter.id)})}/>
        </div>)}
      </section>}
      <section className="encoding-editor-section search-test-section">
        <div className="encoding-section-title"><strong>试搜</strong><span>只读取候选，不创建业务记录</span></div>
        {linked.length>0&&<div className="search-context-fields">{linked.map(key=><label className="encoding-editor-field" key={key}><span>{baseConfig.fields.find(field=>field.key===key)?.name||key}（试填值）</span><Input aria-label={`搜索试填 ${key}`} value={searchDraft.context[key]||''} onChange={event=>updateSearchSample({context:{...searchDraft.context,[key]:event.target.value}})}/></label>)}</div>}
        <div className="search-test-input"><Input aria-label="试搜关键词" placeholder="输入关键词，留空可查看首批候选" maxLength={256} value={searchDraft.query} disabled={searchDraft.metaLoading} onChange={event=>updateSearchSample({query:event.target.value})} onPressEnter={()=>void testOptionSearch()}/><Button icon={<SearchOutlined/>} loading={searchDraft.loading} disabled={!schema||searchDraft.metaLoading} onClick={()=>void testOptionSearch()}>试搜</Button></div>
        {searchDraft.error&&<Alert type="error" showIcon message={searchDraft.error}/>}
        <Table size="small" rowKey={(row: SearchSettingsDraft['rows'][number])=>String(row.id)} pagination={false} dataSource={searchDraft.rows} locale={{emptyText:searchDraft.tested?'没有符合条件的选项':'输入关键词并点击试搜，查看真实匹配结果'}} columns={[{title:'显示文字',dataIndex:'label'},{title:'保存值',dataIndex:'id'},{title:'匹配字段',dataIndex:'matchedFields',render:(fields:string[])=>fields.map(key=>schema?.fields.find(field=>field.value===key)?.label||key).join('、')||'—'}]}/>
        {searchDraft.hasMore&&<Button type="text" loading={searchDraft.loading} onClick={()=>void testOptionSearch(searchDraft.page+1)}>加载更多结果</Button>}
      </section>
    </div>;
  };

  const renderAssignmentRules = () => {
    if (!selectedControl) return null;
    const enabled = selectedControl.assignmentRulesEnabled ?? Boolean(selectedControl.assignmentRules?.length);
    return <div className="designer-property-rule-row">
      {renderRuleLabel('赋值规则', '开启后，将本字段值、选项文本或关联属性写入目标字段。关闭后保留配置，但不执行赋值。', true)}
      <div className="designer-rule-toggle">
        {enabled && <Button className="designer-rule-config-button" type="text" size="small" icon={<SettingOutlined />} aria-label="设置赋值规则" onClick={() => setAssignmentDraft({ controlId: selectedControl.id, rules: structuredClone(selectedControl.assignmentRules || []) })} />}
        <button type="button" role="switch" aria-label="启用赋值规则" aria-checked={enabled} className={`designer-rule-check ${enabled ? 'designer-rule-check-on' : ''}`}
          onClick={event => { event.preventDefault(); event.stopPropagation(); updateSelectedControl({ assignmentRulesEnabled: !enabled }); }}><span className="designer-rule-check-box" aria-hidden="true" /></button>
      </div>
    </div>;
  };

  const renderAssignmentEditor = () => assignmentDraft && <div className="encoding-rule-workspace assignment-rule-workspace">
    <div className="encoding-section-title"><strong>赋值映射 <span className="encoding-section-count">{assignmentDraft.rules.length} 条</span></strong><Button type="text" size="small" icon={<PlusOutlined />} onClick={addAssignmentRule}>添加映射</Button></div>
    {!assignmentDraft.rules.length && <div className="encoding-empty-segments">尚未配置映射，请添加来源属性与目标字段。</div>}
    {assignmentDraft.rules.map((rule, index) => <div className="assignment-dialog-row" key={rule.id}>
      <span className="assignment-dialog-index">{index + 1}</span>
      <Select aria-label={`赋值来源 ${index + 1}`} placeholder="本字段属性" value={rule.sourceAttribute} options={assignmentSourceAttributeOptions} onChange={sourceAttribute => updateAssignmentRule(rule.id, { sourceAttribute })} />
      <span>赋值给</span>
      <Select aria-label={`赋值目标 ${index + 1}`} placeholder="目标字段" value={rule.targetField} options={assignmentTargetFieldOptions} onChange={targetField => updateAssignmentRule(rule.id, { targetField })} />
      <Button type="text" size="small" aria-label={`删除赋值映射 ${index + 1}`} icon={<DeleteOutlined />} onClick={() => removeAssignmentRule(rule.id)} />
    </div>)}
    <div className="default-rule-behavior-note"><QuestionCircleOutlined /><span>一个目标字段只保留一个赋值来源；正式填写与试填使用同一套规则。</span></div>
  </div>;

  const renderInteractionProperties = () => {
    if (!selectedControl) return null;
    if (selectedControl.controlType === 'divider') {
      return <PropertyGroup title="交互属性" className="designer-prop-section" titleClassName="designer-prop-section-title">
        <label><span>显示</span>{controlRuleToggle('visible')}</label>
      </PropertyGroup>;
    }
    if (isLayoutContainer(selectedControl)) {
      return <PropertyGroup title="交互属性" hint="显示和只读会同时作用于容器内的控件。" className="designer-prop-section" titleClassName="designer-prop-section-title">
        <label><span>显示</span>{controlRuleToggle('visible')}</label>
        <label><span>只读</span>{controlRuleToggle('readonly')}</label>
      </PropertyGroup>;
    }
    return <PropertyGroup title="交互属性" hint="齿轮可配置条件。默认值在新增时预填，已填写的内容不会被覆盖。" className="designer-prop-section" titleClassName="designer-prop-section-title">
      <label>{renderRuleLabel('显示', '开启后，字段在表单中显示；关闭后隐藏。通过齿轮可设置显示条件。')}{controlRuleToggle('visible')}</label>
      <label>{renderRuleLabel('必填', '开启后，此字段必须填写才能提交。通过齿轮可设置必填条件。')}{controlRuleToggle('required')}</label>
      <label>{renderRuleLabel('只读', '开启后，使用者可查看此字段，但不能修改。通过齿轮可设置只读条件。')}{controlRuleToggle('readonly')}</label>
      {renderDefaultValueProperties()}
      <label>
        <span>占位提示</span>
        <Input allowClear placeholder={selectedField?.placeholder || selectedControl.desc || '请输入占位提示'} value={selectedControl.placeholder || ''} onChange={(event) => updateSelectedControl({ placeholder: event.target.value })} />
      </label>
      <label>
        <span>帮助说明</span>
        <Input allowClear placeholder="填写时需要知道的说明" value={selectedControl.helpText || ''} onChange={(event) => updateSelectedControl({ helpText: event.target.value })} />
      </label>
      {hiddenRequiredControls.length > 0 && <Tag color="red">存在隐藏且必填冲突</Tag>}
    </PropertyGroup>;
  };

  const renderDataAttributeProperties = () => {
    if (!selectedControl || isLayoutControl(selectedControl)) return null;
    return <PropertyGroup title="数据属性" hint="唯一在保存时校验；脱敏作用于读取；允许复制作用于运行页的复制和剪切。" className="designer-prop-section" titleClassName="designer-prop-section-title">
      <label>{renderRuleLabel('唯一', '开启后，保存时检查字段值是否已存在，重复值不能保存。')}{controlRuleToggle('unique')}</label>
      <label>{renderRuleLabel('脱敏', '开启后，读取记录时按脱敏规则隐藏部分内容。')}{controlRuleToggle('masked')}</label>
      <label>{renderRuleLabel('允许复制', '开启后，使用者可以在运行表单中复制或剪切字段内容。')}{controlRuleToggle('copyable')}</label>
      {renderCalculationProperties()}
      {renderAssignmentRules()}
      {renderDataSourceProperties()}
      {renderEncodingProperties()}
    </PropertyGroup>;
  };

  const renderRuleLabel = (title: string, help: string, clickOnly = false) => <span className="designer-rule-label">{title}<Tooltip title={help} trigger={clickOnly ? ['click'] : ['hover', 'focus']}><button className="designer-property-help" type="button" aria-label={`${title}说明`} onClick={event => event.preventDefault()}><QuestionCircleOutlined /></button></Tooltip></span>;

  const renderDefaultValueProperties = () => {
    if (!selectedControl) return null;
    const rule = selectedControl.defaultRule || selectedField?.defaultRule || { mode: 'fixed' as const };
    const automaticCode = selectedControlUsesEncoding && (selectedControl.encodingRule || selectedField?.encodingRule)?.generationMode !== 'manual';
    const disabled = !selectedField || automaticCode || Boolean(selectedControl?.computed);
    const configured = rule.mode === 'template' || String(getFieldDefaultValue(selectedField)) !== '';
    const enabled = rule.enabled ?? configured;
    return <div className="designer-default-mode-row">
      {renderRuleLabel('默认值', '开启后在新增时预填，允许使用者修改；关闭后保留规则但不生成默认值。齿轮用于配置规则。', true)}
      <div className="designer-rule-toggle">
        {enabled && <Button className="designer-rule-config-button" size="small" type="text" icon={<SettingOutlined />} aria-label="设置默认值规则" disabled={Boolean(disabled)} onClick={event => { event.preventDefault(); event.stopPropagation(); setDefaultValueDraft({ controlId: selectedControl.id, rule: { ...structuredClone(rule), parts: (rule.parts || []).map(part => ({ ...part, id: part.id || createUuid() })) }, fixed: String(getFieldDefaultValue(selectedField)) }); }} />}
        <button type="button" role="switch" aria-label="启用默认值" aria-checked={enabled} disabled={Boolean(disabled)}
          className={`designer-rule-check ${enabled ? 'designer-rule-check-on' : ''}`}
          onClick={event => { event.preventDefault(); event.stopPropagation(); updateSelectedControl({ defaultRule: { ...rule, enabled: !enabled } }); }}>
          <span className="designer-rule-check-box" aria-hidden="true" />
        </button>
      </div>
    </div>;
  };

  const renderDefaultValueEditor = () => {
    if (!defaultValueDraft || !selectedControl || defaultValueDraft.controlId !== selectedControl.id) return null;
    const { rule, fixed } = defaultValueDraft;
    const parts = rule.parts || [];
    const canConcatenate = Boolean(selectedField && ['string', 'text', 'code'].includes(mapDesignerFieldType(selectedField)));
    const setRule = (next: DefaultValueRule) => setDefaultValueDraft(current => current && ({ ...current, rule: next }));
    const setParts = (next: typeof parts) => setRule({ ...rule, mode: 'template', parts: next });
    const sourceFields = baseConfig.fields.filter(field => field.key !== selectedField?.key && field.storageType !== 'json' && !field.computed && !isEncodingField(field));
    const movePart = (index: number, offset: number) => {
      const next = [...parts];
      [next[index], next[index + offset]] = [next[index + offset], next[index]];
      setParts(next);
    };
    const errors = defaultRuleErrors(layoutControls.map(control => control.id === selectedControl.id ? { ...control, defaultRule: { ...rule, enabled: true } } : control), baseConfig.fields);
    const summary = rule.mode === 'template' ? defaultRuleSummary(rule, baseConfig.fields) : fixed;
    return <div className="encoding-rule-workspace default-rule-workspace">
      <div className="encoding-rule-editor default-rule-editor">
        <section className="encoding-editor-section encoding-rule-basics">
          <div className="encoding-basics-fields">
            <label className="encoding-editor-field"><span>对应字段</span><Input aria-label="默认值对应字段" readOnly value={selectedControl.name} /></label>
            <label className="encoding-editor-field"><span>生成方式</span><Select aria-label="默认值方式" value={rule.mode} options={[{ value: 'fixed', label: '固定值' }, { value: 'template', label: '按规则拼接', disabled: !canConcatenate }]} onChange={mode => setRule({ ...rule, mode, parts: mode === 'template' && !parts.length ? [newDefaultPart('text')] : parts })} /></label>
          </div>
        </section>
        <section className="encoding-editor-section encoding-rule-conditions default-rule-conditions">
          <div className="encoding-section-title encoding-trigger-heading">
            <strong>何时触发<Tooltip title="不添加条件时不限制预填；添加后，只有全部条件满足时才预填。已填写的内容不会被默认值覆盖。" trigger={['hover','focus']}><button type="button" className="encoding-trigger-help" aria-label="默认值何时触发说明"><QuestionCircleOutlined /></button></Tooltip></strong>
            <Button size="small" type="text" icon={<PlusOutlined />} aria-label="添加默认值触发条件" disabled={(rule.conditions || []).length >= 20} onClick={() => setRule({...rule, conditions:[...(rule.conditions || []), {sourceField:sourceFields[0]?.key || '',operator:'eq',value:''}]})}>添加触发条件</Button>
          </div>
          {(rule.conditions || []).map((condition,index) => <div className="encoding-condition-row" key={index}>
            <Select aria-label={`默认值条件字段 ${index+1}`} placeholder="选择字段" value={condition.sourceField || undefined} options={sourceFields.map(field => ({value:field.key,label:field.name}))} onChange={sourceField => setRule({...rule,conditions:rule.conditions?.map((item,i) => i === index ? {...item,sourceField} : item)})} />
            <Select aria-label={`默认值条件运算符 ${index+1}`} value={condition.operator} options={[{value:'eq',label:'等于'},{value:'ne',label:'不等于'},{value:'contains',label:'包含'},{value:'gte',label:'大于等于'},{value:'lte',label:'小于等于'},{value:'isEmpty',label:'为空'},{value:'notEmpty',label:'不为空'}]} onChange={operator => setRule({...rule,conditions:rule.conditions?.map((item,i) => i === index ? {...item,operator} : item)})} />
            {['isEmpty','notEmpty'].includes(condition.operator) ? <span className="encoding-no-value">无需填写值</span> : <Input aria-label={`默认值条件值 ${index+1}`} placeholder="填写匹配值" value={condition.value} onChange={event => setRule({...rule,conditions:rule.conditions?.map((item,i) => i === index ? {...item,value:event.target.value} : item)})} />}
            <Button type="text" aria-label={`删除默认值条件 ${index+1}`} icon={<DeleteOutlined />} onClick={() => setRule({...rule,conditions:rule.conditions?.filter((_,i) => i !== index)})} />
          </div>)}
        </section>
        {rule.mode === 'fixed' ? <section className="encoding-editor-section">
          <div className="encoding-section-title encoding-composition-heading"><strong>预填内容</strong><div className="encoding-heading-preview" aria-label="默认值结果预览" aria-live="polite"><span>生成结果预览</span><code>{summary || '—'}</code></div></div>
          <Input.TextArea aria-label="固定默认值" placeholder="留空则不预填" autoSize={{ minRows: 1, maxRows: 4 }} value={fixed} onChange={event => setDefaultValueDraft(current => current && ({ ...current, fixed: event.target.value }))} />
        </section> : <section className="encoding-editor-section encoding-rule-composition">
          <div className="encoding-section-title encoding-composition-heading">
            <strong>默认值片段 <span className="encoding-section-count">{parts.length} / 20 段</span></strong>
            <div className="encoding-heading-preview" aria-label="默认值结果预览" aria-live="polite"><span>生成结果预览</span><code>{summary || '—'}</code></div>
            <Space size={4}><Button type="text" size="small" icon={<PlusOutlined />} disabled={parts.length >= 20} onClick={() => setParts([...parts, newDefaultPart('text')])}>固定文字</Button><Button type="text" size="small" icon={<PlusOutlined />} disabled={parts.length >= 20 || !sourceFields.length} onClick={() => setParts([...parts, newDefaultPart('field')])}>引用字段</Button></Space>
          </div>
          <div className="encoding-segment-list default-rule-parts">
            {parts.map((part, index) => <div key={part.id} className="encoding-segment-item default-rule-part">
              <span className="default-rule-part-index">{index + 1}</span>
              <Select aria-label={`默认值片段 ${index + 1} 类型`} value={part.kind} options={[{ value: 'text', label: '固定文字' }, { value: 'field', label: '引用字段' }]} onChange={kind => setParts(parts.map(item => item.id === part.id ? { ...item, kind, value: '' } : item))} />
              {part.kind === 'text' ? <Input aria-label={`默认值片段 ${index + 1} 内容`} maxLength={4096} placeholder="例如：MAT- 或分隔符" value={part.value} onChange={event => setParts(parts.map(item => item.id === part.id ? { ...item, value: event.target.value } : item))} /> : <Select aria-label={`默认值片段 ${index + 1} 字段`} placeholder="选择来源字段" value={part.value || undefined} options={sourceFields.map(field => ({ value: field.key, label: field.name }))} onChange={value => setParts(parts.map(item => item.id === part.id ? { ...item, value } : item))} />}
              <div className="default-rule-part-actions">
                <Button type="text" size="small" aria-label={`上移默认值片段 ${index + 1}`} disabled={index === 0} onClick={() => movePart(index, -1)}>↑</Button>
                <Button type="text" size="small" aria-label={`下移默认值片段 ${index + 1}`} disabled={index === parts.length - 1} onClick={() => movePart(index, 1)}>↓</Button>
                <Button type="text" size="small" aria-label={`删除默认值片段 ${index + 1}`} icon={<DeleteOutlined />} onClick={() => setParts(parts.filter(item => item.id !== part.id))} />
              </div>
            </div>)}
          </div>
        </section>}
        {errors.length > 0 && <p className="default-rule-error" role="alert">{errors.join('；')}</p>}
      </div>
    </div>;
  };

  const renderCalculationProperties = () => {
    if (!selectedControl || !selectedField || isEncodingField(selectedField) || !['string','text','int','integer','number','float','decimal'].includes(selectedField.storageType || 'string') || ['relation','upload','editable-table','readonly-table','datetime','switch','select'].includes(selectedControl.controlType)) return null;
    const enabled = selectedControl.calculationRulesEnabled ?? Boolean(selectedControl.computed);
    return <div className="designer-property-rule-row">
      {renderRuleLabel('计算规则', '开启后可通过齿轮配置计算公式；关闭后保留配置并停止计算。来源字段变化时自动计算，结果只读。', true)}
      <div className="designer-rule-toggle">
        {enabled && <Button className="designer-rule-config-button" type="text" size="small" icon={<SettingOutlined />} aria-label="设置计算规则" disabled={!platformForm} onClick={() => {
          setCalculationError(''); setCalculationResult(null);
          setCalculationDraft({ controlId: selectedControl.id, rule: structuredClone(selectedControl.computed || selectedControl.inactiveCalculationRule || { expression: '', precision: ['int','integer'].includes(selectedField.storageType || '') ? 0 : null, emptyBehavior: 'empty' }), samples: {} });
        }} />}
        <button type="button" role="switch" aria-label="启用计算规则" aria-checked={enabled} className={`designer-rule-check ${enabled ? 'designer-rule-check-on' : ''}`} onClick={event => {
          event.preventDefault(); event.stopPropagation();
          const rule = selectedControl.computed || selectedControl.inactiveCalculationRule;
          updateSelectedControl(enabled
            ? { calculationRulesEnabled: false, inactiveCalculationRule: rule, computed: null }
            : { calculationRulesEnabled: true, computed: rule || null, ...(rule ? { defaultRule: { ...(selectedControl.defaultRule || { mode: 'fixed' as const }), enabled: false } } : {}) });
        }}><span className="designer-rule-check-box" aria-hidden="true" /></button>
      </div>
    </div>;
  };

  const renderCalculationEditor = () => {
    if (!calculationDraft) return null;
    const target = layoutControls.find(control => control.id === calculationDraft.controlId);
    const numericResult = ['int','integer','number','float','decimal'].includes(baseConfig.fields.find(field => field.key === target?.fieldKey)?.storageType || '');
    const fields = baseConfig.fields.filter(field => field.key !== target?.fieldKey && field.storageType !== 'json' && !isEncodingField(field));
    const rules = Object.fromEntries(baseConfig.fields.map(field => {
      const control = layoutControls.find(control => control.fieldKey === field.key);
      return [field.key, control?.computed === undefined ? field.calculationRule : control.computed];
    }));
    const sources = calculationSources(calculationDraft.rule.expression, fields, rules);
    return <div className="calculation-editor">
      <div className="encoding-basics-fields"><label className="encoding-editor-field"><span>结果字段</span><span className="calculation-target-name">{target?.name}</span></label><span className="calculation-readonly-note">{numericResult ? '数值结果 · 自动计算 · 只读' : '文本结果 · 可拼接文字和字段 · 只读'}</span></div>
      <section><div className="encoding-section-title"><strong>计算方式</strong><Tooltip title="数值支持算术运算；文本支持字段和固定文字拼接；条件判断可按字段值选择不同结果。复杂表达式可使用高级公式。"><button className="encoding-trigger-help" aria-label="计算公式说明"><QuestionCircleOutlined /></button></Tooltip></div>
        <CalculationExpressionEditor key={calculationDraft.controlId} expression={calculationDraft.rule.expression} onChange={expression => updateCalculationDraft({ expression })} fields={fields} numericResult={numericResult} targetName={target?.name || '结果'} />
      </section>
      <section className="calculation-options">{numericResult && <label><span>小数位数</span><RuleInlineSelect aria-label="计算结果小数位数" value={calculationDraft.rule.precision ?? 'auto'} options={[{ value: 'auto', label: '不额外舍入' }, ...Array.from({ length: 7 }, (_, value) => ({ value, label: `${value} 位（四舍五入）` }))]} onChange={value => updateCalculationDraft({ precision: value === 'auto' ? null : Number(value) })} /></label>}<label><span>来源为空</span><RuleInlineSelect aria-label="计算空值处理" value={calculationDraft.rule.emptyBehavior || 'empty'} options={[{ value: 'empty', label: '结果留空' }, { value: 'zero', label: '按 0 计算' }]} onChange={emptyBehavior => updateCalculationDraft({ emptyBehavior })} /></label></section>
      <section><div className="encoding-section-title"><strong>试算</strong><Button size="small" type="text" loading={calculationBusy} onClick={() => checkCalculation(false)}>计算预览</Button></div>
        {sources.length > 0 && <div className="calculation-samples">{sources.map(field => <label key={field.key}><span>{field.name}</span>{['int','integer','float','number','decimal'].includes(field.storageType || '') ? <InputNumber aria-label={`试算值：${field.name}`} value={calculationDraft.samples[field.key] as number | undefined} onChange={value => updateCalculationDraft({}, { ...calculationDraft.samples, [field.key]: value })} /> : <Input aria-label={`试算值：${field.name}`} value={String(calculationDraft.samples[field.key] ?? '')} onChange={event => updateCalculationDraft({}, { ...calculationDraft.samples, [field.key]: event.target.value })} />}</label>)}</div>}
        <div className="calculation-result" aria-label="计算预览结果" aria-live="polite"><span>结果</span><code>{calculationResult ? calculationResult.value == null ? '—（来源为空）' : String(calculationResult.value) : '填写测试值后点击计算预览'}</code></div>
      </section>
      {calculationError && <Alert type="error" showIcon message={calculationError} />}
    </div>;
  };

  return {
    renderControlIdentityProperties,
    renderLayoutWidth,
    renderLayoutAppearance,
    renderDataSourceProperties,
    renderEncodingProperties,
    renderTypeSpecificProperties,
    renderInteractionProperties,
    renderDataAttributeProperties,
    renderSearchSettingsEditor,
    renderCalculationEditor,
    renderAssignmentEditor,
    renderDefaultValueEditor,
  };
}

function propertyNode(scope: PropertyPanelScope, actions: PropertyPanelActions, render: (panels: ReturnType<typeof createPropertyRenderers>) => React.ReactNode) {
  return <>{render(createPropertyRenderers(scope, actions))}</>;
}

export function ControlIdentityProperties({ scope, actions }: PropertyPanelProps) {
  return propertyNode(scope, actions, (panels) => panels.renderControlIdentityProperties());
}

export function LayoutWidthProperties({ scope, actions }: PropertyPanelProps) {
  return propertyNode(scope, actions, (panels) => panels.renderLayoutWidth());
}

export function LayoutAppearanceProperties({ scope, actions }: PropertyPanelProps) {
  return propertyNode(scope, actions, (panels) => panels.renderLayoutAppearance());
}

export function DataSourceProperties({ scope, actions }: PropertyPanelProps) {
  return propertyNode(scope, actions, (panels) => panels.renderDataSourceProperties());
}

export function EncodingProperties({ scope, actions }: PropertyPanelProps) {
  return propertyNode(scope, actions, (panels) => panels.renderEncodingProperties());
}

export function TypeSpecificProperties({ scope, actions }: PropertyPanelProps) {
  return propertyNode(scope, actions, (panels) => panels.renderTypeSpecificProperties());
}

export function InteractionProperties({ scope, actions }: PropertyPanelProps) {
  return propertyNode(scope, actions, (panels) => panels.renderInteractionProperties());
}

export function DataAttributeProperties({ scope, actions }: PropertyPanelProps) {
  return propertyNode(scope, actions, (panels) => panels.renderDataAttributeProperties());
}

export function SearchSettingsEditor({ scope, actions }: PropertyPanelProps) {
  return propertyNode(scope, actions, (panels) => panels.renderSearchSettingsEditor());
}

export function CalculationEditor({ scope, actions }: PropertyPanelProps) {
  return propertyNode(scope, actions, (panels) => panels.renderCalculationEditor());
}

export function AssignmentEditor({ scope, actions }: PropertyPanelProps) {
  return propertyNode(scope, actions, (panels) => panels.renderAssignmentEditor());
}

export function DefaultValueEditor({ scope, actions }: PropertyPanelProps) {
  return propertyNode(scope, actions, (panels) => panels.renderDefaultValueEditor());
}
