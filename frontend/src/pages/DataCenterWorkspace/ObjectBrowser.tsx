import { ArrowLeftOutlined, BranchesOutlined, ReloadOutlined, SettingOutlined } from '@/components/Icon/ant';
import { Alert, Button, Card, Empty, Input, Select, Skeleton, Table, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  listObjectRecords, loadObjectTypes, objectRuntimeError, objectTypeId, readObjectRecord,
  type ObjectPropertySource, type ObjectRecord, type ObjectRecordDetail, type ObjectRecordPage,
  type ObjectRelationRecords, type RuntimeObjectType,
} from '../../services/objectRuntime';
import { formatServerDateTime } from '../../utils/dateTime';
import ObjectRuntimeSettings from './ObjectRuntimeSettings';
import './objectBrowser.css';

const PAGE_SIZE = 20;

const canBrowse = (item: RuntimeObjectType) => item.status === 'published' && (item.record_bound ?? Boolean(item.record_binding));

function propertyLabel(model: RuntimeObjectType, code: string) {
  return model.fields.find(field => (field.code || field.name) === code)?.label || code;
}

function propertyValue(value: unknown) {
  if (value == null || value === '') return '—';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function sourceLabel(source: ObjectPropertySource) {
  return [source.source_name, source.source_entity, source.source_field].filter(Boolean).join(' / ');
}

const relationEmpty: Record<ObjectRelationRecords['state'], string> = {
  matched: '暂无可查看的关联记录',
  missing: '暂无符合匹配条件的记录',
  ambiguous: '匹配到多条目标记录，请核对主键与关系配置',
  unbound: '此关系尚未完成实例配置',
  restricted: '当前账号无权查看该关系的实例',
};

export default function ObjectBrowser({ isAdmin, openModelDesign }: { isAdmin: boolean; openModelDesign: () => void }) {
  const [params, setParams] = useSearchParams();
  const [models, setModels] = useState<RuntimeObjectType[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState('');
  const [revision, setRevision] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [list, setList] = useState<ObjectRecordPage>();
  const [record, setRecord] = useState<ObjectRecordDetail>();
  const [loading, setLoading] = useState(false);
  const [recordError, setRecordError] = useState('');

  const available = models.filter(canBrowse);
  const requestedType = params.get('objectType');
  const requestedModel = models.find(item => String(objectTypeId(item)) === requestedType)
    ?? models.find(item => item.code === requestedType);
  const candidate = requestedType ? requestedModel : available[0];
  const selected = candidate && canBrowse(candidate) ? candidate : undefined;
  const typeId = selected && objectTypeId(selected);
  const key = params.get('objectKey');
  const query = params.get('objectQuery') ?? '';
  const requestedPage = Number(params.get('objectPage'));
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;

  function refresh() {
    setRevision(value => value + 1);
  }

  function objectParams(id: number, recordKey?: string) {
    const next = new URLSearchParams(params);
    next.set('view', 'browse');
    next.set('objectType', String(id));
    if (id !== typeId || recordKey === undefined) {
      next.delete('objectQuery');
      next.delete('objectPage');
    }
    if (recordKey !== undefined) next.set('objectKey', recordKey);
    else next.delete('objectKey');
    return next;
  }

  function backToList() {
    const next = new URLSearchParams(params);
    next.delete('objectKey');
    setParams(next);
  }

  function search(value: string) {
    const next = new URLSearchParams(params);
    if (value.trim()) next.set('objectQuery', value.trim());
    else next.delete('objectQuery');
    next.delete('objectPage');
    setParams(next);
  }

  function setPage(value: number) {
    const next = new URLSearchParams(params);
    if (value > 1) next.set('objectPage', String(value));
    else next.delete('objectPage');
    setParams(next);
  }

  useEffect(() => {
    let active = true;
    setCatalogLoading(true);
    setCatalogError('');
    loadObjectTypes().then(response => {
      if (active) setModels(response.data.data);
    }).catch(error => {
      if (active) setCatalogError(objectRuntimeError(error, '无法读取对象目录。'));
    }).finally(() => {
      if (active) setCatalogLoading(false);
    });
    return () => { active = false; };
  }, [revision]);

  useEffect(() => {
    let active = true;
    setRecordError('');
    setRecord(undefined);
    setList(undefined);
    setLoading(Boolean(typeId));
    if (!typeId) return;

    const request = key
      ? readObjectRecord(typeId, key).then(response => { if (active) setRecord(response.data.data); })
      : listObjectRecords(typeId, { q: query || undefined, page, page_size: PAGE_SIZE })
        .then(response => { if (active) setList(response.data.data); });
    request.catch(error => {
      if (active) setRecordError(objectRuntimeError(error, '无法读取对象记录。'));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [typeId, key, query, page, revision]);

  const openRecord = (id: number, recordKey: string) => `?${objectParams(id, recordKey)}`;
  const listedFields = selected?.fields
    .filter(field => field.list !== false && list?.items.some(item => Object.prototype.hasOwnProperty.call(item.values, field.code || field.name)))
    .slice(0, 5) ?? [];

  return <div className="object-browser">
    <div className="object-browser-toolbar">
      <div className="object-browser-filters">
        {available.length > 0 && <Select
          aria-label="对象类型"
          placeholder="选择对象类型"
          loading={catalogLoading}
          value={typeId}
          options={available.map(item => ({ value: objectTypeId(item), label: item.name }))}
          optionFilterProp="label"
          showSearch
          onChange={id => setParams(objectParams(id))}
        />}
        {typeId && !key && <Input.Search
          aria-label="搜索对象"
          key={`${typeId}:${query}`}
          placeholder="按对象标识或可搜索属性查找"
          defaultValue={query}
          maxLength={200}
          allowClear
          onSearch={search}
        />}
      </div>
      <div className="object-browser-actions">
        <Button icon={<ReloadOutlined />} loading={catalogLoading} onClick={refresh}>刷新</Button>
        {isAdmin && <Button icon={<SettingOutlined />} onClick={() => setSettingsOpen(true)}>实例配置</Button>}
      </div>
    </div>

    {catalogError && <Alert type="error" showIcon message={catalogError} />}
    {!selected && !catalogLoading && !catalogError && <Card>
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={requestedType ? '当前对象类型不可浏览' : '暂无绑定记录的已发布对象类型'}>
        {isAdmin && (requestedModel?.status === 'published'
          ? <Button type="primary" onClick={() => setSettingsOpen(true)}>配置记录来源</Button>
          : <Button onClick={openModelDesign}>前往模型设计</Button>)}
      </Empty>
    </Card>}
    {!selected && catalogLoading && <Skeleton active />}
    {selected && typeId && <>
      {key && <Button className="object-browser-back" type="text" icon={<ArrowLeftOutlined />} onClick={backToList}>返回{selected.name}列表</Button>}
      {recordError && <Alert type="error" showIcon message={recordError} action={<Button onClick={refresh}>重试</Button>} />}
      {!recordError && !key && <Card
        title={selected.name}
        extra={list?.binding_form && <Typography.Text type="secondary">记录来源　{list.binding_form.name}</Typography.Text>}
      >
        <Table<ObjectRecord>
          size="middle"
          loading={loading}
          rowKey="key"
          dataSource={list?.items ?? []}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: query ? '未找到匹配的对象' : '暂无可查看的对象记录' }}
          pagination={{ current: page, pageSize: PAGE_SIZE, total: list?.total ?? 0, showSizeChanger: false, hideOnSinglePage: true, onChange: setPage }}
          columns={[
            { title: '对象标识', key: 'key', render: (_, item) => <Link to={openRecord(typeId, item.key)}>{item.key}</Link> },
            ...listedFields.map(field => ({
              title: field.label || field.name, key: `property:${field.code || field.name}`,
              render: (_: unknown, item: ObjectRecord) => propertyValue(item.values[field.code || field.name]),
            })),
            { title: '记录更新时间', key: 'updated_at', render: (_, item) => formatServerDateTime(item.updated_at, '—') },
          ]}
        />
      </Card>}
      {!recordError && key && (loading || !record ? <Skeleton active /> : <>
        <Card
          title={<div className="object-browser-record-title"><span>{record.key}</span><Tag>{selected.name}</Tag></div>}
          extra={<Typography.Text type="secondary">记录更新　{formatServerDateTime(record.updated_at, '—')}</Typography.Text>}
        >
          {record.binding_form && <Typography.Paragraph type="secondary">记录来源　{record.binding_form.name}</Typography.Paragraph>}
          <Table
            size="small"
            pagination={false}
            rowKey="code"
            dataSource={Object.entries(record.values).map(([code, value]) => ({ code, value, source: record.sources?.[code] }))}
            locale={{ emptyText: '暂无可查看的属性' }}
            columns={[
              { title: '属性', key: 'code', render: (_, item) => propertyLabel(selected, item.code) },
              { title: '值', key: 'value', render: (_, item) => <span className="object-browser-property-value">{propertyValue(item.value)}</span> },
              { title: '配置的来源映射', key: 'source', render: (_, item) => {
                const sources = Array.isArray(item.source) ? item.source : item.source ? [item.source] : [];
                return sources.map(sourceLabel).filter(Boolean).join('、') || '—';
              } },
            ]}
          />
        </Card>
        <Card title="关联记录" extra={<Link to={`?${new URLSearchParams({ view: 'graph', objectType: String(typeId), objectKey: record.key })}`}>
          <BranchesOutlined /> 查看关系图
        </Link>}>
          {!record.relations.length && <Empty description="暂无可浏览的关联记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          <div className="object-browser-relations">
            {record.relations.map(relation => <section key={`${relation.id}:${relation.direction}`} className="object-browser-relation">
              <div className="object-browser-relation-heading">
                <Typography.Text strong>{relation.name}</Typography.Text>
                <Tag>{relation.direction === 'outgoing' ? `关联到 ${relation.related_object_name}` : `来自 ${relation.related_object_name}`}</Tag>
              </div>
              {relation.records.length
                ? <ul>{relation.records.map(item => <li key={item.key}><Link to={openRecord(Number(relation.related_object_id), item.key)}>{item.key}</Link></li>)}</ul>
                : <Typography.Text type="secondary">{relationEmpty[relation.state]}</Typography.Text>}
              {relation.records.length > 0 && relation.total > relation.records.length && <Typography.Text type="secondary">已展示 {relation.records.length} 条，共 {relation.total} 条</Typography.Text>}
            </section>)}
          </div>
        </Card>
      </>)}
    </>}

    {settingsOpen && <ObjectRuntimeSettings models={models} initialObjectId={requestedModel ? objectTypeId(requestedModel) : typeId} onClose={() => setSettingsOpen(false)} onChange={refresh} />}
  </div>;
}
