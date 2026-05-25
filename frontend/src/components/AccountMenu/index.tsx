import { useMemo } from 'react';
import {
  AppstoreOutlined,
  AuditOutlined,
  DatabaseOutlined,
  LogoutOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  SkinOutlined,
  UserOutlined,
} from '@ant-design/icons';
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
}

export default function AccountMenu({ user, onNavigate, onLogout }: AccountMenuProps) {
  const roleLabel = user?.is_admin ? '系统管理员' : user?.roles?.[0]?.label || '业务用户';

  const menu = useMemo<MenuProps>(() => ({
    items: [
      {
        key: 'account-header',
        disabled: true,
        label: (
          <div className="user-menu-header">
            <Avatar size={40} icon={<UserOutlined />} style={{ backgroundColor: '#2f5f73' }} />
            <div>
              <strong>{user?.display_name || '系统管理员'}</strong>
              <span>{user?.email || user?.username || 'admin@manufoundry.local'}</span>
              <Tag color={user?.is_admin ? 'gold' : 'blue'}>{roleLabel}</Tag>
            </div>
          </div>
        ),
      },
      { type: 'divider' },
      {
        key: 'account-center',
        label: '账号中心',
        icon: <UserOutlined />,
        onClick: () => onNavigate('/account-center?section=account'),
      },
      {
        key: 'work-preferences',
        label: '工作偏好',
        icon: <SkinOutlined />,
        onClick: () => onNavigate('/account-center?section=preferences'),
      },
      ...(user?.is_admin
        ? [
            { type: 'divider' as const },
            {
              key: 'ai-platform',
              label: 'AI 与平台设置',
              icon: <RobotOutlined />,
              onClick: () => onNavigate('/account-center?section=ai'),
            },
            {
              key: 'app-menu',
              label: '应用与菜单',
              icon: <AppstoreOutlined />,
              onClick: () => onNavigate('/account-center?section=app-menu'),
            },
            {
              key: 'data-ontology',
              label: '数据资产与本体',
              icon: <DatabaseOutlined />,
              onClick: () => onNavigate('/account-center?section=data-ontology'),
            },
            {
              key: 'identity-access',
              label: '用户与权限',
              icon: <SafetyCertificateOutlined />,
              onClick: () => onNavigate('/account-center?section=identity-access'),
            },
            {
              key: 'audit',
              label: '审计与日志',
              icon: <AuditOutlined />,
              onClick: () => onNavigate('/account-center?section=audit'),
            },
          ]
        : []),
      { type: 'divider' },
      {
        key: 'templates',
        label: '模板市场',
        icon: <AppstoreOutlined />,
        onClick: () => onNavigate('/templates'),
      },
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
    <Dropdown menu={menu} trigger={['click']}>
      <Space style={{ cursor: 'pointer' }}>
        <Avatar size="small" icon={<UserOutlined />} style={{ backgroundColor: '#2f5f73' }} />
        <span style={{ fontSize: 13, color: '#273640' }}>{user?.display_name || '系统管理员'}</span>
      </Space>
    </Dropdown>
  );
}
