import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { isAxiosError } from 'axios';
import { Alert, Button, Descriptions, Drawer, Empty, Form, Input, Modal, Select, Space, Spin, Statistic, Steps, Table, Tag, Timeline, Typography, message } from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { actOnMaterialApplication, createMaterialApplication, editMaterialApplication, getMaterialApplication, listMaterialApplications, materialError, type MaterialAction, type MaterialApplication, type MaterialList, type MaterialStatus } from '../../services/materialApplications';
import { formatServerDateTime } from '../../utils/dateTime';
import './style.css';
const statuses: Record<MaterialStatus, { label: string; color: string }> = { draft: { label: '待提交', color: 'default' }, pending: { label: '待审批', color: 'processing' }, approved: { label: '已通过', color: 'success' }, rejected: { label: '已驳回', color: 'error' }, legacy: { label: '历史申请', color: 'default' } };
const actions: Record<MaterialAction, string> = { submit: '提交审批', approve: '通过申请', reject: '驳回申请' };
const historyLabels: Record<string, string> = { ...actions, create: '登记草稿', edit: '修改申请', update: '修改申请', import: '历史申请迁入' };
const statusLabel = (value?: string) => value ? statuses[value as MaterialStatus]?.label || value : '—';
const statusTag = (row: MaterialApplication) => <Space size={4}><Tag color={statuses[row.status]?.color}>{statusLabel(row.status)}</Tag>{row.is_legacy && row.legacy_status && <Tag>{row.legacy_status}</Tag>}</Space>;
const sourceRoute = (row: MaterialApplication) => { const route = typeof row.approval_source === 'string' ? row.approval_source : row.approval_source?.route; return route && /^\/workflow(?:\?|$)/.test(route) ? route : null; };
export default function MaterialApplications({ embedded = false }: { embedded?: boolean }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const linkedRecordId = Number(searchParams.get('record_id') || searchParams.get('recordId'));
  const [data, setData] = useState<MaterialList | null>(null), [loading, setLoading] = useState(false), [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState({ q: '', status: '', page: 1, page_size: 20 }), [search, setSearch] = useState(''), [revision, setRevision] = useState(0);
  const [detailId, setDetailId] = useState<number | null>(null), [detail, setDetail] = useState<MaterialApplication | null>(null), [detailLoading, setDetailLoading] = useState(false), [detailError, setDetailError] = useState('');
  const [editor, setEditor] = useState<'create' | 'edit' | null>(null), [action, setAction] = useState<MaterialAction | null>(null), [saving, setSaving] = useState(false);
  const [editForm] = Form.useForm(), [actionForm] = Form.useForm();
  const listRequest = useRef(0), detailRequest = useRef(0);
  useEffect(() => {
    const request = ++listRequest.current; setLoading(true); setLoadError('');
    listMaterialApplications(query).then(({ data: result }) => { if (request !== listRequest.current) return; const lastPage = Math.max(1, Math.ceil(result.total / query.page_size)); if (query.page > lastPage) setQuery((q) => ({ ...q, page: lastPage })); else setData(result); })
      .catch((error) => { if (request === listRequest.current) { setData(null); setLoadError(materialError(error)); } }).finally(() => { if (request === listRequest.current) setLoading(false); });
    return () => { listRequest.current++; };
  }, [query, revision]);
  const loadDetail = useCallback(async (id: number) => { const request = ++detailRequest.current; setDetailLoading(true); setDetailError(''); try { const response = await getMaterialApplication(id); if (request === detailRequest.current) setDetail(response.data.data); } catch (error) { if (request === detailRequest.current) { setDetail(null); setDetailError(materialError(error)); } } finally { if (request === detailRequest.current) setDetailLoading(false); } }, []);
  useEffect(() => { setDetail(null); if (detailId !== null) void loadDetail(detailId); return () => { detailRequest.current++; }; }, [detailId, loadDetail]);
  useEffect(() => {
    setDetailId(Number.isSafeInteger(linkedRecordId) && linkedRecordId > 0 ? linkedRecordId : null);
  }, [linkedRecordId]);
  const openDetail = (id: number | null) => {
    const params = new URLSearchParams(searchParams);
    params.delete('recordId');
    if (id === null) params.delete('record_id'); else params.set('record_id', String(id));
    setSearchParams(params, { replace: true });
    setDetailId(id);
  };
  const openEditor = (mode: 'create' | 'edit') => { editForm.resetFields(); if (mode === 'edit' && detail) editForm.setFieldsValue({ part_no: detail.part_no, title: detail.title }); setEditor(mode); };
  const failure = async (error: unknown, id?: number) => { message.error(materialError(error)); if (id !== undefined) await loadDetail(id); setRevision((r) => r + 1); if (isAxiosError(error) && [403, 409, 404].includes(error.response?.status || 0)) { setAction(null); setEditor(null); } };
  const saveDraft = async () => {
    if (saving || !editor || (editor === 'edit' && !detail)) return;
    let values; try { values = await editForm.validateFields(); } catch { return; } setSaving(true);
    try { const body = { part_no: values.part_no.trim(), title: values.title.trim() }; const response = editor === 'edit' && detail ? await editMaterialApplication(detail.id, { ...body, expected_status: detail.status }) : await createMaterialApplication(body); const row = response.data.data; setEditor(null); setRevision((r) => r + 1); if (detailId === row.id) setDetail(row); else openDetail(row.id); message.success('申请已保存，确认后可提交审批'); } catch (error) { await failure(error, editor === 'edit' ? detail?.id : undefined); } finally { setSaving(false); }
  };
  const performAction = async () => {
    if (saving || !action || !detail) return; let values; try { values = await actionForm.validateFields(); } catch { return; } setSaving(true);
    try { const response = await actOnMaterialApplication(detail.id, action, { expected_status: detail.status, ...(action !== 'submit' ? { comment: values.comment?.trim() || '' } : {}) }); setDetail(response.data.data); setAction(null); setRevision((r) => r + 1); message.success(action === 'submit' ? '申请已提交审批' : action === 'approve' ? '申请已通过' : '申请已驳回，申请人可修改后重新提交'); } catch (error) { await failure(error, detail.id); } finally { setSaving(false); }
  };
  const openAction = (next: MaterialAction) => { actionForm.resetFields(); setAction(next); };
  return <div className="material-applications" style={embedded ? { padding: '8px 0 24px' } : undefined}>
    <div className="material-applications-header"><Typography.Text type="secondary">提交后进入审批，驳回后可修改重提。</Typography.Text><Space wrap><Button onClick={() => navigate('/workflow?tab=pending')}>流程与待办</Button><Button icon={<ReloadOutlined />} onClick={() => { setRevision((r) => r + 1); if (detailId !== null) void loadDetail(detailId); }}>刷新</Button><Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor('create')}>登记申请</Button></Space></div>
    <Alert type="info" showIcon message="审批通过代表申请获准，不会自动新增或更新物料主数据。" />
    <div className="material-applications-stats">{Object.entries(statuses).map(([key, item]) => <div className={`material-applications-stat${key === 'pending' ? ' hierarchy-kpi-primary' : ''}`} key={key}><Statistic title={item.label} value={data?.counts?.[key as MaterialStatus] ?? '—'} /></div>)}</div>
    <div className="material-applications-filters"><Input.Search placeholder="搜索申请编号、料号、标题或申请人" value={search} allowClear enterButton="搜索" onChange={(event) => { setSearch(event.target.value); if (!event.target.value) setQuery((q) => ({ ...q, q: '', page: 1 })); }} onSearch={(q) => setQuery((current) => ({ ...current, q: q.trim(), page: 1 }))} /><Select aria-label="申请状态" value={query.status} options={[{ value: '', label: '全部状态' }, ...Object.entries(statuses).map(([value, item]) => ({ value, label: item.label }))]} onChange={(status) => setQuery((q) => ({ ...q, status, page: 1 }))} /><Typography.Text type="secondary" style={{ alignSelf: 'center' }}>统计按当前搜索范围汇总</Typography.Text></div>
    {loadError && <Alert type="error" showIcon message={loadError} style={{ marginBottom: 16 }} action={<Button size="small" onClick={() => setRevision((r) => r + 1)}>重试</Button>} />}
    <Table<MaterialApplication> className="material-applications-table" rowKey="id" loading={loading} dataSource={data?.data || []} scroll={{ x: 1000 }} locale={{ emptyText: loadError ? '申请加载失败' : <Empty description="当前条件下暂无申请" /> }} pagination={{ current: query.page, pageSize: query.page_size, total: data?.total || 0, showSizeChanger: true, pageSizeOptions: [20, 50, 100], showTotal: (total) => `共 ${total} 条申请`, onChange: (page, page_size) => setQuery((q) => ({ ...q, page: page_size !== q.page_size ? 1 : page, page_size })) }} columns={[
      { title: '申请', key: 'title', width: 300, render: (_, row) => <div><Button type="link" style={{ padding: 0, height: 'auto', whiteSpace: 'normal', textAlign: 'left' }} onClick={() => openDetail(row.id)}>{row.title}</Button><div><Typography.Text type="secondary">{row.request_no}</Typography.Text></div></div> },
      { title: '料号', dataIndex: 'part_no', width: 160 }, { title: '状态', key: 'status', width: 180, render: (_, row) => statusTag(row) }, { title: '申请人', dataIndex: 'applicant', width: 120, render: (v) => v || '—' }, { title: '当前审批人', key: 'assignees', width: 160, render: (_, row) => row.current_assignees?.map((item) => item.name).join('、') || '—' }, { title: '申请时间', dataIndex: 'applied_at', width: 180, render: (v) => formatServerDateTime(v) },
    ]} />
    <Drawer title="料号申请详情" width={660} open={detailId !== null} onClose={() => { if (!saving) { openDetail(null); setEditor(null); setAction(null); } }} className="material-applications-detail"><Spin spinning={detailLoading}>
      {detailError && <Alert type="error" showIcon message={detailError} action={<Button size="small" onClick={() => detailId !== null && loadDetail(detailId)}>重试</Button>} />}
      {detail && <>{statusTag(detail)}<div className="overlay-record-heading"><Typography.Title level={4}>{detail.title}</Typography.Title><Typography.Text type="secondary">{detail.request_no}</Typography.Text></div>
        <Descriptions column={1} size="small" items={[{ key: 'part', label: '料号', children: <strong className="overlay-record-key">{detail.part_no}</strong> }, { key: 'applicant', label: '申请人', children: detail.applicant || '—' }, { key: 'date', label: '申请时间', children: formatServerDateTime(detail.applied_at) }, { key: 'assignees', label: '当前审批人', children: <strong className="overlay-key-value">{detail.current_assignees?.map((item) => item.name).join('、') || '—'}</strong> }, { key: 'workflow', label: '审批实例', children: detail.workflow_id ? `#${detail.workflow_id}${detail.workflow_version ? ` · 版本 ${detail.workflow_version}` : ''}` : detail.is_legacy ? '查看原审批关联' : '尚未提交' }]} />
        {detail.is_legacy ? <Alert type="info" showIcon message="历史申请只读保留" description="原状态与原审批关联保留，不会重新创建审批实例。" action={sourceRoute(detail) ? <Button onClick={() => navigate(sourceRoute(detail)!)}>查看原审批</Button> : undefined} /> : <><Steps size="small" current={detail.status === 'draft' ? 0 : detail.status === 'pending' || detail.status === 'rejected' ? 1 : 2} status={detail.status === 'rejected' ? 'error' : detail.status === 'approved' ? 'finish' : 'process'} items={[{ title: '待提交' }, { title: detail.status === 'rejected' ? '已驳回' : '待审批' }, { title: '已通过' }]} />{detail.status === 'rejected' && <Alert style={{ marginTop: 16 }} type="warning" showIcon message="申请已驳回，请查看审批意见。申请人可修改后重新提交。" />}</>}
        <Typography.Title level={5} style={{ marginTop: 24 }}>状态与审批历史</Typography.Title>
        {detail.history?.length ? <Timeline items={detail.history.map((item, index) => ({ key: index, color: item.action === 'reject' ? 'red' : item.action === 'approve' ? 'green' : 'blue', children: <div><strong>{historyLabels[item.action] || item.action || '记录更新'}</strong><div><Typography.Text type="secondary">{formatServerDateTime(item.created_at)} · {item.actor_name || '系统'}</Typography.Text></div>{(item.from_status || item.to_status) && <div>{statusLabel(item.from_status)} → {statusLabel(item.to_status)}</div>}{item.workflow_id && <div><Typography.Text type="secondary">审批实例 #{item.workflow_id}</Typography.Text></div>}{item.comment && <div className="material-applications-history-comment">{item.comment}</div>}</div> }))} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={detail.is_legacy ? '暂无迁入的审批历史，请查看原审批' : '暂无操作历史'} />}
        {!detail.is_legacy && <div className="material-applications-actions"><Space wrap>{detail.can_edit && <Button disabled={saving || detailLoading} onClick={() => openEditor('edit')}>修改申请</Button>}{detail.can_submit && <Button type="primary" disabled={saving || detailLoading} onClick={() => openAction('submit')}>{detail.status === 'rejected' ? '重新提交审批' : '提交审批'}</Button>}{detail.can_approve && <><Button type="primary" disabled={saving || detailLoading} onClick={() => openAction('approve')}>通过申请</Button><Button danger disabled={saving || detailLoading} onClick={() => openAction('reject')}>驳回申请</Button></>}</Space><div style={{ marginTop: 12 }}><Typography.Text type="secondary">操作权限由申请人和当前审批任务决定。审批结果会写入历史；通过后不自动写入物料主数据。</Typography.Text></div></div>}
      </>}
    </Spin></Drawer>
    <Modal title={editor === 'edit' ? '修改料号申请' : '登记料号申请'} open={editor !== null} onCancel={() => !saving && setEditor(null)} onOk={() => void saveDraft()} confirmLoading={saving} okText="保存草稿" cancelText="取消"><Form form={editForm} layout="vertical"><Form.Item className="form-field-primary" name="part_no" label="料号" rules={[{ required: true, whitespace: true, message: '请填写料号' }, { max: 100 }]}><Input maxLength={100} placeholder="填写拟申请的料号" /></Form.Item><Form.Item className="form-field-primary" name="title" label="申请标题" rules={[{ required: true, whitespace: true, message: '请填写申请标题' }, { max: 200 }]}><Input maxLength={200} placeholder="描述申请内容" /></Form.Item><Typography.Text type="secondary">保存后仍需提交审批。申请人和状态由系统记录。</Typography.Text></Form></Modal>
    <Modal title={action ? actions[action] : ''} open={action !== null} onCancel={() => !saving && setAction(null)} onOk={() => void performAction()} confirmLoading={saving} okText={action === 'submit' ? '确认提交' : action === 'approve' ? '确认通过' : '确认驳回'} okButtonProps={{ danger: action === 'reject' }} cancelText="取消"><Form form={actionForm} layout="vertical">{action === 'submit' ? <Alert type="info" showIcon message={`提交料号 ${detail?.part_no || ''} 的申请`} description="提交后进入审批，审批期间不可修改。若被驳回，申请人可修改并重新提交，历史记录将保留。" /> : <><Typography.Paragraph>{action === 'approve' ? '通过后申请结束，不自动写入物料主数据。' : '驳回后申请人可修改并重新提交。请说明需要调整的内容。'}</Typography.Paragraph><Form.Item name="comment" label={action === 'reject' ? '驳回理由' : '审批意见（可选）'} rules={[{ required: action === 'reject', whitespace: true, message: '请填写驳回理由' }, { max: 2000 }]}><Input.TextArea rows={4} maxLength={2000} showCount placeholder={action === 'reject' ? '填写驳回原因和修改建议' : '填写本次审批依据'} /></Form.Item></>}</Form></Modal>
  </div>;
}
