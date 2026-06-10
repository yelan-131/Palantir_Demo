import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ApiOutlined,
  AppstoreOutlined,
  AuditOutlined,  BellOutlined,
  DatabaseOutlined,
  DeleteOutlined,
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
import ReferenceDataManagement from '../SystemAdmin/ReferenceDataManagement';
import SemanticAssetCenter, { KnowledgeCenter } from '../SystemAdmin/SemanticAssetCenter';
import {
  adminListUsers,
  closeAgentConversation,
  deleteAIMemory,
  getClosedLoopConfig,
  getAISettings,
  listAgentConversations,
  listAIMemories,
  listAuditLogs,
  testSavedAISettings,
  updateAISettings,
} from '../../services/api';

cytoscape.use(dagre);

interface CurrentApplication {
  name?: string;
}

interface AccountCenterProps {
  currentApplication?: CurrentApplication | null;
}

const { Title, Text } = Typography;
const AI_SETTINGS_STORAGE_KEY = 'mf_ai_assistant_settings';
const GLM_AI_DEFAULTS = {
  provider: 'glm',
  baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
  chatModel: 'glm-5.1',
  reasoningModel: 'glm-5.1',
  embeddingModel: 'embedding-3',
  visionModel: 'glm-4v-plus',
};
const GLM_CODING_PLAN_DEFAULTS = {
  ...GLM_AI_DEFAULTS,
  baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
  chatModel: 'GLM-5.1',
  reasoningModel: 'GLM-5.1',
};
const DEEPSEEK_AI_DEFAULTS = {
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com',
  chatModel: 'deepseek-chat',
  reasoningModel: 'deepseek-reasoner',
};

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

function normalizeAISettings(settings: Record<string, any>) {
  const normalized = { ...settings };
  const provider = String(normalized.provider || '');
  if (!provider || provider === 'mock') {
    Object.assign(normalized, GLM_AI_DEFAULTS);
  }
  if (normalized.provider === 'glm') {
    if (!normalized.baseUrl || String(normalized.baseUrl).includes('api.openai.com')) normalized.baseUrl = GLM_AI_DEFAULTS.baseUrl;
    if (!normalized.chatModel || String(normalized.chatModel).startsWith('mock') || String(normalized.chatModel).startsWith('gpt-')) {
      normalized.chatModel = GLM_AI_DEFAULTS.chatModel;
    }
    if (!normalized.reasoningModel || String(normalized.reasoningModel).startsWith('mock') || String(normalized.reasoningModel).startsWith('gpt-')) {
      normalized.reasoningModel = GLM_AI_DEFAULTS.reasoningModel;
    }
    if (!normalized.embeddingModel || String(normalized.embeddingModel).startsWith('mock') || String(normalized.embeddingModel).startsWith('text-embedding')) {
      normalized.embeddingModel = GLM_AI_DEFAULTS.embeddingModel;
    }
    if (!normalized.visionModel || normalized.visionModel === 'disabled' || String(normalized.visionModel).startsWith('gpt-')) {
      normalized.visionModel = GLM_AI_DEFAULTS.visionModel;
    }
  }
  if (normalized.provider === 'deepseek') {
    if (!normalized.baseUrl || String(normalized.baseUrl).includes('bigmodel.cn') || String(normalized.baseUrl).includes('api.openai.com')) {
      normalized.baseUrl = DEEPSEEK_AI_DEFAULTS.baseUrl;
    }
    if (!normalized.chatModel || String(normalized.chatModel).startsWith('glm-') || String(normalized.chatModel).startsWith('GLM-') || String(normalized.chatModel).startsWith('gpt-')) {
      normalized.chatModel = DEEPSEEK_AI_DEFAULTS.chatModel;
    }
    if (!normalized.reasoningModel || String(normalized.reasoningModel).startsWith('glm-') || String(normalized.reasoningModel).startsWith('GLM-') || String(normalized.reasoningModel).startsWith('gpt-')) {
      normalized.reasoningModel = DEEPSEEK_AI_DEFAULTS.reasoningModel;
    }
  }
  return normalized;
}

export default function AccountCenter({ currentApplication }: AccountCenterProps) {
  const user = useAuthStore((s) => s.user);
  const [searchParams, setSearchParams] = useSearchParams();
  const activeSection = searchParams.get('section') || 'account';
  const identityDefaultTab = activeSection === 'tenants' ? 'tenants' : activeSection === 'roles' || activeSection === 'ai-role-policies' ? 'roles' : activeSection === 'orgs' ? 'orgs' : activeSection === 'users' ? 'users' : 'overview';
  const normalizedSection = ['tenants', 'users', 'roles', 'orgs', 'ai-role-policies'].includes(activeSection)
    ? 'identity-access'
    : activeSection === 'ai-personal' || activeSection === 'preferences'
      ? 'account'
    : activeSection === 'palantir-config' || activeSection === 'data-ontology'
      ? 'data-assets'
      : activeSection === 'knowledge-graph'
        ? 'knowledge'
      : activeSection;
  const roles = user?.roles?.length ? user.roles.map((role: any) => role.label || role.name).join(' / ') : '-';
  const roleLabel = user?.is_admin ? '系统管理员' : user?.roles?.[0]?.label || '业务用户';
  const accountDefaultSubTab = activeSection === 'preferences' ? 'preferences' : 'profile';

  const items = useMemo(() => {
    const baseItems = [
      {
        key: 'account',
        label: '账号中心',
        icon: <UserOutlined />,
        children: (
          <AccountProfilePanel
            user={user}
            roleLabel={roleLabel}
            roles={roles}
            currentApplication={currentApplication}
            defaultActiveKey={accountDefaultSubTab}
          />
        ),
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
        key: 'data-assets',
        label: '数据资产中心',
        icon: <DatabaseOutlined />,
        children: <SemanticAssetCenter view="data" />,
      },
      {
        key: 'reference-data',
        label: '数据字典与基础档案',
        icon: <DatabaseOutlined />,
        children: <ReferenceDataManagement />,
      },
      {
        key: 'ontology-modeling',
        label: '对象与关系中心',
        icon: <NodeIndexOutlined />,
        children: <SemanticAssetCenter view="ontology" />,
      },
      {
        key: 'knowledge',
        label: '知识库中心',
        icon: <FileSearchOutlined />,
        children: <KnowledgeCenter />,
      },
      {
        key: 'identity-access',
        label: '身份与权限',
        icon: <SafetyCertificateOutlined />,
        children: (
          <IdentityAccessManagement
            key={identityDefaultTab}
            defaultActiveKey={identityDefaultTab}
            onTabChange={(key) => setSearchParams({ section: key === 'overview' ? 'identity-access' : key })}
          />
        ),
      },
      {
        key: 'audit',
        label: '审计与日志',
        icon: <AuditOutlined />,
        children: <AuditPanel />,
      },
    ];
  }, [accountDefaultSubTab, currentApplication, identityDefaultTab, roleLabel, roles, setSearchParams, user]);

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
  defaultActiveKey,
}: {
  user: any;
  roleLabel: string;
  roles: string;
  currentApplication?: CurrentApplication | null;
  defaultActiveKey: string;
}) {
  const [activeSubTab, setActiveSubTab] = useState(defaultActiveKey);

  useEffect(() => {
    setActiveSubTab(defaultActiveKey);
  }, [defaultActiveKey]);

  return (
    <Tabs
      className="account-profile-subtabs"
      activeKey={activeSubTab}
      onChange={setActiveSubTab}
      items={[
        {
          key: 'profile',
          label: '身份与安全',
          icon: <UserOutlined />,
          children: (
            <AccountSecurityPanel
              user={user}
              roleLabel={roleLabel}
              roles={roles}
              currentApplication={currentApplication}
            />
          ),
        },
        {
          key: 'preferences',
          label: '工作偏好',
          icon: <SkinOutlined />,
          children: <PreferencePanel />,
        },
      ]}
    />
  );
}

function AccountSecurityPanel({
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
        <Form layout="vertical" autoComplete="off">
          <Form.Item label="当前密码" name="currentPassword">
            <Input.Password
              autoComplete="new-password"
              placeholder="请输入当前密码"
            />
          </Form.Item>
          <Form.Item label="新密码" name="newPassword">
            <Input.Password
              autoComplete="new-password"
              placeholder="请输入新密码"
            />
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

function PersonalAIPanel() {
  const [memories, setMemories] = useState<any[]>([]);
  const [conversations, setConversations] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const [memoryResponse, conversationResponse] = await Promise.all([
        listAIMemories({ include_candidates: true, limit: 50 }),
        listAgentConversations({ include_closed: true, limit: 50 }),
      ]);
      setMemories(memoryResponse.data?.data || []);
      setConversations(conversationResponse.data?.data || []);
    } catch {
      message.warning('AI 记忆或历史暂时不可用');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <div className="account-center-grid two-columns">
      <Card title="我的 AI 记忆" className="account-panel-card">
        <Table
          size="small"
          loading={loading}
          rowKey="memory_id"
          dataSource={memories}
          pagination={{ pageSize: 6 }}
          columns={[
            { title: '类型', dataIndex: 'memory_type', width: 110, render: (value) => <Tag>{value || 'summary'}</Tag> },
            { title: '摘要', dataIndex: 'summary', ellipsis: true },
            { title: '状态', dataIndex: 'status', width: 90 },
            {
              title: '操作',
              width: 82,
              render: (_, record: any) => (
                <Button
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={async () => {
                    await deleteAIMemory(record.memory_id);
                    message.success('AI 记忆已删除');
                    void refresh();
                  }}
                />
              ),
            },
          ]}
        />
      </Card>
      <Card title="我的 AI 历史窗口" className="account-panel-card">
        <Table
          size="small"
          loading={loading}
          rowKey="conversation_id"
          dataSource={conversations}
          pagination={{ pageSize: 6 }}
          columns={[
            { title: '标题', dataIndex: 'title', ellipsis: true },
            { title: '页面', dataIndex: 'page', width: 150, ellipsis: true },
            { title: '状态', dataIndex: 'status', width: 80 },
            {
              title: '操作',
              width: 82,
              render: (_, record: any) => (
                <Button
                  size="small"
                  danger
                  disabled={record.status === 'closed'}
                  onClick={async () => {
                    await closeAgentConversation(record.conversation_id);
                    message.success('AI 窗口已关闭');
                    void refresh();
                  }}
                >
                  关闭
                </Button>
              ),
            },
          ]}
        />
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
      return normalizeAISettings(JSON.parse(localStorage.getItem(AI_SETTINGS_STORAGE_KEY) || '{}'));
    } catch {
      return {};
    }
  }, []);

  const defaultSettings = useMemo(() => ({
    aiEnabled: true,
    ...GLM_AI_DEFAULTS,
    apiKey: '',
    organization: '',
    project: '',
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
    contextPolicy: { recentMessageLimit: 10, maxContextTokens: 12000, showContextSources: true },
    ragPolicy: { enabled: true, topK: 5, maxEvidenceChars: 1200, similarityThreshold: 0.15 },
    memoryPolicy: {
      enabled: false,
      recallLimit: 5,
      allowedTypes: ['summary', 'fact', 'preference', 'task_state', 'decision'],
      defaultVisibility: 'private',
      retentionDays: 90,
    },
    compactionPolicy: {
      enabled: true,
      triggerMessageCount: 20,
      triggerTokenCount: 12000,
      compactOnClose: true,
      summaryDetail: 'standard',
    },
    safetyPolicy: {
      sensitiveMasking: true,
      blockSecretMemory: true,
      highRiskConfirm: true,
      maxToolSteps: 5,
      toolTimeoutSeconds: 30,
    },
  }), []);

  useEffect(() => {
    let cancelled = false;

    const loadBackendSettings = async () => {
      try {
        const response = await getAISettings();
        const backendSettings = response.data?.settings || response.data?.data?.settings || response.data?.data;
        if (!cancelled && backendSettings && typeof backendSettings === 'object' && !Array.isArray(backendSettings)) {
          const mergedSettings = normalizeAISettings({ ...defaultSettings, ...savedSettings, ...backendSettings });
          form.setFieldsValue(mergedSettings);
          localStorage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(mergedSettings));
        }
      } catch {
        if (!cancelled) {
          form.setFieldsValue(normalizeAISettings({ ...defaultSettings, ...savedSettings }));
        }
      }
    };

    loadBackendSettings();

    return () => {
      cancelled = true;
    };
  }, [defaultSettings, form, savedSettings]);

  const saveLocalSettings = (values: Record<string, unknown>) => {
    localStorage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(normalizeAISettings(values)));
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
  const watchedSettings = Form.useWatch([], form) || {};
  const currentProvider = watchedSettings.provider || defaultSettings.provider;
  const currentChatModel = watchedSettings.chatModel || defaultSettings.chatModel;
  const currentReasoningModel = watchedSettings.reasoningModel || defaultSettings.reasoningModel;
  const currentEmbeddingModel = watchedSettings.embeddingModel || defaultSettings.embeddingModel;
  const activeDomains = watchedSettings.domains || defaultSettings.domains;
  const activeTools = watchedSettings.tools || defaultSettings.tools;
  const rolePolicies = watchedSettings.rolePolicies || defaultSettings.rolePolicies;

  const handleSave = () => {
    saveLocalSettings(form.getFieldsValue());
    message.success('AI 设置已保存到本地浏览器');
  };

  const applyProviderPreset = (provider: string) => {
    if (provider === 'glm') {
      const nextSettings = { ...form.getFieldsValue(), ...GLM_AI_DEFAULTS };
      form.setFieldsValue(nextSettings);
      saveLocalSettings(nextSettings);
      return;
    }
    if (provider === 'deepseek') {
      const nextSettings = normalizeAISettings({ ...form.getFieldsValue(), ...DEEPSEEK_AI_DEFAULTS });
      form.setFieldsValue(nextSettings);
      saveLocalSettings(nextSettings);
    }
  };

  const applyGlmPreset = (preset: 'api' | 'coding') => {
    const nextSettings = {
      ...form.getFieldsValue(),
      ...(preset === 'coding' ? GLM_CODING_PLAN_DEFAULTS : GLM_AI_DEFAULTS),
    };
    form.setFieldsValue(nextSettings);
    saveLocalSettings(nextSettings);
  };

  const handleSaveToBackend = async () => {
    const values = normalizeAISettings(form.getFieldsValue());
    form.setFieldsValue(values);
    saveLocalSettings(values);
    try {
      await updateAISettings(values);
      message.success('AI 设置已保存到数据库');
    } catch {
      message.warning('后端 AI 设置暂不可用，已先保存到本地浏览器');
    }
  };

  const handleTestConnection = async () => {
    const values = normalizeAISettings(form.getFieldsValue());
    form.setFieldsValue(values);
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
      <Form form={form} layout="vertical" initialValues={{ ...defaultSettings, ...savedSettings }} className="ai-platform-form">
        <div className="ai-platform-console">
          <div className="ai-platform-workbench">
            <aside className="ai-platform-side">
              <Card size="small" title="模型服务接入" className="account-panel-card ai-connection-card">
                <div className="ai-connection-section">
                  <div className="ai-connection-head">
                    <div>
                      <Text strong>服务链路</Text>
                      <Text type="secondary">{currentProvider}</Text>
                    </div>
                    <Form.Item name="aiEnabled" valuePropName="checked" noStyle><Switch /></Form.Item>
                  </div>
                  <Form.Item name="provider" label="模型服务商">
                    <Select options={[
                      { label: 'GLM', value: 'glm' },
                      { label: 'OpenAI Compatible', value: 'openai-compatible' },
                      { label: 'OpenAI', value: 'openai' },
                      { label: 'Azure OpenAI', value: 'azure-openai' },
                      { label: 'DeepSeek', value: 'deepseek' },
                      { label: 'Qwen', value: 'qwen' },
                      { label: 'Local Model', value: 'local' },
                    ]} onChange={applyProviderPreset} />
                  </Form.Item>
                </div>

                <div className="ai-connection-section">
                  <div className="ai-connection-section-head">
                    <Text strong>接入凭据</Text>
                    <Tag color="blue">托管密钥</Tag>
                  </div>
                  <Form.Item name="baseUrl" label="Base URL"><Input placeholder="https://open.bigmodel.cn/api/paas/v4" /></Form.Item>
                  <Form.Item name="apiKey" label="API Key"><Input.Password placeholder="由后端密钥库托管；可先为空" /></Form.Item>
                  <div className="ai-provider-presets">
                    <Button size="small" onClick={() => applyGlmPreset('api')}>GLM 普通 API</Button>
                    <Button size="small" onClick={() => applyGlmPreset('coding')}>GLM Coding Plan</Button>
                  </div>
                  <div className="ai-connection-field-grid">
                    <Form.Item name="organization" label="Organization"><Input placeholder="可选" /></Form.Item>
                    <Form.Item name="project" label="Project"><Input placeholder="可选" /></Form.Item>
                  </div>
                </div>

                <div className="ai-provider-summary">
                  <div>
                    <span>当前链路</span>
                    <strong>{currentProvider} / {currentChatModel}</strong>
                  </div>
                  <Text type="secondary">知识 Agent、页面助手、报表生成优先使用。</Text>
                </div>
              </Card>
            </aside>

            <main className="ai-platform-main">
              <Card size="small" className="account-panel-card ai-orchestration-card">
                <Tabs
                  items={[
                    {
                      key: 'models',
                      label: '模型编排',
                      children: (
                        <div className="ai-tab-grid">
                          <Form.Item name="chatModel" label="默认聊天模型">
                            <Select options={[
                              { label: 'glm-5.1', value: 'glm-5.1' },
                              { label: 'GLM-5.1 / Coding Plan', value: 'GLM-5.1' },
                              { label: 'GLM-4.7 / Coding Plan', value: 'GLM-4.7' },
                              { label: 'GLM-4.5-air / Coding Plan', value: 'GLM-4.5-air' },
                              { label: 'glm-4-flash', value: 'glm-4-flash' },
                              { label: 'glm-4-plus', value: 'glm-4-plus' },
                              { label: 'gpt-4o-mini', value: 'gpt-4o-mini' },
                              { label: 'gpt-4o', value: 'gpt-4o' },
                              { label: 'deepseek-chat', value: 'deepseek-chat' },
                              { label: 'qwen-plus', value: 'qwen-plus' },
                            ]} />
                          </Form.Item>
                          <Form.Item name="reasoningModel" label="推理 / Agent 模型">
                            <Select options={[
                              { label: 'glm-5.1', value: 'glm-5.1' },
                              { label: 'GLM-5.1 / Coding Plan', value: 'GLM-5.1' },
                              { label: 'GLM-4.7 / Coding Plan', value: 'GLM-4.7' },
                              { label: 'GLM-4.5-air / Coding Plan', value: 'GLM-4.5-air' },
                              { label: 'glm-4-plus', value: 'glm-4-plus' },
                              { label: 'glm-4v-plus', value: 'glm-4v-plus' },
                              { label: 'gpt-4o', value: 'gpt-4o' },
                              { label: 'deepseek-reasoner', value: 'deepseek-reasoner' },
                              { label: 'qwen-max', value: 'qwen-max' },
                            ]} />
                          </Form.Item>
                          <Form.Item name="embeddingModel" label="向量模型">
                            <Select options={[
                              { label: 'embedding-3', value: 'embedding-3' },
                              { label: 'bge-m3', value: 'bge-m3' },
                              { label: 'text-embedding-3-small', value: 'text-embedding-3-small' },
                              { label: 'text-embedding-3-large', value: 'text-embedding-3-large' },
                            ]} />
                          </Form.Item>
                          <Form.Item name="visionModel" label="视觉模型">
                            <Select options={[
                              { label: 'glm-4v-plus', value: 'glm-4v-plus' },
                              { label: 'gpt-4o', value: 'gpt-4o' },
                              { label: 'gpt-4o-mini', value: 'gpt-4o-mini' },
                              { label: '暂不启用', value: 'disabled' },
                            ]} />
                          </Form.Item>
                          <Form.Item name="temperature" label="回答风格">
                            <Radio.Group optionType="button" buttonStyle="solid">
                              <Radio.Button value="strict">严谨</Radio.Button>
                              <Radio.Button value="balanced">均衡</Radio.Button>
                              <Radio.Button value="creative">发散</Radio.Button>
                            </Radio.Group>
                          </Form.Item>
                          <Form.Item name="streaming" label="流式输出" valuePropName="checked"><Switch /></Form.Item>
                          <Row gutter={12}>
                            <Col span={8}><Form.Item name="maxTokens" label="Max Tokens"><Input type="number" min={256} max={16000} /></Form.Item></Col>
                            <Col span={8}><Form.Item name="timeoutSeconds" label="超时秒数"><Input type="number" min={5} max={180} /></Form.Item></Col>
                            <Col span={8}>
                              <Form.Item name="retryCount" label="失败重试">
                                <Select options={[{ label: '0 次', value: 0 }, { label: '1 次', value: 1 }, { label: '2 次', value: 2 }, { label: '3 次', value: 3 }]} />
                              </Form.Item>
                            </Col>
                          </Row>
                        </div>
                      ),
                    },
                    {
                      key: 'context',
                      label: '上下文预算',
                      children: (
                        <div className="ai-tab-grid">
                          <Row gutter={12}>
                            <Col span={8}><Form.Item name={['contextPolicy', 'recentMessageLimit']} label="最近消息条数"><Input type="number" min={2} max={50} /></Form.Item></Col>
                            <Col span={8}><Form.Item name={['contextPolicy', 'maxContextTokens']} label="最大上下文 Token"><Input type="number" min={1000} max={200000} /></Form.Item></Col>
                            <Col span={8}><Form.Item name={['contextPolicy', 'showContextSources']} label="显示上下文来源" valuePropName="checked"><Switch /></Form.Item></Col>
                          </Row>
                          <div className="ai-model-route">
                            <span>模型调用只读取最近消息、相关记忆和检索证据，完整 transcript 仅用于审计与回放。</span>
                          </div>
                        </div>
                      ),
                    },
                    {
                      key: 'memory',
                      label: '记忆与压缩',
                      children: (
                        <div className="ai-tab-grid">
                          <div className="ai-switch-panel">
                            <Form.Item name={['memoryPolicy', 'enabled']} label="启用长期记忆" valuePropName="checked"><Switch /></Form.Item>
                            <Form.Item name={['compactionPolicy', 'enabled']} label="启用会话压缩" valuePropName="checked"><Switch /></Form.Item>
                            <Form.Item name={['compactionPolicy', 'compactOnClose']} label="关闭窗口时压缩" valuePropName="checked"><Switch /></Form.Item>
                          </div>
                          <Row gutter={12}>
                            <Col span={8}><Form.Item name={['memoryPolicy', 'recallLimit']} label="记忆召回条数"><Input type="number" min={0} max={20} /></Form.Item></Col>
                            <Col span={8}><Form.Item name={['memoryPolicy', 'retentionDays']} label="记忆保留天数"><Input type="number" min={1} max={3650} /></Form.Item></Col>
                            <Col span={8}><Form.Item name={['memoryPolicy', 'defaultVisibility']} label="默认可见性"><Select options={[{ label: 'private', value: 'private' }, { label: 'team', value: 'team' }, { label: 'tenant', value: 'tenant' }]} /></Form.Item></Col>
                          </Row>
                          <Row gutter={12}>
                            <Col span={8}><Form.Item name={['compactionPolicy', 'triggerMessageCount']} label="压缩触发消息数"><Input type="number" min={2} max={200} /></Form.Item></Col>
                            <Col span={8}><Form.Item name={['compactionPolicy', 'triggerTokenCount']} label="压缩触发 Token"><Input type="number" min={1000} max={200000} /></Form.Item></Col>
                            <Col span={8}><Form.Item name={['compactionPolicy', 'summaryDetail']} label="摘要粒度"><Select options={[{ label: '简洁', value: 'compact' }, { label: '标准', value: 'standard' }, { label: '详细', value: 'detailed' }]} /></Form.Item></Col>
                          </Row>
                          <Form.Item name={['memoryPolicy', 'allowedTypes']} label="允许记忆类型">
                            <Select mode="multiple" options={[
                              { label: 'summary', value: 'summary' },
                              { label: 'fact', value: 'fact' },
                              { label: 'preference', value: 'preference' },
                              { label: 'task_state', value: 'task_state' },
                              { label: 'decision', value: 'decision' },
                            ]} />
                          </Form.Item>
                        </div>
                      ),
                    },
                    {
                      key: 'capabilities',
                      label: '能力与工具',
                      children: (
                        <div className="ai-tab-grid">
                          <div className="ai-switch-panel">
                            <Form.Item name="qaEnabled" label="问答型 AI" valuePropName="checked"><Switch /></Form.Item>
                            <Form.Item name="assistEnabled" label="辅助型 AI" valuePropName="checked"><Switch /></Form.Item>
                            <Form.Item name="proactiveEnabled" label="主动型 AI" valuePropName="checked"><Switch /></Form.Item>
                          </div>
                          <Form.Item name="agentMode" label="Agent 执行模式">
                            <Select options={[
                              { label: '关闭', value: 'off' },
                              { label: '只读查询', value: 'readonly' },
                              { label: '仅生成草稿', value: 'draft' },
                              { label: '确认后执行', value: 'confirm' },
                              { label: '自动执行', value: 'auto', disabled: true },
                            ]} />
                          </Form.Item>
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
                        </div>
                      ),
                    },
                    {
                      key: 'knowledge',
                      label: '知识 / RAG',
                      children: (
                        <div className="ai-tab-grid">
                          <Form.Item name="ragEnabled" label="启用知识库问答" valuePropName="checked"><Switch /></Form.Item>
                          <Row gutter={12}>
                            <Col span={8}><Form.Item name={['ragPolicy', 'enabled']} label="RAG 进入上下文" valuePropName="checked"><Switch /></Form.Item></Col>
                            <Col span={8}><Form.Item name={['ragPolicy', 'topK']} label="证据 Top K"><Input type="number" min={1} max={20} /></Form.Item></Col>
                            <Col span={8}><Form.Item name={['ragPolicy', 'maxEvidenceChars']} label="单条证据最大字符"><Input type="number" min={200} max={5000} /></Form.Item></Col>
                          </Row>
                          <Form.Item name={['ragPolicy', 'similarityThreshold']} label="相似度阈值"><Input /></Form.Item>
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
                            <Col span={12}><Form.Item name="topK" label="Top K"><Input type="number" min={1} max={20} /></Form.Item></Col>
                            <Col span={12}><Form.Item name="similarityThreshold" label="相似度阈值"><Input /></Form.Item></Col>
                          </Row>
                          <div className="ai-model-route">
                            <span>检索链路</span>
                            <strong>{currentEmbeddingModel}</strong>
                            <span>→</span>
                            <strong>{currentReasoningModel}</strong>
                          </div>
                        </div>
                      ),
                    },
                    {
                      key: 'roles',
                      label: '角色策略',
                      children: (
                        <div className="ai-role-policy-list">
                          {rolePolicies.map((policy: any) => (
                            <div className="ai-role-policy-row" key={policy.role}>
                              <div>
                                <strong>{aiRoleOptions.find((item) => item.value === policy.role)?.label || policy.role}</strong>
                                <Text type="secondary">{policy.agentMode}</Text>
                              </div>
                              <Space size={[4, 4]} wrap>
                                {(policy.capabilities || []).slice(0, 4).map((capability: string) => (
                                  <Tag key={capability}>{aiCapabilityOptions.find((item) => item.value === capability)?.label || capability}</Tag>
                                ))}
                              </Space>
                              <Switch checked={policy.enabled} disabled />
                            </div>
                          ))}
                        </div>
                      ),
                    },
                  ]}
                />
              </Card>
            </main>

            <aside className="ai-platform-side">
              <Card size="small" title="安全、审计与额度" className="account-panel-card ai-policy-card">
                <div className="ai-policy-section">
                  <div className="ai-policy-section-head">
                    <Text strong>安全护栏</Text>
                    <Tag color="blue">确认 / 脱敏 / 记忆</Tag>
                  </div>
                  <div className="ai-policy-toggle-list">
                    <div className="ai-policy-toggle-item">
                      <span>高风险动作二次确认</span>
                      <Form.Item name="highRiskConfirm" valuePropName="checked" noStyle><Switch /></Form.Item>
                    </div>
                    <div className="ai-policy-toggle-item">
                      <span>敏感字段脱敏</span>
                      <Form.Item name="sensitiveMasking" valuePropName="checked" noStyle><Switch /></Form.Item>
                    </div>
                    <div className="ai-policy-toggle-item">
                      <span>Agent 高风险确认</span>
                      <Form.Item name={['safetyPolicy', 'highRiskConfirm']} valuePropName="checked" noStyle><Switch /></Form.Item>
                    </div>
                    <div className="ai-policy-toggle-item">
                      <span>上下文敏感信息脱敏</span>
                      <Form.Item name={['safetyPolicy', 'sensitiveMasking']} valuePropName="checked" noStyle><Switch /></Form.Item>
                    </div>
                    <div className="ai-policy-toggle-item">
                      <span>禁止密钥写入记忆</span>
                      <Form.Item name={['safetyPolicy', 'blockSecretMemory']} valuePropName="checked" noStyle><Switch /></Form.Item>
                    </div>
                  </div>
                  <div className="ai-policy-field-grid">
                    <Form.Item name={['safetyPolicy', 'maxToolSteps']} label="最大工具步数"><Input type="number" min={1} max={20} /></Form.Item>
                    <Form.Item name={['safetyPolicy', 'toolTimeoutSeconds']} label="工具超时秒数"><Input type="number" min={5} max={180} /></Form.Item>
                  </div>
                  <Form.Item name="forbiddenActions" label="禁止动作清单" className="ai-policy-compact-item">
                    <Select mode="multiple" options={[
                      { label: '自动下单', value: 'auto_order' },
                      { label: '删除数据', value: 'delete_data' },
                      { label: '修改权限', value: 'change_permission' },
                      { label: '发布配置', value: 'publish_config' },
                    ]} />
                  </Form.Item>
                </div>

                <div className="ai-policy-section">
                  <div className="ai-policy-section-head">
                    <Text strong>审计与额度</Text>
                    <Tag color="green">日志 / 配额</Tag>
                  </div>
                  <div className="ai-policy-toggle-list compact">
                    <div className="ai-policy-toggle-item">
                      <span>保存对话日志</span>
                      <Form.Item name="auditEnabled" valuePropName="checked" noStyle><Switch /></Form.Item>
                    </div>
                    <div className="ai-policy-toggle-item">
                      <span>记录工具调用</span>
                      <Form.Item name="recordToolCalls" valuePropName="checked" noStyle><Switch /></Form.Item>
                    </div>
                  </div>
                  <Form.Item name="retentionDays" label="历史保留天数" className="ai-policy-compact-item">
                    <Select options={[{ label: '30 天', value: 30 }, { label: '90 天', value: 90 }, { label: '180 天', value: 180 }, { label: '365 天', value: 365 }]} />
                  </Form.Item>
                  <div className="ai-policy-field-grid">
                    <Form.Item name="dailyLimit" label="平台日额度"><Input type="number" min={1} /></Form.Item>
                    <Form.Item name="userDailyLimit" label="用户日额度"><Input type="number" min={1} /></Form.Item>
                  </div>
                </div>

                <div className="ai-scope-preview">
                  <div className="ai-scope-row">
                    <Text type="secondary">开放范围</Text>
                    <Space size={[4, 4]} wrap>{activeDomains.map((domain: string) => <Tag key={domain}>{aiDomainOptions.find((item) => item.value === domain)?.label || domain}</Tag>)}</Space>
                  </div>
                  <div className="ai-scope-row">
                    <Text type="secondary">可调用工具</Text>
                    <Space size={[4, 4]} wrap>{activeTools.map((tool: string) => <Tag color="blue" key={tool}>{tool}</Tag>)}</Space>
                  </div>
                </div>

                <div className="ai-platform-actions">
                  <Button icon={<ApiOutlined />} onClick={handleTestConnection}>测试后端 AI</Button>
                  <Button icon={<ApiOutlined />} onClick={() => message.success('本地连通性检查通过')}>本地检查</Button>
                  <Button type="primary" icon={<RobotOutlined />} onClick={handleSaveToBackend}>保存 AI 设置</Button>
                </div>
              </Card>
            </aside>
          </div>
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

const CLOSED_LOOP_TEXT = {
  all: '\u5168\u90e8',
  dataRelationView: '\u6570\u636e\u5173\u7cfb\u89c6\u56fe',
  hierarchyView: '\u5c42\u7ea7\u89c6\u56fe',
  permissionView: '\u6743\u9650\u89c6\u56fe',
  actionFlowView: '\u52a8\u4f5c\u6d41\u89c6\u56fe',
  loadFailed: '\u95ed\u73af\u914d\u7f6e\u6570\u636e\u52a0\u8f7d\u5931\u8d25',
  centerTitle: '\u95ed\u73af\u914d\u7f6e\u4e2d\u5fc3',
  centerDescription: '\u524d\u7aef\u4ec5\u6e32\u67d3\u540e\u7aef\u4ece\u6570\u636e\u5e93\u6574\u7406\u51fa\u7684\u5bf9\u8c61\u3001\u5173\u7cfb\u548c\u6cbb\u7406\u7b56\u7565\u3002',
  refresh: '\u5237\u65b0',
  fitCanvas: '\u9002\u914d\u753b\u5e03',
  businessObjects: '\u4e1a\u52a1\u5bf9\u8c61',
  frontendRelations: '\u524d\u7aef\u5173\u7cfb',
  actionEntries: '\u52a8\u4f5c\u5165\u53e3',
  roleCoverage: '\u89d2\u8272\u8986\u76d6',
  highRiskItems: '\u9ad8\u98ce\u9669\u9879',
  policies: '\u6cbb\u7406\u7b56\u7565',
  dbObjects: '\u6570\u636e\u5e93\u5bf9\u8c61',
  noObjects: '\u6570\u636e\u5e93\u6682\u65e0\u95ed\u73af\u5bf9\u8c61',
  readingDb: '\u6b63\u5728\u8bfb\u53d6\u6570\u636e\u5e93...',
  noFilteredData: '\u5f53\u524d\u7b5b\u9009\u6761\u4ef6\u4e0b\u6682\u65e0\u6570\u636e',
  relationDetail: '\u5173\u7cfb\u8be6\u60c5',
  objectDetail: '\u5bf9\u8c61\u8be6\u60c5',
  chooseOne: '\u8bf7\u9009\u62e9\u4e00\u4e2a\u5bf9\u8c61\u6216\u5173\u7cfb',
  governanceView: '\u6cbb\u7406\u89c6\u56fe',
  relations: '\u5173\u7cfb',
  frontendVisible: '\u524d\u7aef\u53ef\u89c1',
  domain: '\u4e1a\u52a1\u57df',
  module: '\u627f\u8f7d\u6a21\u5757',
  visibleRoles: '\u53ef\u89c1\u89d2\u8272',
  keyFields: '\u5173\u952e\u5b57\u6bb5',
  noFields: '\u65e0\u5b57\u6bb5',
  actions: '\u5173\u8054\u52a8\u4f5c',
  noActions: '\u65e0\u52a8\u4f5c',
  sourceObject: '\u6e90\u5bf9\u8c61',
  targetObject: '\u76ee\u6807\u5bf9\u8c61',
  condition: '\u89e6\u53d1\u6761\u4ef6',
  evidence: '\u8bc1\u636e',
  yes: '\u662f',
  backendOnly: '\u4ec5\u540e\u7aef\u6cbb\u7406',
  noRelations: '\u6570\u636e\u5e93\u6682\u65e0\u5173\u7cfb\u6570\u636e',
  relation: '\u5173\u7cfb',
  type: '\u7c7b\u578b',
  risk: '\u98ce\u9669',
  publish: '\u53d1\u5e03',
  frontendGraph: '\u524d\u7aef\u56fe\u8c31',
  visible: '\u53ef\u89c1',
  backstage: '\u540e\u53f0',
  noPolicies: '\u6570\u636e\u5e93\u6682\u65e0\u6cbb\u7406\u7b56\u7565',
  policy: '\u7b56\u7565',
  scope: '\u8303\u56f4',
  guard: '\u7ea6\u675f',
  coverage: '\u8986\u76d6\u7387',
};

const ALL_OPTION = CLOSED_LOOP_TEXT.all;
const riskOptions = [ALL_OPTION, 'low', 'medium', 'high', 'critical'];
const statusOptions = [ALL_OPTION, 'published', 'review', 'draft'];

const closedLoopTypeColors: Record<string, string> = {
  Form: '#1677ff',
  Application: '#2f5f73',
  RolePolicy: '#7353ba',
  KnowledgeObject: '#2f7d5b',
  default: '#8c8c8c',
};

const riskColor: Record<string, string> = {
  low: 'green',
  medium: 'gold',
  high: 'volcano',
  critical: 'red',
};

type ClosedLoopPolicy = { key: string; policy: string; scope: string; guard: string; coverage: number };

type ClosedLoopSelection = { kind: 'node'; data: ClosedLoopNode } | { kind: 'edge'; data: ClosedLoopEdge } | null;

function uniqueOptions(values: Array<string | undefined>) {
  return [ALL_OPTION, ...Array.from(new Set(values.filter((value): value is string => Boolean(value))))];
}

function ClosedLoopConfigCenter() {
  const [nodes, setNodes] = useState<ClosedLoopNode[]>([]);
  const [edges, setEdges] = useState<ClosedLoopEdge[]>([]);
  const [policies, setPolicies] = useState<ClosedLoopPolicy[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedDomain, setSelectedDomain] = useState(ALL_OPTION);
  const [selectedRole, setSelectedRole] = useState(ALL_OPTION);
  const [selectedRisk, setSelectedRisk] = useState(ALL_OPTION);
  const [selectedStatus, setSelectedStatus] = useState(ALL_OPTION);
  const [layoutMode, setLayoutMode] = useState(CLOSED_LOOP_TEXT.dataRelationView);
  const [selected, setSelected] = useState<ClosedLoopSelection>(null);
  const cyContainerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);

  const loadClosedLoopConfig = async () => {
    setLoading(true);
    try {
      const response = await getClosedLoopConfig();
      const payload = response.data?.data ?? {};
      const nextNodes = Array.isArray(payload.nodes) ? payload.nodes as ClosedLoopNode[] : [];
      const nextEdges = Array.isArray(payload.edges) ? payload.edges as ClosedLoopEdge[] : [];
      const nextPolicies = Array.isArray(payload.policies) ? payload.policies as ClosedLoopPolicy[] : [];
      setNodes(nextNodes);
      setEdges(nextEdges);
      setPolicies(nextPolicies);
      setSelected((prev) => {
        if (prev?.kind === 'node' && nextNodes.some((node) => node.id === prev.data.id)) return prev;
        if (prev?.kind === 'edge' && nextEdges.some((edge) => edge.id === prev.data.id)) return prev;
        return nextNodes[0] ? { kind: 'node', data: nextNodes[0] } : null;
      });
    } catch (error: any) {
      setNodes([]);
      setEdges([]);
      setPolicies([]);
      setSelected(null);
      message.warning(error?.response?.data?.detail ?? CLOSED_LOOP_TEXT.loadFailed);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadClosedLoopConfig();
  }, []);

  const domainOptions = useMemo(() => uniqueOptions(nodes.map((node) => node.domain)), [nodes]);
  const roleOptions = useMemo(() => uniqueOptions(nodes.flatMap((node) => node.roles || [])), [nodes]);
  const filteredNodes = useMemo(() => nodes.filter((node) => {
    const domainMatched = selectedDomain === ALL_OPTION || node.domain === selectedDomain;
    const roleMatched = selectedRole === ALL_OPTION || (node.roles || []).includes(selectedRole);
    const riskMatched = selectedRisk === ALL_OPTION || node.riskLevel === selectedRisk;
    const statusMatched = selectedStatus === ALL_OPTION || node.status === selectedStatus;
    return domainMatched && roleMatched && riskMatched && statusMatched;
  }), [nodes, selectedDomain, selectedRisk, selectedRole, selectedStatus]);

  const filteredNodeIds = useMemo(() => new Set(filteredNodes.map((node) => node.id)), [filteredNodes]);
  const filteredEdges = useMemo(() => edges.filter((edge) => filteredNodeIds.has(edge.source) && filteredNodeIds.has(edge.target)), [edges, filteredNodeIds]);

  useEffect(() => {
    if (!cyContainerRef.current) return;

    const elements: cytoscape.ElementDefinition[] = [
      ...filteredNodes.map((node) => ({
        group: 'nodes' as const,
        data: {
          id: node.id,
          label: node.name,
          shortLabel: node.type,
          color: closedLoopTypeColors[node.type] || closedLoopTypeColors.default,
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
        { selector: 'node', style: { 'background-color': 'data(color)', label: 'data(label)', color: '#172026', 'font-size': 11, 'font-weight': 700, 'text-valign': 'bottom', 'text-halign': 'center', 'text-margin-y': 8, 'text-wrap': 'wrap', 'text-max-width': '112px', width: 58, height: 58, 'border-width': 4, 'border-color': '#fff', 'overlay-opacity': 0 } },
        { selector: 'node:selected', style: { 'border-color': '#172026', 'border-width': 5 } },
        { selector: 'edge', style: { width: 2, 'line-color': '#b9c5ce', 'target-arrow-color': '#b9c5ce', 'target-arrow-shape': 'triangle', 'curve-style': 'bezier', label: 'data(label)', 'font-size': 10, color: '#52616b', 'text-background-color': '#fff', 'text-background-opacity': 0.9, 'text-background-padding': '3px', 'text-rotation': 'autorotate' } },
        { selector: 'edge:selected', style: { width: 4, 'line-color': '#2f5f73', 'target-arrow-color': '#2f5f73' } },
      ] as any,
      layout: getClosedLoopLayout(layoutMode),
      minZoom: 0.35,
      maxZoom: 2.2,
      wheelSensitivity: 0.25,
    });

    cy.on('tap', 'node', (event) => {
      const node = nodes.find((item) => item.id === event.target.id());
      if (node) setSelected({ kind: 'node', data: node });
    });

    cy.on('tap', 'edge', (event) => {
      const edge = edges.find((item) => item.id === event.target.id());
      if (edge) setSelected({ kind: 'edge', data: edge });
    });

    cyRef.current = cy;
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [edges, filteredEdges, filteredNodes, layoutMode, nodes]);

  const metrics = [
    { label: CLOSED_LOOP_TEXT.businessObjects, value: nodes.filter((node) => !['RolePolicy'].includes(node.type)).length },
    { label: CLOSED_LOOP_TEXT.frontendRelations, value: edges.filter((edge) => edge.frontendVisible).length },
    { label: CLOSED_LOOP_TEXT.actionEntries, value: nodes.reduce((sum, node) => sum + (node.actions || []).length, 0) },
    { label: CLOSED_LOOP_TEXT.roleCoverage, value: new Set(nodes.flatMap((node) => node.roles || [])).size },
    { label: CLOSED_LOOP_TEXT.highRiskItems, value: edges.filter((edge) => ['high', 'critical'].includes(edge.riskLevel)).length },
    { label: CLOSED_LOOP_TEXT.policies, value: policies.length },
  ];

  return (
    <div className="closed-loop-config-center">
      <section className="closed-loop-hero">
        <div>
          <Typography.Text className="closed-loop-kicker">Database-backed operations ontology</Typography.Text>
          <Typography.Title level={4}>{CLOSED_LOOP_TEXT.centerTitle}</Typography.Title>
          <Typography.Text type="secondary">{CLOSED_LOOP_TEXT.centerDescription}</Typography.Text>
        </div>
        <Space wrap>
          <Button onClick={loadClosedLoopConfig} loading={loading}>{CLOSED_LOOP_TEXT.refresh}</Button>
          <Button icon={<NodeIndexOutlined />} onClick={() => cyRef.current?.fit(undefined, 32)}>{CLOSED_LOOP_TEXT.fitCanvas}</Button>
        </Space>
      </section>

      <Row gutter={[12, 12]} className="closed-loop-metrics">
        {metrics.map((metric) => (
          <Col xs={12} md={8} xl={4} key={metric.label}>
            <Card size="small" loading={loading}>
              <Typography.Text type="secondary">{metric.label}</Typography.Text>
              <Typography.Title level={3}>{metric.value}</Typography.Title>
            </Card>
          </Col>
        ))}
      </Row>

      <div className="closed-loop-workbench">
        <aside className="closed-loop-left">
          <Typography.Text strong>{CLOSED_LOOP_TEXT.dbObjects}</Typography.Text>
          {nodes.length ? nodes.map((node) => (
            <button className="closed-loop-domain-item" key={node.id} type="button" onClick={() => setSelected({ kind: 'node', data: node })}>
              <span>{node.name}</span>
              <small>{node.type} / {node.module}</small>
            </button>
          )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={CLOSED_LOOP_TEXT.noObjects} />}
        </aside>

        <main className="closed-loop-canvas-panel">
          <div className="closed-loop-toolbar">
            <Space wrap>
              <Select value={selectedDomain} options={domainOptions.map((value) => ({ value, label: value }))} onChange={setSelectedDomain} style={{ width: 130 }} />
              <Select value={selectedRole} options={roleOptions.map((value) => ({ value, label: value }))} onChange={setSelectedRole} style={{ width: 150 }} />
              <Select value={selectedRisk} options={riskOptions.map((value) => ({ value, label: value }))} onChange={setSelectedRisk} style={{ width: 130 }} />
              <Select value={selectedStatus} options={statusOptions.map((value) => ({ value, label: value }))} onChange={setSelectedStatus} style={{ width: 140 }} />
            </Space>
            <Segmented value={layoutMode} onChange={(value) => setLayoutMode(String(value))} options={[CLOSED_LOOP_TEXT.dataRelationView, CLOSED_LOOP_TEXT.hierarchyView, CLOSED_LOOP_TEXT.permissionView, CLOSED_LOOP_TEXT.actionFlowView]} />
          </div>
          <div className="closed-loop-canvas" ref={cyContainerRef}>
            {!filteredNodes.length && <Empty description={loading ? CLOSED_LOOP_TEXT.readingDb : CLOSED_LOOP_TEXT.noFilteredData} />}
          </div>
        </main>

        <aside className="closed-loop-right">
          <Typography.Text strong>{selected?.kind === 'edge' ? CLOSED_LOOP_TEXT.relationDetail : CLOSED_LOOP_TEXT.objectDetail}</Typography.Text>
          <Divider />
          {selected?.kind === 'node'
            ? <ClosedLoopNodeDetail node={selected.data} />
            : selected?.kind === 'edge'
              ? <ClosedLoopEdgeDetail edge={selected.data} nodes={nodes} />
              : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={CLOSED_LOOP_TEXT.chooseOne} />}
        </aside>
      </div>

      <Card className="closed-loop-governance" title={CLOSED_LOOP_TEXT.governanceView} loading={loading}>
        <Tabs
          items={[
            { key: 'relations', label: CLOSED_LOOP_TEXT.relations, children: <ClosedLoopEdgeTable data={edges} /> },
            { key: 'frontend', label: CLOSED_LOOP_TEXT.frontendVisible, children: <ClosedLoopEdgeTable data={edges.filter((edge) => edge.frontendVisible)} /> },
            { key: 'policy', label: CLOSED_LOOP_TEXT.policies, children: <ClosedLoopPolicyTable policies={policies} /> },
          ]}
        />
      </Card>
    </div>
  );
}

function getClosedLoopLayout(layoutMode: string): cytoscape.LayoutOptions {
  if (layoutMode === CLOSED_LOOP_TEXT.dataRelationView) return { name: 'dagre', rankDir: 'LR', spacingFactor: 1.15, fit: true, padding: 36 } as cytoscape.LayoutOptions;
  if (layoutMode === CLOSED_LOOP_TEXT.permissionView) return { name: 'concentric', fit: true, padding: 42, minNodeSpacing: 42 } as cytoscape.LayoutOptions;
  if (layoutMode === CLOSED_LOOP_TEXT.actionFlowView) return { name: 'breadthfirst', directed: true, fit: true, padding: 42, spacingFactor: 1.1 } as cytoscape.LayoutOptions;
  return { name: 'dagre', rankDir: 'TB', spacingFactor: 1.08, fit: true, padding: 36 } as cytoscape.LayoutOptions;
}

function ClosedLoopNodeDetail({ node }: { node: ClosedLoopNode }) {
  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Space wrap>
        <Tag color="blue">{node.type}</Tag>
        <Tag color={riskColor[node.riskLevel] || 'default'}>{node.riskLevel}</Tag>
        <Tag color={node.status === 'published' ? 'green' : 'gold'}>{node.status}</Tag>
      </Space>
      <Typography.Title level={5}>{node.name}</Typography.Title>
      <Typography.Paragraph type="secondary">{node.description}</Typography.Paragraph>
      <Descriptions size="small" column={1} bordered>
        <Descriptions.Item label={CLOSED_LOOP_TEXT.domain}>{node.domain}</Descriptions.Item>
        <Descriptions.Item label={CLOSED_LOOP_TEXT.module}>{node.module}</Descriptions.Item>
        <Descriptions.Item label={CLOSED_LOOP_TEXT.visibleRoles}>{node.roles.join(' / ') || '-'}</Descriptions.Item>
      </Descriptions>
      <div>
        <Typography.Text type="secondary">{CLOSED_LOOP_TEXT.keyFields}</Typography.Text>
        <div className="closed-loop-tag-cloud">{node.fields.length ? node.fields.map((field) => <Tag key={field}>{field}</Tag>) : <Tag>{CLOSED_LOOP_TEXT.noFields}</Tag>}</div>
      </div>
      <div>
        <Typography.Text type="secondary">{CLOSED_LOOP_TEXT.actions}</Typography.Text>
        <div className="closed-loop-tag-cloud">{node.actions.length ? node.actions.map((action) => <Tag color="processing" key={action}>{action}</Tag>) : <Tag>{CLOSED_LOOP_TEXT.noActions}</Tag>}</div>
      </div>
    </Space>
  );
}

function ClosedLoopEdgeDetail({ edge, nodes }: { edge: ClosedLoopEdge; nodes: ClosedLoopNode[] }) {
  const source = nodes.find((node) => node.id === edge.source);
  const target = nodes.find((node) => node.id === edge.target);

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Space wrap>
        <Tag color="purple">{edge.type}</Tag>
        <Tag color={riskColor[edge.riskLevel] || 'default'}>{edge.riskLevel}</Tag>
        <Tag color={edge.status === 'published' ? 'green' : 'gold'}>{edge.status}</Tag>
      </Space>
      <Typography.Title level={5}>{edge.label}</Typography.Title>
      <Descriptions size="small" column={1} bordered>
        <Descriptions.Item label={CLOSED_LOOP_TEXT.sourceObject}>{source?.name ?? edge.source}</Descriptions.Item>
        <Descriptions.Item label={CLOSED_LOOP_TEXT.targetObject}>{target?.name ?? edge.target}</Descriptions.Item>
        <Descriptions.Item label={CLOSED_LOOP_TEXT.condition}>{edge.condition}</Descriptions.Item>
        <Descriptions.Item label={CLOSED_LOOP_TEXT.evidence}>{edge.evidence}</Descriptions.Item>
        <Descriptions.Item label={CLOSED_LOOP_TEXT.frontendVisible}>{edge.frontendVisible ? CLOSED_LOOP_TEXT.yes : CLOSED_LOOP_TEXT.backendOnly}</Descriptions.Item>
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
      locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={CLOSED_LOOP_TEXT.noRelations} /> }}
      columns={[
        { title: CLOSED_LOOP_TEXT.relation, dataIndex: 'label', width: 130 },
        { title: CLOSED_LOOP_TEXT.type, dataIndex: 'type', width: 130, render: (value) => <Tag color="purple">{value}</Tag> },
        { title: CLOSED_LOOP_TEXT.condition, dataIndex: 'condition', ellipsis: true },
        { title: CLOSED_LOOP_TEXT.risk, dataIndex: 'riskLevel', width: 100, render: (value) => <Tag color={riskColor[value] || 'default'}>{value}</Tag> },
        { title: CLOSED_LOOP_TEXT.publish, dataIndex: 'status', width: 100, render: (value) => <Tag color={value === 'published' ? 'green' : 'gold'}>{value}</Tag> },
        { title: CLOSED_LOOP_TEXT.frontendGraph, dataIndex: 'frontendVisible', width: 110, render: (value) => <Tag color={value ? 'success' : 'default'}>{value ? CLOSED_LOOP_TEXT.visible : CLOSED_LOOP_TEXT.backstage}</Tag> },
      ]}
    />
  );
}

function ClosedLoopPolicyTable({ policies }: { policies: ClosedLoopPolicy[] }) {
  return (
    <Table
      size="small"
      rowKey="key"
      dataSource={policies}
      pagination={false}
      locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={CLOSED_LOOP_TEXT.noPolicies} /> }}
      columns={[
        { title: CLOSED_LOOP_TEXT.policy, dataIndex: 'policy', width: 170 },
        { title: CLOSED_LOOP_TEXT.scope, dataIndex: 'scope', ellipsis: true },
        { title: CLOSED_LOOP_TEXT.guard, dataIndex: 'guard', ellipsis: true },
        { title: CLOSED_LOOP_TEXT.coverage, dataIndex: 'coverage', width: 150, render: (value) => <Progress size="small" percent={value} /> },
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
              { label: '创建组织', value: 'create_org_unit' },
              { label: '更新', value: 'update' },
              { label: '更新组织', value: 'update_org_unit' },
              { label: '删除', value: 'delete' },
              { label: '删除组织', value: 'delete_org_unit' },
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
    create_org_unit: '创建组织',
    update: '更新',
    update_org_unit: '更新组织',
    delete: '删除',
    delete_org_unit: '删除组织',
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

