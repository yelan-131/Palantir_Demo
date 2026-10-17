import React, { useState, useEffect, useCallback } from 'react';
import {
  Card,
  Table,
  Tag,
  Space,
  Row,
  Col,
  Typography,
  Statistic,
  Tabs,
  message,
  Rate,
  Badge,
  Tooltip,
  Progress,
} from 'antd';
import {
  ShopOutlined,
  WarningOutlined,
  CheckCircleOutlined,
  CarOutlined,
  DollarOutlined,
  BarChartOutlined,
  StockOutlined,
  AlertOutlined,
} from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { CHART_SERIES_COLORS, TECH_WHITE_CHART_THEME_NAME } from '../../theme/charts';
import { TECH_WHITE_PALETTE } from '../../theme/techWhite';
import {
  listSuppliers,
  getInventoryOverview,
  listShipments,
  getRiskAssessment,
  getSupplyChainAnalytics,
} from '@/services/api';

const { Text } = Typography;

interface Supplier {
  id: number;
  name: string;
  category: string;
  rating: number;
  lead_time_days: number;
  on_time_rate: number;
  quality_score: number;
  status: string;
  contact: string;
}

interface InventoryItem {
  id: number;
  material_name: string;
  category: string;
  current_stock: number;
  min_stock: number;
  max_stock: number;
  unit: string;
  status: string;
  supplier: string;
}

interface Shipment {
  id: number;
  order_id: string;
  supplier: string;
  material: string;
  quantity: number;
  status: string;
  eta: string;
  shipped_at: string;
}

interface RiskItem {
  category: string;
  supplier: string;
  risk_level: string;
  risk_score: number;
  factors: string[];
  mitigation: string;
}

interface Analytics {
  inventory_turnover: { labels: string[]; values: number[] };
  delivery_performance: { labels: string[]; on_time: number[]; delayed: number[] };
  cost_trend: { labels: string[]; values: number[] };
  category_distribution: { labels: string[]; values: number[] };
}

const SHIPMENT_STATUS_COLORS: Record<string, string> = {
  pending: 'default',
  shipped: 'processing',
  in_transit: 'blue',
  delivered: 'success',
  delayed: 'warning',
  cancelled: 'error',
};

const SHIPMENT_STATUS_TEXT: Record<string, string> = {
  pending: '待发货',
  shipped: '已发货',
  in_transit: '运输中',
  delivered: '已送达',
  delayed: '已延迟',
  cancelled: '已取消',
};

const RISK_LEVEL_COLORS: Record<string, string> = {
  high: TECH_WHITE_PALETTE.danger,
  medium: TECH_WHITE_PALETTE.warning,
  low: TECH_WHITE_PALETTE.success,
};

export default function SupplyChainPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [risks, setRisks] = useState<RiskItem[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [suppliersRes, inventoryRes, shipmentsRes, riskRes, analyticsRes] = await Promise.all([
        listSuppliers().catch(() => ({ data: [] })),
        getInventoryOverview().catch(() => ({ data: [] })),
        listShipments().catch(() => ({ data: [] })),
        getRiskAssessment().catch(() => ({ data: [] })),
        getSupplyChainAnalytics().catch(() => ({ data: null })),
      ]);
      setSuppliers(suppliersRes.data?.data ?? []);
      setInventory(inventoryRes.data?.items ?? []);
      setShipments(shipmentsRes.data?.data ?? []);
      setRisks(riskRes.data?.data ?? []);
      setAnalytics(analyticsRes.data ?? null);
    } catch {
      message.error('加载供应链数据失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const shortageCount = inventory.filter((item) => item.status === 'shortage' || item.current_stock < item.min_stock).length;
  const activeShipments = shipments.filter((s) => ['shipped', 'in_transit'].includes(s.status)).length;
  const highRisks = risks.filter((r) => r.risk_level === 'high').length;
  const avgRating = suppliers.length > 0 ? suppliers.reduce((sum, s) => sum + s.rating, 0) / suppliers.length : 0;

  // ECharts options
  const inventoryTurnoverOption = analytics?.inventory_turnover
    ? {
        tooltip: { trigger: 'axis' as const },
        xAxis: { type: 'category' as const, data: analytics.inventory_turnover.labels },
        yAxis: { type: 'value' as const, name: '周转率' },
        series: [
          {
            type: 'line' as const,
            data: analytics.inventory_turnover.values,
            smooth: true,
            areaStyle: { opacity: 0.15 },
            itemStyle: { color: TECH_WHITE_PALETTE.primary },
          },
        ],
        grid: { left: 50, right: 20, bottom: 30, top: 20 },
      }
    : null;

  const deliveryPerformanceOption = analytics?.delivery_performance
    ? {
        tooltip: { trigger: 'axis' as const },
        legend: { data: ['准时', '延迟'] },
        xAxis: { type: 'category' as const, data: analytics.delivery_performance.labels },
        yAxis: { type: 'value' as const, name: '数量' },
        series: [
          {
            name: '准时',
            type: 'bar' as const,
            stack: 'total',
            data: analytics.delivery_performance.on_time,
            itemStyle: { color: TECH_WHITE_PALETTE.success },
          },
          {
            name: '延迟',
            type: 'bar' as const,
            stack: 'total',
            data: analytics.delivery_performance.delayed,
            itemStyle: { color: TECH_WHITE_PALETTE.danger },
          },
        ],
        grid: { left: 50, right: 20, bottom: 30, top: 40 },
      }
    : null;

  const costTrendOption = analytics?.cost_trend
    ? {
        tooltip: { trigger: 'axis' as const, formatter: (params: unknown[]) => {
          const p = params as { name: string; value: number }[];
          return `${p[0]?.name}<br/>成本: ¥${p[0]?.value?.toLocaleString()}`;
        }},
        xAxis: { type: 'category' as const, data: analytics.cost_trend.labels },
        yAxis: { type: 'value' as const, name: '成本 (¥)' },
        series: [
          {
            type: 'line' as const,
            data: analytics.cost_trend.values,
            smooth: true,
            itemStyle: { color: CHART_SERIES_COLORS[1] },
            areaStyle: { opacity: 0.1 },
          },
        ],
        grid: { left: 60, right: 20, bottom: 30, top: 20 },
      }
    : null;

  const categoryDistOption = analytics?.category_distribution
    ? {
        color: CHART_SERIES_COLORS,
        tooltip: { trigger: 'item' as const },
        series: [
          {
            type: 'pie' as const,
            radius: ['40%', '70%'],
            data: analytics.category_distribution.labels.map((label, i) => ({
              name: label,
              value: analytics.category_distribution!.values[i],
            })),
            label: { show: true, formatter: '{b}: {d}%' },
          },
        ],
      }
    : null;

  const supplierColumns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 50 },
    { title: '供应商', dataIndex: 'name', key: 'name', width: 160 },
    {
      title: '类别',
      dataIndex: 'category',
      key: 'category',
      width: 100,
      render: (cat: string) => <Tag>{cat}</Tag>,
    },
    {
      title: '评分',
      dataIndex: 'rating',
      key: 'rating',
      width: 140,
      sorter: (a: Supplier, b: Supplier) => a.rating - b.rating,
      render: (rating: number) => (
        <Space>
          <Rate disabled defaultValue={rating / 2} allowHalf style={{ fontSize: 12 }} />
          <Text strong>{(rating ?? 0).toFixed(1)}</Text>
        </Space>
      ),
    },
    {
      title: '交货周期',
      dataIndex: 'lead_time_days',
      key: 'lead_time_days',
      width: 100,
      render: (days: number) => `${days} 天`,
    },
    {
      title: '准时率',
      dataIndex: 'on_time_rate',
      key: 'on_time_rate',
      width: 130,
      sorter: (a: Supplier, b: Supplier) => a.on_time_rate - b.on_time_rate,
      render: (rate: number) => {
        const pct = ((rate ?? 0) * 100).toFixed(1);
        const color = rate >= 0.9 ? TECH_WHITE_PALETTE.success : rate >= 0.7 ? TECH_WHITE_PALETTE.warning : TECH_WHITE_PALETTE.danger;
        return <Progress percent={parseFloat(pct)} size="small" strokeColor={color} />;
      },
    },
    {
      title: '质量分',
      dataIndex: 'quality_score',
      key: 'quality_score',
      width: 80,
      render: (score: number) => (
        <Text style={{ color: score >= 90 ? TECH_WHITE_PALETTE.success : score >= 70 ? TECH_WHITE_PALETTE.warning : TECH_WHITE_PALETTE.danger }}>
          {score}
        </Text>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 80,
      render: (status: string) => (
        <Tag color={status === 'active' ? 'success' : status === 'suspended' ? 'warning' : 'default'}>
          {status === 'active' ? '活跃' : status === 'suspended' ? '暂停' : status}
        </Tag>
      ),
    },
  ];

  const inventoryColumns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 50 },
    { title: '物料名称', dataIndex: 'material_name', key: 'material_name', width: 150 },
    {
      title: '类别',
      dataIndex: 'category',
      key: 'category',
      width: 90,
      render: (cat: string) => <Tag>{cat}</Tag>,
    },
    {
      title: '当前库存',
      dataIndex: 'current_stock',
      key: 'current_stock',
      width: 100,
      render: (val: number, record: InventoryItem) => {
        const isLow = val < record.min_stock;
        return (
          <Text strong style={{ color: isLow ? TECH_WHITE_PALETTE.danger : undefined }}>
            {val} {record.unit}
          </Text>
        );
      },
    },
    {
      title: '安全库存',
      dataIndex: 'min_stock',
      key: 'min_stock',
      width: 90,
      render: (val: number, record: InventoryItem) => `${val} ${record.unit}`,
    },
    {
      title: '最大库存',
      dataIndex: 'max_stock',
      key: 'max_stock',
      width: 90,
      render: (val: number, record: InventoryItem) => `${val} ${record.unit}`,
    },
    {
      title: '库存水位',
      key: 'level',
      width: 150,
      render: (_: unknown, record: InventoryItem) => {
        const pct = Math.min(100, Math.round((record.current_stock / record.max_stock) * 100));
        const color = record.current_stock < record.min_stock ? TECH_WHITE_PALETTE.danger : pct < 50 ? TECH_WHITE_PALETTE.warning : TECH_WHITE_PALETTE.success;
        return <Progress percent={pct} size="small" strokeColor={color} />;
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (status: string, record: InventoryItem) => {
        const isShortage = status === 'shortage' || record.current_stock < record.min_stock;
        return (
          <Tag color={isShortage ? 'error' : 'success'} icon={isShortage ? <WarningOutlined /> : <CheckCircleOutlined />}>
            {isShortage ? '库存不足' : '正常'}
          </Tag>
        );
      },
    },
    { title: '供应商', dataIndex: 'supplier', key: 'supplier', width: 120 },
  ];

  const shipmentColumns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 50 },
    { title: '订单号', dataIndex: 'order_id', key: 'order_id', width: 120 },
    { title: '供应商', dataIndex: 'supplier', key: 'supplier', width: 120 },
    { title: '物料', dataIndex: 'material', key: 'material', width: 120 },
    { title: '数量', dataIndex: 'quantity', key: 'quantity', width: 80 },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (status: string) => (
        <Tag color={SHIPMENT_STATUS_COLORS[status] ?? 'default'}>
          {SHIPMENT_STATUS_TEXT[status] ?? status}
        </Tag>
      ),
    },
    { title: '发货日期', dataIndex: 'shipped_at', key: 'shipped_at', width: 120 },
    { title: '预计到达', dataIndex: 'eta', key: 'eta', width: 120 },
  ];

  const riskColumns = [
    { title: '类别', dataIndex: 'category', key: 'category', width: 100, render: (v: string) => <Tag>{v}</Tag> },
    { title: '供应商', dataIndex: 'supplier', key: 'supplier', width: 120 },
    {
      title: '风险等级',
      dataIndex: 'risk_level',
      key: 'risk_level',
      width: 100,
      render: (level: string) => (
        <Tag color={RISK_LEVEL_COLORS[level] ?? 'default'}>
          {level === 'high' ? '高' : level === 'medium' ? '中' : '低'}
        </Tag>
      ),
    },
    {
      title: '风险分值',
      dataIndex: 'risk_score',
      key: 'risk_score',
      width: 100,
      sorter: (a: RiskItem, b: RiskItem) => a.risk_score - b.risk_score,
      render: (score: number) => (
        <Text strong style={{ color: score >= 70 ? TECH_WHITE_PALETTE.danger : score >= 40 ? TECH_WHITE_PALETTE.warning : TECH_WHITE_PALETTE.success }}>
          {score}
        </Text>
      ),
    },
    {
      title: '风险因素',
      dataIndex: 'factors',
      key: 'factors',
      render: (factors: string[]) => (
        <Space wrap size={4}>
          {factors.map((f) => (
            <Tag key={f} color="orange" style={{ fontSize: 11 }}>
              {f}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '缓解措施',
      dataIndex: 'mitigation',
      key: 'mitigation',
      ellipsis: true,
      render: (text: string) => <Tooltip title={text}><Text style={{ fontSize: 12 }}>{text}</Text></Tooltip>,
    },
  ];

  return (
    <div className="supply-chain-page">

      {/* Overview Stats */}
      <Row className="page-summary-metrics" gutter={[16, 16]} style={{ marginBottom: 16, marginInline: 0 }}>
        <Col xs={12} md={6}>
          <Card>
            <Statistic
              title="供应商总数"
              value={suppliers.length}
              prefix={<ShopOutlined />}
              suffix={
                <Text type="secondary" style={{ fontSize: 12 }}>
                  均分 {(avgRating ?? 0).toFixed(1)}
                </Text>
              }
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic
              title="库存短缺"
              value={shortageCount}
              valueStyle={{ color: shortageCount > 0 ? TECH_WHITE_PALETTE.danger : TECH_WHITE_PALETTE.success }}
              prefix={<WarningOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic
              title="在途物流"
              value={activeShipments}
              prefix={<CarOutlined />}
              valueStyle={{ color: TECH_WHITE_PALETTE.primary }}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic
              title="高风险项"
              value={highRisks}
              valueStyle={{ color: highRisks > 0 ? TECH_WHITE_PALETTE.danger : TECH_WHITE_PALETTE.success }}
              prefix={<AlertOutlined />}
            />
          </Card>
        </Col>
      </Row>

      <Tabs
        items={[
          {
            key: 'suppliers',
            label: (
              <span>
                <ShopOutlined /> 供应商
              </span>
            ),
            children: (
              <Card size="small">
                <Table
                  rowKey="id"
                  columns={supplierColumns}
                  dataSource={suppliers}
                  loading={loading}
                  pagination={{ pageSize: 10, showTotal: (total) => `共 ${total} 家` }}
                  scroll={{ x: 1000 }}
                />
              </Card>
            ),
          },
          {
            key: 'inventory',
            label: (
              <span>
                <StockOutlined /> 库存概览
              </span>
            ),
            children: (
              <Card size="small">
                {shortageCount > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <Badge count={shortageCount}>
                      <Tag color="error" icon={<WarningOutlined />} style={{ fontSize: 13, padding: '4px 12px' }}>
                        库存短缺预警
                      </Tag>
                    </Badge>
                  </div>
                )}
                <Table
                  rowKey="id"
                  columns={inventoryColumns}
                  dataSource={inventory}
                  loading={loading}
                  pagination={{ pageSize: 10, showTotal: (total) => `共 ${total} 项` }}
                  scroll={{ x: 1000 }}
                />
              </Card>
            ),
          },
          {
            key: 'shipments',
            label: (
              <span>
                <CarOutlined /> 物流跟踪
              </span>
            ),
            children: (
              <Card size="small">
                <Table
                  rowKey="id"
                  columns={shipmentColumns}
                  dataSource={shipments}
                  loading={loading}
                  pagination={{ pageSize: 10, showTotal: (total) => `共 ${total} 单` }}
                  scroll={{ x: 800 }}
                />
              </Card>
            ),
          },
          {
            key: 'risk',
            label: (
              <span>
                <AlertOutlined /> 风险评估
              </span>
            ),
            children: (
              <Card size="small">
                <Table
                  rowKey="supplier"
                  columns={riskColumns}
                  dataSource={risks}
                  loading={loading}
                  pagination={{ pageSize: 10, showTotal: (total) => `共 ${total} 项` }}
                  scroll={{ x: 800 }}
                />
              </Card>
            ),
          },
          {
            key: 'analytics',
            label: (
              <span>
                <BarChartOutlined /> 数据分析
              </span>
            ),
            children: (
              <Row gutter={16}>
                <Col span={12}>
                  <Card title="库存周转率趋势" size="small">
                    {inventoryTurnoverOption ? (
                      <ReactECharts theme={TECH_WHITE_CHART_THEME_NAME} option={inventoryTurnoverOption} style={{ height: 300 }} />
                    ) : (
                      <div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Text type="secondary">暂无数据</Text>
                      </div>
                    )}
                  </Card>
                </Col>
                <Col span={12}>
                  <Card title="交付表现" size="small">
                    {deliveryPerformanceOption ? (
                      <ReactECharts theme={TECH_WHITE_CHART_THEME_NAME} option={deliveryPerformanceOption} style={{ height: 300 }} />
                    ) : (
                      <div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Text type="secondary">暂无数据</Text>
                      </div>
                    )}
                  </Card>
                </Col>
                <Col span={12} style={{ marginTop: 16 }}>
                  <Card title="成本趋势" size="small">
                    {costTrendOption ? (
                      <ReactECharts theme={TECH_WHITE_CHART_THEME_NAME} option={costTrendOption} style={{ height: 300 }} />
                    ) : (
                      <div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Text type="secondary">暂无数据</Text>
                      </div>
                    )}
                  </Card>
                </Col>
                <Col span={12} style={{ marginTop: 16 }}>
                  <Card title="品类分布" size="small">
                    {categoryDistOption ? (
                      <ReactECharts theme={TECH_WHITE_CHART_THEME_NAME} option={categoryDistOption} style={{ height: 300 }} />
                    ) : (
                      <div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Text type="secondary">暂无数据</Text>
                      </div>
                    )}
                  </Card>
                </Col>
              </Row>
            ),
          },
        ]}
      />
    </div>
  );
}
