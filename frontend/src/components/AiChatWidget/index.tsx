import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Input, Space, Tag, Typography } from 'antd';
import {
  CloseOutlined,
  DeleteOutlined,
  FileTextOutlined,
  RobotOutlined,
  SendOutlined,
} from '@ant-design/icons';
import { useLocation } from 'react-router-dom';

type ChatRole = 'assistant' | 'user';

interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
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

const STORAGE_PREFIX = 'mf_ai_floating_chat:';

const contextByRoute: Array<{
  test: (pathname: string) => boolean;
  context: Omit<PageContext, 'title'> & { title?: string };
}> = [
  {
    test: (pathname) => pathname.includes('/program/device-health') || pathname === '/maintenance',
    context: {
      title: '设备健康',
      scope: '设备、健康分、故障预测、维修工单',
      intro: '我正在基于设备健康页面提供帮助，可以解释风险、总结设备状态，也可以生成维修工单草稿。',
      quickPrompts: ['总结当前设备健康', '解释高风险设备', '生成维修工单草稿', '给出本周维护优先级'],
    },
  },
  {
    test: (pathname) => pathname.includes('/program/supply') || pathname.includes('/program/material') || pathname === '/supply-chain',
    context: {
      title: '供应链风险',
      scope: '供应商、库存、物料影响、采购建议',
      intro: '我正在基于供应链页面提供帮助，可以总结供应风险、解释高风险供应商，也可以生成采购申请草稿。',
      quickPrompts: ['总结供应风险', '解释高风险供应商', '生成采购申请草稿', '给出替代供应商建议'],
    },
  },
  {
    test: (pathname) => pathname.includes('/program/quality') || pathname.includes('/program/defect') || pathname === '/quality',
    context: {
      title: '质量分析',
      scope: '缺陷、检验、SPC、CAPA、追溯',
      intro: '我正在基于质量页面提供帮助，可以解释质量异常、追溯影响范围，也可以生成 CAPA 草稿。',
      quickPrompts: ['总结质量异常', '解释缺陷原因', '生成 CAPA 草稿', '追溯影响范围'],
    },
  },
  {
    test: (pathname) => pathname.includes('/program/production') || pathname.includes('/program/oee') || pathname === '/dashboard',
    context: {
      title: '生产态势',
      scope: 'OEE、产线、计划、产量、告警',
      intro: '我正在基于生产页面提供帮助，可以解释 OEE、总结产线状态，也可以生成班次摘要。',
      quickPrompts: ['总结生产态势', '解释 OEE 下降原因', '生成班次摘要', '列出需要关注的产线'],
    },
  },
  {
    test: (pathname) => pathname.includes('/workflow'),
    context: {
      title: '流程中心',
      scope: '审批、待办、退回、流程状态',
      intro: '我正在基于流程中心提供帮助，可以总结待办、解释审批状态，也可以生成处理意见草稿。',
      quickPrompts: ['总结我的待办', '生成审批意见', '解释退回原因', '列出超时流程'],
    },
  },
  {
    test: (pathname) => pathname.includes('/system-admin') || pathname.includes('/account-center'),
    context: {
      title: '平台管理',
      scope: '应用、菜单、权限、审计、AI 设置',
      intro: '我正在基于平台管理页面提供帮助，可以解释配置、生成规则草稿，也可以总结审计线索。',
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
    intro: '我正在基于当前页面提供帮助，可以回答问题、总结内容，也可以生成草稿建议。',
    quickPrompts: ['总结当前页面', '解释关键指标', '生成处理建议', '我能在这里做什么'],
  };
}

function createAssistantMessage(content: string): ChatMessage {
  return {
    id: `assistant-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role: 'assistant',
    content,
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

function generateDemoReply(prompt: string, context: PageContext): string {
  const text = prompt.toLowerCase();

  if (context.title.includes('设备') || text.includes('维修') || text.includes('设备')) {
    if (text.includes('工单') || text.includes('草稿')) {
      return [
        '已生成维修工单草稿：',
        '',
        '设备：CNC-17 主轴',
        '优先级：高',
        '问题描述：健康分降至 68，故障预测显示振动升高，建议 48 小时内点检。',
        '建议动作：检查主轴轴承、润滑状态和振动传感器曲线。',
        '',
        'Demo 阶段我先生成草稿，不会直接提交流程。',
      ].join('\n');
    }
    if (text.includes('优先级')) {
      return [
        '本周维护优先级建议：',
        '1. CNC-17 主轴：健康分 68，优先安排点检。',
        '2. 空压机 2#：健康分 81，持续观察油温趋势。',
        '3. AGV-06：健康分 92，按计划保养即可。',
      ].join('\n');
    }
    return '当前设备健康整体稳定，但有少数高风险对象需要关注。建议优先查看健康分低于 70 的设备，并把故障概率、预计天数和已有工单一起判断。';
  }

  if (context.title.includes('供应') || text.includes('采购') || text.includes('供应商')) {
    if (text.includes('采购') || text.includes('草稿')) {
      return [
        '已生成采购申请草稿：',
        '',
        '物料：M-0042 关键备件',
        '建议数量：200 件',
        '原因：当前库存低于安全库存，预计 5 天后触发缺料风险。',
        '建议供应商：优先选择交付稳定且风险等级较低的供应商。',
        '',
        'Demo 阶段只生成草稿，正式下单需要人工确认。',
      ].join('\n');
    }
    return '供应链页面建议重点关注高风险供应商、库存天数不足的物料，以及会影响生产计划的缺口。AI 可以先帮你生成风险摘要和采购申请草稿。';
  }

  if (context.title.includes('质量') || text.includes('capa') || text.includes('缺陷')) {
    if (text.includes('capa') || text.includes('草稿')) {
      return [
        '已生成 CAPA 草稿：',
        '',
        '问题：近期缺陷率上升，疑似与某批次物料或工序参数波动有关。',
        '临时措施：隔离相关批次，增加首件和巡检频次。',
        '根因分析：建议追溯供应商批次、设备参数和操作班组。',
        '纠正措施：完成参数复核并更新检验规则。',
      ].join('\n');
    }
    return '质量页面建议先看异常批次、缺陷 Pareto 和影响范围。AI 可以帮助解释缺陷原因、生成 CAPA 草稿，并把相关订单或客户影响列出来。';
  }

  if (context.title.includes('生产') || text.includes('oee')) {
    return '生产态势建议先关注 OEE 下降的产线、计划达成率和停机原因。Demo 中我可以生成班次摘要、解释 OEE 变化，并列出需要班组长处理的事项。';
  }

  if (text.includes('能做什么')) {
    return `在“${context.title}”里，我可以做两类事：\n\n1. 问答型：解释页面、指标、数据和流程。\n2. 辅助型：生成摘要、建议、规则或业务单据草稿。\n\n当前上下文范围：${context.scope}。`;
  }

  return `我会基于“${context.title}”回答。Demo 阶段我先展示问答和辅助能力：可以解释当前页面、总结重点、生成处理建议或草稿，但不会直接提交业务动作。`;
}

export default function AiChatWidget({ pageTitle, applicationName }: AiChatWidgetProps) {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const bodyRef = useRef<HTMLDivElement>(null);

  const pageContext = useMemo(
    () => buildPageContext(location.pathname, pageTitle),
    [location.pathname, pageTitle],
  );

  const storageKey = `${STORAGE_PREFIX}${location.pathname}`;

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

  return (
    <>
      <Button
        className="ai-floating-button"
        type="primary"
        onClick={() => setOpen((prev) => !prev)}
        aria-label="AI Assistant"
      >
        <RobotOutlined />
        <span>AI</span>
      </Button>

      {open && (
        <section className="ai-chat-panel" aria-label="AI chat panel">
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
