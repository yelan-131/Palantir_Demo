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
  Row,
  Select,
  Space,
  Switch,
  Tabs,
  Tag,
  Typography,
  Col,
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
        children: <AIPlatformPanelV2 />,
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

function AIPlatformPanelV2() {
  const [form] = Form.useForm();
  const savedSettings = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem('mf_ai_assistant_settings') || '{}');
    } catch {
      return {};
    }
  }, []);

  const defaultSettings = {
    aiEnabled: true,
    provider: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    organization: '',
    project: '',
    chatModel: 'gpt-4o-mini',
    reasoningModel: 'gpt-4o',
    embeddingModel: 'text-embedding-3-small',
    visionModel: 'gpt-4o',
    temperature: 'strict',
    maxTokens: 2048,
    timeoutSeconds: 30,
    retryCount: 2,
    streaming: true,
    qaEnabled: true,
    assistEnabled: true,
    proactiveEnabled: false,
    agentMode: 'draft',
    domains: ['production', 'quality', 'maintenance', 'supply-chain'],
    tools: ['query', 'report', 'draft'],
    highRiskConfirm: true,
    sensitiveMasking: true,
    forbiddenActions: ['auto_order', 'delete_data', 'change_permission'],
    ragEnabled: false,
    knowledgeScopes: ['project_docs', 'sop'],
    topK: 5,
    similarityThreshold: '0.72',
    auditEnabled: true,
    recordToolCalls: true,
    retentionDays: 90,
    dailyLimit: 1000,
    userDailyLimit: 100,
  };

  const handleSave = () => {
    localStorage.setItem('mf_ai_assistant_settings', JSON.stringify(form.getFieldsValue()));
    message.success('AI 设置已保存到本地 Demo 配置');
  };

  return (
    <div className="account-admin-section">
      <div className="account-section-title">
        <RobotOutlined />
        <div>
          <Title level={4}>AI 设置</Title>
          <Text type="secondary">Demo 阶段先保存到浏览器本地，后续可迁移到后端配置、权限与审计服务。</Text>
        </div>
      </div>

      <Form form={form} layout="vertical" initialValues={{ ...defaultSettings, ...savedSettings }}>
        <div className="account-center-grid three-columns">
          <Card size="small" title="基础连接" className="account-panel-card">
            <Form.Item name="aiEnabled" label="启用 AI" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="provider" label="模型服务商">
              <Select options={[
                { label: 'OpenAI Compatible', value: 'openai-compatible' },
                { label: 'OpenAI', value: 'openai' },
                { label: 'Azure OpenAI', value: 'azure-openai' },
                { label: 'DeepSeek', value: 'deepseek' },
                { label: 'Qwen', value: 'qwen' },
                { label: 'Local Model', value: 'local' },
              ]} />
            </Form.Item>
            <Form.Item name="baseUrl" label="Base URL">
              <Input placeholder="https://api.openai.com/v1" />
            </Form.Item>
            <Form.Item name="apiKey" label="API Key">
              <Input.Password placeholder="Demo 可留空，正式环境由后端密钥库托管" />
            </Form.Item>
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item name="organization" label="Organization">
                  <Input placeholder="可选" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="project" label="Project">
                  <Input placeholder="可选" />
                </Form.Item>
              </Col>
            </Row>
          </Card>

          <Card size="small" title="模型选择" className="account-panel-card">
            <Form.Item name="chatModel" label="默认聊天模型">
              <Select options={[
                { label: 'gpt-4o-mini', value: 'gpt-4o-mini' },
                { label: 'gpt-4o', value: 'gpt-4o' },
                { label: 'deepseek-chat', value: 'deepseek-chat' },
                { label: 'qwen-plus', value: 'qwen-plus' },
              ]} />
            </Form.Item>
            <Form.Item name="reasoningModel" label="推理/Agent 模型">
              <Select options={[
                { label: 'gpt-4o', value: 'gpt-4o' },
                { label: 'gpt-4o-mini', value: 'gpt-4o-mini' },
                { label: 'deepseek-reasoner', value: 'deepseek-reasoner' },
                { label: 'qwen-max', value: 'qwen-max' },
              ]} />
            </Form.Item>
            <Form.Item name="embeddingModel" label="嵌入模型">
              <Select options={[
                { label: 'text-embedding-3-small', value: 'text-embedding-3-small' },
                { label: 'text-embedding-3-large', value: 'text-embedding-3-large' },
                { label: 'bge-m3', value: 'bge-m3' },
              ]} />
            </Form.Item>
            <Form.Item name="visionModel" label="视觉模型">
              <Select options={[
                { label: 'gpt-4o', value: 'gpt-4o' },
                { label: 'gpt-4o-mini', value: 'gpt-4o-mini' },
                { label: '暂不启用', value: 'disabled' },
              ]} />
            </Form.Item>
          </Card>

          <Card size="small" title="生成参数" className="account-panel-card">
            <Form.Item name="temperature" label="回答风格">
              <Radio.Group optionType="button" buttonStyle="solid">
                <Radio.Button value="strict">严谨</Radio.Button>
                <Radio.Button value="balanced">均衡</Radio.Button>
                <Radio.Button value="creative">发散</Radio.Button>
              </Radio.Group>
            </Form.Item>
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item name="maxTokens" label="Max Tokens">
                  <Input type="number" min={256} max={16000} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="timeoutSeconds" label="超时秒数">
                  <Input type="number" min={5} max={180} />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item name="retryCount" label="失败重试次数">
              <Select options={[
                { label: '0 次', value: 0 },
                { label: '1 次', value: 1 },
                { label: '2 次', value: 2 },
                { label: '3 次', value: 3 },
              ]} />
            </Form.Item>
            <Form.Item name="streaming" label="流式输出" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Card>
        </div>

        <div className="account-center-grid three-columns">
          <Card size="small" title="能力开关" className="account-panel-card">
            <Form.Item name="qaEnabled" label="问答型 AI" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="assistEnabled" label="辅助型 AI" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="proactiveEnabled" label="主动型 AI" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="agentMode" label="Agent 执行模式">
              <Select options={[
                { label: '关闭', value: 'off' },
                { label: '只读查询', value: 'readonly' },
                { label: '仅生成草稿', value: 'draft' },
                { label: '确认后执行', value: 'confirm' },
                { label: '自动执行', value: 'auto', disabled: true },
              ]} />
            </Form.Item>
          </Card>

          <Card size="small" title="业务范围与工具" className="account-panel-card">
            <Form.Item name="domains" label="可访问业务域">
              <Select mode="multiple" options={[
                { label: '生产态势', value: 'production' },
                { label: '质量分析', value: 'quality' },
                { label: '设备维护', value: 'maintenance' },
                { label: '供应链风险', value: 'supply-chain' },
                { label: '工作流审批', value: 'workflow' },
                { label: '低代码配置', value: 'low-code' },
              ]} />
            </Form.Item>
            <Form.Item name="tools" label="允许调用工具">
              <Select mode="multiple" options={[
                { label: '查询业务数据', value: 'query' },
                { label: '生成报告', value: 'report' },
                { label: '生成单据草稿', value: 'draft' },
                { label: '发起审批', value: 'workflow' },
                { label: '修改配置', value: 'config' },
                { label: '创建订单', value: 'order', disabled: true },
              ]} />
            </Form.Item>
          </Card>

          <Card size="small" title="安全策略" className="account-panel-card">
            <Form.Item name="highRiskConfirm" label="高风险动作必须二次确认" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="sensitiveMasking" label="敏感字段脱敏" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="forbiddenActions" label="禁止动作清单">
              <Select mode="multiple" options={[
                { label: '自动下单', value: 'auto_order' },
                { label: '删除数据', value: 'delete_data' },
                { label: '修改权限', value: 'change_permission' },
                { label: '发布配置', value: 'publish_config' },
              ]} />
            </Form.Item>
          </Card>
        </div>

        <div className="account-center-grid three-columns">
          <Card size="small" title="知识库 / RAG" className="account-panel-card">
            <Form.Item name="ragEnabled" label="启用知识库问答" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="knowledgeScopes" label="知识范围">
              <Select mode="multiple" options={[
                { label: '项目文档', value: 'project_docs' },
                { label: '业务 SOP', value: 'sop' },
                { label: '设备手册', value: 'equipment_manuals' },
                { label: '供应商协议', value: 'supplier_contracts' },
                { label: 'API 文档', value: 'api_docs' },
              ]} />
            </Form.Item>
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item name="topK" label="Top K">
                  <Input type="number" min={1} max={20} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="similarityThreshold" label="相似度阈值">
                  <Input />
                </Form.Item>
              </Col>
            </Row>
          </Card>

          <Card size="small" title="审计与历史" className="account-panel-card">
            <Form.Item name="auditEnabled" label="保存对话日志" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="recordToolCalls" label="记录工具调用" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="retentionDays" label="历史保留天数">
              <Select options={[
                { label: '30 天', value: 30 },
                { label: '90 天', value: 90 },
                { label: '180 天', value: 180 },
                { label: '365 天', value: 365 },
              ]} />
            </Form.Item>
          </Card>

          <Card size="small" title="成本与额度" className="account-panel-card">
            <Form.Item name="dailyLimit" label="平台每日调用上限">
              <Input type="number" min={1} />
            </Form.Item>
            <Form.Item name="userDailyLimit" label="单用户每日调用上限">
              <Input type="number" min={1} />
            </Form.Item>
            <Space>
              <Button icon={<ApiOutlined />} onClick={() => message.success('Demo 连通性检查通过')}>
                测试连接
              </Button>
              <Button type="primary" icon={<RobotOutlined />} onClick={handleSave}>
                保存 AI 设置
              </Button>
            </Space>
          </Card>
        </div>
      </Form>
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
