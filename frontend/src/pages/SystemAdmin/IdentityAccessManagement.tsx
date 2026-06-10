import { useEffect, useState } from 'react';
import {
  AuditOutlined,
  BankOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  TeamOutlined,
  UserSwitchOutlined,
} from '@ant-design/icons';
import { Button, Card, Form, Input, InputNumber, Space, Statistic, Switch, Tabs, Typography, message } from 'antd';
import { adminGetIamSettings, adminUpdateIamSettings } from '@/services/api';
import OrganizationManagement from './OrganizationManagement';
import RoleManagement from './RoleManagement';
import TenantManagement from './TenantManagement';
import UserManagement from './UserManagement';

interface IdentityAccessManagementProps {
  defaultActiveKey?: string;
  onTabChange?: (key: string) => void;
}

export default function IdentityAccessManagement({ defaultActiveKey = 'overview', onTabChange }: IdentityAccessManagementProps) {
  const [activeKey, setActiveKey] = useState(defaultActiveKey);

  useEffect(() => {
    setActiveKey(defaultActiveKey);
  }, [defaultActiveKey]);

  return (
    <div className="identity-access-workspace">
      <Tabs
        className="identity-access-tabs"
        activeKey={activeKey}
        onChange={(key) => {
          setActiveKey(key);
          onTabChange?.(key);
        }}
        items={[
          { key: 'tenants', label: <span><BankOutlined /> 租户管理</span>, children: <TenantManagement /> },
          { key: 'overview', label: <span><AuditOutlined /> 访问控制总览</span>, children: <IdentityOverview /> },
          { key: 'users', label: <span><TeamOutlined /> 用户管理</span>, children: <UserManagement /> },
          { key: 'roles', label: <span><SafetyCertificateOutlined /> 角色管理</span>, children: <RoleManagement /> },
          { key: 'orgs', label: <span><UserSwitchOutlined /> 组织管理</span>, children: <OrganizationManagement /> },
        ]}
      />
    </div>
  );
}

function IdentityOverview() {
  const [settings, setSettings] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const loadSettings = () => {
    adminGetIamSettings().then((res) => {
      const data = res.data?.data;
      setSettings(data);
      form.setFieldsValue({
        password_min_length: data?.security?.password?.min_length,
        password_require_complexity: data?.security?.password?.require_complexity,
        password_history_count: data?.security?.password?.history_count,
        login_lock_threshold: data?.security?.login?.lock_threshold,
        login_lock_minutes: data?.security?.login?.lock_minutes,
        mfa_enabled: data?.security?.mfa?.enabled,
        mfa_require_for_sso: data?.security?.mfa?.require_for_sso,
        oidc_enabled: data?.oidc?.enabled,
        oidc_issuer: data?.oidc?.issuer,
        oidc_client_id: data?.oidc?.client_id,
        oidc_client_secret: '',
        oidc_redirect_uri: data?.oidc?.redirect_uri,
        oidc_scopes: data?.oidc?.scopes,
        oidc_username_claim: data?.oidc?.username_claim,
        oidc_email_claim: data?.oidc?.email_claim,
        oidc_display_name_claim: data?.oidc?.display_name_claim,
        oidc_subject_claim: data?.oidc?.subject_claim,
      });
    }).catch(() => setSettings(null));
  };

  useEffect(() => { loadSettings(); }, []);

  const saveSettings = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const payload: Record<string, any> = {
        security: {
          password: {
            min_length: values.password_min_length,
            require_complexity: values.password_require_complexity,
            history_count: values.password_history_count,
          },
          login: {
            lock_threshold: values.login_lock_threshold,
            lock_minutes: values.login_lock_minutes,
          },
          mfa: {
            enabled: values.mfa_enabled,
            require_for_sso: values.mfa_require_for_sso,
          },
        },
        oidc: {
          enabled: values.oidc_enabled,
          issuer: values.oidc_issuer,
          client_id: values.oidc_client_id,
          redirect_uri: values.oidc_redirect_uri,
          scopes: values.oidc_scopes,
          username_claim: values.oidc_username_claim,
          email_claim: values.oidc_email_claim,
          display_name_claim: values.oidc_display_name_claim,
          subject_claim: values.oidc_subject_claim,
          require_platform_mfa: values.mfa_require_for_sso,
        },
      };
      if (values.oidc_client_secret) payload.oidc.client_secret = values.oidc_client_secret;
      const res = await adminUpdateIamSettings(payload);
      setSettings(res.data?.data);
      message.success('登录与安全配置已保存');
      loadSettings();
    } catch {
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const oidc = settings?.oidc || {};
  const security = settings?.security || {};

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
          width: '100%',
        }}
      >
        <Card><Statistic title="登录模式" value="本地 + SSO" prefix={<SettingOutlined />} /></Card>
        <Card><Statistic title="MFA" value={security?.mfa?.enabled ? '可用' : '未启用'} /></Card>
        <Card><Statistic title="OIDC" value={oidc.enabled ? '已配置' : '未配置'} /></Card>
      </div>

      <Card title="账号安全策略">
        <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
          控制账号密码、失败锁定和 SSO 后是否继续要求平台 MFA。生产环境建议开启复杂度、历史密码和失败锁定。
        </Typography.Paragraph>
        <Form form={form} layout="vertical">
          <Space wrap align="start">
            <Form.Item name="password_min_length" label="密码最小长度" rules={[{ required: true }]}>
              <InputNumber min={6} max={64} />
            </Form.Item>
            <Form.Item name="password_require_complexity" label="要求复杂密码" valuePropName="checked">
              <Switch checkedChildren="开启" unCheckedChildren="关闭" />
            </Form.Item>
            <Form.Item name="password_history_count" label="历史密码防复用">
              <InputNumber min={0} max={20} />
            </Form.Item>
            <Form.Item name="login_lock_threshold" label="失败几次锁定">
              <InputNumber min={1} max={20} />
            </Form.Item>
            <Form.Item name="login_lock_minutes" label="锁定分钟">
              <InputNumber min={1} max={1440} />
            </Form.Item>
            <Form.Item name="mfa_enabled" label="允许平台 MFA" valuePropName="checked">
              <Switch checkedChildren="开启" unCheckedChildren="关闭" />
            </Form.Item>
            <Form.Item name="mfa_require_for_sso" label="SSO 后仍要求 MFA" valuePropName="checked">
              <Switch checkedChildren="需要" unCheckedChildren="不强制" />
            </Form.Item>
          </Space>
        </Form>
      </Card>

      <Card title="企业 SSO / OIDC">
        <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
          如果公司有统一身份平台，就在这里填写 OIDC 参数。未配置时，系统仍可使用账号密码登录。
        </Typography.Paragraph>
        <Form form={form} layout="vertical">
          <Space wrap align="start" style={{ width: '100%' }}>
            <Form.Item name="oidc_enabled" label="启用企业 SSO" valuePropName="checked">
              <Switch checkedChildren="启用" unCheckedChildren="关闭" />
            </Form.Item>
            <Form.Item name="oidc_issuer" label="Issuer">
              <Input style={{ width: 320 }} placeholder="https://sso.example.com/realms/main" />
            </Form.Item>
            <Form.Item name="oidc_client_id" label="Client ID">
              <Input style={{ width: 220 }} />
            </Form.Item>
            <Form.Item name="oidc_client_secret" label="Client Secret">
              <Input.Password style={{ width: 220 }} placeholder="留空则不修改" />
            </Form.Item>
            <Form.Item name="oidc_redirect_uri" label="Redirect URI">
              <Input style={{ width: 320 }} placeholder="http://localhost:3000/login" />
            </Form.Item>
            <Form.Item name="oidc_scopes" label="Scopes">
              <Input style={{ width: 220 }} placeholder="openid profile email" />
            </Form.Item>
            <Form.Item name="oidc_subject_claim" label="Subject Claim">
              <Input style={{ width: 160 }} placeholder="sub" />
            </Form.Item>
            <Form.Item name="oidc_username_claim" label="用户名 Claim">
              <Input style={{ width: 160 }} placeholder="preferred_username" />
            </Form.Item>
            <Form.Item name="oidc_email_claim" label="邮箱 Claim">
              <Input style={{ width: 160 }} placeholder="email" />
            </Form.Item>
            <Form.Item name="oidc_display_name_claim" label="显示名 Claim">
              <Input style={{ width: 160 }} placeholder="name" />
            </Form.Item>
          </Space>
        </Form>
        <Button type="primary" onClick={saveSettings} loading={saving}>保存登录与安全配置</Button>
      </Card>
    </Space>
  );
}
