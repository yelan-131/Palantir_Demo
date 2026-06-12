import { Alert, Button, Card, Form, Input, Modal, Typography, message } from 'antd';
import {
  ApiOutlined,
  BulbOutlined,
  DashboardOutlined,
  LockOutlined,
  PartitionOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  RobotOutlined,
  ShareAltOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { authLoginWithMfa, getOidcLoginUrl } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';

const commandSlides = [
  {
    icon: <DashboardOutlined />,
    tab: '低代码平台',
    eyebrow: 'Low-code Platform',
    title: '业务应用快速装配',
    status: '设计中',
    summary: '把应用、菜单、表单、权限和流程沉淀为可组合的业务组件，快速形成可运行页面。',
    core: 'Low-code',
    orbit: ['App', 'Form', 'Flow', 'BI'],
    features: [
      { label: '菜单管理', desc: '菜单、页面、权限一体编排' },
      { label: '表单设计', desc: '字段模型与业务画布分离' },
      { label: '看板编排', desc: '指标、图表和动作联动' },
    ],
  },
  {
    icon: <RobotOutlined />,
    tab: 'AI Agent',
    eyebrow: 'AI Agent Layer',
    title: '智能助手与任务编排',
    status: '推理中',
    summary: '让 AI 能理解业务上下文，调用工具、检索知识、生成分析，并把建议落到业务动作里。',
    core: 'Agent',
    orbit: ['RAG', 'Tool', 'Task', 'Insight'],
    features: [
      { label: '语义检索', desc: '面向数据资产和业务知识提问' },
      { label: '工具调用', desc: '连接表单、流程和数据服务' },
      { label: '自动分析', desc: '输出洞察、风险和下一步建议' },
    ],
  },
  {
    icon: <ShareAltOutlined />,
    tab: 'Palantir 架构',
    eyebrow: 'Ontology Architecture',
    title: '数据本体与应用运行层',
    status: '联动',
    summary: '通过本体层把数据、对象、关系和业务应用连接起来，让分析结果能够直接进入运营闭环。',
    core: 'Ontology',
    orbit: ['Entity', 'Relation', 'Action', 'Ops'],
    features: [
      { label: '数据本体', desc: '实体、关系、指标统一建模' },
      { label: '应用运行', desc: '场景、权限、数据源联动' },
      { label: '决策闭环', desc: '从分析看板进入业务处理' },
    ],
  },
];

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [ssoLoading, setSsoLoading] = useState(false);
  const [activeSlide, setActiveSlide] = useState(0);
  const [mfaOpen, setMfaOpen] = useState(false);
  const [mfaPending, setMfaPending] = useState<{ username: string; password: string } | null>(null);
  const [loginForm] = Form.useForm();
  const [mfaForm] = Form.useForm();
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const currentSlide = commandSlides[activeSlide];

  const clearMfaPending = () => {
    setMfaOpen(false);
    setMfaPending(null);
    mfaForm.resetFields();
  };

  const renderSceneContent = () => {
    if (activeSlide === 0) {
      return (
        <div className="identity-scene-content scene-lowcode">
          <p className="identity-summary-line">{currentSlide.summary}</p>
          <div className="identity-assembly-flow">
            {currentSlide.features.map((feature, index) => (
              <div className="identity-assembly-step" key={feature.label}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <strong>{feature.label}</strong>
                <small>{feature.desc}</small>
              </div>
            ))}
          </div>
          <div className="identity-signal-strip">
            {currentSlide.orbit.map((node) => (
              <span key={node}>{node}</span>
            ))}
          </div>
        </div>
      );
    }

    if (activeSlide === 1) {
      const agentTiles = [
        { label: 'RAG', icon: <SearchOutlined /> },
        { label: 'Tool', icon: <ApiOutlined /> },
        { label: 'Task', icon: <PartitionOutlined /> },
        { label: 'Insight', icon: <BulbOutlined /> },
      ];

      return (
        <div className="identity-scene-content scene-agent">
          <div className="identity-agent-icon-grid" aria-label="AI Agent 能力">
            <div className="identity-agent-icon-core">
              <RobotOutlined />
              <strong>{currentSlide.core}</strong>
            </div>
            {agentTiles.map((tile) => (
              <div className="identity-agent-icon-tile" key={tile.label}>
                <span>{tile.icon}</span>
                <strong>{tile.label}</strong>
              </div>
            ))}
          </div>
          <div className="identity-agent-queue">
            <p className="identity-summary-line">{currentSlide.summary}</p>
            {currentSlide.features.map((feature) => (
              <div className="identity-feature-item" key={feature.label}>
                <strong>{feature.label}</strong>
                <span>{feature.desc}</span>
              </div>
            ))}
          </div>
        </div>
      );
    }

    return (
      <div className="identity-scene-content scene-ontology">
        <p className="identity-summary-line">{currentSlide.summary}</p>
        <div className="identity-ontology-map" aria-hidden="true">
          <span className="identity-ontology-node main">{currentSlide.core}</span>
          {currentSlide.orbit.map((node, index) => (
            <span className={`identity-ontology-node node-${index + 1}`} key={node}>
              {node}
            </span>
          ))}
          <i className="identity-ontology-link link-1" />
          <i className="identity-ontology-link link-2" />
          <i className="identity-ontology-link link-3" />
        </div>
        <div className="identity-ontology-list">
          {currentSlide.features.map((feature) => (
            <div key={feature.label}>
              <strong>{feature.label}</strong>
              <span>{feature.desc}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActiveSlide((prev) => (prev + 1) % commandSlides.length);
    }, 3600);
    return () => window.clearInterval(timer);
  }, []);

  const handleLogin = async (values: { username: string; password: string }) => {
    setLoading(true);
    try {
      const res = await authLoginWithMfa(values.username, values.password);
      const data = res.data;
      if (data.requires_mfa || data.mfa_required) {
        setMfaPending(values);
        setMfaOpen(true);
        message.info('请输入 MFA 验证码');
        return;
      }
      login(data.token, data.user);
      message.success(`欢迎回来，${data.user.display_name}`);
      navigate('/');
    } catch {
      message.error('账号或密码不正确');
    } finally {
      setLoading(false);
    }
  };

  const submitMfa = async () => {
    if (!mfaPending) return;
    const values = await mfaForm.validateFields();
    setLoading(true);
    try {
      const res = await authLoginWithMfa(mfaPending.username, mfaPending.password, values.code);
      const data = res.data;
      login(data.token, data.user);
      setMfaOpen(false);
      setMfaPending(null);
      message.success(`欢迎回来，${data.user.display_name || data.user.username}`);
      navigate('/');
    } catch {
      message.error('MFA 验证失败');
      clearMfaPending();
    } finally {
      setLoading(false);
    }
  };

  const handleSsoLogin = async () => {
    setSsoLoading(true);
    try {
      const username = String(loginForm.getFieldValue('username') || '').trim();
      const res = await getOidcLoginUrl(`${window.location.origin}/login`, { loginHint: username || undefined });
      if (res.data?.url) {
        window.location.href = res.data.url;
        return;
      }
      message.warning('企业 SSO 尚未配置');
    } catch {
      message.warning('企业 SSO 尚未配置');
    } finally {
      setSsoLoading(false);
    }
  };

  return (
    <div className="identity-shell">
      <div className="identity-grid" />
      <div className="identity-breath-layer" aria-hidden="true">
        <span />
        <span />
      </div>
      <div className="identity-halo identity-halo-a" />
      <div className="identity-halo identity-halo-b" />
      <div className="identity-motion-layer" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      <section className="identity-intro">
        <div className="identity-brand-lockup">
          <span className="identity-brand-mark">MF</span>
          <div>
            <Typography.Title level={1}>ManuFoundry</Typography.Title>
            <small>Manufacturing Intelligence Workspace</small>
          </div>
        </div>

        <div className={`identity-command-panel scene-${activeSlide}`}>
          <div className="identity-panel-glow" aria-hidden="true" />
          <div className="identity-panel-top">
            <span className="identity-panel-icon">{currentSlide.icon}</span>
            <div className="identity-panel-heading">
              <span className="identity-panel-eyebrow">{currentSlide.eyebrow}</span>
              <strong>{currentSlide.title}</strong>
            </div>
            <span className="identity-live-dot">{currentSlide.status}</span>
          </div>
          {renderSceneContent()}
          <div className="identity-feature-stage legacy-scene-stage" aria-hidden="true">
            <div className="identity-orbit-visual" aria-hidden="true">
              <div className="identity-orbit-ring" />
              <div className="identity-orbit-core">
                <span>{currentSlide.core}</span>
              </div>
              {currentSlide.orbit.map((node, index) => (
                <span className={`identity-orbit-node node-${index + 1}`} key={node}>
                  {node}
                </span>
              ))}
              <i className="identity-orbit-line line-1" />
              <i className="identity-orbit-line line-2" />
            </div>
            <div className="identity-insight-board">
              <p className="identity-summary-line">{currentSlide.summary}</p>
              <div className="identity-feature-list" aria-label="能力编排">
                {currentSlide.features.map((feature) => (
                  <div className="identity-feature-item" key={feature.label}>
                    <strong>{feature.label}</strong>
                    <span>{feature.desc}</span>
                  </div>
                ))}
              </div>
              <div className="identity-signal-strip">
                {currentSlide.orbit.map((node) => (
                  <span key={node}>{node}</span>
                ))}
              </div>
            </div>
          </div>
          <div className="identity-slide-dots" aria-label="运行概览轮播">
            {commandSlides.map((slide, index) => (
              <button
                key={slide.title}
                type="button"
                className={index === activeSlide ? 'active' : ''}
                aria-label={`切换到${slide.title}`}
                onClick={() => setActiveSlide(index)}
              />
            ))}
          </div>
        </div>
      </section>

      <Card className="identity-card" variant="borderless">
        <div className="identity-card-head">
          <span className="identity-login-mark"><SafetyCertificateOutlined /></span>
          <div>
            <Typography.Title level={3}>进入工作台</Typography.Title>
            <Typography.Text type="secondary">组织空间认证 · 权限安全接入</Typography.Text>
          </div>
        </div>

        <Form
          form={loginForm}
          layout="vertical"
          onFinish={handleLogin}
        >
          <Form.Item name="username" label="账号" rules={[{ required: true, message: '请输入账号' }]}>
            <Input prefix={<UserOutlined />} placeholder="请输入账号" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="请输入密码" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={loading} block className="identity-submit">
            登录工作台
          </Button>
        </Form>

        <Button block icon={<SafetyCertificateOutlined />} loading={ssoLoading} onClick={handleSsoLogin} style={{ marginTop: 10 }}>
          企业 SSO 登录
        </Button>
        <Alert
          type="info"
          showIcon
          message="本地账号与企业 SSO 双登录并存；生产环境可通过后台配置 OIDC。"
          style={{ marginTop: 12 }}
        />

      </Card>
      <Modal title="MFA 验证" open={mfaOpen} onOk={submitMfa} onCancel={clearMfaPending} confirmLoading={loading}>
        <Form form={mfaForm} layout="vertical">
          <Form.Item name="code" label="6 位动态验证码" rules={[{ required: true, message: '请输入 MFA 验证码' }]}>
            <Input placeholder="请输入动态验证码" maxLength={8} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
