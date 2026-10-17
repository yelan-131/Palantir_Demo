import { useEffect } from 'react';
import useAISettingsNotification from './useAISettingsNotification';
import SettingsTabs from '@/components/SettingsTabs';
import type { ReactNode } from 'react';
import { ApiOutlined, CheckCircleOutlined, KeyOutlined, RobotOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { Button, Form, Space, Switch } from 'antd';

export interface AISettingsSection { key: string; children: ReactNode }
export const AI_SETTINGS_SECTIONS = [
  { key: 'connection', title: '模型服务', icon: <ApiOutlined /> },
  { key: 'models', title: '模型用途', icon: <RobotOutlined /> },
  { key: 'agent-registry', title: '工具与技能', icon: <KeyOutlined /> },
  { key: 'safety', title: '执行与安全', icon: <SafetyCertificateOutlined /> },
];

interface Props {
  sections: AISettingsSection[];
  active: string;
  onSelect: (key: string) => void;
  loaded: boolean;
  dirty: boolean;
  saving: boolean;
  testing: boolean;
  loadError: string;
  sdkVersion?: string;
  connectionResult: { ok: boolean; message: string } | null;
  onSave: () => void;
  onTest: () => void;
  onReset: () => void;
  onDismissTest: () => void;
}

export default function AISettingsWorkspace(props: Props) {
  const { notify, contextHolder } = useAISettingsNotification();
  useEffect(() => {
    if (props.connectionResult) notify(props.connectionResult.ok ? 'success' : 'error', props.connectionResult.ok ? '测试通过' : '测试未通过', props.connectionResult.message);
  }, [props.connectionResult, notify]);
  useEffect(() => {
    if (props.loadError) notify('error', '配置读取失败', props.loadError);
  }, [props.loadError, notify]);
  const active = AI_SETTINGS_SECTIONS.some(section => section.key === props.active) ? props.active : 'connection';
  return <div className="ai-settings-workspace ai-settings-tabs-workspace">

    {contextHolder}
    <SettingsTabs className="ai-primary-tabs" tabBarExtraContent={{ right: <div className="ai-settings-tab-actions"><span className="ai-runtime-status">DeepSeek Harness <small>{props.sdkVersion ? `SDK ${props.sdkVersion}` : '运行依赖未就绪'}</small></span><div className="ai-settings-master-switch"><span>启用平台 AI</span><Form.Item name="aiEnabled" valuePropName="checked" noStyle><Switch aria-label="启用平台 AI" disabled={!props.loaded || props.saving || props.testing} /></Form.Item></div></div> }} activeKey={active} onChange={props.onSelect} items={AI_SETTINGS_SECTIONS.map(item => ({key: item.key, label: <span>{item.icon}{item.title}</span>, disabled: props.saving || props.testing, forceRender: true, children: <fieldset disabled={!props.loaded || props.saving || props.testing} className="ai-settings-fieldset ai-tab-content">{props.sections.find(section => section.key === item.key)?.children}</fieldset>}))} />
    <footer className="ai-settings-savebar"><div className="ai-settings-save-state" role="status">{props.dirty ? <><span className="ai-state-dot warning" /><span>有未保存的更改</span></> : <><CheckCircleOutlined /><span>{props.loadError ? '配置读取失败' : props.loaded ? '与已保存配置一致' : '正在读取配置'}</span></>}<small>测试使用当前草稿；保存后用于后续请求</small></div><Space wrap><Button onClick={props.onReset} disabled={!props.loaded || !props.dirty || props.saving || props.testing}>恢复已保存</Button><Button type="primary" loading={props.saving} disabled={!props.loaded || props.testing || !props.dirty} onClick={props.onSave}>保存更改</Button></Space></footer>
  </div>;
}
