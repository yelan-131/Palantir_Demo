import { useEffect, useState } from 'react';
import useAISettingsNotification from './useAISettingsNotification';
import api from '@/services/api';
import SettingsTabs from '@/components/SettingsTabs';
import type { ReactNode } from 'react';
import { ApiOutlined, CheckCircleOutlined, KeyOutlined, RobotOutlined, SafetyCertificateOutlined } from '@/components/Icon/ant';
import { Alert, Button, Form, Space, Switch } from 'antd';

export interface AISettingsSection { key: string; children: ReactNode }
export const AI_SETTINGS_SECTIONS = [
  { key: 'connection', title: '模型服务', icon: <ApiOutlined /> },
  { key: 'models', title: '模型用途', icon: <RobotOutlined /> },
  { key: 'agent-registry', title: '工具与技能', icon: <KeyOutlined /> },
  { key: 'safety', title: '执行与安全', icon: <SafetyCertificateOutlined /> },
];

interface Props {
  sections: AISettingsSection[];
  canManageGlobalSettings: boolean;
  registryLoaded: boolean;
  effectivePreview?: ReactNode;
  saveActions: ReactNode;
  active: string;
  onSelect: (key: string) => void;
  loaded: boolean;
  saving: boolean;
  testing: boolean;
  loadError: string;
  sdkVersion?: string;
  connectionResult: { ok: boolean; message: string } | null;
}

interface SaveActionsProps {
  loaded: boolean;
  dirty: boolean;
  saving: boolean;
  testing: boolean;
  loadError: string;
  onSave: () => void;
  onReset: () => void;
}

export function AISettingsSaveActions(props: SaveActionsProps) {
  return <div className="ai-settings-savebar">
    <div className="ai-settings-save-state" role="status">
      <span>{props.dirty ? <><span className="ai-state-dot warning" />有未保存的更改</> : <><CheckCircleOutlined />{props.loadError ? '配置读取失败' : props.loaded ? '与已保存配置一致' : '正在读取配置'}</>}</span>
      <small>测试使用当前草稿；保存后用于后续请求</small>
    </div>
    <Space size={8} wrap>
      <Button size="small" onClick={props.onReset} disabled={!props.loaded || !props.dirty || props.saving || props.testing}>恢复已保存</Button>
      <Button size="small" type="primary" loading={props.saving} disabled={!props.loaded || props.testing || !props.dirty} onClick={props.onSave}>保存更改</Button>
    </Space>
  </div>;
}

export default function AISettingsWorkspace(props: Props) {
  const { notify, contextHolder } = useAISettingsNotification();
  useEffect(() => {
    if (props.connectionResult) notify(props.connectionResult.ok ? 'success' : 'error', props.connectionResult.ok ? '测试通过' : '测试未通过', props.connectionResult.message);
  }, [props.connectionResult, notify]);
  useEffect(() => {
    if (props.loadError) notify('error', '配置读取失败', props.loadError);
  }, [props.loadError, notify]);
  const [checking, setChecking] = useState(false);
  const [update, setUpdate] = useState<{ currentVersion: string | null; runtimeVersion: string | null; latestVersion: string; updateAvailable: boolean; releaseUrl: string } | null>(null);
  const checkUpdate = async () => {
    setChecking(true);
    setUpdate(null);
    try {
      const response = await api.get('/ai/settings/harness-update');
      setUpdate(response.data);
    } catch { notify('error', 'DSH 更新检查失败', '请稍后重试，或检查服务器到 PyPI 的网络连接。'); }
    finally { setChecking(false); }
  };
  const sections = props.canManageGlobalSettings ? AI_SETTINGS_SECTIONS : AI_SETTINGS_SECTIONS.filter(section => section.key === 'agent-registry');
  return <div className="ai-settings-workspace ai-settings-tabs-workspace">
    {contextHolder}
    {!props.canManageGlobalSettings && <Alert
      type="info"
      showIcon
      message="当前账号可管理本租户的技能和工具。模型服务、AI 总开关和全局执行策略由平台管理员管理。"
    />}
    <SettingsTabs className="ai-primary-tabs" activeKey={props.active} onChange={props.onSelect} items={sections.map(item => ({
      key: item.key,
      label: <span>{item.icon}{item.title}</span>,
      disabled: props.saving || props.testing,
      forceRender: true,
      children: <>
        {item.key === 'connection' && <>
          <div className="ai-runtime-toolbar">
            <div className="ai-runtime-status">
              <strong>DeepSeek Harness</strong>
              <small>{props.sdkVersion ? `SDK ${props.sdkVersion}` : '运行依赖未就绪'}</small>
            </div>
            <div className="ai-runtime-actions">
              <Button size="small" loading={checking} onClick={checkUpdate}>检查 DSH 更新</Button>
              <label className="ai-settings-master-switch">
                <span>启用平台 AI</span>
                <Form.Item name="aiEnabled" valuePropName="checked" noStyle>
                  <Switch aria-label="启用平台 AI" disabled={!props.loaded || props.saving || props.testing} />
                </Form.Item>
              </label>
            </div>
          </div>
          {update && <Alert className="ai-runtime-update" showIcon closable onClose={() => setUpdate(null)}
            type={update.updateAvailable ? 'info' : 'success'}
            message={update.updateAvailable ? `发现 DSH 新版本 ${update.latestVersion}` : update.currentVersion ? '当前 DSH 已是最新可用版本' : 'DSH 尚未安装'}
            description={<span>SDK：{update.currentVersion || '未安装'} · Runtime：{update.runtimeVersion || '未安装'} · 最新可用：{update.latestVersion}。<a href={update.releaseUrl} target="_blank" rel="noreferrer">查看版本说明</a>（检查不会自动升级）</span>}
          />}
        </>}
        <fieldset disabled={item.key === 'agent-registry' ? !props.registryLoaded : !props.loaded || props.saving || props.testing} className="ai-settings-fieldset ai-tab-content">
          {props.sections.find(section => section.key === item.key)?.children}
        </fieldset>
      </>,
    }))} />
    {props.canManageGlobalSettings && props.active !== 'agent-registry' && props.effectivePreview}
    {props.canManageGlobalSettings && props.saveActions && <footer className="ai-settings-save-footer">{props.saveActions}</footer>}
  </div>;
}
