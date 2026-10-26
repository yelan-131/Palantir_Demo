import { createUuid } from '@/utils/uuid';
import FieldProtection, {type FieldPolicy} from '@/components/FieldProtection';
import React, { useEffect, useState, useRef } from 'react';
import { Button, Checkbox, DatePicker, Input, InputNumber, Radio, Select, Space, Switch, Table, Tooltip, Upload, message } from 'antd';
import { DeleteOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { downloadFormFile, uploadFormFile, listPlatformDynamicRecords } from '@/services/api';
import { enumOptions, matchesOptionSearch, fileAccept, normalizeText, type ControlSettings } from '@/utils/formControls';
export interface WidgetProps extends FieldPolicy { value?: any; onChange?: (value: any) => void; type: string; settings?: ControlSettings; options?: unknown; disabled?: boolean; placeholder?: string; formId?: number|string; fieldName?: string; recordId?: number; preview?: boolean; label?: string; }
function FieldWidget({value,onChange,type,settings={},options,disabled,placeholder,formId,fieldName,recordId,preview,label}:WidgetProps) {
  const filesRef=useRef<any[]>([]); filesRef.current=Array.isArray(value)?value:[];
  const [relatedPage,setRelatedPage]=useState(1);const [relatedTotal,setRelatedTotal]=useState(0);
  useEffect(()=>setRelatedPage(1),[settings.sourceFormId]);
  const [related,setRelated]=useState<any[]>([]);const [loading,setLoading]=useState(false);
  useEffect(()=>{if(type!=='readonly-table'||!settings.sourceFormId)return;let cancelled=false;setLoading(true);setRelated([]);listPlatformDynamicRecords(settings.sourceFormId,{page:relatedPage,page_size:10}).then(response=>{const data=response.data?.data;const rows=Array.isArray(data)?data:data?.items||response.data?.items||[];if(!cancelled){setRelated(rows.map((row:any)=>row.data||row));setRelatedTotal(Number(response.data?.total??rows.length));}}).catch(()=>{if(!cancelled)message.error('关联表数据加载失败，请检查访问权限');}).finally(()=>{if(!cancelled)setLoading(false);});return()=>{cancelled=true;};},[type,settings.sourceFormId,relatedPage]);
  const props={disabled,placeholder,'aria-label':label};
  if(type==='number')return <InputNumber {...props} value={value} onChange={onChange} min={settings.min} max={settings.max} precision={settings.precision} suffix={settings.unit} style={{width:'100%'}} formatter={settings.thousandSeparator?(val=>String(val??'').replace(/\B(?=(\d{3})+(?!\d))/g,',')):undefined} parser={val=>Number(String(val||'').replace(/,/g,''))} />;
  if(type==='select') {
    const choices=enumOptions(options);const multiple=settings.selectionMode==='multiple'||settings.displayMode==='tags';
    if(settings.displayMode==='radio'&&!multiple)return <Radio.Group aria-label={label} disabled={disabled} value={value} options={choices} onChange={event=>onChange?.(event.target.value)} />;
    const selected = Array.isArray(value) ? value : [];
    const atLimit = multiple && settings.maxSelections !== undefined && selected.length >= settings.maxSelections;
    const limitedChoices = choices.map(option => ({ ...option, disabled: atLimit && !selected.includes(option.value) }));
    const changeSelection = (next: any) => {
      if (multiple && settings.maxSelections !== undefined && Array.isArray(next) && next.length > settings.maxSelections) { message.warning(`最多选择 ${settings.maxSelections} 项`); return; }
      onChange?.(next);
    };
    if(multiple&&settings.displayMode==='radio')return <Checkbox.Group aria-label={label} disabled={disabled} value={selected} options={limitedChoices} onChange={changeSelection} />;
    const maxTagCount = !multiple || settings.tagCollapse === 'none' ? undefined : settings.tagCollapse === 'responsive' ? 'responsive' as const : settings.tagCollapse === 'fixed' ? settings.maxVisibleTags ?? 3 : undefined;
    return <Select {...props} value={value} onChange={changeSelection} options={limitedChoices} mode={multiple?(settings.allowCreateOption?'tags':'multiple'):undefined} maxTagCount={maxTagCount} maxTagPlaceholder={omitted => <Tooltip title={omitted.map(item => item.label).join('、')}><span aria-label={`另有 ${omitted.length} 项`}>+{omitted.length} 项</span></Tooltip>} showSearch={settings.displayMode==='search'||Boolean(multiple&&settings.allowCreateOption)} filterOption={(input, option) => matchesOptionSearch(option?.label, input, settings.search?.match)} allowClear={settings.allowClear!==false} style={{width:'100%'}} />;
  }
  if(type==='datetime') {
    const disabledDate=settings.disablePast?(date:dayjs.Dayjs)=>date.isBefore(dayjs().startOf('day')):undefined;
    if(settings.dateMode==='range')return <DatePicker.RangePicker disabled={disabled} aria-label={label} value={Array.isArray(value)?value.map(item=>item?dayjs(item):null) as any:null} onChange={dates=>onChange?.(dates?.map(item=>item?.format('YYYY-MM-DD'))??null)} disabledDate={disabledDate} style={{width:'100%'}} />;
    return <DatePicker {...props} value={value?dayjs(value):null} showTime={settings.dateMode!=='date'} onChange={date=>onChange?.(date?.format(settings.dateMode==='date'?'YYYY-MM-DD':'YYYY-MM-DDTHH:mm:ss')??null)} disabledDate={disabledDate} style={{width:'100%'}} />;
  }
  if(type==='switch')return <Switch aria-label={label} disabled={disabled} checked={Boolean(value)} onChange={onChange} checkedChildren={settings.checkedText||'是'} unCheckedChildren={settings.uncheckedText||'否'} />;
  if(type==='upload') {
    const files=Array.isArray(value)?value:[];
    return <Upload disabled={disabled} accept={fileAccept(settings.fileTypes)} multiple maxCount={settings.maxFiles||5} fileList={files.map((file:any)=>({...file,uid:file.id,name:file.name,status:file.uploading?'uploading':'done'}))}
      beforeUpload={file=>{if(file.size>(settings.maxFileSize||20)*1024*1024){message.error(`单个文件不能超过 ${settings.maxFileSize||20} MB`);return Upload.LIST_IGNORE;}if(files.length>=(settings.maxFiles||5)){message.error('已达到附件数量上限');return Upload.LIST_IGNORE;}return true;}}
      customRequest={async request=>{try{if(preview){request.onError?.(new Error('预览不上传真实文件，请在运行页上传'));return;}if(!formId||!fieldName)throw Error('请先保存表单并绑定附件字段');const pending={id:`pending-${createUuid()}`,name:(request.file as File).name,uploading:true};if(filesRef.current.length>=(settings.maxFiles||5))throw Error('已达到附件数量上限');filesRef.current=[...filesRef.current,pending];onChange?.(filesRef.current);try{const result=await uploadFormFile(formId,fieldName,request.file as File,recordId);filesRef.current=filesRef.current.map(item=>item.id===pending.id?result.data.data:item);onChange?.(filesRef.current);request.onSuccess?.(result.data.data);}catch(error){filesRef.current=filesRef.current.filter(item=>item.id!==pending.id);onChange?.(filesRef.current);throw error;}}catch(error:any){message.error(error?.response?.data?.detail||error.message||'上传失败');request.onError?.(error);}}}
      onRemove={file=>{if((file as any).uploading)return false;filesRef.current=filesRef.current.filter((item:any)=>item.id!==(file as any).id);onChange?.(filesRef.current);return true;}}
      onDownload={async file=>{try{const response=await downloadFormFile(formId!,fieldName!,(file as any).id,recordId);const url=URL.createObjectURL(response.data);const anchor=document.createElement('a');anchor.href=url;anchor.download=file.name;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch{message.error('附件下载失败或无访问权限');}}}
      showUploadList={{showRemoveIcon:!disabled,showDownloadIcon:true,showPreviewIcon:false}}><Button disabled={disabled||preview} icon={<UploadOutlined/>}>{preview?'附件上传（运行页使用）':'上传附件'}</Button></Upload>;
  }
  if(type==='editable-table'||type==='readonly-table') {
    const rows=type==='readonly-table'&&settings.sourceFormId?related:Array.isArray(value)?value:[];
    const columns=settings.columns||[];const readonly=disabled||type==='readonly-table';
    const update=(index:number,key:string,val:any)=>onChange?.(rows.map((row:any,i:number)=>i===index?{...row,[key]:val}:row));
    return <Space direction="vertical" style={{width:'100%'}}><Table size="small" loading={loading} rowKey={row=>String(rows.indexOf(row))} pagination={type==='readonly-table'?(settings.sourceFormId?{current:relatedPage,pageSize:10,total:relatedTotal,onChange:setRelatedPage,showSizeChanger:false}:{pageSize:10}):false} scroll={{x:400}} dataSource={rows} locale={{emptyText:columns.length?'暂无明细':'请先配置明细列'}} columns={[
      ...columns.map(column=>({key:column.key,title:column.label+(column.required?' *':''),render:(_:any,row:any,index:number)=>readonly?String(row[column.key]??'—'):column.type==='number'?<InputNumber aria-label={column.label} value={row[column.key]} onChange={val=>update(index,column.key,val)} />:column.type==='boolean'?<Switch aria-label={column.label} checked={Boolean(row[column.key])} onChange={val=>update(index,column.key,val)}/>:<Input aria-label={column.label} value={row[column.key]} onChange={event=>update(index,column.key,event.target.value)}/>})),
      ...(!readonly&&settings.allowDelete!==false?[{key:'remove',width:44,render:(_:any,__:any,index:number)=><Button danger type="text" aria-label={`删除明细第 ${index+1} 行`} icon={<DeleteOutlined/>} onClick={()=>onChange?.(rows.filter((_:any,i:number)=>i!==index))}/>}]:[]),
    ]}/>{!readonly&&settings.allowAdd!==false&&<Button size="small" icon={<PlusOutlined/>} disabled={!columns.length||rows.length>=(settings.maxRows||200)} onClick={()=>onChange?.([...rows,{}])}>新增明细行</Button>}</Space>;
  }
  const inputProps={...props,value:value??'',onChange:(event:React.ChangeEvent<HTMLInputElement|HTMLTextAreaElement>)=>onChange?.(event.target.value),onBlur:()=>{if(typeof value==='string')onChange?.(normalizeText(value,settings));},minLength:settings.minLength,maxLength:settings.maxLength};
  if(type==='textarea')return <Input.TextArea {...inputProps} rows={settings.rows||3}/>;
  return <Input {...inputProps} readOnly={type==='readonly-text'} type={settings.textFormat==='email'?'email':settings.textFormat==='password'?'password':'text'}/>;
}

export default function FieldControl(props:WidgetProps){
  return <FieldProtection copyMode={props.copyMode} copyText={props.copyText}>{props.masked?<Input aria-label={props.label} value={String(props.value??'')} readOnly disabled placeholder="已脱敏，原值保留"/>:<FieldWidget {...props}/>}</FieldProtection>;
}
