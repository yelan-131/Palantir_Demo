import React,{useCallback,useEffect,useState} from 'react';
import {Button,Modal,Space,Table,Tag,Typography,message} from 'antd';
import api from '@/services/api';

type Job={instance_id:number;instance_title:string;node_id:string;node_title:string;status:string;attempts:number;error?:string;result?:{form_id?:number;record_id?:number;http_status?:number};finished_at?:string};
const statuses:Record<string,{label:string;color:string}>={pending:{label:'等待执行',color:'blue'},succeeded:{label:'成功',color:'green'},failed:{label:'失败',color:'red'},cancelled:{label:'已取消',color:'default'}};
export default function DispatchLog({workflow,onClose}:{workflow?:{id:number;name:string};onClose:()=>void}){
 const [jobs,setJobs]=useState<Job[]>([]),[loading,setLoading]=useState(false),[retrying,setRetrying]=useState<string>();
 const reload=useCallback(async()=>{if(!workflow)return;setLoading(true);try{const response=await api.get(`/workflow/definitions/${workflow.id}/dispatches`);setJobs(response.data.items);}catch{message.error('下发记录加载失败');}finally{setLoading(false);}},[workflow?.id]);
 useEffect(()=>{setJobs([]);void reload();},[reload]);
 return <Modal title={`${workflow?.name??''} · 下发记录`} open={Boolean(workflow)} width={860} onCancel={onClose} footer={<Space><Button loading={loading} onClick={()=>void reload()}>刷新</Button><Button onClick={onClose}>关闭</Button></Space>}>
  <Typography.Paragraph type="secondary">显示最近 100 个流程实例的下发任务。站内下发生成草稿；重试外部接口时沿用同一幂等键。</Typography.Paragraph>
  <Table<Job> size="small" rowKey={job=>`${job.instance_id}:${job.node_id}`} dataSource={jobs} loading={loading} pagination={{pageSize:10}} columns={[
   {title:'流程实例',dataIndex:'instance_title',width:160},{title:'节点',dataIndex:'node_title',width:100},
   {title:'状态',dataIndex:'status',width:90,render:value=><Tag color={statuses[value]?.color}>{statuses[value]?.label??value}</Tag>},
   {title:'次数',dataIndex:'attempts',width:50},
   {title:'执行结果',render:(_,job)=>job.error??(job.result?.record_id?`表单 ${job.result.form_id} · 草稿 #${job.result.record_id}`:job.result?.http_status?`HTTP ${job.result.http_status}`:'—')},
   {title:'操作',width:80,render:(_,job)=>job.status==='failed'?<Button size="small" loading={retrying===`${job.instance_id}:${job.node_id}`} onClick={async()=>{setRetrying(`${job.instance_id}:${job.node_id}`);try{await api.post(`/workflow/instances/${job.instance_id}/dispatches/${encodeURIComponent(job.node_id)}/retry`);message.success('已加入重试队列');await reload();}catch{message.error('重试失败');}finally{setRetrying(undefined);}}}>重试</Button>:null},
  ]}/>
 </Modal>;
}
