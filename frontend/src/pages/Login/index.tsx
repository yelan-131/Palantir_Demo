import { Alert, Button, Divider, Form, Input, Modal, Typography, message } from 'antd';
import { isAxiosError } from 'axios';
import { flushSync } from 'react-dom';
import { LockOutlined, SafetyCertificateOutlined, UserOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { authLoginWithMfa, getOidcLoginUrl } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import './style.css';

const platformIntroductions = [
  {
    label: '连接数据',
    title: '让分散的数据，成为共同的依据',
    description: '汇集生产与业务数据，让团队基于统一信息开展工作。',
    details: ['统一管理数据与业务记录', '通过生产看板查看进展', '为业务应用提供数据支撑'],
  },
  {
    label: '协同业务',
    title: '让每一项待办，都有清晰的下一步',
    description: '连接业务记录、审批与待办，让团队协作更有序。',
    details: ['集中处理业务待办', '跟进流程与审批进度', '在业务记录中保留协作信息'],
  },
  {
    label: '智能决策',
    title: '从查找信息，到理解业务',
    description: '结合数据、知识与智能助手，为业务行动提供参考。',
    details: ['查找业务数据与知识资料', '通过智能助手梳理问题', '结合业务上下文辅助分析'],
  },
];

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [ssoLoading, setSsoLoading] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const [introductionIndex, setIntroductionIndex] = useState(0);
  const [pendingIntroduction, setPendingIntroduction] = useState<number | null>(null);
  const [introductionHovered, setIntroductionHovered] = useState(false);
  const [introductionFocused, setIntroductionFocused] = useState(false);
  const [pageHidden, setPageHidden] = useState(document.hidden);
  const [reduceMotion, setReduceMotion] = useState(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const introductionTabs = useRef<(HTMLButtonElement | null)[]>([]);
  const introduction = platformIntroductions[introductionIndex];
  const [mfaOpen, setMfaOpen] = useState(false);
  const [mfaPending, setMfaPending] = useState<{ username: string; password: string } | null>(null);
  const [loginForm] = Form.useForm();
  const [mfaForm] = Form.useForm();
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const [entering, setEntering] = useState(false);
  const navigationTimer = useRef<number | null>(null);
  const nativeTransition = !reduceMotion && typeof document.startViewTransition === 'function';

  useEffect(() => () => {
    if (navigationTimer.current !== null) window.clearTimeout(navigationTimer.current);
  }, []);

  const enterWorkspace = (token: string, user: Parameters<typeof login>[1]) => {
    setEntering(true);
    const commit = (native: boolean) => {
      flushSync(() => {
        login(token, user);
        navigate('/', { replace: true, state: { loginArrival: !native } });
      });
    };
    if (nativeTransition) {
      document.documentElement.dataset.loginTransition = 'active';
      try {
        const transition = document.startViewTransition(() => commit(true));
        // A skipped visual transition must not interrupt successful authentication.
        void transition.ready.catch(() => undefined);
        void transition.finished.catch(() => undefined).finally(() => {
          delete document.documentElement.dataset.loginTransition;
        });
      } catch {
        delete document.documentElement.dataset.loginTransition;
        commit(false);
      }
      return;
    }
    navigationTimer.current = window.setTimeout(() => commit(false), reduceMotion ? 0 : 120);
  };

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotion = () => setReduceMotion(media.matches);
    const updateVisibility = () => setPageHidden(document.hidden);
    media.addEventListener('change', updateMotion);
    document.addEventListener('visibilitychange', updateVisibility);
    return () => {
      media.removeEventListener('change', updateMotion);
      document.removeEventListener('visibilitychange', updateVisibility);
    };
  }, []);

  useEffect(() => {
    if (pendingIntroduction === null) return;
    const timer = window.setTimeout(() => {
      setIntroductionIndex(pendingIntroduction);
      setPendingIntroduction(null);
    }, reduceMotion ? 0 : 180);
    return () => window.clearTimeout(timer);
  }, [pendingIntroduction, reduceMotion]);

  useEffect(() => {
    if (entering || introductionHovered || introductionFocused || pageHidden || pendingIntroduction !== null) return;
    const timer = window.setTimeout(() => {
      setPendingIntroduction((introductionIndex + 1) % platformIntroductions.length);
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [introductionIndex, pendingIntroduction, entering, introductionHovered, introductionFocused, pageHidden]);

  const selectIntroduction = (index: number) => {
    setPendingIntroduction(index === introductionIndex ? null : index);
  };

  const clearMfaPending = () => {
    setMfaOpen(false);
    setMfaPending(null);
    mfaForm.resetFields();
  };

  const handleLogin = async (values: { username: string; password: string }) => {
    if (loading || ssoLoading || entering) return;
    setLoginError('');
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
      enterWorkspace(data.token, data.user);
    } catch (error) {
      const status = isAxiosError(error) ? error.response?.status : undefined;
      setLoginError(status === 401 ? '账号或密码不正确，请检查后重试。' : status === 429 ? '尝试次数过多，请稍后重试。' : status === 403 ? '当前账号无法登录，请联系组织管理员。' : '暂时无法登录，请检查网络或稍后重试。');
    } finally {
      setLoading(false);
    }
  };

  const submitMfa = async () => {
    if (!mfaPending || loading || entering) return;
    const values = await mfaForm.validateFields();
    setLoading(true);
    try {
      const res = await authLoginWithMfa(mfaPending.username, mfaPending.password, values.code);
      const data = res.data;
      setMfaOpen(false);
      setMfaPending(null);
      enterWorkspace(data.token, data.user);
    } catch {
      message.error('MFA 验证失败');
      clearMfaPending();
    } finally {
      setLoading(false);
    }
  };

  const handleSsoLogin = async () => {
    if (loading || ssoLoading || entering) return;
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
    <main className={`technology-login${entering ? ' is-entering-workspace' : ''}`} aria-busy={entering} data-transition-mode={nativeTransition ? 'snapshot' : 'fade'}>
      <section className="technology-login-intro" aria-label="平台介绍">
        <div className="technology-login-atmosphere" aria-hidden="true"><span /><span /><span /></div>
        <div className="technology-login-transition" aria-hidden="true" />
        <div className="technology-login-description">
          <span className="technology-login-kicker"><i /> 制造业数据工作空间</span>
          <Typography.Title level={1}>连接制造现场<br /><em>让数据驱动协作</em></Typography.Title>
          <p>从生产数据到业务行动，<br />让每一次决策与协作都有据可依。</p>
          <div
            className="technology-login-introduction-switcher"
            onMouseEnter={() => setIntroductionHovered(true)}
            onMouseLeave={() => setIntroductionHovered(false)}
            onFocusCapture={() => setIntroductionFocused(true)}
            onBlurCapture={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setIntroductionFocused(false);
            }}
          >
          <div className="technology-login-introduction-controls">
          <div className="technology-login-introduction-tabs" role="tablist" aria-label="了解平台能力">
            {platformIntroductions.map((item, index) => (
              <button
                key={item.label}
                type="button"
                role="tab"
                id={`login-introduction-tab-${index}`}
                aria-controls="login-introduction-panel"
                aria-selected={introductionIndex === index}
                tabIndex={introductionIndex === index ? 0 : -1}
                ref={(element) => { introductionTabs.current[index] = element; }}
                onClick={() => selectIntroduction(index)}
                onKeyDown={(event) => {
                  let nextIndex = index;
                  if (event.key === 'ArrowRight') nextIndex = (index + 1) % platformIntroductions.length;
                  else if (event.key === 'ArrowLeft') nextIndex = (index + platformIntroductions.length - 1) % platformIntroductions.length;
                  else if (event.key === 'Home') nextIndex = 0;
                  else if (event.key === 'End') nextIndex = platformIntroductions.length - 1;
                  else return;
                  event.preventDefault();
                  selectIntroduction(nextIndex);
                  introductionTabs.current[nextIndex]?.focus();
                }}
              >
                <span aria-hidden="true">0{index + 1}</span>{item.label}
              </button>
            ))}
          </div>
          </div>
          <div key={introductionIndex} className={`technology-login-introduction-panel${pendingIntroduction !== null ? ' is-leaving' : ''}`} id="login-introduction-panel" role="tabpanel" aria-labelledby={`login-introduction-tab-${introductionIndex}`} aria-live={introductionFocused ? 'polite' : 'off'} tabIndex={0}>
            <Typography.Title level={3}>{introduction.title}</Typography.Title>
            <p>{introduction.description}</p>
            <ul>{introduction.details.map((detail) => <li key={detail}>{detail}</li>)}</ul>
          </div>
          </div>
        </div>
      </section>
      <section className="technology-login-access" aria-label="账号登录">
        <div className="technology-login-form">
          <div className="technology-login-form-head">
            <span className="technology-login-form-kicker">欢迎回来</span>
            <Typography.Title level={2}>登录你的工作空间</Typography.Title>
            <Typography.Text type="secondary">使用组织账号登录，继续你的工作</Typography.Text>
          </div>

        <Form
          form={loginForm}
          layout="vertical"
          disabled={entering}
          requiredMark={false}
          onFinish={handleLogin}
        >
          <Form.Item name="username" label="账号" rules={[{ required: true, message: '请输入账号' }]}>
            <Input prefix={<UserOutlined />} placeholder="请输入组织账号" autoComplete="username" autoCapitalize="none" spellCheck={false} />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="请输入密码" autoComplete="current-password" />
          </Form.Item>
          <div className="technology-login-help"><Button type="link" onClick={() => setHelpOpen(true)}>无法登录？联系管理员</Button></div>
          {loginError && <Alert className="technology-login-error" type="error" showIcon message={loginError} role="alert" />}
          <Button type="primary" htmlType="submit" loading={loading} disabled={ssoLoading} block className="technology-login-submit">
            {loading ? '正在登录…' : '登录'}
          </Button>
        </Form>

        <Divider plain className="technology-login-divider">或</Divider>
        <Button block icon={<SafetyCertificateOutlined />} loading={ssoLoading} disabled={loading || entering} onClick={handleSsoLogin}>
          企业 SSO 登录
        </Button>
        <div className="technology-login-auth-note">账号由组织统一分配，企业 SSO 需组织开通。</div>

        </div>
      </section>
      <Modal title="登录帮助" open={helpOpen} onCancel={() => setHelpOpen(false)} footer={<Button type="primary" onClick={() => setHelpOpen(false)}>知道了</Button>}>
        <Typography.Paragraph>忘记密码、尚未获得账号或账号无法登录时，请通过组织内部通讯录或 IT 服务渠道联系平台管理员，申请重置密码或确认账号权限。</Typography.Paragraph>
        <Typography.Paragraph>使用企业 SSO 的用户，请确认组织已开通该方式，并使用企业身份账号登录。</Typography.Paragraph>
      </Modal>
      <Modal title="MFA 验证" open={mfaOpen} onOk={submitMfa} onCancel={clearMfaPending} confirmLoading={loading}>
        <Form form={mfaForm} layout="vertical">
          <Form.Item name="code" label="6 位动态验证码" rules={[{ required: true, message: '请输入 MFA 验证码' }]}>
            <Input placeholder="请输入动态验证码" maxLength={8} />
          </Form.Item>
        </Form>
      </Modal>
    </main>
  );
}
