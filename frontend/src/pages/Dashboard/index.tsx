import React, { useState, useEffect, useCallback } from 'react';
import { Button, Card, Row, Col, Statistic, Table, Tag, Skeleton, Space, Typography, message } from 'antd';
import {
  ToolOutlined,
  CheckCircleOutlined,
  HeartOutlined,
  FileTextOutlined,
  ReloadOutlined,
  SettingOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { useNavigate } from 'react-router-dom';
import { getOverview, getOEE, getProductionStats, getAlerts } from '@/services/api';

// ---------- Type definitions ----------

interface OverviewData {
  factories: { count: number };
  equipment: {
    total: number;
    running: number;
    utilization_rate: number;
  };
  production_lines: {
    total: number;
    running: number;
  };
  work_orders: {
    total: number;
    in_progress: number;
    completed: number;
  };
  quality: {
    defect_count: number;
  };
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
  id: number;
  type: string;
  severity: string;
  title: string;
  message: string;
  entity_id: number;
  timestamp: string;
}

// ---------- Severity helpers ----------

const severityColorMap: Record<string, string> = {
  critical: '#f5222d',
  high: '#fa541c',
  medium: '#faad14',
  low: '#52c41a',
  info: '#1677ff',
};

const severityLabelMap: Record<string, string> = {
  critical: '紧急',
  high: '高',
  medium: '中',
  low: '低',
  info: '信息',
};

// ---------- Component ----------

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
        getProductionStats(7),
        getAlerts(10),
      ]);
      const [overviewRes, oeeRes, prodRes, alertsRes] = results;

      if (overviewRes.status === 'fulfilled') {
        setOverview(overviewRes.value.data?.data ?? overviewRes.value.data);
      }
      if (oeeRes.status === 'fulfilled') {
        setOeeData(oeeRes.value.data?.data ?? []);
      }
      if (prodRes.status === 'fulfilled') {
        setProductionData(prodRes.value.data?.data ?? []);
      }
      if (alertsRes.status === 'fulfilled') {
        setAlerts(alertsRes.value.data?.data ?? []);
      }

      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed > 0 && failed < 4) {
        message.warning(`${failed} 个数据源加载失败`);
      } else if (failed === 4) {
        message.error('数据加载失败，请稍后重试');
      }
    } catch {
      message.error('数据加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const openSettings = () => {
    navigate('/form-settings/production-overview');
  };

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  // ---- OEE stacked bar chart ----

  const buildOEEChartOption = useCallback((): EChartsOption => {
    const lineNames = oeeData.map((d) => d.line_name);
    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter(params: unknown) {
          const items = params as { seriesName: string; value: number; color: string }[];
          if (!Array.isArray(items)) return '';
          const total = items.reduce((s, i) => s + i.value, 0);
          let html = `<strong>${(items as unknown as { axisValue: string }[])[0]?.axisValue ?? ''}</strong><br/>`;
          items.forEach((item) => {
            html += `${item.seriesName}: <b>${(item.value ?? 0).toFixed(1)}%</b><br/>`;
          });
          html += `OEE 总计: <b>${(total ?? 0).toFixed(1)}%</b>`;
          return html;
        },
      },
      legend: {
        data: ['可用率', '性能率', '质量率'],
        top: 0,
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '3%',
        containLabel: true,
      },
      xAxis: {
        type: 'category' as const,
        data: lineNames,
        axisLabel: { fontSize: 12 },
      },
      yAxis: {
        type: 'value' as const,
        max: 100,
        axisLabel: { formatter: '{value}%' },
      },
      series: [
        {
          name: '可用率',
          type: 'bar',
          stack: 'oee',
          itemStyle: { color: '#1677ff' },
          data: oeeData.map((d) => +((d.availability ?? 0) * 100).toFixed(1)),
          barMaxWidth: 48,
        },
        {
          name: '性能率',
          type: 'bar',
          stack: 'oee',
          itemStyle: { color: '#52c41a' },
          data: oeeData.map((d) => +((d.performance ?? 0) * 100).toFixed(1)),
          barMaxWidth: 48,
        },
        {
          name: '质量率',
          type: 'bar',
          stack: 'oee',
          itemStyle: { color: '#faad14' },
          data: oeeData.map((d) => +((d.quality ?? 0) * 100).toFixed(1)),
          barMaxWidth: 48,
        },
      ],
    };
  }, [oeeData]);

  // ---- Production trend line chart ----

  const buildProductionChartOption = useCallback((): EChartsOption => {
    const dates = productionData.map((d) => d.date);
    return {
      tooltip: {
        trigger: 'axis',
      },
      legend: {
        data: ['计划产量', '实际产量', '合格率'],
        top: 0,
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '3%',
        containLabel: true,
      },
      xAxis: {
        type: 'category' as const,
        data: dates,
        boundaryGap: true,
        axisLabel: { fontSize: 12 },
      },
      yAxis: [
        {
          type: 'value' as const,
          name: '产量',
          position: 'left',
          axisLabel: { formatter: '{value}' },
        },
        {
          type: 'value' as const,
          name: '合格率',
          position: 'right',
          max: 100,
          axisLabel: { formatter: '{value}%' },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: '计划产量',
          type: 'line',
          data: productionData.map((d) => d.planned),
          smooth: true,
          lineStyle: { width: 2, type: 'dashed' },
          itemStyle: { color: '#1677ff' },
          symbol: 'circle',
          symbolSize: 6,
        },
        {
          name: '实际产量',
          type: 'line',
          data: productionData.map((d) => d.actual),
          smooth: true,
          lineStyle: { width: 2 },
          itemStyle: { color: '#52c41a' },
          areaStyle: {
            color: {
              type: 'linear' as const,
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(82,196,26,0.25)' },
                { offset: 1, color: 'rgba(82,196,26,0.02)' },
              ],
            },
          },
          symbol: 'circle',
          symbolSize: 6,
        },
        {
          name: '合格率',
          type: 'line',
          yAxisIndex: 1,
          data: productionData.map((d) => +((d.yield_rate ?? 0) * 100).toFixed(1)),
          smooth: true,
          lineStyle: { width: 2 },
          itemStyle: { color: '#faad14' },
          symbol: 'diamond',
          symbolSize: 7,
        },
      ],
    };
  }, [productionData]);

  // ---- Alerts table columns ----

  const alertColumns = [
    {
      title: '级别',
      dataIndex: 'severity',
      key: 'severity',
      width: 80,
      render: (severity: string) => (
        <Tag color={severityColorMap[severity] ?? '#8c8c8c'}>
          {severityLabelMap[severity] ?? severity}
        </Tag>
      ),
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 100,
    },
    {
      title: '标题',
      dataIndex: 'title',
      key: 'title',
      ellipsis: true,
    },
    {
      title: '详情',
      dataIndex: 'message',
      key: 'message',
      ellipsis: true,
    },
    {
      title: '时间',
      dataIndex: 'timestamp',
      key: 'timestamp',
      width: 180,
      render: (ts: string) => new Date(ts).toLocaleString('zh-CN'),
    },
  ];

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="app-program-header">
          <div className="app-program-title-block">
            <span className="app-program-icon"><ToolOutlined /></span>
            <div>
              <Space size={8} align="center" wrap>
                <Typography.Title level={3}>生产总览</Typography.Title>
                <Tag color="blue">分析看板</Tag>
              </Space>
              <Typography.Text type="secondary">设备、工单、OEE、产线趋势和告警数据的生产态势总览。</Typography.Text>
            </div>
          </div>
          <Space wrap>
            <Button icon={<ReloadOutlined />} loading>刷新</Button>
            <Button icon={<SettingOutlined />} onClick={openSettings}>设置</Button>
          </Space>
        </div>
        <Row gutter={[16, 16]}>
          {[1,2,3,4,5,6].map(i => (
            <Col xs={24} sm={12} md={8} lg={4} key={i}>
              <Card size="small"><Skeleton active paragraph={false} /></Card>
            </Col>
          ))}
        </Row>
        <Row gutter={16}>
          <Col span={12}><Card size="small"><Skeleton active /></Card></Col>
          <Col span={12}><Card size="small"><Skeleton active /></Card></Col>
        </Row>
        <Card size="small"><Skeleton active /></Card>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="app-program-header">
        <div className="app-program-title-block">
          <span className="app-program-icon"><ToolOutlined /></span>
          <div>
            <Space size={8} align="center" wrap>
              <Typography.Title level={3}>生产总览</Typography.Title>
              <Tag color="blue">分析看板</Tag>
            </Space>
            <Typography.Text type="secondary">设备、工单、OEE、产线趋势和告警数据的生产态势总览。</Typography.Text>
          </div>
        </div>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={fetchAllData}>刷新</Button>
          <Button icon={<SettingOutlined />} onClick={openSettings}>设置</Button>
        </Space>
      </div>

      {/* ---- KPI Cards ---- */}
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} md={8} lg={4}>
          <Card size="small" hoverable>
            <Statistic
              title="设备总数"
              value={overview?.equipment.total ?? 0}
              prefix={<ToolOutlined />}
              valueStyle={{ color: '#1677ff' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8} lg={4}>
          <Card size="small" hoverable>
            <Statistic
              title="运行中"
              value={overview?.equipment.running ?? 0}
              prefix={<CheckCircleOutlined />}
              valueStyle={{ color: '#52c41a' }}
              suffix={
                overview ? (
                  <span style={{ fontSize: 14, color: '#8c8c8c' }}>
                    / {overview.equipment.total}
                  </span>
                ) : null
              }
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8} lg={4}>
          <Card size="small" hoverable>
            <Statistic
              title="平均健康评分"
              value={overview ? +((overview.avg_equipment_health ?? 0) * 100).toFixed(1) : 0}
              precision={1}
              prefix={<HeartOutlined />}
              valueStyle={{
                color:
                  overview && overview.avg_equipment_health >= 0.8
                    ? '#52c41a'
                    : overview && overview.avg_equipment_health >= 0.6
                    ? '#faad14'
                    : '#f5222d',
              }}
              suffix="%"
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8} lg={4}>
          <Card size="small" hoverable>
            <Statistic
              title="工单总数"
              value={overview?.work_orders.total ?? 0}
              prefix={<FileTextOutlined />}
              valueStyle={{ color: '#1677ff' }}
              suffix={
                overview ? (
                  <span style={{ fontSize: 14, color: '#8c8c8c' }}>
                    进行中 {overview.work_orders.in_progress}
                  </span>
                ) : null
              }
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8} lg={4}>
          <Card size="small" hoverable>
            <Statistic
              title="缺陷数"
              value={overview?.quality.defect_count ?? 0}
              prefix={<WarningOutlined />}
              valueStyle={{ color: '#f5222d' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8} lg={4}>
          <Card size="small" hoverable>
            <Statistic
              title="设备利用率"
              value={overview ? +((overview.equipment?.utilization_rate ?? 0) * 100).toFixed(1) : 0}
              precision={1}
              valueStyle={{ color: '#722ed1' }}
              suffix="%"
            />
          </Card>
        </Col>
      </Row>

      {/* ---- OEE Chart ---- */}
      <Card title="产线 OEE 总览" size="small">
        {oeeData.length > 0 ? (
          <ReactECharts
            option={buildOEEChartOption()}
            style={{ height: 320 }}
            notMerge
            lazyUpdate
          />
        ) : (
          <div style={{ textAlign: 'center', padding: 48, color: '#8c8c8c' }}>
            暂无 OEE 数据
          </div>
        )}
      </Card>

      {/* ---- Production Trend Chart ---- */}
      <Card title="近7日生产趋势" size="small">
        {productionData.length > 0 ? (
          <ReactECharts
            option={buildProductionChartOption()}
            style={{ height: 320 }}
            notMerge
            lazyUpdate
          />
        ) : (
          <div style={{ textAlign: 'center', padding: 48, color: '#8c8c8c' }}>
            暂无生产数据
          </div>
        )}
      </Card>

      {/* ---- Alerts Table ---- */}
      <Card
        title={
          <span>
            <WarningOutlined style={{ marginRight: 8, color: '#fa541c' }} />
            告警列表
          </span>
        }
        size="small"
      >
        <Table
          dataSource={alerts}
          columns={alertColumns}
          rowKey="id"
          size="small"
          pagination={{ pageSize: 8, showSizeChanger: false }}
          scroll={{ x: 700 }}
          rowClassName={(record) => {
            if (record.severity === 'critical') return 'alert-row-critical';
            return '';
          }}
        />
      </Card>
    </div>
  );
}
