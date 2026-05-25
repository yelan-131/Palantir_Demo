import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ApiOutlined,
  AppstoreOutlined,
  AuditOutlined,
  BellOutlined,
  DatabaseOutlined,
  FileSearchOutlined,
  KeyOutlined,
  NodeIndexOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  SkinOutlined,
  UserOutlined,
} from '@ant-design/icons';
import {
  Avatar,
  Button,
  Card,
  Descriptions,
  Divider,
  Empty,
  Form,
  Input,
  Progress,
  Radio,
  Row,
  Segmented,
  Select,
  Space,
  Switch,
  Tabs,
  Tag,
  Table,
  Typography,
  Col,
  message,
} from 'antd';
import cytoscape from 'cytoscape';
import dagre from 'cytoscape-dagre';
import { useAuthStore } from '../../stores/authStore';
import AppMenuManagement from '../SystemAdmin/AppMenuManagement';
import IdentityAccessManagement from '../SystemAdmin/IdentityAccessManagement';
import SemanticAssetCenter, { KnowledgeCenter } from '../SystemAdmin/SemanticAssetCenter';
import { adminListUsers, getAISettings, listAuditLogs, testSavedAISettings, updateAISettings } from '../../services/api';

cytoscape.use(dagre);

interface CurrentApplication {
  name?: string;
}

interface AccountCenterProps {
  currentApplication?: CurrentApplication | null;
}

const { Title, Text } = Typography;
const AI_SETTINGS_STORAGE_KEY = 'mf_ai_assistant_settings';

interface AuditLogRecord {
  id: number;
  tenant_id?: number | null;
  user_id?: number | null;
  action: string;
  resource_type: string;
  resource_id?: number | null;
  old_values?: string | null;
  new_values?: string | null;
  timestamp?: string | null;
}

export default function AccountCenter({ currentApplication }: AccountCenterProps) {
  const user = useAuthStore((s) => s.user);
  const [searchParams, setSearchParams] = useSearchParams();
  const activeSection = searchParams.get('section') || 'account';
  const identityDefaultTab = activeSection === 'roles' ? 'roles' : activeSection === 'orgs' ? 'orgs' : 'users';
  const normalizedSection = ['users', 'roles', 'orgs'].includes(activeSection)
    ? 'identity-access'
    : activeSection === 'palantir-config'
      ? 'data-ontology'
      : activeSection;
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
        key: 'knowledge',
        label: '知识库中心',
        icon: <FileSearchOutlined />,
        children: <KnowledgeCenter />,
      },
      {
        key: 'identity-access',
        label: '用户与权限',
        icon: <SafetyCertificateOutlined />,
        children: <IdentityAccessManagement key={identityDefaultTab} defaultActiveKey={identityDefaultTab} />,
      },
      {
        key: 'audit',
        label: '审计与日志',
        icon: <AuditOutlined />,
        children: <AuditPanel />,
      },
    ];
  }, [currentApplication, identityDefaultTab, roleLabel, roles, user]);

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
        activeKey={normalizedSection}
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
      return JSON.parse(localStorage.getItem(AI_SETTINGS_STORAGE_KEY) || '{}');
    } catch {
      return {};
    }
  }, []);

  const defaultSettings = useMemo(() => ({
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
    guestAccess: 'disabled',
    rolePolicies: [
      { role: 'admin', enabled: true, capabilities: ['qa', 'rag', 'business_query', 'report', 'draft', 'save_draft', 'workflow', 'config'], domains: ['production', 'quality', 'maintenance', 'supply-chain', 'workflow', 'low-code'], agentMode: 'save_after_confirm' },
      { role: 'production_manager', enabled: true, capabilities: ['qa', 'rag', 'business_query', 'report', 'draft', 'save_draft', 'workflow'], domains: ['production', 'maintenance', 'workflow'], agentMode: 'save_after_confirm' },
      { role: 'quality_engineer', enabled: true, capabilities: ['qa', 'rag', 'business_query', 'report', 'draft', 'save_draft'], domains: ['quality'], agentMode: 'save_after_confirm' },
      { role: 'maintenance_manager', enabled: true, capabilities: ['qa', 'rag', 'business_query', 'report', 'draft', 'save_draft'], domains: ['maintenance'], agentMode: 'save_after_confirm' },
      { role: 'supply_chain_manager', enabled: true, capabilities: ['qa', 'rag', 'business_query', 'report', 'draft', 'save_draft'], domains: ['supply-chain'], agentMode: 'save_after_confirm' },
      { role: 'viewer', enabled: true, capabilities: ['qa', 'rag', 'report'], domains: ['production', 'quality', 'maintenance', 'supply-chain'], agentMode: 'readonly' },
    ],
    riskPolicy: { low: 'allow', medium: 'confirm', high: 'confirm_and_audit', critical: 'blocked' },
    ragEnabled: false,
    knowledgeScopes: ['project_docs', 'sop'],
    topK: 5,
    similarityThreshold: '0.72',
    auditEnabled: true,
    recordToolCalls: true,
    retentionDays: 90,
    dailyLimit: 1000,
    userDailyLimit: 100,
  }), []);

  useEffect(() => {
    let cancelled = false;

    const loadBackendSettings = async () => {
      try {
        const response = await getAISettings();
        const backendSettings = response.data?.settings || response.data?.data?.settings || response.data?.data;
        if (!cancelled && backendSettings && typeof backendSettings === 'object' && !Array.isArray(backendSettings)) {
          const mergedSettings = { ...defaultSettings, ...savedSettings, ...backendSettings };
          form.setFieldsValue(mergedSettings);
          localStorage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(mergedSettings));
        }
      } catch {
        if (!cancelled) {
          form.setFieldsValue({ ...defaultSettings, ...savedSettings });
        }
      }
    };

    loadBackendSettings();

    return () => {
      cancelled = true;
    };
  }, [defaultSettings, form, savedSettings]);

  const saveLocalSettings = (values: Record<string, unknown>) => {
    localStorage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(values));
  };

  const aiRoleOptions = [
    { label: 'Admin', value: 'admin' },
    { label: 'Production manager', value: 'production_manager' },
    { label: 'Quality engineer', value: 'quality_engineer' },
    { label: 'Maintenance manager', value: 'maintenance_manager' },
    { label: 'Supply chain manager', value: 'supply_chain_manager' },
    { label: 'Operator', value: 'operator' },
    { label: 'Viewer', value: 'viewer' },
  ];

  const aiCapabilityOptions = [
    { label: 'Page Q&A', value: 'qa' },
    { label: 'Knowledge RAG', value: 'rag' },
    { label: 'Business query', value: 'business_query' },
    { label: 'Report summary', value: 'report' },
    { label: 'Generate draft', value: 'draft' },
    { label: 'Save draft after confirm', value: 'save_draft' },
    { label: 'Start workflow', value: 'workflow' },
    { label: 'Config assistant', value: 'config' },
  ];

  const aiDomainOptions = [
    { label: 'Production', value: 'production' },
    { label: 'Quality', value: 'quality' },
    { label: 'Maintenance', value: 'maintenance' },
    { label: 'Supply chain', value: 'supply-chain' },
    { label: 'Workflow', value: 'workflow' },
    { label: 'Low-code', value: 'low-code' },
  ];

  const handleSave = () => {
    saveLocalSettings(form.getFieldsValue());
    message.success('AI 设置已保存到本地 Demo 配置');
  };

  const handleSaveToBackend = async () => {
    const values = form.getFieldsValue();
    saveLocalSettings(values);
    try {
      await updateAISettings(values);
      message.success('AI settings saved to backend system settings');
    } catch {
      message.warning('Backend AI settings unavailable; saved local demo settings');
    }
  };

  const handleTestConnection = async () => {
    const values = form.getFieldsValue();
    saveLocalSettings(values);
    try {
      await updateAISettings(values);
      const response = await testSavedAISettings();
      if (response.data?.ok) {
        message.success(response.data?.message || 'AI provider configuration accepted');
      } else {
        message.warning(response.data?.message || 'AI provider configuration is incomplete');
      }
    } catch {
      message.error('AI provider test failed');
    }
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
                { label: 'GLM', value: 'glm' },
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
                { label: 'glm-4-flash', value: 'glm-4-flash' },
                { label: 'glm-4-plus', value: 'glm-4-plus' },
              ]} />
            </Form.Item>
            <Form.Item name="reasoningModel" label="推理/Agent 模型">
              <Select options={[
                { label: 'gpt-4o', value: 'gpt-4o' },
                { label: 'gpt-4o-mini', value: 'gpt-4o-mini' },
                { label: 'glm-4v-plus', value: 'glm-4v-plus' },
                { label: 'deepseek-reasoner', value: 'deepseek-reasoner' },
                { label: 'qwen-max', value: 'qwen-max' },
                { label: 'glm-4-plus', value: 'glm-4-plus' },
              ]} />
            </Form.Item>
            <Form.Item name="embeddingModel" label="嵌入模型">
              <Select options={[
                { label: 'text-embedding-3-small', value: 'text-embedding-3-small' },
                { label: 'text-embedding-3-large', value: 'text-embedding-3-large' },
                { label: 'bge-m3', value: 'bge-m3' },
                { label: 'embedding-3', value: 'embedding-3' },
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
              <Button icon={<ApiOutlined />} onClick={handleTestConnection}>
                Test backend AI
              </Button>
              <Button icon={<ApiOutlined />} onClick={() => message.success('Demo 连通性检查通过')}>
                测试连接
              </Button>
              <Button type="primary" icon={<RobotOutlined />} onClick={handleSaveToBackend}>
                保存 AI 设置
              </Button>
            </Space>
          </Card>
        </div>
      </Form>
    </div>
  );
}

type ClosedLoopNode = {
  id: string;
  name: string;
  type: string;
  domain: string;
  status: 'published' | 'draft' | 'review';
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  module: string;
  roles: string[];
  fields: string[];
  actions: string[];
  description: string;
};

type ClosedLoopEdge = {
  id: string;
  source: string;
  target: string;
  type: string;
  label: string;
  condition: string;
  status: 'published' | 'draft' | 'review';
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  evidence: string;
  frontendVisible: boolean;
};

const closedLoopNodes: ClosedLoopNode[] = [
  { id: 'quality-event', name: '质量异常事件', type: 'QualityEvent', domain: '质量', status: 'published', riskLevel: 'critical', module: '质量异常闭环', roles: ['质量经理', '生产主管', '平台管理员'], fields: ['event_id', 'severity', 'status', 'risk_score', 'owner'], actions: ['AI 影响分析', '冻结批次', '生成 CAPA'], description: '承载缺陷超阈值后形成的业务事件，是闭环编排的中心对象。' },
  { id: 'defect', name: '焊点虚焊缺陷', type: 'Defect', domain: '质量', status: 'published', riskLevel: 'high', module: '质量分析', roles: ['质量经理', '质量工程师'], fields: ['defect_type', 'defect_rate', 'station', 'severity'], actions: ['发起复检', '缺陷归因'], description: '来自检验、AOI 或人工复核的缺陷事实，用于触发规则和影响分析。' },
  { id: 'batch', name: 'MB-7781 物料批次', type: 'MaterialBatch', domain: '供应链', status: 'published', riskLevel: 'high', module: '数据资产中心', roles: ['采购', '质量经理', '生产主管'], fields: ['batch_no', 'material_code', 'supplier_id', 'lot_status'], actions: ['冻结批次', '让步放行审批'], description: '与供应商、工单、缺陷关联的物料批次主数据对象。' },
  { id: 'supplier', name: '北辰电子材料', type: 'Supplier', domain: '供应链', status: 'published', riskLevel: 'medium', module: '供应链风险', roles: ['采购', '质量经理'], fields: ['supplier_id', 'rating', 'risk_level', 'delivery_score'], actions: ['通知采购', '供应商 8D 跟进'], description: '质量事件关联到供应商后，用于形成采购和供应风险处置。' },
  { id: 'workorder', name: 'WO-260521-017 工单', type: 'WorkOrder', domain: '生产', status: 'published', riskLevel: 'medium', module: '生产计划', roles: ['生产主管', '质量经理'], fields: ['work_order_id', 'line_id', 'plan_qty', 'delivery_date'], actions: ['调整排产', '通知班组'], description: '质量异常影响的生产工单，用于连接交付和产线执行。' },
  { id: 'capa', name: 'CAPA-072 整改闭环', type: 'CAPA', domain: '工作流', status: 'review', riskLevel: 'high', module: '流程中心', roles: ['质量经理', '质量工程师'], fields: ['capa_id', 'owner', 'due_date', 'verify_result'], actions: ['审批整改', '验证关闭'], description: '由质量事件生成的纠正预防措施，必须人工确认后进入工作流。' },
  { id: 'ai-action', name: 'AI 建议草稿', type: 'AIAction', domain: 'AI', status: 'review', riskLevel: 'high', module: 'AI 助手', roles: ['质量经理', '平台管理员'], fields: ['prompt', 'summary', 'suggested_actions', 'confidence'], actions: ['生成草稿', '等待人工确认'], description: 'AI 只负责解释风险和生成草稿，高风险动作不能自动执行。' },
  { id: 'role', name: '角色工作台', type: 'RolePolicy', domain: '权限', status: 'published', riskLevel: 'low', module: '用户与权限', roles: ['平台管理员'], fields: ['role', 'data_scope', 'allowed_actions', 'audit_required'], actions: ['控制可见性', '限制高危动作'], description: '决定不同角色能看到哪些节点、关系和动作按钮。' },
  { id: 'audit', name: '审计链路', type: 'AuditTrail', domain: '审计', status: 'published', riskLevel: 'low', module: '审计与日志', roles: ['平台管理员', '审计员'], fields: ['actor', 'action', 'target', 'timestamp', 'before_after'], actions: ['记录配置', '记录确认', '追溯执行'], description: '记录配置变更、AI 建议、人工确认和工作流执行结果。' },
];

const closedLoopEdges: ClosedLoopEdge[] = [
  { id: 'edge-defect-event', source: 'defect', target: 'quality-event', type: 'TRIGGERS', label: '规则触发', condition: '缺陷率 > 2.0% 且严重度 >= Major', status: 'published', riskLevel: 'critical', evidence: '质量检验规则 / defect_rate_threshold', frontendVisible: true },
  { id: 'edge-event-batch', source: 'quality-event', target: 'batch', type: 'AFFECTS', label: '影响批次', condition: 'event.material_batch_id = batch.batch_no', status: 'published', riskLevel: 'high', evidence: '知识图谱中心 / 物料批次关系', frontendVisible: true },
  { id: 'edge-batch-supplier', source: 'batch', target: 'supplier', type: 'SUPPLIED_BY', label: '供应来源', condition: 'batch.supplier_id = supplier.id', status: 'published', riskLevel: 'medium', evidence: '数据资产中心 / supplier master', frontendVisible: true },
  { id: 'edge-event-workorder', source: 'quality-event', target: 'workorder', type: 'IMPACTS', label: '影响工单', condition: '批次已投产或占用生产计划', status: 'published', riskLevel: 'medium', evidence: 'Graph impact-analysis', frontendVisible: true },
  { id: 'edge-event-ai', source: 'quality-event', target: 'ai-action', type: 'SUGGESTS', label: 'AI 草稿', condition: '人工点击 AI 影响分析', status: 'review', riskLevel: 'high', evidence: 'AI Assistant tool call', frontendVisible: false },
  { id: 'edge-ai-capa', source: 'ai-action', target: 'capa', type: 'DRAFTS', label: '生成 CAPA 草稿', condition: '质量经理确认 AI 建议后', status: 'review', riskLevel: 'high', evidence: '人工确认记录', frontendVisible: false },
  { id: 'edge-role-event', source: 'role', target: 'quality-event', type: 'CAN_VIEW', label: '角色可见', condition: 'role in [quality_manager, production_manager]', status: 'published', riskLevel: 'low', evidence: '用户与权限配置', frontendVisible: false },
  { id: 'edge-capa-audit', source: 'capa', target: 'audit', type: 'AUDITED_BY', label: '审计留痕', condition: 'CAPA 创建、审批、关闭全量记录', status: 'published', riskLevel: 'low', evidence: '审计与日志', frontendVisible: false },
  { id: 'edge-ai-audit', source: 'ai-action', target: 'audit', type: 'AUDITED_BY', label: 'AI 留痕', condition: 'AI 建议和工具调用必须记录', status: 'published', riskLevel: 'medium', evidence: 'AI 工具调用日志', frontendVisible: false },
];

const domainOptions = ['全部', '质量', '供应链', '生产', '工作流', 'AI', '权限', '审计'];
const roleOptions = ['全部', '质量经理', '质量工程师', '生产主管', '采购', '平台管理员', '审计员'];
const riskOptions = ['全部', 'low', 'medium', 'high', 'critical'];
const statusOptions = ['全部', 'published', 'review', 'draft'];

const closedLoopTypeColors: Record<string, string> = {
  QualityEvent: '#c83f49',
  Defect: '#d46b08',
  MaterialBatch: '#1677ff',
  Supplier: '#2f7d5b',
  WorkOrder: '#5b4ca3',
  CAPA: '#a43d3d',
  AIAction: '#2f5f73',
  RolePolicy: '#7353ba',
  AuditTrail: '#5d6972',
};

const riskColor: Record<string, string> = {
  low: 'green',
  medium: 'gold',
  high: 'volcano',
  critical: 'red',
};

function ClosedLoopConfigCenter() {
  const [selectedDomain, setSelectedDomain] = useState('全部');
  const [selectedRole, setSelectedRole] = useState('全部');
  const [selectedRisk, setSelectedRisk] = useState('全部');
  const [selectedStatus, setSelectedStatus] = useState('全部');
  const [layoutMode, setLayoutMode] = useState('业务闭环视图');
  const [selected, setSelected] = useState<{ kind: 'node'; data: ClosedLoopNode } | { kind: 'edge'; data: ClosedLoopEdge }>({ kind: 'node', data: closedLoopNodes[0] });
  const cyContainerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);

  const filteredNodes = useMemo(() => {
    return closedLoopNodes.filter((node) => {
      const domainMatched = selectedDomain === '全部' || node.domain === selectedDomain;
      const roleMatched = selectedRole === '全部' || node.roles.includes(selectedRole);
      const riskMatched = selectedRisk === '全部' || node.riskLevel === selectedRisk;
      const statusMatched = selectedStatus === '全部' || node.status === selectedStatus;
      return domainMatched && roleMatched && riskMatched && statusMatched;
    });
  }, [selectedDomain, selectedRisk, selectedRole, selectedStatus]);

  const filteredNodeIds = useMemo(() => new Set(filteredNodes.map((node) => node.id)), [filteredNodes]);
  const filteredEdges = useMemo(() => closedLoopEdges.filter((edge) => filteredNodeIds.has(edge.source) && filteredNodeIds.has(edge.target)), [filteredNodeIds]);

  useEffect(() => {
    if (!cyContainerRef.current) return;

    const elements: cytoscape.ElementDefinition[] = [
      ...filteredNodes.map((node) => ({
        group: 'nodes' as const,
        data: {
          id: node.id,
          label: node.name,
          shortLabel: node.type,
          color: closedLoopTypeColors[node.type] || '#8c8c8c',
          riskLevel: node.riskLevel,
        },
      })),
      ...filteredEdges.map((edge) => ({
        group: 'edges' as const,
        data: {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          label: edge.label,
          edgeType: edge.type,
          riskLevel: edge.riskLevel,
        },
      })),
    ];

    if (cyRef.current) {
      cyRef.current.destroy();
      cyRef.current = null;
    }

    if (!elements.length) return;

    const cy = cytoscape({
      container: cyContainerRef.current,
      elements,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': 'data(color)',
            label: 'data(label)',
            color: '#172026',
            'font-size': 11,
            'font-weight': 700,
            'text-valign': 'bottom',
            'text-halign': 'center',
            'text-margin-y': 8,
            'text-wrap': 'wrap',
            'text-max-width': '112px',
            width: 58,
            height: 58,
            'border-width': 4,
            'border-color': '#fff',
            'overlay-opacity': 0,
          },
        },
        {
          selector: 'node:selected',
          style: {
            'border-color': '#172026',
            'border-width': 5,
          },
        },
        {
          selector: 'edge',
          style: {
            width: 2,
            'line-color': '#b9c5ce',
            'target-arrow-color': '#b9c5ce',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            label: 'data(label)',
            'font-size': 10,
            color: '#52616b',
            'text-background-color': '#fff',
            'text-background-opacity': 0.9,
            'text-background-padding': '3px',
            'text-rotation': 'autorotate',
          },
        },
        {
          selector: 'edge:selected',
          style: {
            width: 4,
            'line-color': '#2f5f73',
            'target-arrow-color': '#2f5f73',
          },
        },
      ] as any,
      layout: getClosedLoopLayout(layoutMode),
      minZoom: 0.35,
      maxZoom: 2.2,
      wheelSensitivity: 0.25,
    });

    cy.on('tap', 'node', (event) => {
      const node = closedLoopNodes.find((item) => item.id === event.target.id());
      if (node) setSelected({ kind: 'node', data: node });
    });

    cy.on('tap', 'edge', (event) => {
      const edge = closedLoopEdges.find((item) => item.id === event.target.id());
      if (edge) setSelected({ kind: 'edge', data: edge });
    });

    cyRef.current = cy;
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [filteredEdges, filteredNodes, layoutMode]);

  const metrics = [
    { label: '业务对象', value: closedLoopNodes.filter((node) => !['RolePolicy', 'AuditTrail'].includes(node.type)).length },
    { label: '图谱关系', value: closedLoopEdges.filter((edge) => edge.frontendVisible).length },
    { label: '业务动作', value: closedLoopNodes.reduce((sum, node) => sum + node.actions.length, 0) },
    { label: '角色策略', value: new Set(closedLoopNodes.flatMap((node) => node.roles)).size },
    { label: '风险策略', value: closedLoopEdges.filter((edge) => ['high', 'critical'].includes(edge.riskLevel)).length },
    { label: '审计覆盖率', value: '100%' },
  ];

  return (
    <div className="closed-loop-config-center">
      <section className="closed-loop-hero">
        <div>
          <Typography.Text className="closed-loop-kicker">ManuFoundry Operations Ontology</Typography.Text>
          <Typography.Title level={4}>运营闭环配置中心</Typography.Title>
          <Typography.Text type="secondary">把业务对象、图谱关系、AI 草稿、人工确认、工作流动作和审计记录编排成可发布的运营闭环。</Typography.Text>
        </div>
        <Space wrap>
          <Tag color="processing">后台配置</Tag>
          <Tag color="success">人工确认后执行</Tag>
          <Button icon={<NodeIndexOutlined />} onClick={() => cyRef.current?.fit(undefined, 32)}>适配画布</Button>
        </Space>
      </section>

      <Row gutter={[12, 12]} className="closed-loop-metrics">
        {metrics.map((metric) => (
          <Col xs={12} md={8} xl={4} key={metric.label}>
            <Card size="small">
              <Typography.Text type="secondary">{metric.label}</Typography.Text>
              <Typography.Title level={3}>{metric.value}</Typography.Title>
            </Card>
          </Col>
        ))}
      </Row>

      <div className="closed-loop-workbench">
        <aside className="closed-loop-left">
          <Typography.Text strong>配置域</Typography.Text>
          {[
            ['业务对象', '本体对象、字段和主数据绑定'],
            ['对象关系', '图谱边、影响路径和证据'],
            ['业务动作', '冻结、复检、CAPA、通知'],
            ['角色工作台', '角色入口和数据范围'],
            ['AI 权限', '草稿、工具和高危动作策略'],
            ['审计闭环', '配置、确认、执行留痕'],
          ].map(([title, desc]) => (
            <button className="closed-loop-domain-item" key={title} type="button">
              <span>{title}</span>
              <small>{desc}</small>
            </button>
          ))}
        </aside>

        <main className="closed-loop-canvas-panel">
          <div className="closed-loop-toolbar">
            <Space wrap>
              <Select value={selectedDomain} options={domainOptions.map((value) => ({ value, label: value }))} onChange={setSelectedDomain} style={{ width: 130 }} />
              <Select value={selectedRole} options={roleOptions.map((value) => ({ value, label: value }))} onChange={setSelectedRole} style={{ width: 150 }} />
              <Select value={selectedRisk} options={riskOptions.map((value) => ({ value, label: value }))} onChange={setSelectedRisk} style={{ width: 130 }} />
              <Select value={selectedStatus} options={statusOptions.map((value) => ({ value, label: value }))} onChange={setSelectedStatus} style={{ width: 140 }} />
            </Space>
            <Segmented
              value={layoutMode}
              onChange={(value) => setLayoutMode(String(value))}
              options={['业务闭环视图', '数据关系视图', '权限视图', '动作流视图']}
            />
          </div>
          <div className="closed-loop-canvas" ref={cyContainerRef}>
            {!filteredNodes.length && <Empty description="没有符合筛选条件的闭环对象" />}
          </div>
        </main>

        <aside className="closed-loop-right">
          <Typography.Text strong>{selected.kind === 'node' ? '对象详情' : '关系详情'}</Typography.Text>
          <Divider />
          {selected.kind === 'node' ? <ClosedLoopNodeDetail node={selected.data} /> : <ClosedLoopEdgeDetail edge={selected.data} />}
        </aside>
      </div>

      <Card className="closed-loop-governance" title="治理链路">
        <Tabs
          items={[
            { key: 'rules', label: '规则触发', children: <ClosedLoopEdgeTable data={closedLoopEdges.filter((edge) => edge.type === 'TRIGGERS' || edge.type === 'AFFECTS' || edge.type === 'IMPACTS')} /> },
            { key: 'actions', label: '动作编排', children: <ClosedLoopEdgeTable data={closedLoopEdges.filter((edge) => ['SUGGESTS', 'DRAFTS'].includes(edge.type))} /> },
            { key: 'roles', label: '角色可见性', children: <ClosedLoopEdgeTable data={closedLoopEdges.filter((edge) => edge.type === 'CAN_VIEW')} /> },
            { key: 'ai', label: 'AI 安全策略', children: <ClosedLoopPolicyTable /> },
            { key: 'audit', label: '审计记录', children: <ClosedLoopEdgeTable data={closedLoopEdges.filter((edge) => edge.type === 'AUDITED_BY')} /> },
          ]}
        />
      </Card>
    </div>
  );
}

function getClosedLoopLayout(layoutMode: string): cytoscape.LayoutOptions {
  if (layoutMode === '数据关系视图') return { name: 'dagre', rankDir: 'LR', spacingFactor: 1.15, fit: true, padding: 36 } as cytoscape.LayoutOptions;
  if (layoutMode === '权限视图') return { name: 'concentric', fit: true, padding: 42, minNodeSpacing: 42 } as cytoscape.LayoutOptions;
  if (layoutMode === '动作流视图') return { name: 'breadthfirst', directed: true, fit: true, padding: 42, spacingFactor: 1.1 } as cytoscape.LayoutOptions;
  return { name: 'dagre', rankDir: 'TB', spacingFactor: 1.08, fit: true, padding: 36 } as cytoscape.LayoutOptions;
}

function ClosedLoopNodeDetail({ node }: { node: ClosedLoopNode }) {
  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Space wrap>
        <Tag color="blue">{node.type}</Tag>
        <Tag color={riskColor[node.riskLevel]}>{node.riskLevel}</Tag>
        <Tag color={node.status === 'published' ? 'green' : 'gold'}>{node.status}</Tag>
      </Space>
      <Typography.Title level={5}>{node.name}</Typography.Title>
      <Typography.Paragraph type="secondary">{node.description}</Typography.Paragraph>
      <Descriptions size="small" column={1} bordered>
        <Descriptions.Item label="业务域">{node.domain}</Descriptions.Item>
        <Descriptions.Item label="承载模块">{node.module}</Descriptions.Item>
        <Descriptions.Item label="可见角色">{node.roles.join(' / ')}</Descriptions.Item>
      </Descriptions>
      <div>
        <Typography.Text type="secondary">关键字段</Typography.Text>
        <div className="closed-loop-tag-cloud">{node.fields.map((field) => <Tag key={field}>{field}</Tag>)}</div>
      </div>
      <div>
        <Typography.Text type="secondary">关联动作</Typography.Text>
        <div className="closed-loop-tag-cloud">{node.actions.map((action) => <Tag color="processing" key={action}>{action}</Tag>)}</div>
      </div>
    </Space>
  );
}

function ClosedLoopEdgeDetail({ edge }: { edge: ClosedLoopEdge }) {
  const source = closedLoopNodes.find((node) => node.id === edge.source);
  const target = closedLoopNodes.find((node) => node.id === edge.target);

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Space wrap>
        <Tag color="purple">{edge.type}</Tag>
        <Tag color={riskColor[edge.riskLevel]}>{edge.riskLevel}</Tag>
        <Tag color={edge.status === 'published' ? 'green' : 'gold'}>{edge.status}</Tag>
      </Space>
      <Typography.Title level={5}>{edge.label}</Typography.Title>
      <Descriptions size="small" column={1} bordered>
        <Descriptions.Item label="起点">{source?.name ?? edge.source}</Descriptions.Item>
        <Descriptions.Item label="终点">{target?.name ?? edge.target}</Descriptions.Item>
        <Descriptions.Item label="触发条件">{edge.condition}</Descriptions.Item>
        <Descriptions.Item label="来源证据">{edge.evidence}</Descriptions.Item>
        <Descriptions.Item label="前台可见">{edge.frontendVisible ? '是' : '否，仅后台治理'}</Descriptions.Item>
      </Descriptions>
    </Space>
  );
}

function ClosedLoopEdgeTable({ data }: { data: ClosedLoopEdge[] }) {
  return (
    <Table
      size="small"
      rowKey="id"
      dataSource={data}
      pagination={false}
      columns={[
        { title: '关系', dataIndex: 'label', width: 130 },
        { title: '类型', dataIndex: 'type', width: 130, render: (value) => <Tag color="purple">{value}</Tag> },
        { title: '触发条件', dataIndex: 'condition', ellipsis: true },
        { title: '风险', dataIndex: 'riskLevel', width: 100, render: (value) => <Tag color={riskColor[value]}>{value}</Tag> },
        { title: '发布', dataIndex: 'status', width: 100, render: (value) => <Tag color={value === 'published' ? 'green' : 'gold'}>{value}</Tag> },
        { title: '前台图谱', dataIndex: 'frontendVisible', width: 110, render: (value) => <Tag color={value ? 'success' : 'default'}>{value ? '可见' : '后台'}</Tag> },
      ]}
    />
  );
}

function ClosedLoopPolicyTable() {
  const policies = [
    { key: 'ai-draft', policy: 'AI 只生成处置草稿', scope: 'AI 建议、CAPA 草稿、风险解释', guard: '不可直接执行冻结、放行、删除等动作', coverage: 100 },
    { key: 'confirm', policy: '高风险动作人工确认', scope: '冻结批次、生成 CAPA、供应商整改', guard: '质量经理确认后进入工作流', coverage: 100 },
    { key: 'audit', policy: '工具调用审计', scope: 'AI 工具调用、配置变更、动作审批', guard: '记录 actor/action/target/before_after', coverage: 100 },
    { key: 'visibility', policy: '角色数据边界', scope: '前台图谱、动作按钮、配置入口', guard: '按角色和数据范围过滤', coverage: 92 },
  ];

  return (
    <Table
      size="small"
      rowKey="key"
      dataSource={policies}
      pagination={false}
      columns={[
        { title: '策略', dataIndex: 'policy', width: 170 },
        { title: '覆盖范围', dataIndex: 'scope', ellipsis: true },
        { title: '保护机制', dataIndex: 'guard', ellipsis: true },
        { title: '覆盖率', dataIndex: 'coverage', width: 150, render: (value) => <Progress size="small" percent={value} /> },
      ]}
    />
  );
}

function AuditPanel() {
  const [logs, setLogs] = useState<AuditLogRecord[]>([]);
  const [usersById, setUsersById] = useState<Record<number, string>>({});
  const [summary, setSummary] = useState<{ resource_counts?: Record<string, number>; action_counts?: Record<string, number> }>({});
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({ resource_type: 'all', action: 'all', keyword: '' });

  const fetchAuditLogs = async (
    nextPage = page,
    nextPageSize = pageSize,
    nextFilters = filters,
  ) => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = {
        page: nextPage,
        page_size: nextPageSize,
      };
      if (nextFilters.resource_type !== 'all') params.resource_type = nextFilters.resource_type;
      if (nextFilters.action !== 'all') params.action = nextFilters.action;
      if (nextFilters.keyword.trim()) params.keyword = nextFilters.keyword.trim();

      const [auditResp, usersResp] = await Promise.all([
        listAuditLogs(params),
        adminListUsers().catch(() => null),
      ]);
      const payload = auditResp.data ?? {};
      setLogs(payload.data ?? []);
      setTotal(payload.total ?? 0);
      setSummary(payload.summary ?? {});
      setPage(payload.page ?? nextPage);
      setPageSize(payload.page_size ?? nextPageSize);

      const userRows = Array.isArray(usersResp?.data) ? usersResp.data : usersResp?.data?.data ?? [];
      setUsersById(Object.fromEntries(userRows.map((item: any) => [
        item.id,
        item.display_name || item.username || `用户 ${item.id}`,
      ])));
    } catch (error) {
      message.error('审计日志加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAuditLogs(1, pageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resourceCounts = summary.resource_counts ?? {};
  const actionCounts = summary.action_counts ?? {};
  const loginCount = resourceCounts.auth ?? 0;
  const aiCount = Object.entries(resourceCounts).reduce((sum, [key, value]) => (
    key.includes('ai') ? sum + value : sum
  ), 0);
  const highRiskCount = Object.entries(actionCounts).reduce((sum, [key, value]) => (
    /(delete|approve|reject|confirm|freeze|disable)/i.test(key) ? sum + value : sum
  ), 0);
  const configCount = Math.max(total - loginCount - aiCount, 0);

  const applyFilters = (nextFilters = filters) => {
    setPage(1);
    fetchAuditLogs(1, pageSize, nextFilters);
  };

  const resetFilters = () => {
    const nextFilters = { resource_type: 'all', action: 'all', keyword: '' };
    setFilters(nextFilters);
    setPage(1);
    fetchAuditLogs(1, pageSize, nextFilters);
  };

  const updateAuditFilter = (key: keyof typeof filters, value: string) => {
    const nextFilters = { ...filters, [key]: value };
    setFilters(nextFilters);
    applyFilters(nextFilters);
  };

  const activeFilterTags = [
    filters.keyword.trim() ? `关键词：${filters.keyword.trim()}` : null,
    filters.resource_type !== 'all' ? `资源：${auditResourceLabel(filters.resource_type)}` : null,
    filters.action !== 'all' ? `动作：${auditActionLabel(filters.action)}` : null,
  ].filter(Boolean);

  return (
    <div className="account-admin-section">
      <div className="audit-summary-grid">
        <Card className="account-panel-card audit-summary-card">
          <Text type="secondary">全部记录</Text>
          <Title level={3}>{total}</Title>
        </Card>
        <Card className="account-panel-card audit-summary-card">
          <Text type="secondary">登录审计</Text>
          <Title level={3}>{loginCount}</Title>
        </Card>
        <Card className="account-panel-card audit-summary-card">
          <Text type="secondary">配置变更</Text>
          <Title level={3}>{configCount}</Title>
        </Card>
        <Card className="account-panel-card audit-summary-card">
          <Text type="secondary">高风险动作</Text>
          <Title level={3}>{highRiskCount}</Title>
        </Card>
      </div>

      <Card className="account-panel-card audit-console-card">
        <div className="audit-toolbar">
          <Input.Search
            allowClear
            placeholder="搜索动作、资源、变更内容"
            value={filters.keyword}
            onChange={(event) => setFilters((prev) => ({ ...prev, keyword: event.target.value }))}
            onSearch={() => applyFilters()}
          />
          <Select
            value={filters.resource_type}
            onChange={(value) => updateAuditFilter('resource_type', value)}
            options={[
              { label: '全部资源', value: 'all' },
              { label: '登录认证', value: 'auth' },
              { label: '应用', value: 'application' },
              { label: '应用绑定', value: 'application_binding' },
              { label: '菜单', value: 'platform_menu_node' },
              { label: '表单', value: 'platform_form' },
              { label: '角色权限', value: 'role_permission' },
              { label: '本体对象', value: 'ontology_object' },
              { label: '本体关系', value: 'ontology_relation' },
              { label: '图谱同步', value: 'graph' },
              { label: 'AI 助手', value: 'ai_assistant' },
              { label: 'AI 设置', value: 'ai_settings' },
              { label: '流程实例', value: 'workflow_instance' },
              { label: '报表', value: 'report' },
              { label: '知识资产', value: 'knowledge_asset' },
              { label: '知识查询', value: 'knowledge' },
              { label: '维修工单', value: 'maintenance_order' },
              { label: '物料批次', value: 'material_batch' },
              { label: '供应商', value: 'supplier' },
              { label: '用户', value: 'user' },
              { label: '组织', value: 'org_unit' },
              { label: '通知', value: 'notification' },
              { label: '审计归档', value: 'audit' },
            ]}
          />
          <Select
            value={filters.action}
            onChange={(value) => updateAuditFilter('action', value)}
            options={[
              { label: '全部动作', value: 'all' },
              { label: '登录成功', value: 'login_success' },
              { label: '登录失败', value: 'login_failed' },
              { label: '退出登录', value: 'logout' },
              { label: '创建', value: 'create' },
              { label: '更新', value: 'update' },
              { label: '删除', value: 'delete' },
              { label: '审批', value: 'approve' },
              { label: '驳回', value: 'reject' },
              { label: '确认', value: 'confirm' },
              { label: '发起', value: 'start' },
              { label: '查询', value: 'query' },
              { label: '导出', value: 'export' },
              { label: '同步', value: 'sync' },
              { label: '上传', value: 'upload' },
              { label: '冻结', value: 'freeze' },
              { label: '停用', value: 'disable' },
              { label: '归档', value: 'archive' },
              { label: '保存草稿', value: 'draft_saved' },
            ]}
          />
          <Space>
            <Button onClick={resetFilters}>重置</Button>
            <Button type="primary" icon={<AuditOutlined />} onClick={() => applyFilters()}>查询</Button>
          </Space>
        </div>

        <div className="audit-filter-status">
          <Space size={8} wrap>
            <Text type="secondary">
              当前筛选命中 <Typography.Text strong>{total}</Typography.Text> 条
            </Text>
            {activeFilterTags.length ? activeFilterTags.map((tag) => (
              <Tag key={tag} color="processing">{tag}</Tag>
            )) : <Tag>未设置筛选条件</Tag>}
          </Space>
          <Button size="small" onClick={() => fetchAuditLogs(page, pageSize)}>
            刷新
          </Button>
        </div>

        <Table
          size="small"
          rowKey="id"
          loading={loading}
          dataSource={logs}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (count) => `共 ${count} 条`,
            onChange: (nextPage, nextPageSize) => fetchAuditLogs(nextPage, nextPageSize),
          }}
          expandable={{
            expandedRowRender: (record) => <AuditDetail record={record} />,
          }}
          columns={[
            {
              title: '时间',
              dataIndex: 'timestamp',
              width: 170,
              render: (value) => formatAuditTime(value),
            },
            {
              title: '用户',
              dataIndex: 'user_id',
              width: 150,
              render: (value) => value ? usersById[value] || `用户 ${value}` : '系统',
            },
            {
              title: '动作',
              dataIndex: 'action',
              width: 130,
              render: (value) => <Tag color={auditActionColor(value)}>{auditActionLabel(value)}</Tag>,
            },
            {
              title: '资源',
              dataIndex: 'resource_type',
              width: 170,
              render: (value, record) => (
                <Space size={6} wrap>
                  <Tag>{auditResourceLabel(value)}</Tag>
                  {record.resource_id ? <Text type="secondary">#{record.resource_id}</Text> : null}
                </Space>
              ),
            },
            {
              title: '摘要',
              render: (_, record) => <Text ellipsis>{auditSummaryText(record)}</Text>,
            },
          ]}
        />
      </Card>
    </div>
  );
}

function AuditDetail({ record }: { record: AuditLogRecord }) {
  return (
    <div className="audit-detail">
      <div>
        <Text type="secondary">变更前</Text>
        <pre>{formatAuditJson(record.old_values)}</pre>
      </div>
      <div>
        <Text type="secondary">变更后 / 上下文</Text>
        <pre>{formatAuditJson(record.new_values)}</pre>
      </div>
    </div>
  );
}

function parseAuditJson(value?: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function formatAuditJson(value?: string | null) {
  const parsed = parseAuditJson(value);
  if (!parsed) return '无';
  return typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2);
}

function auditSummaryText(record: AuditLogRecord) {
  const payload = parseAuditJson(record.new_values);
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const data = payload as Record<string, unknown>;
    const name = data.name || data.title || data.username || data.code || data.route_path;
    if (name) return `${auditActionLabel(record.action)} ${auditResourceLabel(record.resource_type)}：${String(name)}`;
  }
  return `${auditActionLabel(record.action)} ${auditResourceLabel(record.resource_type)}`;
}

function formatAuditTime(value?: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function auditActionLabel(action?: string) {
  const labels: Record<string, string> = {
    login_success: '登录成功',
    login_failed: '登录失败',
    logout: '退出登录',
    create: '创建',
    update: '更新',
    delete: '删除',
    approve: '审批',
    reject: '驳回',
    confirm: '确认',
    start: '发起',
    query: '查询',
    export: '导出',
    sync: '同步',
    upload: '上传',
    freeze: '冻结',
    disable: '停用',
    archive: '归档',
    draft_saved: '保存草稿',
  };
  return labels[action ?? ''] || action || '-';
}

function auditActionColor(action?: string) {
  if (!action) return 'default';
  if (/failed|delete|reject|disable/i.test(action)) return 'error';
  if (/approve|confirm|success/i.test(action)) return 'success';
  if (/create|start/i.test(action)) return 'processing';
  return 'warning';
}

function auditResourceLabel(resource?: string) {
  const labels: Record<string, string> = {
    auth: '登录认证',
    application: '应用',
    application_binding: '应用绑定',
    platform_menu_node: '菜单节点',
    platform_form: '表单',
    workflow: '流程',
    workflow_instance: '流程实例',
    report: '报表',
    role_permission: '角色权限',
    ontology_object: '本体对象',
    ontology_relation: '本体关系',
    graph: '图谱同步',
    ai_assistant: 'AI 助手',
    ai_settings: 'AI 设置',
    data_asset: '数据资产',
    knowledge_asset: '知识资产',
    knowledge: '知识查询',
    maintenance_order: '维修工单',
    material_batch: '物料批次',
    supplier: '供应商',
    user: '用户',
    org_unit: '组织',
    notification: '通知',
    audit: '审计归档',
  };
  return labels[resource ?? ''] || resource || '-';
}
