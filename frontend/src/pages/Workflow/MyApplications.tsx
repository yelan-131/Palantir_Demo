import {
  AppstoreOutlined,
  ClockCircleOutlined,
  DashboardOutlined,
  PushpinOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  ShopOutlined,
  StarFilled,
  ToolOutlined,
} from '@ant-design/icons';
import { Button, Card, Col, Empty, Input, Row, Space, Spin, Tag, Typography, message } from 'antd';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listApplications } from '@/services/api';

type ApplicationEntry = {
  id: number;
  name: string;
  code: string;
  description?: string;
  icon?: string;
  default_route: string;
  status: string;
  is_pinned?: boolean;
};

const iconMap: Record<string, ReactNode> = {
  DashboardOutlined: <DashboardOutlined />,
  ToolOutlined: <ToolOutlined />,
  SafetyCertificateOutlined: <SafetyCertificateOutlined />,
  ShopOutlined: <ShopOutlined />,
  AppstoreOutlined: <AppstoreOutlined />,
};

const fallbackApplications: ApplicationEntry[] = [
  { id: 1, name: '生产态势', code: 'production-dashboard', description: '生产效率、OEE、产线告警和班次趋势。', icon: 'DashboardOutlined', default_route: '/program/production-overview', status: 'published', is_pinned: true },
  { id: 2, name: '预测性维护', code: 'maintenance-analysis', description: '设备健康总览、健康分析、故障预测和工单管理。', icon: 'ToolOutlined', default_route: '/program/device-health-dashboard', status: 'published', is_pinned: true },
  { id: 3, name: '质量分析', code: 'quality-control', description: '质量缺陷、检验批次、异常追溯和过程能力分析。', icon: 'SafetyCertificateOutlined', default_route: '/program/quality-overview', status: 'published' },
  { id: 4, name: '供应链风险', code: 'supply-risk', description: '供应商交付、库存水位、风险预警和替代方案。', icon: 'ShopOutlined', default_route: '/program/supply-overview', status: 'published' },
];

function renderIcon(name?: string) {
  return iconMap[name || ''] || <AppstoreOutlined />;
}

export default function MyApplications() {
  const navigate = useNavigate();
  const [applications, setApplications] = useState<ApplicationEntry[]>([]);
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    listApplications()
      .then((res) => {
        const data = res.data?.data || [];
        setApplications(data.length ? data : fallbackApplications);
      })
      .catch(() => {
        setApplications(fallbackApplications);
        message.warning('应用目录使用本地默认配置');
      })
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return applications;
    return applications.filter((app) => (
      app.name.toLowerCase().includes(q)
      || app.code.toLowerCase().includes(q)
      || (app.description || '').toLowerCase().includes(q)
    ));
  }, [applications, keyword]);

  const openApplication = (app: ApplicationEntry) => {
    localStorage.setItem('mf_current_app_id', String(app.id));
    navigate(app.default_route || '/');
  };

  return (
    <div className="application-switch-page">
      <Row gutter={[16, 16]}>
        <Col xs={24} md={8}>
          <Card className="application-summary-card">
            <span className="application-summary-icon"><AppstoreOutlined /></span>
            <div>
              <Typography.Text type="secondary">可访问应用</Typography.Text>
              <strong>{applications.length}</strong>
            </div>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card className="application-summary-card">
            <span className="application-summary-icon"><PushpinOutlined /></span>
            <div>
              <Typography.Text type="secondary">固定应用</Typography.Text>
              <strong>{applications.filter((app) => app.is_pinned).length}</strong>
            </div>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card className="application-summary-card">
            <span className="application-summary-icon"><ClockCircleOutlined /></span>
            <div>
              <Typography.Text type="secondary">切换方式</Typography.Text>
              <strong>顶部下拉</strong>
            </div>
          </Card>
        </Col>
      </Row>

      <Card
        className="application-directory-card"
        title="我的可访问应用"
        extra={(
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索应用名称或编码"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            style={{ width: 260 }}
          />
        )}
      >
        <Spin spinning={loading}>
          {filtered.length === 0 ? (
            <Empty description="暂无可访问应用" />
          ) : (
            <Row gutter={[14, 14]}>
              {filtered.map((app) => (
                <Col xs={24} lg={12} xl={6} key={app.id}>
                  <Card className="application-card" variant="borderless">
                    <div className="application-card-head">
                      <span className="application-icon">{renderIcon(app.icon)}</span>
                      <Space size={6}>
                        {app.is_pinned && <StarFilled className="application-star" />}
                        <Tag color={app.status === 'published' ? 'success' : 'warning'}>
                          {app.status === 'published' ? '已发布' : app.status}
                        </Tag>
                      </Space>
                    </div>
                    <Typography.Title level={5}>{app.name}</Typography.Title>
                    <Typography.Text type="secondary">{app.code}</Typography.Text>
                    <Typography.Paragraph className="application-description">
                      {app.description || '业务工作包'}
                    </Typography.Paragraph>
                    <div className="application-meta-block">
                      <span>默认首页</span>
                      <Tag>{app.default_route}</Tag>
                    </div>
                    <div className="application-card-footer">
                      <Typography.Text type="secondary">通过顶部应用下拉快速切换</Typography.Text>
                      <Button type="primary" onClick={() => openApplication(app)}>打开应用</Button>
                    </div>
                  </Card>
                </Col>
              ))}
            </Row>
          )}
        </Spin>
      </Card>
    </div>
  );
}
