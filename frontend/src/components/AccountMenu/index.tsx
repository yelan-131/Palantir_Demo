import { useMemo } from 'react';
import {
  LogoutOutlined,
  SafetyCertificateOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { PERSONAL_SETTINGS_ENTRIES, visibleNavigationEntries } from '../../config/navigation';
import { Avatar, Dropdown, Space, Tag } from 'antd';
import type { MenuProps } from 'antd';

interface AccountMenuRole {
  name: string;
  label?: string;
}

export interface AccountMenuUser {
  username?: string;
  display_name?: string;
  email?: string;
  is_admin?: boolean;
  roles?: AccountMenuRole[];
}

interface AccountMenuProps {
  user: AccountMenuUser | null;
  onNavigate: (path: string) => void;
  onLogout: () => void;
  compact?: boolean;
  active?: boolean;
}

export default function AccountMenu({ user, onNavigate, onLogout, compact = false, active = false }: AccountMenuProps) {
  const roleLabel = user?.is_admin ? '系统管理员' : user?.roles?.[0]?.label || '业务用户';

  const menu = useMemo<MenuProps>(() => ({
    items: [
      {
        key: 'account-header',
        disabled: true,
        label: (
          <div className="user-menu-header">
            <Avatar size={40} icon={<UserOutlined />} style={{ backgroundColor: 'var(--shell-avatar-background, #697586)' }} />
            <div>
              <strong>{user?.display_name || user?.username || '用户'}</strong>
              <span>{user?.email || user?.username || ''}</span>
              <Tag color={user?.is_admin ? 'gold' : 'blue'}>{roleLabel}</Tag>
            </div>
          </div>
        ),
      },
      { type: 'divider' },
      {
        key: 'personal-settings',
        type: 'group' as const,
        label: '个人设置',
        children: PERSONAL_SETTINGS_ENTRIES.map(entry => ({
          key: entry.path, label: entry.label,
          onClick: () => onNavigate(entry.path),
        })),
      },
      {
        key: 'application-settings',
        type: 'group' as const,
        label: '应用配置',
        children: visibleNavigationEntries('studio', Boolean(user?.is_admin)).map(entry => ({
          key: entry.path, label: entry.label,
          onClick: () => onNavigate(entry.path),
        })),
      },
      ...(user?.is_admin ? [{ key: 'platform-settings', label: '平台管理', icon: <SafetyCertificateOutlined />, onClick: () => onNavigate('/admin') }] : []),
      { type: 'divider' as const },
      {
        key: 'logout',
        label: '退出登录',
        icon: <LogoutOutlined />,
        danger: true,
        onClick: onLogout,
      },
    ],
  }), [onLogout, onNavigate, roleLabel, user]);

  return (
    <Dropdown menu={menu} trigger={['click']} placement={compact ? 'topRight' : 'bottomRight'}>
      <button
        type="button"
        className={`${compact ? 'shell-account-button' : 'account-menu-button'}${active ? ' is-active' : ''}`}
        aria-pressed={active}
        aria-label="用户菜单与设置"
        style={{
          cursor: 'pointer',
          border: 0,
          background: 'transparent',
          padding: compact ? 8 : 0,
          borderRadius: 'var(--shell-radius, 10px)',
          color: 'var(--shell-text, #273640)',
        }}
      >
        <Space>
          <Avatar size={compact ? 30 : 'small'} icon={<UserOutlined />} style={{ backgroundColor: 'var(--shell-avatar-background, #697586)' }} />
          {!compact && <span style={{ fontSize: 13 }}>{user?.display_name || user?.username || '用户'}</span>}
        </Space>
      </button>
    </Dropdown>
  );
}
