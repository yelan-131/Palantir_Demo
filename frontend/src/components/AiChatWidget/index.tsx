import { useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import { Button, Input, Space, Tag, Tooltip, Typography } from 'antd';
import {
  CheckCircleOutlined,
  CloseOutlined,
  CodeOutlined,
  HistoryOutlined,
  MessageOutlined,
  PlusOutlined,
  SendOutlined,
} from '@ant-design/icons';
import { useLocation } from 'react-router-dom';
import {
  closeAgentConversation,
  confirmAgentRun,
  createAgentConversation,
  listAgentConversationMessages,
  listAgentConversations,
  streamAgentChat,
} from '@/services/api';
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

interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  fullContent?: string;
  typing?: boolean;
  createdAt: string;
  actions?: MockSkillAction[];
  steps?: AgentProcessStep[];
  source?: string;
  contextSources?: Record<string, number | boolean | string>;
  runId?: string;
  requiresConfirmation?: boolean;
  confirmationPayload?: Record<string, unknown>;
}

interface AgentSession {
  id: string;
  title: string;
  contextKey: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
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
  steps?: Array<Record<string, unknown>>;
  actions?: AgentSkillAction[];
  risk_level?: string;
  requires_confirmation?: boolean;
  confirmation_payload?: Record<string, unknown>;
}

interface PageContext {
  title: string;
  scope: string;
  intro: string;
  quickPrompts: string[];
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
  actions?: AgentSkillAction[];
  evidence?: Array<Record<string, unknown>>;
  mode?: string;
  run_id?: string;
  requires_confirmation?: boolean;
  confirmation_payload?: Record<string, unknown>;
  steps?: Array<Record<string, unknown>>;
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
      quickPrompts: ['总结当前设备健康', '解释高风险设备', '生成维修工单草稿', '给出本周维护优先级'],
    },
  },
  {
    test: (pathname) => pathname.includes('/program/supply') || pathname.includes('/program/material') || pathname === '/supply-chain',
    context: {
      title: '供应链风险',
      scope: '供应商、库存、物料影响、采购建议',
      intro: '我会基于供应链页面提供帮助，可以总结供应风险、解释高风险供应商，也可以生成采购或物料申请草稿。',
      quickPrompts: ['总结供应风险', '生成采购申请草稿', '生成物料申请草稿', '给出替代供应商建议'],
    },
  },
  {
    test: (pathname) => pathname.includes('/program/quality') || pathname.includes('/program/defect') || pathname === '/quality',
    context: {
      title: '质量分析',
      scope: '缺陷、检验、SPC、CAPA、追溯',
      intro: '我会基于质量页面提供帮助，可以解释质量异常、追溯影响范围，也可以生成 CAPA 草稿。',
      quickPrompts: ['总结质量异常', '解释缺陷原因', '生成 CAPA 草稿', '追溯影响范围'],
    },
  },
  {
    test: (pathname) => pathname.includes('/program/production') || pathname.includes('/program/oee') || pathname === '/dashboard',
    context: {
      title: '生产态势',
      scope: 'OEE、产线、计划、产量、告警',
      intro: '我会基于生产页面提供帮助，可以解释 OEE、总结产线状态，也可以生成班次摘要。',
      quickPrompts: ['总结生产态势', '解释 OEE 下降原因', '生成班次摘要', '列出需要关注的产线'],
    },
  },
  {
    test: (pathname) => pathname.includes('/workflow'),
    context: {
      title: '流程中心',
      scope: '审批、待办、退回、流程状态',
      intro: '我会基于流程中心提供帮助，可以总结待办、解释审批状态，也可以生成处理意见草稿。',
      quickPrompts: ['总结我的待办', '生成审批意见', '解释退回原因', '列出超时流程'],
    },
  },
  {
    test: (pathname) => pathname.includes('/system-admin') || pathname.includes('/account-center'),
    context: {
      title: '平台管理',
      scope: '应用、菜单、权限、审计、AI 设置',
      intro: '我会基于平台管理页面提供帮助，可以解释配置、生成规则草稿，也可以总结审计线索。',
      quickPrompts: ['解释当前配置', '生成规则草稿', '总结 AI 调用日志', '给出权限检查建议'],
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
      quickPrompts: matched.context.quickPrompts,
    };
  }

  return {
    title: fallbackTitle || '当前页面',
    scope: '当前页面数据、操作和业务上下文',
    intro: '我在。你可以直接聊天，也可以问当前页面里的数据、流程或下一步建议。',
    quickPrompts: ['随便聊聊', '总结当前页面', '解释关键指标', '生成处理建议'],
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
  return {
    id: `agent-session-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title,
    contextKey,
    messages: [createAssistantMessage(intro)],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function formatServerTime(value?: string | null): string {
  if (!value) return nowText();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return nowText();
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function mapServerMessage(message: AgentMessagePayload): ChatMessage {
  const isAssistant = message.role !== 'user';
  return {
    id: message.message_id || message.id || `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role: isAssistant ? 'assistant' : 'user',
    content: message.content || '',
    actions: isAssistant ? mapAgentActions(message.actions) : undefined,
    steps: isAssistant ? mapAgentSteps(message.steps) : undefined,
    createdAt: formatServerTime(message.created_at),
    source: isAssistant && message.model_name ? `model: ${message.model_name}` : undefined,
    contextSources: isAssistant ? getContextSources({ steps: message.steps }) : undefined,
    runId: isAssistant ? message.run_id : undefined,
    requiresConfirmation: isAssistant ? Boolean(message.requires_confirmation) : undefined,
    confirmationPayload: isAssistant ? message.confirmation_payload : undefined,
  };
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
  if (type === 'tool') return `调用工具 ${stringifyStepValue(step.tool) || ''}`.trim();
  if (type === 'policy') return '执行策略检查';
  if (type === 'plan') return '规划下一步';
  if (type === 'respond') return '生成回答';
  return '处理步骤';
}

function getAgentStepDetail(step: Record<string, unknown>): string | undefined {
  const parts = [
    stringifyStepValue(step.intent),
    stringifyStepValue(step.skill),
    stringifyStepValue(step.capability),
    stringifyStepValue(step.matched_role),
    stringifyStepValue(step.tool),
    step.result_count !== undefined ? `结果 ${step.result_count}` : '',
    step.semantic_objects !== undefined ? `对象 ${step.semantic_objects}` : '',
    step.semantic_records !== undefined ? `记录 ${step.semantic_records}` : '',
    stringifyStepValue(step.model),
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
  const answerStep = [...(payload.steps || [])].reverse().find((step) => step.type === 'respond');
  const modelConfigStep = [...(payload.steps || [])].reverse().find((step) => step.id === 'step-model-config');
  const provider = typeof answerStep?.provider === 'string' ? answerStep.provider : '';
  const model = typeof answerStep?.model === 'string' ? answerStep.model : '';
  const fallbackReason = typeof answerStep?.fallback_reason === 'string' ? answerStep.fallback_reason : '';

  if (modelConfigStep?.status === 'blocked') {
    return '未配置大模型';
  }
  if (provider || (model && model !== 'local-agent-runtime')) {
    return [provider && `provider: ${provider}`, model && `model: ${model}`].filter(Boolean).join(' / ');
  }
  if (fallbackReason) {
    return fallbackReason.includes('not configured') ? '未配置大模型' : '大模型连接失败';
  }
  if (payload.actions?.length) {
    return 'backend Agent: draft action generated';
  }
  return 'backend Agent';
}

function getContextSources(payload: AgentChatResponse): Record<string, number | boolean | string> | undefined {
  const contextStep = [...(payload.steps || [])].reverse().find((step) => step.id === 'step-context-builder');
  const sources = contextStep?.sources;
  return sources && typeof sources === 'object' && !Array.isArray(sources)
    ? sources as Record<string, number | boolean | string>
    : undefined;
}

function getConfirmationToken(payload?: Record<string, unknown>): string | undefined {
  const token = payload?.confirmation_token;
  return typeof token === 'string' ? token : undefined;
}

function isStepComplete(status: string): boolean {
  return ['completed', 'skipped', 'waiting_confirmation'].includes(status);
}

function getVisibleAgentSteps(steps?: AgentProcessStep[]): AgentProcessStep[] {
  if (!steps?.length) return [];
  return steps.slice(-5);
}

function getAgentProcessTitle(steps: AgentProcessStep[], hasContent: boolean): string {
  if (steps.some((step) => step.status === 'failed' || step.status === 'blocked')) return 'Agent 遇到问题';
  if (hasContent || steps.some((step) => step.status === 'waiting_confirmation')) return 'Agent 已整理完成';
  return 'Agent 正在处理';
}

function isAgentProcessActive(steps: AgentProcessStep[], hasContent: boolean): boolean {
  if (hasContent) return false;
  if (steps.some((step) => step.status === 'failed' || step.status === 'blocked')) return false;
  if (steps.some((step) => step.status === 'waiting_confirmation')) return false;
  return true;
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
  const [sending, setSending] = useState(false);
  const [confirmingRunId, setConfirmingRunId] = useState<string>();
  const [confirmationNotes, setConfirmationNotes] = useState<Record<string, string>>({});
  const bodyRef = useRef<HTMLDivElement>(null);
  const promptScrollerRef = useRef<HTMLDivElement>(null);
  const promptDragRef = useRef<{ pointerId: number; startX: number; scrollLeft: number; dragging: boolean } | null>(null);

  const pageContext = useMemo(
    () => buildPageContext(location.pathname, pageTitle),
    [location.pathname, pageTitle],
  );
  const surface = knowledgeContext ? 'knowledge' : 'global';
  const contextKey = AI_WORKBENCH_PAGE;
  const intro = '我是独立 AI 工作区。你可以直接聊天；当你问到当前页面、表单、数据、知识文档或业务分析时，我会按需读取相关上下文。';
  const quickPrompts = knowledgeContext
    ? ['这篇文档讲什么', '抽取系统和能力', '生成发布清单建议', '我能对它做什么']
    : pageContext.quickPrompts;
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

  const sendMessage = async (content: string) => {
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
      await streamAgentChat({
        message: trimmed,
        page: AI_WORKBENCH_PAGE,
        context: runtimeContext,
      }, ({ event, data }) => {
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
        if (event === 'step.completed') {
          const rawStep = data.step && typeof data.step === 'object'
            ? data.step as Record<string, unknown>
            : data;
          const nextStep = mapAgentStep(rawStep);
          updateSessionMessage(sessionId, assistantMessageId, (message) => {
            const steps = message.steps || [];
            const existing = steps.findIndex((step) => step.id === nextStep.id);
            const nextSteps = existing >= 0
              ? steps.map((step, index) => (index === existing ? nextStep : step))
              : [...steps, nextStep];
            return { ...message, steps: nextSteps };
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
            actions: mapAgentActions(payload.actions),
            steps: mapAgentSteps(payload.steps) || message.steps,
            source: getAgentResponseSource(payload),
            contextSources: getContextSources(payload),
            runId: payload.run_id,
            requiresConfirmation: Boolean(payload.requires_confirmation),
            confirmationPayload: payload.confirmation_payload,
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
    try {
      const response = await confirmAgentRun(runId, {
        confirmation_token: token,
        confirmed: true,
      });
      const run = (response.data?.data || {}) as Record<string, unknown>;
      const results = Array.isArray(run.tool_results) ? run.tool_results : [];
      const completed = results.find((item) => (
        item && typeof item === 'object' && (item as Record<string, unknown>).status === 'completed'
      )) as Record<string, unknown> | undefined;
      const result = completed?.result && typeof completed.result === 'object'
        ? completed.result as Record<string, unknown>
        : {};
      const routePath = typeof result.route_path === 'string' ? result.route_path : '';
      const nextMessages = messages.map((item) => (
        item.id === message.id
          ? (() => {
            const currentContent = item.fullContent || item.content;
            return {
              ...item,
              content: routePath
                ? `${currentContent}\n\n已确认执行，表单已创建：${routePath}`
                : `${currentContent}\n\n已确认执行。`,
              fullContent: undefined,
              typing: false,
              requiresConfirmation: false,
              source: 'backend Agent: confirmed execution',
            };
          })()
          : item
      ));
      setSessionMessages(activeSession.id, nextMessages);
    } catch {
      const nextMessages = messages.map((item) => (
        item.id === message.id
          ? {
            ...item,
            content: `${item.fullContent || item.content}\n\n确认执行失败，请检查权限或稍后重试。`,
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
    void sendMessage(`请调整刚才的 ${action.title}：${note}`);
  };

  const messageScopedNote = (actionId: string) => confirmationNotes[actionId] || '';

  const scrollPromptsWithWheel = (event: WheelEvent<HTMLDivElement>) => {
    const scroller = promptScrollerRef.current;
    if (!scroller) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (!delta) return;
    event.preventDefault();
    scroller.scrollLeft += delta;
  };

  const startPromptDrag = (event: PointerEvent<HTMLDivElement>) => {
    const scroller = promptScrollerRef.current;
    if (!scroller) return;
    promptDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      scrollLeft: scroller.scrollLeft,
      dragging: false,
    };
    scroller.setPointerCapture(event.pointerId);
  };

  const dragPrompts = (event: PointerEvent<HTMLDivElement>) => {
    const drag = promptDragRef.current;
    const scroller = promptScrollerRef.current;
    if (!drag || !scroller || drag.pointerId !== event.pointerId) return;
    const distance = event.clientX - drag.startX;
    if (Math.abs(distance) > 3) drag.dragging = true;
    if (!drag.dragging) return;
    event.preventDefault();
    scroller.scrollLeft = drag.scrollLeft - distance;
  };

  const stopPromptDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = promptDragRef.current;
    const scroller = promptScrollerRef.current;
    if (drag && scroller && drag.pointerId === event.pointerId) {
      scroller.releasePointerCapture(event.pointerId);
    }
    window.setTimeout(() => {
      promptDragRef.current = null;
    }, 0);
  };

  const chatWorkbench = (
          <div className="ai-workbench-chat">
          <div className="ai-chat-body" ref={bodyRef}>
            {messages.map((message) => {
              const processSteps = message.role === 'assistant' ? getVisibleAgentSteps(message.steps) : [];
              const hasProcess = processSteps.length > 0;
              const hasContent = Boolean(message.content.trim());
              const isTypingAssistant = message.role === 'assistant' && Boolean(message.typing);
              const hasAnswer = hasContent || Boolean(message.fullContent?.trim());
              const isPendingAssistant = message.role === 'assistant' && hasProcess && !hasAnswer;
              const canShowAssistantMeta = message.role === 'assistant' && !isTypingAssistant;
              const isProcessActive = hasProcess && isAgentProcessActive(processSteps, hasAnswer);

              return (
              <div className={`ai-chat-message ${message.role}`} key={message.id}>
                <div className="ai-chat-bubble">
                  {hasProcess ? (
                    <div className="ai-agent-process">
                      <div className="ai-agent-process-title">
                        <span className={`ai-agent-process-dot ${isProcessActive ? 'active' : 'done'}`} />
                        <span>{getAgentProcessTitle(processSteps, hasAnswer)}</span>
                      </div>
                      <div className="ai-agent-process-steps">
                        {processSteps.map((step) => (
                          <div className={`ai-agent-process-step ${isStepComplete(step.status) ? 'done' : 'active'}`} key={step.id}>
                            <span className="ai-agent-process-dot" />
                            <div>
                              <span>{step.label}</span>
                              {step.detail ? <small>{step.detail}</small> : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
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
                  {canShowAssistantMeta && message.actions?.length ? (
                    <div className="ai-skill-action-list">
                      {message.actions.map((action) => {
                        const review = getLowCodeReview(action);
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
                          {!review && message.requiresConfirmation && message.runId ? (
                            <Button
                              type="primary"
                              size="small"
                              icon={<CheckCircleOutlined />}
                              loading={confirmingRunId === message.runId}
                              onClick={() => { void confirmAgentAction(message); }}
                            >
                              确认执行
                            </Button>
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

          <div
            className="ai-chat-quick-prompts"
            ref={promptScrollerRef}
            onWheel={scrollPromptsWithWheel}
            onPointerDown={startPromptDrag}
            onPointerMove={dragPrompts}
            onPointerUp={stopPromptDrag}
            onPointerCancel={stopPromptDrag}
          >
            {quickPrompts.map((prompt) => (
              <Button
                key={prompt}
                size="small"
                disabled={sending}
                onClick={() => {
                  if (promptDragRef.current?.dragging) return;
                  void sendMessage(prompt);
                }}
              >
                {prompt}
              </Button>
            ))}
          </div>

          <div className="ai-chat-input">
            <Input.TextArea
              value={input}
              placeholder="问我当前页面的问题，或让我生成草稿..."
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
              {sessions.map((session) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={session.id === activeSession?.id}
                  className={`ai-agent-title-tab ${session.id === activeSession?.id ? 'active' : ''}`}
                  key={session.id}
                  onClick={() => {
                    setActiveSessionId(session.id);
                    setHistoryOpen(false);
                  }}
                >
                  <MessageOutlined />
                  <Typography.Text strong>{session.title || '当前窗口'}</Typography.Text>
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
              ))}
            </div>
            <Space size={4} className="ai-agent-title-actions">
              <Tooltip title="新建窗口">
                <Button type="text" icon={<PlusOutlined />} onClick={() => { void startNewSession(); }} />
              </Tooltip>
              <Tooltip title="历史记录">
                <Button
                  type="text"
                  icon={<HistoryOutlined />}
                  onClick={() => setHistoryOpen((prev) => !prev)}
                />
              </Tooltip>
              <Tooltip title="收起">
                <Button type="text" icon={<CloseOutlined />} onClick={() => setOpen(false)} />
              </Tooltip>
            </Space>
          </header>

          {historyOpen ? (
            <div className="ai-session-history">
              {sessions.map((session) => (
                <button
                  type="button"
                  className={`ai-session-history-item ${session.id === activeSession?.id ? 'active' : ''}`}
                  key={session.id}
                  onClick={() => {
                    setActiveSessionId(session.id);
                    setHistoryOpen(false);
                  }}
                >
                  <span>{session.title}</span>
                  <small>
                    {session.messages.length} 条消息 · {session.updatedAt}
                  </small>
                </button>
              ))}
            </div>
          ) : null}

          {chatWorkbench}
        </section>
      )}
    </>
  );
}
