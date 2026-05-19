import {
  ApartmentOutlined,
  ApiOutlined,
  AppstoreAddOutlined,
  BarChartOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  DatabaseOutlined,
  EditOutlined,
  ExperimentOutlined,
  FileDoneOutlined,
  FileSearchOutlined,
  FormOutlined,
  LayoutOutlined,
  NodeIndexOutlined,
  PlayCircleOutlined,
  RocketOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { Button, Card, Col, Progress, Row, Space, Tag, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';

const commandActions = [
  { label: '新建分析应用', icon: <AppstoreAddOutlined />, path: '/model-driven', type: 'primary' as const },
  { label: '配置业务表单', icon: <FormOutlined />, path: '/model-driven' },
  { label: '配置数据模型', icon: <ApartmentOutlined />, path: '/ontology' },
  { label: '导入数据源', icon: <ApiOutlined />, path: '/data-sources' },
];

const workspaceStats = [
  { label: '可配置表单', value: '18', detail: '字段、布局、权限可配置', icon: <FormOutlined /> },
  { label: '草稿应用', value: '7', detail: '2 个待发布', icon: <FileSearchOutlined /> },
  { label: '数据资产', value: '46', detail: '18 个已映射', icon: <DatabaseOutlined /> },
  { label: '流程任务', value: '9', detail: '4 个待审批', icon: <CheckCircleOutlined /> },
];

const formConfigs = [
  {
    name: '设备点检表单',
    domain: '设备维护',
    fields: 24,
    layout: '两栏布局',
    workflow: '点检审批',
    status: '已发布',
    path: '/model-driven',
  },
  {
    name: '质量检验表单',
    domain: '质量分析',
    fields: 31,
    layout: '分组表单',
    workflow: '异常复核',
    status: '配置中',
    path: '/model-driven',
  },
  {
    name: '供应商评估表单',
    domain: '供应链',
    fields: 18,
    layout: '评分矩阵',
    workflow: '准入审批',
    status: '草稿',
    path: '/model-driven',
  },
  {
    name: '工单执行表单',
    domain: '生产态势',
    fields: 28,
    layout: '主从明细',
    workflow: '工单流转',
    status: '已发布',
    path: '/model-driven',
  },
];

const builderEntries = [
  {
    title: '表单设计器',
    subtitle: '配置字段、校验、分组、布局和显隐规则',
    icon: <FormOutlined />,
    path: '/model-driven',
    nodes: ['字段', '布局', '规则'],
  },
  {
    title: '数据模型',
    subtitle: '为每个表单绑定实体、字段和关系',
    icon: <NodeIndexOutlined />,
    path: '/ontology',
    nodes: ['Entity', 'Field', 'Relation'],
  },
  {
    title: '分析页面',
    subtitle: '把表单数据组合成指标、图表和报表',
    icon: <BarChartOutlined />,
    path: '/reports',
    nodes: ['KPI', 'Chart', 'Filter'],
  },
  {
    title: '流程与权限',
    subtitle: '为表单配置审批、角色、发布范围和审计',
    icon: <ThunderboltOutlined />,
    path: '/rules',
    nodes: ['Workflow', 'Role', 'Audit'],
  },
];

const platformSignals = [
  { label: '表单发布率', value: '72%', tone: 'good' },
  { label: '模型同步', value: '12 min ago', tone: 'good' },
  { label: '异常告警', value: '5', tone: 'warn' },
  { label: '待审批配置', value: '4', tone: 'info' },
];

export default function WorkspacePage() {
  const navigate = useNavigate();

  return (
    <div className="workspace-page">
      <section className="workspace-hero">
        <div>
          <Tag className="system-tag">Form-first Low-code Analytics</Tag>
          <Typography.Title level={1}>低代码分析工作台</Typography.Title>
          <Typography.Paragraph>
            每个业务表单都可以配置字段、布局、规则、数据绑定、权限和发布，再沉淀为分析应用。
          </Typography.Paragraph>
        </div>
        <Space wrap>
          {commandActions.map((action) => (
            <Button
              key={action.label}
              type={action.type ?? 'default'}
              icon={action.icon}
              onClick={() => navigate(action.path)}
            >
              {action.label}
            </Button>
          ))}
        </Space>
      </section>

      <Row gutter={[16, 16]}>
        {workspaceStats.map((stat) => (
          <Col xs={24} sm={12} lg={6} key={stat.label}>
            <Card className="metric-card" variant="borderless">
              <span className="metric-icon">{stat.icon}</span>
              <div>
                <span className="metric-label">{stat.label}</span>
                <strong>{stat.value}</strong>
                <small>{stat.detail}</small>
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[16, 16]} align="stretch">
        <Col xs={24} xl={16}>
          <Card
            className="workspace-section"
            title="表单级低代码配置"
            extra={<Button type="link" icon={<SettingOutlined />} onClick={() => navigate('/model-driven')}>进入表单配置器</Button>}
          >
            <div className="form-config-grid">
              {formConfigs.map((form) => (
                <button className="form-config-card" key={form.name} onClick={() => navigate(form.path)}>
                  <div className="form-config-head">
                    <span>
                      <strong>{form.name}</strong>
                      <small>{form.domain}</small>
                    </span>
                    <Tag color={form.status === '已发布' ? 'success' : form.status === '配置中' ? 'processing' : 'warning'}>
                      {form.status}
                    </Tag>
                  </div>
                  <div className="form-config-meta">
                    <em><EditOutlined /> {form.fields} 个字段</em>
                    <em><LayoutOutlined /> {form.layout}</em>
                    <em><FileDoneOutlined /> {form.workflow}</em>
                  </div>
                  <div className="form-config-actions">
                    <span>配置字段</span>
                    <span>配置布局</span>
                    <span>配置权限</span>
                  </div>
                </button>
              ))}
            </div>
          </Card>

          <Card
            className="workspace-section"
            title="配置能力地图"
            extra={<Button type="link" onClick={() => navigate('/model-driven')}>打开 App Builder</Button>}
          >
            <Row gutter={[12, 12]}>
              {builderEntries.map((entry) => (
                <Col xs={24} md={12} key={entry.title}>
                  <button className="builder-tile" onClick={() => navigate(entry.path)}>
                    <span className="builder-tile-icon">{entry.icon}</span>
                    <span>
                      <strong>{entry.title}</strong>
                      <small>{entry.subtitle}</small>
                    </span>
                    <div className="builder-flow">
                      {entry.nodes.map((node) => (
                        <em key={node}>{node}</em>
                      ))}
                    </div>
                  </button>
                </Col>
              ))}
            </Row>
          </Card>

          <Card className="workspace-section canvas-preview-card" title="表单驱动的分析应用预览">
            <div className="builder-preview">
              <aside>
                <span>表单组件</span>
                <em><DatabaseOutlined /> 字段表格</em>
                <em><BarChartOutlined /> 指标图表</em>
                <em><ExperimentOutlined /> 规则校验</em>
              </aside>
              <main>
                <div className="preview-toolbar">
                  <span>设备点检分析应用</span>
                  <Tag color="processing">Draft</Tag>
                </div>
                <div className="preview-grid">
                  <div className="preview-kpi">完成率<strong>92%</strong></div>
                  <div className="preview-kpi">异常项<strong>5</strong></div>
                  <div className="preview-chart" />
                  <div className="preview-table" />
                </div>
              </main>
              <aside>
                <span>配置项</span>
                <em>数据表: inspection_form</em>
                <em>联动: 工厂 / 产线 / 设备</em>
                <em>权限: 生产经理 / 维修员</em>
              </aside>
            </div>
          </Card>
        </Col>

        <Col xs={24} xl={8}>
          <Card className="workspace-section" title="Platform Signals">
            <div className="signal-list">
              {platformSignals.map((signal) => (
                <div className={`signal-item signal-${signal.tone}`} key={signal.label}>
                  <span>{signal.label}</span>
                  <strong>{signal.value}</strong>
                </div>
              ))}
            </div>
            <DividerLine />
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <div className="health-row">
                <span><SafetyCertificateOutlined /> 配置健康度</span>
                <strong>92</strong>
              </div>
              <Progress percent={92} showInfo={false} strokeColor="#2f5f73" />
              <div className="health-row">
                <span><ClockCircleOutlined /> 最近发布</span>
                <Tag color="success">设备点检表单</Tag>
              </div>
            </Space>
          </Card>

          <Card className="workspace-section launch-card" variant="borderless">
            <RocketOutlined />
            <Typography.Title level={4}>从一个业务表单开始</Typography.Title>
            <Typography.Paragraph>
              先配置字段和布局，再绑定数据模型、审批流和分析组件，最后发布成可用的分析应用。
            </Typography.Paragraph>
            <Button block type="primary" onClick={() => navigate('/model-driven')}>
              新建表单配置
            </Button>
          </Card>
        </Col>
      </Row>
    </div>
  );
}

function DividerLine() {
  return <div className="divider-line" />;
}
