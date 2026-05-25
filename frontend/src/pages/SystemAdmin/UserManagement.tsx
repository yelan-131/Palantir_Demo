import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  Upload,
  message,
} from 'antd';
import {
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import type { UploadProps } from 'antd';
import {
  adminCreateUser,
  adminDeleteUser,
  adminListOrgUnits,
  adminListRoles,
  adminListUsers,
  adminUpdateUser,
} from '@/services/api';

interface RoleItem {
  id: number;
  name: string;
  label: string;
}

interface OrgUnitItem {
  id: number;
  parent_id?: number | null;
  code: string;
  name: string;
  org_type: string;
  member_count?: number;
}

interface UserOrgUnit {
  id: number;
  code: string;
  name: string;
  org_type: string;
  position_title?: string;
  is_primary?: boolean;
}

interface UserItem {
  id: number;
  username: string;
  display_name: string;
  email: string;
  is_active: boolean;
  is_admin: boolean;
  roles: RoleItem[];
  org_units?: UserOrgUnit[];
}

const orgTypeLabel: Record<string, string> = {
  company: '集团',
  factory: '工厂',
  department: '部门',
  team: '班组',
};

const csvEscape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;

const parseCsv = (text: string) => {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field || row.length) rows.push([...row, field]);
  const [headers = [], ...records] = rows.filter((items) => items.some(Boolean));
  return records.map((items) => Object.fromEntries(headers.map((header, index) => [header.trim(), items[index]?.trim() || ''])));
};

export default function UserManagement() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [orgUnits, setOrgUnits] = useState<OrgUnitItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserItem | null>(null);
  const [form] = Form.useForm();

  const orgOptions = useMemo(
    () => orgUnits.map((org) => ({
      label: `${org.name} · ${orgTypeLabel[org.org_type] || org.org_type}`,
      value: org.id,
    })),
    [orgUnits],
  );

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [uRes, rRes, oRes] = await Promise.all([adminListUsers(), adminListRoles(), adminListOrgUnits()]);
      setUsers(uRes.data?.data || []);
      setRoles((rRes.data?.data || []).map((r: any) => ({ id: r.id, name: r.name, label: r.label })));
      setOrgUnits(oRes.data?.data || []);
    } catch {
      message.error('加载用户与权限数据失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const openCreate = () => {
    setEditingUser(null);
    form.resetFields();
    form.setFieldsValue({ is_active: true, is_admin: false, role_ids: [], org_unit_ids: [] });
    setModalOpen(true);
  };

  const openEdit = (record: UserItem) => {
    const primaryOrg = record.org_units?.find((org) => org.is_primary) || record.org_units?.[0];
    setEditingUser(record);
    form.setFieldsValue({
      username: record.username,
      display_name: record.display_name,
      email: record.email,
      is_active: record.is_active,
      is_admin: record.is_admin,
      role_ids: record.roles?.map((role) => role.id) || [],
      org_unit_ids: record.org_units?.map((org) => org.id) || [],
      primary_org_unit_id: primaryOrg?.id,
      position_title: primaryOrg?.position_title,
    });
    setModalOpen(true);
  };

  const submitUser = async () => {
    const values = await form.validateFields();
    const payload = {
      ...values,
      org_unit_ids: values.org_unit_ids || [],
      primary_org_unit_id: values.primary_org_unit_id || values.org_unit_ids?.[0],
      role_ids: values.role_ids || [],
    };
    try {
      if (editingUser) {
        const { password, username, ...updates } = payload;
        await adminUpdateUser(editingUser.id, updates);
        message.success('用户已更新');
      } else {
        await adminCreateUser(payload);
        message.success('用户已创建');
      }
      setModalOpen(false);
      fetchData();
    } catch {
      message.error(editingUser ? '更新用户失败' : '创建用户失败');
    }
  };

  const exportUsers = () => {
    const headers = ['username', 'display_name', 'email', 'is_active', 'is_admin', 'role_ids', 'org_unit_ids'];
    const lines = [
      headers.join(','),
      ...users.map((user) => headers.map((header) => {
        if (header === 'role_ids') return csvEscape(user.roles?.map((role) => role.id).join('|'));
        if (header === 'org_unit_ids') return csvEscape(user.org_units?.map((org) => org.id).join('|'));
        return csvEscape(user[header as keyof UserItem]);
      }).join(',')),
    ];
    const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `users-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const importUsers: UploadProps['beforeUpload'] = async (file) => {
    try {
      const text = await file.text();
      const rawRows = file.name.toLowerCase().endsWith('.json') ? JSON.parse(text) : parseCsv(text);
      const rows = Array.isArray(rawRows) ? rawRows : [];
      if (!rows.length) {
        message.warning('没有可导入的数据');
        return Upload.LIST_IGNORE;
      }
      await Promise.all(rows.map((row: any) => adminCreateUser({
        username: row.username,
        display_name: row.display_name || row.name || row.username,
        email: row.email,
        password: row.password || 'ChangeMe123!',
        is_active: row.is_active === undefined ? true : String(row.is_active).toLowerCase() !== 'false',
        is_admin: String(row.is_admin).toLowerCase() === 'true',
        role_ids: String(row.role_ids || '').split('|').filter(Boolean).map(Number),
        org_unit_ids: String(row.org_unit_ids || '').split('|').filter(Boolean).map(Number),
      })));
      message.success(`已导入 ${rows.length} 个用户`);
      fetchData();
    } catch {
      message.error('导入用户失败，请检查文件格式');
    }
    return Upload.LIST_IGNORE;
  };

  const columns = [
    { title: '账号', dataIndex: 'username', width: 120 },
    { title: '姓名', dataIndex: 'display_name', width: 160 },
    { title: '邮箱', dataIndex: 'email', width: 220, ellipsis: true },
    {
      title: '角色',
      dataIndex: 'roles',
      width: 260,
      render: (items: RoleItem[]) => items?.map((role) => <Tag key={role.id} color="blue">{role.label}</Tag>),
    },
    {
      title: '组织/岗位',
      dataIndex: 'org_units',
      width: 280,
      render: (items: UserOrgUnit[]) => {
        if (!items?.length) return <Typography.Text type="secondary">未分配</Typography.Text>;
        return items.map((org) => (
          <Tag key={org.id} color={org.is_primary ? 'green' : 'default'}>
            {org.name}{org.position_title ? ` · ${org.position_title}` : ''}
          </Tag>
        ));
      },
    },
    {
      title: '管理员',
      dataIndex: 'is_admin',
      width: 90,
      render: (value: boolean) => (value ? <Tag color="red">是</Tag> : <Tag>否</Tag>),
    },
    {
      title: '状态',
      dataIndex: 'is_active',
      width: 90,
      render: (value: boolean) => (value ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>),
    },
    {
      title: '操作',
      width: 120,
      render: (_: unknown, record: UserItem) => (
        <Space size={4}>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)} />
          {record.username !== 'admin' && (
            <Popconfirm title="确定删除该用户？" onConfirm={async () => { await adminDeleteUser(record.id); fetchData(); }}>
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <Typography.Title level={5} style={{ margin: 0 }}>用户管理</Typography.Title>
          <Typography.Text type="secondary">账号在这里绑定角色和组织，角色控制功能，组织用于后续数据范围。</Typography.Text>
        </div>
        <Space size={6}>
          <Tooltip title="导入用户">
            <Upload accept=".csv,.json" showUploadList={false} beforeUpload={importUsers}>
              <Button aria-label="导入用户" icon={<UploadOutlined />} />
            </Upload>
          </Tooltip>
          <Tooltip title="导出用户">
            <Button aria-label="导出用户" icon={<DownloadOutlined />} onClick={exportUsers} />
          </Tooltip>
          <Tooltip title="刷新">
            <Button aria-label="刷新" icon={<ReloadOutlined />} loading={loading} onClick={fetchData} />
          </Tooltip>
          <Tooltip title="新建用户">
            <Button type="primary" aria-label="新建用户" icon={<PlusOutlined />} onClick={openCreate} />
          </Tooltip>
        </Space>
      </div>

      <Table dataSource={users} columns={columns} rowKey="id" loading={loading} size="small" />

      <Modal
        title={editingUser ? '编辑用户' : '新建用户'}
        open={modalOpen}
        onOk={submitUser}
        onCancel={() => setModalOpen(false)}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item label="账号" name="username" rules={[{ required: true, message: '请输入账号' }]}>
            <Input disabled={!!editingUser} placeholder="login_name" />
          </Form.Item>
          <Form.Item label="姓名" name="display_name">
            <Input placeholder="显示姓名" />
          </Form.Item>
          <Form.Item label="邮箱" name="email">
            <Input placeholder="email@example.com" />
          </Form.Item>
          {!editingUser && (
            <Form.Item label="初始密码" name="password" rules={[{ required: true, message: '请输入初始密码' }]}>
              <Input.Password placeholder="初始密码" />
            </Form.Item>
          )}
          <Form.Item label="角色" name="role_ids">
            <Select mode="multiple" options={roles.map((role) => ({ label: role.label, value: role.id }))} />
          </Form.Item>
          <Form.Item label="所属组织" name="org_unit_ids">
            <Select mode="multiple" options={orgOptions} />
          </Form.Item>
          <Form.Item label="主组织" name="primary_org_unit_id">
            <Select allowClear options={orgOptions} />
          </Form.Item>
          <Form.Item label="岗位" name="position_title">
            <Input placeholder="例如：质量工程师" />
          </Form.Item>
          <Space size={24}>
            <Form.Item label="启用" name="is_active" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item label="超级管理员" name="is_admin" valuePropName="checked">
              <Switch disabled={editingUser?.username === 'admin'} />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </div>
  );
}
