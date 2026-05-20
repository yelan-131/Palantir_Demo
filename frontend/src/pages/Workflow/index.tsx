import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  EditOutlined,
  ExclamationCircleOutlined,
  FileSearchOutlined,
  FormOutlined,
  HistoryOutlined,
  InboxOutlined,
  RightOutlined,
  RollbackOutlined,
} from '@ant-design/icons';
import { Button, Card, Space, Table, Tabs, Tag, Timeline, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

type WorkflowTab = 'pending' | 'running' | 'done' | 'draft' | 'returned';

type WorkflowCase = {
  id: string;
  title: string;
  app: string;
  form: string;
  status: WorkflowTab;
  priority: '高' | '中' | '低';
  initiator: string;
  currentNode: string;
  updatedAt: string;
  dueAt: string;
  summary: string;
  steps: Array<{ title: string; description: string; state: 'finish' | 'process' | 'wait' | 'error' }>;
};

const statusMeta: Record<WorkflowTab, { label: string; color: string; icon: JSX.Element; description: string }> = {
  pending: { label: '待审批', color: 'orange', icon: <InboxOutlined />, description: '需要当前用户处理' },
  running: { label: '审批中', color: 'blue', icon: <ClockCircleOutlined />, description: '我发起或参与，仍在流转' },
  done: { label: '已审批', color: 'green', icon: <CheckCircleOutlined />, description: '已完成审批闭环' },
  draft: { label: '草稿', color: 'default', icon: <EditOutlined />, description: '我保存但未提交' },
  returned: { label: '退回待修改', color: 'red', icon: <RollbackOutlined />, description: '需要补充后重新提交' },
};

const workflowCases: WorkflowCase[] = [
  {
    id: 'WF-20260520-001',
    title: '设备维修申请 - 产线 A03 主轴异响',
    app: '设备维护分析',
    form: '设备维修申请',
    status: 'pending',
    priority: '高',
    initiator: '李明',
    currentNode: '维修主管审批',
    updatedAt: '今天 10:32',
    dueAt: '今天 18:00 前',
    summary: '产线 A03 主轴异响，需要确认是否停机维修并协调备件。',
    steps: [
      { title: '提交申请', description: '李明提交维修申请', state: 'finish' },
      { title: '维修主管审批', description: '等待当前用户处理', state: 'process' },
      { title: '设备经理复核', description: '审批通过后进入复核', state: 'wait' },
      { title: '维修执行', description: '生成维修工单', state: 'wait' },
    ],
  },
  {
    id: 'WF-20260520-002',
    title: '质量异常复核 - Q-20260520',
    app: '质量控制',
    form: '质量异常复核',
    status: 'pending',
    priority: '中',
    initiator: '王珊',
    currentNode: '质量主管审批',
    updatedAt: '今天 09:48',
    dueAt: '明天 12:00 前',
    summary: '来料批次出现尺寸波动，需要复核处置方式和供应商责任。',
    steps: [
      { title: '异常登记', description: '质量工程师登记异常', state: 'finish' },
      { title: '质量主管审批', description: '等待当前用户处理', state: 'process' },
      { title: '供应商确认', description: '同步供应商纠正措施', state: 'wait' },
    ],
  },
  {
    id: 'WF-20260519-018',
    title: '物料采购申请 - MRO-1842',
    app: '供应链风险',
    form: '采购申请',
    status: 'running',
    priority: '中',
    initiator: '赵倩',
    currentNode: '财务预算复核',
    updatedAt: '今天 08:15',
    dueAt: '5 月 21 日',
    summary: '维修耗材补库申请已通过部门审批，正在等待预算复核。',
    steps: [
      { title: '提交申请', description: '采购专员提交', state: 'finish' },
      { title: '部门审批', description: '生产经理已通过', state: 'finish' },
      { title: '财务预算复核', description: '财务处理中', state: 'process' },
      { title: '采购下单', description: '复核通过后执行', state: 'wait' },
    ],
  },
  {
    id: 'WF-20260518-011',
    title: '维修工单关闭 - WO-771',
    app: '设备维护分析',
    form: '维修工单关闭',
    status: 'done',
    priority: '低',
    initiator: '陈涛',
    currentNode: '已完成',
    updatedAt: '昨天 17:20',
    dueAt: '已完成',
    summary: '维修任务已完成，备件更换记录和停机时长已归档。',
    steps: [
      { title: '提交关闭申请', description: '维修工程师提交', state: 'finish' },
      { title: '主管确认', description: '主管已确认', state: 'finish' },
      { title: '资料归档', description: '系统完成归档', state: 'finish' },
    ],
  },
  {
    id: 'WF-DRAFT-007',
    title: '供应商评分草稿',
    app: '供应链风险',
    form: '供应商评分',
    status: 'draft',
    priority: '低',
    initiator: '我',
    currentNode: '未提交',
    updatedAt: '今天 11:05',
    dueAt: '未设置',
    summary: '已填写交付表现和质量表现，待补充商务评分。',
    steps: [
      { title: '编辑草稿', description: '当前停留在草稿状态', state: 'process' },
      { title: '提交审批', description: '提交后进入采购经理审批', state: 'wait' },
    ],
  },
  {
    id: 'WF-RETURN-003',
    title: '采购申请退回 - 预算口径待补充',
    app: '供应链风险',
    form: '采购申请',
    status: 'returned',
    priority: '高',
    initiator: '我',
    currentNode: '发起人修改',
    updatedAt: '2 小时前',
    dueAt: '今天 17:00 前',
    summary: '财务退回，要求补充年度预算科目和费用归属说明。',
    steps: [
      { title: '提交申请', description: '采购申请已提交', state: 'finish' },
      { title: '部门审批', description: '生产经理已通过', state: 'finish' },
      { title: '财务复核', description: '因预算口径不清退回', state: 'error' },
      { title: '发起人修改', description: '等待补充后重新提交', state: 'process' },
    ],
  },
];

const orderedTabs: WorkflowTab[] = ['pending', 'running', 'done', 'draft', 'returned'];

function getPriorityColor(priority: WorkflowCase['priority']) {
  if (priority === '高') return 'red';
  if (priority === '中') return 'orange';
  return 'default';
}

export default function WorkflowPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryTab = searchParams.get('tab') as WorkflowTab | null;
  const initialTab = queryTab && orderedTabs.includes(queryTab) ? queryTab : 'pending';
  const [activeTab, setActiveTab] = useState<WorkflowTab>(initialTab);
  const filteredCases = useMemo(() => workflowCases.filter((item) => item.status === activeTab), [activeTab]);
  const [selectedId, setSelectedId] = useState<string | undefined>(filteredCases[0]?.id);
  const selectedCase = filteredCases.find((item) => item.id === selectedId) ?? filteredCases[0];

  const switchTab = (key: string) => {
    const nextTab = key as WorkflowTab;
    setActiveTab(nextTab);
    setSearchParams({ tab: nextTab });
    const first = workflowCases.find((item) => item.status === nextTab);
    setSelectedId(first?.id);
  };

  const columns: ColumnsType<WorkflowCase> = [
    {
      title: '流程事项',
      dataIndex: 'title',
      render: (_, record) => (
        <Space direction="vertical" size={2}>
          <Typography.Text strong>{record.title}</Typography.Text>
          <Typography.Text type="secondary">{record.id} · {record.form}</Typography.Text>
        </Space>
      ),
    },
    { title: '来源应用', dataIndex: 'app', width: 130 },
    { title: '当前节点', dataIndex: 'currentNode', width: 130 },
    { title: '发起人', dataIndex: 'initiator', width: 90 },
    {
      title: '优先级',
      dataIndex: 'priority',
      width: 90,
      render: (value) => <Tag color={getPriorityColor(value)}>{value}</Tag>,
    },
    { title: '更新时间', dataIndex: 'updatedAt', width: 120 },
    {
      title: '操作',
      width: 120,
      render: (_, record) => activeTab === 'pending'
        ? <Button size="small" type="primary">处理</Button>
        : <Button size="small" onClick={() => setSelectedId(record.id)}>查看</Button>,
    },
  ];

  return (
    <div className="workflow-page">
      <section className="workflow-hero-row">
        <div>
          <Typography.Title level={3}>流程中心</Typography.Title>
          <Typography.Text type="secondary">聚合当前用户相关的待审批、流转中、已完成、草稿和退回事项。</Typography.Text>
        </div>
        <Space>
          <Button icon={<HistoryOutlined />}>刷新</Button>
          <Button type="primary" icon={<FormOutlined />} onClick={() => navigate('/')}>返回工作台</Button>
        </Space>
      </section>

      <div className="workflow-status-grid">
        {orderedTabs.map((key) => {
          const meta = statusMeta[key];
          const count = workflowCases.filter((item) => item.status === key).length;
          return (
            <button
              className={'workflow-status-card' + (activeTab === key ? ' active' : '')}
              key={key}
              onClick={() => switchTab(key)}
            >
              <span className="workflow-status-icon">{meta.icon}</span>
              <span>
                <strong>{meta.label}</strong>
                <small>{meta.description}</small>
              </span>
              <Tag color={meta.color}>{count}</Tag>
            </button>
          );
        })}
      </div>

      <div className="workflow-main-grid">
        <Card className="workflow-list-card" title="流程事项">
          <Tabs
            activeKey={activeTab}
            onChange={switchTab}
            items={orderedTabs.map((key) => ({
              key,
              label: statusMeta[key].label,
            }))}
          />
          <Table
            dataSource={filteredCases}
            columns={columns}
            rowKey="id"
            size="middle"
            pagination={false}
            rowClassName={(record) => record.id === selectedCase?.id ? 'workflow-selected-row' : ''}
            onRow={(record) => ({ onClick: () => setSelectedId(record.id) })}
          />
        </Card>

        <Card className="workflow-detail-card" title="流程详情">
          {selectedCase ? (
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              <div className="workflow-detail-head">
                <FileSearchOutlined />
                <div>
                  <Typography.Text strong>{selectedCase.title}</Typography.Text>
                  <Typography.Text type="secondary">{selectedCase.id}</Typography.Text>
                </div>
              </div>
              <div className="workflow-detail-meta">
                <span>状态<Tag color={statusMeta[selectedCase.status].color}>{statusMeta[selectedCase.status].label}</Tag></span>
                <span>当前节点<strong>{selectedCase.currentNode}</strong></span>
                <span>截止时间<strong>{selectedCase.dueAt}</strong></span>
              </div>
              <Typography.Paragraph type="secondary" style={{ margin: 0 }}>{selectedCase.summary}</Typography.Paragraph>
              <Timeline
                items={selectedCase.steps.map((step) => ({
                  color: step.state === 'finish' ? 'green' : step.state === 'process' ? 'blue' : step.state === 'error' ? 'red' : 'gray',
                  children: (
                    <div className="workflow-step-item">
                      <strong>{step.title}</strong>
                      <span>{step.description}</span>
                    </div>
                  ),
                }))}
              />
              <Button type="primary" block>
                {activeTab === 'pending' ? '进入处理' : activeTab === 'draft' || activeTab === 'returned' ? '继续编辑' : '查看完整记录'} <RightOutlined />
              </Button>
            </Space>
          ) : (
            <div className="workflow-empty-detail">
              <ExclamationCircleOutlined />
              <span>当前状态下暂无流程事项</span>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
