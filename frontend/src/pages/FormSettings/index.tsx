import { useAiWorkbench } from '@/components/AiChatWidget/context';
import type { PageAction, NewFormDraft } from '@/components/AiChatWidget/pageControls';
import StaticOptionsEditor from './StaticOptionsEditor';
import { parseStaticOptions, staticOptionErrors, normalizeSelection, selectionCountError, selectionConfigErrors } from '@/utils/selectOptions';
import { createUuid } from '@/utils/uuid';
import { previewFieldPermission, previewFlowNodes as associatedPreviewNodes } from './previewPermissions';
import { RuleInlineSelect } from './RuleInlineCell';
import CalculationExpressionEditor from './CalculationExpressionEditor';
import {PropertyInspectorHeader, PropertyGroup, PropertyRow, PropertyAdvanced} from '@/components/PropertyInspector';
import { calculationSources, type CalculationRule } from '@/utils/formCalculations';
import {protectCopy} from '@/components/FieldProtection';
import FieldControl from '@/components/FormWidgets/FieldControl';
import RelationPicker from '@/components/FormWidgets/RelationPicker';
import { enumOptions, matchesOptionSearch, duplicateFieldBindings, type ControlSettings, type OptionSearchSettings } from '@/utils/formControls';
import SettingsTabs from '@/components/SettingsTabs';
import VersionManager from './VersionManager';
import { isLayoutControl, isLayoutContainer, layoutSlots, normalizeLayout, placeLayoutControl, unwrapLayoutControl, cloneLayoutSubtree, layoutDescendants, buildRuntimeLayout, getControlAppearance, getControlPresentation, getControlColumnSpan, type LayoutPlacement, type ControlPresentation } from '@/utils/formLayout';
import { DEFAULT_FIELD_BYTES, DEFAULT_FORM_LIMITS, fieldStorageSize } from '../SystemAdmin/assemblyPersistence';
import { defaultRuleErrors, defaultRuleSummary, newDefaultPart, type DefaultValueRule } from '@/utils/formDefaults';
import { useShellPageTitle } from '@/components/ShellPageTitle';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertOutlined,
  ApartmentOutlined,
  ArrowLeftOutlined,
  BarChartOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  CheckSquareOutlined,
  CopyOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  EyeOutlined,
  FileImageOutlined,
  FileSearchOutlined,
  FormOutlined,
  HistoryOutlined,
  HolderOutlined,
  LayoutOutlined,
  LinkOutlined,
  LockOutlined,
  MobileOutlined,
  NumberOutlined,
  PaperClipOutlined,
  PlusOutlined,
  QuestionCircleOutlined,
  SaveOutlined,
  SearchOutlined,
  SelectOutlined,
  SettingOutlined,
  SwitcherOutlined,
  TabletOutlined,
  TableOutlined,
  TagsOutlined,
  RedoOutlined,
  UndoOutlined,
  UserOutlined,
  UserSwitchOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { Alert, Dropdown, Button, Checkbox, Input, InputNumber, Modal, Segmented, Select, Space, Spin, Switch, Form, Tag, Table, Tooltip, Typography, message } from 'antd';
import { useNavigate, useParams, useSearchParams, useBlocker, useLocation } from 'react-router-dom';
import {
  previewDesignerRules,
  getFormOptionSources,
  previewFormReferenceOptions, previewOptionSearchSchema,
  restorePlatformFormDraft,
  adminListUsers,
  adminListOrgUnits,
  adminListRoles,
  createPlatformForm,
  createPlatformFormField,
  deletePlatformFormPermission,
  getPlatformForm,
  getPlatformFormByCode,
  listPlatformFormLayouts,
  listPlatformFormPermissions,
  listPlatformForms,
  listWorkflowBindings,
  previewPlatformFormPublish,
  publishPlatformForm,
  updatePlatformForm,
  updatePlatformFormField,
  updateWorkflowBinding,
  upsertPlatformFormPermission,
  upsertPlatformFormLayout,
  upsertWorkflowBinding,
  wfCreateDefinition,
  wfGetDefinition,
  wfUpdateDefinition,
  type PlatformForm,
  type PlatformFormField,
  type PlatformFormPublishReport,
} from '@/services/api';
import {
  getViewTabs,
  updateActiveView,
  controlTypeForField,
  defaultOperatorForControl,
  makeDefaultViewConfig,
  normalizeViewConfig,
  renderTypeForField,
  sortByOrder,
  type ViewColumnRenderType,
  type ViewConfig,
  type ViewControlType,
  type ViewFilterConfig,
  type ViewFilterOperator,
  type ViewTableColumnConfig,
} from '@/utils/viewConfig';
import ProfessionalFlowDesigner, {
  createDefaultFlowConfig,
  normalizeNodeFieldPermissions,
  validateFlowDesignerConfig,
  type FlowDesignerConfig,
  type FlowDesignerEdge,
  type FlowDesignerNode,
} from './ProfessionalFlowDesigner';
import ViewTabsEditor from './ViewTabsEditor';
import './style.css';
import './designer-dialog.css';

type DesignerTab = 'form' | 'dataset' | 'dashboard' | 'filter' | 'style' | 'flow' | 'approval' | 'permission';
type ComponentPanel = 'components' | 'fieldTypes';
type ControlSource = 'field' | 'component';
type ControlWidth = 'third' | 'quarter' | 'half' | 'twoThird' | 'threeQuarter' | 'full';
type FlowPortSide = 'top' | 'right' | 'bottom' | 'left';
type DropPosition = 'before' | 'after';
type ControlRuleKey =
  | 'visible'
  | 'readonly'
  | 'required'
  | 'unique'
  | 'masked'
  | 'copyable'
  | 'optionSort';
type PublishCheckLevel = 'error' | 'warning' | 'suggestion';
type EncodingResetCycle = 'none' | 'day' | 'month' | 'year' | 'dependency';
type EncodingSegmentType = 'fixed' | 'date' | 'field' | 'masterData' | 'organization' | 'sequence';
type EncodingPadding = 'none' | 'leftZero' | 'rightZero' | 'truncate';
type EncodingGenerationMode = 'auto' | 'manual' | 'autoEditable';
type EncodingGenerationTiming = 'create' | 'save' | 'submit' | 'workflowNode';
type EncodingUniquenessScope = 'form' | 'global' | 'organization' | 'dependency';
type ReferenceSourceKind = 'static' | 'dictionary' | 'masterData' | 'businessForm' | 'organization' | 'externalApi';
type FieldBusinessType =
  | 'text'
  | 'longText'
  | 'number'
  | 'date'
  | 'datetime'
  | 'enum'
  | 'person'
  | 'relation'
  | 'attachment'
  | 'code';

type AnalyticsWidgetType = 'metric-card' | 'line' | 'bar' | 'pie' | 'rank-table' | 'detail-table';

interface AnalyticsDataset {
  id: string;
  name: string;
  sourceType: 'businessForm' | 'ontology' | 'sql' | 'api';
  source: string;
  refreshMode: 'realtime' | 'scheduled' | 'manual';
  refreshInterval?: number;
  dimensions: string[];
  measures: string[];
}

interface AnalyticsMetric {
  id: string;
  name: string;
  expression: string;
  datasetId: string;
  format: 'number' | 'percent' | 'currency' | 'duration';
  threshold: string;
}

interface AnalyticsWidget {
  id: string;
  title: string;
  type: AnalyticsWidgetType;
  datasetId: string;
  metricIds: string[];
  dimension?: string;
  width: 'quarter' | 'half' | 'full';
  interaction: 'none' | 'filter' | 'drilldown' | 'navigate';
}

interface AnalyticsStyle {
  preset: 'clean' | 'executive' | 'factory' | 'dark';
  background: string;
  componentGap: number;
  cardRadius: number;
  cardBorder: 'none' | 'light' | 'strong';
  chartPalette: 'manufacturing' | 'business' | 'warning' | 'mono';
  tableDensity: 'compact' | 'standard' | 'comfortable';
  filterTheme: 'inline' | 'panel' | 'toolbar';
}

interface AnalyticsDesign {
  datasets: AnalyticsDataset[];
  metrics: AnalyticsMetric[];
  widgets: AnalyticsWidget[];
  globalFilters: string[];
  interactions: Array<{
    sourceWidgetId: string;
    targetWidgetId: string;
    action: 'filter' | 'drilldown' | 'navigate';
  }>;
  style: AnalyticsStyle;
}

function makeDefaultAnalyticsStyle(): AnalyticsStyle {
  return {
    preset: 'clean',
    background: '#f6f8fa',
    componentGap: 12,
    cardRadius: 8,
    cardBorder: 'light',
    chartPalette: 'manufacturing',
    tableDensity: 'standard',
    filterTheme: 'toolbar',
  };
}

interface ControlRuleCondition {
  sourceField?: string;
  operator?: string;
  value?: string;
  strategy?: string;
  parameter?: string;
  fields?: string[];
  roleIds?: number[];
  keepStart?: number;
  keepEnd?: number;
  note?: string;
}

interface ControlRule {
  enabled: boolean;
  conditions?: ControlRuleCondition;
  conditionGroups?: ControlRuleCondition[][];
  conditionGroupTitles?: string[];
}

type ControlRules = Record<ControlRuleKey, ControlRule>;

interface EncodingSegment {
  id: string;
  name: string;
  type: EncodingSegmentType;
  length: number;
  value?: string;
  sourceField?: string;
  sourceAttribute?: string;
  datePattern?: string;
  resetCycle?: EncodingResetCycle;
  padding?: EncodingPadding;
  sequenceStart?: number;
  sequenceStep?: number;
  regenerateOnChange?: boolean;
  lockAfterGenerated?: boolean;
}

interface EncodingRule {
  id?: string;
  name?: string;
  priority?: number;
  conditions?: ControlRuleCondition[];
  rules?: EncodingRule[];
  enabled: boolean;
  template: string;
  dependencies: string[];
  resetCycle: EncodingResetCycle;
  sequenceLength: number;
  fixedLength?: number;
  prefix?: string;
  datePattern?: string;
  dependencySegmentLength?: number;
  regenerateOnDependencyChange: boolean;
  allowManualOverride: boolean;
  unique: boolean;
  segments?: EncodingSegment[];
  generationMode?: EncodingGenerationMode;
  generationTiming?: EncodingGenerationTiming;
  uniquenessScope?: EncodingUniquenessScope;
}

interface ControlTypeSettings extends ControlSettings {}
interface OptionSearchSchema { kind: string; fields: Array<{value: string; label: string}>; defaultField: string; note?: string }
interface SearchSettingsDraft { tested?: boolean; controlId: string; settings: OptionSearchSettings; query: string; schema?: OptionSearchSchema; metaLoading: boolean; loading: boolean; error: string; rows: Array<{id: string | number; label: string; matchedFields: string[]}>; page: number; hasMore: boolean; context: Record<string, string> }


interface AssignmentRule {
  id: string;
  sourceAttribute?: string;
  targetField?: string;
}

interface DesignerField {
  enumValues?: unknown;
  storageType?: string;
  maxBytes?: number;
  defaultRule?: DefaultValueRule;
  computed?: boolean;
  calculationRule?: CalculationRule;
  key: string;
  name: string;
  type: string;
  businessType?: FieldBusinessType;
  placeholder: string;
  locked?: boolean;
  required?: boolean;
  listVisible?: boolean;
  searchable?: boolean;
  sortable?: boolean;
  defaultValue?: string;
  validation?: string;
  optionSource?: string;
  encodingRule?: EncodingRule;
}

interface DesignerConfig {
  id: string;
  name: string;
  createTitle: string;
  kind: 'business' | 'analysis';
  appName: string;
  dataSource: string;
  primaryKey: string;
  status: string;
  version: string;
  description: string;
  fields: DesignerField[];
  filters: DesignerField[];
  flowSteps: string[];
  roles: string[];
}

interface ComponentDefinition {
  key: string;
  category: string;
  name: string;
  desc: string;
  icon: React.ReactNode;
  controlType: string;
  defaultWidth?: ControlWidth;
}

interface LayoutControl extends LayoutPlacement {
  id: string;
  source: ControlSource;
  controlType: string;
  name: string;
  desc?: string;
  fieldKey?: string;
  placeholder?: string;
  helpText?: string;
  optionSource?: string;
  referenceLabelField?: string;
  referenceValueField?: string;
  referenceItemsPath?: string;
  dataSourceKind?: ReferenceSourceKind;
  encodingRule?: EncodingRule;
  assignmentRules?: AssignmentRule[];
  assignmentRulesEnabled?: boolean;
  defaultRule?: DefaultValueRule;
  computed?: CalculationRule | null;
  calculationRulesEnabled?: boolean;
  inactiveCalculationRule?: CalculationRule;
  storageMaxBytes?: number;
  typeSettings?: ControlTypeSettings;
  width: ControlWidth;
  rules: ControlRules;
}

interface FlowNode {
  id: string;
  label: string;
  role: string;
  x: number;
  y: number;
}

interface FlowConnection {
  id: string;
  fromId: string;
  fromSide: FlowPortSide;
  toId: string;
  toSide: FlowPortSide;
}

interface FlowNodeDefinition {
  key: string;
  name: string;
  desc: string;
  role: string;
  icon: React.ReactNode;
}

interface BusinessSection {
  key: string;
  title: string;
  desc: string;
  fieldKeys: string[];
}

interface DesignerOption {
  value: string;
  label: string;
}

interface DesignerMetaConfig {
  controlTypeOptions?: DesignerOption[];
  typeSettingOptions?: {
    textFormats?: DesignerOption[];
    textTrimModes?: DesignerOption[];
    textCaseModes?: DesignerOption[];
    selectionModes?: DesignerOption[];
    selectionDisplays?: DesignerOption[];
    dateModes?: DesignerOption[];
    defaultDates?: DesignerOption[];
    encodingResetCycles?: DesignerOption[];
  };
  componentLibrary?: Array<{
    category: string;
    items: Array<{
      key: string;
      name: string;
      desc?: string;
      controlType: string;
      defaultWidth?: ControlWidth;
      iconKey?: string;
    }>;
  }>;
  commonControlKeys?: string[];
  businessSections?: BusinessSection[];
}

interface DesignerMeta {
  controlTypeOptions: DesignerOption[];
  textFormatOptions: DesignerOption[];
  textTrimModeOptions: DesignerOption[];
  textCaseModeOptions: DesignerOption[];
  selectionModeOptions: DesignerOption[];
  selectionDisplayOptions: DesignerOption[];
  dateModeOptions: DesignerOption[];
  defaultDateOptions: DesignerOption[];
  encodingResetCycleOptions: DesignerOption[];
  componentGroups: Array<{ category: string; items: ComponentDefinition[] }>;
  commonControlKeys: string[];
  businessSections?: BusinessSection[];
}

interface PublishCheckItem {
  level: PublishCheckLevel;
  title: string;
  detail: string;
}

interface WorkflowDesignerMeta {
  draftWorkflowId?: number;
  publishedWorkflowId?: number;
  publishedAt?: string;
  publishedVersion?: number;
}

interface ViewConfigMeta {
  draftVersion?: number;
  publishedVersion?: number;
  draftSavedAt?: string;
  publishedAt?: string;
  status?: 'draft' | 'published';
}


interface PermissionDesignDraft {
  page: Record<string, boolean>;
  actions: Record<string, boolean>;
  fields: Record<string, {
    visible: boolean;
    editable: boolean;
    required: boolean;
    exportable: boolean;
  }>;
  data: {
    scope: string;
    orgUnits: number[];
    sensitiveFields: string;
    ownership: Record<string, boolean>;
  };
}

type PermissionDraftMap = Record<string, PermissionDesignDraft>;

interface FormPermissionRow {
  id: number;
  role_id: number;
  action: string;
  effect: 'allow' | 'deny' | string;
  field_name?: string | null;
}

interface WorkflowDefinitionPayload {
  id: number;
  name: string;
  description?: string;
  config?: Partial<FlowDesignerConfig> & Record<string, unknown>;
  form_config?: Record<string, unknown>;
  status?: string;
  version?: number;
}

interface WorkflowBindingPayload {
  id: number;
  form_id: number;
  workflow_id: number;
  trigger_action: string;
  enabled: boolean;
  config?: Record<string, unknown>;
}

const permissionActionDefinitions = [
  { key: 'view', name: '查看页面', desc: '打开菜单、查看列表和详情', risk: 'low' },
  { key: 'create', name: '新增入口', desc: '显示新增按钮并打开新增表单，不代表已提交', risk: 'medium' },
  { key: 'import', name: '导入入口', desc: '显示批量导入入口，按导入流程写入数据', risk: 'high' },
  { key: 'export', name: '导出入口', desc: '下载列表或报表数据', risk: 'high' },
  { key: 'saveDraft', name: '保存草稿', desc: '保存未提交的表单草稿', risk: 'medium' },
  { key: 'submit', name: '提交表单', desc: '提交当前表单并触发后续流程', risk: 'medium' },
  { key: 'edit', name: '修改记录', desc: '修改已存在的告警记录', risk: 'medium' },
  { key: 'delete', name: '删除', desc: '移除记录，高风险动作', risk: 'high' },
  { key: 'approve', name: '审批处理', desc: '处理流程节点、同意、驳回或关闭', risk: 'medium' },
] as const;

const permissionActionGroups = [
  { key: 'entry', title: '列表入口与批量动作', desc: '控制列表页和工具栏入口', actionKeys: ['view', 'create', 'import', 'export'] },
  { key: 'form', title: '表单内动作', desc: '控制打开表单后的底部按钮', actionKeys: ['saveDraft', 'submit', 'edit', 'delete'] },
  { key: 'workflow', title: '流程动作', desc: '控制流程节点处理按钮', actionKeys: ['approve'] },
];

function getDefaultPermissionActionEnabled(roleKind: 'system' | 'manager' | 'operator', actionKey: string) {
  if (actionKey === 'view') return true;
  if (actionKey === 'delete') return roleKind === 'system';
  return roleKind !== 'operator';
}

function makePermissionDesignDraft(roleKind: 'system' | 'manager' | 'operator', orgUnits: number[]): PermissionDesignDraft {
  return {
    page: {
      menu: true,
      enter: true,
      detail: true,
      designTab: roleKind !== 'operator',
      preview: roleKind !== 'operator',
      publish: roleKind === 'system',
    },
    actions: Object.fromEntries(
      permissionActionDefinitions.map((definition) => [
        definition.key,
        getDefaultPermissionActionEnabled(roleKind, definition.key),
      ]),
    ),
    fields: {},
    data: {
      scope: roleKind === 'system' ? 'all' : roleKind === 'manager' ? 'org_tree' : 'assigned',
      orgUnits: orgUnits.slice(0, 2),
      sensitiveFields: roleKind === 'system' ? 'full' : 'mask',
      ownership: {
        createdByMe: true,
        assignedToMe: true,
        sameOrg: roleKind !== 'operator',
        crossOrg: roleKind === 'system',
        statistics: roleKind === 'system',
      },
    },
  };
}

function permissionDraftsFromConfig(config?: Record<string, unknown> | null): PermissionDraftMap {
  const permissionDesign = config?.permissionDesignDraft || config?.permissionDesign;
  if (!permissionDesign || typeof permissionDesign !== 'object') return {};
  const roles = (permissionDesign as { roles?: unknown }).roles;
  return roles && typeof roles === 'object' ? roles as PermissionDraftMap : {};
}

function getPermissionRoleKind(roleIndex: number, roleName = ''): 'system' | 'manager' | 'operator' {
  const normalized = roleName.toLowerCase();
  if (roleIndex === 0 || normalized.includes('admin') || normalized.includes('system')) return 'system';
  if (roleIndex < 4 || normalized.includes('manager') || normalized.includes('lead')) return 'manager';
  return 'operator';
}

function defaultRoleFieldPermission(field: DesignerField, index: number, roleKind: 'system' | 'manager' | 'operator') {
  return {
    visible: true,
    editable: !field.locked && (roleKind === 'system' || index < 5),
    required: Boolean(field.required),
    exportable: roleKind !== 'operator' || index <= 4,
  };
}

function permissionDraftsFromRows(
  rows: FormPermissionRow[],
  roles: Array<{ id: number; name: string; label: string }>,
  fields: DesignerField[],
  orgUnits: number[],
): PermissionDraftMap {
  const roleById = new Map(roles.map((role) => [role.id, role]));
  const roleIndexById = new Map(roles.map((role, index) => [role.id, index]));
  const drafts: PermissionDraftMap = {};

  for (const row of rows) {
    const role = roleById.get(row.role_id);
    const roleName = role?.label || role?.name || `role-${row.role_id}`;
    const roleKind = getPermissionRoleKind(roleIndexById.get(row.role_id) ?? 99, role?.name || roleName);
    const draft = drafts[roleName] || makePermissionDesignDraft(roleKind, orgUnits);
    const enabled = row.effect !== 'deny';

    if (!row.field_name) {
      if (permissionActionDefinitions.some((definition) => definition.key === row.action)) {
        draft.actions[row.action] = enabled;
      }
      drafts[roleName] = draft;
      continue;
    }

    const field = fields.find((item) => item.key === row.field_name);
    if (!field) {
      drafts[roleName] = draft;
      continue;
    }
    const fieldIndex = Math.max(fields.findIndex((item) => item.key === row.field_name), 0);
    const current = draft.fields[row.field_name] || defaultRoleFieldPermission(field, fieldIndex, roleKind);
    if (row.action === 'view') current.visible = enabled;
    if (row.action === 'edit') current.editable = enabled;
    if (row.action === 'export') current.exportable = enabled;
    if (row.action === 'create') current.editable = current.editable && enabled;
    draft.fields[row.field_name] = current;
    drafts[roleName] = draft;
  }

  return drafts;
}

function mergePermissionDraftSources(primary: PermissionDraftMap, fallback: PermissionDraftMap): PermissionDraftMap {
  return Object.keys(primary).length ? primary : fallback;
}

function sanitizePermissionDesignDraft(draft: PermissionDesignDraft): PermissionDesignDraft {
  const actions = Object.fromEntries(
    Object.entries(draft.actions || {}).filter(([key]) => key !== 'configure'),
  ) as Record<string, boolean>;
  const data = draft.data || {
    scope: 'assigned',
    orgUnits: [],
    sensitiveFields: 'mask',
    ownership: {},
  };
  const orgUnits = Array.from(new Set(
    (Array.isArray(data.orgUnits) ? data.orgUnits : [])
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0),
  ));
  return {
    page: draft.page || {},
    actions,
    fields: draft.fields || {},
    data: {
      ...data,
      orgUnits,
    },
  };
}

const controlWidthOptions = [
  { value: 'quarter', label: '25%' },
  { value: 'third', label: '33%' },
  { value: 'half', label: '50%' },
  { value: 'twoThird', label: '67%' },
  { value: 'threeQuarter', label: '75%' },
  { value: 'full', label: '100%' },
];

const defaultControlTypeOptions = [
  { value: 'code', label: '编码' },
  { value: 'text', label: '文本输入' },
  { value: 'textarea', label: '多行文本' },
  { value: 'number', label: '数值输入' },
  { value: 'select', label: '选择控件' },
  { value: 'datetime', label: '日期时间' },
  { value: 'upload', label: '附件上传' },
  { value: 'switch', label: '开关切换' },
  { value: 'readonly-text', label: '只读展示' },
];

const defaultTextFormatOptions = [
  { value: 'plain', label: '普通文本' },
  { value: 'email', label: '邮箱' },
  { value: 'phone', label: '手机号' },
  { value: 'url', label: '链接' },
  { value: 'idNo', label: '证件号' },
  { value: 'custom', label: '自定义正则' },
];

const defaultTextTrimModeOptions = [
  { value: 'none', label: '不处理' },
  { value: 'trim', label: '去首尾空格' },
  { value: 'trimAll', label: '去全部空格' },
];

const defaultTextCaseModeOptions = [
  { value: 'original', label: '保持原样' },
  { value: 'upper', label: '自动大写' },
  { value: 'lower', label: '自动小写' },
];

const defaultSelectionModeOptions = [
  { value: 'single', label: '单选' },
  { value: 'multiple', label: '多选' },
];

const defaultSelectionDisplayOptions = [
  { value: 'dropdown', label: '下拉' },
  { value: 'search', label: '搜索选择' },
  { value: 'radio', label: '平铺单选' },
  { value: 'tags', label: '标签多选' },
];

const defaultDateModeOptions = [
  { value: 'date', label: '日期' },
  { value: 'datetime', label: '日期时间' },
  { value: 'range', label: '日期范围' },
];

const defaultDateValueOptions = [
  { value: 'none', label: '无默认值' },
  { value: 'today', label: '当天' },
  { value: 'now', label: '当前时间' },
];

const fieldBusinessTypeOptions: Array<{ value: FieldBusinessType; label: string }> = [
  { value: 'text', label: '文本' },
  { value: 'longText', label: '多行文本' },
  { value: 'number', label: '数值' },
  { value: 'date', label: '日期' },
  { value: 'datetime', label: '日期时间' },
  { value: 'enum', label: '枚举/下拉' },
  { value: 'person', label: '人员' },
  { value: 'relation', label: '关联对象' },
  { value: 'attachment', label: '附件' },
  { value: 'code', label: '编码' },
];

const defaultEncodingResetCycleOptions = [
  { value: 'none', label: '不重置' },
  { value: 'day', label: '按天重置' },
  { value: 'month', label: '按月重置' },
  { value: 'year', label: '按年重置' },
  { value: 'dependency', label: '按依赖字段重置' },
];

const encodingDatePatternOptions = [
  { value: 'YYMM', label: 'YYMM（4位）' },
  { value: 'YYYYMMDD', label: 'YYYYMMDD（8位）' },
  { value: 'YYYY', label: 'YYYY（4位）' },
  { value: 'MMDD', label: 'MMDD（4位）' },
  { value: 'none', label: '不使用日期段' },
];

const encodingSegmentTypeOptions: Array<{ value: EncodingSegmentType; label: string }> = [
  { value: 'fixed', label: '固定文本' },
  { value: 'date', label: '日期时间' },
  { value: 'field', label: '表单字段' },
  { value: 'masterData', label: '基础档案' },
  { value: 'organization', label: '组织信息' },
  { value: 'sequence', label: '流水号' },
];

const encodingPaddingOptions: Array<{ value: EncodingPadding; label: string }> = [
  { value: 'none', label: '不补位' },
  { value: 'leftZero', label: '左侧补 0' },
  { value: 'rightZero', label: '右侧补 0' },
  { value: 'truncate', label: '超长截断' },
];

const encodingGenerationModeOptions: Array<{ value: EncodingGenerationMode; label: string }> = [
  { value: 'auto', label: '自动生成' },
  { value: 'autoEditable', label: '自动生成后可改' },
  { value: 'manual', label: '手工录入' },
];

const encodingGenerationTimingOptions: Array<{ value: EncodingGenerationTiming; label: string }> = [
  { value: 'create', label: '新建时生成' },
  { value: 'save', label: '保存草稿时生成' },
  { value: 'submit', label: '提交时生成' },
  { value: 'workflowNode', label: '流程节点生成' },
];

const encodingUniquenessScopeOptions: Array<{ value: EncodingUniquenessScope; label: string }> = [
  { value: 'form', label: '当前表单唯一' },
  { value: 'global', label: '同租户同编码字段唯一' },
  { value: 'organization', label: '组织内唯一' },
  { value: 'dependency', label: '依赖范围内唯一' },
];

const referenceSourceKindOptions: Array<{ value: ReferenceSourceKind; label: string }> = [
  { value: 'static', label: '静态选项' },
  { value: 'dictionary', label: '数据字典' },
  { value: 'masterData', label: '基础档案' },
  { value: 'businessForm', label: '业务表单' },
  { value: 'organization', label: '用户组织' },
  { value: 'externalApi', label: '外部接口' },
];

const referenceSourceRegistry: Record<ReferenceSourceKind, {
  setup: string;
  placeholder: string;
  objects: Array<{ value: string; label: string }>;
  valueFields: Array<{ value: string; label: string }>;
  labelFields: Array<{ value: string; label: string }>;
  preview: string[];
}> = {
  static: {
    setup: '当前字段配置中维护，适合只服务本字段的小枚举',
    placeholder: '例如：系统监测、人工上报、外部接口',
    objects: [{ value: 'inline_options', label: '字段私有选项' }],
    valueFields: [{ value: 'value', label: '选项值' }],
    labelFields: [{ value: 'label', label: '选项名称' }],
    preview: ['系统监测', '人工上报', '外部接口'],
  },
  dictionary: {
    setup: '系统管理 / 数据字典与基础档案 / 数据字典',
    placeholder: '选择数据字典，例如 alert_level',
    objects: [
      { value: 'alert_source', label: '告警来源' },
      { value: 'alert_level', label: '告警等级' },
      { value: 'alert_status', label: '告警状态' },
      { value: 'priority', label: '优先级' },
    ],
    valueFields: [{ value: 'item_value', label: '字典项编码' }],
    labelFields: [{ value: 'item_label', label: '字典项名称' }],
    preview: ['严重', '一般', '提醒'],
  },
  masterData: {
    setup: '系统管理 / 数据字典与基础档案 / 基础档案',
    placeholder: '选择基础档案，例如 equipment_master',
    objects: [
      { value: 'equipment', label: '设备档案' },
      { value: 'production_lines', label: '产线档案' },
      { value: 'material_master', label: '物料档案' },
      { value: 'supplier_master', label: '供应商档案' },
    ],
    valueFields: [
      { value: 'id', label: '内部 ID' },
      { value: 'code', label: '档案编码' },
      { value: 'equipment_no', label: '设备编号' },
    ],
    labelFields: [
      { value: 'name', label: '档案名称' },

    ],
    preview: ['SMT-03 回流焊', '空压站 2#', 'Assembly-A 主线'],
  },
  businessForm: {
    setup: '系统管理 / 应用与菜单 / 表单资产',
    placeholder: '选择业务表单，例如 alert-center',
    objects: [
      { value: 'alert-center', label: '告警中心' },
      { value: 'risk-review', label: '风险复核' },
      { value: 'maintenance-order', label: '维修工单' },
    ],
    valueFields: [{ value: 'id', label: '记录 ID' }, { value: 'code', label: '业务编号' }],
    labelFields: [{ value: 'title', label: '标题' }, { value: 'name', label: '名称' }],
    preview: ['AL-20260529-001', 'AL-20260529-002'],
  },
  organization: {
    setup: '系统管理 / 用户与权限 / 组织管理、用户管理、角色管理',
    placeholder: '选择组织、角色或人员范围',
    objects: [
      { value: 'users', label: '用户' },
      { value: 'roles', label: '角色' },
      { value: 'org_units', label: '组织' },
    ],
    valueFields: [{ value: 'id', label: '记录 ID' }],
    labelFields: [{ value: 'name', label: '名称（人员显示姓名）' }],
    preview: ['李明', '孙浩', '周强'],
  },
  externalApi: {
    setup: '数据源管理 / REST API 或系统管理 / 数据资产与本体',
    placeholder: '选择已接入的 API 数据源',
    objects: [
      { value: 'mes-alert-api', label: 'MES 告警接口' },
      { value: 'erp-material-api', label: 'ERP 物料接口' },
    ],
    valueFields: [{ value: 'id', label: '接口返回 ID' }, { value: 'code', label: '接口返回编码' }],
    labelFields: [{ value: 'name', label: '接口返回名称' }, { value: 'label', label: '接口返回标签' }],
    preview: ['外部接口项 A', '外部接口项 B'],
  },
};

const ruleLabels: Record<ControlRuleKey, string> = {
  visible: '默认显示',
  readonly: '默认只读',
  required: '默认必输',
  unique: '唯一校验',
  masked: '默认脱敏',
  copyable: '允许复制',
  optionSort: '选项排序',
};

const ruleOperatorOptions = [
  { value: 'equals', label: '等于' },
  { value: 'notEquals', label: '不等于' },
  { value: 'contains', label: '包含' },
  { value: 'notEmpty', label: '不为空' },
];

const ruleStrategyOptions: Partial<Record<ControlRuleKey, Array<{ value: string; label: string }>>> = {
  unique: [
    { value: 'form', label: '当前表单唯一' },
    { value: 'global', label: '同租户同编码字段唯一' },
    { value: 'compound', label: '组合字段唯一' },
  ],
  masked: [
    { value: 'role', label: '按角色脱敏' },
    { value: 'partial', label: '保留首尾' },
    { value: 'hidden', label: '全量隐藏' },
  ],
  copyable: [
    { value: 'normal', label: '允许复制文本' },
    { value: 'maskedCopy', label: '复制时脱敏' },
    { value: 'disabled', label: '禁止复制' },
  ],
  optionSort: [
    { value: 'sourceOrder', label: '按数据源顺序' },
    { value: 'labelAsc', label: '按显示名称升序' },
    { value: 'valueAsc', label: '按编码/值升序' },
    { value: 'custom', label: '自定义排序' },
  ],
};

const viewControlOptions: Array<{ value: ViewControlType; label: string }> = [
  { value: 'keyword', label: '关键词' },
  { value: 'text', label: '文本输入' },
  { value: 'select', label: '选择控件' },
  { value: 'dateRange', label: '日期范围' },
  { value: 'date', label: '单日期' },
  { value: 'number', label: '数字' },
];

const viewFilterOperatorOptions: Array<{ value: ViewFilterOperator; label: string }> = [
  { value: 'contains', label: '包含' },
  { value: 'equals', label: '等于' },
  { value: 'between', label: '范围内' },
  { value: 'gte', label: '大于等于' },
  { value: 'lte', label: '小于等于' },
];

const viewColumnRenderOptions: Array<{ value: ViewColumnRenderType; label: string }> = [
  { value: 'text', label: '文本' },
  { value: 'tag', label: '标签' },
  { value: 'date', label: '日期' },
  { value: 'number', label: '数字' },
  { value: 'progress', label: '进度条' },
];

const FLOW_NODE_WIDTH = 220;
const FLOW_NODE_HEIGHT = 72;

function controlWidthLabel(width: ControlWidth) {
  const option = controlWidthOptions.find((item) => item.value === width);
  return option?.label || '50%';
}

function controlWidthClass(width: ControlWidth) {
  return `control-width-${width}`;
}

function makeControlRules(required = false, field?: DesignerField): ControlRules {
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

function normalizeControlRules(rules?: Partial<ControlRules>, field?: DesignerField): ControlRules {
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

function inferBusinessTypeFromLegacyType(type = ''): FieldBusinessType {
  if (type === 'code' || type.includes('编码')) return 'code';
  if (type.includes('日期')) return 'datetime';
  if (type.includes('数字') || type.includes('数值')) return 'number';
  if (type.includes('下拉') || type.includes('选择')) return 'enum';
  if (type.includes('人员')) return 'person';
  if (type.includes('关联')) return 'relation';
  if (type.includes('附件')) return 'attachment';
  if (type.includes('多行')) return 'longText';
  return 'text';
}

function getFieldBusinessType(field?: DesignerField): FieldBusinessType {
  if (!field) return 'text';
  return field.businessType || inferBusinessTypeFromLegacyType(field.type);
}

function getFieldBusinessTypeLabel(field?: DesignerField) {
  const businessType = getFieldBusinessType(field);
  return fieldBusinessTypeOptions.find((item) => item.value === businessType)?.label || '文本';
}

const fieldStorageTypeLabels: Record<string, string> = {
  string: '文本 string',
  text: '长文本 text',
  number: '数值 number',
  integer: '整数 integer',
  decimal: '小数 decimal',
  float: '浮点 float',
  boolean: '布尔 boolean',
  date: '日期 date',
  datetime: '日期时间 datetime',
  enum: '枚举 enum',
  relation: '关联 relation',
  json: 'JSON json',
};

function getFieldStorageTypeLabel(field?: DesignerField) {
  if (!field) return '未绑定字段';
  const storageType = mapDesignerFieldType(field);
  return fieldStorageTypeLabels[storageType] || storageType;
}

function isEncodingField(field?: DesignerField) {
  return getFieldBusinessType(field) === 'code';
}

function makeEncodingRule(field?: DesignerField): EncodingRule {
  const prefix = field?.key.toLowerCase().includes('alert') ? 'AL' : field?.key.toLowerCase().includes('risk') ? 'SR' : 'NO';
  const defaultSegments: EncodingSegment[] = [
    {
      id: 'segment-prefix',
      name: '业务前缀',
      type: 'fixed',
      length: prefix.length,
      value: prefix,
      padding: 'none',
      lockAfterGenerated: true,
    },
    {
      id: 'segment-date',
      name: '年月',
      type: 'date',
      length: 4,
      datePattern: 'YYMM',
      padding: 'none',
      lockAfterGenerated: true,
    },
    {
      id: 'segment-sequence',
      name: '流水号',
      type: 'sequence',
      length: 3,
      resetCycle: 'month',
      padding: 'leftZero',
      sequenceStart: 1,
      sequenceStep: 1,
      lockAfterGenerated: true,
    },
  ];
  return {
    enabled: true,
    template: `{PREFIX}-{YYMM}-{SEQ3}`,
    prefix,
    datePattern: 'YYMM',
    dependencies: [],
    resetCycle: 'month',
    sequenceLength: 3,
    fixedLength: 13,
    dependencySegmentLength: 2,
    regenerateOnDependencyChange: true,
    allowManualOverride: false,
    unique: true,
    segments: defaultSegments,
    generationMode: 'auto',
    generationTiming: 'create',
    uniquenessScope: 'form',
  };
}

function getEncodingRules(rule?: EncodingRule): EncodingRule[] {
  if (!rule) return [];
  if (Array.isArray(rule.rules)) return rule.rules;
  return [{ ...rule, id: 'default-rule', name: '默认编码规则', conditions: [] }];
}

function makeEncodingSegment(type: EncodingSegmentType = 'fixed', fields: DesignerField[] = []): EncodingSegment {
  const firstSourceField = fields.find((field) => !isEncodingField(field));
  const base: EncodingSegment = {
    id: `segment-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    name: encodingSegmentTypeOptions.find((item) => item.value === type)?.label || '编码段',
    type,
    length: type === 'sequence' ? 3 : type === 'date' ? 4 : 2,
    padding: type === 'sequence' ? 'leftZero' : 'truncate',
    lockAfterGenerated: true,
  };
  if (type === 'fixed') return { ...base, name: '固定文本', value: 'AL', length: 2, padding: 'none' };
  if (type === 'date') return { ...base, name: '日期', datePattern: 'YYMM', length: 4, padding: 'none' };
  if (type === 'sequence') return { ...base, name: '流水号', resetCycle: 'month', sequenceStart: 1, sequenceStep: 1 };
  if (type === 'organization') return { ...base, name: '组织编码', sourceAttribute: 'org_code', length: 3 };
  return { ...base, name: type === 'masterData' ? '档案编码' : '字段取值', sourceField: firstSourceField?.key, sourceAttribute: 'code' };
}

function getLegacyEncodingSegments(rule: EncodingRule): EncodingSegment[] {
  const segments: EncodingSegment[] = [];
  if (rule.prefix) {
    segments.push({
      id: 'legacy-prefix',
      name: '业务前缀',
      type: 'fixed',
      length: rule.prefix.length,
      value: rule.prefix,
      padding: 'none',
    });
  }
  if (rule.datePattern && rule.datePattern !== 'none') {
    segments.push({
      id: 'legacy-date',
      name: '日期',
      type: 'date',
      length: getDateSegmentLength(rule.datePattern),
      datePattern: rule.datePattern,
      padding: 'none',
    });
  }
  rule.dependencies.forEach((sourceField, index) => {
    segments.push({
      id: `legacy-field-${sourceField}`,
      name: index === 0 ? '依赖字段' : `依赖字段 ${index + 1}`,
      type: 'field',
      length: rule.dependencySegmentLength || 2,
      sourceField,
      sourceAttribute: 'code',
      padding: 'truncate',
      regenerateOnChange: true,
    });
  });
  segments.push({
    id: 'legacy-sequence',
    name: '流水号',
    type: 'sequence',
    length: rule.sequenceLength || 3,
    resetCycle: rule.resetCycle,
    padding: 'leftZero',
    sequenceStart: 1,
    sequenceStep: 1,
  });
  return segments;
}

function getEncodingSegments(rule?: EncodingRule): EncodingSegment[] {
  if (!rule) return [];
  if (rule.segments?.length) return rule.segments;
  return getLegacyEncodingSegments(rule);
}

function getEncodingSegmentTypeLabel(type: EncodingSegmentType) {
  return encodingSegmentTypeOptions.find((item) => item.value === type)?.label || '编码段';
}

function renderDateSample(pattern?: string) {
  if (pattern === 'none') return '';
  const now = new Date();
  return (pattern || 'YYMM').replace(/YYYY|YY|MM|DD/g, (token) => ({
    YYYY: String(now.getFullYear()), YY: String(now.getFullYear()).slice(-2),
    MM: String(now.getMonth() + 1).padStart(2, '0'), DD: String(now.getDate()).padStart(2, '0'),
  }[token] || token));
}

function fitSegmentSample(value: string, length: number, padding?: EncodingPadding) {
  if (!length || length <= 0) return '';
  if (value.length === length) return value;
  if (value.length > length) return padding === 'truncate' ? value.slice(0, length) : value;
  if (padding === 'leftZero') return value.padStart(length, '0');
  if (padding === 'rightZero') return value.padEnd(length, '0');
  return value;
}

function encodingSegmentLengthError(segment: EncodingSegment) {
  const raw = segment.type === 'fixed' ? segment.value || ''
    : segment.type === 'date' ? renderDateSample(segment.datePattern)
    : segment.type === 'sequence' ? String(segment.sequenceStart ?? 1) : '';
  const size = Array.from(raw).length;
  return size > segment.length && segment.padding !== 'truncate' ? `内容 ${size} 个字符，超过 ${segment.length} 位` : '';
}

function renderEncodingSegmentSample(segment: EncodingSegment, fields: DesignerField[] = []) {
  const length = segment.length || 0;
  if (segment.type === 'fixed') return fitSegmentSample(segment.value || '', length, segment.padding);
  if (segment.type === 'date') return fitSegmentSample(renderDateSample(segment.datePattern), length, segment.padding);
  if (segment.type === 'sequence') return fitSegmentSample(String(segment.sequenceStart || 1), length, segment.padding || 'leftZero');
  if (segment.type === 'organization') return fitSegmentSample(segment.sourceAttribute === 'org_name' ? '制造部' : 'MF', length, segment.padding);
  const sourceField = fields.find((field) => field.key === segment.sourceField);
  return fitSegmentSample(sourceField?.key?.toUpperCase() || 'FIELD', length, segment.padding);
}

function renderEncodingSample(rule?: EncodingRule, fields: DesignerField[] = []) {
  if (!rule?.enabled) return '不自动生成';
  const segments = getEncodingSegments(rule);
  if (!segments.length) return '请新增编码段';
  return segments.map((segment) => renderEncodingSegmentSample(segment, fields)).join('');
}

function getDateSegmentLength(pattern?: string) {
  if (!pattern || pattern === 'none') return 0;
  return pattern.length;
}

function getEncodingComposition(rule?: EncodingRule, fields: DesignerField[] = []) {
  if (!rule?.enabled) return '未启用自动编码';
  const segments = getEncodingSegments(rule);
  if (!segments.length) return '尚未配置编码段';
  const parts = segments.map((segment) => {
    const field = fields.find((item) => item.key === segment.sourceField);
    const source = field ? `：${field.name}` : '';
    return `${segment.name || getEncodingSegmentTypeLabel(segment.type)}${source} ${segment.length || 0} 位`;
  });
  const expected = segments.reduce((total, segment) => total + (segment.length || 0), 0);
  return `${parts.join(' + ')} = ${expected} 位`;
}

const flowNodePalette: FlowNodeDefinition[] = [
  { key: 'start', name: '开始节点', desc: '流程入口，仅保留一个', role: 'start', icon: <CheckCircleOutlined /> },
  { key: 'approve', name: '审批节点', desc: '人工审核、同意或驳回', role: 'task', icon: <UserSwitchOutlined /> },
  { key: 'handle', name: '处理节点', desc: '业务办理、补充资料', role: 'task', icon: <SettingOutlined /> },
  { key: 'dispatch', name: '分发节点', desc: '按规则分派责任人', role: 'task', icon: <LinkOutlined /> },
  { key: 'condition', name: '条件分支', desc: '按字段或规则走不同路径', role: 'task', icon: <TagsOutlined /> },
  { key: 'cc', name: '抄送节点', desc: '通知相关角色或人员', role: 'task', icon: <UserOutlined /> },
  { key: 'automation', name: '自动任务', desc: '调用接口、写入数据、触发消息', role: 'task', icon: <DatabaseOutlined /> },
  { key: 'end', name: '结束节点', desc: '流程归档出口', role: 'end', icon: <LockOutlined /> },
];

const configs: Record<string, DesignerConfig> = {
  'risk-review': {
    id: 'risk-review',
    name: '风险复核',
    createTitle: '新增风险复核单',
    kind: 'business',
    appName: '供应链风险',
    dataSource: 'risk_reviews',
    primaryKey: 'riskNo',
    status: '草稿',
    version: 'v1',
    description: '用于新增风险复核业务数据，而不是配置整个运行页面。',
    fields: [
      { key: 'riskNo', name: '风险单号', type: '文本 / 自动编号', businessType: 'code', placeholder: '自动生成 SR-2605-001', locked: true, required: true, listVisible: true, searchable: true, sortable: true, validation: '系统唯一编号，不允许重复' },
      { key: 'subject', name: '风险主题', type: '文本输入', placeholder: '请输入风险主题', required: true, listVisible: true, searchable: true, validation: '2-80 个字符' },
      { key: 'level', name: '风险等级', type: '下拉选择', placeholder: '高 / 中 / 低', required: true, listVisible: true, searchable: true, optionSource: '高、中、低' },
      { key: 'owner', name: '处理人', type: '人员选择', placeholder: '选择处理人', required: true, listVisible: true, searchable: true, optionSource: '组织人员' },
      { key: 'reason', name: '风险原因', type: '多行文本', placeholder: '描述风险原因和影响范围', listVisible: false, validation: '最多 500 字' },
    ],
    filters: [
      { key: 'keyword', name: '业务编号 / 主题', type: '搜索输入', placeholder: '请输入关键词' },
      { key: 'status', name: '状态', type: '下拉选择', placeholder: '请选择状态' },
      { key: 'level', name: '等级', type: '下拉选择', placeholder: '请选择等级' },
      { key: 'owner', name: '负责人', type: '人员选择', placeholder: '请选择负责人' },
    ],
    flowSteps: ['提交复核', '风险定级', '责任分派', '处理关闭'],
    roles: ['采购管理', '计划管理', '仓储管理', '系统管理员'],
  },
  'alert-center': {
    id: 'alert-center',
    name: '告警中心',
    createTitle: '新增设备告警',
    kind: 'business',
    appName: '预测性维护',
    dataSource: 'business_alert_center',
    primaryKey: 'alertId',
    status: '已发布',
    version: 'v1',
    description: '用于新增设备告警数据，字段和风险复核不同。',
    fields: [
      { key: 'alertId', name: '告警编号', type: '文本 / 自动编号', businessType: 'code', placeholder: '自动生成 AL-2605-001', locked: true, required: true, listVisible: true, searchable: true, sortable: true, validation: '系统唯一编号，不允许重复' },
      { key: 'title', name: '告警标题', type: '文本输入', placeholder: '请输入告警标题', required: true, listVisible: true, searchable: true, validation: '2-80 个字符' },
      { key: 'device', name: '关联设备', type: '关联对象', placeholder: '选择设备', required: true, listVisible: true, searchable: true, optionSource: '设备台账' },
      { key: 'level', name: '告警等级', type: '下拉选择', placeholder: '严重 / 一般 / 提醒', required: true, listVisible: true, searchable: true, optionSource: '严重、一般、提醒' },
      { key: 'source', name: '告警来源', type: '下拉选择', placeholder: '系统监测 / 人工上报 / 外部接口', required: true, listVisible: true, searchable: true, optionSource: '系统监测、人工上报、外部接口' },
      { key: 'occurredAt', name: '发生时间', type: '日期控件', placeholder: '选择告警发生时间', required: true, listVisible: true, sortable: true },
      { key: 'owner', name: '处理人', type: '人员选择', placeholder: '选择处理人', listVisible: true, searchable: true, optionSource: '组织人员' },
      { key: 'dueAt', name: '处理时限', type: '日期控件', placeholder: '选择处理截止时间', listVisible: true, sortable: true, validation: '严重告警必须配置处理时限' },
      { key: 'status', name: '告警状态', type: '下拉选择', placeholder: '待处理 / 处理中 / 已关闭', listVisible: true, searchable: true, optionSource: '待处理、处理中、已关闭' },
      { key: 'resolution', name: '处理结论', type: '多行文本', placeholder: '填写处理过程和关闭结论', listVisible: false, validation: '关闭告警时必填' },
      { key: 'evidence', name: '附件证据', type: '附件控件', placeholder: '上传现场图片、日志或凭证', listVisible: false, validation: '严重告警建议必填' },
    ],
    filters: [
      { key: 'keyword', name: '告警编号 / 标题', type: '搜索输入', placeholder: '请输入关键词' },
      { key: 'device', name: '设备', type: '关联对象', placeholder: '请选择设备' },
      { key: 'level', name: '等级', type: '下拉选择', placeholder: '请选择等级' },
      { key: 'status', name: '状态', type: '下拉选择', placeholder: '请选择状态' },
    ],
    flowSteps: ['告警登记', '维护确认', '维修处理', '关闭归档'],
    roles: ['设备管理员', '维修工程师', '生产经理', '系统管理员'],
  },
};

const defaultConfig: DesignerConfig = {
  id: 'unknown',
  name: '表单设置',
  createTitle: '新增业务记录',
  kind: 'business',
  appName: '当前应用',
  dataSource: 'business_records',
  primaryKey: 'id',
  status: '草稿',
  version: 'v1',
  description: '用于配置新增业务数据的表单。',
  fields: [
    { key: 'id', name: '编号', type: '文本 / 自动编号', businessType: 'code', placeholder: '自动生成编号', locked: true, required: true, listVisible: true, searchable: true, validation: '系统唯一编号' },
    { key: 'name', name: '名称', type: '文本输入', placeholder: '请输入名称', required: true, listVisible: true, searchable: true },
    { key: 'status', name: '状态', type: '下拉选择', placeholder: '请选择状态', listVisible: true, searchable: true },
  ],
  filters: [
    { key: 'keyword', name: '关键词', type: '搜索输入', placeholder: '请输入关键词' },
    { key: 'status', name: '状态', type: '下拉选择', placeholder: '请选择状态' },
  ],
  flowSteps: ['提交', '审批', '归档'],
  roles: ['系统管理员'],
};

function isNumericFormRouteId(value: string) {
  return /^\d+$/.test(value.trim());
}

async function resolvePlatformFormForConfig(configId: string) {
  if (isNumericFormRouteId(configId)) {
    const detailResponse = await getPlatformForm(configId, { schema: 'draft', scope: 'designer' });
    const form = detailResponse.data?.data as PlatformForm | undefined;
    return form || null;
  }
  try {
    const detailResponse = await getPlatformFormByCode(configId, { schema: 'draft', scope: 'designer' });
    const form = detailResponse.data?.data as PlatformForm | undefined;
    if (form) return form;
  } catch {
    // Keep compatibility with older backends that only support list + id lookup.
  }
  const formsResponse = await listPlatformForms();
  const forms = (formsResponse.data?.data || []) as PlatformForm[];
  const matchedForm = forms.find((form) => form.code === configId);
  if (!matchedForm) return null;
  const detailResponse = await getPlatformForm(matchedForm.id, { schema: 'draft', scope: 'designer' });
  return (detailResponse.data?.data || matchedForm) as PlatformForm;
}

const tabs = [
  { key: 'form', label: '表单设计', icon: <FormOutlined /> },
  { key: 'filter', label: '数据筛选', icon: <SearchOutlined /> },
  { key: 'flow', label: '流程与审批', icon: <UserSwitchOutlined /> },
  { key: 'permission', label: '权限设计', icon: <LockOutlined /> },
];

const analyticsTabs = [
  { key: 'dashboard', label: '看板画布', icon: <BarChartOutlined /> },
  { key: 'dataset', label: '数据与指标', icon: <DatabaseOutlined /> },
  { key: 'filter', label: '筛选联动', icon: <SearchOutlined /> },
  { key: 'style', label: '样式主题', icon: <SettingOutlined /> },
  { key: 'permission', label: '权限发布', icon: <LockOutlined /> },
];

function inferDesignerKindFromMeta(kindValue?: unknown, codeValue?: unknown, tabValue?: unknown): DesignerConfig['kind'] {
  const kind = String(kindValue || '').toLowerCase();
  const code = String(codeValue || '').toLowerCase();
  const tab = String(tabValue || '').toLowerCase();
  if (
    ['analysis', 'analytics', 'dashboard', 'report', 'bi_report', 'metric_dashboard', 'list_analysis'].includes(kind)
    || ['dashboard', 'dataset', 'style'].includes(tab)
    || code.includes('dashboard')
    || code.includes('overview')
    || code.includes('report')
    || code.includes('analysis')
  ) {
    return 'analysis';
  }
  return 'business';
}

function inferFormDesignerKind(form: PlatformForm): DesignerConfig['kind'] {
  const config = (form.config || {}) as Record<string, unknown>;
  return inferDesignerKindFromMeta(config.assemblyKind || config.kind || config.type, form.code);
}

function makeDefaultAnalyticsDesign(config: DesignerConfig): AnalyticsDesign {
  const dimensions = config.fields.filter(field => field.businessType !== 'number').slice(0, 8).map(field => field.key);
  const measures = config.fields.filter(field => field.businessType === 'number' || field.type.includes('数值')).map(field => field.key);
  const dimension = dimensions.includes('date') ? 'date' : dimensions[0];
  const datasetId = `${config.id}-dataset`;
  const metrics: AnalyticsMetric[] = [{ id: 'metric-total', name: '记录数', expression: 'count(*)', datasetId, format: 'number', threshold: '正常 >= 0' }];
  if (measures.length) metrics.push({ id: 'metric-primary', name: `${measures[0]}合计`, expression: `sum(${measures[0]})`, datasetId, format: 'number', threshold: '正常 >= 0' });
  if (dimensions.includes('status')) metrics.push({ id: 'metric-rate', name: '已关闭占比', expression: 'count_if(status == "已关闭") / count(*)', datasetId, format: 'percent', threshold: '绿色 >= 90%' });
  const widgets: AnalyticsWidget[] = [{ id: 'widget-total', title: '核心指标', type: 'metric-card', datasetId, metricIds: metrics.map(metric => metric.id), width: 'full', interaction: 'none' }];
  if (dimension) widgets.push(
    { id: 'widget-trend', title: '分组分析', type: 'line', datasetId, metricIds: ['metric-total'], dimension, width: 'half', interaction: 'filter' },
    { id: 'widget-rank', title: '数量排行', type: 'rank-table', datasetId, metricIds: ['metric-total'], dimension, width: 'half', interaction: 'drilldown' },
  );
  widgets.push({ id: 'widget-detail', title: '明细列表', type: 'detail-table', datasetId, metricIds: ['metric-total'], dimension, width: 'full', interaction: 'navigate' });
  return {
    datasets: [{ id: datasetId, name: `${config.name}数据集`, sourceType: 'businessForm', source: config.id, refreshMode: 'realtime', dimensions, measures }],
    metrics, widgets, globalFilters: dimensions.slice(0, 3),
    interactions: dimension ? [{ sourceWidgetId: 'widget-trend', targetWidgetId: 'widget-detail', action: 'filter' }, { sourceWidgetId: 'widget-rank', targetWidgetId: 'widget-detail', action: 'drilldown' }] : [],
    style: makeDefaultAnalyticsStyle(),
  };
}

function normalizeAnalyticsDesign(value: unknown, fallback: AnalyticsDesign): AnalyticsDesign {
  if (!value || typeof value !== 'object') return fallback;
  const draft = value as Partial<AnalyticsDesign>;
  return {
    datasets: Array.isArray(draft.datasets) ? draft.datasets as AnalyticsDataset[] : fallback.datasets,
    metrics: Array.isArray(draft.metrics) ? draft.metrics as AnalyticsMetric[] : fallback.metrics,
    widgets: Array.isArray(draft.widgets) ? draft.widgets as AnalyticsWidget[] : fallback.widgets,
    globalFilters: Array.isArray(draft.globalFilters) ? draft.globalFilters.map(String) : fallback.globalFilters,
    interactions: Array.isArray(draft.interactions) ? draft.interactions as AnalyticsDesign['interactions'] : fallback.interactions,
    style: { ...fallback.style, ...(isRecord(draft.style) ? draft.style : {}) } as AnalyticsStyle,
  };
}

function getStoredAnalyticsDesign(form: PlatformForm | null | undefined, designerConfig: DesignerConfig): AnalyticsDesign {
  const fallback = makeDefaultAnalyticsDesign(designerConfig);
  const config = (form?.config || {}) as Record<string, unknown>;
  return normalizeAnalyticsDesign(config.analyticsDesignDraft || config.analyticsDesign, fallback);
}

const defaultComponentGroups: Array<{ category: string; items: ComponentDefinition[] }> = [
  {
    category: '基础输入',
    items: [
      { key: 'text', category: '基础输入', name: '文本控件', desc: '单行文本输入', icon: <FormOutlined />, controlType: 'text' },
      { key: 'textarea', category: '基础输入', name: '多行文本', desc: '长文本、备注、说明录入', icon: <FormOutlined />, controlType: 'textarea', defaultWidth: 'full' },
      { key: 'number', category: '基础输入', name: '数值控件', desc: '数量、金额、百分比', icon: <NumberOutlined />, controlType: 'number' },
      { key: 'code', category: '基础输入', name: '编码控件', desc: '自动编号、业务编号、流水号', icon: <NumberOutlined />, controlType: 'code' },
    ],
  },
  {
    category: '选择控件',
    items: [
      { key: 'select', category: '选择控件', name: '选择控件', desc: '固定选项、字典、人员及关联记录', icon: <SelectOutlined />, controlType: 'select' },
      { key: 'datetime', category: '选择控件', name: '日期选择', desc: '日期、时间、时间范围', icon: <CalendarOutlined />, controlType: 'datetime' },
      { key: 'switch', category: '选择控件', name: '布尔选择', desc: '是/否、启用/停用', icon: <SwitcherOutlined />, controlType: 'switch' },
      { key: 'upload', category: '选择控件', name: '附件上传', desc: '图片、文件、凭证上传', icon: <PaperClipOutlined />, controlType: 'upload', defaultWidth: 'full' },
    ],
  },
  {
    category: '布局容器',
    items: [
      { key: 'container', category: '布局容器', name: '容器', desc: '分组面板、基础信息区', icon: <HolderOutlined />, controlType: 'container', defaultWidth: 'full' },
      { key: 'two-columns', category: '布局容器', name: '多列布局', desc: '两列、三列、高密度字段排版', icon: <HolderOutlined />, controlType: 'two-columns', defaultWidth: 'full' },
      { key: 'tabs', category: '布局容器', name: 'Tab 页', desc: '切换页签、次要信息收起', icon: <HolderOutlined />, controlType: 'tabs', defaultWidth: 'full' },
      { key: 'divider', category: '布局容器', name: '分割符', desc: '分割线、区块说明', icon: <FileSearchOutlined />, controlType: 'divider', defaultWidth: 'full' },
    ],
  },
  {
    category: '数据展示',
    items: [
      { key: 'editable-table', category: '数据展示', name: '表格', desc: '可编辑子表、明细行', icon: <TableOutlined />, controlType: 'editable-table', defaultWidth: 'full' },
      { key: 'readonly-table', category: '数据展示', name: '关联表格', desc: '只读关联表、分页详情', icon: <TableOutlined />, controlType: 'readonly-table', defaultWidth: 'full' },
      { key: 'summary-card', category: '数据展示', name: '数据摘要', desc: '摘要卡、统计值、关联对象概览', icon: <DatabaseOutlined />, controlType: 'summary-card', defaultWidth: 'full' },
      { key: 'status-tag', category: '数据展示', name: '状态标签', desc: '状态、等级、结果标识', icon: <TagsOutlined />, controlType: 'status-tag' },
      { key: 'file-preview', category: '数据展示', name: '媒体预览', desc: '图片、附件、凭证预览', icon: <FileImageOutlined />, controlType: 'file-preview', defaultWidth: 'full' },
    ],
  },
];

const defaultCommonControlKeys = ['text', 'number', 'code', 'select', 'datetime'];

const componentIconMap: Record<string, React.ReactNode> = {
  text: <FormOutlined />,
  textarea: <FormOutlined />,
  form: <FormOutlined />,
  number: <NumberOutlined />,
  code: <NumberOutlined />,
  select: <SelectOutlined />,
  relation: <LinkOutlined />,
  datetime: <CalendarOutlined />,
  switch: <SwitcherOutlined />,
  upload: <PaperClipOutlined />,
  table: <TableOutlined />,
  database: <DatabaseOutlined />,
  tag: <TagsOutlined />,
  media: <FileImageOutlined />,
  layout: <HolderOutlined />,
  divider: <FileSearchOutlined />,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isControlWidth(value: unknown): value is ControlWidth {
  return controlWidthOptions.some(option => option.value === value);
}

function normalizeDesignerOptions(raw: unknown, fallback: DesignerOption[]): DesignerOption[] {
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

function normalizeComponentGroups(
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

function normalizeStringList(raw: unknown, fallback: string[]): string[] {
  if (!Array.isArray(raw)) return fallback;
  const values = raw.filter((item): item is string => typeof item === 'string' && item.length > 0);
  return values.length ? values : fallback;
}

function normalizeBusinessSections(raw: unknown, fallback: BusinessSection[]): BusinessSection[] {
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

function getDesignerMeta(form: PlatformForm | null | undefined): DesignerMeta {
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

const alertBusinessSections: BusinessSection[] = [
  { key: 'basic', title: '基础信息', desc: '识别告警、说明主题和来源', fieldKeys: ['alertId', 'title', 'source', 'occurredAt'] },
  { key: 'device', title: '设备信息', desc: '定位设备、等级和影响范围', fieldKeys: ['device', 'level'] },
  { key: 'handle', title: '告警处理', desc: '明确责任人、时限、状态和结论', fieldKeys: ['owner', 'dueAt', 'status', 'resolution'] },
  { key: 'evidence', title: '附件证据', desc: '上传现场图片、日志和处理凭证', fieldKeys: ['evidence'] },
  { key: 'approval', title: '审批/流转信息', desc: '展示流程状态、操作记录和关闭轨迹', fieldKeys: [] },
];

const fieldTemplates: DesignerField[] = [
  { key: 'templateCode', name: '业务编号', type: '文本 / 自动编号', businessType: 'code', placeholder: '自动生成唯一编号', locked: true, required: true, listVisible: true, searchable: true, sortable: true },
  { key: 'templateTitle', name: '标题', type: '文本输入', placeholder: '请输入标题', required: true, listVisible: true, searchable: true },
  { key: 'templateStatus', name: '状态', type: '下拉选择', placeholder: '待处理 / 处理中 / 已关闭', listVisible: true, searchable: true, optionSource: '待处理、处理中、已关闭' },
  { key: 'templateLevel', name: '等级', type: '下拉选择', placeholder: '高 / 中 / 低', listVisible: true, searchable: true, optionSource: '高、中、低' },
  { key: 'templateOwner', name: '责任人', type: '人员选择', placeholder: '选择责任人', listVisible: true, searchable: true, optionSource: '组织人员' },
  { key: 'templateTime', name: '时间', type: '日期控件', placeholder: '选择时间', listVisible: true, sortable: true },
  { key: 'templateAttachment', name: '附件', type: '附件控件', placeholder: '上传附件', listVisible: false },
  { key: 'templateRemark', name: '备注', type: '多行文本', placeholder: '填写备注说明', listVisible: false },
];

function getRecommendedRules(fields: DesignerField[]) {
  const suggestions: string[] = [];
  const has = (name: string) => fields.some(field => field.name.includes(name));
  if (has('物料编码')) suggestions.push('建议为物料编码配置自动编号与唯一性校验');
  if (has('安全库存')) suggestions.push('建议将安全库存设置为非负数，防止录入负库存阈值');
  if (has('计量单位')) suggestions.push('建议将计量单位绑定字典，统一物料的计量口径');
  if (has('告警等级') && has('附件') && has('处理时限')) suggestions.push('建议在告警等级为严重时，将附件证据和处理时限设为必填');
  if (has('告警状态') && has('处理结论')) suggestions.push('建议在告警状态为已关闭时，将处理结论设为必填');
  return suggestions;
}

function getFlowNodeAssigneeLabel(node?: FlowDesignerNode) {
  if (!node) return '未选择流程节点';
  if (node.type === 'startEvent') return '发起人';
  if (node.type === 'endEvent') return '流程归档';
  if (node.assigneeSource === 'field') return `${node.assigneeValue || '未配置'}字段`;
  if (node.assigneeSource === 'departmentOwner') return '部门负责人';
  if (node.assigneeSource === 'initiatorManager') return '发起人上级';
  return node.assigneeValue || '未配置处理人';
}

function getPreviewNodeNote(node?: FlowDesignerNode) {
  if (!node) return '请选择流程节点，预览会按该节点的处理人和字段权限展示运行效果。';
  const permissions = Object.values(node.fieldPermissions || {});
  const editableCount = permissions.filter((permission) => permission.editable).length;
  const requiredCount = permissions.filter((permission) => permission.required).length;
  return `当前节点：${node.label}；处理人：${getFlowNodeAssigneeLabel(node)}；可编辑 ${editableCount} 个字段，必填 ${requiredCount} 个字段。`;
}

function optionSourceToOptions(source?: string, fallback?: string) {
  return parseStaticOptions(source === undefined ? fallback : source);
}

function inferFieldControlType(field?: DesignerField) {
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

function getEffectiveControlTypeForControl(control?: LayoutControl, field?: DesignerField) {
  if (!control) return '';
  if (control.controlType === 'field') return inferFieldControlType(field);
  return control.controlType;
}

function isDataSourceControlType(controlType?: string) {
  return controlType === 'select' || controlType === 'relation';
}

function inferReferenceSourceKind(field?: DesignerField, controlType?: string): ReferenceSourceKind {
  const businessType = getFieldBusinessType(field);
  if (businessType === 'person') return 'organization';
  if (businessType === 'relation' || controlType === 'relation') {
    if (field?.optionSource?.includes('组织') || field?.optionSource?.includes('人员')) return 'organization';
    return 'masterData';
  }
  if (businessType === 'enum') return 'static';
  return 'static';
}

function getReferenceConfig(kind?: ReferenceSourceKind) {
  return referenceSourceRegistry[kind || 'static'];
}

function fieldInput(field: DesignerField, placeholderOverride?: string, disabled = false, optionSourceOverride?: string, controlTypeOverride?: string, typeSettings?: ControlTypeSettings) {
  const type=controlTypeOverride && controlTypeOverride!=='field'?controlTypeOverride:inferFieldControlType(field);
  return <FieldControl preview type={type} disabled={disabled} label={field.name} placeholder={placeholderOverride||field.placeholder} settings={typeSettings} options={parseStaticOptions(optionSourceOverride ?? field.optionSource, field.enumValues)} />;
}

function designerFieldsToViewFields(fields: DesignerField[]) {
  return fields.map((field) => ({
    fieldName: field.key,
    label: field.name,
    fieldType: field.type,
    searchable: field.searchable,
    sortable: field.sortable,
    visibleInList: field.listVisible,
  }));
}

function getPlatformUiString(field: PlatformFormField, key: string) {
  const value = field.ui_config?.[key];
  return typeof value === 'string' ? value : undefined;
}

function getPlatformFieldString(field: PlatformFormField, key: 'business_type' | 'control_type' | 'data_source') {
  const value = field[key];
  return typeof value === 'string' ? value : undefined;
}

function getPlatformEnumValues(field: PlatformFormField) {
  return enumOptions(field.enum_values).map(item=>String(item.value));
}

function getPlatformValidationText(field: PlatformFormField) {
  const validation = field.validation;
  if (!validation) return undefined;
  const messageText = validation.message || validation.detail || validation.rule;
  if (typeof messageText === 'string') return messageText;
  return undefined;
}

function getPlatformEncodingRule(field: PlatformFormField): EncodingRule | undefined {
  const rawRule = field.encoding_rule || field.ui_config?.encodingRule;
  if (!rawRule || typeof rawRule !== 'object' || Array.isArray(rawRule)) return undefined;
  const fallbackField: DesignerField = {
    key: field.field_name,
    name: field.label || field.field_name,
    type: '文本 / 自动编号',
    businessType: 'code',
    placeholder: `自动生成${field.label || field.field_name}`,
  };
  const fallback = makeEncodingRule(fallbackField);
  const rule = rawRule as Partial<EncodingRule>;
  return {
    ...fallback,
    ...rule,
    segments: Array.isArray(rule.segments) ? rule.segments : fallback.segments,
  };
}

function mapPlatformBusinessType(rawBusinessType: string | undefined, rawType: string, controlType?: string, dataSource?: string, widget?: string): FieldBusinessType {
  if (rawBusinessType === 'code' || controlType === 'code' || rawType === 'code') return 'code';
  if (rawBusinessType === 'enum' || rawType === 'enum') return 'enum';
  if (rawBusinessType === 'datetime' || rawType === 'datetime') return 'datetime';
  if (rawBusinessType === 'date' || rawType === 'date') return 'date';
  if (['number', 'integer', 'int', 'decimal', 'float'].includes(rawBusinessType || '') || ['number', 'integer', 'int', 'decimal', 'float'].includes(rawType)) return 'number';
  if (rawBusinessType === 'person') return 'person';
  if (rawBusinessType === 'attachment') return 'attachment';
  if (dataSource === 'users') return 'person';
  if (rawBusinessType === 'relation' || rawType === 'relation' || Boolean(dataSource)) return 'relation';
  if (widget === 'upload') return 'attachment';
  if (rawType === 'json' && dataSource) return 'relation';
  if (rawType === 'text') return 'longText';
  return 'text';
}

function mapPlatformFieldType(field: PlatformFormField): Pick<DesignerField, 'type' | 'businessType' | 'optionSource' | 'placeholder' | 'encodingRule'> {
  const rawType = String(field.field_type || 'string');
  const controlType = getPlatformFieldString(field, 'control_type') || getPlatformUiString(field, 'controlType');
  const widget = getPlatformUiString(field, 'widget');
  const dataSource = getPlatformFieldString(field, 'data_source') || getPlatformUiString(field, 'dataSource') || getPlatformUiString(field, 'relation');
  const rawBusinessType = getPlatformFieldString(field, 'business_type') || getPlatformUiString(field, 'businessType');
  const encodingRule = getPlatformEncodingRule(field);
  const businessType = encodingRule ? 'code' : mapPlatformBusinessType(rawBusinessType, rawType, controlType, dataSource, widget);
  const enumChoices = enumOptions(field.enum_values);
  const enumSource = enumChoices.length ? JSON.stringify(enumChoices) : getPlatformEnumValues(field).join('、') || undefined;
  const label = field.label || field.field_name;

  if (businessType === 'code') {
    return { type: '文本 / 自动编号', businessType, placeholder: `自动生成${label}`, encodingRule };
  }
  if (businessType === 'enum') {
    return { type: '下拉选择', businessType, optionSource: enumSource, placeholder: `请选择${label}` };
  }
  if (businessType === 'datetime' || businessType === 'date') {
    return { type: '日期控件', businessType, placeholder: `选择${label}` };
  }
  if (businessType === 'number') {
    return { type: '数值控件', businessType, placeholder: `请输入${label}` };
  }
  if (businessType === 'person' || businessType === 'relation') {
    return {
      type: '关联对象',
      businessType,
      optionSource: businessType === 'person' ? '组织人员' : dataSource,
      placeholder: `选择${label}`,
    };
  }
  if (businessType === 'attachment' || (rawType === 'json' && field.field_name.toLowerCase().includes('evidence'))) {
    return { type: '附件控件', businessType: 'attachment', placeholder: `上传${label}` };
  }
  if (businessType === 'longText') {
    return { type: '多行文本', businessType, placeholder: `填写${label}` };
  }
  return { type: '文本输入', businessType, placeholder: `请输入${label}` };
}

function platformFieldsToDesignerFields(fields?: PlatformFormField[]) {
  return (fields || [])
    .filter((field) => !field.archived)
    .sort((left, right) => (left.sort_order || 0) - (right.sort_order || 0))
    .map((field): DesignerField => {
      const mapped = mapPlatformFieldType(field);
      return {
        key: field.field_name,
        enumValues: field.enum_values,
        storageType: field.field_type,
        maxBytes: typeof field.validation?.maxBytes === 'number' ? field.validation.maxBytes : undefined,
        defaultRule: field.ui_config?.defaultRule as DefaultValueRule | undefined,
        computed: Boolean(field.ui_config?.computed),
        calculationRule: field.ui_config?.computed as CalculationRule | undefined,
        name: field.label || field.field_name,
        type: mapped.type,
        businessType: mapped.businessType,
        placeholder: mapped.placeholder,
        locked: mapped.businessType === 'code',
        required: field.required,
        listVisible: field.visible_in_list,
        searchable: field.searchable,
        sortable: field.sortable,
        defaultValue: field.default_value || undefined,
        validation: getPlatformValidationText(field),
        optionSource: mapped.optionSource,
        encodingRule: mapped.encodingRule,
      };
    });
}

function areDesignerFieldsSame(left?: DesignerField[], right?: DesignerField[]) {
  if (!left || !right) return false;
  if (left.length !== right.length) return false;
  return left.every((field, index) => {
    const other = right[index];
    return other
      && field.key === other.key
      && field.name === other.name
      && field.storageType === other.storageType
      && field.maxBytes === other.maxBytes
      && field.computed === other.computed
      && JSON.stringify(field.calculationRule) === JSON.stringify(other.calculationRule)
      && JSON.stringify(field.defaultRule) === JSON.stringify(other.defaultRule)
      && field.type === other.type
      && field.businessType === other.businessType
      && field.placeholder === other.placeholder
      && field.locked === other.locked
      && field.required === other.required
      && field.listVisible === other.listVisible
      && field.searchable === other.searchable
      && field.sortable === other.sortable
      && field.defaultValue === other.defaultValue
      && field.validation === other.validation
      && field.optionSource === other.optionSource
      && JSON.stringify(field.encodingRule || null) === JSON.stringify(other.encodingRule || null);
  });
}

function makeDesignerViewConfig(config: DesignerConfig): ViewConfig {
  return makeDefaultViewConfig(
    designerFieldsToViewFields(config.fields),
    config.filters.map((filter) => filter.key),
  );
}

function makeProfessionalFlowConfig(config: DesignerConfig): FlowDesignerConfig {
  return createDefaultFlowConfig({
    formId: config.id,
    formName: config.name,
    version: config.version,
    steps: config.flowSteps,
    fields: config.fields.map((field) => ({
      key: field.key,
      name: field.name,
      type: field.type,
      required: field.required,
    })),
  });
}

function shouldShiftLegacyDefaultWorkflow(nodes: FlowDesignerNode[]) {
  const legacyIds = ['start-1', 'task-1', 'task-2', 'end-1'];
  const legacyY = [80, 200, 320, 440];
  return nodes.length === legacyIds.length
    && nodes.every((node, index) => node.id === legacyIds[index] && node.x === 420 && node.y === legacyY[index]);
}

function normalizeProfessionalFlowConfig(
  source: Partial<FlowDesignerConfig> & Record<string, unknown>,
  fallback: FlowDesignerConfig,
): FlowDesignerConfig {
  // The former approval-settings editor persisted linear steps. Convert them
  // in memory; the published definition is retained until a new graph is published.
  if ((!Array.isArray(source.nodes) || !source.nodes.length) && Array.isArray(source.steps)) {
    const steps = source.steps as Array<Record<string, any>>;
    if (steps.some((step) => !['start', 'end', 'approval'].includes(step.type))) {
      throw new Error('当前旧流程包含无法转换的节点，请先迁移流程定义');
    }
    const nodes = steps.map((step, index) => ({
      id: String(step.node_id || `legacy-${index}`),
      type: step.type === 'start' ? 'startEvent' : step.type === 'end' ? 'endEvent' : 'userTask',
      label: !step.name || /^[?\s]+$/.test(step.name) ? (step.type === 'start' ? '提交' : step.type === 'end' ? '结束' : '审批') : String(step.name), x: 360, y: 140 + index * 120,
      approvalMode: step.approval_mode || 'single',
      assigneeRules: (step.assignee_rules || (step.assignee_role ? [{ type: 'role', value: step.assignee_role }] : [])).flatMap((rule: any, ruleIndex: number) =>
        (Array.isArray(rule.value) ? rule.value : [rule.value]).map((value: unknown, valueIndex: number) => ({
          id: `legacy-${index}-${ruleIndex}-${valueIndex}`, type: rule.type, value: value == null ? undefined : String(value),
        }))),
    }));
    const { steps: _steps, ...rest } = source;
    source = { ...rest, nodes: nodes as FlowDesignerNode[], edges: nodes.slice(1).map((node, index) => ({
      id: `legacy-edge-${index}`, source: nodes[index].id, target: node.id,
      sourceSide: 'bottom', targetSide: 'top', label: '', priority: index,
    })) };
  }
  const categoryByType = (type: string): FlowDesignerNode['category'] => {
    if (type.includes('Gateway')) return 'gateway';
    if (type.includes('Task')) return 'task';
    if (type.includes('Process') || type.includes('Activity')) return 'subprocess';
    if (type.includes('Object') || type.includes('Message')) return 'data';
    if (type.includes('Boundary') || type.includes('compensation')) return 'boundary';
    return 'event';
  };
  const bpmnByType: Record<string, string> = {
    startEvent: 'bpmn:StartEvent',
    endEvent: 'bpmn:EndEvent',
    userTask: 'bpmn:UserTask',
    serviceTask: 'bpmn:ServiceTask',
    manualTask: 'bpmn:UserTask',
    ccTask: 'bpmn:SendTask',
    exclusiveGateway: 'bpmn:ExclusiveGateway',
    parallelGateway: 'bpmn:ParallelGateway',
    joinGateway: 'bpmn:ParallelGateway',
  };
  const executableTypes = new Set(['startEvent', 'endEvent', 'userTask', 'serviceTask', 'manualTask', 'ccTask', 'exclusiveGateway', 'parallelGateway', 'joinGateway']);
  const rawNodes = Array.isArray(source.nodes) ? source.nodes : fallback.nodes;
  let nodes = rawNodes
    .filter(Boolean)
    .map((raw, index) => {
      const node = raw as Partial<FlowDesignerNode> & { data?: Record<string, unknown>; assigneeType?: string };
      const fallbackNode = fallback.nodes[index] || fallback.nodes[0];
      const rawType = String(node.type || node.data?.type || fallbackNode?.type || 'userTask');
      const type = rawType === 'manualTask' ? 'userTask' : rawType;
      const x = Number(node.x);
      const y = Number(node.y);
      return {
        id: String(node.id || `flow-node-${index + 1}`),
        type,
        category: node.category || categoryByType(type),
        label: String(node.label || node.data?.label || fallbackNode?.label || `节点 ${index + 1}`),
        description: String(node.description || node.data?.description || fallbackNode?.description || ''),
        executable: typeof node.executable === 'boolean' ? node.executable : executableTypes.has(type),
        x: Number.isFinite(x) ? x : 420,
        y: Number.isFinite(y) ? y : 90 + index * 120,
        assigneeSource: node.assigneeSource || (node.assigneeType as FlowDesignerNode['assigneeSource']) || fallbackNode?.assigneeSource,
        assigneeValue: node.assigneeValue || fallbackNode?.assigneeValue,
        assigneeRules: node.assigneeRules || fallbackNode?.assigneeRules,
        approvalMode: node.approvalMode || fallbackNode?.approvalMode,
        slaHours: node.slaHours ?? fallbackNode?.slaHours,
        notificationEnabled: node.notificationEnabled ?? fallbackNode?.notificationEnabled,
        errorPolicy: node.errorPolicy || fallbackNode?.errorPolicy,
        retryTimes: node.retryTimes ?? fallbackNode?.retryTimes,
        externalAction: node.externalAction || fallbackNode?.externalAction,
        bpmnType: node.bpmnType || bpmnByType[type] || fallbackNode?.bpmnType,
        fieldPermissions: normalizeNodeFieldPermissions(node.fieldPermissions || fallbackNode?.fieldPermissions),
      } satisfies FlowDesignerNode;
    });
  if (shouldShiftLegacyDefaultWorkflow(nodes)) {
    nodes = nodes.map((node) => ({ ...node, y: node.y + 60 }));
  }
  const nodeIds = new Set(nodes.map((node) => node.id));
  const rawEdges = Array.isArray(source.edges) ? source.edges : fallback.edges;
  const edges = rawEdges
    .filter(Boolean)
    .map((raw, index) => {
      const edge = raw as Partial<FlowDesignerEdge> & { fromId?: string; toId?: string };
      return {
        id: String(edge.id || `flow-edge-${index + 1}`),
        source: String(edge.source || edge.fromId || ''),
        sourceSide: edge.sourceSide || 'bottom',
        target: String(edge.target || edge.toId || ''),
        targetSide: edge.targetSide || 'top',
        label: String(edge.label || ''),
        condition: edge.condition,
        conditionField: edge.conditionField,
        conditionOperator: edge.conditionOperator,
        conditionValue: edge.conditionValue,
        priority: Number.isFinite(Number(edge.priority)) ? Number(edge.priority) : index + 1,
        isDefault: Boolean(edge.isDefault),
        routeY: edge.routeY,
      } satisfies FlowDesignerEdge;
    })
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
  const rawStateMapping = (source.stateMapping || {}) as Partial<FlowDesignerConfig['stateMapping']> & Record<string, unknown>;
  return {
    ...fallback,
    ...source,
    nodes,
    edges,
    triggerBindings: Array.isArray(source.triggerBindings) && source.triggerBindings.length ? source.triggerBindings : fallback.triggerBindings,
    stateMapping: {
      statusField: String(rawStateMapping.statusField || rawStateMapping.processStatus || fallback.stateMapping.statusField),
      currentNodeField: String(rawStateMapping.currentNodeField || rawStateMapping.currentNode || fallback.stateMapping.currentNodeField),
      currentAssigneeField: String(rawStateMapping.currentAssigneeField || rawStateMapping.currentHandler || fallback.stateMapping.currentAssigneeField),
      completedAtField: String(rawStateMapping.completedAtField || rawStateMapping.completedAt || fallback.stateMapping.completedAtField),
    },
    advancedModeConfig: {
      ...fallback.advancedModeConfig,
      ...((source.advancedModeConfig || {}) as Partial<FlowDesignerConfig['advancedModeConfig']>),
    },
  };
}

function getWorkflowDesignerMeta(form?: PlatformForm | null): WorkflowDesignerMeta {
  const config = form?.config || {};
  const meta = config.workflowDesigner;
  return meta && typeof meta === 'object' ? meta as WorkflowDesignerMeta : {};
}

function makeRuntimeFormLayout(controls: LayoutControl[], fields: DesignerField[]) {
  const fieldByKey = new Map(fields.map((field) => [field.key, field]));
  const widthToColSpan = (width: ControlWidth) => getControlColumnSpan(width) / 6;
  return buildRuntimeLayout(controls, (control, inheritedReadonly) => {
    const field = fieldByKey.get(String(control.fieldKey));
    return { fieldName: String(control.fieldKey), label: control.name || field?.name || String(control.fieldKey),
      width: control.width, colSpan: widthToColSpan(control.width), controlType: getEffectiveControlTypeForControl(control, field),
      required: Boolean(control.rules.required.enabled), readonly: inheritedReadonly,
      placeholder: control.placeholder || field?.placeholder, helpText: control.helpText };
  });
}

function getViewConfigMeta(form?: PlatformForm | null): ViewConfigMeta {
  const config = form?.config || {};
  const meta = config.viewConfigMeta;
  return meta && typeof meta === 'object' ? meta as ViewConfigMeta : {};
}

function getStoredViewConfig(form: PlatformForm | null | undefined, designerConfig: DesignerConfig): ViewConfig | null {
  const config = form?.config || {};
  const stored = config.viewConfigDraft || config.viewConfig;
  if (!stored || typeof stored !== 'object') return null;
  return normalizeViewConfig(
    stored as Partial<ViewConfig>,
    designerFieldsToViewFields(designerConfig.fields),
    designerConfig.filters.map((filter) => filter.key),
  );
}

function mapDesignerFieldType(field: DesignerField) {
  if (field.storageType) return field.storageType;
  const businessType = getFieldBusinessType(field);
  if (businessType === 'code') return 'string';
  if (businessType === 'date' || businessType === 'datetime') return 'datetime';
  if (businessType === 'number') return 'number';
  if (businessType === 'enum') return 'enum';
  if (businessType === 'attachment') return 'json';
  if (businessType === 'longText') return 'text';
  return 'string';
}

function makeWorkflowFormConfig(config: DesignerConfig) {
  return {
    formCode: config.id,
    formName: config.name,
    fields: config.fields.map((field, index) => ({
      name: field.key,
      label: field.name,
      type: mapDesignerFieldType(field),
      required: Boolean(field.required),
      sortOrder: index,
    })),
  };
}

function makeWorkflowConfigPayload(flowConfig: FlowDesignerConfig, form: PlatformForm, config: DesignerConfig) {
  return {
    ...flowConfig,
    nodes: flowConfig.nodes.map((node) => ({ ...node, fieldPermissions: normalizeNodeFieldPermissions(node.fieldPermissions), assigneeRules: node.assigneeRules?.map((rule) => ({
      ...rule, approvalMode: rule.approvalMode || node.approvalMode || 'single',
    })) })),
    steps: undefined,
    formId: form.id,
    formCode: form.code,
    formName: config.name,
    savedAt: new Date().toISOString(),
    fieldPermissions: Object.fromEntries(
      flowConfig.nodes.map((node) => [node.id, normalizeNodeFieldPermissions(node.fieldPermissions)]),
    ),
  };
}

function getDefaultTypeSettings(controlType: string, field?: DesignerField): ControlTypeSettings {
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

function makeFieldControl(field: DesignerField): LayoutControl {
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

function makeComponentControl(component: ComponentDefinition): LayoutControl {
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

function cloneControl(control: LayoutControl): LayoutControl {
  const clonedRules = normalizeControlRules(control.rules);
  return {
    ...control,
    id: `${control.id}-copy-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: control.name,
    rules: clonedRules,
  };
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return ['input', 'textarea', 'select'].includes(tagName) || target.isContentEditable || Boolean(target.closest('.ant-select'));
}

function RuleToggleControl({
  enabled,
  onConfig,
  onToggle,
  title,
}: {
  enabled: boolean;
  onConfig: () => void;
  onToggle: () => void;
  title: string;
}) {
  const runButtonAction = (event: React.MouseEvent<HTMLElement>, action: () => void) => {
    event.preventDefault();
    event.stopPropagation();
    action();
  };

  return (
    <div className="designer-rule-toggle" data-rule-title={title} onClick={(event) => event.stopPropagation()}>
      {enabled ? (
        <Button
          className="designer-rule-config-button"
          data-rule-action="config"
          size="small"
          type="text"
          icon={<SettingOutlined />}
          onMouseDownCapture={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => runButtonAction(event, onConfig)}
          title={`${title} config`}
        />
      ) : null}
      <button
        type="button"
        className={`designer-rule-check ${enabled ? 'designer-rule-check-on' : ''}`}
        data-rule-action="toggle"
        onMouseDownCapture={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => runButtonAction(event, onToggle)}
        title={enabled ? `${title} enabled` : `${title} disabled`}
      >
        <span className="designer-rule-check-box" aria-hidden="true" />
      </button>
    </div>
  );
}

function makeFlowNodes(steps: string[]): FlowNode[] {
  return steps.map((step, index) => ({
    id: `flow-${index}`,
    label: step,
    role: index === 0 ? 'start' : index === steps.length - 1 ? 'end' : 'task',
    x: 300,
    y: 112 + index * 126,
  }));
}

function makeFlowConnections(nodes: FlowNode[]): FlowConnection[] {
  return nodes.slice(0, -1).map((node, index) => ({
    id: `${node.id}-${nodes[index + 1].id}`,
    fromId: node.id,
    fromSide: 'bottom',
    toId: nodes[index + 1].id,
    toSide: 'top',
  }));
}

function getFlowNodePorts(node: FlowNode): FlowPortSide[] {
  if (node.role === 'start') return ['right', 'bottom', 'left'];
  if (node.role === 'end') return ['top', 'right', 'left'];
  return ['top', 'right', 'bottom', 'left'];
}

function getFlowPortPoint(node: FlowNode, side: FlowPortSide) {
  const points: Record<FlowPortSide, { x: number; y: number }> = {
    top: { x: node.x + FLOW_NODE_WIDTH / 2, y: node.y },
    right: { x: node.x + FLOW_NODE_WIDTH, y: node.y + FLOW_NODE_HEIGHT / 2 },
    bottom: { x: node.x + FLOW_NODE_WIDTH / 2, y: node.y + FLOW_NODE_HEIGHT },
    left: { x: node.x, y: node.y + FLOW_NODE_HEIGHT / 2 },
  };
  return points[side];
}

function getFlowPortVector(side: FlowPortSide) {
  const vectors: Record<FlowPortSide, { x: number; y: number }> = {
    top: { x: 0, y: -1 },
    right: { x: 1, y: 0 },
    bottom: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
  };
  return vectors[side];
}

function roundedOrthogonalPath(points: Array<{ x: number; y: number }>, radius = 14) {
  const compactPoints = points.filter((point, index) => {
    const previous = points[index - 1];
    return !previous || previous.x !== point.x || previous.y !== point.y;
  });
  if (compactPoints.length < 2) return '';
  const commands = [`M ${compactPoints[0].x} ${compactPoints[0].y}`];
  for (let index = 1; index < compactPoints.length - 1; index += 1) {
    const previous = compactPoints[index - 1];
    const current = compactPoints[index];
    const next = compactPoints[index + 1];
    const prevLength = Math.abs(current.x - previous.x) + Math.abs(current.y - previous.y);
    const nextLength = Math.abs(next.x - current.x) + Math.abs(next.y - current.y);
    const cornerRadius = Math.min(radius, prevLength / 2, nextLength / 2);
    const before = {
      x: current.x + Math.sign(previous.x - current.x) * cornerRadius,
      y: current.y + Math.sign(previous.y - current.y) * cornerRadius,
    };
    const after = {
      x: current.x + Math.sign(next.x - current.x) * cornerRadius,
      y: current.y + Math.sign(next.y - current.y) * cornerRadius,
    };
    commands.push(`L ${before.x} ${before.y}`);
    commands.push(`Q ${current.x} ${current.y} ${after.x} ${after.y}`);
  }
  const end = compactPoints[compactPoints.length - 1];
  commands.push(`L ${end.x} ${end.y}`);
  return commands.join(' ');
}

function getFlowConnectorPath(from: FlowNode, fromSide: FlowPortSide, to: FlowNode, toSide: FlowPortSide) {
  const start = getFlowPortPoint(from, fromSide);
  const end = getFlowPortPoint(to, toSide);
  const offset = 32;
  const fromVector = getFlowPortVector(fromSide);
  const toVector = getFlowPortVector(toSide);
  const startLead = { x: start.x + fromVector.x * offset, y: start.y + fromVector.y * offset };
  const endLead = { x: end.x + toVector.x * offset, y: end.y + toVector.y * offset };
  const fromIsVertical = fromSide === 'top' || fromSide === 'bottom';
  const bridge = fromIsVertical
    ? [
        { x: startLead.x, y: (startLead.y + endLead.y) / 2 },
        { x: endLead.x, y: (startLead.y + endLead.y) / 2 },
      ]
    : [
        { x: (startLead.x + endLead.x) / 2, y: startLead.y },
        { x: (startLead.x + endLead.x) / 2, y: endLead.y },
      ];
  return roundedOrthogonalPath([start, startLead, ...bridge, endLead, end]);
}

export interface FormSettingsPageProps {
  formId?: string;
  embedded?: boolean;
  initialTab?: 'form' | 'filter' | 'flow' | 'permission';
  onExit?: () => void;
  onPublished?: () => void;
}

function nativeDraftEncoding(settings: NonNullable<PageAction['properties']>['encoding']): EncodingRule | undefined {
  if (!settings) return undefined;
  const rule = makeEncodingRule();
  const dateLength = settings.date_pattern.length;
  return { ...rule, prefix: settings.prefix, datePattern: settings.date_pattern,
    template: `{PREFIX}-{${settings.date_pattern}}-{SEQ${settings.sequence_length}}`,
    sequenceLength: settings.sequence_length, resetCycle: settings.reset_cycle,
    fixedLength: settings.prefix.length + dateLength + settings.sequence_length + 2,
    segments: [
      { id: 'prefix', name: '业务前缀', type: 'fixed', value: settings.prefix, length: settings.prefix.length, padding: 'none', lockAfterGenerated: true },
      { id: 'date', name: '日期', type: 'date', datePattern: settings.date_pattern, length: dateLength, padding: 'none', lockAfterGenerated: true },
      { id: 'sequence', name: '流水号', type: 'sequence', length: settings.sequence_length, resetCycle: settings.reset_cycle,
        padding: 'leftZero', sequenceStart: 1, sequenceStep: 1, lockAfterGenerated: true },
    ] };
}

function draftFieldToDesignerField(field: NewFormDraft['fields'][number]): DesignerField {
  const numeric = ['integer', 'decimal'].includes(field.field_type);
  const date = ['date', 'datetime'].includes(field.field_type);
  const types: Record<string, [string, FieldBusinessType]> = {
    text: ['多行文本', 'longText'], code: ['文本 / 自动编号', 'code'],
    enum: ['下拉选择', 'enum'], attachment: ['附件控件', 'attachment'],
  };
  const [type, businessType] = types[field.field_type] || (numeric ? ['数值控件', 'number'] : date ? ['日期控件', field.field_type] : ['文本输入', 'text']);
  return { key: field.field_name, name: field.label,
    storageType: field.field_type === 'code' ? 'string' : field.field_type === 'attachment' ? 'json' : field.field_type,
    type, businessType: businessType as FieldBusinessType, locked: field.field_type === 'code',
    encodingRule: nativeDraftEncoding(field.encoding),
    enumValues: field.options ? { values: field.options } : undefined,
    optionSource: field.options ? JSON.stringify(field.options) : undefined,
    required: field.required, placeholder: field.placeholder || (field.field_type === 'code' ? '保存时自动生成' : `请输入${field.label}`), listVisible: true };
}

function applyNativeFieldProperties(control: LayoutControl, field: DesignerField | undefined, properties: NonNullable<PageAction['properties']>): LayoutControl {
  const kind = properties.control_type || getEffectiveControlTypeForControl(control, field);
  if (properties.label !== undefined && !properties.label.trim()) throw new Error('字段名称不能为空');
  if (properties.readonly === false && (control.encodingRule || isEncodingField(field) || control.computed)) throw new Error('自动生成字段的只读状态不能直接取消');
  if (properties.encoding && !isEncodingField(field)) throw new Error('编号规则只能用于编码字段');
  if (properties.options && kind !== 'select') throw new Error('候选项只能用于选择控件');
  const settings = { ...(properties.control_type ? getDefaultTypeSettings(kind, field) : control.typeSettings),
    ...properties.settings, ...(properties.min !== undefined ? { min: properties.min } : {}), ...(properties.max !== undefined ? { max: properties.max } : {}) };
  if (settings.min !== undefined && settings.max !== undefined && settings.min > settings.max) throw new Error('最小值不能大于最大值');
  if ((properties.min !== undefined || properties.max !== undefined || properties.settings?.precision !== undefined) && kind !== 'number') throw new Error('只有数字控件支持数值范围和精度');
  if (properties.settings?.rows !== undefined && kind !== 'textarea') throw new Error('只有多行文本支持行数');
  if (settings.displayMode === 'tags' && settings.selectionMode !== 'multiple') throw new Error('标签样式需要多选模式');
  return { ...control, controlType: kind,
    ...(properties.label !== undefined ? { name: properties.label.trim() } : {}),
    ...(properties.width ? { width: properties.width } : {}),
    ...(properties.help_text !== undefined ? { helpText: properties.help_text } : {}),
    ...(properties.options ? { optionSource: JSON.stringify(properties.options), dataSourceKind: 'static' as const } : {}),
    ...(properties.presentation ? { presentation: { ...control.presentation, ...properties.presentation } } : {}),
    ...(properties.encoding ? { encodingRule: nativeDraftEncoding(properties.encoding) } : {}),
    ...(properties.placeholder !== undefined ? { placeholder: properties.placeholder }
      : properties.required === true && /^选填/.test(control.placeholder || '')
        ? { placeholder: control.placeholder!.replace(/^选填[，,、：:\s]*/, '') || `请输入${control.name}` } : {}),
    typeSettings: settings,
    rules: { ...control.rules,
      ...(properties.required !== undefined ? { required: { ...control.rules.required, enabled: properties.required } } : {}),
      ...(properties.readonly !== undefined || isEncodingField(field) ? { readonly: { ...control.rules.readonly, enabled: isEncodingField(field) || Boolean(properties.readonly) } } : {}) },
  };
}

export default function FormSettingsPage({ formId: providedFormId, embedded = false, initialTab, onExit, onPublished }: FormSettingsPageProps = {}) {
  const { formId: routeFormId } = useParams();
  const formId = providedFormId || routeFormId;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const aiFormDraft = formId === 'new' ? location.state?.aiFormDraft as (NewFormDraft & { id: string }) | undefined : undefined;
  const staticBaseConfig = useMemo(
    () => {
      if (aiFormDraft) return {
        ...defaultConfig, id: aiFormDraft.code, name: aiFormDraft.name,
        createTitle: `新增${aiFormDraft.name}`, description: aiFormDraft.description,
        dataSource: aiFormDraft.code, filters: [], flowSteps: [],
        fields: aiFormDraft.fields.map(draftFieldToDesignerField),
      } satisfies DesignerConfig;
      if (formId && configs[formId]) return configs[formId];
      const fallbackId = formId || defaultConfig.id;
      const requestedTab = searchParams.get('tab');
      return {
        ...defaultConfig,
        id: fallbackId,
        kind: inferDesignerKindFromMeta(defaultConfig.kind, fallbackId, requestedTab),
      };
    },
    [formId, searchParams, aiFormDraft],
  );
  const initializedAiDraft = useRef<string>();
  const lastSavedForm = useRef<PlatformForm | null>(null);
  const [draftReviewReady, setDraftReviewReady] = useState(false);
  const isPlatformFormRoute = Boolean(formId && isNumericFormRouteId(formId));
  const [databaseFieldsByForm, setDatabaseFieldsByForm] = useState<Record<string, DesignerField[]>>({});
  const [databaseMetaByForm, setDatabaseMetaByForm] = useState<Record<string, {
    dataSource?: string;
    description?: string;
    kind?: DesignerConfig['kind'];
    name?: string;
    code?: string;
  }>>({});
  const baseConfig = useMemo<DesignerConfig>(() => {
    const databaseFields = databaseFieldsByForm[staticBaseConfig.id];
    const databaseMeta = databaseMetaByForm[staticBaseConfig.id];
    if (!databaseFields && !databaseMeta) return staticBaseConfig;
    return {
      ...staticBaseConfig,
      id: databaseMeta?.code || staticBaseConfig.id,
      name: databaseMeta?.name || staticBaseConfig.name,
      createTitle: databaseMeta?.name ? `新增${databaseMeta.name}` : staticBaseConfig.createTitle,
      kind: databaseMeta?.kind || staticBaseConfig.kind,
      fields: databaseFields ?? staticBaseConfig.fields,
      dataSource: databaseMeta?.dataSource || staticBaseConfig.dataSource,
      description: databaseMeta?.description || staticBaseConfig.description,
    };
  }, [databaseFieldsByForm, databaseMetaByForm, staticBaseConfig]);
  useShellPageTitle(`${baseConfig.name}配置`, !embedded);
  const [activeTab, setActiveTab] = useState<DesignerTab>(() => (staticBaseConfig.kind === 'analysis' ? 'dashboard' : 'form'));
  const [componentPanel, setComponentPanel] = useState<ComponentPanel>(embedded ? 'fieldTypes' : 'components');
  const [version, setVersion] = useState('v1');
  const [storedViewConfig, setViewConfig] = useState<ViewConfig>(() => makeDesignerViewConfig(baseConfig));
  const [activeViewTabId, setActiveViewTabId] = useState('default');
  const activeViewTab = getViewTabs(storedViewConfig).find((tab) => tab.id === activeViewTabId) || getViewTabs(storedViewConfig)[0];
  const viewConfig: ViewConfig = { ...storedViewConfig, filters: activeViewTab.filters, table: activeViewTab.table };
  const [identityUsers, setIdentityUsers] = useState<Array<{ id: number; username: string; label: string }>>([]);
  const [analyticsDesign, setAnalyticsDesign] = useState<AnalyticsDesign>(() => makeDefaultAnalyticsDesign(baseConfig));
  const [selectedAnalyticsWidgetId, setSelectedAnalyticsWidgetId] = useState('');
  const [analyticsLibrarySearch, setAnalyticsLibrarySearch] = useState('');
  const [analyticsSourceFields, setAnalyticsSourceFields] = useState<Record<string, PlatformFormField[]>>({});
  const [draggedAnalyticsWidgetId, setDraggedAnalyticsWidgetId] = useState('');
  const [expandedViewRow, setExpandedViewRow] = useState<string>('filter-0');
  const [filterFieldPickerOpen, setFilterFieldPickerOpen] = useState(false);
  const [tableFieldPickerOpen, setTableFieldPickerOpen] = useState(false);
  const [draggedViewFilterId, setDraggedViewFilterId] = useState('');
  const [draggedViewColumnId, setDraggedViewColumnId] = useState('');
  const [layoutControls, setLayoutControls] = useState<LayoutControl[]>(baseConfig.fields.map(makeFieldControl));
  const [selectedControlId, setSelectedControlId] = useState<string>('');
  const [defaultValueDraft, setDefaultValueDraft] = useState<{ controlId: string; rule: DefaultValueRule; fixed: string } | null>(null);
  const [calculationDraft, setCalculationDraft] = useState<{ controlId: string; rule: CalculationRule; samples: Record<string, unknown> } | null>(null);
  const [calculationBusy, setCalculationBusy] = useState(false);
  const [calculationError, setCalculationError] = useState('');
  const [calculationResult, setCalculationResult] = useState<{ value: unknown } | null>(null);
  const calculationEpoch = useRef(0);
  const [assignmentDraft, setAssignmentDraft] = useState<{ controlId: string; rules: AssignmentRule[] } | null>(null);
  const [searchDraft, setSearchDraft] = useState<SearchSettingsDraft | null>(null);
  const searchRequestEpoch = useRef(0);
  const [selectedAssetKey, setSelectedAssetKey] = useState<string>(baseConfig.fields[0]?.key || '');
  const [containerTabs, setContainerTabs] = useState<Record<string, string>>({});
  const [copiedTree, setCopiedTree] = useState<LayoutControl[]>([]);
  const [copiedControl, setCopiedControl] = useState<LayoutControl | null>(null);
  const [history, setHistory] = useState<LayoutControl[][]>([]);
  const [future, setFuture] = useState<LayoutControl[][]>([]);
  const [librarySearch, setLibrarySearch] = useState('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [canvasSettings,setCanvasSettings]=useState({columns:2,gap:12});
  const [previewForm]=Form.useForm();
  const [previewValues,setPreviewValues]=useState<Record<string,unknown>>({});
  const [previewStates,setPreviewStates]=useState<Record<string,{visible:boolean;required:boolean;readonly:boolean;masked?:boolean;copyMode?:'normal'|'maskedCopy'|'disabled';copyText?:string}>>({});
  const [previewRuleError,setPreviewRuleError]=useState('');
  const previewEpoch=useRef(0);
  const blocker=useBlocker(({currentLocation,nextLocation}) => hasUnsavedChanges
    // A pending designer can mount before React Router commits navigation.
    // Its new draft must not block the navigation that is opening it.
    && currentLocation.pathname === location.pathname
    && currentLocation.search === location.search
    && (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search));
  useEffect(()=>{if(!hasUnsavedChanges)return;const guard=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',guard);return()=>window.removeEventListener('beforeunload',guard);},[hasUnsavedChanges]);
  useEffect(()=>{if(blocker.state!=='blocked')return;const modal=Modal.confirm({className:'form-designer-dialog',title:'当前有未保存修改',content:'离开后本次修改不会保留。请先保存草稿，或确认放弃修改。',okText:'放弃并离开',cancelText:'继续编辑',onOk:()=>blocker.proceed(),onCancel:()=>blocker.reset()});return()=>modal.destroy();},[blocker]);
  const [flowLoadError, setFlowLoadError] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewRole, setPreviewRole] = useState('');
  const [hasAssociatedFlow, setHasAssociatedFlow] = useState(false);
  const [previewFlowNodeId, setPreviewFlowNodeId] = useState('');
  const [publishCheckOpen, setPublishCheckOpen] = useState(false);
  const [validationOpen, setValidationOpen] = useState(false);
  const [serverPublishReport, setServerPublishReport] = useState<PlatformFormPublishReport | null>(null);
  const [versionPanelOpen, setVersionPanelOpen] = useState(false);
  const [designerReloadKey, setDesignerReloadKey] = useState(0);
  const restoredDesignFormId = useRef<number | null>(null);
  useEffect(() => { restoredDesignFormId.current = null; }, [staticBaseConfig.id]);
  const [draggedControlId, setDraggedControlId] = useState('');
  const [dropHint, setDropHint] = useState<{ controlId: string; position: DropPosition } | null>(null);
  const [isCanvasDragActive, setCanvasDragActive] = useState(false);
  const [fieldDefaultValueDrafts, setFieldDefaultValueDrafts] = useState<Record<string, string>>({});
  const ruleOpeningValue=useRef<{id:string;key:ControlRuleKey;value:ControlRule}|null>(null);
  const [ruleModal, setRuleModal] = useState<{ controlId: string; ruleKey: ControlRuleKey } | null>(null);
  const [editingRuleGroupTitle, setEditingRuleGroupTitle] = useState<{ ruleKey: ControlRuleKey; groupIndex: number; value: string } | null>(null);
  const [ruleWindowMode, setRuleWindowMode] = useState<'common' | 'custom'>('common');
  const [encodingSegmentEditor, setEncodingSegmentEditor] = useState<{
    open: boolean;
    index?: number;
    draft: EncodingSegment;
  }>(() => ({ open: false, draft: makeEncodingSegment('fixed', baseConfig.fields) }));
  const [professionalFlowConfig, setProfessionalFlowConfig] = useState<FlowDesignerConfig>(() => makeProfessionalFlowConfig(baseConfig));
  const [platformForm, setPlatformForm] = useState<PlatformForm | null>(null);
  useEffect(() => {
    if (!embedded && platformForm?.config?.componentPageEnabled && searchParams.get('legacy') !== '1' && !hasUnsavedChanges) {
      navigate(`/program/${encodeURIComponent(platformForm.code)}`, {replace: true}); return;
    }
    const liveAnalytics = platformForm?.config?.analyticsDesign;
    const hasRuntimeDashboard = Boolean(platformForm?.published_version || platformForm?.config?.publishedSchemaVersion || (liveAnalytics && typeof liveAnalytics === 'object' && !Array.isArray(liveAnalytics)));
    if (embedded || baseConfig.kind !== 'analysis' || !platformForm || !hasRuntimeDashboard || hasUnsavedChanges || searchParams.get('legacy') === '1' || searchParams.get('tab') === 'permission') return;
    const panel = ({dataset: 'data', filter: 'filters', style: 'style'} as Record<string, string>)[searchParams.get('tab') || ''];
    navigate(`/program/${encodeURIComponent(platformForm.code)}?edit=1${panel ? `&panel=${panel}` : ''}`, {replace: true});
  }, [baseConfig.kind, platformForm, hasUnsavedChanges, searchParams, navigate, embedded]);
  const viewConfigMeta = getViewConfigMeta(platformForm);
  useEffect(()=>{if(!previewOpen||baseConfig.kind==='analysis'||!platformForm?.id)return;const epoch=++previewEpoch.current;let active=true;const timer=setTimeout(()=>{previewDesignerRules(platformForm.id,layoutControls,previewValues).then(response=>{if(!active||epoch!==previewEpoch.current)return;const result=response.data?.data;setPreviewStates(result?.states||{});previewForm.setFieldsValue(result?.data||{});setPreviewRuleError('');}).catch((error)=>{if(active)setPreviewRuleError(error?.response?.data?.detail || '规则预览失败，请检查条件配置或网络连接。');});},250);return()=>{active=false;clearTimeout(timer);};},[previewOpen,platformForm?.id,layoutControls,previewValues,previewForm]);

  const [formPermissionRows, setFormPermissionRows] = useState<FormPermissionRow[]>([]);
  const [isResolvingPlatformConfig, setResolvingPlatformConfig] = useState(Boolean(formId));
  const designerMeta = useMemo(() => getDesignerMeta(platformForm), [platformForm]);
  const {
    controlTypeOptions,
    textFormatOptions,
    textTrimModeOptions,
    textCaseModeOptions,
    selectionModeOptions,
    selectionDisplayOptions,
    dateModeOptions,
    defaultDateOptions,
    encodingResetCycleOptions,
    componentGroups,
    commonControlKeys,
  } = designerMeta;
  const commonControls = useMemo(
    () => commonControlKeys
      .map((key) => componentGroups.flatMap((group) => group.items).find((item) => item.key === key))
      .filter((item): item is ComponentDefinition => Boolean(item)),
    [commonControlKeys, componentGroups],
  );
  const [encodingSettingsDraft, setEncodingSettingsDraft] = useState<EncodingRule | null>(null);
  const [encodingSegmentEditPart, setEncodingSegmentEditPart] = useState<'type' | 'length' | 'value' | 'padding'>('type');
  const encodingEditorRef = useRef<HTMLDivElement>(null);
  const encodingRuleTargetRef = useRef<{ controlId: string; rule: EncodingRule } | null>(null);
  const [draggedEncodingSegmentId, setDraggedEncodingSegmentId] = useState<string | null>(null);
  const encodingSegmentPointer = useRef<{ id: string; x: number; y: number } | null>(null);
  const [workflowMeta, setWorkflowMeta] = useState<WorkflowDesignerMeta>({});
  const [isPersistingFlow, setPersistingFlow] = useState(false);
  const [isPersistingPermissions, setPersistingPermissions] = useState(false);
  const [identityRoleRecords, setIdentityRoleRecords] = useState<Array<{ id: number; name: string; label: string }>>([]);
  const [identityRoles, setIdentityRoles] = useState<string[]>([]);
  const [identityOrgUnits, setIdentityOrgUnits] = useState<Array<{ id: number; name: string; code?: string; status?: string }>>([]);
  const [permissionDrafts, setPermissionDrafts] = useState<PermissionDraftMap>({});
  const [permissionRoleSearch,setPermissionRoleSearch]=useState('');
  const permissionRoles = identityRoles.length ? identityRoles : baseConfig.roles;
  const permissionOrgUnits = identityOrgUnits.filter((org) => org.status !== 'inactive');
  const permissionOrgUnitIds = permissionOrgUnits.map((org) => org.id);
  const permissionOrgUnitKey = permissionOrgUnitIds.join(',');
  const permissionOrgUnitOptions = permissionOrgUnits.map((org) => ({
    value: org.id,
    label: org.code ? `${org.name} / ${org.code}` : org.name,
  }));
  useEffect(() => {
    if (!platformForm) return;
    const configDrafts = permissionDraftsFromConfig(platformForm.config);
    const rowDrafts = formPermissionRows.length
      ? permissionDraftsFromRows(formPermissionRows, identityRoleRecords, baseConfig.fields, permissionOrgUnitIds)
      : {};
    setPermissionDrafts(configDrafts);
  }, [baseConfig.fields, formPermissionRows, identityRoleRecords, permissionOrgUnitKey, platformForm]);
  const [selectedPermissionRole, setSelectedPermissionRole] = useState('');
  const [fieldPermissionQuery, setFieldPermissionQuery] = useState('');
  const [fieldPermissionFilter, setFieldPermissionFilter] = useState<'all' | 'hidden' | 'editable' | 'required' | 'exportable'>('all');
  const [fieldPermissionPage, setFieldPermissionPage] = useState(1);
  const activePermissionRole = selectedPermissionRole || permissionRoles[0] || '未配置角色';
  const activePermissionRoleIndex = Math.max(permissionRoles.indexOf(activePermissionRole), 0);
  const activePermissionRoleKind = activePermissionRoleIndex === 0 ? 'system' : activePermissionRoleIndex < 4 ? 'manager' : 'operator';
  const activePermissionDraft = permissionDrafts[activePermissionRole] || permissionDraftsFromRows(formPermissionRows,identityRoleRecords,baseConfig.fields,permissionOrgUnitIds)[activePermissionRole] || makePermissionDesignDraft(activePermissionRoleKind, permissionOrgUnitIds);
  const getRoleFieldPermission = (field: DesignerField, index: number) => {
    const configured = activePermissionDraft.fields?.[field.key];
    return configured || {
      visible: true,
      editable: !field.locked && (activePermissionRoleKind === 'system' || index < 5),
      required: Boolean(field.required),
      exportable: activePermissionRoleKind !== 'operator' || index <= 4,
    };
  };
  const updateActivePermissionDraft = (updater: (draft: PermissionDesignDraft) => PermissionDesignDraft) => {
    setPermissionDrafts((current) => {
      const baseDraft = current[activePermissionRole] || activePermissionDraft;
      return { ...current, [activePermissionRole]: updater(baseDraft) };
    });
    setHasUnsavedChanges(true);
  };
  const updateRoleFieldPermission = (field: DesignerField, index: number, patch: Partial<ReturnType<typeof getRoleFieldPermission>>) => {
    const currentPermission = getRoleFieldPermission(field, index);
    updateActivePermissionDraft((draft) => ({
      ...draft,
      fields: {
        ...(draft.fields || {}),
        [field.key]: { ...currentPermission, ...patch },
      },
    }));
  };
  const getFieldDefaultValue = (field?: DesignerField) => {
    if (!field) return '';
    return fieldDefaultValueDrafts[field.key] ?? field.defaultValue ?? '';
  };
  const updateFieldDefaultValue = (field: DesignerField | undefined, value: string) => {
    if (!field) return;
    setFieldDefaultValueDrafts((current) => ({ ...current, [field.key]: value }));
    setHasUnsavedChanges(true);
  };
  const previewFlowNodes = useMemo(
    () => associatedPreviewNodes(professionalFlowConfig.nodes, hasAssociatedFlow),
    [professionalFlowConfig.nodes, hasAssociatedFlow],
  );
  const selectedPreviewFlowNode = useMemo(
    () => previewFlowNodes.find((node) => node.id === previewFlowNodeId) || previewFlowNodes[0],
    [previewFlowNodeId, previewFlowNodes],
  );
  const previewFlowNodeOptions = useMemo(
    () => previewFlowNodes.map((node) => ({
      value: node.id,
      label: `${node.label} · ${getFlowNodeAssigneeLabel(node)}`,
    })),
    [previewFlowNodes],
  );
  const [flowNodes, setFlowNodes] = useState<FlowNode[]>(() => makeFlowNodes(baseConfig.flowSteps));
  const [flowConnections, setFlowConnections] = useState<FlowConnection[]>(() => makeFlowConnections(makeFlowNodes(baseConfig.flowSteps)));
  const [pendingFlowPort, setPendingFlowPort] = useState<{ nodeId: string; side: FlowPortSide } | null>(null);
  const flowCanvasRef = useRef<HTMLDivElement | null>(null);
  const draggingFlowNodeRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    scaleX: number;
    scaleY: number;
  } | null>(null);
  const isAnalysisDesigner = baseConfig.kind === 'analysis';
  const designerTabs = isAnalysisDesigner ? analyticsTabs : tabs;
  const isNoLeftTab = (['permission', 'filter', 'style', 'flow', 'approval', 'dataset', 'dashboard'] as DesignerTab[]).includes(activeTab);

  useEffect(() => {
    const requestedTab = embedded ? initialTab || 'form' : (searchParams.get('tab') === 'approval' ? 'flow' : searchParams.get('tab')) as DesignerTab | null;
    if (!requestedTab) return;
    if (designerTabs.some((item) => item.key === requestedTab) && activeTab !== requestedTab) {
      setActiveTab(requestedTab);
      setSelectedControlId('');
    }
  }, [designerTabs, searchParams, embedded, initialTab]);

  useEffect(() => {
    if (!designerTabs.some((item) => item.key === activeTab)) {
      setActiveTab(designerTabs[0].key as DesignerTab);
      setSelectedControlId('');
    }
  }, [activeTab, designerTabs]);

  useEffect(() => {
    adminListUsers().then((response) => setIdentityUsers((response.data?.data || [])
      .filter((user: any) => user.is_active !== false)
      .map((user: any) => ({ id: Number(user.id), username: String(user.username), label: `${user.display_name || user.username} (${user.username})` }))))
      .catch(() => message.warning('用户列表加载失败，暂时无法选择绑定用户，请刷新重试'));
  }, []);

  useEffect(() => {
    Promise.all([adminListRoles(), adminListOrgUnits()])
      .then(([roleRes, orgRes]) => {
        const roleRecords = (roleRes.data?.data || []).map((role: any) => ({
          id: Number(role.id),
          name: String(role.name || ''),
          label: String(role.label || role.name || ''),
        })).filter((role: { id: number; label: string }) => Number.isFinite(role.id) && role.label);
        setIdentityRoleRecords(roleRecords);
        setIdentityRoles(roleRecords.map((role: { label: string }) => role.label));
        setIdentityOrgUnits((orgRes.data?.data || [])
          .map((org: any) => ({
            id: Number(org.id),
            name: String(org.name || ''),
            code: org.code ? String(org.code) : undefined,
            status: org.status ? String(org.status) : undefined,
          }))
          .filter((org: { id: number; name: string }) => Number.isFinite(org.id) && org.name));
      })
      .catch(() => {
        setIdentityRoles([]);
        setIdentityOrgUnits([]);
      });
  }, []);

  useEffect(() => {
    if (permissionRoles.length && !permissionRoles.includes(activePermissionRole)) {
      setSelectedPermissionRole(permissionRoles[0]);
    }
  }, [activePermissionRole, permissionRoles]);

  useEffect(() => {
    if (aiFormDraft && initializedAiDraft.current === aiFormDraft.id) return;
    initializedAiDraft.current = aiFormDraft?.id;
    setDraftReviewReady(false);
    const nextControls = baseConfig.fields.map(makeFieldControl);
    const requestedTab = embedded ? initialTab || 'form' : (searchParams.get('tab') === 'approval' ? 'flow' : searchParams.get('tab')) as DesignerTab | null;
    const nextTabs = baseConfig.kind === 'analysis' ? analyticsTabs : tabs;
    const nextDefaultTab = baseConfig.kind === 'analysis' ? 'dashboard' : 'form';
    const nextTab = requestedTab && nextTabs.some((item) => item.key === requestedTab) ? requestedTab : nextDefaultTab;
    setActiveTab(nextTab);
    setLayoutControls(nextControls);
    setSelectedControlId(nextControls[0]?.id || '');
    setSelectedAssetKey(baseConfig.fields[0]?.key || '');
    setViewConfig(makeDesignerViewConfig(baseConfig));
    setAnalyticsDesign(makeDefaultAnalyticsDesign(baseConfig));
    setSelectedAnalyticsWidgetId('');
    setExpandedViewRow('filter-0');
    setFilterFieldPickerOpen(false);
    setTableFieldPickerOpen(false);
    setDraggedViewFilterId('');
    setDraggedViewColumnId('');
    setVersion(baseConfig.version);
    setCopiedControl(null);
    setHistory([]);
    setFuture([]);
    setLibrarySearch('');
    setHasUnsavedChanges(Boolean(aiFormDraft));
    setPreviewOpen(false);
    setPublishCheckOpen(false);
    setVersionPanelOpen(false);
    setPreviewFlowNodeId('');
    setPreviewRole('');
    setHasAssociatedFlow(false);
    setDraggedControlId('');
    setDropHint(null);
    setCanvasDragActive(false);
    setFieldDefaultValueDrafts({});
    setRuleModal(null);
    setProfessionalFlowConfig(makeProfessionalFlowConfig(baseConfig));
    setPlatformForm((current) => {
      if (!current) return null;
      if (current.code === staticBaseConfig.id || String(current.id) === staticBaseConfig.id) return current;
      if (isPlatformFormRoute && String(current.id) === String(formId)) return current;
      return null;
    });
    setFormPermissionRows([]);
    setWorkflowMeta({});
    setPermissionDrafts({});
    const nextFlowNodes = makeFlowNodes(baseConfig.flowSteps);
    setFlowNodes(nextFlowNodes);
    setFlowConnections(makeFlowConnections(nextFlowNodes));
    setPendingFlowPort(null);
  }, [baseConfig.id, baseConfig.kind, baseConfig.version, baseConfig.fields, baseConfig.flowSteps, formId, isPlatformFormRoute, searchParams, staticBaseConfig.id, embedded, initialTab]);

  useEffect(() => {
    if (!previewFlowNodeOptions.length) {
      if (previewFlowNodeId) setPreviewFlowNodeId('');
      return;
    }
    if (!previewFlowNodeOptions.some((item) => item.value === previewFlowNodeId)) {
      setPreviewFlowNodeId(previewFlowNodeOptions[0].value);
    }
  }, [previewFlowNodeId, previewFlowNodeOptions]);

  useEffect(() => {
    let cancelled = false;
    const loadPersistedFlow = async () => {
      // A new form stays entirely in this existing editor until the user saves.
      if (aiFormDraft) { setResolvingPlatformConfig(false); return; }
      setResolvingPlatformConfig(true);
      setFlowLoadError('');
      try {
        const formDetail = await resolvePlatformFormForConfig(staticBaseConfig.id);
        if (!formDetail || cancelled) return;
        if (cancelled) return;
        const databaseFields = platformFieldsToDesignerFields(formDetail.fields);
        setDatabaseFieldsByForm((current) => {
          if (areDesignerFieldsSame(current[staticBaseConfig.id], databaseFields)) return current;
          return { ...current, [staticBaseConfig.id]: databaseFields };
        });
        setDatabaseMetaByForm((current) => ({
          ...current,
          [staticBaseConfig.id]: {
            name: formDetail.name || baseConfig.name,
            code: formDetail.code || baseConfig.id,
            dataSource: formDetail.table_name || baseConfig.dataSource,
            description: formDetail.description || baseConfig.description,
            kind: inferFormDesignerKind(formDetail),
          },
        }));
        setPlatformForm(formDetail);
        const savedCanvas=formDetail.config?.canvasSettings as {columns?:number;gap?:number}|undefined;
        setCanvasSettings({columns:[1,2,3].includes(Number(savedCanvas?.columns))?Number(savedCanvas?.columns):2,gap:[8,12,16].includes(Number(savedCanvas?.gap))?Number(savedCanvas?.gap):12});
        const savedControls = formDetail.config?.formDesignerControls as LayoutControl[] | undefined;
        if (Array.isArray(savedControls)) {
          const knownFields = new Set(databaseFields.map((field) => field.key));
          const restoredControls = normalizeLayout(savedControls.filter((control) => control && typeof control.id === 'string'
            && typeof control.controlType === 'string' && ['field', 'component'].includes(control.source)
            && (control.source !== 'field' || knownFields.has(String(control.fieldKey))))
            .map((control) => ({ ...control, computed: control.computed === undefined ? databaseFields.find(field => field.key === control.fieldKey)?.calculationRule : control.computed, rules: normalizeControlRules(control.rules) })));
          setLayoutControls(restoredControls);
          setSelectedControlId(restoredControls[0]?.id || '');
        } else {
          setLayoutControls(databaseFields.map(makeFieldControl));
          setSelectedControlId('');
        }
        const storedAnalyticsDesign = getStoredAnalyticsDesign(formDetail, {
          ...baseConfig,
          kind: inferFormDesignerKind(formDetail),
        });
        setAnalyticsDesign(storedAnalyticsDesign);
        setSelectedAnalyticsWidgetId(storedAnalyticsDesign.widgets[0]?.id || '');
        setPermissionDrafts(permissionDraftsFromConfig({...formDetail.config,permissionDesign:formDetail.config?.permissionDesignDraft||formDetail.config?.permissionDesign}));
        try {
          const permissionsResponse = await listPlatformFormPermissions(formDetail.id);
          if (!cancelled) {
            setFormPermissionRows((permissionsResponse.data?.data || []) as FormPermissionRow[]);
          }
        } catch (error) {
          console.warn('form permissions load failed', error);
          if (!cancelled) setFormPermissionRows([]);
        }
        const viewSourceFields = databaseFields;
        let persistedViewConfig = getStoredViewConfig(formDetail, baseConfig);
        if (!persistedViewConfig && restoredDesignFormId.current !== formDetail.id) {
          try {
            const layoutsResponse = await listPlatformFormLayouts(formDetail.id);
            const layouts = (layoutsResponse.data?.data || []) as Array<{ layout_type?: string; config?: Record<string, unknown> }>;
            const viewLayout = layouts.find((layout) => layout.layout_type === 'view');
            const layoutConfig = viewLayout?.config || {};
            const layoutView = layoutConfig.draft || layoutConfig.published;
            if (layoutView) {
              persistedViewConfig = normalizeViewConfig(
                layoutView,
                designerFieldsToViewFields(viewSourceFields),
                baseConfig.filters.map((filter) => filter.key),
              );
            }
          } catch (error) {
            console.warn('view layout load failed', error);
          }
        }
        if (!cancelled) {
          setViewConfig(persistedViewConfig || makeDesignerViewConfig(baseConfig));
        }
        const meta = getWorkflowDesignerMeta(formDetail);
        setWorkflowMeta(meta);
        let workflowId = meta.draftWorkflowId || meta.publishedWorkflowId;
        let boundTrigger: WorkflowBindingPayload | undefined;
        if (!workflowId) {
          const bindingsResponse = await listWorkflowBindings(formDetail.id);
          const bindings = (bindingsResponse.data?.data || []) as WorkflowBindingPayload[];
          boundTrigger = bindings.find((binding) => binding.enabled && ['submit', 'manual_submit'].includes(binding.trigger_action));
          workflowId = boundTrigger?.workflow_id;
        }
        if (!workflowId) {
          setProfessionalFlowConfig(makeProfessionalFlowConfig(baseConfig));
          setHasUnsavedChanges(false);
          return;
        }
        const definitionResponse = await wfGetDefinition(workflowId);
        if (cancelled) return;
        const definition = definitionResponse.data as WorkflowDefinitionPayload;
        if (definition.config && (definition.config.nodes || definition.config.steps)) {
          const defaultFlow = makeProfessionalFlowConfig(baseConfig);
          const nextConfig = normalizeProfessionalFlowConfig({
            ...definition.config,
            version: definition.version ? `v${definition.version}` : String(definition.config.version || defaultFlow.version),
          }, defaultFlow);
          if (boundTrigger) {
            nextConfig.triggerBindings = nextConfig.triggerBindings.map((binding) => binding.action === 'submit'
              ? { ...binding, action: boundTrigger!.trigger_action, enabled: true } : binding);
          }
          setProfessionalFlowConfig(nextConfig);
          setHasAssociatedFlow(true);
          setVersion(nextConfig.version);
          setHasUnsavedChanges(false);
        }
      } catch (error) {
        console.warn('workflow designer load failed', error);
        if (!cancelled) {
          setFlowLoadError('已有流程加载失败，请刷新重试；为避免覆盖原流程，暂时禁止保存和发布。');
          message.error('已有流程加载失败，请刷新后重试');
        }
      } finally {
        if (!cancelled) setResolvingPlatformConfig(false);
      }
    };
    loadPersistedFlow();
    return () => {
      cancelled = true;
    };
  }, [baseConfig.id, baseConfig.name, baseConfig.version, baseConfig.fields, baseConfig.flowSteps, staticBaseConfig.id, designerReloadKey]);

  const selectedControl = useMemo(
    () => layoutControls.find((control) => control.id === selectedControlId),
    [layoutControls, selectedControlId],
  );
  const canvasFieldKeySet = useMemo(
    () => new Set(layoutControls.map((control) => control.fieldKey).filter(Boolean)),
    [layoutControls],
  );
  const selectedField = useMemo(
    () => {
      const targetKey = selectedControl?.fieldKey || selectedAssetKey;
      if (activeTab === 'filter') {
        return baseConfig.filters.find((field) => field.key === targetKey) || baseConfig.fields.find((field) => field.key === targetKey);
      }
      return baseConfig.fields.find((field) => field.key === targetKey);
    },
    [activeTab, baseConfig.fields, baseConfig.filters, selectedAssetKey, selectedControl],
  );
  const selectedEffectiveControlType = getEffectiveControlTypeForControl(selectedControl, selectedField);
  const selectedControlUsesDataSource = Boolean(
    selectedControl && isDataSourceControlType(selectedEffectiveControlType),
  );
  const selectedReferenceSourceKind = selectedControl?.dataSourceKind || inferReferenceSourceKind(selectedField, selectedEffectiveControlType);
  const selectedReferenceConfig = getReferenceConfig(selectedReferenceSourceKind);
  const selectedControlUsesEncoding = Boolean(
    selectedControl && (selectedEffectiveControlType === 'code' || isEncodingField(selectedField)),
  );
  const [optionCatalog,setOptionCatalog]=useState<{dictionaries:Array<{code:string;name:string}>;externalApis:Array<{id:number;name:string}>}>({dictionaries:[],externalApis:[]});
  const [testingOptionSource,setTestingOptionSource]=useState(false);
  useEffect(()=>{getFormOptionSources().then(response=>setOptionCatalog(response.data.data)).catch(()=>message.error('字典与 API 数据源列表加载失败，请刷新重试'));},[]);
  const [referenceForms,setReferenceForms]=useState<PlatformForm[]>([]);
  const [referenceLabelOptions,setReferenceLabelOptions]=useState<Array<{value:string;label:string}>>([]);
  useEffect(()=>{listPlatformForms().then(res=>setReferenceForms(res.data?.data||[])).catch(()=>{});},[]);
  useEffect(() => {
    let cancelled = false;
    const sources = Array.from(new Set(analyticsDesign.datasets.map(dataset => dataset.source)));
    void Promise.all(sources.map(async source => {
      if (analyticsSourceFields[source]) return;
      const form = referenceForms.find(item => item.code === source || String(item.id) === source);
      if (!form) return;
      try { const response = await getPlatformForm(form.id); if (!cancelled) setAnalyticsSourceFields(current => ({...current, [source]: response.data.data.fields || []})); }
      catch { /* The runtime and publish check surface unavailable sources. */ }
    }));
    return () => { cancelled = true; };
  }, [analyticsDesign.datasets.map(dataset => dataset.source).join('|'), referenceForms]);

  useEffect(()=>{
    let cancelled=false;
    setReferenceLabelOptions(selectedReferenceConfig.labelFields);
    if(selectedReferenceSourceKind==='businessForm'&&selectedControl?.optionSource){
      getPlatformFormByCode(selectedControl.optionSource,{schema:'published',scope:'designer'}).then(res=>{
        if(!cancelled){const options=(res.data?.data?.fields||[]).filter((field:PlatformFormField)=>!field.archived).map((field:PlatformFormField)=>({value:field.field_name,label:field.label}));setReferenceLabelOptions(options);if(options.length&&!selectedControl.referenceLabelField)updateSelectedControl({referenceLabelField:options[0].value});}
      }).catch(()=>{if(!cancelled)setReferenceLabelOptions([]);});
    }
    return()=>{cancelled=true;};
  },[selectedReferenceSourceKind,selectedControl?.optionSource]);

  const assignmentSourceAttributeOptions = useMemo(() => {
    const options: Array<{ value: string; label: string }> = [
      { value: 'self.value', label: '本字段值' },
    ];
    const businessType = getFieldBusinessType(selectedField);
    const canReadOptionParts = selectedControlUsesDataSource || businessType === 'enum';
    if (canReadOptionParts) {
      options.push(
        { value: 'self.option_value', label: '选项值' },
        { value: 'self.option_label', label: '选项文本' },
      );
    }
    if (selectedControlUsesDataSource && selectedReferenceSourceKind !== 'static') {
      [{value:'id',label:'记录 ID'}, ...referenceLabelOptions].forEach((field) => {
        const value = `record.${field.value}`;
        if (!options.some((item) => item.value === value)) {
          options.push({ value, label: `关联记录.${field.label}` });
        }
      });
    }
    return options;
  }, [selectedControlUsesDataSource, selectedField, selectedReferenceConfig, selectedReferenceSourceKind, referenceLabelOptions]);
  const assignmentTargetFieldOptions = useMemo(() => (
    baseConfig.fields
      .filter((field) => field.key !== selectedField?.key)
      .map((field) => ({ value: field.key, label: field.name }))
  ), [baseConfig.fields, selectedField]);
  const selectedEncodingRule = selectedControlUsesEncoding
    ? selectedControl?.encodingRule || makeEncodingRule(selectedField)
    : undefined;
  const selectedEncodingSegments = useMemo(
    () => getEncodingSegments(encodingSettingsDraft || selectedEncodingRule),
    [selectedEncodingRule, encodingSettingsDraft],
  );
  const normalizedLibrarySearch = librarySearch.trim().toLowerCase();
  const matchesLibrarySearch = (text: string) => !normalizedLibrarySearch || text.toLowerCase().includes(normalizedLibrarySearch);
  const filteredCommonControls = commonControls.filter((item) => matchesLibrarySearch(`${item.name} ${item.desc} ${item.category}`));
  const filteredComponentGroups = componentGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => matchesLibrarySearch(`${group.category} ${item.name} ${item.desc}`)),
    }))
    .filter((group) => !normalizedLibrarySearch || group.items.length > 0 || matchesLibrarySearch(group.category));
  const filteredFields = baseConfig.fields.filter((field) => matchesLibrarySearch(`${field.name} ${field.key} ${field.type} ${field.optionSource || ''}`));
  const libraryFields = activeTab === 'filter' ? baseConfig.filters : baseConfig.fields;
  const filteredLibraryFields = libraryFields.filter((field) => matchesLibrarySearch(`${field.name} ${field.key} ${field.type} ${field.optionSource || ''}`));
  const fallbackBusinessSections = baseConfig.id === 'alert-center' ? alertBusinessSections : [
    { key: 'default', title: '基础信息', desc: '当前表单的主要录入字段', fieldKeys: baseConfig.fields.map((field) => field.key) },
  ];
  const alertSections = normalizeBusinessSections(designerMeta.businessSections, fallbackBusinessSections);
  const searchableFieldCount = baseConfig.fields.filter((field) => field.searchable).length;
  const requiredControlsInCanvas = layoutControls.filter((control) => control.rules.required.enabled).length;
  const hiddenRequiredControls = layoutControls.filter((control) => !control.rules.visible.enabled && control.rules.required.enabled);
  const publishChecks = useMemo<PublishCheckItem[]>(() => {
    if (isAnalysisDesigner) {
      const widgetsWithoutMetric = analyticsDesign.widgets.filter((widget) => !widget.metricIds.length);
      const invalidWidgetDatasets = analyticsDesign.widgets.filter((widget) => !analyticsDesign.datasets.some((dataset) => dataset.id === widget.datasetId));
      const interactiveWidgets = analyticsDesign.widgets.filter((widget) => widget.interaction !== 'none');
      const hasDetailTarget = analyticsDesign.widgets.some((widget) => widget.type === 'detail-table' || widget.type === 'rank-table');
      return [
        {
          level: analyticsDesign.datasets.length ? 'suggestion' : 'error',
          title: '数据集绑定',
          detail: analyticsDesign.datasets.length ? `已配置 ${analyticsDesign.datasets.length} 个数据集，主数据源为 ${analyticsDesign.datasets[0]?.source || '-'}` : 'BI 看板至少需要一个数据集。',
        },
        {
          level: analyticsDesign.metrics.length ? 'suggestion' : 'error',
          title: '指标定义',
          detail: analyticsDesign.metrics.length ? `已配置 ${analyticsDesign.metrics.length} 个指标，可用于指标卡、趋势图和排行。` : '请至少定义一个可计算指标。',
        },
        {
          level: widgetsWithoutMetric.length ? 'error' : 'suggestion',
          title: '图表指标绑定',
          detail: widgetsWithoutMetric.length ? `以下组件缺少指标：${widgetsWithoutMetric.map((widget) => widget.title).join('、')}` : '所有图表组件均已绑定指标。',
        },
        {
          level: invalidWidgetDatasets.length ? 'error' : 'suggestion',
          title: '图表数据集绑定',
          detail: invalidWidgetDatasets.length ? `以下组件绑定的数据集不存在：${invalidWidgetDatasets.map((widget) => widget.title).join('、')}` : '所有图表组件均绑定有效数据集。',
        },
        {
          level: analyticsDesign.globalFilters.length ? 'suggestion' : 'warning',
          title: '全局筛选器',
          detail: analyticsDesign.globalFilters.length ? `已配置 ${analyticsDesign.globalFilters.length} 个全局筛选器。` : '建议配置时间、组织或状态等全局筛选器。',
        },
        {
          level: interactiveWidgets.length && !hasDetailTarget ? 'warning' : 'suggestion',
          title: '联动与下钻',
          detail: interactiveWidgets.length
            ? `已配置 ${interactiveWidgets.length} 个可交互组件${hasDetailTarget ? '，并具备明细承接组件。' : '，建议增加明细表或排行表作为承接。'}`
            : '当前看板为纯展示模式，可按需增加点击筛选、下钻或跳转动作。',
        },
      ];
    }
    const canvasFieldKeys = new Set(layoutControls.map((control) => control.fieldKey).filter(Boolean));
    const missingRequired = baseConfig.fields.filter((field) => field.required && !canvasFieldKeys.has(field.key));
    const enumWithoutSource = baseConfig.fields.filter((field) => field.type.includes('下拉') && !field.optionSource);
    const relationWithoutSource = baseConfig.fields.filter((field) => field.type.includes('关联') && !field.optionSource);
    const viewTabs = getViewTabs(storedViewConfig);
    const enabledFilters = viewTabs.flatMap((tab) => tab.filters.filter((filter) => filter.enabled));
    const enabledColumns = viewTabs.flatMap((tab) => tab.table.columns.filter((column) => column.enabled));
    const emptyTabs = viewTabs.filter((tab) => !tab.table.columns.some((column) => column.enabled));
    const unboundTabs = viewTabs.filter((tab) => tab.audience.mode === 'restricted' && !tab.audience.roleIds.length && !tab.audience.userIds.length && !tab.audience.orgIds.length);
    const flowValidation = validateFlowDesignerConfig(professionalFlowConfig);
    const flowErrors = flowValidation.filter((item) => item.level === 'error');
    const flowWarnings = flowValidation.filter((item) => item.level === 'warning');
    const invalidViewFields = [
      ...enabledFilters.filter((filter) => !baseConfig.fields.some((field) => field.key === filter.fieldName)).map((filter) => filter.label),
      ...enabledColumns.filter((column) => !baseConfig.fields.some((field) => field.key === column.fieldName)).map((column) => column.label),
    ];
    const duplicates=duplicateFieldBindings(layoutControls);
    const unbound=layoutControls.filter(c=>!c.fieldKey&&!isLayoutControl(c));
    const defaultErrors = defaultRuleErrors(layoutControls, baseConfig.fields);
    const checks: PublishCheckItem[] = [
      { level: baseConfig.fields.length > DEFAULT_FORM_LIMITS.fields ? 'error' : 'suggestion', title: '表单容量规则', detail: `当前 ${baseConfig.fields.length} 个字段，系统上限 ${DEFAULT_FORM_LIMITS.fields} 个；单条记录最多 2 MiB` },
      { level: defaultErrors.length ? 'error' : 'suggestion', title: '默认值规则', detail: defaultErrors.length ? defaultErrors.join('；') : '默认值字段引用与依赖关系有效' },
      {level:duplicates.length?'error':'suggestion',title:'字段绑定唯一性',detail:duplicates.length?`请重新绑定复制控件：${duplicates.join('、')}`:'每个字段仅绑定一个控件'},
      {level:unbound.length?'error':'suggestion',title:'控件数据绑定',detail:unbound.length?`请绑定字段或移除控件：${unbound.map(c=>c.name).join('、')}`:'所有输入控件都已绑定字段'},
      {
        level: missingRequired.length ? 'error' : 'suggestion',
        title: '必填字段覆盖',
        detail: missingRequired.length ? `以下必填字段不在表单中：${missingRequired.map((field) => field.name).join('、')}` : '所有必填字段都已放入表单画布。',
      },
      {
        level: enumWithoutSource.length ? 'error' : 'suggestion',
        title: '枚举选项完整性',
        detail: enumWithoutSource.length ? `以下枚举字段缺少选项：${enumWithoutSource.map((field) => field.name).join('、')}` : '枚举字段均已配置选项来源。',
      },
      {
        level: relationWithoutSource.length ? 'warning' : 'suggestion',
        title: '关联数据源',
        detail: relationWithoutSource.length ? `以下关联字段需要补充数据源：${relationWithoutSource.map((field) => field.name).join('、')}` : '关联字段均有数据来源。',
      },
      {
        level: searchableFieldCount ? 'suggestion' : 'warning',
        title: '搜索体验',
        detail: searchableFieldCount ? `已配置 ${searchableFieldCount} 个可搜索字段。` : '建议至少配置一个可搜索字段。',
      },
      {
        level: hiddenRequiredControls.length ? 'error' : 'suggestion',
        title: '规则冲突',
        detail: hiddenRequiredControls.length ? `以下控件同时隐藏且必填：${hiddenRequiredControls.map((control) => control.name).join('、')}` : '未发现隐藏且必填的规则冲突。',
      },
      {
        level: enabledFilters.length ? 'suggestion' : 'warning',
        title: '筛选条件',
        detail: enabledFilters.length ? `已启用 ${enabledFilters.length} 个运行页筛选条件。` : '建议至少启用一个运行页筛选条件。',
      },
      {
        level: emptyTabs.length ? 'error' : 'suggestion',
        title: '数据展示列',
        detail: emptyTabs.length ? `以下 Tab 至少需要一个展示列：${emptyTabs.map((tab) => tab.name).join('、')}` : `所有 ${viewTabs.length} 个 Tab 均已配置展示列。`,
      },
      {
        level: unboundTabs.length ? 'error' : 'suggestion',
        title: 'Tab 可见范围',
        detail: unboundTabs.length ? `以下 Tab 尚未绑定角色、用户或组织：${unboundTabs.map((tab) => tab.name).join('、')}` : '所有 Tab 均已配置可见范围。',
      },
      {
        level: invalidViewFields.length ? 'error' : 'suggestion',
        title: '视图字段绑定',
        detail: invalidViewFields.length ? `以下筛选或列绑定字段不存在：${invalidViewFields.join('、')}` : '筛选条件和表格列均已绑定有效字段。',
      },
      ...(baseConfig.id === 'alert-center' ? [{
        level: 'suggestion' as const,
        title: '严重告警处理规则',
        detail: '建议确认严重告警已配置附件证据和处理时限必填规则。',
      }] : []),
    ];
    checks.push({
      level: flowErrors.length ? 'error' : flowWarnings.length ? 'warning' : 'suggestion',
      title: '流程设计完整性',
      detail: flowErrors.length
        ? `流程存在 ${flowErrors.length} 个阻断项：${flowErrors.map((item) => item.title).join('、')}`
        : flowWarnings.length
          ? `流程存在 ${flowWarnings.length} 个警告项：${flowWarnings.map((item) => item.title).join('、')}`
          : '流程结构、节点规则和触发绑定已通过核心发布校验。',
    });
    return checks;
  }, [analyticsDesign, baseConfig.fields, baseConfig.id, hiddenRequiredControls, isAnalysisDesigner, layoutControls, professionalFlowConfig, searchableFieldCount, viewConfig]);
  const serverPublishChecks = useMemo<PublishCheckItem[]>(() => {
    if (!serverPublishReport) return [];
    const items = serverPublishReport.items.map((item) => ({
      level: item.level === 'blocking' ? 'error' : item.level === 'warning' ? 'warning' : 'suggestion',
      title: item.label ? `${item.label} / ${item.type}` : item.type,
      detail: `${item.detail}${item.affected_count ? `（影响 ${item.affected_count} 条记录）` : ''}`,
    } as PublishCheckItem));
    if (!items.length) {
      items.push({
        level: 'suggestion',
        title: '业务数据影响检查',
        detail: `已检查 ${serverPublishReport.record_count} 条现有记录，未发现阻断发布的结构变更。`,
      });
    }
    return items;
  }, [serverPublishReport]);
  const combinedPublishChecks = useMemo(
    () => [...publishChecks, ...serverPublishChecks],
    [publishChecks, serverPublishChecks],
  );
  const publishErrorCount = combinedPublishChecks.filter((item) => item.level === 'error').length;
  const publishWarningCount = combinedPublishChecks.filter((item) => item.level === 'warning').length;
  const localErrorCount = publishChecks.filter((item) => item.level === 'error').length;
  const localWarningCount = publishChecks.filter((item) => item.level === 'warning').length;
  const recommendedRules = getRecommendedRules(baseConfig.fields);
  const publishedVersion = platformForm?.config?.publishedSchemaVersion || viewConfigMeta.publishedVersion;
  const draftStatusLabel = hasUnsavedChanges ? '草稿有未保存修改' : viewConfigMeta.status === 'published' ? '草稿无修改' : '草稿已保存 · 待发布';

  const updateSelectedControlRule = (ruleKey: ControlRuleKey, patch: Partial<ControlRule>) => {
    if (!selectedControl) return;
    const normalizedRules = normalizeControlRules(selectedControl.rules, selectedField);
    const currentRule = normalizedRules[ruleKey];
    updateSelectedControl({
      rules: {
        ...normalizedRules,
        [ruleKey]: {
          ...currentRule,
          ...patch,
          conditions: patch.conditions === undefined ? currentRule.conditions : patch.conditions,
        },
      },
    });
  };

  const updateSelectedRuleCondition = (ruleKey: ControlRuleKey, patch: Partial<ControlRuleCondition>) => {
    if (!selectedControl) return;
    updateSelectedControlRule(ruleKey, {
      conditions: {
        ...(normalizeControlRules(selectedControl.rules, selectedField)[ruleKey].conditions || {}),
        ...patch,
      },
    });
  };

  const getRuleConditionGroups = (rule: ControlRule): ControlRuleCondition[][] => {
    if (Array.isArray(rule.conditionGroups) && rule.conditionGroups.length) {
      return rule.conditionGroups.map((group) => (Array.isArray(group) && group.length ? group : [{}]));
    }
    return rule.conditions?.sourceField ? [[{sourceField:rule.conditions.sourceField,operator:rule.conditions.operator,value:rule.conditions.value}]] : [];
  };

  const getRuleGroupTitle = (rule: ControlRule, groupIndex: number) => {
    const title = rule.conditionGroupTitles?.[groupIndex]?.trim();
    return title || `条件组 ${groupIndex + 1}`;
  };

  const updateSelectedRuleConditionGroups = (
    ruleKey: ControlRuleKey,
    groups: ControlRuleCondition[][],
    titles = activeRule?.conditionGroupTitles || [],
  ) => {
    const normalizedGroups = groups
      .map((group) => group.filter(Boolean))
      .filter((group) => group.length);
    updateSelectedControlRule(ruleKey, {
      conditionGroups: normalizedGroups,
      conditionGroupTitles: titles.slice(0, normalizedGroups.length),
      conditions: { ...normalizeControlRules(selectedControl?.rules,selectedField)[ruleKey].conditions, sourceField:undefined,operator:undefined,value:undefined,...normalizedGroups[0]?.[0] },
    });
  };

  const addSelectedRuleConditionGroup = (ruleKey: ControlRuleKey) => {
    if (!activeRule) return;
    updateSelectedRuleConditionGroups(ruleKey, [...getRuleConditionGroups(activeRule), [{}]], activeRule.conditionGroupTitles || []);
  };

  const addSelectedRuleConditionRow = (ruleKey: ControlRuleKey, groupIndex: number) => {
    if (!activeRule) return;
    const groups = getRuleConditionGroups(activeRule);
    groups[groupIndex] = [...(groups[groupIndex] || []), {}];
    updateSelectedRuleConditionGroups(ruleKey, groups);
  };

  const updateSelectedRuleConditionRow = (
    ruleKey: ControlRuleKey,
    groupIndex: number,
    rowIndex: number,
    patch: Partial<ControlRuleCondition>,
  ) => {
    if (!activeRule) return;
    const groups = getRuleConditionGroups(activeRule);
    const group = groups[groupIndex] || [{}];
    group[rowIndex] = { ...(group[rowIndex] || {}), ...patch };
    groups[groupIndex] = group;
    updateSelectedRuleConditionGroups(ruleKey, groups);
  };

  const removeSelectedRuleConditionRow = (ruleKey: ControlRuleKey, groupIndex: number, rowIndex: number) => {
    if (!activeRule) return;
    const groups = getRuleConditionGroups(activeRule);
    const titles = [...(activeRule.conditionGroupTitles || [])];
    const group = (groups[groupIndex] || []).filter((_condition, index) => index !== rowIndex);
    if (group.length) {
      groups[groupIndex] = group;
    } else {
      groups.splice(groupIndex, 1);
      titles.splice(groupIndex, 1);
    }
    updateSelectedRuleConditionGroups(ruleKey, groups, titles);
  };

  const removeSelectedRuleConditionGroup = (ruleKey: ControlRuleKey, groupIndex: number) => {
    if (!activeRule) return;
    const groups = getRuleConditionGroups(activeRule).filter((_group, index) => index !== groupIndex);
    const titles = (activeRule.conditionGroupTitles || []).filter((_title, index) => index !== groupIndex);
    updateSelectedRuleConditionGroups(ruleKey, groups, titles);
  };

  const updateSelectedRuleGroupTitle = (ruleKey: ControlRuleKey, groupIndex: number, title: string) => {
    if (!activeRule) return;
    const titles = [...(activeRule.conditionGroupTitles || [])];
    titles[groupIndex] = title.trim();
    updateSelectedControlRule(ruleKey, { conditionGroupTitles: titles });
  };

  const controlRuleToggle = (ruleKey: ControlRuleKey) => {
    if (!selectedControl) return null;
    const rule = normalizeControlRules(selectedControl.rules, selectedField)[ruleKey];
    const title = ruleLabels[ruleKey];
    return (
      <RuleToggleControl
        enabled={rule.enabled}
        onConfig={() => {ruleOpeningValue.current={id:selectedControl.id,key:ruleKey,value:structuredClone(rule)};setRuleModal({ controlId: selectedControl.id, ruleKey });}}
        onToggle={() => updateSelectedControlRule(ruleKey, { enabled: !rule.enabled })}
        title={title}
      />
    );
  };

  const renderTypeSpecificProperties = () => {
    if (!selectedControl) return null;
    const typeSettings = {
      ...getDefaultTypeSettings(selectedEffectiveControlType, selectedField),
      ...(selectedControl.typeSettings || {}),
    };
    if (selectedEffectiveControlType === 'text' || selectedEffectiveControlType === 'textarea') {
      return (
        <section className="designer-prop-section">
          <strong className="designer-prop-section-title">文本设置</strong>
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
        </section>
      );
    }
    if (selectedEffectiveControlType === 'number') {
      return (
        <section className="designer-prop-section">
          <strong className="designer-prop-section-title">数值设置</strong>
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
        </section>
      );
    }
    if (selectedEffectiveControlType === 'select' || selectedEffectiveControlType === 'relation') {
      return (
        <section className="designer-prop-section">
          {renderPropertyHeading('选择设置', '设置如何选择和展示选项；候选内容在数据来源中配置。问号可查看每项设置的效果与适用范围。')}
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
        </section>
      );
    }
    if (selectedEffectiveControlType === 'datetime') {
      return (
        <section className="designer-prop-section">
          <strong className="designer-prop-section-title">日期设置</strong>
          <label><span>日期类型</span><Select value={typeSettings.dateMode || 'datetime'} options={dateModeOptions} onChange={(dateMode) => updateSelectedTypeSettings({ dateMode })} /></label>
          <label><span>默认值</span><Select value={typeSettings.defaultDate || 'none'} options={defaultDateOptions} onChange={(defaultDate) => updateSelectedTypeSettings({ defaultDate })} /></label>
          <label><span>禁选过去</span><Switch size="small" checked={Boolean(typeSettings.disablePast)} onChange={(disablePast) => updateSelectedTypeSettings({ disablePast })} /></label>
        </section>
      );
    }
    if (selectedEffectiveControlType === 'upload') {
      return (
        <section className="designer-prop-section">
          <strong className="designer-prop-section-title">上传设置</strong>
          <label><span>文件数量</span><InputNumber min={1} max={20} value={typeSettings.maxFiles || 5} onChange={(maxFiles) => updateSelectedTypeSettings({ maxFiles: Number(maxFiles || 1) })} /></label>
          <label><span>单个大小</span><InputNumber min={1} max={200} addonAfter="MB" value={typeSettings.maxFileSize || 20} onChange={(maxFileSize) => updateSelectedTypeSettings({ maxFileSize: Number(maxFileSize || 1) })} /></label>
          <label><span>文件类型</span><Input allowClear value={typeSettings.fileTypes || ''} onChange={(event) => updateSelectedTypeSettings({ fileTypes: event.target.value })} /></label>
        </section>
      );
    }
    if (selectedEffectiveControlType === 'switch') {
      return (
        <section className="designer-prop-section">
          <strong className="designer-prop-section-title">布尔设置</strong>
          <label><span>默认状态</span><Switch size="small" checked={Boolean(typeSettings.defaultChecked)} onChange={(defaultChecked) => updateSelectedTypeSettings({ defaultChecked })} /></label>
          <label><span>开启文案</span><Input value={typeSettings.checkedText || '是'} onChange={(event) => updateSelectedTypeSettings({ checkedText: event.target.value })} /></label>
          <label><span>关闭文案</span><Input value={typeSettings.uncheckedText || '否'} onChange={(event) => updateSelectedTypeSettings({ uncheckedText: event.target.value })} /></label>
        </section>
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
      <PropertyGroup title={embedded ? '基本信息' : '控件身份'} className="designer-prop-section designer-prop-section-identity" titleClassName="designer-prop-section-title">
        <PropertyRow label={embedded ? '显示名称' : '控件名称'} className="designer-prop-row-key">
          <Input
            aria-label="显示名称"
            value={selectedControl.name}
            onChange={(event) => updateSelectedControl({ name: event.target.value })}
          />
        </PropertyRow>
        <label>
          <span>{embedded && !isLayoutControl(selectedControl) ? '填写方式' : '控件类型'}</span>
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
        {embedded && !isLayoutControl(selectedControl) && !selectedControl.fieldKey && <Alert type="warning" showIcon message="请先绑定存储字段" description="在下方高级设置中选择字段后，填写内容才能保存。" />}
      </PropertyGroup>
    );
  };

  const referenceObjectOptions=selectedReferenceSourceKind==='dictionary'?optionCatalog.dictionaries.map(item=>({value:item.code,label:item.name})):selectedReferenceSourceKind==='externalApi'?optionCatalog.externalApis.map(item=>({value:String(item.id),label:item.name})):selectedReferenceSourceKind==='businessForm'?referenceForms.filter(form=>form.id!==platformForm?.id).map(form=>({value:form.code,label:form.name})):selectedReferenceConfig.objects;
  const renderDataSourceProperties = () => {
    if (!selectedControl || !selectedControlUsesDataSource) return null;
    return (
      <section className="designer-prop-section">
        <strong className="designer-prop-section-title">数据来源</strong>
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
        {selectedReferenceSourceKind==='externalApi'&&<><label><span>选项数组路径</span><Input aria-label="API 数组路径" placeholder="data.items；根数组留空" value={selectedControl.referenceItemsPath??'data'} onChange={event=>updateSelectedControl({referenceItemsPath:event.target.value})}/></label><small>只读 GET；接口 URL、认证头及内网访问许可在数据连接中维护，表单只保存数据源 ID 和映射。最多 1000 项。</small></>}
        {selectedReferenceSourceKind!=='static'&&<Button loading={testingOptionSource} disabled={!platformForm||!selectedControl.optionSource} onClick={async()=>{if(!platformForm||!selectedControl.fieldKey)return;setTestingOptionSource(true);try{const response=await previewFormReferenceOptions(platformForm.id,selectedControl.fieldKey,layoutControls,{});const options=response.data.data||[];Modal.info({className:'form-designer-dialog',title:`真实选项预览（${options.length} 项）`,content:<div style={{maxHeight:300,overflow:'auto'}}>{options.slice(0,20).map((option:any)=><div key={String(option.id)}>{option.label} · {String(option.id)}</div>)}{!options.length&&'当前来源没有启用的选项'}</div>});}catch(error:any){message.error(error?.response?.data?.detail||'选项读取失败');}finally{setTestingOptionSource(false);}}}>读取真实选项</Button>}
      </section>
    );
  };

  const renderEncodingProperties = () => {
    if (!selectedControlUsesEncoding || !selectedEncodingRule) return null;
    return (
      <section className="designer-prop-section designer-prop-section-primary">
        <strong className="designer-prop-section-title">
          <span>编码规则</span>
          <Button className="encoding-heading-add" aria-label="新增编码规则" title="新增编码规则"
            icon={<PlusOutlined />} onClick={() => { encodingRuleTargetRef.current = { controlId: selectedControlId, rule: selectedEncodingRule }; setEncodingSettingsDraft({ ...makeEncodingRule(selectedField),
              id: `rule-${createUuid()}`, name: `编码规则 ${getEncodingRules(selectedEncodingRule).length + 1}`, conditions: [] }); }} size="small" type="text" />
        </strong>
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
      </section>
    );
  };

  const renderPropertyHeading = (title: string, help: string) => <strong className="designer-prop-section-title"><span>{title}</span><Tooltip title={help}><button className="designer-property-help" type="button" aria-label={`${title}说明`}><QuestionCircleOutlined /></button></Tooltip></strong>;

  const renderDisplayProperties = () => {
    if (!selectedControl) return null;
    const presentation = getControlPresentation(selectedControl.presentation);
    const updatePresentation = (patch: Partial<ControlPresentation>) => updateSelectedControl({ presentation: { ...selectedControl.presentation, ...patch } });
    const hasFieldLabel = Boolean(selectedControl.fieldKey) || ['text', 'textarea', 'number', 'select', 'relation', 'datetime', 'upload', 'switch', 'readonly-text', 'code'].includes(selectedControl.controlType);
    return (
      <PropertyGroup title="布局与外观" className="designer-prop-section designer-layout-properties" titleClassName="designer-prop-section-title">
        <PropertyRow label="布局占比" hint="宽度相对于所在容器，空间不足时自动换行；外观参数留空时跟随主题。" className="designer-width-setting">
          <Select aria-label="布局占比" value={selectedControl.width} options={controlWidthOptions}
            onChange={width => updateSelectedControl({ width: width as ControlWidth, presentation: { ...selectedControl.presentation, startNewRow: false } })} />
        </PropertyRow>
        <PropertyAdvanced className="designer-appearance-advanced" key={selectedControl.id}>
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
      </PropertyGroup>
    );
  };

  const openSearchSettings = async () => {
    if (!selectedControl?.fieldKey) return;
    const epoch = ++searchRequestEpoch.current;
    const settings: OptionSearchSettings = structuredClone(selectedControl.typeSettings?.search || { fields: [], match: 'contains', filters: [] });
    setSearchDraft({ controlId: selectedControl.id, settings, query: '', metaLoading: true, loading: false, error: '', rows: [], page: 1, hasMore: false, context: {} });
    try {
      const schema: OptionSearchSchema = selectedReferenceSourceKind === 'static'
        ? { kind: 'static', fields: [{value:'label',label:'选项文字'}], defaultField:'label' }
        : (await previewOptionSearchSchema(platformForm!.id, selectedControl.fieldKey, layoutControls)).data.data;
      if (epoch !== searchRequestEpoch.current) return;
      setSearchDraft(current => current && ({ ...current, schema, metaLoading: false, settings: { ...current.settings, fields: current.settings.fields?.length ? current.settings.fields : [schema.defaultField] } }));
    } catch (error: any) {
      if (epoch === searchRequestEpoch.current) setSearchDraft(current => current && ({ ...current, metaLoading: false, error: error?.response?.data?.detail || '无法读取来源字段，请先检查数据来源' }));
    }
  };
  const updateSearchSettings = (patch: Partial<OptionSearchSettings>) => {
    ++searchRequestEpoch.current;
    setSearchDraft(current => current && ({ ...current, settings: { ...current.settings, ...patch }, rows: [], hasMore: false, tested: false, error: '', loading: false }));
  };
  const searchSettingsError = (draft: SearchSettingsDraft) => {
    const names = new Set(draft.schema?.fields.map(field => field.value));
    if (!draft.settings.fields?.length || draft.settings.fields.some(field => !names.has(field))) return '请选择有效的搜索字段';
    for (const filter of draft.settings.filters || []) {
      if (!names.has(filter.field)) return '请选择有效的范围字段';
      if (['isEmpty','notEmpty'].includes(filter.operator)) continue;
      if (filter.source === 'field' ? !baseConfig.fields.some(field => field.key === filter.sourceField) : !filter.value?.trim()) return '请完善候选范围的条件取值';
    }
    return '';
  };
  const updateSearchSample = (patch: Partial<SearchSettingsDraft>) => {
    ++searchRequestEpoch.current;
    setSearchDraft(current => current && ({ ...current, ...patch, rows: [], hasMore: false, tested: false, loading: false, error: '' }));
  };
  const testOptionSearch = async (page = 1) => {
    if (!searchDraft?.schema || !selectedControl?.fieldKey || searchDraft.controlId !== selectedControl.id) return;
    const invalid = searchSettingsError(searchDraft);
    if (invalid) { setSearchDraft(current => current && ({ ...current, error: invalid })); return; }
    const draft = searchDraft, epoch = ++searchRequestEpoch.current;
    setSearchDraft(current => current && ({ ...current, loading: true, error: '' }));
    try {
      let result: {data: SearchSettingsDraft['rows']; has_more: boolean};
      if (draft.schema?.kind === 'static') {
        const values = enumOptions(selectedControl.optionSource ? optionSourceToOptions(selectedControl.optionSource) : selectedField?.enumValues);
        const options = values.filter(option => matchesOptionSearch(option.label, draft.query, draft.settings.match));
        result = { data: options.slice((page-1)*20,page*20).map(option => ({id:option.value,label:option.label,matchedFields:draft.query?['label']:[]})), has_more: options.length > page*20 };
      } else {
        const controls = layoutControls.map(control => control.id === draft.controlId ? { ...control, typeSettings: { ...control.typeSettings, search: draft.settings } } : control);
        result = (await previewFormReferenceOptions(platformForm!.id, selectedControl.fieldKey, controls, draft.context, {query:draft.query,page,page_size:20})).data;
      }
      if (epoch === searchRequestEpoch.current) setSearchDraft(current => current && ({ ...current, rows: page===1?result.data:[...current.rows,...result.data], hasMore:result.has_more, page, loading:false, tested:true }));
    } catch (error:any) {
      if (epoch === searchRequestEpoch.current) setSearchDraft(current => current && ({ ...current, loading:false, error:error?.response?.data?.detail || '试搜失败，请检查来源与范围条件' }));
    }
  };
  const applySearchSettings = () => {
    if (!searchDraft || !selectedControl || searchDraft.controlId !== selectedControl.id) return;
    const invalid = searchSettingsError(searchDraft);
    if (invalid) { setSearchDraft(current => current && ({ ...current,error:invalid })); return; }
    updateSelectedControl({ typeSettings: { ...selectedControl.typeSettings, search: searchDraft.settings } });
    ++searchRequestEpoch.current; setSearchDraft(null);
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

  const applyAssignmentDraft = () => {
    if (!assignmentDraft || assignmentDraft.controlId !== selectedControlId) return;
    const targets = new Set<string>();
    for (const rule of assignmentDraft.rules) {
      if (!assignmentSourceAttributeOptions.some(option => option.value === rule.sourceAttribute) || !assignmentTargetFieldOptions.some(option => option.value === rule.targetField)) { message.error('请选择有效的来源属性和目标字段'); return; }
      if (targets.has(rule.targetField!)) { message.error('同一目标字段不能重复赋值'); return; }
      targets.add(rule.targetField!);
    }
    updateSelectedControl({ assignmentRules: assignmentDraft.rules, assignmentRulesEnabled: true });
    setAssignmentDraft(null);
  };

  const renderDefaultRuleProperties = () => (
    <section className="designer-prop-section">
      <strong className="designer-prop-section-title">{embedded ? '校验与数据保护' : '默认交互规则'}</strong>
      {!embedded && <><label><span>默认显示</span>{controlRuleToggle('visible')}</label>
      <label><span>默认只读</span>{controlRuleToggle('readonly')}</label>
      {!isLayoutContainer(selectedControl || undefined) && <label><span>默认必输</span>{controlRuleToggle('required')}</label>}</>}
      <label><span>唯一校验</span>{controlRuleToggle('unique')}</label>
      <label><span>默认脱敏</span>{controlRuleToggle('masked')}</label>
      <label><span>允许复制</span>{controlRuleToggle('copyable')}</label>
      <small>唯一校验在保存时由后台执行；脱敏作用于记录读取；复制限制作用于运行页复制和剪切。</small>
      {!embedded && renderDefaultValueProperties()}
      {renderAssignmentRules()}
      {hiddenRequiredControls.length > 0 && <Tag color="red">存在隐藏且必填冲突</Tag>}
    </section>
  );

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

  const applyDefaultValueDraft = () => {
    if (!defaultValueDraft || !selectedControl || defaultValueDraft.controlId !== selectedControl.id || !selectedField) return;
    const errors = defaultRuleErrors(layoutControls.map(control => control.id === selectedControl.id ? { ...control, defaultRule: { ...defaultValueDraft.rule, enabled: true } } : control), baseConfig.fields);
    if (errors.length) { message.error(errors.join('；')); return; }
    updateSelectedControl({ defaultRule: { ...defaultValueDraft.rule, enabled: true } });
    updateFieldDefaultValue(selectedField, defaultValueDraft.rule.mode === 'fixed' ? defaultValueDraft.fixed : '');
    setDefaultValueDraft(null);
  };

  const closeCalculationEditor = () => {
    calculationEpoch.current += 1;
    setCalculationDraft(null); setCalculationError(''); setCalculationResult(null); setCalculationBusy(false);
  };
  const updateCalculationDraft = (patch: Partial<CalculationRule>, samples?: Record<string, unknown>) => {
    calculationEpoch.current += 1;
    setCalculationBusy(false); setCalculationError(''); setCalculationResult(null);
    setCalculationDraft(current => current && ({ ...current, rule: { ...current.rule, ...patch }, samples: samples ?? current.samples }));
  };
  const calculationControls = () => layoutControls.map(control => control.id === calculationDraft?.controlId
    ? { ...control, computed: calculationDraft.rule, calculationRulesEnabled: true, inactiveCalculationRule: undefined, typeSettings: { ...control.typeSettings, precision: calculationDraft.rule.precision ?? undefined }, defaultRule: { ...(control.defaultRule || { mode: 'fixed' as const }), enabled: false } }
    : control);
  const checkCalculation = async (save: boolean) => {
    if (!calculationDraft || !platformForm) return;
    if (!calculationDraft.rule.expression.trim()) { setCalculationError('请填写计算公式'); return; }
    const epoch = ++calculationEpoch.current;
    setCalculationBusy(true); setCalculationError('');
    try {
      const controls = calculationControls();
      const response = await previewDesignerRules(platformForm.id, controls, calculationDraft.samples, false, save);
      if (epoch !== calculationEpoch.current) return;
      const target = controls.find(control => control.id === calculationDraft.controlId);
      if (!target?.fieldKey) return;
      if (save) {
        commitLayoutChange(() => controls);
        closeCalculationEditor();
      } else setCalculationResult({ value: response.data?.data?.data?.[target.fieldKey] });
    } catch (error: any) {
      if (epoch === calculationEpoch.current) setCalculationError(error?.response?.data?.detail || '公式检查失败，请稍后重试');
    } finally { if (epoch === calculationEpoch.current) setCalculationBusy(false); }
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

  const renderCommonRuleProperties = () => (
    <section className="designer-prop-section designer-common-rules">
      {renderPropertyHeading('填写规则', '唯一性校验在正式保存时执行；脱敏控制记录读取，复制限制作用于运行页的复制和剪切。齿轮可配置条件规则。')}
      <label>{renderRuleLabel('必填', '开启后，此字段必须填写才能提交。通过齿轮可设置必填条件。')}{controlRuleToggle('required')}</label>
      <label>{renderRuleLabel('只读', '开启后，使用者可查看此字段，但不能修改。通过齿轮可设置只读条件。')}{controlRuleToggle('readonly')}</label>
      <label>{renderRuleLabel('显示字段', '开启后，字段在表单中显示；关闭后隐藏。通过齿轮可设置显示条件。')}{controlRuleToggle('visible')}</label>
      <label>{renderRuleLabel('唯一校验', '开启后，保存时检查字段值是否已存在，重复值不能保存。')}{controlRuleToggle('unique')}</label>
      <label>{renderRuleLabel('数据脱敏', '开启后，读取记录时按脱敏规则隐藏部分内容，保护敏感数据。')}{controlRuleToggle('masked')}</label>
      <label>{renderRuleLabel('允许复制', '开启后，使用者可以在运行表单中复制或剪切字段内容。')}{controlRuleToggle('copyable')}</label>
      {renderDefaultValueProperties()}
      {hiddenRequiredControls.length > 0 && <Tag color="red">存在隐藏且必填冲突</Tag>}
    </section>
  );

  const renderAutomationProperties = () => (
    <section className="designer-prop-section">
      {renderPropertyHeading('提示与联动', '占位提示显示在输入框内，帮助说明显示在字段下方；赋值规则可在关联字段变化后回填其他字段。')}
      <label>
        <span>占位提示</span>
        <Input
          allowClear
          placeholder={selectedField?.placeholder || selectedControl?.desc || '请输入占位提示'}
          value={selectedControl?.placeholder || ''}
          onChange={(event) => updateSelectedControl({ placeholder: event.target.value })}
        />
      </label>
      <label>
        <span>帮助说明</span>
        <Input
          allowClear
          placeholder="可在此补充录入说明"
          value={selectedControl?.helpText || ''}
          onChange={(event) => updateSelectedControl({ helpText: event.target.value })}
        />
      </label>
      {renderCalculationProperties()}
      {embedded && renderAssignmentRules()}
      {!embedded && <><small>关联字段变更后，按下方已保存的赋值规则执行回填。</small>
      <label><span>联动刷新</span><Input value="未绑定联动规则" readOnly /></label>
      <label><span>异常提示</span><Input value="使用字段校验提示" readOnly /></label>
      <label><span>角色差异</span><Input value="在权限设计中统一配置" readOnly /></label></>}
    </section>
  );

  const markUnsaved = () => setHasUnsavedChanges(true);

  const updateViewConfig = (updater: (current: ViewConfig) => ViewConfig) => {
    setViewConfig((current) => updateActiveView(current, activeViewTab.id, updater));
    markUnsaved();
  };

  const updateViewFilter = (id: string, patch: Partial<ViewFilterConfig>) => {
    updateViewConfig((current) => ({
      ...current,
      filters: current.filters.map((filter) => (filter.id === id ? { ...filter, ...patch } : filter)),
    }));
  };

  const updateViewColumn = (id: string, patch: Partial<ViewTableColumnConfig>) => {
    updateViewConfig((current) => ({
      ...current,
      table: {
        ...current.table,
        columns: current.table.columns.map((column) => (column.id === id ? { ...column, ...patch } : column)),
      },
    }));
  };

  const moveViewItem = (kind: 'filter' | 'column', id: string, direction: -1 | 1) => {
    updateViewConfig((current) => {
      const source = kind === 'filter' ? sortByOrder(current.filters) : sortByOrder(current.table.columns);
      const index = source.findIndex((item) => item.id === id);
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= source.length) return current;
      const next = [...source];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      const reordered = next.map((item, sortOrder) => ({ ...item, sortOrder }));
      return kind === 'filter'
        ? { ...current, filters: reordered as ViewFilterConfig[] }
        : { ...current, table: { ...current.table, columns: reordered as ViewTableColumnConfig[] } };
    });
  };

  const reorderViewFilters = (draggedId: string, targetId: string) => {
    if (!draggedId || draggedId === targetId) return;
    updateViewConfig((current) => {
      const source = sortByOrder(current.filters);
      const fromIndex = source.findIndex((filter) => filter.id === draggedId);
      const toIndex = source.findIndex((filter) => filter.id === targetId);
      if (fromIndex < 0 || toIndex < 0) return current;
      const next = [...source];
      const [dragged] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, dragged);
      return {
        ...current,
        filters: next.map((filter, sortOrder) => ({ ...filter, sortOrder })),
      };
    });
  };

  const reorderViewColumns = (draggedId: string, targetId: string) => {
    if (!draggedId || draggedId === targetId) return;
    updateViewConfig((current) => {
      const source = sortByOrder(current.table.columns);
      const fromIndex = source.findIndex((column) => column.id === draggedId);
      const toIndex = source.findIndex((column) => column.id === targetId);
      if (fromIndex < 0 || toIndex < 0) return current;
      const next = [...source];
      const [dragged] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, dragged);
      return {
        ...current,
        table: {
          ...current.table,
          columns: next.map((column, sortOrder) => ({ ...column, sortOrder })),
        },
      };
    });
  };

  const syncViewFiltersByFields = (fieldNames: string[]) => {
    updateViewConfig((current) => {
      const selected = new Set(fieldNames);
      const existingByField = new Map(current.filters.map((filter) => [filter.fieldName, filter]));
      const filters = fieldNames
        .map((fieldName, index) => {
          const existing = existingByField.get(fieldName);
          if (existing) {
            return { ...existing, enabled: true, sortOrder: index };
          }
          const field = baseConfig.fields.find((item) => item.key === fieldName);
          const controlType = controlTypeForField(field?.type);
          return {
            id: `filter-${fieldName}-${Date.now()}-${index}`,
            fieldName,
            label: field?.name || fieldName,
            controlType,
            operator: defaultOperatorForControl(controlType),
            placeholder: controlType === 'keyword' || controlType === 'text' ? `请输入${field?.name || fieldName}` : `请选择${field?.name || fieldName}`,
            enabled: true,
            advanced: index > 3,
            sortOrder: index,
          } satisfies ViewFilterConfig;
        })
        .filter((filter) => selected.has(filter.fieldName));
      return { ...current, filters };
    });
  };

  const syncViewColumnsByFields = (fieldNames: string[]) => {
    updateViewConfig((current) => {
      const selected = new Set(fieldNames);
      const existingByField = new Map(current.table.columns.map((column) => [column.fieldName, column]));
      const columns = fieldNames
        .map((fieldName, index) => {
          const existing = existingByField.get(fieldName);
          if (existing) {
            return { ...existing, enabled: true, sortOrder: index };
          }
          const field = baseConfig.fields.find((item) => item.key === fieldName);
          return {
            id: `column-${fieldName}-${Date.now()}-${index}`,
            fieldName,
            label: field?.name || fieldName,
            enabled: true,
            width: index === 0 ? 180 : 140,
            sortable: Boolean(field?.sortable),
            renderType: renderTypeForField(field?.type),
            emptyText: '-',
            sortOrder: index,
          } satisfies ViewTableColumnConfig;
        })
        .filter((column) => selected.has(column.fieldName));
      return {
        ...current,
        table: {
          ...current.table,
          columns,
        },
      };
    });
  };

  const ensurePlatformForm = async () => {
    if (platformForm) return platformForm;
    const matchedForm = await resolvePlatformFormForConfig(staticBaseConfig.id);
    if (matchedForm) {
      if (aiFormDraft) throw new Error('表单编码已被使用，请修改编码后重试，不能覆盖已有表单');
      setPlatformForm(matchedForm);
      setPermissionDrafts(permissionDraftsFromConfig(matchedForm.config));
      setWorkflowMeta(getWorkflowDesignerMeta(matchedForm));
      return matchedForm;
    }

    const createResponse = await createPlatformForm({
      name: baseConfig.name,
      code: baseConfig.id,
      description: baseConfig.description,
      table_name: aiFormDraft ? undefined : baseConfig.dataSource,
      storage_mode: 'dynamic',
      status: aiFormDraft ? 'draft' : 'active',
      config: {
        workflowDesigner: {},
        source: 'form-settings',
        viewConfig: storedViewConfig,
        viewConfigDraft: storedViewConfig,
        viewConfigMeta: {
          draftVersion: 1,
          publishedVersion: aiFormDraft ? 0 : 1,
          draftSavedAt: new Date().toISOString(),
          publishedAt: aiFormDraft ? undefined : new Date().toISOString(),
          status: aiFormDraft ? 'draft' : 'published',
        },
      },
    });
    const createdForm = createResponse.data?.data as PlatformForm;
    await Promise.all(baseConfig.fields.map((baseField, index) => {
      const control = layoutControls.find(item => item.fieldKey === baseField.key);
      const field = control ? { ...baseField, name: control.name, required: control.rules.required.enabled, placeholder: control.placeholder ?? baseField.placeholder } : baseField;
      return createPlatformFormField(createdForm.id, {
        field_name: field.key,
        label: field.name,
        field_type: mapDesignerFieldType(field),
        business_type: getFieldBusinessType(field),
        control_type: inferFieldControlType(field),
        data_source: field.optionSource,
        encoding_rule: control?.encodingRule || (isEncodingField(field) ? field.encodingRule || makeEncodingRule(field) : undefined),
        required: Boolean(field.required),
        visible_in_list: field.listVisible !== false,
        visible_in_form: true,
        searchable: Boolean(field.searchable),
        sortable: Boolean(field.sortable),
        default_value: getDesignerFieldDefaultValue(field),
        enum_values: control?.optionSource && enumOptions(control.optionSource).length ? { values: enumOptions(control.optionSource) } : field.enumValues as Record<string, unknown> | undefined || (field.optionSource ? { source: field.optionSource } : undefined),
        validation: field.validation ? { message: field.validation } : undefined,
        ui_config: {
          placeholder: field.placeholder,
          locked: Boolean(field.locked),
          designerType: field.type,
          businessType: getFieldBusinessType(field),
          controlType: inferFieldControlType(field),
        },
        sort_order: index,
      });
    }));
    setPlatformForm(createdForm);
    setWorkflowMeta({});
    return createdForm;
  };

  const getDesignerFieldDefaultValue = (field: DesignerField) => (
    fieldDefaultValueDrafts[field.key] ?? field.defaultValue
  );

  const syncFieldDefaultValues = async (form: PlatformForm) => {
    const changedKeys = Object.keys(fieldDefaultValueDrafts);
    if (!changedKeys.length) return form;
    const fieldByName = new Map((form.fields || []).map((field) => [field.field_name, field]));
    await Promise.all(changedKeys.map(async (fieldKey) => {
      const platformField = fieldByName.get(fieldKey);
      if (!platformField) return;
      await updatePlatformFormField(form.id, platformField.id, {
        default_value: fieldDefaultValueDrafts[fieldKey],
      });
    }));
  };

  const savePermissionDesign = async () => {
    setPersistingPermissions(true);
    try {await saveDraft();}
    finally{setPersistingPermissions(false);}
  };

  const updateFormWorkflowMeta = async (form: PlatformForm, nextMeta: WorkflowDesignerMeta) => {
    const nextConfig = { ...(form.config || {}), workflowDesigner: nextMeta };
    const response = await updatePlatformForm(form.id, { config: nextConfig });
    const updatedForm = (response.data?.data || { ...form, config: nextConfig }) as PlatformForm;
    setPlatformForm(updatedForm);
    setWorkflowMeta(nextMeta);
    return updatedForm;
  };

  const updateFormViewConfig = async (
    form: PlatformForm,
    nextViewConfig: ViewConfig,
    mode: 'draft' | 'published',
  ) => {
    const currentConfig = { ...(form.config || {}) } as Record<string, unknown>;
    const currentMeta = getViewConfigMeta(form);
    const now = new Date().toISOString();
    const draftVersion = Number(currentMeta.draftVersion || currentMeta.publishedVersion || 0);
    const publishedVersion = Number(currentMeta.publishedVersion || 0);
    const runtimeFormLayout = makeRuntimeFormLayout(layoutControls, baseConfig.fields);
    const nextMeta: ViewConfigMeta = mode === 'draft'
      ? {
          ...currentMeta,
          draftVersion: draftVersion + 1,
          draftSavedAt: now,
          status: 'draft',
        }
      : {
          ...currentMeta,
          draftVersion: Math.max(draftVersion, publishedVersion + 1),
          publishedVersion: publishedVersion + 1,
          draftSavedAt: now,
          publishedAt: now,
          status: 'published',
        };
    const nextConfig: Record<string, unknown> = mode === 'draft'
      ? {
          ...currentConfig,
          viewConfigDraft: nextViewConfig,
          formLayout: runtimeFormLayout,
          permissionDesignDraft:{version:1,roles:Object.fromEntries(Object.entries(permissionDrafts).map(([key,value])=>[key,sanitizePermissionDesignDraft(value)]))},
          formDesignerControls: layoutControls,
          canvasSettings,
          viewConfigMeta: nextMeta,
        }
      : {
          ...currentConfig,
          viewConfig: nextViewConfig,
          viewConfigDraft: nextViewConfig,
          formLayout: runtimeFormLayout,
          permissionDesignDraft:{version:1,roles:Object.fromEntries(Object.entries(permissionDrafts).map(([key,value])=>[key,sanitizePermissionDesignDraft(value)]))},
          formDesignerControls: layoutControls,
          canvasSettings,
          viewConfigMeta: nextMeta,
        };
    const response = await updatePlatformForm(form.id, { config: nextConfig });
    const updatedForm = (response.data?.data || { ...form, config: nextConfig }) as PlatformForm;
    await upsertPlatformFormLayout(form.id, 'view', {
      layout_type: 'view',
      config: {
        draft: nextConfig.viewConfigDraft,
        published: nextConfig.viewConfig,
        meta: nextConfig.viewConfigMeta,
      },
    });
    await upsertPlatformFormLayout(form.id, 'form', {
      layout_type: 'form',
      config: runtimeFormLayout,
    });
    setPlatformForm(updatedForm);
    return updatedForm;
  };

  const updateFormAnalyticsDesign = async (
    form: PlatformForm,
    nextAnalyticsDesign: AnalyticsDesign,
    mode: 'draft' | 'published',
  ) => {
    const currentConfig = { ...(form.config || {}) } as Record<string, unknown>;
    const now = new Date().toISOString();
    const currentMeta = (currentConfig.analyticsDesignMeta || {}) as Record<string, unknown>;
    const draftVersion = Number(currentMeta.draftVersion || currentMeta.publishedVersion || 0);
    const publishedVersion = Number(currentMeta.publishedVersion || 0);
    const nextMeta = mode === 'draft'
      ? {
          ...currentMeta,
          draftVersion: draftVersion + 1,
          draftSavedAt: now,
          status: 'draft',
        }
      : {
          ...currentMeta,
          draftVersion: Math.max(draftVersion, publishedVersion + 1),
          publishedVersion: publishedVersion + 1,
          draftSavedAt: now,
          publishedAt: now,
          status: 'published',
        };
    const nextConfig: Record<string, unknown> = mode === 'draft'
      ? {
          ...currentConfig,
          assemblyKind: 'analysis',
          analyticsDesignDraft: nextAnalyticsDesign,
          analyticsDesignMeta: nextMeta,
        }
      : {
          ...currentConfig,
          assemblyKind: 'analysis',
          analyticsDesign: nextAnalyticsDesign,
          analyticsDesignDraft: nextAnalyticsDesign,
          analyticsDesignMeta: nextMeta,
        };
    const response = await updatePlatformForm(form.id, { config: nextConfig });
    const updatedForm = (response.data?.data || { ...form, config: nextConfig }) as PlatformForm;
    await upsertPlatformFormLayout(form.id, 'analytics', {
      layout_type: 'analytics',
      config: {
        draft: nextConfig.analyticsDesignDraft,
        published: nextConfig.analyticsDesign,
        meta: nextConfig.analyticsDesignMeta,
      },
    });
    setPlatformForm(updatedForm);
    return updatedForm;
  };

  const saveWorkflowDefinition = async (status: 'draft' | 'published', form: PlatformForm, workflowId?: number) => {
    const payload = {
      name: professionalFlowConfig.name || `${baseConfig.name}流程`,
      description: `${baseConfig.name} 表单内嵌流程设计`,
      status,
      config: makeWorkflowConfigPayload(professionalFlowConfig, form, baseConfig),
      form_config: makeWorkflowFormConfig(baseConfig),
    };
    if (workflowId) {
      const response = await wfUpdateDefinition(workflowId, payload);
      return {
        id: workflowId,
        version: Number(response.data?.version || 1),
        status: String(response.data?.status || status),
      };
    }
    const response = await wfCreateDefinition(payload);
    return {
      id: Number(response.data?.id),
      version: Number(response.data?.version || 1),
      status: String(response.data?.status || status),
    };
  };

  const persistDesignerDraft = async () => {
    const form = await ensurePlatformForm();
    await syncFieldDefaultValues(form);
    const formWithView = await updateFormViewConfig(form, storedViewConfig, 'draft');
    let updatedForm: PlatformForm;
    if (isAnalysisDesigner) {
      updatedForm = await updateFormAnalyticsDesign(formWithView, analyticsDesign, 'draft');
    } else {
      const meta = getWorkflowDesignerMeta(formWithView);
      const saved = await saveWorkflowDefinition('draft', formWithView, meta.draftWorkflowId === meta.publishedWorkflowId ? undefined : meta.draftWorkflowId);
      updatedForm = await updateFormWorkflowMeta(formWithView, { ...meta, draftWorkflowId: saved.id });
    }
    lastSavedForm.current = updatedForm;
    setHasUnsavedChanges(false);
    return updatedForm;
  };

  const checkSelectionConfiguration = () => {
    const errors: string[] = [];
    for (const control of layoutControls) {
      const field = baseConfig.fields.find(item => item.key === control.fieldKey);
      const kind = getEffectiveControlTypeForControl(control, field);
      if (!['select', 'relation'].includes(kind)) continue;
      const sourceKind = control.dataSourceKind || inferReferenceSourceKind(field, kind);
      const settings = control.typeSettings || {};
      if (sourceKind !== 'static') continue;
      const options = control.optionSource === field?.optionSource && field?.enumValues ? enumOptions(field.enumValues) : parseStaticOptions(control.optionSource, field?.enumValues);
      errors.push(...[...staticOptionErrors(options), ...selectionConfigErrors(settings, options.length)].map(error => `「${control.name}」${error}`));
      if (settings.displayMode === 'tags' && settings.selectionMode !== 'multiple') errors.push(`「${control.name}」标签展示需要多选模式`);
      if (settings.allowCreateOption && (settings.selectionMode !== 'multiple' || settings.displayMode === 'radio')) errors.push(`「${control.name}」当前模式不支持临时项`);
      const rule = control.defaultRule || field?.defaultRule;
      const fixed = getFieldDefaultValue(field);
      if (rule?.enabled !== false && rule?.mode !== 'template' && fixed !== '') {
        let values: unknown[] = [fixed];
        if (settings.selectionMode === 'multiple') { try { const parsed = JSON.parse(fixed); values = Array.isArray(parsed) ? parsed : [parsed]; } catch { values = [fixed]; } }
        const countError = selectionCountError(values, settings);
        if (countError) errors.push(`「${control.name}」默认值${countError}`);
        if (!settings.allowCreateOption && values.some(value => !options.some(option => String(option.value) === String(value)))) errors.push(`「${control.name}」默认值不在候选选项中`);
      }
    }
    if (errors.length) { Modal.error({ title: '请完善选择控件配置', content: <div>{errors.map((error, index) => <div key={index}>{error}</div>)}</div> }); return false; }
    return true;
  };

  const saveDraft = async () => {
    if (!checkSelectionConfiguration()) return false;
    if (flowLoadError) { message.error(flowLoadError); return false; }
    if (isPersistingFlow) return false;
    setPersistingFlow(true);
    try {
      await persistDesignerDraft();
      message.success('草稿已保存，发布后会同步到业务页面');
      return true;
    } catch (error) {
      console.error('workflow draft save failed', error);
      message.error('草稿保存失败，请检查后端服务或登录状态');
      return false;
    } finally {
      setPersistingFlow(false);
    }
  };

  const publishConfig = async () => {
    if (!checkSelectionConfiguration()) return false;
    if (flowLoadError) { message.error(flowLoadError); return false; }
    if (isPersistingFlow) return false;
    setPersistingFlow(true);
    try {
      const savedForm = await persistDesignerDraft();
      const response = await previewPlatformFormPublish(savedForm.id);
      setServerPublishReport(response.data?.data as PlatformFormPublishReport);
      setPublishCheckOpen(true);
      return true;
    } catch (error) {
      console.error('form publish preview failed', error);
      message.error('发布检查未完成，当前修改仍保留，请重试');
      return false;
    } finally {
      setPersistingFlow(false);
    }
  };

  const confirmPublish = async () => {
    if (!checkSelectionConfiguration()) return;
    if (flowLoadError) { message.error(flowLoadError); return; }
    if (publishErrorCount > 0) {
      message.error('请先处理发布确认中的阻断项');
      return;
    }
    if (isPersistingFlow) return;
    setPersistingFlow(true);
    try {
      const form = await ensurePlatformForm();
      await syncFieldDefaultValues(form);
      if (isAnalysisDesigner) {
        const formWithViewDraft = await updateFormViewConfig(form, storedViewConfig, 'draft');
        const formWithAnalyticsDraft = await updateFormAnalyticsDesign(formWithViewDraft, analyticsDesign, 'draft');
        const updatedForm = formWithAnalyticsDraft;
        const formVersionResponse = await publishPlatformForm(updatedForm.id);
        onPublished?.();
      const publishedDetail=await getPlatformForm(updatedForm.id,{schema:'draft',scope:'designer'});
      setPlatformForm(publishedDetail.data.data);
        const schemaVersion = Number(formVersionResponse.data?.data?.version || ((updatedForm.config || {}).analyticsDesignMeta as any)?.publishedVersion || 1);
        setServerPublishReport((formVersionResponse.data?.data?.impact_report || null) as PlatformFormPublishReport | null);
        setVersion(`v${schemaVersion}`);
        setPublishCheckOpen(false);
        setHasUnsavedChanges(false);
        message.success('BI 看板配置已发布，运行页会读取新的数据集、指标、图表和联动配置');
        return;
      }
      const formWithView = await updateFormViewConfig(form, storedViewConfig, 'draft');
      const meta = getWorkflowDesignerMeta(formWithView);
      const saved = await saveWorkflowDefinition('published', formWithView, meta.draftWorkflowId);
      const publishedAt = new Date().toISOString();
      const updatedForm = await updateFormWorkflowMeta(formWithView, {
        ...meta,
        draftWorkflowId: saved.id,
        publishedWorkflowId: saved.id,
        publishedAt,
        publishedVersion: saved.version,
      });
      const bindingsResponse = await listWorkflowBindings(updatedForm.id);
      const existingBindings = (bindingsResponse.data?.data || []) as WorkflowBindingPayload[];
      await Promise.all(professionalFlowConfig.triggerBindings.map((binding) => {
        const payload = {
          workflow_id: saved.id,
          trigger_action: binding.action,
          enabled: binding.enabled,
          config: {
            label: binding.label,
            workflowVersion: saved.version,
            publishedAt,
            stateMapping: professionalFlowConfig.stateMapping,
          },
        };
        const existing = existingBindings.find((item) => item.trigger_action === binding.action);
        return existing
          ? updateWorkflowBinding(updatedForm.id, existing.id, payload)
          : upsertWorkflowBinding(updatedForm.id, payload);
      }));
      const formVersionResponse = await publishPlatformForm(updatedForm.id);
      onPublished?.();
      const publishedDetail=await getPlatformForm(updatedForm.id,{schema:'draft',scope:'designer'});
      setPlatformForm(publishedDetail.data.data);
      const schemaVersion = Number(formVersionResponse.data?.data?.version || saved.version);
      setServerPublishReport((formVersionResponse.data?.data?.impact_report || null) as PlatformFormPublishReport | null);
      setVersion(`v${schemaVersion}`);
      setPublishCheckOpen(false);
      setHasUnsavedChanges(false);
      message.success('配置已发布，运行页会读取新的数据筛选和表格配置');
    } catch (error) {
      console.error('workflow publish failed', error);
      const report = (error as any)?.response?.data?.detail?.report as PlatformFormPublishReport | undefined;
      if (report) {
        setServerPublishReport(report);
        message.error('发布被后端影响报告阻断，请先处理不兼容字段变更');
        return;
      }
      message.error('发布失败，请检查流程定义或绑定接口');
    } finally {
      setPersistingFlow(false);
    }
  };

  const warnBeforeLeave = () => {
    if (!embedded || !onExit) {
      navigate(`/program/${baseConfig.id}`);
      return;
    }
    if (isPersistingFlow) return;
    if (!hasUnsavedChanges) { onExit(); return; }
    let savingBeforeExit = false;
    const confirmation = Modal.confirm({
      className: 'form-designer-dialog',
      title: '返回前，保留这次修改吗？',
      content: '保存为配置草稿后，可以下次继续编辑。发布前，业务页面仍使用当前版本。',
      okText: '保存草稿并返回',
      cancelText: '继续编辑',
      onOk: async () => {
        savingBeforeExit = true;
        confirmation.update({ cancelButtonProps: { disabled: true }, keyboard: false, maskClosable: false });
        if (!await saveDraft()) {
          savingBeforeExit = false;
          confirmation.update({ cancelButtonProps: { disabled: false }, keyboard: true });
          throw new Error('草稿保存失败，请重试');
        }
        onExit();
      },
      footer: (_, { OkBtn, CancelBtn }) => <Space wrap>
        <Button type="text" danger disabled={savingBeforeExit} onClick={() => { if (savingBeforeExit) return; confirmation.destroy(); onExit(); }}>放弃修改并返回</Button>
        <CancelBtn /><OkBtn />
      </Space>,
    });
  };

  const applyTwoColumnLayout = () => {
    commitLayoutChange((current) => current.map((control) => ({ ...control, width: 'half' })));
    message.success('已应用两列布局');
  };

  const applyCompactLayout = () => {
    commitLayoutChange((current) => current.map((control) => ({
      ...control,
      width: control.controlType === 'textarea' || control.controlType === 'upload' ? 'full' : 'quarter',
    })));
    message.success('已应用紧凑布局');
  };

  const applyBusinessSectionLayout = () => {
    const controls: LayoutControl[] = [];
    alertSections.forEach((section) => {
      controls.push({
        id: `section-${section.key}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        source: 'component',
        controlType: 'divider',
        name: section.title,
        desc: section.desc,
        width: 'full',
        rules: makeControlRules(),
      });
      section.fieldKeys
        .map((fieldKey) => baseConfig.fields.find((field) => field.key === fieldKey))
        .filter((field): field is DesignerField => Boolean(field))
        .forEach((field) => controls.push(makeFieldControl(field)));
    });
    commitLayoutChange(() => controls);
    setSelectedControlId(controls.find((control) => control.fieldKey)?.id || '');
    message.success('已按告警业务分组重新排版');
  };

  const batchUpdateVisibleControls = (patch: Partial<LayoutControl>) => {
    commitLayoutChange((current) => current.map((control) => (
      control.source === 'field' ? { ...control, ...patch } : control
    )));
  };

  const batchSetRequired = () => {
    commitLayoutChange((current) => current.map((control) => (
      control.source === 'field'
        ? { ...control, rules: { ...control.rules, required: { ...control.rules.required, enabled: true } } }
        : control
    )));
    message.success('已将画布中的字段批量设为必填');
  };

  const addTemplateField = (template: DesignerField) => {
    const field = { ...template, key: `${template.key}-${Date.now()}` };
    const control = makeFieldControl(field);
    const target = layoutControls.find(item => item.id === selectedControlId);
    const parentId = isLayoutContainer(target) ? target!.id : target?.parentId;
    const parent = layoutControls.find(item => item.id === parentId);
    const slotId = parent ? (isLayoutContainer(target) ? containerTabs[parent.id] || layoutSlots(parent)[0].id : target?.slotId) : undefined;
    commitLayoutChange((current) => [...current, { ...control, parentId, slotId, width:parentId?control.width:canvasSettings.columns===1?'full':canvasSettings.columns===3?'third':'half' }]);
    setSelectedControlId(control.id);
    message.success(`已添加常用字段模板：${template.name}`);
  };

  const redoLayoutChange = () => {
    setFuture((current) => {
      const nextState = current[current.length - 1];
      if (!nextState) return current;
      setHistory((previous) => [...previous.slice(-19), layoutControls]);
      setLayoutControls(nextState);
      setSelectedControlId('');
      message.success('已重做画布操作');
      return current.slice(0, -1);
    });
  };

  const startFlowNodeDrag = (event: React.PointerEvent<HTMLDivElement>, node: FlowNode) => {
    if ((event.target as HTMLElement).closest('.flow-port')) return;
    const canvas = flowCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / canvas.offsetWidth || 1;
    const scaleY = rect.height / canvas.offsetHeight || 1;
    draggingFlowNodeRef.current = {
      id: node.id,
      startX: event.clientX,
      startY: event.clientY,
      originX: node.x,
      originY: node.y,
      scaleX,
      scaleY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveFlowNode = (event: React.PointerEvent<HTMLDivElement>) => {
    const dragState = draggingFlowNodeRef.current;
    const canvas = flowCanvasRef.current;
    if (!dragState || !canvas) return;
    const nextX = dragState.originX + (event.clientX - dragState.startX) / dragState.scaleX;
    const nextY = dragState.originY + (event.clientY - dragState.startY) / dragState.scaleY;
    const maxX = Math.max(40, canvas.offsetWidth - FLOW_NODE_WIDTH - 24);
    const maxY = Math.max(60, canvas.offsetHeight - FLOW_NODE_HEIGHT - 24);
    setFlowNodes((current) => current.map((node) => (
      node.id === dragState.id
        ? { ...node, x: Math.min(Math.max(28, nextX), maxX), y: Math.min(Math.max(72, nextY), maxY) }
        : node
    )));
  };

  const stopFlowNodeDrag = () => {
    draggingFlowNodeRef.current = null;
  };

  const addFlowNode = (definition: FlowNodeDefinition) => {
    setFlowNodes((current) => {
      const node: FlowNode = {
        id: `flow-${definition.key}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        label: definition.name,
        role: definition.role,
        x: 300,
        y: 112,
      };
      const endIndex = current.findIndex((item) => item.role === 'end');
      const next = definition.role === 'end' || endIndex < 0
        ? [...current, node]
        : [...current.slice(0, endIndex), node, ...current.slice(endIndex)];
      const arranged = next.map((item, index) => ({ ...item, x: item.x || 300, y: 112 + index * 126 }));
      setFlowConnections(makeFlowConnections(arranged));
      setPendingFlowPort(null);
      return arranged;
    });
  };

  const handleFlowPortClick = (event: React.MouseEvent<HTMLElement>, node: FlowNode, side: FlowPortSide) => {
    event.stopPropagation();
    setPendingFlowPort((current) => {
      if (!current) return { nodeId: node.id, side };
      if (current.nodeId === node.id && current.side === side) return null;
      const nextConnection: FlowConnection = {
        id: `${current.nodeId}-${current.side}-${node.id}-${side}-${Date.now()}`,
        fromId: current.nodeId,
        fromSide: current.side,
        toId: node.id,
        toSide: side,
      };
      setFlowConnections((connections) => [
        ...connections.filter((connection) => !(connection.fromId === current.nodeId && connection.fromSide === current.side && connection.toId === node.id && connection.toSide === side)),
        nextConnection,
      ]);
      return null;
    });
  };

  const commitLayoutChange = (updater: (current: LayoutControl[]) => LayoutControl[]) => {
    setLayoutControls((current) => {
      const next = normalizeLayout(updater(current));
      setHistory((previous) => [...previous.slice(-19), current]);
      setFuture([]);
      markUnsaved();
      return next;
    });
  };

  const { registerPageController, setDesignerContext } = useAiWorkbench();
  const aiNativeState = useRef({ layoutControls, selectedControlId, platformForm, hasUnsavedChanges, commitLayoutChange, saveDraft, fields: baseConfig.fields });
  aiNativeState.current = { layoutControls, selectedControlId, platformForm, hasUnsavedChanges, commitLayoutChange, saveDraft, fields: baseConfig.fields };
  const [pageCallCompletion, setPageCallCompletion] = useState<{ resolve: (state: Record<string, unknown>) => void } | null>(null);
  useEffect(() => {
    if ((!platformForm?.id && !aiFormDraft) || isResolvingPlatformConfig || isAnalysisDesigner) return;
    return registerPageController(platformForm?.id || 0, async (action: PageAction) => {
      const current = aiNativeState.current;
      if (action.draft_id ? (current.platformForm || action.draft_id !== aiFormDraft?.id) : current.platformForm?.id !== action.form_id) throw new Error('当前设计器与目标表单不一致');
      if (action.action === 'confirm_draft') {
        if (!aiFormDraft || !await current.saveDraft()) throw new Error('草稿未保存，请检查页面提示后重试');
        return { form_id: lastSavedForm.current?.id, saved: true, published: false };
      }
      if (action.action === 'draft_new') {
        setDatabaseFieldsByForm(fields => ({ ...fields, [staticBaseConfig.id]: [] }));
        current.commitLayoutChange(() => []);
        setDraftReviewReady(false);
      }
      if (action.action === 'add_field' || action.action === 'set_field_properties') setDraftReviewReady(false);
      if (action.action === 'add_field') {
        if (!aiFormDraft || !action.field) throw new Error('只能向未创建的本地草稿逐步添加字段');
        if (current.fields.length >= 60) throw new Error('草稿已达到字段数量上限');
        if (current.fields.some(field => field.key === action.field!.field_name)) throw new Error('该字段已在草稿中');
        const field = draftFieldToDesignerField(action.field);
        const fields = [...current.fields, field];
        setDatabaseFieldsByForm(value => ({ ...value, [staticBaseConfig.id]: fields }));
        const addedControl = applyNativeFieldProperties(makeFieldControl(field), field, action.field);
        current.commitLayoutChange(controls => {
          const next = [...controls];
          next.splice(Math.min(action.field!.position ?? next.length, next.length), 0, addedControl);
          return next;
        });
        setViewConfig(makeDesignerViewConfig({ ...baseConfig, fields }));
        setSelectedControlId(addedControl.id);
      }
      if (action.action === 'review') setDraftReviewReady(true);
      const control = action.field_name ? current.layoutControls.find(item => item.fieldKey === action.field_name) : undefined;
      if (action.field_name && !control) throw new Error('该字段不在当前画布中，请先在原设计器加入已有字段');
      if (action.action === 'set_field_properties' && control) {
        const properties = action.properties || {};
        const field = current.fields.find(field => field.key === control.fieldKey);
        const updated = applyNativeFieldProperties(control, field, properties);
        current.commitLayoutChange(controls => {
          const next = controls.map(item => item.id === control.id ? updated : item);
          if (properties.position !== undefined) {
            const index = next.findIndex(item => item.id === control.id);
            const [moved] = next.splice(index, 1);
            next.splice(Math.min(properties.position, next.length), 0, moved);
          }
          return next;
        });
      }
      setActiveTab('form');
      if (control) setSelectedControlId(control.id);
      if (action.action === 'preview') setPreviewOpen(true);
      // Resolve only after React commits the native designer's changed state.
      return new Promise<Record<string, unknown>>(resolve => setPageCallCompletion({ resolve }));
    });
  }, [platformForm?.id, aiFormDraft, isResolvingPlatformConfig, isAnalysisDesigner, registerPageController, baseConfig.fields]);
  useEffect(() => {
    if (!pageCallCompletion) return;
    const selected = layoutControls.find(control => control.id === selectedControlId);
    pageCallCompletion.resolve({ form_id: platformForm?.id || null, draft_id: platformForm ? undefined : aiFormDraft?.id,
      fields: layoutControls.filter(control => control.fieldKey).map(control => ({ field_name: control.fieldKey, label: control.name,
        control_type: getEffectiveControlTypeForControl(control, baseConfig.fields.find(field => field.key === control.fieldKey)),
        required: control.rules.required.enabled, readonly: control.rules.readonly.enabled })), selected_field: selected?.fieldKey,
      label: selected?.name, required: selected?.rules.required.enabled,
      readonly: selected?.rules.readonly.enabled, unsaved_changes: hasUnsavedChanges,
      saved: false, published: false });
    setPageCallCompletion(null);
  }, [pageCallCompletion, layoutControls, selectedControlId, hasUnsavedChanges, platformForm?.id, aiFormDraft]);
  useEffect(() => {
    if ((!platformForm?.id && !aiFormDraft) || isResolvingPlatformConfig) return;
    setDesignerContext({ form_id: platformForm?.id || null, draft_id: platformForm ? undefined : aiFormDraft?.id, form_code: platformForm?.code || aiFormDraft?.code, form_name: baseConfig.name, review_ready: draftReviewReady, unsaved_changes: hasUnsavedChanges,
      selected_field: layoutControls.find(control => control.id === selectedControlId)?.fieldKey,
      fields: layoutControls.filter(control => control.fieldKey).map(control => ({ field_name: control.fieldKey,
        label: control.name, required: control.rules.required.enabled, readonly: control.rules.readonly.enabled,
        min: control.typeSettings?.min, max: control.typeSettings?.max,
        control_type: getEffectiveControlTypeForControl(control, baseConfig.fields.find(field => field.key === control.fieldKey)),
        width: control.width, settings: control.typeSettings, presentation: control.presentation,
        options: enumOptions(control.optionSource), encoding: control.encodingRule ? { prefix: control.encodingRule.prefix, date_pattern: control.encodingRule.datePattern, sequence_length: control.encodingRule.sequenceLength, reset_cycle: control.encodingRule.resetCycle } : undefined })) });
  }, [platformForm?.id, aiFormDraft, draftReviewReady, baseConfig.name, baseConfig.fields, isResolvingPlatformConfig, layoutControls, selectedControlId, hasUnsavedChanges, setDesignerContext]);
  useEffect(() => {
    if (aiFormDraft && platformForm?.id && !hasUnsavedChanges && !isPersistingFlow) {
      navigate(`/form-settings/${platformForm.id}?tab=form&legacy=1`, { replace: true });
    }
  }, [aiFormDraft, platformForm?.id, hasUnsavedChanges, isPersistingFlow, navigate]);
  useEffect(() => () => setDesignerContext(undefined), [setDesignerContext]);

  const undoLayoutChange = () => {
    setHistory((current) => {
      const previous = current[current.length - 1];
      if (!previous) return current;
      setFuture((next) => [...next.slice(-19), layoutControls]);
      setLayoutControls(previous);
      setSelectedControlId('');
      markUnsaved();
      message.success('已撤回上一步画布操作');
      return current.slice(0, -1);
    });
  };

  const addFieldToCanvas = (field: DesignerField) => {
    const control = makeFieldControl(field);
    const target = layoutControls.find(item => item.id === selectedControlId);
    const parentId = isLayoutContainer(target) ? target!.id : target?.parentId;
    const parent = layoutControls.find(item => item.id === parentId);
    const slotId = parent ? (isLayoutContainer(target) ? containerTabs[parent.id] || layoutSlots(parent)[0].id : target?.slotId) : undefined;
    commitLayoutChange((current) => [...current, { ...control, parentId, slotId, width:parentId?control.width:canvasSettings.columns===1?'full':canvasSettings.columns===3?'third':'half' }]);
    setSelectedControlId(control.id);
    setSelectedAssetKey(field.key);
  };

  const addComponentToCanvas = (component: ComponentDefinition) => {
    const control = makeComponentControl(component);
    const target = layoutControls.find(item => item.id === selectedControlId);
    const parentId = isLayoutContainer(target) ? target!.id : target?.parentId;
    const parent = layoutControls.find(item => item.id === parentId);
    const slotId = parent ? (isLayoutContainer(target) ? containerTabs[parent.id] || layoutSlots(parent)[0].id : target?.slotId) : undefined;
    commitLayoutChange((current) => [...current, { ...control, parentId, slotId, width:parentId?control.width:canvasSettings.columns===1?'full':canvasSettings.columns===3?'third':'half' }]);
    setSelectedControlId(control.id);
    message.success(`已添加${component.name}`);
  };

  const updateSelectedControl = (patch: Partial<LayoutControl>) => {
    if (!selectedControlId) return;
    commitLayoutChange((current) => current.map((control) => (
      control.id === selectedControlId ? { ...control, ...patch } : control
    )));
  };

  const addAssignmentRule = () => setAssignmentDraft(current => current && ({ ...current, rules: [...current.rules, { id: `assign-${createUuid()}`, sourceAttribute: assignmentSourceAttributeOptions[0]?.value || 'self.value' }] }));
  const updateAssignmentRule = (ruleId: string, patch: Partial<AssignmentRule>) => setAssignmentDraft(current => current && ({ ...current, rules: current.rules.map(rule => rule.id === ruleId ? { ...rule, ...patch } : rule) }));
  const removeAssignmentRule = (ruleId: string) => setAssignmentDraft(current => current && ({ ...current, rules: current.rules.filter(rule => rule.id !== ruleId) }));

  const updateSelectedEncodingRule = (patch: Partial<EncodingRule>) => {
    if (!selectedControlId) return;
    const currentRule = selectedControl?.encodingRule || makeEncodingRule(selectedField);
    updateSelectedControl({ encodingRule: { ...currentRule, ...patch } });
  };

  const updateSelectedTypeSettings = (patch: Partial<ControlTypeSettings>) => {
    if (!selectedControl) return;
    const settings = { ...getDefaultTypeSettings(selectedEffectiveControlType, selectedField), ...(selectedControl.typeSettings || {}) };
    updateSelectedControl({ typeSettings: ['select', 'relation'].includes(selectedEffectiveControlType)
      ? normalizeSelection(settings, patch, selectedReferenceSourceKind === 'static') : { ...settings, ...patch } });
  };

  const syncEncodingSegments = (segments: EncodingSegment[]) => {
    const dependencies = Array.from(new Set(
      segments
        .filter((segment) => segment.type === 'field' || segment.type === 'masterData')
        .map((segment) => segment.sourceField)
        .filter(Boolean) as string[],
    ));
    const sequenceSegment = segments.find((segment) => segment.type === 'sequence');
    setEncodingSettingsDraft((current) => current ? ({
      ...current,
      segments,
      dependencies,
      sequenceLength: sequenceSegment?.length || selectedEncodingRule?.sequenceLength || 3,
      resetCycle: sequenceSegment?.resetCycle || selectedEncodingRule?.resetCycle || 'month',
      regenerateOnDependencyChange: segments.some((segment) => segment.regenerateOnChange),
    }) : current);
  };

  const openEncodingSegmentEditor = (segment?: EncodingSegment, index?: number, part: 'type' | 'length' | 'value' | 'padding' = 'type') => {
    setEncodingSegmentEditPart(part);
    const draft = segment ? { ...segment, name: segment.name || getEncodingSegmentTypeLabel(segment.type) } : makeEncodingSegment('fixed', baseConfig.fields);
    const targetIndex = typeof index === 'number' ? index : selectedEncodingSegments.length;
    if (!segment) syncEncodingSegments([...selectedEncodingSegments, draft]);
    setEncodingSegmentEditor({ open: true, index: targetIndex, draft });
  };

  const closeEncodingSegmentEditor = () => {
    setEncodingSegmentEditor((current) => ({ ...current, open: false }));
  };

  const updateEncodingSegmentDraft = (patch: Partial<EncodingSegment>) => {
    const draft = { ...encodingSegmentEditor.draft, ...patch };
    setEncodingSegmentEditor(current => ({ ...current, draft }));
    if (typeof encodingSegmentEditor.index === 'number') {
      syncEncodingSegments(selectedEncodingSegments.map((segment, index) => index === encodingSegmentEditor.index ? draft : segment));
    }
  };

  const saveEncodingSegmentDraft = () => {
    if (!selectedControlUsesEncoding || !selectedEncodingRule) return;
    const draft = encodingSegmentEditor.draft;
    if (!draft.name?.trim()) {
      message.warning('请填写编码段名称');
      return;
    }
    if (!draft.length || draft.length < 1) {
      message.warning('编码段位数至少为 1');
      return;
    }
    const nextSegments = [...selectedEncodingSegments];
    if (typeof encodingSegmentEditor.index === 'number') {
      nextSegments[encodingSegmentEditor.index] = draft;
    } else {
      nextSegments.push(draft);
    }
    syncEncodingSegments(nextSegments);
    closeEncodingSegmentEditor();
  };

  const dismissEncodingSettings = () => {
    closeEncodingSegmentEditor();
    setEncodingSettingsDraft(null);
    encodingRuleTargetRef.current = null;
  };

  const deleteEncodingSettings = () => {
    const target = encodingRuleTargetRef.current;
    if (!target || !encodingSettingsDraft) return;
    const rules = getEncodingRules(target.rule).filter(rule => rule.id !== encodingSettingsDraft.id);
    commitLayoutChange(controls => controls.map(control => control.id === target.controlId
      ? { ...control, encodingRule: { ...target.rule, enabled: rules.length > 0 && target.rule.enabled !== false, rules } }
      : control));
    dismissEncodingSettings();
  };

  const commitEncodingSettings = () => {
          if (!encodingSettingsDraft || !encodingSettingsDraft.name?.trim()) { message.warning('请填写规则名称'); return; }
          const invalidSegment = selectedEncodingSegments.find(segment => encodingSegmentLengthError(segment));
          if (invalidSegment) { message.warning(`${getEncodingSegmentTypeLabel(invalidSegment.type)}：${encodingSegmentLengthError(invalidSegment)}，请调整内容、位数或选择超长截断`); return; }
          if (encodingSettingsDraft.generationMode !== 'manual' && !selectedEncodingSegments.length) { message.warning('请添加编码段'); return; }
          if ((encodingSettingsDraft.conditions || []).some((c) => !c.sourceField || (!['isEmpty', 'notEmpty'].includes(c.operator || '') && !c.value?.trim()))) {
            message.warning('请完整填写触发条件'); return;
          }
          const target = encodingRuleTargetRef.current;
          if (!target) { message.warning('请重新打开编码规则配置'); return; }
          const rules = [...getEncodingRules(target.rule)];
          if (rules.some((r) => r.id !== encodingSettingsDraft.id && r.name?.trim() === encodingSettingsDraft.name?.trim())) {
            message.warning('规则名称不能重复'); return;
          }
          const { priority, ...savedRule } = encodingSettingsDraft;
          const existingIndex = rules.findIndex((rule) => rule.id === savedRule.id);
          const nextRules = [...rules];
          if (existingIndex >= 0) nextRules[existingIndex] = savedRule;
          else nextRules.push(savedRule);
          commitLayoutChange(controls => controls.map(control => control.id === target.controlId ? { ...control, encodingRule: { ...target.rule, rules: nextRules } } : control));
          dismissEncodingSettings();
  };

  const renderEncodingSegmentForm = () => {
    const draft = encodingSegmentEditor.draft;
    const update = updateEncodingSegmentDraft;
    return <div className="encoding-segment-cell-inputs" onDoubleClick={event => event.stopPropagation()}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node) && !(event.relatedTarget as HTMLElement)?.closest?.('.ant-select-dropdown')) closeEncodingSegmentEditor(); }}
      onKeyDown={event => { event.stopPropagation(); if (event.key === 'Enter') saveEncodingSegmentDraft(); }}>
      {draft.type === 'fixed' && <Input autoFocus size="small" aria-label="固定值" status={encodingSegmentLengthError(draft) ? 'error' : undefined} value={draft.value || ''} onChange={event => update({value:event.target.value})} />}
      {draft.type === 'date' && <Select autoFocus size="small" aria-label="日期格式" value={draft.datePattern || 'YYMM'} options={encodingDatePatternOptions} onChange={datePattern => update({datePattern,length:getDateSegmentLength(datePattern) || draft.length})} />}
      {(draft.type === 'field' || draft.type === 'masterData') && <Select autoFocus size="small" aria-label="依据字段" value={draft.sourceField} options={baseConfig.fields.filter(field => field.key !== selectedField?.key).map(field => ({value:field.key,label:field.name}))} onChange={sourceField => update({sourceField,regenerateOnChange:Boolean(sourceField)})} />}
      {(draft.type === 'field' || draft.type === 'masterData' || draft.type === 'organization') && <Select size="small" aria-label="取值属性" value={draft.sourceAttribute || (draft.type === 'organization' ? 'org_code' : 'code')} options={draft.type === 'organization' ? [{value:'org_code',label:'组织编码'},{value:'factory_code',label:'工厂编码'},{value:'department_code',label:'部门编码'},{value:'org_name',label:'组织简称'}] : [{value:'code',label:'编码'},{value:'id',label:'ID'},{value:'shortName',label:'简称'},{value:'custom',label:'自定义属性'}]} onChange={sourceAttribute => update({sourceAttribute})} />}
      {draft.type === 'sequence' && <><InputNumber autoFocus size="small" aria-label="起始值" min={0} value={draft.sequenceStart ?? 1} onChange={value => update({sequenceStart:Number(value ?? 1)})} /><InputNumber size="small" aria-label="步长" min={1} value={draft.sequenceStep || 1} onChange={value => update({sequenceStep:Number(value || 1)})} /><Select size="small" aria-label="重置周期" value={draft.resetCycle || 'month'} options={encodingResetCycleOptions} onChange={resetCycle => update({resetCycle})} /></>}
    </div>;
  };

  const renderEncodingSegmentContents = (segment: EncodingSegment, index: number) => {
    const editing = encodingSegmentEditor.open && encodingSegmentEditor.index === index;
    const draft = editing ? encodingSegmentEditor.draft : segment;
    const start = (part: 'type' | 'length' | 'value' | 'padding') => openEncodingSegmentEditor(segment,index,part);
    const value = segment.type === 'fixed' ? segment.value || '设置固定值'
      : segment.type === 'date' ? segment.datePattern || 'YYMM'
      : segment.type === 'sequence' ? `起始 ${segment.sequenceStart ?? 1} · 步长 ${segment.sequenceStep || 1} · ${encodingResetCycleOptions.find(option => option.value === (segment.resetCycle || 'month'))?.label || segment.resetCycle || '按月重置'}`
      : `${baseConfig.fields.find(field => field.key === segment.sourceField)?.name || segment.sourceField || segment.sourceAttribute || '选择来源'}${segment.sourceAttribute ? ` / ${segment.sourceAttribute}` : ''}`;
    const cellButton = (part: 'type' | 'length' | 'value' | 'padding', label: string, content: React.ReactNode) => <button type="button" className="encoding-cell-display" aria-label={label}
      onDoubleClick={event => { event.stopPropagation(); start(part); }}
      onClick={event => { event.stopPropagation(); if (event.detail === 0) start(part); }}>{content}</button>;
    return <div className="encoding-segment-description encoding-segment-property-row">
      <div className="encoding-property-cell encoding-property-type">
        {editing && encodingSegmentEditPart === 'type' ? <Select autoFocus size="small" aria-label="段类型" value={draft.type} options={encodingSegmentTypeOptions}
          onBlur={closeEncodingSegmentEditor} onChange={type => { updateEncodingSegmentDraft({...makeEncodingSegment(type, baseConfig.fields),id:draft.id}); closeEncodingSegmentEditor(); }} />
          : cellButton('type',`编辑编码段类型：${getEncodingSegmentTypeLabel(segment.type)}`,<strong>{segment.name || getEncodingSegmentTypeLabel(segment.type)}</strong>)}
      </div>
      <div className="encoding-property-cell encoding-property-length">
        {editing && encodingSegmentEditPart === 'length' ? <InputNumber autoFocus size="small" aria-label="位数" min={1} max={64} suffix="位" value={draft.length}
          onChange={length => updateEncodingSegmentDraft({length:Number(length || 1)})} onBlur={closeEncodingSegmentEditor} onPressEnter={closeEncodingSegmentEditor} />
          : cellButton('length',`编辑${getEncodingSegmentTypeLabel(segment.type)}位数`,<span>{segment.length} 位</span>)}
      </div>
      <div className="encoding-property-cell encoding-property-value">
        {editing && encodingSegmentEditPart === 'value' ? renderEncodingSegmentForm() : cellButton('value',`编辑${getEncodingSegmentTypeLabel(segment.type)}内容`,<code>{value}</code>)}
        {encodingSegmentLengthError(segment) && <span className="encoding-segment-error" role="alert">{encodingSegmentLengthError(segment)}</span>}
      </div>
      <div className="encoding-property-cell encoding-property-padding">
        {editing && encodingSegmentEditPart === 'padding' ? <Select autoFocus size="small" aria-label={`${getEncodingSegmentTypeLabel(segment.type)}补位方式`} value={draft.padding || (draft.type === 'sequence' ? 'leftZero' : 'none')} options={encodingPaddingOptions}
          onBlur={closeEncodingSegmentEditor} onChange={padding => { updateEncodingSegmentDraft({padding}); closeEncodingSegmentEditor(); }} />
          : cellButton('padding',`编辑${getEncodingSegmentTypeLabel(segment.type)}补位方式`,<span>{encodingPaddingOptions.find(option => option.value === (segment.padding || (segment.type === 'sequence' ? 'leftZero' : 'none')))?.label}</span>)}

      </div>
    </div>;
  };

  const removeEncodingSegment = (index: number) => {
    closeEncodingSegmentEditor();
    syncEncodingSegments(selectedEncodingSegments.filter((_, segmentIndex) => segmentIndex !== index));
  };

  const moveLayoutControl = (sourceId: string, targetId: string, position: DropPosition = 'before') => {
    const target = layoutControls.find(item => item.id === targetId);
    if (!target || layoutDescendants(layoutControls, sourceId).has(targetId)) return;
    commitLayoutChange(current => {
      const siblings = current.filter(item => item.parentId === target.parentId && item.slotId === target.slotId && item.id !== sourceId);
      const nextSibling = siblings[siblings.findIndex(item => item.id === targetId) + 1];
      return placeLayoutControl(current, sourceId, target.parentId, target.slotId, position === 'before' ? target.id : nextSibling?.id);
    });
    setSelectedControlId(sourceId);
  };
  const moveLayoutControlToEnd = (sourceId: string) => {
    commitLayoutChange(current => placeLayoutControl(current, sourceId));
    setSelectedControlId(sourceId);
  };

  const duplicateControl = (control?: LayoutControl | null) => {
    if (!control) return;
    const tree = cloneLayoutSubtree(layoutControls, control.id, () => `control-${createUuid()}`);
    const copied = tree.find(item => item.parentId === control.parentId) || tree[0];
    setCopiedControl(control); setCopiedTree(layoutControls.filter(item => layoutDescendants(layoutControls, control.id).has(item.id)));
    commitLayoutChange((current) => [...current, ...tree]);
    setSelectedControlId(copied.id);
  };

  const copyControlToClipboard = (control?: LayoutControl | null) => {
    if (!control) return;
    setCopiedControl(control); setCopiedTree(layoutControls.filter(item => layoutDescendants(layoutControls, control.id).has(item.id)));
    message.success('已复制控件，可使用 Ctrl+V 粘贴');
  };

  const pasteCopiedControl = () => {
    if (!copiedControl) {
      message.warning('还没有复制控件');
      return;
    }
    const tree = cloneLayoutSubtree(copiedTree.length ? copiedTree : [copiedControl], copiedControl.id, () => `control-${createUuid()}`);
    commitLayoutChange((current) => [...current, ...tree]);
    setSelectedControlId(tree.find(item => item.parentId === copiedControl.parentId)?.id || tree[0]?.id);
  };

  const removeControl = (controlId?: string) => {
    const targetId = controlId || selectedControlId;
    const target = layoutControls.find((control) => control.id === targetId);
    if (!target) {
      message.warning('请先选择画布控件');
      return;
    }
    commitLayoutChange((current) => unwrapLayoutControl(current, targetId));
    setSelectedControlId('');
    message.success(isLayoutContainer(target) ? '容器已移除，内部控件已移到上一级' : '已从画布移出控件，字段资产仍然保留');
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (activeTab !== 'form' || isEditableTarget(event.target) || (event.target instanceof Element && event.target.closest('.ant-modal, .ant-drawer'))) return;
      const metaKey = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (metaKey && key === 'c') {
        event.preventDefault();
        copyControlToClipboard(selectedControl);
      }
      if (metaKey && key === 'v') {
        event.preventDefault();
        pasteCopiedControl();
      }
      if (metaKey && key === 'z') {
        event.preventDefault();
        undoLayoutChange();
      }
      if (metaKey && key === 'y') {
        event.preventDefault();
        redoLayoutChange();
      }
      if (!metaKey && (event.key === 'Delete' || event.key === 'Backspace') && selectedControl) {
        event.preventDefault();
        removeControl(selectedControl.id);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, copiedControl, copiedTree, selectedControl, selectedControlId, layoutControls]);

  const renderControlActions = (control: LayoutControl) => (
    <span className="designer-control-actions" onClick={(event) => event.stopPropagation()}>
      <HolderOutlined className="designer-drag-handle" title="拖动调整位置" />
      <Button size="small" type="text" title="复制" aria-label={`复制${control.name}`} icon={<CopyOutlined />} onClick={() => duplicateControl(control)} />
      <Button size="small" type="text" danger title="移出画布" aria-label={`移出${control.name}`} icon={<DeleteOutlined />} onClick={() => removeControl(control.id)} />
    </span>
  );

  const getCanvasControlDragProps = (control: LayoutControl) => ({
    tabIndex: embedded ? 0 : undefined,
    role: embedded ? 'group' : undefined,
    'aria-label': embedded ? `编辑字段：${control.name}` : undefined,
    onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!embedded || event.target !== event.currentTarget || !['Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      setSelectedControlId(control.id);
      setSelectedAssetKey(control.fieldKey || '');
    },
    draggable: true,
    onDragStart: (event: React.DragEvent<HTMLDivElement>) => {
      event.stopPropagation();
      event.dataTransfer.setData('layoutControlId', control.id);
      event.dataTransfer.effectAllowed = 'move';
      setDraggedControlId(control.id);
      setCanvasDragActive(true);
      setSelectedControlId(control.id);
      if (control.fieldKey) setSelectedAssetKey(control.fieldKey);
    },
    onDragEnd: () => {
      setDraggedControlId('');
      setDropHint(null);
      setCanvasDragActive(false);
    },
    onDragOver: (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'move';
      const rect = event.currentTarget.getBoundingClientRect();
      const position: DropPosition = event.clientY > rect.top + rect.height / 2 ? 'after' : 'before';
      setDropHint({ controlId: control.id, position });
    },
    onDragLeave: (event: React.DragEvent<HTMLDivElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
        setDropHint((current) => (current?.controlId === control.id ? null : current));
      }
    },
    onDrop: (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const sourceId = event.dataTransfer.getData('layoutControlId');
      if (sourceId) moveLayoutControl(sourceId, control.id, dropHint?.controlId === control.id ? dropHint.position : 'before');
      else {
        const field = baseConfig.fields.find(item => item.key === event.dataTransfer.getData('fieldKey'));
        const component = componentGroups.flatMap(group => group.items).find(item => item.key === event.dataTransfer.getData('componentKey'));
        const added = field ? makeFieldControl(field) : component ? makeComponentControl(component) : null;
        if (added) { commitLayoutChange(current => placeLayoutControl([...current, added], added.id, control.parentId, control.slotId, control.id)); setSelectedControlId(added.id); }
      }
      setDraggedControlId('');
      setDropHint(null);
      setCanvasDragActive(false);
    },
  });

  const renderControlLabel = (control: LayoutControl) => (
    <span className={`designer-field-title ${control.rules.required.enabled ? 'designer-required-label' : ''}`}>{control.name}</span>
  );

  const renderComponentInput = (control: LayoutControl) => <FieldControl preview type={control.controlType} label={control.name} disabled={embedded || control.rules.readonly.enabled} placeholder={control.placeholder} settings={control.typeSettings} options={optionSourceToOptions(control.optionSource)} />;

  const handleContainerDrop=(event:React.DragEvent, parentId:string,slotId:string)=>{
    event.preventDefault();event.stopPropagation();
    let id=event.dataTransfer.getData('layoutControlId');
    const field=baseConfig.fields.find(f=>f.key===event.dataTransfer.getData('fieldKey'));
    const component=componentGroups.flatMap(g=>g.items).find(c=>c.key===event.dataTransfer.getData('componentKey'));
    const added=!id?(field?makeFieldControl(field):component?makeComponentControl(component):null):null;
    if(added)id=added.id;if(!id)return;
    commitLayoutChange(current=>placeLayoutControl(added?[...current,added]:current,id,parentId,slotId));
    setSelectedControlId(id);setCanvasDragActive(false);setDraggedControlId('');setDropHint(null);
  };

  const renderContainerProperties = () => {
    if (!selectedControl) return null;
    const control = selectedControl;
    const updateLayout = (patch: NonNullable<LayoutControl['layout']>) => updateSelectedControl({ layout: { ...control.layout, ...patch } });
    const parentOptions = layoutControls.filter(item => isLayoutContainer(item) && !layoutDescendants(layoutControls, control.id).has(item.id));
    const parent = layoutControls.find(item => item.id === control.parentId);
    return <section className="designer-prop-section"><strong className="designer-prop-section-title">{isLayoutContainer(control) ? '容器配置' : '所在位置'}</strong>
      <label><span>所属容器</span><Select aria-label="所属容器" value={control.parentId || 'root'} options={[{ value: 'root', label: '画布顶层' }, ...parentOptions.map(item => ({ value: item.id, label: item.name }))]} onChange={value => commitLayoutChange(current => placeLayoutControl(current, control.id, value === 'root' ? undefined : value))} /></label>
      {parent && <label><span>容器位置</span><Select aria-label="容器位置" value={control.slotId} options={layoutSlots(parent).map(slot => ({ value: slot.id, label: slot.label }))} onChange={value => { commitLayoutChange(current => placeLayoutControl(current, control.id, parent.id, value)); if (parent.controlType === 'tabs') setContainerTabs(current => ({ ...current, [parent.id]: value })); }} /></label>}
      {isLayoutContainer(control) && <>
        <label><span>内容间距</span><InputNumber aria-label="内容间距" min={0} max={40} value={control.layout?.gap ?? 12} onChange={gap => updateLayout({ gap: gap ?? 12 })} suffix="px" /></label>
        {control.controlType === 'container' && <><label><span>允许折叠</span><Switch size="small" checked={Boolean(control.layout?.collapsible)} onChange={collapsible => updateLayout({ collapsible })} /></label>{control.layout?.collapsible && <label><span>默认收起</span><Switch size="small" checked={Boolean(control.layout.defaultCollapsed)} onChange={defaultCollapsed => updateLayout({ defaultCollapsed })} /></label>}</>}
        {control.controlType === 'two-columns' && <><label><span>列数</span><Select aria-label="列数" value={control.layout?.columns || 2} options={[2,3,4].map(value => ({ value, label: `${value} 列` }))} onChange={columns => updateLayout({ columns, ratios: Array.from({ length: columns }, (_, i) => control.layout?.ratios?.[i] || 1) })} /></label><small>减少列数时，原列中的控件会移至第一列。</small>{layoutSlots(control).map((slot, index) => <label key={slot.id}><span>{slot.label}比例</span><InputNumber min={1} max={12} value={control.layout?.ratios?.[index] || 1} onChange={value => updateLayout({ ratios: layoutSlots(control).map((_, i) => i === index ? value || 1 : control.layout?.ratios?.[i] || 1) })} /></label>)}</>}
        {control.controlType === 'tabs' && <><div className="designer-container-tab-settings">{layoutSlots(control).map(slot => <div key={slot.id}><Input aria-label={`页签名称：${slot.label}`} value={slot.label} onChange={event => updateLayout({ tabs: layoutSlots(control).map(tab => tab.id === slot.id ? { ...tab, label: event.target.value } : tab) })} /><Button danger size="small" disabled={layoutSlots(control).length < 2} onClick={() => { const remaining = layoutSlots(control).filter(tab => tab.id !== slot.id); updateLayout({ tabs: remaining }); setContainerTabs(current => ({ ...current, [control.id]: remaining[0].id })); }}>移除</Button></div>)}</div><Button size="small" icon={<PlusOutlined />} onClick={() => updateLayout({ tabs: [...layoutSlots(control), { id: `tab-${createUuid()}`, label: `页签 ${layoutSlots(control).length + 1}` }] })}>新增页签</Button><small>移除页签后，其控件会保留在第一个页签。</small></>}
      </>}
    </section>;
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
      const activeTab = containerTabs[control.id] || slots[0].id;
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
    return <section className="designer-prop-section"><strong className="designer-prop-section-title">{editable?'明细表配置':'关联表配置'}</strong>
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
    </section>;
  };

  const activeRule = ruleModal && selectedControl?.id === ruleModal.controlId
    ? normalizeControlRules(selectedControl.rules, selectedField)[ruleModal.ruleKey]
    : null;
  const activeRuleLabel = ruleModal ? ruleLabels[ruleModal.ruleKey] : '';
  const activeRuleStrategyOptions = ruleModal ? ruleStrategyOptions[ruleModal.ruleKey] || [] : [];
  const activeRuleConditionGroups = activeRule ? getRuleConditionGroups(activeRule) : [];
  const conditionFieldOptions = baseConfig.fields.map((field) => ({ value: field.key, label: field.name }));
  const conditionFieldByKey = new Map(baseConfig.fields.map((field) => [field.key, field]));
  const renderRuleConditionValueControl = (
    condition: ControlRuleCondition,
    groupIndex: number,
    rowIndex: number,
  ) => {
    if (!ruleModal) return null;
    const sourceField = conditionFieldByKey.get(condition.sourceField || '');
    const businessType = getFieldBusinessType(sourceField);
    const updateValue = (value: unknown) => updateSelectedRuleConditionRow(ruleModal.ruleKey, groupIndex, rowIndex, {
      value: value === undefined || value === null ? '' : String(value),
    });
    if (businessType === 'number') {
      const numericValue = condition.value === undefined || condition.value === '' ? undefined : Number(condition.value);
      return (
        <InputNumber
          placeholder="条件值"
          value={Number.isFinite(numericValue) ? numericValue : undefined}
          onChange={updateValue}
          style={{ width: '100%' }}
        />
      );
    }
    if (businessType === 'enum' || businessType === 'person' || businessType === 'relation') {
      return (
        <Select
          allowClear
          placeholder="条件值"
          value={condition.value || undefined}
          onChange={updateValue}
          options={optionSourceToOptions(sourceField?.optionSource, sourceField?.placeholder)}
        />
      );
    }
    if (businessType === 'date' || businessType === 'datetime') {
      return (
        <Input
          placeholder={businessType === 'date' ? 'YYYY-MM-DD' : 'YYYY-MM-DD HH:mm:ss'}
          prefix={<CalendarOutlined />}
          value={condition.value || ''}
          onChange={(event) => updateValue(event.target.value)}
        />
      );
    }
    return (
      <Input
        placeholder={sourceField ? '条件值' : '请先选择目标字段'}
        value={condition.value || ''}
        onChange={(event) => updateValue(event.target.value)}
      />
    );
  };
  const activePreviewRole = permissionRoles.includes(previewRole) ? previewRole : permissionRoles[0];
  const previewRoleRecord = identityRoleRecords.find(role => role.label === activePreviewRole || role.name === activePreviewRole);
  const previewRoleIndex = Math.max(permissionRoles.indexOf(activePreviewRole), 0);
  const previewRoleKind = previewRoleIndex === 0 ? 'system' : previewRoleIndex < 4 ? 'manager' : 'operator';
  const previewRoleDraft = permissionDrafts[activePreviewRole] || permissionDrafts[previewRoleRecord?.name || '']
    || permissionDraftsFromRows(formPermissionRows, identityRoleRecords, baseConfig.fields, permissionOrgUnitIds)[activePreviewRole]
    || makePermissionDesignDraft(previewRoleKind, permissionOrgUnitIds);
  const previewRoleCanView = previewRoleDraft.page.enter !== false && previewRoleDraft.actions.view !== false;
  const previewRoleCanFill = selectedPreviewFlowNode?.type === 'endEvent' ? false
    : previewRoleDraft.actions[selectedPreviewFlowNode && selectedPreviewFlowNode.type !== 'startEvent' ? 'approve' : 'create'] !== false;
  const getPreviewFieldPermission = (fieldKey?: string) => {
    if (!fieldKey) return undefined;
    const fieldIndex = baseConfig.fields.findIndex(field => field.key === fieldKey);
    const field = baseConfig.fields[fieldIndex];
    const rolePermission = field ? previewRoleDraft.fields[fieldKey] || defaultRoleFieldPermission(field, fieldIndex, previewRoleKind) : undefined;
    return previewFieldPermission(selectedPreviewFlowNode?.fieldPermissions?.[fieldKey], rolePermission, previewRoleCanView, previewRoleCanFill);
  };
  const previewControls = layoutControls.filter((control) => {
    if (control.source !== 'field') return true;
    const permission = getPreviewFieldPermission(control.fieldKey);
    return permission?.visible !== false;
  });
  const renderPreviewContent = () => {
    return <Form onCopyCapture={protectCopy} onCutCapture={protectCopy} form={previewForm} layout="vertical" onValuesChange={(_,values)=>setPreviewValues(values)}>
      {previewRuleError&&<small role="alert">{previewRuleError}</small>}
      <div className="create-form-grid" style={{ gap: canvasSettings.gap }}>
        {previewControls.filter(control => !control.parentId).map(control => renderCanvasControl(control, true))}
      </div>
    </Form>;
  };


  const viewFieldOptions = baseConfig.fields.map((field) => ({ value: field.key, label: `${field.name} (${field.key})` }));
  const sortedViewFilters = sortByOrder(viewConfig.filters);
  const sortedViewColumns = sortByOrder(viewConfig.table.columns);
  const enabledViewColumns = sortedViewColumns.filter((column) => column.enabled);

  const renderViewFilterControl = (filter: ViewFilterConfig) => {
    const placeholder = filter.placeholder || filter.label;
    if (filter.controlType === 'select' || filter.controlType === 'relation') {
      return <Select allowClear disabled placeholder={placeholder} options={[{ value: 'demo', label: placeholder }]} />;
    }
    if (filter.controlType === 'dateRange') {
      return <Input disabled prefix={<CalendarOutlined />} placeholder="开始日期  →  结束日期" />;
    }
    return <Input disabled prefix={filter.controlType === 'keyword' ? <SearchOutlined /> : undefined} placeholder={placeholder} />;
  };

  const renderViewFilterRow = (filter: ViewFilterConfig, index: number) => {
    return (
      <div
        className={`view-config-row ${draggedViewFilterId === filter.id ? 'view-config-row-dragging' : ''}`}
        draggable
        key={filter.id}
        onDragEnd={() => setDraggedViewFilterId('')}
        onDragOver={(event) => {
          if (!draggedViewFilterId || draggedViewFilterId === filter.id) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
        }}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move';
          setDraggedViewFilterId(filter.id);
        }}
        onDrop={(event) => {
          event.preventDefault();
          reorderViewFilters(draggedViewFilterId, filter.id);
          setDraggedViewFilterId('');
        }}
      >
        <div
          className="view-config-row-main view-filter-config-main"
        >
          <label className="view-filter-config-form-item">
            <span className="view-filter-config-label">{filter.label}</span>
            <span className="view-filter-config-control">{renderViewFilterControl(filter)}</span>
          </label>
        </div>
      </div>
    );
  };

  const renderViewColumnRow = (column: ViewTableColumnConfig, index: number) => {
    const expanded = expandedViewRow === column.id;
    return (
      <div className={`view-config-row ${expanded ? 'view-config-row-expanded' : ''}`} key={column.id}>
        <button className="view-config-row-main" type="button" onClick={() => setExpandedViewRow(expanded ? '' : column.id)}>
          <span className="view-config-order">{index + 1}</span>
          <span className="view-config-primary">
            <strong>{column.label}</strong>
            <small>{column.fieldName} · {viewColumnRenderOptions.find((item) => item.value === column.renderType)?.label} · {column.width || 140}px</small>
          </span>
          <Tag color={column.enabled ? 'green' : 'default'}>{column.enabled ? '展示' : '隐藏'}</Tag>
          {column.sortable && <Tag color="blue">可排序</Tag>}
          {column.fixed && <Tag color="purple">固定{column.fixed === 'left' ? '左侧' : '右侧'}</Tag>}
        </button>
        <Space size={4} className="view-config-row-actions">
          <Button size="small" onClick={() => moveViewItem('column', column.id, -1)} disabled={index === 0}>上移</Button>
          <Button size="small" onClick={() => moveViewItem('column', column.id, 1)} disabled={index === sortedViewColumns.length - 1}>下移</Button>
          <Switch size="small" checked={column.enabled} onChange={(enabled) => updateViewColumn(column.id, { enabled })} />
        </Space>
        {expanded && (
          <div className="view-config-inline-editor view-config-inline-editor-wide">
            <label><span>绑定字段</span><Select value={column.fieldName} options={viewFieldOptions} onChange={(fieldName) => {
              const field = baseConfig.fields.find((item) => item.key === fieldName);
              updateViewColumn(column.id, { fieldName, label: field?.name || column.label });
            }} /></label>
            <label><span>列标题</span><Input value={column.label} onChange={(event) => updateViewColumn(column.id, { label: event.target.value })} /></label>
            <label><span>列宽</span><InputNumber min={80} max={420} value={column.width || 140} onChange={(width) => updateViewColumn(column.id, { width: Number(width || 140) })} /></label>
            <label><span>渲染类型</span><Select value={column.renderType} options={viewColumnRenderOptions} onChange={(renderType) => updateViewColumn(column.id, { renderType })} /></label>
            <label><span>固定列</span><Select value={column.fixed || 'none'} options={[{ value: 'none', label: '不固定' }, { value: 'left', label: '固定左侧' }, { value: 'right', label: '固定右侧' }]} onChange={(value) => updateViewColumn(column.id, { fixed: value === 'none' ? undefined : value as 'left' | 'right' })} /></label>
            <label><span>空值展示</span><Input value={column.emptyText} onChange={(event) => updateViewColumn(column.id, { emptyText: event.target.value })} /></label>
            <label><span>允许排序</span><Switch size="small" checked={column.sortable} onChange={(sortable) => updateViewColumn(column.id, { sortable })} /></label>
          </div>
        )}
      </div>
    );
  };

  const renderDataViewDesigner = () => (
    <div className="data-view-designer">
      <ViewTabsEditor config={storedViewConfig} activeId={activeViewTab.id} onSelect={(id) => { setActiveViewTabId(id); setExpandedViewRow(''); }}
        onChange={(next) => { setViewConfig(next); markUnsaved(); }}
        roles={identityRoleRecords.map((role) => ({ value: role.id, label: role.label }))}
        users={identityUsers.map((user) => ({ value: user.id, label: user.label }))}
        organizations={permissionOrgUnits.map((org) => ({ value: org.id, label: org.name }))} />
      <section className="view-config-section">
        <div className="view-config-section-head">
          <div><strong>筛选区</strong><span>配置查询条件、操作符、默认值和常用/高级位置。</span></div>
          <Button
            aria-label="新增筛选项"
            icon={<PlusOutlined />}
            onClick={() => setFilterFieldPickerOpen(true)}
            size="small"
            title="新增筛选项"
            type="text"
          />
        </div>
        <div className="view-config-filter-shell">
          <div className="view-config-list view-config-filter-grid">
            {sortedViewFilters.map(renderViewFilterRow)}
          </div>
          <Space className="view-config-filter-actions">
            <Button size="small" disabled title="设计预览，不执行查询">重置</Button>
            <Button icon={<SearchOutlined />} size="small" type="primary" disabled title="发布后在运行页查询">查询</Button>
          </Space>
        </div>
      </section>

      <section className="view-config-section">
        <div className="view-config-section-head">
          <div><strong>数据列表区</strong><span>配置表格列、操作、排序、分页和行交互。</span></div>
          <Button
            aria-label="新增列表字段"
            icon={<PlusOutlined />}
            onClick={() => setTableFieldPickerOpen(true)}
            size="small"
            title="新增列表字段"
            type="text"
          />
        </div>
        <Space wrap style={{marginBottom:12}}><Checkbox checked={viewConfig.table.toolbarActions.includes('import')} onChange={event=>updateViewConfig(current=>({...current,table:{...current.table,toolbarActions:event.target.checked?[...new Set([...current.table.toolbarActions,'import'])]:current.table.toolbarActions.filter(action=>action!=='import')}}))}>显示批量导入入口</Checkbox><Typography.Text type="secondary">发布后生效；导入还需角色具有“导入”和“新增”权限。</Typography.Text></Space>
        <div className="view-config-table-shell">
          <div className="view-config-table-preview">
            <div
              className="view-config-table-head-row"
              style={{ gridTemplateColumns: `${enabledViewColumns.map((column) => `${column.width || 140}px`).join(' ')} 128px` }}
            >
              {enabledViewColumns.map((column) => (
                <div
                  className={`view-config-table-head-cell ${draggedViewColumnId === column.id ? 'view-config-table-cell-dragging' : ''}`}
                  draggable
                  key={column.id}
                  onDragEnd={() => setDraggedViewColumnId('')}
                  onDragOver={(event) => {
                    if (!draggedViewColumnId || draggedViewColumnId === column.id) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                  }}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = 'move';
                    setDraggedViewColumnId(column.id);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    reorderViewColumns(draggedViewColumnId, column.id);
                    setDraggedViewColumnId('');
                  }}
                  title="拖拽调整列顺序"
                >
                  {column.label}
                </div>
              ))}
              <div className="view-config-table-head-cell view-config-table-action-cell">操作</div>
            </div>
            <div className="view-config-table-empty">
              暂无数据
            </div>
          </div>
        </div>
      </section>

    </div>
  );

  const updateAnalyticsDesign = (updater: (current: AnalyticsDesign) => AnalyticsDesign) => {
    setAnalyticsDesign((current) => updater(current));
    markUnsaved();
  };

  const updateAnalyticsDataset = (id: string, patch: Partial<AnalyticsDataset>) => {
    updateAnalyticsDesign((current) => ({
      ...current,
      datasets: current.datasets.map((dataset) => (dataset.id === id ? { ...dataset, ...patch } : dataset)),
    }));
  };

  const updateAnalyticsMetric = (id: string, patch: Partial<AnalyticsMetric>) => {
    updateAnalyticsDesign((current) => ({
      ...current,
      metrics: current.metrics.map((metric) => (metric.id === id ? { ...metric, ...patch } : metric)),
    }));
  };

  const updateAnalyticsWidget = (id: string, patch: Partial<AnalyticsWidget>) => {
    updateAnalyticsDesign((current) => ({
      ...current,
      widgets: current.widgets.map((widget) => (widget.id === id ? { ...widget, ...patch } : widget)),
    }));
  };

  const updateAnalyticsStyle = (patch: Partial<AnalyticsStyle>) => {
    updateAnalyticsDesign((current) => ({
      ...current,
      style: { ...makeDefaultAnalyticsStyle(), ...(current.style || {}), ...patch },
    }));
  };

  const addAnalyticsDataset = () => {
    const datasetId = `dataset-${Date.now()}`;
    updateAnalyticsDesign((current) => ({
      ...current,
      datasets: [
        ...current.datasets,
        {
          id: datasetId,
          name: '新数据集',
          sourceType: 'businessForm',
          source: platformForm?.code || baseConfig.id,
          refreshMode: 'realtime',
          dimensions: [],
          measures: [],
        },
      ],
    }));
  };

  const addAnalyticsMetric = () => {
    const datasetId = analyticsDesign.datasets[0]?.id || `${baseConfig.id}-dataset`;
    updateAnalyticsDesign((current) => ({
      ...current,
      metrics: [
        ...current.metrics,
        {
          id: `metric-${Date.now()}`,
          name: '新指标',
          expression: 'count(*)',
          datasetId,
          format: 'number',
          threshold: '按需配置',
        },
      ],
    }));
  };

  const addAnalyticsWidget = (type: AnalyticsWidgetType) => {
    const datasetId = analyticsDesign.datasets[0]?.id || `${baseConfig.id}-dataset`;
    const metricId = analyticsDesign.metrics[0]?.id;
    const widgetId = `widget-${Date.now()}`;
    updateAnalyticsDesign((current) => ({
      ...current,
      widgets: [
        ...current.widgets,
        {
          id: widgetId,
          title: type === 'metric-card' ? '指标卡' : type === 'detail-table' ? '明细表' : '新图表',
          type,
          datasetId,
          metricIds: metricId ? [metricId] : [],
          dimension: current.datasets[0]?.dimensions[0],
          width: type === 'metric-card' || type === 'detail-table' ? 'full' : 'half',
          interaction: type === 'detail-table' ? 'navigate' : 'filter',
        },
      ],
    }));
    setSelectedAnalyticsWidgetId(widgetId);
  };

  const analyticsDatasetOptions = analyticsDesign.datasets.map((dataset) => ({ value: dataset.id, label: dataset.name }));
  const analyticsWidgetOptions = analyticsDesign.widgets.map((widget) => ({ value: widget.id, label: widget.title }));
  const selectedAnalyticsWidget = analyticsDesign.widgets.find((widget) => widget.id === selectedAnalyticsWidgetId) || analyticsDesign.widgets[0];
  const analyticsStyle = { ...makeDefaultAnalyticsStyle(), ...(analyticsDesign.style || {}) };
  const analyticsCanvasStyle: React.CSSProperties = {
    background: analyticsStyle.background,
    gap: analyticsStyle.componentGap,
  };
  const analyticsWidgetStyle: React.CSSProperties = {
    borderRadius: analyticsStyle.cardRadius,
    borderColor: analyticsStyle.cardBorder === 'none' ? 'transparent' : analyticsStyle.cardBorder === 'strong' ? '#2c6e84' : '#dce5ec',
  };

  const renderAnalyticsDatasetDesigner = () => (
    <div className="analytics-designer analytics-dataset-designer">
      <section className="analytics-section">
        <div className="analytics-section-head">
          <div>
            <strong>数据源与数据集</strong>
            <span>配置看板取数来源、刷新策略、维度字段和可计算字段。</span>
          </div>
          <Space size={6}>
            <Tag color="blue">{analyticsDesign.datasets.length} 个数据集</Tag>
            <Button size="small" icon={<PlusOutlined />} onClick={addAnalyticsDataset}>新增数据集</Button>
          </Space>
        </div>
        <div className="analytics-dataset-grid">
          {analyticsDesign.datasets.map((dataset) => (
            <div className="analytics-dataset-card" key={dataset.id}>
              <div className="analytics-card-title">
                <DatabaseOutlined />
                <Input aria-label="数据集名称" value={dataset.name} onChange={(event) => updateAnalyticsDataset(dataset.id, { name: event.target.value })} />
                <Button size="small" danger title="删除数据集" icon={<DeleteOutlined />} onClick={() => {
                  if (analyticsDesign.metrics.some(metric => metric.datasetId === dataset.id) || analyticsDesign.widgets.some(widget => widget.datasetId === dataset.id)) { message.warning('请先删除或重新绑定引用此数据集的指标和组件'); return; }
                  updateAnalyticsDesign(current => ({...current, datasets: current.datasets.filter(item => item.id !== dataset.id)}));
                }} />
              </div>
              <div className="analytics-card-form-grid">
                <label><span>来源类型</span><Select value={dataset.sourceType} options={[
                  { value: 'businessForm', label: '业务表单' },
                  { value: 'ontology', label: '本体对象（暂未接入）', disabled: true },
                  { value: 'sql', label: 'SQL 数据集（暂未接入）', disabled: true },
                  { value: 'api', label: 'API 数据源（暂未接入）', disabled: true },
                ]} onChange={(sourceType) => updateAnalyticsDataset(dataset.id, { sourceType })} /></label>
                <label><span>来源表单编码</span><Select showSearch value={dataset.source} optionFilterProp="label" options={referenceForms.map(form => ({ value: form.code, label: `${form.name} (${form.code})` }))} onChange={(source) => updateAnalyticsDataset(dataset.id, { source, dimensions: [], measures: [] })} /><small>切换来源后请重新配置该表单的维度与数值字段。</small></label>
                <label><span>刷新策略</span><Select value={dataset.refreshMode} options={[
                  { value: 'realtime', label: '自动读取（每 30 秒）' },
                  { value: 'scheduled', label: '定时刷新' },
                  { value: 'manual', label: '手动刷新' },
                ]} onChange={(refreshMode) => updateAnalyticsDataset(dataset.id, { refreshMode })} /></label>
                {dataset.refreshMode === 'scheduled' && <label><span>刷新间隔（秒）</span><InputNumber min={10} max={86400} value={dataset.refreshInterval || 60} onChange={value => updateAnalyticsDataset(dataset.id, { refreshInterval: Number(value || 60) })} /></label>}
              </div>
              <div className="analytics-card-form-grid analytics-card-form-grid-wide">
                <label><span>维度字段</span><Select mode="multiple" options={(analyticsSourceFields[dataset.source] || []).filter(field => !field.archived).map(field => ({value: field.field_name, label: `${field.label} (${field.field_name})`}))} value={dataset.dimensions} onChange={(dimensions) => updateAnalyticsDataset(dataset.id, { dimensions })} /></label>
                <label><span>指标字段</span><Select mode="multiple" options={(analyticsSourceFields[dataset.source] || []).filter(field => !field.archived && /number|int|float|decimal|numeric|double|currency/.test(field.field_type)).map(field => ({value: field.field_name, label: `${field.label} (${field.field_name})`}))} value={dataset.measures} onChange={(measures) => updateAnalyticsDataset(dataset.id, { measures })} /></label>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="analytics-section">
        <div className="analytics-section-head">
          <div>
            <strong>指标口径</strong>
            <span>支持 count(*)、sum(actual)、avg(actual)、count_distinct(subject)、count_if(status == "已关闭")。百分比公式返回比例，例如 sum(actual) / sum(target)，展示时乘以 100；分母为零显示 —。</span>
          </div>
          <Button size="small" icon={<PlusOutlined />} onClick={addAnalyticsMetric}>新增指标</Button>
        </div>
        <div className="analytics-metric-list">
          {analyticsDesign.metrics.map((metric) => (
            <div className="analytics-metric-row" key={metric.id}>
              <Input value={metric.name} onChange={(event) => updateAnalyticsMetric(metric.id, { name: event.target.value })} />
              <Select value={metric.datasetId} options={analyticsDatasetOptions} onChange={(datasetId) => updateAnalyticsMetric(metric.id, { datasetId })} />
              <Input value={metric.expression} onChange={(event) => updateAnalyticsMetric(metric.id, { expression: event.target.value })} />
              <Select value={metric.format} options={[
                { value: 'number', label: '数值' },
                { value: 'percent', label: '百分比' },
                { value: 'currency', label: '金额' },
                { value: 'duration', label: '时长' },
              ]} onChange={(format) => updateAnalyticsMetric(metric.id, { format })} />
              <Input aria-label="指标阈值" value={metric.threshold} onChange={(event) => updateAnalyticsMetric(metric.id, { threshold: event.target.value })} />
              <Button danger size="small" title="删除指标" icon={<DeleteOutlined />} onClick={() => updateAnalyticsDesign(current => ({...current, metrics: current.metrics.filter(item => item.id !== metric.id), widgets: current.widgets.map(widget => ({...widget, metricIds: widget.metricIds.filter(id => id !== metric.id)}))}))} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );

  const renderAnalyticsWidgetPreview = (widget: AnalyticsWidget) => {
    if (widget.type === 'metric-card') {
      return (
        <div className="analytics-widget-metrics">
          {widget.metricIds.map((metricId) => analyticsDesign.metrics.find((metric) => metric.id === metricId)).filter(Boolean).map((metric) => (
            <div key={metric!.id}><span>{metric!.name}</span><strong>{'—'}</strong></div>
          ))}
        </div>
      );
    }
    if (widget.type === 'detail-table' || widget.type === 'rank-table') {
      return (
        <div className="analytics-widget-table">
          <div><span>对象</span><span>指标</span><span>状态</span></div>
          {[1, 2, 3].map((row) => <div key={row}><span>示意行 {row}</span><span>—</span><span>—</span></div>)}
        </div>
      );
    }
    return (
      <div className={`analytics-widget-chart analytics-widget-chart-${widget.type}`}>
        <span />
        <span />
        <span />
        <span />
      </div>
    );
  };

  const renderAnalyticsDashboardDesigner = () => (
    <div className="analytics-board-workbench">
      <aside className="analytics-board-left form-designer-left">
        <div className="designer-panel-head">
          <strong>控件</strong>
          <span>BI 组件库</span>
        </div>
        <div className="designer-library-search">
          <Input allowClear prefix={<SearchOutlined />} placeholder="搜索组件类型" value={analyticsLibrarySearch} onChange={event => setAnalyticsLibrarySearch(event.target.value)} />
          <small>点击添加组件；拖动画布中的组件可调整顺序。画布为布局示意，真实数据请到运行页查看。</small>
        </div>
        <div className="designer-component-library">
          <section className="designer-component-group">
            <div className="designer-group-title">
              <span>分析组件</span>
              <small>点击添加</small>
            </div>
            <div className="designer-component-list analytics-control-list">
              {[
                { type: 'metric-card' as const, name: '指标卡', desc: '展示核心 KPI 与阈值状态' },
                { type: 'line' as const, name: '折线图', desc: '展示时间趋势' },
                { type: 'bar' as const, name: '柱状图', desc: '展示分类对比' },
                { type: 'pie' as const, name: '饼图', desc: '展示占比结构' },
                { type: 'rank-table' as const, name: '排行表', desc: '展示 Top N 排名' },
                { type: 'detail-table' as const, name: '明细表', desc: '承接下钻和跳转' },
              ].filter(item => item.name.includes(analyticsLibrarySearch.trim()) || item.desc.includes(analyticsLibrarySearch.trim())).map((item) => (
                <button className="designer-component analytics-control-item" data-desc={item.desc} title={`${item.name} / ${item.desc}`} key={item.type} type="button" onClick={() => addAnalyticsWidget(item.type)}>
                  <span>{item.name}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      </aside>

      <main className="analytics-board-middle form-designer-canvas">
        <div className="canvas-board create-form-canvas analytics-dashboard-shell">
          <div className="create-form-modal analytics-dashboard-modal">
            <section className="create-form-grid analytics-dashboard-canvas" style={analyticsCanvasStyle}>
              {analyticsDesign.widgets.map((widget) => (
                <button
                  className={`analytics-widget analytics-widget-${widget.width} ${selectedAnalyticsWidget?.id === widget.id ? 'analytics-widget-selected' : ''}`}
                  key={widget.id}
                  style={analyticsWidgetStyle}
                  type="button"
                  draggable
                  onDragStart={() => setDraggedAnalyticsWidgetId(widget.id)}
                  onDragEnd={() => setDraggedAnalyticsWidgetId('')}
                  onDragOver={event => event.preventDefault()}
                  onDrop={event => { event.preventDefault(); if (!draggedAnalyticsWidgetId || draggedAnalyticsWidgetId === widget.id) return; updateAnalyticsDesign(current => { const widgets = [...current.widgets]; const from = widgets.findIndex(item => item.id === draggedAnalyticsWidgetId); const to = widgets.findIndex(item => item.id === widget.id); if (from < 0 || to < 0) return current; widgets.splice(to, 0, widgets.splice(from, 1)[0]); return {...current, widgets}; }); setDraggedAnalyticsWidgetId(''); }}
                  onClick={() => setSelectedAnalyticsWidgetId(widget.id)}
                >
                  <div className="analytics-widget-head">
                    <strong>{widget.title}</strong>
                    <Tag>{widget.type}</Tag>
                  </div>
                  {renderAnalyticsWidgetPreview(widget)}
                </button>
              ))}
            </section>
          </div>
        </div>
      </main>

      <aside className="analytics-board-right form-designer-right">
        <div className="designer-panel-head">
          <strong>属性</strong>
          <span>{selectedAnalyticsWidget?.title || '画布'}</span>
        </div>
        <div className="designer-prop-summary">
          <span className="designer-prop-summary-badge">{selectedAnalyticsWidget ? '组件' : '画布'}</span>
          <strong>{selectedAnalyticsWidget?.title || baseConfig.name}</strong>
          <small>{selectedAnalyticsWidget ? `${selectedAnalyticsWidget.type} · ${selectedAnalyticsWidget.metricIds.length} 个指标` : `${analyticsDesign.widgets.length} 个组件`}</small>
        </div>

        <div className="designer-props">
          {selectedAnalyticsWidget && (
            <section className="designer-prop-section designer-prop-section-primary">
              <strong className="designer-prop-section-title">组件属性</strong>
              <Space wrap><Button size="small" disabled={analyticsDesign.widgets[0]?.id === selectedAnalyticsWidget.id} onClick={() => updateAnalyticsDesign(current => { const widgets = [...current.widgets]; const index = widgets.findIndex(item => item.id === selectedAnalyticsWidget.id); if(index > 0) [widgets[index - 1], widgets[index]] = [widgets[index], widgets[index - 1]]; return {...current, widgets}; })}>上移</Button>
              <Button size="small" disabled={analyticsDesign.widgets[analyticsDesign.widgets.length - 1]?.id === selectedAnalyticsWidget.id} onClick={() => updateAnalyticsDesign(current => { const widgets = [...current.widgets]; const index = widgets.findIndex(item => item.id === selectedAnalyticsWidget.id); if(index >= 0 && index < widgets.length - 1) [widgets[index + 1], widgets[index]] = [widgets[index], widgets[index + 1]]; return {...current, widgets}; })}>下移</Button>
              <Button size="small" danger onClick={() => { updateAnalyticsDesign(current => ({...current, widgets: current.widgets.filter(item => item.id !== selectedAnalyticsWidget.id), interactions: current.interactions.filter(link => link.sourceWidgetId !== selectedAnalyticsWidget.id && link.targetWidgetId !== selectedAnalyticsWidget.id)})); setSelectedAnalyticsWidgetId(''); }}>删除组件</Button></Space>
              <label><span>标题</span><Input value={selectedAnalyticsWidget.title} onChange={(event) => updateAnalyticsWidget(selectedAnalyticsWidget.id, { title: event.target.value })} /></label>
              <label><span>图表类型</span><Select value={selectedAnalyticsWidget.type} options={[
                { value: 'metric-card', label: '指标卡' },
                { value: 'line', label: '折线图' },
                { value: 'bar', label: '柱状图' },
                { value: 'pie', label: '饼图' },
                { value: 'rank-table', label: '排行表' },
                { value: 'detail-table', label: '明细表' },
              ]} onChange={(type) => updateAnalyticsWidget(selectedAnalyticsWidget.id, { type })} /></label>
              <label><span>占位宽度</span><Select value={selectedAnalyticsWidget.width} options={[{ value: 'quarter', label: '25%' }, { value: 'half', label: '50%' }, { value: 'full', label: '100%' }]} onChange={(width) => updateAnalyticsWidget(selectedAnalyticsWidget.id, { width })} /></label>
            </section>
          )}

          {selectedAnalyticsWidget && (
            <section className="designer-prop-section">
              <strong className="designer-prop-section-title">数据绑定</strong>
              <label><span>数据集</span><Select value={selectedAnalyticsWidget.datasetId} options={analyticsDatasetOptions} onChange={(datasetId) => updateAnalyticsWidget(selectedAnalyticsWidget.id, { datasetId, metricIds: [], dimension: analyticsDesign.datasets.find(item => item.id === datasetId)?.dimensions[0] })} /></label>
              <label>
                <span>指标</span>
                <Select
                  mode="multiple"
                  value={selectedAnalyticsWidget.metricIds}
                  options={analyticsDesign.metrics.filter(metric => metric.datasetId === selectedAnalyticsWidget.datasetId).map(metric => ({value: metric.id, label: metric.name}))}
                  onChange={(metricIds) => updateAnalyticsWidget(selectedAnalyticsWidget.id, { metricIds })}
                  placeholder="选择当前组件指标"
                />
              </label>
              <label><span>维度</span><Select allowClear value={selectedAnalyticsWidget.dimension} options={(analyticsDesign.datasets.find(item => item.id === selectedAnalyticsWidget.datasetId)?.dimensions || []).map(value => ({value, label: value}))} onChange={dimension => updateAnalyticsWidget(selectedAnalyticsWidget.id, { dimension })} /></label>
            </section>
          )}

          {selectedAnalyticsWidget && (
            <section className="designer-prop-section">
              <strong className="designer-prop-section-title">交互行为</strong>
              <label><span>点击动作</span><Select value={selectedAnalyticsWidget.interaction} options={[
                { value: 'none', label: '无交互' },
                { value: 'filter', label: '点击筛选' },
                { value: 'drilldown', label: '下钻明细' },
                { value: 'navigate', label: '跳转业务页' },
              ]} onChange={(interaction) => updateAnalyticsWidget(selectedAnalyticsWidget.id, { interaction })} /></label>
            </section>
          )}
        </div>

      </aside>
    </div>
  );

  const renderAnalyticsFilterDesigner = () => (
    <div className="analytics-designer analytics-filter-designer">
      <section className="analytics-section">
        <div className="analytics-section-head">
          <div>
            <strong>全局筛选器</strong>
            <span>作用于整个看板，可绑定日期、组织、状态、供应商等维度。</span>
          </div>
          <Tag color="blue">{analyticsDesign.globalFilters.length} 个筛选器</Tag>
        </div>
        <Select
          mode="multiple"
          options={Array.from(new Set(analyticsDesign.datasets.flatMap(dataset => dataset.dimensions).concat(analyticsDesign.datasets.some(dataset => dataset.dimensions.includes('date')) ? ['dateRange'] : []))).map(value => ({value, label: value}))}
          className="analytics-full-control"
          value={analyticsDesign.globalFilters}
          onChange={(globalFilters) => updateAnalyticsDesign((current) => ({ ...current, globalFilters }))}
          placeholder="输入或选择筛选字段"
        />
      </section>
      <section className="analytics-section">
        <div className="analytics-section-head">
          <div>
            <strong>组件联动</strong>
            <span>配置点击图表后的筛选、下钻或跳转业务动作。</span>
          </div>
          <Button size="small" icon={<PlusOutlined />} onClick={() => updateAnalyticsDesign((current) => ({
            ...current,
            interactions: [
              ...current.interactions,
              {
                sourceWidgetId: current.widgets[0]?.id || '',
                targetWidgetId: current.widgets[current.widgets.length - 1]?.id || '',
                action: 'filter',
              },
            ],
          }))}>新增联动</Button>
        </div>
        <div className="analytics-interaction-list">
          {analyticsDesign.interactions.map((interaction, index) => (
            <div className="analytics-interaction-row" key={`${interaction.sourceWidgetId}-${interaction.targetWidgetId}-${index}`}>
              <Select value={interaction.sourceWidgetId} options={analyticsWidgetOptions} onChange={(sourceWidgetId) => updateAnalyticsDesign((current) => ({
                ...current,
                interactions: current.interactions.map((item, itemIndex) => itemIndex === index ? { ...item, sourceWidgetId } : item),
              }))} />
              <Select value={interaction.action} options={[
                { value: 'filter', label: '筛选目标组件' },
                { value: 'drilldown', label: '下钻明细' },
                { value: 'navigate', label: '跳转业务页' },
              ]} onChange={(action) => updateAnalyticsDesign((current) => ({
                ...current,
                interactions: current.interactions.map((item, itemIndex) => itemIndex === index ? { ...item, action } : item),
              }))} />
              <Select value={interaction.targetWidgetId} options={analyticsWidgetOptions.filter(item => item.value !== interaction.sourceWidgetId)} onChange={(targetWidgetId) => updateAnalyticsDesign((current) => ({
                ...current,
                interactions: current.interactions.map((item, itemIndex) => itemIndex === index ? { ...item, targetWidgetId } : item),
              }))} /><Button danger size="small" title="删除联动" icon={<DeleteOutlined />} onClick={() => updateAnalyticsDesign(current => ({...current, interactions: current.interactions.filter((_, itemIndex) => itemIndex !== index)}))} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );

  const renderAnalyticsStyleDesigner = () => (
    <div className="analytics-designer analytics-style-designer">
      <section className="analytics-section">
        <div className="analytics-section-head">
          <div>
            <strong>主题预设</strong>
            <span>先选择看板整体气质，再按业务场景微调组件与图表样式。</span>
          </div>
          <Tag color="blue">主题应用于整张看板</Tag>
        </div>
        <div className="analytics-style-preset-grid">
          {[
            { value: 'clean' as const, label: '清爽运营', desc: '白底、轻边框，适合日常管理看板' },
            { value: 'executive' as const, label: '经营驾驶舱', desc: '高对比指标卡，适合管理层总览' },
            { value: 'factory' as const, label: '工厂现场', desc: '偏设备与产线监控，强调状态识别' },
            { value: 'dark' as const, label: '深色大屏', desc: '适合投屏、战情室和全天候展示' },
          ].map((preset) => (
            <button
              className={`analytics-style-preset ${analyticsStyle.preset === preset.value ? 'analytics-style-preset-active' : ''}`}
              key={preset.value}
              type="button"
              onClick={() => updateAnalyticsStyle({ preset: preset.value, background: preset.value === 'dark' ? '#101c26' : preset.value === 'factory' ? '#edf4f5' : preset.value === 'executive' ? '#f1f3f8' : '#f6f8fa', cardBorder: preset.value === 'executive' ? 'strong' : 'light', chartPalette: preset.value === 'executive' ? 'business' : 'manufacturing' })}
            >
              <strong>{preset.label}</strong>
              <span>{preset.desc}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="analytics-section">
        <div className="analytics-section-head">
          <div>
            <strong>画布与组件</strong>
            <span>控制整张看板的背景、间距、卡片形态和视觉密度。</span>
          </div>
        </div>
        <div className="analytics-style-form-grid">
          <label><span>画布背景</span><Input value={analyticsStyle.background} onChange={(event) => updateAnalyticsStyle({ background: event.target.value })} /></label>
          <label><span>组件间距</span><InputNumber min={0} max={32} value={analyticsStyle.componentGap} onChange={(componentGap) => updateAnalyticsStyle({ componentGap: Number(componentGap || 0) })} /></label>
          <label><span>卡片圆角</span><InputNumber min={0} max={20} value={analyticsStyle.cardRadius} onChange={(cardRadius) => updateAnalyticsStyle({ cardRadius: Number(cardRadius || 0) })} /></label>
          <label><span>卡片边框</span><Select value={analyticsStyle.cardBorder} options={[
            { value: 'none', label: '无边框' },
            { value: 'light', label: '轻边框' },
            { value: 'strong', label: '强调边框' },
          ]} onChange={(cardBorder) => updateAnalyticsStyle({ cardBorder })} /></label>
        </div>
      </section>

      <section className="analytics-section">
        <div className="analytics-section-head">
          <div>
            <strong>图表、表格与筛选器</strong>
            <span>统一配置图表色板、表格密度和过滤组件主题。</span>
          </div>
        </div>
        <div className="analytics-style-form-grid">
          <label><span>图表配色</span><Select value={analyticsStyle.chartPalette} options={[
            { value: 'manufacturing', label: '制造蓝绿' },
            { value: 'business', label: '经营彩色' },
            { value: 'warning', label: '风险预警' },
            { value: 'mono', label: '单色专业' },
          ]} onChange={(chartPalette) => updateAnalyticsStyle({ chartPalette })} /></label>
          <label><span>表格密度</span><Select value={analyticsStyle.tableDensity} options={[
            { value: 'compact', label: '紧凑' },
            { value: 'standard', label: '标准' },
            { value: 'comfortable', label: '宽松' },
          ]} onChange={(tableDensity) => updateAnalyticsStyle({ tableDensity })} /></label>
          <label><span>筛选器样式</span><Select value={analyticsStyle.filterTheme} options={[
            { value: 'toolbar', label: '顶部工具栏' },
            { value: 'inline', label: '嵌入画布' },
            { value: 'panel', label: '侧边筛选面板' },
          ]} onChange={(filterTheme) => updateAnalyticsStyle({ filterTheme })} /></label>
        </div>
      </section>
    </div>
  );

  const activeTabKey: string = activeTab;
  const permissionActionRows = permissionActionDefinitions.map((item) => ({
    ...item,
    enabled: activePermissionDraft.actions[item.key] ?? getDefaultPermissionActionEnabled(activePermissionRoleKind, item.key),
  }));
  const permissionActionRowsByKey = Object.fromEntries(permissionActionRows.map((item) => [item.key, item]));
  const enabledPermissionActionCount = permissionActionRows.filter((item) => item.enabled).length;
  const editablePermissionFieldCount = baseConfig.fields.filter((field, index) => getRoleFieldPermission(field, index).editable).length;
  const requiredPermissionFieldCount = baseConfig.fields.filter((field, index) => getRoleFieldPermission(field, index).required).length;
  const permissionFieldPageSize = 60;
  const filteredPermissionFields = baseConfig.fields
    .map((field, index) => ({ field, index, permission: getRoleFieldPermission(field, index) }))
    .filter(({ field, permission }) => {
      const query = fieldPermissionQuery.trim().toLowerCase();
      const matchesQuery = !query || field.name.toLowerCase().includes(query) || field.key.toLowerCase().includes(query);
      const matchesFilter =
        fieldPermissionFilter === 'all'
        || (fieldPermissionFilter === 'hidden' && !permission.visible)
        || (fieldPermissionFilter === 'editable' && permission.editable)
        || (fieldPermissionFilter === 'required' && permission.required)
        || (fieldPermissionFilter === 'exportable' && permission.exportable);
      return matchesQuery && matchesFilter;
    });
  const fieldPermissionPageCount = Math.max(1, Math.ceil(filteredPermissionFields.length / permissionFieldPageSize));
  const safeFieldPermissionPage = Math.min(fieldPermissionPage, fieldPermissionPageCount);
  const pagedPermissionFields = filteredPermissionFields.slice(
    (safeFieldPermissionPage - 1) * permissionFieldPageSize,
    safeFieldPermissionPage * permissionFieldPageSize,
  );
  const currentDesignerTabLabel = designerTabs.find((item) => item.key === activeTab)?.label || '';
  const hasResolvedRemoteDesignerConfig = Boolean(
    databaseMetaByForm[staticBaseConfig.id]
    || platformForm?.code === staticBaseConfig.id
    || String(platformForm?.id) === staticBaseConfig.id,
  );
  const shouldWaitForDatabaseConfig = (
    isResolvingPlatformConfig
    && !hasResolvedRemoteDesignerConfig
  );

  if (shouldWaitForDatabaseConfig) {
    return (
      <div className={`form-designer-page ${embedded ? 'form-designer-embedded' : ''}`}>
        <div className="form-designer-loading-state">
          <Spin />
          <Typography.Text type="secondary">正在加载数据库表单配置...</Typography.Text>
        </div>
      </div>
    );
  }

  return (
    <div className={`form-designer-page ${embedded ? 'form-designer-embedded' : ''}`}>
      <header className="form-designer-toolbar">
        <div className="form-designer-title">
          {embedded ? <>
            <Tooltip title="返回数据列表"><Button className="form-editor-back" aria-label="返回数据" icon={<ArrowLeftOutlined />} disabled={isPersistingFlow} onClick={warnBeforeLeave} /></Tooltip>
            <div className="form-editor-identity">
              <strong>表单编辑</strong>
              <div className="form-editor-version-status">
                <span className="designer-release-status">{publishedVersion || viewConfigMeta.status === 'published' ? `线上 v${publishedVersion || 1}` : '尚未发布'}</span>
                <span className={`designer-draft-status ${hasUnsavedChanges ? 'is-unsaved' : ''}`}>{hasUnsavedChanges ? '有未保存修改' : viewConfigMeta.status === 'published' ? '已与线上同步' : '草稿待发布'}</span>
              </div>
            </div>
          </> :
          <div className="form-editor-version-status">
          <span className="designer-release-status">{publishedVersion || viewConfigMeta.status === 'published' ? `已发布 v${publishedVersion || 1}` : '尚未发布'}</span>
          <span className={`designer-draft-status ${hasUnsavedChanges ? 'is-unsaved' : ''}`}>{draftStatusLabel}</span>
          </div>}
        </div>
        <SettingsTabs
          className="form-designer-tabs"
          activeKey={activeTab}
          onChange={(key) => {
            setActiveTab(key as DesignerTab);
            setSelectedControlId('');
          }}
          items={designerTabs.map((item) => ({ key: item.key, label: <span>{item.icon}{embedded ? ({ form: '填写表单', filter: '列表与筛选', flow: '流程与审批', permission: '权限管理' } as Record<string, string>)[item.key] || item.label : item.label}</span> }))}
        />
        <Space className="form-designer-actions" size={4} wrap={false}>
          {!embedded && <Button size="small" type="text" title="返回表单" aria-label="返回表单" icon={<ArrowLeftOutlined />} onClick={warnBeforeLeave}>返回表单</Button>}
          {embedded && activeTab === 'form' && <><Tooltip title="撤销布局修改"><Button size="small" type="text" aria-label="撤销布局修改" disabled={!history.length} icon={<UndoOutlined />} onClick={undoLayoutChange} /></Tooltip><Tooltip title="重做布局修改"><Button size="small" type="text" aria-label="重做布局修改" disabled={!future.length} icon={<RedoOutlined />} onClick={redoLayoutChange} /></Tooltip></>}
          <Button size="small" type="text" title={embedded ? '试填表单' : '预览'} aria-label={embedded ? '试填表单' : '预览'} icon={<EyeOutlined />} onClick={() => setPreviewOpen(true)}>{embedded ? '试填表单' : '预览'}</Button>
          <Button
            className="designer-version-action"
            size="small"
            title="版本管理"
            aria-label="版本管理"
            icon={<HistoryOutlined />}
            onClick={() => setVersionPanelOpen(true)}
          >
            版本管理
          </Button>
          {<Button size="small" title={aiFormDraft && !platformForm ? '确认创建草稿' : '保存草稿'} aria-label={aiFormDraft && !platformForm ? '确认创建草稿' : '保存草稿'} icon={<SaveOutlined />} loading={isPersistingFlow} onClick={saveDraft}>{aiFormDraft && !platformForm ? '确认创建草稿' : '保存草稿'}</Button>}
          {<Button className="designer-publish-button" size="small" type="primary" disabled={Boolean(aiFormDraft && !platformForm)} icon={<CheckCircleOutlined />} loading={isPersistingFlow} onClick={publishConfig}>{embedded ? '发布更改' : '发布配置'}</Button>}
        </Space>
      </header>

      <section className={`form-designer-shell ${isNoLeftTab ? 'form-designer-shell-no-left' : ''} ${activeTab === 'filter' || activeTab === 'style' || activeTab === 'dataset' || activeTab === 'dashboard' ? 'form-designer-shell-data-view' : ''} ${activeTab === 'flow' ? 'form-designer-shell-flow' : ''} ${activeTab === 'permission' ? 'form-designer-shell-permission' : ''}`}>
        {!isNoLeftTab && (
          <aside className="form-designer-left">
            <div className="designer-panel-head">
              <strong>{embedded && <LayoutOutlined />}{embedded ? '字段与布局' : '控件'}</strong>
              {activeTab !== 'form' && (
                <span>{currentDesignerTabLabel}</span>
              )}
            </div>
            {(activeTab === 'form' || activeTab === 'filter') && (
              <div className="designer-library-search">
                <Input
                  allowClear
                  prefix={<SearchOutlined />}
                  placeholder="搜索字段、控件或分类"
                  value={librarySearch}
                  onChange={(event) => setLibrarySearch(event.target.value)}
                />
              </div>
            )}

          {(activeTab === 'form' || activeTab === 'filter') ? (
            <>
              <Segmented
                block
                className="designer-library-switch"
                value={componentPanel}
                onChange={(value) => setComponentPanel(value as ComponentPanel)}
                options={[
                  {
                    label: <Tooltip title="点击或拖入填写控件、分组和布局容器。"><span>{embedded ? '添加控件' : '控件库'}</span></Tooltip>,
                    value: 'components',
                  },
                  {
                    label: <Tooltip title="点击已使用的字段进行设置；点击未使用的字段添加到表单。"><span>{embedded ? '表单字段' : '字段库'}</span></Tooltip>,
                    value: 'fieldTypes',
                  },
                ]}
              />
              <div className="designer-quick-panel">
                <div className="designer-group-title">快捷排版</div>
                <div className="designer-side-guide">
                  <strong>配置引导</strong>
                  <span>{activeTab === 'filter' ? '配置运行页查询条件，选中后在右侧查看属性，发布时会同步做业务校验。' : '拖入字段/控件，选中后在右侧配置属性，发布时会同步做业务校验。'}</span>
                  <div>
                    <Tag color="blue">{activeTab === 'filter' ? '筛选字段' : '字段'} {libraryFields.length}</Tag>
                    <Tag color="green">{activeTab === 'filter' ? '筛选项' : '控件'} {activeTab === 'filter' ? baseConfig.filters.length : layoutControls.length}</Tag>
                    <Tag color={publishErrorCount ? 'red' : 'success'}>阻断 {publishErrorCount}</Tag>
                  </div>
                </div>
                <div className="designer-quick-grid">
                  <Button size="small" icon={<LayoutOutlined />} onClick={applyTwoColumnLayout}>两列</Button>
                  <Button size="small" icon={<TableOutlined />} onClick={applyCompactLayout}>紧凑</Button>
                  <Button size="small" icon={<ApartmentOutlined />} onClick={applyBusinessSectionLayout}>业务分组</Button>
                </div>
                <div className="designer-quick-grid">
                  <Button size="small" icon={<CheckSquareOutlined />} onClick={batchSetRequired}>批量必填</Button>
                  <Button size="small" onClick={() => batchUpdateVisibleControls({ width: 'full' })}>全宽</Button>
                  <Button size="small" icon={<UndoOutlined />} disabled={!history.length} onClick={undoLayoutChange}>撤销</Button>
                </div>
                <div className="designer-side-sections">
                  {alertSections.map((section) => (
                    <button key={section.key} type="button" onClick={applyBusinessSectionLayout}>
                      <strong>{section.title}</strong>
                      <small>{section.desc}</small>
                    </button>
                  ))}
                </div>
              </div>
              {componentPanel === 'components' ? (
                <div className="designer-component-library">
                  <section className="designer-component-group">
                    <div className="designer-group-title">常用控件</div>
                    <small className="designer-library-hint">点击添加，也可拖入画布</small>
                    <div className="designer-component-list">
                      {filteredCommonControls.slice(0, 2).map((item) => (
                        <div
                          className="designer-component"
                          draggable
                          key={item.key}
                          data-desc={item.desc}
                          onClick={() => activeTab === 'filter' ? message.info('筛选页先选择字段，再在右侧查看或调整属性') : addComponentToCanvas(item)}
                          onDragEnd={() => setCanvasDragActive(false)}
                          onDragStart={(event) => {
                            event.dataTransfer.setData('componentKey', item.key);
                            setCanvasDragActive(true);
                          }}
                          title={`${item.name} / ${item.desc}`}
                        >
                          <span className="designer-component-icon">{item.icon}</span><span>{item.name}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                  {filteredComponentGroups.map((group) => (
                    <details className="designer-component-group designer-component-collapse" key={group.category} open>
                      <summary className="designer-group-title">
                        <span>{group.category}</span>
                        <small>{group.items.filter(item=>!['summary-card','status-tag','file-preview','approval-comment','operation-log','status-flow','risk-level'].includes(item.controlType)).length} 个</small>
                      </summary>
                      <div className="designer-component-list">
                        {group.items.filter(item=>!['summary-card','status-tag','file-preview','approval-comment','operation-log','status-flow','risk-level'].includes(item.controlType)).map((item) => (
                          <div
                            className="designer-component"
                            draggable
                            key={item.key}
                            data-desc={item.desc}
                            onClick={() => activeTab === 'filter' ? message.info('筛选页先选择字段，再在右侧查看或调整属性') : addComponentToCanvas(item)}
                            onDragEnd={() => setCanvasDragActive(false)}
                            onDragStart={(event) => {
                              event.dataTransfer.setData('componentKey', item.key);
                              setCanvasDragActive(true);
                            }}
                            title={`${item.name} / ${item.desc}`}
                          >
                            <span className="designer-component-icon">{item.icon}</span><span>{item.name}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  ))}
                </div>
              ) : (
                <section className="designer-component-group designer-field-library-group">
                  <div className="designer-group-title">
                    <span>{activeTab === 'filter' ? '筛选字段' : '字段库'}</span>
                    <small>{filteredLibraryFields.length} / {libraryFields.length} 个</small>
                  </div>
                  <div className="designer-field-list">
                    {filteredLibraryFields.map((field) => {
                      const isFieldOnCanvas = canvasFieldKeySet.has(field.key);
                      return (
                        <div
                          className={`designer-field ${selectedAssetKey === field.key ? 'designer-field-active' : ''} ${isFieldOnCanvas ? 'designer-field-used' : ''}`}
                          draggable={activeTab === 'form'}
                          key={field.key}
                          onClick={() => {
                            if (embedded && activeTab === 'form' && !isFieldOnCanvas) { addFieldToCanvas(field); return; }
                            setSelectedAssetKey(field.key);
                            setSelectedControlId(layoutControls.find(control => control.fieldKey === field.key)?.id || '');
                          }}
                          onDragStart={(event) => activeTab === 'form' && event.dataTransfer.setData('fieldKey', field.key)}
                          title={`${field.name} / ${field.key} / ${field.type}`}
                        >
                          <span>{field.name}</span>
                          {isFieldOnCanvas && <CheckCircleOutlined className="designer-field-check" />}
                          {embedded && !isFieldOnCanvas && <PlusOutlined />}
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}
            </>
          ) : (
              <div className="designer-component-list">
                <div className="designer-component" title="页面级规则配置">
                <span>{currentDesignerTabLabel}</span>
              </div>
            </div>
          )}
        </aside>
        )}

        <main className="form-designer-canvas">
          {activeTabKey === 'dataset' && (
            <div className="data-view-canvas">
              {renderAnalyticsDatasetDesigner()}
            </div>
          )}

          {activeTabKey === 'dashboard' && (
            <div className="data-view-canvas">
              {renderAnalyticsDashboardDesigner()}
            </div>
          )}

          {activeTabKey === 'form' && (
            <div
              className="canvas-board create-form-canvas"
              onClick={() => { setSelectedControlId(''); setSelectedAssetKey(''); }}
              onDragEnter={() => setCanvasDragActive(true)}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setCanvasDragActive(false);
                  setDropHint(null);
                }
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setCanvasDragActive(true);
              }}
              onDrop={(event) => {
                event.preventDefault();
                const layoutControlId = event.dataTransfer.getData('layoutControlId');
                if (layoutControlId) {
                  moveLayoutControlToEnd(layoutControlId);
                  setDraggedControlId('');
                  setDropHint(null);
                  setCanvasDragActive(false);
                  return;
                }
                const fieldKey = event.dataTransfer.getData('fieldKey');
                const componentKey = event.dataTransfer.getData('componentKey');
                const field = baseConfig.fields.find((item) => item.key === fieldKey);
                const component = componentGroups.flatMap((group) => group.items).find((item) => item.key === componentKey);
                if (field) addFieldToCanvas(field);
                if (component) addComponentToCanvas(component);
                setCanvasDragActive(false);
              }}
            >
              <div className="designer-canvas-context" onClick={event => event.stopPropagation()}>
                <button type="button" onClick={() => { setSelectedControlId(''); setSelectedAssetKey(''); }}><LayoutOutlined /> 表单画布</button>
                <span>{layoutControls.filter(control => !isLayoutContainer(control)).length} 个控件 · 点击选择，拖动排序</span>
              </div>
              <div className="create-form-modal" onClick={(event) => { event.stopPropagation(); if (event.target === event.currentTarget) { setSelectedControlId(''); setSelectedAssetKey(''); } }}>
                {embedded && <div className="form-editor-canvas-heading"><strong>{baseConfig.name}</strong></div>}
                <div style={{gap:canvasSettings.gap}} className={`create-form-grid ${isCanvasDragActive ? 'canvas-drag-active' : ''}`} onClick={event => { if (event.target === event.currentTarget) { setSelectedControlId(''); setSelectedAssetKey(''); } }}>
                  {layoutControls.filter(control => !control.parentId).map(control => renderCanvasControl(control))}
                  {isCanvasDragActive && !dropHint && <div className="canvas-drop-end-indicator">拖到这里放在末尾</div>}
                </div>
                <div className="create-form-actions">
                  <span className="designer-business-actions-note">{embedded ? '调整完成后，先试填检查效果' : '业务表单按钮区 · 预览时可体验'}</span>
                  {embedded ? <Button className="form-editor-preview-action" icon={<EyeOutlined />} onClick={() => setPreviewOpen(true)}>试填表单</Button> : <div className="create-form-action-buttons">
                    <Button disabled title="表单设计预览">取消</Button>
                    <Button disabled title="设计预览，不写入业务数据">保存草稿</Button>
                    <Button type="primary" disabled title="设计预览，不提交业务数据">提交</Button>
                  </div>}
                </div>
              </div>
            </div>
          )}

          {activeTabKey === 'filter' && (
            <div className="data-view-canvas">
              {isAnalysisDesigner ? renderAnalyticsFilterDesigner() : renderDataViewDesigner()}
            </div>
          )}

          {activeTabKey === 'style' && (
            <div className="data-view-canvas">
              {renderAnalyticsStyleDesigner()}
            </div>
          )}


          {activeTabKey === 'flow' && (
            <ProfessionalFlowDesigner
              config={professionalFlowConfig}
              fields={baseConfig.fields.map((field) => ({
                key: field.key,
                name: field.name,
                type: field.type,
                required: field.required,
              }))}
              roles={permissionRoles}
              roleOptions={identityRoleRecords.map((role) => ({ value: role.name, label: role.label }))}
              users={identityUsers.map((user) => ({ value: String(user.id), label: user.label }))}
              onChange={(nextConfig) => {
                setProfessionalFlowConfig(nextConfig);
                setHasAssociatedFlow(true);
                markUnsaved();
              }}
            />
          )}

          {activeTabKey === 'permission' && (
            <div className="permission-canvas">
              <div className="permission-workbench">
                <aside className="permission-role-rail">
                  <div className="permission-rail-head">
                    <div>
                      <div className="permission-section-title">1. 选择授权对象</div>
                      <small>来自用户与权限中心的角色</small>
                    </div>
                    <Space size={6}>
                      <Tag>{permissionRoles.length}</Tag>
                      <Button
                        aria-label="保存权限草稿"
                        icon={<SaveOutlined />}
                        loading={isPersistingPermissions}
                        onClick={savePermissionDesign}
                        size="small"
                        title="保存权限草稿（发布后生效）"
                        type="text"
                      />
                    </Space>
                  </div>
                  <Input size="small" prefix={<SearchOutlined />} placeholder="搜索角色" value={permissionRoleSearch} onChange={event=>setPermissionRoleSearch(event.target.value)} />
                  {permissionRoles.filter(role=>role.toLowerCase().includes(permissionRoleSearch.toLowerCase())).map((role, index) => (
                    <button
                      className={`permission-role-card ${role === activePermissionRole ? 'permission-role-active' : ''}`}
                      key={role}
                      type="button"
                      onClick={() => setSelectedPermissionRole(role)}
                    >
                      <span className="permission-role-icon"><UserSwitchOutlined /></span>
                      <span>
                        <strong>{role}</strong>
                        <small>{role === activePermissionRole ? '正在配置' : index === 0 ? '最高权限模板' : '点击切换配置'}</small>
                      </span>
                      <Tag color={role === activePermissionRole ? 'blue' : 'default'}>{index === 0 ? '全局' : '业务'}</Tag>
                    </button>
                  ))}
                </aside>

                <div className="permission-main">
                  <section className="permission-card permission-scope-card">
                    <div className="permission-card-head">
                      <div>
                        <div className="permission-section-title">1. 数据权限</div>
                        <span>决定角色可以看到哪些组织、记录和敏感信息</span>
                      </div>
                      <ApartmentOutlined />
                    </div>
                    <div className="permission-data-config">
                      <label>
                        <span>数据范围</span>
                        <Select
                          size="small"
                          value={activePermissionDraft.data.scope}
                          onChange={(scope) => updateActivePermissionDraft((draft) => ({
                            ...draft,
                            data: { ...draft.data, scope },
                          }))}
                          options={[
                            { value: 'all', label: '全部组织' },
                            { value: 'org_tree', label: '本组织及下级' },
                            { value: 'org', label: '仅本组织' },
                            { value: 'assigned', label: '本人创建 / 分派给我' },
                            { value: 'custom', label: '自定义范围' },
                          ]}
                        />
                      </label>
                      <label>
                        <span>自定义组织范围</span>
                        <Select
                          mode="multiple"
                          size="small"
                          disabled={activePermissionDraft.data.scope!=='custom'}
                          value={(activePermissionDraft.data.orgUnits || [])
                            .map((value) => Number(value))
                            .filter((value) => Number.isInteger(value) && value > 0)}
                          onChange={(orgUnits) => updateActivePermissionDraft((draft) => ({
                            ...draft,
                            data: { ...draft.data, orgUnits },
                          }))}
                          maxTagCount="responsive"
                          options={permissionOrgUnitOptions}
                        />
                      </label>
                      <label>
                        <span>敏感字段</span>
                        <Select
                          size="small"
                          value={activePermissionDraft.data.sensitiveFields}
                          onChange={(sensitiveFields) => updateActivePermissionDraft((draft) => ({
                            ...draft,
                            data: { ...draft.data, sensitiveFields },
                          }))}
                          options={[
                            { value: 'full', label: '遵循字段自身的脱敏规则' },
                            { value: 'mask', label: '详情与导出脱敏' },
                            { value: 'hide', label: '完全隐藏' },
                          ]}
                        />
                      </label>
                    </div>
                    <div className="permission-data-checks">
                      {[
                        ['createdByMe', '本人创建'],
                        ['assignedToMe', '分派给我'],
                        ['sameOrg', '同组织记录'],
                        ['crossOrg', '跨组织记录'],
                        ['statistics', '统计汇总数据'],
                      ].map(([key, label]) => (
                        <Checkbox
                          key={key}
                          checked={activePermissionDraft.data.ownership[key] !== false}
                          onChange={(event) => updateActivePermissionDraft((draft) => ({
                            ...draft,
                            data: {
                              ...draft.data,
                              ownership: { ...draft.data.ownership, [key]: event.target.checked },
                            },
                          }))}
                        >
                          {label}
                        </Checkbox>
                      ))}
                    </div>
                  </section>

                  <section className="permission-card permission-action-card">
                    <div className="permission-card-head">
                      <div>
                        <div className="permission-section-title">2. 动作权限</div>
                        <span>按角色分别控制列表入口、表单内按钮和流程处理动作</span>
                      </div>
                      <Tag color="green">{enabledPermissionActionCount} / {permissionActionRows.length} 已启用</Tag>
                    </div>
                    <div className="permission-action-groups">
                      {permissionActionGroups.map((group) => (
                        <div className="permission-action-group" key={group.key}>
                          <div className="permission-action-group-title">
                            <strong>{group.title}</strong>
                            <small>{group.desc}</small>
                          </div>
                          <div className="permission-action-grid">
                            {group.actionKeys.map((actionKey) => {
                              const item = permissionActionRowsByKey[actionKey];
                              if (!item) return null;
                              return (
                                <Tooltip
                                  key={item.key}
                                  title={`${item.desc}；风险等级：${item.risk === 'high' ? '高' : item.risk === 'medium' ? '中' : '低'}`}
                                  placement="top"
                                >
                                  <label className={`permission-toggle-row permission-action-toggle-row ${item.enabled ? 'permission-action-toggle-on' : 'permission-action-toggle-off'}`}>
                                    <span>
                                      <strong>{item.name}</strong>
                                    </span>
                                    <Switch
                                      size="small"
                                      checked={item.enabled}
                                      onChange={(checked) => updateActivePermissionDraft((draft) => ({
                                        ...draft,
                                        actions: { ...draft.actions, [item.key]: checked },
                                      }))}
                                    />
                                  </label>
                                </Tooltip>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="permission-card permission-field-card">
                    <div className="permission-card-head">
                      <div>
                        <div className="permission-section-title">3. 角色字段权限</div>
                        <span>按字段搜索和筛选后批量处理当前角色的运行时覆盖；字段默认参数仍在字段设置里维护</span>
                      </div>
                      <Space size={6}>
                        <Tag color="green">字段 {baseConfig.fields.length}</Tag>
                        <Tag color="blue">可编辑 {editablePermissionFieldCount}</Tag>
                        <Tag color="orange">角色必填 {requiredPermissionFieldCount}</Tag>
                        <Dropdown disabled={!filteredPermissionFields.length} menu={{items:[{key:'visible',label:'可见'},{key:'editable',label:'可编辑'},{key:'required',label:'角色必填'},{key:'exportable',label:'允许导出'}].map(item=>({...item,children:[{key:`${item.key}:1`,label:'全部启用'},{key:`${item.key}:0`,label:'全部关闭'}]})),onClick:({key})=>{
                          const [property,flag]=key.split(':');const enabled=flag==='1';
                          updateActivePermissionDraft(draft=>{const fields={...draft.fields};for(const {field,permission} of filteredPermissionFields){if(property==='editable'&&field.locked)continue;fields[field.key]={...permission,[property]:enabled,...(property==='visible'&&!enabled?{editable:false,required:false,exportable:false}:{}),...(property!=='visible'&&enabled?{visible:true}:{})};}return {...draft,fields};});
                        }}}><Button size="small">批量设置</Button></Dropdown>
                      </Space>
                    </div>
                    <div className="permission-field-tools">
                      <Input
                        allowClear
                        prefix={<SearchOutlined />}
                        placeholder="搜索字段名称或编码"
                        value={fieldPermissionQuery}
                        onChange={(event) => {
                          setFieldPermissionQuery(event.target.value);
                          setFieldPermissionPage(1);
                        }}
                      />
                      <Select
                        value={fieldPermissionFilter}
                        onChange={(value) => {
                          setFieldPermissionFilter(value);
                          setFieldPermissionPage(1);
                        }}
                        options={[
                          { value: 'all', label: '全部字段' },
                          { value: 'hidden', label: '隐藏字段' },
                          { value: 'editable', label: '可编辑' },
                          { value: 'required', label: '角色必填' },
                          { value: 'exportable', label: '允许导出' },
                        ]}
                      />
                      <span>{filteredPermissionFields.length} 个匹配字段</span>
                    </div>
                    <div className="permission-field-matrix">
                      <div className="permission-field-head">
                        <span>字段</span><span>可见</span><span>编辑</span><span>必填</span><span>导出</span>
                      </div>
                      <div className="permission-field-list">
                      {pagedPermissionFields.map(({ field, index, permission }) => {
                        return (
                          <div className="permission-field-row" key={field.key}>
                            <span title={`${field.name} / ${field.key}`}>
                              <strong>{field.name}</strong>
                              <small>{field.key}</small>
                            </span>
                            <Switch
                              size="small"
                              checked={permission.visible}
                              onChange={(checked) => updateRoleFieldPermission(field, index, {
                                visible: checked,
                                editable: checked ? permission.editable : false,
                                required: checked ? permission.required : false,
                              })}
                            />
                            <Switch
                              size="small"
                              checked={permission.visible && permission.editable}
                              disabled={field.locked || !permission.visible}
                              onChange={(checked) => updateRoleFieldPermission(field, index, { editable: checked })}
                            />
                            <Switch
                              size="small"
                              checked={permission.visible && permission.required}
                              disabled={!permission.visible}
                              onChange={(checked) => updateRoleFieldPermission(field, index, { required: checked })}
                            />
                            <Switch
                              size="small"
                              checked={permission.visible && permission.exportable}
                              disabled={!permission.visible}
                              onChange={(checked) => updateRoleFieldPermission(field, index, { exportable: checked })}
                            />
                          </div>
                        );
                      })}
                      </div>
                      <div className="permission-field-pager">
                        <span>
                          第 {safeFieldPermissionPage} / {fieldPermissionPageCount} 页，每页 {permissionFieldPageSize} 个字段
                        </span>
                        <Space size={6}>
                          <Button
                            size="small"
                            disabled={safeFieldPermissionPage <= 1}
                            onClick={() => setFieldPermissionPage((page) => Math.max(1, page - 1))}
                          >
                            上一页
                          </Button>
                          <Button
                            size="small"
                            disabled={safeFieldPermissionPage >= fieldPermissionPageCount}
                            onClick={() => setFieldPermissionPage((page) => Math.min(fieldPermissionPageCount, page + 1))}
                          >
                            下一页
                          </Button>
                        </Space>
                      </div>
                    </div>
                  </section>

                </div>
              </div>
            </div>
          )}
        </main>

        {!isAnalysisDesigner && !(['permission', 'filter', 'flow', 'approval'] as DesignerTab[]).includes(activeTab) && (
        <aside className="form-designer-right property-inspector">
          <PropertyInspectorHeader title={selectedControl ? `${isLayoutContainer(selectedControl) ? '容器' : selectedControl.fieldKey ? '字段' : '控件'}属性` : '画布属性'} context={selectedControl?.name || baseConfig.name} />
          {selectedControl ? (
            <div className="designer-props">
              {renderControlIdentityProperties()}
              {renderDisplayProperties()}
              {selectedControl.controlType === 'divider' ? <>
                <section className="designer-prop-section"><strong className="designer-prop-section-title">显示设置</strong><label><span>显示分割符</span>{controlRuleToggle('visible')}</label></section>
                {renderContainerProperties()}
              </> : embedded ? <>
                {isLayoutContainer(selectedControl) ? <>{renderContainerProperties()}<section className="designer-prop-section"><strong className="designer-prop-section-title">容器交互</strong><label><span>显示容器</span>{controlRuleToggle('visible')}</label><label><span>只读</span>{controlRuleToggle('readonly')}</label><small>同时作用于容器内的字段。</small></section></> : <>{renderCommonRuleProperties()}{renderTypeSpecificProperties()}{renderAutomationProperties()}{renderDataSourceProperties()}</>}
                {!isLayoutContainer(selectedControl) && <>
                  {renderContainerProperties()}
                  {renderEncodingProperties()}
                  {renderTableProperties()}
                </>}
              </> : <>
                {renderContainerProperties()}
                {isLayoutContainer(selectedControl) ? <section className="designer-prop-section"><strong className="designer-prop-section-title">容器交互</strong><label><span>默认显示</span>{controlRuleToggle('visible')}</label><label><span>默认只读</span>{controlRuleToggle('readonly')}</label><small>容器的显示和只读规则同时作用于内部控件。</small></section> : renderDefaultRuleProperties()}
                {renderTypeSpecificProperties()}
                {!isLayoutContainer(selectedControl) && renderAutomationProperties()}
                {renderDataSourceProperties()}
                {renderEncodingProperties()}
                {renderTableProperties()}
              </>}
            </div>
          ) : (
            <div className="designer-props">
              <button type="button" className={`designer-validation-summary ${localErrorCount ? 'has-errors' : ''}`} onClick={() => setValidationOpen(true)}>
                <span><CheckCircleOutlined /> 本地配置检查 <span>查看规则 →</span></span>
                <small>{localErrorCount} 个阻断项 · {localWarningCount} 个提醒</small>
                <small className="designer-validation-trigger">随配置修改自动更新 · 发布时另做服务器检查</small>
              </button>
              <details className="designer-prop-section designer-canvas-property-group" open>
                <summary className="designer-prop-section-title">基本信息</summary>
                <label><span>表单名称</span><Input value={baseConfig.name} readOnly /></label>
                <label><span>新增标题</span><Input value={baseConfig.createTitle} readOnly /></label>
                <label className="designer-description-row"><span>表单说明</span><Input.TextArea value={baseConfig.description} readOnly autoSize={{ minRows: 2, maxRows: 5 }} /></label>
              </details>
              <details className="designer-prop-section designer-canvas-property-group" open>
                <summary className="designer-prop-section-title">布局设置</summary>
                <label><span>默认列数</span><Select value={String(canvasSettings.columns)} onChange={value=>{const columns=Number(value);setCanvasSettings(current=>({...current,columns}));commitLayoutChange(current=>current.map(c=>!c.parentId&&!isLayoutContainer(c)&&c.controlType!=='divider'?{...c,width:columns===1?'full':columns===3?'third':'half'}:c));}} options={[{ value: '1', label: '单列' }, { value: '2', label: '两列' }, { value: '3', label: '三列' }]} /></label>
                <label><span>字段间距</span><Select value={String(canvasSettings.gap)} onChange={value=>{setCanvasSettings(current=>({...current,gap:Number(value)}));setHasUnsavedChanges(true);}} options={[{ value: '8', label: '紧凑' }, { value: '12', label: '标准' }, { value: '16', label: '宽松' }]} /></label>
              </details>
              <details className="designer-prop-section designer-canvas-property-group" open>
                <summary className="designer-prop-section-title">数据绑定</summary>
                <label><span>数据表</span><Input value={baseConfig.dataSource} readOnly /></label>
                <label><span>主键字段</span><Input value={baseConfig.primaryKey} readOnly /></label>
              </details>
              <details className="designer-prop-section designer-canvas-property-group">
                <summary className="designer-prop-section-title">系统容量规则</summary>
                <label><span>字段数量</span><Input aria-label="表单字段数量上限" readOnly value={`${baseConfig.fields.length} / ${DEFAULT_FORM_LIMITS.fields} 个`} /></label>
                <label><span>单条记录</span><Input aria-label="单条记录容量上限" readOnly value="2 MiB" /></label>
                <small className="designer-capacity-note">系统默认，设计中不可修改。按实际填写的数据校验，不预占空间；附件文件不计入记录正文。</small>
              </details>
              {recommendedRules.length > 0 && <details className="designer-prop-section designer-canvas-property-group" open>
                <summary className="designer-prop-section-title">内置配置参考</summary>
                <small className="designer-recommendation-note"><strong>来源：平台预置规则</strong><span>按字段名称匹配，仅供参考；需手动配置后生效。</span></small>
                {recommendedRules.map((rule) => <div className="designer-rule-pill" key={rule}>{rule}</div>)}
              </details>}

            </div>
          )}
        </aside>
        )}
      </section>

      <Modal centered className="form-designer-dialog encoding-rule-modal search-rule-modal" title={<div className="encoding-dialog-title"><SearchOutlined/><span>搜索设置</span></div>} width={980} open={Boolean(searchDraft)} okText="应用设置" cancelText="取消" onCancel={()=>{++searchRequestEpoch.current;setSearchDraft(null);}} onOk={applySearchSettings} okButtonProps={{disabled:!searchDraft?.schema||searchDraft.metaLoading}}>
        {renderSearchSettingsEditor()}
      </Modal>

      <Modal centered className="form-designer-dialog encoding-rule-modal calculation-rule-modal" title={<div className="encoding-dialog-title"><NumberOutlined /><span>计算规则</span></div>} width={860} open={Boolean(calculationDraft)} onCancel={closeCalculationEditor}
        footer={<div className="encoding-rule-footer"><Button type="text" danger icon={<DeleteOutlined />} disabled={!layoutControls.find(control => control.id === calculationDraft?.controlId)?.computed || calculationBusy} onClick={() => {
          commitLayoutChange(controls => controls.map(control => control.id === calculationDraft?.controlId ? { ...control, computed: null, calculationRulesEnabled: false, inactiveCalculationRule: undefined } : control)); closeCalculationEditor();
        }}>删除规则</Button><Space size={8}><Button type="text" onClick={closeCalculationEditor}>取消</Button><Button type="primary" loading={calculationBusy} onClick={() => checkCalculation(true)}>保存规则</Button></Space></div>}>
        {renderCalculationEditor()}
      </Modal>

      <Modal centered className="form-designer-dialog encoding-rule-modal assignment-rule-modal" title={<div className="encoding-dialog-title"><SettingOutlined /><span>赋值规则</span></div>} width={860} open={Boolean(assignmentDraft)} onCancel={() => setAssignmentDraft(null)} onOk={applyAssignmentDraft} okText="应用规则" cancelText="取消">
        {renderAssignmentEditor()}
      </Modal>

      <Modal centered className="form-designer-dialog encoding-rule-modal default-rule-modal" title={<div className="encoding-dialog-title"><SettingOutlined /><span>默认值规则</span><span className="default-rule-title-note">新增时预填一次，允许手动修改；编辑已有记录不重算。</span></div>} open={Boolean(defaultValueDraft)} width={980}
        okText="应用规则" cancelText="取消" onCancel={() => setDefaultValueDraft(null)} onOk={applyDefaultValueDraft}>
        {renderDefaultValueEditor()}
      </Modal>

      <Modal centered className="form-designer-dialog encoding-rule-modal encoding-scheme-modal" title={<div className="encoding-dialog-title"><NumberOutlined /><span>编码规则</span></div>} open={Boolean(encodingSettingsDraft)}
        afterOpenChange={(open) => { if (open) encodingEditorRef.current?.scrollTo({ top: 0 }); }}
        onCancel={dismissEncodingSettings} footer={<div className="encoding-rule-footer">
          <Button className="encoding-rule-delete" danger type="text" icon={<DeleteOutlined />} disabled={!encodingSettingsDraft || !getEncodingRules(encodingRuleTargetRef.current?.rule).some(rule => rule.id === encodingSettingsDraft.id)} onClick={deleteEncodingSettings}>删除规则</Button>
          <Space size={8}><Button type="text" className="encoding-rule-cancel" onClick={dismissEncodingSettings}>取消</Button><Button type="primary" className="encoding-rule-save" onClick={commitEncodingSettings}>保存规则</Button></Space>
        </div>} width={980}>
        {encodingSettingsDraft && <div className="encoding-rule-workspace">
          <div className="encoding-rule-editor" ref={encodingEditorRef}>
            <section className="encoding-editor-section encoding-rule-basics">
              <div className="encoding-basics-fields"><label className="encoding-editor-field"><span>规则名称</span><Input aria-label="编码规则名称" value={encodingSettingsDraft.name}
                placeholder="例如：成品物料编码" maxLength={60}
                onChange={(e) => setEncodingSettingsDraft({ ...encodingSettingsDraft, name: e.target.value })} /></label>
                <label className="encoding-editor-field"><span>生成方式</span><Select aria-label="编码生成方式" value={encodingSettingsDraft.generationMode || 'auto'} options={encodingGenerationModeOptions}
                  onChange={(generationMode) => setEncodingSettingsDraft({ ...encodingSettingsDraft, generationMode,
                    allowManualOverride: generationMode === 'autoEditable' || generationMode === 'manual' })} /></label>
              </div>
            </section>
            <section className="encoding-editor-section encoding-rule-conditions">
              <div className="encoding-section-title encoding-trigger-heading">
                <strong>何时触发<Tooltip title="不添加条件时不限制触发；点击右侧加号添加条件，只有全部条件满足时才使用此编码规则。删除全部条件可恢复无限制触发。" trigger={['hover','focus']}><button type="button" className="encoding-trigger-help" aria-label="何时触发说明"><QuestionCircleOutlined /></button></Tooltip></strong>
                <Button size="small" type="text" icon={<PlusOutlined />} aria-label="添加触发条件" title="添加触发条件" onClick={() => setEncodingSettingsDraft({ ...encodingSettingsDraft, conditions: [...(encodingSettingsDraft.conditions || []), {sourceField: assignmentTargetFieldOptions.find(option => option.value !== selectedField?.key)?.value, operator:'eq',value:''}] })}>添加触发条件</Button>
              </div>
              {Boolean(encodingSettingsDraft.conditions?.length) && <>
                {encodingSettingsDraft.conditions?.map((condition,index) => <div className="encoding-condition-row" key={index}>
                  <Select aria-label={`条件字段 ${index + 1}`} placeholder="选择字段" value={condition.sourceField} options={assignmentTargetFieldOptions}
                    onChange={(sourceField) => setEncodingSettingsDraft({...encodingSettingsDraft,conditions:encodingSettingsDraft.conditions?.map((c,i)=>i===index?{...c,sourceField}:c)})} />
                  <Select aria-label={`条件运算符 ${index + 1}`} value={condition.operator} options={[
                    {value:'eq',label:'等于'},{value:'ne',label:'不等于'},{value:'contains',label:'包含'},
                    {value:'gte',label:'大于等于'},{value:'lte',label:'小于等于'},{value:'isEmpty',label:'为空'},{value:'notEmpty',label:'不为空'}]}
                    onChange={(operator)=>setEncodingSettingsDraft({...encodingSettingsDraft,conditions:encodingSettingsDraft.conditions?.map((c,i)=>i===index?{...c,operator}:c)})} />
                  {['isEmpty','notEmpty'].includes(condition.operator || '') ? <span className="encoding-no-value">无需填写值</span> :
                    <Input aria-label={`条件值 ${index + 1}`} placeholder="填写匹配值" value={condition.value}
                      onChange={(e)=>setEncodingSettingsDraft({...encodingSettingsDraft,conditions:encodingSettingsDraft.conditions?.map((c,i)=>i===index?{...c,value:e.target.value}:c)})} />}
                  <Button aria-label={`删除条件 ${index + 1}`} type="text" icon={<DeleteOutlined />}
                    onClick={()=>setEncodingSettingsDraft({...encodingSettingsDraft,conditions:encodingSettingsDraft.conditions?.filter((_,i)=>i!==index)})} />
                </div>)}
              </>}
            </section>
            <section className="encoding-editor-section encoding-rule-composition">
              <div className="encoding-section-title encoding-composition-heading">
                <strong>编码段配置 <span className="encoding-section-count">{selectedEncodingSegments.length} 段</span></strong>
                <div className="encoding-heading-preview" aria-label="生成结果预览" aria-live="polite"><span>生成结果预览</span><code>{encodingSettingsDraft.generationMode === 'manual' ? '手工录入' : selectedEncodingSegments.some(segment => encodingSegmentLengthError(segment)) ? '存在超长编码段，请调整' : selectedEncodingSegments.length ? renderEncodingSample({...encodingSettingsDraft,enabled:true},baseConfig.fields) : '—'}</code></div>
                {encodingSettingsDraft.generationMode !== 'manual' && <Button size="small" type="text" icon={<PlusOutlined />} onClick={()=>openEncodingSegmentEditor()}>添加编码段</Button>}
              </div>
              {encodingSettingsDraft.generationMode === 'manual' ? <p className="encoding-editor-hint">由使用者录入完整编码，不使用自动编码段。</p> : <>
                {!selectedEncodingSegments.length && <div className="encoding-empty-segments">尚未配置编码段，请点击右上角添加。</div>}
                <div className="encoding-segment-flow-scroll"><div className="encoding-segment-flow">
                  <div className="encoding-segment-list">
                    {selectedEncodingSegments.map((segment,index) => <div
                      className={`encoding-segment-item ${draggedEncodingSegmentId === String(index) ? 'is-dragging' : ''}`}
                      key={segment.id || index} data-encoding-segment-id={index} role={encodingSegmentEditor.open && encodingSegmentEditor.index === index ? undefined : "button"} tabIndex={0}
                      aria-label={`编辑编码段：${segment.name || getEncodingSegmentTypeLabel(segment.type)}`}
                      title="双击编辑，拖拽调整顺序"
                      onKeyDown={event => {
                        if (encodingSegmentEditor.open || event.target !== event.currentTarget) return;
                        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openEncodingSegmentEditor(segment,index); }
                        if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
                          event.preventDefault();
                          const target = index + (event.key === 'ArrowUp' ? -1 : 1);
                          if (target < 0 || target >= selectedEncodingSegments.length) return;
                          const next = [...selectedEncodingSegments]; next.splice(index,1); next.splice(target,0,segment); syncEncodingSegments(next);
                        }
                      }}
                      onPointerDown={event => {
                        if (encodingSegmentEditor.open || event.button !== 0 || (event.target as HTMLElement).closest('button, input, textarea, .ant-select, .ant-select-dropdown, .ant-input-number')) return;
                        encodingSegmentPointer.current = { id: String(index), x: event.clientX, y: event.clientY };
                        event.currentTarget.setPointerCapture(event.pointerId);
                      }}
                      onPointerMove={event => {
                        const pointer = encodingSegmentPointer.current;
                        if (pointer && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 5) setDraggedEncodingSegmentId(pointer.id);
                      }}
                      onPointerUp={event => {
                        const pointer = encodingSegmentPointer.current;
                        if (!pointer) return;
                        if (Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 5) {
                          const target = event.currentTarget.ownerDocument.elementFromPoint(event.clientX, event.clientY)?.closest('[data-encoding-segment-id]');
                          const sourceIndex = Number(pointer.id);
                          const targetIndex = target ? Number(target.getAttribute('data-encoding-segment-id')) : -1;
                          if (sourceIndex >= 0 && targetIndex >= 0 && sourceIndex !== targetIndex) {
                            const next = [...selectedEncodingSegments]; const [moved] = next.splice(sourceIndex,1); next.splice(targetIndex,0,moved); syncEncodingSegments(next);
                          }
                        }
                        encodingSegmentPointer.current = null; setDraggedEncodingSegmentId(null);
                        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                      }}
                      onPointerCancel={() => { encodingSegmentPointer.current = null; setDraggedEncodingSegmentId(null); }}

                    >
                      <HolderOutlined className="encoding-segment-grip" />
                      {renderEncodingSegmentContents(segment,index)}
                      <div className="encoding-segment-actions">
                        <Button size="small" type="text" title="删除编码段" aria-label={`删除编码段：${segment.name || getEncodingSegmentTypeLabel(segment.type)}`} icon={<DeleteOutlined />} onClick={event => { event.stopPropagation(); removeEncodingSegment(index); }} />
                      </div>

                    </div>)}
                  </div>
                </div></div>
              </>}
            </section>
          </div>
        </div>}

      </Modal>



      <Modal
        centered
        className="form-designer-dialog view-filter-field-modal"
        okText="完成"
        onCancel={() => setFilterFieldPickerOpen(false)}
        onOk={() => setFilterFieldPickerOpen(false)}
        open={filterFieldPickerOpen}
        title="选择筛选字段"
        width={720}
      >
        <div className="view-filter-field-modal-note">勾选表单字段后，会自动出现在筛选区；取消勾选会从筛选区移除。</div>
        <Checkbox.Group
          className="view-filter-field-grid"
          value={sortedViewFilters.map((filter) => filter.fieldName)}
          onChange={(values) => syncViewFiltersByFields(values.map(String))}
        >
          {baseConfig.fields.map((field) => (
            <label className="view-filter-field-option" key={field.key}>
              <Checkbox value={field.key} />
              <span>
                <strong>{field.name}</strong>
                <small>{field.key} · {field.type}</small>
              </span>
            </label>
          ))}
        </Checkbox.Group>
      </Modal>

      <Modal
        centered
        className="form-designer-dialog view-filter-field-modal"
        okText="完成"
        onCancel={() => setTableFieldPickerOpen(false)}
        onOk={() => setTableFieldPickerOpen(false)}
        open={tableFieldPickerOpen}
        title="选择列表字段"
        width={720}
      >
        <div className="view-filter-field-modal-note">勾选表单字段后，会自动出现在数据列表区；取消勾选会从列表区移除。</div>
        <Checkbox.Group
          className="view-filter-field-grid"
          value={sortedViewColumns.map((column) => column.fieldName)}
          onChange={(values) => syncViewColumnsByFields(values.map(String))}
        >
          {baseConfig.fields.map((field) => (
            <label className="view-filter-field-option" key={field.key}>
              <Checkbox value={field.key} />
              <span>
                <strong>{field.name}</strong>
                <small>{field.key} · {field.type}</small>
              </span>
            </label>
          ))}
        </Checkbox.Group>
      </Modal>

      <Modal
        centered
        className="form-designer-dialog designer-preview-modal"
        footer={<div className="trial-footer">
          <span><LockOutlined /> {isAnalysisDesigner ? '示意数据 · 仅预览布局' : '试填内容不会保存为业务记录'}</span>
          <Space size={10}>
            <Button onClick={() => setPreviewOpen(false)}>返回设计</Button>
            {!isAnalysisDesigner && <Button type="primary" icon={<CheckCircleOutlined />} onClick={() => previewForm.validateFields().then(() => message.success('预览必填及选择数量校验通过；数值、格式及字节限制以运行页保存校验为准')).catch(() => {})}>检查必填项</Button>}
          </Space>
        </div>}
        onCancel={() => setPreviewOpen(false)}
        open={previewOpen}
        title={<div className="trial-title">
          <span className="trial-title-icon"><EyeOutlined /></span>
          <div><div className="trial-title-line"><span>{isAnalysisDesigner ? '看板布局预览' : embedded ? '试填表单' : '表单预览'}</span><Tag>当前草稿</Tag></div>
            <p>{isAnalysisDesigner ? '检查组件布局，真实数据请在发布后的运行页验证。' : '体验填写过程，检查表单布局、必填规则与节点权限。'}</p>
          </div>
        </div>}
        width={1120}
      >
        {!isAnalysisDesigner && <div className="trial-controls">
          <div className="trial-scenario">
            <label className="trial-context-field"><span className="trial-control-label"><ApartmentOutlined /> 流程节点</span>
              <Select className="designer-preview-node-select" aria-label="试填流程节点"
                value={selectedPreviewFlowNode?.id} onChange={setPreviewFlowNodeId} options={previewFlowNodeOptions}
                disabled={!previewFlowNodeOptions.length || isResolvingPlatformConfig} loading={isResolvingPlatformConfig}
                placeholder="请先关联流程" notFoundContent="请在流程与审批中关联流程" />
            </label>
            <label className="trial-context-field"><span className="trial-control-label"><UserSwitchOutlined /> 预览角色</span>
              <Select className="designer-preview-role-select" aria-label="试填角色" value={activePreviewRole}
                onChange={setPreviewRole} options={permissionRoles.map(role => ({ value: role, label: role }))}
                disabled={!permissionRoles.length} placeholder="请先配置角色" />
            </label>
            <Button type="link" className="trial-flow-link" onClick={() => { setPreviewOpen(false); setActiveTab('flow'); }}>流程与审批 <ArrowLeftOutlined rotate={180} /></Button>
          </div>
          <div className="trial-context-note">
            {flowLoadError || (hasAssociatedFlow ? `流程：${professionalFlowConfig.name}。${getPreviewNodeNote(selectedPreviewFlowNode)}` : '尚未关联流程，请在「流程与审批」中配置。')}
            <span>角色权限与「权限管理」保持同步。{!previewRoleCanView ? '该角色无权查看此表单。' : !previewRoleCanFill ? '当前角色或节点仅可查看。' : ''}</span>
          </div>
        </div>}
        <div className="trial-stage">
        <div className="trial-stage-label"><span className="trial-live-dot" />表单预览<span>·</span><span>{isAnalysisDesigner ? '示意布局' : '与当前草稿同步'}</span></div>
        <div className="designer-preview-shell designer-preview-desktop">
          <div className={`designer-preview-surface trial-canvas ${embedded ? 'form-designer-embedded' : ''}`}>
            <div className="form-editor-canvas-heading"><strong>{baseConfig.name}</strong></div>
            <div className="trial-form-body">{isAnalysisDesigner ? <><p>此处仅预览组件布局。真实数据、筛选和交互请在发布后的运行页验证。</p><div className="analytics-dashboard-canvas" style={{...analyticsCanvasStyle, display:'grid', gridTemplateColumns:'repeat(4,minmax(0,1fr))'}}>{analyticsDesign.widgets.map(widget => <div key={widget.id} className={`analytics-widget analytics-widget-${widget.width}`} style={analyticsWidgetStyle}><strong>{widget.title}</strong>{renderAnalyticsWidgetPreview(widget)}</div>)}</div></> : renderPreviewContent()}</div>
          </div>
        </div>
        </div>
      </Modal>

      <Modal centered className="form-designer-dialog" title="本地配置检查" open={validationOpen} onCancel={() => setValidationOpen(false)} footer={<Button onClick={() => setValidationOpen(false)}>关闭</Button>}>
        <p className="designer-publish-note">来源：平台内置配置规则。修改字段、布局、列表或流程时自动更新；本窗口展示当前草稿的检查结果。</p>
        <p className="designer-publish-note">点击“{embedded ? '发布更改' : '发布配置'}”后，服务器还会检查现有业务数据的影响，再进入发布确认。</p>
        <div className="designer-check-list">
          {publishChecks.map((item, index) => <div className={`designer-check-item designer-check-${item.level}`} key={`${item.title}-${index}`}>
            <span>{item.level === 'error' ? <AlertOutlined /> : item.level === 'warning' ? <WarningOutlined /> : <CheckCircleOutlined />}</span>
            <div><strong>{item.title}</strong><small>{item.detail}</small></div>
          </div>)}
        </div>
      </Modal>

      <Modal
        centered
        className="form-designer-dialog designer-check-modal"
        okText={publishErrorCount ? '处理阻断项' : '确认发布'}
        onCancel={() => setPublishCheckOpen(false)}
        onOk={confirmPublish}
        open={publishCheckOpen}
        confirmLoading={isPersistingFlow}
        title="发布确认"
      >
        <div className="designer-publish-note">
          发布时会执行当前业务表单配置的必要校验；不同业务可拥有不同规则，日常编辑不单独打扰。
        </div>
        <div className="designer-check-summary">
          <Tag color={publishErrorCount ? 'red' : 'success'}>{publishErrorCount} 个阻断项</Tag>
          <Tag color={publishWarningCount ? 'orange' : 'default'}>{publishWarningCount} 个提醒</Tag>
          <Tag color="blue">{combinedPublishChecks.filter((item) => item.level === 'suggestion').length} 个建议</Tag>
        </div>
        <div className="designer-check-list">
          {combinedPublishChecks.map((item) => (
            <div className={`designer-check-item designer-check-${item.level}`} key={item.title}>
              <span>{item.level === 'error' ? <AlertOutlined /> : item.level === 'warning' ? <WarningOutlined /> : <CheckCircleOutlined />}</span>
              <div>
                <strong>{item.title}</strong>
                <small>{item.detail}</small>
              </div>
            </div>
          ))}
        </div>
      </Modal>

      <VersionManager
        open={versionPanelOpen}
        form={platformForm}
        name={baseConfig.name}
        hasUnsavedChanges={hasUnsavedChanges}
        draftStatus={viewConfigMeta.status}
        savedAt={viewConfigMeta.draftSavedAt}
        busy={isPersistingFlow || isResolvingPlatformConfig}
        loadError={flowLoadError}
        onClose={() => setVersionPanelOpen(false)}
        onEdit={() => setVersionPanelOpen(false)}
        onSave={saveDraft}
        onPublish={publishConfig}
        onRestore={async () => {
          if (!platformForm || isPersistingFlow) return false;
          setPersistingFlow(true);
          try {
            await restorePlatformFormDraft(platformForm.id);
            restoredDesignFormId.current = platformForm.id;
            setServerPublishReport(null);
            setFieldDefaultValueDrafts({});
            setCopiedControl(null);
            setCopiedTree([]);
            setHistory([]);
            setFuture([]);
            setHasUnsavedChanges(false);
            setDesignerReloadKey(key => key + 1);
            message.success('已用线上配置重置草稿，可继续编辑后重新发布');
            return true;
          } catch {
            message.error('重置草稿失败，请重试');
            return false;
          } finally {
            setPersistingFlow(false);
          }
        }}
      />

      <Modal
        centered
        className="form-designer-dialog designer-rule-modal"
        destroyOnClose
        okText="保存规则"
        onCancel={() => {
          const opening=ruleOpeningValue.current;if(opening&&selectedControl?.id===opening.id)updateSelectedControl({rules:{...selectedControl.rules,[opening.key]:opening.value}});
          setEditingRuleGroupTitle(null);setRuleModal(null);ruleOpeningValue.current=null;
        }}
        onOk={() => {
          message.success(`${activeRuleLabel}规则已保存`);
          setEditingRuleGroupTitle(null);
          setRuleModal(null);
        }}
        open={Boolean(activeRule)}
        width={980}
        title={`${activeRuleLabel}规则`}
      >
        {ruleModal && activeRule && (
          <div className="designer-rule-form">
            <div className="designer-rule-window-layout">
              <aside className="designer-rule-window-sidebar">
                <button
                  className={`designer-rule-window-tab ${ruleWindowMode === 'common' ? 'designer-rule-window-tab-active' : ''}`}
                  type="button"
                  onClick={() => setRuleWindowMode('common')}
                >
                  通用窗口
                </button>
                <button
                  className={`designer-rule-window-tab ${ruleWindowMode === 'custom' ? 'designer-rule-window-tab-active' : ''}`}
                  type="button"
                  onClick={() => setRuleWindowMode('custom')}
                >
                  自定义窗口
                </button>
              </aside>
            <div className="designer-rule-group-editor">
              <div className="designer-rule-group-editor-head">
                <Button size="small" icon={<PlusOutlined />} onClick={() => addSelectedRuleConditionGroup(ruleModal.ruleKey)}>
                  新增
                </Button>
              </div>
              <div className="designer-rule-group-list">
                {activeRuleConditionGroups.length ? (
                  <>
                    {activeRuleConditionGroups.map((group, groupIndex) => (
                      <React.Fragment key={`rule-group-${groupIndex}`}>
                        {groupIndex > 0 && <div className="designer-rule-or-divider">OR</div>}
                        <div className="designer-rule-condition-group">
                          <div className="designer-rule-condition-group-head">
                            {editingRuleGroupTitle?.ruleKey === ruleModal.ruleKey && editingRuleGroupTitle.groupIndex === groupIndex ? (
                              <Input
                                autoFocus
                                className="designer-rule-group-title-input"
                                size="small"
                                value={editingRuleGroupTitle.value}
                                onBlur={() => {
                                  updateSelectedRuleGroupTitle(ruleModal.ruleKey, groupIndex, editingRuleGroupTitle.value);
                                  setEditingRuleGroupTitle(null);
                                }}
                                onChange={(event) => setEditingRuleGroupTitle({
                                  ruleKey: ruleModal.ruleKey,
                                  groupIndex,
                                  value: event.target.value,
                                })}
                                onKeyDown={(event) => {
                                  if (event.key === 'Escape') {
                                    setEditingRuleGroupTitle(null);
                                  }
                                }}
                                onPressEnter={() => {
                                  updateSelectedRuleGroupTitle(ruleModal.ruleKey, groupIndex, editingRuleGroupTitle.value);
                                  setEditingRuleGroupTitle(null);
                                }}
                              />
                            ) : (
                              <button
                                className="designer-rule-group-title"
                                type="button"
                                onDoubleClick={() => setEditingRuleGroupTitle({
                                  ruleKey: ruleModal.ruleKey,
                                  groupIndex,
                                  value: getRuleGroupTitle(activeRule, groupIndex),
                                })}
                                title="双击编辑"
                              >
                                {getRuleGroupTitle(activeRule, groupIndex)}
                              </button>
                            )}
                            <Button
                              className="designer-rule-add-condition"
                              size="small"
                              type="text"
                              icon={<PlusOutlined />}
                              onClick={() => addSelectedRuleConditionRow(ruleModal.ruleKey, groupIndex)}
                            >
                              新增条件
                            </Button>
                          </div>
                          {group.map((condition, rowIndex) => (
                            <div className="designer-rule-condition-row" key={`rule-condition-${groupIndex}-${rowIndex}`}>
                              <Select
                                allowClear
                                placeholder="目标字段"
                                value={condition.sourceField}
                                onChange={(value) => updateSelectedRuleConditionRow(ruleModal.ruleKey, groupIndex, rowIndex, { sourceField: value, value: '' })}
                                options={conditionFieldOptions}
                              />
                              <Select
                                value={condition.operator || 'equals'}
                                onChange={(value) => updateSelectedRuleConditionRow(ruleModal.ruleKey, groupIndex, rowIndex, { operator: value })}
                                options={ruleOperatorOptions}
                              />
                              {renderRuleConditionValueControl(condition, groupIndex, rowIndex)}
                              <Button
                                aria-label="删除条件"
                                danger
                                size="small"
                                type="text"
                                icon={<DeleteOutlined />}
                                onClick={() => removeSelectedRuleConditionRow(ruleModal.ruleKey, groupIndex, rowIndex)}
                              />
                            </div>
                          ))}
                          <Button
                            className="designer-rule-delete-group"
                            danger
                            icon={<DeleteOutlined />}
                            size="small"
                            type="text"
                            onClick={() => removeSelectedRuleConditionGroup(ruleModal.ruleKey, groupIndex)}
                          >
                            删除条件组
                          </Button>
                        </div>
                      </React.Fragment>
                    ))}
                    <Button
                      className="designer-rule-add-or"
                      icon={<PlusOutlined />}
                      size="small"
                      type="text"
                      onClick={() => addSelectedRuleConditionGroup(ruleModal.ruleKey)}
                    >
                      添加或条件规则
                    </Button>
                  </>
                ) : (
                  <Button
                    className="designer-rule-empty-add"
                    icon={<PlusOutlined />}
                    size="small"
                    type="text"
                    onClick={() => addSelectedRuleConditionGroup(ruleModal.ruleKey)}
                  >
                    添加条件规则
                  </Button>
                )}
              </div>
            </div>
            </div>
            {activeRule && ruleModal && false && (
            <label>
              <span>规则启用</span>
              <Segmented
                block
                value={activeRule?.enabled ? 'enabled' : 'disabled'}
                onChange={(value) => ruleModal && updateSelectedControlRule(ruleModal.ruleKey, { enabled: value === 'enabled' })}
                options={[
                  { value: 'enabled', label: '启用' },
                  { value: 'disabled', label: '关闭' },
                ]}
              />
            </label>
            )}
            {activeRuleStrategyOptions.length > 0 && (
              <label className="designer-policy-setting">
                <span>规则策略</span>
                <Select
                  aria-label="规则策略" value={activeRule.conditions?.strategy || activeRuleStrategyOptions[0]?.value}
                  onChange={(value) => updateSelectedRuleCondition(ruleModal.ruleKey, { strategy: value })}
                  options={activeRuleStrategyOptions}
                />
              </label>
            )}
            {ruleModal.ruleKey==='unique'&&activeRule.conditions?.strategy==='compound'&&<label className="designer-policy-setting"><span>组合字段</span><Select mode="multiple" aria-label="组合唯一字段" value={activeRule.conditions?.fields||[]} options={conditionFieldOptions.filter(option=>option.value!==selectedControl?.fieldKey)} onChange={fields=>updateSelectedRuleCondition('unique',{fields})}/><small>当前字段与所选字段的组合必须唯一；空值不参与检查。</small></label>}
            {ruleModal.ruleKey==='unique'&&<small>范围限当前租户；删除的记录不参与校验，编辑时排除记录自身。发布前会检查已有重复数据。</small>}
            {ruleModal.ruleKey==='masked'&&(activeRule.conditions?.strategy||'role')==='role'&&<label className="designer-policy-setting"><span>可查看原文的角色</span><Select mode="multiple" aria-label="可查看原文的角色" options={identityRoleRecords.map(role=>({value:role.id,label:role.label||role.name}))} value={activeRule.conditions?.roleIds||[]} onChange={roleIds=>updateSelectedRuleCondition('masked',{roleIds})}/><small>未选角色时所有人均脱敏；只影响字段展示，不授予表单访问权限。</small></label>}
            {ruleModal.ruleKey==='masked'&&activeRule.conditions?.strategy!=='hidden'&&<Space><label><span>保留开头字符</span><InputNumber aria-label="保留开头字符" min={0} max={20} value={activeRule.conditions?.keepStart??1} onChange={value=>updateSelectedRuleCondition('masked',{keepStart:value??1})}/></label><label><span>保留结尾字符</span><InputNumber aria-label="保留结尾字符" min={0} max={20} value={activeRule.conditions?.keepEnd??1} onChange={value=>updateSelectedRuleCondition('masked',{keepEnd:value??1})}/></label></Space>}
            {ruleModal.ruleKey==='copyable'&&<small>禁止复制会阻止运行页的复制、剪切与拖出操作；复制时脱敏保留首尾字符。此设置不是下载、截图或接口访问权限。</small>}
            <label>
              <span>条件来源字段</span>
              <Select
                allowClear
                placeholder="不选则始终生效"
                value={activeRule.conditions?.sourceField}
                onChange={(value) => updateSelectedRuleCondition(ruleModal.ruleKey, { sourceField: value })}
                options={conditionFieldOptions}
              />
            </label>
            <label>
              <span>判断方式</span>
              <Select
                value={activeRule.conditions?.operator || 'equals'}
                onChange={(value) => updateSelectedRuleCondition(ruleModal.ruleKey, { operator: value })}
                options={ruleOperatorOptions}
              />
            </label>
            <label>
              <span>条件值</span>
              <Input
                placeholder="例如：严重、已提交、当前用户"
                value={activeRule.conditions?.value || ''}
                onChange={(event) => updateSelectedRuleCondition(ruleModal.ruleKey, { value: event.target.value })}
              />
            </label>
            <label>
              <span>说明文本</span>
              <Input.TextArea
                autoSize={{ minRows: 2, maxRows: 4 }}
                placeholder="说明这条规则什么时候生效"
                value={activeRule.conditions?.note || ''}
                onChange={(event) => updateSelectedRuleCondition(ruleModal.ruleKey, { note: event.target.value })}
              />
            </label>
          </div>
        )}
      </Modal>
    </div>
  );
}
