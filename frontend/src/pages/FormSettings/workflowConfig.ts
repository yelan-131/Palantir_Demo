import type { PlatformForm } from '@/services/api';
import { makeDefaultViewConfig, normalizeViewConfig } from '@/utils/viewConfig';
import type { ViewConfig } from '@/utils/viewConfig';
import { buildRuntimeLayout, getControlColumnSpan } from '@/utils/formLayout';
import { createDefaultFlowConfig, normalizeNodeFieldPermissions } from './ProfessionalFlowDesigner';
import type { FlowDesignerConfig, FlowDesignerEdge, FlowDesignerNode } from './ProfessionalFlowDesigner';
import { readFlowAnnotations } from './flowAnnotations';
import { readFlowWaypoints } from './flowEdgeRoute';
import { FLOW_NODE_SIZE } from './flowNodeSnap';
import type { ControlWidth, DesignerConfig, DesignerField, LayoutControl, ViewConfigMeta, WorkflowDesignerMeta } from './designerTypes';
import { mapDesignerFieldType } from './fieldBusinessType';
import { designerFieldsToViewFields, getEffectiveControlTypeForControl } from './fieldModel';

export function makeDesignerViewConfig(config: DesignerConfig): ViewConfig {
  return makeDefaultViewConfig(
    designerFieldsToViewFields(config.fields),
    config.filters.map((filter) => filter.key),
  );
}

export function makeProfessionalFlowConfig(config: DesignerConfig): FlowDesignerConfig {
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

export function shouldShiftLegacyDefaultWorkflow(nodes: FlowDesignerNode[]) {
  const legacyIds = ['start-1', 'task-1', 'task-2', 'end-1'];
  const legacyY = [80, 200, 320, 440];
  return nodes.length === legacyIds.length
    && nodes.every((node, index) => node.id === legacyIds[index] && node.x === 420 && node.y === legacyY[index]);
}

const BOUNDARY_GAP_Y = 96;

function completeBoundaryEvents(nodes: FlowDesignerNode[], edges: FlowDesignerEdge[], fallback: FlowDesignerConfig) {
  const hasStart = nodes.some((node) => node.type === 'startEvent');
  const hasEnd = nodes.some((node) => node.type === 'endEvent');
  if (hasStart && hasEnd) return { nodes, edges };

  const ids = new Set([...nodes.map((node) => node.id), ...edges.map((edge) => edge.id)]);
  const newId = (base: string) => {
    let id = base;
    for (let suffix = 2; ids.has(id); suffix += 1) id = `${base}-${suffix}`;
    ids.add(id);
    return id;
  };
  const newNodes = [...nodes];
  const newEdges = [...edges];
  const connect = (source: string, target: string, label: string, sideBySide = false) => {
    newEdges.push({
      id: newId(`${source}-${target}`), source, target, label,
      sourceSide: sideBySide ? 'left' : 'bottom', targetSide: sideBySide ? 'right' : 'top',
      priority: newEdges.length + 1, isDefault: true,
    });
  };

  if (!hasStart) {
    const targets = new Set(edges.map((edge) => edge.target));
    const roots = nodes.filter((node) => node.executable && !targets.has(node.id));
    const entry = roots.length === 1 ? roots[0] : undefined;
    const top = Math.min(...nodes.map((node) => node.y));
    const sideBySide = top < 138;
    const start = {
      ...fallback.nodes[0], id: newId('flow-start'), label: '开始',
      x: sideBySide ? Math.max(...nodes.map((node) => node.x)) + FLOW_NODE_SIZE.width + 24 : entry?.x ?? nodes[0]?.x ?? 360,
      y: Number.isFinite(top) ? Math.max(82, top - BOUNDARY_GAP_Y) : 140,
    };
    newNodes.unshift(start);
    if (entry) connect(start.id, entry.id, '提交', sideBySide);
  }

  if (!hasEnd) {
    const sources = new Set(newEdges.map((edge) => edge.source));
    const terminals = newNodes.filter((node) => node.executable && !sources.has(node.id));
    const exit = terminals.length === 1 ? terminals[0] : undefined;
    const end = {
      ...fallback.nodes[fallback.nodes.length - 1], id: newId('flow-end'), label: '结束',
      x: exit?.x ?? newNodes[0].x,
      y: Math.max(...newNodes.map((node) => node.y)) + BOUNDARY_GAP_Y,
    };
    newNodes.push(end);
    if (exit && exit.type !== 'exclusiveGateway') connect(exit.id, end.id, exit.type === 'startEvent' ? '提交' : '通过');
  }

  return { nodes: newNodes, edges: newEdges };
}

export function normalizeProfessionalFlowConfig(
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
    const firstStepY = 140 + (steps.some((step) => step.type === 'start') ? 0 : BOUNDARY_GAP_Y);
    const nodes = steps.map((step, index) => ({
      id: String(step.node_id || `legacy-${index}`),
      type: step.type === 'start' ? 'startEvent' : step.type === 'end' ? 'endEvent' : 'userTask',
      label: !step.name || /^[?\s]+$/.test(step.name) ? (step.type === 'start' ? '提交' : step.type === 'end' ? '结束' : '审批') : String(step.name),
      x: 360,
      y: firstStepY + index * 120,
      approvalMode: step.approval_mode || 'single',
      fieldPermissions: step.field_permissions,
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
  const aliases: Record<string, string> = { start: 'startEvent', end: 'endEvent', manualTask: 'userTask' };
  const executableTypes = new Set(['startEvent', 'endEvent', 'userTask', 'serviceTask', 'manualTask', 'ccTask', 'exclusiveGateway', 'parallelGateway', 'joinGateway']);
  const rawNodes = Array.isArray(source.nodes) ? source.nodes : fallback.nodes;
  let nodes = rawNodes
    .filter(Boolean)
    .map((raw, index) => {
      const node = raw as Partial<FlowDesignerNode> & { data?: Record<string, unknown>; assigneeType?: string };
      const fallbackNode = fallback.nodes[index] || fallback.nodes[0];
      const rawType = String(node.type || node.data?.type || fallbackNode?.type || 'userTask');
      const type = aliases[rawType] || rawType;
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
        ccRecipients: Array.isArray(node.ccRecipients)
          ? node.ccRecipients.filter((rule) => rule && typeof rule.id === 'string' && ['user', 'role'].includes(rule.type))
            .map((rule) => ({ ...rule, value: typeof rule.value === 'string' ? rule.value : undefined }))
          : undefined,
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
  const rawEdges = Array.isArray(source.edges) ? source.edges : Array.isArray(source.nodes) ? [] : fallback.edges;
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
        routeY: Number.isFinite(edge.routeY) ? edge.routeY : undefined,
        waypoints: readFlowWaypoints(edge.waypoints),
      } satisfies FlowDesignerEdge;
    })
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
  const rawStateMapping = (source.stateMapping || {}) as Partial<FlowDesignerConfig['stateMapping']> & Record<string, unknown>;
  const graph = completeBoundaryEvents(nodes, edges, fallback);
  return {
    ...fallback,
    ...source,
    ...graph,
    annotations: readFlowAnnotations(source.annotations, graph.nodes),
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

export function getWorkflowDesignerMeta(form?: PlatformForm | null): WorkflowDesignerMeta {
  const config = form?.config || {};
  const meta = config.workflowDesigner;
  return meta && typeof meta === 'object' ? meta as WorkflowDesignerMeta : {};
}

export function makeRuntimeFormLayout(controls: LayoutControl[], fields: DesignerField[]) {
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

export function getViewConfigMeta(form?: PlatformForm | null): ViewConfigMeta {
  const config = form?.config || {};
  const meta = config.viewConfigMeta;
  return meta && typeof meta === 'object' ? meta as ViewConfigMeta : {};
}

export function getStoredViewConfig(form: PlatformForm | null | undefined, designerConfig: DesignerConfig): ViewConfig | null {
  const config = form?.config || {};
  const stored = config.viewConfigDraft || config.viewConfig;
  if (!stored || typeof stored !== 'object') return null;
  return normalizeViewConfig(
    stored as Partial<ViewConfig>,
    designerFieldsToViewFields(designerConfig.fields),
    designerConfig.filters.map((filter) => filter.key),
  );
}

export function makeWorkflowFormConfig(config: DesignerConfig) {
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

export function makeWorkflowConfigPayload(flowConfig: FlowDesignerConfig, form: { id?: number; code: string }, config: DesignerConfig) {
  return {
    ...flowConfig,
    nodes: flowConfig.nodes.map((node) => ({ ...node, fieldPermissions: normalizeNodeFieldPermissions(node.fieldPermissions), assigneeRules: node.assigneeRules?.map((rule) => ({
      ...rule, approvalMode: rule.approvalMode || node.approvalMode || 'single',
    })) })),
    steps: undefined,
    formId: form.id,
    formCode: form.code,
    formName: config.name,
    ...(form.id ? { savedAt: new Date().toISOString() } : {}),
    fieldPermissions: Object.fromEntries(
      flowConfig.nodes.map((node) => [node.id, normalizeNodeFieldPermissions(node.fieldPermissions)]),
    ),
  };
}
