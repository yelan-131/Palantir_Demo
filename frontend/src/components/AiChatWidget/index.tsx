import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { Button, Input, Space, Tag, Typography } from 'antd';
import {
  CheckCircleOutlined,
  CloseOutlined,
  CodeOutlined,
  DeleteOutlined,
  FileTextOutlined,
  RobotOutlined,
  SendOutlined,
} from '@ant-design/icons';
import { useLocation } from 'react-router-dom';
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
}

interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  actions?: MockSkillAction[];
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

interface DemoReply {
  content: string;
  actions?: MockSkillAction[];
}

const STORAGE_PREFIX = 'mf_ai_floating_chat:';
const POSITION_STORAGE_KEY = 'mf_ai_floating_position';
const DEFAULT_FLOATING_POSITION = { x: 24, y: 24 };

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
      intro: '我会基于供应链页面提供帮助，可以总结供应风险、解释高风险供应商，也可以生成采购申请或物料申请草稿。',
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

const nowText = () => new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

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
    intro: '我会基于当前页面提供帮助，可以回答问题、总结内容，也可以生成草稿建议。',
    quickPrompts: ['总结当前页面', '解释关键指标', '生成处理建议', '我能在这里做什么'],
  };
}

function createAssistantMessage(reply: DemoReply | string): ChatMessage {
  return {
    id: `assistant-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role: 'assistant',
    content: typeof reply === 'string' ? reply : reply.content,
    actions: typeof reply === 'string' ? undefined : reply.actions,
    createdAt: nowText(),
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

function createAction(skill: string, data: Omit<MockSkillAction, 'id' | 'skill' | 'status'>): MockSkillAction {
  return {
    id: `${skill}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    skill,
    status: 'draft_created',
    ...data,
  };
}

function buildWorkOrderDraft(): MockSkillAction {
  return createAction('maintenance.create_work_order_draft', {
    title: '维修工单草稿',
    summary: '已根据设备健康分和振动趋势生成待复核工单。',
    fields: [
      { label: '设备', value: 'CNC-17 主轴' },
      { label: '优先级', value: '高' },
      { label: '建议窗口', value: '48 小时内' },
      { label: '风险信号', value: '健康分 68，振动升高' },
    ],
    nextSteps: ['补充停机窗口', '确认备件库存', '提交维护主管审批'],
  });
}

function buildPurchaseRequestDraft(): MockSkillAction {
  return createAction('supply.create_purchase_request_draft', {
    title: '采购申请草稿',
    summary: '已按安全库存缺口生成采购申请，等待采购员确认价格和交期。',
    fields: [
      { label: '物料', value: 'M-0042 关键备件' },
      { label: '建议数量', value: '200 件' },
      { label: '需求原因', value: '预计 5 天后低于安全库存' },
      { label: '推荐供应商', value: '华东精密 / 风险等级低' },
    ],
    nextSteps: ['确认预算科目', '拉取最新报价', '提交采购审批'],
  });
}

function buildMaterialApplicationDraft(): MockSkillAction {
  return createAction('material.create_material_application_draft', {
    title: '物料申请草稿',
    summary: '已为受影响产线生成领料申请，保留人工确认入口。',
    fields: [
      { label: '申请产线', value: '装配二线' },
      { label: '物料编码', value: 'MAT-2188' },
      { label: '申请数量', value: '36 套' },
      { label: '用途', value: '应对批次返修与补料' },
    ],
    nextSteps: ['确认批次号', '校验仓库可用量', '发送给仓库复核'],
  });
}

function buildCapaDraft(): MockSkillAction {
  return createAction('quality.create_capa_draft', {
    title: 'CAPA 草稿',
    summary: '已把质量异常整理为纠正预防措施草稿，尚未写入后端流程。',
    fields: [
      { label: '问题', value: '缺陷率连续 3 班次升高' },
      { label: '临时措施', value: '隔离相关批次，提高巡检频次' },
      { label: '疑似根因', value: '物料批次或工艺参数波动' },
      { label: '责任角色', value: '质量工程师 / 工艺工程师' },
    ],
    nextSteps: ['补充 5Why 分析', '关联受影响订单', '提交 CAPA 负责人复核'],
  });
}

function buildDraftActions(text: string, context: PageContext): MockSkillAction[] {
  const actions: MockSkillAction[] = [];
  const wantsDraft = text.includes('草稿') || text.includes('生成') || text.includes('申请') || text.includes('工单') || text.includes('capa');

  if ((context.title.includes('设备') || text.includes('维修') || text.includes('工单')) && wantsDraft) {
    actions.push(buildWorkOrderDraft());
  }

  if ((context.title.includes('供应') || text.includes('采购')) && wantsDraft) {
    actions.push(buildPurchaseRequestDraft());
  }

  if ((context.title.includes('供应') || text.includes('物料') || text.includes('领料')) && wantsDraft) {
    actions.push(buildMaterialApplicationDraft());
  }

  if ((context.title.includes('质量') || text.includes('capa') || text.includes('缺陷')) && wantsDraft) {
    actions.push(buildCapaDraft());
  }

  return actions;
}

function generateDemoReply(prompt: string, context: PageContext): DemoReply {
  const text = prompt.toLowerCase();
  const actions = buildDraftActions(text, context);

  if (actions.length) {
    return {
      content: [
        '已生成 mock skill 调用结果。Demo 只在前端展示草稿卡片，不会提交后端或真实流程。',
        '',
        '你可以把这些卡片理解为 Agent Shell 对业务技能的模拟编排结果，后续接入真实服务时再替换为接口返回。',
      ].join('\n'),
      actions,
    };
  }

  if (context.title.includes('设备')) {
    if (text.includes('优先级')) {
      return {
        content: [
          '本周维护优先级建议：',
          '1. CNC-17 主轴：健康分 68，优先安排点检。',
          '2. 空压机 2#：健康分 81，持续观察油温趋势。',
          '3. AGV-06：健康分 92，按计划保养即可。',
        ].join('\n'),
      };
    }
    return {
      content: '当前设备健康整体稳定，但少数高风险对象需要关注。建议优先查看健康分低于 70 的设备，并把故障概率、预计天数和已有工单一起判断。',
    };
  }

  if (context.title.includes('供应')) {
    return {
      content: '供应链页面建议重点关注高风险供应商、库存天数不足的物料，以及会影响生产计划的缺口。需要草稿时可以让我生成采购申请或物料申请。',
    };
  }

  if (context.title.includes('质量')) {
    return {
      content: '质量页面建议先看异常批次、缺陷 Pareto 和影响范围。我可以帮助解释缺陷原因、生成 CAPA 草稿，并列出相关订单或客户影响。',
    };
  }

  if (context.title.includes('生产')) {
    return {
      content: '生产态势建议先关注 OEE 下降的产线、计划达成率和停机原因。Demo 中我可以生成班次摘要、解释 OEE 变化，并列出需要班组长处理的事项。',
    };
  }

  if (text.includes('能做什么')) {
    return {
      content: `在“${context.title}”里，我可以做两类事：\n\n1. 问答型：解释页面、指标、数据和流程。\n2. 辅助型：生成摘要、建议、规则或业务单据草稿。\n\n当前上下文范围：${context.scope}。`,
    };
  }

  return {
    content: `我会基于“${context.title}”回答。Demo 阶段我会展示问答和 mock skill 调用能力：可以解释当前页面、总结重点、生成处理建议或草稿，但不会直接提交业务动作。`,
  };
}

function getStatusLabel(status: MockSkillStatus) {
  return status === 'draft_created' ? '草稿已生成' : '待复核';
}

export default function AiChatWidget({ pageTitle, applicationName }: AiChatWidgetProps) {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [floatingPosition, setFloatingPosition] = useState(DEFAULT_FLOATING_POSITION);
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number; dragging: boolean } | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const pageContext = useMemo(
    () => buildPageContext(location.pathname, pageTitle),
    [location.pathname, pageTitle],
  );

  const storageKey = `${STORAGE_PREFIX}${location.pathname}`;

  useEffect(() => {
    const stored = localStorage.getItem(POSITION_STORAGE_KEY);
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored) as { x: number; y: number };
      if (Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
        setFloatingPosition({
          x: Math.max(12, Math.min(parsed.x, window.innerWidth - 96)),
          y: Math.max(12, Math.min(parsed.y, window.innerHeight - 72)),
        });
      }
    } catch {
      localStorage.removeItem(POSITION_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as ChatMessage[];
        setMessages(parsed);
        return;
      } catch {
        localStorage.removeItem(storageKey);
      }
    }

    setMessages([createAssistantMessage(pageContext.intro)]);
  }, [pageContext.intro, storageKey]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, open]);

  const persistMessages = (next: ChatMessage[]) => {
    setMessages(next);
    localStorage.setItem(storageKey, JSON.stringify(next));
  };

  const sendMessage = (content: string) => {
    const trimmed = content.trim();
    if (!trimmed) return;

    const next = [
      ...messages,
      createUserMessage(trimmed),
      createAssistantMessage(generateDemoReply(trimmed, pageContext)),
    ];
    persistMessages(next);
    setInput('');
  };

  const startNewSession = () => {
    const next = [createAssistantMessage(pageContext.intro)];
    persistMessages(next);
    setInput('');
  };

  const startDrag = (event: PointerEvent<HTMLButtonElement>) => {
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: floatingPosition.x,
      originY: floatingPosition.y,
      dragging: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const dragFloatingButton = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (Math.abs(deltaX) + Math.abs(deltaY) > 4) drag.dragging = true;
    if (!drag.dragging) return;
    setFloatingPosition({
      x: Math.max(12, Math.min(drag.originX - deltaX, window.innerWidth - 96)),
      y: Math.max(12, Math.min(drag.originY - deltaY, window.innerHeight - 72)),
    });
  };

  const stopDrag = () => {
    const drag = dragRef.current;
    if (!drag) return;
    localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(floatingPosition));
    window.setTimeout(() => {
      dragRef.current = null;
    }, 0);
  };

  const toggleOpen = () => {
    if (dragRef.current?.dragging) return;
    setOpen((prev) => !prev);
  };

  return (
    <>
      <Button
        className="ai-floating-button"
        type="primary"
        style={{ right: floatingPosition.x, bottom: floatingPosition.y }}
        onPointerDown={startDrag}
        onPointerMove={dragFloatingButton}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
        onClick={toggleOpen}
        aria-label="AI Assistant"
      >
        <RobotOutlined />
        <span>AI</span>
      </Button>

      {open && (
        <section
          className="ai-chat-panel"
          style={{ right: floatingPosition.x, bottom: floatingPosition.y + 64 }}
          aria-label="AI chat panel"
        >
          <header className="ai-chat-header">
            <div>
              <Space size={8} align="center">
                <RobotOutlined />
                <Typography.Text strong>ManuFoundry AI</Typography.Text>
              </Space>
              <Typography.Text type="secondary">
                基于当前页面：{pageContext.title}
              </Typography.Text>
            </div>
            <Button type="text" icon={<CloseOutlined />} onClick={() => setOpen(false)} />
          </header>

          <div className="ai-chat-context">
            <Tag color="blue">{applicationName || '当前应用'}</Tag>
            <span>{pageContext.scope}</span>
          </div>

          <div className="ai-chat-body" ref={bodyRef}>
            {messages.map((message) => (
              <div className={`ai-chat-message ${message.role}`} key={message.id}>
                <div className="ai-chat-bubble">
                  <Typography.Text>{message.content}</Typography.Text>
                  {message.actions?.length ? (
                    <div className="ai-skill-action-list">
                      {message.actions.map((action) => (
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
                          <dl className="ai-skill-action-fields">
                            {action.fields.map((field) => (
                              <div key={`${action.id}-${field.label}`}>
                                <dt>{field.label}</dt>
                                <dd>{field.value}</dd>
                              </div>
                            ))}
                          </dl>
                          <div className="ai-skill-action-next">
                            <Typography.Text type="secondary">后续动作</Typography.Text>
                            <ol>
                              {action.nextSteps.map((step) => (
                                <li key={`${action.id}-${step}`}>{step}</li>
                              ))}
                            </ol>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : null}
                </div>
                <span>{message.createdAt}</span>
              </div>
            ))}
          </div>

          <div className="ai-chat-quick-prompts">
            {pageContext.quickPrompts.map((prompt) => (
              <Button key={prompt} size="small" onClick={() => sendMessage(prompt)}>
                {prompt}
              </Button>
            ))}
          </div>

          <div className="ai-chat-input">
            <Input.TextArea
              value={input}
              placeholder="问我当前页面的问题，或让我生成草稿..."
              autoSize={{ minRows: 1, maxRows: 3 }}
              onChange={(event) => setInput(event.target.value)}
              onPressEnter={(event) => {
                if (!event.shiftKey) {
                  event.preventDefault();
                  sendMessage(input);
                }
              }}
            />
            <Button type="primary" icon={<SendOutlined />} onClick={() => sendMessage(input)} />
          </div>

          <footer className="ai-chat-footer">
            <Button size="small" icon={<FileTextOutlined />} onClick={startNewSession}>
              新会话
            </Button>
            <Button size="small" icon={<DeleteOutlined />} onClick={startNewSession}>
              清空当前页历史
            </Button>
          </footer>
        </section>
      )}
    </>
  );
}
