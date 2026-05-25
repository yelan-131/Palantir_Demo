import { useEffect, useMemo, useState } from 'react';
import {
  ApiOutlined,
  AppstoreOutlined,
  CheckCircleOutlined,
  ControlOutlined,
  DatabaseOutlined,
  FileDoneOutlined,
  FormOutlined,
  ReloadOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  ShopOutlined,
  StarOutlined,
  ToolOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { Button, Card, Col, Progress, Row, Space, Tag, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { listQualityEvents } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';

interface QualityEvent {
  id: string;
  title: string;
  severity: string;
  status: string;
  source: string;
  description: string;
  risk_score: number;
  affected: Record<string, number>;
  recommended_actions: string[];
}

const roleCards = {
  admin: [
    { title: '数据变更审批', desc: '物料、供应商、批次主数据变更待确认', icon: <DatabaseOutlined />, path: '/workflow?tab=pending', tone: 'blue' },
    { title: '质量异常待审', desc: '缺陷分级、影响范围和处置建议待复核', icon: <SafetyCertificateOutlined />, path: '/program/quality-event', tone: 'red' },
    { title: '批次放行审批', desc: '复检结果、冻结批次和让步放行待决策', icon: <CheckCircleOutlined />, path: '/workflow?tab=pending', tone: 'green' },
    { title: 'AI 建议复核', desc: 'AI 草稿、风险解释和动作建议进入人工确认', icon: <RobotOutlined />, path: '/program/quality-event', tone: 'purple' },
  ],
  quality: [
    { title: '质量异常闭环', desc: '查看事件、影响图谱、AI 建议和 CAPA', icon: <SafetyCertificateOutlined />, path: '/program/quality-event', tone: 'red' },
    { title: '缺陷分析', desc: '定位缺陷趋势和主要原因', icon: <WarningOutlined />, path: '/program/defect-analysis', tone: 'orange' },
    { title: '检验批次', desc: '处理抽检、复检和放行记录', icon: <CheckCircleOutlined />, path: '/program/inspection-batch', tone: 'green' },
    { title: '流程待办', desc: '审批 CAPA、复检、质量异常任务', icon: <FileDoneOutlined />, path: '/workflow?tab=pending', tone: 'blue' },
  ],
  production: [
    { title: '生产态势', desc: '查看产线、工单和交付风险', icon: <ControlOutlined />, path: '/dashboard', tone: 'blue' },
    { title: '受影响工单', desc: '从质量事件追踪到生产计划', icon: <AppstoreOutlined />, path: '/program/quality-event', tone: 'orange' },
    { title: '设备复核', desc: '处理异常相关设备与维修工单', icon: <ToolOutlined />, path: '/maintenance', tone: 'green' },
    { title: '供应风险', desc: '查看物料和供应商对排产的影响', icon: <ShopOutlined />, path: '/supply-chain', tone: 'red' },
  ],
  user: [
    { title: '料号申请', desc: '发起物料、替代料和采购申请', icon: <FormOutlined />, path: '/program/risk-review', tone: 'green' },
    { title: '我的待办', desc: '查看我发起和需要我处理的流程', icon: <FileDoneOutlined />, path: '/workflow', tone: 'blue' },
    { title: '常用表单', desc: '进入收藏的低代码业务表单', icon: <StarOutlined />, path: '/account-center?section=preferences', tone: 'purple' },
    { title: '风险通知', desc: '查看与我相关的质量和供应链提醒', icon: <WarningOutlined />, path: '/program/quality-event', tone: 'orange' },
  ],
};

const adminBlueprint = [
  { label: 'Foundry 底座', value: '数据源 / 本体 / 对象 / 关系', icon: <DatabaseOutlined /> },
  { label: 'AIP 辅助层', value: 'AI 草稿 / 解释 / 审计 / 工具权限', icon: <RobotOutlined /> },
  { label: 'Gotham 体验', value: '事件 / 图谱 / 计划 / 动作闭环', icon: <ApiOutlined /> },
];

const defaultEvents: QualityEvent[] = [
  {
    id: 'QE-20260521-001',
    title: '电控模块焊点虚焊异常',
    severity: 'critical',
    status: 'open',
    source: '制程检验 / AOI',
    description: '缺陷率达到 6.8%，超过 2.0% 管控线。',
    risk_score: 92,
    affected: { work_orders: 5, orders: 3, suppliers: 1 },
    recommended_actions: ['生成 CAPA', '冻结批次', '发起复检'],
  },
];

function getRoleKey(user: any): keyof typeof roleCards {
  if (user?.is_admin) return 'admin';
  const roleNames = new Set((user?.roles || []).map((role: any) => role.name));
  if (roleNames.has('quality_inspector')) return 'quality';
  if (roleNames.has('production_manager')) return 'production';
  return 'user';
}

function roleTitle(roleKey: keyof typeof roleCards) {
  const map = {
    admin: '数据审批工作台',
    quality: '质量经理工作台',
    production: '生产主管工作台',
    user: '我的业务工作台',
  };
  return map[roleKey];
}

export default function WorkspacePage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const [events, setEvents] = useState<QualityEvent[]>(defaultEvents);
  const roleKey = getRoleKey(user);
  const cards = roleCards[roleKey];

  const loadEvents = () => {
    listQualityEvents()
      .then((res) => setEvents(res.data?.data?.length ? res.data.data : defaultEvents))
      .catch(() => setEvents(defaultEvents));
  };

  useEffect(() => {
    loadEvents();
  }, []);

  const headline = useMemo(() => {
    if (roleKey === 'admin') return '聚合主数据变更、质量异常和 AI 建议的审批处置';
    if (roleKey === 'quality') return '从异常发现到 CAPA 闭环';
    if (roleKey === 'production') return '看清质量异常对工单和交付的影响';
    return '处理与你相关的申请、待办和风险提醒';
  }, [roleKey]);

  return (
    <div className="workspace-page personal-workspace-page role-workspace-page">
      <section className="workspace-hero-row role-workspace-hero">
        <div>
          <Typography.Text className="role-workspace-kicker">ManuFoundry Role Workbench</Typography.Text>
          <Typography.Title level={3}>{roleTitle(roleKey)}</Typography.Title>
          <Typography.Text type="secondary">{headline}</Typography.Text>
        </div>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={loadEvents}>刷新事件</Button>
          <Button type="primary" icon={<SafetyCertificateOutlined />} onClick={() => navigate('/program/quality-event')}>
            进入质量异常闭环
          </Button>
        </Space>
      </section>

      <Row gutter={[14, 14]}>
        {cards.map((card) => (
          <Col xs={24} md={12} xl={6} key={card.title}>
            <button className={`role-entry-card role-entry-${card.tone}`} onClick={() => navigate(card.path)}>
              <span>{card.icon}</span>
              <strong>{card.title}</strong>
              <small>{card.desc}</small>
            </button>
          </Col>
        ))}
      </Row>

      <Row gutter={[16, 16]} align="stretch" style={{ marginTop: 16 }}>
        <Col xs={24} xl={roleKey === 'admin' ? 12 : 15}>
          <Card
            className="workspace-section"
            title={roleKey === 'admin' ? '数据审批态势' : '质量异常事件'}
            extra={<Tag color="processing">{roleKey === 'admin' ? '数据治理闭环' : '事件驱动'}</Tag>}
          >
            {roleKey === 'admin' ? (
              <div className="palantir-blueprint-grid">
                {adminBlueprint.map((item) => (
                  <div className="palantir-blueprint-item" key={item.label}>
                    <span>{item.icon}</span>
                    <strong>{item.label}</strong>
                    <small>{item.value}</small>
                  </div>
                ))}
              </div>
            ) : (
              <div className="quality-event-list">
                {events.map((event) => (
                  <button className="quality-workspace-event" key={event.id} onClick={() => navigate('/program/quality-event')}>
                    <span>
                      <Tag color={event.severity === 'critical' ? 'red' : 'orange'}>{event.severity}</Tag>
                      <strong>{event.title}</strong>
                    </span>
                    <small>{event.id} / {event.source}</small>
                    <p>{event.description}</p>
                    <Progress percent={event.risk_score} size="small" strokeColor={event.risk_score > 85 ? '#c83f49' : '#d48806'} />
                  </button>
                ))}
              </div>
            )}
          </Card>
        </Col>

        <Col xs={24} xl={roleKey === 'admin' ? 12 : 9}>
          <Card className="workspace-section" title="闭环进度">
            <div className="closure-step-list">
              {[
                ['发现事件', '规则引擎触发质量异常'],
                ['分析影响', '图谱追踪到批次、供应商、工单、订单'],
                ['AI 草稿', 'AI 生成建议，不直接执行'],
                ['动作闭环', 'CAPA、复检、冻结、通知进入流程'],
              ].map(([title, desc], index) => (
                <div className="closure-step-row" key={title}>
                  <span>{index + 1}</span>
                  <div>
                    <strong>{title}</strong>
                    <small>{desc}</small>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
