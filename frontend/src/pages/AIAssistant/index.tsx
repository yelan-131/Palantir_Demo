import React, { useState, useEffect, useRef } from 'react';
import {
  Card,
  Input,
  Button,
  Space,
  Tag,
  Typography,
  Spin,
  Empty,
  Table,
  Divider,
  Row,
  Col,
} from 'antd';
import {
  SendOutlined,
  RobotOutlined,
  UserOutlined,
  BulbOutlined,
  BarChartOutlined,
  DatabaseOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { sendChat, smartAnalyze } from '@/services/api';

const { Text, Title, Paragraph } = Typography;
const { TextArea } = Input;

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  intent?: string;
  structuredData?: Record<string, unknown>;
  analysisType?: string;
}

const INTENT_CONFIG: Record<string, { color: string; label: string; icon: React.ReactNode }> = {
  query: { color: 'blue', label: '数据查询', icon: <DatabaseOutlined /> },
  analysis: { color: 'purple', label: '智能分析', icon: <BarChartOutlined /> },
  alert: { color: 'red', label: '异常告警', icon: <ThunderboltOutlined /> },
  recommendation: { color: 'green', label: '优化建议', icon: <BulbOutlined /> },
  general: { color: 'default', label: '通用对话', icon: <RobotOutlined /> },
};

const QUICK_QUERIES = [
  '查询 CNC-001 设备的实时状态',
  '分析本月 OEE 下降的原因',
  '哪些物料库存低于安全线？',
  '供应商交付准时率排名',
  '预测下周设备故障风险',
  '最近 24 小时质量缺陷统计',
];

export default function AIAssistantPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef<string>(`session_${Date.now()}`);

  useEffect(() => {
    // Welcome message
    setMessages([
      {
        id: 'welcome',
        role: 'assistant',
        content:
          '您好！我是 ManuFoundry AI 助手，可以帮您查询数据、分析生产状况、预测设备风险和提供优化建议。请问有什么可以帮您的？',
        timestamp: new Date().toLocaleTimeString('zh-CN'),
        intent: 'general',
      },
    ]);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    const text = inputValue.trim();
    if (!text) return;

    const userMessage: ChatMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date().toLocaleTimeString('zh-CN'),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setSending(true);

    try {
      const res = await sendChat(text, sessionIdRef.current);
      const data = res.data ?? {};
      const assistantMessage: ChatMessage = {
        id: `assistant_${Date.now()}`,
        role: 'assistant',
        content: data.reply ?? data.content ?? data.message ?? '抱歉，我无法处理该请求。',
        timestamp: new Date().toLocaleTimeString('zh-CN'),
        intent: data.intent ?? 'general',
        structuredData: data.data ?? data.structured_data ?? undefined,
        analysisType: data.analysis_type ?? undefined,
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `error_${Date.now()}`,
          role: 'assistant',
          content: '抱歉，请求处理失败，请稍后重试。',
          timestamp: new Date().toLocaleTimeString('zh-CN'),
          intent: 'general',
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  const handleQuickQuery = (query: string) => {
    setInputValue(query);
  };

  const handleSmartAnalyze = async (query: string) => {
    setSending(true);
    const userMessage: ChatMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      content: `[智能分析] ${query}`,
      timestamp: new Date().toLocaleTimeString('zh-CN'),
    };
    setMessages((prev) => [...prev, userMessage]);

    try {
      const res = await smartAnalyze(query);
      const data = res.data ?? {};
      const assistantMessage: ChatMessage = {
        id: `assistant_${Date.now()}`,
        role: 'assistant',
        content: data.summary ?? data.content ?? '分析完成。',
        timestamp: new Date().toLocaleTimeString('zh-CN'),
        intent: 'analysis',
        structuredData: data.data ?? data.results ?? undefined,
        analysisType: data.analysis_type ?? '综合分析',
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `error_${Date.now()}`,
          role: 'assistant',
          content: '分析请求失败，请稍后重试。',
          timestamp: new Date().toLocaleTimeString('zh-CN'),
          intent: 'general',
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  const renderStructuredData = (data: Record<string, unknown>) => {
    if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object') {
      const columns = Object.keys(data[0]).map((key) => ({
        title: key,
        dataIndex: key,
        key: key,
        ellipsis: true,
        width: 120,
        render: (val: unknown) => {
          if (typeof val === 'number') return val.toLocaleString();
          if (typeof val === 'boolean') return val ? '是' : '否';
          return String(val ?? '-');
        },
      }));
      return (
        <Table
          size="small"
          columns={columns}
          dataSource={data.map((row: Record<string, unknown>, i: number) => ({ ...row, _key: i }))}
          rowKey="_key"
          pagination={{ pageSize: 5 }}
          scroll={{ x: 'max-content' }}
          style={{ marginTop: 8 }}
        />
      );
    }
    return (
      <pre
        style={{
          background: '#f5f5f5',
          padding: 10,
          borderRadius: 6,
          fontSize: 12,
          maxHeight: 200,
          overflow: 'auto',
          marginTop: 8,
        }}
      >
        {JSON.stringify(data, null, 2)}
      </pre>
    );
  };

  return (
    <div>
      <Title level={4}>AI 助手</Title>
      <Row gutter={16} style={{ height: 'calc(100vh - 180px)' }}>
        {/* Chat Area */}
        <Col span={18}>
          <Card
            size="small"
            style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
            styles={{ body: { flex: 1, display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' } }}
          >
            {/* Messages */}
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: 16,
              }}
            >
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  style={{
                    display: 'flex',
                    justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                    marginBottom: 16,
                  }}
                >
                  <div
                    style={{
                      maxWidth: '75%',
                      display: 'flex',
                      gap: 8,
                      flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                    }}
                  >
                    {/* Avatar */}
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: '50%',
                        background: msg.role === 'user' ? '#1677ff' : '#f0f0f0',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {msg.role === 'user' ? (
                        <UserOutlined style={{ color: '#fff', fontSize: 14 }} />
                      ) : (
                        <RobotOutlined style={{ color: '#1677ff', fontSize: 14 }} />
                      )}
                    </div>

                    {/* Bubble */}
                    <div>
                      {msg.role === 'assistant' && msg.intent && (
                        <div style={{ marginBottom: 4 }}>
                          <Tag
                            color={INTENT_CONFIG[msg.intent]?.color ?? 'default'}
                            icon={INTENT_CONFIG[msg.intent]?.icon}
                            style={{ fontSize: 11 }}
                          >
                            {INTENT_CONFIG[msg.intent]?.label ?? msg.intent}
                          </Tag>
                          {msg.analysisType && (
                            <Tag color="purple" style={{ fontSize: 11 }}>
                              {msg.analysisType}
                            </Tag>
                          )}
                        </div>
                      )}
                      <div
                        style={{
                          background: msg.role === 'user' ? '#1677ff' : '#f5f5f5',
                          color: msg.role === 'user' ? '#fff' : undefined,
                          padding: '10px 14px',
                          borderRadius: msg.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                          fontSize: 13,
                          lineHeight: 1.7,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                        }}
                      >
                        {msg.content}
                      </div>
                      {msg.role === 'assistant' && msg.structuredData && (
                        <div
                          style={{
                            background: '#fff',
                            border: '1px solid #f0f0f0',
                            borderRadius: 8,
                            padding: 8,
                            marginTop: 6,
                            maxWidth: 500,
                          }}
                        >
                          <Text type="secondary" style={{ fontSize: 11, marginBottom: 4, display: 'block' }}>
                            结构化数据:
                          </Text>
                          {renderStructuredData(msg.structuredData)}
                        </div>
                      )}
                      <Text type="secondary" style={{ fontSize: 10, marginTop: 2, display: 'block' }}>
                        {msg.timestamp}
                      </Text>
                    </div>
                  </div>
                </div>
              ))}
              {sending && (
                <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: '50%',
                      background: '#f0f0f0',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <RobotOutlined style={{ color: '#1677ff', fontSize: 14 }} />
                  </div>
                  <div
                    style={{
                      background: '#f5f5f5',
                      padding: '10px 14px',
                      borderRadius: '12px 12px 12px 2px',
                    }}
                  >
                    <Spin size="small" />
                    <Text type="secondary" style={{ marginLeft: 8 }}>
                      正在思考...
                    </Text>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div
              style={{
                borderTop: '1px solid #f0f0f0',
                padding: '12px 16px',
                background: '#fafafa',
              }}
            >
              <Space.Compact style={{ width: '100%' }}>
                <TextArea
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder="输入问题或指令，按 Enter 发送..."
                  autoSize={{ minRows: 1, maxRows: 4 }}
                  onPressEnter={(e) => {
                    if (!e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  style={{ borderRadius: '6px 0 0 6px' }}
                  disabled={sending}
                />
                <Button
                  type="primary"
                  icon={<SendOutlined />}
                  onClick={handleSend}
                  loading={sending}
                  style={{ height: 'auto', borderRadius: '0 6px 6px 0' }}
                >
                  发送
                </Button>
              </Space.Compact>
            </div>
          </Card>
        </Col>

        {/* Sidebar: Quick Queries & Tips */}
        <Col span={6}>
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Card title="快捷提问" size="small">
              <Space direction="vertical" size={6} style={{ width: '100%' }}>
                {QUICK_QUERIES.map((q) => (
                  <Button
                    key={q}
                    block
                    size="small"
                    type="dashed"
                    onClick={() => handleQuickQuery(q)}
                    style={{ textAlign: 'left', whiteSpace: 'normal', height: 'auto', padding: '4px 8px' }}
                  >
                    {q}
                  </Button>
                ))}
              </Space>
            </Card>

            <Card title="智能分析" size="small">
              <Space direction="vertical" size={6} style={{ width: '100%' }}>
                <Button
                  block
                  size="small"
                  type="primary"
                  ghost
                  onClick={() => handleSmartAnalyze('分析本月产线 OEE 趋势及瓶颈')}
                >
                  OEE 趋势分析
                </Button>
                <Button
                  block
                  size="small"
                  type="primary"
                  ghost
                  onClick={() => handleSmartAnalyze('评估供应商风险并给出建议')}
                >
                  供应商风险评估
                </Button>
                <Button
                  block
                  size="small"
                  type="primary"
                  ghost
                  onClick={() => handleSmartAnalyze('预测下周设备故障概率')}
                >
                  设备故障预测
                </Button>
              </Space>
            </Card>

            <Card title="使用说明" size="small">
              <Paragraph style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 4 }}>
                <Text strong style={{ color: '#1677ff' }}>数据查询</Text>：输入自然语言查询生产数据
              </Paragraph>
              <Paragraph style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 4 }}>
                <Text strong style={{ color: '#722ed1' }}>智能分析</Text>：AI 自动分析数据趋势和异常
              </Paragraph>
              <Paragraph style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 4 }}>
                <Text strong style={{ color: '#52c41a' }}>优化建议</Text>：基于数据给出可操作建议
              </Paragraph>
              <Paragraph style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 0 }}>
                <Text strong style={{ color: '#ff4d4f' }}>异常告警</Text>：自动检测异常并通知
              </Paragraph>
            </Card>
          </Space>
        </Col>
      </Row>
    </div>
  );
}
