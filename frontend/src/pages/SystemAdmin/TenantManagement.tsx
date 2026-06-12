import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Progress,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import {
  CopyOutlined,
  EditOutlined,
  LinkOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SendOutlined,
} from '@ant-design/icons';
import {
  PlatformTenantDetail,
  PlatformTenantInvite,
  PlatformTenantInviteItem,
  PlatformTenantItem,
  PlatformTenantUserSummary,
  TenantStatus,
  platformCreateTenant,
  platformCreateTenantInvite,
  platformCreateTenantPasswordReset,
  platformGetTenant,
  platformListTenants,
  platformResendTenantInvite,
  platformRevokeTenantInvite,
  platformUpdateTenant,
} from '@/services/api';
import { formatServerDateTime } from '@/utils/dateTime';

const statusColor: Record<TenantStatus, string> = {
  active: 'green',
  suspended: 'orange',
  archived: 'default',
};

const statusLabel: Record<TenantStatus, string> = {
  active: '启用',
  suspended: '停用',
  archived: '归档',
};

const inviteStatusColor: Record<string, string> = {
  pending: 'blue',
  accepted: 'green',
  revoked: 'red',
  replaced: 'purple',
  expired: 'default',
};

const inviteStatusLabel: Record<string, string> = {
  pending: '待接受',
  accepted: '已接受',
  revoked: '已撤销',
  replaced: '已重发',
  expired: '已过期',
};

const splitDomains = (value?: string): string[] =>
  (value || '')
    .split(/[\s,;，；]+/)
    .map((item) => item.trim().replace(/^@/, '').toLowerCase())
    .filter(Boolean);

const formatTime = (value?: string | null) => formatServerDateTime(value);

const getApiError = (error: unknown, fallback: string) => {
  const detail = (error as any)?.response?.data?.detail;
  return typeof detail === 'string' ? detail : fallback;
};

const limitValue = (value: unknown): number | null | undefined => {
  if (value === null) return null;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};

export default function TenantManagement() {
  const [tenants, setTenants] = useState<PlatformTenantItem[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<number | null>(null);
  const [detail, setDetail] = useState<PlatformTenantDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [createForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [inviteForm] = Form.useForm();

  const loadTenants = useCallback(async () => {
    setLoading(true);
    try {
      const res = await platformListTenants();
      setTenants(res.data?.data || []);
    } catch (error) {
      message.error(getApiError(error, '加载租户列表失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (tenantId: number) => {
    setDetailLoading(true);
    try {
      const res = await platformGetTenant(tenantId);
      setDetail(res.data?.data || null);
    } catch (error) {
      message.error(getApiError(error, '加载租户详情失败'));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTenants();
  }, [loadTenants]);

  const openDetail = (tenant: PlatformTenantItem) => {
    setSelectedTenantId(tenant.id);
    void loadDetail(tenant.id);
  };

  const refreshCurrent = async () => {
    await loadTenants();
    if (selectedTenantId) await loadDetail(selectedTenantId);
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      message.success('链接已复制');
    } catch {
      message.warning('浏览器不允许自动复制，请手动复制链接');
    }
  };

  const showInviteLink = (invite?: PlatformTenantInvite) => {
    if (!invite?.inviteUrl) return;
    Modal.info({
      title: '邀请链接已生成',
      width: 720,
      content: (
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Typography.Text type="secondary">
            {invite.email} / {invite.role}，邮件{invite.emailDelivered ? '已发送' : '未发送，开发环境可复制链接'}。
          </Typography.Text>
          <Input value={invite.inviteUrl} readOnly suffix={<Button size="small" icon={<CopyOutlined />} onClick={() => copyText(invite.inviteUrl)} />} />
        </Space>
      ),
    });
  };

  const showResetLink = (resetUrl?: string, emailDelivered?: boolean) => {
    if (!resetUrl) return;
    Modal.info({
      title: '密码重置链接已生成',
      width: 720,
      content: (
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Typography.Text type="secondary">邮件{emailDelivered ? '已发送' : '未发送，开发环境可复制链接'}。</Typography.Text>
          <Input value={resetUrl} readOnly suffix={<Button size="small" icon={<CopyOutlined />} onClick={() => copyText(resetUrl)} />} />
        </Space>
      ),
    });
  };

  const openCreate = () => {
    createForm.resetFields();
    createForm.setFieldsValue({
      config_brandName: 'ManuFoundry',
      config_defaultLanguage: 'zh-CN',
      limit_users: 50,
      limit_applications: 20,
      limit_dynamicRecords: 100000,
    });
    setCreateOpen(true);
  };

  const fillEditForm = (tenant: PlatformTenantDetail | PlatformTenantItem) => {
    editForm.setFieldsValue({
      name: tenant.name,
      status: tenant.status,
      domains: tenant.domains?.map((item) => item.domain).join('\n'),
      suspended_reason: tenant.suspendedReason,
      config_brandName: tenant.config?.brandName,
      config_defaultLanguage: tenant.config?.defaultLanguage,
      limit_users: tenant.limits?.users,
      limit_applications: tenant.limits?.applications,
      limit_dynamicRecords: tenant.limits?.dynamicRecords,
    });
    setEditOpen(true);
  };

  const createTenant = async () => {
    const values = await createForm.validateFields();
    setSaving(true);
    try {
      const res = await platformCreateTenant({
        name: values.name,
        slug: values.slug,
        domains: splitDomains(values.domains),
        admin_email: values.admin_email || undefined,
        config: { brandName: values.config_brandName, defaultLanguage: values.config_defaultLanguage },
        limits: {
          users: limitValue(values.limit_users),
          applications: limitValue(values.limit_applications),
          dynamicRecords: limitValue(values.limit_dynamicRecords),
        },
      });
      message.success('租户已创建');
      setCreateOpen(false);
      await refreshCurrent();
      showInviteLink(res.data?.data?.adminInvite);
    } catch (error) {
      message.error(getApiError(error, '创建租户失败'));
    } finally {
      setSaving(false);
    }
  };

  const updateTenant = async () => {
    if (!detail && !selectedTenantId) return;
    const tenantId = detail?.id || selectedTenantId!;
    const values = await editForm.validateFields();
    if (values.status !== 'active' && !values.suspended_reason) {
      message.error('停用或归档租户必须填写原因');
      return;
    }
    setSaving(true);
    try {
      await platformUpdateTenant(tenantId, {
        name: values.name,
        status: values.status,
        domains: splitDomains(values.domains),
        suspended_reason: values.suspended_reason || '',
        config: { brandName: values.config_brandName, defaultLanguage: values.config_defaultLanguage },
        limits: {
          users: limitValue(values.limit_users),
          applications: limitValue(values.limit_applications),
          dynamicRecords: limitValue(values.limit_dynamicRecords),
        },
      });
      message.success('租户配置已更新');
      setEditOpen(false);
      await refreshCurrent();
    } catch (error) {
      message.error(getApiError(error, '更新租户失败'));
    } finally {
      setSaving(false);
    }
  };

  const openInvite = (tenant?: PlatformTenantItem | PlatformTenantDetail) => {
    const target = tenant || detail;
    if (!target) return;
    if (target.status !== 'active') {
      message.warning('停用或归档租户不能生成邀请');
      return;
    }
    setSelectedTenantId(target.id);
    inviteForm.resetFields();
    inviteForm.setFieldsValue({ role: 'member' });
    setInviteOpen(true);
  };

  const createInvite = async () => {
    if (!selectedTenantId) return;
    const values = await inviteForm.validateFields();
    setSaving(true);
    try {
      const res = await platformCreateTenantInvite(selectedTenantId, { email: values.email, role: values.role });
      message.success('邀请已生成');
      setInviteOpen(false);
      showInviteLink(res.data?.data);
      await refreshCurrent();
    } catch (error) {
      message.error(getApiError(error, '生成邀请失败'));
    } finally {
      setSaving(false);
    }
  };

  const revokeInvite = async (inviteId: number) => {
    if (!selectedTenantId) return;
    try {
      await platformRevokeTenantInvite(selectedTenantId, inviteId);
      message.success('邀请已撤销');
      await refreshCurrent();
    } catch (error) {
      message.error(getApiError(error, '撤销邀请失败'));
    }
  };

  const resendInvite = async (inviteId: number) => {
    if (!selectedTenantId) return;
    try {
      const res = await platformResendTenantInvite(selectedTenantId, inviteId);
      message.success('邀请已重发');
      showInviteLink(res.data?.data);
      await refreshCurrent();
    } catch (error) {
      message.error(getApiError(error, '重发邀请失败'));
    }
  };

  const createPasswordReset = async (userId: number) => {
    if (!selectedTenantId || detail?.status !== 'active') return;
    try {
      const res = await platformCreateTenantPasswordReset(selectedTenantId, userId);
      message.success('重置链接已生成');
      showResetLink(res.data?.data?.resetUrl, res.data?.data?.emailDelivered);
    } catch (error) {
      message.error(getApiError(error, '生成重置链接失败'));
    }
  };

  const tenantOptions = useMemo(
    () => tenants.map((tenant) => ({ label: `${tenant.name} / ${tenant.slug}`, value: tenant.id })),
    [tenants],
  );

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' }}>
        <div>
          <Typography.Title level={5} style={{ margin: 0 }}>租户运营后台</Typography.Title>
          <Typography.Text type="secondary">租户状态、域名、限额、用量、邀请历史、用户安全和审计摘要。</Typography.Text>
        </div>
        <Space>
          <Tooltip title="刷新">
            <Button icon={<ReloadOutlined />} loading={loading} onClick={loadTenants} />
          </Tooltip>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建租户</Button>
        </Space>
      </div>

      <Table
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={tenants}
        columns={[
          {
            title: '租户',
            width: 230,
            render: (_value, record) => (
              <Space direction="vertical" size={0}>
                <Button type="link" style={{ padding: 0 }} onClick={() => openDetail(record)}>{record.name}</Button>
                <Typography.Text type="secondary">{record.slug}</Typography.Text>
              </Space>
            ),
          },
          {
            title: '状态',
            dataIndex: 'status',
            width: 90,
            render: (status: TenantStatus) => <Tag color={statusColor[status]}>{statusLabel[status] || status}</Tag>,
          },
          {
            title: '邮箱域名',
            width: 260,
            render: (_value, record) => record.domains?.length
              ? record.domains.map((item) => <Tag key={item.id || item.domain} icon={<LinkOutlined />}>{item.domain}</Tag>)
              : <Tag color="orange">未绑定</Tag>,
          },
          {
            title: '运营摘要',
            width: 280,
            render: (_value, record) => (
              <Space size={6} wrap>
                <Tag>用户 {record.usage?.users ?? 0}</Tag>
                <Tag>应用 {record.usage?.applications ?? 0}</Tag>
                <Tag>记录 {record.usage?.dynamicRecords ?? 0}</Tag>
                <Tag color={record.pendingInvitesCount ? 'blue' : 'default'}>待邀 {record.pendingInvitesCount ?? 0}</Tag>
              </Space>
            ),
          },
          { title: '最近登录', dataIndex: 'lastLoginAt', width: 170, render: (value: string | null) => formatTime(value) },
          {
            title: '操作',
            width: 210,
            render: (_value, record) => (
              <Space size={6}>
                <Button size="small" onClick={() => openDetail(record)}>详情</Button>
                <Button size="small" icon={<EditOutlined />} onClick={() => { setSelectedTenantId(record.id); fillEditForm(record); }}>配置</Button>
                <Button size="small" icon={<SendOutlined />} disabled={record.status !== 'active'} onClick={() => openInvite(record)}>邀请</Button>
              </Space>
            ),
          },
        ]}
      />

      <Drawer
        title={detail ? `${detail.name} / ${detail.slug}` : '租户详情'}
        open={!!selectedTenantId}
        width={980}
        onClose={() => { setSelectedTenantId(null); setDetail(null); }}
        extra={<Button icon={<ReloadOutlined />} loading={detailLoading} onClick={() => selectedTenantId && loadDetail(selectedTenantId)} />}
      >
        {detail && (
          <Tabs
            items={[
              { key: 'overview', label: '概览', children: <OverviewTab tenant={detail} onEdit={() => fillEditForm(detail)} /> },
              { key: 'config', label: '配置与限额', children: <ConfigTab tenant={detail} onEdit={() => fillEditForm(detail)} /> },
              { key: 'domains', label: '域名', children: <DomainsTab tenant={detail} onEdit={() => fillEditForm(detail)} /> },
              {
                key: 'invites',
                label: '邀请',
                children: (
                  <InvitesTab
                    tenant={detail}
                    onCreate={() => openInvite(detail)}
                    onRevoke={revokeInvite}
                    onResend={resendInvite}
                  />
                ),
              },
              { key: 'users', label: '用户安全', children: <UsersTab tenant={detail} onReset={createPasswordReset} /> },
              { key: 'audit', label: '审计', children: <AuditTab tenant={detail} /> },
            ]}
          />
        )}
      </Drawer>

      <Modal title="新建租户" open={createOpen} onOk={createTenant} confirmLoading={saving} onCancel={() => setCreateOpen(false)} destroyOnClose width={720}>
        <TenantForm form={createForm} includeSlug includeAdminEmail />
      </Modal>

      <Modal title="租户配置" open={editOpen} onOk={updateTenant} confirmLoading={saving} onCancel={() => setEditOpen(false)} destroyOnClose width={720}>
        <TenantForm form={editForm} includeStatus />
      </Modal>

      <Modal title="邀请租户用户" open={inviteOpen} onOk={createInvite} confirmLoading={saving} onCancel={() => setInviteOpen(false)} destroyOnClose>
        <Form form={inviteForm} layout="vertical">
          <Form.Item label="租户">
            <Select disabled value={selectedTenantId || undefined} options={tenantOptions} />
          </Form.Item>
          <Form.Item label="邮箱" name="email" rules={[{ required: true, type: 'email', message: '请输入有效邮箱' }]}>
            <Input placeholder="user@example.com" />
          </Form.Item>
          <Form.Item label="角色" name="role" rules={[{ required: true }]}>
            <Select
              options={[
                { label: '租户管理员', value: 'admin' },
                { label: '普通成员', value: 'member' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}

function OverviewTab({ tenant, onEdit }: { tenant: PlatformTenantDetail; onEdit: () => void }) {
  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      {tenant.status !== 'active' && (
        <Alert type="warning" showIcon message="租户当前不可用" description={tenant.suspendedReason || '停用或归档后用户无法登录，邀请和密码重置也会被禁止。'} />
      )}
      <Descriptions bordered size="small" column={2}>
        <Descriptions.Item label="租户名称">{tenant.name}</Descriptions.Item>
        <Descriptions.Item label="租户标识">{tenant.slug}</Descriptions.Item>
        <Descriptions.Item label="状态"><Tag color={statusColor[tenant.status]}>{statusLabel[tenant.status]}</Tag></Descriptions.Item>
        <Descriptions.Item label="最近登录">{formatTime(tenant.lastLoginAt)}</Descriptions.Item>
        <Descriptions.Item label="创建时间">{formatTime(tenant.createdAt)}</Descriptions.Item>
        <Descriptions.Item label="更新时间">{formatTime(tenant.updatedAt)}</Descriptions.Item>
        <Descriptions.Item label="停用原因" span={2}>{tenant.suspendedReason || '-'}</Descriptions.Item>
      </Descriptions>
      <Space wrap>
        <UsageTag label="用户" used={tenant.usage?.users} limit={tenant.limits?.users} />
        <UsageTag label="应用" used={tenant.usage?.applications} limit={tenant.limits?.applications} />
        <UsageTag label="动态记录" used={tenant.usage?.dynamicRecords} limit={tenant.limits?.dynamicRecords} />
        <Tag>表单 {tenant.usage?.forms ?? 0}</Tag>
        <Tag>报表 {tenant.usage?.reports ?? 0}</Tag>
        <Tag>审计 {tenant.usage?.auditLogs ?? 0}</Tag>
      </Space>
      <Button icon={<EditOutlined />} onClick={onEdit}>编辑租户配置</Button>
    </Space>
  );
}

function ConfigTab({ tenant, onEdit }: { tenant: PlatformTenantDetail; onEdit: () => void }) {
  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      <Descriptions bordered size="small" column={2}>
        <Descriptions.Item label="品牌名">{String(tenant.config?.brandName ?? '-')}</Descriptions.Item>
        <Descriptions.Item label="默认语言">{String(tenant.config?.defaultLanguage ?? '-')}</Descriptions.Item>
      </Descriptions>
      <LimitProgress label="用户上限" used={tenant.usage?.users ?? 0} limit={tenant.limits?.users} />
      <LimitProgress label="应用上限" used={tenant.usage?.applications ?? 0} limit={tenant.limits?.applications} />
      <LimitProgress label="动态记录软上限" used={tenant.usage?.dynamicRecords ?? 0} limit={tenant.limits?.dynamicRecords} />
      <Button type="primary" icon={<EditOutlined />} onClick={onEdit}>编辑配置与限额</Button>
    </Space>
  );
}

function DomainsTab({ tenant, onEdit }: { tenant: PlatformTenantDetail; onEdit: () => void }) {
  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      {!tenant.domains?.length && <Alert type="warning" showIcon message="未绑定邮箱域名" description="该租户用户无法通过邮箱域名自动解析登录。" />}
      <Space wrap>
        {tenant.domains?.map((item) => <Tag key={item.id} icon={<LinkOutlined />} color={item.isPrimary ? 'blue' : 'default'}>{item.domain}</Tag>)}
      </Space>
      <Button icon={<EditOutlined />} onClick={onEdit}>编辑域名</Button>
    </Space>
  );
}

function InvitesTab({
  tenant,
  onCreate,
  onRevoke,
  onResend,
}: {
  tenant: PlatformTenantDetail;
  onCreate: () => void;
  onRevoke: (inviteId: number) => void;
  onResend: (inviteId: number) => void;
}) {
  const disabled = tenant.status !== 'active';
  return (
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      {disabled && <Alert type="warning" showIcon message="租户不可用，不能创建或重发邀请。" />}
      <Button type="primary" icon={<SendOutlined />} disabled={disabled} onClick={onCreate}>创建邀请</Button>
      <Table
        rowKey="id"
        size="small"
        dataSource={tenant.recentInvites || []}
        columns={[
          { title: '邮箱', dataIndex: 'email', ellipsis: true },
          { title: '角色', dataIndex: 'role', width: 110 },
          { title: '状态', dataIndex: 'status', width: 110, render: (value) => <Tag color={inviteStatusColor[value]}>{inviteStatusLabel[value] || value}</Tag> },
          { title: '过期时间', dataIndex: 'expiresAt', width: 170, render: (value: string | null) => formatTime(value) },
          { title: '创建时间', dataIndex: 'createdAt', width: 170, render: (value: string | null) => formatTime(value) },
          {
            title: '操作',
            width: 150,
            render: (_value, record: PlatformTenantInviteItem) => (
              <Space size={6}>
                <Button size="small" disabled={disabled || record.status === 'accepted'} onClick={() => onResend(record.id)}>重发</Button>
                <Popconfirm title="确定撤销该邀请？" onConfirm={() => onRevoke(record.id)}>
                  <Button size="small" danger disabled={record.status !== 'pending'}>撤销</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
    </Space>
  );
}

function UsersTab({ tenant, onReset }: { tenant: PlatformTenantDetail; onReset: (userId: number) => void }) {
  const disabled = tenant.status !== 'active';
  return (
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      {disabled && <Alert type="warning" showIcon message="租户不可用，不能生成密码重置链接。" />}
      <Table
        rowKey="id"
        size="small"
        dataSource={tenant.users || []}
        columns={[
          { title: '用户', dataIndex: 'displayName', render: (_value, record: PlatformTenantUserSummary) => record.displayName || record.username },
          { title: '邮箱', dataIndex: 'email', ellipsis: true },
          { title: '角色', render: (_value, record: PlatformTenantUserSummary) => <Space wrap>{record.isAdmin && <Tag color="gold">管理员</Tag>}{record.roles?.map((role) => <Tag key={role.id}>{role.label}</Tag>)}</Space> },
          { title: '状态', width: 110, render: (_value, record: PlatformTenantUserSummary) => record.isActive ? <Tag color="green">启用</Tag> : <Tag>停用</Tag> },
          { title: '最近登录', dataIndex: 'lastLoginAt', width: 170, render: (value: string | null) => formatTime(value) },
          {
            title: '操作',
            width: 130,
            render: (_value, record: PlatformTenantUserSummary) => (
              <Button size="small" icon={<SafetyCertificateOutlined />} disabled={disabled || !record.isActive || !record.email} onClick={() => onReset(record.id)}>重置密码</Button>
            ),
          },
        ]}
      />
    </Space>
  );
}

function AuditTab({ tenant }: { tenant: PlatformTenantDetail }) {
  return (
    <Table
      rowKey="id"
      size="small"
      dataSource={tenant.recentAuditLogs || []}
      columns={[
        { title: '时间', dataIndex: 'timestamp', width: 170, render: (value: string | null) => formatTime(value) },
        { title: '动作', dataIndex: 'action', width: 180 },
        { title: '资源', dataIndex: 'resourceType', width: 160 },
        { title: '摘要', dataIndex: 'newValues', ellipsis: true },
      ]}
    />
  );
}

function UsageTag({ label, used, limit }: { label: string; used?: number; limit?: unknown }) {
  const displayLimit = limit === null || limit === undefined ? '不限' : String(limit);
  return <Tag>{label} {used ?? 0}/{displayLimit}</Tag>;
}

function LimitProgress({ label, used, limit }: { label: string; used: number; limit?: unknown }) {
  if (limit === null || limit === undefined) {
    return <Progress percent={0} format={() => `${label}: ${used}/不限`} />;
  }
  const numericLimit = Number(limit);
  const percent = numericLimit > 0 ? Math.round((used / numericLimit) * 100) : 0;
  const status = percent >= 100 ? 'exception' : percent >= 80 ? 'normal' : 'success';
  return <Progress percent={Math.min(percent, 100)} status={status} format={() => `${label}: ${used}/${numericLimit}`} />;
}

function TenantForm({
  form,
  includeSlug = false,
  includeAdminEmail = false,
  includeStatus = false,
}: {
  form: ReturnType<typeof Form.useForm>[0];
  includeSlug?: boolean;
  includeAdminEmail?: boolean;
  includeStatus?: boolean;
}) {
  return (
    <Form form={form} layout="vertical">
      <Form.Item label="租户名称" name="name" rules={[{ required: true, message: '请输入租户名称' }]}>
        <Input placeholder="例如：华东制造事业部" />
      </Form.Item>
      {includeSlug && (
        <Form.Item
          label="租户标识"
          name="slug"
          rules={[
            { required: true, message: '请输入租户标识' },
            { pattern: /^[a-z0-9-]+$/, message: '仅支持小写字母、数字和中划线' },
          ]}
        >
          <Input placeholder="east-manufacturing" />
        </Form.Item>
      )}
      {includeStatus && (
        <Form.Item label="状态" name="status" rules={[{ required: true }]}>
          <Select
            options={[
              { label: '启用', value: 'active' },
              { label: '停用', value: 'suspended' },
              { label: '归档', value: 'archived' },
            ]}
          />
        </Form.Item>
      )}
      <Form.Item label="邮箱域名" name="domains" tooltip="支持逗号、空格或换行分隔；为空时该租户不能通过邮箱域名自动登录。">
        <Input.TextArea rows={3} placeholder="example.com&#10;factory.example.com" />
      </Form.Item>
      {includeAdminEmail && (
        <Form.Item label="首个管理员邮箱" name="admin_email" rules={[{ type: 'email', message: '请输入有效邮箱' }]}>
          <Input placeholder="admin@example.com" />
        </Form.Item>
      )}
      {includeStatus && (
        <Form.Item label="停用/归档原因" name="suspended_reason">
          <Input.TextArea rows={2} placeholder="停用或归档时必填" />
        </Form.Item>
      )}
      <Space wrap align="start" style={{ width: '100%' }}>
        <Form.Item label="品牌名" name="config_brandName">
          <Input style={{ width: 220 }} placeholder="ManuFoundry" />
        </Form.Item>
        <Form.Item label="默认语言" name="config_defaultLanguage">
          <Select
            style={{ width: 160 }}
            options={[
              { label: '简体中文', value: 'zh-CN' },
              { label: 'English', value: 'en-US' },
            ]}
          />
        </Form.Item>
        <Form.Item label="用户上限" name="limit_users" tooltip="留空表示保持/不限额；输入数字必须大于 0。">
          <InputNumber min={1} max={100000} style={{ width: 140 }} />
        </Form.Item>
        <Form.Item label="应用上限" name="limit_applications">
          <InputNumber min={1} max={10000} style={{ width: 140 }} />
        </Form.Item>
        <Form.Item label="动态记录软上限" name="limit_dynamicRecords">
          <InputNumber min={1} max={100000000} style={{ width: 160 }} />
        </Form.Item>
      </Space>
    </Form>
  );
}
