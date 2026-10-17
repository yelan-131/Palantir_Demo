import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { isAxiosError } from 'axios';
import { Alert, Button, DatePicker, Descriptions, Drawer, Empty, Form, Input, Modal, Select, Space, Spin, Statistic, Table, Tag, Timeline, Typography, message } from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { adminListUsers } from '../../services/api';
import { actOnAlert, alertError, createAlert, getAlert, listAlerts, type AlertAction, type AlertList, type AlertRecord, type AlertStatus } from '../../services/alerts';
import { useAuthStore } from '../../stores/authStore';
import { formatServerDateTime, parseServerDate } from '../../utils/dateTime';
import './style.css';

const statuses: Record<AlertStatus, { label: string; color: string }> = {
  pending: { label: '待处理', color: 'orange' },
  acknowledged: { label: '已确认', color: 'blue' },
  in_progress: { label: '处理中', color: 'processing' },
  resolved: { label: '待验证', color: 'cyan' },
  closed: { label: '已关闭', color: 'default' },
};
const actionLabels: Record<AlertAction, string> = { acknowledge: '确认告警', assign: '分派责任人', start: '开始处理', resolve: '提交处置', close: '验证并关闭' };
const historyLabels: Record<string, string> = { ...actionLabels, create: '登记告警', import: '历史记录迁入' };
const statusLabel = (value?: string) => value && value in statuses ? statuses[value as AlertStatus].label : value || '—';
function statusTag(status: AlertStatus) { const item = statuses[status]; return <Tag color={item?.color}>{item?.label || status}</Tag>; }
function isOverdue(row: AlertRecord) { const due = parseServerDate(row.due_at); return !['resolved', 'closed'].includes(row.status) && !!due && due.getTime() < Date.now(); }

export default function AlertCenter() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const [data, setData] = useState<AlertList | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState({ q: '', status: '', page: 1, page_size: 20 });
  const [search, setSearch] = useState('');
  const [revision, setRevision] = useState(0);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detail, setDetail] = useState<AlertRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [action, setAction] = useState<AlertAction | null>(null);
  const [saving, setSaving] = useState(false);
  const [users, setUsers] = useState<{ id: number; display_name?: string; username: string }[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [createForm] = Form.useForm();
  const [actionForm] = Form.useForm();
  const listRequest = useRef(0);
  const detailRequest = useRef(0);

  useEffect(() => {
    const request = ++listRequest.current;
    setLoading(true); setLoadError('');
    listAlerts(query).then((response) => {
      if (request !== listRequest.current) return;
      const result = response.data;
      if (result.total > 0 && query.page > Math.ceil(result.total / query.page_size)) {
        setQuery((current) => ({ ...current, page: Math.ceil(result.total / query.page_size) }));
      } else setData(result);
    }).catch((error) => { if (request === listRequest.current) { setData(null); setLoadError(alertError(error)); } })
      .finally(() => { if (request === listRequest.current) setLoading(false); });
    return () => { listRequest.current++; };
  }, [query, revision]);

  const loadDetail = useCallback(async (id: number) => {
    const request = ++detailRequest.current;
    setDetailLoading(true); setDetailError('');
    try { const response = await getAlert(id); if (request === detailRequest.current) setDetail(response.data.data); }
    catch (error) { if (request === detailRequest.current) { setDetail(null); setDetailError(alertError(error)); } }
    finally { if (request === detailRequest.current) setDetailLoading(false); }
  }, []);
  useEffect(() => {
    setDetail(null);
    if (detailId !== null) void loadDetail(detailId);
    return () => { detailRequest.current++; };
  }, [detailId, loadDetail]);

  const openAction = async (next: AlertAction) => {
    actionForm.resetFields(); actionForm.setFieldsValue({ owner_id: user?.id }); setAction(next);
    if (next === 'assign' && user?.is_admin) {
      setUsersLoading(true);
      try { const response = await adminListUsers(); setUsers((response.data?.data || []).filter((item: { is_active?: boolean }) => item.is_active !== false)); }
      catch { message.error('责任人列表加载失败，可先认领本人或稍后重试。'); setUsers([]); }
      finally { setUsersLoading(false); }
    }
  };
  const submitAction = async () => {
    if (!action || !detail || saving) return;
    let values;
    try { values = await actionForm.validateFields(); } catch { return; }
    setSaving(true);
    try {
      const response = await actOnAlert(detail.id, { action, expected_status: detail.status, comment: values.comment.trim(), ...(action === 'assign' ? { owner_id: values.owner_id } : {}) });
      setDetail(response.data.data); setAction(null); setRevision((value) => value + 1); message.success('告警已更新');
    } catch (error) {
      message.error(alertError(error));
      await loadDetail(detail.id); setRevision((value) => value + 1);
      if (isAxiosError(error) && error.response?.status === 409) setAction(null);
    } finally { setSaving(false); }
  };
  const submitCreate = async () => {
    if (saving) return;
    let values;
    try { values = await createForm.validateFields(); } catch { return; }
    setSaving(true);
    try {
      const response = await createAlert({ title: values.title.trim(), device: values.device?.trim(), level: values.level, source: values.source.trim(), occurred_at: values.occurred_at.toISOString(), due_at: values.due_at?.toISOString() });
      setCreateOpen(false); createForm.resetFields(); setRevision((value) => value + 1); setDetailId(response.data.data.id); message.success('告警已登记');
    } catch (error) { message.error(alertError(error)); }
    finally { setSaving(false); }
  };
  const ownerOptions = Array.from(new Map([
    ...(user ? [{ value: user.id, label: `${user.display_name || user.username}（我）` }] : []),
    ...users.map((item) => ({ value: item.id, label: item.id === user?.id ? `${item.display_name || item.username}（我）` : item.display_name || item.username })),
  ].map((item) => [item.value, item])).values());
  const canHandle = !!detail && !!user && (user.is_admin || detail.owner_id === user.id);

  return <div className="alert-center">
    <div className="alert-center-header">
      <Typography.Text type="secondary">跟进设备、质量与供应风险的处置进展。</Typography.Text>
      <Space wrap><Button onClick={() => navigate('/program/material-application')}>料号申请</Button><Button icon={<ReloadOutlined />} onClick={() => { setRevision((value) => value + 1); if (detailId !== null) void loadDetail(detailId); }}>刷新</Button><Button type="primary" icon={<PlusOutlined />} onClick={() => { createForm.resetFields(); setCreateOpen(true); }}>登记告警</Button></Space>
    </div>
    <div className="alert-center-stats">{([...Object.entries(statuses).map(([key, item]) => ({ key, label: item.label })), { key: 'overdue', label: '逾期未处置' }]).map((item) => <div className={`alert-center-stat${item.key === 'pending' ? ' hierarchy-kpi-primary' : ''}`} key={item.key}><Statistic title={item.label} value={data?.counts?.[item.key as keyof AlertList['counts']] ?? '—'} valueStyle={item.key === 'overdue' ? { color: (data?.counts?.overdue ?? 0) > 0 ? 'var(--mf-danger)' : 'var(--mf-muted)' } : undefined} /></div>)}</div>
    <div className="alert-center-filters"><Input.Search placeholder="搜索告警编号、标题、设备或来源" allowClear value={search} onChange={(event) => { setSearch(event.target.value); if (!event.target.value) setQuery((current) => ({ ...current, q: '', page: 1 })); }} onSearch={(q) => setQuery((current) => ({ ...current, q: q.trim(), page: 1 }))} enterButton="搜索" /><Select aria-label="告警状态" value={query.status} options={[{ value: '', label: '全部状态' }, ...Object.entries(statuses).map(([value, item]) => ({ value, label: item.label }))]} onChange={(status) => setQuery((current) => ({ ...current, status, page: 1 }))} /><Typography.Text type="secondary" style={{ alignSelf: 'center' }}>统计按当前搜索范围汇总</Typography.Text></div>
    {loadError && <Alert type="error" showIcon message={loadError} style={{ marginBottom: 16 }} action={<Button size="small" onClick={() => setRevision((value) => value + 1)}>重试</Button>} />}
    <Table<AlertRecord> className="alert-center-table" rowKey="id" loading={loading} dataSource={data?.data || []} scroll={{ x: 1000 }} locale={{ emptyText: loadError ? '告警加载失败' : <Empty description="当前条件下暂无告警" /> }} pagination={{ current: query.page, pageSize: query.page_size, total: data?.total || 0, showSizeChanger: true, pageSizeOptions: [20, 50, 100], showTotal: (total) => `共 ${total} 条告警`, onChange: (page, page_size) => setQuery((current) => ({ ...current, page: page_size !== current.page_size ? 1 : page, page_size })) }} columns={[
      { title: '告警', key: 'title', width: 300, render: (_, row) => <div><Button type="link" style={{ padding: 0, height: 'auto', whiteSpace: 'normal', textAlign: 'left' }} onClick={() => setDetailId(row.id)}>{row.title}</Button><div><Typography.Text type="secondary">{row.alert_id}</Typography.Text></div></div> },
      { title: '等级', dataIndex: 'level', width: 90, render: (level: string) => <Tag color={level === '严重' || level === 'critical' ? 'red' : level === '中等' || level === 'high' ? 'orange' : 'blue'}>{level}</Tag> },
      { title: '状态', dataIndex: 'status', width: 105, render: statusTag },
      { title: '设备 / 对象', dataIndex: 'device', width: 130, render: (value) => value || '—' },
      { title: '来源', dataIndex: 'source', width: 120, render: (value) => value || '—' },
      { title: '责任人', dataIndex: 'owner_name', width: 110, render: (value) => value || '待分派' },
      { title: '发生时间', dataIndex: 'occurred_at', width: 180, render: (value) => formatServerDateTime(value) },
      { title: '处理时限', key: 'due', width: 180, render: (_, row) => <Space direction="vertical" size={0}><span>{formatServerDateTime(row.due_at)}</span>{isOverdue(row) && <Tag color="red">已逾期</Tag>}</Space> },
    ]} />
    <Drawer title="告警详情" width={620} open={detailId !== null} onClose={() => { if (!saving) { setDetailId(null); setAction(null); } }} className="alert-center-detail">
      <Spin spinning={detailLoading}>
        {detailError && <Alert type="error" showIcon message={detailError} action={<Button size="small" onClick={() => detailId !== null && loadDetail(detailId)}>重试</Button>} />}
        {detail && <><Space wrap>{statusTag(detail.status)}<Tag>{detail.level}</Tag>{isOverdue(detail) && <Tag color="red">已逾期</Tag>}</Space><div className="overlay-record-heading"><Typography.Title level={4}>{detail.title}</Typography.Title><Typography.Text type="secondary">{detail.alert_id}</Typography.Text></div>
          <Descriptions column={1} size="small" items={[{ key: 'device', label: '设备 / 对象', children: <strong className="overlay-key-value">{detail.device || '—'}</strong> }, { key: 'source', label: '告警来源', children: detail.source || '—' }, { key: 'owner', label: '责任人', children: <strong className="overlay-key-value">{detail.owner_name || '待分派'}</strong> }, { key: 'occurred', label: '发生时间', children: formatServerDateTime(detail.occurred_at) }, { key: 'due', label: '处理时限', children: <strong className="overlay-key-value" style={isOverdue(detail) ? { color: 'var(--mf-danger)' } : undefined}>{formatServerDateTime(detail.due_at)}</strong> }]} />
          <Typography.Title level={5}>处置历史</Typography.Title>
          {detail.resolution && <Alert type="info" showIcon message="处置结论" description={<div className="alert-center-history-comment">{detail.resolution}</div>} style={{ marginBottom: 20 }} />}
          {detail.history?.length ? <Timeline items={detail.history.map((item, index) => ({ key: index, color: item.to_status === 'closed' ? 'green' : 'blue', children: <div><strong>{historyLabels[item.action || ''] || item.action || '记录更新'}</strong><div><Typography.Text type="secondary">{formatServerDateTime(item.created_at || item.at || item.time)} · {item.actor_name || item.actor || '系统'}</Typography.Text></div>{(item.from_status || item.to_status) && <div>{statusLabel(item.from_status)} → {statusLabel(item.to_status)}</div>}{item.comment && <div className="alert-center-history-comment">{item.comment}</div>}</div> }))} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无处置记录" />}
          <div className="alert-center-detail-actions"><Space wrap>
            {detail.status === 'pending' && <Button type="primary" disabled={saving} onClick={() => void openAction('acknowledge')}>确认告警</Button>}
            {detail.status !== 'closed' && detail.status !== 'resolved' && <Button disabled={saving || !user} onClick={() => void openAction('assign')}>{user?.is_admin ? '分派责任人' : '认领给我'}</Button>}
            {detail.status === 'acknowledged' && canHandle && <Button type="primary" disabled={saving} onClick={() => void openAction('start')}>开始处理</Button>}
            {detail.status === 'in_progress' && canHandle && <Button type="primary" disabled={saving} onClick={() => void openAction('resolve')}>提交处置结论</Button>}
            {detail.status === 'resolved' && canHandle && <Button type="primary" disabled={saving} onClick={() => void openAction('close')}>验证并关闭</Button>}
          </Space><div style={{ marginTop: 12 }}><Typography.Text type="secondary">待处理 → 已确认 → 处理中 → 待验证 → 已关闭。处置和关闭由责任人或管理员完成。</Typography.Text></div></div>
        </>}
      </Spin>
    </Drawer>
    <Modal title="登记告警" open={createOpen} onCancel={() => !saving && setCreateOpen(false)} onOk={() => void submitCreate()} confirmLoading={saving} okText="登记" cancelText="取消">
      <Form form={createForm} layout="vertical" initialValues={{ level: '一般', source: '人工上报' }}>
        <Form.Item className="form-field-primary" name="title" label="告警标题" rules={[{ required: true, whitespace: true, message: '请填写告警标题' }, { max: 200 }]}><Input maxLength={200} placeholder="描述需要处置的异常" /></Form.Item>
        <Form.Item name="device" label="设备 / 对象" rules={[{ max: 200 }]}><Input maxLength={200} placeholder="设备编号、产线或业务对象（可选）" /></Form.Item>
        <Form.Item name="level" label="告警等级" rules={[{ required: true }]}><Select options={['一般', '提醒', '严重'].map((value) => ({ value, label: value }))} /></Form.Item>
        <Form.Item name="source" label="来源" rules={[{ required: true, whitespace: true, message: '请填写告警来源' }, { max: 200 }]}><Select options={['人工上报', '系统监测', '外部接口'].map(value => ({ value, label: value }))} /></Form.Item>
        <Form.Item name="occurred_at" label="发生时间" rules={[{ required: true, message: '请选择发生时间' }]}><DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: '100%' }} /></Form.Item>
        <Form.Item name="due_at" label="处理时限（可选）" dependencies={['occurred_at']} rules={[({ getFieldValue }) => ({ validator(_, value) { const occurred = getFieldValue('occurred_at'); return !value || !occurred || value.valueOf() > occurred.valueOf() ? Promise.resolve() : Promise.reject(new Error('处理时限必须晚于发生时间')); } })]}><DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: '100%' }} /></Form.Item>
      </Form>
    </Modal>
    <Modal title={action ? actionLabels[action] : ''} open={action !== null} onCancel={() => !saving && setAction(null)} onOk={() => void submitAction()} confirmLoading={saving} okText="确认" cancelText="取消">
      <Form form={actionForm} layout="vertical">
        {action === 'assign' && <Form.Item name="owner_id" label="责任人" rules={[{ required: true, message: '请选择责任人' }]}><Select loading={usersLoading} disabled={!user?.is_admin} options={ownerOptions} showSearch optionFilterProp="label" /></Form.Item>}
        <Form.Item name="comment" label={action === 'resolve' ? '处置结论' : action === 'close' ? '验证结果' : '操作说明'} rules={[{ required: true, whitespace: true, message: '请填写说明，记录本次处置依据' }, { max: 2000 }]}><Input.TextArea rows={4} maxLength={2000} showCount placeholder={action === 'resolve' ? '填写原因、采取的措施和处理结果' : action === 'close' ? '填写复核依据和验证结果' : '填写本次操作的说明'} /></Form.Item>
      </Form>
    </Modal>
  </div>;
}
