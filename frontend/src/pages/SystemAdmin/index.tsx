import { Tabs } from 'antd';
import AppMenuManagement from './AppMenuManagement';
import IdentityAccessManagement from './IdentityAccessManagement';
import ReferenceDataManagement from './ReferenceDataManagement';
import SemanticAssetCenter from './SemanticAssetCenter';

export default function SystemAdmin() {
  return (
    <Tabs
      className="system-admin-page"
      defaultActiveKey="app-menu"
      items={[
        { key: 'app-menu', label: '应用与菜单', children: <AppMenuManagement /> },
        { key: 'reference-data', label: '数据字典与基础档案', children: <ReferenceDataManagement /> },
        { key: 'semantic-assets', label: '数据资产与本体', children: <SemanticAssetCenter /> },
        { key: 'identity-access', label: '身份与权限', children: <IdentityAccessManagement /> },
      ]}
    />
  );
}

