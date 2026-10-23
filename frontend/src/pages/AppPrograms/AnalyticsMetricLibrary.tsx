import React from 'react';
import {Alert, Button, Empty, Input, Select, Space, Spin, Tabs, Tag, message} from 'antd';
import {ArrowLeftOutlined, DatabaseOutlined, LinkOutlined, PlusOutlined, ReloadOutlined, SearchOutlined} from '@ant-design/icons';
import {getPlatformFormByCode} from '@/services/api';
import {checkSharedMetricImpact, createSharedAnalyticsMetric, getSharedAnalyticsMetric, getSharedMetricReferences, listSharedAnalyticsMetrics, publishSharedAnalyticsMetric, saveSharedAnalyticsMetric} from './analyticsApi';
import {analyticsErrorMessage} from './analyticsEditorState';
import {bindSharedMetricToBoard, compatibleMetricSource, sharedDefinitionKey, sharedMetricSeed} from './analyticsMetricLibraryState';
import {formatAnalyticsVersionTime} from './analyticsVersionUtils';
import type {RuntimeAnalyticsDesign, SharedMetricDefinition, SharedMetricEntry, SharedMetricImpact, SharedMetricReferences} from './analyticsTypes';
import './analytics-metric-library.css';

interface Props {
  design: RuntimeAnalyticsDesign;
  focusId?: string;
  refreshKey?: string;
  disabled?: boolean;
  hasUnsavedBoardChanges: boolean;
  onChange: (design: RuntimeAnalyticsDesign) => void;
  onPublished: () => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}

export default function AnalyticsMetricLibrary({design, focusId, refreshKey, disabled = false, hasUnsavedBoardChanges, onChange, onPublished, onDirtyChange, onBusyChange}: Props) {
  const [items, setItems] = React.useState<SharedMetricEntry[]>([]);
  const [entry, setEntry] = React.useState<SharedMetricEntry>();
  const [definition, setDefinition] = React.useState<SharedMetricDefinition>();
  const [references, setReferences] = React.useState<SharedMetricReferences>();
  const [impact, setImpact] = React.useState<SharedMetricImpact>();
  const [creating, setCreating] = React.useState(false);
  const [originId, setOriginId] = React.useState('');
  const [replaceId, setReplaceId] = React.useState('');
  const [tab, setTab] = React.useState('definition');
  const [search, setSearch] = React.useState('');
  const [fields, setFields] = React.useState<string[]>([]);
  const [note, setNote] = React.useState('');
  const [error, setError] = React.useState('');
  const [operation, setOperation] = React.useState('load');
  const alive = React.useRef(true);
  const operationRef = React.useRef(false);
  const currentEntry = React.useRef(entry);
  currentEntry.current = entry;
  const dirty = !!definition && (creating || !!entry && sharedDefinitionKey(definition) !== sharedDefinitionKey(entry.draft));
  const busy = !!operation || disabled;
  const localMetrics = (design.metrics || []).filter(metric => !metric.sharedMetricId && design.datasets?.some(dataset => dataset.id === metric.datasetId && dataset.sourceType === 'businessForm'));

  React.useEffect(() => {onDirtyChange(dirty);}, [dirty, onDirtyChange]);
  React.useEffect(() => {onBusyChange(!!operation);}, [operation, onBusyChange]);
  React.useEffect(() => {
    alive.current = true;
    return () => {alive.current = false; onDirtyChange(false); onBusyChange(false);};
  }, [onDirtyChange, onBusyChange]);

  const acceptEntry = (value: SharedMetricEntry) => {
    setEntry(value); setDefinition(value.draft); setCreating(false); setImpact(undefined); setNote('');
    setItems(current => [value, ...current.filter(item => item.id !== value.id)]);
    const existing = design.metrics?.find(metric => metric.sharedMetricId === value.id);
    setReplaceId(existing?.id || '');
  };
  const run = async (name: string, action: () => Promise<void>) => {
    if (operationRef.current) return;
    operationRef.current = true; setOperation(name); setError('');
    try {await action();}
    catch (cause) {if (alive.current) setError(analyticsErrorMessage(cause, cause instanceof Error ? cause.message : '操作失败，请重试。'));}
    finally {operationRef.current = false; if (alive.current) setOperation('');}
  };

  const load = async (id?: string) => run('load', async () => {
    const {data} = await listSharedAnalyticsMetrics();
    if (!alive.current) return;
    setItems(data.items);
    if (id) {
      const [detail, refs] = await Promise.all([getSharedAnalyticsMetric(id), getSharedMetricReferences(id)]);
      if (!alive.current) return;
      acceptEntry(detail.data); setReferences(refs.data);
    } else {setEntry(undefined); setDefinition(undefined); setCreating(false); setReferences(undefined);}
  });
  React.useEffect(() => {void load(focusId || currentEntry.current?.id);}, [focusId, refreshKey]);

  React.useEffect(() => {
    const source = definition?.source;
    if (!source) {setFields([]); return;}
    let cancelled = false;
    getPlatformFormByCode(source, {schema:'published', scope:'designer'}).then(response => {
      if (!cancelled) setFields((response.data?.data?.fields || []).filter((field: {archived?: boolean}) => !field.archived).map((field: {field_name: string}) => field.field_name));
    }).catch(() => {if (!cancelled) setFields([]);});
    return () => {cancelled = true;};
  }, [definition?.source]);

  const change = (patch: Partial<SharedMetricDefinition>) => {
    if (busy) return;
    setDefinition(current => current ? {...current, ...patch} : current); setImpact(undefined);
  };
  const canSwitch = () => {
    if (busy) return false;
    if (dirty) {message.info('当前口径尚未保存，请先保存指标草稿或还原编辑。'); return false;}
    return true;
  };
  const startCreate = () => {
    if (!canSwitch()) return;
    const first = localMetrics[0];
    if (!first) return;
    const dataset = design.datasets!.find(value => value.id === first.datasetId)!;
    setEntry(undefined); setCreating(true); setOriginId(first.id); setDefinition(sharedMetricSeed(first, dataset));
    setReferences(undefined); setImpact(undefined); setTab('definition'); setError('');
  };
  const saveDraft = () => {
    if (!definition) return;
    void run('save', async () => {
      const {data} = creating ? await createSharedAnalyticsMetric(definition) : await saveSharedAnalyticsMetric(entry!.id, definition, entry!.revision);
      if (!alive.current) return;
      acceptEntry(data); setReplaceId(creating ? originId : replaceId);
      setReferences((await getSharedMetricReferences(data.id)).data);
      message.success('指标草稿已保存，线上看板尚未变化');
    });
  };
  const check = () => {
    if (!entry || !definition) return;
    void run('check', async () => {
      const {data} = await checkSharedMetricImpact(entry.id, definition, entry.revision);
      if (!alive.current) return;
      setImpact(data); setReferences(data); setTab('references');
    });
  };
  const publish = () => {
    if (!entry || !definition || !impact || impact.errors.length || impact.unchanged || hasUnsavedBoardChanges) return;
    void run('publish', async () => {
      const {data} = await publishSharedAnalyticsMetric(entry.id, definition, entry.revision, impact.impactToken, note);
      if (!alive.current) return;
      acceptEntry(data); onDirtyChange(false);
      const refs = await getSharedMetricReferences(data.id);
      if (!alive.current) return;
      setReferences(refs.data);
      message.success(`共享指标 v${data.publishedVersion} 已发布，更新 ${data.updatedBoards.length} 张线上看板`);
      await onPublished();
    });
  };
  const bind = () => {
    if (!entry || busy || dirty) return;
    try {
      const next = bindSharedMetricToBoard(design, entry, replaceId);
      onChange(next.design); setReplaceId(next.metricId);
      message.success('已引用到当前看板草稿，保存并发布看板后生效');
    } catch (cause) {setError(cause instanceof Error ? cause.message : '引用失败');}
  };
  const renderReferences = (value?: SharedMetricReferences) => value && <>
    <div className="analytics-library-impact-summary"><div><strong>{value.counts.publishedBoards}</strong><span>线上看板</span></div><div><strong>{value.counts.publishedCharts}</strong><span>线上图表</span></div></div>
    <p className="analytics-library-help">另有 {value.counts.draftBoards} 张已保存草稿、{value.counts.draftCharts} 个草稿图表。历史版本保持原口径；未保存的引用不计入此清单。</p>
    {value.references.length ? <div className="analytics-library-references">{value.references.map(item => <article key={`${item.formId}-${item.state}`}>
      <div><a href={`/program/${encodeURIComponent(item.programId)}`} target="_blank" rel="noreferrer">{item.boardName}</a><Tag color={item.state === 'published' ? 'green' : 'default'}>{item.state === 'published' ? '线上' : '草稿'}{item.version ? ` v${item.version}` : ''}</Tag></div>
      <ul>{item.widgets.map(widget => <li key={widget.id}>{widget.title}</li>)}</ul>{!item.widgets.length && <p>已引用此指标，暂未用于图表</p>}
    </article>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前还没有已保存的看板引用" />}
  </>;

  return <div className="analytics-metric-library">
    <div className="analytics-library-intro"><DatabaseOutlined /><p>同一指标跨看板引用。口径修改先检查影响，发布后统一更新线上看板并生成新版本。</p></div>
    {error && <Alert type="error" showIcon message={error} action={<Button size="small" disabled={busy} onClick={() => {setCreating(false); void load(entry?.id);}}>放弃编辑并重新加载</Button>} />}
    <Spin spinning={operation === 'load'}>
      {!entry && !creating ? <>
        <div className="analytics-library-list-actions"><Input placeholder="搜索共享指标" aria-label="搜索共享指标" prefix={<SearchOutlined />} value={search} onChange={event => setSearch(event.target.value)} /><Button icon={<ReloadOutlined />} aria-label="刷新指标库" disabled={busy} onClick={() => void load()} /></div>
        <Button block icon={<PlusOutlined />} disabled={busy || !localMetrics.length} onClick={startCreate}>从本看板登记指标</Button>
        {!localMetrics.length && <p className="analytics-library-help">可先在「数据与指标」创建本地指标，再登记为共享口径。</p>}
        <div className="analytics-library-list">{items.filter(item => `${item.draft.name} ${item.published?.name || ''}`.toLowerCase().includes(search.toLowerCase())).map(item => <button type="button" key={item.id} disabled={busy} onClick={() => {if (canSwitch()) {setTab('definition'); void load(item.id);}}}>
          <span><strong>{item.published?.name || item.draft.name}</strong><Tag>{item.publishedVersion ? `v${item.publishedVersion}` : '未发布'}</Tag></span><small>{item.draft.sourceName || item.draft.source}</small>
          {!!item.published && sharedDefinitionKey(item.draft) !== sharedDefinitionKey(item.published) && <em>有待发布口径</em>}
        </button>)}</div>
        {!items.length && !busy && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="指标库尚未登记指标" />}
      </> : definition && <>
        <div className="analytics-library-detail-heading"><Button size="small" type="text" icon={<ArrowLeftOutlined />} disabled={busy} onClick={() => {if (canSwitch()) void load();}}>指标列表</Button><Space size={4}>{dirty && <Tag color="gold">口径未保存</Tag>}<Tag>{entry?.publishedVersion ? `共享 v${entry.publishedVersion}` : '新指标草稿'}</Tag></Space></div>
        <Tabs size="small" activeKey={tab} onChange={setTab} items={[
          {key:'definition',label:'指标口径',children:<>
            {creating && <div className="analytics-library-field"><label>登记本看板指标</label><Select aria-label="登记本看板指标" value={originId} disabled={busy} options={localMetrics.map(metric => ({value:metric.id,label:metric.name}))} onChange={id => {const metric=localMetrics.find(value => value.id===id)!;setOriginId(id);setDefinition(sharedMetricSeed(metric,design.datasets!.find(value => value.id===metric.datasetId)!));}} /></div>}
            <div className="analytics-library-source">数据来源：{definition.sourceName || definition.source}</div>
            <div className="analytics-library-field"><label htmlFor="shared-metric-name">指标名称</label><Input id="shared-metric-name" value={definition.name} maxLength={80} disabled={busy} onChange={event => change({name:event.target.value})} /></div>
            <div className="analytics-library-field"><label htmlFor="shared-metric-expression">统一计算公式</label><Input.TextArea id="shared-metric-expression" value={definition.expression} maxLength={512} rows={3} disabled={busy} onChange={event => change({expression:event.target.value})} /><small>使用来源表单的已发布字段。支持 sum、avg、count 等聚合及四则运算。</small>{!!fields.length && <div className="analytics-library-fields">{fields.map(field => <code key={field}>{field}</code>)}</div>}</div>
            <div className="analytics-library-field"><label htmlFor="shared-metric-description">业务口径说明</label><Input.TextArea id="shared-metric-description" value={definition.description} rows={3} maxLength={500} disabled={busy} onChange={event => change({description:event.target.value})} /></div>
            <div className="analytics-library-field-row"><div className="analytics-library-field"><label>显示格式</label><Select aria-label="共享指标显示格式" value={definition.format} disabled={busy} options={[{value:'number',label:'数值'},{value:'percent',label:'百分比'},{value:'currency',label:'金额'},{value:'duration',label:'时长（秒）'}]} onChange={format => change({format})} /></div><div className="analytics-library-field"><label htmlFor="shared-metric-unit">单位</label><Input id="shared-metric-unit" value={definition.unit} maxLength={20} disabled={busy || definition.format !== 'number'} onChange={event => change({unit:event.target.value})} /></div></div>
            <div className="analytics-library-field"><label htmlFor="shared-metric-threshold">阈值规则</label><Input id="shared-metric-threshold" value={definition.threshold} maxLength={200} placeholder="例如：绿色 >= 90" disabled={busy} onChange={event => change({threshold:event.target.value})} /></div>
          </>},
          {key:'references',label:'引用与影响',children:<>
            {impact ? <Alert showIcon type={impact.errors.length ? 'error' : impact.unchanged ? 'info' : 'success'} message={impact.errors.length ? '检查未通过，所有看板均不会更新' : impact.unchanged ? '与已发布口径一致，无需重复发布' : `检查通过，将发布共享指标 v${impact.nextVersion}`} description={impact.errors.length ? <ul>{impact.errors.map((item,index)=><li key={index}>{item}</li>)}</ul> : '发布时会再次核对引用关系，避免检查期间新增引用被遗漏。'} /> : <p className="analytics-library-help">这里展示已保存的引用。修改口径后点击「检查影响」，校验全部线上看板。</p>}
            {renderReferences(impact || references)}
            {impact && !impact.errors.length && !impact.unchanged && <div className="analytics-library-publish">
              {hasUnsavedBoardChanges && <Alert showIcon type="warning" message="请先保存当前看板草稿，再发布共享口径" />}
              <div className="analytics-library-field"><label htmlFor="shared-metric-note">本次修改说明</label><Input.TextArea id="shared-metric-note" value={note} maxLength={500} rows={2} disabled={busy} placeholder="说明口径变更原因" onChange={event => setNote(event.target.value)} /></div>
              <Button block type="primary" loading={operation==='publish'} disabled={busy || hasUnsavedBoardChanges} onClick={publish}>发布共享口径 v{impact.nextVersion}</Button>
            </div>}
          </>},
          ...(!creating ? [{key:'history',label:'指标版本',children:<div className="analytics-library-history">{entry?.versions?.length ? entry.versions.map(version => <article key={version.version}><strong>v{version.version} · {version.definition.name}</strong><small>{formatAnalyticsVersionTime(version.publishedAt)}</small><code>{version.definition.expression}</code>{version.note && <p>{version.note}</p>}<Button size="small" disabled={busy} onClick={() => {if (!canSwitch()) return;setDefinition(version.definition);setImpact(undefined);setTab('definition');}}>以此口径编辑</Button></article>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="首次发布后开始记录指标版本" />}</div>}] : []),
        ]} />
        <div className="analytics-library-draft-actions"><Button loading={operation==='save'} disabled={busy || !dirty} onClick={saveDraft}>{creating ? '登记为指标草稿' : '保存指标草稿'}</Button><Button disabled={busy || creating || !entry} loading={operation==='check'} onClick={check}>检查影响</Button>{dirty && <Button type="text" disabled={busy} onClick={() => {if (creating) {setCreating(false);setDefinition(undefined);} else setDefinition(entry!.draft);setImpact(undefined);}}>还原编辑</Button>}</div>
        {entry?.published && <div className="analytics-library-bind"><strong><LinkOutlined /> 引用到当前看板</strong><p>引用已发布的共享 v{entry.publishedVersion}。替换本地指标时保留图表绑定，所需字段会补充到同源数据集。</p>
          <Select aria-label="共享指标引用方式" value={replaceId} disabled={busy || dirty} options={[{value:'',label:'作为新指标引用'},...(design.metrics || []).filter(metric => design.datasets?.some(dataset => dataset.id===metric.datasetId && compatibleMetricSource(dataset,entry.published!))).map(metric => ({value:metric.id,label:`替换「${metric.name}」${metric.sharedMetricId===entry.id?'（已引用）':''}`}))]} onChange={setReplaceId} />
          <Button block icon={<LinkOutlined />} disabled={busy || dirty} onClick={bind}>引用到看板草稿</Button>
        </div>}
      </>}
    </Spin>
  </div>;
}
