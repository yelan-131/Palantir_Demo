import SettingsTabs from '@/components/SettingsTabs';
import { useState } from 'react';
import { Button, Form, Input, Modal, Select, Space, Typography, message } from 'antd';
import { PlusOutlined, SettingOutlined } from '@ant-design/icons';
import { getViewTabs, type ViewConfig, type ViewTabConfig } from '@/utils/viewConfig';

type Option = { value: number; label: string };
export default function ViewTabsEditor({ config, activeId, onSelect, onChange, roles, users, organizations }: {
  config: ViewConfig; activeId: string; onSelect: (id: string) => void;
  onChange: (config: ViewConfig) => void; roles: Option[]; users: Option[]; organizations: Option[];
}) {
  const tabs = getViewTabs(config);
  const active = tabs.find((tab) => tab.id === activeId) || tabs[0];
  const [editing, setEditing] = useState<ViewTabConfig | null>(null);
  const [creating, setCreating] = useState(false);
  const open = (create: boolean) => {
    setCreating(create);
    setEditing(create ? { ...structuredClone(active), id: crypto.randomUUID(), name: '',
      audience: { mode: 'restricted', roleIds: [], userIds: [], orgIds: [] } } : structuredClone(active));
  };
  const commit = () => {
    if (!editing) return;
    const name = editing.name.trim();
    if (!name) { message.warning('请输入 Tab 名称'); return; }
    if (tabs.some((tab) => tab.id !== editing.id && tab.name === name)) { message.warning('Tab 名称不能重复'); return; }
    if (editing.audience.mode === 'restricted' && !editing.audience.roleIds.length && !editing.audience.userIds.length && !editing.audience.orgIds.length) {
      message.warning('请至少绑定一个角色、用户或组织'); return;
    }
    const next = { ...editing, name };
    const updated = creating ? [...tabs, next] : tabs.map((tab) => tab.id === next.id ? next : tab);
    onChange({ filters: updated[0].filters, table: updated[0].table, tabs: updated });
    onSelect(next.id);
    setEditing(null);
  };
  const remove = () => Modal.confirm({
    title: `删除视图“${active.name}”？`, content: '仅删除此 Tab 的筛选和列表配置，业务数据保留。保存并发布后生效。',
    okText: '删除视图', cancelText: '取消', okButtonProps: { danger: true },
    onOk: () => {
      const updated = tabs.filter((tab) => tab.id !== active.id);
      onChange({ filters: updated[0].filters, table: updated[0].table, tabs: updated });
      onSelect(updated[0].id);
    },
  });
  return <section className="view-tabs-editor">
    <SettingsTabs activeKey={active.id} onChange={onSelect} items={tabs.map((tab) => ({ key: tab.id, label: tab.name }))}
      tabBarExtraContent={<Space>
        <Button icon={<SettingOutlined />} onClick={() => open(false)}>Tab 设置</Button>
        <Button icon={<PlusOutlined />} onClick={() => open(true)}>新建 Tab</Button>
      </Space>} />
    <div className="view-tabs-summary">
      <Typography.Text type="secondary">{active.audience.mode === 'everyone' ? '所有具有本表单访问权限的用户可见' : `指定范围可见：${active.audience.roleIds.length} 个角色、${active.audience.userIds.length} 位用户、${active.audience.orgIds.length} 个组织（满足任一项）`}。各 Tab 独立配置筛选与列表，保存草稿后发布生效。</Typography.Text>
      <Button danger type="text" size="small" disabled={tabs.length <= 1} onClick={remove}>删除当前 Tab</Button>
    </div>
    <Modal title={creating ? '新建数据视图 Tab' : 'Tab 设置'} open={Boolean(editing)} onCancel={() => setEditing(null)} onOk={commit} okText="确认" cancelText="取消" destroyOnClose>
      {editing && <Form layout="vertical">
        <Form.Item label="Tab 名称" required><Input aria-label="Tab 名称" maxLength={40} value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></Form.Item>
        <Form.Item label="可见范围"><Select aria-label="Tab 可见范围" value={editing.audience.mode} options={[{ value: 'everyone', label: '所有可访问本表单的用户' }, { value: 'restricted', label: '绑定角色 / 用户 / 组织' }]} onChange={(mode) => setEditing({ ...editing, audience: { ...editing.audience, mode } })} /></Form.Item>
        {editing.audience.mode === 'restricted' && <>
          {([{ key: 'roleIds', label: '绑定角色', options: roles }, { key: 'userIds', label: '绑定用户', options: users }, { key: 'orgIds', label: '绑定组织', options: organizations }] as const).map((item) => <Form.Item key={item.key} label={item.label}>
            <Select mode="multiple" showSearch optionFilterProp="label" aria-label={item.label} placeholder={`选择${item.label.slice(2)}`} value={editing.audience[item.key]} options={item.options} onChange={(values: number[]) => setEditing({ ...editing, audience: { ...editing.audience, [item.key]: values } })} />
          </Form.Item>)}
          <Typography.Text type="secondary">角色、用户、组织之间按“或”匹配。此设置控制视图展示，记录和字段仍遵守权限设计。</Typography.Text>
        </>}
        {creating && <p>初始筛选项和列表列复制自当前 Tab，创建后可独立修改。</p>}
      </Form>}
    </Modal>
  </section>;
}
