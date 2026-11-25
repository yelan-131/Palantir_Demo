import { useEffect, useState } from 'react';
import { Alert, Button, Descriptions, Empty, Form, Input, Modal, Select, Space, Table, Tag } from 'antd';
import { isAxiosError } from 'axios';
import { Link } from 'react-router-dom';
import {
  getDataSourceMetadata,
  getDataSourceSyncStatus,
  listPlatformForms,
  listSemanticOntologyMappings,
  listSemanticOntologyObjects,
  type MappedFormSyncRequest,
  type OntologyMappingInfo,
  type OntologyObjectInfo,
  type PlatformForm,
} from '@/services/api';
import {
  listMappedFormSyncBindings, listMappedFormSyncRuns, runMappedFormSync, saveMappedFormSyncBinding,
  type MappedFormSyncBinding, type MappedFormSyncRun,
} from '@/services/mappedFormSyncApi';
import { formatServerDateTime } from '@/utils/dateTime';

interface Props {
  sourceId: number;
  sourceName: string;
  initialEntity?: string;
  onClose: () => void;
  onSynced: () => void;
}

interface SourceTable {
  value: string;
  label: string;
  primaryKey: string;
}

type SyncObject = OntologyObjectInfo & { record_binding?: { form_id: number } | null };

export default function MappedFormSyncDialog({ sourceId, sourceName, initialEntity, onClose, onSynced }: Props) {
  const [form] = Form.useForm<MappedFormSyncRequest>();
  const selectedTable = Form.useWatch('entity_name', form);
  const selectedObject = Form.useWatch('object_code', form);
  const selectedForm = Form.useWatch('form_id', form);
  const [tables, setTables] = useState<SourceTable[]>([]);
  const [mappings, setMappings] = useState<OntologyMappingInfo[]>([]);
  const [objects, setObjects] = useState<SyncObject[]>([]);
  const [forms, setForms] = useState<PlatformForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [bindings, setBindings] = useState<MappedFormSyncBinding[]>([]);
  const [runs, setRuns] = useState<MappedFormSyncRun[]>([]);
  const [scanFinishedAt, setScanFinishedAt] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [pending, setPending] = useState<'save' | 'sync'>();
  const [syncError, setSyncError] = useState('');

  const binding = bindings.find(item => item.entity_name === selectedTable
    && item.object_code === selectedObject && item.form_id === selectedForm);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    void Promise.all([
      getDataSourceMetadata(sourceId),
      listSemanticOntologyMappings(),
      listSemanticOntologyObjects(),
      listPlatformForms(),
      listMappedFormSyncBindings(sourceId),
      getDataSourceSyncStatus(sourceId),
    ]).then(([metadataResponse, mappingResponse, objectResponse, formResponse, bindingResponse, scanResponse]) => {
      if (!active) return;
      setTables(metadataResponse.data.data.flatMap(table => {
        const keys = table.fields.filter(field => field.primary_key === true);
        return table.status === 'scanned' && keys.length === 1 && typeof keys[0].name === 'string'
          ? [{
            value: table.entity_name,
            label: table.entity_label && table.entity_label !== table.entity_name
              ? `${table.entity_label} (${table.entity_name})`
              : table.entity_name,
            primaryKey: keys[0].name,
          }]
          : [];
      }));
      setMappings(mappingResponse.data.data.filter(mapping =>
        mapping.source_system === String(sourceId)
          && ['approved', 'published'].includes(mapping.status)
          && mapping.target_field_code,
      ));
      setObjects(objectResponse.data.data);
      setForms((formResponse.data.data as PlatformForm[]).filter(item => item.status === 'published'));
      const saved = bindingResponse.data.data;
      setBindings(saved);
      setScanFinishedAt(scanResponse.data.data?.last_finished_at ?? null);
      const relevant = initialEntity ? saved.filter(item => item.entity_name === initialEntity) : saved;
      if (relevant.length === 1) {
        const { entity_name, object_code, form_id } = relevant[0];
        form.setFieldsValue({ entity_name, object_code, form_id });
      } else if (initialEntity) {
        form.setFieldValue('entity_name', initialEntity);
      }
    }).catch(() => {
      if (active) setLoadFailed(true);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [sourceId, initialEntity, form, reload]);

  useEffect(() => {
    let active = true;
    setRuns([]);
    setHistoryLoading(false);
    setHistoryError(false);
    if (!binding) return;
    setHistoryLoading(true);
    void listMappedFormSyncRuns(sourceId, binding.id).then(response => {
      if (active) setRuns(response.data.data);
    }).catch(() => {
      if (active) setHistoryError(true);
    }).finally(() => {
      if (active) setHistoryLoading(false);
    });
    return () => { active = false; };
  }, [sourceId, binding, historyRevision]);

  const table = tables.find(item => item.value === selectedTable);
  const mappedObjects = new Set(mappings.filter(mapping =>
    mapping.source_entity === table?.value && mapping.source_field === table?.primaryKey,
  ).map(mapping => mapping.target_object_code));
  const objectOptions = objects.filter(item => mappedObjects.has(item.code)).map(item => ({
    value: item.code,
    label: `${item.name} (${item.code})`,
  }));
  const backingFormId = objects.find(item => item.code === selectedObject)?.record_binding?.form_id;
  const formOptions = forms.filter(item => !backingFormId || item.id === backingFormId)
    .map(item => ({ value: item.id, label: `${item.name} (${item.code})` }));

  const applyBinding = (id: number) => {
    const chosen = bindings.find(item => item.id === id);
    if (chosen) {
      const { entity_name, object_code, form_id } = chosen;
      form.setFieldsValue({ entity_name, object_code, form_id, source_key: undefined });
      setSyncError('');
    }
  };

  const submit = async (action: 'save' | 'sync') => {
    const values = await form.validateFields().catch(() => undefined);
    if (!values || pending) return;
    setPending(action);
    setSyncError('');
    try {
      const { entity_name, object_code, form_id, source_key } = values;
      const saved = binding ?? (await saveMappedFormSyncBinding(sourceId, { entity_name, object_code, form_id })).data.data;
      if (!binding) setBindings(current => [...current.filter(item => item.id !== saved.id), saved]);
      if (action === 'sync') {
        await runMappedFormSync(sourceId, saved.id, source_key || undefined);
        onSynced();
      }
    } catch (cause) {
      const detail: unknown = isAxiosError(cause) ? cause.response?.data?.detail : undefined;
      setSyncError(typeof detail === 'string' ? detail : action === 'save' ? '保存同步绑定失败' : '同步失败，请核对来源和绑定配置。');
    } finally {
      setPending(undefined);
      setHistoryRevision(current => current + 1);
    }
  };

  const canSubmit = !loading && !loadFailed && Boolean(table)
    && objectOptions.some(item => item.value === selectedObject)
    && formOptions.some(item => item.value === selectedForm);

  return (
    <Modal
      title="同步绑定"
      width={760}
      open
      onCancel={pending ? undefined : onClose}
      closable={!pending}
      maskClosable={!pending}
      keyboard={!pending}
      footer={[
        <Button key="close" disabled={Boolean(pending)} onClick={onClose}>关闭</Button>,
        <Button key="save" loading={pending === 'save'} disabled={!canSubmit || Boolean(binding) || pending === 'sync'} onClick={() => void submit('save')}>保存绑定</Button>,
        <Button key="run" type="primary" loading={pending === 'sync'} disabled={!canSubmit || pending === 'save'} onClick={() => void submit('sync')}>同步入表</Button>,
      ]}
    >
      <Descriptions size="small" items={[
        { key: 'source', label: '数据源', children: sourceName },
        { key: 'scan', label: '最近扫描结束', children: formatServerDateTime(scanFinishedAt, '暂无') },
      ]} column={{ xs: 1, sm: 2 }} />
      {loadFailed && <Alert type="error" showIcon message="无法加载同步选项" action={<Button onClick={() => setReload(value => value + 1)}>重试</Button>} />}
      <Form form={form} layout="vertical" disabled={Boolean(pending)} onValuesChange={() => setSyncError('')}>
        {!!bindings.length && (
          <Form.Item label="已保存绑定">
            <Select showSearch optionFilterProp="label" value={binding?.id} placeholder="选择绑定以复用配置" onChange={applyBinding}
              options={bindings.map(item => ({
                value: item.id,
                label: `${item.entity_name} → ${objects.find(object => object.code === item.object_code)?.name ?? item.object_code} → ${forms.find(target => target.id === item.form_id)?.name ?? item.form_id}`,
              }))} />
          </Form.Item>
        )}
        <Form.Item name="entity_name" label="源表" rules={[{ required: true, message: '请选择源表' }]}>
          <Select
            showSearch optionFilterProp="label" loading={loading} disabled={loadFailed}
            placeholder="选择已扫描且具有单列主键的表" options={tables}
            notFoundContent={tables.length ? '没有匹配的表' : <Link to="/data-center/assets?view=data">前往资产目录扫描具有单列主键的表</Link>}
            onChange={() => form.setFieldsValue({ object_code: undefined, form_id: undefined, source_key: undefined })}
          />
        </Form.Item>
        <Form.Item name="object_code" label="映射对象" rules={[{ required: true, message: '请选择映射对象' }]}>
          <Select
            showSearch optionFilterProp="label" placeholder="选择已审核源主键映射的对象"
            disabled={!table || loadFailed} options={objectOptions}
            notFoundContent={objectOptions.length ? '没有匹配的对象' : <Link to={`/data-center/objects?view=ontology&section=mapping&sourceId=${sourceId}`}>前往模型设计配置主键映射</Link>}
            onChange={code => form.setFieldValue('form_id', objects.find(item => item.code === code)?.record_binding?.form_id)}
          />
        </Form.Item>
        <Form.Item
          name="form_id" label="目标表单" rules={[{ required: true, message: '请选择目标表单' }]}
          extra="选择无需提交审批的表单。表单字段编码须与对象字段编码一致。同步按源主键匹配已有记录，对应表单字段须配置唯一校验。"
        >
          <Select showSearch optionFilterProp="label" loading={loading} disabled={!selectedObject || loadFailed} placeholder="选择已发布表单" options={formOptions} />
        </Form.Item>
        <Form.Item name="source_key" label="源主键值" extra="留空时同步整表，整表最多 500 行。输入主键值可同步指定行。">
          <Input disabled={!table || loadFailed} maxLength={200} placeholder={table ? `输入 ${table.primaryKey} 的值（可选）` : '先选择源表'} />
        </Form.Item>
      </Form>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        {syncError && <Alert type="error" showIcon message={syncError} />}
        {historyError && <Alert type="warning" showIcon message="读取同步记录失败" action={<Button onClick={() => setHistoryRevision(value => value + 1)}>重试</Button>} />}
        {binding && !historyError && (
          <Table<MappedFormSyncRun>
            rowKey="id" size="small" loading={historyLoading} pagination={false} scroll={{ x: 630 }}
            title={() => '最近入表记录'} dataSource={runs.slice(0, 8)}
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无入表记录" /> }}
            columns={[
              { title: '完成时间', dataIndex: 'finished_at', width: 140, render: value => formatServerDateTime(value) },
              { title: '范围', dataIndex: 'source_key', width: 130, render: value => value || '整表' },
              { title: '结果', key: 'result', render: (_, run) => run.status === 'completed'
                ? <Space wrap size="small"><Tag color="success">完成</Tag><span>读取 {run.read}，新增 {run.created}，更新 {run.updated}，无变化 {run.unchanged}</span></Space>
                : <Space wrap size="small"><Tag color="error">失败</Tag><span>{run.error_message || '同步失败'}</span></Space> },
            ]}
          />
        )}
      </Space>
    </Modal>
  );
}
