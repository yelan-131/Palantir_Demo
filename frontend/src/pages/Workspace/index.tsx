import { useEffect, useState } from 'react';
import {
  BellOutlined,
  CheckCircleOutlined,
  FileDoneOutlined,
  PlusOutlined,
  SafetyCertificateOutlined,
  SendOutlined,
} from '@ant-design/icons';
import { Button, Skeleton, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { listNotifications, wfListInstances } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';

interface WorkflowInstance {
  id: number | string;
  status: string;
  initiator_id?: number;
  approvals?: Array<{ action?: string | null; approver_id?: number }>;
}

interface NotificationItem {
  id: number | string;
  is_read?: boolean;
}

function pickData<T>(payload: unknown): T[] {
  const data = payload as { data?: unknown };
  return Array.isArray(data?.data) ? data.data as T[] : [];
}

export default function WorkspacePage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const [workflowInstances, setWorkflowInstances] = useState<WorkflowInstance[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadWorkbench = async () => {
    setLoading(true);

    const [workflowRes, notificationRes] = await Promise.allSettled([
      wfListInstances(),
      listNotifications({ user_id: user?.id, page_size: 6 }),
    ]);

    if (workflowRes.status === 'fulfilled') {
      setWorkflowInstances(pickData<WorkflowInstance>(workflowRes.value.data));
    } else {
      setWorkflowInstances([]);
    }

    if (notificationRes.status === 'fulfilled') {
      const payload = notificationRes.value.data as { source?: string };
      setNotifications(payload.source === 'fallback' ? [] : pickData<NotificationItem>(payload));
    } else {
      setNotifications([]);
    }

    setLoading(false);
  };

  useEffect(() => {
    loadWorkbench();
  }, [user?.id]);

  const userId = typeof user?.id === 'number' ? user.id : undefined;
  const activeStatuses = new Set(['pending', 'running', 'in_progress']);
  const doneStatuses = new Set(['approved', 'done']);
  const pendingCount = workflowInstances.filter((item) => {
    if (item.status !== 'pending') return false;
    if (user?.is_admin) return true;
    return item.approvals?.some((approval) => approval.approver_id === userId && !approval.action);
  }).length;
  const runningCount = workflowInstances.filter((item) => (
    item.initiator_id === userId && activeStatuses.has(item.status)
  )).length;
  const doneCount = workflowInstances.filter((item) => (
    doneStatuses.has(item.status)
    || item.approvals?.some((approval) => approval.approver_id === userId && Boolean(approval.action))
  )).length;
  const unreadCount = notifications.filter((item) => !item.is_read).length;

  const todoMetrics = [
    {
      label: '我的待办',
      value: pendingCount,
      suffix: '个待处理',
      icon: <BellOutlined />,
      path: '/workflow?tab=pending',
    },
    {
      label: '我的发起',
      value: runningCount,
      suffix: '个正在运行',
      icon: <SendOutlined />,
      path: '/workflow?tab=running',
    },
    {
      label: '我的已办',
      value: doneCount,
      suffix: '个已处理',
      icon: <CheckCircleOutlined />,
      path: '/workflow?tab=done',
    },
    {
      label: '我的待阅',
      value: unreadCount,
      suffix: '个待阅',
      icon: <FileDoneOutlined />,
      path: '/workflow',
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
                <Typography.Text type="secondary">汇总流程单据，统一处理</Typography.Text>
              </div>
              <Button type="link" onClick={loadWorkbench}>刷新</Button>
            </div>

            <div className="todo-center-content">
              <div className="todo-metric-row">
                {todoMetrics.map((item) => (
                  <button className="todo-metric-item" key={item.label} onClick={() => navigate(item.path)}>
                    <span className="todo-metric-icon">{item.icon}</span>
                    <span>
                      <strong>{item.label}</strong>
                      <em>{item.value}</em>
                      <small>{item.suffix}</small>
                    </span>
                  </button>
                ))}
              </div>
              <div className="todo-center-illustration" aria-hidden="true">
                <FileDoneOutlined />
              </div>
            </div>
          </section>

          <section className="simple-workbench-panel favorite-center-panel">
            <Typography.Title level={4}>我的收藏</Typography.Title>
            <div className="favorite-app-grid">
              <button className="favorite-app-entry" onClick={() => navigate('/workflow')}>
                <span><PlusOutlined /></span>
                <strong>进入应用</strong>
              </button>
              <button className="favorite-app-entry favorite-graph-entry" onClick={() => navigate('/program/quality-event')}>
                <span><SafetyCertificateOutlined /></span>
                <strong>质量异常闭环</strong>
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
