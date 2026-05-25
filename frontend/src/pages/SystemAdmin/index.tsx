import { Tabs } from 'antd';
import AppMenuManagement from './AppMenuManagement';
import IdentityAccessManagement from './IdentityAccessManagement';
import SemanticAssetCenter from './SemanticAssetCenter';

export default function SystemAdmin() {
  return (
    <Tabs
      className="system-admin-page"
      defaultActiveKey="app-menu"
      items={[
        { key: 'app-menu', label: '应用与菜单', children: <AppMenuManagement /> },
        { key: 'semantic-assets', label: '数据资产与本体', children: <SemanticAssetCenter /> },
        { key: 'identity-access', label: '用户与权限', children: <IdentityAccessManagement /> },
      ]}
    />
  );
}

