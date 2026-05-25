import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertOutlined,
  ApartmentOutlined,
  ArrowLeftOutlined,
  CalendarOutlined,
  CheckSquareOutlined,
  CheckCircleOutlined,
  CopyOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  DragOutlined,
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
  SaveOutlined,
  SearchOutlined,
  SelectOutlined,
  SettingOutlined,
  SwitcherOutlined,
  TabletOutlined,
  TableOutlined,
  TagsOutlined,
  UndoOutlined,
  UserOutlined,
  UserSwitchOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { Button, Input, InputNumber, Modal, Popover, Segmented, Select, Space, Switch, Tabs, Tag, Typography, message } from 'antd';
import { useNavigate, useParams } from 'react-router-dom';
import {
  adminListOrgUnits,
  adminListRoles,
  createPlatformForm,
  createPlatformFormField,
  listPlatformFormLayouts,
  listPlatformForms,
  listWorkflowBindings,
  updatePlatformForm,
  updateWorkflowBinding,
  upsertPlatformFormLayout,
  upsertWorkflowBinding,
  wfCreateDefinition,
  wfGetDefinition,
  wfUpdateDefinition,
  type PlatformForm,
} from '@/services/api';
import {
  makeDefaultViewConfig,
  normalizeViewConfig,
  sortByOrder,
  type ViewColumnRenderType,
  type ViewConfig,
  type ViewControlType,
  type ViewFilterConfig,
  type ViewFilterOperator,
  type ViewTableColumnConfig,
  type ViewTableDensity,
} from '@/utils/viewConfig';
import ProfessionalFlowDesigner, {
  createDefaultFlowConfig,
  validateFlowDesignerConfig,
  type FlowDesignerConfig,
  type FlowDesignerEdge,
  type FlowDesignerNode,
} from './ProfessionalFlowDesigner';
import './style.css';

type DesignerTab = 'form' | 'filter' | 'flow' | 'permission';
type ComponentPanel = 'components' | 'fieldTypes';
type ControlSource = 'field' | 'component';
type ControlWidth = 'quarter' | 'half' | 'threeQuarter' | 'full';
type FlowPortSide = 'top' | 'right' | 'bottom' | 'left';
type DropPosition = 'before' | 'after';
type ControlRuleKey = 'visible' | 'readonly' | 'required';
type PreviewMode = 'create' | 'edit' | 'list';
type PreviewDevice = 'desktop' | 'tablet' | 'mobile';
type PublishCheckLevel = 'error' | 'warning' | 'suggestion';

interface ControlRuleCondition {
  sourceField?: string;
  operator?: string;
  value?: string;
  note?: string;
}

interface ControlRule {
  enabled: boolean;
  conditions?: ControlRuleCondition;
}

type ControlRules = Record<ControlRuleKey, ControlRule>;

interface DesignerField {
  key: string;
  name: string;
  type: string;
  placeholder: string;
  locked?: boolean;
  required?: boolean;
  listVisible?: boolean;
  searchable?: boolean;
  sortable?: boolean;
  defaultValue?: string;
  validation?: string;
  optionSource?: string;
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

interface LayoutControl {
  id: string;
  source: ControlSource;
  controlType: string;
  name: string;
  desc?: string;
  fieldKey?: string;
  placeholder?: string;
  helpText?: string;
  optionSource?: string;
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

const controlWidthOptions = [
  { value: 'quarter', label: '25%' },
  { value: 'half', label: '50%' },
  { value: 'threeQuarter', label: '75%' },
  { value: 'full', label: '100%' },
];

const previewModeOptions = [
  { value: 'create', label: '新建记录' },
  { value: 'edit', label: '编辑记录' },
  { value: 'list', label: '列表页' },
];

const previewDeviceOptions = [
  { value: 'desktop', label: '桌面', icon: <LayoutOutlined /> },
  { value: 'tablet', label: '平板', icon: <TabletOutlined /> },
  { value: 'mobile', label: '手机', icon: <MobileOutlined /> },
];

const controlTypeOptions = [
  { value: 'text', label: '文本输入' },
  { value: 'textarea', label: '多行文本' },
  { value: 'number', label: '数值输入' },
  { value: 'select', label: '下拉选择' },
  { value: 'relation', label: '对象/人员选择' },
  { value: 'datetime', label: '日期时间' },
  { value: 'upload', label: '附件上传' },
  { value: 'switch', label: '开关切换' },
  { value: 'readonly-text', label: '只读展示' },
];

const ruleLabels: Record<ControlRuleKey, string> = {
  visible: '显示',
  readonly: '只读',
  required: '必输',
};

const ruleOperatorOptions = [
  { value: 'equals', label: '等于' },
  { value: 'notEquals', label: '不等于' },
  { value: 'contains', label: '包含' },
  { value: 'notEmpty', label: '不为空' },
];

const viewControlOptions: Array<{ value: ViewControlType; label: string }> = [
  { value: 'keyword', label: '关键词' },
  { value: 'text', label: '文本输入' },
  { value: 'select', label: '下拉选择' },
  { value: 'dateRange', label: '日期范围' },
  { value: 'date', label: '单日期' },
  { value: 'number', label: '数字' },
  { value: 'relation', label: '关联对象' },
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

const tableDensityOptions: Array<{ value: ViewTableDensity; label: string }> = [
  { value: 'compact', label: '紧凑' },
  { value: 'middle', label: '标准' },
  { value: 'large', label: '宽松' },
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

function makeControlRules(required = false): ControlRules {
  return {
    visible: { enabled: true },
    readonly: { enabled: false },
    required: { enabled: required },
  };
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
    version: 'v0.1',
    description: '用于新增风险复核业务数据，而不是配置整个运行页面。',
    fields: [
      { key: 'riskNo', name: '风险单号', type: '文本 / 自动编号', placeholder: '自动生成 SR-2605-001', locked: true, required: true, listVisible: true, searchable: true, sortable: true, validation: '系统唯一编号，不允许重复' },
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
    dataSource: 'equipment_alerts',
    primaryKey: 'alertId',
    status: '已发布',
    version: 'v0.1',
    description: '用于新增设备告警数据，字段和风险复核不同。',
    fields: [
      { key: 'alertId', name: '告警编号', type: '文本 / 自动编号', placeholder: '自动生成 AL-2605-001', locked: true, required: true, listVisible: true, searchable: true, sortable: true, validation: '系统唯一编号，不允许重复' },
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
  version: 'v0.1',
  description: '用于配置新增业务数据的表单。',
  fields: [
    { key: 'id', name: '编号', type: '文本 / 自动编号', placeholder: '自动生成编号', locked: true, required: true, listVisible: true, searchable: true, validation: '系统唯一编号' },
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

const tabs = [
  { key: 'form', label: '表单设计', icon: <FormOutlined /> },
  { key: 'filter', label: '数据筛选', icon: <SearchOutlined /> },
  { key: 'flow', label: '流程设计', icon: <UserSwitchOutlined /> },
  { key: 'permission', label: '权限设计', icon: <LockOutlined /> },
];

const componentGroups: Array<{ category: string; items: ComponentDefinition[] }> = [
  {
    category: '文本类',
    items: [
      { key: 'text', category: '文本类', name: '文本控件', desc: '单行文本输入', icon: <FormOutlined />, controlType: 'text' },
      { key: 'textarea', category: '文本类', name: '多行文本', desc: '长文本、备注、说明录入', icon: <FormOutlined />, controlType: 'textarea', defaultWidth: 'full' },
      { key: 'readonly-text', category: '文本类', name: '只读文本', desc: '展示计算值、引用值', icon: <FileSearchOutlined />, controlType: 'readonly-text' },
    ],
  },
  {
    category: '选择类',
    items: [
      { key: 'number', category: '选择类', name: '数值控件', desc: '数量、金额、百分比', icon: <NumberOutlined />, controlType: 'number' },
      { key: 'select', category: '选择类', name: '选择控件', desc: '下拉、单选、多选', icon: <SelectOutlined />, controlType: 'select' },
      { key: 'datetime', category: '选择类', name: '日期控件', desc: '日期、时间、时间范围', icon: <CalendarOutlined />, controlType: 'datetime' },
      { key: 'relation', category: '选择类', name: '对象选择', desc: '人员、设备、供应商、物料', icon: <LinkOutlined />, controlType: 'relation' },
      { key: 'switch', category: '选择类', name: '开关控件', desc: '是否、启用、状态切换', icon: <SwitcherOutlined />, controlType: 'switch' },
      { key: 'upload', category: '选择类', name: '附件控件', desc: '图片、文件、凭证上传', icon: <PaperClipOutlined />, controlType: 'upload', defaultWidth: 'full' },
    ],
  },
  {
    category: '布局类',
    items: [
      { key: 'container', category: '布局类', name: '容器', desc: '分组面板、基础信息区', icon: <HolderOutlined />, controlType: 'container', defaultWidth: 'full' },
      { key: 'two-columns', category: '布局类', name: '多列布局', desc: '两列、三列、高密度字段排版', icon: <HolderOutlined />, controlType: 'two-columns', defaultWidth: 'full' },
      { key: 'tabs', category: '布局类', name: 'Tab 页', desc: '切换页签、次要信息收起', icon: <HolderOutlined />, controlType: 'tabs', defaultWidth: 'full' },
      { key: 'divider', category: '布局类', name: '分割符', desc: '分割线、区块说明', icon: <FileSearchOutlined />, controlType: 'divider', defaultWidth: 'full' },
    ],
  },
  {
    category: '数据类',
    items: [
      { key: 'editable-table', category: '数据类', name: '表格', desc: '可编辑子表、明细行', icon: <TableOutlined />, controlType: 'editable-table', defaultWidth: 'full' },
      { key: 'readonly-table', category: '数据类', name: '关联表格', desc: '只读关联表、分页详情', icon: <TableOutlined />, controlType: 'readonly-table', defaultWidth: 'full' },
      { key: 'summary-card', category: '数据类', name: '数据摘要', desc: '摘要卡、统计值、关联对象概览', icon: <DatabaseOutlined />, controlType: 'summary-card', defaultWidth: 'full' },
    ],
  },
  {
    category: '展示类',
    items: [
      { key: 'status-tag', category: '展示类', name: '状态标签', desc: '状态、等级、结果标识', icon: <TagsOutlined />, controlType: 'status-tag' },
      { key: 'file-preview', category: '展示类', name: '媒体预览', desc: '图片、附件、凭证预览', icon: <FileImageOutlined />, controlType: 'file-preview', defaultWidth: 'full' },
    ],
  },
  {
    category: '业务类',
    items: [
      { key: 'approval-comment', category: '业务类', name: '审批处理', desc: '审批意见、处理说明、签批记录', icon: <UserSwitchOutlined />, controlType: 'approval-comment', defaultWidth: 'full' },
      { key: 'operation-log', category: '业务类', name: '操作记录', desc: '操作日志、变更记录、审计轨迹', icon: <FileSearchOutlined />, controlType: 'operation-log', defaultWidth: 'full' },
      { key: 'status-flow', category: '业务类', name: '状态流转', desc: '流程状态、节点进度、关闭归档', icon: <UserSwitchOutlined />, controlType: 'status-flow', defaultWidth: 'full' },
      { key: 'risk-level', category: '业务类', name: '风险校验', desc: '风险等级、校验提示、异常规则', icon: <TagsOutlined />, controlType: 'risk-level' },
    ],
  },
];

const commonControlKeys = ['text', 'number', 'select', 'datetime', 'upload', 'container', 'editable-table', 'tabs', 'divider'];
const commonControls = commonControlKeys
  .map((key) => componentGroups.flatMap((group) => group.items).find((item) => item.key === key))
  .filter((item): item is ComponentDefinition => Boolean(item));

const alertBusinessSections: BusinessSection[] = [
  { key: 'basic', title: '基础信息', desc: '识别告警、说明主题和来源', fieldKeys: ['alertId', 'title', 'source', 'occurredAt'] },
  { key: 'device', title: '设备信息', desc: '定位设备、等级和影响范围', fieldKeys: ['device', 'level'] },
  { key: 'handle', title: '告警处理', desc: '明确责任人、时限、状态和结论', fieldKeys: ['owner', 'dueAt', 'status', 'resolution'] },
  { key: 'evidence', title: '附件证据', desc: '上传现场图片、日志和处理凭证', fieldKeys: ['evidence'] },
  { key: 'approval', title: '审批/流转信息', desc: '展示流程状态、操作记录和关闭轨迹', fieldKeys: [] },
];

const fieldTemplates: DesignerField[] = [
  { key: 'templateCode', name: '业务编号', type: '文本 / 自动编号', placeholder: '自动生成唯一编号', locked: true, required: true, listVisible: true, searchable: true, sortable: true },
  { key: 'templateTitle', name: '标题', type: '文本输入', placeholder: '请输入标题', required: true, listVisible: true, searchable: true },
  { key: 'templateStatus', name: '状态', type: '下拉选择', placeholder: '待处理 / 处理中 / 已关闭', listVisible: true, searchable: true, optionSource: '待处理、处理中、已关闭' },
  { key: 'templateLevel', name: '等级', type: '下拉选择', placeholder: '高 / 中 / 低', listVisible: true, searchable: true, optionSource: '高、中、低' },
  { key: 'templateOwner', name: '责任人', type: '人员选择', placeholder: '选择责任人', listVisible: true, searchable: true, optionSource: '组织人员' },
  { key: 'templateTime', name: '时间', type: '日期控件', placeholder: '选择时间', listVisible: true, sortable: true },
  { key: 'templateAttachment', name: '附件', type: '附件控件', placeholder: '上传附件', listVisible: false },
  { key: 'templateRemark', name: '备注', type: '多行文本', placeholder: '填写备注说明', listVisible: false },
];

const recommendedRules = [
  '选择关联设备后自动带出产线、设备位置和默认处理人',
  '告警等级为“严重”时，附件证据和处理时限必填',
  '告警状态为“已关闭”时，处理结论必填',
  '超过处理时限时自动标记为逾期并提醒责任人',
];

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
  const raw = source || fallback || '';
  const values = raw
    .split(/[、,/，|]/)
    .map((item) => item.trim())
    .filter(Boolean);
  const normalized = values.length ? values : (fallback ? [fallback] : ['待配置选项']);
  return normalized.map((item) => ({ value: item, label: item }));
}

function inferFieldControlType(field?: DesignerField) {
  if (!field) return 'text';
  if (field.type.includes('下拉')) return 'select';
  if (field.type.includes('人员') || field.type.includes('关联')) return 'relation';
  if (field.type.includes('日期')) return 'datetime';
  if (field.type.includes('附件')) return 'upload';
  if (field.type.includes('多行')) return 'textarea';
  if (field.type.includes('数字') || field.type.includes('数值')) return 'number';
  return 'text';
}

function isDataSourceControlType(controlType?: string) {
  return controlType === 'select' || controlType === 'relation';
}

function fieldInput(field: DesignerField, placeholderOverride?: string, disabled = false, optionSourceOverride?: string, controlTypeOverride?: string) {
  const placeholder = placeholderOverride || field.placeholder;
  const controlType = controlTypeOverride && controlTypeOverride !== 'field' ? controlTypeOverride : inferFieldControlType(field);
  if (controlType === 'select' || controlType === 'relation') {
    return <Select disabled={disabled} placeholder={placeholder} options={optionSourceToOptions(optionSourceOverride || field.optionSource, placeholder)} />;
  }
  if (controlType === 'datetime') {
    return <Input disabled={disabled} placeholder={placeholder} prefix={<CalendarOutlined />} />;
  }
  if (controlType === 'upload') {
    return <Button disabled={disabled} icon={<PaperClipOutlined />}>{placeholder || '选择文件'}</Button>;
  }
  if (controlType === 'textarea') {
    return <Input.TextArea disabled={disabled} placeholder={placeholder} autoSize={{ minRows: 2, maxRows: 4 }} />;
  }
  if (controlType === 'number') {
    return <Input disabled={disabled} placeholder={placeholder} suffix="#" />;
  }
  if (controlType === 'switch') {
    return <Segmented disabled={disabled} options={['否', '是']} value="否" />;
  }
  if (controlType === 'readonly-text') {
    return <Input disabled value={placeholder || field.name} />;
  }
  return <Input disabled={disabled} placeholder={placeholder} />;
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

function normalizeProfessionalFlowConfig(
  source: Partial<FlowDesignerConfig> & Record<string, unknown>,
  fallback: FlowDesignerConfig,
): FlowDesignerConfig {
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
    manualTask: 'bpmn:ManualTask',
    ccTask: 'bpmn:SendTask',
    exclusiveGateway: 'bpmn:ExclusiveGateway',
    parallelGateway: 'bpmn:ParallelGateway',
    joinGateway: 'bpmn:ParallelGateway',
  };
  const executableTypes = new Set(['startEvent', 'endEvent', 'userTask', 'serviceTask', 'manualTask', 'ccTask', 'exclusiveGateway', 'parallelGateway', 'joinGateway']);
  const rawNodes = Array.isArray(source.nodes) ? source.nodes : fallback.nodes;
  const nodes = rawNodes
    .filter(Boolean)
    .map((raw, index) => {
      const node = raw as Partial<FlowDesignerNode> & { data?: Record<string, unknown>; assigneeType?: string };
      const fallbackNode = fallback.nodes[index] || fallback.nodes[0];
      const type = String(node.type || node.data?.type || fallbackNode?.type || 'manualTask');
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
        approvalMode: node.approvalMode || fallbackNode?.approvalMode,
        slaHours: node.slaHours ?? fallbackNode?.slaHours,
        notificationEnabled: node.notificationEnabled ?? fallbackNode?.notificationEnabled,
        errorPolicy: node.errorPolicy || fallbackNode?.errorPolicy,
        retryTimes: node.retryTimes ?? fallbackNode?.retryTimes,
        bpmnType: node.bpmnType || bpmnByType[type] || fallbackNode?.bpmnType,
        fieldPermissions: node.fieldPermissions || fallbackNode?.fieldPermissions,
      } satisfies FlowDesignerNode;
    });
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
        priority: Number.isFinite(Number(edge.priority)) ? Number(edge.priority) : index + 1,
        isDefault: Boolean(edge.isDefault),
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

function mapDesignerFieldType(type: string) {
  if (type.includes('日期')) return 'datetime';
  if (type.includes('数字') || type.includes('数值')) return 'number';
  if (type.includes('下拉') || type.includes('选择')) return 'enum';
  if (type.includes('多行')) return 'text';
  if (type.includes('附件')) return 'json';
  return 'string';
}

function makeWorkflowFormConfig(config: DesignerConfig) {
  return {
    formCode: config.id,
    formName: config.name,
    fields: config.fields.map((field, index) => ({
      name: field.key,
      label: field.name,
      type: mapDesignerFieldType(field.type),
      required: Boolean(field.required),
      sortOrder: index,
    })),
  };
}

function makeWorkflowConfigPayload(flowConfig: FlowDesignerConfig, form: PlatformForm, config: DesignerConfig) {
  return {
    ...flowConfig,
    formId: form.id,
    formCode: form.code,
    formName: config.name,
    savedAt: new Date().toISOString(),
    fieldPermissions: Object.fromEntries(
      flowConfig.nodes.map((node) => [node.id, node.fieldPermissions || {}]),
    ),
  };
}

function makeFieldControl(field: DesignerField): LayoutControl {
  return {
    id: `field-${field.key}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    source: 'field',
    controlType: inferFieldControlType(field),
    name: field.name,
    fieldKey: field.key,
    placeholder: field.placeholder,
    helpText: '',
    optionSource: field.optionSource,
    width: field.type.includes('多行') ? 'full' : 'half',
    rules: makeControlRules(Boolean(field.required)),
  };
}

function makeComponentControl(component: ComponentDefinition): LayoutControl {
  return {
    id: `component-${component.key}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    source: 'component',
    controlType: component.controlType,
    name: component.name,
    desc: component.desc,
    placeholder: component.desc,
    helpText: '',
    optionSource: ['select', 'relation'].includes(component.controlType) ? component.desc : undefined,
    width: component.defaultWidth || 'half',
    rules: makeControlRules(),
  };
}

function cloneControl(control: LayoutControl): LayoutControl {
  return {
    ...control,
    id: `${control.id}-copy-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: control.name,
    rules: {
      visible: { ...control.rules.visible, conditions: control.rules.visible.conditions ? { ...control.rules.visible.conditions } : undefined },
      readonly: { ...control.rules.readonly, conditions: control.rules.readonly.conditions ? { ...control.rules.readonly.conditions } : undefined },
      required: { ...control.rules.required, conditions: control.rules.required.conditions ? { ...control.rules.required.conditions } : undefined },
    },
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
      <Button
        data-rule-action="config"
        size="small"
        icon={<SettingOutlined />}
        onMouseDownCapture={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => runButtonAction(event, onConfig)}
        title={`${title}条件配置`}
      />
      <Button
        data-rule-action="toggle"
        className="designer-rule-check"
        size="small"
        type={enabled ? 'primary' : 'default'}
        icon={<CheckCircleOutlined />}
        onMouseDownCapture={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => runButtonAction(event, onToggle)}
        title={enabled ? `${title}已启用` : `${title}未启用`}
      />
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

export default function FormSettingsPage() {
  const { formId } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<DesignerTab>('form');
  const [componentPanel, setComponentPanel] = useState<ComponentPanel>('components');
  const [version, setVersion] = useState('v0.1');
  const baseConfig = (formId && configs[formId]) || { ...defaultConfig, id: formId || defaultConfig.id };
  const [viewConfig, setViewConfig] = useState<ViewConfig>(() => makeDesignerViewConfig(baseConfig));
  const [expandedViewRow, setExpandedViewRow] = useState<string>('filter-0');
  const [viewPreviewDevice, setViewPreviewDevice] = useState<'desktop' | 'narrow'>('desktop');
  const [layoutControls, setLayoutControls] = useState<LayoutControl[]>(baseConfig.fields.map(makeFieldControl));
  const [selectedControlId, setSelectedControlId] = useState<string>('');
  const [selectedAssetKey, setSelectedAssetKey] = useState<string>(baseConfig.fields[0]?.key || '');
  const [propertyTab, setPropertyTab] = useState<'control' | 'field'>('control');
  const [copiedControl, setCopiedControl] = useState<LayoutControl | null>(null);
  const [history, setHistory] = useState<LayoutControl[][]>([]);
  const [future, setFuture] = useState<LayoutControl[][]>([]);
  const [librarySearch, setLibrarySearch] = useState('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewMode, setPreviewMode] = useState<PreviewMode>('create');
  const [previewDevice, setPreviewDevice] = useState<PreviewDevice>('desktop');
  const [previewFlowNodeId, setPreviewFlowNodeId] = useState('');
  const [publishCheckOpen, setPublishCheckOpen] = useState(false);
  const [versionPanelOpen, setVersionPanelOpen] = useState(false);
  const [draggedControlId, setDraggedControlId] = useState('');
  const [dropHint, setDropHint] = useState<{ controlId: string; position: DropPosition } | null>(null);
  const [isCanvasDragActive, setCanvasDragActive] = useState(false);
  const [ruleOverrides, setRuleOverrides] = useState<Record<string, boolean>>({});
  const [ruleModal, setRuleModal] = useState<{ controlId: string; ruleKey: ControlRuleKey } | null>(null);
  const [professionalFlowConfig, setProfessionalFlowConfig] = useState<FlowDesignerConfig>(() => makeProfessionalFlowConfig(baseConfig));
  const [platformForm, setPlatformForm] = useState<PlatformForm | null>(null);
  const [workflowMeta, setWorkflowMeta] = useState<WorkflowDesignerMeta>({});
  const [isPersistingFlow, setPersistingFlow] = useState(false);
  const [identityRoles, setIdentityRoles] = useState<string[]>([]);
  const [identityOrgUnits, setIdentityOrgUnits] = useState<string[]>([]);
  const permissionRoles = identityRoles.length ? identityRoles : baseConfig.roles;
  const permissionOrgUnits = identityOrgUnits.length ? identityOrgUnits : ['本部门', '所属工厂', '个人创建'];
  const previewFlowNodes = useMemo(
    () => professionalFlowConfig.nodes.filter((node) => node.executable || node.type === 'startEvent' || node.type === 'endEvent'),
    [professionalFlowConfig.nodes],
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

  useEffect(() => {
    Promise.all([adminListRoles(), adminListOrgUnits()])
      .then(([roleRes, orgRes]) => {
        setIdentityRoles((roleRes.data?.data || []).map((role: any) => role.label || role.name).filter(Boolean));
        setIdentityOrgUnits((orgRes.data?.data || []).map((org: any) => org.name).filter(Boolean));
      })
      .catch(() => {
        setIdentityRoles([]);
        setIdentityOrgUnits([]);
      });
  }, []);

  useEffect(() => {
    const nextControls = baseConfig.fields.map(makeFieldControl);
    setLayoutControls(nextControls);
    setSelectedControlId(nextControls[0]?.id || '');
    setSelectedAssetKey(baseConfig.fields[0]?.key || '');
    setViewConfig(makeDesignerViewConfig(baseConfig));
    setExpandedViewRow('filter-0');
    setViewPreviewDevice('desktop');
    setVersion(baseConfig.version);
    setCopiedControl(null);
    setHistory([]);
    setFuture([]);
    setLibrarySearch('');
    setHasUnsavedChanges(false);
    setPreviewOpen(false);
    setPublishCheckOpen(false);
    setVersionPanelOpen(false);
    setPreviewFlowNodeId('');
    setDraggedControlId('');
    setDropHint(null);
    setCanvasDragActive(false);
    setRuleOverrides({});
    setRuleModal(null);
    setProfessionalFlowConfig(makeProfessionalFlowConfig(baseConfig));
    setPlatformForm(null);
    setWorkflowMeta({});
    const nextFlowNodes = makeFlowNodes(baseConfig.flowSteps);
    setFlowNodes(nextFlowNodes);
    setFlowConnections(makeFlowConnections(nextFlowNodes));
    setPendingFlowPort(null);
  }, [baseConfig.id, baseConfig.version, baseConfig.fields, baseConfig.flowSteps]);

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
    if (selectedControlId) {
      setPropertyTab('control');
      return;
    }
    if (selectedAssetKey) setPropertyTab('field');
  }, [selectedAssetKey, selectedControlId]);

  useEffect(() => {
    let cancelled = false;
    const loadPersistedFlow = async () => {
      try {
        const formsResponse = await listPlatformForms();
        const forms = (formsResponse.data?.data || []) as PlatformForm[];
        const matchedForm = forms.find((form) => form.code === baseConfig.id);
        if (!matchedForm || cancelled) return;
        setPlatformForm(matchedForm);
        let persistedViewConfig = getStoredViewConfig(matchedForm, baseConfig);
        if (!persistedViewConfig) {
          try {
            const layoutsResponse = await listPlatformFormLayouts(matchedForm.id);
            const layouts = (layoutsResponse.data?.data || []) as Array<{ layout_type?: string; config?: Record<string, unknown> }>;
            const viewLayout = layouts.find((layout) => layout.layout_type === 'view');
            const layoutConfig = viewLayout?.config || {};
            const layoutView = layoutConfig.draft || layoutConfig.published;
            if (layoutView) {
              persistedViewConfig = normalizeViewConfig(
                layoutView,
                designerFieldsToViewFields(baseConfig.fields),
                baseConfig.filters.map((filter) => filter.key),
              );
            }
          } catch (error) {
            console.warn('view layout load failed', error);
          }
        }
        if (persistedViewConfig && !cancelled) {
          setViewConfig(persistedViewConfig);
        }
        const meta = getWorkflowDesignerMeta(matchedForm);
        setWorkflowMeta(meta);
        const workflowId = meta.draftWorkflowId || meta.publishedWorkflowId;
        if (!workflowId) return;
        const definitionResponse = await wfGetDefinition(workflowId);
        if (cancelled) return;
        const definition = definitionResponse.data as WorkflowDefinitionPayload;
        if (definition.config?.nodes && definition.config?.edges) {
          const defaultFlow = makeProfessionalFlowConfig(baseConfig);
          const nextConfig = normalizeProfessionalFlowConfig({
            ...definition.config,
            version: definition.version ? `v${definition.version}` : String(definition.config.version || defaultFlow.version),
          }, defaultFlow);
          setProfessionalFlowConfig(nextConfig);
          setVersion(nextConfig.version);
          setHasUnsavedChanges(false);
        }
      } catch (error) {
        console.warn('workflow designer load failed', error);
        if (!cancelled) {
          message.warning('未能加载后端流程草稿，当前使用本地默认配置');
        }
      }
    };
    loadPersistedFlow();
    return () => {
      cancelled = true;
    };
  }, [baseConfig.id, baseConfig.name, baseConfig.version, baseConfig.fields, baseConfig.flowSteps]);

  const selectedControl = useMemo(
    () => layoutControls.find((control) => control.id === selectedControlId),
    [layoutControls, selectedControlId],
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
  const selectedEffectiveControlType = selectedControl
    ? selectedControl.controlType === 'field'
      ? inferFieldControlType(selectedField)
      : selectedControl.controlType
    : '';
  const selectedControlUsesDataSource = Boolean(
    selectedControl && isDataSourceControlType(selectedEffectiveControlType),
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
  const alertSections = baseConfig.id === 'alert-center' ? alertBusinessSections : [
    { key: 'default', title: '基础信息', desc: '当前表单的主要录入字段', fieldKeys: baseConfig.fields.map((field) => field.key) },
  ];
  const searchableFieldCount = baseConfig.fields.filter((field) => field.searchable).length;
  const requiredControlsInCanvas = layoutControls.filter((control) => control.rules.required.enabled).length;
  const hiddenRequiredControls = layoutControls.filter((control) => !control.rules.visible.enabled && control.rules.required.enabled);
  const publishChecks = useMemo<PublishCheckItem[]>(() => {
    const canvasFieldKeys = new Set(layoutControls.map((control) => control.fieldKey).filter(Boolean));
    const missingRequired = baseConfig.fields.filter((field) => field.required && !canvasFieldKeys.has(field.key));
    const enumWithoutSource = baseConfig.fields.filter((field) => field.type.includes('下拉') && !field.optionSource);
    const relationWithoutSource = baseConfig.fields.filter((field) => field.type.includes('关联') && !field.optionSource);
    const enabledFilters = viewConfig.filters.filter((filter) => filter.enabled);
    const enabledColumns = viewConfig.table.columns.filter((column) => column.enabled);
    const flowValidation = validateFlowDesignerConfig(professionalFlowConfig);
    const flowErrors = flowValidation.filter((item) => item.level === 'error');
    const flowWarnings = flowValidation.filter((item) => item.level === 'warning');
    const invalidViewFields = [
      ...enabledFilters.filter((filter) => !baseConfig.fields.some((field) => field.key === filter.fieldName)).map((filter) => filter.label),
      ...enabledColumns.filter((column) => !baseConfig.fields.some((field) => field.key === column.fieldName)).map((column) => column.label),
    ];
    const checks: PublishCheckItem[] = [
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
        level: enabledColumns.length ? 'suggestion' : 'error',
        title: '数据展示列',
        detail: enabledColumns.length ? `已启用 ${enabledColumns.length} 个表格展示列。` : '运行页表格至少需要一个展示列。',
      },
      {
        level: invalidViewFields.length ? 'error' : 'suggestion',
        title: '视图字段绑定',
        detail: invalidViewFields.length ? `以下筛选或列绑定字段不存在：${invalidViewFields.join('、')}` : '筛选条件和表格列均已绑定有效字段。',
      },
      {
        level: baseConfig.id === 'alert-center' ? 'suggestion' : 'warning',
        title: '严重告警处理规则',
        detail: baseConfig.id === 'alert-center' ? '已启用推荐规则：严重告警要求附件证据和处理时限。' : '建议按业务场景配置高风险记录的强制处理规则。',
      },
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
  }, [baseConfig.fields, baseConfig.id, hiddenRequiredControls, layoutControls, professionalFlowConfig, searchableFieldCount, viewConfig]);
  const publishErrorCount = publishChecks.filter((item) => item.level === 'error').length;
  const publishWarningCount = publishChecks.filter((item) => item.level === 'warning').length;

  const updateSelectedControlRule = (ruleKey: ControlRuleKey, patch: Partial<ControlRule>) => {
    if (!selectedControl) return;
    const currentRule = selectedControl.rules[ruleKey];
    updateSelectedControl({
      rules: {
        ...selectedControl.rules,
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
        ...(selectedControl.rules[ruleKey].conditions || {}),
        ...patch,
      },
    });
  };

  const genericRuleToggle = (defaultEnabled: boolean, title: string, key = title) => {
    const scope = selectedControl?.id || selectedField?.key || baseConfig.id;
    const ruleKey = `${activeTab}:${scope}:${key}`;
    const enabled = ruleOverrides[ruleKey] ?? defaultEnabled;
    return (
      <RuleToggleControl
        enabled={enabled}
        onConfig={() => {
          setRuleOverrides((current) => ({ ...current, [ruleKey]: current[ruleKey] ?? defaultEnabled }));
          message.info(`已进入「${title}」条件配置，可按字段、角色或流程状态设置规则`);
        }}
        onToggle={() => {
          setRuleOverrides((current) => {
            const nextEnabled = !(current[ruleKey] ?? defaultEnabled);
            message.success(`${title}已${nextEnabled ? '启用' : '关闭'}`);
            return { ...current, [ruleKey]: nextEnabled };
          });
        }}
        title={title}
      />
    );
  };

  const controlRuleToggle = (ruleKey: ControlRuleKey) => {
    if (!selectedControl) return null;
    const rule = selectedControl.rules[ruleKey];
    const title = ruleLabels[ruleKey];
    return (
      <RuleToggleControl
        enabled={rule.enabled}
        onConfig={() => setRuleModal({ controlId: selectedControl.id, ruleKey })}
        onToggle={() => updateSelectedControlRule(ruleKey, { enabled: !rule.enabled })}
        title={title}
      />
    );
  };

  const markUnsaved = () => setHasUnsavedChanges(true);

  const updateViewConfig = (updater: (current: ViewConfig) => ViewConfig) => {
    setViewConfig((current) => updater(current));
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

  const updateViewTable = (patch: Partial<ViewConfig['table']>) => {
    updateViewConfig((current) => ({
      ...current,
      table: { ...current.table, ...patch },
    }));
  };

  const ensurePlatformForm = async () => {
    if (platformForm) return platformForm;
    const formsResponse = await listPlatformForms();
    const forms = (formsResponse.data?.data || []) as PlatformForm[];
    const matchedForm = forms.find((form) => form.code === baseConfig.id);
    if (matchedForm) {
      setPlatformForm(matchedForm);
      setWorkflowMeta(getWorkflowDesignerMeta(matchedForm));
      return matchedForm;
    }

    const createResponse = await createPlatformForm({
      name: baseConfig.name,
      code: baseConfig.id,
      description: baseConfig.description,
      table_name: baseConfig.dataSource,
      storage_mode: 'dynamic',
      status: 'active',
      config: {
        workflowDesigner: {},
        source: 'form-settings',
        viewConfig,
        viewConfigDraft: viewConfig,
        viewConfigMeta: {
          draftVersion: 1,
          publishedVersion: 1,
          draftSavedAt: new Date().toISOString(),
          publishedAt: new Date().toISOString(),
          status: 'published',
        },
      },
    });
    const createdForm = createResponse.data?.data as PlatformForm;
    await Promise.all(baseConfig.fields.map((field, index) => createPlatformFormField(createdForm.id, {
      field_name: field.key,
      label: field.name,
      field_type: mapDesignerFieldType(field.type),
      required: Boolean(field.required),
      visible_in_list: field.listVisible !== false,
      visible_in_form: true,
      searchable: Boolean(field.searchable),
      sortable: Boolean(field.sortable),
      default_value: field.defaultValue,
      enum_values: field.optionSource ? { source: field.optionSource } : undefined,
      validation: field.validation ? { message: field.validation } : undefined,
      ui_config: {
        placeholder: field.placeholder,
        locked: Boolean(field.locked),
        designerType: field.type,
      },
      sort_order: index,
    })));
    setPlatformForm(createdForm);
    setWorkflowMeta({});
    return createdForm;
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
          viewConfigMeta: nextMeta,
        }
      : {
          ...currentConfig,
          viewConfig: nextViewConfig,
          viewConfigDraft: nextViewConfig,
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

  const saveDraft = async () => {
    if (isPersistingFlow) return;
    setPersistingFlow(true);
    try {
      const form = await ensurePlatformForm();
      const formWithView = await updateFormViewConfig(form, viewConfig, 'draft');
      const meta = getWorkflowDesignerMeta(formWithView);
      const saved = await saveWorkflowDefinition('draft', formWithView, meta.draftWorkflowId);
      await updateFormWorkflowMeta(formWithView, { ...meta, draftWorkflowId: saved.id });
      setVersion(`v${saved.version}`);
      setHasUnsavedChanges(false);
      message.success('草稿已保存，数据筛选配置和流程草稿都不会影响已发布运行页');
    } catch (error) {
      console.error('workflow draft save failed', error);
      message.error('草稿保存失败，请检查后端服务或登录状态');
    } finally {
      setPersistingFlow(false);
    }
  };

  const publishConfig = () => {
    setPublishCheckOpen(true);
  };

  const confirmPublish = async () => {
    if (publishErrorCount > 0) {
      message.error('请先处理发布确认中的阻断项');
      return;
    }
    if (isPersistingFlow) return;
    setPersistingFlow(true);
    try {
      const form = await ensurePlatformForm();
      const formWithView = await updateFormViewConfig(form, viewConfig, 'published');
      const meta = getWorkflowDesignerMeta(formWithView);
      const saved = await saveWorkflowDefinition('published', formWithView, meta.draftWorkflowId || meta.publishedWorkflowId);
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
      setVersion(`v${saved.version}`);
      setPublishCheckOpen(false);
      setHasUnsavedChanges(false);
      message.success('配置已发布，运行页会读取新的数据筛选和表格配置');
    } catch (error) {
      console.error('workflow publish failed', error);
      message.error('发布失败，请检查流程定义或绑定接口');
    } finally {
      setPersistingFlow(false);
    }
  };

  const warnBeforeLeave = () => {
    if (!hasUnsavedChanges) {
      navigate(`/program/${baseConfig.id}`);
      return;
    }
    Modal.confirm({
      title: '当前有未保存修改',
      content: '离开后本次表单设置调整将不会保留。建议先保存草稿或发布配置。',
      okText: '仍然离开',
      cancelText: '继续配置',
      onOk: () => navigate(`/program/${baseConfig.id}`),
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
    commitLayoutChange((current) => [...current, control]);
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
      const next = updater(current);
      setHistory((previous) => [...previous.slice(-19), current]);
      setFuture([]);
      markUnsaved();
      return next;
    });
  };

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
    commitLayoutChange((current) => [...current, control]);
    setSelectedControlId(control.id);
    setSelectedAssetKey(field.key);
  };

  const addComponentToCanvas = (component: ComponentDefinition) => {
    const control = makeComponentControl(component);
    commitLayoutChange((current) => [...current, control]);
    setSelectedControlId(control.id);
  };

  const updateSelectedControl = (patch: Partial<LayoutControl>) => {
    if (!selectedControlId) return;
    commitLayoutChange((current) => current.map((control) => (
      control.id === selectedControlId ? { ...control, ...patch } : control
    )));
  };

  const moveLayoutControl = (sourceId: string, targetId: string, position: DropPosition = 'before') => {
    if (!sourceId || !targetId || sourceId === targetId) return;
    commitLayoutChange((current) => {
      const sourceIndex = current.findIndex((control) => control.id === sourceId);
      const targetIndex = current.findIndex((control) => control.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      const next = [...current];
      const [source] = next.splice(sourceIndex, 1);
      const nextTargetIndex = next.findIndex((control) => control.id === targetId);
      const insertIndex = position === 'after' ? nextTargetIndex + 1 : nextTargetIndex;
      next.splice(Math.max(0, insertIndex), 0, source);
      return next;
    });
    setSelectedControlId(sourceId);
    const source = layoutControls.find((control) => control.id === sourceId);
    if (source?.fieldKey) setSelectedAssetKey(source.fieldKey);
  };

  const moveLayoutControlToEnd = (sourceId: string) => {
    if (!sourceId) return;
    commitLayoutChange((current) => {
      const sourceIndex = current.findIndex((control) => control.id === sourceId);
      if (sourceIndex < 0 || sourceIndex === current.length - 1) return current;
      const next = [...current];
      const [source] = next.splice(sourceIndex, 1);
      next.push(source);
      return next;
    });
    setSelectedControlId(sourceId);
    const source = layoutControls.find((control) => control.id === sourceId);
    if (source?.fieldKey) setSelectedAssetKey(source.fieldKey);
  };

  const duplicateControl = (control?: LayoutControl | null) => {
    if (!control) return;
    const copied = cloneControl(control);
    setCopiedControl(control);
    commitLayoutChange((current) => [...current, copied]);
    setSelectedControlId(copied.id);
  };

  const copyControlToClipboard = (control?: LayoutControl | null) => {
    if (!control) return;
    setCopiedControl(control);
    message.success('已复制控件，可使用 Ctrl+V 粘贴');
  };

  const pasteCopiedControl = () => {
    if (!copiedControl) {
      message.warning('还没有复制控件');
      return;
    }
    const pasted = cloneControl(copiedControl);
    commitLayoutChange((current) => [...current, pasted]);
    setSelectedControlId(pasted.id);
  };

  const removeControl = (controlId?: string) => {
    const targetId = controlId || selectedControlId;
    const target = layoutControls.find((control) => control.id === targetId);
    if (!target) {
      message.warning('请先选择画布控件');
      return;
    }
    commitLayoutChange((current) => current.filter((control) => control.id !== targetId));
    setSelectedControlId('');
    message.success('已从画布移出控件，字段资产仍然保留');
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (activeTab !== 'form' || isEditableTarget(event.target)) return;
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
  }, [activeTab, copiedControl, selectedControl, selectedControlId, layoutControls]);

  const renderControlActions = (control: LayoutControl) => (
    <span className="designer-control-actions" onClick={(event) => event.stopPropagation()}>
      <Button size="small" type="text" title="复制" icon={<CopyOutlined />} onClick={() => duplicateControl(control)} />
      <Button size="small" type="text" danger title="移出画布" icon={<DeleteOutlined />} onClick={() => removeControl(control.id)} />
    </span>
  );

  const getCanvasControlDragProps = (control: LayoutControl) => ({
    draggable: true,
    onDragStart: (event: React.DragEvent<HTMLDivElement>) => {
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
      moveLayoutControl(sourceId, control.id, dropHint?.controlId === control.id ? dropHint.position : 'before');
      setDraggedControlId('');
      setDropHint(null);
      setCanvasDragActive(false);
    },
  });

  const renderControlLabel = (control: LayoutControl) => (
    <span className={control.rules.required.enabled ? 'designer-required-label' : undefined}>{control.name}</span>
  );

  const renderComponentInput = (control: LayoutControl) => {
    const disabled = control.rules.readonly.enabled;
    const placeholder = control.placeholder || control.desc || `请输入${control.name}`;
    if (control.controlType === 'textarea') {
      return <Input.TextArea disabled={disabled} placeholder={placeholder} autoSize={{ minRows: 2, maxRows: 4 }} />;
    }
    if (control.controlType === 'number') {
      return <Input disabled={disabled} placeholder={placeholder} suffix="#" />;
    }
    if (['select', 'relation'].includes(control.controlType)) {
      return <Select disabled={disabled} placeholder={placeholder} options={optionSourceToOptions(control.optionSource, placeholder)} />;
    }
    if (control.controlType === 'datetime') {
      return <Input disabled={disabled} placeholder={placeholder} prefix={<CalendarOutlined />} />;
    }
    if (control.controlType === 'upload') {
      return <Button disabled={disabled} icon={<PaperClipOutlined />}>选择文件</Button>;
    }
    if (control.controlType === 'switch') {
      return <Segmented disabled={disabled} options={['否', '是']} value="否" />;
    }
    if (control.controlType === 'readonly-text') {
      return <Input disabled value="系统计算或引用值" />;
    }
    return <Input disabled={disabled} placeholder={placeholder} />;
  };

  const renderCanvasControl = (control: LayoutControl) => {
    const field = baseConfig.fields.find((item) => item.key === control.fieldKey);
    const dragClass = `${draggedControlId === control.id ? 'canvas-control-dragging' : ''} ${dropHint?.controlId === control.id ? `canvas-drop-${dropHint.position}` : ''}`;
    const ruleClass = `${!control.rules.visible.enabled ? 'canvas-control-hidden-preview' : ''} ${control.rules.readonly.enabled ? 'canvas-control-readonly-preview' : ''}`;
    if (control.source === 'field' && field) {
      return (
        <div
          {...getCanvasControlDragProps(control)}
          className={`designer-field-control ${controlWidthClass(control.width)} ${selectedControlId === control.id ? 'canvas-field-active' : ''} ${dragClass} ${ruleClass}`}
          key={control.id}
          onClick={() => {
            setSelectedControlId(control.id);
            setSelectedAssetKey(field.key);
          }}
        >
          {renderControlActions(control)}
          <label>
            {renderControlLabel(control)}
            {fieldInput(field, control.placeholder, control.rules.readonly.enabled, control.optionSource, control.controlType)}
            {control.helpText && <small className="designer-control-help">{control.helpText}</small>}
          </label>
        </div>
      );
    }

    if (['text', 'textarea', 'number', 'select', 'relation', 'datetime', 'upload', 'switch', 'readonly-text'].includes(control.controlType)) {
      return (
        <div
          {...getCanvasControlDragProps(control)}
          className={`designer-field-control ${controlWidthClass(control.width)} ${selectedControlId === control.id ? 'canvas-field-active' : ''} ${dragClass} ${ruleClass}`}
          key={control.id}
          onClick={() => setSelectedControlId(control.id)}
        >
          {renderControlActions(control)}
          <label>
            {renderControlLabel(control)}
            {renderComponentInput(control)}
            {control.helpText && <small className="designer-control-help">{control.helpText}</small>}
          </label>
        </div>
      );
    }

    if (control.controlType === 'editable-table' || control.controlType === 'readonly-table') {
      return (
        <div
          {...getCanvasControlDragProps(control)}
          className={`designer-table-control ${controlWidthClass(control.width)} ${selectedControlId === control.id ? 'canvas-field-active' : ''} ${dragClass} ${ruleClass}`}
          key={control.id}
          onClick={() => setSelectedControlId(control.id)}
        >
          {renderControlActions(control)}
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
          {...getCanvasControlDragProps(control)}
          className={`designer-divider-control ${controlWidthClass(control.width)} ${selectedControlId === control.id ? 'canvas-field-active' : ''} ${dragClass} ${ruleClass}`}
          key={control.id}
          onClick={() => setSelectedControlId(control.id)}
        >
          {renderControlActions(control)}
          <span>{control.name}</span>
        </div>
      );
    }

    if (control.controlType === 'tabs') {
      return (
        <div
          {...getCanvasControlDragProps(control)}
          className={`designer-tabs-control ${controlWidthClass(control.width)} ${selectedControlId === control.id ? 'canvas-field-active' : ''} ${dragClass} ${ruleClass}`}
          key={control.id}
          onClick={() => setSelectedControlId(control.id)}
        >
          {renderControlActions(control)}
          <div className="designer-tabs-preview">
            <span className="designer-tab-active">基础信息</span>
            <span>扩展信息</span>
            <span>操作记录</span>
          </div>
          <small>{control.desc}</small>
        </div>
      );
    }

    return (
      <div
        {...getCanvasControlDragProps(control)}
        className={`designer-placeholder-control ${controlWidthClass(control.width)} ${selectedControlId === control.id ? 'canvas-field-active' : ''} ${dragClass} ${ruleClass}`}
        key={control.id}
        onClick={() => setSelectedControlId(control.id)}
      >
        {renderControlActions(control)}
        <strong className={control.rules.required.enabled ? 'designer-required-label' : undefined}>{control.name}</strong>
        <span>{control.desc || '纯 UI 控件，可在右侧绑定字段或配置展示方式。'}</span>
      </div>
    );
  };

  const renderTableProperties = () => {
    if (!selectedControl || !['editable-table', 'readonly-table'].includes(selectedControl.controlType)) return null;
    const editable = selectedControl.controlType === 'editable-table';
    return (
      <section className="designer-prop-section">
        <strong className="designer-prop-section-title">{editable ? '子表属性' : '关联表属性'}</strong>
        <label><span>数据来源</span><Input value={editable ? `${baseConfig.dataSource}_items` : 'related_records'} readOnly /></label>
        <label><span>{editable ? '列配置' : '展示列'}</span><Input value={editable ? '物料、数量、单位、备注' : '编号、名称、状态、时间'} readOnly /></label>
        <label><span>{editable ? '允许新增行' : '分页显示'}</span>{genericRuleToggle(true, editable ? '新增行' : '分页')}</label>
        <label><span>{editable ? '允许删除行' : '点击查看详情'}</span>{genericRuleToggle(true, editable ? '删除行' : '详情')}</label>
        <label><span>{editable ? '行校验规则' : '排序规则'}</span><Input value={editable ? '明细行不能为空，数量必须大于 0' : '按时间倒序'} readOnly /></label>
      </section>
    );
  };

  const renderFieldProperties = (field?: DesignerField) => {
    if (!field) {
      return <div className="designer-empty-props">当前控件未绑定字段，可在控件属性中选择绑定字段。</div>;
    }
    return (
      <div className="designer-props">
        <section className="designer-prop-section">
          <strong className="designer-prop-section-title">字段资产</strong>
          <label className="designer-prop-locked"><span>字段编码</span><Input value={field.key} disabled suffix="锁定" /></label>
          <label><span>字段名称</span><Input value={field.name} readOnly /></label>
          <label className="designer-prop-locked"><span>字段类型</span><Input value={field.type} disabled suffix="锁定" /></label>
          <label className={field.locked ? 'designer-prop-locked' : undefined}><span>字段状态</span><Input value={field.locked ? '锁定字段' : '可配置字段'} disabled={field.locked} readOnly suffix={field.locked ? '锁定' : undefined} /></label>
        </section>
        <section className="designer-prop-section">
          <strong className="designer-prop-section-title">数据与校验</strong>
          <label><span>是否必填</span>{genericRuleToggle(Boolean(field.required), '必填')}</label>
          <label><span>默认值</span><Input value={field.defaultValue || '无'} readOnly /></label>
          <label><span>校验规则</span><Input value={field.validation || '未配置'} readOnly /></label>
          <label><span>枚举/关联来源</span><Input value={field.optionSource || '无'} readOnly /></label>
        </section>
        <section className="designer-prop-section">
          <strong className="designer-prop-section-title">列表与检索</strong>
          <label><span>列表展示</span>{genericRuleToggle(Boolean(field.listVisible), '列表展示')}</label>
          <label><span>允许搜索</span>{genericRuleToggle(Boolean(field.searchable), '搜索')}</label>
          <label><span>允许排序</span>{genericRuleToggle(Boolean(field.sortable), '排序')}</label>
        </section>
      </div>
    );
  };

  const activeRule = ruleModal && selectedControl?.id === ruleModal.controlId
    ? selectedControl.rules[ruleModal.ruleKey]
    : null;
  const activeRuleLabel = ruleModal ? ruleLabels[ruleModal.ruleKey] : '';
  const conditionFieldOptions = baseConfig.fields.map((field) => ({ value: field.key, label: field.name }));
  const getPreviewFieldPermission = (fieldKey?: string) => (
    fieldKey ? selectedPreviewFlowNode?.fieldPermissions?.[fieldKey] : undefined
  );
  const previewControls = layoutControls.filter((control) => {
    if (!control.rules.visible.enabled) return false;
    if (control.source !== 'field') return true;
    const permission = getPreviewFieldPermission(control.fieldKey);
    return permission?.visible !== false;
  });
  const renderPreviewContent = () => {
    if (previewMode === 'list') {
      const columns = baseConfig.fields.filter((field) => field.listVisible).slice(0, previewDevice === 'mobile' ? 3 : 6);
      return (
        <div className="designer-preview-table">
          <div className="designer-preview-table-head">
            {columns.map((field) => <span key={field.key}>{field.name}</span>)}
          </div>
          {[1, 2, 3].map((row) => (
            <div className="designer-preview-table-row" key={row}>
              {columns.map((field) => <span key={field.key}>{field.placeholder || field.name}</span>)}
            </div>
          ))}
        </div>
      );
    }
    return (
      <div className="designer-preview-form">
        {previewControls.map((control) => {
          const field = baseConfig.fields.find((item) => item.key === control.fieldKey);
          const permission = getPreviewFieldPermission(control.fieldKey);
          const readonlyByNode = permission ? !permission.editable : false;
          const requiredByNode = permission?.required ?? false;
          const required = control.rules.required.enabled || requiredByNode;
          const readonly = control.rules.readonly.enabled || readonlyByNode;
          return (
            <div className={`designer-preview-control ${controlWidthClass(previewDevice === 'mobile' ? 'full' : control.width)}`} key={control.id}>
              <span className={required ? 'designer-required-label' : undefined}>{control.name}</span>
              {control.source === 'field' && field
                ? fieldInput(field, control.placeholder, readonly, control.optionSource, control.controlType)
                : renderComponentInput({ ...control, rules: { ...control.rules, readonly: { ...control.rules.readonly, enabled: readonly } } })}
              {field && permission && (
                <small className="designer-preview-node-permission">
                  {permission.editable ? '当前节点可编辑' : '当前节点只读'}{permission.required ? ' / 必填' : ''}
                </small>
              )}
              {control.helpText && <small>{control.helpText}</small>}
            </div>
          );
        })}
      </div>
    );
  };

  const viewFieldOptions = baseConfig.fields.map((field) => ({ value: field.key, label: `${field.name} (${field.key})` }));
  const sortedViewFilters = sortByOrder(viewConfig.filters);
  const sortedViewColumns = sortByOrder(viewConfig.table.columns);
  const enabledViewFilters = sortedViewFilters.filter((filter) => filter.enabled);
  const enabledViewColumns = sortedViewColumns.filter((column) => column.enabled);
  const viewConfigMeta = getViewConfigMeta(platformForm);
  const viewSampleRows = [
    { alertId: 'AL-2605-001', title: '压缩空气压力偏低', device: '空压站 2#', level: '严重', status: '已派发', source: '能源站', owner: '李工', occurredAt: '2026-05-24' },
    { alertId: 'AL-2605-002', title: 'A 线节拍延迟', device: '总装 A 线', level: '中等', status: '确认中', source: '生产执行', owner: '王工', occurredAt: '2026-05-24' },
    { alertId: 'AL-2605-003', title: '来料批次延迟', device: '供应链', level: '中等', status: '跟进中', source: '供应链', owner: '周工', occurredAt: '2026-05-23' },
  ];

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
    const expanded = expandedViewRow === filter.id;
    return (
      <div className={`view-config-row ${expanded ? 'view-config-row-expanded' : ''}`} key={filter.id}>
        <button className="view-config-row-main" type="button" onClick={() => setExpandedViewRow(expanded ? '' : filter.id)}>
          <span className="view-config-order">{index + 1}</span>
          <span className="view-config-primary">
            <strong>{filter.label}</strong>
            <small>{filter.fieldName} · {viewControlOptions.find((item) => item.value === filter.controlType)?.label} · {viewFilterOperatorOptions.find((item) => item.value === filter.operator)?.label}</small>
          </span>
          <Tag color={filter.enabled ? 'green' : 'default'}>{filter.enabled ? '启用' : '停用'}</Tag>
          <Tag color={filter.advanced ? 'blue' : 'cyan'}>{filter.advanced ? '高级' : '常用'}</Tag>
        </button>
        <Space size={4} className="view-config-row-actions">
          <Button size="small" onClick={() => moveViewItem('filter', filter.id, -1)} disabled={index === 0}>上移</Button>
          <Button size="small" onClick={() => moveViewItem('filter', filter.id, 1)} disabled={index === sortedViewFilters.length - 1}>下移</Button>
          <Switch size="small" checked={filter.enabled} onChange={(enabled) => updateViewFilter(filter.id, { enabled })} />
        </Space>
        {expanded && (
          <div className="view-config-inline-editor">
            <label><span>绑定字段</span><Select value={filter.fieldName} options={viewFieldOptions} onChange={(fieldName) => {
              const field = baseConfig.fields.find((item) => item.key === fieldName);
              updateViewFilter(filter.id, { fieldName, label: field?.name || filter.label });
            }} /></label>
            <label><span>显示名称</span><Input value={filter.label} onChange={(event) => updateViewFilter(filter.id, { label: event.target.value })} /></label>
            <label><span>控件类型</span><Select value={filter.controlType} options={viewControlOptions} onChange={(controlType) => updateViewFilter(filter.id, { controlType, operator: controlType === 'dateRange' ? 'between' : filter.operator })} /></label>
            <label><span>操作符</span><Select value={filter.operator} options={viewFilterOperatorOptions} onChange={(operator) => updateViewFilter(filter.id, { operator })} /></label>
            <label><span>默认值</span><Input allowClear value={String(filter.defaultValue ?? '')} onChange={(event) => updateViewFilter(filter.id, { defaultValue: event.target.value })} /></label>
            <label><span>占位提示</span><Input allowClear value={filter.placeholder || ''} onChange={(event) => updateViewFilter(filter.id, { placeholder: event.target.value })} /></label>
            <label><span>显示位置</span><Select value={filter.advanced ? 'advanced' : 'common'} options={[{ value: 'common', label: '常用筛选' }, { value: 'advanced', label: '高级筛选' }]} onChange={(value) => updateViewFilter(filter.id, { advanced: value === 'advanced' })} /></label>
            <label><span>清空默认值</span><Button onClick={() => updateViewFilter(filter.id, { defaultValue: '' })}>清空</Button></label>
          </div>
        )}
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
            <label><span>允许排序</span><Switch checked={column.sortable} onChange={(sortable) => updateViewColumn(column.id, { sortable })} /></label>
          </div>
        )}
      </div>
    );
  };

  const renderDataViewDesigner = () => (
    <div className="data-view-designer">
      <section className="data-view-hero">
        <div>
          <strong>{baseConfig.name}数据视图配置</strong>
          <span>配置运行页面的上方筛选区和下方数据展示区，保存发布后同步作用于程序页与动态表单页。</span>
        </div>
        <Space wrap>
          <Segmented value={viewPreviewDevice} onChange={(value) => setViewPreviewDevice(value as 'desktop' | 'narrow')} options={[{ value: 'desktop', label: '桌面预览' }, { value: 'narrow', label: '窄屏预览' }]} />
          <Tag color="blue">{enabledViewFilters.length} 个筛选</Tag>
          <Tag color="green">{enabledViewColumns.length} 个展示列</Tag>
          <Tag color={viewConfigMeta.status === 'draft' ? 'orange' : 'success'}>
            {viewConfigMeta.status === 'draft' ? `草稿 v${viewConfigMeta.draftVersion || 1}` : `已发布 v${viewConfigMeta.publishedVersion || 1}`}
          </Tag>
        </Space>
      </section>

      <section className="view-config-section">
        <div className="view-config-section-head">
          <div><strong>上方筛选区</strong><span>配置查询条件、操作符、默认值和常用/高级位置。</span></div>
          <Button size="small" onClick={() => {
            const field = baseConfig.fields.find((item) => !viewConfig.filters.some((filter) => filter.fieldName === item.key)) || baseConfig.fields[0];
            if (!field) return;
            updateViewConfig((current) => ({
              ...current,
              filters: [...current.filters, {
                id: `filter-${field.key}-${Date.now()}`,
                fieldName: field.key,
                label: field.name,
                controlType: 'text',
                operator: 'contains',
                placeholder: `请输入${field.name}`,
                enabled: true,
                advanced: current.filters.length > 3,
                sortOrder: current.filters.length,
              }],
            }));
          }}>新增筛选项</Button>
        </div>
        <div className="view-config-list">
          {sortedViewFilters.map(renderViewFilterRow)}
        </div>
      </section>

      <section className="view-config-section">
        <div className="view-config-section-head">
          <div><strong>下方数据展示区</strong><span>配置表格列、操作、排序、分页和行交互。</span></div>
          <Space wrap>
            <Select size="small" value={viewConfig.table.density} options={tableDensityOptions} onChange={(density) => updateViewTable({ density })} />
            <Select size="small" value={String(viewConfig.table.pageSize)} options={[10, 20, 50, 100].map((value) => ({ value: String(value), label: `${value} 条/页` }))} onChange={(value) => updateViewTable({ pageSize: Number(value) })} />
            <Select size="small" value={viewConfig.table.rowClickAction} options={[{ value: 'detail', label: '点击行看详情' }, { value: 'edit', label: '点击行编辑' }, { value: 'none', label: '无行点击' }]} onChange={(rowClickAction) => updateViewTable({ rowClickAction })} />
          </Space>
        </div>
        <div className="view-config-list">
          {sortedViewColumns.map(renderViewColumnRow)}
        </div>
      </section>

      <section className={`view-runtime-preview view-runtime-preview-${viewPreviewDevice}`}>
        <div className="view-runtime-preview-head">
          <strong>运行页预览</strong>
          <span>上方筛选 + 下方数据表格</span>
        </div>
        <div className="view-runtime-filter-preview">
          {enabledViewFilters.filter((filter) => !filter.advanced).map((filter) => (
            <label key={filter.id}>
              <span>{filter.label}</span>
              {renderViewFilterControl(filter)}
            </label>
          ))}
          <Space className="view-runtime-actions">
            <Button>重置</Button>
            <Button type="primary" icon={<SearchOutlined />}>查询</Button>
          </Space>
        </div>
        <div className="view-runtime-table-preview">
          <div className="view-runtime-table-head" style={{ gridTemplateColumns: `repeat(${Math.max(enabledViewColumns.length, 1)}, minmax(110px, 1fr)) 140px` }}>
            {enabledViewColumns.map((column) => <span key={column.id}>{column.label}</span>)}
            <span>操作</span>
          </div>
          {viewSampleRows.map((row, rowIndex) => (
            <div className="view-runtime-table-row" key={rowIndex} style={{ gridTemplateColumns: `repeat(${Math.max(enabledViewColumns.length, 1)}, minmax(110px, 1fr)) 140px` }}>
              {enabledViewColumns.map((column) => <span key={column.id}>{String(row[column.fieldName as keyof typeof row] ?? column.emptyText)}</span>)}
              <span>详情　处理</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );

  const toolbarToolPanel = (
    <div className="designer-top-tool-panel">
      <section>
        <strong>配置引导</strong>
        <span>拖入字段/控件，选中后在右侧配置属性，发布时会同步做业务校验。</span>
        <div className="designer-top-tool-tags">
          <Tag color="blue">字段 {baseConfig.fields.length}</Tag>
          <Tag color="green">控件 {layoutControls.length}</Tag>
          <Tag color={publishErrorCount ? 'red' : 'success'}>阻断 {publishErrorCount}</Tag>
        </div>
      </section>
      <section>
        <strong>快捷排版</strong>
        <div className="designer-top-tool-grid">
          <Button size="small" icon={<LayoutOutlined />} onClick={applyTwoColumnLayout}>两列</Button>
          <Button size="small" icon={<TableOutlined />} onClick={applyCompactLayout}>紧凑</Button>
          <Button size="small" icon={<ApartmentOutlined />} onClick={applyBusinessSectionLayout}>业务分组</Button>
          <Button size="small" icon={<CheckSquareOutlined />} onClick={batchSetRequired}>批量必填</Button>
          <Button size="small" onClick={() => batchUpdateVisibleControls({ width: 'full' })}>全宽</Button>
          <Button size="small" icon={<UndoOutlined />} disabled={!history.length} onClick={undoLayoutChange}>撤销</Button>
        </div>
      </section>
      <section>
        <strong>业务区块</strong>
        <div className="designer-top-tool-sections">
          {alertSections.map((section) => (
            <button key={section.key} type="button" onClick={applyBusinessSectionLayout}>
              <span>{section.title}</span>
              <small>{section.desc}</small>
            </button>
          ))}
        </div>
      </section>
    </div>
  );

  const activeTabKey: string = activeTab;

  return (
    <div className="form-designer-page">
      <header className="form-designer-toolbar">
        <div className="form-designer-title">
          <Typography.Title level={4}>{baseConfig.name}配置</Typography.Title>
          <span className="designer-title-meta">{baseConfig.status}</span>
        </div>
        <Tabs
          className="form-designer-tabs"
          activeKey={activeTab}
          onChange={(key) => {
            setActiveTab(key as DesignerTab);
            setSelectedControlId('');
          }}
          items={tabs.map((item) => ({ key: item.key, label: <span>{item.icon}{item.label}</span> }))}
        />
        <Space className="form-designer-actions" size={4} wrap={false}>
          {hasUnsavedChanges && <Tag className="designer-unsaved-tag" color="orange">未保存</Tag>}
          <Button size="small" type="text" title="返回表单" aria-label="返回表单" icon={<ArrowLeftOutlined />} onClick={warnBeforeLeave} />
          <Button size="small" type="text" title="预览" aria-label="预览" icon={<EyeOutlined />} onClick={() => setPreviewOpen(true)} />
          <Button
            className="designer-version-action"
            size="small"
            title="版本管理"
            aria-label="版本管理"
            icon={<HistoryOutlined />}
            onClick={() => setVersionPanelOpen(true)}
          >
            {version} 当前草稿
          </Button>
          <Button size="small" type="text" title="保存草稿" aria-label="保存草稿" icon={<SaveOutlined />} loading={isPersistingFlow} onClick={saveDraft} />
          <Popover content={toolbarToolPanel} placement="bottomRight" trigger="click">
            <Button size="small" type="text" title="工具" aria-label="工具" icon={<SettingOutlined />} />
          </Popover>
          <Button size="small" type="primary" icon={<CheckCircleOutlined />} loading={isPersistingFlow} onClick={publishConfig}>发布配置</Button>
        </Space>
      </header>

      <section className={`form-designer-shell ${activeTab === 'permission' || activeTab === 'filter' || activeTab === 'flow' ? 'form-designer-shell-no-left' : ''} ${activeTab === 'filter' ? 'form-designer-shell-data-view' : ''}`}>
        {!(['permission', 'filter', 'flow'] as DesignerTab[]).includes(activeTab) && (
          <aside className="form-designer-left">
            <div className="designer-panel-head">
              <strong>控件</strong>
              {activeTab !== 'form' && (
                <span>{tabs.find((item) => item.key === activeTab)?.label}</span>
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
                <small>字段库绑定业务数据，控件库负责展示和布局。</small>
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
                  { label: '控件库', value: 'components' },
                  { label: '字段库', value: 'fieldTypes' },
                ]}
              />
              <div className="designer-quick-panel">
                <div className="designer-group-title">快捷排版</div>
                <div className="designer-side-guide">
                  <strong>配置引导</strong>
                  <span>{activeTab === 'filter' ? '配置运行页查询条件，选中后在右侧查看字段属性，发布时会同步做业务校验。' : '拖入字段/控件，选中后在右侧配置属性，发布时会同步做业务校验。'}</span>
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
                    <div className="designer-component-list">
                      {filteredCommonControls.map((item) => (
                        <div
                          className="designer-component"
                          draggable
                          key={item.key}
                          data-desc={item.desc}
                          onClick={() => activeTab === 'filter' ? message.info('筛选页先选择字段，再在右侧查看或调整字段属性') : addComponentToCanvas(item)}
                          onDragStart={(event) => event.dataTransfer.setData('componentKey', item.key)}
                        >
                          <span className="designer-component-icon">{item.icon}</span>
                          <div>
                            <strong>{item.name}</strong>
                            <small>{item.desc}</small>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                  {filteredComponentGroups.map((group) => (
                    <details className="designer-component-group designer-component-collapse" key={group.category}>
                      <summary className="designer-group-title">
                        <span>{group.category}</span>
                        <small>{group.items.length} 个</small>
                      </summary>
                      <div className="designer-component-list">
                        {group.items.map((item) => (
                          <div
                            className="designer-component"
                            draggable
                            key={item.key}
                            data-desc={item.desc}
                            onClick={() => activeTab === 'filter' ? message.info('筛选页先选择字段，再在右侧查看或调整字段属性') : addComponentToCanvas(item)}
                            onDragStart={(event) => event.dataTransfer.setData('componentKey', item.key)}
                          >
                            <span className="designer-component-icon">{item.icon}</span>
                            <div>
                              <strong>{item.name}</strong>
                              <small>{item.desc}</small>
                            </div>
                          </div>
                        ))}
                      </div>
                    </details>
                  ))}
                </div>
              ) : (
                <>
                  <div className="designer-panel-head designer-panel-head-gap">
                    <strong>{activeTab === 'filter' ? '筛选字段' : '字段库'}</strong>
                    <span>{filteredLibraryFields.length} / {libraryFields.length} 个</span>
                  </div>
                  {activeTab === 'form' && <div className="designer-template-grid">
                    {fieldTemplates.filter((field) => matchesLibrarySearch(`${field.name} ${field.type}`)).map((field) => (
                      <button key={field.key} type="button" onClick={() => addTemplateField(field)}>
                        <span>{field.name}</span>
                        <small>{field.type}</small>
                      </button>
                    ))}
                  </div>}
                  <div className="designer-field-list">
                    {filteredLibraryFields.map((field) => (
                      <div
                        className={`designer-field ${selectedAssetKey === field.key ? 'designer-field-active' : ''}`}
                        draggable={activeTab === 'form'}
                        key={field.key}
                        onClick={() => {
                          setSelectedAssetKey(field.key);
                          setSelectedControlId('');
                        }}
                        onDragStart={(event) => activeTab === 'form' && event.dataTransfer.setData('fieldKey', field.key)}
                      >
                        <DragOutlined />
                        <span>{field.name}</span>
                        {field.locked && <Tag color="orange">锁定</Tag>}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="designer-component-list">
              <div className="designer-component">
                <span className="designer-component-icon">{tabs.find((item) => item.key === activeTab)?.icon}</span>
                <div>
                  <strong>{tabs.find((item) => item.key === activeTab)?.label}</strong>
                  <small>这里配置页面级规则，不拖入表单新增画布。</small>
                </div>
              </div>
            </div>
          )}
        </aside>
        )}

        <main className="form-designer-canvas">
          {activeTabKey === 'form' && (
            <div
              className="canvas-board create-form-canvas"
              onClick={() => setSelectedControlId('')}
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
              <div className="create-form-modal" onClick={(event) => event.stopPropagation()}>
                <div className={`create-form-grid ${isCanvasDragActive ? 'canvas-drag-active' : ''}`}>
                  {layoutControls.map(renderCanvasControl)}
                  {isCanvasDragActive && draggedControlId && !dropHint && <div className="canvas-drop-end-indicator">拖到这里放在末尾</div>}
                </div>
                <div className="create-form-actions">
                  <Button>取消</Button>
                  <Button type="primary">提交</Button>
                </div>
              </div>
            </div>
          )}

          {activeTabKey === 'filter' && (
            <div className="canvas-board data-view-canvas">
              {renderDataViewDesigner()}
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
              onChange={(nextConfig) => {
                setProfessionalFlowConfig(nextConfig);
                markUnsaved();
              }}
            />
          )}

          {activeTabKey === 'permission' && (
            <div className="canvas-board permission-canvas">
              <div className="permission-overview">
                <div>
                  <strong>权限设计</strong>
                  <span>按角色配置动作权限、数据范围和字段级控制。</span>
                </div>
                <Tag color="blue">{baseConfig.name}</Tag>
              </div>
              <div className="permission-workbench">
                <aside className="permission-role-rail">
                  <div className="permission-section-title">角色</div>
                  {permissionRoles.map((role, index) => (
                    <button className={`permission-role-card ${index === 0 ? 'permission-role-active' : ''}`} key={role} type="button">
                      <span className="permission-role-icon"><UserSwitchOutlined /></span>
                      <span>
                        <strong>{role}</strong>
                        <small>{index === 0 ? '当前选中' : '可切换配置'}</small>
                      </span>
                    </button>
                  ))}
                </aside>
                <div className="permission-main">
                  <section className="permission-card">
                    <div className="permission-section-title">动作权限</div>
                    <div className="permission-action-grid">
                      {[
                        ['查看', true, '基础访问'],
                        ['新增', true, '创建记录'],
                        ['编辑', true, '修改记录'],
                        ['删除', false, '高风险动作'],
                        ['导入', true, '批量写入'],
                        ['导出', true, '数据外发'],
                        ['设置', false, '配置入口'],
                        ['审批', true, '流程处理'],
                      ].map(([name, enabled, desc]) => (
                        <div className={`permission-action ${enabled ? 'permission-action-on' : 'permission-action-off'}`} key={name as string}>
                          <span>{name}</span>
                          <small>{desc}</small>
                          <CheckCircleOutlined />
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="permission-card permission-scope-card">
                    <div className="permission-section-title">数据范围</div>
                    <div className="permission-scope-grid">
                      <div><span>范围模式</span><strong>主组织 + 个人创建</strong></div>
                      <div><span>组织来源</span><strong>{permissionOrgUnits.slice(0, 3).join(' / ')}</strong></div>
                      <div><span>敏感数据</span><strong>脱敏显示</strong></div>
                    </div>
                  </section>

                  <section className="permission-card">
                    <div className="permission-section-title">字段权限</div>
                    <div className="permission-field-matrix">
                      <div className="permission-field-head">
                        <span>字段</span><span>可见</span><span>可编辑</span><span>必填</span>
                      </div>
                      {baseConfig.fields.map((field, index) => (
                        <div className="permission-field-row" key={field.key}>
                          <span>{field.name}</span>
                          <Tag color="green">可见</Tag>
                          <Tag color={field.locked ? 'default' : 'blue'}>{field.locked ? '锁定' : index < 2 ? '可编辑' : '只读'}</Tag>
                          <Tag color={field.required ? 'orange' : 'default'}>{field.required ? '必填' : '可选'}</Tag>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>
              </div>
            </div>
          )}
        </main>

        {!(['permission', 'filter', 'flow'] as DesignerTab[]).includes(activeTab) && (
        <aside className="form-designer-right">
          <div className="designer-panel-head">
            <strong>属性</strong>
            <span>当前：{selectedControl ? '控件' : selectedField ? '字段' : '画布'}</span>
          </div>
          <div className="designer-prop-summary">
            <span className="designer-prop-summary-badge">{selectedControl ? '控件' : selectedField ? '字段' : '画布'}</span>
            <strong>{selectedControl?.name || selectedField?.name || baseConfig.name}</strong>
            <small>
              {selectedControl
                ? `${selectedControl.controlType} · ${controlWidthLabel(selectedControl.width)}`
                : selectedField
                  ? `${selectedField.type} · ${selectedField.locked ? '锁定字段' : '可配置字段'}`
                  : `${baseConfig.dataSource} · ${baseConfig.primaryKey}`}
            </small>
          </div>

          {selectedControl ? (
            <Tabs
              className="designer-prop-tabs"
              size="small"
              activeKey={propertyTab}
              onChange={(key) => setPropertyTab(key as 'control' | 'field')}
              items={[
                {
                  key: 'control',
                  label: '控件属性',
                  children: (
                      <div className="designer-props">
                        <section className="designer-prop-section">
                          <strong className="designer-prop-section-title">控件身份</strong>
                          <label>
                            <span>控件名称</span>
                            <Input
                              value={selectedControl.name}
                              onChange={(event) => updateSelectedControl({ name: event.target.value })}
                            />
                          </label>
                          <label>
                            <span>控件类型</span>
                            <Select
                              value={selectedEffectiveControlType}
                              options={controlTypeOptions}
                              onChange={(controlType) => {
                                const nextWidth = controlType === 'textarea' || controlType === 'upload' ? 'full' : selectedControl.width;
                                updateSelectedControl({ controlType, width: nextWidth as ControlWidth });
                              }}
                            />
                          </label>
                          <label className="designer-prop-locked">
                            <span>字段来源</span>
                            <Input value={selectedField ? selectedField.name : '未绑定字段'} disabled />
                          </label>
                      </section>
                      {selectedControlUsesDataSource && (
                        <section className="designer-prop-section">
                          <strong className="designer-prop-section-title">数据源与选项</strong>
                          <label>
                            <span>来源类型</span>
                            <Input
                              value={
                                selectedEffectiveControlType === 'relation' || selectedField?.type.includes('关联')
                                  ? '关联对象'
                                  : selectedField?.type.includes('人员')
                                    ? '组织人员'
                                    : '静态枚举'
                              }
                              readOnly
                            />
                          </label>
                          <label>
                            <span>选项来源</span>
                            <Input
                              allowClear
                              placeholder="例如：系统监测、人工上报、外部接口"
                              value={selectedControl.optionSource || selectedField?.optionSource || ''}
                              onChange={(event) => updateSelectedControl({ optionSource: event.target.value })}
                            />
                          </label>
                          <label>
                            <span>选项预览</span>
                            <Select
                              value={optionSourceToOptions(selectedControl.optionSource || selectedField?.optionSource, selectedControl.placeholder || selectedField?.placeholder)[0]?.value}
                              options={optionSourceToOptions(selectedControl.optionSource || selectedField?.optionSource, selectedControl.placeholder || selectedField?.placeholder)}
                            />
                          </label>
                        </section>
                      )}
                      <section className="designer-prop-section">
                        <strong className="designer-prop-section-title">布局</strong>
                          <label className="designer-prop-row-wide">
                            <span>控件宽度</span>
                            <div className="designer-width-picker">
                            {controlWidthOptions.map((option) => (
                              <button
                                className={`designer-width-option ${selectedControl.width === option.value ? 'designer-width-option-active' : ''}`}
                                key={option.value}
                                onClick={() => updateSelectedControl({ width: option.value as ControlWidth })}
                                type="button"
                              >
                                <span>{option.label}</span>
                              </button>
                            ))}
                          </div>
                        </label>
                      </section>
                        <section className="designer-prop-section">
                          <strong className="designer-prop-section-title">交互规则</strong>
                          <label><span>显示</span>{controlRuleToggle('visible')}</label>
                          <label><span>只读</span>{controlRuleToggle('readonly')}</label>
                          <label><span>必输</span>{controlRuleToggle('required')}</label>
                          {hiddenRequiredControls.length > 0 && <Tag color="red">存在隐藏且必填冲突</Tag>}
                        </section>
                        <section className="designer-prop-section">
                          <strong className="designer-prop-section-title">提示与联动</strong>
                          <label>
                            <span>占位提示</span>
                            <Input
                              allowClear
                              placeholder={selectedField?.placeholder || selectedControl.desc || '请输入占位提示'}
                              value={selectedControl.placeholder || ''}
                              onChange={(event) => updateSelectedControl({ placeholder: event.target.value })}
                            />
                          </label>
                          <label>
                            <span>帮助说明</span>
                            <Input
                              allowClear
                              placeholder="可在此补充录入说明"
                              value={selectedControl.helpText || ''}
                              onChange={(event) => updateSelectedControl({ helpText: event.target.value })}
                            />
                          </label>
                          <label><span>变更触发</span>{genericRuleToggle(false, '变更触发')}</label>
                          <label><span>联动刷新</span><Input value="未绑定联动规则" readOnly /></label>
                          <label><span>异常提示</span><Input value="使用字段校验提示" readOnly /></label>
                        <label><span>权限覆盖</span><Input value="跟随表单权限" readOnly /></label>
                      </section>
                      {renderTableProperties()}
                    </div>
                  ),
                },
                {
                  key: 'field',
                  label: '字段属性',
                  children: renderFieldProperties(selectedField),
                },
              ]}
            />
          ) : selectedField ? (
            <Tabs className="designer-prop-tabs" size="small" items={[{ key: 'field', label: '字段属性', children: renderFieldProperties(selectedField) }]} />
          ) : (
            <div className="designer-props">
              <section className="designer-prop-section">
                <strong className="designer-prop-section-title">画布属性</strong>
                <label><span>表单名称</span><Input value={baseConfig.name} readOnly /></label>
                <label><span>新增标题</span><Input value={baseConfig.createTitle} readOnly /></label>
                <label><span>数据表</span><Input value={baseConfig.dataSource} readOnly /></label>
                <label><span>主键字段</span><Input value={baseConfig.primaryKey} readOnly /></label>
                <label><span>默认列数</span><Select value="2" options={[{ value: '1', label: '单列' }, { value: '2', label: '两列' }, { value: '3', label: '三列' }]} /></label>
                <label><span>字段间距</span><Select value="12" options={[{ value: '8', label: '紧凑' }, { value: '12', label: '标准' }, { value: '16', label: '宽松' }]} /></label>
                <label><span>表单说明</span><Input value={baseConfig.description} readOnly /></label>
                <label><span>发布状态</span><Input value={hasUnsavedChanges ? '当前草稿有未保存修改' : '草稿与已发布版本一致'} readOnly /></label>
                <label><span>发布校验</span><Input value={`${publishErrorCount} 个阻断项 / ${publishWarningCount} 个提醒`} readOnly /></label>
              </section>
              <section className="designer-prop-section">
                <strong className="designer-prop-section-title">推荐联动</strong>
                {recommendedRules.map((rule) => <div className="designer-rule-pill" key={rule}>{rule}</div>)}
              </section>
            </div>
          )}
        </aside>
        )}
      </section>

      <Modal
        centered
        className="designer-preview-modal"
        footer={null}
        onCancel={() => setPreviewOpen(false)}
        open={previewOpen}
        title="表单预览"
        width={980}
      >
        <div className="designer-preview-toolbar">
          <Segmented value={previewMode} onChange={(value) => setPreviewMode(value as PreviewMode)} options={previewModeOptions} />
          <Segmented value={previewDevice} onChange={(value) => setPreviewDevice(value as PreviewDevice)} options={previewDeviceOptions.map((item) => ({ value: item.value, label: <span>{item.icon}{item.label}</span> }))} />
          <Select
            className="designer-preview-node-select"
            value={selectedPreviewFlowNode?.id}
            onChange={setPreviewFlowNodeId}
            options={previewFlowNodeOptions}
            placeholder="选择流程节点"
          />
        </div>
        <div className="designer-role-note">{getPreviewNodeNote(selectedPreviewFlowNode)}</div>
        <div className={`designer-preview-shell designer-preview-${previewDevice}`}>
          <div className="designer-preview-surface">
            <div className="designer-preview-head">
              <strong>{baseConfig.createTitle}</strong>
              <Tag color="blue">{previewModeOptions.find((item) => item.value === previewMode)?.label}</Tag>
            </div>
            {renderPreviewContent()}
          </div>
        </div>
      </Modal>

      <Modal
        centered
        className="designer-check-modal"
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
          <Tag color="blue">{publishChecks.filter((item) => item.level === 'suggestion').length} 个建议</Tag>
        </div>
        <div className="designer-check-list">
          {publishChecks.map((item) => (
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

      <Modal
        centered
        footer={null}
        onCancel={() => setVersionPanelOpen(false)}
        open={versionPanelOpen}
        title="草稿与已发布版本"
      >
        <div className="designer-version-panel">
          <div><span>已发布版本</span><strong>数据视图 v{viewConfigMeta.publishedVersion || 0}{viewConfigMeta.publishedAt ? ` · ${viewConfigMeta.publishedAt.slice(0, 10)}` : ''}</strong></div>
          <div><span>当前草稿</span><strong>{hasUnsavedChanges || viewConfigMeta.status === 'draft' ? `存在未发布修改 · 草稿 v${viewConfigMeta.draftVersion || 1}` : '无差异'}</strong></div>
          <div><span>变更摘要</span><strong>筛选条件、表格列、流程配置和业务发布规则</strong></div>
          <Space wrap>
            <Button onClick={saveDraft} loading={isPersistingFlow} icon={<SaveOutlined />}>保存草稿</Button>
            <Button danger onClick={() => { setHasUnsavedChanges(false); setVersionPanelOpen(false); message.success('已回滚到上一发布版本'); }}>回滚上一版</Button>
            <Button type="primary" onClick={() => { setVersionPanelOpen(false); setPublishCheckOpen(true); }}>发布当前草稿</Button>
          </Space>
        </div>
      </Modal>

      <Modal
        centered
        className="designer-rule-modal"
        destroyOnClose
        okText="保存规则"
        onCancel={() => setRuleModal(null)}
        onOk={() => {
          message.success(`${activeRuleLabel}规则已保存`);
          setRuleModal(null);
        }}
        open={Boolean(activeRule)}
        title={`${activeRuleLabel}规则`}
      >
        {ruleModal && activeRule && (
          <div className="designer-rule-form">
            <label>
              <span>规则启用</span>
              <Segmented
                block
                value={activeRule.enabled ? 'enabled' : 'disabled'}
                onChange={(value) => updateSelectedControlRule(ruleModal.ruleKey, { enabled: value === 'enabled' })}
                options={[
                  { value: 'enabled', label: '启用' },
                  { value: 'disabled', label: '关闭' },
                ]}
              />
            </label>
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
