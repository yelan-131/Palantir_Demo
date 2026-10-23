import { useEffect, useState } from 'react';
import api, { wfListBusinessItems, type PlatformFormField } from '@/services/api';

export type View = 'pending' | 'initiated' | 'processed';
export type ReviewForm = { id: number; code: string; name: string; description: string; group: string; applicationId: number; fields: PlatformFormField[]; status: string; version: number; record_count: number; approval_configured: boolean; can_create: boolean; route_path: string };
export type ReviewApplication = { id: number; code: string; name: string; description: string; default_route: string; icon: string; status: string; is_pinned: boolean };
export type Item = {
  id: string; source: 'dynamic_record'; status: 'pending' | 'running' | 'done' | 'rejected' | 'draft'; views: View[]; can_approve: boolean;
  title: string; summary: string; application: ReviewApplication; applications: ReviewApplication[]; form: { id: number; name: string; code: string };
  record: { id: number; status: string }; workflow: { id: number; workflow_id: number; current_assignees: { id: number; name: string }[]; approvals: { id: number; node_id: string; approver_name: string; action: string | null; comment: string | null; acted_at?: string }[] };
  fields: { field_name: string; label: string; value: unknown; field_type: string; required: boolean }[];
  current_node: string; current_assignees: { id: number; name: string }[]; created_at: string; updated_at: string; route_path: string;
};
export type Dataset = { applications: ReviewApplication[]; forms: ReviewForm[]; items: Item[]; view_counts: Record<View, number> };
export const applications: ReviewApplication[] = [
  { id: 1, code: 'production', name: '生产态势', description: '计划填报、生产记录与产线协同', default_route: '/program/production-overview', icon: 'DashboardOutlined', status: 'published', is_pinned: true },
  { id: 2, code: 'quality', name: '质量管理', description: '异常登记、CAPA 与质量闭环', default_route: '/program/quality-overview', icon: 'SafetyCertificateOutlined', status: 'published', is_pinned: true },
  { id: 3, code: 'supply', name: '供应链管理', description: '物料主数据与供应商协作', default_route: '/program/supply-overview', icon: 'ShopOutlined', status: 'published', is_pinned: true },
  { id: 4, code: 'device', name: '设备维护', description: '设备点检、维修与维护记录', default_route: '/program/device-health', icon: 'ToolOutlined', status: 'published', is_pinned: true },
];
function field(id: number, formId: number, code: string, label: string, type = 'text', required = true, width = 'half', values?: string[]): PlatformFormField {
  return { id, form_id: formId, field_name: code, label, field_type: type === 'number' ? 'number' : type === 'select' ? 'enum' : type === 'textarea' ? 'text' : type === 'datetime' ? 'datetime' : 'string', control_type: type, required, visible_in_list: true, visible_in_form: true, searchable: true, sortable: true, archived: false, sort_order: id, enum_values: values ? { values } : null, ui_config: { width, placeholder: type === 'select' ? '请选择' : `请输入${label}`, settings: type === 'datetime' ? { dateMode: 'date' } : {} } };
}
const initialForms: ReviewForm[] = [
  { id: 1, code: 'material-application', name: '物料主数据申请', description: '申请物料编码，维护名称、规格与分类。', group: '采购', applicationId: 3, status: 'published', version: 3, record_count: 0, approval_configured: true, can_create: true, route_path: '/program/material-application', fields: [field(11,1,'material_name','物料名称'),field(12,1,'category','物料分类','select',true,'half',['原材料','标准件','半成品','成品','包装材料']),field(13,1,'specification','规格型号'),field(14,1,'unit','计量单位','select',true,'half',['件','套','千克','米']),field(15,1,'description','申请说明','textarea',false,'full')] },
  { id: 2, code: 'quality-event', name: '质量事件', description: '登记异常批次，记录问题与处置建议。', group: '质量', applicationId: 2, status: 'published', version: 2, record_count: 0, approval_configured: true, can_create: true, route_path: '/program/quality-event', fields: [field(21,2,'event_name','事件名称'),field(22,2,'batch','关联批次'),field(23,2,'severity','问题等级','select',true,'half',['一般','重要','严重']),field(24,2,'line','所属产线'),field(25,2,'description','问题描述','textarea',true,'full')] },
  { id: 3, code: 'capa', name: 'CAPA 跟踪', description: '围绕质量问题，推进纠正与预防措施。', group: '质量', applicationId: 2, status: 'published', version: 2, record_count: 0, approval_configured: true, can_create: true, route_path: '/program/capa', fields: [field(31,3,'problem','问题名称'),field(32,3,'owner','责任人'),field(33,3,'containment','临时措施','textarea',true,'full'),field(34,3,'action','纠正与预防措施','textarea',true,'full')] },
  { id: 4, code: 'equipment-inspection', name: '设备点检', description: '按计划登记点检结果与设备异常。', group: '生产', applicationId: 4, status: 'published', version: 1, record_count: 0, approval_configured: true, can_create: true, route_path: '/program/equipment-inspection', fields: [field(41,4,'equipment','设备名称'),field(42,4,'code','设备编号'),field(43,4,'result','点检结果','select',true,'half',['正常','异常待处理']),field(44,4,'inspector','点检人'),field(45,4,'note','备注','textarea',false,'full')] },
  { id: 5, code: 'production-plan-entry', name: '生产计划填报', description: '登记产线计划与计划产量。', group: '生产', applicationId: 1, status: 'published', version: 1, record_count: 0, approval_configured: false, can_create: true, route_path: '/program/production-plan-entry', fields: [field(51,5,'plan_name','计划名称'),field(52,5,'line','产线'),field(53,5,'quantity','计划产量','number'),field(54,5,'date','计划日期','datetime'),field(55,5,'note','备注','textarea',false,'full')] },
];
const seedRows = [
  [1, '精密轴承物料编码申请', '陈思远', 'pending', {material_name:'深沟球轴承',category:'标准件',specification:'6205-2RS / 内径 25mm',unit:'件',description:'用于装配产线的传动组件，需新增标准物料编码。'}],
  [2, 'SMT-03 焊接空洞异常处置', '林晓', 'pending', {event_name:'SMT-03 焊接空洞超标',batch:'SMT-20261021-03',severity:'重要',line:'SMT-03',description:'抽检发现 BGA 焊点空洞率超出控制限，批次已隔离。请审核复检与处置建议。'}],
  [3, 'BGA 焊接问题纠正措施审核', '周晴', 'pending', {problem:'BGA 焊接空洞率偏高',owner:'工艺工程组',containment:'隔离关联批次，并完成 X-Ray 复检。',action:'复核回流焊温区参数，更新过程控制计划并追踪三批验证结果。'}],
  [4, 'A3 贴片机周度点检记录', '赵明', 'pending', {equipment:'高速贴片机',code:'SMT-A3-006',result:'正常',inspector:'赵明',note:'传动、润滑及安全联锁检查正常。'}],
  [1, '包装材料新增申请', '我', 'running', {material_name:'防静电包装袋',category:'包装材料',specification:'200 × 300 mm',unit:'件',description:'补充标准包装材料档案。'}],
  [5, 'SMT 产线生产计划', '我', 'done', {plan_name:'SMT 第 43 周生产计划',line:'SMT-01',quantity:24000,date:'2026-10-23',note:'按排产计划执行。'}],
  [2, '来料表面涂层异常记录', '林晓', 'done', {event_name:'涂层厚度偏差',batch:'IN-20261020-08',severity:'一般',line:'装配二线',description:'已复检确认并完成供应商反馈。'}],
] as const;
function makeItem(form: ReviewForm, index: number, title: string, person: string, status: Item['status'], values: Record<string, unknown>): Item {
  const application=applications.find(a=>a.id===form.applicationId)!;const workflowId=1201+index;const id=701+index;
  const assignees=status==='done'?[]:[{id:person==='我'?22:1,name:person==='我'?'部门主管':'我'}];
  return {id:`dynamic_record:${form.id}:${id}`,source:'dynamic_record',status,views:person==='我'?['initiated']:status==='pending'?['pending']:['processed'],can_approve:status==='pending'&&person!=='我',title,summary:`${person}发起 · ${form.name}`,application,applications:[application],form:{id:form.id,name:form.name,code:form.code},record:{id,status},workflow:{id:workflowId,workflow_id:form.id,current_assignees:assignees,approvals:[{id:workflowId*10,node_id:'提交申请',approver_name:person,action:'submit',comment:null,acted_at:'2026-10-21T01:15:00Z'},{id:workflowId*10+1,node_id:'业务审核',approver_name:assignees[0]?.name||'部门主管',action:status==='done'?'approve':null,comment:status==='done'?'资料完整，审核通过':null,acted_at:status==='done'?'2026-10-21T02:00:00Z':undefined}]},fields:form.fields.map(f=>({field_name:f.field_name,label:f.label,value:values[f.field_name],field_type:f.field_type,required:f.required})),current_node:status==='done'?'已完成':'业务审核',current_assignees:assignees,created_at:`2026-10-21T0${Math.min(index+1,8)}:15:00Z`,updated_at:'2026-10-21T02:24:00Z',route_path:form.route_path};
}
const KEY='mf-code-ui-review-v3';
function seed(){return {forms:structuredClone(initialForms),items:seedRows.map(([formId,title,person,status,values],i)=>makeItem(initialForms.find(f=>f.id===formId)!,i,title,person,status,values))};}
let store: ReturnType<typeof seed> = seed();
try { const saved=JSON.parse(localStorage.getItem(KEY)||'null');if(saved?.forms?.length&&saved?.items?.length)store=saved; }catch{}
const CHANGE='mf-review-data-changed';
function persist(){try{localStorage.setItem(KEY,JSON.stringify(store));}catch{}window.dispatchEvent(new Event(CHANGE));}
export function getDataset():Dataset { const items=structuredClone(store.items);return {applications,forms:structuredClone(store.forms).map(f=>({...f,record_count:items.filter(i=>i.form.id===f.id).length})),items,view_counts:{pending:items.filter(i=>i.views.includes('pending')).length,initiated:items.filter(i=>i.views.includes('initiated')).length,processed:items.filter(i=>i.views.includes('processed')).length}}; }
/** Installed only by ui-review.html. Production entry and API implementation stay unchanged. */
export function installReviewAdapter(){api.defaults.adapter=async config=>{
  const url=config.url||'';
  let payload: unknown;
  if(config.method==='get'&&url==='/workflow/business-items')payload={data:getDataset()};
  else if(config.method==='post'&&/^\/workflow\/instances\/\d+\/act$/.test(url)){
    const id=Number(url.split('/')[3]);const item=store.items.find(i=>i.workflow.id===id);const body=typeof config.data==='string'?JSON.parse(config.data):config.data;
    if(!item?.can_approve)throw Error('该事项已处理，请刷新');
    if(body.action==='reject'&&!String(body.comment||'').trim())throw Error('请填写驳回理由');
    item.status=body.action==='approve'?'done':'rejected';item.views=item.views.filter(v=>v!=='pending');item.views.push('processed');item.can_approve=false;item.current_node=body.action==='approve'?'已完成':'已驳回';item.current_assignees=[];item.workflow.current_assignees=[];item.workflow.approvals[1]={...item.workflow.approvals[1],action:body.action,comment:body.comment||null,acted_at:new Date().toISOString()};item.updated_at=new Date().toISOString();item.record.status=item.status;persist();payload={data:{success:true}};
  }else throw Error(`本地设计预览没有实现此接口：${config.method} ${url}`);
  return {data:payload,status:200,statusText:'OK',headers:{},config};
};}
export function useReviewData(){const [data,setData]=useState(getDataset);useEffect(()=>{const load=()=>{wfListBusinessItems().then(r=>setData(r.data.data)).catch(()=>setData(getDataset()));};load();window.addEventListener(CHANGE,load);return()=>window.removeEventListener(CHANGE,load);},[]);return data;}
export function submitRecord(formId:number,values:Record<string,unknown>,draft=false){const form=store.forms.find(f=>f.id===formId)!;const title=String(values[form.fields[0]?.field_name]||form.name);const item=makeItem(form,store.items.length+100, title,'我',draft?'draft':form.approval_configured?'running':'done',values);item.created_at=new Date().toISOString();item.updated_at=item.created_at;item.current_node=draft?'草稿':form.approval_configured?'业务审核':'已完成';if(draft){item.workflow.approvals=[];item.current_assignees=[];item.workflow.current_assignees=[];}store.items.unshift(item);persist();return item;}
export function publishForm(id:number,fields:PlatformFormField[]){const f=store.forms.find(f=>f.id===id)!;f.fields=structuredClone(fields);f.version++;persist();}
export function resetReview(){store=seed();window.dispatchEvent(new Event('mf-review-reset'));try{localStorage.removeItem('mf-code-ui-review-draft');localStorage.removeItem('mf-code-ui-review-favorites');}catch{}persist();}
