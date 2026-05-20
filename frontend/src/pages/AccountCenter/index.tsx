import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ApiOutlined,
  AppstoreOutlined,
  AuditOutlined,
  BellOutlined,
  DatabaseOutlined,
  KeyOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  SkinOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import {
  Avatar,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  Radio,
  Select,
  Space,
  Switch,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import { useAuthStore } from '../../stores/authStore';
import AppMenuManagement from '../SystemAdmin/AppMenuManagement';
import RoleManagement from '../SystemAdmin/RoleManagement';
import SemanticAssetCenter from '../SystemAdmin/SemanticAssetCenter';
import UserManagement from '../SystemAdmin/UserManagement';

interface CurrentApplication {
  name?: string;
}

interface AccountCenterProps {
  currentApplication?: CurrentApplication | null;
}

const { Title, Text } = Typography;

export default function AccountCenter({ currentApplication }: AccountCenterProps) {
  const user = useAuthStore((s) => s.user);
  const [searchParams, setSearchParams] = useSearchParams();
  const activeSection = searchParams.get('section') || 'account';
  const roles = user?.roles?.length ? user.roles.map((role: any) => role.label || role.name).join(' / ') : '-';
  const roleLabel = user?.is_admin ? '系统管理员' : user?.roles?.[0]?.label || '业务用户';

  const items = useMemo(() => {
    const baseItems = [
      {
        key: 'account',
        label: '账号中心',
        icon: <UserOutlined />,
        children: <AccountProfilePanel user={user} roleLabel={roleLabel} roles={roles} currentApplication={currentApplication} />,
      },
      {
        key: 'preferences',
        label: '工作偏好',
        icon: <SkinOutlined />,
        children: <PreferencePanel />,
      },
    ];

    if (!user?.is_admin) return baseItems;

    return [
      ...baseItems,
      {
        key: 'ai',
        label: 'AI 与平台设置',
        icon: <RobotOutlined />,
        children: <AIPlatformPanel />,
      },
      {
        key: 'app-menu',
        label: '应用与菜单',
        icon: <AppstoreOutlined />,
        children: <AppMenuManagement />,
      },
      {
        key: 'data-ontology',
        label: '数据资产与本体',
        icon: <DatabaseOutlined />,
        children: <SemanticAssetCenter />,
      },
      {
        key: 'users',
        label: '用户管理',
        icon: <TeamOutlined />,
        children: <UserManagement />,
      },
      {
        key: 'roles',
        label: '角色权限',
        icon: <SafetyCertificateOutlined />,
        children: <RoleManagement />,
      },
      {
        key: 'audit',
        label: '审计与日志',
        icon: <AuditOutlined />,
        children: <AuditPanel />,
      },
    ];
  }, [currentApplication, roleLabel, roles, user]);

  return (
    <div className="account-center-page">
      <div className="account-center-head">
        <Space size={16} align="center">
          <Avatar size={56} icon={<UserOutlined />} style={{ backgroundColor: '#2f5f73' }} />
          <div>
            <Title level={3}>{user?.display_name || '系统管理员'}</Title>
            <Text type="secondary">{user?.email || user?.username || 'admin@manufoundry.local'}</Text>
          </div>
        </Space>
        <Tag color={user?.is_admin ? 'gold' : 'blue'}>{roleLabel}</Tag>
      </div>

      <Tabs
        className="account-center-tabs"
        activeKey={activeSection}
        items={items}
        onChange={(key) => setSearchParams({ section: key })}
      />
    </div>
  );
}

function AccountProfilePanel({
  user,
  roleLabel,
  roles,
  currentApplication,
}: {
  user: any;
  roleLabel: string;
  roles: string;
  currentApplication?: CurrentApplication | null;
}) {
  return (
    <div className="account-center-grid two-columns">
      <Card title="身份信息" className="account-panel-card">
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label="账号">{user?.username || '-'}</Descriptions.Item>
          <Descriptions.Item label="邮箱">{user?.email || '-'}</Descriptions.Item>
          <Descriptions.Item label="账号类型">{roleLabel}</Descriptions.Item>
          <Descriptions.Item label="角色">{roles}</Descriptions.Item>
          <Descriptions.Item label="当前应用">{currentApplication?.name || '-'}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title="安全设置" className="account-panel-card">
        <Form layout="vertical">
          <Form.Item label="当前密码">
            <Input.Password placeholder="Demo 中暂不校验真实密码" />
          </Form.Item>
          <Form.Item label="新密码">
            <Input.Password placeholder="请输入新密码" />
          </Form.Item>
          <Form.Item label="登录保护" valuePropName="checked">
            <Switch defaultChecked /> <Text type="secondary"> 异地登录提醒</Text>
          </Form.Item>
          <Button type="primary" icon={<KeyOutlined />} onClick={() => message.success('账号安全设置已保存')}>
            保存安全设置
          </Button>
        </Form>
      </Card>
    </div>
  );
}

function PreferencePanel() {
  const [form] = Form.useForm();

  return (
    <div className="account-center-grid two-columns">
      <Card title="界面偏好" className="account-panel-card">
        <Form
          form={form}
          layout="vertical"
          initialValues={{ density: 'standard', theme: 'light', sidebar: 'expanded', home: 'workspace', language: 'zh-CN' }}
        >
          <Form.Item name="density" label="显示密度">
            <Radio.Group optionType="button" buttonStyle="solid">
              <Radio.Button value="compact">紧凑</Radio.Button>
              <Radio.Button value="standard">标准</Radio.Button>
              <Radio.Button value="relaxed">宽松</Radio.Button>
            </Radio.Group>
          </Form.Item>
          <Form.Item name="theme" label="主题模式">
            <Radio.Group>
              <Radio value="light">浅色</Radio>
              <Radio value="dark" disabled>深色（规划中）</Radio>
            </Radio.Group>
          </Form.Item>
          <Form.Item name="sidebar" label="默认侧边栏">
            <Radio.Group>
              <Radio value="expanded">展开</Radio>
              <Radio value="collapsed">折叠</Radio>
            </Radio.Group>
          </Form.Item>
          <Form.Item name="home" label="默认首页">
            <Select
              options={[
                { label: '我的工作台', value: 'workspace' },
                { label: '当前应用默认页', value: 'current-app' },
                { label: '系统管理', value: 'system-admin' },
              ]}
            />
          </Form.Item>
          <Form.Item name="language" label="语言">
            <Select
              options={[
                { label: '中文', value: 'zh-CN' },
                { label: 'English（规划中）', value: 'en-US', disabled: true },
              ]}
            />
          </Form.Item>
          <Button
            type="primary"
            icon={<SkinOutlined />}
            onClick={() => {
              localStorage.setItem('mf_user_preferences', JSON.stringify(form.getFieldsValue()));
              message.success('工作偏好已保存');
            }}
          >
            保存工作偏好
          </Button>
        </Form>
      </Card>

      <Card title="通知偏好" className="account-panel-card">
        <Space direction="vertical" size={18} className="account-switch-list">
          <span><Switch defaultChecked /> <BellOutlined /> 待办与审批提醒</span>
          <span><Switch defaultChecked /> <SafetyCertificateOutlined /> 风险与质量预警</span>
          <span><Switch /> <ApiOutlined /> 数据任务运行结果</span>
        </Space>
      </Card>
    </div>
  );
}

function AIPlatformPanel() {
  const [form] = Form.useForm();

  return (
    <div className="account-center-grid three-columns">
      <Card size="small" title="基础模型配置" className="account-panel-card">
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            defaultModel: 'gpt-4o',
            fallbackModel: 'gpt-4o-mini',
            temperature: 'balanced',
            streaming: true,
            domains: ['production', 'quality', 'maintenance'],
            tools: ['query', 'report'],
            auditEnabled: true,
            retentionDays: 90,
          }}
        >
          <Form.Item name="defaultModel" label="默认模型">
            <Select
              options={[
                { label: 'GPT-4o', value: 'gpt-4o' },
                { label: 'GPT-4o mini', value: 'gpt-4o-mini' },
                { label: '企业私有模型（预留）', value: 'private-model', disabled: true },
              ]}
            />
          </Form.Item>
          <Form.Item name="fallbackModel" label="备用模型">
            <Select
              options={[
                { label: 'GPT-4o mini', value: 'gpt-4o-mini' },
                { label: 'GPT-4o', value: 'gpt-4o' },
              ]}
            />
          </Form.Item>
          <Form.Item name="temperature" label="回答风格">
            <Radio.Group>
              <Radio value="strict">严谨</Radio>
              <Radio value="balanced">均衡</Radio>
              <Radio value="creative">发散</Radio>
            </Radio.Group>
          </Form.Item>
          <Form.Item name="streaming" label="流式输出" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Card>

      <Card size="small" title="知识与工具权限" className="account-panel-card">
        <Form form={form} layout="vertical">
          <Form.Item name="domains" label="可访问业务域">
            <Select
              mode="multiple"
              options={[
                { label: '生产', value: 'production' },
                { label: '质量', value: 'quality' },
                { label: '设备维护', value: 'maintenance' },
                { label: '供应链', value: 'supply-chain' },
              ]}
            />
          </Form.Item>
          <Form.Item name="tools" label="允许调用的工具">
            <Select
              mode="multiple"
              options={[
                { label: '数据查询', value: 'query' },
                { label: '生成报表', value: 'report' },
                { label: '触发流程', value: 'workflow' },
                { label: '修改配置（高风险）', value: 'config' },
              ]}
            />
          </Form.Item>
          <Form.Item name="highRiskConfirm" label="高风险操作二次确认" valuePropName="checked">
            <Switch defaultChecked />
          </Form.Item>
        </Form>
      </Card>

      <Card size="small" title="安全与审计策略" className="account-panel-card">
        <Form form={form} layout="vertical">
          <Form.Item name="auditEnabled" label="保存对话与工具调用日志" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="retentionDays" label="对话保留天数">
            <Select
              options={[
                { label: '30 天', value: 30 },
                { label: '90 天', value: 90 },
                { label: '180 天', value: 180 },
              ]}
            />
          </Form.Item>
          <Button
            type="primary"
            icon={<RobotOutlined />}
            onClick={() => {
              localStorage.setItem('mf_ai_assistant_settings', JSON.stringify(form.getFieldsValue()));
              message.success('AI 与平台设置已保存');
            }}
          >
            保存 AI 设置
          </Button>
        </Form>
      </Card>
    </div>
  );
}

function AuditPanel() {
  return (
    <div className="account-admin-section">
      <div className="account-section-title">
        <AuditOutlined />
        <div>
          <Title level={4}>审计与日志</Title>
          <Text type="secondary">统一查看登录、配置变更、AI 工具调用和高风险操作记录。</Text>
        </div>
      </div>
      <div className="account-center-grid three-columns">
        <Card title="登录审计" className="account-panel-card">
          <Text type="secondary">记录用户登录、退出、异地登录和失败尝试。</Text>
        </Card>
        <Card title="配置变更" className="account-panel-card">
          <Text type="secondary">记录应用、菜单、权限、数据资产等配置调整。</Text>
        </Card>
        <Card title="AI 调用日志" className="account-panel-card">
          <Text type="secondary">记录对话、工具调用、数据查询和高风险确认。</Text>
        </Card>
      </div>
    </div>
  );
}
