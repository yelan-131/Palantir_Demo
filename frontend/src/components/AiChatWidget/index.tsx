import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Dropdown, Input, Modal, Popover, Segmented, Space, Tag, Tooltip, Typography } from 'antd';
import {
  CheckCircleOutlined,
  CloseOutlined,
  DeleteOutlined,
  EllipsisOutlined,
  HistoryOutlined,
  InboxOutlined,
  MessageOutlined,
  PlusOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  acknowledgePageAction,
  cancelAgentRun,
  closeAgentConversation,
  continueSavedAgentConfirmation,
  createAgentConversation,
  listAgentConversationMessages,
  listAgentConversations,
  resumeAgentConfirmation,
  reviseAgentRecordReview,
  stopAgentConfirmation,
  streamAgentChat,
  streamConfirmAgentRun,
  getAgentRunState,
  updateAgentConversation,
} from '@/services/api';
import type { AgentStreamEvent, RecordReviewResponse } from '@/services/api';
import { formatServerTime as formatServerClockTime, parseServerDate } from '@/utils/dateTime';
import { LEGACY_ACCOUNT_SECTIONS, navigationAreaForPath } from '@/config/navigation';
import { getSkillDisplayTitle, getToolHelp } from '@/pages/AccountCenter/aiRegistryHelp';
import { useAiWorkbench } from './context';
import { confirmationDesignPreview, designPreviewPath, parseDesignPreview } from './designPreview';
import type { DesignPreview } from './designPreview';
import type { BrowserPageAction, PageAction } from './pageControls';
import type { AiKnowledgeContext } from './context';
import './style.css';
import './aiPanels.css';
import { ChatComposer } from './ChatComposer';
import type { ChatAttachment } from './ChatComposer';
import { ConfigurationReviewEditor } from './ConfigurationReviewEditor';
import RecordConfirmationReview from './RecordConfirmationReview';
import { NativeDesignerReview, NativeLayoutReview } from './NativeDesignerReview';
import { AgentExecutionTrace } from './AgentExecutionTrace';
import { getTraceQueryContext, getTraceStatusLabel } from './tracePresentation';
import type { TracePresentationInput as AgentTraceItem } from './tracePresentation';

type ChatRole = 'assistant' | 'user';
type MockSkillStatus = 'draft_created' | 'ready_for_review' | 'completed' | 'failed';

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

interface RecordCardDraft {
  review?: RecordReviewResponse;
  changes: Record<string, unknown>;
  displayValues?: Record<string, string>;
  valid: boolean;
}

interface AgentProcessStep {
  id: string;
  label: string;
  status: string;
  detail?: string;
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
  confirmationCancelled?: boolean;
  confirmationError?: string;
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
  continuableConfirmationRunId?: string;
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
  run_status?: string;
  mode?: string;
  items?: Array<Record<string, unknown>>;
  risk_level?: string;
  requires_confirmation?: boolean;
}

interface AgentConversationHistory {
  data?: AgentMessagePayload[];
  active_confirmation_run_id?: string | null;
  continuable_confirmation_run_id?: string | null;
}

interface PageContext {
  title: string;
  scope: string;
  intro: string;
}

interface AiChatWidgetProps {
  enabled?: boolean;
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
const AI_CHAT_TAB_KEY = 'mf:ai-workbench:tab';

function readChatTabState(): { sessionId?: string; open: boolean } {
  try {
    const stored = asRecord(JSON.parse(window.sessionStorage.getItem(AI_CHAT_TAB_KEY) || 'null'));
    return {
      sessionId: typeof stored.sessionId === 'string' ? stored.sessionId : undefined,
      open: stored.open === true,
    };
  } catch {
    return { open: false };
  }
}

function findActiveSession(sessions: AgentSession[], sessionId?: string): AgentSession | undefined {
  return sessions.find(session => session.id === sessionId) || sessions[0];
}

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
    test: (pathname) => pathname === '/account-center',
    context: {
      title: '个人账号',
      scope: '个人资料、密码、通知与个人偏好',
      intro: '我会基于个人账号页面提供帮助，可以解释个人资料和偏好设置。',
    },
  },
  {
    test: (pathname) => pathname === '/data-center/knowledge',
    context: {
      title: '知识库',
      scope: '知识文档、SOP、证据、抽取与发布状态',
      intro: '我会基于知识库页面提供帮助，可以检索知识、解释文档内容，也可以总结证据与抽取结果。',
    },
  },
  {
    test: (pathname) => navigationAreaForPath(pathname) === 'studio',
    context: {
      title: '应用工作室',
      scope: '应用、表单、菜单、看板与模板',
      intro: '我会基于应用工作室提供帮助，可以解释应用配置、表单、看板，以及表单和流程里的规则。',
    },
  },
  {
    test: (pathname) => navigationAreaForPath(pathname) === 'data',
    context: {
      title: '数据中心',
      scope: '数据连接、同步管道、基础档案、资产映射、对象关系与图谱',
      intro: '我会基于数据中心提供帮助，可以解释数据连接、资产映射、对象关系和图谱。',
    },
  },
  {
    test: (pathname) => navigationAreaForPath(pathname) === 'admin',
    context: {
      title: '平台管理',
      scope: '组织、身份、权限、审计、AI 与平台设置',
      intro: '我会基于管理控制台提供帮助，可以解释权限和平台配置，也可以总结审计线索。',
    },
  },
];

function buildPageContext(pathname: string, fallbackTitle: string, search = ''): PageContext {
  const legacySection = pathname === '/account-center' ? new URLSearchParams(search).get('section') : null;
  const contextPath = legacySection && LEGACY_ACCOUNT_SECTIONS[legacySection]
    ? LEGACY_ACCOUNT_SECTIONS[legacySection].split('?')[0]
    : pathname;
  const matched = contextByRoute.find((item) => item.test(contextPath));
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
  const terminal = ['completed', 'cancelled', 'failed'].includes(message.run_status || '');
  const confirmationPayload = terminal ? undefined : getConfirmationItemPayload(items);
  const actions = message.run_status === 'cancelled' ? undefined : getConfirmationActions(items);
  const mappedActions = isAssistant ? mapAgentActions(actions) : undefined;
  const executionSnapshot = [...items].reverse().find(item => item.execution_snapshot === true);
  const failedResult = asRecordArray(asRecord(executionSnapshot?.payload).tool_results).find(item => item.status === 'failed');
  return {
    id: message.message_id || message.id || `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role: isAssistant ? 'assistant' : 'user',
    content: message.content || '',
    actions: message.run_status === 'failed'
      ? mappedActions?.map(action => ({ ...action, status: 'failed', summary: '操作未完成，请查看执行结果。', nextSteps: [] }))
      : message.run_status === 'completed' ? mappedActions?.map(action => ({ ...action, status: 'completed', summary: '已确认并执行。', nextSteps: [] })) : mappedActions,
    items: isAssistant ? items : undefined,
    steps: isAssistant ? mapAgentSteps(items) : undefined,
    trace: isAssistant ? mapTraceFromItems(items) : undefined,
    createdAt: formatServerTime(message.created_at),
    source: isAssistant && message.model_name ? `model: ${message.model_name}` : undefined,
    contextSources: isAssistant ? getContextSources({ items }) : undefined,
    runId: isAssistant ? message.run_id : undefined,
    requiresConfirmation: isAssistant && !terminal ? Boolean(confirmationPayload?.confirmation_token || message.requires_confirmation) : false,
    confirmationPayload: isAssistant ? confirmationPayload : undefined,
    executionResult: isAssistant && message.run_status === 'completed' ? getStoredExecutionResult(items) : undefined,
    confirmationCancelled: isAssistant && message.run_status === 'cancelled' && Boolean(getConfirmationItemPayload(items)),
    confirmationError: isAssistant && message.run_status === 'failed' && typeof failedResult?.error === 'string'
      ? failedResult.error
      : undefined,
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

function createSkillTraceItem(data: Record<string, unknown>): AgentTraceItem | undefined {
  const legacyRead = data.type === 'context' && data.summary === '已读取业务技能';
  if ((!legacyRead && data.type !== 'skill_use') || data.status !== 'completed') return undefined;
  const skillId = legacyRead ? asRecord(data.payload).name : data.skill;
  if (typeof skillId !== 'string' || !/^[\w.-]{1,160}$/.test(skillId)) return undefined;
  const stepId = `skill-${String(data.item_id || data.id || skillId)}`;
  return {
    id: stepId,
    stepId,
    kind: 'skill',
    content: getSkillDisplayTitle(skillId, !legacyRead && typeof data.title === 'string' ? data.title : undefined),
    skillId,
    status: 'completed',
  };
}

function mapTraceFromItems(items?: Array<Record<string, unknown>>): AgentTraceItem[] | undefined {
  const trace = (items || [])
    .map((step, index) => {
      const skill = createSkillTraceItem(step);
      if (skill) return skill;
      if (step.type === 'page_action') return createTraceItem('item.updated', step);
      if (step.type === 'tool_call' || step.type === 'tool_result') {
        return createToolTraceItem(`history-trace-tool-${String(step.item_id || step.id || index)}`, step, step.type === 'tool_result');
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

function createToolTraceItem(id: string, data: Record<string, unknown>, completed: boolean, stepId?: string): AgentTraceItem {
  const tool = stringifyStepValue(data.tool);
  return {
    id,
    kind: completed ? 'result' : 'tool',
    content: tool || '工具',
    status: String(data.status || (completed ? 'completed' : 'running')),
    tool,
    stepId,
    toolCallId: typeof data.tool_call_id === 'string' ? data.tool_call_id : undefined,
    resultCount: typeof data.result_count === 'number' ? data.result_count : undefined,
    resultPayload: completed ? data.payload : undefined,
    queryContext: completed ? undefined : getTraceQueryContext(tool, data.payload),
    summary: typeof data.summary === 'string' ? data.summary : undefined,
    error: typeof data.error === 'string' ? data.error : undefined,
  };
}

function getPageTraceText(title: string, status: string, summary?: string): string {
  return [title, getTraceStatusLabel(status), summary].filter(Boolean).join(' · ');
}

function finishPendingTrace(trace: AgentTraceItem[] | undefined, status: 'interrupted' | 'stopped') {
  return trace?.map(item => {
    if (item.status !== 'running' && item.status !== 'active') return item;
    if (item.kind === 'page') return { ...item, status, content: getPageTraceText(item.pageTitle || '画布操作', status) };
    return item.kind === 'tool' ? { ...item, status } : item;
  });
}

function appendAgentTraceItem(
  trace: AgentTraceItem[] | undefined,
  item: AgentTraceItem,
): AgentTraceItem[] {
  const previous = trace || [];
  if (item.source === 'dsh') {
    return [...previous, { ...item, id: `${item.id}-${previous.length}` }];
  }
  const existingIndex = item.stepId
    ? previous.findIndex((existing) => existing.stepId === item.stepId)
    : -1;
  return existingIndex < 0
    ? [...previous, item]
    : previous.map((existing, index) => index === existingIndex ? item : existing);
}

function createTraceItem(event: string, data: Record<string, unknown>): AgentTraceItem | undefined {
  if (event === 'harness.reasoning' && typeof data.text === 'string' && data.text.trim()) {
    const stepId = `reasoning-${String(data.sequence ?? data.step ?? 0)}`;
    return { id: stepId, stepId, kind: 'note', content: data.text, source: 'reasoning' };
  }
  if (event === 'harness.progress') {
    const phase = String(data.phase || '');
    const step = data.step ?? 1;
    const retry = data.retry ?? 1;
    const labels: Record<string, string> = {
      'turn/start': '开始执行',
      'step/start': `开始模型步骤 ${step}`,
      'step/end': `模型步骤 ${step} 完成`,
      'assistant/message': `收到模型步骤 ${step} 的输出`,
      'compaction/start': '开始压缩对话上下文',
      'compaction/end': '对话上下文压缩完成',
      'turn/end': '本轮执行结束',
      'llm/retry': `模型步骤 ${step} 等待第 ${retry} 次重试`,
      'llm/retry-started': `模型步骤 ${step} 开始第 ${retry} 次重试`,
    };
    const label = Object.prototype.hasOwnProperty.call(labels, phase) ? labels[phase] : undefined;
    if (!label) return undefined;
    const usage = data.usage as Record<string, number> | undefined;
    const accounting = typeof usage?.inputTokens === 'number' && typeof usage.outputTokens === 'number'
      ? ` · 输入 ${usage.inputTokens} / 输出 ${usage.outputTokens} Token`
      : '';
    const stepId = `dsh-${phase}-${data.sequence ?? `${step}-${retry}`}`;
    return { id: stepId, kind: 'note', content: label + accounting, source: 'dsh', stepId };
  }
  if (event === 'assistant.note') {
    return undefined;
  }
  if (event === 'item.created' || event === 'item.updated') {
    const skill = createSkillTraceItem(data);
    if (skill) return skill;
    const type = String(data.type || '');
    if (type === 'page_action') {
      const stepId = `page-action-${String(data.item_id || data.id)}`;
      const pageTitle = stringifyStepValue(data.title) || '画布操作';
      const status = String(data.status || 'running');
      return {
        id: stepId,
        stepId,
        kind: 'page',
        status,
        pageTitle,
        content: getPageTraceText(pageTitle, status, stringifyStepValue(data.summary)),
      };
    }
    if (!['tool_call', 'tool_result', 'confirmation', 'validation', 'error'].includes(type)) return undefined;
    const tool = stringifyStepValue(data.tool);
    const stepId = `${type}-${String(data.item_id || data.id || data.tool || Date.now())}`;
    if (type === 'tool_call' || type === 'tool_result') {
      return createToolTraceItem(`trace-item-${stepId}`, data, type === 'tool_result', stepId);
    }
    return {
      id: `trace-item-${stepId}`,
      kind: 'note',
      content: [getAgentStepLabel(data), tool].filter(Boolean).join(' · '),
      status: String(data.status || 'completed'),
      tool,
      stepId,
      source: type === 'validation' ? 'validation' : undefined,
    };
  }
  if (event === 'tool.started' || event === 'tool.completed') {
    const completed = event === 'tool.completed';
    const stepId = `${event}-${String(data.step_id || data.tool || Date.now())}`;
    return createToolTraceItem(`trace-tool-${stepId}`, data, completed, stepId);
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
  if (!['low_code.create_form_definition', 'forms.create_form_definition'].includes(action.skill)) return undefined;
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
    fields: fields.map((field) => ({
      name: formatActionValue(field.field_name),
      label: formatActionValue(field.label),
      type: formatActionValue(field.field_type),
      required: Boolean(field.required),
      options: Array.isArray(field.enum_values) ? field.enum_values.map(formatActionValue).join(' / ') : '',
    })),
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
    application_id: '应用编号',
    application_name: '应用名称',
    form_id: '表单编号',
    form_code: '表单编码',
    form_name: '表单名称',
    page_id: '页面编号',
    page_code: '页面编码',
    record_id: '记录编号',
    field_id: '字段编号',
    field_name: '字段编码',
    field_type: '字段类型',
    name: '名称',
    title: '标题',
    code: '编码',
    description: '说明',
    status: '状态',
    values: '字段值',
    config: '配置',
    layout: '布局',
    operation: '操作方式',
    revision: '修订号',
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

const confirmationStatusNames: Record<string, string> = {
  draft: '草稿', published: '已发布', active: '已启用', disabled: '已停用', archived: '已归档',
};

function getDraftPreviewFields(payload?: Record<string, unknown>) {
  return Object.entries(payload || {})
    .filter(([key]) => !key.startsWith('_'))
    .map(([key, value]) => {
      const label = formatSlotName(key);
      const text = typeof value === 'boolean' ? (value ? '是' : '否') : formatActionValue(value);
      return {
        label,
        value: label === '状态'
          ? text.split(' → ').map(part => confirmationStatusNames[part] || part).join(' → ')
          : text,
      };
    });
}

function getGenericActionReview(action: MockSkillAction) {
  const payload = asRecord(action.payload);
  const preview = asRecord(payload._preview);
  const subject = [preview.target, payload.form_name, payload.application_name, payload.name, payload.title]
    .find((value): value is string => typeof value === 'string' && Boolean(value.trim()));
  const fields = typeof preview.target === 'string' ? getDraftPreviewFields(asRecord(preview.fields))
    : action.skill === 'forms.publish_to_menu' ? action.fields.filter(field => field.label !== '业务表单')
      : getDraftPreviewFields(payload);
  return { subject, fields };
}

function getConfirmationToolTitle(action: MockSkillAction): string {
  const payload = asRecord(action.payload);
  const tool = payload._harness_tool || asRecord(payload._contract).tool || action.skill;
  const title = getToolHelp(String(tool))?.title || getSkillDisplayTitle(action.skill, action.title);
  return /\p{Script=Han}/u.test(title) ? title : '执行业务操作';
}

function supportsRecordReview(action: MockSkillAction): boolean {
  const tool = action.payload?._harness_tool || asRecord(action.payload?._contract).tool || action.skill;
  return tool === 'forms.create_dynamic_record_draft' || tool === 'forms.update_record';
}

function recordReviewError(error: unknown): string {
  const response = (error as { response?: { data?: { detail?: unknown } } })?.response;
  const detail = response?.data?.detail;
  return typeof detail === 'string' ? detail : String(asRecord(detail).message || '明细校验暂未完成，请检查修改后重试。');
}

function recordCardChanges(draft: RecordCardDraft): Record<string, unknown> {
  return Object.fromEntries(Object.entries(draft.changes).map(([name, value]) => {
    const numeric = draft.review?.fields.some(field => field.name === name && field.kind === 'number');
    if (!numeric || typeof value !== 'string') return [name, value];
    return [name, value.trim() ? Number(value) : null];
  }));
}

const confirmationTitles: Record<string, { title?: string; confirm?: string; completed?: string }> = {
  'applications.create': { title: '新建应用草稿', confirm: '确认创建草稿', completed: '应用草稿已创建' },
  'applications.publish': { title: '发布应用', confirm: '确认发布', completed: '已发布应用' },
  'applications.enable': { confirm: '确认启用', completed: '已启用应用' },
  'applications.disable': { confirm: '确认停用', completed: '已停用应用' },
  'applications.delete': { confirm: '确认删除草稿', completed: '已删除应用草稿' },
  'forms.create_form_definition': { confirm: '确认保存草稿' },
  'low_code.create_form_definition': { confirm: '确认保存草稿' },
  'forms.create_dynamic_record_draft': { confirm: '确认保存草稿' },
  'forms.create_record_draft': { confirm: '确认保存草稿' },
  'forms.update_record': { confirm: '确认修改', completed: '记录已更新' },
  'forms.publish': { confirm: '确认发布', completed: '表单已发布' },
  'forms.publish_to_menu': { confirm: '确认挂载菜单' },
  'forms.save_layout': { confirm: '确认保存草稿' },
  'pages.save_draft': { confirm: '确认保存草稿', completed: '页面草稿已保存' },
  'dashboards.save_draft': { confirm: '确认保存草稿', completed: '看板草稿已保存' },
  'dashboards.publish': { confirm: '确认发布', completed: '看板已发布' },
};

function getConfirmationTitle(action: MockSkillAction): string {
  return confirmationTitles[action.skill]?.title
    || (/\p{Script=Han}/u.test(action.title) ? action.title : getConfirmationToolTitle(action));
}

const fieldTypeNames: Record<string, string> = {
  string: '单行文本', text: '多行文本', number: '数字', integer: '整数', decimal: '小数',
  date: '日期', datetime: '日期时间', boolean: '开关', enum: '选项', relation: '关联记录',
  code: '编号', attachment: '附件', json: '结构化数据',
};

function ConfirmationFields({ fields }: { fields: MockSkillAction['fields'] }) {
  return (
    <dl className="ai-confirmation-field-list">
      {fields.map(({ label, value }, index) => (
        <div key={index}><dt>{label}</dt><dd>{value}</dd></div>
      ))}
    </dl>
  );
}

function getConfirmationReview(action: MockSkillAction) {
  const form = getLowCodeReview(action);
  const toolField = { label: '执行工具', value: getConfirmationToolTitle(action) };
  if (form) {
    const meta = '保存为草稿 · ' + form.fieldCount + ' 个字段';
    const effect = form.menuEnabled ? '待挂载到「' + form.menuTitle + '」，发布及挂载需另行确认。' : '发布需另行确认。';
    return {
      subject: form.formName,
      meta,
      effect,
      highlights: [],
      fields: [
        { label: '表单编码', value: form.formCode },
        ...(form.description === '待补充' ? [] : [{ label: '说明', value: form.description }]),
        ...form.fields.map(field => ({
          label: field.label,
          value: [fieldTypeNames[field.type] || '其他类型', field.required ? '必填' : '选填', field.options].filter(Boolean).join(' · '),
        })),
        toolField,
      ],
    };
  }
  const generic = getGenericActionReview(action);
  const status = generic.fields.find(field => field.label === '状态')?.value;
  const highlights = generic.fields.filter(field => (
    field.label !== '状态' && field.value !== generic.subject && field.value.length <= 100 && !/^[{\[]/.test(field.value)
  )).slice(0, 2);
  return {
    ...generic,
    meta: status,
    effect: action.skill === 'applications.publish' ? '发布后，有访问权限的成员可以打开应用。' : undefined,
    highlights,
    fields: [...generic.fields, toolField],
  };
}

function getPendingStateFromAction(action: MockSkillAction): AgentActionState {
  const payload = asRecord(action.payload);
  // Preserve the complete proposal, including application IDs, menu options
  // and field rules, when asking the model for a delta.
  return {
    skill: action.skill,
    status: 'collecting',
    collected_slots: Object.fromEntries(Object.entries(payload).filter(([key]) => !key.endsWith('_snapshot'))),
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
      fields: (action.skill === 'forms.publish_to_menu' ? [
        ['业务表单', payload.form_name], ['菜单位置', payload.destination],
        ['发布方式', payload.publish_required ? '首次发布并挂载' : '使用已发布版本'],
      ] : Object.entries(payload).slice(0, 6)).map(([label, value]) => ({
        label: String(label),
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

function getCompletedToolResults(toolResults: unknown): Record<string, unknown>[] {
  return asRecordArray(toolResults)
    .filter(item => item.status === 'completed')
    .map(item => {
      const outer = asRecord(item.result);
      return outer.result && typeof outer.result === 'object' && !Array.isArray(outer.result)
        ? asRecord(outer.result)
        : outer;
    });
}

function pickExecutionResult(results: Record<string, unknown>[]): AgentExecutionResult | undefined {
  const receipts = results.map(getExecutionResult);
  return receipts.find(receipt => receipt.href) || receipts[0];
}

function getStoredExecutionResult(items: Record<string, unknown>[]): AgentExecutionResult | undefined {
  const snapshot = [...items].reverse().find(item => item.execution_snapshot === true);
  const results = snapshot
    ? getCompletedToolResults(asRecord(snapshot.payload).tool_results)
    : items.filter(item => item.execution_receipt === true).map(item => asRecord(item.payload));
  return pickExecutionResult(results);
}

function getExecutionResult(result: Record<string, unknown>): AgentExecutionResult {
  const routePath = typeof result.route_path === 'string' && /^\/(?![\/\\])/.test(result.route_path)
    ? result.route_path
    : '';
  if (routePath) {
    const savedDraft = asRecord(result.form).status === 'draft';
    return {
      kind: 'form_definition',
      title: savedDraft ? '表单草稿已保存' : result.menu_id ? '表单已挂载到应用菜单' : '表单已创建',
      detail: savedDraft ? '发布需要单独确认' : routePath,
      href: routePath,
    };
  }
  const recordId = result.record_id;
  const formCode = typeof result.form_code === 'string' ? result.form_code : '';
  const formName = typeof result.form_name === 'string' ? result.form_name : formCode;
  if (recordId !== undefined && formCode) {
    return {
      kind: 'dynamic_record',
      title: result.operation === 'update' ? '记录已更新' : '动态记录草稿已创建',
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

function generateUnavailableReply(): AssistantReply {
  return {
    content: '当前无法连接后端 AI 服务。请先确认后端服务、登录状态和大模型配置可用后再试。',
  };
}

export default function AiChatWidget({ pageTitle, applicationName, enabled = true }: AiChatWidgetProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { knowledgeContext, enqueuePageAction, finishPageAction, designerContext, componentPageContext, setDesignPreview } = useAiWorkbench();
  const currentLocation = useRef(location);
  currentLocation.current = location;
  const [restoredTab] = useState(readChatTabState);
  const [open, setOpen] = useState(restoredTab.open);
  const [input, setInput] = useState('');
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>();
  const [historyLoadError, setHistoryLoadError] = useState<string>();
  const [historyLoadAttempt, setHistoryLoadAttempt] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState('');
  const [historyScope, setHistoryScope] = useState<'recent' | 'archived'>('recent');
  const [archivedSessions, setArchivedSessions] = useState<AgentSession[]>([]);
  const [sending, setSending] = useState(false);
  const [nativeDraftReview, setNativeDraftReview] = useState<{ sessionId: string; draftId: string; menuTarget?: NonNullable<PageAction['draft']>['menu_target'] }>();
  const streamController = useRef<AbortController | null>(null);
  const activeContinuation = useRef<{ conversationId: string; runId: string } | null>(null);
  useEffect(() => () => streamController.current?.abort(), []);
  const [confirmingRunId, setConfirmingRunId] = useState<string>();
  const confirmationLocks = useRef(new Set<string>());
  const [confirmationNotes, setConfirmationNotes] = useState<Record<string, string>>({});
  const [recordCardDrafts, setRecordCardDrafts] = useState<Record<string, Record<number, RecordCardDraft>>>({});
  const [renamingSessionId, setRenamingSessionId] = useState<string>();
  const [renamingTitle, setRenamingTitle] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);

  const pageContext = useMemo(
    () => buildPageContext(location.pathname, pageTitle, location.search),
    [location.pathname, location.search, pageTitle],
  );
  const surface = knowledgeContext ? 'knowledge' : 'global';
  const contextKey = AI_WORKBENCH_PAGE;
  const intro = '我是独立 AI 工作区。你可以直接聊天；当你问到当前页面、表单、数据、知识文档或业务分析时，我会按需读取相关上下文。';
  const activeSession = findActiveSession(sessions, activeSessionId);
  const visibleSessionId = useRef(activeSession?.id);
  visibleSessionId.current = activeSession?.id;
  const messages = activeSession?.messages || [];
  const latestTrace = messages[messages.length - 1]?.trace;

  useEffect(() => {
    if (!enabled || !activeSession?.id) return;
    try {
      window.sessionStorage.setItem(AI_CHAT_TAB_KEY, JSON.stringify({ sessionId: activeSession.id, open }));
    } catch {
      // Chat history remains available when browser storage is disabled.
    }
  }, [activeSession?.id, enabled, open]);

  useEffect(() => {
    if (!enabled || sessions.length) return;
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
        const selected = findActiveSession(rows, restoredTab.sessionId);
        if (selected) {
          setSessions(rows);
          setActiveSessionId(selected.id);
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
        if (active) setHistoryLoadError(AI_WORKBENCH_PAGE);
      }
    };
    void bootstrapSessions();
    return () => {
      active = false;
    };
  }, [contextKey, intro, enabled, historyLoadAttempt, restoredTab.sessionId]);

  useEffect(() => {
    if (!enabled || !activeSession?.id || activeSession.messages.length) return;
    let active = true;
    listAgentConversationMessages(activeSession.id)
      .then((response) => {
        if (!active) return;
        const history = (response.data || {}) as AgentConversationHistory;
        const loadedMessages = restoreSessionHistory(activeSession.id, history);
        const activeRunId = history.active_confirmation_run_id;
        const parent = activeRunId && loadedMessages.find(message => message.runId === activeRunId);
        if (parent) void confirmAgentAction(parent, 'reconnect');
      })
      .catch(() => {
        if (active) setHistoryLoadError(activeSession.id);
      });
    return () => {
      active = false;
    };
  }, [activeSession?.id, activeSession?.messages.length, intro, enabled, historyLoadAttempt]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, open, sending, nativeDraftReview?.draftId, designerContext?.review_ready]);

  useEffect(() => {
    if (sending && followLatest.current && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [latestTrace, sending]);

  useEffect(() => {
    document.body.classList.toggle('ai-workbench-open', open && enabled);
    return () => document.body.classList.remove('ai-workbench-open');
  }, [open, enabled]);

  useEffect(() => { if (!enabled) setOpen(false); }, [enabled]);

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

  const restoreSessionHistory = (sessionId: string, history: AgentConversationHistory) => {
    const messages = (history.data || []).map(mapServerMessage);
    setSessions(prev => prev.map(session => session.id === sessionId ? {
      ...session,
      messages: messages.length ? messages : [createAssistantMessage(intro)],
      continuableConfirmationRunId: history.continuable_confirmation_run_id || undefined,
    } : session));
    return messages;
  };

  const appendSessionMessages = (sessionId: string, ...newMessages: ChatMessage[]) => {
    setSessions(prev => prev.map(session => session.id === sessionId
      ? { ...session, messages: [...session.messages, ...newMessages], updatedAt: nowText() }
      : session));
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

  const showDesignPreview = (preview: DesignPreview, sessionId: string, messageId: string, runId?: string) => {
    const previousLocation = currentLocation.current;
    setDesignPreview(current => ({
      preview, sessionId, messageId, runId,
      returnTo: previousLocation.state?.aiDesignPreviewId && current
        ? current.returnTo : previousLocation.pathname + previousLocation.search,
    }));
    navigate(designPreviewPath(preview), {
      replace: Boolean(previousLocation.state?.aiDesignPreviewId),
      state: { aiDesignPreviewId: preview.id },
    });
  };

  const turnEventHandler = (
    sessionId: string,
    assistantMessageId: string,
    pageActionIds: Set<string>,
    onAccepted?: () => void,
  ) => ({ event, data }: AgentStreamEvent) => {
    if (event === 'ui.design_preview') {
      const preview = parseDesignPreview(data);
      if (preview && visibleSessionId.current === sessionId) {
        showDesignPreview(preview, sessionId, assistantMessageId);
      }
      return;
    }
    if (event === 'ui.action.cancel') {
      if (typeof data.id === 'string') finishPageAction(data.id);
      return;
    }
    if (event === 'ui.action') {
      const action = data as unknown as BrowserPageAction;
      if (action.type === 'application_navigation' && visibleSessionId.current !== sessionId) {
        void acknowledgePageAction(action.id, { ok: false, error: '请切回发起请求的 AI 窗口，再打开目标。' }).catch(() => {});
        return;
      }
      pageActionIds.add(action.id);
      if (action.type === 'form_designer' && action.draft_id) setNativeDraftReview(previous => previous?.draftId === action.draft_id ? previous : {
        sessionId, draftId: action.draft_id!, menuTarget: action.draft?.menu_target,
      });
      enqueuePageAction(action);
      return;
    }
    const traceItem = createTraceItem(event, data);
    if (traceItem || (event === 'harness.progress' && typeof data.text === 'string' && data.text)) {
      updateSessionMessage(sessionId, assistantMessageId, (message) => ({
        ...message,
        trace: traceItem ? appendAgentTraceItem(message.trace, traceItem) : message.trace,
        ...(event === 'harness.progress' && typeof data.text === 'string' && data.text ? { content: data.text, fullContent: data.text, typing: false } : {}),
      }));
      return;
    }
    if (event === 'run.accepted') {
      onAccepted?.();
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
      setDesignPreview(current => current?.messageId === assistantMessageId
        ? { ...current, runId: payload.run_id } : current);
      const answerContent = payload.answer || payload.assistant_message?.content || '后端没有返回可展示的回答。';
      updateSessionMessage(sessionId, assistantMessageId, (message) => ({
        ...message,
        content: answerContent,
        fullContent: answerContent,
        typing: false,
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
        trace: finishPendingTrace(message.trace, 'interrupted'),
        source: 'Agent 事件流',
      }));
    }
  };

  const sendMessage = async (
    content: string,
    extraContext?: Record<string, unknown>,
    attachments: ChatAttachment[] = [],
    onAnswered?: () => void,
  ) => {
    const trimmed = content.trim();
    if (!trimmed || streamController.current || confirmationLocks.current.size || !activeSession?.messages.length) return;

    const controller = new AbortController();
    streamController.current = controller;
    const messageText = [trimmed, ...attachments.map(file => `📎 ${file.name}${file.sampled ? '（摘录）' : ''}`)].join('\n');
    const userMessage = createUserMessage(messageText);
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
    const sessionId = activeSession.id;
    const pageActionIds = new Set<string>();
    let accepted = false;
    appendSessionMessages(sessionId, userMessage, assistantPlaceholder);
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
      Object.assign(runtimeContext, { pageControlsSupported: true, designerContext }, extraContext || {},
        { componentPageContext, followDesignTools: true });
      const handleEvent = turnEventHandler(sessionId, assistantMessageId, pageActionIds, () => { accepted = true; });
      await streamAgentChat({
        message: messageText,
        page: AI_WORKBENCH_PAGE,
        context: attachments.length ? { ...runtimeContext, chatAttachments: attachments } : runtimeContext,
      }, (event) => {
        handleEvent(event);
        if (event.event === 'answer.completed') onAnswered?.();
      }, controller.signal);
    } catch {
      if (controller.signal.aborted) {
        updateSessionMessage(sessionId, assistantMessageId, (message) => ({
          ...message,
          content: '已停止本次执行。',
          fullContent: undefined,
          typing: false,
          trace: finishPendingTrace(message.trace, 'stopped'),
        }));
        return;
      }
      const interrupted = accepted
        ? `连接已中断，未收到本轮结果。${pageActionIds.size ? '请先检查当前草稿，再重试。' : '请重试。'}`
        : generateUnavailableReply().content;
      updateSessionMessage(sessionId, assistantMessageId, (message) => ({
        ...message,
        content: interrupted,
        fullContent: undefined,
        typing: false,
        trace: finishPendingTrace(message.trace, 'interrupted'),
      }));
    } finally {
      for (const actionId of pageActionIds) finishPageAction(actionId);
      if (streamController.current === controller) streamController.current = null;
      setSending(false);
    }
  };

  const updateRecordCardDraft = (runId: string, actionIndex: number, update: Partial<RecordCardDraft>) => {
    setRecordCardDrafts(previous => ({
      ...previous,
      [runId]: {
        ...previous[runId],
        [actionIndex]: {
          ...(previous[runId]?.[actionIndex] ?? { changes: {}, valid: true }), ...update,
        },
      },
    }));
  };

  const clearRecordCardDrafts = (runId: string) => {
    setRecordCardDrafts(previous => {
      if (!previous[runId]) return previous;
      const next = { ...previous };
      delete next[runId];
      return next;
    });
  };

  const applyRecordReviewRevision = (sessionId: string, messageId: string, items: Array<Record<string, unknown>>) => {
    const confirmationPayload = getConfirmationItemPayload(items);
    const token = getConfirmationToken(confirmationPayload);
    const actions = mapAgentActions(getConfirmationActions(items));
    if (!token || !actions) return undefined;
    updateSessionMessage(sessionId, messageId, current => ({
      ...current,
      items: [
        ...(current.items || []).filter(item => item.type !== 'confirmation'),
        ...items.filter(item => item.type === 'confirmation'),
      ],
      actions: actions.map((action, index) => ({ ...action, id: current.actions?.[index]?.id || action.id })),
      confirmationPayload,
    }));
    return token;
  };

  const confirmAgentAction = async (message: ChatMessage, intent: 'confirm' | 'reconnect' | 'continue' = 'confirm') => {
    const runId = message.runId;
    let token = getConfirmationToken(message.confirmationPayload);
    if (!runId || (!token && intent === 'confirm') || !activeSession) return;
    if (confirmationLocks.current.size || streamController.current) return;
    const edits = intent === 'confirm'
      ? Object.entries(recordCardDrafts[runId] || {})
        .filter(([index, draft]) => Object.keys(draft.changes).length && message.actions?.[Number(index)]
          && supportsRecordReview(message.actions[Number(index)]))
      : [];
    if (edits.some(([, draft]) => !draft.valid)) return;
    confirmationLocks.current.add(runId);
    setConfirmingRunId(runId);
    const sessionId = activeSession.id;
    const controller = new AbortController();
    streamController.current = controller;
    const continuationMessageId = `assistant-continuation-${runId}`;
    const pageActionIds = new Set<string>();
    const handleContinuation = turnEventHandler(sessionId, continuationMessageId, pageActionIds);
    let receiptShown = intent === 'continue';
    let continuationStarted = false;
    let continuationFinished = false;
    let streamFinished = false;

    if (intent === 'confirm') {
      updateSessionMessage(sessionId, message.id, item => ({ ...item, confirmationError: undefined }));
    }

    const applyCompletedRun = (run: Record<string, unknown>) => {
      if (receiptShown) return;
      receiptShown = true;
      if (run.status !== 'completed') {
        const results = Array.isArray(run.tool_results) ? run.tool_results as Record<string, unknown>[] : [];
        const failed = results.find(result => result.status === 'failed');
        const detail = String(failed?.error || '操作未完成，请重新读取记录后确认。');
        updateSessionMessage(sessionId, message.id, item => ({ ...item,
          content: item.fullContent || item.content, fullContent: undefined,
          typing: false, requiresConfirmation: false, executionResult: undefined,
          confirmationError: detail, confirmationPayload: undefined, actionState: undefined,
          actions: item.actions?.map(action => ({ ...action, status: 'failed' as const, summary: detail, nextSteps: [] })),
        }));
        return;
      }
      const results = getCompletedToolResults(run.tool_results);
      setDesignPreview(current => current?.sessionId === sessionId && current.runId === runId ? undefined : current);
      const executionResult = pickExecutionResult(results) || getExecutionResult({});
      if (results.some(result => result.menu_id)) window.dispatchEvent(new Event('applications-changed'));
      updateSessionMessage(sessionId, message.id, item => ({
        ...item,
        content: item.fullContent || item.content,
        fullContent: undefined,
        typing: false,
        requiresConfirmation: false,
        confirmationPayload: undefined,
        confirmationError: undefined,
        actionState: undefined,
        executionResult,
        actions: item.actions?.map(action => ({ ...action, status: 'completed' as const, nextSteps: [] })),
      }));
    };

    const onEvent = ({ event, data }: AgentStreamEvent) => {
      if (event === 'confirmation.finished') {
        streamFinished = true;
        return;
      }
      if (event.startsWith('continuation.')) {
        if (!continuationStarted) {
          continuationStarted = true;
          activeContinuation.current = { conversationId: sessionId, runId };
          setSending(true);
          const pending: ChatMessage = {
            id: continuationMessageId, role: 'assistant', content: '', createdAt: nowText(),
          };
          setSessions(prev => prev.map(session => session.id === sessionId ? {
            ...session,
            messages: [...session.messages.filter(item => item.id !== continuationMessageId), pending],
          } : session));
        }
        const turnEvent = event.slice('continuation.'.length);
        if (turnEvent === 'run.stopped') {
          continuationFinished = true;
          updateSessionMessage(sessionId, continuationMessageId, item => ({
            ...item, content: '已停止继续处理。', fullContent: undefined, typing: false,
            trace: finishPendingTrace(item.trace, 'stopped'),
          }));
          return;
        }
        if (turnEvent === 'answer.completed' || turnEvent === 'run.failed') continuationFinished = true;
        if (turnEvent === 'answer.completed' && data.run_id) {
          setSessions(prev => prev.map(session => {
            if (session.id !== sessionId) return session;
            const alreadyRestored = session.messages.some(item => item.runId === data.run_id && item.id !== continuationMessageId);
            return { ...session,
              continuableConfirmationRunId: undefined,
              messages: alreadyRestored ? session.messages.filter(item => item.id !== continuationMessageId) : session.messages,
            };
          }));
        }
        handleContinuation({ event: turnEvent, data });
        return;
      }
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
        const detail = String(data.detail || '暂时无法确认执行结果。');
        updateSessionMessage(sessionId, message.id, (item) => ({
          ...item,
          content: item.fullContent || item.content,
          fullContent: undefined,
          typing: false,
          confirmationError: detail,
        }));
      }
    };
    try {
      if (token && edits.length) {
        try {
          const { data } = await reviseAgentRecordReview(runId, {
            confirmation_token: token,
            edits: edits.map(([index, draft]) => ({ action_index: Number(index), data: recordCardChanges(draft) })),
          });
          const revisedToken = applyRecordReviewRevision(sessionId, message.id, data.items);
          if (!revisedToken) throw new Error('未收到更新后的确认卡');
          token = revisedToken;
          clearRecordCardDrafts(runId);
        } catch (error) {
          let detail = recordReviewError(error);
          const status = (error as { response?: { status?: number } }).response?.status;
          if (!status || status === 409) {
            try {
              const latest = asRecord((await getAgentRunState(runId)).data?.data);
              const items = asRecordArray(latest.items);
              if (latest.status === 'completed' || latest.status === 'failed') {
                applyRecordReviewRevision(sessionId, message.id, items);
                clearRecordCardDrafts(runId);
                applyCompletedRun(latest);
                return;
              }
              const latestToken = getConfirmationToken(getConfirmationItemPayload(items));
              if (latest.status === 'waiting_confirmation' && latestToken && latestToken !== token) {
                applyRecordReviewRevision(sessionId, message.id, items);
                detail = '已重新读取待确认卡，请核对明细后再确认。';
              }
            } catch { /* Retry remains tied to this run. */ }
          }
          updateSessionMessage(sessionId, message.id, item => ({ ...item, confirmationError: detail }));
          return;
        }
      }
      let originalError: unknown;
      if (intent !== 'reconnect') {
        try {
          if (intent === 'continue') {
            await continueSavedAgentConfirmation(sessionId, runId, onEvent, controller.signal);
          } else {
            await streamConfirmAgentRun(runId, {
              confirmation_token: token,
              confirmed: true,
              continue_conversation_id: sessionId,
              continue_route: location.pathname,
              follow_design_tools: true,
            }, onEvent, controller.signal);
          }
        } catch (error) {
          originalError = error;
        }
      }
      if (!streamFinished && !controller.signal.aborted) {
        try {
          await resumeAgentConfirmation(sessionId, runId, onEvent, controller.signal);
          if (streamFinished) return;
        } catch (error) {
          if (intent === 'confirm' && !receiptShown) throw originalError || error;
        }
        if (!controller.signal.aborted && (intent !== 'confirm' || receiptShown)) {
          // The job can commit immediately before the reconnect request arrives.
          const response = await listAgentConversationMessages(sessionId);
          if (!controller.signal.aborted) {
            const history = (response.data || {}) as AgentConversationHistory;
            restoreSessionHistory(sessionId, history);
            if (intent === 'continue' && originalError && history.continuable_confirmation_run_id === runId) {
              onEvent({event: 'continuation.run.failed', data: {detail: '暂时无法从回执继续，请重试。'}});
            }
          }
        }
      }
    } catch (error) {
      if (controller.signal.aborted || receiptShown) return;
      try {
        const recovered = asRecord((await getAgentRunState(runId)).data?.data);
        if (recovered.status === 'completed' || recovered.status === 'failed') {
          applyCompletedRun(recovered);
          return;
        }
      } catch { /* Retain the owner-bound card so the same run can be retried. */ }
      const detail = (error as { response?: { data?: { detail?: string } }; message?: string })?.response?.data?.detail
        || (error as { message?: string })?.message
        || '原因未知';
      updateSessionMessage(sessionId, message.id, (item) => ({
        ...item,
        content: item.fullContent || item.content,
        fullContent: undefined,
        typing: false,
        confirmationError: `暂未收到执行结果（${detail}）。重试时会查询原操作结果。`,
      }));
    } finally {
      if (continuationStarted) {
        for (const actionId of pageActionIds) finishPageAction(actionId);
        if (!continuationFinished) {
          updateSessionMessage(sessionId, continuationMessageId, item => ({
            ...item,
            content: '后续对话连接已中断，刷新后可恢复进度。',
            fullContent: undefined,
            typing: false,
            trace: finishPendingTrace(item.trace, 'interrupted'),
          }));
        }
        activeContinuation.current = null;
        setSending(false);
      }
      if (streamController.current === controller) streamController.current = null;
      confirmationLocks.current.delete(runId);
      setConfirmingRunId(undefined);
    }
  };

  const stopGeneration = () => {
    const continuation = activeContinuation.current;
    if (continuation) {
      void stopAgentConfirmation(continuation.conversationId, continuation.runId).catch(() => {});
    } else {
      streamController.current?.abort();
    }
  };

  const cancelAgentAction = async (message: ChatMessage) => {
    const runId = message.runId;
    const sessionId = activeSession?.id;
    if (!runId || !sessionId || confirmingRunId) return;
    setConfirmingRunId(runId);
    try {
      await cancelAgentRun(runId);
      clearRecordCardDrafts(runId);
      setDesignPreview(current => current?.sessionId === sessionId && current.runId === runId ? undefined : current);
      updateSessionMessage(sessionId, message.id, item => ({
        ...item,
        content: item.fullContent || item.content,
        fullContent: undefined,
        typing: false,
        requiresConfirmation: false,
        confirmationPayload: undefined,
        confirmationError: undefined,
        confirmationCancelled: true,
        actionState: undefined,
        actions: undefined,
      }));
    } catch {
      updateSessionMessage(sessionId, message.id, item => ({
        ...item,
        confirmationError: '取消失败，请稍后再试。',
      }));
    } finally {
      setConfirmingRunId(undefined);
    }
  };

  const sendConfirmationAdjustment = (action: MockSkillAction, changes?: Record<string, unknown>) => {
    const inputNote = messageScopedNote(action.id);
    const note = inputNote.trim();
    if (!note || streamController.current || confirmationLocks.current.size) return;
    const pendingActionState = getPendingStateFromAction(action);
    if (changes && Object.keys(changes).length) {
      const slots = pendingActionState.collected_slots || {};
      const record = asRecord(slots.record);
      const data = { ...asRecord(record.data), ...asRecord(slots.data), ...changes };
      pendingActionState.collected_slots = {
        ...slots, data, ...(slots.record ? { record: { ...record, data } } : {}),
      };
    }
    void sendMessage(`请调整刚才的 ${getConfirmationTitle(action)}：${note}`, {
      pendingActionState,
      pending_action_state: pendingActionState,
    }, [], () => {
      setConfirmationNotes(previous => (
        previous[action.id] === inputNote ? { ...previous, [action.id]: '' } : previous
      ));
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
  const historyFailed = historyLoadError === (activeSession?.id || AI_WORKBENCH_PAGE);

  const chatWorkbench = (
          <div className="ai-workbench-chat">
          <div className="ai-chat-body" ref={bodyRef} onScroll={(event) => {
            const body = event.currentTarget;
            followLatest.current = body.scrollHeight - body.scrollTop - body.clientHeight < 48;
          }}>
            {!messages.length && (
              <div role="status">
                <Typography.Text type="secondary">{historyFailed ? '对话加载失败。' : '正在恢复对话…'}</Typography.Text>
                {historyFailed && (
                  <Button type="link" size="small" onClick={() => {
                    setHistoryLoadError(undefined);
                    setHistoryLoadAttempt(attempt => attempt + 1);
                  }}>
                    重试
                  </Button>
                )}
              </div>
            )}
            {messages.map((message) => {
              const hasContent = Boolean(message.content.trim());
              const isTypingAssistant = message.role === 'assistant' && Boolean(message.typing);
              const hasAnswer = hasContent || Boolean(message.fullContent?.trim());
              const hasTraceOrSteps = Boolean(message.trace?.length || message.steps?.length);
              const isPendingAssistant = message.role === 'assistant' && hasTraceOrSteps && !hasAnswer;
              const canShowAssistantMeta = message.role === 'assistant' && !isTypingAssistant;
              const actions = message.actions || [];
              const firstAction = actions[0];
              const firstReview = firstAction && getConfirmationReview(firstAction);
              const hasBatchReview = actions.length > 1;
              const canConfirm = Boolean(message.requiresConfirmation && message.runId);
              const confirmationToken = getConfirmationToken(message.confirmationPayload);
              const recordDrafts = message.runId ? recordCardDrafts[message.runId] : undefined;
              const hasInvalidChanges = Object.values(recordDrafts || {})
                .some(draft => !draft.valid && Object.keys(draft.changes).length);
              const failedReview = firstAction?.status === 'failed';
              const receipt = message.executionResult;
              const showReceipt = Boolean(receipt || firstAction?.status === 'completed');
              const canContinue = Boolean(message.runId && message.runId === activeSession?.continuableConfirmationRunId);
              const receiptTitle = hasBatchReview ? '已完成 ' + actions.length + ' 项操作'
                : (firstAction && confirmationTitles[firstAction.skill]?.completed)
                  || (receipt && receipt.kind !== 'generic' ? receipt.title : '操作已完成');
              const confirmationButtons = (label = '确认执行', cancelLabel = '取消') => <>
                <Button size="small" disabled={sending || Boolean(confirmingRunId)}
                  onClick={() => { void cancelAgentAction(message); }}>
                  {cancelLabel}
                </Button>
                <Button type="primary" size="small"
                  loading={confirmingRunId === message.runId}
                  disabled={sending || hasInvalidChanges || Boolean(confirmingRunId && confirmingRunId !== message.runId)}
                  onClick={() => { void confirmAgentAction(message); }}>
                  {label}
                </Button>
              </>;
              const actionStateReview = message.role === 'assistant' ? getActionStateReview(message.actionState) : undefined;
              const layoutReviewItem = message.role === 'assistant' && [...(message.items || [])].reverse().find(item =>
                item.type === 'page_action' && item.status === 'completed' && asRecord(item.payload).form_layout_review);
              const layoutReview = layoutReviewItem ? asRecord(asRecord(layoutReviewItem.payload).form_layout_review) : {};
              const layoutReviewId = layoutReviewItem ? layoutReviewItem.item_id || layoutReviewItem.id : undefined;
              const traceItems = message.trace || [];
              const executionHref = message.executionResult?.href;
              const activeRun = (sending && message.id === messages[messages.length - 1]?.id)
                || Boolean(confirmingRunId && confirmingRunId === message.runId);

              return (
              <div className={`ai-chat-message ${message.role}`} key={message.id}>
                <div className="ai-chat-bubble">
                  <Typography.Text className={isPendingAssistant ? 'ai-chat-pending-text' : undefined} type={isPendingAssistant ? 'secondary' : undefined}>
                    {hasContent ? message.content : (isPendingAssistant ? '正在处理...' : '')}
                    {isTypingAssistant ? <span className="ai-typing-cursor" /> : null}
                  </Typography.Text>
                   {message.role === 'assistant' && traceItems.length > 0 && (
                     <AgentExecutionTrace items={traceItems} active={activeRun} awaitingConfirmation={message.requiresConfirmation} />
                   )}
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
                </div>
                {typeof layoutReviewId === 'string' && typeof layoutReview.form_id === 'number' && typeof layoutReview.operation_count === 'number' && (
                  <NativeLayoutReview key={layoutReviewId} reviewId={layoutReviewId} formId={layoutReview.form_id}
                    operationCount={layoutReview.operation_count} disabled={sending || Boolean(confirmingRunId)} />
                )}
                {canShowAssistantMeta && message.confirmationCancelled && (
                  <div className="ai-confirmation-card ai-confirmation-cancelled">已取消操作</div>
                )}
                {canShowAssistantMeta && showReceipt && (
                  <details className="ai-confirmation-receipt" data-status="completed">
                    <summary>
                      <CheckCircleOutlined />
                      <span className="ai-confirmation-receipt-title">
                        <strong>{receiptTitle}</strong>
                        {!hasBatchReview && firstReview?.subject ? ' · ' + firstReview.subject : null}
                        {canContinue ? <small className="ai-confirmation-meta"> · 待继续处理</small> : null}
                      </span>
                    </summary>
                    <div className="ai-confirmation-receipt-body">
                      {actions.map((action, index) => {
                        const review = index === 0 && firstReview ? firstReview : getConfirmationReview(action);
                        return (
                          <div className="ai-confirmation-operation" key={action.id}>
                            {hasBatchReview && <strong>{getConfirmationTitle(action)}</strong>}
                            <ConfirmationFields fields={[
                              ...(review.subject ? [{ label: '操作对象', value: review.subject }] : []),
                              ...review.fields,
                            ]} />
                          </div>
                        );
                      })}
                      {receipt?.detail && receipt.detail !== executionHref && receipt.kind !== 'ai_draft' && (
                        <p className="ai-confirmation-meta">{receipt.detail}</p>
                      )}
                      {message.confirmationError && <p className="ai-confirmation-error" role="alert">{message.confirmationError}</p>}
                      {(executionHref || canContinue) && (
                        <div className="ai-confirmation-secondary">
                          {executionHref && <Button size="small" onClick={() => navigate(executionHref)}>打开</Button>}
                          {canContinue && (
                            <Button size="small" disabled={sending || Boolean(confirmingRunId)}
                              onClick={() => { void confirmAgentAction(message, 'continue'); }}>
                              继续处理
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </details>
                )}
                {canShowAssistantMeta && !showReceipt && firstAction && (
                  <article className="ai-confirmation-card">
                    <div className="ai-confirmation-head">
                      <h4>{hasBatchReview ? '确认 ' + actions.length + ' 项操作' : getConfirmationTitle(firstAction)}</h4>
                      <span className="ai-confirmation-status" data-status={failedReview ? 'failed' : undefined}>
                        {failedReview ? '执行未完成' : canConfirm ? '待确认' : '操作建议'}
                      </span>
                    </div>
                    {message.confirmationError || failedReview ? (
                      <p className="ai-confirmation-error" role="alert">{message.confirmationError || firstAction.summary}</p>
                    ) : null}
                    {actions.map((action, actionIndex) => {
                      const review = actionIndex === 0 && firstReview ? firstReview : getConfirmationReview(action);
                      const actionPreview = canConfirm ? confirmationDesignPreview(message.items, actionIndex, action.payload) : undefined;
                      const note = messageScopedNote(action.id);
                      const disabled = sending || Boolean(confirmingRunId);
                      const recordDraft = recordDrafts?.[actionIndex];
                      const canEditRecord = canConfirm && Boolean(confirmationToken) && supportsRecordReview(action);
                      const editedFields = canEditRecord ? Object.entries(recordDraft?.changes || {}) : [];
                      const highlights = editedFields.length ? editedFields.slice(0, 2).map(([key, value]) => ({
                        label: recordDraft?.review?.fields.find(field => field.name === key)?.label || formatSlotName(key),
                        value: recordDraft?.displayValues?.[key] || (value === null || value === '' ? '已清空' : formatActionValue(value)),
                      })) : review.highlights;
                      const subject = canEditRecord ? recordDraft?.review?.form_name || review.subject : review.subject;
                      const status = editedFields.length ? '已修改 ' + editedFields.length + ' 项' : review.meta;
                      return (
                        <div className="ai-confirmation-operation" key={action.id}>
                          {hasBatchReview && <h5>{getConfirmationTitle(action)}</h5>}
                          {(subject || status) && (
                            <div className="ai-confirmation-subject">
                              {subject && <strong>{subject}</strong>}
                              {status && <span className="ai-confirmation-meta">{status}</span>}
                            </div>
                          )}
                          {review.effect && <p className="ai-confirmation-meta">{review.effect}</p>}
                          {highlights.length > 0 && <ConfirmationFields fields={highlights} />}
                          <div className="ai-confirmation-secondary">
                            {canEditRecord && message.runId && confirmationToken ? (
                              <details className="ai-confirmation-details"
                                onToggle={event => {
                                  if (event.currentTarget.open && !recordDraft && message.runId) {
                                    updateRecordCardDraft(message.runId, actionIndex, {});
                                  }
                                }}>
                                <summary>查看并编辑</summary>
                                {recordDraft && (
                                  <RecordConfirmationReview
                                    runId={message.runId}
                                    token={confirmationToken}
                                    actionIndex={actionIndex}
                                    disabled={disabled}
                                    changes={recordDraft.changes}
                                    onChange={(changes, valid, displayValues) => {
                                      if (message.runId) updateRecordCardDraft(message.runId, actionIndex, { changes, valid, displayValues });
                                    }}
                                    onReview={(recordReview, valid) => {
                                      if (message.runId) updateRecordCardDraft(message.runId, actionIndex, { review: recordReview, valid });
                                    }}
                                  />
                                )}
                              </details>
                            ) : (
                              <details className="ai-confirmation-details">
                                <summary>查看详情</summary>
                                <ConfirmationFields fields={review.fields} />
                              </details>
                            )}
                            {actionPreview && activeSession && (
                              <Button type="link" size="small" aria-label={'查看' + getConfirmationTitle(action) + '预览'}
                                onClick={() => showDesignPreview(actionPreview, activeSession.id, message.id, message.runId)}>
                                查看预览
                              </Button>
                            )}
                            {canConfirm && message.runId && action.payload?._harness_tool === 'forms.create_form_definition' && (
                              <ConfigurationReviewEditor
                                runId={message.runId}
                                token={getConfirmationToken(message.confirmationPayload) || ''}
                                actionIndex={actionIndex}
                                payload={action.payload}
                                disabled={disabled}
                                onSaved={(items) => {
                                  if (!activeSessionId) return;
                                  updateSessionMessage(activeSessionId, message.id, current => ({
                                    ...current, items,
                                    actions: mapAgentActions(getConfirmationActions(items)),
                                    confirmationPayload: getConfirmationItemPayload(items),
                                  }));
                                }}
                              />
                            )}
                          </div>
                          {canConfirm && (
                            <div className="ai-confirmation-note">
                              <label htmlFor={'confirmation-note-' + action.id}>备注（可选）</label>
                              <div className="ai-confirmation-note-input">
                                <Input id={'confirmation-note-' + action.id} size="small" value={note} disabled={disabled}
                                  placeholder="补充需要 AI 调整的内容"
                                  onChange={event => {
                                    setConfirmationNotes(prev => ({ ...prev, [action.id]: event.target.value }));
                                  }}
                                />
                                {note.trim() && (
                                  <Button size="small" disabled={disabled || Boolean(editedFields.length && !recordDraft?.valid)}
                                    onClick={() => sendConfirmationAdjustment(action, recordDraft && recordCardChanges(recordDraft))}>
                                    更新方案
                                  </Button>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {canConfirm && (
                      <footer className="ai-confirmation-footer">
                        {hasBatchReview
                          ? confirmationButtons('确认执行 ' + actions.length + ' 项', '取消这批')
                          : confirmationButtons(firstAction.skill === 'forms.publish_to_menu' && firstAction.payload?.publish_required
                            ? '确认发布并挂载'
                            : confirmationTitles[firstAction.skill]?.confirm)}
                      </footer>
                    )}
                  </article>
                )}
                {canShowAssistantMeta && !firstAction && !showReceipt && message.confirmationError && (
                  <p className="ai-confirmation-error" role="alert">{message.confirmationError}</p>
                )}
                <span>{message.createdAt}</span>
              </div>
              );
            })}
            {nativeDraftReview && nativeDraftReview.sessionId === activeSession?.id && !sending && !messages[messages.length - 1]?.content.startsWith('执行失败') && <NativeDesignerReview key={nativeDraftReview.draftId} draftId={nativeDraftReview.draftId} disabled={sending || Boolean(confirmingRunId)} menuTarget={nativeDraftReview.menuTarget} onSaved={formId => {
              const target = nativeDraftReview.menuTarget;
              if (!target) return;
              void sendMessage(`请准备把刚保存的表单发布并挂载到应用菜单「${target.destination}」的确认卡片。`, {
                formMenuDelivery: { form_id: formId, ...target },
              });
            }} />}
          </div>

          <ChatComposer
            key={activeSession?.id}
            input={input}
            enabled={messages.length > 0 && (!confirmingRunId || sending)}
            sending={sending}
            onChange={setInput}
            onSend={(message, attachments) => sendMessage(message, undefined, attachments)}
            onStop={stopGeneration}
          />
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
      {enabled && <Tooltip title={open ? '收起 AI 助手' : '打开 AI 助手'} placement="left">
        <Button
          className="ai-edge-toggle"
          onClick={() => setOpen((prev) => !prev)}
          aria-label={open ? '收起 AI 助手' : '打开 AI 助手'}
          aria-expanded={open}
        >
          <MessageOutlined />

        </Button>
      </Tooltip>}

      {enabled && open && (
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
                <Button type="text" aria-label="关闭 AI 对话" icon={<CloseOutlined />} onClick={() => setOpen(false)} />
              </Tooltip>
            </Space>
          </header>

          {chatWorkbench}
        </section>
      )}
    </>
  );
}
