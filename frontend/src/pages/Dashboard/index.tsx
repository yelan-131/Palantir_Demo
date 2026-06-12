import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Progress,
  Row,
  Skeleton,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  CheckCircleOutlined,
  DashboardOutlined,
  ExperimentOutlined,
  FileTextOutlined,
  HeartOutlined,
  ReloadOutlined,
  SettingOutlined,
  ThunderboltOutlined,
  ToolOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { useNavigate } from 'react-router-dom';
import { getAlerts, getOEE, getOverview, getProductionStats } from '@/services/api';
import { formatServerDateTime } from '@/utils/dateTime';

interface OverviewData {
  factories: { count: number };
  equipment: { total: number; running: number; utilization_rate: number };
  production_lines: { total: number; running: number };
  work_orders: { total: number; in_progress: number; completed: number };
  quality: { defect_count: number };
  avg_equipment_health: number;
}

interface OEERecord {
  line_id: number;
  line_name: string;
  availability: number;
  performance: number;
  quality: number;
  oee: number;
  target: number;
}

interface ProductionDay {
  date: string;
  planned: number;
  actual: number;
  passed: number;
  yield_rate: number;
}

interface AlertRecord {
  id: string | number;
  type: string;
  severity: string;
  title: string;
  message: string;
  entity_id: number;
  timestamp: string;
}

const severityColorMap: Record<string, string> = {
  critical: 'red',
  high: 'volcano',
  warning: 'orange',
  medium: 'gold',
  low: 'green',
  info: 'blue',
};

const severityLabelMap: Record<string, string> = {
  critical: '严重',
  high: '高',
  warning: '预警',
  medium: '中',
  low: '低',
  info: '信息',
};

const percent = (value = 0) => Number((value * 100).toFixed(1));

function unwrapData<T>(payload: any, fallback: T): T {
  return payload?.data?.data ?? payload?.data ?? fallback;
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [oeeData, setOeeData] = useState<OEERecord[]>([]);
  const [productionData, setProductionData] = useState<ProductionDay[]>([]);
  const [alerts, setAlerts] = useState<AlertRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAllData = useCallback(async () => {
    setLoading(true);
    try {
      const results = await Promise.allSettled([
        getOverview(),
        getOEE(),
        getProductionStats(14),
        getAlerts(20),
      ]);
      const [overviewRes, oeeRes, productionRes, alertsRes] = results;

      if (overviewRes.status === 'fulfilled') setOverview(unwrapData<OverviewData | null>(overviewRes.value, null));
      if (oeeRes.status === 'fulfilled') setOeeData(unwrapData<OEERecord[]>(oeeRes.value, []));
      if (productionRes.status === 'fulfilled') setProductionData(unwrapData<ProductionDay[]>(productionRes.value, []));
      if (alertsRes.status === 'fulfilled') setAlerts(unwrapData<AlertRecord[]>(alertsRes.value, []));

      const failed = results.filter((item) => item.status === 'rejected').length;
      if (failed) message.warning(`${failed} 个数据源加载失败，已展示可用数据`);
    } catch {
      message.error('生产看板数据加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  const oeeAverage = useMemo(() => {
    if (!oeeData.length) return 0;
    return oeeData.reduce((sum, item) => sum + item.oee, 0) / oeeData.length;
  }, [oeeData]);

  const yieldAverage = useMemo(() => {
    if (!productionData.length) return 0;
    return productionData.reduce((sum, item) => sum + item.yield_rate, 0) / productionData.length;
  }, [productionData]);

  const totalActual = useMemo(
    () => productionData.reduce((sum, item) => sum + item.actual, 0),
    [productionData],
  );

  const topLines = useMemo(
    () => [...oeeData].sort((a, b) => b.oee - a.oee).slice(0, 8),
    [oeeData],
  );

  const productionOption = useMemo<EChartsOption>(() => ({
    color: ['#1677ff', '#13c2c2', '#faad14'],
    tooltip: { trigger: 'axis' },
    legend: { top: 0, data: ['计划产量', '实际产量', '合格率'] },
    grid: { left: 36, right: 42, top: 48, bottom: 32 },
    xAxis: {
      type: 'category',
      data: productionData.map((item) => item.date.slice(5)),
      axisTick: { alignWithLabel: true },
    },
    yAxis: [
      { type: 'value', name: '产量' },
      { type: 'value', name: '合格率', min: 80, max: 100, axisLabel: { formatter: '{value}%' } },
    ],
    series: [
      { name: '计划产量', type: 'bar', barMaxWidth: 22, data: productionData.map((item) => item.planned) },
      { name: '实际产量', type: 'bar', barMaxWidth: 22, data: productionData.map((item) => item.actual) },
      {
        name: '合格率',
        type: 'line',
        yAxisIndex: 1,
        smooth: true,
        symbolSize: 7,
        data: productionData.map((item) => percent(item.yield_rate)),
      },
    ],
  }), [productionData]);

  const oeeOption = useMemo<EChartsOption>(() => ({
    color: ['#1677ff', '#52c41a', '#faad14'],
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { top: 0, data: ['OEE', '目标'] },
    grid: { left: 112, right: 28, top: 44, bottom: 24 },
    xAxis: { type: 'value', max: 100, axisLabel: { formatter: '{value}%' } },
    yAxis: {
      type: 'category',
      data: topLines.map((item) => item.line_name),
      axisLabel: { width: 96, overflow: 'truncate' },
    },
    series: [
      {
        name: 'OEE',
        type: 'bar',
        barMaxWidth: 16,
        data: topLines.map((item) => percent(item.oee)),
      },
      {
        name: '目标',
        type: 'scatter',
        symbol: 'diamond',
        symbolSize: 10,
        data: topLines.map((item) => percent(item.target)),
      },
    ],
  }), [topLines]);

  const lineHealthOption = useMemo<EChartsOption>(() => ({
    color: ['#52c41a', '#faad14', '#ff4d4f'],
    tooltip: { trigger: 'item' },
    legend: { bottom: 0 },
    series: [
      {
        type: 'pie',
        radius: ['54%', '74%'],
        center: ['50%', '44%'],
        label: { formatter: '{b}\n{d}%' },
        data: [
          { name: '运行', value: overview?.production_lines.running ?? 0 },
          { name: '待机', value: Math.max((overview?.production_lines.total ?? 0) - (overview?.production_lines.running ?? 0), 0) },
          { name: '告警', value: alerts.filter((item) => ['critical', 'high', 'warning'].includes(item.severity)).length },
        ],
      },
    ],
  }), [alerts, overview]);

  const alertColumns = [
    {
      title: '级别',
      dataIndex: 'severity',
      width: 92,
      render: (severity: string) => (
        <Tag color={severityColorMap[severity] ?? 'default'}>{severityLabelMap[severity] ?? severity}</Tag>
      ),
    },
    { title: '标题', dataIndex: 'title', ellipsis: true },
    { title: '详情', dataIndex: 'message', ellipsis: true },
    {
      title: '时间',
      dataIndex: 'timestamp',
      width: 172,
      render: (value: string) => formatServerDateTime(value),
    },
  ];

  if (loading) {
    return (
      <div className="dashboard-page">
        <Skeleton active paragraph={{ rows: 12 }} />
      </div>
    );
  }

  return (
    <div className="dashboard-page">
      <div className="app-program-header dashboard-command-header">
        <div className="app-program-title-block">
          <span className="app-program-icon"><DashboardOutlined /></span>
          <div>
            <Space size={8} align="center" wrap>
              <Typography.Title level={3}>生产运营看板</Typography.Title>
              <Tag color="blue">实时运营</Tag>
            </Space>
            <Typography.Text type="secondary">
              产线、设备、工单、质量和告警的统一生产态势视图。
            </Typography.Text>
          </div>
        </div>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={fetchAllData}>刷新</Button>
          <Button icon={<SettingOutlined />} onClick={() => navigate('/form-settings/production-overview')}>配置</Button>
        </Space>
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} xl={4}>
          <Card className="dashboard-kpi-card" size="small">
            <Statistic title="工厂" value={overview?.factories.count ?? 0} prefix={<ThunderboltOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={4}>
          <Card className="dashboard-kpi-card" size="small">
            <Statistic title="运行设备" value={overview?.equipment.running ?? 0} suffix={`/ ${overview?.equipment.total ?? 0}`} prefix={<ToolOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={4}>
          <Card className="dashboard-kpi-card" size="small">
            <Statistic title="设备利用率" value={percent(overview?.equipment.utilization_rate)} suffix="%" precision={1} prefix={<CheckCircleOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={4}>
          <Card className="dashboard-kpi-card" size="small">
            <Statistic title="平均健康度" value={percent(overview?.avg_equipment_health)} suffix="%" precision={1} prefix={<HeartOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={4}>
          <Card className="dashboard-kpi-card" size="small">
            <Statistic title="在制工单" value={overview?.work_orders.in_progress ?? 0} prefix={<FileTextOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={4}>
          <Card className="dashboard-kpi-card" size="small">
            <Statistic title="缺陷记录" value={overview?.quality.defect_count ?? 0} prefix={<ExperimentOutlined />} />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={16}>
          <Card title="产量与合格率趋势" extra={<Tag color="blue">近 14 天</Tag>}>
            <ReactECharts option={productionOption} style={{ height: 360 }} notMerge lazyUpdate />
          </Card>
        </Col>
        <Col xs={24} xl={8}>
          <Card title="核心指标">
            <Space direction="vertical" size={18} style={{ width: '100%' }}>
              <div>
                <Typography.Text type="secondary">平均 OEE</Typography.Text>
                <Progress percent={percent(oeeAverage)} strokeColor="#1677ff" />
              </div>
              <div>
                <Typography.Text type="secondary">平均合格率</Typography.Text>
                <Progress percent={percent(yieldAverage)} strokeColor="#52c41a" />
              </div>
              <div>
                <Typography.Text type="secondary">设备健康度</Typography.Text>
                <Progress percent={percent(overview?.avg_equipment_health)} strokeColor="#13c2c2" />
              </div>
              <Alert
                type={alerts.some((item) => item.severity === 'critical') ? 'error' : 'success'}
                showIcon
                message={`累计实际产量 ${totalActual.toLocaleString('zh-CN')} 件，当前告警 ${alerts.length} 条`}
              />
            </Space>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={14}>
          <Card title="产线 OEE 排名">
            <ReactECharts option={oeeOption} style={{ height: 360 }} notMerge lazyUpdate />
          </Card>
        </Col>
        <Col xs={24} xl={10}>
          <Card title="产线状态分布">
            <ReactECharts option={lineHealthOption} style={{ height: 360 }} notMerge lazyUpdate />
          </Card>
        </Col>
      </Row>

      <Card
        title={<Space><WarningOutlined />告警队列</Space>}
        extra={<Tag color={alerts.length ? 'orange' : 'green'}>{alerts.length} 条</Tag>}
      >
        <Table
          dataSource={alerts}
          columns={alertColumns}
          rowKey="id"
          size="middle"
          pagination={{ pageSize: 8, showSizeChanger: false }}
          scroll={{ x: 760 }}
        />
      </Card>
    </div>
  );
}
