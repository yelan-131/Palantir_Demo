import React, {useState} from 'react';
import {Alert, Button, Checkbox, Empty, Input, Modal, Popconfirm, Space, message} from 'antd';
import {ImportOutlined} from '@ant-design/icons';
import api from '@/services/api';
import {mergePermissionAudience, type ToolbarGroup} from './businessComponents';
type Template = {id:string;name:string;groups:ToolbarGroup[]};
export default function PermissionTemplates({groups,disabled,onImport,scope='toolbar'}: {scope?:'toolbar'|'access'|'display'|'filter'|'filter-fields'|'audience';groups:ToolbarGroup[];disabled:boolean;onImport:(groups:ToolbarGroup[])=>void}) {
  const [open,setOpen]=useState(false),[loading,setLoading]=useState(false),[templates,setTemplates]=useState<Template[]>([]),[selected,setSelected]=useState<string[]>([]),[name,setName]=useState(''),[error,setError]=useState('');
  const refresh=async()=>{setLoading(true);setError('');try{setTemplates((await api.get('/pages/permission-templates',{params:{scope}})).data.data);}catch{setError('权限模板读取失败，请重试');}finally{setLoading(false);}};
  const imported=templates.filter(item=>selected.includes(item.id)).flatMap(item=>item.groups);
  const audience=scope==='audience';
  const subjects=mergePermissionAudience(groups[0]||{id:'',name:'',roleIds:[],actions:[]},imported);
  const overLimit=audience?Object.values(subjects).some(ids=>ids.length>100):groups.length+imported.length>20;

  return <><Button type="text" size="small" title={audience?'导入适用对象模板':'导入通用权限模板'} aria-label={audience?'导入适用对象模板':'导入通用权限模板'} icon={<ImportOutlined/>} disabled={disabled} onClick={event=>{event.preventDefault();event.stopPropagation();setOpen(true);setSelected([]);void refresh();}}/>
    <Modal title={audience?'适用对象模板':'通用权限模板'} open={open} onCancel={()=>setOpen(false)} okText="导入所选模板" cancelText="取消" confirmLoading={loading} okButtonProps={{disabled:!imported.length||overLimit||!!error}} onOk={()=>{onImport(imported.map(group=>({...structuredClone(group),id:crypto.randomUUID()})));setOpen(false);}}>
      <p>{audience?'仅将角色、用户和组织合并到当前权限组的适用对象，不改变筛选字段、显示列或按钮。历史权限模板也可提取适用对象使用。':'模板可在不同表单页面间复用。导入为独立副本，后续修改互不影响。'}</p>
      {error&&<Alert type="error" message={error} action={<Button onClick={()=>void refresh()}>重试</Button>}/>}
      <div style={{maxHeight:'40vh',overflowY:'auto'}}>{!loading&&!templates.length&&!error&&<Empty description="暂无通用权限模板，可将当前配置保存为模板" image={Empty.PRESENTED_IMAGE_SIMPLE}/>}{templates.map(item=><div key={item.id} style={{display:'flex',justifyContent:'space-between',padding:'10px 0'}}><Checkbox checked={selected.includes(item.id)} onChange={event=>setSelected(event.target.checked?[...selected,item.id]:selected.filter(id=>id!==item.id))}>{item.name}（{item.groups.length} 个权限组）</Checkbox><Popconfirm title="删除此通用模板？已导入的配置不受影响。" onConfirm={async()=>{try{await api.delete('/pages/permission-templates/'+item.id);setSelected(selected.filter(id=>id!==item.id));void refresh();}catch{message.error('删除失败');}}}><Button type="text" size="small">删除</Button></Popconfirm></div>)}</div>
      {overLimit&&<Alert type="warning" message={audience?'每种适用对象最多允许 100 项':'导入后最多允许 20 个权限组'}/>}
      <Space.Compact style={{width:'100%',marginTop:16}}><Input aria-label="通用权限模板名称" placeholder={audience?'将当前适用对象保存为模板':'将当前配置保存为通用模板'} maxLength={50} value={name} onChange={event=>setName(event.target.value)}/><Button disabled={!name.trim()||!groups.length||loading||!!error} onClick={async()=>{setLoading(true);try{await api.post('/pages/permission-templates',{name:name.trim(),groups,scope});setName('');message.success('已保存通用权限模板');void refresh();}catch{message.error('保存失败，请检查角色配置后重试');}finally{setLoading(false);}}}>保存模板</Button></Space.Compact>
    </Modal></>;
}
