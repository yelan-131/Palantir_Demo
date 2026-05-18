import { useMemo, useState } from 'react';
import type React from 'react';
import {
  BarChartOutlined,
  BellOutlined,
  DatabaseOutlined,
  FilterOutlined,
  LineChartOutlined,
  NumberOutlined,
  SettingOutlined,
  TableOutlined,
} from '@ant-design/icons';
import { Button, Card, Col, Empty, Form, Input, Row, Select, Space, Tag, Typography } from 'antd';

type ComponentType = 'kpi' | 'line-chart' | 'bar-chart' | 'table' | 'filter' | 'alert-list';

interface BuilderComponent {
  id: string;
  type: ComponentType;
  title: string;
  dataSource: string;
  metric: string;
  aggregation: 'sum' | 'avg' | 'count' | 'max' | 'min';
  width: '1/3' | '1/2' | '2/3' | 'full';
}

interface ComponentPaletteItem {
  type: ComponentType;
  title: string;
  description: string;
  icon: React.ReactNode;
}

const palette: ComponentPaletteItem[] = [
  { type: 'kpi', title: 'KPI 指标卡', description: '展示核心指标、趋势和目标', icon: <NumberOutlined /> },
  { type: 'line-chart', title: '趋势图', description: '按时间观察指标变化', icon: <LineChartOutlined /> },
  { type: 'bar-chart', title: '柱状图', description: '按分类比较指标表现', icon: <BarChartOutlined /> },
  { type: 'table', title: '明细表格', description: '展示可筛选的数据明细', icon: <TableOutlined /> },
  { type: 'filter', title: '筛选器', description: '配置日期、工厂、产线等筛选条件', icon: <FilterOutlined /> },
  { type: 'alert-list', title: '告警列表', description: '展示异常、规则和待处理事项', icon: <BellOutlined /> },
];

const initialComponents: BuilderComponent[] = [
  {
    id: 'kpi-oee',
    type: 'kpi',
    title: 'OEE 综合效率',
    dataSource: 'production_metrics',
    metric: 'oee',
    aggregation: 'avg',
    width: '1/3',
  },
  {
    id: 'line-output',
    type: 'line-chart',
    title: '产量趋势',
    dataSource: 'work_order_daily',
    metric: 'actual_output',
    aggregation: 'sum',
    width: '2/3',
  },
  {
    id: 'table-equipment',
    type: 'table',
    title: '设备健康明细',
    dataSource: 'equipment_health',
    metric: 'health_score',
    aggregation: 'avg',
    width: 'full',
  },
];

const widthSpan: Record<BuilderComponent['width'], number> = {
  '1/3': 8,
  '1/2': 12,
  '2/3': 16,
  full: 24,
};

const typeLabel: Record<ComponentType, string> = {
  kpi: 'KPI',
  'line-chart': 'Line',
  'bar-chart': 'Bar',
  table: 'Table',
  filter: 'Filter',
  'alert-list': 'Alerts',
};

const dataSources = [
  'production_metrics',
  'work_order_daily',
  'equipment_health',
  'quality_spc_points',
  'supply_risk_scores',
  'workflow_tasks',
];

export default function AppBuilder() {
  const [components, setComponents] = useState<BuilderComponent[]>(initialComponents);
  const [selectedId, setSelectedId] = useState(initialComponents[0]?.id ?? '');

  const selected = components.find((item) => item.id === selectedId) ?? null;

  const appSchema = useMemo(() => ({
    appId: 'manufacturing-analytics-workspace',
    name: '制造业分析应用',
    version: 'draft',
    layout: components.map((component, index) => ({
      ...component,
      order: index + 1,
      dataBinding: {
        source: component.dataSource,
        field: component.metric,
        aggregation: component.aggregation,
      },
    })),
    filters: ['factory', 'line', 'dateRange'],
    permissions: ['admin', 'production_manager', 'quality_inspector'],
  }), [components]);

  const addComponent = (item: ComponentPaletteItem) => {
    const next: BuilderComponent = {
      id: `${item.type}-${Date.now()}`,
      type: item.type,
      title: item.title,
      dataSource: dataSources[0],
      metric: item.type === 'filter' ? 'date_range' : 'value',
      aggregation: item.type === 'table' || item.type === 'filter' ? 'count' : 'avg',
      width: item.type === 'kpi' || item.type === 'filter' ? '1/3' : '1/2',
    };
    setComponents((prev) => [...prev, next]);
    setSelectedId(next.id);
  };

  const updateSelected = (patch: Partial<BuilderComponent>) => {
    if (!selected) return;
    setComponents((prev) => prev.map((item) => (item.id === selected.id ? { ...item, ...patch } : item)));
  };

  const removeSelected = () => {
    if (!selected) return;
    const next = components.filter((item) => item.id !== selected.id);
    setComponents(next);
    setSelectedId(next[0]?.id ?? '');
  };

  return (
    <div className="app-builder-page">
      <section className="builder-header">
        <div>
          <Tag className="system-tag">Schema-driven Builder</Tag>
          <Typography.Title level={3}>低代码分析应用配置器</Typography.Title>
          <Typography.Paragraph>
            用组件、数据绑定和属性面板配置分析应用，Python 后端只负责数据与分析执行。
          </Typography.Paragraph>
        </div>
        <Space>
          <Button>预览运行</Button>
          <Button type="primary">保存草稿</Button>
          <Button type="primary" ghost>发布</Button>
        </Space>
      </section>

      <div className="builder-shell">
        <aside className="builder-sidebar">
          <div className="builder-panel-title">
            <SettingOutlined />
            <span>组件库</span>
          </div>
          <div className="builder-palette">
            {palette.map((item) => (
              <button key={item.type} onClick={() => addComponent(item)}>
                <span>{item.icon}</span>
                <strong>{item.title}</strong>
                <small>{item.description}</small>
              </button>
            ))}
          </div>
        </aside>

        <main className="builder-canvas">
          <div className="canvas-topbar">
            <span>Manufacturing Analytics App</span>
            <Space size={6}>
              <Tag color="processing">Draft</Tag>
              <Tag>3 filters</Tag>
              <Tag>{components.length} components</Tag>
            </Space>
          </div>
          <Row gutter={[12, 12]}>
            {components.map((component) => (
              <Col span={widthSpan[component.width]} key={component.id}>
                <button
                  className={`canvas-widget ${selectedId === component.id ? 'selected' : ''}`}
                  onClick={() => setSelectedId(component.id)}
                >
                  <div className="widget-head">
                    <span>{component.title}</span>
                    <Tag>{typeLabel[component.type]}</Tag>
                  </div>
                  <RuntimePreview component={component} />
                  <div className="widget-binding">
                    <DatabaseOutlined />
                    {component.dataSource}.{component.metric}
                  </div>
                </button>
              </Col>
            ))}
          </Row>
          {components.length === 0 && <Empty description="从左侧添加分析组件" />}
        </main>

        <aside className="builder-properties">
          <div className="builder-panel-title">
            <SettingOutlined />
            <span>属性与数据绑定</span>
          </div>
          {selected ? (
            <Form layout="vertical" size="small">
              <Form.Item label="组件标题">
                <Input value={selected.title} onChange={(e) => updateSelected({ title: e.target.value })} />
              </Form.Item>
              <Form.Item label="组件类型">
                <Select
                  value={selected.type}
                  options={palette.map((item) => ({ label: item.title, value: item.type }))}
                  onChange={(type) => updateSelected({ type })}
                />
              </Form.Item>
              <Form.Item label="数据源">
                <Select
                  value={selected.dataSource}
                  options={dataSources.map((source) => ({ label: source, value: source }))}
                  onChange={(dataSource) => updateSelected({ dataSource })}
                />
              </Form.Item>
              <Form.Item label="指标字段">
                <Input value={selected.metric} onChange={(e) => updateSelected({ metric: e.target.value })} />
              </Form.Item>
              <Form.Item label="聚合方式">
                <Select
                  value={selected.aggregation}
                  options={['sum', 'avg', 'count', 'max', 'min'].map((value) => ({ label: value, value }))}
                  onChange={(aggregation) => updateSelected({ aggregation })}
                />
              </Form.Item>
              <Form.Item label="布局宽度">
                <Select
                  value={selected.width}
                  options={[
                    { label: '1/3', value: '1/3' },
                    { label: '1/2', value: '1/2' },
                    { label: '2/3', value: '2/3' },
                    { label: 'Full', value: 'full' },
                  ]}
                  onChange={(width) => updateSelected({ width })}
                />
              </Form.Item>
              <Button danger block onClick={removeSelected}>移除组件</Button>
            </Form>
          ) : (
            <Empty description="选择画布组件进行配置" />
          )}
        </aside>
      </div>

      <Card className="schema-card" title="配置 Schema / Runtime Contract">
        <pre>{JSON.stringify(appSchema, null, 2)}</pre>
      </Card>
    </div>
  );
}

function RuntimePreview({ component }: { component: BuilderComponent }) {
  if (component.type === 'kpi') {
    return <div className="runtime-kpi">86.4<span>%</span></div>;
  }
  if (component.type === 'table') {
    return (
      <div className="runtime-table">
        <i /><i /><i /><i />
      </div>
    );
  }
  if (component.type === 'filter') {
    return <div className="runtime-filter">Factory / Line / Date</div>;
  }
  if (component.type === 'alert-list') {
    return <div className="runtime-alerts"><b /> <b /> <b /></div>;
  }
  return <div className={`runtime-chart runtime-${component.type}`} />;
}
