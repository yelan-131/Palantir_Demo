import {
  ApartmentOutlined,
  ApiOutlined,
  AppstoreAddOutlined,
  BarChartOutlined,
  BranchesOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  DatabaseOutlined,
  ExperimentOutlined,
  FileSearchOutlined,
  LayoutOutlined,
  NodeIndexOutlined,
  PlayCircleOutlined,
  RocketOutlined,
  SafetyCertificateOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { Button, Card, Col, Progress, Row, Space, Tag, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';

const commandActions = [
  { label: '创建分析应用', icon: <AppstoreAddOutlined />, path: '/model-driven', type: 'primary' as const },
  { label: '配置数据模型', icon: <ApartmentOutlined />, path: '/ontology' },
  { label: '导入数据源', icon: <ApiOutlined />, path: '/data-sources' },
  { label: '打开 Builder', icon: <LayoutOutlined />, path: '/reports' },
];

const workspaceStats = [
  { label: '最近应用', value: '12', detail: '3 个本周更新', icon: <PlayCircleOutlined /> },
  { label: '草稿配置', value: '7', detail: '2 个待发布', icon: <FileSearchOutlined /> },
  { label: '数据资产', value: '46', detail: '18 个已映射', icon: <DatabaseOutlined /> },
  { label: '流程任务', value: '9', detail: '4 个待审批', icon: <CheckCircleOutlined /> },
];

const builderEntries = [
  {
    title: 'App Builder',
    subtitle: '拖拽页面、表单和权限',
    icon: <LayoutOutlined />,
    path: '/model-driven',
    nodes: ['页面', '表单', '权限'],
  },
  {
    title: 'Data Modeler',
    subtitle: '配置实体、字段和关系',
    icon: <NodeIndexOutlined />,
    path: '/ontology',
    nodes: ['Entity', 'Field', 'Relation'],
  },
  {
    title: 'Report Designer',
    subtitle: '组合指标、图表和筛选',
    icon: <BarChartOutlined />,
    path: '/reports',
    nodes: ['KPI', 'Chart', 'Filter'],
  },
  {
    title: 'Rule Builder',
    subtitle: '定义异常规则和自动化',
    icon: <ThunderboltOutlined />,
    path: '/rules',
    nodes: ['Trigger', 'Condition', 'Action'],
  },
];

const recentApps = [
  { name: '设备健康分析', type: '维护', status: '已发布', path: '/maintenance' },
  { name: '质量 SPC 看板', type: '质量', status: '草稿', path: '/quality' },
  { name: '供应风险雷达', type: '供应链', status: '已发布', path: '/supply-chain' },
];

const platformSignals = [
  { label: '数据新鲜度', value: '96%', tone: 'good' },
  { label: '模型同步', value: '12 min ago', tone: 'good' },
  { label: '活跃告警', value: '5', tone: 'warn' },
  { label: '待审批', value: '4', tone: 'info' },
];

export default function WorkspacePage() {
  const navigate = useNavigate();

  return (
    <div className="workspace-page">
      <section className="workspace-hero">
        <div>
          <Tag className="system-tag">My Analytics Workspace</Tag>
          <Typography.Title level={1}>我的分析工作台</Typography.Title>
          <Typography.Paragraph>
            从数据源、模型、页面和规则开始，用低代码方式搭建制造业分析应用。
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
            <Card className="metric-card" bordered={false}>
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
            title="低代码配置入口"
            extra={<Button type="link" onClick={() => navigate('/model-driven')}>进入配置中心</Button>}
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

          <Card className="workspace-section canvas-preview-card" title="分析应用画布预览">
            <div className="builder-preview">
              <aside>
                <span>组件库</span>
                <em><DatabaseOutlined /> 数据表</em>
                <em><BarChartOutlined /> 趋势图</em>
                <em><ExperimentOutlined /> 规则</em>
              </aside>
              <main>
                <div className="preview-toolbar">
                  <span>OEE 分析应用</span>
                  <Tag color="processing">Draft</Tag>
                </div>
                <div className="preview-grid">
                  <div className="preview-kpi">OEE<strong>86.4%</strong></div>
                  <div className="preview-kpi">告警<strong>5</strong></div>
                  <div className="preview-chart" />
                  <div className="preview-table" />
                </div>
              </main>
              <aside>
                <span>属性</span>
                <em>数据集: equipment_health</em>
                <em>筛选: 工厂 / 产线</em>
                <em>权限: 生产经理</em>
              </aside>
            </div>
          </Card>
        </Col>

        <Col xs={24} xl={8}>
          <Card className="workspace-section" title="最近访问">
            <div className="recent-list">
              {recentApps.map((app) => (
                <button key={app.name} onClick={() => navigate(app.path)}>
                  <span>
                    <strong>{app.name}</strong>
                    <small>{app.type}</small>
                  </span>
                  <Tag color={app.status === '已发布' ? 'success' : 'warning'}>{app.status}</Tag>
                </button>
              ))}
            </div>
          </Card>

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
                <span><SafetyCertificateOutlined /> 平台健康度</span>
                <strong>92</strong>
              </div>
              <Progress percent={92} showInfo={false} strokeColor="#2f5f73" />
              <div className="health-row">
                <span><ClockCircleOutlined /> 数据同步 SLA</span>
                <Tag color="success">正常</Tag>
              </div>
            </Space>
          </Card>

          <Card className="workspace-section launch-card" bordered={false}>
            <RocketOutlined />
            <Typography.Title level={4}>发布一个新的分析应用</Typography.Title>
            <Typography.Paragraph>
              从数据模型开始，组合页面、指标、筛选器和规则，发布给不同角色使用。
            </Typography.Paragraph>
            <Button block type="primary" onClick={() => navigate('/model-driven')}>
              开始配置
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
