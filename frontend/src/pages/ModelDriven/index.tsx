import { Tabs } from 'antd';
import AppBuilder from './AppBuilder';
import ModelDesigner from './ModelDesigner';
import PageGenerator from './PageGenerator';
import MenuManager from './MenuManager';

export default function ModelDriven() {
  return (
    <Tabs
      defaultActiveKey="builder"
      items={[
        { key: 'builder', label: 'App Builder', children: <AppBuilder /> },
        { key: 'models', label: '数据模型', children: <ModelDesigner /> },
        { key: 'pages', label: '页面生成', children: <PageGenerator /> },
        { key: 'menus', label: '菜单发布', children: <MenuManager /> },
      ]}
    />
  );
}
