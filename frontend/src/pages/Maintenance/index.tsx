import { useState, useEffect, useCallback } from 'react';
import {
  Row,
  Col,
  Card,
  Statistic,
  Table,
  Tag,
  Progress,
  Skeleton,
  Spin,
  message,
  Typography,
  Tooltip,
  Button,
  Modal,
  Form,
  Input,
  Select,
} from 'antd';
import {
  CheckCircleOutlined,
  WarningOutlined,
  CloseCircleOutlined,
  ToolOutlined,
  PlusOutlined,
  DownloadOutlined,
} from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import {
  getEquipmentHealth,
  getSingleEquipmentHealth,
  getFaultPredictions,
  getWorkOrders,
  wfStartInstance,
} from '@/services/api';
import { formatServerDateTime } from '@/utils/dateTime';
import { exportCSV } from '@/utils/csvExport';

const { Title, Text } = Typography;

// ── Types ──────────────────────────────────────────────────────────
interface Summary {
  total: number;
  healthy: number;
  warning: number;
  critical: number;
  avg_score: number;
}

interface EquipmentItem {
  id: number;
  name: string;
  model: string;
  status: string;
  health_score: number;
  risk_level: string;
}

interface FaultPrediction {
  equipment_id: number;
  equipment_name: string;
  health_score: number;
  fault_probability: number;
  predicted_fault: string;
  estimated_days: number;
  risk_level: string;
}

interface WorkOrder {
  id: number;
  equipment_id: number;
  type: string;
  priority: string;
  status: string;
  assigned_to: string;
  created_at: string;
}

interface Breakdown {
  vibration: number;
  temperature: number;
  pressure: number;
  electrical: number;
  wear: number;
}

// ── Helpers ────────────────────────────────────────────────────────
const riskColor = (level: string) => {
  const l = (level ?? '').toLowerCase();
  if (l === 'low') return 'green';
  if (l === 'medium') return 'orange';
  return 'red';
};

const riskLabel = (level: string) => {
  const l = (level ?? '').toLowerCase();
  if (l === 'low') return '低风险';
  if (l === 'medium') return '中风险';
  if (l === 'high') return '高风险';
  return level;
};

const statusTag = (status: string) => {
  const s = (status ?? '').toLowerCase();
  if (s === 'healthy') return <Tag color="green">健康</Tag>;
  if (s === 'warning') return <Tag color="orange">预警</Tag>;
  if (s === 'critical') return <Tag color="red">故障</Tag>;
  return <Tag>{status}</Tag>;
};

const priorityTag = (priority: string) => {
  const p = (priority ?? '').toLowerCase();
  if (p === 'high') return <Tag color="red">高</Tag>;
  if (p === 'medium') return <Tag color="orange">中</Tag>;
  if (p === 'low') return <Tag color="green">低</Tag>;
  return <Tag>{priority}</Tag>;
};

const woStatusTag = (status: string) => {
  const s = (status ?? '').toLowerCase();
  if (s === 'pending') return <Tag color="default">待处理</Tag>;
  if (s === 'in_progress') return <Tag color="processing">进行中</Tag>;
  if (s === 'completed') return <Tag color="success">已完成</Tag>;
  if (s === 'cancelled') return <Tag color="error">已取消</Tag>;
  return <Tag>{status}</Tag>;
};

const healthScoreColor = (score: number) => {
  if (score >= 80) return '#52c41a';
  if (score >= 60) return '#faad14';
  return '#ff4d4f';
};

// ── Component ──────────────────────────────────────────────────────
export default function MaintenancePage() {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [equipment, setEquipment] = useState<EquipmentItem[]>([]);
  const [predictions, setPredictions] = useState<FaultPrediction[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [radarLoading, setRadarLoading] = useState(false);
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null);
  const [selectedHealthScore, setSelectedHealthScore] = useState<number>(0);
  const [recommendation, setRecommendation] = useState<string>('');

  // ── Fetch overview data ──
  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [healthRes, predRes, woRes] = await Promise.all([
        getEquipmentHealth(),
        getFaultPredictions(),
        getWorkOrders(),
      ]);
      setSummary(healthRes.data.summary);
      setEquipment(healthRes.data.equipment);
      setPredictions(predRes.data.data);
      setWorkOrders(woRes.data.data);
    } catch {
      message.error('数据加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // ── Fetch single equipment detail for radar ──
  const fetchDetail = useCallback(async (id: number) => {
    setRadarLoading(true);
    try {
      const res = await getSingleEquipmentHealth(id);
      setBreakdown(res.data.breakdown);
      setSelectedHealthScore(res.data.health_score);
      setRecommendation(res.data.recommendation || '');
    } catch {
      message.error('设备详情加载失败');
    } finally {
      setRadarLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId !== null) {
      fetchDetail(selectedId);
    }
  }, [selectedId, fetchDetail]);

  // Auto-select first equipment
  useEffect(() => {
    if (equipment.length > 0 && selectedId === null) {
      setSelectedId(equipment[0].id);
    }
  }, [equipment, selectedId]);

  // ── Radar chart option ──
  const radarOption = {
    tooltip: {},
    radar: {
      indicator: [
        { name: '振动', max: 100 },
        { name: '温度', max: 100 },
        { name: '压力', max: 100 },
        { name: '电气', max: 100 },
        { name: '磨损', max: 100 },
      ],
      shape: 'polygon' as const,
      splitNumber: 5,
      axisName: { color: '#666' },
    },
    series: [
      {
        type: 'radar',
        data: breakdown
          ? [
              {
                value: [
                  breakdown.vibration,
                  breakdown.temperature,
                  breakdown.pressure,
                  breakdown.electrical,
                  breakdown.wear,
                ],
                name: '健康指标',
                areaStyle: { color: 'rgba(24, 144, 255, 0.2)' },
                lineStyle: { color: '#1890ff', width: 2 },
                itemStyle: { color: '#1890ff' },
              },
            ]
          : [],
      },
    ],
  };

  // ── Columns ──
  const equipmentColumns = [
    {
      title: '设备名称',
      dataIndex: 'name',
      key: 'name',
      ellipsis: true,
    },
    {
      title: '型号',
      dataIndex: 'model',
      key: 'model',
      width: 140,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (s: string) => statusTag(s),
    },
    {
      title: '健康评分',
      dataIndex: 'health_score',
      key: 'health_score',
      width: 180,
      sorter: (a: EquipmentItem, b: EquipmentItem) => a.health_score - b.health_score,
      render: (score: number) => (
        <Progress
          percent={score}
          size="small"
          strokeColor={healthScoreColor(score)}
          format={(p) => `${p}`}
        />
      ),
    },
    {
      title: '风险等级',
      dataIndex: 'risk_level',
      key: 'risk_level',
      width: 100,
      render: (r: string) => <Tag color={riskColor(r)}>{riskLabel(r)}</Tag>,
    },
    {
      title: '操作',
      key: 'action',
      width: 80,
      render: (_: unknown, record: EquipmentItem) => (
        <a onClick={() => setSelectedId(record.id)}>详情</a>
      ),
    },
  ];

  const predictionColumns = [
    {
      title: '设备名称',
      dataIndex: 'equipment_name',
      key: 'equipment_name',
      ellipsis: true,
    },
    {
      title: '健康评分',
      dataIndex: 'health_score',
      key: 'health_score',
      width: 100,
      render: (v: number) => (
        <span style={{ color: healthScoreColor(v), fontWeight: 600 }}>{v}</span>
      ),
    },
    {
      title: '故障概率',
      dataIndex: 'fault_probability',
      key: 'fault_probability',
      width: 110,
      render: (v: number) => `${((v ?? 0) * 100).toFixed(1)}%`,
      sorter: (a: FaultPrediction, b: FaultPrediction) =>
        a.fault_probability - b.fault_probability,
    },
    {
      title: '预测故障',
      dataIndex: 'predicted_fault',
      key: 'predicted_fault',
      ellipsis: true,
    },
    {
      title: '预计天数',
      dataIndex: 'estimated_days',
      key: 'estimated_days',
      width: 100,
      render: (v: number) => (
        <Tooltip title="预计故障发生剩余天数">
          <span style={{ color: v <= 7 ? '#ff4d4f' : v <= 14 ? '#faad14' : '#52c41a' }}>
            {v} 天
          </span>
        </Tooltip>
      ),
    },
    {
      title: '风险等级',
      dataIndex: 'risk_level',
      key: 'risk_level',
      width: 100,
      render: (r: string) => <Tag color={riskColor(r)}>{riskLabel(r)}</Tag>,
    },
  ];

  const workOrderColumns = [
    {
      title: '工单号',
      dataIndex: 'id',
      key: 'id',
      width: 80,
    },
    {
      title: '设备ID',
      dataIndex: 'equipment_id',
      key: 'equipment_id',
      width: 80,
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 100,
      render: (t: string) => {
        const map: Record<string, string> = {
          preventive: '预防性',
          corrective: '纠正性',
          emergency: '紧急',
          inspection: '巡检',
        };
        return map[(t ?? '').toLowerCase()] || t;
      },
    },
    {
      title: '优先级',
      dataIndex: 'priority',
      key: 'priority',
      width: 80,
      render: (p: string) => priorityTag(p),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (s: string) => woStatusTag(s),
    },
    {
      title: '负责人',
      dataIndex: 'assigned_to',
      key: 'assigned_to',
      width: 100,
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 170,
      render: (v: string) => formatServerDateTime(v),
    },
  ];

  // ── Workflow: submit maintenance request ──
  const [wfModalOpen, setWfModalOpen] = useState(false);
  const [wfSubmitting, setWfSubmitting] = useState(false);
  const [wfForm] = Form.useForm();

  const handleWfSubmit = async (values: any) => {
    setWfSubmitting(true);
    try {
      await wfStartInstance(1, {
        title: `维修申请 - ${values.equipment_name}`,
        form_data: values,
      });
      message.success('维修申请已提交，等待审批');
      setWfModalOpen(false);
      wfForm.resetFields();
    } catch {
      message.error('提交失败');
    } finally {
      setWfSubmitting(false);
    }
  };

  // ── Render ──
  if (loading) {
    return (
      <div>
        <Skeleton.Input active style={{ width: 200, marginBottom: 20 }} />
        <Row gutter={16} style={{ marginBottom: 24 }}>
          {[1,2,3,4].map(i => (
            <Col span={6} key={i}><Card size="small"><Skeleton active paragraph={false} /></Card></Col>
          ))}
        </Row>
        <Row gutter={16} style={{ marginBottom: 24 }}>
          <Col span={14}><Card size="small"><Skeleton active /></Card></Col>
          <Col span={10}><Card size="small"><Skeleton active /></Card></Col>
        </Row>
        <Card size="small" style={{ marginBottom: 24 }}><Skeleton active /></Card>
        <Card size="small"><Skeleton active /></Card>
      </div>
    );
  }

  return (
    <div>
      <Title level={4} style={{ marginBottom: 20 }}>
        <ToolOutlined style={{ marginRight: 8 }} />
        预测性维护
        <Button
          type="primary"
          icon={<PlusOutlined />}
          style={{ float: 'right', marginTop: 4 }}
          onClick={() => setWfModalOpen(true)}
        >
          提交维修申请
        </Button>
      </Title>

      {/* ── Summary Cards ── */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card size="small">
            <Statistic title="设备总数" value={summary?.total ?? 0} suffix="台" />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="健康"
              value={summary?.healthy ?? 0}
              suffix="台"
              valueStyle={{ color: '#52c41a' }}
              prefix={<CheckCircleOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="预警"
              value={summary?.warning ?? 0}
              suffix="台"
              valueStyle={{ color: '#faad14' }}
              prefix={<WarningOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="故障"
              value={summary?.critical ?? 0}
              suffix="台"
              valueStyle={{ color: '#ff4d4f' }}
              prefix={<CloseCircleOutlined />}
            />
          </Card>
        </Col>
      </Row>

      {/* ── Equipment Table + Radar ── */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={14}>
          <Card title="设备健康总览" size="small"
            extra={<Button size="small" icon={<DownloadOutlined />}
              onClick={() => exportCSV(equipmentColumns, equipment, '设备健康')}>导出</Button>}>
            <Table
              rowKey="id"
              dataSource={equipment}
              columns={equipmentColumns}
              size="small"
              pagination={{ pageSize: 6 }}
              rowClassName={(record) =>
                record.id === selectedId ? 'ant-table-row-selected' : ''
              }
              onRow={(record) => ({
                onClick: () => setSelectedId(record.id),
                style: { cursor: 'pointer' },
              })}
            />
          </Card>
        </Col>
        <Col span={10}>
          <Card
            title={
              selectedId !== null
                ? `设备健康分析 #${selectedId}`
                : '设备健康分析'
            }
            size="small"
            extra={
              selectedHealthScore > 0 && (
                <Tag color={healthScoreColor(selectedHealthScore)}>
                  综合 {selectedHealthScore} 分
                </Tag>
              )
            }
          >
            <Spin spinning={radarLoading}>
              <ReactECharts
                option={radarOption}
                style={{ height: 280 }}
                notMerge
              />
              {recommendation && (
                <div style={{ marginTop: 8 }}>
                  <Text type="secondary">建议: </Text>
                  <Text>{recommendation}</Text>
                </div>
              )}
            </Spin>
          </Card>
        </Col>
      </Row>

      {/* ── Fault Predictions ── */}
      <Card title="故障预测" size="small" style={{ marginBottom: 24 }}
        extra={<Button size="small" icon={<DownloadOutlined />}
          onClick={() => exportCSV(predictionColumns, predictions, '故障预测')}>导出</Button>}>        <Table
          rowKey="equipment_id"
          dataSource={predictions}
          columns={predictionColumns}
          size="small"
          pagination={{ pageSize: 5 }}
        />
      </Card>

      {/* ── Work Orders ── */}
      <Card title="工单管理" size="small"
        extra={<Button size="small" icon={<DownloadOutlined />}
          onClick={() => exportCSV(workOrderColumns, workOrders, '工单')}>导出</Button>}>
        <Table
          rowKey="id"
          dataSource={workOrders}
          columns={workOrderColumns}
          size="small"
          pagination={{ pageSize: 5 }}
        />
      </Card>

      {/* ── Workflow Modal: Submit Maintenance Request ── */}
      <Modal
        title="提交维修申请"
        open={wfModalOpen}
        onCancel={() => setWfModalOpen(false)}
        footer={null}
        width={520}
      >
        <Form form={wfForm} layout="vertical" onFinish={handleWfSubmit}
          initialValues={{ priority: 'medium' }}>
          <Form.Item name="equipment_name" label="设备名称" rules={[{ required: true, message: '请输入设备名称' }]}>
            <Input placeholder="如：CNC 加工中心 #3" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="priority" label="优先级">
                <Select options={[
                  { label: '高', value: 'high' },
                  { label: '中', value: 'medium' },
                  { label: '低', value: 'low' },
                ]} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="fault_type" label="故障类型">
                <Select allowClear placeholder="选择故障类型" options={[
                  { label: '机械故障', value: 'mechanical' },
                  { label: '电气故障', value: 'electrical' },
                  { label: '液压故障', value: 'hydraulic' },
                  { label: '软件异常', value: 'software' },
                  { label: '其他', value: 'other' },
                ]} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="description" label="问题描述" rules={[{ required: true, message: '请描述问题' }]}>
            <Input.TextArea rows={3} placeholder="详细描述设备异常情况..." />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={wfSubmitting} block>
              提交申请
            </Button>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
