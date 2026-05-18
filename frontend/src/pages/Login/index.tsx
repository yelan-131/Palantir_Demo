import { Button, Card, Divider, Form, Input, Select, Space, Tag, Typography, message } from 'antd';
import {
  ApiOutlined,
  CheckCircleOutlined,
  ClusterOutlined,
  LockOutlined,
  SafetyCertificateOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { authLogin } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';

const demoAccounts = [
  { name: 'admin', label: '平台管理员', pass: 'admin123' },
  { name: 'zhangsan', label: '生产经理', pass: '123456' },
  { name: 'lisi', label: '质量工程师', pass: '123456' },
];

const statusItems = [
  { icon: <ApiOutlined />, label: '数据连接', value: '18 online' },
  { icon: <ClusterOutlined />, label: '模型服务', value: 'healthy' },
  { icon: <SafetyCertificateOutlined />, label: '安全策略', value: 'SSO ready' },
];

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);

  const handleLogin = async (values: { username: string; password: string }) => {
    setLoading(true);
    try {
      const res = await authLogin(values.username, values.password);
      const data = res.data;
      login(data.token, data.user);
      message.success(`欢迎，${data.user.display_name}`);
      navigate('/');
    } catch {
      message.error('账号或密码不正确');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="identity-shell">
      <div className="identity-grid" />
      <section className="identity-intro">
        <Tag className="system-tag">Low-code Analytics Platform</Tag>
        <Typography.Title level={1}>ManuFoundry</Typography.Title>
        <Typography.Paragraph>
          面向制造业数据资产、分析应用和流程协同的低代码工作台。
        </Typography.Paragraph>
        <div className="identity-status">
          {statusItems.map((item) => (
            <div className="identity-status-item" key={item.label}>
              <span className="identity-status-icon">{item.icon}</span>
              <div>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            </div>
          ))}
        </div>
      </section>

      <Card className="identity-card" bordered={false}>
        <Space direction="vertical" size={4} className="identity-card-head">
          <div className="brand-mark">MF</div>
          <Typography.Title level={3}>进入分析工作台</Typography.Title>
          <Typography.Text type="secondary">选择环境并验证身份</Typography.Text>
        </Space>

        <Form
          layout="vertical"
          onFinish={handleLogin}
          initialValues={{ environment: 'demo', username: 'admin', password: 'admin123' }}
        >
          <Form.Item name="environment" label="组织环境">
            <Select
              options={[
                { value: 'demo', label: 'Demo Workspace / 制造业演示空间' },
                { value: 'sandbox', label: 'Sandbox / 配置沙箱' },
                { value: 'prod', label: 'Production / 生产环境' },
              ]}
            />
          </Form.Item>
          <Form.Item name="username" label="账号" rules={[{ required: true, message: '请输入账号' }]}>
            <Input prefix={<UserOutlined />} placeholder="用户名" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="密码" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={loading} block className="identity-submit">
            登录工作台
          </Button>
        </Form>

        <Divider />
        <div className="demo-account-row">
          <Typography.Text type="secondary">演示账号</Typography.Text>
          <Space wrap>
            {demoAccounts.map((account) => (
              <Button
                key={account.name}
                size="small"
                type="text"
                icon={<CheckCircleOutlined />}
                onClick={() => handleLogin({ username: account.name, password: account.pass })}
              >
                {account.label}
              </Button>
            ))}
          </Space>
        </div>
      </Card>
    </div>
  );
}
