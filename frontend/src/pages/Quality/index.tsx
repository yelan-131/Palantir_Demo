import { useState, useEffect, useCallback } from 'react';
import {
  Row,
  Col,
  Card,
  Table,
  Tag,
  Select,
  Skeleton,
  Spin,
  message,
  Typography,
  InputNumber,
  Steps,
  Space,
  Input,
  Button,
  Statistic,
  Tooltip,
  Modal,
  Form,
} from 'antd';
import {
  SafetyCertificateOutlined,
  SearchOutlined,
  LineChartOutlined,
  PlusOutlined,
  DownloadOutlined,
} from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import {
  getSPCData,
  listDefects,
  getDefectPareto,
  getTraceability,
  listInspections,
  wfStartInstance,
} from '@/services/api';
import { exportCSV } from '@/utils/csvExport';

const { Title, Text } = Typography;

// ── Types ──────────────────────────────────────────────────────────
interface SPCPoint {
  timestamp: string;
  value: number;
  ucl: number;
  lcl: number;
  cl: number;
  out_of_control: boolean;
}

interface DefectItem {
  id: number;
  defect_type: string;
  severity: string;
  description: string;
  root_cause: string;
}

interface ParetoItem {
  defect_type: string;
  count: number;
  percentage: number;
  cumulative_percentage: number;
}

interface TraceStep {
  step: string;
  type: string;
  result: string;
  timestamp: string;
}

interface InspectionItem {
  id: number;
  inspection_type: string;
  target_type: string;
  result: string;
  inspected_at: string;
}

// ── Helpers ────────────────────────────────────────────────────────
const severityTag = (severity: string) => {
  const s = (severity ?? '').toLowerCase();
  if (s === 'critical') return <Tag color="red">严重</Tag>;
  if (s === 'major') return <Tag color="orange">重大</Tag>;
  if (s === 'minor') return <Tag color="blue">一般</Tag>;
  return <Tag>{severity}</Tag>;
};

const traceTypeIcon = (type: string) => {
  const t = (type ?? '').toLowerCase();
  if (t === 'inspection') return '质检';
  if (t === 'operation') return '工序';
  if (t === 'material') return '物料';
  if (t === 'assembly') return '装配';
  if (t === 'shipping') return '发货';
  return type;
};

const inspectionResultTag = (result: string) => {
  const r = (result ?? '').toLowerCase();
  if (r === 'pass' || r === 'passed') return <Tag color="green">合格</Tag>;
  if (r === 'fail' || r === 'failed') return <Tag color="red">不合格</Tag>;
  return <Tag color="blue">{result}</Tag>;
};

// ── SPC parameters ──
const SPC_PARAMETERS = [
  { label: '外径 (mm)', value: 'outer_diameter' },
  { label: '内径 (mm)', value: 'inner_diameter' },
  { label: '长度 (mm)', value: 'length' },
  { label: '硬度 (HRC)', value: 'hardness' },
  { label: '表面粗糙度 (Ra)', value: 'surface_roughness' },
  { label: '电阻 (Ohm)', value: 'resistance' },
];

// ── Component ──────────────────────────────────────────────────────
export default function QualityPage() {
  const [loading, setLoading] = useState(true);

  // SPC
  const [spcParameter, setSpcParameter] = useState('outer_diameter');
  const [spcHours, setSpcHours] = useState(24);
  const [spcData, setSpcData] = useState<SPCPoint[]>([]);
  const [cpk, setCpk] = useState<number>(0);
  const [spcLoading, setSpcLoading] = useState(false);

  // Defects
  const [defects, setDefects] = useState<DefectItem[]>([]);
  const [defectTotal, setDefectTotal] = useState(0);
  const [defectPage, setDefectPage] = useState(1);
  const [defectSeverity, setDefectSeverity] = useState<string | undefined>(undefined);
  const [defectsLoading, setDefectsLoading] = useState(false);

  // Pareto
  const [paretoData, setParetoData] = useState<ParetoItem[]>([]);
  const [paretoDays, setParetoDays] = useState(30);

  // Traceability
  const [traceEntityId, setTraceEntityId] = useState<number | null>(null);
  const [traceData, setTraceData] = useState<TraceStep[]>([]);
  const [traceLoading, setTraceLoading] = useState(false);

  // Inspections
  const [inspections, setInspections] = useState<InspectionItem[]>([]);
  const [inspTotal, setInspTotal] = useState(0);
  const [inspPage, setInspPage] = useState(1);
  const [inspType, setInspType] = useState<string | undefined>(undefined);
  const [inspLoading, setInspLoading] = useState(false);

  // ── Fetch initial data ──
  const fetchInitial = useCallback(async () => {
    setLoading(true);
    try {
      const [defectsRes, paretoRes, inspRes] = await Promise.all([
        listDefects({ page: 1, page_size: 10 }),
        getDefectPareto(30),
        listInspections({ page: 1, page_size: 10 }),
      ]);
      setDefects(defectsRes.data.data);
      setDefectTotal(defectsRes.data.total);
      setParetoData(paretoRes.data.data);
      setInspections(inspRes.data.data);
      setInspTotal(inspRes.data.total);
    } catch {
      message.error('质量数据加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInitial();
  }, [fetchInitial]);

  // ── SPC fetch ──
  const fetchSPC = useCallback(async () => {
    setSpcLoading(true);
    try {
      const res = await getSPCData(spcParameter, { hours: spcHours });
      setSpcData(res.data.data);
      setCpk(res.data.cpk);
    } catch {
      message.error('SPC 数据加载失败');
    } finally {
      setSpcLoading(false);
    }
  }, [spcParameter, spcHours]);

  useEffect(() => {
    fetchSPC();
  }, [fetchSPC]);

  // ── Defects fetch ──
  const fetchDefects = useCallback(async () => {
    setDefectsLoading(true);
    try {
      const res = await listDefects({
        severity: defectSeverity,
        page: defectPage,
        page_size: 10,
      });
      setDefects(res.data.data);
      setDefectTotal(res.data.total);
    } catch {
      message.error('缺陷列表加载失败');
    } finally {
      setDefectsLoading(false);
    }
  }, [defectSeverity, defectPage]);

  useEffect(() => {
    if (!loading) fetchDefects();
  }, [fetchDefects, loading]);

  // ── Inspections fetch ──
  const fetchInspections = useCallback(async () => {
    setInspLoading(true);
    try {
      const res = await listInspections({
        inspection_type: inspType,
        page: inspPage,
        page_size: 10,
      });
      setInspections(res.data.data);
      setInspTotal(res.data.total);
    } catch {
      message.error('检验记录加载失败');
    } finally {
      setInspLoading(false);
    }
  }, [inspType, inspPage]);

  useEffect(() => {
    if (!loading) fetchInspections();
  }, [fetchInspections, loading]);

  // ── Traceability fetch ──
  const handleTrace = async () => {
    if (!traceEntityId) {
      message.warning('请输入实体 ID');
      return;
    }
    setTraceLoading(true);
    try {
      const res = await getTraceability(traceEntityId);
      setTraceData(res.data.trace);
    } catch {
      message.error('追溯数据加载失败');
      setTraceData([]);
    } finally {
      setTraceLoading(false);
    }
  };

  // ── SPC Control Chart option ──
  const spcChartOption = {
    tooltip: {
      trigger: 'axis' as const,
      formatter: (params: unknown[]) => {
        const items = params as {
          marker: string;
          seriesName: string;
          value: number;
          dataIndex?: number;
        }[];
        if (!items || items.length === 0) return '';
        const idx = items[0].dataIndex ?? 0;
        const point = spcData[idx];
        if (!point) return '';
        const lines = [
          `<b>${point.timestamp}</b>`,
          `测量值: ${(point.value ?? 0).toFixed(4)}`,
          `UCL: ${(point.ucl ?? 0).toFixed(4)}`,
          `CL: ${(point.cl ?? 0).toFixed(4)}`,
          `LCL: ${(point.lcl ?? 0).toFixed(4)}`,
        ];
        if (point.out_of_control) {
          lines.push('<span style="color:#ff4d4f;font-weight:bold">失控点!</span>');
        }
        return lines.join('<br/>');
      },
    },
    legend: {
      data: ['UCL', 'CL', 'LCL', '测量值'],
      bottom: 0,
    },
    grid: { top: 30, right: 20, bottom: 40, left: 60 },
    xAxis: {
      type: 'category' as const,
      data: spcData.map((p) => {
        try {
          return new Date(p.timestamp).toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
          });
        } catch {
          return p.timestamp;
        }
      }),
      axisLabel: { rotate: 30, fontSize: 10 },
    },
    yAxis: {
      type: 'value' as const,
      scale: true,
    },
    series: [
      {
        name: 'UCL',
        type: 'line',
        data: spcData.map((p) => p.ucl),
        lineStyle: { color: '#ff4d4f', type: 'dashed' as const, width: 1 },
        symbol: 'none',
        itemStyle: { color: '#ff4d4f' },
      },
      {
        name: 'CL',
        type: 'line',
        data: spcData.map((p) => p.cl),
        lineStyle: { color: '#52c41a', type: 'dashed' as const, width: 1 },
        symbol: 'none',
        itemStyle: { color: '#52c41a' },
      },
      {
        name: 'LCL',
        type: 'line',
        data: spcData.map((p) => p.lcl),
        lineStyle: { color: '#ff4d4f', type: 'dashed' as const, width: 1 },
        symbol: 'none',
        itemStyle: { color: '#ff4d4f' },
      },
      {
        name: '测量值',
        type: 'line',
        data: spcData.map((p) => p.value),
        lineStyle: { color: '#1890ff', width: 2 },
        symbol: 'circle',
        symbolSize: 6,
        itemStyle: {
          color: (params: { dataIndex: number }) => {
            const point = spcData[params.dataIndex];
            return point?.out_of_control ? '#ff4d4f' : '#1890ff';
          },
        },
      },
    ],
  };

  // ── Pareto chart option ──
  const paretoChartOption = {
    tooltip: {
      trigger: 'axis' as const,
      axisPointer: { type: 'cross' as const },
    },
    legend: {
      data: ['缺陷数量', '累计占比'],
      bottom: 0,
    },
    grid: { top: 30, right: 60, bottom: 40, left: 60 },
    xAxis: {
      type: 'category' as const,
      data: paretoData.map((d) => d.defect_type),
      axisLabel: { rotate: 30, fontSize: 10 },
    },
    yAxis: [
      { type: 'value' as const, name: '数量', position: 'left' },
      {
        type: 'value' as const,
        name: '累计 %',
        position: 'right',
        axisLabel: { formatter: '{value}%' },
        max: 100,
      },
    ],
    series: [
      {
        name: '缺陷数量',
        type: 'bar',
        data: paretoData.map((d) => d.count),
        itemStyle: {
          color: (params: { dataIndex: number }) => {
            const cumPct = paretoData[params.dataIndex]?.cumulative_percentage ?? 0;
            if (cumPct <= 80) return '#1890ff';
            if (cumPct <= 95) return '#faad14';
            return '#d9d9d9';
          },
        },
        barMaxWidth: 40,
      },
      {
        name: '累计占比',
        type: 'line',
        yAxisIndex: 1,
        data: paretoData.map((d) => d.cumulative_percentage),
        lineStyle: { color: '#ff4d4f', width: 2 },
        itemStyle: { color: '#ff4d4f' },
        symbol: 'circle',
        symbolSize: 6,
        markLine: {
          silent: true,
          data: [{ yAxis: 80, lineStyle: { color: '#faad14', type: 'dashed' } }],
          label: { formatter: '80%' },
        },
      },
    ],
  };

  // ── Columns ──
  const defectColumns = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 60,
    },
    {
      title: '缺陷类型',
      dataIndex: 'defect_type',
      key: 'defect_type',
      ellipsis: true,
    },
    {
      title: '严重程度',
      dataIndex: 'severity',
      key: 'severity',
      width: 100,
      render: (s: string) => severityTag(s),
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
    },
    {
      title: '根因',
      dataIndex: 'root_cause',
      key: 'root_cause',
      ellipsis: true,
    },
  ];

  const inspectionColumns = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 60,
    },
    {
      title: '检验类型',
      dataIndex: 'inspection_type',
      key: 'inspection_type',
      width: 120,
      render: (t: string) => {
        const map: Record<string, string> = {
          incoming: '来料检验',
          in_process: '过程检验',
          final: '成品检验',
          sampling: '抽检',
        };
        return map[(t ?? '').toLowerCase()] || t;
      },
    },
    {
      title: '检验对象',
      dataIndex: 'target_type',
      key: 'target_type',
      width: 120,
    },
    {
      title: '结果',
      dataIndex: 'result',
      key: 'result',
      width: 100,
      render: (r: string) => inspectionResultTag(r),
    },
    {
      title: '检验时间',
      dataIndex: 'inspected_at',
      key: 'inspected_at',
      width: 170,
      render: (v: string) => (v ? new Date(v).toLocaleString('zh-CN') : '-'),
    },
  ];

  // ── Workflow: submit quality issue ──
  const [wfModalOpen, setWfModalOpen] = useState(false);
  const [wfSubmitting, setWfSubmitting] = useState(false);
  const [wfForm] = Form.useForm();

  const handleWfSubmit = async (values: any) => {
    setWfSubmitting(true);
    try {
      await wfStartInstance(2, {
        title: `质量异常处理 - ${values.defect_type || '未知缺陷'}`,
        form_data: values,
      });
      message.success('异常处理申请已提交，等待审批');
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
        <Card size="small" style={{ marginBottom: 24 }}><Skeleton active /></Card>
        <Row gutter={16} style={{ marginBottom: 24 }}>
          <Col span={10}><Card size="small"><Skeleton active /></Card></Col>
          <Col span={14}><Card size="small"><Skeleton active /></Card></Col>
        </Row>
        <Row gutter={16}>
          <Col span={8}><Card size="small"><Skeleton active /></Card></Col>
          <Col span={16}><Card size="small"><Skeleton active /></Card></Col>
        </Row>
      </div>
    );
  }

  return (
    <div>
      <Title level={4} style={{ marginBottom: 20 }}>
        <SafetyCertificateOutlined style={{ marginRight: 8 }} />
        质量管理
        <Button
          type="primary"
          danger
          icon={<PlusOutlined />}
          style={{ float: 'right', marginTop: 4 }}
          onClick={() => setWfModalOpen(true)}
        >
          提交异常处理
        </Button>
      </Title>

      {/* ── SPC Control Chart ── */}
      <Card
        title={
          <span>
            <LineChartOutlined style={{ marginRight: 6 }} />
            SPC 控制图
          </span>
        }
        size="small"
        style={{ marginBottom: 24 }}
        extra={
          <Space>
            <Select
              value={spcParameter}
              onChange={setSpcParameter}
              style={{ width: 180 }}
              options={SPC_PARAMETERS}
              size="small"
            />
            <Tooltip title="回溯小时数">
              <InputNumber
                min={1}
                max={720}
                value={spcHours}
                onChange={(v) => v && setSpcHours(v)}
                size="small"
                style={{ width: 80 }}
                addonAfter="h"
              />
            </Tooltip>
            <Tooltip title="Cpk 过程能力指数">
              <Tag color={cpk >= 1.33 ? 'green' : cpk >= 1.0 ? 'orange' : 'red'}>
                Cpk = {(cpk ?? 0).toFixed(2)}
              </Tag>
            </Tooltip>
          </Space>
        }
      >
        <Spin spinning={spcLoading}>
          <ReactECharts
            option={spcChartOption}
            style={{ height: 340 }}
            notMerge
          />
        </Spin>
      </Card>

      {/* ── Pareto Chart + Defects Table ── */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={10}>
          <Card
            title="缺陷帕累托图"
            size="small"
            extra={
              <Select
                value={paretoDays}
                onChange={(v) => setParetoDays(v)}
                style={{ width: 100 }}
                size="small"
                options={[
                  { label: '近 7 天', value: 7 },
                  { label: '近 30 天', value: 30 },
                  { label: '近 90 天', value: 90 },
                ]}
              />
            }
          >
            <ReactECharts
              option={paretoChartOption}
              style={{ height: 320 }}
              notMerge
            />
          </Card>
        </Col>
        <Col span={14}>
          <Card
            title="缺陷记录"
            size="small"
            extra={
              <Space>
                <Button size="small" icon={<DownloadOutlined />}
                  onClick={() => exportCSV(defectColumns, defects, '缺陷记录')}>导出</Button>
                <Select
                  placeholder="严重程度筛选"
                  allowClear
                  style={{ width: 130 }}
                  size="small"
                  value={defectSeverity}
                  onChange={(v) => {
                    setDefectSeverity(v);
                    setDefectPage(1);
                  }}
                  options={[
                    { label: '严重', value: 'critical' },
                    { label: '重大', value: 'major' },
                    { label: '一般', value: 'minor' },
                  ]}
                />
              </Space>
            }
          >
            <Table
              rowKey="id"
              dataSource={defects}
              columns={defectColumns}
              size="small"
              loading={defectsLoading}
              pagination={{
                current: defectPage,
                total: defectTotal,
                pageSize: 10,
                onChange: (p) => setDefectPage(p),
                showTotal: (t) => `共 ${t} 条`,
                size: 'small',
              }}
            />
          </Card>
        </Col>
      </Row>

      {/* ── Traceability + Inspections ── */}
      <Row gutter={16}>
        <Col span={8}>
          <Card title="质量追溯" size="small">
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <Space>
                <InputNumber
                  placeholder="输入实体 ID"
                  value={traceEntityId}
                  onChange={(v) => setTraceEntityId(v)}
                  style={{ width: 140 }}
                  min={1}
                />
                <Button
                  type="primary"
                  icon={<SearchOutlined />}
                  onClick={handleTrace}
                  loading={traceLoading}
                >
                  追溯
                </Button>
              </Space>
              {traceData.length > 0 ? (
                <Steps
                  direction="vertical"
                  size="small"
                  current={traceData.length}
                  items={traceData.map((step, idx) => ({
                    title: (
                      <span>
                        <Tag style={{ marginRight: 4 }}>{traceTypeIcon(step.type)}</Tag>
                        {step.step}
                      </span>
                    ),
                    description: (
                      <div>
                        <div>
                          <Text
                            type={step.result === 'pass' ? 'success' : step.result === 'fail' ? 'danger' : undefined}
                          >
                            结果: {step.result === 'pass' ? '合格' : step.result === 'fail' ? '不合格' : step.result}
                          </Text>
                        </div>
                        <div>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {step.timestamp
                              ? new Date(step.timestamp).toLocaleString('zh-CN')
                              : ''}
                          </Text>
                        </div>
                      </div>
                    ),
                    status: step.result === 'fail' ? ('error' as const) : ('finish' as const),
                  }))}
                />
              ) : (
                <Text type="secondary">输入实体 ID 并点击追溯查看完整流程</Text>
              )}
            </Space>
          </Card>
        </Col>
        <Col span={16}>
          <Card
            title="检验记录"
            size="small"
            extra={
              <Space>
                <Button size="small" icon={<DownloadOutlined />}
                  onClick={() => exportCSV(inspectionColumns, inspections, '检验记录')}>导出</Button>
                <Select
                  placeholder="检验类型筛选"
                  allowClear
                  style={{ width: 130 }}
                  size="small"
                  value={inspType}
                  onChange={(v) => {
                    setInspType(v);
                    setInspPage(1);
                  }}
                  options={[
                    { label: '来料检验', value: 'incoming' },
                    { label: '过程检验', value: 'in_process' },
                    { label: '成品检验', value: 'final' },
                    { label: '抽检', value: 'sampling' },
                  ]}
                />
              </Space>
            }
          >
            <Table
              rowKey="id"
              dataSource={inspections}
              columns={inspectionColumns}
              size="small"
              loading={inspLoading}
              pagination={{
                current: inspPage,
                total: inspTotal,
                pageSize: 10,
                onChange: (p) => setInspPage(p),
                showTotal: (t) => `共 ${t} 条`,
                size: 'small',
              }}
            />
          </Card>
        </Col>
      </Row>

      {/* ── Workflow Modal: Submit Quality Issue ── */}
      <Modal
        title="提交质量异常处理"
        open={wfModalOpen}
        onCancel={() => setWfModalOpen(false)}
        footer={null}
        width={520}
      >
        <Form form={wfForm} layout="vertical" onFinish={handleWfSubmit}
          initialValues={{ severity: 'major' }}>
          <Form.Item name="defect_type" label="缺陷类型" rules={[{ required: true, message: '请输入缺陷类型' }]}>
            <Input placeholder="如：尺寸超差" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="severity" label="严重程度">
                <Select options={[
                  { label: '严重', value: 'critical' },
                  { label: '重大', value: 'major' },
                  { label: '一般', value: 'minor' },
                ]} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="product_batch" label="产品批次">
                <Input placeholder="如：BATCH-2026-0422" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="description" label="异常描述" rules={[{ required: true, message: '请描述异常' }]}>
            <Input.TextArea rows={3} placeholder="详细描述质量异常情况..." />
          </Form.Item>
          <Form.Item name="root_cause" label="初步原因分析">
            <Input.TextArea rows={2} placeholder="初步分析的可能原因..." />
          </Form.Item>
          <Form.Item>
            <Button type="primary" danger htmlType="submit" loading={wfSubmitting} block>
              提交异常处理申请
            </Button>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
