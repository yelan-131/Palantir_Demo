import React, {useEffect, useRef, useState} from 'react';
import {Alert, Button, Checkbox, Collapse, ConfigProvider, Empty, Input, InputNumber, Modal, Select, Space, Spin, Switch, Table, Tabs, Tag} from 'antd';
import {DatabaseOutlined, DeleteOutlined, PlusOutlined, ReloadOutlined} from '@ant-design/icons';
import {Link} from 'react-router-dom';
import {PropertyAdvanced, PropertyGroup, PropertyRow} from '@/components/PropertyInspector';
import type {PlatformForm, PlatformFormField} from '@/services/api';
import type {AnalyticsDatasetCondition, RuntimeAnalyticsDataset, RuntimeAnalyticsDesign, RuntimeAnalyticsMetric, RuntimeAnalyticsData} from './analyticsTypes';
import {analyticsErrorMessage} from './analyticsEditorState';
import {previewAnalyticsDesign} from './analyticsApi';
import {formatAnalyticsValue} from './analyticsExploration';
import './analytics-dataset-dialog.css';

const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const numeric = (field: PlatformFormField) => /number|int|float|decimal|numeric|double|currency/.test(field.field_type);
const operators = [
  {value:'eq',label:'等于'}, {value:'ne',label:'不等于'}, {value:'contains',label:'包含文字'},
  {value:'gt',label:'大于'}, {value:'gte',label:'大于等于'}, {value:'lt',label:'小于'}, {value:'lte',label:'小于等于'},
  {value:'isEmpty',label:'为空'}, {value:'notEmpty',label:'不为空'},
];
interface Props {
  programId: string;
  dataset?: RuntimeAnalyticsDataset;
  design: RuntimeAnalyticsDesign;
  forms: PlatformForm[];
  formsLoading: boolean;
  disabled: boolean;
  loadFields: (source: string) => Promise<PlatformFormField[]>;
  onApply: (dataset: RuntimeAnalyticsDataset, metrics: RuntimeAnalyticsMetric[]) => void;
  onClose: () => void;
}

export default function AnalyticsDatasetDialog({programId, dataset: original, design, forms, formsLoading, disabled, loadFields, onApply, onClose}: Props) {
  const [dataset, setDataset] = useState<RuntimeAnalyticsDataset>(() => original ? structuredClone(original) : {
    id:id('dataset'), name:'新数据集', sourceType:'businessForm', source:'', refreshMode:'manual', dimensions:[], measures:[], rangeFilters:[],
  });
  const [metrics, setMetrics] = useState<RuntimeAnalyticsMetric[]>(() => structuredClone((design.metrics || []).filter(metric => metric.datasetId === original?.id)));
  const [tab, setTab] = useState('source');
  const [fields, setFields] = useState<PlatformFormField[]>([]);
  const [loading, setLoading] = useState(false);
  const [fieldsError, setFieldsError] = useState('');
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [result, setResult] = useState<{signature:string; data:RuntimeAnalyticsData; at:string}>();
  const alive = useRef(true);
  useEffect(() => {alive.current = true; return () => {alive.current = false;};}, []);
  const sourceCode = forms.find(form => form.code === dataset.source || String(form.id) === dataset.source)?.code || dataset.source;
  useEffect(() => {
    let cancelled = false;
    setFields([]); setFieldsError('');
    if (!sourceCode) {setLoading(false); return;}
    setLoading(true);
    loadFields(sourceCode).then(value => {if (!cancelled) setFields(value);})
      .catch(() => {if (!cancelled) setFieldsError('无法读取来源的已发布字段，请检查发布状态和权限后重试。');})
      .finally(() => {if (!cancelled) setLoading(false);});
    return () => {cancelled = true;};
  }, [sourceCode, loadFields, retry]);
  const patch = (value: Partial<RuntimeAnalyticsDataset>) => {setDataset(current => ({...current,...value})); setError('');};
  const signature = JSON.stringify({dataset,metrics});
  const fresh = result?.signature === signature;
  const declared = [...new Set([...(dataset.dimensions || []), ...(dataset.measures || [])])];
  const selectedFields = fields.filter(field => declared.includes(field.field_name));
  const conditions = dataset.rangeFilters || [];
  const lockedSource = metrics.some(metric => !!metric.sharedMetricId);
  const fieldOptions = selectedFields.map(field => ({value:field.field_name,label:field.label || field.field_name}));
  const label = (name:string) => fields.find(field => field.field_name === name)?.label || name;
  const updateMetric = (metricId:string, value:Partial<RuntimeAnalyticsMetric>) => setMetrics(current => current.map(metric => metric.id === metricId ? {...metric,...value} : metric));
  const updateCondition = (index:number, value:Partial<AnalyticsDatasetCondition>) => patch({rangeFilters:conditions.map((item,i) => i === index ? {...item,...value} : item)});
  const setRole = (field:string, role:'dimensions'|'measures', checked:boolean) => {
    const next = checked ? [...(dataset[role] || []),field] : (dataset[role] || []).filter(item => item !== field);
    const stillSelected = new Set([...next,...(dataset[role === 'dimensions' ? 'measures' : 'dimensions'] || [])]);
    patch({[role]:next,rangeFilters:conditions.filter(item => stillSelected.has(item.field))});
  };
  const changeSource = (source:string) => {
    patch({source,sourceType:'businessForm',dimensions:[],measures:[],rangeFilters:[]});
    setNotice('来源已切换，字段和范围已清空。指标公式保留，请使用新来源字段重新核对。');
  };
  const check = () => {
    if (!dataset.name?.trim()) {setTab('source'); return '请填写数据集名称。';}
    if (!dataset.source) {setTab('source'); return '请选择来源表单。';}
    if (loading || fieldsError) {setTab('source'); return '请等待来源字段加载完成，或重试读取字段。';}
    if (!declared.length) {setTab('fields'); return '请至少选择一个维度字段或数值字段。';}
    if (declared.some(name => !fields.some(field => field.field_name === name))) {setTab('fields'); return '部分已选字段已失效，请重新选择。';}
    if (conditions.some(item => !declared.includes(item.field) || (!['isEmpty','notEmpty'].includes(item.operator) && !item.value?.trim()))) {setTab('range'); return '请补全范围条件的字段和比较值。';}
    if (metrics.some(metric => !metric.name.trim() || !metric.expression?.trim())) {setTab('metrics'); return '请补全指标名称和公式。';}
    return '';
  };
  const preview = async () => {
    const problem = check();
    if (problem) {setError(problem); return undefined;}
    setError(''); setBusy(true);
    const metricIds = metrics.map(metric => metric.id);
    // One isolated dataset avoids unrelated, incomplete widgets obscuring this check.
    const previewMetrics = metrics.length ? metrics : [{id:'__dataset_count',name:'记录数',datasetId:dataset.id,expression:'count(*)',format:'number'}];
    try {
      const response = await previewAnalyticsDesign(programId, {datasets:[dataset],metrics:previewMetrics,widgets:[{
        id:'__dataset_preview',title:'数据预览',type:'detail-table',datasetId:dataset.id,metricIds:metricIds.length ? metricIds : ['__dataset_count'],
      }],globalFilters:[],interactions:[]});
      if (!alive.current) return undefined;
      const data = response.data.analyticsData;
      setResult({signature,data,at:new Date().toLocaleTimeString('zh-CN',{hour12:false})});
      return data;
    } catch (cause) {if (alive.current) setError(analyticsErrorMessage(cause,'预览失败，请检查来源和权限后重试。')); return undefined;}
    finally {if (alive.current) setBusy(false);}
  };
  const apply = async () => {
    const data = fresh ? result?.data : await preview();
    if (!alive.current || !data) return;
    if (data.errors?.length) {setTab('preview'); setError('检查未通过，请修正下方问题后再应用。'); return;}
    onApply({...dataset,name:dataset.name!.trim()},metrics);
  };
  const rows = result?.data.widgets?.__dataset_preview;
  const previewColumns = selectedFields.map(field => ({title:field.label || field.field_name,dataIndex:field.field_name,key:field.field_name,width:160,ellipsis:true,
    render:(value:unknown) => value === null || value === undefined ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value)}));
  const addMetric = () => setMetrics(current => [...current,{id:id('metric'),name:'记录数',datasetId:dataset.id,expression:'count(*)',format:'number'}]);
  const sourcePage = <>
    <PropertyGroup title="基本信息">
      <PropertyRow label="数据集名称"><Input value={dataset.name} maxLength={80} placeholder="例如：正常生产记录" onChange={event => patch({name:event.target.value})} /></PropertyRow>
      <PropertyRow label="来源类型" hint="本次使用已发布业务表单；记录和字段权限由服务端校验。"><Select value={dataset.sourceType || 'businessForm'} options={[{value:'businessForm',label:'业务表单'},{value:'sql',label:'外部数据库 · 尚未接入',disabled:true},{value:'api',label:'API 接口 · 尚未接入',disabled:true}]} /></PropertyRow>
      <PropertyRow label="来源表单" hint="切换来源后需重新选择字段和范围，并核对指标公式。"><Select showSearch optionFilterProp="label" loading={formsLoading} disabled={disabled || busy || lockedSource} placeholder="选择已发布的表单" value={dataset.source ? sourceCode : undefined} options={forms.filter(form => !!form.published_version || form.code === sourceCode).map(form => ({value:form.code,label:`${form.name} (${form.code})`}))} onChange={changeSource} /></PropertyRow>
      {lockedSource && <p className="dataset-note">此数据集引用了共享指标。请先解除共享引用，再切换来源。</p>}
      <PropertyAdvanced title="刷新与外部连接">
        <PropertyRow label="刷新方式"><Select value={dataset.refreshMode} options={[{value:'manual',label:'手动刷新'},{value:'realtime',label:'自动刷新 · 每 30 秒'},{value:'scheduled',label:'定时刷新'}]} onChange={refreshMode => patch({refreshMode})} /></PropertyRow>
        {dataset.refreshMode === 'scheduled' && <PropertyRow label="刷新间隔" hint="10–86400 秒。"><InputNumber min={10} max={86400} precision={0} addonAfter="秒" value={dataset.refreshInterval ?? 60} onChange={value => patch({refreshInterval:value ?? 60})} /></PropertyRow>}
        <p className="dataset-note">外部 SQL / API 直接绑定尚未接入。当前可选择已导入业务表单的数据。</p>
        <Space><Link target="_blank" rel="noopener noreferrer" to="/data-center/sources">管理数据连接</Link><Link target="_blank" rel="noopener noreferrer" to="/data-center/pipelines">查看同步管道</Link></Space>
      </PropertyAdvanced>
    </PropertyGroup>
    <div className="dataset-next"><Button onClick={() => setTab('fields')}>下一步：选择字段</Button></div>
  </>;
  const fieldsPage = <>
    <div className="dataset-section-heading"><div><strong>选择参与分析的字段</strong><p>维度用于分组与筛选；数值字段用于求和、平均等计算。同一数值字段也可作为维度。</p></div><Input aria-label="搜索数据集字段" allowClear placeholder="搜索名称或字段编码" value={search} onChange={event => setSearch(event.target.value)} /></div>
    <div className="dataset-field-count"><Tag>维度 {dataset.dimensions?.length || 0}</Tag><Tag>数值 {dataset.measures?.length || 0}</Tag><span>取消字段会移除该字段的范围条件，并在应用时清理失效绑定。</span></div>
    <Table size="small" rowKey="field_name" pagination={{pageSize:8,showSizeChanger:false}} dataSource={fields.filter(field => `${field.label} ${field.field_name}`.toLowerCase().includes(search.toLowerCase()))} locale={{emptyText:<Empty description={dataset.source ? '没有匹配的字段' : '请先选择来源表单'} />}} columns={[
      {title:'字段名称',dataIndex:'label',render:(value:string,field:PlatformFormField) => <div><strong>{value || field.field_name}</strong><small className="dataset-field-code">{field.field_name}</small></div>},
      {title:'类型',dataIndex:'field_type',width:130},
      {title:'维度',width:80,render:(_:unknown,field:PlatformFormField) => <Checkbox aria-label={`将${field.label || field.field_name}设为维度`} checked={dataset.dimensions?.includes(field.field_name)} onChange={event => setRole(field.field_name,'dimensions',event.target.checked)} />},
      {title:'数值',width:80,render:(_:unknown,field:PlatformFormField) => <Checkbox aria-label={`将${field.label || field.field_name}设为数值`} disabled={disabled || busy || !numeric(field)} checked={dataset.measures?.includes(field.field_name)} onChange={event => setRole(field.field_name,'measures',event.target.checked)} />},
    ]} />
  </>;
  const rangePage = <>
    <PropertyGroup title="数据范围">
      <PropertyRow label="固定范围" hint="多个条件需同时满足。先限制数据集范围，再叠加看板筛选和组件联动。"><Switch size="small" checked={!!conditions.length} disabled={disabled || busy || !declared.length} onChange={enabled => patch({rangeFilters:enabled ? [{field:declared[0],operator:'eq',value:''}] : []})} /></PropertyRow>
    </PropertyGroup>
    {!conditions.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未限制固定范围，使用当前用户有权统计的全部来源记录" /> : <>
      <p className="dataset-note">满足以下全部条件（AND）。数值按大小比较，日期使用 YYYY-MM-DD 格式；留空条件不能应用。</p>
      <div className="dataset-conditions">{conditions.map((condition,index) => <div key={index} className="dataset-condition"><span className="dataset-condition-index">{index + 1}</span><Select aria-label={`范围字段 ${index+1}`} value={condition.field} options={fieldOptions} onChange={field => updateCondition(index,{field,value:''})} /><Select aria-label={`范围比较方式 ${index+1}`} value={condition.operator} options={operators} onChange={operator => updateCondition(index,{operator})} />{!['isEmpty','notEmpty'].includes(condition.operator) ? <Input aria-label={`范围比较值 ${index+1}`} maxLength={500} placeholder="输入比较值" value={condition.value} onChange={event => updateCondition(index,{value:event.target.value})} /> : <span className="dataset-condition-empty">无需比较值</span>}<Button type="text" danger icon={<DeleteOutlined />} aria-label={`删除范围条件 ${index+1}`} onClick={() => patch({rangeFilters:conditions.filter((_,i) => i !== index)})} /></div>)}</div>
      <Button icon={<PlusOutlined />} disabled={disabled || busy || conditions.length >= 20} onClick={() => patch({rangeFilters:[...conditions,{field:declared[0],operator:'eq',value:''}]})}>添加条件</Button>
    </>}
    <Alert type="info" showIcon message="范围作用于此数据集的全部指标、图表和明细；不会扩大来源数据权限。" />
  </>;
  const metricsPage = <>
    <div className="dataset-section-heading"><div><strong>此数据集的指标</strong><p>指标按范围内全部授权记录计算，预览行数不会影响汇总结果。</p></div><Button icon={<PlusOutlined />} disabled={disabled || busy || metrics.length >= 100} onClick={addMetric}>新增指标</Button></div>
    {!metrics.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚无指标，可从 count(*) 记录数开始" />}
    <Collapse accordion items={metrics.map(metric => ({key:metric.id,label:<span>{metric.name || '未命名指标'}{metric.sharedMetricId && <Tag>共享 v{metric.sharedMetricVersion}</Tag>}</span>,children:<>
      {metric.sharedMetricId && <Alert type="info" message="共享指标口径在共享指标库维护，这里仅查看已引用版本。" />}
      <ConfigProvider componentDisabled={disabled || busy || !!metric.sharedMetricId}>
        <PropertyRow label="指标名称"><Input maxLength={80} value={metric.name} onChange={event => updateMetric(metric.id,{name:event.target.value})} /></PropertyRow>
        <PropertyRow label="计算公式" hint="支持 count(*)、sum、avg、min、max、count_distinct、count_if 与四则运算。"><Input.TextArea maxLength={512} rows={3} value={metric.expression} placeholder="例如 sum(actual) / sum(target)" onChange={event => updateMetric(metric.id,{expression:event.target.value})} /></PropertyRow>
        <div className="dataset-formula-fields">{declared.map(field => <code key={field} title={label(field)}>{field}</code>)}</div>
        <PropertyRow label="口径说明"><Input.TextArea maxLength={500} rows={2} value={metric.description} placeholder="说明统计范围、计算方法和业务含义" onChange={event => updateMetric(metric.id,{description:event.target.value})} /></PropertyRow>
        <PropertyRow label="显示格式"><Select value={metric.format || 'number'} options={[{value:'number',label:'数值'},{value:'percent',label:'百分比'},{value:'currency',label:'金额（¥）'},{value:'duration',label:'时长（秒）'}]} onChange={format => updateMetric(metric.id,{format})} /></PropertyRow>
        <PropertyRow label="显示单位"><Input maxLength={20} disabled={disabled || busy || !!metric.sharedMetricId || metric.format !== 'number'} value={metric.unit} placeholder="例如：件、台" onChange={event => updateMetric(metric.id,{unit:event.target.value})} /></PropertyRow>
      </ConfigProvider>
      <p className="dataset-note">达成率建议使用 sum(实际产量字段) / sum(计划产量字段)，显示格式选百分比。分母为零显示 —。</p>
      <Button type="text" danger icon={<DeleteOutlined />} onClick={() => {setMetrics(current => current.filter(item => item.id !== metric.id));setNotice('指标已从窗口草稿移除；应用后会清理组件对它的引用。');}}>移除此指标</Button>
    </>}))} />
  </>;
  const previewPage = <>
    <div className="dataset-section-heading"><div><strong>真实数据预览</strong><p>使用当前窗口配置读取授权数据，仅取前 50 行展示。预览不会保存配置或修改业务记录。</p></div><Button icon={<ReloadOutlined />} loading={busy} disabled={disabled || busy} onClick={() => {void preview();}}>运行预览</Button></div>
    {result && <>
      {!fresh && <Alert type="warning" showIcon message="配置已修改，下方结果来自上一次预览，请重新运行。" />}
      {!!result.data.errors?.length && <Alert type="error" showIcon message="配置检查未通过" description={<ul>{result.data.errors.map((item,index) => <li key={index}>{item}</li>)}</ul>} />}
      <div className="dataset-preview-stats"><div><span>范围内记录</span><strong>{rows?.total ?? '—'}</strong></div><div><span>参与分析字段</span><strong>{declared.length}</strong></div><div><span>预览时间</span><strong>{result.at}</strong></div></div>
      {!!metrics.length && <div className="dataset-preview-metrics">{metrics.map(metric => <div key={metric.id}><span>{metric.name}</span><strong>{formatAnalyticsValue(result.data.metricValues?.[metric.id],metric)}</strong><code>{metric.expression}</code></div>)}</div>}
      <Table size="small" rowKey={(_,index) => String(index)} columns={previewColumns} dataSource={(rows?.rows || []).slice(0,50)} scroll={{x:Math.max(600,previewColumns.length*160)}} pagination={{pageSize:10,showSizeChanger:false}} locale={{emptyText:'当前范围内没有可展示的数据'}} />
      <p className="dataset-note">指标按全部授权记录汇总；表格最多展示前 50 条。数据权限与正式看板一致。</p>
    </>}
    {!result && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="点击「运行预览」检查字段、范围和指标结果" />}
  </>;
  return <Modal open centered title={<div className="dataset-dialog-title"><DatabaseOutlined /><span>数据集配置</span><small>{dataset.name || '新数据集'}</small></div>} width={1080} className="analytics-dataset-dialog" maskClosable={false} onCancel={onClose} closable={!busy} keyboard={!busy} footer={<div className="dataset-dialog-footer"><span>应用到当前看板草稿 · 发布看板后对查看者生效</span><Space><Button disabled={busy} onClick={onClose}>取消</Button><Button type="primary" loading={busy} disabled={disabled || loading || !!fieldsError} onClick={() => {void apply();}}>检查并应用到草稿</Button></Space></div>}>
    <ConfigProvider componentDisabled={disabled || busy}><div className="property-inspector dataset-dialog-content">
      {error && <Alert showIcon type="error" message={error} />}
      {notice && <Alert closable type="info" message={notice} onClose={() => setNotice('')} />}
      {fieldsError && <Alert type="error" showIcon message={fieldsError} action={<Button size="small" onClick={() => setRetry(value => value+1)}>重试</Button>} />}
      <Tabs activeKey={tab} onChange={setTab} items={[{key:'source',label:'来源',children:sourcePage},{key:'fields',label:`字段 ${declared.length}`,children:<Spin spinning={loading}>{fieldsPage}</Spin>},{key:'range',label:`范围${conditions.length ? ` ${conditions.length}` : ''}`,children:rangePage},{key:'metrics',label:`指标 ${metrics.length}`,children:metricsPage},{key:'preview',label:'预览',children:previewPage}]} />
    </div></ConfigProvider>
  </Modal>;
}
