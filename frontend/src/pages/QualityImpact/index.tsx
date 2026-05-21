import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Descriptions,
  Drawer,
  Empty,
  Modal,
  Progress,
  Space,
  Table,
  Tag,
  Timeline,
  Typography,
  message,
} from 'antd';
import {
  ApiOutlined,
  BranchesOutlined,
  CheckCircleOutlined,
  ControlOutlined,
  FileProtectOutlined,
  NodeIndexOutlined,
  PauseCircleOutlined,
  ReloadOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  SendOutlined,
  ShareAltOutlined,
  ThunderboltOutlined,
  ToolOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import {
  createCapa,
  executeQualityEventAction,
  getQualityEventAiSuggestion,
  getQualityEventImpact,
  listQualityEvents,
} from '@/services/api';

type RiskLevel = 'critical' | 'major' | 'medium' | 'low' | string;

interface QualityEvent {
  id: string;
  title: string;
  severity: RiskLevel;
  status: string;
  source: string;
  occurred_at: string;
  description: string;
  risk_score: number;
  affected: Record<string, number>;
  recommended_actions: string[];
}

interface ImpactNode {
  id: string;
  label: string;
  type: string;
  name: string;
  status: string;
  risk: RiskLevel;
  summary: string;
  actions: string[];
}

interface ImpactEdge {
  id: string;
  source: string;
  target: string;
  label: string;
}

interface AiSuggestion {
  summary: string;
  evidence: string[];
  recommended_actions: Array<{ action: string; priority: string; owner: string; reason: string }>;
}

const fallbackEvent: QualityEvent = {
  id: 'QE-20260521-001',
  title: '电控模块焊点虚焊异常',
  severity: 'critical',
  status: 'open',
  source: '制程检验 / AOI',
  occurred_at: '2026-05-21T09:40:00',
  description: 'AOI 连续发现电控模块 V2 批次焊点虚焊，缺陷率达到 6.8%，超过 2.0% 管控线。',
  risk_score: 92,
  affected: { orders: 3, work_orders: 5, material_batches: 2, suppliers: 1, customers: 2 },
  recommended_actions: ['生成 CAPA', '冻结批次', '发起复检', '通知采购'],
};

const fallbackNodes: ImpactNode[] = [
  { id: 'event-qe-001', label: '质量异常', type: 'QualityEvent', name: 'QE-20260521-001', status: 'open', risk: 'critical', summary: '电控模块 V2 批次焊点虚焊缺陷率 6.8%。', actions: ['AI 分析影响', '生成 CAPA', '通知相关角色'] },
  { id: 'defect-001', label: '缺陷', type: 'Defect', name: '焊点虚焊', status: 'confirmed', risk: 'critical', summary: 'AOI 与人工复核均确认虚焊，主要集中在 BGA 区域。', actions: ['查看缺陷明细', '发起复检'] },
  { id: 'inspection-iqc-088', label: '检验批次', type: 'InspectionBatch', name: 'IPQC-260521-088', status: 'failed', risk: 'critical', summary: '抽检 120 件，发现 8 件虚焊。', actions: ['复检批次', '导出检验记录'] },
  { id: 'material-batch-mb-7781', label: '物料批次', type: 'MaterialBatch', name: 'MB-7781 / 焊锡膏 S12', status: 'hold', risk: 'major', summary: '同批次焊锡膏用于 5 个工单，建议先冻结待判定库存。', actions: ['冻结批次', '查看库存'] },
  { id: 'supplier-s-023', label: '供应商', type: 'Supplier', name: '北辰电子材料', status: 'watch', risk: 'major', summary: '近期交付批次质量波动，过去 30 天已有 2 次异常。', actions: ['通知采购', '发起供应商复核'] },
  { id: 'workorder-260521-017', label: '工单', type: 'WorkOrder', name: 'WO-260521-017', status: 'in_progress', risk: 'major', summary: '装配 A 线工单，已生产 860 件，待隔离 240 件。', actions: ['暂停工单', '调整排产'] },
  { id: 'equipment-smt-03', label: '设备', type: 'Equipment', name: 'SMT-03 回流焊', status: 'running', risk: 'medium', summary: '温区 5 曲线有轻微偏移，需要设备工程师复核。', actions: ['创建维修工单', '查看传感器趋势'] },
  { id: 'order-so-8821', label: '客户订单', type: 'CustomerOrder', name: 'SO-8821 / 华东客户', status: 'at_risk', risk: 'major', summary: '预计影响 5 月 23 日交付，需确认替代批次。', actions: ['通知销售', '查看交付承诺'] },
  { id: 'capa-072', label: 'CAPA', type: 'CAPA', name: 'CAPA-072', status: 'draft', risk: 'medium', summary: '建议由质量工程师牵头，设备、工艺、采购协同处理。', actions: ['提交审批', '补充原因分析'] },
];

const fallbackEdges: ImpactEdge[] = [
  { id: 'r1', source: 'event-qe-001', target: 'defect-001', label: '发现' },
  { id: 'r2', source: 'defect-001', target: 'inspection-iqc-088', label: '属于' },
  { id: 'r3', source: 'inspection-iqc-088', target: 'material-batch-mb-7781', label: '检验' },
  { id: 'r4', source: 'material-batch-mb-7781', target: 'supplier-s-023', label: '来自' },
  { id: 'r5', source: 'material-batch-mb-7781', target: 'workorder-260521-017', label: '用于' },
  { id: 'r6', source: 'workorder-260521-017', target: 'equipment-smt-03', label: '经过' },
  { id: 'r7', source: 'workorder-260521-017', target: 'order-so-8821', label: '影响' },
  { id: 'r8', source: 'event-qe-001', target: 'capa-072', label: '建议生成' },
];

const actionConfig = [
  { key: 'generate_capa', label: '生成 CAPA', icon: <FileProtectOutlined />, danger: false },
  { key: 'freeze_batch', label: '冻结批次', icon: <PauseCircleOutlined />, danger: true },
  { key: 'reinspect', label: '发起复检', icon: <CheckCircleOutlined />, danger: false },
  { key: 'maintenance_order', label: '创建维修工单', icon: <ToolOutlined />, danger: false },
  { key: 'notify_purchase', label: '通知采购', icon: <SendOutlined />, danger: false },
];

const riskColor: Record<string, string> = {
  critical: 'red',
  major: 'orange',
  medium: 'gold',
  low: 'green',
};

const typeIcon: Record<string, JSX.Element> = {
  QualityEvent: <WarningOutlined />,
  Defect: <SafetyCertificateOutlined />,
  InspectionBatch: <CheckCircleOutlined />,
  MaterialBatch: <ApiOutlined />,
  Supplier: <ShareAltOutlined />,
  WorkOrder: <ControlOutlined />,
  Equipment: <ToolOutlined />,
  CustomerOrder: <SendOutlined />,
  CAPA: <FileProtectOutlined />,
};

function normalizeRisk(level: RiskLevel) {
  return riskColor[level] || 'blue';
}

const taskFilters = ['全部', 'P0 高风险', '待分析', '待处置', '审批中'];

const closureTimeline = [
  {
    time: '09:40',
    title: '异常发现',
    actor: 'AOI / SPC 规则',
    status: '已完成',
    desc: '电控模块 V2 批次连续出现焊点虚焊，缺陷率超过管控线。',
    color: 'red',
  },
  {
    time: '09:43',
    title: '影响分析',
    actor: '质量经理',
    status: '进行中',
    desc: '图谱已关联检验批次、物料批次、供应商、工单和客户订单。',
    color: 'blue',
  },
  {
    time: '09:47',
    title: 'AI 建议生成',
    actor: 'AIP 辅助层',
    status: '待确认',
    desc: '建议先冻结风险批次，再生成 CAPA，并通知采购确认供应商波动。',
    color: 'gray',
  },
  {
    time: '待办',
    title: 'CAPA / 复检执行',
    actor: '质量工程师',
    status: '未开始',
    desc: '等待质量经理确认动作后进入工作流审批和执行闭环。',
    color: 'gray',
  },
];

export default function QualityImpactWorkbench() {
  const [events, setEvents] = useState<QualityEvent[]>([fallbackEvent]);
  const [event, setEvent] = useState<QualityEvent>(fallbackEvent);
  const [nodes, setNodes] = useState<ImpactNode[]>(fallbackNodes);
  const [edges, setEdges] = useState<ImpactEdge[]>(fallbackEdges);
  const [selectedNodeId, setSelectedNodeId] = useState(fallbackNodes[0].id);
  const [aiSuggestion, setAiSuggestion] = useState<AiSuggestion | null>(null);
  const [loading, setLoading] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) || nodes[0],
    [nodes, selectedNodeId],
  );

  const visibleEdges = useMemo(
    () => edges.filter((edge) => edge.source === selectedNode?.id || edge.target === selectedNode?.id),
    [edges, selectedNode],
  );

  const loadEvent = async (eventId = event.id) => {
    setLoading(true);
    try {
      const eventsRes = await listQualityEvents();
      const nextEvents = eventsRes.data?.data || [fallbackEvent];
      const matched = nextEvents.find((item: QualityEvent) => item.id === eventId) || nextEvents[0];
      const impactRes = await getQualityEventImpact(matched.id);
      const impact = impactRes.data?.data || {};
      setEvents(nextEvents);
      setEvent(impact.event || matched);
      setNodes(impact.nodes || fallbackNodes);
      setEdges(impact.edges || fallbackEdges);
      setSelectedNodeId((impact.nodes || fallbackNodes)[0]?.id || fallbackNodes[0].id);
      setAiSuggestion(null);
    } catch {
      setEvents([fallbackEvent]);
      setEvent(fallbackEvent);
      setNodes(fallbackNodes);
      setEdges(fallbackEdges);
      setSelectedNodeId(fallbackNodes[0].id);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEvent();
  }, []);

  const runAiAnalysis = async () => {
    setLoading(true);
    try {
      const res = await getQualityEventAiSuggestion(event.id);
      setAiSuggestion(res.data?.data || null);
      setAiOpen(true);
    } catch {
      setAiSuggestion({
        summary: '该异常已影响物料、工单和客户订单，建议先隔离批次，再生成 CAPA 闭环。',
        evidence: ['缺陷率超过管控线。', '同批物料用于多个在制工单。', '客户订单存在交付风险。'],
        recommended_actions: [
          { action: '冻结批次', priority: 'P0', owner: '质量经理', reason: '阻断风险继续扩散。' },
          { action: '生成 CAPA', priority: 'P0', owner: '质量工程师', reason: '形成纠正与预防闭环。' },
        ],
      });
      setAiOpen(true);
    } finally {
      setLoading(false);
    }
  };

  const runAction = async (action: string) => {
    if (action === 'generate_capa') {
      try {
        await createCapa({
          defect_id: 1,
          action_type: 'corrective',
          description: `${event.title} - CAPA 纠正预防措施`,
          due_date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
          assignee_id: 3,
        });
      } catch {
        // The demo action endpoint below still records a fallback task.
      }
    }

    try {
      const res = await executeQualityEventAction(event.id, {
        action,
        node_id: selectedNode?.id,
        comment: selectedNode?.summary,
      });
      message.success(res.data?.data?.message || '动作已创建');
    } catch {
      message.success('演示动作已创建，已进入待办闭环');
    }
  };

  return (
    <div className="quality-impact-page">
      <section className="quality-command-hero">
        <div>
          <Typography.Text className="quality-command-kicker">Task Workbench / Quality Closure</Typography.Text>
          <Typography.Title level={3}>质量异常任务处置台</Typography.Title>
          <Typography.Paragraph>
            左侧选择任务，中间查看影响范围，右侧处理对象动作，下方跟踪任务推进状态。
          </Typography.Paragraph>
        </div>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={() => loadEvent(event.id)} loading={loading}>刷新</Button>
          <Button icon={<RobotOutlined />} onClick={runAiAnalysis} loading={loading}>AI 分析影响</Button>
          <Button type="primary" icon={<FileProtectOutlined />} onClick={() => runAction('generate_capa')}>生成 CAPA</Button>
        </Space>
      </section>

      <div className="quality-command-grid">
        <aside className="quality-left-rail">
          <Card className="quality-side-panel quality-task-panel" title="任务区" extra={<Tag color="red">P0</Tag>}>
            <div className="quality-task-filter">
              {taskFilters.map((filter, index) => (
                <button key={filter} className={index === 0 ? 'active' : ''}>{filter}</button>
              ))}
            </div>
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              {events.map((item) => (
                <button
                  key={item.id}
                  className={`quality-event-card ${item.id === event.id ? 'active' : ''}`}
                  onClick={() => loadEvent(item.id)}
                >
                  <span>
                    <Badge color={normalizeRisk(item.severity)} />
                    <strong>{item.title}</strong>
                  </span>
                  <small>{item.id}</small>
                  <em>{item.source}</em>
                  <Progress percent={item.risk_score} size="small" strokeColor={item.risk_score > 85 ? '#c83f49' : '#d48806'} />
                </button>
              ))}
              <button className="quality-event-card">
                <span>
                  <Badge color="orange" />
                  <strong>待生成 CAPA 草稿</strong>
                </span>
                <small>CAPA-TASK-072</small>
                <em>质量经理 / 待确认</em>
                <Progress percent={64} size="small" strokeColor="#d48806" />
              </button>
              <button className="quality-event-card">
                <span>
                  <Badge color="gold" />
                  <strong>供应商风险复核</strong>
                </span>
                <small>SUP-RISK-023</small>
                <em>采购 / 待跟进</em>
                <Progress percent={48} size="small" strokeColor="#faad14" />
              </button>
            </Space>
          </Card>
        </aside>

        <main className="quality-center-stage">
          <Card
            className="quality-impact-graph-card"
            title="任务展示：影响图谱"
            extra={<Tag color="processing">{nodes.length} 对象 / {edges.length} 关系</Tag>}
          >
            <div className="quality-event-summary">
              <Tag color={normalizeRisk(event.severity)}>{event.severity}</Tag>
              <strong>{event.title}</strong>
              <span>{event.description}</span>
            </div>

            <div className="quality-graph-canvas">
              {nodes.map((node, index) => (
                <button
                  key={node.id}
                  className={`quality-graph-node node-${index} risk-${node.risk} ${node.id === selectedNode?.id ? 'selected' : ''}`}
                  onClick={() => setSelectedNodeId(node.id)}
                >
                  <span>{typeIcon[node.type] || <NodeIndexOutlined />}</span>
                  <strong>{node.label}</strong>
                  <small>{node.name}</small>
                </button>
              ))}
              {edges.map((edge, index) => (
                <span key={edge.id} className={`quality-graph-edge edge-${index}`}>
                  {edge.label}
                </span>
              ))}
            </div>

            <div className="quality-map-metrics">
              <div>
                <span><WarningOutlined /> 风险分</span>
                <strong>{event.risk_score}<small>/100</small></strong>
              </div>
              <div>
                <span><ControlOutlined /> 影响工单</span>
                <strong>{event.affected.work_orders || 0}<small>个</small></strong>
              </div>
              <div>
                <span><SendOutlined /> 影响订单</span>
                <strong>{event.affected.orders || 0}<small>个</small></strong>
              </div>
            </div>
          </Card>
        </main>

        <aside className="quality-right-rail">
          <Card className="quality-detail-panel" title="任务详情">
            {selectedNode ? (
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <div className="quality-node-head">
                  <span>{typeIcon[selectedNode.type] || <NodeIndexOutlined />}</span>
                  <div>
                    <Typography.Text strong>{selectedNode.name}</Typography.Text>
                    <br />
                    <Tag color={normalizeRisk(selectedNode.risk)}>{selectedNode.type}</Tag>
                    <Tag>{selectedNode.status}</Tag>
                  </div>
                </div>
                <Alert type={selectedNode.risk === 'critical' ? 'error' : 'warning'} showIcon message={selectedNode.summary} />
                <Descriptions size="small" column={1} bordered>
                  <Descriptions.Item label="对象类型">{selectedNode.type}</Descriptions.Item>
                  <Descriptions.Item label="对象状态">{selectedNode.status}</Descriptions.Item>
                  <Descriptions.Item label="关联关系">{visibleEdges.length} 条</Descriptions.Item>
                </Descriptions>
                <Space wrap>
                  {selectedNode.actions.map((action) => <Tag color="blue" key={action}>{action}</Tag>)}
                </Space>
                <div className="quality-action-stack">
                  {actionConfig.map((action) => (
                    <Button
                      key={action.key}
                      block
                      danger={action.danger}
                      icon={action.icon}
                      onClick={() => runAction(action.key)}
                    >
                      {action.label}
                    </Button>
                  ))}
                </div>
              </Space>
            ) : (
              <Empty description="请选择图谱对象" />
            )}
          </Card>
        </aside>
      </div>

      <div className="quality-progress-row">
        <Card title="任务进度：处置时间线" className="quality-progress-card">
          <Timeline
            mode="left"
            items={closureTimeline.map((item) => ({
              color: item.color,
              label: <span className="quality-timeline-time">{item.time}</span>,
              children: (
                <div className="quality-timeline-item">
                  <div>
                    <strong>{item.title}</strong>
                    <Tag color={item.status === '进行中' ? 'processing' : item.status === '已完成' ? 'success' : 'default'}>{item.status}</Tag>
                  </div>
                  <p>{item.desc}</p>
                  <span>{item.actor}</span>
                </div>
              ),
            }))}
          />
          <div className="quality-config-link">
            <BranchesOutlined />
            <span>对象、关系、动作和角色配置由后台低代码配置中心维护，此处只展示业务处置结果。</span>
          </div>
        </Card>
      </div>

      <Drawer title="AI 影响分析草稿" open={aiOpen} width={520} onClose={() => setAiOpen(false)}>
        {aiSuggestion ? (
          <Space direction="vertical" size={14} style={{ width: '100%' }}>
            <Alert type="info" showIcon message={aiSuggestion.summary} />
            <Card size="small" title="证据">
              <Space direction="vertical">
                {aiSuggestion.evidence.map((item) => <Typography.Text key={item}>- {item}</Typography.Text>)}
              </Space>
            </Card>
            <Table
              size="small"
              rowKey="action"
              pagination={false}
              dataSource={aiSuggestion.recommended_actions}
              columns={[
                { title: '优先级', dataIndex: 'priority', width: 70, render: (value) => <Tag color={value === 'P0' ? 'red' : 'orange'}>{value}</Tag> },
                { title: '动作', dataIndex: 'action', width: 100 },
                { title: '负责人', dataIndex: 'owner', width: 100 },
                { title: '原因', dataIndex: 'reason' },
              ]}
            />
            <Button type="primary" icon={<ThunderboltOutlined />} onClick={() => {
              setAiOpen(false);
              Modal.confirm({
                title: '生成 CAPA 草稿',
                content: 'AI 只生成草稿，不直接替用户完成高风险动作。确认后将进入流程待办。',
                onOk: () => runAction('generate_capa'),
              });
            }}>
              按建议生成 CAPA 草稿
            </Button>
          </Space>
        ) : (
          <Empty description="请先运行 AI 分析" />
        )}
      </Drawer>
    </div>
  );
}
