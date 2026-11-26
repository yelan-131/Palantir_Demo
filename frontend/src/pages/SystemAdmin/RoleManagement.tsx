import SettingsTabs from '@/components/SettingsTabs';
import { isPlatformAdmin, useAuthStore } from '@/stores/authStore';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Descriptions,
  Empty,
  Form,
  Input,
  Modal,
  Pagination,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined, RobotOutlined } from '@/components/Icon/ant';
import {
  adminCreateRole,
  adminDeleteRole,
  adminListUsers,
  adminListRoleTemplates,
  adminListRoles,
  adminSetPermissions,
  adminUpdateRole,
  adminUpdateUser,
  getAISettings,
  updateAISettings,
} from '@/services/api';

interface RoleItem {
  id: number;
  name: string;
  label: string;
  description?: string;
  permissions: unknown[];
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

export default function RoleManagement() {
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [bindingOpen, setBindingOpen] = useState(false);
  const [bindingRole, setBindingRole] = useState<RoleItem | null>(null);
  const [bindingUserIds, setBindingUserIds] = useState<number[]>([]);
  const [bindingSaving, setBindingSaving] = useState(false);
  const [roleInfo, setRoleInfo] = useState<RoleItem | null>(null);
  const [roleInfoSaving, setRoleInfoSaving] = useState(false);
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null);
  const [rolePage, setRolePage] = useState(1);
  const [rolePageSize, setRolePageSize] = useState(100);
  const [createForm] = Form.useForm();
  const [roleInfoForm] = Form.useForm<{ label: string; description?: string }>();

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

  const openRoleInfo = (role: RoleItem) => {
    roleInfoForm.setFieldsValue({ label: role.label, description: role.description ?? '' });
    setRoleInfo(role);
  };

  const saveRoleInfo = async (values: { label: string; description?: string }) => {
    if (!roleInfo) return;
    setRoleInfoSaving(true);
    try {
      await adminUpdateRole(roleInfo.id, {
        label: values.label.trim(),
        description: values.description?.trim() || null,
      });
      message.success('角色信息已保存');
      setRoleInfo(null);
      void fetchRoles();
    } catch {
      message.error('保存角色信息失败');
    } finally {
      setRoleInfoSaving(false);
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
          <Typography.Text type="secondary">
            {roles.length} 个角色 · {permissionCount} 条权限规则
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
            scroll={{ x: 372, y: '100%' }}
            pagination={false}
            rowClassName={(role) => (role.id === selectedRoleId ? 'role-row-selected' : '')}
            onRow={(role) => ({
              onClick: () => setSelectedRoleId(role.id),
            })}
            columns={[
              { title: '角色编码', dataIndex: 'name', width: 92, ellipsis: true },
              { title: '显示名称', dataIndex: 'label', width: 112, ellipsis: true },
              { title: '描述', dataIndex: 'description', ellipsis: true },
              {
                title: '绑定用户',
                width: 108,
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
          onEditDetails={openRoleInfo}
          onBindUsers={openUserBinding}
          onDelete={deleteRole}
        />
      </div>

      <Modal
        title="编辑角色信息"
        open={roleInfo !== null}
        onOk={() => roleInfoForm.submit()}
        onCancel={() => setRoleInfo(null)}
        confirmLoading={roleInfoSaving}
        cancelButtonProps={{ disabled: roleInfoSaving }}
        closable={!roleInfoSaving}
        maskClosable={!roleInfoSaving}
        keyboard={!roleInfoSaving}
        okText="保存"
        forceRender
      >
        <Form form={roleInfoForm} layout="vertical" onFinish={saveRoleInfo} disabled={roleInfoSaving}>
          <Form.Item label="角色编码">
            <Input value={roleInfo?.name} readOnly />
          </Form.Item>
          <Form.Item name="label" label="显示名称" rules={[{ required: true, whitespace: true }]}>
            <Input maxLength={200} />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

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

function AIRolePolicyPanel({ role, editable, onEditEnd }: {
  role: RoleItem;
  editable: boolean;
  onEditEnd: () => void;
}) {
  const [form] = Form.useForm();
  const [settings, setSettings] = useState<Record<string, any> | null>(null);
  const [loading, setLoading] = useState(true);
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
      form.resetFields();
      form.setFieldsValue(policy);
    } catch {
      setSettings(null);
      message.error('AI 策略加载失败');
    } finally {
      setLoading(false);
    }
  }, [form, role.name]);

  useEffect(() => { loadPolicy(); }, [loadPolicy, editable]);

  const savePolicy = async (values: Record<string, unknown>) => {
    if (!settings || loading || saving || !editable) return;
    setSaving(true);
    try {
      const policies = Array.isArray(settings.rolePolicies) ? settings.rolePolicies : [];
      const nextPolicy = { ...values, role: role.name };
      const found = policies.some((item: any) => item.role === role.name);
      const nextPolicies = found
        ? policies.map((item: any) => (item.role === role.name ? { ...item, ...nextPolicy } : item))
        : [...policies, nextPolicy];
      await updateAISettings({ rolePolicies: nextPolicies });
      message.success('AI 角色策略已保存');
      onEditEnd();
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
            {editable ? (
              <>
                <Button size="small" onClick={onEditEnd} disabled={saving}>取消</Button>
                <Button size="small" type="primary" onClick={() => form.submit()} loading={saving} disabled={loading || !settings}>保存</Button>
              </>
            ) : (
              <Button size="small" onClick={loadPolicy} loading={loading}>刷新</Button>
            )}
          </Space>
        </Space>
        <Typography.Text type="secondary">
          全局 AI 策略按角色编码匹配，控制 AI 能力、可访问的业务域和写入确认方式。
        </Typography.Text>
        <Form form={form} layout="vertical" onFinish={savePolicy} disabled={!editable || loading || saving || !settings}>
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
  onEditDetails,
  onBindUsers,
  onDelete,
}: {
  role: RoleItem | null;
  users: UserItem[];
  onEditDetails: (role: RoleItem) => void;
  onBindUsers: (role: RoleItem) => void;
  onDelete: (role: RoleItem) => Promise<void>;
}) {
  const [activeTab, setActiveTab] = useState('overview');
  const [editingPolicyRoleId, setEditingPolicyRoleId] = useState<number | null>(null);
  const roleId = role?.id;

  useEffect(() => { setEditingPolicyRoleId(null); }, [roleId]);
  const canManageGlobalSettings = useAuthStore(state => isPlatformAdmin(state.user));

  if (!role) {
    return (
      <aside className="role-preview-panel">
        <Empty description="选择一个角色查看权限范围" />
      </aside>
    );
  }

  const permissions = role.permissions || [];
  const boundUsers = users.filter((user) => user.roles?.some((item) => item.id === role.id || item.name === role.name));
  const visibleTab = activeTab === 'users' || (canManageGlobalSettings && activeTab === 'ai-policy')
    ? activeTab
    : 'overview';
  const editingPolicy = editingPolicyRoleId === role.id;
  const editCurrentSection = () => {
    switch (visibleTab) {
      case 'users':
        return onBindUsers(role);
      case 'ai-policy':
        return setEditingPolicyRoleId(role.id);
      default:
        return onEditDetails(role);
    }
  };

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
      key: 'users',
      label: `用户 (${boundUsers.length})`,
      children: (
        <div className="role-user-list">
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
      children: (
        <AIRolePolicyPanel
          key={role.id}
          role={role}
          editable={editingPolicy}
          onEditEnd={() => setEditingPolicyRoleId((current) => (current === role.id ? null : current))}
        />
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
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={editCurrentSection}
            disabled={visibleTab === 'ai-policy' && editingPolicy}
          >
            编辑
          </Button>
          {role.name !== 'admin' && (
            <Popconfirm title="确定删除该角色？" onConfirm={() => onDelete(role)}>
              <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
            </Popconfirm>
          )}
        </Space>
      </div>

      <SettingsTabs
        className="role-preview-tabs"
        activeKey={visibleTab}
        onChange={(tab) => {
          setActiveTab(tab);
          setEditingPolicyRoleId(null);
        }}
        items={canManageGlobalSettings ? tabs : tabs.filter(tab => tab.key !== 'ai-policy')}
      />

    </aside>
  );
}
