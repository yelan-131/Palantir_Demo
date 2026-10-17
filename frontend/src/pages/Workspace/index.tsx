import { useEffect, useState } from 'react';
import {
  BellOutlined,
  ArrowRightOutlined,
  CheckCircleOutlined,
  FormOutlined,
  SendOutlined,
} from '@ant-design/icons';
import { Alert, Button, Empty, Skeleton, Tag, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { wfListBusinessItems } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import './style.css';

interface BusinessForm {
  id: number;
  code: string;
  name: string;
  route_path?: string;
  approval_configured?: boolean;
  can_create?: boolean;
}

export default function WorkspacePage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const [forms, setForms] = useState<BusinessForm[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [formError, setFormError] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadWorkbench = async () => {
    setLoading(true);

    try {
      const response = await wfListBusinessItems();
      const payload = response.data?.data || {};
      setForms(Array.isArray(payload.forms) ? payload.forms : []);
      setCounts(payload.view_counts || {});
      setFormError(false);
    } catch {
      setForms([]);
      setCounts({});
      setFormError(true);
    }

    setLoading(false);
  };

  useEffect(() => {
    loadWorkbench();
  }, [user?.id]);

  const pendingCount = counts.pending || 0;
  const runningCount = counts.initiated || 0;
  const doneCount = counts.processed || 0;

  const todoMetrics = [
    {
      label: '待审批',
      value: pendingCount,
      suffix: '个待处理',
      icon: <BellOutlined />,
      path: '/workflow?tab=pending',
    },
    {
      label: '我发起的',
      value: runningCount,
      suffix: '个申请',
      icon: <SendOutlined />,
      path: '/workflow?tab=initiated',
    },
    {
      label: '我已处理的',
      value: doneCount,
      suffix: '个已处理',
      icon: <CheckCircleOutlined />,
      path: '/workflow?tab=processed',
    },
  ];

  return (
    <div className="workspace-page personal-workspace-page simple-workbench-page">
      {loading ? (
        <Skeleton active />
      ) : (
        <>
          <section className="simple-workbench-panel todo-center-panel">
            <div className="simple-workbench-head">
              <div>
                <Typography.Title level={4}>待办中心</Typography.Title>
              </div>
              <Button type="link" onClick={loadWorkbench}>刷新</Button>
            </div>

            <div className="todo-center-content">
              <div className="todo-metric-row">
                {todoMetrics.map((item, index) => (
                  <button className={`todo-metric-item${index === 0 ? ' todo-metric-primary' : ''}`} key={item.label} onClick={() => navigate(item.path)}>
                    <span className="todo-metric-icon">{item.icon}</span>
                    <span>
                      <strong>{item.label}</strong>
                      <em>{item.value}</em>
                      <small>{item.suffix}</small>
                    </span>
                    <ArrowRightOutlined className="todo-metric-arrow" aria-hidden="true" />
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="simple-workbench-panel favorite-center-panel">
            <Typography.Title level={4}>业务表单</Typography.Title>
            <Typography.Paragraph type="secondary">选择表单发起申请，审批任务进入“流程与待办”。</Typography.Paragraph>
            {formError ? <Alert type="error" message="业务表单加载失败" action={<Button onClick={loadWorkbench}>重试</Button>} /> : forms.length ? <div className="business-form-directory">
              {forms.map((form) => <button className="business-form-directory-entry" key={form.id} onClick={() => navigate(form.route_path || '/program/' + encodeURIComponent(form.code))}>
                <span><FormOutlined /></span>
                <strong>{form.name}</strong>
                <Tag color={form.approval_configured ? 'blue' : 'default'}>{form.can_create === false ? '查看表单' : form.approval_configured ? '申请审批' : '普通填报'}</Tag>
              </button>)}
            </div> : <Empty description="暂无可访问的业务表单" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          </section>
        </>
      )}
    </div>
  );
}
