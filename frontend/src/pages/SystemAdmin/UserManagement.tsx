import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Key, ReactNode } from 'react';
import {
  CloseOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import {
  Avatar,
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
  Tabs,
  Tag,
  Typography,
  Upload,
  message,
} from 'antd';
import type { UploadFile } from 'antd/es/upload/interface';
import {
  adminCreateUser,
  adminDeleteUser,
  adminListOrgUnits,
  adminListRoles,
  adminListUserSessions,
  adminListUsers,
  adminRevokeSession,
  adminUpdateUser,
  adminUpdateUserSecurity,
} from '@/services/api';
import { formatServerDateTime } from '@/utils/dateTime';

interface RoleItem { id: number; name: string; label: string }
interface OrgUnitItem { id: number; name: string; org_type: string }
interface UserItem {
  id: number;
  username: string;
  display_name?: string;
  email?: string;
  avatar_url?: string | null;
  is_active: boolean;
  is_admin: boolean;
  roles: RoleItem[];
  org_units?: Array<{ id: number; name: string; position_title?: string; is_primary?: boolean }>;
  login_failed_count?: number;
  locked_until?: string | null;
  force_password_change?: boolean;
  last_login_at?: string | null;
  last_login_ip?: string | null;
  mfa_enabled?: boolean;
  sso_provider?: string | null;
  sso_subject?: string | null;
}

type ImportRow = Record<string, string>;

const csvHeaders = 'username,display_name,email,avatar_url,password,role_names,org_names,is_active';
const visibleTagCount = 2;

function renderCompactTags<T>(
  items: T[] | undefined,
  getKey: (item: T) => Key,
  getLabel: (item: T) => ReactNode,
  getColor: (item: T) => string,
  emptyText = '未分配',
) {
  const safeItems = items || [];
  if (!safeItems.length) return <Typography.Text type="secondary">{emptyText}</Typography.Text>;
  return (
    <span className="management-tag-line">
      {safeItems.slice(0, visibleTagCount).map((item) => (
        <Tag key={getKey(item)} color={getColor(item)}>{getLabel(item)}</Tag>
      ))}
      {safeItems.length > visibleTagCount && <Tag>+{safeItems.length - visibleTagCount}</Tag>}
    </span>
  );
}

function getUserAvatarText(user: UserItem) {
  const source = user.display_name || user.username || '?';
  return source.trim().slice(0, 1).toUpperCase();
}

function normalizeUserPayload(values: any) {
  return {
    ...values,
    role_ids: values.role_ids || [],
    org_unit_ids: values.org_unit_ids || [],
    primary_org_unit_id: values.primary_org_unit_id || values.org_unit_ids?.[0],
  };
}

function getUserFormValues(user: UserItem) {
  const primary = user.org_units?.find((org) => org.is_primary) || user.org_units?.[0];
  return {
    username: user.username,
    display_name: user.display_name,
    email: user.email,
    avatar_url: user.avatar_url,
    is_active: user.is_active,
    is_admin: user.is_admin,
    role_ids: user.roles?.map((role) => role.id) || [],
    org_unit_ids: user.org_units?.map((org) => org.id) || [],
    primary_org_unit_id: primary?.id,
    position_title: primary?.position_title,
  };
}

export default function UserManagement() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [orgUnits, setOrgUnits] = useState<OrgUnitItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importFiles, setImportFiles] = useState<UploadFile[]>([]);
  const [editingUser, setEditingUser] = useState<UserItem | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [userPage, setUserPage] = useState(1);
  const [userPageSize, setUserPageSize] = useState(100);
  const [form] = Form.useForm();
  const [securityForm] = Form.useForm();

  const orgOptions = useMemo(
    () => orgUnits.map((org) => ({ label: `${org.name} / ${org.org_type}`, value: org.id })),
    [orgUnits],
  );

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [uRes, rRes, oRes] = await Promise.all([adminListUsers(), adminListRoles(), adminListOrgUnits()]);
      setUsers(uRes.data?.data || []);
      setRoles((rRes.data?.data || []).map((role: any) => ({ id: role.id, name: role.name, label: role.label })));
      setOrgUnits(oRes.data?.data || []);
    } catch {
      message.error('加载用户与权限数据失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (!users.length) {
      setSelectedUserId(null);
      return;
    }
    if (!selectedUserId || !users.some((user) => user.id === selectedUserId)) {
      setSelectedUserId(users[0].id);
    }
  }, [users, selectedUserId]);

  const openCreate = () => {
    form.resetFields();
    form.setFieldsValue({ is_active: true, is_admin: false, role_ids: [], org_unit_ids: [] });
    setCreateOpen(true);
  };

  const submitCreateUser = async () => {
    const values = await form.validateFields();
    try {
      await adminCreateUser(normalizeUserPayload(values));
      message.success('用户已创建');
      setCreateOpen(false);
      await fetchData();
    } catch {
      message.error('创建用户失败');
    }
  };

  const saveUserInline = async (record: UserItem, values: any) => {
    const payload = normalizeUserPayload(values);
    const { username, password, ...updates } = payload;
    void username;
    void password;
    try {
      await adminUpdateUser(record.id, updates);
      message.success('用户已更新');
      await fetchData();
    } catch {
      message.error('更新用户失败');
      throw new Error('update-user-failed');
    }
  };




  const deleteUser = async (record: UserItem) => {
    await adminDeleteUser(record.id);
    message.success('用户已删除');
    await fetchData();
  };

  const importUsers = async () => {
    const file = importFiles[0]?.originFileObj;
    if (!file) {
      message.warning('请选择 CSV 文件');
      return;
    }
    setImporting(true);
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      const roleMap = new Map<string, number>();
      roles.forEach((role) => {
        roleMap.set(role.name, role.id);
        roleMap.set(role.label, role.id);
      });
      const orgMap = new Map<string, number>();
      orgUnits.forEach((org) => orgMap.set(org.name, org.id));
      let success = 0;
      for (const row of rows) {
        if (!row.username) continue;
        const roleIds = splitList(row.role_names).map((name) => roleMap.get(name)).filter((id): id is number => Boolean(id));
        const orgIds = splitList(row.org_names).map((name) => orgMap.get(name)).filter((id): id is number => Boolean(id));
        await adminCreateUser({
          username: row.username,
          display_name: row.display_name || row.username,
          email: row.email,
          avatar_url: row.avatar_url,
          password: row.password || 'ChangeMe123!',
          role_ids: roleIds,
          org_unit_ids: orgIds,
          primary_org_unit_id: orgIds[0],
          is_active: row.is_active !== 'false',
        });
        success += 1;
      }
      message.success(`已导入 ${success} 个用户`);
      setImportOpen(false);
      setImportFiles([]);
      await fetchData();
    } catch {
      message.error('导入用户失败');
    } finally {
      setImporting(false);
    }
  };

  const selectedUser = useMemo(
    () => users.find((user) => user.id === selectedUserId) || null,
    [users, selectedUserId],
  );

  const pagedUsers = useMemo(() => {
    const start = (userPage - 1) * userPageSize;
    return users.slice(start, start + userPageSize);
  }, [users, userPage, userPageSize]);

  return (
    <div className="user-management-console">
      <div className="user-management-toolbar">
        <div>
          <Typography.Title level={5} style={{ margin: 0 }}>用户管理</Typography.Title>
          <Typography.Text type="secondary">账号、角色、组织、SSO 绑定、MFA 状态和会话治理。</Typography.Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} loading={loading} onClick={fetchData} />
          <Button icon={<UploadOutlined />} onClick={() => setImportOpen(true)}>导入</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建用户</Button>
        </Space>
      </div>

      <div className="user-management-workbench">
        <div className="user-list-panel">
          <Table<UserItem>
            dataSource={pagedUsers}
            rowKey="id"
            loading={loading}
            size="small"
            className="user-management-table"
            scroll={{ x: 1110, y: '100%' }}
            pagination={false}
            rowClassName={(record) => (record.id === selectedUserId ? 'user-row-selected' : '')}
            onRow={(record) => ({ onClick: () => setSelectedUserId(record.id) })}
            columns={[
              {
                title: '头像',
                width: 64,
                align: 'center',
                render: (_value, record) => (
                  <Avatar className="user-table-avatar" size={28} src={record.avatar_url || undefined}>
                    {getUserAvatarText(record)}
                  </Avatar>
                ),
              },
              { title: '账号', dataIndex: 'username', width: 130 },
              { title: '姓名', dataIndex: 'display_name', width: 150 },
              { title: '邮箱', dataIndex: 'email', width: 210, ellipsis: true },
              {
                title: '角色',
                dataIndex: 'roles',
                width: 210,
                render: (items: RoleItem[]) => renderCompactTags(items, (role) => role.id, (role) => role.label, () => 'blue'),
              },
              {
                title: '组织',
                dataIndex: 'org_units',
                width: 200,
                render: (items: UserItem['org_units']) => renderCompactTags(
                  items,
                  (org) => org.id,
                  (org) => org.name,
                  (org) => (org.is_primary ? 'green' : 'default'),
                ),
              },
              {
                title: '安全状态',
                width: 190,
                render: (_value, record) => (
                  <Space size={4} wrap>
                    {record.is_active ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>}
                    {record.is_admin && <Tag color="red">管理员</Tag>}
                    {record.locked_until && <Tag color="red">锁定</Tag>}
                    {record.force_password_change && <Tag color="orange">强制改密</Tag>}
                    {record.mfa_enabled && <Tag color="blue">MFA</Tag>}
                    {record.sso_subject && <Tag color="purple">SSO</Tag>}
                  </Space>
                ),
              },
              {
                title: '最近登录',
                width: 160,
                render: (_value, record) => formatServerDateTime(record.last_login_at),
              },
            ]}
          />
          <div className="user-management-pagination">
            <Pagination
              current={userPage}
              pageSize={userPageSize}
              total={users.length}
              showSizeChanger
              pageSizeOptions={[20, 50, 100, 200]}
              showTotal={(total) => `共 ${total} 个用户`}
              onChange={(page, pageSize) => {
                setUserPage(page);
                setUserPageSize(pageSize);
              }}
            />
          </div>
        </div>

        <UserPreviewPanel
          user={selectedUser}
          roles={roles}
          orgOptions={orgOptions}
          onSave={saveUserInline}
          onDelete={deleteUser}
        />
      </div>

      <Modal title="新建用户" open={createOpen} onOk={submitCreateUser} onCancel={() => setCreateOpen(false)} destroyOnClose>
        <Form form={form} layout="vertical">
          <Form.Item label="账号" name="username" rules={[{ required: true }]}>
            <Input placeholder="login_name" />
          </Form.Item>
          <Form.Item label="姓名" name="display_name"><Input /></Form.Item>
          <Form.Item label="邮箱" name="email"><Input /></Form.Item>
          <Form.Item label="头像地址" name="avatar_url"><Input placeholder="https://... 或 /assets/avatar.png" /></Form.Item>
          <Form.Item label="初始密码" name="password" rules={[{ required: true }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item label="角色" name="role_ids"><Select mode="multiple" options={roles.map((role) => ({ label: role.label, value: role.id }))} /></Form.Item>
          <Form.Item label="所属组织" name="org_unit_ids"><Select mode="multiple" options={orgOptions} /></Form.Item>
          <Form.Item label="主组织" name="primary_org_unit_id"><Select allowClear options={orgOptions} /></Form.Item>
          <Form.Item label="岗位" name="position_title"><Input /></Form.Item>
          <Space size={24}>
            <Form.Item label="启用" name="is_active" valuePropName="checked"><Switch /></Form.Item>
            <Form.Item label="超级管理员" name="is_admin" valuePropName="checked"><Switch /></Form.Item>
          </Space>
        </Form>
      </Modal>

      <Modal title="导入用户" open={importOpen} onOk={importUsers} onCancel={() => setImportOpen(false)} confirmLoading={importing} okText="开始导入" destroyOnClose>
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Typography.Text type="secondary">
            支持 CSV 文件，表头：{csvHeaders}。角色和组织按名称匹配，多个值用英文分号分隔。
          </Typography.Text>
          <Upload.Dragger accept=".csv,text/csv" beforeUpload={() => false} fileList={importFiles} maxCount={1} onChange={({ fileList }) => setImportFiles(fileList)}>
            <p className="ant-upload-drag-icon"><UploadOutlined /></p>
            <p className="ant-upload-text">点击或拖拽 CSV 到这里</p>
          </Upload.Dragger>
        </Space>
      </Modal>


    </div>
  );
}

function UserPreviewPanel({
  user,
  roles,
  orgOptions,
  onSave,
  onDelete,
}: {
  user: UserItem | null;
  roles: RoleItem[];
  orgOptions: Array<{ label: string; value: number }>;
  onSave: (record: UserItem, values: any) => Promise<void>;
  onDelete: (record: UserItem) => Promise<void>;
}) {
  const [activeTab, setActiveTab] = useState('overview');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sessions, setSessions] = useState<any[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [inlineForm] = Form.useForm();

  const loadSessions = useCallback(async (record: UserItem) => {
    setSessionsLoading(true);
    try {
      const res = await adminListUserSessions(record.id);
      setSessions(res.data?.data || []);
    } catch {
      setSessions([]);
      message.error('加载会话失败');
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    setEditing(false);
    inlineForm.setFieldsValue(getUserFormValues(user));
    setSessions([]);
  }, [inlineForm, user?.id]);

  useEffect(() => {
    if (!user) return;
    inlineForm.setFieldsValue(getUserFormValues(user));
  }, [inlineForm, user]);

  useEffect(() => {
    if (user && activeTab === 'sessions') {
      loadSessions(user);
    }
  }, [activeTab, loadSessions, user]);

  if (!user) {
    return (
      <aside className="user-preview-panel">
        <Empty description="选择一个用户查看账号治理信息" />
      </aside>
    );
  }

  const saveEdit = async () => {
    const values = await inlineForm.validateFields();
    setSaving(true);
    try {
      await onSave(user, values);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const cancelEdit = () => {
    inlineForm.setFieldsValue(getUserFormValues(user));
    setEditing(false);
  };

  const securityRisks = [
    user.locked_until ? '账号当前处于锁定状态' : '',
    (user.login_failed_count || 0) > 0 ? `存在 ${user.login_failed_count} 次失败登录` : '',
    user.force_password_change ? '用户下次登录需要修改密码' : '',
    user.is_admin && !user.mfa_enabled ? '管理员账号未启用 MFA' : '',
    !user.last_login_at ? '账号尚无登录记录' : '',
  ].filter(Boolean);

  const tabs = [
    {
      key: 'overview',
      label: '详情',
      children: (
        <div className="user-detail-grid">
          <section className="user-info-card">
            <Typography.Text strong>基本信息</Typography.Text>
            <div className="user-inline-form">
              <Form.Item label="账号" name="username"><Input disabled /></Form.Item>
              <Form.Item label="姓名" name="display_name"><Input disabled={!editing} /></Form.Item>
              <Form.Item className="user-field-wide" label="邮箱" name="email"><Input disabled={!editing} /></Form.Item>
              <Form.Item className="user-field-wide" label="头像地址" name="avatar_url"><Input disabled={!editing} placeholder="https://... 或 /assets/avatar.png" /></Form.Item>
              <Form.Item label="登录 IP"><Input value={user.last_login_ip || '-'} disabled /></Form.Item>
              <Form.Item className="user-field-wide" label="最近登录"><Input value={formatServerDateTime(user.last_login_at)} disabled /></Form.Item>
            </div>
          </section>
          <section className="user-section-card">
            <Typography.Text strong>角色</Typography.Text>
            <div className="user-inline-form">
              <Form.Item name="role_ids">
                <Select disabled={!editing} mode="multiple" options={roles.map((role) => ({ label: role.label, value: role.id }))} />
              </Form.Item>
            </div>
          </section>
          <section className="user-section-card">
            <Typography.Text strong>组织</Typography.Text>
            <div className="user-inline-form">
              <Form.Item name="org_unit_ids">
                <Select disabled={!editing} mode="multiple" options={orgOptions} />
              </Form.Item>
              <Form.Item label="主组织" name="primary_org_unit_id">
                <Select disabled={!editing} allowClear options={orgOptions} />
              </Form.Item>
              <Form.Item label="岗位" name="position_title"><Input disabled={!editing} /></Form.Item>
            </div>
          </section>
        </div>
      ),
    },
    {
      key: 'security',
      label: '安全',
      children: (
        <div className="user-security-list">
          <section className="user-section-card">
            <Typography.Text strong>账号状态</Typography.Text>
            <div className="user-inline-form">
              <Space size={24}>
                <Form.Item label="启用" name="is_active" valuePropName="checked"><Switch disabled={!editing} /></Form.Item>
                <Form.Item label="超级管理员" name="is_admin" valuePropName="checked"><Switch disabled={!editing || user.username === 'admin'} /></Form.Item>
              </Space>
            </div>
            <div className="user-security-tags">
              {user.is_active ? <Tag color="green">账号可登录</Tag> : <Tag>账号已停用</Tag>}
              {user.is_admin ? <Tag color="red">管理员</Tag> : <Tag>普通用户</Tag>}
              {user.locked_until ? <Tag color="red">已锁定</Tag> : <Tag color="green">未锁定</Tag>}
            </div>
          </section>
          <section className="user-section-card">
            <Typography.Text strong>登录与密码</Typography.Text>
            <Descriptions column={1} size="small" className="user-security-descriptions">
              <Descriptions.Item label="最近登录">{formatServerDateTime(user.last_login_at)}</Descriptions.Item>
              <Descriptions.Item label="登录 IP">{user.last_login_ip || '-'}</Descriptions.Item>
              <Descriptions.Item label="失败登录次数">{user.login_failed_count || 0}</Descriptions.Item>
              <Descriptions.Item label="锁定至">{user.locked_until ? formatServerDateTime(user.locked_until) : '未锁定'}</Descriptions.Item>
              <Descriptions.Item label="强制改密">{user.force_password_change ? '是' : '否'}</Descriptions.Item>
            </Descriptions>
          </section>
          <section className="user-section-card">
            <Typography.Text strong>身份验证</Typography.Text>
            <Descriptions column={1} size="small" className="user-security-descriptions">
              <Descriptions.Item label="MFA">{user.mfa_enabled ? '已启用' : '未启用'}</Descriptions.Item>
              <Descriptions.Item label="SSO Provider">{user.sso_provider || '-'}</Descriptions.Item>
              <Descriptions.Item label="SSO Subject">{user.sso_subject || '-'}</Descriptions.Item>
            </Descriptions>
          </section>
          <section className="user-section-card">
            <Typography.Text strong>风险摘要</Typography.Text>
            <div className="user-risk-summary">
              {securityRisks.length ? (
                securityRisks.map((item) => <Tag key={item} color="orange">{item}</Tag>)
              ) : (
                <Tag color="green">暂无明显风险</Tag>
              )}
            </div>
          </section>
        </div>
      ),
    },
    {
      key: 'sessions',
      label: '会话',
      children: (
        <Table
          dataSource={sessions}
          rowKey="session_id"
          size="small"
          loading={sessionsLoading}
          pagination={false}
          columns={[
            { title: '方式', dataIndex: 'login_method', width: 80 },
            { title: 'IP', dataIndex: 'ip_address', width: 120 },
            { title: '过期时间', dataIndex: 'expires_at', width: 150, render: (value: string | null) => formatServerDateTime(value) },
            { title: '撤销时间', dataIndex: 'revoked_at', width: 150, render: (value: string | null) => formatServerDateTime(value) },
            {
              title: '操作',
              width: 80,
              render: (_value, record: any) => (
                <Button
                  size="small"
                  disabled={Boolean(record.revoked_at)}
                  onClick={async () => {
                    await adminRevokeSession(record.session_id);
                    await loadSessions(user);
                  }}
                >
                  撤销
                </Button>
              ),
            },
          ]}
          scroll={{ x: 620 }}
        />
      ),
    },
  ];

  return (
    <aside className="user-preview-panel">
      <div className="user-preview-head">
        <div>
          <Space size={6} wrap>
            <Typography.Title level={5}>{user.display_name || user.username}</Typography.Title>
            {user.is_active ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>}
            {user.is_admin && <Tag color="red">管理员</Tag>}
          </Space>
        </div>
        <Space className="user-head-actions" wrap>
          {editing ? (
            <>
              <Button size="small" type="primary" icon={<SaveOutlined />} loading={saving} onClick={saveEdit}>保存</Button>
              <Button size="small" icon={<CloseOutlined />} onClick={cancelEdit}>取消</Button>
            </>
          ) : (
            <>
              <Button size="small" icon={<EditOutlined />} onClick={() => setEditing(true)}>编辑</Button>
              {user.username !== 'admin' && (
                <Popconfirm title="确定删除该用户？" onConfirm={() => onDelete(user)}>
                  <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
                </Popconfirm>
              )}
            </>
          )}
        </Space>
      </div>
      <Form form={inlineForm} layout="vertical" component={false}>
        <Tabs className="user-preview-tabs" activeKey={activeTab} onChange={setActiveTab} items={tabs} />
      </Form>
    </aside>
  );
}

function splitList(value?: string) {
  return (value || '').split(/[;；]/).map((item) => item.trim()).filter(Boolean);
}

function parseCsv(text: string): ImportRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  const [headers = [], ...records] = rows;
  return records.map((record) => Object.fromEntries(headers.map((header, index) => [header.trim(), record[index]?.trim() || ''])));
}
