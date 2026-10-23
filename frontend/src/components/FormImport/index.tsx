import {useState} from 'react';
import {Alert,Button,Modal,Select,Space,Table,Typography,message} from 'antd';
import {previewFormImport,executeFormImport} from '@/services/api';

type Preview={headers:string[];rows:unknown[][];row_count:number;mapping:Record<string,string>;schema_version:number;fields:Array<{name:string;label:string;type:string}>};
function detail(error:any):string{const value=error?.response?.data?.detail;if(typeof value==='string')return value;if(value?.message)return `${value.message}：${typeof value.detail==='string'?value.detail:JSON.stringify(value.detail)}`;return '请求失败，请重试同一批次；系统会防止重复写入。';}

export default function FormImport({formId,open,onClose,onImported}:{formId:number;open:boolean;onClose:()=>void;onImported:()=>void}){
  const [file,setFile]=useState<File|null>(null);
  const [preview,setPreview]=useState<Preview|null>(null);
  const [mapping,setMapping]=useState<Record<string,string>>({});
  const [requestKey,setRequestKey]=useState(()=>crypto.randomUUID());
  const [busy,setBusy]=useState(false);
  const [attempted,setAttempted]=useState(false);
  const [error,setError]=useState('');
  const close=()=>{if(busy)return;onClose();};
  const loadPreview=async()=>{if(!file)return;setBusy(true);setError('');try{const response=await previewFormImport(formId,file);const result=response.data.data as Preview;setPreview(result);setMapping(result.mapping);setRequestKey(crypto.randomUUID());setAttempted(false);}catch(reason){setError(detail(reason));}finally{setBusy(false);}};
  const commit=async()=>{if(!file||!preview)return;setBusy(true);setAttempted(true);setError('');try{const response=await executeFormImport(formId,file,mapping,requestKey,preview.schema_version);const result=response.data.data;message.success(`${result.replayed?'此前已成功导入，本次未重复写入':'已导入'} ${result.count} 条${result.draft?'申请草稿（未提交审批）':''}`);onImported();onClose();setPreview(null);setFile(null);setAttempted(false);}catch(reason:any){setError(detail(reason));if(reason?.response?.status&&reason.response.status<500){setAttempted(false);setRequestKey(crypto.randomUUID());}}finally{setBusy(false);}};
  return <Modal title="批量导入" open={open} onCancel={close} maskClosable={!busy} closable={!busy} width={920} footer={<Space><Button disabled={busy} onClick={close}>取消</Button><Button disabled={!file||attempted} loading={busy&&!attempted} onClick={loadPreview}>预览文件</Button><Button type="primary" disabled={!preview||!Object.values(mapping).some(Boolean)} loading={busy&&attempted} onClick={commit}>{attempted?'重试当前批次':'确认导入'}</Button></Space>}>
    <Space direction="vertical" style={{width:'100%'}} size={16}>
      <Alert type="info" showIcon message="CSV / Excel 整批导入" description="支持 UTF-8 CSV、.xlsx 的首个工作表，最大 5 MB、500 行。先预览并确认列映射；保存时统一执行当前已发布的字段、权限与唯一校验，一行失败整批回滚。审批表单导入为草稿，不自动提交。"/>
      <input aria-label="选择导入文件" type="file" accept=".csv,.xlsx" disabled={busy||attempted} onChange={event=>{setFile(event.target.files?.[0]||null);setPreview(null);setError('');setRequestKey(crypto.randomUUID());}}/>
      {error&&<Alert type="error" showIcon message={error}/>}
      {preview&&<>
        <Typography.Text>共 {preview.row_count} 行 · 已发布版本 v{preview.schema_version} · 下方预览前 {preview.rows.length} 行</Typography.Text>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(240px,1fr))',gap:12}}>{preview.headers.map((header,index)=><label key={index}><Typography.Text>{header}</Typography.Text><Select aria-label={`映射 ${header}`} style={{width:'100%'}} allowClear disabled={busy||attempted} placeholder="忽略此列" value={mapping[String(index)]||undefined} onChange={value=>setMapping(current=>({...current,[index]:value||''}))} options={preview.fields.map(field=>({value:field.name,label:`${field.label} (${field.name}) · ${field.type}`,disabled:Object.entries(mapping).some(([key,value])=>key!==String(index)&&value===field.name)}))}/></label>)}</div>
        <Table size="small" pagination={false} scroll={{x:'max-content',y:280}} rowKey="_index" dataSource={preview.rows.map((row,index)=>({_index:index,...Object.fromEntries(row.map((value,key)=>[String(key),value]))}))} columns={preview.headers.map((header,index)=>({title:header,dataIndex:String(index),width:160,render:(value:unknown)=>value==null?'—':typeof value==='object'?JSON.stringify(value):String(value)}))}/>
      </>}
    </Space>
  </Modal>;
}
