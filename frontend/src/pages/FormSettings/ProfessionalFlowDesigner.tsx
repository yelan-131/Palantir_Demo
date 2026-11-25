import {getPlatformForm, listPlatformForms, type PlatformForm, type PlatformFormField} from '@/services/api';
import {PropertyGroup, PropertyRow} from '@/components/PropertyInspector';
import {createPortal} from 'react-dom';
import './designer-dialog.css';
import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ApartmentOutlined,
  ApiOutlined,
  BranchesOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  CopyOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  DeploymentUnitOutlined,
  FieldTimeOutlined,
  ForkOutlined,
  GatewayOutlined,
  GlobalOutlined,
  LinkOutlined,
  MailOutlined,
  PartitionOutlined,
  SnippetsOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  ShareAltOutlined,
  StopOutlined,
  TagOutlined,
  ThunderboltOutlined,
  UserOutlined,
  UserSwitchOutlined,
  SearchOutlined,
} from '@/components/Icon/ant';
import { Button, Dropdown, Input, InputNumber, Modal, Select, Switch, Tag, Typography, message } from 'antd';
import { FlowAnnotationProperties } from './FlowAnnotationProperties';
import {
  DEFAULT_FLOW_ANNOTATION_COLOR, getFlowAnnotationFrames, getFlowAnnotationTitleSpace, getFlowMarqueeItems,
  readFlowAnnotations, resizeFlowAnnotation, translateAnnotationRoutes, type FlowAnnotation, type FlowAnnotationSize,
} from './flowAnnotations';
import { getFlowEdgeRoute, getFlowSegmentDrag, insertFlowWaypoint, type FlowPortSide, type FlowRoutePoint } from './flowEdgeRoute';
import { FLOW_NODE_GRID, FLOW_NODE_SIZE, snapFlowAxis, snapFlowNode, type FlowNodeSnap } from './flowNodeSnap';
import { cloneFlowSelection, copyFlowSelection, type FlowClipboard } from './flowClipboard';

type Selection = { type: 'canvas' } | { type: 'node'; id: string } | { type: 'multiple'; nodeIds: string[]; annotationIds: string[] }
  | { type: 'edge'; id: string } | { type: 'annotation'; id: string };
type RouteDragPreview = { waypoints: FlowRoutePoint[]; snap: FlowNodeSnap };
type NodeCategory = 'event' | 'task' | 'gateway' | 'subprocess' | 'data' | 'boundary';
type ApprovalMode = 'single' | 'orSign' | 'countersign';
type AssigneeSource = 'fixed' | 'role' | 'departmentOwner' | 'initiatorManager' | 'field';
type AssigneeTargetType = 'user' | 'role' | 'organization' | 'field' | 'departmentOwner' | 'initiatorManager';

export interface FlowAssigneeRule {
  id: string;
  type: AssigneeTargetType;
  value?: string;
  scope?: 'self' | 'children';
  approvalMode?: ApprovalMode;
}

export interface FlowExternalAction {
  enabled: boolean;
  system?: string;
  action?: 'webhook' | 'api' | 'message' | 'form';
  targetFormId?: number;
  endpoint?: string;
  fieldMappings?: Array<{ id: string; sourceField?: string; targetField?: string }>;
}

export interface FlowDesignerField {
  key: string;
  name: string;
  type: string;
  required?: boolean;
}

export interface FlowCcRecipient {
  id: string;
  type: 'user' | 'role';
  value?: string;
}

export interface FlowDesignerNode {
  id: string;
  type: string;
  category: NodeCategory;
  label: string;
  description: string;
  executable: boolean;
  x: number;
  y: number;
  assigneeSource?: AssigneeSource;
  assigneeValue?: string;
  assigneeRules?: FlowAssigneeRule[];
  rejectionTargetId?: string;
  ccRecipients?: FlowCcRecipient[];
  approvalMode?: ApprovalMode;
  slaHours?: number;
  notificationEnabled?: boolean;
  errorPolicy?: 'manual' | 'retry' | 'skip';
  retryTimes?: number;
  externalAction?: FlowExternalAction;
  bpmnType?: string;
  fieldPermissions?: Record<string, { visible: boolean; editable: boolean; required: boolean }>;
}

export interface FlowDesignerEdge {
  id: string;
  source: string;
  sourceSide: FlowPortSide;
  target: string;
  targetSide: FlowPortSide;
  label: string;
  approvalOutcome?: 'approve' | 'reject';
  condition?: string;
  conditionField?: string;
  conditionOperator?: string;
  conditionValue?: string;
  priority: number;
  isDefault?: boolean;
  routeY?: number;
  waypoints?: FlowRoutePoint[];
}

export interface FlowDesignerConfig {
  id: string;
  name: string;
  version: string;
  nodes: FlowDesignerNode[];
  edges: FlowDesignerEdge[];
  annotations?: FlowAnnotation[];
  triggerBindings: Array<{ action: string; workflowId?: number; enabled: boolean; label: string; startNodeId?: string }>;
  stateMapping: {
    statusField: string;
    currentNodeField: string;
    currentAssigneeField: string;
    completedAtField: string;
  };
  advancedModeConfig: {
    enabled: boolean;
    publishPolicy: 'blockAdvanced' | 'modelOnly';
  };
}

export interface FlowDesignerValidationItem {
  level: 'error' | 'warning' | 'suggestion';
  title: string;
  detail: string;
}

interface NodeDefinition {
  key: string;
  label: string;
  description: string;
  category: NodeCategory;
  executable: boolean;
  icon: React.ReactNode;
  bpmnType: string;
}

const { width: NODE_WIDTH, height: NODE_HEIGHT } = FLOW_NODE_SIZE;
const { step: SNAP_GRID, x: SNAP_ORIGIN_X, y: SNAP_ORIGIN_Y } = FLOW_NODE_GRID;
const annotationResizeKeys: Partial<Record<string, FlowRoutePoint>> = {
  ArrowLeft: { x: -SNAP_GRID, y: 0 },
  ArrowRight: { x: SNAP_GRID, y: 0 },
  ArrowUp: { x: 0, y: -SNAP_GRID },
  ArrowDown: { x: 0, y: SNAP_GRID },
};
const DEFAULT_NODE_START_Y = 140;
const DEFAULT_NODE_GAP_Y = SNAP_GRID * 4;
const DEFAULT_STACK_NODE_IDS = ['start-1', 'task-1', 'task-2', 'end-1'];
const GENERATED_STACK_NODE_IDS = ['flow-0', 'flow-1', 'flow-2', 'flow-3'];
const LEGACY_STACK_X_VALUES = [360, 420];

const nodeGroups: Array<{ key: NodeCategory; title: string; items: NodeDefinition[] }> = [
  {
    key: 'event',
    title: '事件',
    items: [
      { key: 'startEvent', label: '开始事件', description: '表单提交或动作触发入口', category: 'event', executable: true, icon: <PlayCircleOutlined />, bpmnType: 'bpmn:StartEvent' },
      { key: 'endEvent', label: '结束事件', description: '流程完成、驳回或归档出口', category: 'event', executable: true, icon: <StopOutlined />, bpmnType: 'bpmn:EndEvent' },
      { key: 'timerEvent', label: '定时事件', description: '等待到期或定时唤醒', category: 'event', executable: false, icon: <FieldTimeOutlined />, bpmnType: 'bpmn:IntermediateCatchEvent' },
      { key: 'messageEvent', label: '消息事件', description: '等待外部消息或系统回调', category: 'event', executable: false, icon: <MailOutlined />, bpmnType: 'bpmn:MessageEventDefinition' },
    ],
  },
  {
    key: 'task',
    title: '任务',
    items: [
      { key: 'userTask', label: '审批任务', description: '人工审批、会签或或签', category: 'task', executable: true, icon: <UserSwitchOutlined />, bpmnType: 'bpmn:UserTask' },
      { key: 'serviceTask', label: '自动任务', description: '写入数据、调用接口、触发消息', category: 'task', executable: true, icon: <ApiOutlined />, bpmnType: 'bpmn:ServiceTask' },
      { key: 'ccTask', label: '抄送任务', description: '通知相关角色或人员', category: 'task', executable: true, icon: <UserOutlined />, bpmnType: 'bpmn:SendTask' },
      { key: 'scriptTask', label: '脚本任务', description: '执行表达式或脚本逻辑', category: 'task', executable: false, icon: <ThunderboltOutlined />, bpmnType: 'bpmn:ScriptTask' },
    ],
  },
  {
    key: 'gateway',
    title: '网关',
    items: [
      { key: 'exclusiveGateway', label: '条件网关', description: '按字段或表达式进入不同路径', category: 'gateway', executable: true, icon: <BranchesOutlined />, bpmnType: 'bpmn:ExclusiveGateway' },
      { key: 'parallelGateway', label: '并行网关', description: '同时进入多条处理路径', category: 'gateway', executable: true, icon: <ForkOutlined />, bpmnType: 'bpmn:ParallelGateway' },
      { key: 'joinGateway', label: '汇聚网关', description: '等待并行路径汇总后继续', category: 'gateway', executable: true, icon: <GatewayOutlined />, bpmnType: 'bpmn:ParallelGateway' },
      { key: 'inclusiveGateway', label: '包容网关', description: '满足多条件时进入多条路径', category: 'gateway', executable: false, icon: <PartitionOutlined />, bpmnType: 'bpmn:InclusiveGateway' },
    ],
  },
  {
    key: 'subprocess',
    title: '子流程',
    items: [
      { key: 'subProcess', label: '子流程', description: '复用一段流程片段', category: 'subprocess', executable: false, icon: <ApartmentOutlined />, bpmnType: 'bpmn:SubProcess' },
      { key: 'callActivity', label: '调用活动', description: '调用独立流程定义', category: 'subprocess', executable: false, icon: <DeploymentUnitOutlined />, bpmnType: 'bpmn:CallActivity' },
    ],
  },
  {
    key: 'data',
    title: '数据/消息',
    items: [
      { key: 'dataObject', label: '数据对象', description: '流程中引用的业务数据', category: 'data', executable: false, icon: <DatabaseOutlined />, bpmnType: 'bpmn:DataObjectReference' },
      { key: 'messageTask', label: '消息任务', description: '发送业务消息或通知', category: 'data', executable: false, icon: <GlobalOutlined />, bpmnType: 'bpmn:SendTask' },
    ],
  },
  {
    key: 'boundary',
    title: '异常/边界',
    items: [
      { key: 'boundaryTimer', label: '超时边界', description: '任务超时后触发升级路径', category: 'boundary', executable: false, icon: <ClockCircleOutlined />, bpmnType: 'bpmn:BoundaryEvent' },
      { key: 'errorBoundary', label: '错误边界', description: '自动任务失败后的补偿路径', category: 'boundary', executable: false, icon: <CloseCircleOutlined />, bpmnType: 'bpmn:ErrorEventDefinition' },
      { key: 'compensation', label: '补偿处理', description: '回滚或补偿已执行动作', category: 'boundary', executable: false, icon: <SafetyCertificateOutlined />, bpmnType: 'bpmn:CompensateEventDefinition' },
    ],
  },
];

const executableNodeTypes = new Set(['startEvent', 'endEvent', 'userTask', 'serviceTask', 'ccTask', 'exclusiveGateway', 'parallelGateway', 'joinGateway']);
const approvalTaskTypes = new Set(['userTask', 'manualTask']);
const approvalOutcomeLabels = { approve: '通过', reject: '驳回' } as const;

export function approvalRejectionTargets(config: Pick<FlowDesignerConfig, 'nodes' | 'edges'>, nodeId: string) {
  const previous = new Set<string>();
  const next = new Set<string>();
  for (const edge of config.edges) {
    if (edge.target === nodeId && edge.source !== nodeId) previous.add(edge.source);
    if (edge.source === nodeId && edge.target !== nodeId) next.add(edge.target);
  }
  return {
    previous: config.nodes.filter((node) => previous.has(node.id)),
    next: config.nodes.filter((node) => next.has(node.id) && !previous.has(node.id)),
  };
}
const nodeDefinitions = nodeGroups.flatMap((group) => group.items);

const assigneeSourceOptions = [
  { value: 'fixed', label: '固定人员' },
  { value: 'role', label: '角色' },
  { value: 'departmentOwner', label: '部门负责人' },
  { value: 'initiatorManager', label: '发起人上级' },
  { value: 'field', label: '表单字段人员' },
];

const assigneeTargetTypeOptions = [
  { value: 'role', label: '角色' },
  { value: 'user', label: '用户' },
  { value: 'organization', label: '组织' },
  { value: 'field', label: '表单字段' },
  { value: 'departmentOwner', label: '部门负责人' },
  { value: 'initiatorManager', label: '发起人上级' },
];

const externalActionTypeOptions = [
  { value: 'api', label: '调用 API' },
  { value: 'webhook', label: 'Webhook' },
  { value: 'form', label: '创建站内表单草稿' },
];

const approvalModeOptions = [
  { value: 'single', label: '单人' },
  { value: 'orSign', label: '或签' },
  { value: 'countersign', label: '会签' },
];

const ccRecipientTypeOptions = [
  { value: 'user', label: '用户' },
  { value: 'role', label: '角色' },
];

const edgeConditionOperatorOptions = [
  { value: 'eq', label: '等于' },
  { value: 'ne', label: '不等于' },
  { value: 'contains', label: '包含' },
  { value: 'gt', label: '大于' },
  { value: 'gte', label: '大于等于' },
  { value: 'lt', label: '小于' },
  { value: 'lte', label: '小于等于' },
  { value: 'empty', label: '为空' },
  { value: 'not_empty', label: '不为空' },
];

const edgeConditionOperatorsWithoutValue = new Set(['empty', 'not_empty']);

function quoteConditionValue(value: string) {
  const escaped = value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `'${escaped}'`;
}

function buildEdgeConditionExpression(field?: string, operator?: string, value?: string) {
  if (!field || !operator) return undefined;
  if (operator === 'empty') return `!${field}`;
  if (operator === 'not_empty') return `!!${field}`;
  const normalizedValue = String(value ?? '').trim();
  if (!normalizedValue) return undefined;
  const right = quoteConditionValue(normalizedValue);
  const operatorMap: Record<string, string> = {
    eq: '==',
    ne: '!=',
    gt: '>',
    gte: '>=',
    lt: '<',
    lte: '<=',
  };
  if (operator === 'contains') return `${field}.includes(${right})`;
  return `${field} ${operatorMap[operator] || '=='} ${right}`;
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getNodeBounds(canvas: HTMLDivElement) {
  return {
    min: { x: SNAP_ORIGIN_X, y: SNAP_ORIGIN_Y },
    max: {
      x: Math.max(SNAP_ORIGIN_X, canvas.offsetWidth - NODE_WIDTH - 24),
      y: Math.max(SNAP_ORIGIN_Y, canvas.offsetHeight - NODE_HEIGHT - 24),
    },
  };
}

function snapNodePosition(x: number, y: number, canvas: HTMLDivElement) {
  return snapFlowNode({ x, y }, getNodeBounds(canvas)).point;
}

function getCenteredNodeX(width: number) {
  return Math.max(SNAP_ORIGIN_X, Math.round((width - NODE_WIDTH) / 2));
}

function isDefaultVerticalStack(nodes: FlowDesignerNode[]) {
  if (nodes.length !== 4) return false;
  const ids = nodes.map((node) => node.id);
  const hasDefaultIds = DEFAULT_STACK_NODE_IDS.every((id, index) => ids[index] === id)
    || GENERATED_STACK_NODE_IDS.every((id, index) => ids[index] === id);
  const expectedTypes = ['startEvent', 'userTask', 'userTask', 'endEvent'];
  const hasDefaultTypes = expectedTypes.every((type, index) => nodes[index].type === type);
  const expectedY = nodes.map((_, index) => DEFAULT_NODE_START_Y + index * DEFAULT_NODE_GAP_Y);
  const hasDefaultY = expectedY.every((y, index) => Math.abs(nodes[index].y - y) <= 1);
  return (hasDefaultIds || hasDefaultTypes) && hasDefaultY;
}

function getCanvasScale(canvas: HTMLDivElement) {
  const rect = canvas.getBoundingClientRect();
  return {
    scaleX: rect.width / canvas.offsetWidth || 1,
    scaleY: rect.height / canvas.offsetHeight || 1,
  };
}

function clientToCanvasPoint(canvas: HTMLDivElement, clientX: number, clientY: number) {
  const rect = canvas.getBoundingClientRect();
  const { scaleX, scaleY } = getCanvasScale(canvas);
  return {
    x: (clientX - rect.left) / scaleX,
    y: (clientY - rect.top) / scaleY,
  };
}

function cloneFlowConfig(config: FlowDesignerConfig): FlowDesignerConfig {
  return {
    ...config,
    nodes: config.nodes.map((node) => ({
      ...node,
      ccRecipients: node.ccRecipients?.map((recipient) => ({ ...recipient })),
      fieldPermissions: node.fieldPermissions
        ? Object.fromEntries(Object.entries(node.fieldPermissions).map(([key, value]) => [key, { ...value }]))
        : undefined,
    })),
    edges: config.edges.map((edge) => ({ ...edge })),
    annotations: config.annotations?.map((annotation) => ({
      ...annotation,
      nodeIds: [...annotation.nodeIds],
      size: annotation.size && { ...annotation.size },
      titleStyle: annotation.titleStyle && { ...annotation.titleStyle },
      frameStyle: annotation.frameStyle && { ...annotation.frameStyle },
    })),
    triggerBindings: config.triggerBindings.map((binding) => ({ ...binding })),
    stateMapping: { ...config.stateMapping },
    advancedModeConfig: { ...config.advancedModeConfig },
  };
}

function isEditableTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  return Boolean(element?.closest('input, textarea, [contenteditable="true"], .ant-select, .ant-input-number'));
}

export function normalizeNodeFieldPermissions(permissions: FlowDesignerNode['fieldPermissions']) {
  return Object.fromEntries(Object.entries(permissions || {}).map(([key, permission]) => [key, {
    visible: permission.visible !== false,
    editable: Boolean(permission.editable),
    required: Boolean(permission.editable && permission.required),
  }]));
}

function makeFieldPermissions(fields: FlowDesignerField[]) {
  return Object.fromEntries(fields.map((field) => [
    field.key,
    { visible: true, editable: !field.required, required: false },
  ]));
}

function createNode(definition: NodeDefinition, fields: FlowDesignerField[], index: number): FlowDesignerNode {
  return {
    id: makeId(definition.key),
    type: definition.key,
    category: definition.category,
    label: definition.label,
    description: definition.description,
    executable: definition.executable,
    x: 360,
    y: DEFAULT_NODE_START_Y + index * DEFAULT_NODE_GAP_Y,
    assigneeSource: approvalTaskTypes.has(definition.key) ? 'role' : undefined,
    assigneeValue: approvalTaskTypes.has(definition.key) ? '流程审批人' : undefined,
    assigneeRules: approvalTaskTypes.has(definition.key) ? [{ id: makeId('assignee'), type: 'role', value: '流程审批人', approvalMode: 'single' }] : undefined,
    approvalMode: approvalTaskTypes.has(definition.key) ? 'single' : undefined,
    slaHours: approvalTaskTypes.has(definition.key) ? 24 : undefined,
    notificationEnabled: definition.key !== 'startEvent',
    errorPolicy: definition.key === 'serviceTask' ? 'retry' : 'manual',
    retryTimes: definition.key === 'serviceTask' ? 3 : 0,
    externalAction: definition.key === 'serviceTask' ? { enabled: false, action: 'api', fieldMappings: [] } : undefined,
    bpmnType: definition.bpmnType,
    fieldPermissions: makeFieldPermissions(fields),
  };
}

export function createDefaultFlowConfig(params: {
  formId: string;
  formName: string;
  version: string;
  steps: string[];
  fields: FlowDesignerField[];
}): FlowDesignerConfig {
  const startDef = nodeGroups[0].items[0];
  const endDef = nodeGroups[0].items[1];
  const taskDef = nodeGroups[1].items[0];
  const labels = params.steps.length >= 2 ? params.steps : ['提交', params.steps[0] || '审批', '归档'];
  const nodes = labels.map((label, index) => {
    const definition = index === 0 ? startDef : index === labels.length - 1 ? endDef : taskDef;
    return { ...createNode(definition, params.fields, index), id: `flow-${index}`, label };
  });
  const edges = nodes.slice(0, -1).map((node, index) => ({
    id: `${node.id}-${nodes[index + 1].id}`,
    source: node.id,
    sourceSide: 'bottom' as FlowPortSide,
    target: nodes[index + 1].id,
    targetSide: 'top' as FlowPortSide,
    label: index === 0 ? '提交' : '通过',
    priority: index + 1,
    isDefault: true,
  }));

  return {
    id: `${params.formId}-workflow`,
    name: `${params.formName}流程`,
    version: params.version,
    nodes,
    edges,
    triggerBindings: [
      { action: 'submit', label: '提交表单', enabled: true },
    ],
    stateMapping: {
      statusField: 'workflow_status',
      currentNodeField: 'current_node',
      currentAssigneeField: 'current_assignee',
      completedAtField: 'completed_at',
    },
    advancedModeConfig: {
      enabled: false,
      publishPolicy: 'blockAdvanced',
    },
  };
}

export function workflowTriggerStartId(binding: FlowDesignerConfig['triggerBindings'][number], startNodes: FlowDesignerNode[]) {
  if (!binding.enabled) return undefined;
  if (startNodes.length === 1) return startNodes[0].id;
  return startNodes.find((node) => node.id === binding.startNodeId)?.id;
}

export function preserveWorkflowStartBindings(previous: FlowDesignerConfig, next: FlowDesignerConfig) {
  if (next.nodes === previous.nodes) return next;
  const oldStarts = previous.nodes.filter((node) => node.type === 'startEvent');
  const newStarts = next.nodes.filter((node) => node.type === 'startEvent');
  if (oldStarts.length !== 1 || newStarts.length <= 1 || !newStarts.some((node) => node.id === oldStarts[0].id)) return next;
  return {
    ...next,
    triggerBindings: next.triggerBindings.map((binding) => binding.enabled && !newStarts.some((node) => node.id === binding.startNodeId)
      ? { ...binding, startNodeId: oldStarts[0].id } : binding),
  };
}

export function setWorkflowStartTrigger(config: FlowDesignerConfig, action: string, startId: string, enabled: boolean) {
  const starts = config.nodes.filter((node) => node.type === 'startEvent');
  if (!starts.some((node) => node.id === startId)) return config.triggerBindings;
  return config.triggerBindings.map((binding) => {
    if (binding.action !== action || (!enabled && workflowTriggerStartId(binding, starts) !== startId)) return binding;
    return { ...binding, enabled, startNodeId: enabled ? startId : undefined };
  });
}

export function validateFlowDesignerConfig(config: FlowDesignerConfig): FlowDesignerValidationItem[] {
  const startNodes = config.nodes.filter((node) => node.type === 'startEvent');
  const endNodes = config.nodes.filter((node) => node.type === 'endEvent');
  const nodeIds = new Set(config.nodes.map((node) => node.id));
  const connectedNodeIds = new Set<string>();
  const outgoing = new Map<string, FlowDesignerEdge[]>();
  const incoming = new Map<string, string[]>();
  config.edges.forEach((edge) => {
    connectedNodeIds.add(edge.source);
    connectedNodeIds.add(edge.target);
    const routes = outgoing.get(edge.source) ?? [];
    routes.push(edge);
    outgoing.set(edge.source, routes);
    const predecessors = incoming.get(edge.target) ?? [];
    predecessors.push(edge.source);
    incoming.set(edge.target, predecessors);
  });
  const orphanNodes = config.nodes.filter((node) => node.executable && node.type !== 'startEvent' && node.type !== 'endEvent' && !connectedNodeIds.has(node.id));
  const incompleteApprovals = config.nodes.filter((node) => approvalTaskTypes.has(node.type) && (
    node.assigneeRules?.length
      ? node.assigneeRules.some((rule) => !['departmentOwner', 'initiatorManager'].includes(rule.type) && !String(rule.value || '').trim())
      : !(node.assigneeSource && node.assigneeValue)
  ));
  const incompleteCc = config.nodes.filter((node) => node.type === 'ccTask' && (
    !node.ccRecipients?.length || node.ccRecipients.some((recipient) =>
      !['user', 'role'].includes(recipient.type) || !recipient.value?.trim())
  ));
  const incompleteGateways = config.nodes.filter((node) => node.type === 'exclusiveGateway').filter((node) => {
    const routes = outgoing.get(node.id) ?? [];
    return routes.length < 2 || routes.every((edge) => !edge.conditionField && !edge.condition && !edge.isDefault);
  });
  const invalidApprovalRoutes = config.nodes.filter((node) => {
    const routes = outgoing.get(node.id) ?? [];
    if (!routes.some((edge) => edge.approvalOutcome)) return false;
    const rejections = routes.filter((edge) => edge.approvalOutcome === 'reject').length;
    return !approvalTaskTypes.has(node.type) || rejections > 1 || routes.length - rejections !== 1;
  });
  const invalidRejectionTargets = config.nodes.filter((node) => (
    node.rejectionTargetId && (!approvalTaskTypes.has(node.type) ||
      (!outgoing.get(node.id)?.some((edge) => edge.target !== node.id && edge.target === node.rejectionTargetId) &&
       !incoming.get(node.id)?.some((source) => source !== node.id && source === node.rejectionTargetId)))
  ));
  const hasParallelGateway = config.nodes.some((node) => ['parallelGateway', 'joinGateway'].includes(node.type));
  const invalidEdges = config.edges.filter((edge) => !nodeIds.has(edge.source) || !nodeIds.has(edge.target));
  const enabledTriggers = config.triggerBindings.filter((binding) => binding.enabled);
  const reachable = new Set<string>();
  const pending = endNodes.map((node) => node.id);
  while (pending.length) {
    const id = pending.pop()!;
    if (reachable.has(id) || !nodeIds.has(id)) continue;
    reachable.add(id);
    for (const source of incoming.get(id) ?? []) pending.push(source);
  }
  const startsWithoutEnd = startNodes.filter((node) => !reachable.has(node.id));
  const unassignedTriggers = startNodes.length > 1
    ? enabledTriggers.filter((binding) => !startNodes.some((node) => node.id === binding.startNodeId))
    : [];
  const issues: FlowDesignerValidationItem[] = [
    {
      level: startNodes.length ? 'suggestion' : 'error',
      title: '开始事件',
      detail: startNodes.length ? `流程包含 ${startNodes.length} 个开始事件。` : '流程至少需要一个开始事件。',
    },
    {
      level: endNodes.length >= 1 ? 'suggestion' : 'error',
      title: '结束事件',
      detail: endNodes.length >= 1 ? `流程包含 ${endNodes.length} 个结束出口。` : '流程至少需要一个结束事件。',
    },
    {
      level: orphanNodes.length ? 'error' : 'suggestion',
      title: '孤立节点',
      detail: orphanNodes.length ? `以下可执行节点未连入流程：${orphanNodes.map((node) => node.label).join('、')}` : '未发现孤立的可执行节点。',
    },
    {
      level: incompleteApprovals.length ? 'error' : 'suggestion',
      title: '审批处理人',
      detail: incompleteApprovals.length ? `以下审批节点缺少处理人：${incompleteApprovals.map((node) => node.label).join('、')}` : '审批节点均已配置处理人来源。',
    },
    {
      level: incompleteGateways.length ? 'error' : 'suggestion',
      title: '条件分支',
      detail: incompleteGateways.length ? `以下条件网关需要至少两条路径，并配置条件或默认路径：${incompleteGateways.map((node) => node.label).join('、')}` : '条件网关配置完整。',
    },
    {
      level: hasParallelGateway ? 'error' : 'suggestion',
      title: '并行汇聚',
      detail: hasParallelGateway ? '暂不支持执行并行网关；请使用审批组配置会签或或签。' : '未使用并行网关。',
    },
    {
      level: invalidEdges.length ? 'error' : 'suggestion',
      title: '连线有效性',
      detail: invalidEdges.length ? `存在 ${invalidEdges.length} 条连接了无效节点的连线。` : '连线均连接有效节点。',
    },
    {
      level: enabledTriggers.length && !unassignedTriggers.length ? 'suggestion' : 'error',
      title: '触发绑定',
      detail: unassignedTriggers.length
        ? `请选择开始节点，在「触发动作」中绑定 ${unassignedTriggers.map((binding) => binding.label || binding.action).join('、')}。`
        : enabledTriggers.length ? `已启用 ${enabledTriggers.length} 个表单触发动作。` : '至少需要启用一个表单触发动作。',
    },
  ];
  if (incompleteCc.length) {
    issues.push({ level: 'error', title: '抄送对象', detail: `请为以下抄送任务配置收件人：${incompleteCc.map((node) => node.label).join('、')}。` });
  }
  if (endNodes.length && startsWithoutEnd.length) {
    issues.push({ level: 'error', title: '起止路径', detail: `请为以下开始事件连接至少一个结束事件：${startsWithoutEnd.map((node) => node.label).join('、')}。` });
  }
  if (invalidApprovalRoutes.length) {
    issues.push({ level: 'error', title: '审批结果连线', detail: `请从审批节点配置一条通过连线和至多一条驳回连线：${invalidApprovalRoutes.map((node) => node.label).join('、')}。` });
  }
  if (invalidRejectionTargets.length) {
    issues.push({ level: 'error', title: '自定义驳回', detail: `请选择直接相连的驳回目标：${invalidRejectionTargets.map((node) => node.label).join('、')}。` });
  }
  return issues;
}

export function getRemovableFlowNodeIds(config: FlowDesignerConfig, selectedIds: string[]) {
  const removable = new Set(selectedIds);
  const preferredStarts = new Set(config.triggerBindings.filter((binding) => binding.enabled).map((binding) => binding.startNodeId));
  for (const type of ['startEvent', 'endEvent']) {
    const events = config.nodes.filter((node) => node.type === type);
    if (!events.length || events.some((node) => !removable.has(node.id))) continue;
    const retained = type === 'startEvent' ? events.find((node) => preferredStarts.has(node.id)) ?? events[0] : events[0];
    removable.delete(retained.id);
  }
  return removable;
}

function getPortPoint(node: FlowDesignerNode, side: FlowPortSide) {
  const points: Record<FlowPortSide, { x: number; y: number }> = {
    top: { x: node.x + NODE_WIDTH / 2, y: node.y },
    right: { x: node.x + NODE_WIDTH, y: node.y + NODE_HEIGHT / 2 },
    bottom: { x: node.x + NODE_WIDTH / 2, y: node.y + NODE_HEIGHT },
    left: { x: node.x, y: node.y + NODE_HEIGHT / 2 },
  };
  return points[side];
}

function previewTargetSide(fromSide: FlowPortSide, start: { x: number; y: number }, end: { x: number; y: number }): FlowPortSide {
  if (fromSide === 'left' || fromSide === 'right') {
    return end.x >= start.x ? 'left' : 'right';
  }
  return end.y >= start.y ? 'top' : 'bottom';
}

function nearestPortSide(node: FlowDesignerNode, point: { x: number; y: number }): FlowPortSide {
  const distances: Array<[FlowPortSide, number]> = (['top', 'right', 'bottom', 'left'] as FlowPortSide[]).map((side) => {
    const port = getPortPoint(node, side);
    return [side, Math.hypot(point.x - port.x, point.y - port.y)];
  });
  return distances.sort((a, b) => a[1] - b[1])[0][0];
}

function getNodeDefinition(type: string) {
  const normalizedType = type === 'manualTask' ? 'userTask' : type;
  return nodeDefinitions.find((definition) => definition.key === normalizedType);
}

function getNodeTypeLabel(node: FlowDesignerNode) {
  return getNodeDefinition(node.type)?.label || node.type;
}

function getNodeTypeDescription(node: FlowDesignerNode) {
  return getNodeDefinition(node.type)?.description || node.description;
}

function getNodeIcon(node: FlowDesignerNode) {
  return getNodeDefinition(node.type)?.icon || <UserSwitchOutlined />;
}

function portsForNode(node: FlowDesignerNode): FlowPortSide[] {
  if (node.type === 'startEvent') return ['left', 'right', 'bottom'];
  if (node.type === 'endEvent') return ['top', 'left', 'right'];
  return ['top', 'right', 'bottom', 'left'];
}

export default function ProfessionalFlowDesigner({
  config,
  externalInspector = false,
  propertiesTarget,
  fields,
  roles,
  roleOptions,
  users = [],
  onChange,
}: {
  config: FlowDesignerConfig;
  externalInspector?:boolean;
  propertiesTarget?:HTMLElement|null;
  fields: FlowDesignerField[];
  roles: string[];
  roleOptions?: Array<{ value: string; label: string }>;
  users?: Array<{ value: string; label: string }>;
  onChange: (config: FlowDesignerConfig) => void;
}) {
  const [selection, setSelection] = useState<Selection>({ type: 'canvas' });
  const [pendingPort, setPendingPort] = useState<{ nodeId: string; side: FlowPortSide } | null>(null);
  const [isPaletteDragOver, setPaletteDragOver] = useState(false);
  const [palettePreview, setPalettePreview] = useState<{ label: string; x: number; y: number; inside: boolean } | null>(null);
  const [dragPreview, setDragPreview] = useState<FlowNodeSnap | null>(null);
  const [annotationResize, setAnnotationResize] = useState<{ id: string; size: FlowAnnotationSize } | null>(null);
  const [connectionPreview, setConnectionPreview] = useState<{ x: number; y: number } | null>(null);
  const [marqueeSelection, setMarqueeSelection] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [selectedWaypoint, setSelectedWaypoint] = useState<{ edgeId: string; index: number } | null>(null);
  const [routePreview, setRoutePreview] = useState<RouteDragPreview | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const arrowId = useId();
  const [conditionModalOpen, setConditionModalOpen] = useState(false);
  const [history, setHistory] = useState<FlowDesignerConfig[]>([]);
  const [future, setFuture] = useState<FlowDesignerConfig[]>([]);
  const [clipboard, setClipboard] = useState<{ graph: FlowClipboard; pasteCount: number } | null>(null);
  const [nodeSearch, setNodeSearch] = useState('');
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const annotationResizeRef = useRef<{
    id: string;
    pointerId: number;
    origin: FlowRoutePoint;
    size: FlowAnnotationSize;
    minimum: FlowAnnotationSize;
    preview: FlowAnnotationSize;
  } | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const pastedAnnotationRef = useRef<string | null>(null);
  const autoCenteredStackXRef = useRef<number | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    pointerStart: FlowRoutePoint;
    pointerOrigin: FlowRoutePoint;
    primary: FlowDesignerNode;
    clickSelection: Selection;
    moveInternalRoutes: boolean;
    ids: Set<string>;
    neighbors: FlowDesignerNode[];
    bounds: ReturnType<typeof getNodeBounds>;
    preview: FlowNodeSnap | null;
  } | null>(null);
  const routeDragRef = useRef<{
    edgeId: string;
    pointerId: number;
    pointerStart: FlowRoutePoint;
    pointerOrigin: FlowRoutePoint;
    move: (delta: FlowRoutePoint, canvas: HTMLDivElement) => RouteDragPreview | null;
    preview: RouteDragPreview | null;
  } | null>(null);
  const marqueeRef = useRef<{ pointerId: number; startX: number; startY: number; dragging: boolean } | null>(null);
  const palettePointerDragRef = useRef<{
    definition: NodeDefinition;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    dragging: boolean;
  } | null>(null);
  const suppressPaletteClickRef = useRef(false);
  const suppressCanvasClickRef = useRef(false);
  const validation = useMemo(() => validateFlowDesignerConfig(config), [config]);
  const startNodes = config.nodes.filter((node) => node.type === 'startEvent');
  const normalizedNodeSearch = nodeSearch.trim().toLowerCase();
  const visibleNodeGroups = useMemo(() => {
    return nodeGroups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => {
          if (!item.executable) return false;
          if (!normalizedNodeSearch) return true;
          return [group.title, item.label, item.description, item.category, item.key]
            .join(' ')
            .toLowerCase()
            .includes(normalizedNodeSearch);
        }),
      }))
      .filter((group) => group.items.length > 0);
  }, [normalizedNodeSearch]);
  const quickNodeItems = useMemo(() => {
    const quickKeys = new Set(['userTask', 'serviceTask', 'ccTask']);
    return visibleNodeGroups.flatMap((group) => group.items).filter((item) => quickKeys.has(item.key));
  }, [visibleNodeGroups]);
  const selectedNode = selection.type === 'node' ? config.nodes.find((node) => node.id === selection.id) : undefined;
  const [dispatchForms,setDispatchForms]=useState<PlatformForm[]>([]);
  const [dispatchFields,setDispatchFields]=useState<PlatformFormField[]>([]);
  const [dispatchLoadError,setDispatchLoadError]=useState('');
  const dispatchTargetId=selectedNode?.externalAction?.targetFormId;
  useEffect(()=>{
    if(selectedNode?.type!=='serviceTask')return;
    let current=true;
    listPlatformForms().then(response=>{if(current){const data=response.data?.data??response.data;setDispatchForms((Array.isArray(data)?data:data?.items??[]).filter((form:PlatformForm)=>form.status==='published'));}}).catch(()=>{if(current)setDispatchLoadError('目标表单加载失败');});
    return()=>{current=false;};
  },[selectedNode?.type]);
  useEffect(()=>{
    setDispatchFields([]);setDispatchLoadError('');
    if(!dispatchTargetId)return;
    let current=true;
    getPlatformForm(dispatchTargetId,{schema:'published'}).then(response=>{if(current){const form=response.data?.data??response.data;setDispatchFields((form.fields??[]).filter((field:PlatformFormField)=>!field.archived));}}).catch(()=>{if(current)setDispatchLoadError('目标字段加载失败，请检查表单权限');});
    return()=>{current=false;};
  },[dispatchTargetId]);
  const selectedEdge = selection.type === 'edge' ? config.edges.find((edge) => edge.id === selection.id) : undefined;
  const annotations = config.annotations ?? [];
  const selectedAnnotation = selection.type === 'annotation' ? annotations.find((annotation) => annotation.id === selection.id) : undefined;
  const selectedAnnotationIds = new Set(selection.type === 'multiple' ? selection.annotationIds : selectedAnnotation ? [selectedAnnotation.id] : []);
  const selectedNodeIds = selection.type === 'multiple' ? selection.nodeIds : selection.type === 'node' ? [selection.id] : [];
  const selectedNodeIdSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);
  const canCopySelection = Boolean(selectedNodeIds.length || selectedAnnotationIds.size);
  const copyLabel = selectedAnnotationIds.size ? (selectedNodeIds.length ? '复制所选项' : '复制注释') : '复制节点';
  const selectedEdgeSourceNode = selectedEdge ? config.nodes.find((node) => node.id === selectedEdge.source) : undefined;
  const isSelectedEdgeFromBranch = selectedEdgeSourceNode?.type === 'exclusiveGateway';
  const isSelectedEdgeFromApproval = approvalTaskTypes.has(selectedEdgeSourceNode?.type ?? '');

  useEffect(() => {
    setSelectedWaypoint(null);
    if (selection.type !== 'edge') {
      setConditionModalOpen(false);
    }
  }, [selectedEdge?.id, selection.type]);

  useEffect(() => {
    if (!config.nodes.some((node) => node.type === 'manualTask')) return;
    onChange({
      ...config,
      nodes: config.nodes.map((node) => (node.type === 'manualTask'
        ? {
            ...node,
            type: 'userTask',
            bpmnType: 'bpmn:UserTask',
            assigneeSource: node.assigneeSource || 'role',
            assigneeValue: node.assigneeValue || '流程审批人',
            assigneeRules: node.assigneeRules?.length
              ? node.assigneeRules
              : [{ id: makeId('assignee'), type: 'role', value: node.assigneeValue || '流程审批人' }],
            approvalMode: node.approvalMode || 'single',
          }
        : node)),
    });
  }, [config, onChange]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const measure = () => setViewportWidth(viewport.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const id = pastedAnnotationRef.current;
    const viewport = viewportRef.current;
    const canvas = canvasRef.current;
    if (!id || !viewport || !canvas) return;
    pastedAnnotationRef.current = null;
    const frame = viewport.querySelector(`[data-flow-annotation-id="${id}"]`);
    if (!frame) return;
    const { left, right, width } = frame.getBoundingClientRect();
    const viewportLeft = viewport.getBoundingClientRect().left;
    const viewportRight = viewportLeft + viewport.clientWidth;
    const shift = width >= viewport.clientWidth || left < viewportLeft ? left - viewportLeft : Math.max(0, right - viewportRight);
    viewport.scrollLeft += shift / getCanvasScale(canvas).scaleX;
  }, [config.annotations]);

  useEffect(() => {
    if (!viewportWidth || !isDefaultVerticalStack(config.nodes) || config.edges.some((edge) => edge.waypoints?.length)) return;
    const firstX = config.nodes[0]?.x;
    const allNodesShareX = config.nodes.every((node) => Math.abs(node.x - firstX) <= 1);
    if (!allNodesShareX) return;
    const wasAutoCentered = autoCenteredStackXRef.current !== null && Math.abs(firstX - autoCenteredStackXRef.current) <= 1;
    const isLegacyDefaultX = LEGACY_STACK_X_VALUES.some((x) => Math.abs(firstX - x) <= 1);
    if (!wasAutoCentered && !isLegacyDefaultX) return;
    const centeredX = getCenteredNodeX(viewportWidth);
    autoCenteredStackXRef.current = centeredX;
    if (config.nodes.every((node) => Math.abs(node.x - centeredX) <= 1)) return;
    onChange({
      ...config,
      nodes: config.nodes.map((node) => ({ ...node, x: centeredX })),
    });
  }, [config, onChange, viewportWidth]);

  const applyConfig = (nextConfig: FlowDesignerConfig, options: { record?: boolean } = {}) => {
    if (options.record !== false) {
      setHistory((items) => [...items.slice(-29), cloneFlowConfig(config)]);
      setFuture([]);
    }
    onChange(nextConfig);
  };

  const patchConfig = (patch: Partial<FlowDesignerConfig>, options?: { record?: boolean }) =>
    applyConfig(preserveWorkflowStartBindings(config, { ...config, ...patch }), options);
  const patchNode = (nodeId: string, patch: Partial<FlowDesignerNode>) => {
    patchConfig({ nodes: config.nodes.map((node) => (node.id === nodeId ? { ...node, ...patch } : node)) });
  };
  const patchEdge = (edgeId: string, patch: Partial<FlowDesignerEdge>) => {
    patchConfig({ edges: config.edges.map((edge) => (edge.id === edgeId ? { ...edge, ...patch } : edge)) });
  };
  const addAnnotation = () => {
    const nodeIds = config.nodes.filter((node) => selectedNodeIdSet.has(node.id)).map((node) => node.id);
    if (!nodeIds.length) return;
    const annotation: FlowAnnotation = { id: makeId('annotation'), nodeIds, title: '注释', color: DEFAULT_FLOW_ANNOTATION_COLOR };
    patchConfig({ annotations: [...annotations, annotation] });
    setSelection({ type: 'annotation', id: annotation.id });
  };
  const patchAnnotation = (annotationId: string, patch: Partial<FlowAnnotation>) => {
    patchConfig({ annotations: annotations.map((annotation) => annotation.id === annotationId ? { ...annotation, ...patch } : annotation) });
  };

  const startAnnotationResize = (
    event: React.PointerEvent<HTMLButtonElement>, id: string, bounds: FlowAnnotationSize, minimum: FlowAnnotationSize,
  ) => {
    const canvas = canvasRef.current;
    if (!canvas || event.button !== 0 || pendingPort || annotationResizeRef.current || dragRef.current || routeDragRef.current || marqueeRef.current) return;
    event.stopPropagation();
    const size = { width: bounds.width, height: bounds.height };
    annotationResizeRef.current = {
      id, pointerId: event.pointerId, origin: clientToCanvasPoint(canvas, event.clientX, event.clientY),
      size, minimum, preview: size,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveAnnotationResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = annotationResizeRef.current;
    const canvas = canvasRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !canvas) return;
    const point = clientToCanvasPoint(canvas, event.clientX, event.clientY);
    drag.preview = resizeFlowAnnotation(drag.size, { x: point.x - drag.origin.x, y: point.y - drag.origin.y }, drag.minimum);
    setAnnotationResize({ id: drag.id, size: drag.preview });
  };

  const stopAnnotationResize = (commit: boolean, pointerId?: number) => {
    const drag = annotationResizeRef.current;
    if (!drag || (pointerId !== undefined && drag.pointerId !== pointerId)) return;
    annotationResizeRef.current = null;
    setAnnotationResize(null);
    if (commit && (drag.size.width !== drag.preview.width || drag.size.height !== drag.preview.height)) {
      patchAnnotation(drag.id, { size: drag.preview });
    }
  };

  const routeForEdge = (edge: FlowDesignerEdge, waypoints = edge.waypoints, nodes = config.nodes) => {
    const from = nodes.find((node) => node.id === edge.source);
    const to = nodes.find((node) => node.id === edge.target);
    if (!from || !to) return undefined;
    return getFlowEdgeRoute(getPortPoint(from, edge.sourceSide), edge.sourceSide,
      getPortPoint(to, edge.targetSide), edge.targetSide, waypoints, edge.routeY);
  };

  const getRouteSnapTargets = (edgeId: string) => {
    const targets: Record<keyof FlowRoutePoint, FlowRoutePoint[]> = { x: [], y: [] };
    for (const other of config.edges) {
      if (other.id === edgeId) continue;
      const route = routeForEdge(other);
      for (const { a, b, length } of route?.segments ?? []) {
        if (length < 12) continue;
        const axis = a.x === b.x ? 'x' : 'y';
        targets[axis].push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      }
    }
    return targets;
  };

  const addWaypoint = (edge: FlowDesignerEdge, point?: FlowRoutePoint) => {
    const route = routeForEdge(edge);
    const insertion = route && insertFlowWaypoint(route, point);
    if (!insertion) return;
    patchEdge(edge.id, { waypoints: insertion.waypoints, routeY: undefined });
    setSelectedWaypoint({ edgeId: edge.id, index: insertion.index });
  };

  const removeWaypoint = (edge: FlowDesignerEdge, index: number) => {
    const waypoints = edge.waypoints?.filter((_, current) => current !== index);
    patchEdge(edge.id, { waypoints: waypoints?.length ? waypoints : undefined });
    setSelectedWaypoint(null);
  };

  const addNode = (definition: NodeDefinition, position?: { x: number; y: number }) => {
    const node = createNode(definition, fields, config.nodes.length);
    const canvas = canvasRef.current;
    if (position && canvas) {
      const snapped = snapNodePosition(position.x - NODE_WIDTH / 2, position.y - NODE_HEIGHT / 2, canvas);
      node.x = snapped.x;
      node.y = snapped.y;
    }
    const endIndex = config.nodes.findIndex((item) => item.type === 'endEvent');
    const nextNodes = endIndex >= 0 && definition.key !== 'endEvent'
      ? [...config.nodes.slice(0, endIndex), node, ...config.nodes.slice(endIndex)]
      : [...config.nodes, node];
    patchConfig({ nodes: nextNodes });
    setSelection({ type: 'node', id: node.id });
  };

  const findNodeDefinition = (key: string) => nodeGroups.flatMap((group) => group.items).find((item) => item.key === key);

  const updateMarqueeSelection = (startX: number, startY: number, currentX: number, currentY: number) => {
    const x = Math.min(startX, currentX);
    const y = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);
    setMarqueeSelection({ x, y, width, height });
    const { nodeIds, annotationIds } = getFlowMarqueeItems({ left: x, top: y, width, height }, config.nodes, savedAnnotationFrames);
    if (annotationIds.length || nodeIds.length > 1) setSelection({ type: 'multiple', nodeIds, annotationIds });
    else setSelection(nodeIds.length === 1 ? { type: 'node', id: nodeIds[0] } : { type: 'canvas' });
  };

  const startMarqueeSelection = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || pendingPort || dragRef.current || routeDragRef.current || marqueeRef.current || annotationResizeRef.current) return;
    const target = event.target as HTMLElement;
    if (target.closest('.professional-flow-node, .professional-flow-port, .professional-flow-canvas-toolbar, .professional-flow-annotation-title, .professional-flow-annotation-resize')) return;
    if (target.tagName.toLowerCase() === 'path' || target.tagName.toLowerCase() === 'text') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    event.preventDefault();
    const point = clientToCanvasPoint(canvas, event.clientX, event.clientY);
    const startX = point.x;
    const startY = point.y;
    marqueeRef.current = { pointerId: event.pointerId, startX, startY, dragging: false };
    setSelection({ type: 'canvas' });
    setMarqueeSelection(null);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveMarqueeSelection = (event: React.PointerEvent<HTMLElement>) => {
    const marquee = marqueeRef.current;
    const canvas = canvasRef.current;
    if (!marquee || marquee.pointerId !== event.pointerId || !canvas) return;
    const point = clientToCanvasPoint(canvas, event.clientX, event.clientY);
    const distance = Math.hypot(point.x - marquee.startX, point.y - marquee.startY);
    if (distance <= 4 && !marquee.dragging) return;
    marquee.dragging = true;
    suppressCanvasClickRef.current = true;
    updateMarqueeSelection(marquee.startX, marquee.startY, point.x, point.y);
  };

  const stopMarqueeSelection = (pointerId: number) => {
    const marquee = marqueeRef.current;
    if (!marquee || marquee.pointerId !== pointerId) return;
    marqueeRef.current = null;
    setMarqueeSelection(null);
    if (!marquee.dragging) return;
    window.setTimeout(() => {
      suppressCanvasClickRef.current = false;
    }, 0);
  };

  const handleCanvasDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setPaletteDragOver(false);
    const definitionKey = event.dataTransfer.getData('application/x-professional-flow-node') || event.dataTransfer.getData('text/plain');
    const definition = findNodeDefinition(definitionKey);
    const canvas = canvasRef.current;
    if (!definition || !canvas) return;
    addNode(definition, {
      ...clientToCanvasPoint(canvas, event.clientX, event.clientY),
    });
  };

  const startPalettePointerDrag = (event: React.PointerEvent<HTMLButtonElement>, definition: NodeDefinition) => {
    event.preventDefault();
    palettePointerDragRef.current = {
      definition,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      dragging: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const movePalettePointerDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = palettePointerDragRef.current;
    const canvas = canvasRef.current;
    if (!drag || !canvas) return;
    event.preventDefault();
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    if (distance > 6) drag.dragging = true;
    const rect = canvas.getBoundingClientRect();
    const inside = drag.dragging
      && event.clientX >= rect.left
      && event.clientX <= rect.right
      && event.clientY >= rect.top
      && event.clientY <= rect.bottom;
    setPaletteDragOver(inside);
    if (drag.dragging) {
      const point = clientToCanvasPoint(canvas, event.clientX, event.clientY);
      const snapped = snapNodePosition(point.x - NODE_WIDTH / 2, point.y - NODE_HEIGHT / 2, canvas);
      setPalettePreview({ label: drag.definition.label, x: snapped.x, y: snapped.y, inside });
    }
  };

  const stopPalettePointerDrag = () => {
    const drag = palettePointerDragRef.current;
    const canvas = canvasRef.current;
    palettePointerDragRef.current = null;
    setPaletteDragOver(false);
    setPalettePreview(null);
    if (!drag || !canvas || !drag.dragging) return;
    const rect = canvas.getBoundingClientRect();
    const isInside = drag.lastX >= rect.left && drag.lastX <= rect.right && drag.lastY >= rect.top && drag.lastY <= rect.bottom;
    if (!isInside) return;
    suppressPaletteClickRef.current = true;
    addNode(drag.definition, {
      ...clientToCanvasPoint(canvas, drag.lastX, drag.lastY),
    });
    window.setTimeout(() => {
      suppressPaletteClickRef.current = false;
    }, 0);
  };

  const startPaletteMouseDrag = (event: React.MouseEvent<HTMLButtonElement>, definition: NodeDefinition) => {
    event.preventDefault();
    if (!palettePointerDragRef.current) {
      palettePointerDragRef.current = {
        definition,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        dragging: false,
      };
    }

    const handleMove = (moveEvent: MouseEvent) => {
      const drag = palettePointerDragRef.current;
      const canvas = canvasRef.current;
      if (!drag || !canvas) return;
      drag.lastX = moveEvent.clientX;
      drag.lastY = moveEvent.clientY;
      const distance = Math.hypot(moveEvent.clientX - drag.startX, moveEvent.clientY - drag.startY);
      if (distance > 6) drag.dragging = true;
      const rect = canvas.getBoundingClientRect();
      const inside = drag.dragging
        && moveEvent.clientX >= rect.left
        && moveEvent.clientX <= rect.right
        && moveEvent.clientY >= rect.top
        && moveEvent.clientY <= rect.bottom;
      setPaletteDragOver(inside);
      if (drag.dragging) {
        const point = clientToCanvasPoint(canvas, moveEvent.clientX, moveEvent.clientY);
        const snapped = snapNodePosition(point.x - NODE_WIDTH / 2, point.y - NODE_HEIGHT / 2, canvas);
        setPalettePreview({ label: drag.definition.label, x: snapped.x, y: snapped.y, inside });
      }
    };

    const handleUp = () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      stopPalettePointerDrag();
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  };

  const deleteCanvasItems = (selectedIds: string[], annotationIds: ReadonlySet<string>) => {
    const nodeIds = getRemovableFlowNodeIds(config, selectedIds);
    if (!nodeIds.size && !annotationIds.size) {
      if (selectedIds.length) message.warning('流程必须保留至少一个开始事件和一个结束事件');
      return;
    }
    const nodes = nodeIds.size ? config.nodes.filter((node) => !nodeIds.has(node.id)) : config.nodes;
    const remaining = annotations.filter((annotation) => !annotationIds.has(annotation.id));
    patchConfig({
      annotations: readFlowAnnotations(remaining, nodes),
      ...(nodeIds.size && {
        nodes,
        edges: config.edges.filter((edge) => !nodeIds.has(edge.source) && !nodeIds.has(edge.target)),
        triggerBindings: config.triggerBindings.map((binding) => binding.startNodeId && nodeIds.has(binding.startNodeId)
          ? { ...binding, startNodeId: undefined } : binding),
      }),
    });
    setSelection({ type: 'canvas' });
    if (nodeIds.size < selectedIds.length) message.info('已保留必需的起止事件');
  };

  const deleteSelected = () => {
    if (selection.type !== 'edge') {
      deleteCanvasItems(selectedNodeIds, selectedAnnotationIds);
      return;
    }
    patchConfig({ edges: config.edges.filter((edge) => edge.id !== selection.id) });
    setSelection({ type: 'canvas' });
  };

  const startNodeDrag = (
    event: React.PointerEvent<HTMLElement>, node: FlowDesignerNode, nodeIds: string[],
    clickSelection: Selection, movingAnnotations: FlowAnnotation[], keepSelection: boolean,
  ) => {
    if (event.button !== 0 || dragRef.current || routeDragRef.current || annotationResizeRef.current || marqueeRef.current || pendingPort) return;
    const canvas = canvasRef.current;
    const surface = canvas?.parentElement;
    if (!canvas || !surface) return;
    event.preventDefault();
    event.stopPropagation();
    const ids = new Set([...nodeIds, ...movingAnnotations.flatMap((annotation) => annotation.nodeIds)]);
    const movingNodes = config.nodes.filter((item) => ids.has(item.id));
    const limits = getNodeBounds(canvas);
    const toolbar = movingAnnotations.length && surface.closest('.professional-flow-canvas')?.querySelector<HTMLElement>('.professional-flow-canvas-toolbar');
    const annotationMinY = toolbar ? Math.max(...movingAnnotations.map((annotation) => {
      const topNode = Math.min(...movingNodes.filter((item) => annotation.nodeIds.includes(item.id)).map((item) => item.y));
      return toolbar.offsetTop + toolbar.offsetHeight + getFlowAnnotationTitleSpace(annotation) + node.y - topNode;
    })) : -Infinity;
    // Bound the shared movement so nodes keep their spacing at the edge of the canvas.
    const bounds = {
      min: {
        x: Math.min(node.x, limits.min.x + node.x - Math.min(...movingNodes.map((item) => item.x))),
        y: Math.min(node.y, Math.max(annotationMinY, limits.min.y + node.y - Math.min(...movingNodes.map((item) => item.y)))),
      },
      max: {
        x: Math.max(node.x, limits.max.x + node.x - Math.max(...movingNodes.map((item) => item.x))),
        y: Math.max(node.y, limits.max.y + node.y - Math.max(...movingNodes.map((item) => item.y))),
      },
    };
    dragRef.current = {
      pointerId: event.pointerId,
      pointerStart: { x: event.clientX, y: event.clientY },
      pointerOrigin: clientToCanvasPoint(canvas, event.clientX, event.clientY),
      primary: node,
      clickSelection,
      moveInternalRoutes: movingAnnotations.length > 0,
      ids,
      neighbors: config.nodes.filter((item) => !ids.has(item.id)),
      bounds,
      preview: null,
    };
    if (!keepSelection) setSelection(clickSelection);
    surface.setPointerCapture(event.pointerId);
  };

  const startDrag = (event: React.PointerEvent<HTMLDivElement>, node: FlowDesignerNode) => {
    if ((event.target as HTMLElement).closest('.professional-flow-port')) return;
    const group = selection.type === 'multiple' && selectedNodeIdSet.has(node.id);
    const movingAnnotations = group ? annotations.filter((annotation) => selectedAnnotationIds.has(annotation.id)) : [];
    startNodeDrag(event, node, group ? selectedNodeIds : [node.id], { type: 'node', id: node.id }, movingAnnotations, group);
  };

  const startAnnotationDrag = (event: React.PointerEvent<HTMLDivElement>, annotation: FlowAnnotation) => {
    if (event.shiftKey || (event.target as HTMLElement).closest('.professional-flow-annotation-resize')) return;
    const primary = config.nodes.find((node) => annotation.nodeIds.includes(node.id));
    if (!primary) return;
    const group = selection.type === 'multiple' && selectedAnnotationIds.has(annotation.id);
    const movingAnnotations = group ? annotations.filter((item) => selectedAnnotationIds.has(item.id)) : [annotation];
    startNodeDrag(event, primary, group ? selectedNodeIds : annotation.nodeIds, { type: 'annotation', id: annotation.id }, movingAnnotations, group);
  };

  const moveDrag = (event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    const canvas = canvasRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !canvas) return;
    if (!drag.preview && Math.hypot(event.clientX - drag.pointerStart.x, event.clientY - drag.pointerStart.y) < 4) return;
    const pointer = clientToCanvasPoint(canvas, event.clientX, event.clientY);
    const { scaleX, scaleY } = getCanvasScale(canvas);
    const proposed = {
      x: drag.primary.x + pointer.x - drag.pointerOrigin.x,
      y: drag.primary.y + pointer.y - drag.pointerOrigin.y,
    };
    drag.preview = snapFlowNode(proposed, drag.bounds, drag.neighbors, { x: scaleX, y: scaleY });
    setDragPreview(drag.preview);
  };

  const startRouteDrag = (
    event: React.PointerEvent<SVGElement>,
    edge: FlowDesignerEdge,
    move: NonNullable<typeof routeDragRef.current>['move'],
  ) => {
    const canvas = canvasRef.current;
    if (!canvas || event.button !== 0 || pendingPort || dragRef.current || routeDragRef.current || annotationResizeRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus({ preventScroll: true });
    routeDragRef.current = {
      edgeId: edge.id,
      pointerId: event.pointerId,
      pointerStart: { x: event.clientX, y: event.clientY },
      pointerOrigin: clientToCanvasPoint(canvas, event.clientX, event.clientY),
      move,
      preview: null,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const startSegmentDrag = (
    event: React.PointerEvent<SVGElement>, edge: FlowDesignerEdge, route: ReturnType<typeof getFlowEdgeRoute>, anchor?: FlowRoutePoint,
  ) => {
    const canvas = canvasRef.current;
    if (!canvas || event.button !== 0) return;
    const segment = getFlowSegmentDrag(route, anchor ?? clientToCanvasPoint(canvas, event.clientX, event.clientY));
    if (!segment) return;
    const { axis, origin } = segment;
    const targets = getRouteSnapTargets(edge.id)[axis];
    startRouteDrag(event, edge, (delta, surface) => {
      if (Math.abs(delta[axis]) < 1) return null;
      const { scaleX, scaleY } = getCanvasScale(surface);
      const proposed = { ...origin, [axis]: origin[axis] + delta[axis] };
      const { value, target } = snapFlowAxis(axis, proposed, {
        min: { x: 8, y: 8 },
        max: { x: surface.clientWidth - 8, y: surface.clientHeight - 8 },
      }, targets, axis === 'x' ? scaleX : scaleY);
      if (value === origin[axis]) return null;
      const point = { ...origin, [axis]: value };
      return { waypoints: segment.move(value), snap: { point, alignX: axis === 'x' ? target : undefined, alignY: axis === 'y' ? target : undefined } };
    });
    setSelection({ type: 'edge', id: edge.id });
    setSelectedWaypoint(null);
  };

  const startWaypointDrag = (event: React.PointerEvent<SVGCircleElement>, edge: FlowDesignerEdge, index: number, origin: FlowRoutePoint) => {
    if (!edge.waypoints) return;
    const points = edge.waypoints;
    const targets = getRouteSnapTargets(edge.id);
    startRouteDrag(event, edge, (delta, canvas) => {
      if (Math.hypot(delta.x, delta.y) < 1) return null;
      const proposed = { x: origin.x + delta.x, y: origin.y + delta.y };
      const bounds = {
        min: { x: 8, y: 8 },
        max: { x: canvas.clientWidth - 8, y: canvas.clientHeight - 8 },
      };
      const { scaleX, scaleY } = getCanvasScale(canvas);
      const x = snapFlowAxis('x', proposed, bounds, targets.x, scaleX);
      const y = snapFlowAxis('y', proposed, bounds, targets.y, scaleY);
      const point = { x: x.value, y: y.value };
      if (point.x === origin.x && point.y === origin.y) return null;
      return { waypoints: points.map((item, current) => current === index ? point : item), snap: { point, alignX: x.target, alignY: y.target } };
    });
    setSelectedWaypoint({ edgeId: edge.id, index });
  };

  const moveRouteDrag = (event: React.PointerEvent<HTMLElement>) => {
    const drag = routeDragRef.current;
    const canvas = canvasRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !canvas) return;
    if (!drag.preview && Math.hypot(event.clientX - drag.pointerStart.x, event.clientY - drag.pointerStart.y) < 4) return;
    event.preventDefault();
    const pointer = clientToCanvasPoint(canvas, event.clientX, event.clientY);
    drag.preview = drag.move({ x: pointer.x - drag.pointerOrigin.x, y: pointer.y - drag.pointerOrigin.y }, canvas);
    setRoutePreview(drag.preview);
  };

  const updateConnectionPreview = (event: React.PointerEvent<HTMLElement>) => {
    if (!pendingPort || dragRef.current || routeDragRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    setConnectionPreview(clientToCanvasPoint(canvas, event.clientX, event.clientY));
  };

  const moveDragSelection = (drag: NonNullable<typeof dragRef.current>, point: FlowRoutePoint) => {
    const delta = { x: point.x - drag.primary.x, y: point.y - drag.primary.y };
    return {
      nodes: config.nodes.map((node) => drag.ids.has(node.id) ? { ...node, x: node.x + delta.x, y: node.y + delta.y } : node),
      edges: drag.moveInternalRoutes ? translateAnnotationRoutes(config.edges, drag.ids, delta) : config.edges,
    };
  };

  const stopDrag = (commit: boolean, pointerId?: number) => {
    const drag = dragRef.current;
    if (!drag || (pointerId !== undefined && drag.pointerId !== pointerId)) return;
    dragRef.current = null;
    setDragPreview(null);
    if (!commit) return;
    suppressCanvasClickRef.current = true;
    window.setTimeout(() => { suppressCanvasClickRef.current = false; }, 0);
    if (!drag.preview) {
      setSelection(drag.clickSelection);
      return;
    }
    const { point } = drag.preview;
    if (point.x !== drag.primary.x || point.y !== drag.primary.y) {
      patchConfig(moveDragSelection(drag, point));
    }
  };

  const stopRouteDrag = (commit: boolean, pointerId?: number) => {
    const drag = routeDragRef.current;
    if (!drag || (pointerId !== undefined && drag.pointerId !== pointerId)) return;
    routeDragRef.current = null;
    setRoutePreview(null);
    if (commit && drag.preview) {
      suppressCanvasClickRef.current = true;
      window.setTimeout(() => { suppressCanvasClickRef.current = false; }, 0);
      patchEdge(drag.edgeId, { waypoints: drag.preview.waypoints, routeY: undefined });
    }
  };

  const undo = () => {
    const previous = history[history.length - 1];
    if (!previous) return;
    setHistory((items) => items.slice(0, -1));
    setFuture((items) => [cloneFlowConfig(config), ...items.slice(0, 29)]);
    onChange(previous);
    setSelection({ type: 'canvas' });
    setPendingPort(null);
  };

  const redo = () => {
    const next = future[0];
    if (!next) return;
    setFuture((items) => items.slice(1));
    setHistory((items) => [...items.slice(-29), cloneFlowConfig(config)]);
    onChange(next);
    setSelection({ type: 'canvas' });
    setPendingPort(null);
  };

  const copySelected = () => {
    const graph = copyFlowSelection(config, selectedNodeIdSet, selectedAnnotationIds);
    if (!graph.nodes.length) return;
    setClipboard({ graph, pasteCount: 0 });
    const copiedAnnotations = graph.annotations.length ? `、${graph.annotations.length} 个注释` : '';
    message.success(`已复制 ${graph.nodes.length} 个节点${copiedAnnotations}`);
  };

  const insertCopiedSelection = (graph: FlowClipboard, pasteCount: number) => {
    const anchor = { x: Math.min(...graph.nodes.map((node) => node.x)), y: Math.min(...graph.nodes.map((node) => node.y)) };
    const frames = getFlowAnnotationFrames(graph.annotations, graph.nodes);
    const left = Math.min(anchor.x, ...frames.map(({ bounds }) => bounds.left));
    const right = Math.max(...graph.nodes.map((node) => node.x + NODE_WIDTH), ...frames.map(({ bounds }) => bounds.left + bounds.width));
    // Keep copied annotations side by side so neither title sits under the other group's nodes.
    const offset = (frames.length ? right - left + SNAP_GRID : SNAP_GRID * 2) * pasteCount;
    const { point } = snapFlowNode({ x: anchor.x + offset, y: anchor.y + offset }, {
      min: { x: SNAP_ORIGIN_X, y: SNAP_ORIGIN_Y },
      max: { x: Infinity, y: Infinity },
    });
    const pasted = cloneFlowSelection(graph, { x: point.x - anchor.x, y: frames.length ? 0 : point.y - anchor.y }, makeId);
    const nodeIds = pasted.nodes.map((node) => node.id);
    const annotationIds = pasted.annotations.map((annotation) => annotation.id);
    pastedAnnotationRef.current = annotationIds[0] ?? null;
    patchConfig({
      nodes: [...config.nodes, ...pasted.nodes],
      edges: [...config.edges, ...pasted.edges],
      ...(pasted.annotations.length && { annotations: [...annotations, ...pasted.annotations] }),
    });
    setSelection(annotationIds.length || nodeIds.length > 1
      ? { type: 'multiple', nodeIds, annotationIds }
      : { type: 'node', id: nodeIds[0] });
    setClipboard({ graph, pasteCount });
  };

  const pasteSelection = () => {
    if (clipboard) insertCopiedSelection(clipboard.graph, clipboard.pasteCount + 1);
  };

  const duplicateSelected = () => {
    const graph = copyFlowSelection(config, selectedNodeIdSet, selectedAnnotationIds);
    if (graph.nodes.length) insertCopiedSelection(graph, 1);
  };

  const connectPendingPortTo = (targetNode: FlowDesignerNode, targetSide: FlowPortSide) => {
    if (!pendingPort) return;
    const duplicateEdge = config.edges.some((edge) => edge.source === pendingPort.nodeId && edge.target === targetNode.id);
    if (duplicateEdge || pendingPort.nodeId === targetNode.id) {
      setPendingPort(null);
      setConnectionPreview(null);
      return;
    }
    const sourceNode = config.nodes.find((item) => item.id === pendingPort.nodeId);
    const approvalOutcome = approvalTaskTypes.has(sourceNode?.type ?? '')
      ? config.edges.some((edge) => edge.source === pendingPort.nodeId && edge.approvalOutcome !== 'reject') ? 'reject' : 'approve'
      : undefined;
    const newEdge: FlowDesignerEdge = {
      id: makeId('edge'),
      source: pendingPort.nodeId,
      sourceSide: pendingPort.side,
      target: targetNode.id,
      targetSide,
      label: approvalOutcome ? approvalOutcomeLabels[approvalOutcome] : sourceNode?.type === 'startEvent' ? '提交' : '',
      ...(approvalOutcome && { approvalOutcome }),
      priority: config.edges.length + 1,
      isDefault: sourceNode?.category !== 'gateway',
    };
    patchConfig({ edges: [...config.edges, newEdge] });
    setPendingPort(null);
    setConnectionPreview(null);
    setSelection({ type: 'edge', id: newEdge.id });
  };

  const handlePortClick = (event: React.MouseEvent<HTMLElement>, node: FlowDesignerNode, side: FlowPortSide) => {
    event.stopPropagation();
    if (!pendingPort) {
      setPendingPort({ nodeId: node.id, side });
      setConnectionPreview(getPortPoint(node, side));
      return;
    }
    if (pendingPort.nodeId === node.id && pendingPort.side === side) {
      setPendingPort(null);
      setConnectionPreview(null);
      return;
    }
    connectPendingPortTo(node, side);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const key = event.key.toLowerCase();
      const command = event.ctrlKey || event.metaKey;
      if (key === 'delete' || key === 'backspace') {
        event.preventDefault();
        deleteSelected();
        return;
      }
      if (command && key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
        return;
      }
      if ((command && key === 'y') || (command && event.shiftKey && key === 'z')) {
        event.preventDefault();
        redo();
        return;
      }
      if (command && key === 'c' && canCopySelection) {
        event.preventDefault();
        copySelected();
        return;
      }
      if (command && key === 'v' && clipboard) {
        event.preventDefault();
        pasteSelection();
        return;
      }
      if (command && key === 'd' && canCopySelection) {
        event.preventDefault();
        duplicateSelected();
        return;
      }
      if (key === 'escape') {
        stopDrag(false);
        stopRouteDrag(false);
        stopAnnotationResize(false);
        setPendingPort(null);
        setConnectionPreview(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [clipboard, config, future, history, selection]);

  useEffect(() => {
    if (!pendingPort) return undefined;
    const handlePointerMove = (event: PointerEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      setConnectionPreview(clientToCanvasPoint(canvas, event.clientX, event.clientY));
    };
    window.addEventListener('pointermove', handlePointerMove);
    return () => window.removeEventListener('pointermove', handlePointerMove);
  }, [pendingPort]);

  const updateFieldPermission = (fieldKey: string, key: 'visible' | 'editable' | 'required', value: boolean) => {
    if (!selectedNode) return;
    const next = normalizeNodeFieldPermissions({ [fieldKey]: {
      visible: true, editable: false, required: false,
      ...(selectedNode.fieldPermissions?.[fieldKey] || {}), [key]: value,
    } });
    patchNode(selectedNode.id, { fieldPermissions: { ...(selectedNode.fieldPermissions || {}), ...next } });
  };

  const renderNodeProperties = () => {
    if (!selectedNode) return null;
    const isApproval = approvalTaskTypes.has(selectedNode.type);
    const rejectionTargets = isApproval ? approvalRejectionTargets(config, selectedNode.id) : undefined;
    const outcomeEdges = isApproval ? config.edges.filter((edge) => edge.source === selectedNode.id) : [];
    const hasApprovalPath = outcomeEdges.some((edge) => edge.approvalOutcome !== 'reject');
    const linkedRejectionEdge = outcomeEdges.find((edge) => edge.approvalOutcome === 'reject');
    const linkedRejectionTarget = config.nodes.find((node) => node.id === linkedRejectionEdge?.target);
    const savedNextTarget = rejectionTargets?.next.find((node) => node.id === selectedNode.rejectionTargetId);
    const customTargetInvalid = selectedNode.rejectionTargetId && !savedNextTarget &&
      !rejectionTargets?.previous.some((node) => node.id === selectedNode.rejectionTargetId);
    const fieldOptions = fields.map((field) => ({ value: field.key, label: field.name }));
    const selectedNodeTypeLabel = getNodeTypeLabel(selectedNode);
    const ccRecipients = selectedNode.ccRecipients ?? [];
    const ccRoleOptions = roleOptions?.length ? roleOptions : roles.map((role) => ({ value: role, label: role }));
    const patchCcRecipients = (next: FlowCcRecipient[]) => patchNode(selectedNode.id, { ccRecipients: next });
    const assigneeRules = selectedNode.assigneeRules?.length
      ? selectedNode.assigneeRules
      : approvalTaskTypes.has(selectedNode.type) && selectedNode.assigneeSource
        ? [{ id: 'legacy-assignee', type: selectedNode.assigneeSource === 'fixed' ? 'user' : selectedNode.assigneeSource as AssigneeTargetType, value: selectedNode.assigneeValue }]
        : [];
    const patchAssigneeRules = (nextRules: FlowAssigneeRule[]) => {
      const firstRule = nextRules[0];
      patchNode(selectedNode.id, {
        assigneeRules: nextRules.map((rule) => ({ ...rule, approvalMode: rule.approvalMode || selectedNode.approvalMode || 'single' })),
        assigneeSource: firstRule ? (firstRule.type === 'user' ? 'fixed' : firstRule.type as AssigneeSource) : undefined,
        assigneeValue: firstRule?.value,
      });
    };
    const renderAssigneeValueControl = (rule: FlowAssigneeRule) => {
      if (rule.type === 'departmentOwner' || rule.type === 'initiatorManager') {
        return <Input value="由流程运行时自动解析" readOnly />;
      }
      if (rule.type === 'field') {
        return (
          <Select
            placeholder="选择人员/组织字段"
            value={rule.value}
            options={fieldOptions}
            onChange={(value) => patchAssigneeRules(assigneeRules.map((item) => (item.id === rule.id ? { ...item, value } : item)))}
          />
        );
      }
      if (rule.type === 'user') {
        return <Select showSearch optionFilterProp="label" placeholder="选择审批用户" value={rule.value}
          options={users} onChange={(value) => patchAssigneeRules(assigneeRules.map((item) => item.id === rule.id ? { ...item, value } : item))} />;
      }
      if (rule.type === 'role') {
        return (
          <Select
            placeholder="选择角色"
            value={rule.value}
            options={roleOptions?.length ? roleOptions : roles.map((role) => ({ value: role, label: role }))}
            onChange={(value) => patchAssigneeRules(assigneeRules.map((item) => (item.id === rule.id ? { ...item, value } : item)))}
          />
        );
      }
      return (
        <Input
          placeholder={rule.type === 'organization' ? '输入组织/部门' : '输入用户账号或姓名'}
          value={rule.value}
          onChange={(event) => patchAssigneeRules(assigneeRules.map((item) => (item.id === rule.id ? { ...item, value: event.target.value } : item)))}
        />
      );
    };
    const externalAction = selectedNode.externalAction || { enabled: false, action: 'api' as const, fieldMappings: [] };
    const patchExternalAction = (patch: Partial<FlowExternalAction>) => {
      const nextExternalAction: FlowExternalAction = {
        enabled: patch.enabled ?? externalAction.enabled ?? false,
        action: patch.action ?? externalAction.action ?? 'api',
        system: patch.system ?? externalAction.system,
        targetFormId: patch.targetFormId ?? externalAction.targetFormId,
        endpoint: patch.endpoint ?? externalAction.endpoint,
        fieldMappings: patch.fieldMappings ?? externalAction.fieldMappings ?? [],
      };
      patchNode(selectedNode.id, {
        externalAction: nextExternalAction,
      });
    };
    return (
      <div className="professional-flow-props">
        <PropertyGroup title="节点身份">

          <PropertyRow label="节点类型"><Input aria-label="节点类型" value={selectedNodeTypeLabel} readOnly /></PropertyRow>
          <PropertyRow label="标题"><Input aria-label="节点标题" placeholder="输入节点标题" maxLength={100} value={selectedNode.label} onChange={event=>patchNode(selectedNode.id,{label:event.target.value})}/></PropertyRow>
          <PropertyRow label="业务说明"><Input.TextArea aria-label="节点业务说明" placeholder="说明此节点的业务用途" maxLength={500} autoSize={{minRows:2,maxRows:5}} value={selectedNode.description} onChange={event=>patchNode(selectedNode.id,{description:event.target.value})}/></PropertyRow>
        </PropertyGroup>

        {selectedNode.type === 'startEvent' && (
          <PropertyGroup title="触发动作" hint="每个动作只绑定一个开始节点。在这里开启已绑定的动作，会将入口切换到当前节点。">
            {config.triggerBindings.filter((binding) => binding.action !== 'approve' || binding.enabled).map((binding) => {
              const startId = workflowTriggerStartId(binding, startNodes);
              const otherStart = startId && startId !== selectedNode.id ? startNodes.find((node) => node.id === startId) : undefined;
              return (
                <div className="professional-flow-trigger" key={binding.action}>
                  <Switch aria-label={`启用${binding.label || binding.action}`}
                    checked={startId === selectedNode.id}
                    onChange={(enabled) => patchConfig({
                      triggerBindings: setWorkflowStartTrigger(config, binding.action, selectedNode.id, enabled),
                    })}
                  />
                  <Input aria-label={`${binding.action} 触发动作名称`}
                    value={binding.label}
                    readOnly={Boolean(otherStart)}
                    onChange={(event) => patchConfig({
                      triggerBindings: config.triggerBindings.map((item) => item.action === binding.action
                        ? { ...item, label: event.target.value } : item),
                    })}
                  />
                  <Tag>{binding.action}</Tag>
                  {otherStart && <small className="professional-flow-trigger-entry">当前入口：{otherStart.label}</small>}
                </div>
              );
            })}
          </PropertyGroup>
        )}

        {rejectionTargets && (
          <PropertyGroup title="同意与驳回" hint="默认沿本次进入的路线退到上一个审批节点。退到开始事件时，交回发起人。">
            <PropertyRow label="同意后">
              <Input aria-label="同意后" value={hasApprovalPath ? '沿通过连线继续' : '未连接通过路线'} readOnly />
            </PropertyRow>
            <PropertyRow label="驳回到">
              <Select
                aria-label="驳回到"
                value={selectedNode.rejectionTargetId || ''}
                status={customTargetInvalid ? 'error' : undefined}
                options={[
                  { value: '', label: linkedRejectionTarget ? `沿驳回线到 ${linkedRejectionTarget.label}` : '沿来路退回（默认）' },
                  ...(rejectionTargets.previous.length ? [{ label: '前置节点', options: rejectionTargets.previous.map((node) => ({ value: node.id, label: node.label })) }] : []),
                  ...(savedNextTarget ? [{ value: savedNextTarget.id, label: savedNextTarget.label }] : []),
                  ...(customTargetInvalid ? [{ value: selectedNode.rejectionTargetId, label: '原目标已断开，请重新选择', disabled: true }] : []),
                ]}
                onChange={(value) => patchNode(selectedNode.id, { rejectionTargetId: value || undefined })}
              />
            </PropertyRow>
          </PropertyGroup>
        )}

        {selectedNode.type === 'ccTask' && (
          <PropertyGroup title="抄送对象" hint="流程到达此节点时发出站内通知，抄送人无需审批。" actions={ccRecipients.length > 0 && (
            <Button aria-label="添加抄送对象" title="添加抄送对象" icon={<PlusOutlined />} size="small" type="text"
              onClick={() => patchCcRecipients([...ccRecipients, { id: makeId('cc'), type: 'user' }])} />
          )}>
            {ccRecipients.length === 0 ? (
              <div className="professional-flow-property-actions">
                <Button size="small" icon={<PlusOutlined />}
                  onClick={() => patchCcRecipients([{ id: makeId('cc'), type: 'user' }])}>添加用户或角色</Button>
              </div>
            ) : (
              <>
                <div className="professional-flow-assignee-head professional-flow-cc-row"><span>类型</span><span>收件人</span><span /></div>
                <div className="professional-flow-assignee-list">
                  {ccRecipients.map((recipient, index) => (
                    <div className="professional-flow-assignee-rule professional-flow-cc-row" key={recipient.id}>
                      <Select<FlowCcRecipient['type']>
                        aria-label={`抄送对象 ${index + 1} 的类型`}
                        value={recipient.type}
                        options={ccRecipientTypeOptions}
                        onChange={(type) => patchCcRecipients(ccRecipients.map((item) =>
                          item.id === recipient.id ? { ...item, type, value: undefined } : item))}
                      />
                      <Select showSearch optionFilterProp="label"
                        aria-label={`抄送对象 ${index + 1} 的收件人`}
                        placeholder={recipient.type === 'role' ? '选择角色' : '选择用户'}
                        value={recipient.value}
                        options={recipient.type === 'role' ? ccRoleOptions : users}
                        onChange={(value) => patchCcRecipients(ccRecipients.map((item) =>
                          item.id === recipient.id ? { ...item, value } : item))}
                      />
                      <Button aria-label={`删除抄送对象 ${index + 1}`} icon={<DeleteOutlined />} size="small" type="text"
                        onClick={() => patchCcRecipients(ccRecipients.filter((item) => item.id !== recipient.id))} />
                    </div>
                  ))}
                </div>
              </>
            )}
          </PropertyGroup>
        )}

        {approvalTaskTypes.has(selectedNode.type) && (
          <PropertyGroup title="处理人规则" actions={<> <Button aria-label="添加处理对象" title="添加处理对象" icon={<PlusOutlined />} size="small" type="text"
                onClick={() => patchAssigneeRules([...assigneeRules, { id: makeId('assignee'), type: 'role', approvalMode: 'orSign' }])} /> </>}>

            <div className="professional-flow-assignee-head"><span>对象类型</span><span>处理对象</span><span>审批方式</span><span /></div>
            <div className="professional-flow-assignee-list">
              {assigneeRules.map((rule) => (
                <div className="professional-flow-assignee-rule" key={rule.id}>
                  <Select
                    value={rule.type}
                    options={assigneeTargetTypeOptions}
                    onChange={(type) => patchAssigneeRules(assigneeRules.map((item) => (
                      item.id === rule.id
                        ? { ...item, type, value: type === 'departmentOwner' || type === 'initiatorManager' ? undefined : item.value }
                        : item
                    )))}
                  />
                  {renderAssigneeValueControl(rule)}
                  <Select aria-label={`处理对象 ${assigneeRules.indexOf(rule) + 1} 审批方式`}
                    value={rule.approvalMode || selectedNode.approvalMode || 'single'} options={approvalModeOptions}
                    onChange={(approvalMode) => patchAssigneeRules(assigneeRules.map((item) => item.id === rule.id ? { ...item, approvalMode } : item))} />
                  <Button
                    aria-label="删除处理对象"
                    disabled={assigneeRules.length <= 1}
                    icon={<DeleteOutlined />}
                    size="small"
                    type="text"
                    onClick={() => patchAssigneeRules(assigneeRules.filter((item) => item.id !== rule.id))}
                  />
                </div>
              ))}
            </div>
          </PropertyGroup>
        )}

        {selectedNode.type === 'serviceTask' && (
          <PropertyGroup title="数据下发" hint="流程经过此自动任务后异步执行。站内表单创建草稿；API/Webhook 使用 POST 并携带幂等键，失败可在实例下发记录中重试。">

            <PropertyRow label="启用下发"><Switch size="small" checked={externalAction.enabled} onChange={(enabled) => patchExternalAction({ enabled })} /></PropertyRow>

            <PropertyRow label="推送方式"><Select value={externalAction.action || 'api'} options={externalActionTypeOptions} onChange={(action) => patchExternalAction({ action })} /></PropertyRow>
            {externalAction.action==='form'?<PropertyRow label="目标表单"><Select aria-label="下发目标表单" showSearch optionFilterProp="label" placeholder="选择已发布表单" value={externalAction.targetFormId} options={dispatchForms.map(form=>({value:form.id,label:form.name}))} onChange={targetFormId=>patchExternalAction({targetFormId,fieldMappings:(externalAction.fieldMappings||[]).map(item=>({...item,targetField:undefined}))})}/></PropertyRow>:<><PropertyRow label="目标系统"><Input placeholder="例如 ERP / MES / WMS" value={externalAction.system} onChange={event=>patchExternalAction({system:event.target.value})}/></PropertyRow><PropertyRow label="接口地址"><Input placeholder="https://example.com/api/receive" value={externalAction.endpoint} onChange={event=>patchExternalAction({endpoint:event.target.value})}/></PropertyRow></>}
            {dispatchLoadError&&<Typography.Text type="danger">{dispatchLoadError}</Typography.Text>}
            <div className="professional-flow-mapping-list">
              <div className="professional-flow-mapping-head"><span>表单字段</span><span>{externalAction.action==='form'?'目标字段':'外部字段'}</span><span /></div>
              {(externalAction.fieldMappings || []).map((mapping) => (
                <div className="professional-flow-mapping-row" key={mapping.id}>
                  <Select
                    placeholder="选择字段"
                    value={mapping.sourceField}
                    options={fieldOptions}
                    onChange={(sourceField) => patchExternalAction({
                      fieldMappings: (externalAction.fieldMappings || []).map((item) => (item.id === mapping.id ? { ...item, sourceField } : item)),
                    })}
                  />
                  {externalAction.action==='form'?<Select aria-label="下发目标字段" placeholder="选择目标字段" value={mapping.targetField} options={dispatchFields.map(field=>({value:field.field_name,label:field.label}))} onChange={targetField=>patchExternalAction({fieldMappings:(externalAction.fieldMappings||[]).map(item=>item.id===mapping.id?{...item,targetField}:item)})}/>:<Input placeholder="外部字段名" value={mapping.targetField} onChange={event=>patchExternalAction({fieldMappings:(externalAction.fieldMappings||[]).map(item=>item.id===mapping.id?{...item,targetField:event.target.value}:item)})}/>}
                  <Button
                    aria-label="删除字段映射"
                    icon={<DeleteOutlined />}
                    size="small"
                    type="text"
                    onClick={() => patchExternalAction({ fieldMappings: (externalAction.fieldMappings || []).filter((item) => item.id !== mapping.id) })}
                  />
                </div>
              ))}
              <Button
                size="small"
                type="dashed"
                onClick={() => patchExternalAction({ fieldMappings: [...(externalAction.fieldMappings || []), { id: makeId('mapping') }] })}
              >
                添加字段映射
              </Button>
            </div>
          </PropertyGroup>
        )}

        {approvalTaskTypes.has(selectedNode.type) && <PropertyGroup title="节点字段权限" defaultOpen={false}>

          <div className="professional-flow-field-matrix">
            <div className="professional-flow-field-head"><span>字段</span><span>可见</span><span>可填</span><span>必填</span></div>
            {fields.map((field) => {
              const permission = normalizeNodeFieldPermissions(selectedNode.fieldPermissions)[field.key] || { visible: true, editable: false, required: false };
              return (
                <div className="professional-flow-field-row" key={field.key}>
                  <span>{field.name}</span>
                  <Switch aria-label={`${field.name}可见`} size="small" checked={permission.visible} onChange={(checked) => updateFieldPermission(field.key, 'visible', checked)} />
                  <Switch aria-label={`${field.name}可填`} size="small" checked={permission.editable} onChange={(checked) => updateFieldPermission(field.key, 'editable', checked)} />
                  <Switch aria-label={`${field.name}必填`} size="small" disabled={!permission.editable} checked={permission.required} onChange={(checked) => updateFieldPermission(field.key, 'required', checked)} />
                </div>
              );
            })}
          </div>
        </PropertyGroup>}

      </div>
    );
  };

  const renderEdgeProperties = () => {
    if (!selectedEdge) return null;
    const conditionNeedsValue = !edgeConditionOperatorsWithoutValue.has(selectedEdge.conditionOperator || 'eq');
    const selectedConditionField = fields.find((field) => field.key === selectedEdge.conditionField);
    const selectedConditionOperator = edgeConditionOperatorOptions.find((option) => option.value === (selectedEdge.conditionOperator || 'eq'));
    const conditionSummary = selectedEdge.conditionField
      ? `当 ${selectedConditionField?.name || selectedEdge.conditionField} ${selectedConditionOperator?.label || ''}${conditionNeedsValue ? ` ${selectedEdge.conditionValue || '...'}` : ''} 时通过`
      : selectedEdge.condition
        ? '已配置自定义条件'
        : '未设置条件规则';
    const updateEdgeCondition = (patch: Partial<FlowDesignerEdge>) => {
      const next = { ...selectedEdge, ...patch };
      patchEdge(selectedEdge.id, {
        ...patch,
        ...(next.conditionField && { isDefault: false }),
        condition: buildEdgeConditionExpression(next.conditionField, next.conditionOperator || 'eq', next.conditionValue),
      });
    };
    const clearEdgeCondition = () => patchEdge(selectedEdge.id, {
      condition: undefined,
      conditionField: undefined,
      conditionOperator: undefined,
      conditionValue: undefined,
    });
    return (
      <div className="professional-flow-props">
        <PropertyGroup title="连线规则">

          {isSelectedEdgeFromApproval && (
            <PropertyRow label="审批结果">
              <Select
                aria-label="审批结果"
                value={selectedEdge.approvalOutcome || 'approve'}
                options={[
                  { value: 'approve', label: '审批通过' },
                  { value: 'reject', label: '审批驳回' },
                ]}
                onChange={(approvalOutcome: NonNullable<FlowDesignerEdge['approvalOutcome']>) => {
                  const label = selectedEdge.label;
                  patchEdge(selectedEdge.id, {
                    approvalOutcome,
                    label: !label || label === '通过' || label === '驳回' ? approvalOutcomeLabels[approvalOutcome] : label,
                  });
                }}
              />
            </PropertyRow>
          )}
          <PropertyRow label="连线名称">
            <Input aria-label="连线名称" value={selectedEdge.label} onChange={(event) => patchEdge(selectedEdge.id, { label: event.target.value })} />
          </PropertyRow>
          <PropertyRow label="条件规则">
            <div className="designer-rule-toggle professional-flow-edge-rule-toggle" data-rule-title="条件规则" title={conditionSummary} onClick={(event) => event.stopPropagation()}>
              <small>{conditionSummary}</small>
              <Button
                className="designer-rule-config-button"
                data-rule-action="config"
                icon={<SettingOutlined />}
                size="small"
                type="text"
                onMouseDownCapture={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setConditionModalOpen(true);
                }}
                aria-label="设置条件规则"
                title="设置条件规则"
              />
            </div>
          </PropertyRow>
          <PropertyRow label="优先级"><InputNumber min={1} value={selectedEdge.priority} onChange={(value) => patchEdge(selectedEdge.id, { priority: Number(value || 1) })} /></PropertyRow>
          {isSelectedEdgeFromBranch && <PropertyRow label="默认路径">
            <Switch
              size="small"
              checked={Boolean(selectedEdge.isDefault)}
              onChange={(checked) => patchEdge(selectedEdge.id, { isDefault: checked })}
            />
          </PropertyRow>}
        </PropertyGroup>
        <PropertyGroup title="连线路径">
          <div className="professional-flow-property-actions">
            <Button size="small" icon={<PlusOutlined />} onClick={() => addWaypoint(selectedEdge)}>添加拐点</Button>
            <Button size="small" disabled={selectedWaypoint?.edgeId !== selectedEdge.id}
              onClick={() => selectedWaypoint && removeWaypoint(selectedEdge, selectedWaypoint.index)}>删除拐点</Button>
            <Button size="small" type="text" disabled={!selectedEdge.waypoints?.length && selectedEdge.routeY === undefined}
              onClick={() => {
                patchEdge(selectedEdge.id, { waypoints: undefined, routeY: undefined });
                setSelectedWaypoint(null);
              }}>重置</Button>
          </div>
        </PropertyGroup>
        <Modal
          className="form-designer-dialog"
          title="设置条件规则"
          open={conditionModalOpen}
          onCancel={() => setConditionModalOpen(false)}
          footer={[
            <Button key="clear" disabled={!selectedEdge.conditionField && !selectedEdge.condition} onClick={clearEdgeCondition}>清空规则</Button>,
            <Button key="done" type="primary" onClick={() => setConditionModalOpen(false)}>完成</Button>,
          ]}
          width={560}
        >
          <div className="professional-flow-condition-modal">
            <div className="professional-flow-condition-card">
              <div className="professional-flow-condition-head">
                <strong>字段条件</strong>
                <span>按照当前表单字段设置连线通过条件</span>
              </div>
              <div className="professional-flow-condition-sentence">
                <span>当</span>
                <Select
                  allowClear
                  placeholder="选择表单字段"
                  value={selectedEdge.conditionField}
                  options={fields.map((field) => ({ value: field.key, label: field.name }))}
                  onChange={(value) => updateEdgeCondition({ conditionField: value, conditionOperator: selectedEdge.conditionOperator || 'eq', conditionValue: undefined })}
                />
                <span>满足</span>
                <Select
                  placeholder="选择条件"
                  value={selectedEdge.conditionOperator || 'eq'}
                  options={edgeConditionOperatorOptions}
                  onChange={(value) => updateEdgeCondition({ conditionOperator: value, conditionValue: edgeConditionOperatorsWithoutValue.has(value) ? undefined : selectedEdge.conditionValue })}
                />
                {conditionNeedsValue && (
                  <>
                    <span>值为</span>
                    <Input
                      placeholder="输入或选择值"
                      value={selectedEdge.conditionValue}
                      onChange={(event) => updateEdgeCondition({ conditionValue: event.target.value })}
                    />
                  </>
                )}
                <span>时通过这条连线</span>
              </div>
            </div>
          </div>
        </Modal>
      </div>
    );
  };

  const renderCanvasProperties = () => (
    <div className="professional-flow-props">
      <PropertyGroup title="流程属性">
        <PropertyRow label="流程名称">
          <Input aria-label="流程名称" value={config.name} readOnly />
        </PropertyRow>
      </PropertyGroup>
    </div>
  );

  const renderProperties = () => {
    if (selection.type === 'node') return renderNodeProperties();
    if (selection.type === 'edge') return renderEdgeProperties();
    if (selectedAnnotation) {
      return <FlowAnnotationProperties annotation={selectedAnnotation} onCopy={copySelected} onDelete={deleteSelected}
        onChange={(patch) => patchAnnotation(selectedAnnotation.id, patch)} />;
    }
    if (selection.type === 'multiple') {
      const counts = [
        selection.nodeIds.length && `${selection.nodeIds.length} 个节点`,
        selection.annotationIds.length && `${selection.annotationIds.length} 个注释`,
      ].filter(Boolean).join('、');
      return (
        <div className="professional-flow-props">
          <PropertyGroup title={`已选 ${counts}`}>
            <div className="professional-flow-property-actions">
              <Button size="small" icon={<CopyOutlined />} onClick={copySelected}>{copyLabel}</Button>
              {selection.nodeIds.length > 0 && <>
                <Button size="small" icon={<TagOutlined />} onClick={addAnnotation}>添加注释</Button>
                <Button danger size="small" icon={<DeleteOutlined />} onClick={() => deleteCanvasItems(selectedNodeIds, new Set())}>
                  删除所选节点
                </Button>
              </>}
              {selection.annotationIds.length > 0 && <Button danger size="small" icon={<DeleteOutlined />}
                onClick={() => deleteCanvasItems([], selectedAnnotationIds)}>删除所选注释</Button>}
            </div>
          </PropertyGroup>
        </div>
      );
    }
    return renderCanvasProperties();
  };

  const selectedTitle = selectedAnnotation ? selectedAnnotation.title || '注释' : selectedNode?.label || selectedEdge?.label || config.name;
  const selectedType = selectedAnnotation ? '注释属性' : selection.type === 'multiple' ? '多选属性' : selectedNode ? '节点属性' : selectedEdge ? '连线属性' : '画布属性';

  const { nodes: visibleNodes, edges: visibleEdges } =
    dragPreview && dragRef.current ? moveDragSelection(dragRef.current, dragPreview.point) : config;
  const savedAnnotationFrames = getFlowAnnotationFrames(annotations, config.nodes);
  const annotationFrames = (visibleNodes === config.nodes ? savedAnnotationFrames : getFlowAnnotationFrames(annotations, visibleNodes))
    .map((frame) => annotationResize?.id === frame.annotation.id
      ? { ...frame, bounds: { ...frame.bounds, ...annotationResize.size } }
      : frame);
  const routePoints = config.edges.flatMap((edge) => edge.waypoints ?? []);
  const graphLeft = Math.min(Infinity, ...config.nodes.map((node) => node.x), ...routePoints.map((point) => point.x),
    ...savedAnnotationFrames.map(({ bounds }) => bounds.left));
  const graphRight = Math.max(0, ...config.nodes.map((node) => node.x + NODE_WIDTH + 40), ...routePoints.map((point) => point.x + 24));
  const graphBottom = Math.max(0, ...config.nodes.map((node) => node.y + NODE_HEIGHT + 40),
    ...routePoints.map((point) => point.y + 24), ...config.edges.map((edge) => edge.routeY ?? 0));
  // Keep the graph in view on narrow screens while working in the stored canvas coordinates.
  const originX = viewportWidth ? Math.max(0, Math.min(graphLeft - 24, graphRight - viewportWidth)) : 0;
  const canvasRight = Math.max(graphRight, ...annotationFrames.map(({ bounds }) => bounds.left + bounds.width + 24));
  const canvasBottom = Math.max(graphBottom, ...annotationFrames.map(({ bounds }) => bounds.top + bounds.height + 24));
  const routeSnap = routePreview?.snap;
  const canvasMenu = [
    ...(selectedNodeIds.length ? [{ key: 'annotation', label: '添加注释', icon: <TagOutlined />, onClick: addAnnotation }] : []),
    ...(canCopySelection ? [{ key: 'copy', label: copyLabel, icon: <CopyOutlined />, onClick: copySelected }] : []),
    ...(clipboard ? [{
      key: 'paste', label: clipboard.graph.annotations.length ? '粘贴' : '粘贴节点', icon: <SnippetsOutlined />, onClick: pasteSelection,
    }] : []),
  ];

  return (
    <div
      className={"professional-flow-designer"+(externalInspector?" professional-flow-external-inspector":"")}
      style={{ '--flow-node-width': `${NODE_WIDTH}px`, '--flow-node-height': `${NODE_HEIGHT}px` } as React.CSSProperties}
    >
      <aside className="professional-flow-library form-designer-left">
        <div className="professional-flow-panel-head designer-panel-head">
          <strong>节点</strong>
          <span>流程设计</span>
        </div>
        <div className="designer-library-search professional-flow-library-search">
          <Input
            allowClear
            placeholder="搜索节点或分类"
            prefix={<SearchOutlined />}
            value={nodeSearch}
            onChange={(event) => setNodeSearch(event.target.value)}
          />
          <small>通过审批节点配置审批人、会签/或签与字段权限；保存草稿后统一发布生效。</small>
        </div>
        <div className="professional-flow-node-groups designer-component-library">
          {!!quickNodeItems.length && (
            <section className="professional-flow-node-group designer-component-group">
              <div className="professional-flow-group-title designer-group-title">快捷添加</div>
              <div className="professional-flow-node-list designer-component-list">
                {quickNodeItems.map((item) => (
                  <button
                    className="professional-flow-palette-card designer-component"
                    data-desc={item.description}
                    draggable
                    key={item.key}
                    onClick={() => {
                      if (suppressPaletteClickRef.current) return;
                      addNode(item);
                    }}
                    onDragStart={(event) => {
                      event.dataTransfer.setData('application/x-professional-flow-node', item.key);
                      event.dataTransfer.setData('text/plain', item.key);
                      event.dataTransfer.effectAllowed = 'copy';
                    }}
                    onPointerCancel={stopPalettePointerDrag}
                    onPointerDown={(event) => startPalettePointerDrag(event, item)}
                    onPointerMove={movePalettePointerDrag}
                    onPointerUp={stopPalettePointerDrag}
                    onMouseDown={(event) => startPaletteMouseDrag(event, item)}
                    title={`${item.label} / ${item.description}`}
                    type="button"
                  >
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
          {visibleNodeGroups.map((group) => (
            <details className="professional-flow-node-group designer-component-group designer-component-collapse" key={group.key} open>
              <summary className="professional-flow-group-title designer-group-title">
                <span>{group.title}</span>
                <small>{group.items.length} 个</small>
              </summary>
              <div className="professional-flow-node-list designer-component-list">
                {group.items.map((item) => (
                  <button
                    className="professional-flow-palette-card designer-component"
                    data-desc={item.description}
                    draggable
                    key={item.key}
                    onClick={() => {
                      if (suppressPaletteClickRef.current) return;
                      addNode(item);
                    }}
                    onDragStart={(event) => {
                      event.dataTransfer.setData('application/x-professional-flow-node', item.key);
                      event.dataTransfer.setData('text/plain', item.key);
                      event.dataTransfer.effectAllowed = 'copy';
                    }}
                    onPointerCancel={stopPalettePointerDrag}
                    onPointerDown={(event) => startPalettePointerDrag(event, item)}
                    onPointerMove={movePalettePointerDrag}
                    onPointerUp={stopPalettePointerDrag}
                    onMouseDown={(event) => startPaletteMouseDrag(event, item)}
                    title={`${item.label} / ${item.description}`}
                    type="button"
                  >
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            </details>
          ))}
          {!visibleNodeGroups.length && (
            <div className="professional-flow-empty">没有匹配的节点</div>
          )}
        </div>
      </aside>

      <main className={`professional-flow-canvas ${isPaletteDragOver ? 'professional-flow-canvas-drag-over' : ''}`}>
        <div className="professional-flow-canvas-toolbar">
          <div className="professional-flow-canvas-title">
            <Typography.Text strong>{config.name}</Typography.Text>
          </div>
          <span className="professional-flow-canvas-meta">{config.nodes.length} 节点 / {config.edges.length} 连线</span>
        </div>
        <div className="professional-flow-canvas-scroll" ref={viewportRef}>
        <Dropdown trigger={['contextMenu']} disabled={!canvasMenu.length || Boolean(pendingPort)}
          menu={{ items: canvasMenu }}>
        <div
        className="professional-flow-canvas-content"
        style={{
          minWidth: canvasRight - originX,
          minHeight: `max(100%, ${canvasBottom}px)`,
          backgroundSize: `${SNAP_GRID}px ${SNAP_GRID}px`,
          backgroundPosition: `${SNAP_ORIGIN_X - originX}px ${SNAP_ORIGIN_Y}px`,
        }}
        onClick={() => {
          if (suppressCanvasClickRef.current) return;
          setSelection({ type: 'canvas' });
        }}
        onDragEnter={(event) => {
          if (event.dataTransfer.types.includes('application/x-professional-flow-node') || event.dataTransfer.types.includes('text/plain')) {
            event.preventDefault();
            setPaletteDragOver(true);
          }
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setPaletteDragOver(false);
          }
        }}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('application/x-professional-flow-node') || event.dataTransfer.types.includes('text/plain')) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
            setPaletteDragOver(true);
          }
        }}
        onDrop={handleCanvasDrop}
        onPointerDown={startMarqueeSelection}
        onPointerMove={(event) => {
          moveDrag(event);
          moveRouteDrag(event);
          moveMarqueeSelection(event);
          updateConnectionPreview(event);
        }}
        onPointerUp={(event) => {
          stopDrag(true, event.pointerId);
          stopRouteDrag(true, event.pointerId);
          stopMarqueeSelection(event.pointerId);
        }}
        onPointerCancel={(event) => {
          stopDrag(false, event.pointerId);
          stopRouteDrag(false, event.pointerId);
          stopMarqueeSelection(event.pointerId);
        }}
        onLostPointerCapture={(event) => {
          if (event.target === event.currentTarget) {
            stopDrag(false, event.pointerId);
            stopMarqueeSelection(event.pointerId);
          }
        }}
      >
        <div className="professional-flow-canvas-geometry" ref={canvasRef} style={{ left: -originX }}>
        {annotationFrames.map(({ annotation, bounds, minimum }) => {
          const { frameStyle, titleStyle } = annotation;
          const selected = selectedAnnotationIds.has(annotation.id);
          return (
            <div key={annotation.id} className="professional-flow-annotation"
              style={{
                ...bounds,
                '--flow-annotation-color': annotation.color,
                '--flow-annotation-fill': frameStyle?.backgroundColor,
                '--flow-annotation-opacity': frameStyle?.backgroundOpacity === undefined ? undefined : `${frameStyle.backgroundOpacity}%`,
                borderColor: frameStyle?.borderColor,
                borderStyle: frameStyle?.borderStyle,
                borderWidth: frameStyle?.borderWidth,
                borderRadius: frameStyle?.borderRadius,
              } as React.CSSProperties}
              data-selected={selected}
              data-flow-annotation-id={annotation.id}
              onPointerDown={(event) => startAnnotationDrag(event, annotation)}>
              <button className="professional-flow-annotation-title" type="button" aria-pressed={selected}
                style={{
                  color: titleStyle?.color, fontFamily: titleStyle?.fontFamily, fontSize: titleStyle?.fontSize,
                  fontWeight: titleStyle?.bold === false ? 400 : undefined,
                  fontStyle: titleStyle?.italic ? 'italic' : undefined,
                  textDecoration: titleStyle?.underline ? 'underline' : undefined,
                }}
                title={annotation.title || '注释'} onClick={(event) => {
                  event.stopPropagation();
                  setSelection({ type: 'annotation', id: annotation.id });
                }}>
                {annotation.title || '注释'}
              </button>
              {selectedAnnotation?.id === annotation.id && <button className="professional-flow-annotation-resize" type="button"
                aria-label="调整注释框大小" title="拖动或使用方向键调整注释框大小"
                onPointerDown={(event) => startAnnotationResize(event, annotation.id, bounds, minimum)}
                onPointerMove={moveAnnotationResize}
                onPointerUp={(event) => stopAnnotationResize(true, event.pointerId)}
                onPointerCancel={(event) => stopAnnotationResize(false, event.pointerId)}
                onLostPointerCapture={(event) => stopAnnotationResize(false, event.pointerId)}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  const delta = annotationResizeKeys[event.key];
                  if (!delta || annotationResizeRef.current) return;
                  event.preventDefault();
                  const size = resizeFlowAnnotation(bounds, delta, minimum);
                  if (size.width !== bounds.width || size.height !== bounds.height) patchAnnotation(annotation.id, { size });
                }} />}
            </div>
          );
        })}
        <svg className="professional-flow-edge-layer">
          <defs>
            <marker id={arrowId} markerUnits="userSpaceOnUse" markerHeight="8" markerWidth="8" orient="auto" refX="12" refY="4">
              <path className="professional-flow-arrow" d="M 1 1 L 6 4 L 1 7" />
            </marker>
          </defs>
          {visibleEdges.map((edge) => {
            const isActiveEdge = selection.type === 'edge' && selection.id === edge.id;
            const drag = routeDragRef.current;
            const waypoints = routePreview && drag?.edgeId === edge.id ? routePreview.waypoints : edge.waypoints;
            const route = routeForEdge(edge, waypoints, visibleNodes);
            if (!route) return null;
            const selectEdge = (event: React.MouseEvent<SVGElement>) => {
              event.stopPropagation();
              setSelection({ type: 'edge', id: edge.id });
            };
            const addEdgeWaypoint = (event: React.MouseEvent<SVGElement>, anchor?: FlowRoutePoint) => {
              event.stopPropagation();
              if (suppressCanvasClickRef.current) return;
              const canvas = canvasRef.current;
              if (canvas) addWaypoint(edge, anchor ?? clientToCanvasPoint(canvas, event.clientX, event.clientY));
            };
            return (
              <g key={edge.id} className={isActiveEdge ? 'professional-flow-edge-active' : undefined}>
                <path className="professional-flow-edge-line" d={route.d} markerEnd={`url(#${arrowId})`} />
                <path
                  className="professional-flow-edge-hit"
                  d={route.d}
                  tabIndex={0}
                  role="button"
                  aria-label={`编辑连线${edge.label ? `：${edge.label}` : ''}`}
                  onPointerDown={(event) => startSegmentDrag(event, edge, route)}
                  onLostPointerCapture={(event) => stopRouteDrag(false, event.pointerId)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    setSelection({ type: 'edge', id: edge.id });
                  }}
                  onClick={selectEdge}
                  onDoubleClick={(event) => addEdgeWaypoint(event)}
                />
                {edge.label && <text className="professional-flow-edge-label" x={route.label.x} y={route.label.y}
                  onPointerDown={(event) => startSegmentDrag(event, edge, route, route.label.anchor)}
                  onLostPointerCapture={(event) => stopRouteDrag(false, event.pointerId)}
                  onClick={selectEdge}
                  onDoubleClick={(event) => addEdgeWaypoint(event, route.label.anchor)}
                  textAnchor={route.label.vertical ? 'start' : 'middle'}
                  dominantBaseline={route.label.vertical ? 'central' : undefined}>{edge.label}</text>}
                {isActiveEdge && waypoints?.map((point, index) => (
                  <circle
                    key={index}
                    className={`professional-flow-route-handle${selectedWaypoint?.edgeId === edge.id && selectedWaypoint.index === index ? ' professional-flow-route-handle-active' : ''}`}
                    cx={point.x}
                    cy={point.y}
                    r={5}
                    tabIndex={0}
                    role="button"
                    aria-label={`拐点 ${index + 1}`}
                    onFocus={() => setSelectedWaypoint({ edgeId: edge.id, index })}
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => {
                      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
                      event.preventDefault();
                      event.stopPropagation();
                      removeWaypoint(edge, index);
                    }}
                    onPointerDown={(event) => startWaypointDrag(event, edge, index, point)}
                    onLostPointerCapture={(event) => stopRouteDrag(false, event.pointerId)}
                  />
                ))}
              </g>
            );
          })}
          {pendingPort && connectionPreview && (() => {
            const from = config.nodes.find((node) => node.id === pendingPort.nodeId);
            if (!from) return null;
            const start = getPortPoint(from, pendingPort.side);
            const targetSide = previewTargetSide(pendingPort.side, start, connectionPreview);
            return (
              <path
                className="professional-flow-edge-preview"
                d={getFlowEdgeRoute(start, pendingPort.side, connectionPreview, targetSide).d}
              />
            );
          })()}
        </svg>
        {palettePreview && (
          <div
            className={`professional-flow-drag-ghost ${palettePreview.inside ? 'professional-flow-drag-ghost-inside' : ''}`}
            style={{ left: palettePreview.x, top: palettePreview.y }}
          >
            <strong>{palettePreview.label}</strong>
            <span>{palettePreview.inside ? '松开放到吸附位置' : '拖到画布中创建节点'}</span>
          </div>
        )}
        {dragPreview && (
          <>
            {dragPreview.alignY && <div className="professional-flow-snap-guide-horizontal" style={{
              top: dragPreview.point.y + NODE_HEIGHT / 2,
              left: Math.min(dragPreview.point.x, dragPreview.alignY.x) + NODE_WIDTH / 2,
              width: Math.abs(dragPreview.point.x - dragPreview.alignY.x),
            }} />}
            {dragPreview.alignX && <div className="professional-flow-snap-guide-vertical" style={{
              left: dragPreview.point.x + NODE_WIDTH / 2,
              top: Math.min(dragPreview.point.y, dragPreview.alignX.y) + NODE_HEIGHT / 2,
              height: Math.abs(dragPreview.point.y - dragPreview.alignX.y),
            }} />}
            <div className="professional-flow-position-chip" style={{ left: dragPreview.point.x, top: dragPreview.point.y - 12 }}>
              x {Math.round(dragPreview.point.x)} / y {Math.round(dragPreview.point.y)}
            </div>
          </>
        )}
        {routeSnap?.alignY && <div className="professional-flow-snap-guide-horizontal" style={{
          top: routeSnap.point.y,
          left: Math.min(routeSnap.point.x, routeSnap.alignY.x),
          width: Math.abs(routeSnap.point.x - routeSnap.alignY.x),
        }} />}
        {routeSnap?.alignX && <div className="professional-flow-snap-guide-vertical" style={{
          left: routeSnap.point.x,
          top: Math.min(routeSnap.point.y, routeSnap.alignX.y),
          height: Math.abs(routeSnap.point.y - routeSnap.alignX.y),
        }} />}
        {marqueeSelection && (
          <div
            className="professional-flow-marquee"
            style={{
              left: marqueeSelection.x,
              top: marqueeSelection.y,
              width: marqueeSelection.width,
              height: marqueeSelection.height,
            }}
          />
        )}
        {visibleNodes.map((node) => (
          <div
            className={`professional-flow-node professional-flow-node-${node.category} ${selectedNodeIdSet.has(node.id) ? 'professional-flow-node-selected' : ''}`}
            key={node.id}
            onClick={(event) => {
              event.stopPropagation();
              if (suppressCanvasClickRef.current) return;
              if (pendingPort && pendingPort.nodeId !== node.id) {
                const canvas = canvasRef.current;
                if (canvas) {
                  const point = clientToCanvasPoint(canvas, event.clientX, event.clientY);
                  connectPendingPortTo(node, nearestPortSide(node, point));
                  return;
                }
              }
              setSelection({ type: 'node', id: node.id });
            }}
            onPointerDown={(event) => startDrag(event, node)}
            style={{ left: node.x, top: node.y }}
          >
            <span className="professional-flow-node-icon" title={getNodeTypeLabel(node)}>
              {getNodeIcon(node)}
            </span>
            <span className="professional-flow-node-copy" title={node.label}>
              <strong>{node.label}</strong>
            </span>
            {portsForNode(node).map((side) => (
              <button
                aria-label={`${node.label}-${side}`}
                className={`professional-flow-port professional-flow-port-${side} ${pendingPort?.nodeId === node.id && pendingPort.side === side ? 'professional-flow-port-active' : ''}`}
                key={side}
                onClick={(event) => handlePortClick(event, node, side)}
                type="button"
              />
            ))}
          </div>
        ))}
        </div>
        </div>
        </Dropdown>
        </div>
      </main>

      {externalInspector?(propertiesTarget?createPortal(<aside className="professional-flow-properties property-inspector">
        {renderProperties()}
      </aside>,propertiesTarget):null):<aside className="professional-flow-properties property-inspector">
        <div className="professional-flow-panel-head">
          <div>
            <strong>{selectedType}</strong>
            <span>{selectedTitle}</span>
          </div>
          {selection.type === 'canvas' && <Button size="small" icon={<PlusOutlined />} onClick={() => addNode(nodeGroups[1].items[0])}>审批</Button>}
        </div>
        {renderProperties()}
      </aside>}
    </div>
  );
}
