import { BellOutlined, ReloadOutlined } from '@ant-design/icons';
import { Alert, Badge, Button, Empty, Pagination, Popover, Space, Spin, Tag, Typography, message } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getUnreadCount, listNotifications, markAllNotificationsRead, markNotificationRead } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { formatServerDateTime } from '@/utils/dateTime';

export const APPROVAL_NOTIFICATIONS_CHANGED = 'approval-notifications-changed';
export function refreshApprovalNotifications() {
  window.dispatchEvent(new CustomEvent(APPROVAL_NOTIFICATIONS_CHANGED));
}

type Notice = {
  id: number; title: string; content?: string; is_read: boolean; created_at?: string;
  category?: string; actionable?: boolean; target_url?: string | null; workflow_status?: string | null;
};
const PAGE_SIZE = 20;
const categoryLabels: Record<string, string> = { todo: '待办提醒', result: '审批结果', other: '其他', approval: '待办提醒', approval_result: '审批结果', message: '其他' };

export default function NotificationCenter() {
  const user = useAuthStore(state => state.user);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Notice[]>([]);
  const [total, setTotal] = useState(0);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const load = useCallback(async () => {
    if (!user) return;
    const current = ++generation.current;
    setLoading(true);
    try {
      const [list, count] = await Promise.all([listNotifications({ page, page_size: PAGE_SIZE }), getUnreadCount(user.id)]);
      if (current !== generation.current) return;
      setItems(list.data.data || []);
      setTotal(list.data.total || 0);
      setUnread(count.data.unread_count ?? count.data.count ?? list.data.unread_count ?? 0);
      setError('');
    } catch {
      if (current === generation.current) setError('通知读取失败，请重试');
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [page, user?.id]);
  useEffect(() => {
    void load();
    const refresh = () => { void load(); };
    const interval = window.setInterval(refresh, 30000);
    window.addEventListener(APPROVAL_NOTIFICATIONS_CHANGED, refresh);
    window.addEventListener('focus', refresh);
    return () => {
      ++generation.current;
      window.clearInterval(interval);
      window.removeEventListener(APPROVAL_NOTIFICATIONS_CHANGED, refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [load]);

  const openNotice = async (notice: Notice) => {
    try {
      if (!notice.is_read) await markNotificationRead(notice.id);
      await load();
    } catch { message.error('标记已读失败，请重试'); return; }
    if (!notice.target_url) {
      if (['todo', 'result', 'approval', 'approval_result'].includes(notice.category || '')) message.info('该流程已不可查看或当前账号没有访问权限');
      return;
    }
    // Only same-app paths may be supplied by notifications.
    if (!notice.target_url.startsWith('/') || notice.target_url.startsWith('//')) return;
    setOpen(false);
    navigate(notice.target_url);
  };
  const markAll = async () => {
    if (!user) return;
    try { await markAllNotificationsRead(user.id); await load(); }
    catch { message.error('全部已读失败，请重试'); }
  };
  const content = <div style={{ width: 'min(380px, calc(100vw - 48px))' }}>
    <Space style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
      <Typography.Text strong>通知中心</Typography.Text>
      <Space size={4}><Button size="small" type="text" aria-label="刷新通知" icon={<ReloadOutlined />} onClick={() => void load()} /><Button size="small" disabled={!unread || loading} onClick={markAll}>全部已读</Button></Space>
    </Space>
    {error && <Alert type="error" showIcon message={error} action={<Button size="small" onClick={() => void load()}>重试</Button>} />}
    <Spin spinning={loading}>
      <div style={{ maxHeight: 'min(480px, 60vh)', overflowY: 'auto' }}>
        {!items.length && !error ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无通知" /> : items.map(notice => <button
          key={notice.id} onClick={() => void openNotice(notice)}
          style={{ display: 'block', textAlign: 'left', width: '100%', padding: '12px 8px', cursor: 'pointer', border: 0, borderBottom: '1px solid #f0f0f0', background: notice.is_read ? '#fff' : '#f3f8ff' }}
        >
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}><Tag color={['result', 'approval_result'].includes(notice.category || '') ? (notice.workflow_status === 'rejected' ? 'red' : 'green') : ['todo', 'approval'].includes(notice.category || '') ? 'blue' : undefined}>{categoryLabels[notice.category || ''] || '其他'}</Tag>{!notice.is_read && <Badge status="processing" text="未读" />}{['todo', 'approval'].includes(notice.category || '') && notice.actionable === false && <Typography.Text type="secondary">{['approved', 'rejected', 'cancelled', 'completed'].includes(notice.workflow_status || '') ? '流程已结束' : '当前无需处理'}</Typography.Text>}</div>
          <Typography.Text strong={!notice.is_read}>{notice.title}</Typography.Text>
          {notice.content && <div style={{ color: '#5d6972', fontSize: 12, marginTop: 4 }}>{notice.content}</div>}
          <div style={{ color: '#8a97a1', fontSize: 11, marginTop: 4 }}>{formatServerDateTime(notice.created_at)}</div>
        </button>)}
      </div>
    </Spin>
    {total > PAGE_SIZE && <Pagination style={{ marginTop: 12 }} size="small" current={page} total={total} pageSize={PAGE_SIZE} showSizeChanger={false} onChange={setPage} />}
  </div>;
  return <Popover content={content} title={null} trigger="click" placement="bottomRight" open={open} onOpenChange={next => { setOpen(next); if (next) void load(); }}>
    <Badge count={unread} size="small" overflowCount={999}><Button type="text" aria-label={`通知中心，${unread}条未读`} icon={<BellOutlined />} /></Badge>
  </Popover>;
}
