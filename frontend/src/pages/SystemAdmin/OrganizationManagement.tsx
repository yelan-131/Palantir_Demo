import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Descriptions,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Pagination,
  Popconfirm,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  BranchesOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  TeamOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import {
  adminCreateOrgUnit,
  adminDeleteOrgUnit,
  adminListRoles,
  adminListOrgUnits,
  adminListUsers,
  adminUpdateOrgUnit,
  listAuditLogs,
} from '@/services/api';
import { formatServerDateTime } from '@/utils/dateTime';

interface OrgUnitItem {
  id: number;
  parent_id?: number | null;
  code: string;
  name: string;
  org_type: string;
  sort_order: number;
  status: string;
  description?: string;
  member_count?: number;
  created_at?: string | null;
  updated_at?: string | null;
}

interface OrgTableRecord extends OrgUnitItem {
  childCount: number;
  descendantsCount: number;
  level: number;
  parentName: string;
  path: string[];
}

interface RoleItem {
  id: number;
  name: string;
  label: string;
  permissions?: Array<{ data_scope?: string; condition_json?: Record<string, unknown> | null }>;
}

interface UserItem {
  id: number;
  username: string;
  display_name?: string;
  email?: string;
  is_active?: boolean;
  roles?: RoleItem[];
  org_units?: Array<{ id: number; name: string; position_title?: string; is_primary?: boolean }>;
}

interface AuditLogItem {
  id: number;
  user_id?: number | null;
  action: string;
  resource_type: string;
  resource_id?: number | null;
  new_values?: string | null;
  timestamp?: string | null;
}

const ORG_TYPES = [
  { label: '集团', value: 'company', color: 'blue' },
  { label: '工厂', value: 'factory', color: 'cyan' },
  { label: '部门', value: 'department', color: 'geekblue' },
  { label: '班组', value: 'team', color: 'green' },
];

function getOrgTypeMeta(value: string) {
  return ORG_TYPES.find((item) => item.value === value) || { label: value, value, color: 'default' };
}

function sortOrgs(a: OrgUnitItem, b: OrgUnitItem) {
  if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
  return a.id - b.id;
}

export default function OrganizationManagement() {
  const [orgUnits, setOrgUnits] = useState<OrgUnitItem[]>([]);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingOrg, setEditingOrg] = useState<OrgUnitItem | null>(null);
  const [selectedOrgId, setSelectedOrgId] = useState<number | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [keyword, setKeyword] = useState('');
  const [typeFilter, setTypeFilter] = useState<string | undefined>();
  const [orgPage, setOrgPage] = useState(1);
  const [orgPageSize, setOrgPageSize] = useState(100);
  const [form] = Form.useForm();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [orgRes, userRes, roleRes, auditRes] = await Promise.all([
        adminListOrgUnits(),
        adminListUsers().catch(() => null),
        adminListRoles().catch(() => null),
        listAuditLogs({ page: 1, page_size: 200, resource_type: 'org_unit' }).catch(() => null),
      ]);
      setOrgUnits(orgRes.data?.data || []);
      setUsers(userRes?.data?.data || []);
      setRoles(roleRes?.data?.data || []);
      setAuditLogs(auditRes?.data?.data || []);
    } catch {
      message.error('加载组织失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const orgMaps = useMemo(() => {
    const byId = new Map<number, OrgUnitItem>();
    const childrenByParent = new Map<number | null, OrgUnitItem[]>();

    orgUnits.forEach((org) => {
      byId.set(org.id, org);
      const parentId = org.parent_id ?? null;
      const siblings = childrenByParent.get(parentId) || [];
      siblings.push(org);
      childrenByParent.set(parentId, siblings);
    });

    childrenByParent.forEach((children) => children.sort(sortOrgs));

    const getPath = (org: OrgUnitItem) => {
      const path: string[] = [];
      const visited = new Set<number>();
      let cursor: OrgUnitItem | undefined = org;
      while (cursor && !visited.has(cursor.id)) {
        visited.add(cursor.id);
        path.unshift(cursor.name);
        cursor = cursor.parent_id ? byId.get(cursor.parent_id) : undefined;
      }
      return path;
    };

    const countDescendants = (orgId: number): number => {
      const children = childrenByParent.get(orgId) || [];
      return children.reduce((total, child) => total + 1 + countDescendants(child.id), 0);
    };

    const flatten = (nodes: OrgUnitItem[], level = 0, visited = new Set<number>()): OrgTableRecord[] => nodes.flatMap((org) => {
      if (visited.has(org.id)) return [];
      const nextVisited = new Set(visited);
      nextVisited.add(org.id);
      const children = childrenByParent.get(org.id) || [];
      const record: OrgTableRecord = {
        ...org,
        childCount: children.length,
        descendantsCount: countDescendants(org.id),
        level,
        parentName: org.parent_id ? byId.get(org.parent_id)?.name || '-' : '-',
        path: getPath(org),
      };
      return [record, ...flatten(children, level + 1, nextVisited)];
    });

    const roots = (childrenByParent.get(null) || []).length
      ? childrenByParent.get(null) || []
      : orgUnits.filter((org) => !org.parent_id || !byId.has(org.parent_id)).sort(sortOrgs);

    return {
      byId,
      childrenByParent,
      tableRecords: flatten(roots),
    };
  }, [orgUnits]);

  useEffect(() => {
    if (!orgUnits.length) {
      setSelectedOrgId(null);
      return;
    }
    if (!selectedOrgId || !orgUnits.some((org) => org.id === selectedOrgId)) {
      setSelectedOrgId(orgUnits[0].id);
    }
  }, [orgUnits, selectedOrgId]);

  const filteredRecords = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    return orgMaps.tableRecords.filter((org) => {
      const matchesKeyword = !normalizedKeyword
        || org.name.toLowerCase().includes(normalizedKeyword)
        || org.code.toLowerCase().includes(normalizedKeyword)
        || org.path.join('/').toLowerCase().includes(normalizedKeyword)
        || (org.description || '').toLowerCase().includes(normalizedKeyword);
      const matchesType = !typeFilter || org.org_type === typeFilter;
      return matchesKeyword && matchesType;
    });
  }, [keyword, orgMaps.tableRecords, typeFilter]);

  useEffect(() => {
    setOrgPage(1);
  }, [keyword, typeFilter]);

  const pagedRecords = useMemo(() => {
    const start = (orgPage - 1) * orgPageSize;
    return filteredRecords.slice(start, start + orgPageSize);
  }, [filteredRecords, orgPage, orgPageSize]);

  const selectedOrg = useMemo(
    () => orgMaps.tableRecords.find((org) => org.id === selectedOrgId) || null,
    [orgMaps.tableRecords, selectedOrgId],
  );

  const selectedOrgMembers = useMemo(() => {
    if (!selectedOrg) return [];
    return users.filter((user) => user.org_units?.some((org) => org.id === selectedOrg.id));
  }, [selectedOrg, users]);

  const selectedOrgAuditLogs = useMemo(() => {
    if (!selectedOrg) return [];
    return auditLogs.filter((log) => (
      log.resource_id === selectedOrg.id
      || Boolean(log.new_values && (
        log.new_values.includes(selectedOrg.code)
        || log.new_values.includes(selectedOrg.name)
      ))
    ));
  }, [auditLogs, selectedOrg]);

  const descendantIds = useMemo(() => {
    if (!editingOrg) return new Set<number>();
    const collect = (orgId: number): number[] => (orgMaps.childrenByParent.get(orgId) || [])
      .flatMap((child) => [child.id, ...collect(child.id)]);
    return new Set(collect(editingOrg.id));
  }, [editingOrg, orgMaps.childrenByParent]);

  const parentOptions = useMemo(
    () => orgUnits
      .filter((org) => org.id !== editingOrg?.id && !descendantIds.has(org.id))
      .map((org) => ({ label: org.name, value: org.id })),
    [descendantIds, editingOrg?.id, orgUnits],
  );

  const openCreate = (parentId?: number) => {
    setEditingOrg(null);
    form.resetFields();
    form.setFieldsValue({
      org_type: parentId ? 'team' : 'department',
      parent_id: parentId,
      status: 'active',
      sort_order: 100,
    });
    setModalOpen(true);
  };

  const openEdit = (record: OrgUnitItem) => {
    setEditingOrg(record);
    form.setFieldsValue(record);
    setModalOpen(true);
  };

  const submitOrg = async () => {
    const values = await form.validateFields();
    try {
      if (editingOrg) {
        await adminUpdateOrgUnit(editingOrg.id, values);
        message.success('组织已更新');
      } else {
        await adminCreateOrgUnit(values);
        message.success('组织已创建');
      }
      setModalOpen(false);
      fetchData();
    } catch {
      message.error(editingOrg ? '更新组织失败' : '创建组织失败');
    }
  };

  const updateSelectedStatus = async (status: string) => {
    if (!selectedRowKeys.length) return;
    try {
      await Promise.all(selectedRowKeys.map((id) => adminUpdateOrgUnit(Number(id), { status })));
      message.success(status === 'active' ? '已批量启用组织' : '已批量停用组织');
      setSelectedRowKeys([]);
      fetchData();
    } catch {
      message.error('批量更新组织失败');
    }
  };

  const columns: ColumnsType<OrgTableRecord> = [
    {
      title: '组织名称',
      dataIndex: 'name',
      width: 260,
      fixed: 'left',
      render: (value: string, record) => {
        const typeMeta = getOrgTypeMeta(record.org_type);
        return (
          <div className="org-name-cell" style={{ paddingLeft: record.level * 18 }}>
            <span className="org-node-dot" />
            <div className="org-name-content">
              <Space size={6} wrap>
                <Typography.Text strong>{value}</Typography.Text>
                {record.childCount > 0 && <Tag color="processing">{record.childCount} 下级</Tag>}
                <Tag color={typeMeta.color}>{typeMeta.label}</Tag>
              </Space>
              <Typography.Text type="secondary" className="org-path-line">{record.path.join(' / ')}</Typography.Text>
            </div>
          </div>
        );
      },
    },
    { title: '编码', dataIndex: 'code', width: 140 },
    { title: '上级组织', dataIndex: 'parentName', width: 160 },
    {
      title: '成员',
      dataIndex: 'member_count',
      width: 90,
      render: (value?: number) => <Badge count={value || 0} showZero style={{ backgroundColor: '#2f5f73' }} />,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (value: string) => (value === 'active' ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>),
    },
    {
      title: '影响预览',
      width: 130,
      render: (_, record) => (
        <Space size={4}>
          <BranchesOutlined />
          <span>{record.descendantsCount + (record.member_count || 0)} 项</span>
        </Space>
      ),
    },
    { title: '说明', dataIndex: 'description', ellipsis: true },
    {
      title: '操作',
      width: 112,
      fixed: 'right',
      render: (_, record) => (
        <Space size={4}>
          <Tooltip title="新增下级">
            <Button size="small" icon={<PlusOutlined />} onClick={() => openCreate(record.id)} />
          </Tooltip>
          <Tooltip title="编辑">
            <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)} />
          </Tooltip>
          <Popconfirm title="确定删除该组织？" onConfirm={async () => { await adminDeleteOrgUnit(record.id); fetchData(); }}>
            <Tooltip title={record.childCount > 0 ? '请先处理下级组织' : (record.member_count || 0) > 0 ? '该组织仍有成员' : '删除'}>
              <Button
                size="small"
                danger
                icon={<DeleteOutlined />}
                disabled={record.childCount > 0 || (record.member_count || 0) > 0}
              />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="org-management-console">
      <div className="org-management-toolbar">
        <div>
          <Typography.Title level={5} style={{ margin: 0 }}>组织管理</Typography.Title>
          <Typography.Text type="secondary">
            组织用于表达工厂、部门、班组等数据范围来源，用户在用户管理中归属到这里。
          </Typography.Text>
        </div>
        <Space wrap>
          <Button icon={<ReloadOutlined />} loading={loading} onClick={fetchData} />
          <Button icon={<PlusOutlined />} onClick={() => selectedOrg && openCreate(selectedOrg.id)} disabled={!selectedOrg}>
            新增下级
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openCreate()}>新建组织</Button>
        </Space>
      </div>

      <div className="org-management-workbench">
        <div className="org-list-panel">
          <div className="org-toolbar">
            <Space wrap>
              <Input
                prefix={<SearchOutlined />}
                placeholder="搜索组织、编码或路径"
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                style={{ width: 240 }}
                allowClear
              />
              <Select
                placeholder="全部类型"
                value={typeFilter}
                onChange={setTypeFilter}
                options={ORG_TYPES.map(({ label, value }) => ({ label, value }))}
                style={{ width: 130 }}
                allowClear
              />
            </Space>
            <Space wrap>
              {selectedRowKeys.length > 0 && (
                <>
                  <Typography.Text type="secondary">已选 {selectedRowKeys.length} 项</Typography.Text>
                  <Button size="small" onClick={() => updateSelectedStatus('active')}>批量启用</Button>
                  <Button size="small" onClick={() => updateSelectedStatus('inactive')}>批量停用</Button>
                  <Button size="small" onClick={() => setSelectedRowKeys([])}>清除</Button>
                </>
              )}
            </Space>
          </div>

          <Table<OrgTableRecord>
            dataSource={pagedRecords}
            columns={columns}
            rowKey="id"
            loading={loading}
            size="small"
            className="org-management-table"
            pagination={false}
            rowSelection={{
              selectedRowKeys,
              onChange: setSelectedRowKeys,
            }}
            rowClassName={(record) => (record.id === selectedOrgId ? 'org-row-selected' : '')}
            scroll={{ x: 1080, y: '100%' }}
            onRow={(record) => ({
              onClick: () => setSelectedOrgId(record.id),
            })}
          />
          <div className="org-management-pagination">
            <Pagination
              current={orgPage}
              pageSize={orgPageSize}
              total={filteredRecords.length}
              showSizeChanger
              pageSizeOptions={[20, 50, 100, 200]}
              showTotal={(total) => `共 ${total} 个组织`}
              onChange={(page, pageSize) => {
                setOrgPage(page);
                setOrgPageSize(pageSize);
              }}
            />
          </div>
        </div>

        <OrgPreviewPanel
          org={selectedOrg}
          children={(selectedOrg && orgMaps.childrenByParent.get(selectedOrg.id)) || []}
          members={selectedOrgMembers}
          roles={roles}
          auditLogs={selectedOrgAuditLogs}
          onCreateChild={(id) => openCreate(id)}
          onEdit={(org) => openEdit(org)}
          onToggleStatus={async (org) => {
            await adminUpdateOrgUnit(org.id, { status: org.status === 'active' ? 'inactive' : 'active' });
            message.success(org.status === 'active' ? '组织已停用' : '组织已启用');
            fetchData();
          }}
          onDelete={async (org) => {
            await adminDeleteOrgUnit(org.id);
            message.success('组织已删除');
            fetchData();
          }}
        />
      </div>

      <Modal
        title={editingOrg ? '编辑组织' : '新建组织'}
        open={modalOpen}
        onOk={submitOrg}
        onCancel={() => setModalOpen(false)}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item label="组织名称" name="name" rules={[{ required: true, message: '请输入组织名称' }]}>
            <Input />
          </Form.Item>
          <Form.Item label="组织编码" name="code" rules={[{ required: true, message: '请输入组织编码' }]}>
            <Input placeholder="production" />
          </Form.Item>
          <Form.Item label="上级组织" name="parent_id">
            <Select allowClear options={parentOptions} />
          </Form.Item>
          <Form.Item label="组织类型" name="org_type">
            <Select options={ORG_TYPES.map(({ label, value }) => ({ label, value }))} />
          </Form.Item>
          <Form.Item label="排序" name="sort_order">
            <InputNumber style={{ width: '100%' }} min={0} />
          </Form.Item>
          <Form.Item label="状态" name="status">
            <Select options={[{ label: '启用', value: 'active' }, { label: '停用', value: 'inactive' }]} />
          </Form.Item>
          <Form.Item label="说明" name="description">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

function OrgPreviewPanel({
  org,
  children,
  members,
  roles,
  auditLogs,
  onCreateChild,
  onEdit,
  onToggleStatus,
  onDelete,
}: {
  org: OrgTableRecord | null;
  children: OrgUnitItem[];
  members: UserItem[];
  roles: RoleItem[];
  auditLogs: AuditLogItem[];
  onCreateChild: (id: number) => void;
  onEdit: (org: OrgUnitItem) => void;
  onToggleStatus: (org: OrgTableRecord) => Promise<void>;
  onDelete: (org: OrgTableRecord) => Promise<void>;
}) {
  const [activeTab, setActiveTab] = useState('detail');

  if (!org) {
    return (
      <div className="org-preview-panel">
        <Empty description="选择一个组织查看影响范围" />
      </div>
    );
  }

  const typeMeta = getOrgTypeMeta(org.org_type);
  const memberCount = org.member_count || 0;
  const memberRoleIds = new Set(members.flatMap((member) => member.roles?.map((role) => role.id) || []));
  const relatedRoleCount = memberRoleIds.size;
  const dataScopeCount = roles.reduce((count, role) => (
    count + (role.permissions || []).filter((permission) => (
      permission.data_scope && permission.data_scope !== 'all'
    )).length
  ), 0);
  const impactItems = [
    { label: '影响用户', value: memberCount, unit: '人' },
    { label: '关联角色', value: relatedRoleCount, unit: '个' },
    { label: '数据范围', value: dataScopeCount, unit: '个' },
    { label: '下级组织', value: org.childCount, unit: '个' },
  ];

  const tabs = [
    {
      key: 'detail',
      label: '详情',
      children: (
        <div className="org-detail-grid">
          <BasicInfoBlock org={org} typeLabel={typeMeta.label} />
        </div>
      ),
    },
    {
      key: 'impact',
      label: '影响范围',
      children: (
        <ImpactPreviewCard
          org={org}
          items={impactItems}
          onAssess={() => message.info('影响评估会基于成员、角色和数据范围策略生成审批前检查。')}
        />
      ),
    },
    {
      key: 'members',
      label: `成员 (${memberCount})`,
      children: <MembersBlock members={members} total={memberCount} />,
    },
    {
      key: 'children',
      label: `下级组织 (${org.childCount})`,
      children: <ChildrenBlock children={children} />,
    },
    {
      key: 'scope',
      label: '数据范围',
      children: <DataScopeBlock org={org} items={impactItems} />,
    },
    {
      key: 'audit',
      label: '审计记录',
      children: <AuditBlock records={auditLogs} users={members} />,
    },
  ];

  return (
    <aside className="org-preview-panel">
      <div className="org-preview-head">
        <div>
          <Space size={6} wrap>
            <Typography.Title level={5}>{org.name}</Typography.Title>
            {org.status === 'active' ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>}
          </Space>
        </div>
        <Space className="org-head-actions" wrap>
          <Button size="small" onClick={() => onEdit(org)}>编辑</Button>
          <Button size="small" onClick={() => onToggleStatus(org)}>{org.status === 'active' ? '停用' : '启用'}</Button>
          <Button size="small" onClick={() => onCreateChild(org.id)}>新增下级</Button>
          <Popconfirm title="确定删除该组织？" onConfirm={() => onDelete(org)}>
            <Button size="small" danger disabled={org.childCount > 0 || memberCount > 0}>删除</Button>
          </Popconfirm>
        </Space>
      </div>

      <Tabs
        className="org-preview-tabs"
        activeKey={activeTab}
        onChange={setActiveTab}
        items={tabs}
      />

    </aside>
  );
}

function BasicInfoBlock({ org, typeLabel }: { org: OrgTableRecord; typeLabel: string }) {
  return (
    <section className="org-info-card">
      <Typography.Text strong>基本信息</Typography.Text>
      <Descriptions column={1} size="small">
        <Descriptions.Item label="组织名称">{org.name}</Descriptions.Item>
        <Descriptions.Item label="编码">{org.code}</Descriptions.Item>
        <Descriptions.Item label="类型">{typeLabel}</Descriptions.Item>
        <Descriptions.Item label="上级组织">{org.parentName}</Descriptions.Item>
        <Descriptions.Item label="状态">{org.status === 'active' ? '启用' : '停用'}</Descriptions.Item>
        <Descriptions.Item label="说明">{org.description || '-'}</Descriptions.Item>
        <Descriptions.Item label="创建时间">{formatDateTime(org.created_at)}</Descriptions.Item>
        <Descriptions.Item label="创建人">未记录</Descriptions.Item>
        <Descriptions.Item label="最近变更">{formatDateTime(org.updated_at)}</Descriptions.Item>
      </Descriptions>
    </section>
  );
}

function ImpactPreviewCard({
  org,
  items,
  onAssess,
}: {
  org: OrgTableRecord;
  items: Array<{ label: string; value: number; unit: string }>;
  onAssess: () => void;
}) {
  return (
    <section className="org-impact-card">
      <div className="org-impact-head">
        <Typography.Text strong>影响预览</Typography.Text>
        <WarningOutlined />
      </div>
      <Alert
        type="warning"
        showIcon
        message={`${org.status === 'active' ? '停用或移动' : '启用'}该组织将影响以下范围`}
      />
      <div className="org-impact-list">
        {items.map((item) => (
          <div key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <em>{item.unit}</em>
          </div>
        ))}
      </div>
      <Alert
        type="warning"
        message="停用后，关联用户将无法访问该组织范围内的数据与应用。"
      />
      <Button block onClick={onAssess}>影响评估</Button>
    </section>
  );
}

function MembersBlock({ members, total }: { members: UserItem[]; total: number }) {
  const visibleMembers = members.slice(0, 5);
  const visibleCount = visibleMembers.length;
  const hiddenCount = Math.max(0, total - visibleCount);

  return (
    <section className="org-section-card">
      <div className="org-section-head">
        <Typography.Text strong>成员 ({total})</Typography.Text>
        <Button type="link" size="small">查看全部</Button>
      </div>
      <div className="org-member-summary">
        <div>
          <strong>{total}</strong>
          <span>当前组织成员</span>
        </div>
        <div>
          <strong>{visibleCount}</strong>
          <span>预览展示</span>
        </div>
        <div>
          <strong>{hiddenCount}</strong>
          <span>更多成员</span>
        </div>
      </div>
      <div className="org-member-list">
        {visibleMembers.length ? visibleMembers.map((member, index) => {
          const displayName = member.display_name || member.username;
          const primaryOrg = member.org_units?.find((org) => org.is_primary) || member.org_units?.[0];
          const roleLabel = member.roles?.map((role) => role.label || role.name).join(' / ') || '未分配角色';
          return (
            <div key={member.id} className="org-member-row">
              <Avatar size={34} style={{ backgroundColor: member.is_active === false ? '#9aa6ad' : '#2f5f73' }}>
                {displayName.slice(0, 1)}
              </Avatar>
              <div>
                <Space size={6}>
                  <Typography.Text strong>{displayName}</Typography.Text>
                  {primaryOrg?.is_primary && <Tag color="blue">主组织</Tag>}
                </Space>
                <Typography.Text type="secondary">{primaryOrg?.position_title || roleLabel}</Typography.Text>
              </div>
              <Tag color={member.is_active === false ? 'default' : 'green'}>
                {member.is_active === false ? '停用' : '启用'}
              </Tag>
            </div>
          );
        }) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无成员归属" />
        )}
        {hiddenCount > 0 && (
          <button type="button" className="org-member-more">
            还有 {hiddenCount} 位成员，点击查看完整成员清单
          </button>
        )}
      </div>
    </section>
  );
}

function ChildrenBlock({ children }: { children: OrgUnitItem[] }) {
  return (
    <section className="org-section-card">
      <div className="org-section-head">
        <Typography.Text strong>下级组织 ({children.length})</Typography.Text>
        <Button type="link" size="small">查看全部</Button>
      </div>
      <div className="org-child-table">
        <div>
          <span>组织</span>
          <span>成员</span>
          <span>状态</span>
        </div>
        {children.length ? children.map((child) => (
          <div key={child.id}>
            <span>{child.name} ({child.code})</span>
            <span>{child.member_count || 0}</span>
            <Tag color={child.status === 'active' ? 'green' : 'default'}>
              {child.status === 'active' ? '启用' : '停用'}
            </Tag>
          </div>
        )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无下级组织" />}
      </div>
    </section>
  );
}

function DataScopeBlock({
  org,
  items,
}: {
  org: OrgTableRecord;
  items: Array<{ label: string; value: number; unit: string }>;
}) {
  return (
    <section className="org-section-card">
      <Typography.Text strong>数据范围</Typography.Text>
      <Typography.Paragraph type="secondary">
        数据范围指角色权限在查询业务数据时会套用的组织边界，例如“本部门”“本部门及下级”或“指定组织”。
      </Typography.Paragraph>
      <div className="org-scope-list">
        <span><BranchesOutlined /> 当前路径：{org.path.join(' / ')}</span>
        <span><TeamOutlined /> 主组织成员：{org.member_count || 0} 人</span>
        <span><BranchesOutlined /> 下级继承：{org.descendantsCount} 个组织节点</span>
      </div>
      <div className="org-preview-stats">
        {items.slice(1).map((item) => (
          <div key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function AuditBlock({ records, users }: { records: AuditLogItem[]; users: UserItem[] }) {
  const usersById = new Map(users.map((user) => [user.id, user.display_name || user.username]));

  return (
    <section className="org-section-card">
      <Typography.Text strong>审计记录</Typography.Text>
      <div className="org-audit-list">
        {records.length ? records.slice(0, 6).map((record) => (
          <div key={record.id}>
            <i />
            <span>{formatDateTime(record.timestamp)}</span>
            <strong>{record.user_id ? usersById.get(record.user_id) || `用户 ${record.user_id}` : '系统'}</strong>
            <em>{auditActionText(record.action)}</em>
          </div>
        )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无组织审计记录" />}
      </div>
    </section>
  );
}

function formatDateTime(value?: string | null) {
  return formatServerDateTime(value, '未记录');
}

function auditActionText(action?: string) {
  const labels: Record<string, string> = {
    create: '创建组织',
    create_org_unit: '创建组织',
    update: '更新组织',
    update_org_unit: '更新组织',
    delete: '删除组织',
    delete_org_unit: '删除组织',
    disable: '停用组织',
    sync: '同步组织',
  };
  return labels[action || ''] || action || '组织变更';
}
