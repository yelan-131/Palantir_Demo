import { Tabs, type TabsProps } from 'antd';
import './settings-tabs.css';

/** Shared settings navigation, based on the identity/access console. */
export default function SettingsTabs({ className, ...props }: TabsProps) {
  return <Tabs {...props} className={['settings-tabs', className].filter(Boolean).join(' ')} />;
}
