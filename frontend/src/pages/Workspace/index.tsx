import {
  AppstoreOutlined,
  BarChartOutlined,
  ClockCircleOutlined,
  FileDoneOutlined,
  FormOutlined,
  ReloadOutlined,
  RocketOutlined,
  SafetyCertificateOutlined,
  StarOutlined,
} from '@ant-design/icons';
import { Button, Card, Col, Empty, Progress, Row, Space, Tag, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';

const approvalBuckets = [
  { key: 'pending', title: '待审批', count: 6, tone: 'warning', path: '/workflow?tab=pending', items: ['设备维修审批 - 产线 A03', '质量异常复核 - Q-20260520', '供应商准入审批 - 星河精密'] },
  { key: 'running', title: '审批中', count: 9, tone: 'processing', path: '/workflow?tab=running', items: ['物料采购申请 - MRO-1842', '设备点检补录 - EQ-331', '质量 CAPA 跟踪 - CAPA-072'] },
  { key: 'done', title: '已审批', count: 24, tone: 'success', path: '/workflow?tab=done', items: ['维修工单关闭 - WO-771', '供应风险复核 - SR-096', '质量异常结案 - QA-581'] },
  { key: 'draft', title: '草稿', count: 3, tone: 'default', path: '/workflow?tab=draft', items: ['设备巡检记录草稿', '供应商评分草稿', '质量复验申请草稿'] },
  { key: 'returned', title: '退回待修改', count: 2, tone: 'error', path: '/workflow?tab=returned', items: ['维修申请退回 - 缺少照片', '采购申请退回 - 预算口径待补充'] },
];

const favoriteForms = [
  { title: '设备维修申请', type: '业务交互类', app: '设备维护分析', recent: '今天 09:18', icon: <FormOutlined />, path: '/dynamic/device-repair-request' },
  { title: '质量异常看板', type: '分析展示类', app: '质量控制', recent: '昨天 16:40', icon: <BarChartOutlined />, path: '/quality?view=defects' },
  { title: '供应风险复核', type: '业务交互类', app: '供应链风险', recent: '周一 11:05', icon: <SafetyCertificateOutlined />, path: '/supply-chain?view=review' },
  { title: '生产日报', type: '报表', app: '生产驾驶舱', recent: '5 月 19 日', icon: <FileDoneOutlined />, path: '/reports' },
];

const watchedMetrics = [
  { label: '设备健康率', value: 92, suffix: '%', tone: '#2f5f73' },
  { label: '质量异常数', value: 7, suffix: ' 项', tone: '#c47f2c' },
  { label: '供应风险数', value: 5, suffix: ' 项', tone: '#b54747' },
  { label: '数据同步成功率', value: 98, suffix: '%', tone: '#3f7f5f' },
];

const recentActivities = [
  { title: '设备维修审批已进入主管复核', time: '10 分钟前', icon: <ClockCircleOutlined />, path: '/workflow?tab=running' },
  { title: '质量异常看板收藏入口已更新', time: '38 分钟前', icon: <StarOutlined />, path: '/quality?view=defects' },
  { title: 'AI 已生成供应风险摘要', time: '1 小时前', icon: <RocketOutlined />, path: '/ai-assistant' },
  { title: '采购申请被退回，等待补充预算口径', time: '2 小时前', icon: <ClockCircleOutlined />, path: '/workflow?tab=returned' },
  { title: '生产日报已完成生成', time: '昨天 17:30', icon: <FileDoneOutlined />, path: '/reports' },
];

export default function WorkspacePage() {
  const navigate = useNavigate();

  return (
    <div className="workspace-page personal-workspace-page">
      <section className="workspace-hero-row">
        <div>
          <Typography.Title level={3}>我的工作台</Typography.Title>
          <Typography.Text type="secondary">聚合当前用户相关的审批、收藏表单、关注指标和最近状态。</Typography.Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />}>刷新</Button>
          <Button type="primary" icon={<AppstoreOutlined />} onClick={() => navigate('/account-center?section=app-menu')}>管理应用入口</Button>
        </Space>
      </section>

      <Card className="workspace-section" title="待办与审批" extra={<Button type="link" onClick={() => navigate('/workflow')}>查看流程中心</Button>}>
        <div className="approval-bucket-grid">
          {approvalBuckets.map((bucket) => (
            <button className={'approval-bucket-card approval-' + bucket.key} key={bucket.key} onClick={() => navigate(bucket.path)}>
              <span className="approval-bucket-head">
                <strong>{bucket.title}</strong>
                <Tag color={bucket.tone}>{bucket.count}</Tag>
              </span>
              <span className="approval-bucket-list">
                {bucket.items.slice(0, 3).map((item) => <em key={item}>{item}</em>)}
              </span>
            </button>
          ))}
        </div>
      </Card>

      <Card className="workspace-section" title="收藏的表单" extra={<Tag icon={<StarOutlined />}>来自收藏</Tag>}>
        {favoriteForms.length ? (
          <div className="favorite-entry-grid">
            {favoriteForms.map((entry) => (
              <button className="favorite-entry-card" key={entry.title} onClick={() => navigate(entry.path)}>
                <span className="favorite-entry-icon">{entry.icon}</span>
                <span>
                  <strong>{entry.title}</strong>
                  <small>{entry.app}</small>
                </span>
                <Tag color={entry.type === '分析展示类' ? 'blue' : entry.type === '业务交互类' ? 'green' : 'purple'}>{entry.type}</Tag>
                <em>最近访问：{entry.recent}</em>
              </button>
            ))}
          </div>
        ) : <Empty description="暂无收藏表单，可在业务页面或应用装配中收藏常用表单" />}
      </Card>

      <Row gutter={[16, 16]} align="stretch">
        <Col xs={24} xl={16}>
          <Card className="workspace-section" title="测试关注的指标">
            <div className="watched-metric-grid">
              {watchedMetrics.map((metric) => (
                <div className="watched-metric-row" key={metric.label}>
                  <span>{metric.label}</span>
                  <strong>{metric.value}{metric.suffix}</strong>
                  <Progress percent={Math.min(metric.value, 100)} showInfo={false} strokeColor={metric.tone} />
                </div>
              ))}
            </div>
          </Card>
        </Col>

        <Col xs={24} xl={8}>
          <Card className="workspace-section recent-status-card" title="最近状态">
            <div className="recent-activity-list vertical">
              {recentActivities.map((activity) => (
                <button className="recent-activity-item" key={activity.title} onClick={() => navigate(activity.path)}>
                  <span>{activity.icon}</span>
                  <strong>{activity.title}</strong>
                  <em>{activity.time}</em>
                </button>
              ))}
            </div>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
