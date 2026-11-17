import type { AiLayoutControlType } from '@/utils/aiFormLayout';
import FieldControl from '@/components/FormWidgets/FieldControl';
import { FormOutlined } from '@ant-design/icons';
import type { PlatformForm } from '@/services/api';
import { isLayoutControl } from '@/utils/formLayout';
import { parseStaticOptions } from '@/utils/selectOptions';
import type { FlowDesignerNode } from './ProfessionalFlowDesigner';
import { componentIconMap, defaultCommonControlKeys, defaultComponentGroups } from './designerConfig';
import { controlWidthOptions, defaultControlTypeOptions, defaultDateModeOptions, defaultDateValueOptions, defaultEncodingResetCycleOptions, defaultSelectionDisplayOptions, defaultSelectionModeOptions, defaultTextCaseModeOptions, defaultTextFormatOptions, defaultTextTrimModeOptions, referenceSourceRegistry } from './designerOptions';
import { isRecord } from './designerTypes';
import type { BusinessSection, ComponentDefinition, ControlRuleKey, ControlRules, ControlTypeSettings, ControlWidth, DesignerField, DesignerMeta, DesignerMetaConfig, DesignerOption, LayoutControl, ReferenceSourceKind } from './designerTypes';
import { makeEncodingRule } from './encodingRules';
import { getFieldBusinessType, isEncodingField } from './fieldBusinessType';

export function controlWidthLabel(width: ControlWidth) {
  const option = controlWidthOptions.find((item) => item.value === width);
  return option?.label || '50%';
}

export function controlWidthClass(width: ControlWidth) {
  return `control-width-${width}`;
}

export function makeControlRules(required = false, field?: DesignerField): ControlRules {
  return {
    visible: { enabled: true },
    readonly: { enabled: Boolean(field?.locked) },
    required: { enabled: required },
    unique: { enabled: isEncodingField(field) },
    masked: { enabled: false },
    copyable: { enabled: true },
    optionSort: { enabled: false },
  };
}

export function normalizeControlRules(rules?: Partial<ControlRules>, field?: DesignerField): ControlRules {
  const defaults = makeControlRules(Boolean(field?.required), field);
  return (Object.keys(defaults) as ControlRuleKey[]).reduce((next, ruleKey) => ({
    ...next,
    [ruleKey]: {
      ...defaults[ruleKey],
      ...(rules?.[ruleKey] || {}),
      conditions: rules?.[ruleKey]?.conditions ? { ...rules[ruleKey]?.conditions } : defaults[ruleKey].conditions,
    },
  }), {} as ControlRules);
}

export function isControlWidth(value: unknown): value is ControlWidth {
  return controlWidthOptions.some(option => option.value === value);
}

export function normalizeDesignerOptions(raw: unknown, fallback: DesignerOption[]): DesignerOption[] {
  if (!Array.isArray(raw)) return fallback;
  const options = raw
    .map((item) => {
      if (!isRecord(item)) return null;
      const value = typeof item.value === 'string' ? item.value : '';
      const label = typeof item.label === 'string' ? item.label : '';
      return value && label ? { value, label } : null;
    })
    .filter((item): item is DesignerOption => Boolean(item));
  return options.length ? options : fallback;
}

export function normalizeComponentGroups(
  raw: unknown,
  fallback: Array<{ category: string; items: ComponentDefinition[] }>,
): Array<{ category: string; items: ComponentDefinition[] }> {
  if (!Array.isArray(raw)) return fallback;
  const groups = raw
    .map((group) => {
      if (!isRecord(group) || typeof group.category !== 'string' || !Array.isArray(group.items)) return null;
      const category = group.category;
      const items = group.items
        .map((item) => {
          if (!isRecord(item)) return null;
          const key = typeof item.key === 'string' ? item.key : '';
          const name = typeof item.name === 'string' ? item.name : '';
          const controlType = typeof item.controlType === 'string' ? item.controlType : '';
          if (!key || !name || !controlType) return null;
          const iconKey = typeof item.iconKey === 'string' ? item.iconKey : controlType;
          const definition: ComponentDefinition = {
            key,
            category,
            name,
            desc: typeof item.desc === 'string' ? item.desc : '',
            icon: componentIconMap[iconKey] || componentIconMap[controlType] || <FormOutlined />,
            controlType,
            defaultWidth: isControlWidth(item.defaultWidth) ? item.defaultWidth : undefined,
          };
          return definition;
        })
        .filter((item): item is ComponentDefinition => Boolean(item));
      return items.length ? { category, items } : null;
    })
    .filter((group): group is { category: string; items: ComponentDefinition[] } => Boolean(group));
  return groups.length ? groups : fallback;
}

export function normalizeStringList(raw: unknown, fallback: string[]): string[] {
  if (!Array.isArray(raw)) return fallback;
  const values = raw.filter((item): item is string => typeof item === 'string' && item.length > 0);
  return values.length ? values : fallback;
}

export function normalizeBusinessSections(raw: unknown, fallback: BusinessSection[]): BusinessSection[] {
  if (!Array.isArray(raw)) return fallback;
  const sections = raw
    .map((item) => {
      if (!isRecord(item)) return null;
      const key = typeof item.key === 'string' ? item.key : '';
      const title = typeof item.title === 'string' ? item.title : '';
      if (!key || !title) return null;
      return {
        key,
        title,
        desc: typeof item.desc === 'string' ? item.desc : '',
        fieldKeys: normalizeStringList(item.fieldKeys, []),
      };
    })
    .filter((item): item is BusinessSection => Boolean(item));
  return sections.length ? sections : fallback;
}

export function getDesignerMeta(form: PlatformForm | null | undefined): DesignerMeta {
  const config = isRecord(form?.config) ? form?.config : {};
  const meta = isRecord(config?.designerMeta) ? config.designerMeta as DesignerMetaConfig : {};
  const typeSettingOptions = isRecord(meta.typeSettingOptions) ? meta.typeSettingOptions : {};
  const selection = defaultComponentGroups.flatMap(group => group.items).find(item => item.key === 'select')!;
  let selectionAdded = false;
  const componentGroups = normalizeComponentGroups(meta.componentLibrary, defaultComponentGroups).map(group => ({ ...group, items: group.items.flatMap(item => {
    if (!isDataSourceControlType(item.controlType)) return [item];
    if (selectionAdded) return [];
    selectionAdded = true;
    return [{ ...selection, category: group.category }];
  }) })).filter(group => group.items.length);
  const options = normalizeDesignerOptions(meta.controlTypeOptions, defaultControlTypeOptions)
    .map(option => isDataSourceControlType(option.value) ? { value: 'select', label: '选择控件' } : option);
  return {
    controlTypeOptions: options.filter((option, index) => options.findIndex(item => item.value === option.value) === index),
    textFormatOptions: normalizeDesignerOptions(typeSettingOptions.textFormats, defaultTextFormatOptions),
    textTrimModeOptions: normalizeDesignerOptions(typeSettingOptions.textTrimModes, defaultTextTrimModeOptions),
    textCaseModeOptions: normalizeDesignerOptions(typeSettingOptions.textCaseModes, defaultTextCaseModeOptions),
    selectionModeOptions: normalizeDesignerOptions(typeSettingOptions.selectionModes, defaultSelectionModeOptions),
    selectionDisplayOptions: normalizeDesignerOptions(typeSettingOptions.selectionDisplays, defaultSelectionDisplayOptions),
    dateModeOptions: normalizeDesignerOptions(typeSettingOptions.dateModes, defaultDateModeOptions),
    defaultDateOptions: normalizeDesignerOptions(typeSettingOptions.defaultDates, defaultDateValueOptions),
    encodingResetCycleOptions: normalizeDesignerOptions(typeSettingOptions.encodingResetCycles, defaultEncodingResetCycleOptions),
    componentGroups,
    commonControlKeys: [...new Set(normalizeStringList(meta.commonControlKeys, defaultCommonControlKeys).map(key => key === 'relation' ? 'select' : key))],
    businessSections: Array.isArray(meta.businessSections) ? meta.businessSections : undefined,
  };
}

export const alertBusinessSections: BusinessSection[] = [
  { key: 'basic', title: '基础信息', desc: '识别告警、说明主题和来源', fieldKeys: ['alertId', 'title', 'source', 'occurredAt'] },
  { key: 'device', title: '设备信息', desc: '定位设备、等级和影响范围', fieldKeys: ['device', 'level'] },
  { key: 'handle', title: '告警处理', desc: '明确责任人、时限、状态和结论', fieldKeys: ['owner', 'dueAt', 'status', 'resolution'] },
  { key: 'evidence', title: '附件证据', desc: '上传现场图片、日志和处理凭证', fieldKeys: ['evidence'] },
  { key: 'approval', title: '审批/流转信息', desc: '展示流程状态、操作记录和关闭轨迹', fieldKeys: [] },
];

export const fieldTemplates: DesignerField[] = [
  { key: 'templateCode', name: '业务编号', type: '文本 / 自动编号', businessType: 'code', placeholder: '自动生成唯一编号', locked: true, required: true, listVisible: true, searchable: true, sortable: true },
  { key: 'templateTitle', name: '标题', type: '文本输入', placeholder: '请输入标题', required: true, listVisible: true, searchable: true },
  { key: 'templateStatus', name: '状态', type: '下拉选择', placeholder: '待处理 / 处理中 / 已关闭', listVisible: true, searchable: true, optionSource: '待处理、处理中、已关闭' },
  { key: 'templateLevel', name: '等级', type: '下拉选择', placeholder: '高 / 中 / 低', listVisible: true, searchable: true, optionSource: '高、中、低' },
  { key: 'templateOwner', name: '责任人', type: '人员选择', placeholder: '选择责任人', listVisible: true, searchable: true, optionSource: '组织人员' },
  { key: 'templateTime', name: '时间', type: '日期控件', placeholder: '选择时间', listVisible: true, sortable: true },
  { key: 'templateAttachment', name: '附件', type: '附件控件', placeholder: '上传附件', listVisible: false },
  { key: 'templateRemark', name: '备注', type: '多行文本', placeholder: '填写备注说明', listVisible: false },
];

export function getRecommendedRules(fields: DesignerField[]) {
  const suggestions: string[] = [];
  const has = (name: string) => fields.some(field => field.name.includes(name));
  if (has('物料编码')) suggestions.push('建议为物料编码配置自动编号与唯一性校验');
  if (has('安全库存')) suggestions.push('建议将安全库存设置为非负数，防止录入负库存阈值');
  if (has('计量单位')) suggestions.push('建议将计量单位绑定字典，统一物料的计量口径');
  if (has('告警等级') && has('附件') && has('处理时限')) suggestions.push('建议在告警等级为严重时，将附件证据和处理时限设为必填');
  if (has('告警状态') && has('处理结论')) suggestions.push('建议在告警状态为已关闭时，将处理结论设为必填');
  return suggestions;
}

export function getFlowNodeAssigneeLabel(node?: FlowDesignerNode) {
  if (!node) return '未选择流程节点';
  if (node.type === 'startEvent') return '发起人';
  if (node.type === 'endEvent') return '流程归档';
  if (node.assigneeSource === 'field') return `${node.assigneeValue || '未配置'}字段`;
  if (node.assigneeSource === 'departmentOwner') return '部门负责人';
  if (node.assigneeSource === 'initiatorManager') return '发起人上级';
  return node.assigneeValue || '未配置处理人';
}

export function getPreviewNodeNote(node?: FlowDesignerNode) {
  if (!node) return '请选择流程节点，预览会按该节点的处理人和字段权限展示运行效果。';
  const permissions = Object.values(node.fieldPermissions || {});
  const editableCount = permissions.filter((permission) => permission.editable).length;
  const requiredCount = permissions.filter((permission) => permission.required).length;
  return `当前节点：${node.label}；处理人：${getFlowNodeAssigneeLabel(node)}；可编辑 ${editableCount} 个字段，必填 ${requiredCount} 个字段。`;
}

export function optionSourceToOptions(source?: string, fallback?: string) {
  return parseStaticOptions(source === undefined ? fallback : source);
}

export function inferFieldControlType(field?: DesignerField) {
  if (!field) return 'text';
  const businessType = getFieldBusinessType(field);
  if (businessType === 'code') return 'code';
  if (businessType === 'enum') return 'select';
  if (businessType === 'person' || businessType === 'relation') return 'relation';
  if (businessType === 'date' || businessType === 'datetime') return 'datetime';
  if (businessType === 'attachment') return 'upload';
  if (businessType === 'longText') return 'textarea';
  if (field.storageType==='boolean') return 'switch';
  if (businessType === 'number') return 'number';
  return 'text';
}

export function getEffectiveControlTypeForControl(control?: LayoutControl, field?: DesignerField) {
  if (!control) return '';
  if (control.controlType === 'field') return inferFieldControlType(field);
  return control.controlType;
}

export function isDataSourceControlType(controlType?: string) {
  return controlType === 'select' || controlType === 'relation';
}

export function inferReferenceSourceKind(field?: DesignerField, controlType?: string): ReferenceSourceKind {
  const businessType = getFieldBusinessType(field);
  if (businessType === 'person') return 'organization';
  if (businessType === 'relation' || controlType === 'relation') {
    if (field?.optionSource?.includes('组织') || field?.optionSource?.includes('人员')) return 'organization';
    return 'masterData';
  }
  if (businessType === 'enum') return 'static';
  return 'static';
}

export function getReferenceConfig(kind?: ReferenceSourceKind) {
  return referenceSourceRegistry[kind || 'static'];
}

export function fieldInput(field: DesignerField, placeholderOverride?: string, disabled = false, optionSourceOverride?: string, controlTypeOverride?: string, typeSettings?: ControlTypeSettings) {
  const type=controlTypeOverride && controlTypeOverride!=='field'?controlTypeOverride:inferFieldControlType(field);
  return <FieldControl preview type={type} disabled={disabled} label={field.name} placeholder={placeholderOverride||field.placeholder} settings={typeSettings} options={parseStaticOptions(optionSourceOverride ?? field.optionSource, field.enumValues)} />;
}

export function designerFieldsToViewFields(fields: DesignerField[]) {
  return fields.map((field) => ({
    fieldName: field.key,
    label: field.name,
    fieldType: field.type,
    searchable: field.searchable,
    sortable: field.sortable,
    visibleInList: field.listVisible,
  }));
}

export function getDefaultTypeSettings(controlType: string, field?: DesignerField): ControlTypeSettings {
  if (controlType === 'text' || controlType === 'textarea') {
    return {
      minLength: field?.required ? 1 : 0,
      maxLength: controlType === 'textarea' ? 500 : 80,
      textFormat: 'plain',
      trimMode: 'trim',
      caseMode: 'original',
      rows: controlType === 'textarea' ? 3 : undefined,
    };
  }
  if (controlType === 'number') return { precision: field?.storageType==='integer'||field?.storageType==='int'?0:undefined, thousandSeparator: false };
  if (controlType === 'select' || controlType === 'relation') {
    return {
      selectionMode: 'single',
      displayMode: controlType === 'select' ? 'dropdown' : 'search',
      allowClear: true,
      allowCreateOption: false,
    };
  }
  if (controlType === 'datetime') return { dateMode: field?.businessType==='date'?'date':'datetime', defaultDate: 'none', disablePast: false };
  if (controlType === 'upload') return { maxFiles: 5, maxFileSize: 20, fileTypes: '图片、PDF、Office、日志文件' };
  if (controlType === 'switch') return { defaultChecked: false, checkedText: '是', uncheckedText: '否' };
  return {};
}

export function makeFieldControl(field: DesignerField): LayoutControl {
  const controlType = inferFieldControlType(field);
  return {
    id: `field-${field.key}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    source: 'field',
    controlType: 'field',
    name: field.name,
    fieldKey: field.key,
    placeholder: field.placeholder,
    helpText: '',
    optionSource: field.optionSource,
    dataSourceKind: inferReferenceSourceKind(field, controlType),
    encodingRule: isEncodingField(field) ? field.encodingRule || makeEncodingRule(field) : undefined,
    typeSettings: getDefaultTypeSettings(controlType, field),
    defaultRule: field.defaultRule,
    computed: field.calculationRule,
    width: getFieldBusinessType(field) === 'longText' ? 'full' : 'half',
    rules: makeControlRules(Boolean(field.required), field),
  };
}

export function makeComponentControl(component: ComponentDefinition): LayoutControl {
  return {
    id: `component-${component.key}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    source: 'component',
    controlType: component.controlType,
    name: component.name,
    desc: component.desc,
    placeholder: component.controlType === 'select' ? '请选择' : component.desc,
    helpText: '',
    optionSource: component.controlType === 'select' ? '' : component.controlType === 'relation' ? component.desc : undefined,
    dataSourceKind: component.controlType === 'select' ? 'static' : undefined,
    typeSettings: getDefaultTypeSettings(component.controlType),
    width: component.defaultWidth || 'half',
    rules: makeControlRules(),
  };
}

export function makeAiLayoutControl(type: AiLayoutControlType, id: string): LayoutControl {
  const definition = defaultComponentGroups.flatMap(group => group.items).find(item => item.controlType === type);
  if (!definition || !isLayoutControl({ controlType: type })) throw new Error('当前控件库不支持此布局类型');
  return { ...makeComponentControl(definition), id };
}

export function cloneControl(control: LayoutControl): LayoutControl {
  const clonedRules = normalizeControlRules(control.rules);
  return {
    ...control,
    id: `${control.id}-copy-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: control.name,
    rules: clonedRules,
  };
}

export function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return ['input', 'textarea', 'select'].includes(tagName) || target.isContentEditable || Boolean(target.closest('.ant-select'));
}
