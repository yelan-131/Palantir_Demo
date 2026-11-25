import { Alert, Button, Dropdown, Empty, Form, Modal, Select, Space, Table, Tabs, Tag, Typography, type MenuProps } from 'antd';
import { useEffect, useState } from 'react';
import { getPlatformForm, listPlatformForms, type PlatformForm, type PlatformFormField } from '../../services/api';
import {
  bindObjectRecords, bindRelationRecords, loadRelationTypes, objectRuntimeError, objectTypeId,
  type ObjectRecordBinding, type RuntimeObjectType, type RuntimeRelationType,
} from '../../services/objectRuntime';

const emptyBinding: ObjectRecordBinding = { form_id: 0, key_field: '', property_fields: {} };

function fieldName(field: PlatformFormField) {
  return field.label === field.field_name ? field.label : `${field.label}（${field.field_name}）`;
}

function objectFields(model: RuntimeObjectType | undefined) {
  return model?.fields.filter(field => field.status === 'published')
    .map(field => ({ code: field.code || field.name, label: field.label || field.name })) ?? [];
}

export default function ObjectRuntimeSettings({ models, initialObjectId, onClose, onChange }: {
  models: RuntimeObjectType[];
  initialObjectId?: number;
  onClose: () => void;
  onChange: () => void;
}) {
  const published = models.filter(model => model.status === 'published');
  return <Modal open title="对象实例配置" width={780} footer={null} onCancel={onClose}>
    <Tabs items={[
      { key: 'binding', label: '记录来源', children: <ObjectBindingEditor models={published} initialObjectId={initialObjectId} onChange={onChange} /> },
      { key: 'relation', label: '关系匹配', children: <RelationBindingEditor models={published} onChange={onChange} /> },
    ]} />
  </Modal>;
}

function ObjectBindingEditor({ models, initialObjectId, onChange }: {
  models: RuntimeObjectType[];
  initialObjectId?: number;
  onChange: () => void;
}) {
  const [objectId, setObjectId] = useState(initialObjectId);
  const selected = models.find(model => objectTypeId(model) === objectId) ?? models[0];
  return selected ? <>
    <Form layout="vertical">
      <Form.Item label="对象类型">
        <Select
          aria-label="配置记录来源的对象类型"
          value={objectTypeId(selected)}
          options={models.map(model => ({ value: objectTypeId(model), label: model.name }))}
          onChange={setObjectId}
        />
      </Form.Item>
    </Form>
    <ObjectBindingFields key={selected.id} model={selected} onChange={onChange} />
  </> : <Empty description="请先在模型设计中发布对象类型" />;
}

export function ObjectBindingFields({ model, onChange, showSourceFields = false, initialFormCode }: {
  model: RuntimeObjectType;
  onChange: () => void;
  showSourceFields?: boolean;
  initialFormCode?: string;
}) {
  const [forms, setForms] = useState<PlatformForm[]>([]);
  const [fields, setFields] = useState<PlatformFormField[]>([]);
  const [draft, setDraft] = useState(model.record_binding ?? emptyBinding);
  const [formsLoading, setFormsLoading] = useState(true);
  const [fieldsLoading, setFieldsLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saving, setSaving] = useState(false);
  const [openFieldMenu, setOpenFieldMenu] = useState<string>();
  const [revision, setRevision] = useState(0);
  const props = objectFields(model);

  useEffect(() => {
    let active = true;
    setFormsLoading(true);
    setLoadError('');
    listPlatformForms().then(response => {
      if (!active) return;
      const published = (response.data.data as PlatformForm[]).filter(form => form.status === 'published');
      setForms(published);
      const initialForm = initialFormCode ? published.find(form => form.code === initialFormCode) : undefined;
      if (initialForm) {
        setDraft(current => current.form_id ? current : { ...emptyBinding, form_id: initialForm.id });
      }
    }).catch(error => {
      if (active) setLoadError(objectRuntimeError(error, '无法读取业务表单。'));
    }).finally(() => {
      if (active) setFormsLoading(false);
    });
    return () => { active = false; };
  }, [initialFormCode, revision]);

  useEffect(() => {
    let active = true;
    setFields([]);
    if (!draft.form_id) return;
    setFieldsLoading(true);
    getPlatformForm(draft.form_id, { schema: 'published', scope: 'designer' }).then(response => {
      if (!active) return;
      const data: PlatformForm = response.data.data;
      setFields((data.fields ?? []).filter(field => !field.archived));
    }).catch(error => {
      if (active) setLoadError(objectRuntimeError(error, '无法读取发布后的表单字段。'));
    }).finally(() => {
      if (active) setFieldsLoading(false);
    });
    return () => { active = false; };
  }, [draft.form_id, revision]);

  const options = fields.map(field => ({ value: field.field_name, label: fieldName(field) }));
  const keyOptions = fields.filter(field => ['text', 'string', 'int', 'integer'].includes(field.field_type.toLowerCase()))
    .map(field => ({ value: field.field_name, label: fieldName(field) }));
  const mappedValues = Object.values(draft.property_fields);
  const allFieldsExist = mappedValues.every(value => fields.some(field => field.field_name === value));
  const ready = draft.form_id && draft.key_field && mappedValues.includes(draft.key_field) && allFieldsExist;

  function applyDraft(value: ObjectRecordBinding) {
    setDraft(value);
    setSaveError('');
    setSaveSuccess(false);
  }

  function matchFields() {
    const names = new Set(fields.map(field => field.field_name));
    const matched = Object.fromEntries(props.filter(field => names.has(field.code)).map(field => [field.code, field.code]));
    applyDraft({ ...draft, property_fields: { ...matched, ...draft.property_fields } });
  }

  function changeMapping(propertyCode: string, fieldName?: string) {
    const mapped = { ...draft.property_fields };
    if (fieldName) mapped[propertyCode] = fieldName;
    else delete mapped[propertyCode];
    applyDraft({ ...draft, property_fields: mapped });
  }

  function sourceMappingMenu(source: PlatformFormField): MenuProps {
    return {
      items: [{
        key: 'assign-property',
        type: 'group',
        label: '映射到对象属性',
        children: props.map(property => {
          const mapped = draft.property_fields[property.code];
          const label = property.label === property.code ? property.label : `${property.label}（${property.code}）`;
          return { key: property.code, label: mapped === source.field_name ? `移除 ${label} 的映射` : label };
        }),
      }],
      onClick: ({ key }) => {
        setOpenFieldMenu(undefined);
        changeMapping(key, draft.property_fields[key] === source.field_name ? undefined : source.field_name);
      },
    };
  }

  async function save() {
    setSaving(true);
    setSaveError('');
    setSaveSuccess(false);
    try {
      const response = await bindObjectRecords(objectTypeId(model), draft);
      if (response.data.data.record_binding) setDraft(response.data.data.record_binding);
      setSaveSuccess(true);
      onChange();
    } catch (error) {
      setSaveError(objectRuntimeError(error, '保存对象记录来源失败。'));
    } finally {
      setSaving(false);
    }
  }

  return <Space direction="vertical" size={14} style={{ width: '100%' }}>
    {loadError && <Alert message={loadError} type="error" showIcon action={<Button onClick={() => setRevision(value => value + 1)}>重试</Button>} />}
    {saveError && <Alert message={saveError} type="error" showIcon />}
    {saveSuccess && <Alert message="记录来源已保存" type="success" showIcon />}
    <Form layout="vertical" disabled={saving}>
      <Form.Item label="已发布的来源表单">
        <Select
          aria-label="已发布的来源表单"
          placeholder="选择承载实际记录的表单"
          showSearch
          optionFilterProp="label"
          value={draft.form_id || undefined}
          options={forms.map(form => ({ value: form.id, label: `${form.name}（${form.code}）` }))}
          loading={formsLoading}
          onChange={formId => {
            setOpenFieldMenu(undefined);
            setLoadError('');
            applyDraft({ form_id: formId, key_field: '', property_fields: {} });
          }}
        />
      </Form.Item>
      <Form.Item label="业务主键" extra="请选择发布版本中具有唯一值的字段，并将它绑定到一个对象属性。">
        <Select
          aria-label="业务主键"
          placeholder="选择主键字段"
          showSearch
          optionFilterProp="label"
          value={draft.key_field || undefined}
          loading={fieldsLoading}
          disabled={!fields.length}
          options={keyOptions}
          onChange={keyField => applyDraft({ ...draft, key_field: keyField })}
        />
      </Form.Item>
      {draft.form_id > 0 && showSourceFields && <Table
        className="object-binding-fields"
        title={() => <div className="object-browser-toolbar">
          <Space direction="vertical" size={2}>
            <Typography.Text strong>来源字段</Typography.Text>
            <Typography.Text type="secondary">右键字段或点击「映射」，选择对应的对象属性。</Typography.Text>
          </Space>
          <Button size="small" disabled={!fields.length} onClick={matchFields}>按相同编码匹配</Button>
        </div>}
        size="small"
        rowKey="field_name"
        pagination={fields.length > 10 ? { pageSize: 10, showSizeChanger: false } : false}
        loading={fieldsLoading}
        dataSource={fields}
        onRow={field => ({ onContextMenu: event => {
          if (saving || !props.length) return;
          event.preventDefault();
          setOpenFieldMenu(field.field_name);
        } })}
        columns={[
          { title: '表单字段', key: 'source', render: (_, field) => fieldName(field) },
          { title: '类型', dataIndex: 'field_type', key: 'type' },
          { title: '对象属性', key: 'properties', render: (_, field) => {
            const mapped = props.filter(property => draft.property_fields[property.code] === field.field_name);
            return mapped.length ? <Space wrap size={4}>{mapped.map(property => <Tag key={property.code}>{property.label}</Tag>)}</Space> : '—';
          } },
          { title: '操作', key: 'mapping', render: (_, field) => <Dropdown
            trigger={['click']}
            open={openFieldMenu === field.field_name}
            disabled={saving || !props.length}
            menu={sourceMappingMenu(field)}
            onOpenChange={open => setOpenFieldMenu(current => open ? field.field_name : current === field.field_name ? undefined : current)}
          >
            <Button size="small" aria-label={`映射字段 ${field.label}`}>映射</Button>
          </Dropdown> },
        ]}
      />}
      {draft.form_id > 0 && !showSourceFields && <Table
        className="object-binding-fields"
        title={() => <div className="object-browser-toolbar">
          <Typography.Text strong>对象属性绑定</Typography.Text>
          <Button size="small" disabled={!fields.length} onClick={matchFields}>按相同编码匹配</Button>
        </div>}
        size="small"
        rowKey="code"
        pagination={false}
        loading={fieldsLoading}
        dataSource={props}
        columns={[
          { title: '对象属性', key: 'label', render: (_, field) => <Space wrap>{field.label}<Tag>{field.code}</Tag></Space> },
          { title: '对应表单字段', key: 'field', render: (_, field) => <Select
            aria-label={`${field.label}对应字段`}
            showSearch
            optionFilterProp="label"
            allowClear
            placeholder="选择字段"
            disabled={!fields.length}
            value={draft.property_fields[field.code] || undefined}
            options={options}
            onChange={fieldName => changeMapping(field.code, fieldName)}
          /> },
        ]}
      />}
    </Form>
    <Button type="primary" loading={saving} disabled={!ready || formsLoading || fieldsLoading || Boolean(loadError)} onClick={save}>保存记录来源</Button>
  </Space>;
}

function RelationBindingEditor({ models, onChange }: { models: RuntimeObjectType[]; onChange: () => void }) {
  const [relations, setRelations] = useState<RuntimeRelationType[]>([]);
  const [relationId, setRelationId] = useState<number>();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError('');
    loadRelationTypes().then(response => {
      if (active) setRelations(response.data.data.filter(item => item.status === 'published'));
    }).catch(error => {
      if (active) setLoadError(objectRuntimeError(error, '无法读取已发布关系。'));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [revision]);

  const selected = relations.find(relation => objectTypeId(relation) === relationId) ?? relations[0];
  return <Space direction="vertical" size={14} style={{ width: '100%' }}>
    {loadError && <Alert message={loadError} type="error" showIcon action={<Button onClick={() => setRevision(value => value + 1)}>重试</Button>} />}
    <Form layout="vertical">
      <Form.Item label="关系类型">
        <Select
          aria-label="配置实例匹配的关系类型"
          placeholder="选择已发布关系"
          value={selected && objectTypeId(selected)}
          loading={loading}
          options={relations.map(item => ({ value: objectTypeId(item), label: `${item.name || item.label}（${item.source} → ${item.target}）` }))}
          onChange={setRelationId}
        />
      </Form.Item>
    </Form>
    {selected && !loadError ? <RelationBindingFields
      key={selected.id}
      relation={selected}
      source={models.find(model => model.code === selected.source)}
      target={models.find(model => model.code === selected.target)}
      onChange={updated => {
        setRelations(current => current.map(item => item.id === updated.id ? updated : item));
        onChange();
      }}
    /> : !loading && !loadError && <Empty description="请先在模型设计中添加并发布关系" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
  </Space>;
}

function RelationBindingFields({ relation, source, target, onChange }: {
  relation: RuntimeRelationType;
  source: RuntimeObjectType | undefined;
  target: RuntimeObjectType | undefined;
  onChange: (relation: RuntimeRelationType) => void;
}) {
  const [sourceField, setSourceField] = useState(relation.record_link?.source_field);
  const [targetField, setTargetField] = useState(relation.record_link?.target_field);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const sourceBinding = source?.record_binding;
  const targetBinding = target?.record_binding;
  const sourceOptions = objectFields(source).filter(field => sourceBinding?.property_fields[field.code]).map(field => ({ label: field.label, value: field.code }));
  const targetOptions = objectFields(target).filter(field => targetBinding && targetBinding.property_fields[field.code] === targetBinding.key_field).map(field => ({ label: field.label, value: field.code }));
  const selectedTarget = targetOptions.some(option => option.value === targetField) ? targetField : targetOptions.length === 1 ? targetOptions[0].value : undefined;

  async function save() {
    if (!sourceField || !selectedTarget) return;
    setSaving(true);
    setError('');
    setSuccess(false);
    try {
      const response = await bindRelationRecords(objectTypeId(relation), { source_field: sourceField, target_field: selectedTarget });
      onChange(response.data.data);
      setSuccess(true);
    } catch (cause) {
      setError(objectRuntimeError(cause, '保存关系匹配失败。'));
    } finally {
      setSaving(false);
    }
  }

  return <Space direction="vertical" size={14} style={{ width: '100%' }}>
    {error && <Alert message={error} type="error" showIcon />}
    {success && <Alert message="关系匹配已保存" type="success" showIcon />}
    {(!sourceBinding || !targetBinding) && <Alert message="请先为两端的对象配置记录来源。" type="info" showIcon />}
    <Form layout="vertical" disabled={saving}>
      <Form.Item label={`来源属性 · ${source?.name || relation.source}`}>
        <Select aria-label="来源匹配属性" placeholder="选择引用目标对象的属性" options={sourceOptions} value={sourceField} onChange={value => { setSourceField(value); setSuccess(false); setError(''); }} />
      </Form.Item>
      <Form.Item label={`目标主键属性 · ${target?.name || relation.target}`}>
        <Select aria-label="目标主键匹配属性" placeholder="选择目标对象的主键属性" options={targetOptions} value={selectedTarget} onChange={value => { setTargetField(value); setSuccess(false); setError(''); }} />
      </Form.Item>
    </Form>
    <Button type="primary" loading={saving} disabled={!sourceOptions.some(option => option.value === sourceField) || !selectedTarget} onClick={save}>保存关系匹配</Button>
  </Space>;
}
