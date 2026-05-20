import { Tabs } from 'antd';
import AppMenuManagement from './AppMenuManagement';
import RoleManagement from './RoleManagement';
import SemanticAssetCenter from './SemanticAssetCenter';
import UserManagement from './UserManagement';

export default function SystemAdmin() {
  return (
    <Tabs
      className="system-admin-page"
      defaultActiveKey="app-menu"
      items={[
        { key: 'app-menu', label: '应用与菜单', children: <AppMenuManagement /> },
        { key: 'semantic-assets', label: '数据资产与本体', children: <SemanticAssetCenter /> },
        { key: 'users', label: '用户管理', children: <UserManagement /> },
        { key: 'roles', label: '角色权限', children: <RoleManagement /> },
      ]}
    />
  );
}

