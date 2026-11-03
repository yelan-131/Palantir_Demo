import React, {useState} from 'react';
import {Button, Checkbox, Empty, Modal, Space} from 'antd';
import {SettingOutlined} from '@ant-design/icons';

export default function RoleSettings({value, options, onChange}: {
  value: number[]; options: Array<{value:number;label:string}>; onChange:(value:number[])=>void;
}) {
  const [draft,setDraft] = useState<number[] | null>(null);
  return <>
    <Space size={4}>
      <span>{value.length ? `已选 ${value.length} 个角色` : '继承页面权限'}</span>
      <Button type="text" size="small" icon={<SettingOutlined />} aria-label="设置允许角色" onClick={()=>setDraft([...value])} />
    </Space>
    <Modal styles={{body:{maxHeight:'60vh',overflowY:'auto'}}} title="允许角色" open={draft!==null} onCancel={()=>setDraft(null)} onOk={()=>{onChange(draft||[]);setDraft(null);}} okText="确定" cancelText="取消" destroyOnClose>
      <p>留空继承页面访问范围。勾选后仅允许指定角色访问，同时受页面与数据来源权限约束。</p>
      {!options.length ? <Empty description="暂无可选角色" image={Empty.PRESENTED_IMAGE_SIMPLE} /> : options.map(option=><div key={option.value} style={{padding:'8px 0'}}><Checkbox checked={draft?.includes(option.value)} onChange={event=>setDraft(event.target.checked?[...(draft||[]),option.value]:(draft||[]).filter(id=>id!==option.value))}>{option.label}</Checkbox></div>)}
      {(draft||[]).filter(id=>!options.some(option=>option.value===id)).map(id=><div key={id}><Checkbox checked onChange={()=>setDraft((draft||[]).filter(value=>value!==id))}>失效角色（{id}）</Checkbox></div>)}
      <Button type="link" onClick={()=>setDraft([])}>恢复继承页面权限</Button>
    </Modal>
  </>;
}
