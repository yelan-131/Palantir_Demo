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
} from '@ant-design/icons';
import { Button, Input, InputNumber, Select, Space, Switch, Tag, Typography } from 'antd';

type FlowPortSide = 'top' | 'right' | 'bottom' | 'left';
type Selection = { type: 'canvas' } | { type: 'node'; id: string } | { type: 'edge'; id: string };
type NodeCategory = 'event' | 'task' | 'gateway' | 'subprocess' | 'data' | 'boundary';
type ApprovalMode = 'single' | 'orSign' | 'countersign';
type AssigneeSource = 'fixed' | 'role' | 'departmentOwner' | 'initiatorManager' | 'field';

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
  approvalMode?: ApprovalMode;
  slaHours?: number;
  notificationEnabled?: boolean;
  errorPolicy?: 'manual' | 'retry' | 'skip';
  retryTimes?: number;
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
  priority: number;
  isDefault?: boolean;
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
const NODE_HEIGHT = 76;
const SNAP_GRID = 24;
const SNAP_ORIGIN_X = 32;
const SNAP_ORIGIN_Y = 82;

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
      { key: 'manualTask', label: '处理任务', description: '人工办理、补充材料、现场处理', category: 'task', executable: true, icon: <SettingOutlined />, bpmnType: 'bpmn:ManualTask' },
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

const executableNodeTypes = new Set(['startEvent', 'endEvent', 'userTask', 'serviceTask', 'manualTask', 'ccTask', 'exclusiveGateway', 'parallelGateway', 'joinGateway']);

const assigneeSourceOptions = [
  { value: 'fixed', label: '固定人员' },
  { value: 'role', label: '角色' },
  { value: 'departmentOwner', label: '部门负责人' },
  { value: 'initiatorManager', label: '发起人上级' },
  { value: 'field', label: '表单字段人员' },
];

const approvalModeOptions = [
  { value: 'single', label: '单人审批' },
  { value: 'orSign', label: '或签' },
  { value: 'countersign', label: '会签' },
];

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
    y: 120 + index * 112,
    assigneeSource: definition.key === 'userTask' || definition.key === 'manualTask' ? 'role' : undefined,
    assigneeValue: definition.key === 'userTask' ? '流程审批人' : undefined,
    approvalMode: definition.key === 'userTask' ? 'single' : undefined,
    slaHours: definition.key === 'userTask' || definition.key === 'manualTask' ? 24 : undefined,
    notificationEnabled: definition.key !== 'startEvent',
    errorPolicy: definition.key === 'serviceTask' ? 'retry' : 'manual',
    retryTimes: definition.key === 'serviceTask' ? 3 : 0,
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
  const incompleteApprovals = config.nodes.filter((node) => node.type === 'userTask' && (!node.assigneeSource || !node.assigneeValue));
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

function connectorPath(from: FlowDesignerNode, fromSide: FlowPortSide, to: FlowDesignerNode, toSide: FlowPortSide) {
  const start = getPortPoint(from, fromSide);
  const end = getPortPoint(to, toSide);
  const fromVector = getPortVector(fromSide);
  const toVector = getPortVector(toSide);
  const offset = 34;
  const startLead = { x: start.x + fromVector.x * offset, y: start.y + fromVector.y * offset };
  const endLead = { x: end.x + toVector.x * offset, y: end.y + toVector.y * offset };
  const midY = (startLead.y + endLead.y) / 2;
  return `M ${start.x} ${start.y} L ${startLead.x} ${startLead.y} L ${startLead.x} ${midY} L ${endLead.x} ${midY} L ${endLead.x} ${endLead.y} L ${end.x} ${end.y}`;
}

function portsForNode(node: FlowDesignerNode): FlowPortSide[] {
  if (node.type === 'startEvent') return ['right', 'bottom'];
  if (node.type === 'endEvent') return ['top', 'left'];
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
  const [history, setHistory] = useState<FlowDesignerConfig[]>([]);
  const [future, setFuture] = useState<FlowDesignerConfig[]>([]);
  const [clipboardNode, setClipboardNode] = useState<FlowDesignerNode | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ id: string; startX: number; startY: number; originX: number; originY: number; snapshot?: FlowDesignerConfig } | null>(null);
  const palettePointerDragRef = useRef<{
    definition: NodeDefinition;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    dragging: boolean;
  } | null>(null);
  const suppressPaletteClickRef = useRef(false);
  const validation = useMemo(() => validateFlowDesignerConfig(config), [config]);
  const visibleNodeGroups = useMemo(
    () => nodeGroups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => item.executable),
      }))
      .filter((group) => group.items.length > 0),
    [],
  );
  const selectedNode = selection.type === 'node' ? config.nodes.find((node) => node.id === selection.id) : undefined;
  const selectedEdge = selection.type === 'edge' ? config.edges.find((edge) => edge.id === selection.id) : undefined;

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

  const handleCanvasDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setPaletteDragOver(false);
    const definitionKey = event.dataTransfer.getData('application/x-professional-flow-node') || event.dataTransfer.getData('text/plain');
    const definition = findNodeDefinition(definitionKey);
    const canvas = canvasRef.current;
    if (!definition || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    addNode(definition, {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
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
      const snapped = snapNodePosition(event.clientX - rect.left - NODE_WIDTH / 2, event.clientY - rect.top - NODE_HEIGHT / 2, canvas);
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
      x: drag.lastX - rect.left,
      y: drag.lastY - rect.top,
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
        const snapped = snapNodePosition(moveEvent.clientX - rect.left - NODE_WIDTH / 2, moveEvent.clientY - rect.top - NODE_HEIGHT / 2, canvas);
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
    dragRef.current = { id: node.id, startX: event.clientX, startY: event.clientY, originX: node.x, originY: node.y, snapshot: cloneFlowConfig(config) };
    setDragPreview({ x: node.x, y: node.y });
    setSelection({ type: 'node', id: node.id });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    const canvas = canvasRef.current;
    if (!drag || !canvas) return;
    const rawX = drag.originX + event.clientX - drag.startX;
    const rawY = drag.originY + event.clientY - drag.startY;
    const next = snapNodePosition(rawX, rawY, canvas);
    setDragPreview(next);
    if (pendingPort) {
      const rect = canvas.getBoundingClientRect();
      setConnectionPreview({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    }
    patchConfig({
      nodes: config.nodes.map((node) => (node.id === drag.id
        ? {
            ...node,
            x: next.x,
            y: next.y,
          }
        : node)),
    }, { record: false });
  };

  const updateConnectionPreview = (event: React.PointerEvent<HTMLElement>) => {
    if (!pendingPort || dragRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    setConnectionPreview({ x: event.clientX - rect.left, y: event.clientY - rect.top });
  };

  const stopDrag = () => {
    const drag = dragRef.current;
    if (drag?.snapshot) {
      const movedNode = config.nodes.find((node) => node.id === drag.id);
      const didMove = movedNode && (movedNode.x !== drag.originX || movedNode.y !== drag.originY);
      if (didMove) {
        const snapshot = drag.snapshot;
        setHistory((items) => [...items.slice(-29), snapshot]);
        setFuture([]);
      }
    }
    dragRef.current = null;
    setDragPreview(null);
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
    const duplicateEdge = config.edges.some((edge) => edge.source === pendingPort.nodeId && edge.target === node.id);
    if (duplicateEdge || pendingPort.nodeId === node.id) {
      setPendingPort(null);
      setConnectionPreview(null);
      return;
    }
    const newEdge: FlowDesignerEdge = {
      id: makeId('edge'),
      source: pendingPort.nodeId,
      sourceSide: pendingPort.side,
      target: node.id,
      targetSide: side,
      label: '通过',
      priority: config.edges.length + 1,
      isDefault: false,
    };
    patchConfig({ edges: [...config.edges, newEdge] });
    setPendingPort(null);
    setConnectionPreview(null);
    setSelection({ type: 'edge', id: newEdge.id });
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

  const nodeStatusTag = (node: FlowDesignerNode) => (
    node.executable ? <Tag color="green">可执行</Tag> : <Tag color="orange">仅建模</Tag>
  );

  const renderNodeProperties = () => {
    if (!selectedNode) return null;
    const fieldOptions = fields.map((field) => ({ value: field.key, label: field.name }));
    return (
      <div className="professional-flow-props">
        <section>
          <div className="professional-flow-section-title">节点身份</div>
          <label><span>节点名称</span><Input value={selectedNode.label} onChange={(event) => patchNode(selectedNode.id, { label: event.target.value })} /></label>
          <label><span>业务说明</span><Input value={selectedNode.description} onChange={(event) => patchNode(selectedNode.id, { description: event.target.value })} /></label>
          <label><span>执行状态</span>{nodeStatusTag(selectedNode)}</label>
        </section>

        {(selectedNode.type === 'userTask' || selectedNode.type === 'manualTask') && (
          <section>
            <div className="professional-flow-section-title">处理人规则</div>
            <label>
              <span>来源</span>
              <Select value={selectedNode.assigneeSource} options={assigneeSourceOptions} onChange={(value) => patchNode(selectedNode.id, { assigneeSource: value })} />
            </label>
            <label>
              <span>取值</span>
              {selectedNode.assigneeSource === 'field'
                ? <Select value={selectedNode.assigneeValue} options={fieldOptions} onChange={(value) => patchNode(selectedNode.id, { assigneeValue: value })} />
                : <Select value={selectedNode.assigneeValue} options={roles.map((role) => ({ value: role, label: role }))} onChange={(value) => patchNode(selectedNode.id, { assigneeValue: value })} />}
            </label>
            {selectedNode.type === 'userTask' && (
              <label>
                <span>审批方式</span>
                <Select value={selectedNode.approvalMode} options={approvalModeOptions} onChange={(value) => patchNode(selectedNode.id, { approvalMode: value })} />
              </label>
            )}
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
    return (
      <div className="professional-flow-props">
        <section>
          <div className="professional-flow-section-title">连线规则</div>
          <label><span>动作结果</span><Input value={selectedEdge.label} onChange={(event) => patchEdge(selectedEdge.id, { label: event.target.value })} /></label>
          <label><span>条件表达式</span><Input.TextArea rows={3} value={selectedEdge.condition} placeholder="例如：level == '严重' && amount > 10000" onChange={(event) => patchEdge(selectedEdge.id, { condition: event.target.value })} /></label>
          <label><span>优先级</span><InputNumber min={1} value={selectedEdge.priority} onChange={(value) => patchEdge(selectedEdge.id, { priority: Number(value || 1) })} /></label>
          <label><span>默认路径</span><Switch checked={selectedEdge.isDefault} onChange={(checked) => patchEdge(selectedEdge.id, { isDefault: checked })} /></label>
        </section>
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

  const selectedTitle = selectedNode?.label || selectedEdge?.label || config.name;
  const selectedType = selectedNode ? '节点属性' : selectedEdge ? '连线属性' : '画布属性';

  return (
    <div className="professional-flow-designer">
      <aside className="professional-flow-library">
        <div className="professional-flow-panel-head">
          <strong>专业节点库</strong>
          <Tag color="blue">{visibleNodeGroups.reduce((sum, group) => sum + group.items.length, 0)} 类</Tag>
        </div>
        <div className="professional-flow-node-groups">
          {visibleNodeGroups.map((group) => (
            <section className="professional-flow-node-group" key={group.key}>
              <div className="professional-flow-group-title">{group.title}</div>
              {group.items.map((item) => (
                <button
                  className="professional-flow-palette-card"
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
                  type="button"
                >
                  <span className="professional-flow-palette-icon">{item.icon}</span>
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.description}</small>
                  </span>
                  {item.executable ? <Tag color="green">执行</Tag> : <Tag color="orange">建模</Tag>}
                </button>
              ))}
            </section>
          ))}
        </div>
      </aside>

      <main
        className={`professional-flow-canvas ${isPaletteDragOver ? 'professional-flow-canvas-drag-over' : ''}`}
        onClick={() => setSelection({ type: 'canvas' })}
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
        onPointerMove={(event) => {
          moveDrag(event);
          updateConnectionPreview(event);
        }}
        onPointerUp={stopDrag}
        onPointerLeave={stopDrag}
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
        <svg className="professional-flow-edge-layer" aria-hidden="true">
          <defs>
            <marker id="professional-flow-arrow" markerHeight="8" markerWidth="8" orient="auto" refX="7" refY="4">
              <path d="M 0 0 L 8 4 L 0 8 z" />
            </marker>
          </defs>
          {config.edges.map((edge) => {
            const from = config.nodes.find((node) => node.id === edge.source);
            const to = config.nodes.find((node) => node.id === edge.target);
            if (!from || !to) return null;
            return (
              <g key={edge.id}>
                <path
                  className={selection.type === 'edge' && selection.id === edge.id ? 'professional-flow-edge-active' : ''}
                  d={connectorPath(from, edge.sourceSide, to, edge.targetSide)}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelection({ type: 'edge', id: edge.id });
                  }}
                />
                <text x={(from.x + to.x + NODE_WIDTH) / 2} y={(from.y + to.y + NODE_HEIGHT) / 2 - 8}>{edge.label}</text>
              </g>
            );
          })}
          {pendingPort && connectionPreview && (() => {
            const from = config.nodes.find((node) => node.id === pendingPort.nodeId);
            if (!from) return null;
            const start = getPortPoint(from, pendingPort.side);
            return (
              <path
                className="professional-flow-edge-preview"
                d={`M ${start.x} ${start.y} L ${connectionPreview.x} ${connectionPreview.y}`}
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
        {config.nodes.map((node) => (
          <div
            className={`professional-flow-node professional-flow-node-${node.category} ${selection.type === 'node' && selection.id === node.id ? 'professional-flow-node-selected' : ''}`}
            key={node.id}
            onClick={(event) => {
              event.stopPropagation();
              setSelection({ type: 'node', id: node.id });
            }}
            onPointerDown={(event) => startDrag(event, node)}
            style={{ left: node.x, top: node.y }}
          >
            <span className="professional-flow-node-icon">
              {node.type === 'startEvent' ? <PlayCircleOutlined /> : node.type === 'endEvent' ? <StopOutlined /> : node.category === 'gateway' ? <ShareAltOutlined /> : <UserSwitchOutlined />}
            </span>
            <span className="professional-flow-node-copy">
              <strong>{node.label}</strong>
              <small>{node.description}</small>
            </span>
            {nodeStatusTag(node)}
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
