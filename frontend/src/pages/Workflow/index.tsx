import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  EditOutlined,
  FileSearchOutlined,
  FormOutlined,
  HistoryOutlined,
  InboxOutlined,
  RollbackOutlined,
} from '@ant-design/icons';
import { Button, Drawer, Empty, Space, Tabs, Tag, Timeline, Tooltip, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { wfListBusinessItems } from '@/services/api';
import { formatServerDateTime } from '@/utils/dateTime';

export type WorkflowTab = 'draft' | 'pending' | 'running' | 'done' | 'returned' | 'rejected';
type WorkflowViewTab = WorkflowTab | 'all';

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
  counts?: Partial<Record<WorkflowViewTab, number>>;
};

const statusMeta: Record<string, { label: string; color: string; icon: JSX.Element; description: string }> = {
  draft: { label: '草稿', color: 'default', icon: <EditOutlined />, description: '已保存但还没有提交' },
  pending: { label: '待审批', color: 'warning', icon: <InboxOutlined />, description: '需要当前用户处理' },
  running: { label: '审批中', color: 'processing', icon: <ClockCircleOutlined />, description: '正在流程中流转' },
  done: { label: '已审批', color: 'success', icon: <CheckCircleOutlined />, description: '已完成闭环' },
  returned: { label: '已退回', color: 'error', icon: <RollbackOutlined />, description: '需要补充后重新提交' },
};

statusMeta.rejected = { label: '拒绝', color: 'error', icon: <RollbackOutlined />, description: '审批已拒绝' };

const orderedTabs: WorkflowTab[] = ['draft', 'pending', 'running', 'done', 'returned', 'rejected'];
const approvalTabs: Array<{ key: WorkflowViewTab; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'draft', label: '草稿' },
  { key: 'pending', label: '待审批' },
  { key: 'running', label: '审批中' },
  { key: 'done', label: '已审批' },
  { key: 'returned', label: '已退回' },
  { key: 'rejected', label: '拒绝' },
];

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
    counts: data?.counts || {},
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
      <div><span>变更前</span><strong>{formatValue(fieldOldValue(field))}</strong></div>
      <div><span>变更后</span><strong>{formatValue(fieldNewValue(field))}</strong></div>
    </div>
  );
}

function renderBusinessFieldValue(field: WorkflowBusinessField) {
  const changed = isChangedField(field);
  const value = fieldNewValue(field);
  const content = isChoiceField(field) && formatValue(value) !== '-' ? (
    <span className="workflow-business-choice-values">
      {splitChoiceValues(value).map((item) => (
        <Tag className="workflow-business-choice-tag" key={item}>{item}</Tag>
      ))}
    </span>
  ) : (
    <strong>{formatValue(value)}</strong>
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
      value: formatValue(field.value),
    }));
}

function workflowStatusClass(status: string) {
  return `workflow-status-${statusMeta[status] ? status : 'default'}`;
}

export default function WorkflowPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryTab = searchParams.get('tab') as WorkflowViewTab | null;
  const validTabs: WorkflowViewTab[] = ['all', ...orderedTabs];
  const initialTab = queryTab && validTabs.includes(queryTab) ? queryTab : 'pending';
  const [activeTab, setActiveTab] = useState<WorkflowViewTab>(initialTab);
  const [dataset, setDataset] = useState<WorkflowBusinessDataset>({ applications: [], forms: [], items: [], counts: {} });
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [detailOpen, setDetailOpen] = useState(false);

  const loadItems = async () => {
    setLoading(true);
    try {
      const res = await wfListBusinessItems();
      setDataset(unwrapDataset(res));
    } catch {
      setDataset({ applications: [], forms: [], items: [], counts: {} });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadItems();
  }, []);

  const filteredItems = useMemo(() => (
    activeTab === 'all' ? dataset.items : dataset.items.filter((item) => item.status === activeTab)
  ), [activeTab, dataset.items]);
  const selectedItem = dataset.items.find((item) => item.id === selectedId);

  const countByTab = (tab: WorkflowViewTab) => {
    if (tab === 'all') return dataset.items.length;
    return dataset.items.filter((item) => item.status === tab).length;
  };

  const switchTab = (key: string) => {
    const nextTab = key as WorkflowViewTab;
    setActiveTab(nextTab);
    setSearchParams({ tab: nextTab });
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
        color: approval.action ? 'green' : 'gray',
        children: (
          <div className="workflow-step-item">
            <strong>{approval.node_id || '审批节点'}</strong>
            <span>{approval.action ? `${approval.approver_name || '处理人'} ${approval.action} · ${formatTime(approval.acted_at)}` : `等待 ${approval.approver_name || '处理人'} 处理`}</span>
          </div>
        ),
      }))),
    ];
    const operationLogs = [
      {
        title: '发起申请',
        meta: selectedItem.form?.name || '业务表单',
        description: formatTime(selectedItem.created_at),
      },
      ...((selectedItem.workflow?.approvals || []).map((approval) => ({
        title: approval.action ? (approval.action === 'approve' ? '审批通过' : approval.action) : '等待处理',
        meta: approval.node_id || '审批节点',
        description: approval.acted_at ? formatTime(approval.acted_at) : `等待 ${approval.approver_name || '处理人'} 处理`,
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
                    <div className="workflow-business-sheet-footer">
                      <button type="button"><HistoryOutlined />审批历史</button>
                      <button type="button"><FileSearchOutlined />历史版本</button>
                      <button type="button"><ClockCircleOutlined />操作日志</button>
                      <button type="button"><FormOutlined />发布记录</button>
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
                  <div className="workflow-operation-log-card">
                    <div className="workflow-form-section-title">操作日志</div>
                    <div className="workflow-operation-log-list">
                      {operationLogs.map((log, index) => (
                        <div className="workflow-operation-log-row" key={`${log.title}-${index}`}>
                          <strong>{log.title}</strong>
                          <span>{log.meta}</span>
                          <time>{log.description}</time>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ),
            },
          ]}
        />
        <div className="workflow-detail-footer">
          <button type="button"><HistoryOutlined />审批历史</button>
          <button type="button"><FileSearchOutlined />历史版本</button>
          <button type="button"><ClockCircleOutlined />操作日志</button>
          <button type="button"><FormOutlined />发布记录</button>
        </div>
      </div>
    );
  };

  return (
    <div className="workflow-page workflow-approval-page">
      <section className="workflow-approval-topbar">
        <div>
          <Typography.Title level={3}>流程中心</Typography.Title>
          <Typography.Text type="secondary">
            已接入后台应用 {dataset.applications.length} 个，业务表单 {dataset.forms.length} 个，当前展示真实表单记录和流程实例。
          </Typography.Text>
        </div>
        <Space>
          <Button icon={<HistoryOutlined />} onClick={loadItems}>刷新</Button>
          <Button type="primary" icon={<FormOutlined />} onClick={() => navigate('/')}>返回工作台</Button>
        </Space>
      </section>

      <Tabs
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
      />

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
                  <span>申请时间：{formatTime(item.created_at || item.updated_at)}</span>
                </div>
              </div>
              <div className="workflow-approval-card-side">
                <Tag className="workflow-approval-card-status" color={statusMeta[item.status].color}>{statusMeta[item.status].label}</Tag>
              </div>
            </button>
          );
        }) : (
          <Empty description="后台暂时没有符合当前状态的表单记录" />
        )}
      </div>

      <Drawer
        className="workflow-detail-drawer workflow-approval-drawer"
        title={selectedItem?.title || '流程详情'}
        width="min(560px, calc(100vw - 180px))"
        placement="right"
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
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
