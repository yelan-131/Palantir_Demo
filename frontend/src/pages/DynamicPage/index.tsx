import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Table, Button, Space, Input, Modal, Form, Tag, Spin, message,
  Popconfirm, Typography, Select, InputNumber, DatePicker, Switch,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, SearchOutlined, ArrowLeftOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  getPageByName, getModelData, createModelData, updateModelData, deleteModelData,
  listModels,
  getPlatformForm,
  listPlatformForms,
  listPlatformDynamicRecords,
  createPlatformDynamicRecord,
  updatePlatformDynamicRecord,
  deletePlatformDynamicRecord,
  type PlatformForm,
  type PlatformFormField,
} from '@/services/api';
import RelationPicker from '@/components/FormWidgets/RelationPicker';
import {
  normalizeViewConfig,
  sortByOrder,
  type ViewConfig,
  type ViewFilterConfig,
} from '@/utils/viewConfig';

interface FieldDef {
  field_name: string;
  label: string;
  field_type: string;
  required: boolean;
  searchable: boolean;
  sortable: boolean;
  visible_in_list: boolean;
  visible_in_form: boolean;
  enum_values?: string | string[] | Record<string, unknown> | null;
  relation_config?: string;
}

interface PageConfig {
  id: number;
  name: string;
  title: string;
  paradigm: string;
  model_id: number;
  model_name: string;
  config: {
    list_fields?: string[];
    form_fields?: string[];
    search_fields?: string[];
    viewConfig?: ViewConfig;
  };
}

function renderFormField(field: FieldDef) {
  switch (field.field_type) {
    case 'int':
    case 'float':
    case 'integer':
    case 'number':
    case 'decimal':
      return (
        <Form.Item
          key={field.field_name}
          name={field.field_name}
          label={field.label}
          rules={[{ required: field.required, message: `请输入${field.label}` }]}
        >
          <InputNumber style={{ width: '100%' }} placeholder={`请输入${field.label}`} />
        </Form.Item>
      );
    case 'enum': {
      let opts: { label: string; value: string }[] = [];
      if (field.enum_values) {
        const parsed = typeof field.enum_values === 'string' ? (() => {
          try { return JSON.parse(field.enum_values || '[]'); } catch { return []; }
        })() : field.enum_values;
        const values = Array.isArray(parsed)
          ? parsed
          : Object.entries(parsed ?? {}).map(([value, label]) => ({ value, label }));
        opts = values.map((item: any) => (
          typeof item === 'string'
            ? { label: item, value: item }
            : { label: String(item.label ?? item.value), value: String(item.value ?? item.label) }
        ));
      }
      return (
        <Form.Item
          key={field.field_name}
          name={field.field_name}
          label={field.label}
          rules={[{ required: field.required, message: `请选择${field.label}` }]}
        >
          <Select options={opts} placeholder={`请选择${field.label}`} allowClear />
        </Form.Item>
      );
    }
    case 'date':
    case 'datetime':
      return (
        <Form.Item
          key={field.field_name}
          name={field.field_name}
          label={field.label}
          rules={[{ required: field.required, message: `请选择${field.label}` }]}
          getValueProps={(v) => ({ value: v ? dayjs(v) : undefined })}
        >
          <DatePicker style={{ width: '100%' }} placeholder={`请选择${field.label}`} />
        </Form.Item>
      );
    case 'boolean':
      return (
        <Form.Item
          key={field.field_name}
          name={field.field_name}
          label={field.label}
          valuePropName="checked"
        >
          <Switch />
        </Form.Item>
      );
    case 'text':
      return (
        <Form.Item
          key={field.field_name}
          name={field.field_name}
          label={field.label}
          rules={[{ required: field.required, message: `请输入${field.label}` }]}
        >
          <Input.TextArea rows={3} placeholder={`请输入${field.label}`} />
        </Form.Item>
      );
    case 'relation': {
      let targetModel = '';
      if (field.relation_config) {
        try {
          const config = JSON.parse(field.relation_config);
          targetModel = config.target_model || config.target_table || '';
        } catch { /* ignore */ }
      }
      if (!targetModel) {
        return (
          <Form.Item
            key={field.field_name}
            name={field.field_name}
            label={field.label}
            rules={[{ required: field.required, message: `请输入${field.label}` }]}
          >
            <Input placeholder={`请输入${field.label}`} />
          </Form.Item>
        );
      }
      return (
        <Form.Item
          key={field.field_name}
          name={field.field_name}
          label={field.label}
          rules={[{ required: field.required, message: `请选择${field.label}` }]}
        >
          <RelationPicker
            modelName={targetModel}
            placeholder={`请选择${field.label}`}
          />
        </Form.Item>
      );
    }
    default:
      return (
        <Form.Item
          key={field.field_name}
          name={field.field_name}
          label={field.label}
          rules={[{ required: field.required, message: `请输入${field.label}` }]}
        >
          <Input placeholder={`请输入${field.label}`} />
        </Form.Item>
      );
  }
}

function formFieldsToPayload(values: Record<string, unknown>, fields: FieldDef[]): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(values)) {
    if (dayjs.isDayjs(val)) {
      payload[key] = val.format('YYYY-MM-DD');
    } else {
      payload[key] = val;
    }
  }
  return payload;
}

function mapPlatformField(field: PlatformFormField): FieldDef {
  return {
    field_name: field.field_name,
    label: field.label,
    field_type: field.field_type,
    required: field.required,
    searchable: field.searchable,
    sortable: field.sortable,
    visible_in_list: field.visible_in_list,
    visible_in_form: field.visible_in_form,
    enum_values: field.enum_values,
    relation_config: (field.ui_config as any)?.relation_config,
  };
}

function fieldToViewField(field: FieldDef) {
  return {
    fieldName: field.field_name,
    label: field.label,
    fieldType: field.field_type,
    searchable: field.searchable,
    sortable: field.sortable,
    visibleInList: field.visible_in_list,
  };
}

function filterValueToPayload(filter: ViewFilterConfig, value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  if (Array.isArray(value) && value.length === 0) return null;
  if (filter.controlType === 'dateRange' && Array.isArray(value)) {
    const [start, end] = value;
    return {
      field: filter.fieldName,
      op: filter.operator || 'between',
      value: [dayjs.isDayjs(start) ? start.format('YYYY-MM-DD') : start, dayjs.isDayjs(end) ? end.format('YYYY-MM-DD') : end],
    };
  }
  return { field: filter.fieldName, op: filter.operator, value };
}

function unwrapApiData<T>(payload: unknown): T | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = (payload as { data?: unknown }).data;
  if (data && typeof data === 'object' && 'data' in data) {
    return (data as { data?: T }).data ?? null;
  }
  return (data as T) ?? null;
}

function unwrapApiList<T>(payload: unknown): T[] {
  const data = unwrapApiData<unknown>(payload);
  return Array.isArray(data) ? data as T[] : [];
}

export default function DynamicPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [pageConfig, setPageConfig] = useState<PageConfig | null>(null);
  const [platformForm, setPlatformForm] = useState<PlatformForm | null>(null);
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [data, setData] = useState<Record<string, any>[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterValues, setFilterValues] = useState<Record<string, unknown>>({});

  const [modalOpen, setModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<Record<string, any> | null>(null);
  const [form] = Form.useForm();
  const [filterForm] = Form.useForm();
  const [confirmLoading, setConfirmLoading] = useState(false);

  const viewConfig = useMemo(() => normalizeViewConfig(
    pageConfig?.config?.viewConfig,
    fields.map(fieldToViewField),
    pageConfig?.config?.search_fields,
  ), [fields, pageConfig?.config?.search_fields, pageConfig?.config?.viewConfig]);

  const activeFilters = useMemo(() => sortByOrder(viewConfig.filters).filter((filter) => filter.enabled), [viewConfig.filters]);
  const tableConfigColumns = useMemo(() => sortByOrder(viewConfig.table.columns).filter((column) => column.enabled), [viewConfig.table.columns]);
  const structuredFilters = useMemo(() => activeFilters
    .map((filter) => filterValueToPayload(filter, filterValues[filter.id] ?? filter.defaultValue))
    .filter(Boolean), [activeFilters, filterValues]);

  const loadData = useCallback(async () => {
    if (!slug || (!pageConfig && !platformForm)) return;
    setLoading(true);
    try {
      if (platformForm) {
        const res = await listPlatformDynamicRecords(platformForm.id, {
          page,
          page_size: viewConfig.table.pageSize,
          search: search || undefined,
          filters: structuredFilters.length ? JSON.stringify(structuredFilters) : undefined,
        });
        const records = unwrapApiList<any>(res);
        setData(records.map((record) => ({ id: record.id, ...(record.data || {}), _status: record.status })));
        setTotal(res.data?.total ?? records.length);
      } else if (pageConfig) {
        const res = await getModelData(pageConfig.model_name, { page, page_size: 20, search: search || undefined });
        setData(res.data?.data || []);
        setTotal(res.data?.total || 0);
      }
    } catch { message.error('加载数据失败'); }
    finally { setLoading(false); }
  }, [slug, pageConfig, platformForm, page, search, structuredFilters, viewConfig.table.pageSize]);

  useEffect(() => {
    (async () => {
      if (!slug) return;
      try {
        const numericFormId = Number(slug);
        let dbForm: PlatformForm | null = null;
        if (!Number.isNaN(numericFormId)) {
          dbForm = unwrapApiData<PlatformForm>(await getPlatformForm(numericFormId));
        } else {
          dbForm = unwrapApiList<PlatformForm>(await listPlatformForms()).find((item) => item.code === slug) ?? null;
        }
        if (dbForm) {
          setPlatformForm(dbForm);
          setFields((dbForm.fields ?? []).filter((field) => !field.archived).map(mapPlatformField));
          setPageConfig({
            id: dbForm.id,
            name: dbForm.code,
            title: dbForm.name,
            paradigm: 'platform_form',
            model_id: dbForm.model_id ?? 0,
            model_name: dbForm.code,
            config: {
              list_fields: dbForm.fields?.filter((field) => field.visible_in_list && !field.archived).map((field) => field.field_name),
              form_fields: dbForm.fields?.filter((field) => field.visible_in_form && !field.archived).map((field) => field.field_name),
              search_fields: dbForm.fields?.filter((field) => field.searchable && !field.archived).map((field) => field.field_name),
              viewConfig: (dbForm.config as any)?.viewConfig,
            },
          });
          return;
        }
        const res = await getPageByName(slug);
        const pc = res.data;
        setPlatformForm(null);
        setPageConfig(pc);
        if (pc?.model_id) {
          try {
            const modelsRes = await listModels();
            const models = modelsRes.data?.data || [];
            const model = models.find((m: any) => m.id === pc.model_id || m.name === pc.model_name);
            if (model?.fields) {
              setFields(model.fields);
            }
          } catch { /* fields will remain empty, fallback to config */ }
        }
      } catch {
        message.error('页面配置不存在');
      }
    })();
  }, [slug]);

  useEffect(() => { loadData(); }, [loadData]);

  const listFields = tableConfigColumns.length
    ? tableConfigColumns.map((column) => column.fieldName)
    : pageConfig?.config?.list_fields ||
      fields.filter(f => f.visible_in_list).map(f => f.field_name);

  const formFieldNames = pageConfig?.config?.form_fields ||
    fields.filter(f => f.visible_in_form).map(f => f.field_name);

  const formFields = formFieldNames
    .map(fn => fields.find(f => f.field_name === fn))
    .filter((f): f is FieldDef => !!f);

  const tableColumns = listFields.map(field_name => {
    const f = fields.find(x => x.field_name === field_name);
    const viewColumn = tableConfigColumns.find((column) => column.fieldName === field_name);
    return {
      title: viewColumn?.label || f?.label || field_name,
      dataIndex: field_name,
      key: field_name,
      width: viewColumn?.width,
      fixed: viewColumn?.fixed,
      ellipsis: true,
      sorter: viewColumn?.sortable || f?.sortable ? true : undefined,
      render: (val: any) => {
        if (typeof val === 'boolean') return val ? '是' : '否';
        if (val === undefined || val === null || val === '') return viewColumn?.emptyText || '-';
        if (typeof val === 'boolean') return val ? '是' : '否';
        if ((viewColumn?.renderType === 'tag' || f?.field_type === 'enum') && val) return <Tag>{String(val)}</Tag>;
        if (field_name === 'status') {
          const colorMap: Record<string, string> = {
            running: 'green', idle: 'orange', maintenance: 'blue',
            fault: 'red', offline: 'default', active: 'green',
            pending: 'default', in_progress: 'blue', completed: 'green',
          };
          return <Tag color={colorMap[val] || 'default'}>{String(val)}</Tag>;
        }
        return String(val ?? '');
      },
    };
  });

  (tableColumns as any[]).push({
    title: '操作', width: 120, fixed: 'right',
    render: (_val: any, record: any) => (
      <Space size={4}>
        <Button size="small" icon={<EditOutlined />} onClick={() => openEditModal(record)} />
        <Popconfirm title="确定删除？" onConfirm={() => handleDelete(record.id)}>
          <Button size="small" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      </Space>
    ),
  });

  const openCreateModal = () => {
    setEditingRecord(null);
    form.resetFields();
    setModalOpen(true);
  };

  const openEditModal = (record: Record<string, any>) => {
    setEditingRecord(record);
    const formValues: Record<string, any> = {};
    for (const fn of formFieldNames) {
      const f = fields.find(x => x.field_name === fn);
      if (f?.field_type === 'date' && record[fn]) {
        formValues[fn] = dayjs(record[fn]);
      } else {
        formValues[fn] = record[fn] ?? undefined;
      }
    }
    form.setFieldsValue(formValues);
    setModalOpen(true);
  };

  const handleModalOk = async () => {
    try {
      const values = await form.validateFields();
      const payload = formFieldsToPayload(values, fields);
      setConfirmLoading(true);
      if (platformForm && editingRecord) {
        await updatePlatformDynamicRecord(platformForm.id, editingRecord.id, payload);
        message.success('Saved');
      } else if (platformForm) {
        await createPlatformDynamicRecord(platformForm.id, payload);
        message.success('Created');
      } else if (editingRecord) {
        await updateModelData(pageConfig!.model_name, editingRecord.id, payload);
        message.success('更新成功');
      } else {
        await createModelData(pageConfig!.model_name, payload);
        message.success('创建成功');
      }
      setModalOpen(false);
      loadData();
    } catch (e: any) {
      if (e?.errorFields) return; // form validation error
      message.error(editingRecord ? '更新失败' : '创建失败');
    } finally {
      setConfirmLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      if (platformForm) {
        await deletePlatformDynamicRecord(platformForm.id, id);
      } else {
        await deleteModelData(pageConfig!.model_name, id);
      }
      message.success('已删除');
      loadData();
    } catch { message.error('删除失败'); }
  };

  const renderDynamicFilterControl = (filter: ViewFilterConfig) => {
    const field = fields.find((item) => item.field_name === filter.fieldName);
    const placeholder = filter.placeholder || filter.label;
    if (filter.controlType === 'dateRange') return <DatePicker.RangePicker style={{ width: '100%' }} />;
    if (filter.controlType === 'date') return <DatePicker style={{ width: '100%' }} placeholder={placeholder} />;
    if (filter.controlType === 'number') return <InputNumber style={{ width: '100%' }} placeholder={placeholder} />;
    if (filter.controlType === 'select' || field?.field_type === 'enum') {
      let opts: { label: string; value: string }[] = [];
      if (field?.enum_values) {
        const parsed = typeof field.enum_values === 'string' ? (() => {
          try { return JSON.parse(field.enum_values || '[]'); } catch { return []; }
        })() : field.enum_values;
        const values = Array.isArray(parsed)
          ? parsed
          : Object.entries(parsed ?? {}).map(([value, label]) => ({ value, label }));
        opts = values.map((item: any) => (
          typeof item === 'string'
            ? { label: item, value: item }
            : { label: String(item.label ?? item.value), value: String(item.value ?? item.label) }
        ));
      }
      return <Select allowClear placeholder={placeholder} options={opts} />;
    }
    return <Input allowClear prefix={filter.controlType === 'keyword' ? <SearchOutlined /> : undefined} placeholder={placeholder} />;
  };

  if (!pageConfig) {
    return <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>;
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>返回</Button>
          <Typography.Title level={4} style={{ margin: 0 }}>{pageConfig.title}</Typography.Title>
          <Tag color={platformForm ? 'green' : 'blue'}>{platformForm ? 'database form' : pageConfig.model_name}</Tag>
        </Space>
        <Space>
          <Input.Search
            placeholder="搜索..."
            allowClear
            style={{ width: 200 }}
            onSearch={setSearch}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>新建</Button>
        </Space>
      </div>

      <Form
        className="dynamic-view-filter-bar"
        form={filterForm}
        layout="vertical"
        onFinish={(values) => {
          setPage(1);
          setSearch(String(values.keyword || ''));
          setFilterValues(values);
        }}
      >
        {activeFilters.map((filter) => (
          <Form.Item key={filter.id} name={filter.id} label={filter.label} initialValue={filter.defaultValue}>
            {renderDynamicFilterControl(filter)}
          </Form.Item>
        ))}
        <Form.Item className="dynamic-view-filter-actions" label=" ">
          <Space>
            <Button onClick={() => {
              filterForm.resetFields();
              setSearch('');
              setFilterValues({});
              setPage(1);
            }}>重置</Button>
            <Button type="primary" htmlType="submit" icon={<SearchOutlined />}>查询</Button>
          </Space>
        </Form.Item>
      </Form>

      <Table
        dataSource={data}
        columns={tableColumns}
        rowKey="id"
        loading={loading}
        size={viewConfig.table.density === 'compact' ? 'small' : viewConfig.table.density === 'large' ? 'large' : 'middle'}
        scroll={{ x: 'max-content' }}
        pagination={{
          current: page,
          total,
          pageSize: viewConfig.table.pageSize,
          showTotal: (t) => `共 ${t} 条`,
          onChange: (p) => setPage(p),
        }}
      />

      <Modal
        title={editingRecord ? '编辑记录' : '新建记录'}
        open={modalOpen}
        onOk={handleModalOk}
        onCancel={() => setModalOpen(false)}
        confirmLoading={confirmLoading}
        width={640}
        styles={{ body: { paddingTop: 16 } }}
      >
        <Form
          form={form}
          layout="vertical"
          size="middle"
          style={{ marginTop: 16 }}
        >
          {formFields.map(f => renderFormField(f))}
        </Form>
      </Modal>
    </div>
  );
}
