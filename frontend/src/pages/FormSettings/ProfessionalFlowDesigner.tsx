import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  PlayCircleOutlined,
  PlusOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  ShareAltOutlined,
  StopOutlined,
  ThunderboltOutlined,
  UndoOutlined,
  UserOutlined,
  UserSwitchOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { Button, Input, InputNumber, Modal, Select, Space, Switch, Tag, Typography } from 'antd';

type FlowPortSide = 'top' | 'right' | 'bottom' | 'left';
type Selection = { type: 'canvas' } | { type: 'node'; id: string } | { type: 'nodes'; ids: string[] } | { type: 'edge'; id: string };
type NodeCategory = 'event' | 'task' | 'gateway' | 'subprocess' | 'data' | 'boundary';
type ApprovalMode = 'single' | 'orSign' | 'countersign';
type AssigneeSource = 'fixed' | 'role' | 'departmentOwner' | 'initiatorManager' | 'field';
type AssigneeTargetType = 'user' | 'role' | 'organization' | 'field' | 'departmentOwner' | 'initiatorManager';

export interface FlowAssigneeRule {
  id: string;
  type: AssigneeTargetType;
  value?: string;
  scope?: 'self' | 'children';
}

export interface FlowExternalAction {
  enabled: boolean;
  system?: string;
  action?: 'webhook' | 'api' | 'message';
  endpoint?: string;
  fieldMappings?: Array<{ id: string; sourceField?: string; targetField?: string }>;
}

export interface FlowDesignerField {
  key: string;
  name: string;
  type: string;
  required?: boolean;
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
  condition?: string;
  conditionField?: string;
  conditionOperator?: string;
  conditionValue?: string;
  priority: number;
  isDefault?: boolean;
  routeY?: number;
}

export interface FlowDesignerConfig {
  id: string;
  name: string;
  version: string;
  nodes: FlowDesignerNode[];
  edges: FlowDesignerEdge[];
  triggerBindings: Array<{ action: string; workflowId?: number; enabled: boolean; label: string }>;
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

const NODE_WIDTH = 216;
const NODE_HEIGHT = 48;
const SNAP_GRID = 24;
const SNAP_ORIGIN_X = 32;
const SNAP_ORIGIN_Y = 82;
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
  { value: 'message', label: '消息队列' },
];

const approvalModeOptions = [
  { value: 'single', label: '单人审批' },
  { value: 'orSign', label: '或签' },
  { value: 'countersign', label: '会签' },
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

function snapValue(value: number, origin = 0, grid = SNAP_GRID) {
  return Math.round((value - origin) / grid) * grid + origin;
}

function clampPoint(x: number, y: number, canvas: HTMLDivElement) {
  const maxX = Math.max(SNAP_ORIGIN_X, canvas.offsetWidth - NODE_WIDTH - 24);
  const maxY = Math.max(SNAP_ORIGIN_Y, canvas.offsetHeight - NODE_HEIGHT - 24);
  return {
    x: Math.min(Math.max(SNAP_ORIGIN_X, x), maxX),
    y: Math.min(Math.max(SNAP_ORIGIN_Y, y), maxY),
  };
}

function snapNodePosition(x: number, y: number, canvas: HTMLDivElement) {
  return clampPoint(
    snapValue(x, SNAP_ORIGIN_X),
    snapValue(y, SNAP_ORIGIN_Y),
    canvas,
  );
}

function getCenteredNodeX(canvas: HTMLDivElement) {
  return Math.max(SNAP_ORIGIN_X, Math.round((canvas.offsetWidth - NODE_WIDTH) / 2));
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
      fieldPermissions: node.fieldPermissions
        ? Object.fromEntries(Object.entries(node.fieldPermissions).map(([key, value]) => [key, { ...value }]))
        : undefined,
    })),
    edges: config.edges.map((edge) => ({ ...edge })),
    triggerBindings: config.triggerBindings.map((binding) => ({ ...binding })),
    stateMapping: { ...config.stateMapping },
    advancedModeConfig: { ...config.advancedModeConfig },
  };
}

function isEditableTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  return Boolean(element?.closest('input, textarea, [contenteditable="true"], .ant-select, .ant-input-number'));
}

function makeFieldPermissions(fields: FlowDesignerField[]) {
  return Object.fromEntries(fields.map((field) => [
    field.key,
    { visible: true, editable: !field.required, required: Boolean(field.required) },
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
    assigneeRules: approvalTaskTypes.has(definition.key) ? [{ id: makeId('assignee'), type: 'role', value: '流程审批人' }] : undefined,
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
  const labels = params.steps.length >= 2 ? params.steps : ['提交', '审批', '归档'];
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
      { action: 'approve', label: '审批通过', enabled: false },
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

export function validateFlowDesignerConfig(config: FlowDesignerConfig): FlowDesignerValidationItem[] {
  const startNodes = config.nodes.filter((node) => node.type === 'startEvent');
  const endNodes = config.nodes.filter((node) => node.type === 'endEvent');
  const nodeIds = new Set(config.nodes.map((node) => node.id));
  const connectedNodeIds = new Set<string>();
  config.edges.forEach((edge) => {
    connectedNodeIds.add(edge.source);
    connectedNodeIds.add(edge.target);
  });
  const orphanNodes = config.nodes.filter((node) => node.executable && node.type !== 'startEvent' && node.type !== 'endEvent' && !connectedNodeIds.has(node.id));
  const incompleteApprovals = config.nodes.filter((node) => approvalTaskTypes.has(node.type) && !(node.assigneeRules?.length || (node.assigneeSource && node.assigneeValue)));
  const incompleteGateways = config.nodes.filter((node) => node.type === 'exclusiveGateway').filter((node) => {
    const outgoing = config.edges.filter((edge) => edge.source === node.id);
    return outgoing.length < 2 || outgoing.every((edge) => !edge.condition && !edge.isDefault);
  });
  const parallelWithoutJoin = config.nodes.filter((node) => node.type === 'parallelGateway').length > 0
    && config.nodes.filter((node) => node.type === 'joinGateway').length === 0;
  const invalidEdges = config.edges.filter((edge) => !nodeIds.has(edge.source) || !nodeIds.has(edge.target));
  const enabledTriggers = config.triggerBindings.filter((binding) => binding.enabled);
  const issues: FlowDesignerValidationItem[] = [
    {
      level: startNodes.length === 1 ? 'suggestion' : 'error',
      title: '开始事件',
      detail: startNodes.length === 1 ? '流程包含唯一开始事件。' : `当前有 ${startNodes.length} 个开始事件，需要且只能保留一个。`,
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
      level: parallelWithoutJoin ? 'warning' : 'suggestion',
      title: '并行汇聚',
      detail: parallelWithoutJoin ? '存在并行网关但缺少汇聚网关，建议补充汇聚节点。' : '并行与汇聚结构已匹配或未使用并行。',
    },
    {
      level: invalidEdges.length ? 'error' : 'suggestion',
      title: '连线有效性',
      detail: invalidEdges.length ? `存在 ${invalidEdges.length} 条连接了无效节点的连线。` : '连线均连接有效节点。',
    },
    {
      level: enabledTriggers.length ? 'suggestion' : 'error',
      title: '触发绑定',
      detail: enabledTriggers.length ? `已启用 ${enabledTriggers.length} 个表单触发动作。` : '至少需要启用一个表单触发动作。',
    },
  ];
  return issues;
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

function getPortVector(side: FlowPortSide) {
  const vectors: Record<FlowPortSide, { x: number; y: number }> = {
    top: { x: 0, y: -1 },
    right: { x: 1, y: 0 },
    bottom: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
  };
  return vectors[side];
}

function clampRouteY(value: number, canvas?: HTMLDivElement | null) {
  const maxY = canvas ? canvas.offsetHeight - 32 : 1600;
  return Math.min(Math.max(SNAP_ORIGIN_Y, value), maxY);
}

function orthogonalRoute(
  start: { x: number; y: number },
  fromSide: FlowPortSide,
  end: { x: number; y: number },
  toSide: FlowPortSide,
  routeY?: number,
) {
  const fromVector = getPortVector(fromSide);
  const toVector = getPortVector(toSide);
  const offset = 34;
  const startLead = { x: start.x + fromVector.x * offset, y: start.y + fromVector.y * offset };
  const endLead = { x: end.x + toVector.x * offset, y: end.y + toVector.y * offset };
  const midY = routeY ?? (startLead.y + endLead.y) / 2;
  const handleX = (startLead.x + endLead.x) / 2;
  return {
    d: `M ${start.x} ${start.y} L ${startLead.x} ${startLead.y} L ${startLead.x} ${midY} L ${endLead.x} ${midY} L ${endLead.x} ${endLead.y} L ${end.x} ${end.y}`,
    handle: { x: handleX, y: midY },
    midY,
  };
}

function orthogonalPath(start: { x: number; y: number }, fromSide: FlowPortSide, end: { x: number; y: number }, toSide: FlowPortSide) {
  return orthogonalRoute(start, fromSide, end, toSide).d;
}

function connectorRoute(from: FlowDesignerNode, fromSide: FlowPortSide, to: FlowDesignerNode, toSide: FlowPortSide, routeY?: number) {
  return orthogonalRoute(getPortPoint(from, fromSide), fromSide, getPortPoint(to, toSide), toSide, routeY);
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
  fields,
  roles,
  onChange,
}: {
  config: FlowDesignerConfig;
  fields: FlowDesignerField[];
  roles: string[];
  onChange: (config: FlowDesignerConfig) => void;
}) {
  const [selection, setSelection] = useState<Selection>({ type: 'canvas' });
  const [pendingPort, setPendingPort] = useState<{ nodeId: string; side: FlowPortSide } | null>(null);
  const [isPaletteDragOver, setPaletteDragOver] = useState(false);
  const [palettePreview, setPalettePreview] = useState<{ label: string; x: number; y: number; inside: boolean } | null>(null);
  const [dragPreview, setDragPreview] = useState<{ x: number; y: number } | null>(null);
  const [connectionPreview, setConnectionPreview] = useState<{ x: number; y: number } | null>(null);
  const [marqueeSelection, setMarqueeSelection] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [activeRouteEdgeId, setActiveRouteEdgeId] = useState<string | null>(null);
  const [conditionModalOpen, setConditionModalOpen] = useState(false);
  const [history, setHistory] = useState<FlowDesignerConfig[]>([]);
  const [future, setFuture] = useState<FlowDesignerConfig[]>([]);
  const [clipboardNode, setClipboardNode] = useState<FlowDesignerNode | null>(null);
  const [nodeSearch, setNodeSearch] = useState('');
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const autoCenteredStackXRef = useRef<number | null>(null);
  const dragRef = useRef<{ ids: string[]; startX: number; startY: number; scaleX: number; scaleY: number; origins: Record<string, { x: number; y: number }>; snapshot?: FlowDesignerConfig } | null>(null);
  const routeDragRef = useRef<{ edgeId: string; startY: number; originRouteY: number; scaleY: number; snapshot?: FlowDesignerConfig } | null>(null);
  const marqueeRef = useRef<{ startX: number; startY: number; currentX: number; currentY: number; dragging: boolean } | null>(null);
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
  const selectedEdge = selection.type === 'edge' ? config.edges.find((edge) => edge.id === selection.id) : undefined;
  const selectedNodeIds = selection.type === 'nodes' ? selection.ids : selection.type === 'node' ? [selection.id] : [];
  const selectedNodeIdSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);
  const selectedEdgeSourceNode = selectedEdge ? config.nodes.find((node) => node.id === selectedEdge.source) : undefined;
  const isSelectedEdgeFromBranch = selectedEdgeSourceNode?.category === 'gateway';

  useEffect(() => {
    if (selection.type !== 'edge') {
      setConditionModalOpen(false);
    }
  }, [selection.type]);

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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const recenterDefaultStack = () => {
      if (!isDefaultVerticalStack(config.nodes) || canvas.offsetWidth <= 0) return;
      const firstX = config.nodes[0]?.x;
      const allNodesShareX = config.nodes.every((node) => Math.abs(node.x - firstX) <= 1);
      if (!allNodesShareX) return;
      const wasAutoCentered = autoCenteredStackXRef.current !== null && Math.abs(firstX - autoCenteredStackXRef.current) <= 1;
      const isLegacyDefaultX = LEGACY_STACK_X_VALUES.some((x) => Math.abs(firstX - x) <= 1);
      if (!wasAutoCentered && !isLegacyDefaultX) return;
      const centeredX = getCenteredNodeX(canvas);
      autoCenteredStackXRef.current = centeredX;
      if (config.nodes.every((node) => Math.abs(node.x - centeredX) <= 1)) return;
      onChange({
        ...config,
        nodes: config.nodes.map((node) => ({ ...node, x: centeredX })),
      });
    };

    recenterDefaultStack();
    const observer = new ResizeObserver(recenterDefaultStack);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [config, onChange]);

  const applyConfig = (nextConfig: FlowDesignerConfig, options: { record?: boolean } = {}) => {
    if (options.record !== false) {
      setHistory((items) => [...items.slice(-29), cloneFlowConfig(config)]);
      setFuture([]);
    }
    onChange(nextConfig);
  };

  const patchConfig = (patch: Partial<FlowDesignerConfig>, options?: { record?: boolean }) => applyConfig({ ...config, ...patch }, options);
  const patchNode = (nodeId: string, patch: Partial<FlowDesignerNode>) => {
    patchConfig({ nodes: config.nodes.map((node) => (node.id === nodeId ? { ...node, ...patch } : node)) });
  };
  const patchEdge = (edgeId: string, patch: Partial<FlowDesignerEdge>) => {
    patchConfig({ edges: config.edges.map((edge) => (edge.id === edgeId ? { ...edge, ...patch } : edge)) });
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
    const selectedIds = config.nodes
      .filter((node) => {
        const nodeRight = node.x + NODE_WIDTH;
        const nodeBottom = node.y + NODE_HEIGHT;
        const marqueeRight = x + width;
        const marqueeBottom = y + height;
        return node.x < marqueeRight && nodeRight > x && node.y < marqueeBottom && nodeBottom > y;
      })
      .map((node) => node.id);
    setSelection(selectedIds.length === 1 ? { type: 'node', id: selectedIds[0] } : selectedIds.length > 1 ? { type: 'nodes', ids: selectedIds } : { type: 'canvas' });
  };

  const startMarqueeSelection = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || pendingPort || dragRef.current) return;
    const target = event.target as HTMLElement;
    if (target.closest('.professional-flow-node, .professional-flow-port, .professional-flow-canvas-toolbar')) return;
    if (target.tagName.toLowerCase() === 'path' || target.tagName.toLowerCase() === 'text') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const point = clientToCanvasPoint(canvas, event.clientX, event.clientY);
    const startX = point.x;
    const startY = point.y;
    marqueeRef.current = { startX, startY, currentX: startX, currentY: startY, dragging: false };
    setSelection({ type: 'canvas' });
    setMarqueeSelection(null);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveMarqueeSelection = (event: React.PointerEvent<HTMLElement>) => {
    const marquee = marqueeRef.current;
    const canvas = canvasRef.current;
    if (!marquee || !canvas) return;
    const point = clientToCanvasPoint(canvas, event.clientX, event.clientY);
    marquee.currentX = point.x;
    marquee.currentY = point.y;
    const distance = Math.hypot(marquee.currentX - marquee.startX, marquee.currentY - marquee.startY);
    if (distance <= 4 && !marquee.dragging) return;
    marquee.dragging = true;
    suppressCanvasClickRef.current = true;
    updateMarqueeSelection(marquee.startX, marquee.startY, marquee.currentX, marquee.currentY);
  };

  const stopMarqueeSelection = () => {
    const marquee = marqueeRef.current;
    marqueeRef.current = null;
    setMarqueeSelection(null);
    if (!marquee?.dragging) return;
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

  const deleteSelected = () => {
    if (selection.type === 'nodes') {
      const nodeIds = new Set(selection.ids);
      patchConfig({
        nodes: config.nodes.filter((node) => !nodeIds.has(node.id)),
        edges: config.edges.filter((edge) => !nodeIds.has(edge.source) && !nodeIds.has(edge.target)),
      });
      setSelection({ type: 'canvas' });
      return;
    }
    if (selection.type === 'node') {
      patchConfig({
        nodes: config.nodes.filter((node) => node.id !== selection.id),
        edges: config.edges.filter((edge) => edge.source !== selection.id && edge.target !== selection.id),
      });
      setSelection({ type: 'canvas' });
      return;
    }
    if (selection.type === 'edge') {
      patchConfig({ edges: config.edges.filter((edge) => edge.id !== selection.id) });
      setSelection({ type: 'canvas' });
    }
  };

  const startDrag = (event: React.PointerEvent<HTMLDivElement>, node: FlowDesignerNode) => {
    if ((event.target as HTMLElement).closest('.professional-flow-port')) return;
    if (pendingPort) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { scaleX, scaleY } = getCanvasScale(canvas);
    const ids = selection.type === 'nodes' && selectedNodeIdSet.has(node.id) ? selection.ids : [node.id];
    const origins = Object.fromEntries(config.nodes.filter((item) => ids.includes(item.id)).map((item) => [item.id, { x: item.x, y: item.y }]));
    dragRef.current = { ids, startX: event.clientX, startY: event.clientY, scaleX, scaleY, origins, snapshot: cloneFlowConfig(config) };
    setDragPreview({ x: node.x, y: node.y });
    if (!(selection.type === 'nodes' && selectedNodeIdSet.has(node.id))) {
      setSelection({ type: 'node', id: node.id });
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    const canvas = canvasRef.current;
    if (!drag || !canvas) return;
    const deltaX = (event.clientX - drag.startX) / drag.scaleX;
    const deltaY = (event.clientY - drag.startY) / drag.scaleY;
    const primaryOrigin = drag.origins[drag.ids[0]];
    const next = primaryOrigin ? clampPoint(primaryOrigin.x + deltaX, primaryOrigin.y + deltaY, canvas) : null;
    const liveDeltaX = next && primaryOrigin ? next.x - primaryOrigin.x : deltaX;
    const liveDeltaY = next && primaryOrigin ? next.y - primaryOrigin.y : deltaY;
    if (!next) return;
    setDragPreview(next);
    if (pendingPort) {
      setConnectionPreview(clientToCanvasPoint(canvas, event.clientX, event.clientY));
    }
    patchConfig({
      nodes: config.nodes.map((node) => (drag.ids.includes(node.id) && drag.origins[node.id]
        ? {
            ...node,
            x: clampPoint(drag.origins[node.id].x + liveDeltaX, drag.origins[node.id].y + liveDeltaY, canvas).x,
            y: clampPoint(drag.origins[node.id].x + liveDeltaX, drag.origins[node.id].y + liveDeltaY, canvas).y,
          }
        : node)),
    }, { record: false });
  };

  const startRouteDrag = (event: React.PointerEvent<SVGCircleElement>, edge: FlowDesignerEdge, originRouteY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    event.preventDefault();
    event.stopPropagation();
    const { scaleY } = getCanvasScale(canvas);
    routeDragRef.current = {
      edgeId: edge.id,
      startY: event.clientY,
      originRouteY,
      scaleY,
      snapshot: cloneFlowConfig(config),
    };
    setSelection({ type: 'edge', id: edge.id });
    setActiveRouteEdgeId(edge.id);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveRouteDrag = (event: React.PointerEvent<HTMLElement>) => {
    const drag = routeDragRef.current;
    if (!drag) return;
    event.preventDefault();
    const nextRouteY = clampRouteY(drag.originRouteY + (event.clientY - drag.startY) / drag.scaleY, canvasRef.current);
    patchConfig({
      edges: config.edges.map((edge) => (edge.id === drag.edgeId ? { ...edge, routeY: nextRouteY } : edge)),
    }, { record: false });
  };

  const updateConnectionPreview = (event: React.PointerEvent<HTMLElement>) => {
    if (!pendingPort || dragRef.current || routeDragRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    setConnectionPreview(clientToCanvasPoint(canvas, event.clientX, event.clientY));
  };

  const stopDrag = () => {
    const drag = dragRef.current;
    if (drag?.snapshot) {
      const didMove = config.nodes.some((node) => {
        const origin = drag.origins[node.id];
        return origin && (node.x !== origin.x || node.y !== origin.y);
      });
      if (didMove) {
        const snapshot = drag.snapshot;
        setHistory((items) => [...items.slice(-29), snapshot]);
        setFuture([]);
      }
    }
    dragRef.current = null;
    setDragPreview(null);
  };

  const stopRouteDrag = () => {
    const drag = routeDragRef.current;
    if (drag?.snapshot) {
      const current = config.edges.find((edge) => edge.id === drag.edgeId);
      if (current && current.routeY !== drag.snapshot.edges.find((edge) => edge.id === drag.edgeId)?.routeY) {
        setHistory((items) => [...items.slice(-29), drag.snapshot as FlowDesignerConfig]);
        setFuture([]);
      }
    }
    routeDragRef.current = null;
    setActiveRouteEdgeId(null);
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
    if (!selectedNode) return;
    setClipboardNode(cloneFlowConfig({
      ...config,
      nodes: [selectedNode],
      edges: [],
    }).nodes[0]);
  };

  const pasteNode = () => {
    if (!clipboardNode) return;
    const canvas = canvasRef.current;
    const point = canvas ? snapNodePosition(clipboardNode.x + SNAP_GRID * 2, clipboardNode.y + SNAP_GRID * 2, canvas) : { x: clipboardNode.x + SNAP_GRID * 2, y: clipboardNode.y + SNAP_GRID * 2 };
    const pasted: FlowDesignerNode = {
      ...clipboardNode,
      id: makeId(clipboardNode.type),
      label: `${clipboardNode.label} 副本`,
      x: point.x,
      y: point.y,
      fieldPermissions: clipboardNode.fieldPermissions
        ? Object.fromEntries(Object.entries(clipboardNode.fieldPermissions).map(([key, value]) => [key, { ...value }]))
        : undefined,
    };
    patchConfig({ nodes: [...config.nodes, pasted] });
    setSelection({ type: 'node', id: pasted.id });
  };

  const duplicateSelected = () => {
    if (!selectedNode) return;
    setClipboardNode(selectedNode);
    const canvas = canvasRef.current;
    const point = canvas ? snapNodePosition(selectedNode.x + SNAP_GRID * 2, selectedNode.y + SNAP_GRID * 2, canvas) : { x: selectedNode.x + SNAP_GRID * 2, y: selectedNode.y + SNAP_GRID * 2 };
    const duplicate: FlowDesignerNode = {
      ...selectedNode,
      id: makeId(selectedNode.type),
      label: `${selectedNode.label} 副本`,
      x: point.x,
      y: point.y,
      fieldPermissions: selectedNode.fieldPermissions
        ? Object.fromEntries(Object.entries(selectedNode.fieldPermissions).map(([key, value]) => [key, { ...value }]))
        : undefined,
    };
    patchConfig({
      nodes: [...config.nodes, duplicate],
    });
    setSelection({ type: 'node', id: duplicate.id });
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
    const newEdge: FlowDesignerEdge = {
      id: makeId('edge'),
      source: pendingPort.nodeId,
      sourceSide: pendingPort.side,
      target: targetNode.id,
      targetSide,
      label: '通过',
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
      if (command && key === 'c') {
        event.preventDefault();
        copySelected();
        return;
      }
      if (command && key === 'v') {
        event.preventDefault();
        pasteNode();
        return;
      }
      if (command && key === 'd') {
        event.preventDefault();
        duplicateSelected();
        return;
      }
      if (key === 'escape') {
        setPendingPort(null);
        setConnectionPreview(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [clipboardNode, config, future, history, selectedNode, selection]);

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
    patchNode(selectedNode.id, {
      fieldPermissions: {
        ...(selectedNode.fieldPermissions || {}),
        [fieldKey]: {
          visible: true,
          editable: false,
          required: false,
          ...(selectedNode.fieldPermissions?.[fieldKey] || {}),
          [key]: value,
        },
      },
    });
  };

  const renderNodeProperties = () => {
    if (!selectedNode) return null;
    const fieldOptions = fields.map((field) => ({ value: field.key, label: field.name }));
    const selectedNodeTypeLabel = getNodeTypeLabel(selectedNode);
    const selectedNodeTypeDescription = getNodeTypeDescription(selectedNode);
    const assigneeRules = selectedNode.assigneeRules?.length
      ? selectedNode.assigneeRules
      : approvalTaskTypes.has(selectedNode.type) && selectedNode.assigneeSource
        ? [{ id: 'legacy-assignee', type: selectedNode.assigneeSource === 'fixed' ? 'user' : selectedNode.assigneeSource as AssigneeTargetType, value: selectedNode.assigneeValue }]
        : [];
    const patchAssigneeRules = (nextRules: FlowAssigneeRule[]) => {
      const firstRule = nextRules[0];
      patchNode(selectedNode.id, {
        assigneeRules: nextRules,
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
      if (rule.type === 'role') {
        return (
          <Select
            placeholder="选择角色"
            value={rule.value}
            options={roles.map((role) => ({ value: role, label: role }))}
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
        endpoint: patch.endpoint ?? externalAction.endpoint,
        fieldMappings: patch.fieldMappings ?? externalAction.fieldMappings ?? [],
      };
      patchNode(selectedNode.id, {
        externalAction: nextExternalAction,
      });
    };
    return (
      <div className="professional-flow-props">
        <section>
          <div className="professional-flow-section-title">节点身份</div>
          <label className="professional-flow-node-kind-row">
            <span>节点类型</span>
            <div className="professional-flow-node-kind">
              <span className="professional-flow-node-kind-icon">{getNodeIcon(selectedNode)}</span>
              <div>
                <strong>{selectedNodeTypeLabel}</strong>
                <small>{selectedNodeTypeDescription}</small>
              </div>
            </div>
          </label>
          <label><span>标题</span><Input value={selectedNode.label} onChange={(event) => patchNode(selectedNode.id, { label: event.target.value })} /></label>
          <label><span>业务说明</span><Input value={selectedNode.description} onChange={(event) => patchNode(selectedNode.id, { description: event.target.value })} /></label>
        </section>

        {approvalTaskTypes.has(selectedNode.type) && (
          <section>
            <div className="professional-flow-section-title">处理人规则</div>
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
              <Button
                size="small"
                type="dashed"
                onClick={() => patchAssigneeRules([...assigneeRules, { id: makeId('assignee'), type: 'role' }])}
              >
                添加处理对象
              </Button>
            </div>
            <label>
              <span>审批方式</span>
              <Select value={selectedNode.approvalMode} options={approvalModeOptions} onChange={(value) => patchNode(selectedNode.id, { approvalMode: value })} />
            </label>
          </section>
        )}

        {selectedNode.type === 'serviceTask' && (
          <section>
            <div className="professional-flow-section-title">外部系统推送</div>
            <label><span>启用推送</span><Switch checked={externalAction.enabled} onChange={(enabled) => patchExternalAction({ enabled })} /></label>
            <label><span>目标系统</span><Input placeholder="例如 ERP / MES / WMS" value={externalAction.system} onChange={(event) => patchExternalAction({ system: event.target.value })} /></label>
            <label><span>推送方式</span><Select value={externalAction.action || 'api'} options={externalActionTypeOptions} onChange={(action) => patchExternalAction({ action })} /></label>
            <label><span>接口地址</span><Input placeholder="/api/external/receive" value={externalAction.endpoint} onChange={(event) => patchExternalAction({ endpoint: event.target.value })} /></label>
            <div className="professional-flow-mapping-list">
              <div className="professional-flow-mapping-head"><span>表单字段</span><span>外部字段</span><span /></div>
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
                  <Input
                    placeholder="外部字段名"
                    value={mapping.targetField}
                    onChange={(event) => patchExternalAction({
                      fieldMappings: (externalAction.fieldMappings || []).map((item) => (item.id === mapping.id ? { ...item, targetField: event.target.value } : item)),
                    })}
                  />
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
          </section>
        )}

        {selectedNode.executable && (
          <section>
            <div className="professional-flow-section-title">SLA 与异常</div>
            <label><span>处理时限(小时)</span><InputNumber min={1} max={720} value={selectedNode.slaHours} onChange={(value) => patchNode(selectedNode.id, { slaHours: Number(value || 0) })} /></label>
            <label><span>节点通知</span><Switch checked={selectedNode.notificationEnabled} onChange={(checked) => patchNode(selectedNode.id, { notificationEnabled: checked })} /></label>
            <label><span>失败策略</span><Select value={selectedNode.errorPolicy} options={[{ value: 'manual', label: '人工处理' }, { value: 'retry', label: '自动重试' }, { value: 'skip', label: '跳过继续' }]} onChange={(value) => patchNode(selectedNode.id, { errorPolicy: value })} /></label>
          </section>
        )}

        <section>
          <div className="professional-flow-section-title">节点字段权限</div>
          <div className="professional-flow-field-matrix">
            <div className="professional-flow-field-head"><span>字段</span><span>可见</span><span>可填</span><span>必填</span></div>
            {fields.map((field) => {
              const permission = selectedNode.fieldPermissions?.[field.key] || { visible: true, editable: false, required: Boolean(field.required) };
              return (
                <div className="professional-flow-field-row" key={field.key}>
                  <span>{field.name}</span>
                  <Switch size="small" checked={permission.visible} onChange={(checked) => updateFieldPermission(field.key, 'visible', checked)} />
                  <Switch size="small" checked={permission.editable} onChange={(checked) => updateFieldPermission(field.key, 'editable', checked)} />
                  <Switch size="small" checked={permission.required} onChange={(checked) => updateFieldPermission(field.key, 'required', checked)} />
                </div>
              );
            })}
          </div>
        </section>

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
      const nextField = patch.conditionField ?? selectedEdge.conditionField;
      const nextOperator = patch.conditionOperator ?? selectedEdge.conditionOperator ?? 'eq';
      const nextValue = patch.conditionValue ?? selectedEdge.conditionValue;
      patchEdge(selectedEdge.id, {
        ...patch,
        condition: buildEdgeConditionExpression(nextField, nextOperator, nextValue),
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
        <section>
          <div className="professional-flow-section-title">连线规则</div>
          <label><span>动作结果</span><Input value={selectedEdge.label} onChange={(event) => patchEdge(selectedEdge.id, { label: event.target.value })} /></label>
          <label>
            <span>条件规则</span>
            <div className="designer-rule-toggle professional-flow-edge-rule-toggle" data-rule-title="条件规则" title={conditionSummary} onClick={(event) => event.stopPropagation()}>
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
                title="设置条件规则"
              />
            </div>
          </label>
          <label><span>优先级</span><InputNumber min={1} value={selectedEdge.priority} onChange={(value) => patchEdge(selectedEdge.id, { priority: Number(value || 1) })} /></label>
          <label>
            <span>默认路径</span>
            <Switch
              checked={isSelectedEdgeFromBranch ? selectedEdge.isDefault : true}
              disabled={!isSelectedEdgeFromBranch}
              onChange={(checked) => patchEdge(selectedEdge.id, { isDefault: checked })}
            />
          </label>
          <label>
            <span>线条排布</span>
            <Button size="small" disabled={selectedEdge.routeY === undefined} onClick={() => patchEdge(selectedEdge.id, { routeY: undefined })}>重置</Button>
          </label>
        </section>
        <Modal
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
      <section>
        <div className="professional-flow-section-title">流程发布</div>
        <label><span>流程名称</span><Input value={config.name} onChange={(event) => patchConfig({ name: event.target.value })} /></label>
        <label><span>版本</span><Input value={config.version} onChange={(event) => patchConfig({ version: event.target.value })} /></label>
      </section>
      <section>
        <div className="professional-flow-section-title">表单触发</div>
        {config.triggerBindings.map((binding, index) => (
          <div className="professional-flow-trigger" key={binding.action}>
            <Switch
              checked={binding.enabled}
              onChange={(checked) => patchConfig({
                triggerBindings: config.triggerBindings.map((item, itemIndex) => (itemIndex === index ? { ...item, enabled: checked } : item)),
              })}
            />
            <Input
              value={binding.label}
              onChange={(event) => patchConfig({
                triggerBindings: config.triggerBindings.map((item, itemIndex) => (itemIndex === index ? { ...item, label: event.target.value } : item)),
              })}
            />
            <Tag>{binding.action}</Tag>
          </div>
        ))}
      </section>
      <section>
        <div className="professional-flow-section-title">状态回写字段</div>
        {([
          ['statusField', '流程状态'],
          ['currentNodeField', '当前节点'],
          ['currentAssigneeField', '当前处理人'],
          ['completedAtField', '完成时间'],
        ] as const).map(([key, label]) => (
          <label key={key}>
            <span>{label}</span>
            <Input value={config.stateMapping[key]} onChange={(event) => patchConfig({ stateMapping: { ...config.stateMapping, [key]: event.target.value } })} />
          </label>
        ))}
      </section>
    </div>
  );

  const renderProperties = () => {
    if (selection.type === 'node') return renderNodeProperties();
    if (selection.type === 'edge') return renderEdgeProperties();
    return renderCanvasProperties();
  };

  const selectedTitle = selection.type === 'nodes' ? `已选 ${selection.ids.length} 个节点` : selectedNode?.label || selectedEdge?.label || config.name;
  const selectedType = selection.type === 'nodes' ? '多选节点' : selectedNode ? '节点属性' : selectedEdge ? '连线属性' : '画布属性';

  return (
    <div className="professional-flow-designer">
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
          <small>节点库负责流程编排；字段权限、条件和状态回写在右侧属性中配置。</small>
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

      <main
        className={`professional-flow-canvas ${isPaletteDragOver ? 'professional-flow-canvas-drag-over' : ''}`}
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
        onPointerUp={() => {
          stopDrag();
          stopRouteDrag();
          stopMarqueeSelection();
        }}
        onPointerLeave={() => {
          stopDrag();
          stopRouteDrag();
          stopMarqueeSelection();
        }}
        ref={canvasRef}
      >
        <div className="professional-flow-canvas-toolbar" onClick={(event) => event.stopPropagation()}>
          <div>
            <Typography.Text strong>{config.name}</Typography.Text>
            <span>{config.nodes.length} 节点 / {config.edges.length} 连线</span>
          </div>
          <Space size={6}>
            <Button size="small" icon={<UndoOutlined />} disabled={!history.length} onClick={undo}>撤回</Button>
            <Button size="small" disabled={!future.length} onClick={redo}>重做</Button>
            <Button size="small" icon={<CopyOutlined />} disabled={!selectedNode} onClick={copySelected}>复制</Button>
            <Button size="small" disabled={!clipboardNode} onClick={pasteNode}>粘贴</Button>
            <Tag color={validation.some((item) => item.level === 'error') ? 'red' : 'success'}>
              {validation.filter((item) => item.level === 'error').length} 阻断
            </Tag>
            <Button size="small" icon={<DeleteOutlined />} disabled={selection.type === 'canvas'} onClick={deleteSelected}>删除</Button>
          </Space>
        </div>
        <svg className="professional-flow-edge-layer">
          <defs>
            <marker id="professional-flow-arrow" markerHeight="8" markerWidth="8" orient="auto" refX="7" refY="4">
              <path d="M 0 0 L 8 4 L 0 8 z" />
            </marker>
          </defs>
          {config.edges.map((edge) => {
            const from = config.nodes.find((node) => node.id === edge.source);
            const to = config.nodes.find((node) => node.id === edge.target);
            if (!from || !to) return null;
            const route = connectorRoute(from, edge.sourceSide, to, edge.targetSide, edge.routeY);
            const isActiveEdge = selection.type === 'edge' && selection.id === edge.id;
            return (
              <g key={edge.id}>
                <path
                  className={isActiveEdge ? 'professional-flow-edge-active' : ''}
                  d={route.d}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelection({ type: 'edge', id: edge.id });
                  }}
                />
                <text x={route.handle.x} y={route.handle.y - 8}>{edge.label}</text>
                <circle
                  className={`professional-flow-route-handle ${isActiveEdge || activeRouteEdgeId === edge.id ? 'professional-flow-route-handle-active' : ''}`}
                  cx={route.handle.x}
                  cy={route.handle.y}
                  r={6}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelection({ type: 'edge', id: edge.id });
                  }}
                  onPointerDown={(event) => startRouteDrag(event, edge, route.midY)}
                />
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
                d={orthogonalPath(start, pendingPort.side, connectionPreview, targetSide)}
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
            <div className="professional-flow-snap-guide-x" style={{ top: dragPreview.y }} />
            <div className="professional-flow-snap-guide-y" style={{ left: dragPreview.x }} />
            <div className="professional-flow-position-chip" style={{ left: dragPreview.x, top: dragPreview.y - 28 }}>
              x {Math.round(dragPreview.x)} / y {Math.round(dragPreview.y)}
            </div>
          </>
        )}
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
        {config.nodes.map((node) => (
          <div
            className={`professional-flow-node professional-flow-node-${node.category} ${selectedNodeIdSet.has(node.id) ? 'professional-flow-node-selected' : ''}`}
            key={node.id}
            onClick={(event) => {
              event.stopPropagation();
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
            <span className="professional-flow-node-copy">
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
      </main>

      <aside className="professional-flow-properties">
        <div className="professional-flow-panel-head">
          <div>
            <strong>{selectedType}</strong>
            <span>{selectedTitle}</span>
          </div>
          {selection.type === 'canvas' && <Button size="small" icon={<PlusOutlined />} onClick={() => addNode(nodeGroups[1].items[0])}>审批</Button>}
        </div>
        {renderProperties()}
      </aside>
    </div>
  );
}
