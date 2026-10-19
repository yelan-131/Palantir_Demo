import EffectiveHarnessPreview from './EffectiveHarnessPreview';
import useAISettingsNotification from './useAISettingsNotification';
import SettingsTabs from '@/components/SettingsTabs';
import { useSearchParams } from 'react-router-dom';
import { ServiceCatalogPanel, PurposeModelsPanel, NativeCompactionPanel, AIStatusSummary, type TestTarget } from './AIConfigurationPanels';
import { useEffect, useMemo, useRef, useState } from 'react';
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
  UserOutlined,
} from '@ant-design/icons';
import {
  Alert,
  AutoComplete,
  Avatar,
  Button,
  Card,
  Descriptions,
  Divider,
  Empty,
  Form,
  Input,
  Modal,
  Progress,
  Radio,
  Row,
  Segmented,
  Select,
  Space,
  Switch,
  Tag,
  Table,
  Tabs,
  Typography,
  Col,
  Collapse,
  message,
} from 'antd';
import cytoscape from 'cytoscape';
import dagre from 'cytoscape-dagre';
import { useAuthStore } from '../../stores/authStore';
import WorkspacePreferences from './WorkspacePreferences';
import { useShellPreferences } from '../../hooks/useShellPreferences';
import {
  adminListUsers,
  closeAgentConversation,
  deleteAIMemory,
  getAIAgentRegistry,
  getClosedLoopConfig,
  getAISettings,
  previewAISettings,
  listAgentConversations,
  listAIMemories,
  listAuditLogs,
  seedAIAgentRegistry,
  testSavedAISettings,
  updateAIAgentRegistry,
  updateAISettings,
} from '../../services/api';
import { formatServerDateTime } from '../../utils/dateTime';
import './ai-settings.css';
import AISettingsWorkspace from './AISettingsWorkspace';

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

function normalizeAISettings(settings: Record<string, any>): Record<string, any> {
  // Presets fill a draft explicitly. Saving never rewrites a custom model ID
  // or a user-provided gateway URL based on its spelling.
  return { ...settings, provider: settings.provider || 'glm' };
}

function normalizeLocalAISettings(settings: Record<string, any>) {
  const localSettings = normalizeAISettings(settings);
  delete localSettings.apiKey;
  delete localSettings.api_key;
  delete localSettings.modelServices;
  delete localSettings.modelAssignments;
  return localSettings;
}

function readLocalAISettings() {
  const rawSettings = localStorage.getItem(AI_SETTINGS_STORAGE_KEY);
  if (!rawSettings) return {};

  try {
    const parsedSettings = JSON.parse(rawSettings);
    const settings = parsedSettings && typeof parsedSettings === 'object' && !Array.isArray(parsedSettings)
      ? parsedSettings
      : {};
    const localSettings = normalizeLocalAISettings(settings);
    if (Object.prototype.hasOwnProperty.call(settings, 'apiKey')) {
      localStorage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(localSettings));
    }
    return localSettings;
  } catch {
    return {};
  }
}

function saveLocalAISettings(settings: Record<string, unknown>) {
  localStorage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(normalizeLocalAISettings(settings)));
}

export default function AccountCenter({ currentApplication }: AccountCenterProps) {
  const user = useAuthStore((s) => s.user);
  const [accountParams, setAccountParams] = useSearchParams();
  const accountTab = accountParams.get('tab') === 'preferences' || (!accountParams.has('tab') && accountParams.get('section') === 'preferences') ? 'preferences' : 'account';
  const roles = user?.roles?.length ? user.roles.map((role: any) => role.label || role.name).join(' / ') : '-';
  const roleLabel = user?.is_admin ? '系统管理员' : user?.roles?.[0]?.label || '业务用户';

  return (
    <div className="account-center-page account-preferences-active account-settings-unified">
      <div className="account-center-head">
        <Space size={16} align="center">
          <Avatar size={32} icon={<UserOutlined />} style={{ backgroundColor: 'var(--mf-primary)' }} />
          <div>
            <Title level={3}>{user?.display_name || '系统管理员'}</Title>
            <Text type="secondary">{user?.email || user?.username || 'admin@manufoundry.local'}</Text>
          </div>
        </Space>
        <Tag color={user?.is_admin ? 'gold' : 'blue'}>{roleLabel}</Tag>
      </div>

      <div className="account-center-tabs">
        <SettingsTabs
          className="account-settings-tabs"
          key={`${user?.tenant_id ?? 'default'}:${user?.id ?? 'anonymous'}`}
          activeKey={accountTab}
          onChange={tab => { const next = new URLSearchParams(accountParams); next.delete('section'); next.set('tab', tab); setAccountParams(next); }}
          items={[
            { key: 'account', label: '身份与安全', forceRender: true, children: <AccountSecurityPanel user={user} roleLabel={roleLabel} roles={roles} currentApplication={currentApplication} /> },
            { key: 'preferences', label: '工作偏好', forceRender: true, children: <WorkspacePreferences /> },
          ]}
        />
      </div>
    </div>
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
    <section className="account-security-workspace" aria-label="身份与安全">
      <div className="account-security-scroll">
        <header className="account-security-page-heading">
          <Title level={2}>身份与安全</Title>
          <Text type="secondary">查看账号资料，管理登录密码与提醒偏好。</Text>
        </header>
        <div className="account-security-layout">
          <section className="account-security-card account-identity-card" aria-label="账号信息">
            <header className="account-security-card-heading"><span className="account-security-section-icon"><UserOutlined /></span><div><Title level={3}>账号信息</Title><Text type="secondary">当前账号的身份与使用范围</Text></div><Tag>只读资料</Tag></header>
            <div className="account-identity-overview"><span>登录账号</span><strong>{user?.username || '-'}</strong><Text type="secondary">{user?.email || '未设置邮箱'}</Text></div>
            <dl className="account-identity-details">
              <div><dt>账号</dt><dd>{user?.username || '-'}</dd></div>
              <div><dt>邮箱</dt><dd>{user?.email || '-'}</dd></div>
              <div><dt>账号类型</dt><dd>{roleLabel}</dd></div>
              <div><dt>角色</dt><dd>{roles}</dd></div>
              <div><dt>当前应用</dt><dd>{currentApplication?.name || '-'}</dd></div>
            </dl>
          </section>
          <section className="account-security-card account-login-card" aria-label="安全设置">
            <header className="account-security-card-heading"><span className="account-security-section-icon"><KeyOutlined /></span><div><Title level={3}>安全设置</Title><Text type="secondary">登录密码与账号提醒</Text></div></header>
            <Form layout="vertical" autoComplete="off" className="account-security-form">
              <div className="account-security-form-fields">
                <Form.Item label="当前密码" name="currentPassword"><Input.Password autoComplete="new-password" placeholder="请输入当前密码" /></Form.Item>
                <Form.Item label="新密码" name="newPassword"><Input.Password autoComplete="new-password" placeholder="请输入新密码" /></Form.Item>
                <div className="account-security-protection"><div><strong>登录保护</strong><p>异地登录提醒</p></div><Form.Item label="异地登录提醒" className="account-security-protection-switch" valuePropName="checked"><Switch aria-label="异地登录提醒" defaultChecked /></Form.Item></div>
              </div>
              <footer className="account-security-actions"><p>密码修改与登录保护尚未接入账号服务，当前操作不会更新安全配置。</p><Button type="primary" icon={<KeyOutlined />} onClick={() => message.info('安全配置尚未接入账号服务，未修改密码或登录保护')}>保存安全设置</Button></footer>
            </Form>
          </section>
        </div>
      </div>
    </section>
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
          <Form.Item name="domains" label="业务动作域" extra="限制标注业务域的工具；通用表单数据仍按用户的表单权限读取。">
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
              saveLocalAISettings(form.getFieldsValue());
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

export function AIPlatformPanelV2() {
  const { notify, contextHolder: aiNoticeHolder } = useAISettingsNotification();
  const [form] = Form.useForm();
  const [permissionRuleForm] = Form.useForm();
  const [validationRuleForm] = Form.useForm();
  const [skillForm] = Form.useForm();
  const [toolForm] = Form.useForm();
  const [permissionRuleEditor, setPermissionRuleEditor] = useState<{ open: boolean; index: number | null }>({ open: false, index: null });
  const [validationRuleEditor, setValidationRuleEditor] = useState<{ open: boolean; index: number | null }>({ open: false, index: null });
  const [skillEditor, setSkillEditor] = useState<{ open: boolean; index: number | null }>({ open: false, index: null });
  const [toolEditor, setToolEditor] = useState<{ open: boolean; index: number | null }>({ open: false, index: null });
  const [registrySaving, setRegistrySaving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [aiParams, setAIParams] = useSearchParams();
  const requestedSection = aiParams.get('tab') || 'connection';
  const activeSettingsSection = ['connection', 'models', 'agent-registry', 'safety'].includes(requestedSection) ? requestedSection : 'connection';
  const setActiveSettingsSection = (section: string) => setAIParams(previous => {
    const next = new URLSearchParams(previous);
    next.set('tab', section);
    return next;
  });
  const [persistedSettings, setPersistedSettings] = useState<Record<string, any> | null>(null);
  const [loadError, setLoadError] = useState('');
  const [runtimeStatus, setRuntimeStatus] = useState<Record<string, any>>({});
  const [connectionResult, setConnectionResult] = useState<{ ok: boolean; message: string } | null>(null);
  const savedSettings = useMemo(() => {
    try {
      return readLocalAISettings();
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
    harnessPolicy: { reasoning_effort: null, initialize_timeout_seconds: 30, request_timeout_seconds: null, streamIdleTimeoutMs: null, contextWindow: null, compaction: { enabled: true, thresholdRatio: 0.8, retainRatio: 0.16 } },
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
      agentLoopMode: 'harness',
      maxToolSteps: 5,
      toolTimeoutSeconds: 30,
      enabledHooks: ['enforce_permissions', 'validate_before_confirmation', 'validate_before_tool', 'validate_after_tool', 'audit_tool_use'],
      permissionRules: [],
      validationRules: [],
    },
    agentRegistry: {
      skills: [],
      tools: [],
      handlerKeys: [],
      source: undefined,
    },
  }), []);

  useEffect(() => {
    let cancelled = false;

    const loadBackendSettings = async () => {
      try {
        const [response, registryResponse] = await Promise.all([
          getAISettings(),
          getAIAgentRegistry().catch(() => null),
        ]);
        const backendSettings = response.data?.settings || response.data?.data?.settings || response.data?.data;
        if (!cancelled && backendSettings && typeof backendSettings === 'object' && !Array.isArray(backendSettings)) {
          const registryData = registryResponse?.data?.data;
          const agentRegistry = registryData
            ? {
                skills: Object.values(registryData.skills || {}),
                tools: Object.values(registryData.tools || {}),
                handlerKeys: registryData.handlerKeys || [],
                source: registryData.source,
              }
            : defaultSettings.agentRegistry;
          const mergedSettings = normalizeAISettings({ ...defaultSettings, ...savedSettings, ...backendSettings, agentRegistry });
          form.setFieldsValue(mergedSettings);
          saveLocalAISettings(mergedSettings);
          setRuntimeStatus(response.data?.runtime || {});
          setPersistedSettings(mergedSettings);
          setLoaded(true);
          setDirty(false);
        }
      } catch {
        if (!cancelled) {
          setLoadError('后端设置加载失败。当前显示本地草稿，请刷新后重试；尚未确认这些配置生效。');
        }
      }
    };

    loadBackendSettings();

    return () => {
      cancelled = true;
    };
  }, [defaultSettings, form, savedSettings]);

  const saveLocalSettings = (values: Record<string, unknown>) => {
    saveLocalAISettings(values);
  };

  const aiRoleOptions = [
    { label: '管理员', value: 'admin' },
    { label: '生产经理', value: 'production_manager' },
    { label: '质量工程师', value: 'quality_engineer' },
    { label: '维护经理', value: 'maintenance_manager' },
    { label: '供应链经理', value: 'supply_chain_manager' },
    { label: '操作员', value: 'operator' },
    { label: '只读用户', value: 'viewer' },
  ];

  const aiCapabilityOptions = [
    { label: '页面问答', value: 'qa' },
    { label: '知识检索', value: 'rag' },
    { label: '业务查询', value: 'business_query' },
    { label: '报告摘要', value: 'report' },
    { label: '生成草稿', value: 'draft' },
    { label: '确认后保存草稿', value: 'save_draft' },
    { label: '发起流程', value: 'workflow' },
    { label: '配置辅助', value: 'config' },
  ];

  const aiDomainOptions = [
    { label: '生产', value: 'production' },
    { label: '质量', value: 'quality' },
    { label: '设备维护', value: 'maintenance' },
    { label: '供应链', value: 'supply-chain' },
    { label: '工作流', value: 'workflow' },
    { label: '低代码', value: 'low-code' },
  ];
  const hookOptions = [
    { label: '权限检查（始终执行）', value: 'enforce_permissions', disabled: true },
    { label: '确认前校验', value: 'validate_before_confirmation' },
    { label: '执行前校验', value: 'validate_before_tool' },
    { label: '执行后校验', value: 'validate_after_tool' },
    { label: '记录工具审计', value: 'audit_tool_use' },
  ];
  const validationPhaseOptions = [
    { label: '确认前', value: 'pre_confirmation' },
    { label: '执行前', value: 'pre_tool' },
    { label: '执行后', value: 'post_tool' },
  ];
  const validationRuleTypeOptions = [
    { label: '字段必填', value: 'field_required' },
    { label: '字段等于', value: 'field_equals' },
    { label: '数值下限', value: 'min_number' },
    { label: '数值上限', value: 'max_number' },
    { label: '结果非空', value: 'non_empty_result' },
  ];
  const watchedSettings = Form.useWatch([], { form, preserve: true }) || {};
  const activeDomains = watchedSettings.domains || defaultSettings.domains;
  const rolePolicies = watchedSettings.rolePolicies || defaultSettings.rolePolicies;
  const safetyPolicy = watchedSettings.safetyPolicy || defaultSettings.safetyPolicy;
  const permissionRules = Array.isArray(safetyPolicy.permissionRules) ? safetyPolicy.permissionRules : [];
  const validationRules = Array.isArray(safetyPolicy.validationRules) ? safetyPolicy.validationRules : [];
  const agentRegistry = watchedSettings.agentRegistry || defaultSettings.agentRegistry;
  const registrySkills = Array.isArray(agentRegistry.skills) ? agentRegistry.skills : [];
  const registryTools = Array.isArray(agentRegistry.tools) ? agentRegistry.tools : [];
  const registryHandlerKeys = Array.isArray(agentRegistry.handlerKeys) ? agentRegistry.handlerKeys : [];
  const registryToolOptions = registryTools.map((tool: any) => ({ label: tool.name, value: tool.name }));
  const registryHandlerOptions = (registryHandlerKeys.length ? registryHandlerKeys : ['not_implemented'])
    .map((handler: string) => ({ label: handler, value: handler }));

  const updateSafetyRules = (key: 'permissionRules' | 'validationRules', rules: any[]) => {
    form.setFieldsValue({ safetyPolicy: { ...(form.getFieldValue('safetyPolicy') || {}), [key]: rules } });
    setDirty(true);
  };

  const parseJsonField = (value: string | undefined, fallback: Record<string, unknown> = {}) => {
    if (!value || !value.trim()) return fallback;
    try {
      return JSON.parse(value);
    } catch {
      throw new Error('Invalid JSON');
    }
  };

  const persistAgentRegistry = async (nextRegistry: Record<string, any>, successTitle = '注册表已更新') => {
    setRegistrySaving(true);
    try {
      const response = await updateAIAgentRegistry({ skills: nextRegistry.skills, tools: nextRegistry.tools });
      const data = response.data?.data;
      const activated = {
        skills: Object.values(data?.skills || {}),
        tools: Object.values(data?.tools || {}),
        handlerKeys: data?.handlerKeys || nextRegistry.handlerKeys || [],
        source: data?.source || 'database',
      };
      form.setFieldsValue({ agentRegistry: activated });
      saveLocalSettings({ ...form.getFieldsValue(true), agentRegistry: activated });
      notify('success', successTitle);
      return true;
    } catch (error: any) {
      notify('error', '注册表更新失败', errorText(error));
      return false;
    } finally {
      setRegistrySaving(false);
    }
  };

  const changeRegistryItem = async (kind: 'skills' | 'tools', name: string, action: 'toggle' | 'delete') => {
    if (registrySaving) return;
    const rows = kind === 'skills' ? registrySkills : registryTools;
    const item = rows.find((row: any) => row.name === name);
    if (!item) return;
    if (action === 'delete' && item.enabled !== false) {
      notify('warning', '暂不能删除', '请先成功停用此项，再删除');
      return;
    }
    const next = action === 'delete' ? rows.filter((row: any) => row.name !== name) : rows.map((row: any) => row.name === name ? { ...row, enabled: row.enabled === false } : row);
    await persistAgentRegistry({ ...agentRegistry, skills: registrySkills, tools: registryTools, [kind]: next }, `${action === 'delete' ? '已删除' : item.enabled === false ? '已启用' : '已停用'} ${name}`);
  };

  const seedAgentRegistry = async () => {
    setRegistrySaving(true);
    try {
      const response = await seedAIAgentRegistry();
      const data = response.data?.data;
      const activated = {
        skills: Object.values(data?.skills || {}),
        tools: Object.values(data?.tools || {}),
        handlerKeys: data?.handlerKeys || [],
        source: data?.source || 'database',
      };
      form.setFieldsValue({ agentRegistry: activated });
      saveLocalSettings({ ...form.getFieldsValue(true), agentRegistry: activated });
      notify('success', '默认技能与工具已导入');
    } catch (error: any) {
      notify('error', '导入失败', errorText(error));
    } finally {
      setRegistrySaving(false);
    }
  };

  const openSkillEditor = (index: number | null) => {
    const source = index === null
      ? { enabled: false, capability_level: 'assisted', risk_level: 'medium', confirmation_policy: 'confirm_token', allowed_tools: [], required_permissions: [] }
      : registrySkills[index];
    skillForm.setFieldsValue(source);
    setSkillEditor({ open: true, index });
  };

  const saveSkill = async () => {
    const values = await skillForm.validateFields();
    const next = [...registrySkills];
    const item = { ...values, enabled: values.enabled !== false };
    if (skillEditor.index === null) next.push(item);
    else next[skillEditor.index] = item;
    if (await persistAgentRegistry({ ...agentRegistry, skills: next, tools: registryTools })) setSkillEditor({ open: false, index: null });
  };

  const openToolEditor = (index: number | null) => {
    const source = index === null
      ? { enabled: false, handler_key: 'not_implemented', side_effect: 'read', risk_level: 'low', permission_check: 'qa', dry_run_supported: true, audit_required: false, input_schema_json: '{}', output_schema_json: '{}' }
      : {
          ...registryTools[index],
          input_schema_json: JSON.stringify(registryTools[index]?.input_schema || {}, null, 2),
          output_schema_json: JSON.stringify(registryTools[index]?.output_schema || {}, null, 2),
        };
    toolForm.setFieldsValue(source);
    setToolEditor({ open: true, index });
  };

  const saveTool = async () => {
    const values = await toolForm.validateFields();
    let inputSchema: Record<string, unknown>;
    let outputSchema: Record<string, unknown>;
    try {
      inputSchema = parseJsonField(values.input_schema_json);
      outputSchema = parseJsonField(values.output_schema_json);
    } catch {
      notify('error', '配置格式有误', '输入和输出 Schema 必须是有效的 JSON');
      return;
    }
    const { input_schema_json, output_schema_json, ...rest } = values;
    void input_schema_json;
    void output_schema_json;
    const next = [...registryTools];
    const item = { ...rest, enabled: rest.enabled !== false, input_schema: inputSchema, output_schema: outputSchema };
    if (toolEditor.index === null) next.push(item);
    else next[toolEditor.index] = item;
    if (await persistAgentRegistry({ ...agentRegistry, skills: registrySkills, tools: next })) setToolEditor({ open: false, index: null });
  };

  const openPermissionRuleEditor = (index: number | null) => {
    permissionRuleForm.setFieldsValue(index === null ? { action: 'ask', tool: '*', riskThreshold: 'high' } : permissionRules[index]);
    setPermissionRuleEditor({ open: true, index });
  };

  const savePermissionRule = async () => {
    const values = await permissionRuleForm.validateFields();
    const next = [...permissionRules];
    if (permissionRuleEditor.index === null) next.push(values);
    else next[permissionRuleEditor.index] = values;
    updateSafetyRules('permissionRules', next);
    setPermissionRuleEditor({ open: false, index: null });
  };

  const openValidationRuleEditor = (index: number | null) => {
    validationRuleForm.setFieldsValue(index === null ? { phase: 'pre_tool', tool: '*', severity: 'warning', ruleType: 'field_required' } : validationRules[index]);
    setValidationRuleEditor({ open: true, index });
  };

  const saveValidationRule = async () => {
    const values = await validationRuleForm.validateFields();
    const next = [...validationRules];
    if (validationRuleEditor.index === null) next.push(values);
    else next[validationRuleEditor.index] = values;
    updateSafetyRules('validationRules', next);
    setValidationRuleEditor({ open: false, index: null });
  };

  const applyProviderPreset = (provider: string) => {
    setDirty(true);
    setConnectionResult(null);
    const preset = provider === 'glm' ? GLM_AI_DEFAULTS : provider === 'deepseek' ? DEEPSEEK_AI_DEFAULTS : { provider, baseUrl: provider === 'openai' ? 'https://api.openai.com/v1' : '', chatModel: '', reasoningModel: '' };
    const nextSettings = { ...form.getFieldsValue(true), ...preset, apiKey: '', organization: '', project: '', visionModel: provider === 'glm' ? GLM_AI_DEFAULTS.visionModel : 'disabled' };
    form.setFieldsValue(nextSettings);
    saveLocalSettings(nextSettings);
  };

  const applyGlmPreset = (preset: 'api' | 'coding') => {
    const target = preset === 'coding' ? GLM_CODING_PLAN_DEFAULTS : GLM_AI_DEFAULTS;
    if (form.getFieldValue('provider') === 'glm' && form.getFieldValue('baseUrl') === target.baseUrl) return;
    setDirty(true);
    setConnectionResult(null);
    const nextSettings = {
      ...form.getFieldsValue(true),
      ...(preset === 'coding' ? GLM_CODING_PLAN_DEFAULTS : GLM_AI_DEFAULTS),
      apiKey: '',
    };
    form.setFieldsValue(nextSettings);
    saveLocalSettings(nextSettings);
  };

  const collectSettings = async () => {
    try {
      await form.validateFields();
    } catch (error: any) {
      const field = error?.errorFields?.[0]?.name?.[0];
      if (['provider', 'baseUrl', 'apiKey', 'modelServices'].includes(field)) setActiveSettingsSection('connection');
      else if (['chatModel', 'reasoningModel', 'visionModel', 'modelAssignments'].includes(field)) setActiveSettingsSection('models');
      throw error;
    }
    const values = normalizeAISettings(form.getFieldsValue(true));
    delete values.agentRegistry;
    // Canonical policies replace the legacy duplicate fields.
    ['ragEnabled', 'topK', 'similarityThreshold', 'highRiskConfirm', 'sensitiveMasking', 'tools', 'knowledgeScopes', 'dailyLimit', 'userDailyLimit', 'retentionDays', 'proactiveEnabled', 'streaming', 'temperature', 'embeddingModel'].forEach(key => delete values[key]);
    return values;
  };
  const errorText = (error: any) => {
    const fieldError = error?.errorFields?.[0]?.errors?.[0];
    if (fieldError) return fieldError;
    const detail = error?.response?.data?.detail;
    return typeof detail === 'string' ? detail : detail?.message || error?.message || '请检查配置后重试';
  };
  const handleSaveToBackend = async () => {
    setSaving(true);
    try {
      const values = await collectSettings();
      const response = await updateAISettings(values);
      const persisted = response.data?.data;
      form.setFieldsValue(persisted);
      setPersistedSettings({ ...form.getFieldsValue(true), ...persisted });
      saveLocalSettings(persisted);
      setRuntimeStatus(response.data?.runtime || {});
      setDirty(false);
      if ((response.data?.runtime?.issues || []).length) notify('warning', '配置已保存', '模型接入尚未就绪，请检查配置并测试连接');
      else notify('success', '配置已保存', '后续请求使用新配置，可通过连接测试验证模型服务');
    } catch (error) {
      notify('error', '配置未保存', errorText(error));
    } finally { setSaving(false); }
  };
  const handleTestConnection = async (target?: TestTarget) => {
    setTesting(true);
    setConnectionResult(null);
    try {
      const values = await collectSettings();
      const response = await testSavedAISettings({ ...values, _testTarget: target });
      setConnectionResult({ ok: Boolean(response.data?.ok), message: response.data?.message || '连接测试结束' });
    } catch (error) {
      setConnectionResult({ ok: false, message: errorText(error) });
    } finally { setTesting(false); }
  };

  const advancedSections = [
    {
      key: 'agent-registry',
      label: '技能与工具注册表',
      children: (
        <div className="ai-registry-workspace"><SettingsTabs className="ai-registry-tabs" defaultActiveKey="skills" items={[{ key: 'skills', label: `技能 (${registrySkills.length})`, children: <Card title="技能注册表" extra={<Space size={6}>
              <Button size="small" loading={registrySaving} onClick={seedAgentRegistry}>导入默认注册表</Button>
              <Button size="small" type="primary" loading={registrySaving} onClick={() => openSkillEditor(null)}>添加技能</Button>
            </Space>}>
          <Table
            size="small"
            pagination={false}
            scroll={{ x: 760, y: 440 }}
            rowKey={(record: any) => record.name || record.title}
            dataSource={registrySkills}
            columns={[
              { title: '状态', dataIndex: 'enabled', width: 88, render: (value) => <Tag color={value === false ? 'default' : 'green'}>{value === false ? '已停用' : '已启用'}</Tag> },
              { title: '名称', dataIndex: 'name', ellipsis: true },
              { title: '默认工具', dataIndex: 'default_tool', ellipsis: true },
              { title: '风险', dataIndex: 'risk_level', width: 90 },
              {
                title: '',
                width: 200,
                render: (_, record, index) => (
                  <Space size={4}>
                    <Button size="small" disabled={registrySaving} onClick={() => openSkillEditor(index)}>编辑</Button>
                    <Button size="small" disabled={registrySaving} onClick={() => changeRegistryItem('skills', record.name, 'toggle')}>{record.enabled === false ? '启用' : '停用'}</Button>
                    <Button
                      size="small"
                      danger
                      loading={registrySaving}
                      disabled={registrySaving || record.enabled !== false}
                      title={record.enabled !== false ? '请先成功停用后再删除' : undefined}
                      onClick={() => changeRegistryItem('skills', record.name, 'delete')}
                    >
                      删除
                    </Button>
                  </Space>
                ),
              },
            ]}
            locale={{ emptyText: '尚未注册技能' }}
          />
          </Card> }, { key: 'tools', label: `工具 (${registryTools.length})`, children: <Card title="工具注册表" extra={<Button size="small" type="primary" loading={registrySaving} onClick={() => openToolEditor(null)}>添加工具</Button>}>
          <Table
            size="small"
            pagination={false}
            scroll={{ x: 760, y: 440 }}
            rowKey={(record: any) => record.name || record.title}
            dataSource={registryTools}
            columns={[
              { title: '状态', dataIndex: 'enabled', width: 88, render: (value) => <Tag color={value === false ? 'default' : 'green'}>{value === false ? '已停用' : '已启用'}</Tag> },
              { title: '名称', dataIndex: 'name', ellipsis: true },
              { title: '处理器', dataIndex: 'handler_key', ellipsis: true },
              { title: '操作类型', dataIndex: 'side_effect', width: 130 },
              { title: '风险', dataIndex: 'risk_level', width: 90 },
              {
                title: '',
                width: 200,
                render: (_, record, index) => (
                  <Space size={4}>
                    <Button size="small" disabled={registrySaving} onClick={() => openToolEditor(index)}>编辑</Button>
                    <Button size="small" disabled={registrySaving} onClick={() => changeRegistryItem('tools', record.name, 'toggle')}>{record.enabled === false ? '启用' : '停用'}</Button>
                    <Button
                      size="small"
                      danger
                      loading={registrySaving}
                      disabled={registrySaving || record.enabled !== false}
                      title={record.enabled !== false ? '请先成功停用后再删除' : undefined}
                      onClick={() => changeRegistryItem('tools', record.name, 'delete')}
                    >
                      删除
                    </Button>
                  </Space>
                ),
              },
            ]}
            locale={{ emptyText: '尚未注册工具' }}
          />
          </Card> }]} />
          <p className="ai-settings-quiet-note">注册表修改后立即生效 · 可用处理器 {registryHandlerKeys.length} 个</p>
        </div>
      ),
    },
  ];
  const settingsSections = [
    { key: 'connection', children: <ServiceCatalogPanel form={form} values={watchedSettings} onChange={() => { setDirty(true); setConnectionResult(null); }} onTest={handleTestConnection} testing={testing} /> },
    { key: 'models', children: <PurposeModelsPanel values={watchedSettings} onTest={handleTestConnection} testing={testing} /> },
    ...advancedSections.filter(section => section.key === 'agent-registry'),
    { key: 'safety', children: <div className="ai-settings-safety"><AIStatusSummary items={[{ label: '执行模式', value: ({ off: '关闭', readonly: '只读查询', draft: '仅生成草稿', confirm: '确认后执行' } as Record<string, string>)[watchedSettings.agentMode] || '未配置' }, { label: '会话压缩', value: watchedSettings.harnessPolicy?.compaction?.enabled ? '启用' : '关闭' }, { label: '写入策略', value: '操作前确认' }]} /><Card title="执行策略" className="settings-section"><div className="ai-execution-controls"><Form.Item name="agentMode" label="Agent 执行模式"><Select options={[{ value: 'off', label: '关闭' }, { value: 'readonly', label: '只读查询' }, { value: 'draft', label: '仅生成草稿' }, { value: 'confirm', label: '确认后执行' }]} /></Form.Item><Form.Item name={['safetyPolicy', 'maxToolSteps']} label="最大工具步数"><Input type="number" min={1} max={20} /></Form.Item><Form.Item name={['safetyPolicy', 'toolTimeoutSeconds']} label="工具超时 · 秒"><Input type="number" min={1} max={180} /></Form.Item></div><NativeCompactionPanel /></Card>                <Card title="安全护栏" className="settings-section">
                  <Form.Item name="domains" label="开放业务范围" extra="仅开放所选范围内的工具；创建表单和查询应用配置需要选择低代码，写入仍须确认并遵守角色权限。">
                    <Select mode="multiple" options={aiDomainOptions} aria-label="开放业务范围" />
                  </Form.Item>
                  <div className="ai-policy-toggle-list">


                    <div className="ai-policy-toggle-item">
                      <span>业务与配置写入</span>
                      <Tag>所有写入必须确认</Tag>
                    </div>
                    <div className="ai-policy-toggle-item">
                      <span>上下文敏感信息脱敏</span>
                      <Form.Item name={['safetyPolicy', 'sensitiveMasking']} valuePropName="checked" noStyle><Switch /></Form.Item>
                    </div>

                  </div>

                  <Collapse ghost items={[{ key: 'advanced-rules', label: '高级工具规则', children: <>
                  <Form.Item name={['safetyPolicy', 'enabledHooks']} label="平台工具校验与审计" className="ai-policy-compact-item">
                    <Select mode="multiple" options={hookOptions} />
                  </Form.Item>
                  <Form.Item name="forbiddenActions" label="禁止动作清单" className="ai-policy-compact-item">
                    <Select mode="multiple" options={[
                      { label: '自动下单', value: 'auto_order' },
                      { label: '删除数据', value: 'delete_data' },
                      { label: '修改权限', value: 'change_permission' },
                      { label: '所有配置写入', value: 'publish_config' },
                      ...registryToolOptions,
                    ]} />
                  </Form.Item>
                  <div className="ai-policy-rule-head">
                    <Text strong>工具权限规则</Text>
                    <Button size="small" onClick={() => openPermissionRuleEditor(null)}>添加规则</Button>
                  </div>
                  <Table
                    size="small"
                    pagination={false}
                    rowKey={(_, index) => `permission-${index}`}
                    dataSource={permissionRules}
                    columns={[
                      { title: '策略', dataIndex: 'action', width: 90, render: (value) => <Tag color={value === 'deny' ? 'red' : value === 'ask' ? 'gold' : 'green'}>{String(value || 'ask')}</Tag> },
                      { title: '工具', dataIndex: 'tool', ellipsis: true },
                      { title: '角色', dataIndex: 'role', ellipsis: true },
                      { title: '风险', dataIndex: 'riskThreshold', width: 90 },
                      {
                        title: '',
                        width: 120,
                        render: (_, __, index) => (
                          <Space size={4}>
                            <Button size="small" onClick={() => openPermissionRuleEditor(index)}>编辑</Button>
                            <Button size="small" danger onClick={() => updateSafetyRules('permissionRules', permissionRules.filter((_: any, itemIndex: number) => itemIndex !== index))}>删除</Button>
                          </Space>
                        ),
                      },
                    ]}
                    locale={{ emptyText: '尚未设置额外权限规则' }}
                  />
                  <div className="ai-policy-rule-head">
                    <Text strong>工具校验规则</Text>
                    <Button size="small" onClick={() => openValidationRuleEditor(null)}>添加规则</Button>
                  </div>
                  <Table
                    size="small"
                    pagination={false}
                    rowKey={(_, index) => `validation-${index}`}
                    dataSource={validationRules}
                    columns={[
                      { title: '阶段', dataIndex: 'phase', width: 130 },
                      { title: '工具', dataIndex: 'tool', ellipsis: true },
                      { title: '级别', dataIndex: 'severity', width: 90, render: (value) => <Tag color={value === 'error' ? 'red' : 'gold'}>{String(value || 'warning')}</Tag> },
                      { title: '规则', dataIndex: 'ruleType', width: 140 },
                      {
                        title: '',
                        width: 120,
                        render: (_, __, index) => (
                          <Space size={4}>
                            <Button size="small" onClick={() => openValidationRuleEditor(index)}>编辑</Button>
                            <Button size="small" danger onClick={() => updateSafetyRules('validationRules', validationRules.filter((_: any, itemIndex: number) => itemIndex !== index))}>删除</Button>
                          </Space>
                        ),
                      },
                    ]}
                    locale={{ emptyText: '尚未设置额外校验规则' }}
                  />                  </> }]} />
                </Card>

                <Card title="审计记录" className="settings-section">
                  <div className="ai-policy-toggle-list compact">
                    <div className="ai-policy-toggle-item">
                      <span>记录 AI 审计事件</span>
                      <Form.Item name="auditEnabled" valuePropName="checked" noStyle><Switch /></Form.Item>
                    </div>
                    <div className="ai-policy-toggle-item">
                      <span>记录工具调用</span>
                      <Form.Item name="recordToolCalls" valuePropName="checked" noStyle><Switch /></Form.Item>
                    </div>
                  </div>
                  <div className="ai-settings-quiet-note">执行记录统一在“审计与日志”中查看。</div>
                </Card>

                <div className="ai-settings-quiet-note">可调用工具由工具启用状态、角色权限、业务权限与本页执行规则共同约束。</div>


</div> },
  ];
  const resetDraft = () => {
    if (!persistedSettings) return;
    form.setFieldsValue({ ...persistedSettings, agentRegistry: form.getFieldValue('agentRegistry') });
    saveLocalSettings(persistedSettings);
    setDirty(false);
    setConnectionResult(null);
  };
  const onDraftChange = (changed: Record<string, any>, values: Record<string, any>) => {
    if (changed.modelServices && persistedSettings?.modelServices) {
      const services = values.modelServices || [];
      let cleared = false;
      const next = services.map((service: any) => {
        const previous = persistedSettings.modelServices.find((item: any) => item.id === service.id);
        if (service.apiKey === '********' && previous && previous.baseUrl !== service.baseUrl) { cleared = true; return { ...service, apiKey: '' }; }
        return service;
      });
      if (cleared) form.setFieldsValue({ modelServices: next });
    }
    setDirty(true);
    setConnectionResult(null);
  };

  return (
    <div className="account-admin-section ai-settings-page">
      {aiNoticeHolder}
      <Form form={form} layout="vertical" initialValues={{ ...defaultSettings, ...savedSettings }} className="ai-platform-form" onValuesChange={onDraftChange}>
        <AISettingsWorkspace effectivePreview={<EffectiveHarnessPreview onError={description => notify('error', '参数预览失败', description)} values={watchedSettings} onPreview={async () => (await previewAISettings(await collectSettings())).data} />} sections={settingsSections} active={activeSettingsSection} onSelect={setActiveSettingsSection} loaded={loaded} dirty={dirty} saving={saving} testing={testing} loadError={loadError} sdkVersion={runtimeStatus.sdkVersion} connectionResult={connectionResult} onSave={handleSaveToBackend} onTest={handleTestConnection} onReset={resetDraft} onDismissTest={() => setConnectionResult(null)} />
      </Form>
      <Modal
        title={permissionRuleEditor.index === null ? '添加工具权限规则' : '编辑工具权限规则'}
        open={permissionRuleEditor.open}
        onOk={savePermissionRule}
        onCancel={() => setPermissionRuleEditor({ open: false, index: null })}
        destroyOnHidden
      >
        <Form form={permissionRuleForm} layout="vertical">
          <Form.Item name="action" label="处理策略" rules={[{ required: true }]}>
            <Select options={[{ label: '允许', value: 'allow' }, { label: '请求确认', value: 'ask' }, { label: '禁止', value: 'deny' }]} />
          </Form.Item>
          <Form.Item name="tool" label="工具匹配表达式" rules={[{ required: true }]}>
            <Input placeholder="forms.*" />
          </Form.Item>
          <Form.Item name="role" label="角色匹配表达式">
            <Input placeholder="admin / viewer / *" />
          </Form.Item>
          <Form.Item name="riskThreshold" label="风险阈值">
            <Select allowClear options={[{ label: '低', value: 'low' }, { label: '中', value: 'medium' }, { label: '高', value: 'high' }, { label: '严重', value: 'critical' }]} />
          </Form.Item>
          <Form.Item name="reason" label="说明">
            <Input />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title={validationRuleEditor.index === null ? '添加校验规则' : '编辑校验规则'}
        open={validationRuleEditor.open}
        onOk={saveValidationRule}
        onCancel={() => setValidationRuleEditor({ open: false, index: null })}
        destroyOnHidden
      >
        <Form form={validationRuleForm} layout="vertical">
          <Form.Item name="phase" label="校验阶段" rules={[{ required: true }]}>
            <Select options={validationPhaseOptions} />
          </Form.Item>
          <Form.Item name="tool" label="工具匹配表达式" rules={[{ required: true }]}>
            <Input placeholder="forms.create_form_definition" />
          </Form.Item>
          <Form.Item name="severity" label="校验级别" rules={[{ required: true }]}>
            <Select options={[{ label: '警告', value: 'warning' }, { label: '错误', value: 'error' }]} />
          </Form.Item>
          <Form.Item name="ruleType" label="规则类型" rules={[{ required: true }]}>
            <Select options={validationRuleTypeOptions} />
          </Form.Item>
          <Form.Item name="field" label="字段路径">
            <Input placeholder="form.name" />
          </Form.Item>
          <Form.Item name="value" label="值 / 阈值">
            <Input />
          </Form.Item>
          <Form.Item name="message" label="提示信息">
            <Input />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title={skillEditor.index === null ? '添加技能' : '编辑技能'}
        open={skillEditor.open}
        onOk={saveSkill}
        confirmLoading={registrySaving}
        onCancel={() => setSkillEditor({ open: false, index: null })}
        destroyOnHidden
      >
        <Form form={skillForm} layout="vertical">
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="name" label="技能标识" rules={[{ required: true }]}>
            <Input placeholder="low_code_form_builder" />
          </Form.Item>
          <Form.Item name="title" label="显示名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="capability_level" label="能力级别">
                <Select options={[
                  { label: '只读', value: 'readonly' },
                  { label: '辅助', value: 'assisted' },
                  { label: '自主', value: 'autonomous' },
                ]} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="risk_level" label="风险等级">
                <Select options={[
                  { label: '低', value: 'low' },
                  { label: '中', value: 'medium' },
                  { label: '高', value: 'high' },
                  { label: '严重', value: 'critical' },
                ]} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="default_tool" label="默认工具">
            <Select allowClear showSearch options={registryToolOptions} />
          </Form.Item>
          <Form.Item name="allowed_tools" label="允许使用的工具">
            <Select mode="multiple" showSearch options={registryToolOptions} />
          </Form.Item>
          <Form.Item name="required_permissions" label="所需权限">
            <Select mode="tags" />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="confirmation_policy" label="确认策略">
                <Select options={[
                  { label: 'None', value: 'none' },
                  { label: 'Confirm token', value: 'confirm_token' },
                  { label: 'Always confirm', value: 'always_confirm' },
                  { label: 'Blocked', value: 'blocked' },
                ]} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="permission_capability" label="所需能力">
                <Select allowClear options={aiCapabilityOptions} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="domain" label="Domain">
            <Select allowClear options={aiDomainOptions} />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title={toolEditor.index === null ? '添加工具' : '编辑工具'}
        open={toolEditor.open}
        onOk={saveTool}
        confirmLoading={registrySaving}
        onCancel={() => setToolEditor({ open: false, index: null })}
        destroyOnHidden
        width={720}
      >
        <Form form={toolForm} layout="vertical">
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="name" label="工具标识" rules={[{ required: true }]}>
            <Input placeholder="forms.query_records" />
          </Form.Item>
          <Form.Item name="title" label="显示名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="handler_key" label="业务处理器" rules={[{ required: true }]}>
                <Select showSearch options={registryHandlerOptions} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="side_effect" label="操作类型">
                <Select options={[
                  { label: '读取', value: 'read' },
                  { label: '分析', value: 'analyze' },
                  { label: '草稿写入', value: 'draft_write' },
                  { label: '记录修改', value: 'record_write' },
                  { label: '配置写入', value: 'configuration_write' },
                  { label: '流程操作', value: 'workflow_action' },
                  { label: '外部写入', value: 'external_write' },
                ]} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="risk_level" label="风险等级">
                <Select options={[
                  { label: '低', value: 'low' },
                  { label: '中', value: 'medium' },
                  { label: '高', value: 'high' },
                  { label: '严重', value: 'critical' },
                ]} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="permission_check" label="所需能力">
                <Select allowClear options={aiCapabilityOptions} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="dry_run_supported" label="支持预演" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="audit_required" label="必须审计" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="input_schema_json" label="输入结构 JSON">
            <Input.TextArea rows={6} />
          </Form.Item>
          <Form.Item name="output_schema_json" label="输出结构 JSON">
            <Input.TextArea rows={6} />
          </Form.Item>
        </Form>
      </Modal>
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
export function AuditPanel() {
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
  return formatServerDateTime(value);
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


