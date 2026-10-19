import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useShellPageTitle } from '@/components/ShellPageTitle';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Table, Button, Space, Input, Modal, Form, Tag, Spin, message,
  Popconfirm, Typography, Select, InputNumber, DatePicker, Switch,
  Row, Col, Tooltip, Empty, Drawer, Descriptions, Timeline, Tabs, Alert,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, SearchOutlined,
  ReloadOutlined, DownloadOutlined, SettingOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  getPlatformForm,
  getPlatformFormByCode,
  listPlatformForms,
  listPlatformDynamicRecords,
  createPlatformDynamicRecord,
  getPlatformDynamicRecord,
  submitPlatformDynamicRecord,
  approvalStatusLabels,
  type RecordApproval,
  updatePlatformDynamicRecord,
  deletePlatformDynamicRecord,
  type PlatformForm,
  type PlatformFormField,
  evaluateFormRules,
} from '@/services/api';
import RelationPicker from '@/components/FormWidgets/RelationPicker';
import {
  sortByOrder,
  type ViewConfig,
  type ViewFilterConfig,
  type ViewTableDensity,
} from '@/utils/viewConfig';
import '../AppPrograms/style.css';
import './style.css';

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
  generated_code?: boolean;
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
    formFieldNames?: string[];
  };
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getPublishedViewConfig(config?: Record<string, unknown> | null): ViewConfig | undefined {
  const viewConfig = config?.viewConfig;
  return isRecord(viewConfig) ? viewConfig as ViewConfig : undefined;
}

function isAnalysisAssembly(config?: Record<string, unknown> | null, codeValue?: unknown) {
  const kind = String(config?.assemblyKind || config?.kind || config?.type || '').toLowerCase();
  const code = String(codeValue || '').toLowerCase();
  return (
    ['analysis', 'analytics', 'dashboard', 'report', 'bi_report', 'metric_dashboard', 'list_analysis'].includes(kind)
    || code.includes('dashboard')
    || code.includes('overview')
    || code.includes('report')
    || code.includes('analysis')
  );
}

function normalizeRuntimeViewConfig(config: unknown, fields: FieldDef[]): ViewConfig | null {
  if (!isRecord(config)) return null;
  const table = isRecord(config.table) ? config.table : {};
  const sourceColumns = Array.isArray(table.columns) ? table.columns : [];
  const fieldByName = new Map(fields.map((field) => [field.field_name, field]));
  const columns = sourceColumns
    .filter((column): column is Record<string, any> => isRecord(column) && fieldByName.has(String(column.fieldName)))
    .map((column, index) => {
      const field = fieldByName.get(String(column.fieldName));
      return {
        id: String(column.id || `column-${column.fieldName}`),
        fieldName: String(column.fieldName),
        label: String(column.label || field?.label || column.fieldName),
        enabled: column.enabled !== false,
        width: typeof column.width === 'number' ? column.width : undefined,
        fixed: column.fixed === 'left' || column.fixed === 'right' ? column.fixed : undefined,
        sortable: Boolean(column.sortable),
        renderType: ['text', 'tag', 'date', 'number', 'progress'].includes(String(column.renderType)) ? column.renderType as ViewConfig['table']['columns'][number]['renderType'] : 'text',
        emptyText: String(column.emptyText || '-'),
        sortOrder: Number.isFinite(column.sortOrder) ? Number(column.sortOrder) : index,
      };
    });
  if (!columns.length) return null;

  const sourceFilters = Array.isArray(config.filters) ? config.filters : [];
  const filters = sourceFilters
    .filter((filter): filter is Record<string, any> => isRecord(filter) && fieldByName.has(String(filter.fieldName)))
    .map((filter, index) => {
      const field = fieldByName.get(String(filter.fieldName));
      return {
        id: String(filter.id || `filter-${filter.fieldName}`),
        fieldName: String(filter.fieldName),
        label: String(filter.label || field?.label || filter.fieldName),
        controlType: ['keyword', 'text', 'select', 'dateRange', 'date', 'number', 'relation'].includes(String(filter.controlType)) ? filter.controlType as ViewConfig['filters'][number]['controlType'] : 'text',
        operator: ['contains', 'equals', 'between', 'gte', 'lte'].includes(String(filter.operator)) ? filter.operator as ViewConfig['filters'][number]['operator'] : 'contains',
        defaultValue: filter.defaultValue,
        placeholder: filter.placeholder ? String(filter.placeholder) : undefined,
        enabled: filter.enabled !== false,
        advanced: Boolean(filter.advanced),
        sortOrder: Number.isFinite(filter.sortOrder) ? Number(filter.sortOrder) : index,
      };
    });

  const density = ['compact', 'middle', 'large'].includes(String(table.density)) ? table.density as ViewTableDensity : 'middle';
  return {
    filters,
    table: {
      columns,
      defaultSort: isRecord(table.defaultSort) ? table.defaultSort as ViewConfig['table']['defaultSort'] : undefined,
      pageSize: Number.isFinite(table.pageSize) ? Number(table.pageSize) : 20,
      density,
      rowClickAction: ['detail', 'edit', 'none'].includes(String(table.rowClickAction)) ? table.rowClickAction as ViewConfig['table']['rowClickAction'] : 'detail',
      toolbarActions: Array.isArray(table.toolbarActions) ? table.toolbarActions.map(String) : [],
      rowActions: Array.isArray(table.rowActions) ? table.rowActions.map(String) : [],
    },
  };
}

function getPublishedFormFieldNames(config: Record<string, unknown> | null | undefined, fields: FieldDef[]) {
  const layout = isRecord(config?.formLayout) ? config?.formLayout : undefined;
  const sections = Array.isArray(layout?.sections) ? layout.sections : [];
  const fieldNames = sections.flatMap((section) => {
    if (!isRecord(section) || !Array.isArray(section.fields)) return [];
    return section.fields
      .map((item) => {
        if (typeof item === 'string') return item;
        if (isRecord(item)) return item.fieldName || item.field_name;
        return '';
      })
      .filter(Boolean)
      .map(String);
  });
  const available = new Set(fields.map((field) => field.field_name));
  return Array.from(new Set(fieldNames.filter((fieldName) => available.has(fieldName))));
}

const dynamicProgramRouteAliases: Record<string, string> = {
  'equipment-inspection': '/program/equipment-inspection',
  'inventory-impact': '/program/inventory-impact',
  'supplier-scorecard': '/program/supplier-scorecard',
};

type FieldRuntime = { formId?: number; data?: Record<string, unknown>; states?: Record<string, { visible: boolean; required: boolean; readonly: boolean }> };

function renderFormField(field: FieldDef, runtime: FieldRuntime = {}) {
  const state = runtime.states?.[field.field_name];
  if (state?.visible === false) return null;
  const item = renderFormFieldControl({ ...field, required: state?.required ?? field.required }, runtime);
  if (!React.isValidElement(item)) return item;
  const child = (item.props as any).children;
  return React.isValidElement(child) ? React.cloneElement(item, {}, React.cloneElement(child as React.ReactElement<any>, {
    disabled: Boolean(state?.readonly || (child.props as any).disabled),
  })) : item;
}

function renderFormFieldControl(field: FieldDef, runtime: FieldRuntime) {
  if (field.generated_code) {
    return <Form.Item key={field.field_name} name={field.field_name} label={field.label}
      extra="保存时按编码规则自动生成"><Input disabled placeholder="保存后自动生成" /></Form.Item>;
  }
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
          <DatePicker showTime={field.field_type === 'datetime'} style={{ width: '100%' }} placeholder={`请选择${field.label}`} />
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
          targetModel = config.target_form_code || config.target_model || config.target_table || '';
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
            formId={runtime.formId}
            fieldName={field.field_name}
            contextData={runtime.data}
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
      payload[key] = val.format(fields.find(field => field.field_name === key)?.field_type === 'datetime'
        ? 'YYYY-MM-DDTHH:mm:ss' : 'YYYY-MM-DD');
    } else {
      payload[key] = val;
    }
  }
  return payload;
}

function isWideFormField(field: FieldDef) {
  return ['text', 'json'].includes(field.field_type) || field.field_name.toLowerCase().includes('remark');
}

function mapPlatformField(field: PlatformFormField): FieldDef {
  const ui = (field.ui_config || {}) as Record<string, any>;
  const encoding = (field as any).encoding_rule || ui.encodingRule || {};
  const codeField = (field as any).business_type === 'code' || (field as any).control_type === 'code'
    || field.field_type === 'code' || ui.businessType === 'code' || ui.controlType === 'code' || ui.encodingRule;
  return {
    field_name: field.field_name,
    label: field.label,
    field_type: ui.controlType === 'relation' ? 'relation' : field.field_type,
    required: field.required,
    searchable: field.searchable,
    sortable: field.sortable,
    visible_in_list: field.visible_in_list,
    visible_in_form: field.visible_in_form,
    enum_values: field.enum_values,
    relation_config: typeof ui.relation_config === 'object' ? JSON.stringify(ui.relation_config) : ui.relation_config,
    generated_code: Boolean(codeField && encoding.enabled !== false && encoding.generationMode !== 'manual'
      && !(encoding.allowManualOverride || encoding.allow_manual_override)),
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
  const [searchParams] = useSearchParams();
  const linkedRecordId = searchParams.get('recordId');
  const aliasProgramRoute = slug ? dynamicProgramRouteAliases[slug] : undefined;
  const [pageConfig, setPageConfig] = useState<PageConfig | null>(null);
  useShellPageTitle(pageConfig?.title);
  const [platformForm, setPlatformForm] = useState<PlatformForm | null>(null);
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [mutationFields, setMutationFields] = useState<FieldDef[]>([]);
  const [data, setData] = useState<Record<string, any>[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [configError, setConfigError] = useState('');
  const [search, setSearch] = useState('');
  const [filterValues, setFilterValues] = useState<Record<string, unknown>>({});
  const [sortState, setSortState] = useState<{ field?: string; order?: 'asc' | 'desc' }>({});

  const [detailRecord, setDetailRecord] = useState<Record<string, any> | null>(null);
  const [submittingApproval, setSubmittingApproval] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<Record<string, any> | null>(null);
  const [form] = Form.useForm();
  const [filterForm] = Form.useForm();
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [ruleStates, setRuleStates] = useState<FieldRuntime['states']>({});
  const [ruleData, setRuleData] = useState<Record<string, unknown>>({});
  const [ruleError, setRuleError] = useState('');
  const [rulesLoading, setRulesLoading] = useState(false);
  const [ruleRevision, setRuleRevision] = useState(0);
  const ruleRequest = useRef(0);
  useEffect(() => {
    if (!modalOpen || !platformForm) return;
    const request = ++ruleRequest.current;
    let cancelled = false;
    setRulesLoading(true);
    const timer = setTimeout(async () => {
      try {
        const values = formFieldsToPayload(form.getFieldsValue(true), mutationFields);
        const result = unwrapApiData<{ data: Record<string, unknown>; states: FieldRuntime['states'] }>(
          await evaluateFormRules(platformForm.id, values, editingRecord?.id));
        if (cancelled || request !== ruleRequest.current || !result) return;
        const nextValues = { ...result.data };
        mutationFields.forEach(field => {
          const value = nextValues[field.field_name];
          if (value && ['date', 'datetime'].includes(field.field_type)) nextValues[field.field_name] = dayjs(String(value));
        });
        form.setFieldsValue(nextValues);
        setRuleData(result.data);
        setRuleStates(result.states);
        setRuleError('');
      } catch (error: any) {
        if (!cancelled && request === ruleRequest.current) setRuleError(error?.response?.data?.detail || '字段规则预览失败');
      } finally {
        if (!cancelled && request === ruleRequest.current) setRulesLoading(false);
      }
    }, 150);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [modalOpen, platformForm?.id, editingRecord?.id, mutationFields, ruleRevision, form]);
  const usesDraftLifecycle = Boolean(platformForm?.runtime_submission_available && (!editingRecord || editingRecord._approval));

  const requestIdRef = useRef(0);
  const [selectedViewTab, setSelectedViewTab] = useState('');
  const runtimeViewTabs = pageConfig?.config?.viewConfig?.tabs;
  const activeViewTab = runtimeViewTabs?.find((tab) => tab.id === selectedViewTab) || runtimeViewTabs?.[0];
  const viewConfig = useMemo(
    () => normalizeRuntimeViewConfig(activeViewTab || pageConfig?.config?.viewConfig, fields),
    [fields, activeViewTab, pageConfig?.config?.viewConfig],
  );
  const switchViewTab = (id: string) => {
    requestIdRef.current += 1;
    setSelectedViewTab(id);
    setPage(1);
    setSearch('');
    setFilterValues({});
    setSortState({});
    setData([]);
    setTotal(0);
    filterForm.resetFields();
  };

  const activeFilters = useMemo(() => viewConfig ? sortByOrder(viewConfig.filters).filter((filter) => filter.enabled) : [], [viewConfig]);
  const tableConfigColumns = useMemo(() => viewConfig ? sortByOrder(viewConfig.table.columns).filter((column) => column.enabled) : [], [viewConfig]);
  const structuredFilters = useMemo(() => activeFilters
    .map((filter) => filterValueToPayload(filter, filterValues[filter.id] ?? filter.defaultValue))
    .filter(Boolean), [activeFilters, filterValues]);

  useEffect(() => {
    if (aliasProgramRoute) navigate(aliasProgramRoute, { replace: true });
  }, [aliasProgramRoute, navigate]);

  const loadData = useCallback(async () => {
    if (!slug || aliasProgramRoute || !pageConfig || !platformForm || !viewConfig) return;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const res = await listPlatformDynamicRecords(platformForm.id, {
        page,
        page_size: viewConfig.table.pageSize,
        search: search || undefined,
        filters: structuredFilters.length ? JSON.stringify(structuredFilters) : undefined,
        sort_field: sortState.field || viewConfig.table.defaultSort?.fieldName,
        sort_order: sortState.order || (viewConfig.table.defaultSort ? (viewConfig.table.defaultSort.order === 'ascend' ? 'asc' : 'desc') : undefined),
      });
      if (requestId !== requestIdRef.current) return;
      const records = unwrapApiList<any>(res);
      setData(records.map((record) => ({ id: record.id, ...(record.data || {}), _status: record.status, _approval: record._approval, _fieldStates: record.field_states })));
      setTotal(res.data?.total ?? records.length);
    } catch { message.error('加载数据失败'); }
    finally { if (requestId === requestIdRef.current) setLoading(false); }
  }, [slug, aliasProgramRoute, pageConfig, platformForm, viewConfig, page, search, sortState.field, sortState.order, structuredFilters]);

  useEffect(() => {
    (async () => {
      if (!slug || aliasProgramRoute) return;
      try {
        setConfigError('');
        const numericFormId = Number(slug);
        let dbForm: PlatformForm | null = null;
        if (!Number.isNaN(numericFormId)) {
          dbForm = unwrapApiData<PlatformForm>(await getPlatformForm(numericFormId, { schema: 'published', scope: 'list' }));
        } else {
          try {
            dbForm = unwrapApiData<PlatformForm>(await getPlatformFormByCode(slug, { schema: 'published', scope: 'list' }));
          } catch {
            const matchedForm = unwrapApiList<PlatformForm>(await listPlatformForms()).find((item) => item.code === slug) ?? null;
            dbForm = matchedForm
              ? unwrapApiData<PlatformForm>(await getPlatformForm(matchedForm.id, { schema: 'published', scope: 'list' }))
              : null;
          }
        }
        if (dbForm) {
          if (isAnalysisAssembly(dbForm.config, dbForm.code)) {
            setPlatformForm(dbForm);
            setPageConfig(null);
            setConfigError('当前是看板/分析表单，请进入看板设计或分析页面，不使用业务表单运行页。');
            setLoading(false);
            return;
          }
          const runtimeFields = (dbForm.fields ?? []).filter((field) => !field.archived).map(mapPlatformField);
          const publishedViewConfig = getPublishedViewConfig(dbForm.config);
          setPlatformForm(dbForm);
          setFields(runtimeFields);
          setPageConfig({
            id: dbForm.id,
            name: dbForm.code,
            title: dbForm.name,
            paradigm: 'platform_form',
            model_id: dbForm.model_id ?? 0,
            model_name: dbForm.code,
            config: {
              viewConfig: publishedViewConfig,
              formFieldNames: getPublishedFormFieldNames(dbForm.config, runtimeFields),
            },
          });
          if (Array.isArray(publishedViewConfig?.tabs) && !publishedViewConfig.tabs.length) {
            setConfigError('当前账号没有可见的数据视图，请联系管理员配置 Tab 的角色、用户或组织绑定。');
            setLoading(false);
          } else if (!publishedViewConfig) {
            setConfigError('当前表单还没有发布的数据视图配置，请进入表单设置发布后再使用。');
            setLoading(false);
          }
          return;
        }
        const res = { data: null };
        const pc = res.data;
        setPlatformForm(null);
        setPageConfig(pc);
        setConfigError('未找到平台表单配置，动态页面不再回退旧模型页面。');
        setLoading(false);
      } catch {
        setConfigError('页面配置加载失败，请检查表单是否存在并已发布。');
        setLoading(false);
        message.error('页面配置不存在');
      }
    })();
  }, [slug, aliasProgramRoute]);

  useEffect(() => { loadData(); }, [loadData]);

  const listFields = tableConfigColumns.map((column) => column.fieldName);

  const formFieldNames = pageConfig?.config?.formFieldNames || [];

  const formFields = mutationFields.length
    ? mutationFields
    : formFieldNames
      .map(fn => fields.find(f => f.field_name === fn))
      .filter((f): f is FieldDef => !!f);
  const runtimePermissions = platformForm?.runtime_permissions || {};
  const canRunAction = (action: string) => Boolean(platformForm) && runtimePermissions[action] !== false;

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

  const openDetail = async (record: Record<string, any>) => {
    if (!platformForm) return;
    try {
      const item = unwrapApiData<any>(await getPlatformDynamicRecord(platformForm.id, record.id));
      setDetailRecord({ ...item.data, id: item.id, _approval: item._approval, _fieldStates: item.field_states });
    } catch (error: any) { message.error(error?.response?.data?.detail || '详情加载失败'); }
  };
  useEffect(() => {
    if (!platformForm || !linkedRecordId) return;
    const recordId = Number(linkedRecordId);
    if (!Number.isSafeInteger(recordId) || recordId <= 0) return;
    let cancelled = false;
    getPlatformDynamicRecord(platformForm.id, recordId).then(response => {
      const item = unwrapApiData<any>(response);
      if (!cancelled && item) setDetailRecord({ ...item.data, id: item.id, _approval: item._approval, _fieldStates: item.field_states });
    }).catch((error: any) => {
      if (!cancelled) message.error(error?.response?.data?.detail || '详情加载失败');
    });
    return () => { cancelled = true; };
  }, [platformForm?.id, linkedRecordId]);
  const submitApproval = () => {
    const approval = detailRecord?._approval as RecordApproval | undefined;
    if (!platformForm || !detailRecord || !approval?.can_submit) return;
    Modal.confirm({ title: approval.status === 'rejected' ? '确认重新提交审批？' : '确认提交审批？',
      content: '提交后统一进入流程与待办，审批期间不能修改来源记录。',
      onOk: async () => {
        setSubmittingApproval(true);
        try {
          await submitPlatformDynamicRecord(platformForm.id, detailRecord.id, approval.status);
          message.success('已提交审批，可在流程与待办 → 我发起的追踪');
          await openDetail(detailRecord); await loadData();
        } catch (error: any) { message.error(error?.response?.data?.detail || '提交失败，请补充必填字段'); throw error; }
        finally { setSubmittingApproval(false); }
      },
    });
  };
  if (platformForm?.runtime_submission_available) {
    (tableColumns as any[]).push({ title: '审批状态', key: '_approval', width: 100,
      render: (_: any, record: any) => record._approval
        ? <Tag color={record._approval.status === 'rejected' ? 'red' : 'blue'}>{approvalStatusLabels[record._approval.status] || record._approval.status}</Tag> : '历史记录',
    });
  }
  if (platformForm || canRunAction('edit') || canRunAction('delete')) {
    (tableColumns as any[]).push({
      title: '操作', width: 180, fixed: 'right',
      render: (_val: any, record: any) => (
        <Space size={4}>
          <Button size="small" onClick={() => openDetail(record)}>详情</Button>
          {canRunAction('edit') && (!record._approval || record._approval.can_edit) && <Button size="small" icon={<EditOutlined />} onClick={() => openEditModal(record)} />}
          {canRunAction('delete') && (!record._approval || record._approval.can_edit) && (
            <Popconfirm title="确定删除？" onConfirm={() => handleDelete(record.id)}>
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        </Space>
      ),
    });
  }

  const loadMutationSchema = async (scope: 'create' | 'edit') => {
    if (!slug || !platformForm) return [];
    setSchemaLoading(true);
    try {
      const numericFormId = Number(slug);
      const detail = !Number.isNaN(numericFormId)
        ? unwrapApiData<PlatformForm>(await getPlatformForm(numericFormId, { schema: 'published', scope }))
        : unwrapApiData<PlatformForm>(await getPlatformFormByCode(slug, { schema: 'published', scope }));
      return (detail?.fields ?? []).filter((field) => !field.archived).map(mapPlatformField);
    } finally {
      setSchemaLoading(false);
    }
  };

  const openCreateModal = async () => {
    if (!platformForm) return;
    setEditingRecord(null);
    try {
      const nextFields = await loadMutationSchema('create');
      setMutationFields(nextFields);
      form.resetFields();
      setModalOpen(true);
    } catch {
      message.error('新增表单配置加载失败');
    }
  };

  const openEditModal = async (record: Record<string, any>) => {
    if (!platformForm) return;
    try {
      const item = unwrapApiData<any>(await getPlatformDynamicRecord(platformForm.id, record.id));
      record = { ...item.data, id: item.id, _approval: item._approval, _fieldStates: item.field_states };
      if (record._approval && !record._approval.can_edit) { message.warning('当前审批状态不能修改'); return; }
    } catch (error: any) { message.error(error?.response?.data?.detail || '记录加载失败'); return; }
    setEditingRecord(record);
    form.resetFields();
    let nextFields: FieldDef[] = [];
    try {
      nextFields = await loadMutationSchema('edit');
      setMutationFields(nextFields);
    } catch {
      message.error('编辑表单配置加载失败');
      return;
    }
    const formValues: Record<string, any> = {};
    for (const f of nextFields) {
      const fn = f.field_name;
      if (['date', 'datetime'].includes(f.field_type) && record[fn]) {
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
      if (rulesLoading || ruleError) return;
      const values = usesDraftLifecycle ? form.getFieldsValue() : await form.validateFields();
      const payload = formFieldsToPayload(values, formFields);
      setConfirmLoading(true);
      if (platformForm && editingRecord) {
        const expected = Object.fromEntries(Object.keys(payload).map(key => [key, editingRecord[key] ?? null]));
        const item = unwrapApiData<any>(await updatePlatformDynamicRecord(platformForm.id, editingRecord.id, payload, expected));
        setDetailRecord({ ...item.data, id: item.id, _approval: item._approval, _fieldStates: item.field_states });
        message.success(item._approval ? '草稿已保存' : '已保存');
      } else if (platformForm) {
        const item = unwrapApiData<any>(await createPlatformDynamicRecord(platformForm.id, payload));
        setDetailRecord({ ...item.data, id: item.id, _approval: item._approval, _fieldStates: item.field_states });
        message.success(item._approval ? '草稿已保存，请从详情提交审批' : '已保存');
      } else if (editingRecord) {
        message.warning('当前页面没有绑定平台表单，不能写入业务记录');
        return;
        message.success('更新成功');
      } else {
        message.warning('当前页面没有绑定平台表单，不能写入业务记录');
        return;
        message.success('创建成功');
      }
      setModalOpen(false);
      loadData();
    } catch (e: any) {
      if (e?.errorFields) return; // form validation error
      message.error(e?.response?.data?.detail || (editingRecord ? '更新失败' : '创建失败'));
    } finally {
      setConfirmLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      if (platformForm) {
        await deletePlatformDynamicRecord(platformForm.id, id);
      } else {
        message.warning('当前页面没有绑定平台表单，不能删除业务记录');
        return;
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

  if (aliasProgramRoute || (!pageConfig && !configError)) {
    return <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>;
  }

  if (!pageConfig || !viewConfig) {
    return (
      <div className="app-business-page dynamic-business-page">
        <div className="app-business-content dynamic-business-content">
          <div className="app-business-title-row dynamic-business-title-row">
            <Space size={10} align="center" wrap>
              <Tag color="warning">缺少视图配置</Tag>
            </Space>
            {platformForm ? (
              <Tooltip title="表单配置">
                <Button aria-label="表单配置" icon={<SettingOutlined />} onClick={() => navigate(`/form-settings/${platformForm.code || platformForm.id}`)} />
              </Tooltip>
            ) : null}
          </div>
          <Empty
            description={configError || '当前表单缺少已发布的数据视图配置'}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          >
            {platformForm ? (
              <Button type="primary" icon={<SettingOutlined />} onClick={() => navigate(`/form-settings/${platformForm.code || platformForm.id}`)}>
                进入表单设置
              </Button>
            ) : null}
          </Empty>
        </div>
      </div>
    );
  }

  return (
    <div className="app-business-page dynamic-business-page">
      <div className="app-business-content dynamic-business-content">
      <div className="app-business-title-row dynamic-business-title-row">
        <Space size={8} wrap>
          {canRunAction('create') && (
            <Tooltip title={platformForm?.runtime_submission_available ? '填写申请' : '新增'}>
              <Button aria-label={platformForm?.runtime_submission_available ? '填写申请' : '新增'} type="primary" icon={<PlusOutlined />} loading={schemaLoading} onClick={openCreateModal}>{platformForm?.runtime_submission_available ? '填写申请' : '新增'}</Button>
            </Tooltip>
          )}
          <Tooltip title="刷新">
            <Button aria-label="刷新" icon={<ReloadOutlined />} loading={loading} onClick={loadData} />
          </Tooltip>
          {platformForm ? (
            <Tooltip title="表单配置">
              <Button aria-label="表单配置" icon={<SettingOutlined />} onClick={() => navigate(`/form-settings/${platformForm.code || platformForm.id}`)} />
            </Tooltip>
          ) : null}
        </Space>
      </div>

      {runtimeViewTabs && runtimeViewTabs.length > 0 && <Tabs activeKey={activeViewTab?.id} onChange={switchViewTab}
        items={runtimeViewTabs.map((tab) => ({ key: tab.id, label: tab.name }))} />}
      <Form key={activeViewTab?.id || 'default'}
        className="app-business-search-grid app-business-configured-search dynamic-business-filter"
        form={filterForm}
        colon={false}
        layout="horizontal"
        onFinish={(values) => {
          setPage(1);
          setSearch(String(values.keyword || ''));
          setFilterValues(values);
        }}
      >
        <Form.Item name="keyword" label="关键词">
          <Input allowClear prefix={<SearchOutlined />} placeholder="搜索业务记录" />
        </Form.Item>
        {activeFilters.map((filter) => (
          <Form.Item key={filter.id} name={filter.id} label={filter.label} initialValue={filter.defaultValue}>
            {renderDynamicFilterControl(filter)}
          </Form.Item>
        ))}
        <Form.Item className="app-business-search-actions dynamic-view-filter-actions" label=" ">
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

      <div className="app-business-list-toolbar dynamic-business-list-toolbar">
        <Typography.Text type="secondary">共 {total} 条记录</Typography.Text>
        <Typography.Text type="secondary">业务数据列表</Typography.Text>
      </div>

      <Table
        className="app-business-data-table dynamic-business-table"
        dataSource={data}
        columns={tableColumns}
        rowKey="id"
        loading={loading}
        size={viewConfig.table.density === 'compact' ? 'small' : viewConfig.table.density === 'large' ? 'large' : 'middle'}
        scroll={{ x: 'max-content', y: '100%' }}
        onChange={(_pagination, _filters, sorter: any) => {
          const activeSorter = Array.isArray(sorter) ? sorter.find((item) => item.order) : sorter;
          const order = activeSorter?.order === 'ascend'
            ? 'asc'
            : activeSorter?.order === 'descend'
              ? 'desc'
              : undefined;
          const field = order ? String(activeSorter?.field || activeSorter?.columnKey || '') : undefined;
          setSortState(field && order ? { field, order } : {});
          setPage(1);
        }}
        pagination={{
          current: page,
          total,
          pageSize: viewConfig.table.pageSize,
          showTotal: (t) => `共 ${t} 条`,
          onChange: (p) => setPage(p),
        }}
      />
      </div>

      <Drawer title={`${pageConfig.title} · 记录详情`} open={Boolean(detailRecord)} onClose={() => setDetailRecord(null)} width={560}
        extra={<Space>
          {(detailRecord?._approval ? detailRecord._approval.can_edit : canRunAction('edit')) && <Button onClick={() => detailRecord && openEditModal(detailRecord)}>编辑</Button>}
          {detailRecord?._approval?.can_submit && <Button type="primary" loading={submittingApproval} onClick={submitApproval}>{detailRecord._approval.status === 'rejected' ? '重新提交' : '提交审批'}</Button>}
        </Space>}>
        {detailRecord && <>
          {detailRecord._approval && <Typography.Paragraph>审批状态：<Tag>{approvalStatusLabels[detailRecord._approval.status] || detailRecord._approval.status}</Tag></Typography.Paragraph>}
          <Descriptions bordered column={1} size="small" items={fields.filter(f => !f.field_name.startsWith('_') && detailRecord._fieldStates?.[f.field_name]?.visible !== false).map(f => ({ key: f.field_name, label: f.label, children: detailRecord[f.field_name] == null ? '—' : typeof detailRecord[f.field_name] === 'object' ? JSON.stringify(detailRecord[f.field_name]) : String(detailRecord[f.field_name]) }))} />
          {detailRecord._approval && <>
            <Typography.Title level={5}>审批与修改记录</Typography.Title>
            <Timeline items={(detailRecord._approval.history || []).map((entry: Record<string, unknown>) => ({ children: <Space direction="vertical" size={0}>
              <Typography.Text>{({ draft: '保存草稿', edit: '修改草稿', create: '保存草稿', update: '修改草稿', submit: '提交审批', approve: '审批通过', reject: '驳回' } as Record<string, string>)[String(entry.action)] || String(entry.action || '审批记录')}</Typography.Text>
              <Typography.Text type="secondary">{[entry.actor_name, entry.comment, entry.created_at].filter(Boolean).map(String).join(' · ')}</Typography.Text>
            </Space> }))} />
          </>}
        </>}
      </Drawer>
      <Modal
        className="dynamic-business-modal"
        title={editingRecord ? `编辑${pageConfig.title}` : `${platformForm?.runtime_submission_available ? '填写申请：' : '新增'}${pageConfig.title}`}
        open={modalOpen}
        onOk={handleModalOk}
        onCancel={() => setModalOpen(false)}
        confirmLoading={confirmLoading || rulesLoading}
        okButtonProps={{ disabled: Boolean(ruleError) }}
        okText={usesDraftLifecycle ? '保存草稿' : '保存'}
        cancelText="取消"
        width={820}
        styles={{ body: { paddingTop: 16 } }}
      >
        {usesDraftLifecycle && <Typography.Paragraph type="secondary">先保存草稿，完成填写后从记录详情提交审批；驳回后可修改并重新提交。</Typography.Paragraph>}
        <Form
          form={form}
          layout="vertical"
          size="middle"
          className="app-business-create-form dynamic-business-create-form"
          onValuesChange={() => { ruleRequest.current += 1; setRuleRevision(value => value + 1); }}
        >
          {ruleError && <Alert type="error" showIcon message={ruleError} style={{ marginBottom: 16 }} />}
          <Row gutter={12}>
            {formFields.filter(f => ruleStates?.[f.field_name]?.visible !== false).map(f => (
              <Col key={f.field_name} xs={24} md={isWideFormField(f) ? 24 : 12}>
                {renderFormField(f, { formId: platformForm?.id, data: ruleData, states: ruleStates })}
              </Col>
            ))}
          </Row>
        </Form>
      </Modal>
    </div>
  );
}
