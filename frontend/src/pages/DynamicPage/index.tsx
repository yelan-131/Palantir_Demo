import {resolveListView, emptyFilterValue, clearedFilterValues, type FilterSettings, type ListSettings} from '../ComponentPages/businessComponents';
import { selectionCountError } from '@/utils/selectOptions';
import FormImport from '@/components/FormImport';
import FieldProtection, {protectCopy, type FieldPolicy} from '@/components/FieldProtection';
import FieldControl from '@/components/FormWidgets/FieldControl';
import { enumOptions, choiceLabel, type ControlSettings } from '@/utils/formControls';
import FormLayout from '@/components/FormLayout';
import type { FormLayoutNode } from '@/utils/formLayout';
import React, { lazy, Suspense, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useShellPageTitle } from '@/components/ShellPageTitle';
import { useAuthStore } from '@/stores/authStore';
import { canConfigureWorkspace, reconcilePublishedViewState } from './workspaceState';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Table, Button, Space, Input, Modal, Form, Tag, Spin, message,
  Popconfirm, Typography, Select, InputNumber, DatePicker, Switch,
  Row, Col, Tooltip, Empty, Drawer, Descriptions, Timeline, Tabs, Alert, Progress, Dropdown,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, SearchOutlined,
  ReloadOutlined, DownloadOutlined, UploadOutlined, DownOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  getPlatformForm,
  getFormReferenceOptions,
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
  exportPlatformDynamicRecords,
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

const EmbeddedFormSettings = lazy(() => import('../FormSettings'));
type WorkspaceEditorTab = 'form' | 'filter' | 'flow' | 'permission';

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
  defaultValue?: unknown;
  generated_code?: boolean;
  controlType?: string;
  typeSettings?: ControlSettings;
  placeholder?: string;
  helpText?: string;
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
  if(kind)return ['analysis','analytics','dashboard','report','bi_report','metric_dashboard','list_analysis'].includes(kind);
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
      defaultSort: isRecord(table.defaultSort) && columns.some(column => column.enabled && column.sortable && column.fieldName === table.defaultSort.fieldName)
        ? table.defaultSort as ViewConfig['table']['defaultSort'] : undefined,
      pageSize: Number.isFinite(table.pageSize) ? Number(table.pageSize) : 20,
      density,
      rowClickAction: ['detail', 'edit', 'none'].includes(String(table.rowClickAction)) ? table.rowClickAction as ViewConfig['table']['rowClickAction'] : 'detail',
      toolbarActions: Array.isArray(table.toolbarActions) ? table.toolbarActions.map(String) : ['create','refresh','settings'],
      rowActions: Array.isArray(table.rowActions) ? table.rowActions.map(String) : ['detail','edit','delete'],
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

type FieldRuntime = { recordId?: number; formId?: number; data?: Record<string, unknown>; states?: Record<string, { visible: boolean; required: boolean; readonly: boolean } & FieldPolicy> };

function renderFormField(field: FieldDef, runtime: FieldRuntime = {}) {
  const state = runtime.states?.[field.field_name];
  if (state?.visible === false) return null;
  if(runtime.recordId&&state?.masked)return <Form.Item key={field.field_name} name={field.field_name} label={field.label}><FieldControl type="text" masked copyMode={state.copyMode} copyText={state.copyText} label={field.label}/></Form.Item>;
  const item = renderFormFieldControl({ ...field, required: state?.required ?? field.required }, runtime);
  if (!React.isValidElement(item)) return item;
  const child = (item.props as any).children;
  return React.isValidElement(child) ? React.cloneElement(item, {}, React.cloneElement(child as React.ReactElement<any>, {
    disabled: Boolean(state?.readonly || (child.props as any).disabled),
    masked:runtime.recordId?state?.masked:false,copyMode:state?.copyMode,copyText:state?.copyText,
  })) : item;
}

function renderFormFieldControl(field: FieldDef, runtime: FieldRuntime) {
  if (field.generated_code) {
    return <Form.Item key={field.field_name} name={field.field_name} label={field.label}
      extra="保存时按编码规则自动生成"><Input disabled placeholder="保存后自动生成" /></Form.Item>;
  }
  if (field.field_type !== 'relation') {
    const type = field.controlType || ({enum:'select',boolean:'switch',date:'datetime',datetime:'datetime',text:'textarea',int:'number',integer:'number',float:'number',decimal:'number',number:'number'} as Record<string,string>)[field.field_type] || 'text';
    return <Form.Item key={field.field_name} name={field.field_name} label={field.label} extra={field.helpText}
      rules={[{required:field.required,message:`请填写${field.label}`}, {validator: (_, value) => { const error = type === 'select' ? selectionCountError(value, field.typeSettings) : undefined; return error ? Promise.reject(new Error(error)) : Promise.resolve(); }}]}><FieldControl type={type} settings={{...(field.field_type==='date'?{dateMode:'date'}:{}),...field.typeSettings}} options={field.enum_values} placeholder={field.placeholder||`请填写${field.label}`} formId={runtime.formId} fieldName={field.field_name} recordId={runtime.recordId} label={field.label}/></Form.Item>;
  }
  switch (field.field_type) {
    case 'relation': {
      let targetModel = '';
      if (field.relation_config) {
        try {
          const config = JSON.parse(field.relation_config);
          targetModel = config.source_kind || config.target_form_code || config.target_model || config.target_table || '';
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
            allowClear={field.typeSettings?.allowClear!==false}
            showSearch={field.typeSettings?.displayMode!=='dropdown'}
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
    defaultValue: ui.defaultRule?.enabled === false || ui.defaultRule?.conditions?.length ? undefined : field.default_value,
    enum_values: field.enum_values,
    controlType: ui.controlType==='field'?undefined:ui.controlType, typeSettings: ui.typeSettings, placeholder: ui.placeholder, helpText: ui.helpText,
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

export interface RecordListComponentProps {
  formSlug?: string;
  embedded?: boolean;
  filterSettings?: FilterSettings;
  listSettings?: ListSettings;
  tableDensity?: 'compact' | 'standard' | 'comfortable' | null;
  display?: 'all' | 'filters' | 'list';
  filterFields?: string[] | null;
  externalSearch?: string;
  onFilterChange?: (value: {ready?: boolean; search: string; filters: Array<{field: string; op: string; value: unknown}>}) => void;
  externalFilters?: Array<{field: string; op: string; value: unknown}>;
  refreshKey?: number;
  onMutated?: () => void;
  readOnly?: boolean;
}
export default function DynamicPage({formSlug, embedded = false, externalFilters, refreshKey = 0, onMutated, readOnly = false, display = 'all', filterSettings, listSettings, tableDensity, filterFields: selectedFilterFields, externalSearch, onFilterChange}: RecordListComponentProps = {}) {
  const params = useParams<{ slug: string }>();
  const slug=formSlug||params.slug;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const linkedRecordId = searchParams.get('recordId');
  const aliasProgramRoute = !embedded && slug ? dynamicProgramRouteAliases[slug] : undefined;
  const user = useAuthStore(state => state.user);
  const [editorTab, setEditorTab] = useState<WorkspaceEditorTab | null>(null);
  const [configRevision, setConfigRevision] = useState(0);
  const [configRefreshing, setConfigRefreshing] = useState(true);
  const configRequest = useRef(0);
  const configPending = useRef(true);
  const schemaSlug = useRef<string>();
  const [pageConfig, setPageConfig] = useState<PageConfig | null>(null);
  const [platformForm, setPlatformForm] = useState<PlatformForm | null>(null);
  const workspaceTitle = pageConfig?.title || platformForm?.name;
  useShellPageTitle(editorTab && workspaceTitle ? `${workspaceTitle} · 编辑表单` : workspaceTitle, !embedded);
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [referenceLabels,setReferenceLabels]=useState<Record<string,Record<string,string>>>({});
  const [mutationLayout, setMutationLayout] = useState<FormLayoutNode[] | null>(null);
  const [mutationGap,setMutationGap]=useState(12);
  const [mutationFields, setMutationFields] = useState<FieldDef[]>([]);
  const [data, setData] = useState<Record<string, any>[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [configError, setConfigError] = useState('');
  const [configDenied, setConfigDenied] = useState(false);
  const [search, setSearch] = useState('');
  const [exporting,setExporting]=useState(false);
  const [importOpen,setImportOpen]=useState(false);
  const [filterValues, setFilterValues] = useState<Record<string, unknown>>({});
  const [sortState, setSortState] = useState<{ field?: string; order?: 'asc' | 'desc' }>({});

  const [detailRecord, setDetailRecord] = useState<Record<string, any> | null>(null);
  const [detailFields, setDetailFields] = useState<FieldDef[]>([]);
  useEffect(() => {
    let active = true;
    setDetailFields([]);
    if (!platformForm || !detailRecord) return;
    // Detail uses the published form layout, not the smaller list schema.
    // This read endpoint still enforces view permission for every field.
    getPlatformForm(platformForm.id, { schema: 'published', scope: 'edit' }).then(response => {
      const detail = unwrapApiData<PlatformForm>(response);
      if (active) setDetailFields((detail?.fields || []).filter(field => !field.archived).map(mapPlatformField));
    }).catch(() => { if (active) message.error('详情字段配置加载失败'); });
    return () => { active = false; };
  }, [platformForm?.id, detailRecord?.id, platformForm?.config?.publishedSchemaVersion]);
  useEffect(() => {
    let active = true;
    setReferenceLabels({});
    const rows = detailRecord ? [...data, detailRecord] : data;
    if (!platformForm || !rows.length) return;
    const labelFields = [...new Map([...fields, ...detailFields].map(field => [field.field_name, field])).values()];
    const sources = labelFields.filter(field => {
      try {
        const ref = JSON.parse(field.relation_config || '{}');
        return Boolean(ref.target_model || ref.target_form_code || ref.source_kind);
      } catch { return false; }
    });
    Promise.allSettled(sources.map(async field => {
      const dependencies = (field.typeSettings?.search?.filters || []).filter(item => item.source === 'field' && item.sourceField).map(item => item.sourceField!);
      const requests = new Map<string, { selected: string | number; context: Record<string, unknown> }>();
      for (const row of rows) {
        const value = row[field.field_name];
        if (row._fieldStates?.[field.field_name]?.masked || !['string', 'number'].includes(typeof value) || value === '') continue;
        const context = Object.fromEntries(dependencies.filter(key => row[key] !== undefined).map(key => [key, row[key]]));
        requests.set(JSON.stringify([value, context]), { selected: value, context });
      }
      // Resolve only displayed IDs, including ones beyond the first options page.
      const responses = await Promise.all([...requests.values()].map(({ selected, context }) => getFormReferenceOptions(platformForm.id, field.field_name, context, { selected })));
      return [field.field_name, Object.fromEntries(responses.flatMap(response => (response.data.data || []).map((option: any) => [String(option.id), String(option.label)])))] as const;
    })).then(results => {
      if (active) setReferenceLabels(Object.fromEntries(results.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])));
    });
    return () => { active = false; };
  }, [platformForm?.id, fields, detailFields, data, detailRecord]);
  const [submittingApproval, setSubmittingApproval] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<Record<string, any> | null>(null);
  useEffect(() => {if(readOnly){setModalOpen(false);setImportOpen(false);}},[readOnly]);
  const [form] = Form.useForm();
  const [filterForm] = Form.useForm();
  const [autoFilterRevision, setAutoFilterRevision] = useState(0);
  const [selectedRowKeys,setSelectedRowKeys] = useState<React.Key[]>([]);
  const [listError,setListError] = useState('');
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
          if(value===undefined)delete nextValues[field.field_name];
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
  const baseViewConfig = useMemo(
    () => normalizeRuntimeViewConfig(activeViewTab || pageConfig?.config?.viewConfig, fields),
    [fields, activeViewTab, pageConfig?.config?.viewConfig],
  );
  const viewConfig = useMemo(()=>resolveListView(baseViewConfig,listSettings),[baseViewConfig,listSettings]);
  const runtimeViewState = useRef({ selectedViewTab: '', viewConfig, filterValues, sortState });
  runtimeViewState.current = { selectedViewTab: activeViewTab?.id || '', viewConfig, filterValues, sortState };
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

  const activeFilters = useMemo(() => viewConfig ? sortByOrder(viewConfig.filters).filter((filter) => filter.enabled && (display !== 'filters' || selectedFilterFields == null || selectedFilterFields.includes(filter.fieldName))) : [], [viewConfig, display, selectedFilterFields]);
  const tableConfigColumns = useMemo(() => viewConfig ? sortByOrder(viewConfig.table.columns).filter((column) => column.enabled) : [], [viewConfig]);
  const structuredFilters = useMemo(() => [...(externalFilters || []), ...(display === 'list' ? [] : activeFilters)
    .map((filter) => filterValueToPayload(filter, Object.prototype.hasOwnProperty.call(filterValues,filter.id) ? filterValues[filter.id] : filter.defaultValue))
    .filter(Boolean)], [activeFilters, filterValues, externalFilters, display]);
  useEffect(() => { setPage(1); }, [externalFilters, externalSearch]);
  useEffect(()=>{setPage(1);setSortState({});setSelectedRowKeys([]);},[listSettings?.pageSize,listSettings?.defaultSort?.field,listSettings?.defaultSort?.order]);
  const filterCallback = useRef(onFilterChange);
  filterCallback.current = onFilterChange;
  const requiredFilterFields = filterSettings?.requiredFields || [];
  const ready = requiredFilterFields.every(name=>{
    const filter = activeFilters.find(item=>item.fieldName===name);
    return filter && !emptyFilterValue(Object.prototype.hasOwnProperty.call(filterValues,filter.id)?filterValues[filter.id]:filter.defaultValue);
  });
  const filterSignature = JSON.stringify({search:filterSettings?.showKeyword===false?'':search, filters: structuredFilters, ready});
  useEffect(()=>{
    if(display!=='filters'||filterSettings?.queryMode!=='change'||!autoFilterRevision)return;
    const timer=window.setTimeout(()=>filterForm.submit(),350);
    return ()=>window.clearTimeout(timer);
  },[display,filterSettings?.queryMode,autoFilterRevision,filterForm]);
  const selectionQueryKey = JSON.stringify([slug,page,search,externalSearch,structuredFilters,sortState,listSettings?.selection]);
  useEffect(()=>{setSelectedRowKeys([]);},[selectionQueryKey]);
  useEffect(() => {
    if (display === 'filters' && !configRefreshing && !configError) filterCallback.current?.(JSON.parse(filterSignature));
  }, [display, filterSignature, configRefreshing, configError]);

  useEffect(() => {
  if (aliasProgramRoute) navigate(aliasProgramRoute, { replace: true });
  }, [aliasProgramRoute, navigate]);

  const loadData = useCallback(async () => {
    if (display === 'filters' || !slug || aliasProgramRoute || !pageConfig || !platformForm || !viewConfig || configPending.current || configRefreshing || configError) return;
    const requestId = ++requestIdRef.current;
    setLoading(true);setSelectedRowKeys([]);
    try {
      const res = await listPlatformDynamicRecords(platformForm.id, {
        page,
        page_size: viewConfig.table.pageSize,
        search: (externalSearch ?? search) || undefined,
        filters: structuredFilters.length ? JSON.stringify(structuredFilters) : undefined,
        sort_field: sortState.field || viewConfig.table.defaultSort?.fieldName,
        sort_order: sortState.order || (viewConfig.table.defaultSort ? (viewConfig.table.defaultSort.order === 'ascend' ? 'asc' : 'desc') : undefined),
      });
      if (requestId !== requestIdRef.current) return;
      const records = unwrapApiList<any>(res);
      const nextTotal = res.data?.total ?? records.length;
      const lastPage = Math.max(1, Math.ceil(nextTotal / viewConfig.table.pageSize));
      if (page > lastPage) { setPage(lastPage); return; }
      setData(records.map((record) => ({ id: record.id, ...(record.data || {}), _status: record.status, _approval: record._approval, _fieldStates: record.field_states })));
      setTotal(nextTotal);setListError('');setSelectedRowKeys([]);
    } catch (error: any) { if (requestId === requestIdRef.current) {
      if (error?.response?.status === 403) {
        setConfigDenied(true); setConfigError('当前账号没有访问此表单的权限，请联系管理员。');
        setPlatformForm(null); setPageConfig(null); setFields([]); setData([]); setTotal(0);
        setDetailRecord(null); setModalOpen(false);
      } else { setListError('查询失败，以下保留上次成功加载的结果。'); if(!embedded)message.error('加载数据失败'); }
    } }
    finally { if (requestId === requestIdRef.current) setLoading(false); }
  }, [slug, aliasProgramRoute, pageConfig, platformForm, viewConfig, page, search, sortState.field, sortState.order, structuredFilters, configRefreshing, configError, refreshKey, display, externalSearch]);

  useEffect(() => {
    if (!slug || aliasProgramRoute) return;
    const request = ++configRequest.current;
    let active = true;
    const isCurrent = () => active && request === configRequest.current;
    configPending.current = true;
    requestIdRef.current += 1;
    setConfigRefreshing(true);
    setConfigDenied(false);
    if (schemaSlug.current !== slug) {
      schemaSlug.current = slug;
      setEditorTab(null);
      setPageConfig(null);
      setPlatformForm(null);
      setFields([]);
      setData([]);
      setTotal(0);
      setPage(1);
      setSearch('');
      setFilterValues({});
      setSortState({});
      setSelectedViewTab('');
      filterForm.resetFields();
    }
    (async () => {
      try {
        setConfigError('');
        const numericFormId = Number(slug);
        let dbForm: PlatformForm | null = null;
        if (!Number.isNaN(numericFormId)) {
          dbForm = unwrapApiData<PlatformForm>(await getPlatformForm(numericFormId, { schema: 'published', scope: 'list' }));
        } else {
          try {
            dbForm = unwrapApiData<PlatformForm>(await getPlatformFormByCode(slug, { schema: 'published', scope: 'list' }));
          } catch (error: any) {
            if (!isCurrent()) return;
            if ([401, 403].includes(error?.response?.status)) throw error;
            const matchedForm = unwrapApiList<PlatformForm>(await listPlatformForms()).find((item) => item.code === slug) ?? null;
            if (!isCurrent()) return;
            dbForm = matchedForm
              ? unwrapApiData<PlatformForm>(await getPlatformForm(matchedForm.id, { schema: 'published', scope: 'list' }))
              : null;
          }
        }
        if (!isCurrent()) return;
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
          const previous = runtimeViewState.current;
          const nextTab = publishedViewConfig?.tabs?.find(tab => tab.id === previous.selectedViewTab) || publishedViewConfig?.tabs?.[0];
          const nextView = normalizeRuntimeViewConfig(nextTab || publishedViewConfig, runtimeFields);
          const reconciled = reconcilePublishedViewState(previous.viewConfig, nextView, previous.filterValues, previous.sortState);
          setFilterValues(reconciled.filterValues);
          setSortState(reconciled.sortState);
          setSelectedViewTab(nextTab?.id || '');
          if (previous.viewConfig) {
            const inputValues = filterForm.getFieldsValue(true);
            const nextInput = reconcilePublishedViewState(previous.viewConfig, nextView, inputValues, previous.sortState).filterValues;
            filterForm.setFields([...new Set([...Object.keys(inputValues), ...Object.keys(nextInput)])].map(name => ({ name, value: nextInput[name] })));
          }
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
      } catch (error: any) {
        if (!isCurrent()) return;
        const denied = error?.response?.status === 403;
        setConfigDenied(denied);
        setConfigError(denied ? '当前账号没有访问此表单的权限，请联系管理员。' : '页面配置加载失败，请检查表单是否存在并已发布。');
        if (denied) {
          setPlatformForm(null); setPageConfig(null); setFields([]); setData([]); setTotal(0);
          setDetailRecord(null); setModalOpen(false);
        }
        setLoading(false);
        message.error(denied ? '无权访问该表单' : '页面配置加载失败');
      } finally {
        if (isCurrent()) {
          configPending.current = false;
          setConfigRefreshing(false);
        }
      }
    })();
    return () => { active = false; requestIdRef.current += 1; };
  }, [slug, aliasProgramRoute, configRevision, filterForm]);

  useEffect(() => { void loadData(); return () => { requestIdRef.current += 1; }; }, [loadData]);

  const listFields = tableConfigColumns.map((column) => column.fieldName);

  const formFieldNames = pageConfig?.config?.formFieldNames || [];

  const formFields = mutationFields.length
    ? mutationFields
    : formFieldNames
      .map(fn => fields.find(f => f.field_name === fn))
      .filter((f): f is FieldDef => !!f);
  const runtimePermissions = platformForm?.runtime_permissions || {};
  const canRunAction = (action: string) => Boolean(platformForm) && (!readOnly || ['view', 'detail', 'refresh'].includes(action)) && runtimePermissions[action] !== false;

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
      sorter: (viewColumn ? viewColumn.sortable : f?.sortable) ? true : undefined,
      sortOrder: sortState.field === field_name ? (sortState.order === 'asc' ? 'ascend' : 'descend') as 'ascend' | 'descend'
        : !sortState.field && viewConfig?.table.defaultSort?.fieldName === field_name ? viewConfig.table.defaultSort.order : null,
      render: (val: any, record: any) => {
        const protect=(content:React.ReactNode)=><FieldProtection {...record._fieldStates?.[field_name]}>{content}</FieldProtection>;
        const content=()=>{
        if(!record._fieldStates?.[field_name]?.masked&&referenceLabels[field_name]?.[String(val)])return referenceLabels[field_name][String(val)];
        if (typeof val === 'boolean') return val ? '是' : '否';
        if (val === undefined || val === null || val === '') return viewColumn?.emptyText || '-';
        if (!record._fieldStates?.[field_name]?.masked && (f?.controlType === 'select' || f?.field_type === 'enum')) {
          const label = choiceLabel(val, f?.enum_values);
          return viewColumn?.renderType === 'tag' ? <Tag>{label}</Tag> : label;
        }
        if (Array.isArray(val)) return f?.controlType==='upload'?val.map(item=>item?.name||'附件').join('、'):f?.controlType?.includes('table')?`${val.length} 条明细`:val.map(item=>typeof item==='object'?JSON.stringify(item):String(item)).join('、');
        if (typeof val==='object') return JSON.stringify(val);
        if (!record._fieldStates?.[field_name]?.masked) {
          if(viewColumn?.renderType==='number' && Number.isFinite(Number(val)))return Number(val).toLocaleString('zh-CN',{maximumFractionDigits:12});
          if(viewColumn?.renderType==='date' && dayjs(val).isValid())return dayjs(val).format(f?.typeSettings?.dateMode === 'date' ? 'YYYY-MM-DD' : 'YYYY-MM-DD HH:mm');
          if(viewColumn?.renderType==='progress' && Number.isFinite(Number(val)))return <Progress size="small" percent={Math.max(0,Math.min(100,Number(val)))}/>;
        }
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
        };return protect(content());
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
    if (readOnly || !platformForm || !detailRecord || !approval?.can_submit) return;
    Modal.confirm({ title: approval.status === 'rejected' ? '确认重新提交审批？' : '确认提交审批？',
      content: '提交后统一进入流程与待办，审批期间不能修改来源记录。',
      onOk: async () => {
        setSubmittingApproval(true);
        try {
          await submitPlatformDynamicRecord(platformForm.id, detailRecord.id, approval.status);
          message.success('已提交审批，可在流程与待办 → 我发起的追踪');
          await openDetail(detailRecord); await loadData();
          onMutated?.();
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
  const rowActions=viewConfig?.table.rowActions||[];
  const configuredToolbarActions = activeViewTab?.table?.toolbarActions || pageConfig?.config.viewConfig?.table?.toolbarActions;
  const toolbarActions = viewConfig?.table.toolbarActions || configuredToolbarActions || ['settings'];
  const canConfigureForm = Boolean(platformForm) && canConfigureWorkspace(Boolean(user?.is_admin), canRunAction('configure'));
  useEffect(() => { if (editorTab && !canConfigureForm) setEditorTab(null); }, [editorTab, canConfigureForm]);
  const openWorkspace = (tab: WorkspaceEditorTab) => {
    if (canConfigureForm && !modalOpen && !importOpen && !detailRecord && !schemaLoading) setEditorTab(tab);
  };
  const workspaceEntry = canConfigureForm ? <div className="form-workspace-entry">
    <Button icon={<EditOutlined />} onClick={() => openWorkspace('form')}>编辑表单</Button>
    <Dropdown trigger={['click']} menu={{ items: [
      { key: 'filter', label: '列表与筛选' },
      { key: 'flow', label: '流程与审批' },
      { key: 'permission', label: '权限管理' },
    ], onClick: ({ key }) => openWorkspace(key as WorkspaceEditorTab) }}>
      <Button aria-label="更多表单设置" title="更多表单设置" icon={<DownOutlined />} />
    </Dropdown>
  </div> : null;
  const refreshPublishedConfig = () => {
    configPending.current = true;
    requestIdRef.current += 1;
    setConfigRevision(revision => revision + 1);
  };
  const renderWorkspace = (runtime: React.ReactNode) => <div className={`form-workspace${editorTab ? ' form-workspace-editing' : ''}`}>
    {editorTab && platformForm && canConfigureForm && <div className="form-workspace-editor"><Suspense fallback={<div className="form-workspace-loading"><Spin /><span>正在打开表单编辑器</span></div>}>
      <EmbeddedFormSettings formId={String(platformForm.id)} embedded initialTab={editorTab} onExit={() => setEditorTab(null)} onPublished={refreshPublishedConfig} />
    </Suspense></div>}
    <div className="form-workspace-runtime" hidden={Boolean(editorTab)} style={editorTab ? { display: 'none' } : undefined}>{runtime}</div>
  </div>;
  if (rowActions.length) {
    (tableColumns as any[]).push({
      title: '操作', width: 180, fixed: 'right',
      render: (_val: any, record: any) => (
        <Space size={4}>
          {rowActions.includes('detail')&&<Button size="small" onClick={() => openDetail(record)}>详情</Button>}
          {rowActions.includes('edit') && canRunAction('edit') && (!record._approval || record._approval.can_edit) && <Button size="small" icon={<EditOutlined />} onClick={() => openEditModal(record)} />}
          {rowActions.includes('delete') && canRunAction('delete') && (!record._approval || record._approval.can_edit) && (
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
      const nodes = (detail?.config?.formLayout as { version?: number; nodes?: FormLayoutNode[] } | undefined);
      setMutationGap(Number((detail?.config?.canvasSettings as any)?.gap)||12);
      setMutationLayout(nodes?.version === 2 && Array.isArray(nodes.nodes) ? nodes.nodes : null);
      return (detail?.fields ?? []).filter((field) => !field.archived).map(mapPlatformField);
    } finally {
      setSchemaLoading(false);
    }
  };

  const openCreateModal = async () => {
    if (readOnly || !platformForm) return;
    setEditingRecord(null);
    try {
      const nextFields = await loadMutationSchema('create');
      setMutationFields(nextFields);
      form.resetFields();
      const defaults:Record<string,unknown>={};
      for(const field of nextFields){const settings=field.typeSettings||{};
        if(field.defaultValue!==undefined&&field.defaultValue!==null&&field.defaultValue!==''){let value=field.defaultValue;if(['int','integer','number','float','decimal','json','boolean'].includes(field.field_type)||settings.selectionMode==='multiple'||settings.displayMode==='tags'){try{value=JSON.parse(String(value));}catch{}}else value=String(value);defaults[field.field_name]=value;}
        else if(field.controlType==='switch')defaults[field.field_name]=Boolean(settings.defaultChecked);
        else if(field.controlType==='datetime'&&settings.defaultDate&&settings.defaultDate!=='none'&&settings.dateMode!=='range')defaults[field.field_name]=dayjs().format(settings.dateMode==='date'?'YYYY-MM-DD':'YYYY-MM-DDTHH:mm:ss');
      }
      form.setFieldsValue(defaults);
      setModalOpen(true);
    } catch {
      message.error('新增表单配置加载失败');
    }
  };

  const openEditModal = async (record: Record<string, any>) => {
    if (readOnly || !platformForm) return;
    try {
      const item = unwrapApiData<any>(await getPlatformDynamicRecord(platformForm.id, record.id));
      record = { ...item.data, id: item.id, _approval: item._approval, _fieldStates: item.field_states };
      if (record._approval && !record._approval.can_edit) { message.warning('当前审批状态不能修改'); return; }
    } catch (error: any) { message.error(error?.response?.data?.detail || '记录加载失败'); return; }
    setEditingRecord(record);
    setRuleStates(record._fieldStates||{});
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
      formValues[fn] = record[fn] ?? undefined;
    }
    form.setFieldsValue(formValues);
    setModalOpen(true);
  };

  const handleModalOk = async () => {
    if(readOnly)return;
    try {
      if (rulesLoading || ruleError) return;
      const values = usesDraftLifecycle ? form.getFieldsValue() : await form.validateFields();
      const payload = formFieldsToPayload(values, formFields);
      if(editingRecord)for(const key of Object.keys(payload))if(ruleStates?.[key]?.masked)delete payload[key];
      setConfirmLoading(true);
      if (platformForm && editingRecord) {
        const expected = Object.fromEntries(Object.keys(payload).filter(key=>!editingRecord._fieldStates?.[key]?.masked).map(key => [key, editingRecord[key] ?? null]));
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
      onMutated?.();
    } catch (e: any) {
      if (e?.errorFields) return; // form validation error
      message.error(e?.response?.data?.detail || (editingRecord ? '更新失败' : '创建失败'));
    } finally {
      setConfirmLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    if(readOnly)return;
    try {
      if (platformForm) {
        await deletePlatformDynamicRecord(platformForm.id, id);
      } else {
        message.warning('当前页面没有绑定平台表单，不能删除业务记录');
        return;
      }
      message.success('已删除');
      loadData();
      onMutated?.();
    } catch { message.error('删除失败'); }
  };

    const renderDetailValue=(field:FieldDef)=>{
    const value=detailRecord?.[field.field_name];const policy=detailRecord?._fieldStates?.[field.field_name]||{};
    if (!policy.masked && value != null && (field.controlType === 'select' || field.field_type === 'enum')) return <FieldProtection {...policy}>{choiceLabel(value, field.enum_values)}</FieldProtection>;
    if (!policy.masked && typeof value === 'boolean') return <FieldProtection {...policy}>{value ? field.typeSettings?.checkedText || '是' : field.typeSettings?.uncheckedText || '否'}</FieldProtection>;
    return <FieldProtection {...policy}>{!policy.masked&&referenceLabels[field.field_name]?.[String(value)]?referenceLabels[field.field_name][String(value)]:['upload','editable-table','readonly-table'].includes(field.controlType||'')&&!policy.masked?<FieldControl disabled type={field.controlType!} value={value} settings={field.typeSettings} formId={platformForm?.id} fieldName={field.field_name} recordId={detailRecord?.id} label={field.label}/>:value==null?'—':typeof value==='object'?JSON.stringify(value):String(value)}</FieldProtection>;
  };
  const renderDynamicFilterControl = (filter: ViewFilterConfig) => {
    const field = fields.find((item) => item.field_name === filter.fieldName);
    const placeholder = filter.placeholder || filter.label;
    if (filter.controlType === 'dateRange') return <DatePicker.RangePicker style={{ width: '100%' }} />;
    if (filter.controlType === 'date') return <DatePicker style={{ width: '100%' }} placeholder={placeholder} />;
    if(filter.controlType==='relation'&&field?.relation_config&&platformForm)return <RelationPicker formId={platformForm.id} fieldName={field.field_name} contextData={{}} modelName="" placeholder={placeholder}/>;
    if (filter.controlType === 'number') return <InputNumber style={{ width: '100%' }} placeholder={placeholder} />;
    if (filter.controlType === 'select' || field?.field_type === 'enum') {
      const opts = enumOptions(field?.enum_values);
      return <Select allowClear placeholder={placeholder} options={opts} />;
    }
    return <Input allowClear prefix={filter.controlType === 'keyword' ? <SearchOutlined /> : undefined} placeholder={placeholder} />;
  };

  if (aliasProgramRoute || (!pageConfig && !configError)) {
    return renderWorkspace(<div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>);
  }

  if (!pageConfig || !viewConfig) {
    return renderWorkspace(
      <div onCopyCapture={protectCopy} onCutCapture={protectCopy} className={`app-business-page dynamic-business-page${display === 'list' ? ' component-page-list' : ''}`}>
        <div className="app-business-content dynamic-business-content">
          <div className="app-business-title-row dynamic-business-title-row">
            <Space size={10} align="center" wrap>
              <Tag color={configDenied ? 'error' : 'warning'}>{configDenied ? '无访问权限' : '缺少视图配置'}</Tag>
            </Space>
            {!embedded && workspaceEntry}
          </div>
          <Empty
            description={configError || '当前表单缺少已发布的数据视图配置'}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        </div>
      </div>
    );
  }

  const filterContent = (
      <Form onValuesChange={()=>setAutoFilterRevision(value=>value+1)} key={activeViewTab?.id || 'default'}
        className="app-business-search-grid app-business-configured-search dynamic-business-filter"
        form={filterForm}
        colon={false}
        layout="horizontal"
        onFinish={(values) => {
          setPage(1);
          setSearch(filterSettings?.showKeyword===false?'':String(values.keyword || ''));
          setFilterValues(values);
        }}
      >
        <div className="dynamic-filter-fields">
        {filterSettings?.showKeyword!==false&&<Form.Item name="keyword" label="关键词">
          <Input allowClear prefix={<SearchOutlined />} placeholder="搜索业务记录" />
        </Form.Item>}
        {activeFilters.map((filter) => (
          <Form.Item key={filter.id} name={filter.id} label={filter.label} rules={[{required:requiredFilterFields.includes(filter.fieldName),validator:(_,value)=>requiredFilterFields.includes(filter.fieldName)&&emptyFilterValue(value)?Promise.reject(new Error(`请填写${filter.label}`)):Promise.resolve()}]} initialValue={filter.controlType==='date'?filter.defaultValue&&dayjs(String(filter.defaultValue)):filter.controlType==='dateRange'?Array.isArray(filter.defaultValue)?filter.defaultValue.map(v=>dayjs(v)):undefined:filter.defaultValue}>
            {renderDynamicFilterControl(filter)}
          </Form.Item>
        ))}
        </div>
        <Form.Item className="app-business-search-actions dynamic-view-filter-actions">
          <Space>
            <Button onClick={() => {
              setAutoFilterRevision(0);
              if(filterSettings?.resetMode==='clear'){
                const cleared=clearedFilterValues(activeFilters);
                filterForm.setFields([{name:'keyword',value:'',errors:[]},...Object.entries(cleared).map(([name,value])=>({name,value,errors:[]}))]);
                setFilterValues(cleared);
              }else{filterForm.resetFields();setFilterValues({});}
              setSearch('');setPage(1);
            }}>{filterSettings?.resetLabel||'重置'}</Button>
            {filterSettings?.queryMode!=='change'&&<Button type="primary" htmlType="submit" icon={<SearchOutlined />}>{filterSettings?.queryLabel||'查询'}</Button>}
          </Space>
        </Form.Item>
      </Form>
  );
  const missingFilterBinding = requiredFilterFields.some(name=>!activeFilters.some(filter=>filter.fieldName===name));
  if (display === 'filters') return <div className="component-record-filter">{missingFilterBinding&&<Alert type="warning" showIcon message="必填筛选字段已失效，请重新配置筛选字段。" style={{marginBottom:12}} />}{filterSettings?.queryMode==='change'&&<p className="component-query-hint">条件变更后自动查询，必填条件校验通过后生效。</p>}{configError && <Alert type="warning" message={configError} />}{filterContent}</div>;

  return renderWorkspace(
    <div onCopyCapture={protectCopy} onCutCapture={protectCopy} className={`app-business-page dynamic-business-page${display === 'list' ? ' component-page-list' : ''}`}>
      <div className="app-business-content dynamic-business-content">
      <div className="app-business-title-row dynamic-business-title-row">
        <Space className="dynamic-business-toolbar-actions" size={6} wrap>
          {toolbarActions.includes('create') && canRunAction('create') && (
            <Tooltip title={platformForm?.runtime_submission_available ? '填写申请' : '新增'}>
              <Button aria-label={platformForm?.runtime_submission_available ? '填写申请' : '新增'} type="primary" icon={<PlusOutlined />} loading={schemaLoading} onClick={openCreateModal} />
            </Tooltip>
          )}
          {toolbarActions.includes('refresh')&&<Tooltip title="刷新">
            <Button aria-label="刷新" icon={<ReloadOutlined />} loading={loading} onClick={loadData} />
          </Tooltip>}
          {toolbarActions.includes('import')&&canRunAction('import')&&canRunAction('create')&&<Button aria-label="批量导入" title="批量导入" icon={<UploadOutlined/>} onClick={()=>setImportOpen(true)} />}
      {toolbarActions.includes('export')&&canRunAction('export')&&<Button aria-label="导出当前页" title="导出当前页" icon={<DownloadOutlined/>} loading={exporting} onClick={async()=>{
        if(!platformForm)return;setExporting(true);
        try{const res=await exportPlatformDynamicRecords(platformForm.id,{page,page_size:viewConfig.table.pageSize,search:(externalSearch??search)||undefined,filters:structuredFilters.length?JSON.stringify(structuredFilters):undefined,sort_field:sortState.field||viewConfig.table.defaultSort?.fieldName,sort_order:sortState.order||(viewConfig.table.defaultSort?.order==='ascend'?'asc':'desc')});
          const url=URL.createObjectURL(new Blob([res.data],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=`${pageConfig.title}-第${page}页.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
        }catch(error:any){message.error(error?.response?.data?.detail||'导出失败');}finally{setExporting(false);}
      }} />}
        </Space>
        {!embedded && workspaceEntry}
      </div>

      {listError&&<Alert type="error" showIcon message={listError} action={<Button size="small" onClick={()=>void loadData()}>重试</Button>} />}
      {listSettings?.columns?.some(name=>!baseViewConfig?.table.columns.some(column=>column.enabled&&column.fieldName===name))&&<Alert type="warning" showIcon message="部分配置列在当前发布视图中不可用，已自动隐藏。" />}
      {configError && <Alert type="warning" showIcon message={configError} action={<Button size="small" onClick={refreshPublishedConfig}>重新加载配置</Button>} />}

      {runtimeViewTabs && runtimeViewTabs.length > 0 && <Tabs activeKey={activeViewTab?.id} onChange={switchViewTab}
        items={runtimeViewTabs.map((tab) => ({ key: tab.id, label: tab.name }))} />}
      {display !== 'list' && filterContent}

      <div className="app-business-list-toolbar dynamic-business-list-toolbar">
        <Typography.Text type="secondary">共 {total} 条记录{selectedRowKeys.length>0&&` · 已选 ${selectedRowKeys.length} 条`}</Typography.Text>
      </div>

      <Table
        className="app-business-data-table dynamic-business-table"
        dataSource={data}
        columns={tableColumns}
        rowKey="id"
        rowSelection={listSettings?.selection&&listSettings.selection!=='none'?{type:listSettings.selection==='single'?'radio':'checkbox',selectedRowKeys,onChange:keys=>setSelectedRowKeys(keys)}:undefined}
        locale={listSettings?.emptyText?{emptyText:<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={listSettings.emptyText} />}:undefined}
        onRow={record=>({onClick:event=>{
          if((event.target as HTMLElement).closest('button,a,input,.ant-select,.ant-popover'))return;
          if(viewConfig.table.rowClickAction==='detail')void openDetail(record);
          if(viewConfig.table.rowClickAction==='edit'&&canRunAction('edit')&&(!record._approval||record._approval.can_edit))void openEditModal(record);
        }})}
        loading={loading || configRefreshing}
        size={tableDensity ? tableDensity === 'compact' ? 'small' : tableDensity === 'comfortable' ? 'large' : 'middle' : viewConfig.table.density === 'compact' ? 'small' : viewConfig.table.density === 'large' ? 'large' : 'middle'}
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

      {platformForm&&<FormImport key={platformForm.id} formId={platformForm.id} open={importOpen && !editorTab} onClose={()=>setImportOpen(false)} onImported={()=>{setPage(1);void loadData();onMutated?.();}}/>}
      <Drawer title={`${pageConfig.title} · 记录详情`} open={Boolean(detailRecord) && !editorTab} onClose={() => setDetailRecord(null)} width={560}
        extra={<Space>
          {!readOnly && (detailRecord?._approval ? detailRecord._approval.can_edit : canRunAction('edit')) && <Button onClick={() => detailRecord && openEditModal(detailRecord)}>编辑</Button>}
          {!readOnly && detailRecord?._approval?.can_submit && <Button type="primary" loading={submittingApproval} onClick={submitApproval}>{detailRecord._approval.status === 'rejected' ? '重新提交' : '提交审批'}</Button>}
        </Space>}>
        {detailRecord && <>
          {detailRecord._approval && <Typography.Paragraph>审批状态：<Tag>{approvalStatusLabels[detailRecord._approval.status] || detailRecord._approval.status}</Tag></Typography.Paragraph>}
          <Descriptions bordered column={1} size="small" items={(detailFields.length ? detailFields : fields).filter(f => !f.field_name.startsWith('_') && detailRecord._fieldStates?.[f.field_name]?.visible !== false && (!detailRecord._fieldStates || f.field_name in detailRecord._fieldStates)).map(f => ({ key: f.field_name, label: f.label, children: renderDetailValue(f) }))} />
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
        open={modalOpen && !editorTab}
        onOk={handleModalOk}
        onCancel={() => setModalOpen(false)}
        confirmLoading={confirmLoading || rulesLoading}
        okButtonProps={{ disabled: Boolean(ruleError)||(usesDraftLifecycle&&!canRunAction('saveDraft')) }}
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
          {mutationLayout ? <FormLayout gap={mutationGap} nodes={mutationLayout} isFieldVisible={name => formFields.some(field => field.field_name === name) && ruleStates?.[name]?.visible !== false} renderField={node => {
            const field = formFields.find(item => item.field_name === node.fieldName);
            if (!field || ruleStates?.[field.field_name]?.visible === false) return null;
            const states = { ...ruleStates, [field.field_name]: { visible: true, required: field.required, ...ruleStates?.[field.field_name], readonly: ruleStates?.[field.field_name]?.readonly ?? Boolean(node.readonly) } };
            return renderFormField(field, { formId: platformForm?.id, recordId: editingRecord?.id, data: ruleData, states });
          }} /> : <Row gutter={12}>
            {formFields.filter(f => ruleStates?.[f.field_name]?.visible !== false).map(f => (
              <Col key={f.field_name} xs={24} md={isWideFormField(f) ? 24 : 12}>
                {renderFormField(f, { formId: platformForm?.id, recordId: editingRecord?.id, data: ruleData, states: ruleStates })}
              </Col>
            ))}
          </Row>}
        </Form>
      </Modal>
    </div>
  );
}
