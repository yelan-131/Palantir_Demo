import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { Alert, Button, Checkbox, Form, Input, InputNumber, Modal, Segmented, Select, Space, Steps, Switch, Tag, Typography, message } from 'antd';
import { BranchesOutlined, CheckCircleOutlined, DatabaseOutlined, NodeIndexOutlined, RobotOutlined } from '@/components/Icon/ant';
import { adminListUsers, createDataSource, getDataSource, getReferenceData, testDataSourceConfig, updateDataSource } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';

export type ConnectionWizardActions = {
  create: () => void;
  edit: (source: { id: number; name: string }) => Promise<void>;
};

type DiscoveredSourceTable = { name: string; rows?: number };
type GovernanceUserOption = { id: number; label: string; value: string; email?: string };
type SourceConnectionDraft = {
  type: string;
  host: string;
  port: number;
  database: string;
  schema: string;
  auth_type: string;
  username: string;
  password: string;
  ssl_enabled: boolean;
};

const DEFAULT_BUSINESS_DOMAINS = ['生产', '设备', '质量', '供应链', '仓储', '客户'];
const ENABLED_DATA_SOURCE_TYPES = new Set(['postgresql']);
const INVALID_SOURCE_TEXTS = new Set(['', 'undefined', 'null', 'none', 'nan']);
const DEFAULT_SOURCE_CONNECTION_DRAFT: SourceConnectionDraft = {
  type: 'postgresql',
  host: 'localhost',
  port: 15432,
  database: 'mf_mes_execution',
  schema: 'source',
  auth_type: 'password',
  username: 'mf_mes_readonly',
  password: '',
  ssl_enabled: false,
};
const DATA_SENSITIVITY_OPTIONS = [
  { value: 'internal', label: '内部', description: '可用于元数据扫描、AI 识别和对象建模。' },
  { value: 'confidential', label: '敏感', description: '允许建模，AI 使用需记录审计，样例数据需谨慎。' },
  { value: 'restricted', label: '受限', description: '默认禁止 AI 使用和图谱实例，避免高敏数据扩散。' },
];

const cleanSourceText = (value: unknown) => String(value ?? '').trim();

const hasInvalidSourceText = (value: unknown) => {
  const text = cleanSourceText(value).toLowerCase();
  return INVALID_SOURCE_TEXTS.has(text) || text.includes('undefined://') || text.includes('/undefined');
};

const hasInvalidSourceName = (value: unknown) => {
  const text = cleanSourceText(value).toLowerCase();
  return !text || text.includes('undefined://') || text === 'undefined://undefined/undefined';
};

const editableSourceText = (value: unknown) => {
  const text = cleanSourceText(value);
  return hasInvalidSourceText(text) ? '' : text;
};

const normalizeWizardSourceType = (value: unknown) => {
  const text = cleanSourceText(value).toLowerCase();
  if (text === 'database' || INVALID_SOURCE_TEXTS.has(text)) {
    return 'postgresql';
  }
  return text;
};

export default forwardRef<ConnectionWizardActions, { onSaved: () => void }>(function ConnectionWizard({ onSaved }, ref) {
  const [dataSourceForm] = Form.useForm();
  const currentUser = useAuthStore(state => state.user);
  const [saving, setSaving] = useState(false);
  const [sourceModalOpen, setSourceModalOpen] = useState(false);
  const [originalConfig, setOriginalConfig] = useState<Record<string, unknown>>({});
  const [sourceStep, setSourceStep] = useState(0);
  const [sourceEditingId, setSourceEditingId] = useState<number | undefined>();
  const [sourceNameInput, setSourceNameInput] = useState('');
  const [sourceConnectionDraft, setSourceConnectionDraft] = useState<SourceConnectionDraft>(DEFAULT_SOURCE_CONNECTION_DRAFT);
  const [discoveredSourceTables, setDiscoveredSourceTables] = useState<DiscoveredSourceTable[]>([]);
  const [businessDomainOptions, setBusinessDomainOptions] = useState(DEFAULT_BUSINESS_DOMAINS);
  const [governanceUsers, setGovernanceUsers] = useState<GovernanceUserOption[]>([]);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionTestResult, setConnectionTestResult] = useState<'success' | 'error' | undefined>();
  const watchedSensitivity = Form.useWatch('sensitivity', dataSourceForm);

  const hydrateConnectionForm = (draft: SourceConnectionDraft = sourceConnectionDraft) => {
    dataSourceForm.setFieldsValue({
      ...draft,
      name: cleanSourceText(sourceNameInput || dataSourceForm.getFieldValue('name')),
    });
  };

  const handleSourceFormValuesChange = (changedValues: Record<string, any>) => {
    if (Object.prototype.hasOwnProperty.call(changedValues, 'name')) {
      setSourceNameInput(changedValues.name ?? '');
    }
    const draftPatch: Partial<SourceConnectionDraft> = {};
    (['type', 'host', 'port', 'database', 'schema', 'auth_type', 'username', 'password', 'ssl_enabled'] as const).forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(changedValues, key)) {
        (draftPatch as any)[key] = changedValues[key];
      }
    });
    if (Object.keys(draftPatch).length) {
      setSourceConnectionDraft((prev) => ({ ...prev, ...draftPatch }));
    }
  };

  const loadGovernanceOptions = async () => {
    try {
      const [refRes, userRes] = await Promise.all([getReferenceData(), adminListUsers()]);
      const dictionaries = refRes.data?.data?.dictionaries ?? [];
      const businessDomainDict = dictionaries.find((dict: any) => ['business_domain', 'data_asset_business_domain'].includes(String(dict.dictCode)));
      const nextDomains = Array.isArray(businessDomainDict?.options)
        ? businessDomainDict.options
          .filter((item: any) => item.enabled !== false)
          .map((item: any) => String(item.label || item.value))
          .filter(Boolean)
        : [];
      setBusinessDomainOptions(nextDomains.length ? nextDomains : DEFAULT_BUSINESS_DOMAINS);

      const users = userRes.data?.data ?? [];
      const nextUsers = users
        .filter((user: any) => user.is_active !== false)
        .map((user: any) => ({
          id: Number(user.id),
          label: String(user.display_name || user.username),
          value: String(user.display_name || user.username),
          email: user.email,
        }));
      setGovernanceUsers(nextUsers);
    } catch {
      const fallbackUser = currentUser
        ? [{ id: currentUser.id, label: currentUser.display_name || currentUser.username, value: currentUser.display_name || currentUser.username, email: currentUser.email }]
        : [];
      setBusinessDomainOptions(DEFAULT_BUSINESS_DOMAINS);
      setGovernanceUsers(fallbackUser);
    }
  };

  const applySensitivityPolicy = (sensitivity?: string) => {
    if (sensitivity === 'restricted') {
      const currentScope = dataSourceForm.getFieldValue('sync_scope');
      dataSourceForm.setFieldsValue({
        allow_ai: false,
        allow_graph: false,
        sync_scope: Array.isArray(currentScope)
          ? currentScope.filter((item) => !['sample', 'full', 'incremental'].includes(item))
          : ['metadata', 'profile'],
      });
      message.info('受限数据已自动关闭 AI 使用和图谱实例，并移除样例/全量/增量采集。');
    }
  };

  const openDataSourceWizard = () => {
    setOriginalConfig({});
    setSourceEditingId(undefined);
    setSourceStep(0);
    setConnectionTestResult(undefined);
    setDiscoveredSourceTables([]);
    setSourceNameInput('');
    setSourceConnectionDraft(DEFAULT_SOURCE_CONNECTION_DRAFT);
    dataSourceForm.setFieldsValue({
      name: '',
      ...DEFAULT_SOURCE_CONNECTION_DRAFT,
      owner: currentUser?.display_name || currentUser?.username || '平台管理员',
      sync_frequency: '每 5 分钟',
      sync_mode: 'metadata',
      business_domain: '生产',
      sensitivity: 'internal',
      network_zone: '内网 Connector Agent',
      ssl_enabled: false,
      save_secret: true,
      allow_ai: true,
      allow_ontology: true,
      allow_graph: false,
      sync_scope: ['metadata', 'profile'],
      tables: [],
    });
    setSourceModalOpen(true);
  };

  const openDataSourceEditor = async (asset: { id: number; name: string }) => {
    let config: Record<string, any> = {};
    let schedule = '每 5 分钟';
    try {
      const res = await getDataSource(asset.id);
      if (res.data?.source === 'fallback') throw new Error();
      config = JSON.parse(res.data?.connection_config || '{}');
      schedule = res.data?.schedule || schedule;
    } catch {
      message.error('数据源配置加载失败');
      return;
    }
    setOriginalConfig(config);
    setSourceEditingId(asset.id);
    setSourceStep(0);
    setConnectionTestResult(undefined);
    const savedTableNames = Array.isArray(config.selected_tables) ? config.selected_tables : [];
    const savedDiscoveredTables = Array.isArray(config.discovered_tables) && config.discovered_tables.length
      ? config.discovered_tables
      : savedTableNames.map((name: string) => ({ name }));
    setDiscoveredSourceTables(savedDiscoveredTables);
    const editorSourceType = normalizeWizardSourceType(config.type || config.source_type);
    const editableName = editableSourceText(asset.name);
    const editorDraft: SourceConnectionDraft = {
      type: ENABLED_DATA_SOURCE_TYPES.has(editorSourceType) ? editorSourceType : 'postgresql',
      host: editableSourceText(config.host) || 'localhost',
      port: Number(config.port || 5432),
      database: editableSourceText(config.database) || '',
      schema: config.schema || config.schema_name || 'source',
      auth_type: config.auth_type || 'password',
      username: editableSourceText(config.username) || 'mf_readonly',
      password: config.password || '',
      ssl_enabled: config.ssl_enabled ?? false,
    };
    setSourceNameInput(editableName);
    setSourceConnectionDraft(editorDraft);
    dataSourceForm.setFieldsValue({
      ...editorDraft,
      name: editableName,
      owner: config.owner || '平台管理员',
      sync_frequency: schedule,
      sync_mode: config.sync_mode || 'metadata',
      business_domain: config.business_domain || '生产',
      sensitivity: config.sensitivity || 'internal',
      network_zone: config.network_zone || '内网 Connector Agent',
      ssl_enabled: config.ssl_enabled ?? false,
      save_secret: true,
      allow_ai: config.allow_ai ?? true,
      allow_ontology: config.allow_ontology ?? true,
      allow_graph: config.allow_graph ?? false,
      sync_scope: config.sync_scope || ['metadata', 'profile'],
      tables: savedTableNames,
    });
    setSourceModalOpen(true);
  };

  const closeDataSourceWizard = () => {
    setSourceModalOpen(false);
    setSourceStep(0);
    setSourceEditingId(undefined);
    setConnectionTestResult(undefined);
    setDiscoveredSourceTables([]);
    setSourceNameInput('');
    setSourceConnectionDraft(DEFAULT_SOURCE_CONNECTION_DRAFT);
  };

  const nextSourceStep = async () => {
    const normalizedName = cleanSourceText(sourceNameInput || dataSourceForm.getFieldValue('name'));
    dataSourceForm.setFieldsValue({ name: normalizedName, ...sourceConnectionDraft });
    if (sourceStep === 0 && hasInvalidSourceName(normalizedName)) {
      dataSourceForm.setFields([{ name: 'name', errors: ['请输入连接名称'] }]);
      dataSourceForm.scrollToField('name', { block: 'center' });
      message.error('请输入连接名称');
      return;
    }
    const stepFields = [
      ['type', 'host', 'port', 'database', 'schema', 'auth_type', 'username', 'password'],
      ['sync_scope', 'tables', 'sync_mode', 'sync_frequency'],
      ['business_domain', 'owner'],
    ][sourceStep] ?? [];
    try {
      await dataSourceForm.validateFields(stepFields);
      if (sourceStep === 0 && discoveredSourceTables.length === 0) {
        message.warning('请先测试连接，读取真实数据库表');
        return;
      }
      setSourceStep((prev) => Math.min(prev + 1, 2));
    } catch (error: any) {
      const firstField = error?.errorFields?.[0]?.name;
      if (firstField) {
        dataSourceForm.scrollToField(firstField, { block: 'center' });
      }
      message.warning('请先填写必填项');
    }
  };

  const testDataSourceConnection = async () => {
    hydrateConnectionForm();
    const values = await dataSourceForm.validateFields(['type', 'host', 'port', 'database', 'schema', 'auth_type', 'username', 'password', 'ssl_enabled']).catch(() => undefined);
    if (!values) return;
    const draft = { ...sourceConnectionDraft, ...values };
    const sourceType = normalizeWizardSourceType(draft.type);
    if (!ENABLED_DATA_SOURCE_TYPES.has(sourceType)) {
      message.error('数据源类型无效，请选择 PostgreSQL 后再测试连接');
      return;
    }
    setTestingConnection(true);
    setConnectionTestResult(undefined);
    try {
      const res = await testDataSourceConfig({
        source_type: sourceType,
        host: cleanSourceText(draft.host),
        port: draft.port,
        database: cleanSourceText(draft.database),
        schema_name: draft.schema || 'public',
        username: cleanSourceText(draft.username),
        password: draft.password,
        ssl_enabled: Boolean(draft.ssl_enabled),
      });
      setConnectionTestResult('success');
      const tables = res.data?.tables ?? [];
      const realTables = tables.map((table: any) => ({ name: String(table.name), rows: Number(table.rows ?? 0) }));
      setDiscoveredSourceTables(realTables);
      if (tables.length) {
        const selectedTables: string[] = dataSourceForm.getFieldValue('tables') ?? [];
        const discoveredNames = realTables.map((table: DiscoveredSourceTable) => table.name);
        const availableNames = new Set(discoveredNames);
        dataSourceForm.setFieldsValue({
          tables: selectedTables.length ? selectedTables.filter(name => availableNames.has(name)) : discoveredNames,
        });
      }
      message.success(`连接测试通过：发现 ${tables.length || 0} 张候选表`);
    } catch (error: any) {
      setConnectionTestResult('error');
      setDiscoveredSourceTables([]);
      message.error(error?.response?.data?.detail ?? '连接测试失败');
    } finally {
      setTestingConnection(false);
    }
  };

  const saveDataSource = async () => {
    const normalizedName = cleanSourceText(sourceNameInput || dataSourceForm.getFieldValue('name'));
    dataSourceForm.setFieldsValue({ name: normalizedName, ...sourceConnectionDraft });
    const validated = await dataSourceForm.validateFields().catch(() => undefined);
    if (!validated) return;
    const values = dataSourceForm.getFieldsValue(true);
    const draft = { ...sourceConnectionDraft, ...values };
    const sourceName = normalizedName;
    const sourceType = normalizeWizardSourceType(draft.type);
    if (!ENABLED_DATA_SOURCE_TYPES.has(sourceType)) {
      message.error('数据源类型无效，请选择 PostgreSQL 后再保存');
      setSourceStep(0);
      return;
    }
    if (hasInvalidSourceName(sourceName)) {
      dataSourceForm.setFields([{ name: 'name', errors: ['请输入连接名称'] }]);
      dataSourceForm.scrollToField('name', { block: 'center' });
      message.error('请输入连接名称');
      setSourceStep(0);
      return;
    }
    const tableNames = Array.isArray(values.tables) ? values.tables : [];
    const connectionConfig = {
      ...originalConfig,
      type: sourceType,
      source_type: sourceType,
      host: cleanSourceText(draft.host),
      port: draft.port,
      database: cleanSourceText(draft.database),
      schema: draft.schema || 'public',
      schema_name: draft.schema || 'public',
      auth_type: draft.auth_type,
      username: cleanSourceText(draft.username),
      password: draft.password,
      ssl_enabled: Boolean(draft.ssl_enabled),
      owner: values.owner ?? '平台管理员',
      business_domain: values.business_domain,
      sensitivity: values.sensitivity || 'internal',
      network_zone: values.network_zone,
      sync_scope: values.sync_scope ?? ['metadata', 'profile'],
      sync_mode: values.sync_mode ?? 'metadata',
      allow_ai: Boolean(values.allow_ai),
      allow_ontology: Boolean(values.allow_ontology),
      allow_graph: Boolean(values.allow_graph),
      selected_tables: tableNames,
      discovered_tables: discoveredSourceTables,
    };
    const payload = {
      name: sourceName,
      source_type: sourceType,
      connection_config: JSON.stringify(connectionConfig),
      schedule: String(values.sync_frequency ?? '每 5 分钟'),
      status: 'active',
    };
    setSaving(true);
    try {
      const res = sourceEditingId
        ? await updateDataSource(sourceEditingId, payload)
        : await createDataSource(payload);
      if (res.data?.source === 'fallback') throw new Error('未保存到数据库');
      closeDataSourceWizard();
      dataSourceForm.resetFields();
      onSaved();
      message.success(sourceEditingId ? '连接已更新' : '连接已创建');
    } catch (error: any) {
      message.error(error?.response?.data?.detail ?? error?.message ?? '数据源保存失败');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (sourceModalOpen) void loadGovernanceOptions();
  }, [sourceModalOpen]);

  useEffect(() => {
    applySensitivityPolicy(watchedSensitivity);
  }, [watchedSensitivity]);

  useImperativeHandle(ref, () => ({ create: openDataSourceWizard, edit: openDataSourceEditor }));

  return (
    <Modal
      title={sourceEditingId ? '编辑数据源' : '接入数据源'}
      open={sourceModalOpen}
      onCancel={closeDataSourceWizard}
      width={980}
      destroyOnHidden
      footer={
        <Space>
          <Button onClick={closeDataSourceWizard}>取消</Button>
          {sourceStep > 0 && <Button onClick={() => setSourceStep((prev) => prev - 1)}>上一步</Button>}
          {sourceStep < 2 ? (
            <Button type="primary" onClick={nextSourceStep}>下一步</Button>
          ) : (
            <Button type="primary" loading={saving} onClick={saveDataSource}>{sourceEditingId ? '保存修改' : '保存连接'}</Button>
          )}
        </Space>
      }
    >
      <div className="source-onboarding">
        <Steps
          size="small"
          current={sourceStep}
          items={[
            { title: '连接' },
            { title: '采集范围' },
            { title: '治理使用' },
          ]}
        />
        <Form
          form={dataSourceForm}
          layout="vertical"
          className="source-onboarding-form"
          onValuesChange={handleSourceFormValuesChange}
        >
          {sourceStep === 0 && <section className="source-form-section source-connection-section">
            <div className="source-section-title">
              <Typography.Text strong>连接与凭据</Typography.Text>
              <Space size={6}>
                {connectionTestResult === 'success' && <Tag color="success">连接成功</Tag>}
                {connectionTestResult === 'error' && <Tag color="error">连接失败</Tag>}
              </Space>
            </div>
            <div className="source-connection-visual">
              <div className="source-connection-node">
                <DatabaseOutlined />
                <span>平台</span>
              </div>
              <div className="source-connection-line" />
              <div className="source-connection-node">
                <DatabaseOutlined />
                <span>数据库</span>
              </div>
            </div>
            <div className="source-connection-fields">
              <div className="source-connection-row">
                <span className="source-connection-label required">类型:</span>
                <Form.Item name="type" rules={[{ required: true }]}>
                  <Select
                    options={[
                      { value: 'postgresql', label: 'PostgreSQL' },
                      { value: 'mysql', label: 'MySQL 待开发', disabled: true },
                      { value: 'sqlserver', label: 'SQL Server 待开发', disabled: true },
                      { value: 'oracle', label: 'Oracle 待开发', disabled: true },
                      { value: 'rest_api', label: 'REST API 待开发', disabled: true },
                      { value: 'excel', label: 'Excel / CSV 待开发', disabled: true },
                      { value: 'opcua', label: 'OPC UA 待开发', disabled: true },
                    ]}
                  />
                </Form.Item>
              </div>
              <div className="source-connection-row">
                <span className="source-connection-label required">连接名称:</span>
                <Form.Item
                  name="name"
                  rules={[{ required: true, message: '请输入连接名称' }]}
                >
                  <Input placeholder="MES PostgreSQL 生产执行库" />
                </Form.Item>
              </div>
              <div className="source-connection-row">
                <span className="source-connection-label required">主机:</span>
                <Form.Item name="host" rules={[{ required: true, message: '请输入主机或 IP' }]}>
                  <Input placeholder="localhost" />
                </Form.Item>
              </div>
              <div className="source-connection-row short">
                <span className="source-connection-label required">端口:</span>
                <Form.Item name="port" rules={[{ required: true, message: '请输入端口' }]}>
                  <InputNumber min={1} max={65535} />
                </Form.Item>
              </div>
              <div className="source-connection-row">
                <span className="source-connection-label required">初始数据库:</span>
                <Form.Item name="database" rules={[{ required: true, message: '请输入数据库名' }]}>
                  <Input placeholder="mf_mes_execution" />
                </Form.Item>
              </div>
              <div className="source-connection-row">
                <span className="source-connection-label">Schema/命名空间:</span>
                <Form.Item name="schema" extra="可选。PostgreSQL 默认通常是 public；本演示库表在 source。">
                  <Input placeholder="默认 public；演示库填 source" />
                </Form.Item>
              </div>
              <div className="source-connection-row">
                <span className="source-connection-label required">认证:</span>
                <Form.Item name="auth_type" rules={[{ required: true, message: '请选择认证方式' }]}>
                  <Select
                    options={[
                      { value: 'password', label: '用户名 / 密码' },
                      { value: 'token', label: 'Token / API Key 待开发', disabled: true },
                      { value: 'oauth', label: 'OAuth 待开发', disabled: true },
                      { value: 'kerberos', label: 'Kerberos / LDAP 待开发', disabled: true },
                    ]}
                  />
                </Form.Item>
              </div>
              <div className="source-connection-row medium">
                <span className="source-connection-label required">用户名:</span>
                <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
                  <Input placeholder="mf_mes_readonly" />
                </Form.Item>
              </div>
              <div className="source-connection-row medium">
                <span className="source-connection-label required">密码:</span>
                <Form.Item name="password" rules={[{ required: true, message: '请输入密码或 Secret' }]}>
                  <Input.Password placeholder="readonly_demo_123" />
                </Form.Item>
              </div>
              <div className="source-connection-row">
                <span className="source-connection-label">网络:</span>
                <Form.Item name="network_zone">
                  <Select
                    options={[
                      { value: '内网 Connector Agent', label: '内网 Connector Agent' },
                      { value: '平台直连', label: '平台直连' },
                      { value: 'VPN 专线', label: 'VPN 专线' },
                    ]}
                  />
                </Form.Item>
              </div>
              <div className="source-connection-row controls">
                <span className="source-connection-label">选项:</span>
                <div className="source-connection-checks">
                  <Form.Item name="ssl_enabled" valuePropName="checked">
                    <Checkbox>SSL / TLS</Checkbox>
                  </Form.Item>
                  <Form.Item name="save_secret" valuePropName="checked">
                    <Checkbox>保存密码</Checkbox>
                  </Form.Item>
                </div>
              </div>
              <div className="source-connection-row action">
                <span className="source-connection-label" />
                <Button icon={<CheckCircleOutlined />} loading={testingConnection} onClick={testDataSourceConnection}>测试连接</Button>
              </div>
            </div>
          </section>}

          {sourceStep === 1 && <section className="source-form-section">
            <div className="source-section-title">
              <Typography.Text strong>采集范围</Typography.Text>
              <Typography.Text type="secondary">采集内容决定抓取粒度，纳入目录的表决定本次资产边界。</Typography.Text>
            </div>
            <div className="source-range-grid">
              <Form.Item name="sync_scope" label="采集内容" rules={[{ required: true, message: '请选择采集内容' }]}>
                <Checkbox.Group
                  className="source-scope-picker"
                  options={[
                    { label: '表结构', value: 'metadata' },
                    { label: '字段画像', value: 'profile' },
                    { label: '样例数据', value: 'sample' },
                    { label: '全量数据', value: 'full' },
                    { label: '增量数据', value: 'incremental' },
                  ]}
                />
              </Form.Item>
              <div className="source-schedule-grid">
                <Form.Item name="sync_mode" label="采集方式">
                  <Select
                    options={[
                      { value: 'metadata', label: '仅元数据扫描' },
                      { value: 'batch', label: '定时批量同步' },
                      { value: 'incremental', label: '增量同步' },
                      { value: 'cdc', label: 'CDC' },
                    ]}
                  />
                </Form.Item>
                <Form.Item name="sync_frequency" label="频率">
                  <Select
                    options={[
                      { value: '实时', label: '实时' },
                      { value: '每 5 分钟', label: '每 5 分钟' },
                      { value: '每小时', label: '每小时' },
                      { value: '每日', label: '每日' },
                    ]}
                  />
                </Form.Item>
              </div>
            </div>
            <Form.Item name="tables" label="纳入资产目录的表" rules={[{ required: true, message: '请选择至少一张表' }]}>
              {discoveredSourceTables.length ? (
                <Checkbox.Group
                  className="source-table-picker"
                  options={discoveredSourceTables.map((table) => ({
                    label: `${table.name}${typeof table.rows === 'number' ? ` (${table.rows} 行)` : ''}`,
                    value: table.name,
                  }))}
                />
              ) : (
                <Alert showIcon type="warning" message="请先返回连接步骤，点击测试连接读取真实数据库表。" />
              )}
            </Form.Item>
          </section>}

          {sourceStep === 2 && <section className="source-form-section">
            <div className="source-section-title">
              <Typography.Text strong>归属与使用</Typography.Text>
              <Typography.Text type="secondary">决定这个数据源归谁管理，以及后续能否被 AI、对象建模和图谱使用。</Typography.Text>
            </div>
            <div className="source-governance-panel">
              <div className="source-governance-block">
                <div className="source-governance-head">
                  <Typography.Text strong>资产归属</Typography.Text>
                  <Typography.Text type="secondary">用于目录筛选、责任追踪和后续影响分析。</Typography.Text>
                </div>
                <div className="source-governance-grid">
                  <Form.Item name="business_domain" label="业务域" rules={[{ required: true, message: '请选择业务域' }]}>
                    <Select
                      showSearch
                      optionFilterProp="label"
                      options={businessDomainOptions.map((item) => ({ value: item, label: item }))}
                      placeholder="从数据字典读取"
                    />
                  </Form.Item>
                  <Form.Item name="owner" label="负责人" rules={[{ required: true, message: '请选择负责人' }]}>
                    <Select
                      showSearch
                      optionFilterProp="label"
                      options={governanceUsers.map((user) => ({ value: user.value, label: user.email ? `${user.label} · ${user.email}` : user.label }))}
                      placeholder="从系统用户读取"
                    />
                  </Form.Item>
                </div>
              </div>

              <div className="source-governance-block">
                <div className="source-governance-head">
                  <Typography.Text strong>数据分级</Typography.Text>
                  <Typography.Text type="secondary">分级会影响样例采集、AI 使用和图谱实例授权。</Typography.Text>
                </div>
                <Form.Item name="sensitivity" rules={[{ required: true, message: '请选择数据分级' }]}>
                  <Segmented
                    block
                    options={DATA_SENSITIVITY_OPTIONS.map((item) => ({ value: item.value, label: item.label }))}
                  />
                </Form.Item>
                <div className="source-sensitivity-desc">
                  {DATA_SENSITIVITY_OPTIONS.find((item) => item.value === watchedSensitivity)?.description ?? DATA_SENSITIVITY_OPTIONS[0].description}
                </div>
              </div>

              <div className="source-governance-block">
                <div className="source-governance-head">
                  <Typography.Text strong>使用授权</Typography.Text>
                  <Typography.Text type="secondary">控制扫描后的数据能进入哪些治理能力。</Typography.Text>
                </div>
                <div className="source-governance-switches">
                  <div className="source-permission-toggle">
                    <div>
                      <span><RobotOutlined />AI 使用</span>
                      <em>允许生成语义候选</em>
                    </div>
                    <Form.Item name="allow_ai" valuePropName="checked" noStyle>
                      <Switch disabled={watchedSensitivity === 'restricted'} />
                    </Form.Item>
                  </div>
                  <div className="source-permission-toggle">
                    <div>
                      <span><NodeIndexOutlined />对象建模</span>
                      <em>允许发布对象候选</em>
                    </div>
                    <Form.Item name="allow_ontology" valuePropName="checked" noStyle>
                      <Switch />
                    </Form.Item>
                  </div>
                  <div className="source-permission-toggle">
                    <div>
                      <span><BranchesOutlined />图谱实例</span>
                      <em>允许进入关系图谱</em>
                    </div>
                    <Form.Item name="allow_graph" valuePropName="checked" noStyle>
                      <Switch disabled={watchedSensitivity === 'restricted'} />
                    </Form.Item>
                  </div>
                </div>
              </div>
            </div>
          </section>}
        </Form>
      </div>
    </Modal>
  );
});
