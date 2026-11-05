import { Tabs, type TabsProps } from 'antd';
import './inspector-tabs.css';

export default function InspectorTabs({ className, ...props }: TabsProps) {
  return <Tabs size="small" {...props} className={['inspector-tabs', className].filter(Boolean).join(' ')} />;
}
