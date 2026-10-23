import { useMemo } from 'react';
import { UserOutlined } from '@ant-design/icons';
import { Avatar, Dropdown, Space } from 'antd';
import type { MenuProps } from 'antd';
import { settingsNavigationGroups } from '../../config/navigation';

interface AccountMenuRole {
  name: string;
  label?: string;
}

export interface AccountMenuUser {
  username?: string;
  display_name?: string;
  email?: string;
  avatar_url?: string;
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
  const menu = useMemo<MenuProps>(() => ({
    items: [
      {
        key: 'account-header',
        disabled: true,
        label: (
          <div className="user-menu-header">
            <Avatar size={36} src={user?.avatar_url} icon={<UserOutlined />} />
            <div>
              <strong>{user?.display_name || user?.username || '用户'}</strong>
              <span>{user?.email || user?.username || ''}</span>
            </div>
          </div>
        ),
      },
      { type: 'divider' },
      ...settingsNavigationGroups(Boolean(user?.is_admin)).map(group => ({
        key: group.key,
        label: group.label,
        onClick: () => onNavigate(group.entries[0].path),
      })),
      { type: 'divider' as const },
      {
        key: 'logout',
        label: '退出登录',
        danger: true,
        onClick: onLogout,
      },
    ],
  }), [onLogout, onNavigate, user]);

  return (
    <Dropdown overlayClassName="shell-settings-popup" menu={menu} trigger={['click']} placement={compact ? 'topRight' : 'bottomRight'}>
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
