import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseOutlined,
  EditOutlined,
  FileSearchOutlined,
  FormOutlined,
  SearchOutlined,
  HistoryOutlined,
  InboxOutlined,
  RollbackOutlined,
} from '@ant-design/icons';
import { Alert, Button, Drawer, Empty, Input, Modal, Select, Space, Tabs, Tag, Timeline, Tooltip, Typography, message } from 'antd';
import { createRef, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getFormReferenceOptions, wfApproveOrReject, wfListBusinessItems } from '@/services/api';
import { displayWorkflowValue } from './fieldDisplay';
import { APPROVAL_NOTIFICATIONS_CHANGED } from '@/components/NotificationCenter';
import { WORKFLOW_VIEWS, normalizedWorkflowView as normalizedView } from '@/config/navigation';
import { formatServerDateTime } from '@/utils/dateTime';

export type WorkflowTab = 'draft' | 'pending' | 'running' | 'done' | 'returned' | 'rejected';
type WorkflowViewTab = 'pending' | 'initiated' | 'processed';

type WorkflowBusinessApplication = {
  id: number;
  name: string;
  code: string;
  default_route?: string | null;
};

type WorkflowBusinessForm = {
  id: number;
  name: string;
  code: string;
  status: string;
  record_count?: number;
  applications?: WorkflowBusinessApplication[];
};

type WorkflowBusinessField = {
  field_name: string;
  label: string;
  value?: unknown;
  field_type?: string;
  control_type?: string | null;
  required?: boolean;
  enum_values?: Record<string, unknown> | null;
  ui_config?: Record<string, unknown> | null;
  value_labels?: Record<string, string>;
  changed?: boolean;
  old_value?: unknown;
  previous_value?: unknown;
  before_value?: unknown;
  new_value?: unknown;
};

type WorkflowBusinessItem = {
  id: string;
  source: 'dynamic_record' | 'workflow_instance' | string;
  status: WorkflowTab;
  raw_status?: string;
  views?: WorkflowViewTab[];
  can_approve?: boolean;
  title: string;
  summary?: string;
  application?: WorkflowBusinessApplication | null;
  applications?: WorkflowBusinessApplication[];
  form?: { id: number; name: string; code: string } | null;
  record?: { id: number; status?: string; created_at?: string | null; updated_at?: string | null } | null;
  workflow?: {
    id: number;
    workflow_id: number;
    initiator_id?: number | null;
    current_node_id?: string;
    approvals?: Array<{ id: number; node_id?: string | null; approver_id?: number | null; approver_name?: string | null; action?: string | null; comment?: string | null; acted_at?: string | null }>;
    current_assignees?: Array<{ id: number; name: string; username?: string | null }>;
  } | null;
  fields?: WorkflowBusinessField[];
  current_node?: string;
  current_assignees?: Array<{ id: number; name: string; username?: string | null }>;
  updated_at?: string | null;
  created_at?: string | null;
  route_path?: string | null;
};

type WorkflowBusinessDataset = {
  applications: WorkflowBusinessApplication[];
  forms: WorkflowBusinessForm[];
  items: WorkflowBusinessItem[];
  view_counts?: Partial<Record<WorkflowViewTab, number>>;
};

const statusMeta: Record<string, { label: string; color: string; icon: JSX.Element; description: string }> = {
  draft: { label: '草稿', color: 'default', icon: <EditOutlined />, description: '已保存但还没有提交' },
  pending: { label: '待审批', color: 'warning', icon: <InboxOutlined />, description: '需要当前用户处理' },
  running: { label: '审批中', color: 'processing', icon: <ClockCircleOutlined />, description: '正在流程中流转' },
  done: { label: '已通过', color: 'success', icon: <CheckCircleOutlined />, description: '已完成闭环' },
  returned: { label: '已退回', color: 'error', icon: <RollbackOutlined />, description: '需要补充后重新提交' },
};

statusMeta.rejected = { label: '已驳回', color: 'error', icon: <RollbackOutlined />, description: '审批已拒绝' };

const approvalTabs = WORKFLOW_VIEWS;

function actionLabel(action?: string | null) {
  return ({ approve: '审批通过', reject: '驳回申请', return: '退回申请', cancel: '取消申请' } as Record<string, string>)[action || ''] || action || '等待处理';
}

function actionError(error: unknown) {
  const response = error as { response?: { status?: number; data?: { detail?: unknown } } };
  const detail = response.response?.data?.detail;
  return { status: response.response?.status, message: typeof detail === 'string' ? detail : '操作失败，请刷新后重试' };
}

function unwrapDataset(payload: unknown): WorkflowBusinessDataset {
  const response = payload as { data?: unknown };
  const outer = response.data;
  const nested = outer && typeof outer === 'object' && 'data' in outer
    ? (outer as { data?: unknown }).data
    : outer;
  const data = nested as Partial<WorkflowBusinessDataset> | undefined;
  return {
    applications: Array.isArray(data?.applications) ? data.applications : [],
    forms: Array.isArray(data?.forms) ? data.forms : [],
    items: Array.isArray(data?.items) ? data.items : [],
    view_counts: data?.view_counts || {},
  };
}

function formatValue(value: unknown) {
  if (value === undefined || value === null || value === '') return '-';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function formatTime(value?: string | null) {
  return formatServerDateTime(value);
}

function fieldOldValue(field: WorkflowBusinessField) {
  if ('old_value' in field) return field.old_value;
  if ('previous_value' in field) return field.previous_value;
  if ('before_value' in field) return field.before_value;
  return undefined;
}

function fieldNewValue(field: WorkflowBusinessField) {
  if ('new_value' in field) return field.new_value;
  return field.value;
}

function isChangedField(field: WorkflowBusinessField) {
  const oldValue = fieldOldValue(field);
  if (field.changed) return true;
  if (oldValue === undefined) return false;
  return formatValue(oldValue) !== formatValue(fieldNewValue(field));
}

function isChoiceField(field: WorkflowBusinessField) {
  const fieldType = String(field.field_type || '').toLowerCase();
  const controlType = String(field.control_type || field.ui_config?.controlType || field.ui_config?.control_type || '').toLowerCase();
  return ['enum', 'select', 'radio', 'checkbox', 'relation', 'lookup', 'status'].some((type) => fieldType.includes(type) || controlType.includes(type));
}

function splitChoiceValues(value: unknown) {
  if (Array.isArray(value)) return value.map(formatValue);
  return [formatValue(value)];
}

function changeTooltipTitle(field: WorkflowBusinessField) {
  return (
    <div className="workflow-field-change-tooltip">
      <div><span>变更前</span><strong>{displayWorkflowValue(field, fieldOldValue(field))}</strong></div>
      <div><span>变更后</span><strong>{displayWorkflowValue(field, fieldNewValue(field))}</strong></div>
    </div>
  );
}

function renderBusinessFieldValue(field: WorkflowBusinessField) {
  const changed = isChangedField(field);
  const value = fieldNewValue(field);
  const content = isChoiceField(field) && formatValue(value) !== '-' ? (
    <span className="workflow-business-choice-values">
      {splitChoiceValues(value).map((item) => (
        <Tag className="workflow-business-choice-tag" key={item}>{displayWorkflowValue(field, item)}</Tag>
      ))}
    </span>
  ) : (
    <strong>{displayWorkflowValue(field, value)}</strong>
  );

  const valueNode = <div className={changed ? 'workflow-business-sheet-value is-changed' : 'workflow-business-sheet-value'}>{content}</div>;
  return changed ? <Tooltip title={changeTooltipTitle(field)}>{valueNode}</Tooltip> : valueNode;
}

function sourceLabel(item: WorkflowBusinessItem) {
  if (item.source === 'dynamic_record') return '表单记录';
  if (item.source === 'workflow_instance') return '流程实例';
  return item.source;
}

function currentAssigneeLabel(item: WorkflowBusinessItem) {
  const assignees = item.current_assignees || item.workflow?.current_assignees || [];
  if (!assignees.length) return item.status === 'done' ? '已完成' : '-';
  return assignees.map((assignee) => assignee.name || assignee.username || `用户 #${assignee.id}`).join('、');
}

function workflowCardPrimaryFields(item: WorkflowBusinessItem) {
  const fields = Array.isArray(item.fields) ? item.fields : [];
  return fields
    .slice(0, 4)
    .map((field) => ({
      key: field.field_name,
      label: field.label || field.field_name,
      value: displayWorkflowValue(field, field.value),
    }));
}

function workflowStatusClass(status: string) {
  return `workflow-status-${statusMeta[status] ? status : 'default'}`;
}

export default function WorkflowPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('section') === 'materials' ? 'initiated' : normalizedView(searchParams.get('tab'));

  useEffect(() => {
    if (searchParams.get('section') !== 'materials') return;
    const next = new URLSearchParams(searchParams);
    next.delete('section');
    next.set('tab', 'initiated');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);
  const [dataset, setDataset] = useState<WorkflowBusinessDataset>({ applications: [], forms: [], items: [], view_counts: {} });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');
  const [formFilter, setFormFilter] = useState<number | undefined>();
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [detailOpen, setDetailOpen] = useState(false);
  const openedInstance = useRef<string | null>(null);
  const [instanceNotice, setInstanceNotice] = useState('');
  const [approvalLoading, setApprovalLoading] = useState<'approve' | 'reject' | null>(null);
  const loadRequestId = useRef(0);

  const loadItems = async () => {
    const request = ++loadRequestId.current;
    setLoading(true);
    setLoadError('');
    try {
      const sourceForm = Number(searchParams.get('source_form_id'));
      const sourceRecord = Number(searchParams.get('source_record_id'));
      const res = await wfListBusinessItems(sourceForm > 0 && sourceRecord > 0
        ? { source_form_id: sourceForm, source_record_id: sourceRecord }
        : undefined);
      const next = unwrapDataset(res);
      const requests = new Map<string, Promise<Record<string, string>>>();
      await Promise.all(next.items.flatMap(item => (item.fields || []).map(async field => {
        if (!item.form || field.value == null || field.value === '') return;
        let relation = field.ui_config?.relation_config;
        try { if (typeof relation === 'string') relation = JSON.parse(relation); } catch { return; }
        if (!relation || typeof relation !== 'object') return;
        const source = relation as Record<string, unknown>;
        if (!source.target_model && !source.target_form_code && !source.source_kind) return;
        const settings = field.ui_config?.typeSettings as { search?: { filters?: Array<{ source?: string; sourceField?: string }> } } | undefined;
        const dependencies = (settings?.search?.filters || []).filter(filter => filter.source === 'field' && filter.sourceField).map(filter => filter.sourceField!);
        const context = Object.fromEntries((item.fields || []).filter(candidate => dependencies.includes(candidate.field_name)).map(candidate => [candidate.field_name, candidate.value]));
        const ids = Array.isArray(field.value) ? field.value : [field.value];
        const labels = await Promise.all(ids.filter(value => ['string', 'number'].includes(typeof value) && !String(value).includes('*')).map(async selected => {
          const key = JSON.stringify([item.form!.id, field.field_name, selected, context]);
          if (!requests.has(key)) requests.set(key, getFormReferenceOptions(item.form!.id, field.field_name, context, { selected: selected as string | number })
            .then(response => Object.fromEntries((response.data.data || []).map((option: { id: string | number; label: string }) => [String(option.id), option.label])))
            .catch(() => ({})));
          return requests.get(key)!;
        }));
        field.value_labels = Object.assign({}, ...labels);
      })));
      if (request === loadRequestId.current) setDataset(next);
    } catch (error) {
      if (request !== loadRequestId.current) return;
      setLoadError(actionError(error).message);
      setDataset({ applications: [], forms: [], items: [], view_counts: {} });
    } finally {
      if (request === loadRequestId.current) setLoading(false);
    }
  };

  useEffect(() => {
    loadItems();
    return () => { loadRequestId.current += 1; };
  }, [searchParams.get('source_form_id'), searchParams.get('source_record_id')]);

  useEffect(() => {
    const refresh = () => { void loadItems(); };
    window.addEventListener(APPROVAL_NOTIFICATIONS_CHANGED, refresh);
    return () => window.removeEventListener(APPROVAL_NOTIFICATIONS_CHANGED, refresh);
  }, [searchParams.get('source_form_id'), searchParams.get('source_record_id')]);

  useEffect(() => {
    const requested = searchParams.get('instance_id');
    if (!requested) { openedInstance.current = null; setInstanceNotice(''); return; }
    if (loading || loadError || openedInstance.current === requested) return;
    const item = dataset.items.find(item => item.workflow?.id === Number(requested));
    if (!item) {
      setSelectedId(undefined);
      setDetailOpen(false);
      setInstanceNotice('该流程已不可查看或当前账号没有访问权限，请刷新待办或联系管理员。');
      return;
    }
    openedInstance.current = requested;
    setInstanceNotice('');
    setSelectedId(item.id);
    setDetailOpen(true);
    // Finished notifications belong to history; never leave them on pending.
    const tab = normalizedView(searchParams.get('tab'));
    if (!item.views?.includes(tab)) {
      const next = new URLSearchParams(searchParams);
      next.set('tab', item.views?.includes('initiated') ? 'initiated' : item.views?.includes('processed') ? 'processed' : 'pending');
      setSearchParams(next, { replace: true });
    }
  }, [dataset.items, loading, loadError, searchParams, setSearchParams]);

  const closeWorkflowDetail = () => {
    setDetailOpen(false);
    const next = new URLSearchParams(searchParams);
    next.delete('instance_id');
    setSearchParams(next, { replace: true });
  };

  const sourceFormId = Number(searchParams.get('source_form_id'));
  const sourceRecordId = Number(searchParams.get('source_record_id'));
  const sourceScoped = sourceFormId > 0 && sourceRecordId > 0;
  const sourceItems = useMemo(() => sourceScoped
    ? dataset.items.filter(item => item.form?.id === sourceFormId && item.record?.id === sourceRecordId)
    : dataset.items, [dataset.items, sourceScoped, sourceFormId, sourceRecordId]);
  const filteredItems = useMemo(() => sourceItems.filter(item => {
    if (!sourceScoped && !item.views?.includes(activeTab)) return false;
    if (formFilter && item.form?.id !== formFilter) return false;
    const text = query.trim().toLowerCase();
    if (!text) return true;
    return [item.title, item.summary, item.form?.name, item.form?.code, item.application?.name,
      item.workflow?.id, item.record?.id, ...(item.fields || []).map(field => displayWorkflowValue(field, field.value))]
      .some(value => String(value || '').toLowerCase().includes(text));
  }), [activeTab, sourceItems, sourceScoped, formFilter, query]);
  const selectedItem = dataset.items.find((item) => item.id === selectedId);
  const canApproveSelectedItem = Boolean(selectedItem?.can_approve && selectedItem.workflow?.id);

  const countByTab = (tab: WorkflowViewTab) => sourceItems.filter(item => item.views?.includes(tab)).length;

  const switchTab = (key: string) => {
    const nextTab = key as WorkflowViewTab;
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('tab', nextTab);
    nextParams.delete('section');
    nextParams.delete('instance_id');
    setInstanceNotice('');
    setSearchParams(nextParams);
    setSelectedId(undefined);
    setDetailOpen(false);
  };

  const openWorkflowDetail = (record: WorkflowBusinessItem) => {
    setSelectedId(record.id);
    setDetailOpen(true);
  };

  const openSourceRecord = (item: WorkflowBusinessItem) => {
    if (item.route_path) navigate(item.route_path);
  };

  const handleWorkflowAction = (action: 'approve' | 'reject') => {
    if (!selectedItem?.workflow?.id || approvalLoading) return;
    const item = selectedItem;
    const commentRef = createRef<any>();
    Modal.confirm({
      title: action === 'approve' ? '审批通过' : '驳回申请',
      content: (
        <div style={{ marginTop: 12 }}>
          <Typography.Text type="secondary">{item.title}</Typography.Text>
          <Input.TextArea
            ref={commentRef}
            rows={3}
            placeholder={action === 'reject' ? '请填写驳回理由（必填）' : '审批意见（可选）'}
            style={{ marginTop: 12 }}
          />
        </div>
      ),
      okText: action === 'approve' ? '通过' : '驳回',
      okButtonProps: { danger: action === 'reject' },
      cancelText: '取消',
      onOk: async () => {
        const comment = commentRef.current?.resizableTextArea?.textArea?.value
          ?? commentRef.current?.input?.value
          ?? '';
        if (action === 'reject' && !String(comment).trim()) {
          message.warning('请填写驳回理由');
          throw new Error('请填写驳回理由');
        }
        setApprovalLoading(action);
        try {
          await wfApproveOrReject(item.workflow!.id, { action, comment, expected_node_id: item.workflow!.current_node_id });
          message.success(action === 'approve' ? '审批已通过' : '已驳回申请');
          await loadItems();
          closeWorkflowDetail();
          setSelectedId(undefined);
        } catch (error) {
          const failure = actionError(error);
          message.error(failure.message);
          if (failure.status === 409 || failure.status === 403 || failure.status === 400) await loadItems();
          throw error;
        } finally {
          setApprovalLoading(null);
        }
      },
    });
  };

  const renderWorkflowDetail = () => {
    if (!selectedItem) return null;

    const fields = selectedItem.fields || [];
    const metaFields = [
      { label: '所属应用', value: selectedItem.application?.name || '未绑定应用' },
      { label: '业务表单', value: selectedItem.form?.name || '未绑定表单' },
      { label: '记录编号', value: selectedItem.record?.id ? `#${selectedItem.record.id}` : '-' },
      { label: '当前节点', value: selectedItem.current_node || statusMeta[selectedItem.status].description },
      { label: '当前处理人', value: currentAssigneeLabel(selectedItem) },
    ];
    const detailFields = fields.map((field) => ({
      ...field,
      label: field.label || field.field_name,
      value: fieldNewValue(field),
    }));
    const timelineItems = [
      {
        color: selectedItem.status === 'returned' ? 'red' : selectedItem.status === 'done' ? 'green' : 'blue',
        children: (
          <div className="workflow-step-item">
            <strong>{selectedItem.current_node || statusMeta[selectedItem.status].label}</strong>
            <span>{selectedItem.summary || '来自后台业务表单数据'}</span>
          </div>
        ),
      },
      ...((selectedItem.workflow?.approvals || []).map((approval) => ({
        color: approval.action === 'reject' ? 'red' : approval.action ? 'green' : 'gray',
        children: (
          <div className="workflow-step-item">
            <strong>{approval.node_id || '审批节点'}</strong>
            <span>{approval.action ? `${approval.approver_name || '处理人'} ${actionLabel(approval.action)} · ${formatTime(approval.acted_at)}` : `等待 ${approval.approver_name || '处理人'} 处理`}</span>
            {approval.comment && <span>意见：{approval.comment}</span>}
          </div>
        ),
      }))),
    ];

    return (
      <div className="workflow-detail-content">
        <div className="workflow-detail-head workflow-approval-detail-head">
          <FileSearchOutlined />
          <div>
            <Typography.Text strong>{selectedItem.title}</Typography.Text>
            <Typography.Text type="secondary">
              {selectedItem.form?.name || '未绑定表单'} / {selectedItem.application?.name || '未绑定应用'}
            </Typography.Text>
          </div>
          <Tag color={statusMeta[selectedItem.status].color}>{statusMeta[selectedItem.status].label}</Tag>
        </div>
        <div className={`workflow-approval-stamp ${workflowStatusClass(selectedItem.status)}`}>
          {statusMeta[selectedItem.status].label}
        </div>
        <Tabs
          className="workflow-detail-tabs"
          items={[
            {
              key: 'form',
              label: '表单数据',
              children: (
                <div className="workflow-tab-page">
                  <section className="workflow-business-sheet">
                    <div className="workflow-business-sheet-grid">
                      {detailFields.map((field) => (
                        <div className="workflow-business-sheet-cell" key={field.label}>
                          <span className="workflow-business-sheet-label">
                            {field.required ? <em>*</em> : null}
                            {field.label}
                          </span>
                          {renderBusinessFieldValue(field)}
                        </div>
                      ))}
                    </div>
                    <div className="workflow-business-sheet-grid">
                      {metaFields.map(field => <div className="workflow-business-sheet-cell" key={field.label}>
                        <span className="workflow-business-sheet-label">{field.label}</span>
                        <div className="workflow-business-sheet-value"><strong>{field.value}</strong></div>
                      </div>)}
                    </div>
                  </section>
                </div>
              ),
            },
            {
              key: 'progress',
              label: '流程进度',
              children: (
                <div className="workflow-tab-page">
                  <div className="workflow-progress-summary">
                    <div>
                      <span>当前节点</span>
                      <strong>{selectedItem.current_node || statusMeta[selectedItem.status].label}</strong>
                    </div>
                    <div>
                      <span>更新时间</span>
                      <strong>{formatTime(selectedItem.updated_at || selectedItem.created_at)}</strong>
                    </div>
                    <Tag color={statusMeta[selectedItem.status].color}>{statusMeta[selectedItem.status].label}</Tag>
                  </div>
                  <div className="workflow-progress-card">
                    <div className="workflow-form-section-title">后台流程轨迹</div>
                    <Timeline items={timelineItems} />
                  </div>

                </div>
              ),
            },
          ]}
        />
        {canApproveSelectedItem && (
          <div className="workflow-detail-approval-actions">
            <Button
              danger
              icon={<CloseOutlined />}
              loading={approvalLoading === 'reject'}
              disabled={Boolean(approvalLoading)}
              onClick={() => handleWorkflowAction('reject')}
            >
              驳回
            </Button>
            <Button
              type="primary"
              icon={<CheckCircleOutlined />}
              loading={approvalLoading === 'approve'}
              disabled={Boolean(approvalLoading)}
              onClick={() => handleWorkflowAction('approve')}
            >
              通过
            </Button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="workflow-page workflow-approval-page">
      {sourceScoped && <Alert style={{ marginBottom: 16 }} type="info" showIcon message="历史申请的原流程记录" description="此处只显示对应来源记录的流程。没有审批实例的历史申请不会自动生成新审批。" action={<Button onClick={() => setSearchParams({ tab: 'initiated' })}>返回我的申请</Button>} />}

      <section className="workflow-approval-topbar">
        <div>
          <Typography.Text type="secondary">
            新申请请从对应业务表单发起。
          </Typography.Text>
        </div>
        <Space>
          <Button icon={<HistoryOutlined />} onClick={loadItems}>刷新</Button>
          <Button icon={<FormOutlined />} onClick={() => navigate('/')}>返回工作台</Button>
        </Space>
      </section>

      {instanceNotice && <Alert style={{ marginBottom: 16 }} type="warning" showIcon message={instanceNotice} />}
      {loadError && <Alert type="error" showIcon message="审批任务读取失败" description={loadError} action={<Button onClick={loadItems}>重试</Button>} />}

      {!sourceScoped && <Tabs
        className="workflow-approval-tabs"
        activeKey={activeTab}
        onChange={(key) => switchTab(key as WorkflowViewTab)}
        items={approvalTabs.map((item) => ({
          key: item.key,
          label: (
            <span className="workflow-approval-tab-label">
              <span>{item.label}</span>
              <em>{countByTab(item.key)}</em>
            </span>
          ),
        }))}
      />}

      <Space wrap style={{ padding: '0 4px' }}>
        <Input allowClear prefix={<SearchOutlined />} placeholder="搜索申请、表单或编号" value={query} onChange={event => setQuery(event.target.value)} style={{ width: 300 }} />
        <Select allowClear showSearch optionFilterProp="label" placeholder="所有来源表单" value={formFilter} onChange={setFormFilter} style={{ minWidth: 200 }} options={dataset.forms.map(form => ({ value: form.id, label: form.name }))} />
        <Typography.Text type="secondary">共 {filteredItems.length} 条</Typography.Text>
      </Space>

      <div className="workflow-approval-list">
        {loading ? (
          <div className="workflow-empty-state">正在读取后台表单数据...</div>
        ) : filteredItems.length ? filteredItems.map((item) => {
          const primaryFields = workflowCardPrimaryFields(item);
          return (
            <button className="workflow-approval-card" key={item.id} onClick={() => openWorkflowDetail(item)}>
              <div className="workflow-approval-card-main">
                <div className="workflow-approval-card-primary">
                  {primaryFields.length ? primaryFields.map((field) => (
                    <span key={field.key}>
                      <small>{field.label}</small>
                      <strong>{field.value}</strong>
                    </span>
                  )) : (
                    <strong>{item.title}</strong>
                  )}
                </div>
                <div className="workflow-approval-card-meta">
                  <span>应用：{item.application?.name || '未绑定应用'}</span>
                  <span>表单：{item.form?.name || '未绑定表单'}</span>
                  <span>流程编号：{item.workflow?.id ? `#${item.workflow.id}` : '未提交'}</span>
                  <span>当前处理人：{currentAssigneeLabel(item)}</span>
                  <span>申请时间：{formatTime(item.created_at || item.updated_at)}</span>
                </div>
              </div>
              <div className="workflow-approval-card-side">
                <Tag className="workflow-approval-card-status" color={statusMeta[item.status].color}>{statusMeta[item.status].label}</Tag>
              </div>
            </button>
          );
        }) : (
          <Empty description={loadError ? "读取失败，请点击重试" : sourceScoped ? "没有可查看的原流程记录" : query || formFilter ? "没有符合筛选条件的申请" : `暂无${approvalTabs.find(tab => tab.key === activeTab)?.label || '申请'}`} />
        )}
      </div>

      <Drawer
        className="workflow-detail-drawer workflow-approval-drawer"
        title={selectedItem?.title || '流程详情'}
        width="min(560px, calc(100vw - 12px))"
        placement="right"
        open={detailOpen}
        onClose={closeWorkflowDetail}
        extra={selectedItem ? (
          <Space size={6}>
            <Button size="small" disabled={!selectedItem.route_path} onClick={() => openSourceRecord(selectedItem)}>打开表单</Button>
          </Space>
        ) : null}
      >
        {renderWorkflowDetail()}
      </Drawer>
    </div>
  );
}
