import { Alert, Button, Divider, Form, Input, Modal, Typography, message } from 'antd';
import { isAxiosError } from 'axios';
import { LockOutlined, SafetyCertificateOutlined, UserOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { authLoginWithMfa, getOidcLoginUrl } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import './style.css';

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [ssoLoading, setSsoLoading] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const [motionPaused, setMotionPaused] = useState(false);
  const [mfaOpen, setMfaOpen] = useState(false);
  const [mfaPending, setMfaPending] = useState<{ username: string; password: string } | null>(null);
  const [loginForm] = Form.useForm();
  const [mfaForm] = Form.useForm();
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);

  const clearMfaPending = () => {
    setMfaOpen(false);
    setMfaPending(null);
    mfaForm.resetFields();
  };

  const handleLogin = async (values: { username: string; password: string }) => {
    if (loading || ssoLoading) return;
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
      login(data.token, data.user);
      message.success(`欢迎回来，${data.user.display_name}`);
      navigate('/');
    } catch (error) {
      const status = isAxiosError(error) ? error.response?.status : undefined;
      setLoginError(status === 401 ? '账号或密码不正确，请检查后重试。' : status === 429 ? '尝试次数过多，请稍后重试。' : status === 403 ? '当前账号无法登录，请联系组织管理员。' : '暂时无法登录，请检查网络或稍后重试。');
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
    if (loading || ssoLoading) return;
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
    <main className="technology-login">
      <section className="technology-login-intro" aria-label="平台介绍" data-motion-paused={motionPaused}>
        <div className="technology-login-atmosphere" aria-hidden="true"><span /><span /><span /></div>
        <div className="technology-login-transition" aria-hidden="true" />
        <div className="technology-login-brand">
          <span className="technology-login-mark" aria-hidden="true">MF</span>
          <div><strong>ManuFoundry</strong><span>制造数智平台</span></div>
          <button className="technology-login-motion-toggle" type="button" aria-pressed={motionPaused} onClick={() => setMotionPaused(!motionPaused)}>{motionPaused ? '开启动效' : '暂停动效'}</button>
        </div>
        <div className="technology-login-description">
          <span className="technology-login-kicker"><i /> 制造业数据工作空间</span>
          <Typography.Title level={1}>连接制造现场<br /><em>让数据驱动协作</em></Typography.Title>
          <p>从生产数据到业务行动，<br />让每一次决策与协作都有据可依。</p>
          <div className="technology-login-scene" aria-hidden="true">
            <svg viewBox="0 0 620 330" fill="none">
              <defs>
                <linearGradient id="mf-layer" x1="140" y1="80" x2="440" y2="290" gradientUnits="userSpaceOnUse"><stop stopColor="#9abce8" stopOpacity=".42" /><stop offset="1" stopColor="#e1edfa" stopOpacity=".55" /></linearGradient>
                <linearGradient id="mf-core" x1="225" y1="95" x2="380" y2="195" gradientUnits="userSpaceOnUse"><stop stopColor="#c9edf1" /><stop offset="1" stopColor="#8fbce3" /></linearGradient>
                <radialGradient id="mf-halo"><stop stopColor="#72b9e4" stopOpacity=".2" /><stop offset="1" stopColor="#72b9e4" stopOpacity="0" /></radialGradient>
              </defs>
              <ellipse className="technology-login-scene-halo" cx="310" cy="212" rx="240" ry="113" fill="url(#mf-halo)" />
              <g stroke="#8ba8cc" strokeOpacity=".65" strokeLinejoin="round">
                <path d="M310 142L488 229L310 316L132 229Z" fill="url(#mf-layer)" />
                <path d="M310 106L488 193L310 280L132 193Z" fill="url(#mf-layer)" />
                <path d="M310 70L488 157L310 244L132 157Z" fill="url(#mf-layer)" />
                <path d="M132 157V229M488 157V229M310 244V316" strokeDasharray="3 6" />
              </g>
              <g className="technology-login-scene-core">
                <path d="M310 102L385 139V158L310 196L235 158V139Z" fill="#759ac4" stroke="#a1c8e5" strokeOpacity=".7" />
                <path d="M310 102L385 139L310 177L235 139Z" fill="url(#mf-core)" />
                <path d="M310 177V196" stroke="#a1c8e5" />
                <text x="310" y="145" textAnchor="middle" fill="#24456b" fontSize="20" fontWeight="700" fontFamily="sans-serif">MF</text>
              </g>
              <g stroke="#628fbd" strokeOpacity=".85" strokeWidth="1.5">
                <path className="technology-login-scene-flow" d="M235 139L112 79H63M385 139L510 79H560M310 196V271" strokeDasharray="4 7" />
              </g>
              <g className="technology-login-scene-packets" stroke="#528daf" strokeWidth="3" strokeLinecap="round">
                <path d="M112 79L235 139" pathLength="100" strokeDasharray="5 95" />
                <path d="M385 139L510 79" pathLength="100" strokeDasharray="5 95" />
                <path d="M310 271V196" pathLength="100" strokeDasharray="7 93" />
              </g>
              <g fill="#f8fbff" fillOpacity=".8" stroke="#a9bfd8" strokeOpacity=".7">
                <rect x="28" y="42" width="140" height="59" rx="12" />
                <rect x="452" y="42" width="140" height="59" rx="12" />
                <rect x="240" y="267" width="140" height="44" rx="12" />
              </g>
              <g fill="#4b6685" fontSize="13" fontFamily="sans-serif" textAnchor="middle"><text x="98" y="77">生产现场</text><text x="522" y="77">业务应用</text><text x="310" y="294">数据资产</text></g>
              <g fill="#5a99b0"><circle cx="185" cy="114" r="4" /><circle cx="437" cy="113" r="4" /><circle cx="310" cy="232" r="4" /></g>
            </svg>
          </div>
          <div className="technology-login-values"><span><b>01</b> 连接数据</span><span><b>02</b> 协同业务</span><span><b>03</b> 智能决策</span></div>
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
        <Button block icon={<SafetyCertificateOutlined />} loading={ssoLoading} disabled={loading} onClick={handleSsoLogin}>
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
