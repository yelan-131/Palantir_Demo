import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Pagination,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined, RobotOutlined } from '@ant-design/icons';
import {
  adminCreateRole,
  adminDeleteRole,
  adminListUsers,
  adminListRoleTemplates,
  adminListRoles,
  adminSetPermissions,
  adminSimulatePermission,
  adminUpdateUser,
  getAISettings,
  updateAISettings,
} from '@/services/api';

interface PermissionItem {
  id?: number;
  resource_type: string;
  resource_key?: string;
  action: string;
  effect?: string;
  data_scope?: string;
  condition_json?: Record<string, unknown> | null;
  field_rules_json?: Record<string, unknown> | null;
  priority?: number;
  enabled?: boolean;
}

interface RoleItem {
  id: number;
  name: string;
  label: string;
  description?: string;
  permissions: PermissionItem[];
}

interface UserItem {
  id: number;
  username: string;
  display_name?: string;
  email?: string;
  is_active: boolean;
  is_admin?: boolean;
  roles?: Array<{ id: number; name: string; label: string }>;
}

const resourceTypes = ['all', 'menu', 'application', 'form', 'workflow', 'report', 'audit', 'data', 'action'];
const actions = ['*', 'view', 'create', 'edit', 'delete', 'approve', 'export', 'publish'];
const dataScopes = ['all', 'self', 'own_org', 'org_tree', 'selected_orgs', 'condition'];

const resourceTypeLabels: Record<string, string> = {
  all: '全部资源',
  menu: '菜单',
  application: '应用',
  form: '表单',
  workflow: '流程',
  report: '报表',
  audit: '审计',
  data: '数据对象',
  action: '操作按钮',
};

const actionLabels: Record<string, string> = {
  '*': '全部动作',
  view: '查看',
  create: '新建',
  edit: '编辑',
  delete: '删除',
  approve: '审批',
  export: '导出',
  publish: '发布',
};

const dataScopeLabels: Record<string, string> = {
  all: '全部数据',
  self: '仅本人',
  own_org: '本部门',
  org_tree: '本部门及下级',
  selected_orgs: '指定组织',
  condition: '按条件规则',
};

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

const aiAgentModeOptions = [
  { label: '只读', value: 'readonly' },
  { label: '仅生成草稿', value: 'draft' },
  { label: '确认后保存/执行', value: 'save_after_confirm' },
  { label: '关闭', value: 'off' },
];

const toOptions = (values: string[], labels: Record<string, string>) => (
  values.map((value) => ({ label: `${labels[value] || value} (${value})`, value }))
);

function parseJson(value?: string) {
  if (!value?.trim()) return null;
  try {
    return JSON.parse(value);
  } catch {
    throw new Error('JSON 格式不正确');
  }
}

function stringifyJson(value: unknown) {
  return value ? JSON.stringify(value, null, 2) : '';
}

export default function RoleManagement() {
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [bindingOpen, setBindingOpen] = useState(false);
  const [bindingRole, setBindingRole] = useState<RoleItem | null>(null);
  const [bindingUserIds, setBindingUserIds] = useState<number[]>([]);
  const [bindingSaving, setBindingSaving] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleItem | null>(null);
  const [simulation, setSimulation] = useState<Record<string, unknown> | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null);
  const [rolePage, setRolePage] = useState(1);
  const [rolePageSize, setRolePageSize] = useState(100);
  const [form] = Form.useForm();
  const [createForm] = Form.useForm();
  const [simulateForm] = Form.useForm();

  const fetchRoles = useCallback(async () => {
    setLoading(true);
    try {
      const [rolesRes, templatesRes, usersRes] = await Promise.all([adminListRoles(), adminListRoleTemplates(), adminListUsers()]);
      setRoles(rolesRes.data?.data || []);
      setTemplates(templatesRes.data?.data || []);
      setUsers(usersRes.data?.data || []);
    } catch {
      message.error('加载角色权限失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRoles(); }, [fetchRoles]);

  useEffect(() => {
    if (!roles.length) {
      setSelectedRoleId(null);
      return;
    }
    if (!selectedRoleId || !roles.some((role) => role.id === selectedRoleId)) {
      setSelectedRoleId(roles[0].id);
    }
  }, [roles, selectedRoleId]);

  const openCreate = () => {
    createForm.resetFields();
    Modal.confirm({
      title: '新建角色',
      width: 520,
      content: (
        <Form form={createForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="template" label="角色模板">
            <Select
              allowClear
              options={templates.map((item) => ({ label: `${item.label} / ${item.key}`, value: item.key }))}
              onChange={(key) => {
                const tpl = templates.find((item) => item.key === key);
                if (tpl) createForm.setFieldsValue({ name: tpl.key, label: tpl.label, description: tpl.description });
              }}
            />
          </Form.Item>
          <Form.Item name="name" label="角色编码" rules={[{ required: true }]}>
            <Input placeholder="business_admin" />
          </Form.Item>
          <Form.Item name="label" label="显示名称" rules={[{ required: true }]}>
            <Input placeholder="业务管理员" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      ),
      onOk: async () => {
        const values = await createForm.validateFields();
        const tpl = templates.find((item) => item.key === values.template);
        const res = await adminCreateRole(values);
        if (tpl?.permissions?.length && res.data?.id) {
          await adminSetPermissions({ role_id: res.data.id, permissions: tpl.permissions });
        }
        message.success('角色已创建');
        fetchRoles();
      },
    });
  };

  const openPermissions = (role: RoleItem) => {
    setEditingRole(role);
    form.setFieldsValue({
      permissions: (role.permissions || []).map((item) => ({
        ...item,
        effect: item.effect || 'allow',
        data_scope: item.data_scope || 'all',
        priority: item.priority ?? 100,
        enabled: item.enabled !== false,
        condition_json_text: stringifyJson(item.condition_json),
        field_rules_json_text: stringifyJson(item.field_rules_json),
      })),
    });
    setDrawerOpen(true);
  };

  const savePermissions = async () => {
    if (!editingRole) return;
    const values = await form.validateFields();
    try {
      const permissions = (values.permissions || []).map((item: any) => ({
        resource_type: item.resource_type,
        resource_key: item.resource_key || '*',
        action: item.action,
        effect: item.effect || 'allow',
        data_scope: item.data_scope || 'all',
        condition_json: parseJson(item.condition_json_text),
        field_rules_json: parseJson(item.field_rules_json_text),
        priority: item.priority ?? 100,
        enabled: item.enabled !== false,
      }));
      await adminSetPermissions({ role_id: editingRole.id, permissions });
      message.success('权限矩阵已保存');
      setDrawerOpen(false);
      fetchRoles();
    } catch (error: any) {
      message.error(error?.message || '保存失败');
    }
  };

  const runSimulation = async () => {
    const values = await simulateForm.validateFields();
    try {
      const payload = {
        ...values,
        user_id: Number(values.user_id),
        form_id: values.form_id ? Number(values.form_id) : undefined,
        record: parseJson(values.record_json) || {},
      };
      const res = await adminSimulatePermission(payload);
      setSimulation(res.data?.data || {});
    } catch (error: any) {
      message.error(error?.message || '模拟失败');
    }
  };

  const permissionCount = useMemo(
    () => roles.reduce((sum, role) => sum + (role.permissions?.length || 0), 0),
    [roles],
  );

  const selectedRole = useMemo(
    () => roles.find((role) => role.id === selectedRoleId) || null,
    [roles, selectedRoleId],
  );

  const pagedRoles = useMemo(() => {
    const start = (rolePage - 1) * rolePageSize;
    return roles.slice(start, start + rolePageSize);
  }, [roles, rolePage, rolePageSize]);

  const getBoundUsers = useCallback(
    (role: RoleItem) => users.filter((user) => user.roles?.some((item) => item.id === role.id || item.name === role.name)),
    [users],
  );

  const deleteRole = async (role: RoleItem) => {
    await adminDeleteRole(role.id);
    message.success('角色已删除');
    fetchRoles();
  };

  const openUserBinding = (role: RoleItem) => {
    const boundIds = users
      .filter((user) => user.roles?.some((item) => item.id === role.id || item.name === role.name))
      .map((user) => user.id);
    setBindingRole(role);
    setBindingUserIds(boundIds);
    setBindingOpen(true);
  };

  const saveUserBinding = async () => {
    if (!bindingRole) return;
    setBindingSaving(true);
    try {
      const selectedIds = new Set(bindingUserIds);
      await Promise.all(users.map((user) => {
        const currentRoleIds = new Set((user.roles || []).map((role) => role.id));
        const mustKeepAdminRole = bindingRole.name === 'admin' && user.username === 'admin';
        if (selectedIds.has(user.id) || mustKeepAdminRole) {
          currentRoleIds.add(bindingRole.id);
        } else {
          currentRoleIds.delete(bindingRole.id);
        }
        return adminUpdateUser(user.id, { role_ids: Array.from(currentRoleIds) });
      }));
      message.success('角色用户绑定已更新');
      setBindingOpen(false);
      fetchRoles();
    } catch {
      message.error('更新角色用户绑定失败');
    } finally {
      setBindingSaving(false);
    }
  };

  return (
    <div className="role-management-console">
      <div className="role-management-toolbar">
        <div>
          <Typography.Title level={5} style={{ margin: 0 }}>角色管理</Typography.Title>
          <Typography.Text type="secondary">
            按角色分配应用、表单、字段、数据范围和操作权限，共 {roles.length} 个角色 / {permissionCount} 条权限规则
          </Typography.Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} loading={loading} onClick={fetchRoles} />
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建角色</Button>
        </Space>
      </div>

      <div className="role-management-workbench">
        <div className="role-list-panel">
          <Table
            dataSource={pagedRoles}
            rowKey="id"
            loading={loading}
            size="small"
            className="role-management-table"
            scroll={{ x: 1300, y: '100%' }}
            pagination={false}
            rowClassName={(role) => (role.id === selectedRoleId ? 'role-row-selected' : '')}
            onRow={(role) => ({
              onClick: () => setSelectedRoleId(role.id),
            })}
            columns={[
              { title: '角色编码', dataIndex: 'name', width: 180 },
              { title: '显示名称', dataIndex: 'label', width: 170 },
              { title: '描述', dataIndex: 'description', width: 330, ellipsis: true },
              {
                title: '绑定用户',
                width: 280,
                render: (_value, role: RoleItem) => {
                  const boundUsers = getBoundUsers(role);
                  return boundUsers.length ? (
                    <span className="management-tag-line">
                      {boundUsers.slice(0, 2).map((user) => (
                        <Tag key={user.id} color={user.is_admin ? 'red' : 'green'}>
                          {user.display_name || user.username}
                        </Tag>
                      ))}
                      {boundUsers.length > 2 && <Tag>+{boundUsers.length - 2}</Tag>}
                    </span>
                  ) : (
                    <Typography.Text type="secondary">未绑定</Typography.Text>
                  );
                },
              },
              {
                title: '权限',
                width: 150,
                align: 'center',
                render: (_value, role: RoleItem) => <Tag color="blue">{role.permissions?.length || 0} 条</Tag>,
              },
              {
                title: '操作',
                width: 190,
                fixed: 'right',
                render: (_value, role: RoleItem) => (
                  <Space size={4} onClick={(event) => event.stopPropagation()}>
                    <Button size="small" icon={<EditOutlined />} onClick={() => openPermissions(role)}>权限</Button>
                    <Button size="small" onClick={() => openUserBinding(role)}>用户</Button>
                    {role.name !== 'admin' && (
                      <Popconfirm title="确定删除该角色？" onConfirm={() => deleteRole(role)}>
                        <Button size="small" danger icon={<DeleteOutlined />} />
                      </Popconfirm>
                    )}
                  </Space>
                ),
              },
            ]}
          />
          <div className="role-management-pagination">
            <Pagination
              current={rolePage}
              pageSize={rolePageSize}
              total={roles.length}
              showSizeChanger
              pageSizeOptions={[20, 50, 100, 200]}
              showTotal={(total) => `共 ${total} 个角色`}
              onChange={(page, pageSize) => {
                setRolePage(page);
                setRolePageSize(pageSize);
              }}
            />
          </div>
        </div>

        <RolePreviewPanel
          role={selectedRole}
          users={users}
          totalRoles={roles.length}
          totalPermissions={permissionCount}
          onEdit={openPermissions}
          onBindUsers={openUserBinding}
          onDelete={deleteRole}
        />
      </div>

      <Drawer
        title={`配置角色权限 - ${editingRole?.label || ''}`}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width="min(560px, calc(100vw - 180px))"
        extra={<Button type="primary" onClick={savePermissions}>保存</Button>}
      >
        <Tabs
          items={[
            {
              key: 'rules',
              label: '权限规则',
              children: (
                <Form form={form} layout="vertical" className="role-permission-editor">
                  <Form.List name="permissions">
                    {(fields, { add, remove }) => (
                      <div className="role-permission-rule-list">
                        <div className="role-permission-rule-toolbar">
                          <Button
                            icon={<PlusOutlined />}
                            onClick={() => add({
                              resource_type: 'form',
                              resource_key: '*',
                              action: 'view',
                              effect: 'allow',
                              data_scope: 'all',
                              priority: 100,
                              enabled: true,
                            })}
                          >
                            添加授权
                          </Button>
                          <Typography.Text type="secondary">
                            {fields.length} 条授权，拒绝优先；高级条件默认收起
                          </Typography.Text>
                        </div>
                        {fields.map((field, index) => (
                          <div key={field.key} className="role-permission-rule-card">
                            <div className="role-permission-rule-head">
                              <div className="role-permission-rule-title">
                                <Typography.Text strong>授权 {index + 1}</Typography.Text>
                                <label className="role-permission-enable">
                                  <Form.Item {...field} name={[field.name, 'enabled']} valuePropName="checked" noStyle>
                                    <Switch size="small" />
                                  </Form.Item>
                                  <span>启用</span>
                                </label>
                              </div>
                              <Button size="small" danger onClick={() => remove(field.name)}>删除</Button>
                            </div>
                            <div className="role-permission-card-body">
                              <section className="role-permission-target-row">
                                <Typography.Text type="secondary">授权对象</Typography.Text>
                                <div className="role-permission-target-fields">
                                  <Form.Item {...field} name={[field.name, 'resource_type']} rules={[{ required: true }]}>
                                    <Select placeholder="资源类型" options={toOptions(resourceTypes, resourceTypeLabels)} />
                                  </Form.Item>
                                  <Form.Item {...field} name={[field.name, 'resource_key']}>
                                    <Input placeholder="全部填 *，或输入资源编码" />
                                  </Form.Item>
                                </div>
                              </section>
                              <div className="role-permission-action-grid">
                                <Form.Item {...field} name={[field.name, 'effect']} label="授权结果" rules={[{ required: true }]}>
                                  <Select options={[{ label: '允许', value: 'allow' }, { label: '拒绝', value: 'deny' }]} />
                                </Form.Item>
                                <Form.Item {...field} name={[field.name, 'action']} label="可执行动作" rules={[{ required: true }]}>
                                  <Select options={toOptions(actions, actionLabels)} />
                                </Form.Item>
                                <Form.Item {...field} name={[field.name, 'data_scope']} label="数据范围">
                                  <Select options={toOptions(dataScopes, dataScopeLabels)} />
                                </Form.Item>
                              </div>
                            </div>
                            <details className="role-permission-advanced">
                              <summary>高级规则（条件、字段、优先级）</summary>
                              <div className="role-permission-advanced-grid">
                                <Form.Item {...field} name={[field.name, 'priority']} label="优先级">
                                  <InputNumber min={1} />
                                </Form.Item>
                                <Form.Item
                                  {...field}
                                  name={[field.name, 'condition_json_text']}
                                  label="条件规则"
                                >
                                  <Input.TextArea rows={2} placeholder='{"rules":[{"field":"org_id","op":"in","value":"$current_org_ids"}]}' />
                                </Form.Item>
                                <Form.Item
                                  {...field}
                                  name={[field.name, 'field_rules_json_text']}
                                  label="字段规则"
                                >
                                  <Input.TextArea rows={2} placeholder='{"fields":{"cost":{"visible":false,"editable":false}}}' />
                                </Form.Item>
                              </div>
                            </details>
                          </div>
                        ))}
                      </div>
                    )}
                  </Form.List>
                </Form>
              ),
            },
            {
              key: 'simulation',
              label: '权限模拟',
              children: (
                <>
                  <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message="用一个用户和一条资源请求测试最终权限结果"
                    description="模拟会返回 allow/deny、命中的规则和原因，适合排查为什么某个用户看不到表单或不能编辑字段。"
                  />
                  <Form form={simulateForm} layout="inline" style={{ rowGap: 12 }}>
                    <Form.Item name="user_id" label="用户 ID" rules={[{ required: true }]}>
                      <InputNumber min={1} />
                    </Form.Item>
                    <Form.Item name="resource_type" label="资源类型" initialValue="form">
                      <Select style={{ width: 160 }} options={toOptions(resourceTypes, resourceTypeLabels)} />
                    </Form.Item>
                    <Form.Item name="resource_key" label="资源 Key" initialValue="*">
                      <Input style={{ width: 150 }} />
                    </Form.Item>
                    <Form.Item name="action" label="动作" initialValue="view">
                      <Select style={{ width: 130 }} options={toOptions(actions, actionLabels)} />
                    </Form.Item>
                    <Form.Item name="form_id" label="表单 ID">
                      <InputNumber min={1} />
                    </Form.Item>
                    <Form.Item name="field_name" label="字段">
                      <Input style={{ width: 120 }} />
                    </Form.Item>
                    <Form.Item name="record_json" label="记录 JSON">
                      <Input style={{ width: 240 }} placeholder='{"org_id":1}' />
                    </Form.Item>
                    <Button onClick={runSimulation}>模拟</Button>
                  </Form>
                  {simulation && (
                    <pre style={{ marginTop: 12, background: '#f7f7f7', padding: 12, borderRadius: 8 }}>
                      {JSON.stringify(simulation, null, 2)}
                    </pre>
                  )}
                </>
              ),
            },
          ]}
        />
      </Drawer>

      <Modal
        title={`绑定用户 - ${bindingRole?.label || ''}`}
        open={bindingOpen}
        onOk={saveUserBinding}
        onCancel={() => setBindingOpen(false)}
        confirmLoading={bindingSaving}
        destroyOnClose
      >
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Typography.Text type="secondary">
            选择需要绑定到该角色的用户，保存后会同步更新用户的角色集合。
          </Typography.Text>
          <Select
            mode="multiple"
            value={bindingUserIds}
            onChange={setBindingUserIds}
            style={{ width: '100%' }}
            optionFilterProp="label"
            options={users.map((user) => ({
              label: `${user.display_name || user.username} / ${user.username}`,
              value: user.id,
              disabled: bindingRole?.name === 'admin' && user.username === 'admin',
            }))}
          />
        </Space>
      </Modal>
    </div>
  );
}

function AIRolePolicyPanel({ role }: { role: RoleItem }) {
  const [form] = Form.useForm();
  const [settings, setSettings] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadPolicy = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getAISettings();
      const nextSettings = response.data?.settings || response.data?.data?.settings || response.data?.data || {};
      const policies = Array.isArray(nextSettings.rolePolicies) ? nextSettings.rolePolicies : [];
      const policy = policies.find((item: any) => item.role === role.name) || {
        role: role.name,
        enabled: true,
        capabilities: role.name === 'admin' ? ['qa', 'rag', 'business_query', 'report', 'draft', 'save_draft', 'workflow', 'config'] : ['qa', 'rag', 'report'],
        domains: [],
        agentMode: role.name === 'viewer' ? 'readonly' : 'save_after_confirm',
      };
      setSettings(nextSettings);
      form.setFieldsValue(policy);
    } catch {
      message.error('AI 策略加载失败');
    } finally {
      setLoading(false);
    }
  }, [form, role.name]);

  useEffect(() => { loadPolicy(); }, [loadPolicy]);

  const savePolicy = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const policies = Array.isArray(settings.rolePolicies) ? settings.rolePolicies : [];
      const nextPolicy = { ...values, role: role.name };
      const found = policies.some((item: any) => item.role === role.name);
      const nextPolicies = found
        ? policies.map((item: any) => (item.role === role.name ? nextPolicy : item))
        : [...policies, nextPolicy];
      await updateAISettings({ rolePolicies: nextPolicies });
      message.success('AI 角色策略已保存');
      loadPolicy();
    } catch {
      message.error('AI 角色策略保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="role-section-card">
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        <Space align="center" style={{ justifyContent: 'space-between', width: '100%' }}>
          <Space>
            <RobotOutlined />
            <Typography.Text strong>{role.label} 的 AI 策略</Typography.Text>
          </Space>
          <Space>
            <Button size="small" onClick={loadPolicy} loading={loading}>刷新</Button>
            <Button size="small" type="primary" onClick={savePolicy} loading={saving}>保存</Button>
          </Space>
        </Space>
        <Typography.Text type="secondary">
          这里控制当前角色能使用哪些 AI 能力、可进入哪些业务域，以及写入动作是否必须先确认。
        </Typography.Text>
        <Form form={form} layout="vertical">
          <Form.Item name="enabled" label="启用该角色 AI 策略" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="agentMode" label="Agent 执行模式" rules={[{ required: true }]}>
            <Select options={aiAgentModeOptions} />
          </Form.Item>
          <Form.Item name="capabilities" label="AI 能力" rules={[{ required: true }]}>
            <Select mode="multiple" options={aiCapabilityOptions} />
          </Form.Item>
          <Form.Item name="domains" label="可访问业务域">
            <Select mode="multiple" options={aiDomainOptions} />
          </Form.Item>
        </Form>
      </Space>
    </section>
  );
}

function RolePreviewPanel({
  role,
  users,
  totalRoles,
  totalPermissions,
  onEdit,
  onBindUsers,
  onDelete,
}: {
  role: RoleItem | null;
  users: UserItem[];
  totalRoles: number;
  totalPermissions: number;
  onEdit: (role: RoleItem) => void;
  onBindUsers: (role: RoleItem) => void;
  onDelete: (role: RoleItem) => Promise<void>;
}) {
  const [activeTab, setActiveTab] = useState('overview');

  if (!role) {
    return (
      <aside className="role-preview-panel">
        <Empty description="选择一个角色查看权限范围" />
      </aside>
    );
  }

  const permissions = role.permissions || [];
  const allowCount = permissions.filter((item) => (item.effect || 'allow') === 'allow').length;
  const denyCount = permissions.filter((item) => item.effect === 'deny').length;
  const scopedCount = permissions.filter((item) => item.data_scope && item.data_scope !== 'all').length;
  const disabledCount = permissions.filter((item) => item.enabled === false).length;
  const boundUsers = users.filter((user) => user.roles?.some((item) => item.id === role.id || item.name === role.name));
  const resourceStats = resourceTypes
    .map((type) => ({
      type,
      count: permissions.filter((item) => item.resource_type === type).length,
    }))
    .filter((item) => item.count > 0);

  const tabs = [
    {
      key: 'overview',
      label: '详情',
      children: (
        <div className="role-detail-grid">
          <section className="role-info-card">
            <Typography.Text strong>基本信息</Typography.Text>
            <Descriptions column={1} size="small">
              <Descriptions.Item label="角色编码">{role.name}</Descriptions.Item>
              <Descriptions.Item label="显示名称">{role.label}</Descriptions.Item>
              <Descriptions.Item label="描述">{role.description || '-'}</Descriptions.Item>
              <Descriptions.Item label="权限规则">{permissions.length}</Descriptions.Item>
              <Descriptions.Item label="系统角色">{role.name === 'admin' ? '是' : '否'}</Descriptions.Item>
            </Descriptions>
          </section>
        </div>
      ),
    },
    {
      key: 'summary',
      label: '权限概览',
      children: (
        <section className="role-impact-card">
          <Typography.Text strong>权限概览</Typography.Text>
          <div className="role-preview-stats">
            <div><span>允许</span><strong>{allowCount}</strong></div>
            <div><span>拒绝</span><strong>{denyCount}</strong></div>
            <div><span>数据范围</span><strong>{scopedCount}</strong></div>
            <div><span>停用规则</span><strong>{disabledCount}</strong></div>
          </div>
        </section>
      ),
    },
    {
      key: 'rules',
      label: `权限规则 (${permissions.length})`,
      children: (
        <div className="role-rule-list">
          {permissions.length ? permissions.slice(0, 12).map((item, index) => (
            <div className="role-rule-item" key={`${item.resource_type}-${item.resource_key}-${item.action}-${index}`}>
              <span>{index + 1}</span>
              <div>
                <strong>{resourceTypeLabels[item.resource_type] || item.resource_type}</strong>
                <small>{item.resource_key || '*'}</small>
              </div>
              <Tag color={(item.effect || 'allow') === 'allow' ? 'green' : 'red'}>
                {(item.effect || 'allow') === 'allow' ? '允许' : '拒绝'}
              </Tag>
              <Tag color="blue">{actionLabels[item.action] || item.action}</Tag>
            </div>
          )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无权限规则" />}
          {permissions.length > 12 && (
            <Typography.Text type="secondary">还有 {permissions.length - 12} 条规则，请进入权限矩阵查看。</Typography.Text>
          )}
        </div>
      ),
    },
    {
      key: 'users',
      label: `用户 (${boundUsers.length})`,
      children: (
        <div className="role-user-list">
          <div className="role-user-list-head">
            <Typography.Text strong>绑定用户</Typography.Text>
            <Button size="small" onClick={() => onBindUsers(role)}>绑定用户</Button>
          </div>
          {boundUsers.length ? boundUsers.map((user) => (
            <div className="role-user-row" key={user.id}>
              <div>
                <strong>{user.display_name || user.username}</strong>
                <small>{user.username} / {user.email || '未配置邮箱'}</small>
              </div>
              {user.is_admin && <Tag color="red">管理员</Tag>}
              {user.is_active ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>}
            </div>
          )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无绑定用户" />}
        </div>
      ),
    },
    {
      key: 'ai-policy',
      label: 'AI 策略',
      children: <AIRolePolicyPanel role={role} />,
    },
    {
      key: 'scope',
      label: '资源分布',
      children: (
        <div className="role-scope-list">
          {resourceStats.length ? resourceStats.map((item) => (
            <div key={item.type}>
              <span>{resourceTypeLabels[item.type] || item.type}</span>
              <strong>{item.count}</strong>
            </div>
          )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无资源分布" />}
          <section className="role-section-card">
            <Typography.Text strong>全局统计</Typography.Text>
            <Descriptions column={1} size="small">
              <Descriptions.Item label="角色总数">{totalRoles}</Descriptions.Item>
              <Descriptions.Item label="权限规则总数">{totalPermissions}</Descriptions.Item>
              <Descriptions.Item label="当前角色占比">
                {totalPermissions ? `${Math.round((permissions.length / totalPermissions) * 100)}%` : '0%'}
              </Descriptions.Item>
            </Descriptions>
          </section>
        </div>
      ),
    },
  ];

  return (
    <aside className="role-preview-panel">
      <div className="role-preview-head">
        <div>
          <Space size={6} wrap>
            <Typography.Title level={5}>{role.label}</Typography.Title>
            <Tag color={role.name === 'admin' ? 'gold' : 'blue'}>{role.name === 'admin' ? '系统角色' : '业务角色'}</Tag>
          </Space>
        </div>
        <Space className="role-head-actions" wrap>
          <Button size="small" icon={<EditOutlined />} onClick={() => onEdit(role)}>权限矩阵</Button>
          <Button size="small" onClick={() => onBindUsers(role)}>绑定用户</Button>
          {role.name !== 'admin' && (
            <Popconfirm title="确定删除该角色？" onConfirm={() => onDelete(role)}>
              <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
            </Popconfirm>
          )}
        </Space>
      </div>

      <Tabs
        className="role-preview-tabs"
        activeKey={activeTab}
        onChange={setActiveTab}
        items={tabs}
      />

    </aside>
  );
}
