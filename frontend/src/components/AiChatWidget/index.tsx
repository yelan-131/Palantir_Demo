import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Dropdown, Input, Modal, Popover, Segmented, Space, Tag, Tooltip, Typography } from 'antd';
import {
  CheckCircleOutlined,
  CloseOutlined,
  CodeOutlined,
  DeleteOutlined,
  EllipsisOutlined,
  HistoryOutlined,
  InboxOutlined,
  MessageOutlined,
  PlusOutlined,
  SearchOutlined,
  SendOutlined,
} from '@ant-design/icons';
import { useLocation } from 'react-router-dom';
import {
  cancelAgentRun,
  closeAgentConversation,
  createAgentConversation,
  listAgentConversationMessages,
  listAgentConversations,
  streamAgentChat,
  streamConfirmAgentRun,
  updateAgentConversation,
} from '@/services/api';
import { formatServerTime as formatServerClockTime, parseServerDate } from '@/utils/dateTime';
import { useAiWorkbench } from './context';
import type { AiKnowledgeContext } from './context';
import './style.css';

type ChatRole = 'assistant' | 'user';
type MockSkillStatus = 'draft_created' | 'ready_for_review';

interface MockSkillAction {
  id: string;
  skill: string;
  title: string;
  status: MockSkillStatus;
  summary: string;
  fields: Array<{ label: string; value: string }>;
  nextSteps: string[];
  payload?: Record<string, unknown>;
}

interface AgentProcessStep {
  id: string;
  label: string;
  status: string;
  detail?: string;
}

interface AgentTraceItem {
  id: string;
  kind: 'note' | 'tool' | 'result';
  content: string;
  status?: string;
  tool?: string;
  stepId?: string;
  resultCount?: number;
}

interface AgentActionState {
  skill?: string;
  status?: string;
  target?: string;
  collected_slots?: Record<string, unknown>;
  missing_slots?: string[];
}

interface AgentExecutionResult {
  kind: 'dynamic_record' | 'ai_draft' | 'form_definition' | 'generic';
  title: string;
  detail?: string;
  href?: string;
  id?: string | number;
}

interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  fullContent?: string;
  typing?: boolean;
  createdAt: string;
  actions?: MockSkillAction[];
  items?: Array<Record<string, unknown>>;
  steps?: AgentProcessStep[];
  trace?: AgentTraceItem[];
  source?: string;
  contextSources?: Record<string, number | boolean | string>;
  runId?: string;
  requiresConfirmation?: boolean;
  confirmationPayload?: Record<string, unknown>;
  actionState?: AgentActionState;
  executionResult?: AgentExecutionResult;
}

interface AgentSession {
  id: string;
  title: string;
  contextKey: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
  createdAtRaw?: string | null;
  updatedAtRaw?: string | null;
  status?: string;
}

interface AgentConversationPayload {
  conversation_id?: string;
  id?: string;
  title?: string;
  page?: string;
  document_id?: string | null;
  last_message?: string | null;
  metadata?: Record<string, unknown>;
  created_at?: string | null;
  updated_at?: string | null;
  status?: string;
}

interface AgentMessagePayload {
  message_id?: string;
  id?: string;
  role?: ChatRole;
  content?: string;
  created_at?: string | null;
  model_name?: string | null;
  usage?: Record<string, unknown> | null;
  run_id?: string;
  mode?: string;
  items?: Array<Record<string, unknown>>;
  risk_level?: string;
  requires_confirmation?: boolean;
}

interface PageContext {
  title: string;
  scope: string;
  intro: string;
}

interface AiChatWidgetProps {
  pageTitle: string;
  applicationName?: string;
}

interface AssistantReply {
  content: string;
  actions?: MockSkillAction[];
}

interface AgentSkillAction {
  skill?: string;
  title?: string;
  mode?: string;
  risk_level?: string;
  requires_confirmation?: boolean;
  payload?: Record<string, unknown>;
}

interface AgentChatResponse {
  answer?: string;
  evidence?: Array<Record<string, unknown>>;
  mode?: string;
  run_id?: string;
  requires_confirmation?: boolean;
  action_state?: AgentActionState;
  items?: Array<Record<string, unknown>>;
  conversation?: AgentConversationPayload;
  user_message?: AgentMessagePayload;
  assistant_message?: AgentMessagePayload;
}

const nowText = () => new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
const AI_WORKBENCH_PAGE = 'ai-workbench';

function getClientContextNeed(message: string, hasKnowledgeContext: boolean): string {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return 'none';
  if (hasKnowledgeContext || /文档|sop|知识|证据|这篇|当前文档|抽取|发布清单/.test(normalized)) return 'knowledge_rag';
  return 'auto';
}

function buildMessageContext(options: {
  message: string;
  sessionId: string;
  surface: string;
  route: string;
  pageContext: PageContext;
  applicationName?: string;
  knowledgeContext?: AiKnowledgeContext;
}) {
  const contextNeed = getClientContextNeed(options.message, Boolean(options.knowledgeContext));
  const base = {
    surface: contextNeed === 'knowledge_rag' && options.knowledgeContext ? 'knowledge' : 'global',
    workspace: AI_WORKBENCH_PAGE,
    contextNeed,
    conversation_id: options.sessionId,
    conversationId: options.sessionId,
  };
  return {
    ...base,
    route: options.route,
    pageTitle: options.pageContext.title,
    scope: options.pageContext.scope,
    applicationName: options.applicationName,
    documentId: options.knowledgeContext?.documentId,
    document_id: options.knowledgeContext?.documentId,
    documentTitle: options.knowledgeContext?.documentTitle,
    document_title: options.knowledgeContext?.documentTitle,
    knowledgeMode: options.knowledgeContext?.knowledgeMode,
  };
}

const contextByRoute: Array<{
  test: (pathname: string) => boolean;
  context: Omit<PageContext, 'title'> & { title?: string };
}> = [
  {
    test: (pathname) => pathname.includes('/program/device-health') || pathname === '/maintenance',
    context: {
      title: '设备健康',
      scope: '设备、健康分、故障预测、维修工单',
      intro: '我会基于当前设备维护页面提供帮助，可以解释风险、总结设备状态，也可以生成维修工单草稿。',
    },
  },
  {
    test: (pathname) => pathname.includes('/program/supply') || pathname.includes('/program/material') || pathname === '/supply-chain',
    context: {
      title: '供应链风险',
      scope: '供应商、库存、物料影响、采购建议',
      intro: '我会基于供应链页面提供帮助，可以总结供应风险、解释高风险供应商，也可以生成采购或物料申请草稿。',
    },
  },
  {
    test: (pathname) => pathname.includes('/program/quality') || pathname.includes('/program/defect') || pathname === '/quality',
    context: {
      title: '质量分析',
      scope: '缺陷、检验、SPC、CAPA、追溯',
      intro: '我会基于质量页面提供帮助，可以解释质量异常、追溯影响范围，也可以生成 CAPA 草稿。',
    },
  },
  {
    test: (pathname) => pathname.includes('/program/production') || pathname.includes('/program/oee') || pathname === '/dashboard',
    context: {
      title: '生产态势',
      scope: 'OEE、产线、计划、产量、告警',
      intro: '我会基于生产页面提供帮助，可以解释 OEE、总结产线状态，也可以生成班次摘要。',
    },
  },
  {
    test: (pathname) => pathname.includes('/workflow'),
    context: {
      title: '流程中心',
      scope: '审批、待办、退回、流程状态',
      intro: '我会基于流程中心提供帮助，可以总结待办、解释审批状态，也可以生成处理意见草稿。',
    },
  },
  {
    test: (pathname) => pathname.includes('/system-admin') || pathname.includes('/account-center'),
    context: {
      title: '平台管理',
      scope: '应用、菜单、权限、审计、AI 设置',
      intro: '我会基于平台管理页面提供帮助，可以解释配置、生成规则草稿，也可以总结审计线索。',
    },
  },
];

function buildPageContext(pathname: string, fallbackTitle: string): PageContext {
  const matched = contextByRoute.find((item) => item.test(pathname));
  if (matched) {
    return {
      title: matched.context.title || fallbackTitle,
      scope: matched.context.scope,
      intro: matched.context.intro,
    };
  }

  return {
    title: fallbackTitle || '当前页面',
    scope: '当前页面数据、操作和业务上下文',
    intro: '我在。你可以直接聊天，也可以问当前页面里的数据、流程或下一步建议。',
  };
}

function createAssistantMessage(reply: AssistantReply | string, source?: string): ChatMessage {
  return {
    id: `assistant-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role: 'assistant',
    content: typeof reply === 'string' ? reply : reply.content,
    actions: typeof reply === 'string' ? undefined : reply.actions,
    createdAt: nowText(),
    source,
  };
}

function createUserMessage(content: string): ChatMessage {
  return {
    id: `user-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role: 'user',
    content,
    createdAt: nowText(),
  };
}

function createAgentSession(contextKey: string, intro: string, title = '当前窗口'): AgentSession {
  const timestamp = nowText();
  const timestampRaw = new Date().toISOString();
  return {
    id: `agent-session-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title,
    contextKey,
    messages: [createAssistantMessage(intro)],
    createdAt: timestamp,
    updatedAt: timestamp,
    createdAtRaw: timestampRaw,
    updatedAtRaw: timestampRaw,
    status: 'active',
  };
}

function formatServerTime(value?: string | null): string {
  if (!value) return nowText();
  return formatServerClockTime(value, nowText());
}

function getSessionGroupLabel(session: AgentSession): string {
  const rawTime = session.updatedAtRaw || session.createdAtRaw;
  if (!rawTime) return 'Older';
  const date = parseServerDate(rawTime);
  if (!date) return 'Older';
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const sessionDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  if (sessionDay >= startOfToday) return '今天';
  if (sessionDay >= startOfToday - 7 * 24 * 60 * 60 * 1000) return '最近 7 天';
  return '更早';
}

function groupSessionsForHistory(sessions: AgentSession[]) {
  const labels = ['今天', '最近 7 天', '更早'];
  return labels
    .map((label) => ({
      label,
      sessions: sessions.filter((session) => getSessionGroupLabel(session) === label),
    }))
    .filter((group) => group.sessions.length);
}

function mapServerMessage(message: AgentMessagePayload): ChatMessage {
  const isAssistant = message.role !== 'user';
  const items = normalizeAgentItems(message.items);
  const confirmationPayload = getConfirmationItemPayload(items);
  const actions = getConfirmationActions(items);
  return {
    id: message.message_id || message.id || `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role: isAssistant ? 'assistant' : 'user',
    content: message.content || '',
    actions: isAssistant ? mapAgentActions(actions) : undefined,
    items: isAssistant ? items : undefined,
    steps: isAssistant ? mapAgentSteps(items) : undefined,
    trace: isAssistant ? mapTraceFromItems(items) : undefined,
    createdAt: formatServerTime(message.created_at),
    source: isAssistant && message.model_name ? `model: ${message.model_name}` : undefined,
    contextSources: isAssistant ? getContextSources({ items }) : undefined,
    runId: isAssistant ? message.run_id : undefined,
    requiresConfirmation: isAssistant ? Boolean(confirmationPayload?.confirmation_token || message.requires_confirmation) : undefined,
    confirmationPayload: isAssistant ? confirmationPayload : undefined,
  };
}

function normalizeAgentItems(items?: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return Array.isArray(items) ? items.filter((item) => item && typeof item === 'object') : [];
}

function getConfirmationItemPayload(items?: Array<Record<string, unknown>>): Record<string, unknown> | undefined {
  const item = [...(items || [])].reverse().find((entry) => entry.type === 'confirmation');
  return item?.payload && typeof item.payload === 'object' ? item.payload as Record<string, unknown> : undefined;
}

function getConfirmationActions(items?: Array<Record<string, unknown>>): AgentSkillAction[] | undefined {
  const payload = getConfirmationItemPayload(items);
  const actions = payload?.actions;
  return Array.isArray(actions) ? actions as AgentSkillAction[] : undefined;
}

function stringifyStepValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (Array.isArray(value)) return value.map((item) => String(item)).join(', ');
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).filter(Boolean).join(' / ');
  return String(value);
}

function getAgentStepLabel(step: Record<string, unknown>): string {
  const id = String(step.id || '');
  const type = String(step.type || '');
  if (id === 'step-draft-resume') return '载入待确认操作';
  if (id === 'step-action-permission') return '复核动作权限';
  if (id === 'step-tool-contract') return '读取工具合约';
  if (id === 'step-requirement-gap') return '检查缺失参数';
  if (id === 'step-identity') return '识别当前用户';
  if (id === 'step-ai-permission') return '检查 AI 授权';
  if (id === 'step-context-intent') return '判断上下文需求';
  if (id === 'step-context-builder') return '组装对话上下文';
  if (id === 'step-planner') return '规划任务路径';
  if (id === 'step-knowledge-search') return '检索知识与证据';
  if (id === 'step-skill-selection') return '选择可用工具';
  if (id === 'step-confirmation') return '等待人工确认';
  if (id.startsWith('step-skill-policy')) return '复核工具权限';
  if (id === 'step-answer') return '生成回答';
  if (type === 'intent') return '识别意图';
  if (type === 'context') return '组装上下文';
  if (type === 'tool_call') return `调用工具 ${stringifyStepValue(step.tool) || ''}`.trim();
  if (type === 'tool_result') return `工具结果 ${stringifyStepValue(step.tool) || ''}`.trim();
  if (type === 'confirmation') return '等待人工确认';
  if (type === 'validation') return '执行校验';
  if (type === 'answer') return '生成回答';
  if (type === 'error') return '处理失败';
  if (type === 'tool') return `调用工具 ${stringifyStepValue(step.tool) || ''}`.trim();
  if (type === 'policy') return '执行策略检查';
  if (type === 'plan') return '规划下一步';
  if (type === 'respond') return '生成回答';
  return '处理步骤';
}

function getAgentStepDetail(step: Record<string, unknown>): string | undefined {
  const payload = step.payload && typeof step.payload === 'object' ? step.payload as Record<string, unknown> : {};
  const parts = [
    stringifyStepValue(step.intent || payload.intent),
    stringifyStepValue(step.skill || payload.skill),
    stringifyStepValue(step.capability || payload.capability),
    stringifyStepValue(step.matched_role || payload.matched_role),
    stringifyStepValue(step.tool),
    step.result_count !== undefined ? `结果 ${step.result_count}` : '',
    step.semantic_objects !== undefined ? `对象 ${step.semantic_objects}` : '',
    step.semantic_records !== undefined ? `记录 ${step.semantic_records}` : '',
    stringifyStepValue(step.model || payload.model),
    stringifyStepValue(step.summary),
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : undefined;
}

function mapAgentSteps(steps?: Array<Record<string, unknown>>): AgentProcessStep[] | undefined {
  const visible = (steps || []).filter((step) => {
    const id = String(step.id || '');
    return id !== 'step-intent';
  });
  if (!visible.length) return undefined;
  return visible.map((step, index) => ({
    id: String(step.id || `step-${index}`),
    label: getAgentStepLabel(step),
    status: String(step.status || 'completed'),
    detail: getAgentStepDetail(step),
  }));
}

function mapAgentStep(step: Record<string, unknown>): AgentProcessStep {
  return {
    id: String(step.id || `step-${Date.now()}`),
    label: getAgentStepLabel(step),
    status: String(step.status || 'completed'),
    detail: getAgentStepDetail(step),
  };
}

function traceNoteFromStep(step: Record<string, unknown>): string | undefined {
  const id = String(step.id || '');
  if (id === 'step-confirmation') return '我已经整理好待确认动作，确认前不会写入系统。';
  return undefined;
}

function mapTraceFromItems(items?: Array<Record<string, unknown>>): AgentTraceItem[] | undefined {
  const trace = (items || [])
    .map((step, index) => {
      const tool = stringifyStepValue(step.tool);
      if (['tool_call', 'tool_result'].includes(String(step.type || '')) && tool) {
        const completed = String(step.type || '') === 'tool_result';
        return {
          id: `history-trace-tool-${String(step.id || index)}`,
          kind: completed ? 'result' as const : 'tool' as const,
          content: getTraceToolText(step, completed),
          status: String(step.status || 'completed'),
          tool,
          resultCount: typeof step.result_count === 'number' ? step.result_count : undefined,
        };
      }
      const content = traceNoteFromStep(step);
      if (!content) return undefined;
      return {
        id: `history-trace-${String(step.id || index)}`,
        kind: 'note' as const,
        content,
      };
    })
    .filter(Boolean) as AgentTraceItem[];
  return trace.length ? trace : undefined;
}

function getTraceText(data: Record<string, unknown>): string {
  return String(data.message || data.summary || data.detail || '').trim();
}

function getTraceToolText(data: Record<string, unknown>, completed: boolean): string {
  const tool = stringifyStepValue(data.tool) || '工具';
  const resultCount = data.result_count !== undefined ? ` · 结果 ${data.result_count}` : '';
  const summary = data.summary ? ` · ${stringifyStepValue(data.summary)}` : '';
  return completed
    ? `${tool} 已完成${resultCount}${summary}`
    : `调用 ${tool}`;
}

function appendAgentTraceItem(
  trace: AgentTraceItem[] | undefined,
  item: AgentTraceItem,
): AgentTraceItem[] {
  const previous = trace || [];
  const filtered = item.stepId
    ? previous.filter((existing) => existing.stepId !== item.stepId)
    : previous;
  const next = [...filtered, item];
  return next.slice(-10);
}

function createTraceItem(event: string, data: Record<string, unknown>): AgentTraceItem | undefined {
  if (event === 'assistant.note') {
    return undefined;
  }
  if (event === 'item.created' || event === 'item.updated') {
    const type = String(data.type || '');
    if (!['tool_call', 'tool_result', 'confirmation', 'validation', 'error'].includes(type)) return undefined;
    const tool = stringifyStepValue(data.tool);
    const completed = type !== 'tool_call';
    const stepId = String(data.item_id || data.id || data.tool || Date.now());
    return {
      id: `trace-item-${stepId}`,
      kind: type === 'tool_call' ? 'tool' : type === 'tool_result' ? 'result' : 'note',
      content: tool ? getTraceToolText(data, completed) : stringifyStepValue(data.summary || data.title),
      status: String(data.status || (completed ? 'completed' : 'active')),
      tool,
      stepId,
      resultCount: typeof data.result_count === 'number' ? data.result_count : undefined,
    };
  }
  if (event === 'tool.started' || event === 'tool.completed') {
    const completed = event === 'tool.completed';
    const stepId = String(data.step_id || data.tool || Date.now());
    return {
      id: `trace-tool-${stepId}`,
      kind: completed ? 'result' : 'tool',
      content: getTraceToolText(data, completed),
      status: completed ? String(data.status || 'completed') : 'active',
      tool: stringifyStepValue(data.tool),
      stepId,
      resultCount: typeof data.result_count === 'number' ? data.result_count : undefined,
    };
  }
  return undefined;
}

function mapServerConversation(
  conversation: AgentConversationPayload,
  contextKey: string,
  intro: string,
): AgentSession {
  const id = conversation.conversation_id || conversation.id || `agent-session-${Date.now()}`;
  const title = conversation.title && !/^\?+$/.test(conversation.title) ? conversation.title : '当前窗口';
  return {
    id,
    title,
    contextKey,
    messages: conversation.last_message ? [] : [createAssistantMessage(intro)],
    createdAt: formatServerTime(conversation.created_at),
    updatedAt: formatServerTime(conversation.updated_at),
    createdAtRaw: conversation.created_at,
    updatedAtRaw: conversation.updated_at,
    status: conversation.status || 'active',
  };
}

function formatActionValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '待补充';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => (
    item !== null && typeof item === 'object' && !Array.isArray(item)
  )) : [];
}

function getLowCodeReview(action: MockSkillAction) {
  if (action.skill !== 'low_code.create_form_definition') return undefined;
  const payload = asRecord(action.payload);
  const form = asRecord(payload.form);
  const menu = asRecord(payload.menu);
  const fields = asRecordArray(payload.fields);
  return {
    formName: formatActionValue(form.name),
    formCode: formatActionValue(form.code),
    description: formatActionValue(form.description),
    menuEnabled: Boolean(menu.create),
    menuTitle: formatActionValue(menu.title),
    fieldCount: fields.length,
    fields: fields.slice(0, 8).map((field) => ({
      name: formatActionValue(field.field_name),
      label: formatActionValue(field.label),
      type: formatActionValue(field.field_type),
      required: Boolean(field.required),
    })),
    hiddenFieldCount: Math.max(0, fields.length - 8),
  };
}

function formatSlotName(slot: string): string {
  const labels: Record<string, string> = {
    'form.name': '表单名称',
    fields: '字段清单',
    menu: '菜单入口',
    target: '目标对象',
    scope: '处理范围',
    reason: '业务原因',
    problem: '问题',
    containment: '临时措施',
    owner_or_due_date: '责任人/截止时间',
    asset: '设备/资产',
    problem_or_risk: '问题/风险',
    priority_or_window: '优先级/时间窗口',
    item: '物料/对象',
    quantity: '数量',
    usage: '用途',
  };
  return labels[slot] || slot;
}

function getActionStateReview(state?: AgentActionState) {
  if (!state) return undefined;
  const collected = asRecord(state.collected_slots);
  const missing = Array.isArray(state.missing_slots) ? state.missing_slots : [];
  const collectedEntries = Object.entries(collected).slice(0, 4).map(([key, value]) => ({
    label: formatSlotName(key),
    value: formatActionValue(value),
  }));
  return {
    skill: state.skill || 'agent.action',
    status: state.status || 'collecting',
    target: state.target ? formatActionValue(state.target) : '',
    collectedEntries,
    missing: missing.map(formatSlotName),
  };
}

function getDraftPreviewFields(payload?: Record<string, unknown>) {
  return Object.entries(payload || {})
    .filter(([key]) => !key.startsWith('_'))
    .slice(0, 4)
    .map(([label, value]) => ({ label: formatSlotName(label), value: formatActionValue(value) }));
}

function getGenericActionReview(action: MockSkillAction) {
  if (action.skill === 'low_code.create_form_definition') return undefined;
  const payload = asRecord(action.payload);
  const fields = getDraftPreviewFields(payload);
  return {
    title: action.title,
    sourceDraftId: typeof payload._source_draft_id === 'string' ? payload._source_draft_id : '',
    fields,
  };
}

function getPendingStateFromAction(action: MockSkillAction): AgentActionState {
  const payload = asRecord(action.payload);
  let collectedSlots: Record<string, unknown> = payload;
  if (action.skill === 'low_code.create_form_definition') {
    const form = asRecord(payload.form);
    const menu = asRecord(payload.menu);
    collectedSlots = {
      formName: form.name,
      formCode: form.code,
      form_name: form.name,
      form_code: form.code,
      description: form.description,
      fields: Array.isArray(payload.fields) ? payload.fields : [],
      createMenu: Boolean(menu.create),
      menuTitle: menu.title,
    };
  }
  return {
    skill: action.skill,
    status: 'collecting',
    collected_slots: collectedSlots,
    missing_slots: [],
  };
}

function mapAgentActions(actions?: AgentSkillAction[]): MockSkillAction[] | undefined {
  if (!actions?.length) return undefined;
  return actions.map((action) => {
    const payload = action.payload && typeof action.payload === 'object' ? action.payload : {};
    return {
      id: `${action.skill || 'agent-action'}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      skill: action.skill || 'agent.action',
      title: action.title || '待确认动作',
      status: 'ready_for_review',
      summary: action.requires_confirmation
        ? '该动作需要你确认后才会写入或提交。'
        : '这是 Agent 基于当前上下文生成的建议动作。',
      fields: Object.entries(payload).slice(0, 6).map(([label, value]) => ({
        label,
        value: formatActionValue(value),
      })),
      nextSteps: action.requires_confirmation
        ? ['复核关键配置', '需要调整就补充说明', '确认后再写入系统']
        : ['按需继续追问或调整建议'],
      payload,
    };
  });
}

function getAgentResponseSource(payload: AgentChatResponse): string {
  const items = normalizeAgentItems(payload.items);
  const answerItem = [...items].reverse().find((item) => item.type === 'answer');
  const modelConfigItem = [...items].reverse().find((item) => item.id === 'step-model-config');
  const answerPayload = answerItem?.payload && typeof answerItem.payload === 'object' ? answerItem.payload as Record<string, unknown> : {};
  const provider = typeof answerItem?.provider === 'string' ? answerItem.provider : typeof answerPayload.provider === 'string' ? answerPayload.provider : '';
  const model = typeof answerItem?.model === 'string' ? answerItem.model : typeof answerPayload.model === 'string' ? answerPayload.model : '';
  const fallbackReason = typeof answerPayload.fallback_reason === 'string' ? answerPayload.fallback_reason : '';

  if (modelConfigItem?.status === 'blocked') {
    return '未配置大模型';
  }
  if (provider || (model && model !== 'local-agent-runtime')) {
    return [provider && `provider: ${provider}`, model && `model: ${model}`].filter(Boolean).join(' / ');
  }
  if (fallbackReason) {
    return fallbackReason.includes('not configured') ? '未配置大模型' : '大模型连接失败';
  }
  if (getConfirmationActions(items)?.length) {
    return 'backend Agent: draft action generated';
  }
  return 'backend Agent';
}

function getContextSources(payload: AgentChatResponse): Record<string, number | boolean | string> | undefined {
  const contextItem = [...normalizeAgentItems(payload.items)].reverse().find((item) => item.id === 'step-context-builder');
  const contextPayload = contextItem?.payload && typeof contextItem.payload === 'object' ? contextItem.payload as Record<string, unknown> : {};
  const sources = contextItem?.sources || contextPayload.sources;
  return sources && typeof sources === 'object' && !Array.isArray(sources)
    ? sources as Record<string, number | boolean | string>
    : undefined;
}

function getConfirmationToken(payload?: Record<string, unknown>): string | undefined {
  const token = payload?.confirmation_token;
  return typeof token === 'string' ? token : undefined;
}

function getExecutionResult(result: Record<string, unknown>): AgentExecutionResult {
  const routePath = typeof result.route_path === 'string' ? result.route_path : '';
  if (routePath) {
    return {
      kind: 'form_definition',
      title: '表单已创建',
      detail: routePath,
      href: routePath,
    };
  }
  const recordId = result.record_id;
  const formCode = typeof result.form_code === 'string' ? result.form_code : '';
  const formName = typeof result.form_name === 'string' ? result.form_name : formCode;
  if (recordId !== undefined && formCode) {
    return {
      kind: 'dynamic_record',
      title: '动态记录草稿已创建',
      detail: [formName, `记录 ${recordId}`].filter(Boolean).join(' · '),
      href: `/dynamic/${formCode}?recordId=${recordId}`,
      id: recordId as string | number,
    };
  }
  const draftId = typeof result.draft_id === 'string' ? result.draft_id : '';
  if (draftId) {
    return {
      kind: 'ai_draft',
      title: '待确认操作已保存',
      detail: draftId,
      id: draftId,
    };
  }
  return {
    kind: 'generic',
    title: '已确认执行',
  };
}

function getStatusLabel(status: MockSkillStatus) {
  return status === 'draft_created' ? '草稿已生成' : '待复核';
}

function generateUnavailableReply(): AssistantReply {
  return {
    content: '当前无法连接后端 AI 服务。请先确认后端服务、登录状态和大模型配置可用后再试。',
  };
}

export default function AiChatWidget({ pageTitle, applicationName }: AiChatWidgetProps) {
  const location = useLocation();
  const { knowledgeContext } = useAiWorkbench();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState('');
  const [historyScope, setHistoryScope] = useState<'recent' | 'archived'>('recent');
  const [archivedSessions, setArchivedSessions] = useState<AgentSession[]>([]);
  const [sending, setSending] = useState(false);
  const [confirmingRunId, setConfirmingRunId] = useState<string>();
  const [confirmationNotes, setConfirmationNotes] = useState<Record<string, string>>({});
  const [renamingSessionId, setRenamingSessionId] = useState<string>();
  const [renamingTitle, setRenamingTitle] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);

  const pageContext = useMemo(
    () => buildPageContext(location.pathname, pageTitle),
    [location.pathname, pageTitle],
  );
  const surface = knowledgeContext ? 'knowledge' : 'global';
  const contextKey = AI_WORKBENCH_PAGE;
  const intro = '我是独立 AI 工作区。你可以直接聊天；当你问到当前页面、表单、数据、知识文档或业务分析时，我会按需读取相关上下文。';
  const activeSession = sessions.find((session) => session.id === activeSessionId) || sessions[0];
  const messages = activeSession?.messages || [];

  useEffect(() => {
    let active = true;
    const contextPayload = {
      surface: 'global',
      workspace: AI_WORKBENCH_PAGE,
    };
    const bootstrapSessions = async () => {
      try {
        const response = await listAgentConversations({
          page: AI_WORKBENCH_PAGE,
          surface: 'global',
          limit: 30,
        });
        const rows = ((response.data?.data || []) as AgentConversationPayload[])
          .map((conversation) => mapServerConversation(conversation, contextKey, intro));
        if (!active) return;
        if (rows.length) {
          setSessions(rows);
          setActiveSessionId(rows[0].id);
          setHistoryOpen(false);
          setInput('');
          return;
        }
        const created = await createAgentConversation({
          title: '当前窗口',
          page: AI_WORKBENCH_PAGE,
          context: contextPayload,
        });
        const session = mapServerConversation(created.data?.data || {}, contextKey, intro);
        if (!active) return;
        setSessions([session]);
        setActiveSessionId(session.id);
        setHistoryOpen(false);
        setInput('');
      } catch {
        if (!active) return;
        const nextSession = createAgentSession(contextKey, intro);
        setSessions([nextSession]);
        setActiveSessionId(nextSession.id);
        setHistoryOpen(false);
        setInput('');
      }
    };
    void bootstrapSessions();
    return () => {
      active = false;
    };
  }, [contextKey, intro]);

  useEffect(() => {
    if (!activeSession?.id || activeSession.messages.length) return;
    let active = true;
    listAgentConversationMessages(activeSession.id)
      .then((response) => {
        if (!active) return;
        const loadedMessages = ((response.data?.data || []) as AgentMessagePayload[]).map(mapServerMessage);
        setSessionMessages(activeSession.id, loadedMessages.length ? loadedMessages : [createAssistantMessage(intro)]);
      })
      .catch(() => {
        if (active) setSessionMessages(activeSession.id, [createAssistantMessage(intro)]);
      });
    return () => {
      active = false;
    };
  }, [activeSession?.id, activeSession?.messages.length, intro]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, open]);

  useEffect(() => {
    document.body.classList.toggle('ai-workbench-open', open);
    return () => document.body.classList.remove('ai-workbench-open');
  }, [open]);

  const loadHistoryConversations = async () => {
    try {
      const response = await listAgentConversations({
        page: AI_WORKBENCH_PAGE,
        surface: 'global',
        include_closed: true,
        limit: 80,
      });
      const rows = ((response.data?.data || []) as AgentConversationPayload[])
        .map((conversation) => mapServerConversation(conversation, contextKey, intro));
      setArchivedSessions(rows.filter((session) => session.status === 'closed'));
    } catch {
      setArchivedSessions([]);
    }
  };

  const setSessionMessages = (sessionId: string, nextMessages: ChatMessage[]) => {
    setSessions((prev) => prev.map((session) => (
      session.id === sessionId
        ? { ...session, messages: nextMessages, updatedAt: nowText() }
        : session
    )));
  };

  const updateSessionMessage = (
    sessionId: string,
    messageId: string,
    updater: (message: ChatMessage) => ChatMessage,
  ) => {
    setSessions((prev) => prev.map((session) => (
      session.id === sessionId
        ? {
          ...session,
          messages: session.messages.map((message) => (
            message.id === messageId ? updater(message) : message
          )),
          updatedAt: nowText(),
        }
        : session
    )));
  };

  useEffect(() => {
    if (!activeSession?.id) return;
    const typingMessage = messages.find((message) => (
      message.role === 'assistant'
      && message.typing
      && message.fullContent !== undefined
    ));
    if (!typingMessage) return;

    const targetChars = Array.from(typingMessage.fullContent || '');
    const currentSize = Array.from(typingMessage.content).length;
    if (currentSize >= targetChars.length) {
      setSessionMessages(activeSession.id, messages.map((message) => (
        message.id === typingMessage.id
          ? { ...message, content: typingMessage.fullContent || '', fullContent: undefined, typing: false }
          : message
      )));
      return;
    }

    const timer = window.setTimeout(() => {
      const nextContent = targetChars.slice(0, currentSize + 1).join('');
      setSessionMessages(activeSession.id, messages.map((message) => (
        message.id === typingMessage.id
          ? { ...message, content: nextContent }
          : message
      )));
      bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' });
    }, 18);

    return () => window.clearTimeout(timer);
  }, [activeSession?.id, messages]);

  const startNewSession = async () => {
    const title = `窗口 ${sessions.length + 1}`;
    const contextPayload = {
      surface: 'global',
      workspace: AI_WORKBENCH_PAGE,
    };
    try {
      const created = await createAgentConversation({
        title,
        page: AI_WORKBENCH_PAGE,
        context: contextPayload,
      });
      const nextSession = mapServerConversation(created.data?.data || {}, contextKey, intro);
      nextSession.title = title;
      setSessions((prev) => [nextSession, ...prev]);
      setActiveSessionId(nextSession.id);
      setHistoryOpen(false);
      setInput('');
    } catch {
      const nextSession = createAgentSession(contextKey, intro, title);
      setSessions((prev) => [...prev, nextSession]);
      setActiveSessionId(nextSession.id);
      setHistoryOpen(false);
      setInput('');
    }
  };

  const closeSession = (sessionId: string) => {
    const targetSession = sessions.find((session) => session.id === sessionId);
    if (!targetSession) {
      setOpen(false);
      return;
    }
    if (sessions.length <= 1) {
      void closeAgentConversation(targetSession.id);
      setOpen(false);
      return;
    }
    const targetIndex = sessions.findIndex((session) => session.id === targetSession.id);
    const remaining = sessions.filter((session) => session.id !== targetSession.id);
    const nextSession = targetSession.id === activeSession?.id
      ? remaining[Math.max(0, targetIndex - 1)] || remaining[0]
      : activeSession;
    void closeAgentConversation(targetSession.id);
    setSessions(remaining);
    if (nextSession) setActiveSessionId(nextSession.id);
    setHistoryOpen(false);
  };

  const archiveSession = (sessionId: string, keepHistoryVisible = false) => {
    const targetSession = sessions.find((session) => session.id === sessionId);
    if (!targetSession) return;
    const targetIndex = sessions.findIndex((session) => session.id === targetSession.id);
    const remaining = sessions.filter((session) => session.id !== targetSession.id);
    void closeAgentConversation(targetSession.id);
    setSessions(remaining);
    setArchivedSessions((prev) => [{ ...targetSession, status: 'closed', updatedAt: nowText() }, ...prev]);
    if (targetSession.id === activeSession?.id) {
      const nextSession = remaining[Math.max(0, targetIndex - 1)] || remaining[0];
      if (nextSession) {
        setActiveSessionId(nextSession.id);
      } else {
        void startNewSession();
      }
    }
    if (keepHistoryVisible) {
      setHistoryScope('archived');
      setHistoryOpen(true);
    } else {
      setHistoryOpen(false);
    }
  };

  const restoreSession = async (session: AgentSession) => {
    const restoredSession = { ...session, status: 'active', updatedAt: nowText() };
    setArchivedSessions((prev) => prev.filter((item) => item.id !== session.id));
    setSessions((prev) => [restoredSession, ...prev.filter((item) => item.id !== session.id)]);
    setActiveSessionId(session.id);
    setHistoryScope('recent');
    setHistoryOpen(false);
    try {
      await updateAgentConversation(session.id, { status: 'active' });
    } catch {
      setSessions((prev) => prev.filter((item) => item.id !== session.id));
      setArchivedSessions((prev) => [session, ...prev]);
    }
  };

  const deleteArchivedSession = (session: AgentSession) => {
    Modal.confirm({
      title: '删除已归档窗口？',
      content: '删除后该对话不会再显示，系统仍会保留必要的审计和追溯记录。',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        setArchivedSessions((prev) => prev.filter((item) => item.id !== session.id));
        try {
          await updateAgentConversation(session.id, { status: 'deleted' });
        } catch {
          setArchivedSessions((prev) => [session, ...prev]);
        }
      },
    });
  };

  const beginRenameSession = (session: AgentSession) => {
    setActiveSessionId(session.id);
    setHistoryOpen(false);
    setRenamingSessionId(session.id);
    setRenamingTitle(session.title || '当前窗口');
  };

  const cancelRenameSession = () => {
    setRenamingSessionId(undefined);
    setRenamingTitle('');
  };

  const commitRenameSession = async (session: AgentSession) => {
    const title = renamingTitle.trim().slice(0, 80);
    if (!title || title === session.title) {
      cancelRenameSession();
      return;
    }
    const previousTitle = session.title;
    setSessions((prev) => prev.map((item) => (
      item.id === session.id ? { ...item, title, updatedAt: nowText() } : item
    )));
    cancelRenameSession();
    try {
      await updateAgentConversation(session.id, { title });
    } catch {
      setSessions((prev) => prev.map((item) => (
        item.id === session.id ? { ...item, title: previousTitle } : item
      )));
    }
  };

  const sendMessage = async (content: string, extraContext?: Record<string, unknown>) => {
    const trimmed = content.trim();
    if (!trimmed || sending || !activeSession) return;

    const userMessage = createUserMessage(trimmed);
    const assistantMessageId = `assistant-stream-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const assistantPlaceholder: ChatMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      createdAt: nowText(),
      steps: [{
        id: 'run-accepted-local',
        label: '连接 AI Agent',
        status: 'active',
        detail: '等待后端确认任务已接收',
      }],
    };
    const pending = [...messages, userMessage, assistantPlaceholder];
    const sessionId = activeSession.id;
    setSessionMessages(sessionId, pending);
    setInput('');
    setSending(true);
    try {
      const runtimeContext = buildMessageContext({
        message: trimmed,
        sessionId,
        surface,
        route: location.pathname,
        pageContext,
        applicationName,
        knowledgeContext,
      });
      Object.assign(runtimeContext, extraContext || {});
      await streamAgentChat({
        message: trimmed,
        page: AI_WORKBENCH_PAGE,
        context: runtimeContext,
      }, ({ event, data }) => {
        const traceItem = createTraceItem(event, data);
        if (traceItem) {
          updateSessionMessage(sessionId, assistantMessageId, (message) => ({
            ...message,
            trace: appendAgentTraceItem(message.trace, traceItem),
          }));
          return;
        }
        if (event === 'run.accepted') {
          updateSessionMessage(sessionId, assistantMessageId, (message) => ({
            ...message,
            steps: [{
              id: 'run-accepted',
              label: '后端已接收任务',
              status: 'completed',
              detail: typeof data.message === 'string' ? data.message : undefined,
            }],
          }));
          return;
        }
        if (event === 'item.created' || event === 'item.updated') {
          const rawItem = data.item && typeof data.item === 'object'
            ? data.item as Record<string, unknown>
            : data;
          const nextStep = mapAgentStep(rawItem);
          updateSessionMessage(sessionId, assistantMessageId, (message) => {
            const items = message.items || [];
            const itemId = String(rawItem.item_id || rawItem.id || nextStep.id);
            const itemExisting = items.findIndex((item) => String(item.item_id || item.id) === itemId);
            const nextItems = itemExisting >= 0
              ? items.map((item, index) => (index === itemExisting ? rawItem : item))
              : [...items, rawItem];
            const steps = message.steps || [];
            const existing = steps.findIndex((step) => step.id === nextStep.id);
            const nextSteps = existing >= 0
              ? steps.map((step, index) => (index === existing ? nextStep : step))
              : [...steps, nextStep];
            const confirmationPayload = getConfirmationItemPayload(nextItems);
            return {
              ...message,
              items: nextItems,
              steps: nextSteps,
              actions: mapAgentActions(getConfirmationActions(nextItems)) || message.actions,
              requiresConfirmation: Boolean(confirmationPayload?.confirmation_token || message.requiresConfirmation),
              confirmationPayload: confirmationPayload || message.confirmationPayload,
            };
          });
          return;
        }
        if (event === 'answer.completed') {
          const payload = data as AgentChatResponse;
          const answerContent = payload.answer || payload.assistant_message?.content || '后端没有返回可展示的回答。';
          updateSessionMessage(sessionId, assistantMessageId, (message) => ({
            ...message,
            content: '',
            fullContent: answerContent,
            typing: true,
            actions: mapAgentActions(getConfirmationActions(payload.items)) || message.actions,
            items: normalizeAgentItems(payload.items) || message.items,
            steps: mapAgentSteps(payload.items) || message.steps,
            source: getAgentResponseSource(payload),
            contextSources: getContextSources(payload),
            runId: payload.run_id,
            requiresConfirmation: Boolean(getConfirmationItemPayload(payload.items)?.confirmation_token || payload.requires_confirmation),
            confirmationPayload: getConfirmationItemPayload(payload.items),
            actionState: payload.action_state,
          }));
          if (payload.conversation) {
            const updated = mapServerConversation(payload.conversation, contextKey, intro);
            setSessions((prev) => prev.map((session) => (
              session.id === sessionId
                ? { ...session, title: updated.title, updatedAt: updated.updatedAt }
                : session
            )));
          }
          return;
        }
        if (event === 'run.failed') {
          const errorContent = `执行失败：${String(data.detail || '未知错误')}`;
          updateSessionMessage(sessionId, assistantMessageId, (message) => ({
            ...message,
            content: '',
            fullContent: errorContent,
            typing: true,
            source: 'Agent 事件流',
          }));
        }
      });
    } catch {
      updateSessionMessage(sessionId, assistantMessageId, (message) => ({
        ...message,
        content: '',
        fullContent: generateUnavailableReply().content,
        typing: true,
        source: '无法连接后端 AI 事件流',
      }));
    } finally {
      setSending(false);
    }
  };

  const confirmAgentAction = async (message: ChatMessage) => {
    const runId = message.runId;
    const token = getConfirmationToken(message.confirmationPayload);
    if (!runId || !token || !activeSession) return;
    setConfirmingRunId(runId);
    const sessionId = activeSession.id;

    const applyCompletedRun = (run: Record<string, unknown>) => {
      const results = Array.isArray(run.tool_results) ? run.tool_results : [];
      const completed = results.find((item) => (
        item && typeof item === 'object' && (item as Record<string, unknown>).status === 'completed'
      )) as Record<string, unknown> | undefined;
      const nested = completed?.result && typeof completed.result === 'object'
        ? completed.result as Record<string, unknown>
        : {};
      const result = nested.result && typeof nested.result === 'object'
        ? nested.result as Record<string, unknown>
        : nested;
      const executionResult = getExecutionResult(result);
      const routePath = executionResult.href || '';
      updateSessionMessage(sessionId, message.id, (item) => {
        const currentContent = item.fullContent || item.content;
        return {
          ...item,
          content: routePath
            ? `${currentContent}\n\n已确认执行，表单已创建：${routePath}`
            : `${currentContent}\n\n已确认执行。`,
          fullContent: undefined,
          typing: false,
          requiresConfirmation: false,
          actionState: undefined,
          executionResult,
          source: 'backend Agent: confirmed execution',
        };
      });
    };

    try {
      await streamConfirmAgentRun(runId, {
        confirmation_token: token,
        confirmed: true,
      }, ({ event, data }) => {
        const traceItem = createTraceItem(event, data);
        if (traceItem) {
          updateSessionMessage(sessionId, message.id, (item) => ({
            ...item,
            trace: appendAgentTraceItem(item.trace, traceItem),
          }));
          return;
        }
        if (event === 'item.created' || event === 'item.updated') {
          const rawItem = data.item && typeof data.item === 'object'
            ? data.item as Record<string, unknown>
            : data;
          updateSessionMessage(sessionId, message.id, (item) => {
            const items = item.items || [];
            const itemId = String(rawItem.item_id || rawItem.id || Date.now());
            const existing = items.findIndex((entry) => String(entry.item_id || entry.id) === itemId);
            const nextItems = existing >= 0
              ? items.map((entry, index) => (index === existing ? rawItem : entry))
              : [...items, rawItem];
            return {
              ...item,
              items: nextItems,
              steps: mapAgentSteps(nextItems) || item.steps,
            };
          });
          return;
        }
        if (event === 'run.completed') {
          const run = asRecord(data.run);
          applyCompletedRun(run);
          return;
        }
        if (event === 'run.failed') {
          const detail = String(data.detail || 'unknown error');
          updateSessionMessage(sessionId, message.id, (item) => ({
            ...item,
            content: `${item.fullContent || item.content}\n\n确认执行失败：${detail}`,
            fullContent: undefined,
            typing: false,
          }));
        }
      });
    } catch (error) {
      const detail = (error as { response?: { data?: { detail?: string } }; message?: string })?.response?.data?.detail
        || (error as { message?: string })?.message
        || 'unknown error';
      updateSessionMessage(sessionId, message.id, (item) => ({
        ...item,
        content: `${item.fullContent || item.content}\n\n确认执行失败：${detail}`,
        fullContent: undefined,
        typing: false,
      }));
    } finally {
      setConfirmingRunId(undefined);
    }
  };

  const cancelAgentAction = async (message: ChatMessage) => {
    const runId = message.runId;
    if (!runId || !activeSession) return;
    setConfirmingRunId(runId);
    try {
      await cancelAgentRun(runId);
      const nextMessages = messages.map((item) => (
        item.id === message.id
          ? {
            ...item,
            content: `${item.fullContent || item.content}\n\n已取消执行。`,
            fullContent: undefined,
            typing: false,
            requiresConfirmation: false,
            actionState: undefined,
            source: 'backend Agent: cancelled',
          }
          : item
      ));
      setSessionMessages(activeSession.id, nextMessages);
    } catch {
      const nextMessages = messages.map((item) => (
        item.id === message.id
          ? {
            ...item,
            content: `${item.fullContent || item.content}\n\n取消失败，请稍后再试。`,
            fullContent: undefined,
            typing: false,
          }
          : item
      ));
      setSessionMessages(activeSession.id, nextMessages);
    } finally {
      setConfirmingRunId(undefined);
    }
  };

  const sendConfirmationAdjustment = (action: MockSkillAction) => {
    const note = messageScopedNote(action.id).trim();
    if (!note) return;
    setConfirmationNotes((prev) => ({ ...prev, [action.id]: '' }));
    const pendingActionState = getPendingStateFromAction(action);
    void sendMessage(`请调整刚才的 ${action.title}：${note}`, {
      pendingActionState,
      pending_action_state: pendingActionState,
    });
  };

  const messageScopedNote = (actionId: string) => confirmationNotes[actionId] || '';
  const historySourceSessions = historyScope === 'archived' ? archivedSessions : sessions;
  const filteredHistorySessions = historySourceSessions.filter((session) => {
    const query = historyQuery.trim().toLowerCase();
    if (!query) return true;
    return `${session.title} ${session.messages.length} ${session.updatedAt}`.toLowerCase().includes(query);
  });
  const historyGroups = groupSessionsForHistory(filteredHistorySessions);

  const chatWorkbench = (
          <div className="ai-workbench-chat">
          <div className="ai-chat-body" ref={bodyRef}>
            {messages.map((message) => {
              const hasContent = Boolean(message.content.trim());
              const isTypingAssistant = message.role === 'assistant' && Boolean(message.typing);
              const hasAnswer = hasContent || Boolean(message.fullContent?.trim());
              const hasTraceOrSteps = Boolean(message.trace?.length || message.steps?.length);
              const isPendingAssistant = message.role === 'assistant' && hasTraceOrSteps && !hasAnswer;
              const canShowAssistantMeta = message.role === 'assistant' && !isTypingAssistant;
              const actionStateReview = message.role === 'assistant' ? getActionStateReview(message.actionState) : undefined;
              const traceItems = message.trace || [];
              const completedToolCount = traceItems.filter((item) => item.kind === 'result').length;
              const runningToolCount = traceItems.filter((item) => item.kind === 'tool').length;
              const toolTraceCount = completedToolCount + runningToolCount;
              const traceSummary = runningToolCount
                ? `正在运行 ${runningToolCount} 个工具`
                : toolTraceCount
                  ? `已运行 ${completedToolCount} 个工具`
                  : '已整理确认信息';

              return (
              <div className={`ai-chat-message ${message.role}`} key={message.id}>
                <div className="ai-chat-bubble">
                  {message.role === 'assistant' && traceItems.length ? (
                    <details className="ai-agent-trace" open={isPendingAssistant}>
                      <summary>{traceSummary}</summary>
                      <div className="ai-agent-trace-list">
                        {traceItems.map((item) => (
                          <div className={`ai-agent-trace-item ${item.kind}`} key={item.id}>
                            <span className="ai-agent-trace-marker" />
                            <div>
                              {item.kind === 'tool' ? <small>工具调用</small> : null}
                              {item.kind === 'result' ? <small>工具结果</small> : null}
                              {item.kind === 'note' ? <small>状态</small> : null}
                              <span>{item.content}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </details>
                  ) : null}
                  <Typography.Text className={isPendingAssistant ? 'ai-chat-pending-text' : undefined} type={isPendingAssistant ? 'secondary' : undefined}>
                    {hasContent ? message.content : (isPendingAssistant ? '正在处理...' : '')}
                    {isTypingAssistant ? <span className="ai-typing-cursor" /> : null}
                  </Typography.Text>
                  {canShowAssistantMeta && message.source ? (
                    <span className="ai-chat-source">{message.source}</span>
                  ) : null}
                  {canShowAssistantMeta && message.contextSources ? (
                    <div className="ai-context-source-row">
                      <Tag>最近消息 {message.contextSources.recent_messages ?? 0}</Tag>
                      <Tag>记忆 {message.contextSources.memories ?? 0}</Tag>
                      <Tag>证据 {message.contextSources.evidence ?? 0}</Tag>
                      {message.contextSources.semantic_objects ? <Tag>语义对象 {message.contextSources.semantic_objects}</Tag> : null}
                      {message.contextSources.semantic_records ? <Tag>数据记录 {message.contextSources.semantic_records}</Tag> : null}
                    </div>
                  ) : null}
                  {canShowAssistantMeta && actionStateReview && actionStateReview.status !== 'ready_for_confirmation' ? (
                    <div className="ai-action-state-panel">
                      <div className="ai-action-state-head">
                        <span>正在收集动作参数</span>
                        <code>{actionStateReview.skill}</code>
                      </div>
                      {actionStateReview.target ? <small>目标：{actionStateReview.target}</small> : null}
                      {actionStateReview.collectedEntries.length ? (
                        <div className="ai-action-state-tags">
                          {actionStateReview.collectedEntries.map((item) => (
                            <Tag key={`${item.label}-${item.value}`}>{item.label}: {item.value}</Tag>
                          ))}
                        </div>
                      ) : null}
                      {actionStateReview.missing.length ? (
                        <div className="ai-action-state-missing">
                          还需要：{actionStateReview.missing.join('、')}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {canShowAssistantMeta && message.executionResult ? (
                    <div className="ai-execution-result">
                      <div>
                        <strong>{message.executionResult.title}</strong>
                        {message.executionResult.detail ? <small>{message.executionResult.detail}</small> : null}
                      </div>
                      {message.executionResult.href ? (
                        <Button size="small" href={message.executionResult.href}>
                          打开
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                  {canShowAssistantMeta && message.actions?.length ? (
                    <div className="ai-skill-action-list">
                      {message.actions.map((action) => {
                        const review = getLowCodeReview(action);
                        const genericReview = getGenericActionReview(action);
                        const note = messageScopedNote(action.id);
                        return (
                        <article className="ai-skill-action-card" key={action.id}>
                          <div className="ai-skill-action-head">
                            <span className="ai-skill-action-icon">
                              <CodeOutlined />
                            </span>
                            <div>
                              <Typography.Text strong>{action.title}</Typography.Text>
                              <code>{action.skill}</code>
                            </div>
                            <Tag color="green" icon={<CheckCircleOutlined />}>
                              {getStatusLabel(action.status)}
                            </Tag>
                          </div>
                          <Typography.Paragraph className="ai-skill-action-summary">
                            {action.summary}
                          </Typography.Paragraph>
                          {review ? (
                            <div className="ai-confirm-review">
                              <div className="ai-confirm-review-head">
                                <div>
                                  <Typography.Text strong>{review.formName}</Typography.Text>
                                  <small>{review.formCode}</small>
                                </div>
                                <Tag color={review.menuEnabled ? 'blue' : 'default'}>
                                  {review.menuEnabled ? `菜单：${review.menuTitle}` : '不创建菜单入口'}
                                </Tag>
                              </div>
                              <div className="ai-confirm-review-meta">
                                <span>字段 {review.fieldCount}</span>
                                <span>{review.description}</span>
                              </div>
                              <div className="ai-confirm-field-list">
                                {review.fields.map((field) => (
                                  <div className="ai-confirm-field-item" key={`${action.id}-${field.name}`}>
                                    <span>{field.label}</span>
                                    <small>{field.name} · {field.type}{field.required ? ' · 必填' : ''}</small>
                                  </div>
                                ))}
                                {review.hiddenFieldCount ? (
                                  <div className="ai-confirm-field-more">还有 {review.hiddenFieldCount} 个字段</div>
                                ) : null}
                              </div>
                              {message.requiresConfirmation && message.runId ? (
                                <div className="ai-confirm-adjust">
                                  <Input.TextArea
                                    value={note}
                                    rows={2}
                                    placeholder="需要调整就写在这里，例如：字段增加供应商等级，菜单放到供应链风险下面"
                                    disabled={sending || confirmingRunId === message.runId}
                                    onChange={(event) => {
                                      setConfirmationNotes((prev) => ({ ...prev, [action.id]: event.target.value }));
                                    }}
                                  />
                                  <div className="ai-confirm-actions">
                                    <Button
                                      size="small"
                                      disabled={!note.trim() || sending || confirmingRunId === message.runId}
                                      onClick={() => sendConfirmationAdjustment(action)}
                                    >
                                      提交调整
                                    </Button>
                                    <Button
                                      size="small"
                                      disabled={sending || confirmingRunId === message.runId}
                                      onClick={() => { void cancelAgentAction(message); }}
                                    >
                                      取消
                                    </Button>
                                    <Button
                                      type="primary"
                                      size="small"
                                      icon={<CheckCircleOutlined />}
                                      loading={confirmingRunId === message.runId}
                                      onClick={() => { void confirmAgentAction(message); }}
                                    >
                                      确认写入
                                    </Button>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          ) : genericReview ? (
                            <div className="ai-confirm-review ai-generic-confirm-review">
                              <div className="ai-confirm-review-head">
                                <div>
                                  <Typography.Text strong>{genericReview.title}</Typography.Text>
                                  <small>{genericReview.sourceDraftId ? `来源草稿 ${genericReview.sourceDraftId}` : action.skill}</small>
                                </div>
                                <Tag color="orange">待确认</Tag>
                              </div>
                              <div className="ai-confirm-field-list">
                                {genericReview.fields.map((field) => (
                                  <div className="ai-confirm-field-item" key={`${action.id}-${field.label}`}>
                                    <span>{field.label}</span>
                                    <small>{field.value}</small>
                                  </div>
                                ))}
                              </div>
                              {message.requiresConfirmation && message.runId ? (
                                <div className="ai-confirm-adjust">
                                  <Input.TextArea
                                    value={note}
                                    rows={2}
                                    placeholder="需要补充或调整，就写在这里；Agent 会重新整理确认清单。"
                                    disabled={sending || confirmingRunId === message.runId}
                                    onChange={(event) => {
                                      setConfirmationNotes((prev) => ({ ...prev, [action.id]: event.target.value }));
                                    }}
                                  />
                                  <div className="ai-confirm-actions">
                                    <Button
                                      size="small"
                                      disabled={!note.trim() || sending || confirmingRunId === message.runId}
                                      onClick={() => sendConfirmationAdjustment(action)}
                                    >
                                      提交调整
                                    </Button>
                                    <Button
                                      size="small"
                                      disabled={sending || confirmingRunId === message.runId}
                                      onClick={() => { void cancelAgentAction(message); }}
                                    >
                                      取消
                                    </Button>
                                    <Button
                                      type="primary"
                                      size="small"
                                      icon={<CheckCircleOutlined />}
                                      loading={confirmingRunId === message.runId}
                                      onClick={() => { void confirmAgentAction(message); }}
                                    >
                                      确认执行
                                    </Button>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            <dl className="ai-skill-action-fields">
                              {action.fields.map((field) => (
                                <div key={`${action.id}-${field.label}`}>
                                  <dt>{field.label}</dt>
                                  <dd>{field.value}</dd>
                                </div>
                              ))}
                            </dl>
                          )}
                          <div className="ai-skill-action-next">
                            <Typography.Text type="secondary">后续动作</Typography.Text>
                            <ol>
                              {action.nextSteps.map((step) => (
                                <li key={`${action.id}-${step}`}>{step}</li>
                              ))}
                            </ol>
                          </div>
                          {!review && !genericReview && message.requiresConfirmation && message.runId ? (
                            <Space size={6}>
                              <Button
                                size="small"
                                disabled={confirmingRunId === message.runId}
                                onClick={() => { void cancelAgentAction(message); }}
                              >
                                取消
                              </Button>
                              <Button
                              type="primary"
                              size="small"
                              icon={<CheckCircleOutlined />}
                              loading={confirmingRunId === message.runId}
                              onClick={() => { void confirmAgentAction(message); }}
                            >
                              确认执行
                              </Button>
                            </Space>
                          ) : null}
                        </article>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
                <span>{message.createdAt}</span>
              </div>
              );
            })}
          </div>

          <div className="ai-chat-input">
            <Input.TextArea
              value={input}
              placeholder="问我当前页面的问题，或让我准备待确认操作..."
              autoSize={{ minRows: 1, maxRows: 3 }}
              disabled={sending}
              onChange={(event) => setInput(event.target.value)}
              onPressEnter={(event) => {
                if (!event.shiftKey) {
                  event.preventDefault();
                  void sendMessage(input);
                }
              }}
            />
            <Button type="primary" icon={<SendOutlined />} loading={sending} onClick={() => { void sendMessage(input); }} />
          </div>
    </div>
  );

  const historyOverlay = (
    <div className="ai-session-history" role="menu" aria-label="AI 对话历史">
      <div className="ai-session-history-head">
        <Input
          className="ai-session-history-search"
          prefix={<SearchOutlined />}
          value={historyQuery}
          placeholder="搜索窗口..."
          allowClear
          onChange={(event) => setHistoryQuery(event.target.value)}
        />
        <Segmented
          className="ai-session-history-scope"
          size="small"
          value={historyScope}
          options={[
            { label: '最近', value: 'recent' },
            { label: '已归档', value: 'archived' },
          ]}
          onChange={(value) => setHistoryScope(value as 'recent' | 'archived')}
        />
      </div>
      <div className="ai-session-history-list">
        {historyGroups.length ? historyGroups.map((group) => (
          <div className="ai-session-history-group" key={group.label}>
            <div className="ai-session-history-group-label">{group.label}</div>
            {group.sessions.map((session) => {
              const isActive = session.id === activeSession?.id;
              return (
                <div className={`ai-session-history-row ${isActive ? 'active' : ''}`} key={session.id}>
                  <button
                    type="button"
                    className="ai-session-history-item"
                    onClick={() => {
                      if (historyScope === 'archived') {
                        void restoreSession(session);
                        return;
                      }
                      setActiveSessionId(session.id);
                      setHistoryOpen(false);
                    }}
                  >
                    <CheckCircleOutlined />
                    <span className="ai-session-history-main">
                      <span className="ai-session-history-title">{session.title || '当前窗口'}</span>
                      <span className="ai-session-history-meta">{session.messages.length} 条消息 · {session.updatedAt}</span>
                    </span>
                  </button>
                  <Dropdown
                    trigger={['click']}
                    menu={{
                      items: historyScope === 'archived'
                        ? [
                          { key: 'restore', label: '恢复到最近', icon: <InboxOutlined /> },
                          { key: 'delete', label: '删除', icon: <DeleteOutlined />, danger: true },
                        ]
                        : [
                          { key: 'rename', label: '重命名' },
                          { key: 'archive', label: '归档', icon: <InboxOutlined /> },
                        ],
                      onClick: ({ key }) => {
                        if (key === 'rename') beginRenameSession(session);
                        if (key === 'archive') archiveSession(session.id, true);
                        if (key === 'restore') void restoreSession(session);
                        if (key === 'delete') deleteArchivedSession(session);
                      },
                    }}
                  >
                    <Button
                      className="ai-session-history-more"
                      type="text"
                      icon={<EllipsisOutlined />}
                      onClick={(event) => event.stopPropagation()}
                    />
                  </Dropdown>
                </div>
              );
            })}
          </div>
        )) : (
          <div className="ai-session-history-empty">
            {historyScope === 'archived' ? '暂无已归档窗口' : '没有匹配的窗口'}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      <Tooltip title={open ? '收起 AI 工作栏' : '打开 AI 工作栏'} placement="left">
        <Button
          className="ai-edge-toggle"
          type="primary"
          onClick={() => setOpen((prev) => !prev)}
          aria-label="AI Assistant"
        >
          <MessageOutlined />
          <span>AI</span>
        </Button>
      </Tooltip>

      {open && (
        <section className="ai-chat-panel ai-workbench-panel" aria-label="AI chat panel">
          <header className="ai-chat-header">
            <div className="ai-agent-tab-strip" role="tablist" aria-label="AI 对话窗口">
              {sessions.map((session) => {
                const isActive = session.id === activeSession?.id;
                const isRenaming = session.id === renamingSessionId;
                const tabClassName = `ai-agent-title-tab ${isActive ? 'active' : ''} ${isRenaming ? 'renaming' : ''}`;
                if (isRenaming) {
                  return (
                    <div className={tabClassName} key={session.id} role="tab" aria-selected={isActive}>
                      <MessageOutlined />
                      <Input
                        className="ai-agent-tab-title-input"
                        value={renamingTitle}
                        autoFocus
                        maxLength={80}
                        onChange={(event) => setRenamingTitle(event.target.value)}
                        onBlur={() => { void commitRenameSession(session); }}
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            void commitRenameSession(session);
                          }
                          if (event.key === 'Escape') {
                            event.preventDefault();
                            cancelRenameSession();
                          }
                        }}
                      />
                    </div>
                  );
                }
                return (
                  <Dropdown
                    key={session.id}
                    trigger={['contextMenu']}
                    menu={{
                      items: [
                        { key: 'rename', label: '重命名' },
                        { key: 'close', label: '关闭窗口' },
                      ],
                      onClick: ({ key }) => {
                        if (key === 'rename') beginRenameSession(session);
                        if (key === 'close') closeSession(session.id);
                      },
                    }}
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      className={tabClassName}
                      onClick={() => {
                        setActiveSessionId(session.id);
                        setHistoryOpen(false);
                      }}
                      onDoubleClick={() => beginRenameSession(session)}
                    >
                      <MessageOutlined />
                      <Typography.Text strong title={session.title || '当前窗口'}>
                        {session.title || '当前窗口'}
                      </Typography.Text>
                      <span
                        className="ai-agent-tab-close"
                        role="button"
                        tabIndex={0}
                        aria-label="关闭当前对话窗口"
                        onClick={(event) => {
                          event.stopPropagation();
                          closeSession(session.id);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            event.stopPropagation();
                            closeSession(session.id);
                          }
                        }}
                      >
                        <CloseOutlined />
                      </span>
                    </button>
                  </Dropdown>
                );
              })}
            </div>
            <Space size={4} className="ai-agent-title-actions">
              <Tooltip title="新建窗口">
                <Button type="text" icon={<PlusOutlined />} onClick={() => { void startNewSession(); }} />
              </Tooltip>
              <Popover
                content={historyOverlay}
                trigger="click"
                placement="bottomRight"
                open={historyOpen}
                onOpenChange={(nextOpen) => {
                  setHistoryOpen(nextOpen);
                  if (nextOpen) {
                    void loadHistoryConversations();
                  }
                }}
                overlayClassName="ai-session-history-popover"
              >
                <Tooltip title="历史记录">
                  <Button type="text" icon={<HistoryOutlined />} />
                </Tooltip>
              </Popover>
              <Tooltip title="收起">
                <Button type="text" icon={<CloseOutlined />} onClick={() => setOpen(false)} />
              </Tooltip>
            </Space>
          </header>

          {chatWorkbench}
        </section>
      )}
    </>
  );
}
