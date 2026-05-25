import React from 'react';
import { SafetyCertificateOutlined, TeamOutlined, UserSwitchOutlined } from '@ant-design/icons';
import { Tabs } from 'antd';
import OrganizationManagement from './OrganizationManagement';
import RoleManagement from './RoleManagement';
import UserManagement from './UserManagement';

interface IdentityAccessManagementProps {
  defaultActiveKey?: string;
}

export default function IdentityAccessManagement({ defaultActiveKey = 'users' }: IdentityAccessManagementProps) {
  return (
    <div>
      <Tabs
        defaultActiveKey={defaultActiveKey}
        items={[
          { key: 'users', label: <span><TeamOutlined /> 用户管理</span>, children: <UserManagement /> },
          { key: 'roles', label: <span><SafetyCertificateOutlined /> 角色管理</span>, children: <RoleManagement /> },
          { key: 'orgs', label: <span><UserSwitchOutlined /> 组织管理</span>, children: <OrganizationManagement /> },
        ]}
      />
    </div>
  );
}
