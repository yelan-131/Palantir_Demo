import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  EditOutlined,
  FileSearchOutlined,
  FormOutlined,
  HistoryOutlined,
  InboxOutlined,
  RightOutlined,
  RollbackOutlined,
} from '@ant-design/icons';
import { Button, Col, Drawer, Empty, Form, Input, Row, Space, Tabs, Tag, Timeline, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { wfListBusinessItems } from '@/services/api';

export type WorkflowTab = 'draft' | 'pending' | 'running' | 'done' | 'returned';
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
    approvals?: Array<{ id: number; node_id?: string | null; action?: string | null; comment?: string | null; acted_at?: string | null }>;
  } | null;
  fields?: WorkflowBusinessField[];
  current_node?: string;
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

const statusMeta: Record<WorkflowTab, { label: string; color: string; icon: JSX.Element; description: string }> = {
  draft: { label: '草稿', color: 'default', icon: <EditOutlined />, description: '已保存但还没有提交' },
  pending: { label: '待审批', color: 'orange', icon: <InboxOutlined />, description: '需要当前用户处理' },
  running: { label: '审批中', color: 'blue', icon: <ClockCircleOutlined />, description: '正在流程中流转' },
  done: { label: '已审批', color: 'green', icon: <CheckCircleOutlined />, description: '已完成闭环' },
  returned: { label: '已退回', color: 'red', icon: <RollbackOutlined />, description: '需要补充后重新提交' },
};

const orderedTabs: WorkflowTab[] = ['draft', 'pending', 'running', 'done', 'returned'];
const approvalTabs: Array<{ key: WorkflowViewTab; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'draft', label: '草稿' },
  { key: 'pending', label: '待审批' },
  { key: 'running', label: '审批中' },
  { key: 'done', label: '已审批' },
  { key: 'returned', label: '已退回' },
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
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}

function sourceLabel(item: WorkflowBusinessItem) {
  if (item.source === 'dynamic_record') return '表单记录';
  if (item.source === 'workflow_instance') return '流程实例';
  return item.source;
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
    ];
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
            <span>{approval.action ? `${approval.action} · ${formatTime(approval.acted_at)}` : '等待处理'}</span>
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
        <div className="workflow-approval-stamp">{sourceLabel(selectedItem)}</div>
        <Tabs
          className="workflow-detail-tabs"
          items={[
            {
              key: 'form',
              label: '表单数据',
              children: (
                <div className="workflow-tab-page">
                  <Form layout="vertical" className="workflow-business-form">
                    <Row gutter={12}>
                      {metaFields.map((field) => (
                        <Col xs={24} md={12} key={field.label}>
                          <Form.Item label={field.label}>
                            <Input value={formatValue(field.value)} readOnly />
                          </Form.Item>
                        </Col>
                      ))}
                      {fields.map((field) => (
                        <Col xs={24} md={12} key={field.field_name}>
                          <Form.Item label={field.label || field.field_name}>
                            <Input value={formatValue(field.value)} readOnly />
                          </Form.Item>
                        </Col>
                      ))}
                    </Row>
                  </Form>
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
        ) : filteredItems.length ? filteredItems.map((item) => (
          <button className="workflow-approval-card" key={item.id} onClick={() => openWorkflowDetail(item)}>
            <div className="workflow-approval-card-main">
              <div className="workflow-approval-card-title">
                <strong>{item.title}</strong>
                <Tag>{sourceLabel(item)}</Tag>
              </div>
              <p>{item.summary || '来自后台业务表单数据'}</p>
              <div className="workflow-approval-card-fields">
                <span><small>所属应用</small><strong>{item.application?.name || '未绑定应用'}</strong></span>
                <span><small>业务表单</small><strong>{item.form?.name || '未绑定表单'}</strong></span>
                <span><small>当前节点</small><strong>{item.current_node || statusMeta[item.status].label}</strong></span>
                <span><small>记录编号</small><strong>{item.record?.id ? `#${item.record.id}` : '-'}</strong></span>
              </div>
            </div>
            <div className="workflow-approval-card-side">
              <Tag color={statusMeta[item.status].color}>{statusMeta[item.status].label}</Tag>
              <small>{formatTime(item.updated_at || item.created_at)}</small>
              <Button size="small" type={item.status === 'pending' ? 'primary' : 'default'} disabled={!item.route_path}>
                {item.route_path ? '打开表单' : '查看'} <RightOutlined />
              </Button>
            </div>
          </button>
        )) : (
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
            <Button size="small">操作日志</Button>
          </Space>
        ) : null}
      >
        {renderWorkflowDetail()}
      </Drawer>
    </div>
  );
}
