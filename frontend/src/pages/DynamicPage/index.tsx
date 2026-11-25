import {filterValueToPayload, recordMetadataFilterConfig, sourceFilterConfig, type StructuredFilter} from '../ComponentPages/filterControls';
import FilterFieldsViewport from './FilterFieldsViewport';
import {APPROVAL_STATUS_FIELD, APPROVAL_STATUS_LABEL, filterButtonActions, hasImplicitApprovalStatus, isRecordMetadataField, resolveListView, resolveListPresentation, emptyFilterValue, clearedFilterValues, type FilterControlMode, type FilterSettings, type ListSettings} from '../ComponentPages/businessComponents';
import { selectionCountError } from '@/utils/selectOptions';
import FormImport from '@/components/FormImport';
import FieldProtection, {protectCopy, type FieldPolicy} from '@/components/FieldProtection';
import FieldControl from '@/components/FormWidgets/FieldControl';
import { enumOptions, choiceLabel, type ControlSettings } from '@/utils/formControls';
import FormLayout from '@/components/FormLayout';
import { StateBlock } from '@/components/StateBlock';
import { FormAppearanceHeader, normalizeFormAppearance, type FormAppearance } from '@/components/FormLayout/formAppearance';
import type { FormLayoutNode } from '@/utils/formLayout';
import {createPortal} from 'react-dom';
import React, { lazy, Suspense, useState, useEffect, useCallback, useMemo, useRef, useId } from 'react';
import { useShellPageTitle, useShellPageOwnsHeading } from '@/components/ShellPageTitle';
import { CanonThemeScope } from '@/theme/ThemeCardProvider';
import { useAuthStore } from '@/stores/authStore';
import { canConfigureWorkspace, reconcilePublishedViewState } from './workspaceState';
import {recordCopyValues, type RecordCopySource} from './recordCopyValues';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { businessDataDesignPath, formPermissionsPath } from '@/config/navigation';
import {
  Table, Button, Space, Input, Modal, Form, Tag, Spin, message,
  Popconfirm, Typography, Select, InputNumber, DatePicker, Switch,
  Drawer, Descriptions, Timeline, Tabs, Alert, Progress, Dropdown,
  Tooltip,
} from 'antd';
import {
  PlusOutlined, EditOutlined, SearchOutlined,
  ReloadOutlined, DownloadOutlined, UploadOutlined, DownOutlined, InfoCircleOutlined, EllipsisOutlined,
} from '@/components/Icon/ant';
import dayjs from 'dayjs';
import {
  getPlatformForm,
  getFormRecordActorOptions,
  getFormReferenceOptions,
  getPlatformFormByCode,
  listPlatformForms,
  listPlatformDynamicRecords,
  createPlatformDynamicRecord,
  getPlatformDynamicRecord,
  submitPlatformDynamicRecord,
  approvalStatusLabels,
  type OptionSearchRequest,
  type RecordApproval,
  updatePlatformDynamicRecord,
  deletePlatformDynamicRecord,
  type PlatformForm,
  type PlatformFormField,
  evaluateFormRules,
  exportPlatformDynamicRecords,
  downloadFormFile,
} from '@/services/api';
import { formatServerDateTime, parseServerDate } from '@/utils/dateTime';
import RelationPicker from '@/components/FormWidgets/RelationPicker';
import {
  makeDefaultViewConfig,
  sortByOrder,
  type ViewConfig,
  type ViewFilterConfig,
  type ViewTableDensity,
} from '@/utils/viewConfig';
import '../AppPrograms/style.css';
import './style.css';
import './canon-list.css';
import './canon-form.css';

const AlertRecordPanel = lazy(() => import('../AlertCenter'));
type WorkspaceEditorTab = 'form' | 'data' | 'flow' | 'permission';

const approvalStatusOptions = Object.entries(approvalStatusLabels).map(([value, label]) => ({ value, label }));
const approvalTones: Record<string, string> = { approved: 'success', pending: 'info', draft: 'neutral', rejected: 'danger' };

function renderApprovalStatus(approval?: RecordApproval) {
  return approval
    ? <span className={`mf-pill mf-pill-${approvalTones[approval.status] || 'neutral'}`}>{approvalStatusLabels[approval.status] || approval.status}</span>
    : <span className="mf-empty-mark" title="无审批记录">—</span>;
}

function formatRecordActor(id?: number | string | null, name?: string | null): string {
  return name?.trim() || (id == null || id === '' ? '—' : '未知用户');
}

function formatRecordTimestamp(value?: string | number | Date | null): string {
  // SQLite's CURRENT_TIMESTAMP has no timezone marker and uses a space in place of T.
  const normalized = typeof value === 'string' ? value.replace(/^(\d{4}-\d{2}-\d{2}) /, '$1T') : value;
  return formatServerDateTime(normalized, '—');
}

const approvalTableColumn = {
  title: APPROVAL_STATUS_LABEL,
  key: APPROVAL_STATUS_FIELD,
  width: 88,
  className: 'mf-cell-approval',
  render: (_: unknown, record: Record<string, any>) => renderApprovalStatus(record._approval),
};

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
  skipOnCopy?: boolean;
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
  return ['text', 'json'].includes(field.field_type) || ['textarea', 'upload', 'editable-table', 'readonly-table'].includes(field.controlType || '')
    || field.field_name.toLowerCase().includes('remark');
}

function withCanonTheme(children: React.ReactNode) {
  return <CanonThemeScope>{children}</CanonThemeScope>;
}
/** Content portaled into a component-page header lives outside the list root and needs its own scope. */
function canonPortal(children: React.ReactNode) {
  return withCanonTheme(<span className="mf-canon mf-canon-portal">{children}</span>);
}

function mapPlatformField(field: PlatformFormField): FieldDef {
  const ui = (field.ui_config || {}) as Record<string, any>;
  const encoding = (field as any).encoding_rule || ui.encodingRule || {};
  const codeField = (field as any).business_type === 'code' || (field as any).control_type === 'code'
    || field.field_type === 'code' || ui.businessType === 'code' || ui.controlType === 'code' || ui.encodingRule;
  const autoNumbered = Boolean(codeField && encoding.enabled !== false && encoding.generationMode !== 'manual');
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
    generated_code: autoNumbered && !(encoding.allowManualOverride || encoding.allow_manual_override),
    skipOnCopy: autoNumbered || Boolean(ui.rules?.unique?.enabled || ui.computed || ui.controlType === 'upload'
      || field.business_type === 'attachment' || ui.businessType === 'attachment'),
  };
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
  /** Render list actions in its enclosing component header. */
  toolbarTargetId?: string;
  filterSettings?: FilterSettings;
  fieldControls?: Record<string, FilterControlMode>;
  filterLayout?: {rows:number; columns:number};
  showRecordMetadata?: boolean;
  fitTableHeight?: boolean;
  listSettings?: ListSettings;
  tableDensity?: 'compact' | 'standard' | 'comfortable' | null;
  display?: 'all' | 'filters' | 'list' | 'record';
  recordLinkId?: number;
  onCloseRecordLink?: () => void;
  filterFields?: string[] | null;
  externalSearch?: string;
  onFilterChange?: (value: {ready?: boolean; search: string; filters: StructuredFilter[]}) => void;
  externalFilters?: StructuredFilter[];
  refreshKey?: number;
  onMutated?: () => void;
  readOnly?: boolean;
  disableRowAction?: boolean;
}
export default function DynamicPage({formSlug, embedded = false, toolbarTargetId, externalFilters, refreshKey = 0, onMutated, readOnly = false, disableRowAction = false, display = 'all', recordLinkId, onCloseRecordLink, filterSettings, fieldControls, filterLayout, showRecordMetadata = false, fitTableHeight = false, listSettings, tableDensity, filterFields: selectedFilterFields, externalSearch, onFilterChange}: RecordListComponentProps = {}) {
  const filterFormId = useId();
  const allowedFilterActions = filterButtonActions(filterSettings);
  const canQuery = allowedFilterActions.includes('query');
  const canReset = allowedFilterActions.includes('reset');
  const [toolbarTarget, setToolbarTarget] = useState<HTMLElement | null>(null);
  useEffect(()=>{
    setToolbarTarget(toolbarTargetId ? document.getElementById(toolbarTargetId) : null);
  },[toolbarTargetId]);
  const params = useParams<{ slug: string }>();
  const slug=formSlug||params.slug;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const recordOnly = display === 'record';
  const linkedRecordId = recordLinkId ?? (!embedded ? searchParams.get('recordId') : undefined);
  const [recordLinkError, setRecordLinkError] = useState('');
  const aliasProgramRoute = !embedded && slug ? dynamicProgramRouteAliases[slug] : undefined;
  const user = useAuthStore(state => state.user);
  const [configRevision, setConfigRevision] = useState(0);
  const [configRefreshing, setConfigRefreshing] = useState(true);
  const configRequest = useRef(0);
  const configPending = useRef(true);
  const schemaSlug = useRef<string>();
  const [pageConfig, setPageConfig] = useState<PageConfig | null>(null);
  const [platformForm, setPlatformForm] = useState<PlatformForm | null>(null);
  const platformFormId = platformForm?.id;
  const recordActorOptionLoaders = useMemo(() => platformFormId == null ? null : ({
    _created_by: (options: OptionSearchRequest) => getFormRecordActorOptions(platformFormId, '_created_by', options),
    _updated_by: (options: OptionSearchRequest) => getFormRecordActorOptions(platformFormId, '_updated_by', options),
  }), [platformFormId]);
  const workspaceTitle = pageConfig?.title || platformForm?.name;
  useShellPageTitle(workspaceTitle, !embedded);
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [referenceLabels,setReferenceLabels]=useState<Record<string,Record<string,string>>>({});
  const [mutationLayout, setMutationLayout] = useState<FormLayoutNode[] | null>(null);
  const [mutationGap,setMutationGap]=useState(12);
  const [mutationAppearance, setMutationAppearance] = useState<FormAppearance>({});
  const mutationSchemaRequest = useRef(0);
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
  const [alertCreateOpen, setAlertCreateOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<Record<string, any> | null>(null);
  useEffect(() => {if(readOnly){setModalOpen(false);setImportOpen(false);}},[readOnly]);
  const [form] = Form.useForm();
  const [filterForm] = Form.useForm();
  const [autoFilterRevision, setAutoFilterRevision] = useState(0);
  const [selectedRowKeys,setSelectedRowKeys] = useState<React.Key[]>([]);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
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
  const approvalStatusAvailable = platformForm?.runtime_approval_available ?? platformForm?.runtime_submission_available ?? false;

  const requestIdRef = useRef(0);
  const [selectedViewTab, setSelectedViewTab] = useState('');
  const runtimeViewTabs = pageConfig?.config?.viewConfig?.tabs;
  const activeViewTab = runtimeViewTabs?.find((tab) => tab.id === selectedViewTab) || runtimeViewTabs?.[0];
  const baseViewConfig = useMemo(() => {
    const view=normalizeRuntimeViewConfig(activeViewTab || pageConfig?.config?.viewConfig, fields);
    if(!view||display!=='filters')return view;
    const selectedNames=selectedFilterFields??view.filters.filter(item=>item.enabled).map(item=>item.fieldName);
    const filters=selectedNames.flatMap<ViewFilterConfig>((name,index)=>{
      if (name === APPROVAL_STATUS_FIELD) {
        return approvalStatusAvailable ? [{
          id: `component-filter-${name}`,
          fieldName: name,
          label: APPROVAL_STATUS_LABEL,
          controlType: 'select',
          operator: 'equals',
          enabled: true,
          advanced: false,
          sortOrder: index,
        }] : [];
      }
      const recordMetadataFilter=recordMetadataFilterConfig(name,index);
      if (recordMetadataFilter) return [recordMetadataFilter];
      const field=fields.find(item=>item.field_name===name);
      if(!field)return [];
      const existing=view.filters.find(item=>item.fieldName===name);
      return [sourceFilterConfig(field,index,existing,fieldControls?.[name])];
    });
    return {...view,filters};
  },[fields,activeViewTab,pageConfig?.config?.viewConfig,display,selectedFilterFields,fieldControls,approvalStatusAvailable]);
  // Parents recreate configuration objects during inspector edits. Only content changes
  // should invalidate the list query and reset pagination.
  const listSettingsKey = JSON.stringify(listSettings ?? null);
  const stableListSettings = useMemo(() => JSON.parse(listSettingsKey) as ListSettings | null, [listSettingsKey]);
  const indexedSortFields = useMemo(()=>new Set(fields.filter(field=>field.sortable).map(field=>field.field_name)), [fields]);
  const viewConfig = useMemo(
    () => resolveListView(baseViewConfig, stableListSettings ?? undefined, approvalStatusAvailable, showRecordMetadata, indexedSortFields),
    [baseViewConfig, stableListSettings, approvalStatusAvailable, showRecordMetadata, indexedSortFields],
  );
  const listPresentation = useMemo(()=>resolveListPresentation(stableListSettings),[stableListSettings]);
  const effectiveSortField = sortState.field && viewConfig?.table.columns.some(column=>column.enabled&&column.sortable&&column.fieldName===sortState.field) ? sortState.field : undefined;
  const effectiveSortOrder = effectiveSortField ? sortState.order : undefined;
  useEffect(()=>{if(sortState.field&&!effectiveSortField)setSortState({});},[sortState.field,effectiveSortField]);
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
  const externalFiltersKey = JSON.stringify(externalFilters ?? []);
  const stableExternalFilters = useMemo(() => JSON.parse(externalFiltersKey) as NonNullable<RecordListComponentProps['externalFilters']>, [externalFiltersKey]);
  const structuredFilters = useMemo(() => [...stableExternalFilters, ...(display === 'list' ? [] : activeFilters)
    .map((filter) => filterValueToPayload(filter, Object.prototype.hasOwnProperty.call(filterValues,filter.id) ? filterValues[filter.id] : filter.defaultValue))
    .filter((filter): filter is StructuredFilter => filter !== null)], [activeFilters, filterValues, stableExternalFilters, display]);
  useEffect(() => { setPage(1); }, [stableExternalFilters, externalSearch]);
  useEffect(()=>{setPage(1);setSortState({});setSelectedRowKeys([]);},[viewConfig?.table.pageSize,viewConfig?.table.defaultSort?.fieldName,viewConfig?.table.defaultSort?.order]);
  const filterCallback = useRef(onFilterChange);
  filterCallback.current = onFilterChange;
  const requiredFilterFields = filterSettings?.requiredFields || [];
  const ready = requiredFilterFields.every(name=>{
    const filter = activeFilters.find(item=>item.fieldName===name);
    return filter && !emptyFilterValue(Object.prototype.hasOwnProperty.call(filterValues,filter.id)?filterValues[filter.id]:filter.defaultValue);
  });
  const filterSignature = JSON.stringify({search:filterSettings?.showKeyword===false?'':search, filters: structuredFilters, ready});
  useEffect(()=>{
    if(display!=='filters'||!canQuery||filterSettings?.queryMode!=='change'||!autoFilterRevision)return;
    const timer=window.setTimeout(()=>filterForm.submit(),350);
    return ()=>window.clearTimeout(timer);
  },[display,canQuery,filterSettings?.queryMode,autoFilterRevision,filterForm]);
  const selectionQueryKey = JSON.stringify([slug,page,search,externalSearch,structuredFilters,sortState,listSettings?.selection]);
  useEffect(()=>{setSelectedRowKeys([]);},[selectionQueryKey]);
  useEffect(() => {
    if (display === 'filters' && !configRefreshing && !configError) filterCallback.current?.(JSON.parse(filterSignature));
  }, [display, filterSignature, configRefreshing, configError]);

  useEffect(() => {
  if (aliasProgramRoute) navigate(aliasProgramRoute, { replace: true });
  }, [aliasProgramRoute, navigate]);

  const loadData = useCallback(async () => {
    if (display === 'filters' || display === 'record' || !slug || aliasProgramRoute || !pageConfig || !platformForm || !viewConfig || configPending.current || configRefreshing || configError) return;
    const requestId = ++requestIdRef.current;
    setLoading(true);setSelectedRowKeys([]);
    try {
      const res = await listPlatformDynamicRecords(platformForm.id, {
        page,
        page_size: viewConfig.table.pageSize,
        search: (externalSearch ?? search) || undefined,
        filters: structuredFilters.length ? JSON.stringify(structuredFilters) : undefined,
        sort_field: effectiveSortField || viewConfig.table.defaultSort?.fieldName,
        sort_order: effectiveSortOrder || (viewConfig.table.defaultSort ? (viewConfig.table.defaultSort.order === 'ascend' ? 'asc' : 'desc') : undefined),
      });
      if (requestId !== requestIdRef.current) return;
      const records = unwrapApiList<any>(res);
      const nextTotal = res.data?.total ?? records.length;
      const lastPage = Math.max(1, Math.ceil(nextTotal / viewConfig.table.pageSize));
      if (page > lastPage) { setPage(lastPage); return; }
      setData(records.map((record) => ({
        id: record.id,
        ...(record.data || {}),
        ...(showRecordMetadata && {
          _record_id: record.id,
          _created_at: formatRecordTimestamp(record.created_at),
          _updated_at: formatRecordTimestamp(record.updated_at),
          _created_by: formatRecordActor(record.created_by, record.created_by_name),
          _updated_by: formatRecordActor(record.updated_by, record.updated_by_name),
        }),
        _status: record.status,
        _approval: record._approval,
        _fieldStates: record.field_states,
      })));
      setTotal(nextTotal);setListError('');setSelectedRowKeys([]);
    } catch (error: any) { if (requestId === requestIdRef.current) {
      if (error?.response?.status === 403) {
        setConfigDenied(true); setConfigError('当前账号没有访问此表单的权限，请联系管理员。');
        setPlatformForm(null); setPageConfig(null); setFields([]); setData([]); setTotal(0);
        setDetailRecord(null); setModalOpen(false);
      } else {
        const detail = error?.response?.data?.detail;
        const fieldName = error?.response?.status === 400 && typeof detail === 'string'
          ? /^Field is not indexed for filtering: (.+)$/.exec(detail)?.[1]
          : undefined;
        const field = fieldName ? fields.find(item => item.field_name === fieldName) : undefined;
        setListError(field
          ? `「${field.label}」暂不支持筛选。请联系管理员在「业务数据 → 字段结构」开启该字段的可搜索或可排序并发布表单。以下保留上次成功加载的结果。`
          : '查询失败，以下保留上次成功加载的结果。');
        if (!embedded) message.error('加载数据失败');
      }
    } }
    finally { if (requestId === requestIdRef.current) setLoading(false); }
  }, [slug, aliasProgramRoute, pageConfig, platformForm, viewConfig, page, search, sortState.field, sortState.order, structuredFilters, configRefreshing, configError, refreshKey, display, externalSearch, fields, showRecordMetadata]);

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
      mutationSchemaRequest.current += 1;
      setMutationAppearance({});
      setSchemaLoading(false);
      setModalOpen(false);
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
          dbForm = unwrapApiData<PlatformForm>(await getPlatformForm(numericFormId, { schema: 'published', scope: display === 'filters' ? 'filters' : 'list' }));
        } else {
          try {
            dbForm = unwrapApiData<PlatformForm>(await getPlatformFormByCode(slug, { schema: 'published', scope: display === 'filters' ? 'filters' : 'list' }));
          } catch (error: any) {
            if (!isCurrent()) return;
            if ([401, 403].includes(error?.response?.status)) throw error;
            const matchedForm = unwrapApiList<PlatformForm>(await listPlatformForms()).find((item) => item.code === slug) ?? null;
            if (!isCurrent()) return;
            dbForm = matchedForm
              ? unwrapApiData<PlatformForm>(await getPlatformForm(matchedForm.id, { schema: 'published', scope: display === 'filters' ? 'filters' : 'list' }))
              : null;
          }
        }
        if (!isCurrent()) return;
        if (dbForm) {
          if (!embedded && isAnalysisAssembly(dbForm.config, dbForm.code)) {
            setPlatformForm(dbForm);
            setPageConfig(null);
            setConfigError('当前是看板/分析表单，请进入看板设计或分析页面，不使用业务表单运行页。');
            setLoading(false);
            return;
          }
          const runtimeFields = (dbForm.fields ?? []).filter((field) => !field.archived).map(mapPlatformField);
          // Component pages can use a published form as a source before it has any legacy list view.
          const publishedViewConfig = getPublishedViewConfig(dbForm.config) ?? (embedded
            ? makeDefaultViewConfig(runtimeFields.map(field => ({
              fieldName: field.field_name,
              label: field.label,
              fieldType: field.field_type,
              searchable: field.searchable,
              sortable: field.sortable,
              visibleInList: field.visible_in_list,
            })))
            : undefined);
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
  }, [slug, aliasProgramRoute, configRevision, filterForm, display, embedded]);

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
  const canEditRecord = (record: { _approval?: RecordApproval }) => canRunAction('edit') && (!record._approval || record._approval.can_edit);

  const standalone = !embedded && !toolbarTargetId && display === 'all';
  useShellPageOwnsHeading(standalone && Boolean(pageConfig && viewConfig));
  const statusTones: Record<string, string> = {
    running: 'success', idle: 'warning', maintenance: 'info', fault: 'danger', offline: 'neutral',
    active: 'success', pending: 'neutral', in_progress: 'info', completed: 'success',
    启用: 'success', 正常: 'success', 已完成: 'success', 通过: 'success',
    维护中: 'warning', 待处理: 'warning', 进行中: 'warning', 预警: 'warning',
    停用: 'neutral', 未启用: 'neutral', 已关闭: 'neutral',
    异常: 'danger', 失败: 'danger', 驳回: 'danger',
  };
  const statusDot = (label: string, raw: unknown) => <span className={`mf-status mf-status-${statusTones[String(raw)] || statusTones[label] || 'neutral'}`}>{label}</span>;
  const emptyMark = <span className="mf-empty-mark">—</span>;
  const tableColumns = listFields.map((field_name, columnIndex) => {
    if (field_name === APPROVAL_STATUS_FIELD) return approvalTableColumn;
    const recordMetadata = isRecordMetadataField(field_name);
    const f = fields.find(x => x.field_name === field_name);
    const viewColumn = tableConfigColumns.find((column) => column.fieldName === field_name);
    const numeric = ['int', 'integer', 'float', 'decimal', 'number'].includes(f?.field_type || '') || f?.controlType === 'number' || viewColumn?.renderType === 'number';
    const dateOnly = f?.field_type === 'date' || f?.typeSettings?.dateMode === 'date';
    const title = viewColumn?.label || f?.label || field_name;
    const sortable = Boolean(viewColumn ? viewColumn.sortable : f?.sortable);
    const headerMin = [...title].length * 14 + 32 + (sortable ? 20 : 0);
    const contact = /联系|电话|手机|邮箱|负责人|phone|mobile|email|contact/i.test(`${field_name} ${title}`);
    const choice = viewColumn?.renderType === 'tag' || f?.field_type === 'enum' || f?.controlType === 'select' || field_name === 'status';
    const typeWidth = recordMetadata && viewColumn?.width ? viewColumn.width
      : numeric ? 88 : viewColumn?.renderType === 'date' ? (dateOnly ? 104 : 136)
      : f?.field_type === 'boolean' || f?.controlType === 'switch' ? 72 : contact || choice ? 96 : 104;
    const emptyText = viewColumn?.emptyText && !['-', '—'].includes(viewColumn.emptyText) ? viewColumn.emptyText : undefined;
    // The first column takes the remaining space; configured widths cap the others but never cut a header.
    const canonWidth = columnIndex === 0 ? undefined : Math.max(headerMin, Math.min(viewColumn?.width ?? Number.POSITIVE_INFINITY, typeWidth));
    const primaryCell = columnIndex === 0 && !disableRowAction;
    const cellContent = (val: any, record: any): React.ReactNode => {
        if (recordMetadata) return val == null || val === '—' ? emptyMark : String(val);
        if(!record._fieldStates?.[field_name]?.masked&&referenceLabels[field_name]?.[String(val)])return referenceLabels[field_name][String(val)];
        if (typeof val === 'boolean') return val ? '是' : '否';
        if (val === undefined || val === null || val === '' || (Array.isArray(val) && !val.length)) return emptyText || emptyMark;
        if (!record._fieldStates?.[field_name]?.masked && (f?.controlType === 'select' || f?.field_type === 'enum')) {
          const label = choiceLabel(val, f?.enum_values);
          if (viewColumn?.renderType !== 'tag') return label;
          return statusDot(label, val);
        }
        if (Array.isArray(val)) return f?.controlType==='upload'?val.map(item=>item?.name||'附件').join('、'):f?.controlType?.includes('table')?`${val.length} 条明细`:val.map(item=>typeof item==='object'?JSON.stringify(item):String(item)).join('、');
        if (typeof val==='object') return JSON.stringify(val);
        if (!record._fieldStates?.[field_name]?.masked) {
          if(viewColumn?.renderType==='number' && Number.isFinite(Number(val)))return Number(val).toLocaleString('zh-CN',{maximumFractionDigits:12});
          if(viewColumn?.renderType==='date' && dayjs(val).isValid())return dayjs(val).format(f?.typeSettings?.dateMode === 'date' ? 'YYYY-MM-DD' : 'YYYY-MM-DD HH:mm');
          if(viewColumn?.renderType==='progress' && Number.isFinite(Number(val)))return <Progress size="small" percent={Math.max(0,Math.min(100,Number(val)))}/>;
        }
        if ((viewColumn?.renderType === 'tag' || f?.field_type === 'enum' || field_name === 'status') && val) return statusDot(String(val), val);
        return String(val ?? '');
    };
    return {
      title,
      dataIndex: field_name,
      key: field_name,
      width: canonWidth,
      canonMinWidth: columnIndex === 0 ? Math.max(240, headerMin) : canonWidth,
      fixed: viewColumn?.fixed ?? (columnIndex === 0 ? 'left' as const : undefined),
      ellipsis: { showTitle: true },
      align: numeric ? 'right' as const : undefined,
      className: [numeric && 'mf-cell-num', columnIndex === 0 && 'mf-cell-primary'].filter(Boolean).join(' ') || undefined,
      sorter: sortable ? true : undefined,
      sortOrder: sortState.field === field_name ? (sortState.order === 'asc' ? 'ascend' : 'descend') as 'ascend' | 'descend'
        : !sortState.field && viewConfig?.table.defaultSort?.fieldName === field_name ? viewConfig.table.defaultSort.order : null,
      onCell: (record: any) => {
        const text = record._fieldStates?.[field_name]?.masked ? undefined : cellContent(record[field_name], record);
        return typeof text === 'string' && text !== emptyText ? { title: text } : {};
      },
      render: (val: any, record: any) => {
        const protect=(content:React.ReactNode)=><FieldProtection {...record._fieldStates?.[field_name]}>{content}</FieldProtection>;
        const detailAvailable = (viewConfig?.table.rowActions || []).includes('detail') || viewConfig?.table.rowClickAction === 'detail';
        const primaryAction = toolbarTargetId ? viewConfig?.table.rowClickAction : detailAvailable ? 'detail' : undefined;
        const openPrimary = primaryAction === 'detail' ? openDetail : primaryAction === 'edit' && canEditRecord(record) ? openEditModal : undefined;
        if (primaryCell && openPrimary && !record._fieldStates?.[field_name]?.masked && val !== undefined && val !== null && val !== '' && (!recordMetadata || val !== '—')) {
          return protect(<button type="button" className="mf-list-primary-link" onClick={() => void openPrimary(record)}>{cellContent(val, record)}</button>);
        }
        return protect(cellContent(val, record));
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
    setRecordLinkError('');
    getPlatformDynamicRecord(platformForm.id, recordId).then(response => {
      const item = unwrapApiData<any>(response);
      if (!cancelled && item) setDetailRecord({ ...item.data, id: item.id, _approval: item._approval, _fieldStates: item.field_states });
    }).catch((error: any) => {
      if (cancelled) return;
      const detail = error?.response?.data?.detail;
      const text = typeof detail === 'string' ? detail : '详情加载失败';
      if (recordOnly) setRecordLinkError(text);
      else message.error(text);
    });
    return () => { cancelled = true; };
  }, [platformForm?.id, linkedRecordId, recordOnly]);
  const closeDetail = () => {
    setDetailRecord(null);
    onCloseRecordLink?.();
  };
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
  if (platformForm?.runtime_submission_available && hasImplicitApprovalStatus(stableListSettings) && !listFields.includes(APPROVAL_STATUS_FIELD)) {
    (tableColumns as any[]).push({ ...approvalTableColumn, key: '_approval', fixed: 'right' });
  }
  const rowActions=viewConfig?.table.rowActions||[];
  const configuredToolbarActions = activeViewTab?.table?.toolbarActions || pageConfig?.config.viewConfig?.table?.toolbarActions;
  const toolbarActions = viewConfig?.table.toolbarActions || configuredToolbarActions || ['settings'];
  const canConfigureForm = Boolean(platformForm) && canConfigureWorkspace(Boolean(user?.is_admin), canRunAction('configure'));
  const openWorkspace = (tab: WorkspaceEditorTab) => {
    if (platformForm && canConfigureForm && !modalOpen && !importOpen && !detailRecord && !schemaLoading) {
      navigate(tab === 'permission' ? formPermissionsPath(platformForm.id) : businessDataDesignPath(platformForm.id, tab));
    }
  };
  const workspaceMenuItems = [
    { key: 'data', label: '列表与筛选' },
    { key: 'flow', label: '流程与审批' },
    { key: 'permission', label: '权限管理' },
  ];
  const workspaceEntry = canConfigureForm ? <div className="form-workspace-entry">
    <Dropdown.Button trigger={['click']} icon={<DownOutlined aria-label="更多表单设置" />} onClick={() => openWorkspace('form')}
      menu={{ items: workspaceMenuItems, onClick: ({ key }) => openWorkspace(key as WorkspaceEditorTab) }}
      buttonsRender={([left, right]) => [React.cloneElement(left as React.ReactElement<any>, { icon: <EditOutlined /> }), right]}>
      编辑表单
    </Dropdown.Button>
  </div> : null;
  const refreshPublishedConfig = () => {
    configPending.current = true;
    requestIdRef.current += 1;
    setConfigRevision(revision => revision + 1);
  };
  const renderWorkspace = (runtime: React.ReactNode) => <div className="form-workspace">
    <div className="form-workspace-runtime">{withCanonTheme(runtime)}</div>
  </div>;
  if (rowActions.length && !toolbarTargetId) {
    (tableColumns as any[]).push({
      title: '操作', width: Math.max(64, 16 + [rowActions.includes('detail'), rowActions.includes('edit') && canRunAction('edit'), rowActions.includes('delete') && canRunAction('delete')].filter(Boolean).length * 40), fixed: 'right',
      render: (_val: any, record: any) => (
        <div className="mf-row-actions">
          {rowActions.includes('detail')&&<Button type="link" size="small" onClick={() => openDetail(record)}>详情</Button>}
          {rowActions.includes('edit') && canRunAction('edit') && (!record._approval || record._approval.can_edit) && <Button type="link" size="small" onClick={() => openEditModal(record)}>编辑</Button>}
          {rowActions.includes('delete') && canRunAction('delete') && (!record._approval || record._approval.can_edit) && (
            <Popconfirm title="确定删除？" onConfirm={() => handleDelete(record.id)}>
              <Button type="link" size="small" danger>删除</Button>
            </Popconfirm>
          )}
        </div>
      ),
    });
  }

  const loadMutationSchema = async (scope: 'create' | 'edit', copyRecordId?: number) => {
    if (!slug || !platformForm || schemaSlug.current !== slug) return null;
    const request = ++mutationSchemaRequest.current;
    setSchemaLoading(true);
    try {
      const numericFormId = Number(slug);
      const [schema, source] = await Promise.all([
        !Number.isNaN(numericFormId)
          ? getPlatformForm(numericFormId, {schema:'published', scope})
          : getPlatformFormByCode(slug, {schema:'published', scope}),
        copyRecordId === undefined ? undefined : getPlatformDynamicRecord(platformForm.id, copyRecordId),
      ]);
      if (request !== mutationSchemaRequest.current) return null;
      const detail = unwrapApiData<PlatformForm>(schema);
      const nodes = (detail?.config?.formLayout as { version?: number; nodes?: FormLayoutNode[] } | undefined);
      setMutationGap(Number((detail?.config?.canvasSettings as any)?.gap)||12);
      setMutationLayout(nodes?.version === 2 && Array.isArray(nodes.nodes) ? nodes.nodes : null);
      setMutationAppearance(normalizeFormAppearance(detail?.config?.formAppearance));
      return {
        fields: (detail?.fields ?? []).filter(field=>!field.archived).map(mapPlatformField),
        copySource: source ? unwrapApiData<RecordCopySource>(source) : undefined,
      };
    } catch (error) {
      if (request !== mutationSchemaRequest.current) return null;
      throw error;
    } finally {
      if (request === mutationSchemaRequest.current) setSchemaLoading(false);
    }
  };

  const openCreateModal = async (copyRecordId?: number) => {
    if (readOnly || !platformForm) return;
    if (copyRecordId !== undefined && (!canRunAction('view') || !canRunAction('create'))) return;
    if (platformForm.code === 'alert-center') {setAlertCreateOpen(true);return;}
    setEditingRecord(null);
    try {
      const schema = await loadMutationSchema('create', copyRecordId);
      if (!schema) return;
      const {fields: nextFields, copySource} = schema;
      if (copyRecordId !== undefined && !copySource?.data) throw new Error('记录数据不可用');
      setMutationFields(nextFields);
      form.resetFields();
      setRuleStates({});
      setRuleData({});
      setRuleError('');
      const defaults:Record<string,unknown>={};
      for(const field of nextFields){const settings=field.typeSettings||{};
        if(field.defaultValue!==undefined&&field.defaultValue!==null&&field.defaultValue!==''){let value=field.defaultValue;if(['int','integer','number','float','decimal','json','boolean'].includes(field.field_type)||settings.selectionMode==='multiple'||settings.displayMode==='tags'){try{value=JSON.parse(String(value));}catch{}}else value=String(value);defaults[field.field_name]=value;}
        else if(field.controlType==='switch')defaults[field.field_name]=Boolean(settings.defaultChecked);
        else if(field.controlType==='datetime'&&settings.defaultDate&&settings.defaultDate!=='none'&&settings.dateMode!=='range')defaults[field.field_name]=dayjs().format(settings.dateMode==='date'?'YYYY-MM-DD':'YYYY-MM-DDTHH:mm:ss');
      }
      form.setFieldsValue(copySource ? {...defaults,...recordCopyValues(copySource,nextFields)} : defaults);
      setModalOpen(true);
    } catch {
      message.error(copyRecordId === undefined ? '新增表单配置加载失败' : '无法复制记录，请确认该记录仍可查看后重试');
    }
  };

  const openEditModal = async (record: Record<string, any>) => {
    if (platformForm?.code==='alert-center') {await openDetail(record);return;}
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
      const loadedFields = await loadMutationSchema('edit');
      if (!loadedFields) return;
      nextFields = loadedFields.fields;
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
    if (!policy.masked && field.controlType === 'upload') {
      const files = Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : [];
      return <FieldProtection {...policy}>{files.length ? <ul className="mf-detail-files">{files.map((file: any, index: number) => <li key={String(file.id ?? index)}>
        {platformForm && file.id != null && !String(file.id).startsWith('pending-')
          ? <button type="button" className="mf-link-btn" onClick={() => void downloadDetailFile(field.field_name, file)}>{file.name || '附件'}</button>
          : <span>{file.name || '附件'}</span>}
      </li>)}</ul> : <span className="mf-empty-mark">暂无附件</span>}</FieldProtection>;
    }
    const empty = value == null || value === '' || (Array.isArray(value) && !value.length);
    return <FieldProtection {...policy}>{!policy.masked&&referenceLabels[field.field_name]?.[String(value)]?referenceLabels[field.field_name][String(value)]:['editable-table','readonly-table'].includes(field.controlType||'')&&!policy.masked?<FieldControl disabled type={field.controlType!} value={value} settings={field.typeSettings} formId={platformForm?.id} fieldName={field.field_name} recordId={detailRecord?.id} label={field.label}/>:empty?<span className="mf-empty-mark">—</span>:typeof value==='object'?JSON.stringify(value):String(value)}</FieldProtection>;
  };
  const downloadDetailFile = async (fieldName: string, file: { id: string | number; name?: string }) => {
    if (!platformForm) return;
    try {
      const response = await downloadFormFile(platformForm.id, fieldName, String(file.id), detailRecord?.id);
      const url = URL.createObjectURL(response.data);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = file.name || '附件'; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { message.error('附件下载失败或无访问权限'); }
  };
  const renderDynamicFilterControl = (filter: ViewFilterConfig) => {
    const field = fields.find((item) => item.field_name === filter.fieldName);
    // The label already names the field, so placeholders only say what to do.
    const customPlaceholder = filter.placeholder && !filter.placeholder.includes(filter.label) ? filter.placeholder : undefined;
    const placeholder = customPlaceholder || '输入…';
    const choicePlaceholder = customPlaceholder || '全部';
    if (filter.fieldName === APPROVAL_STATUS_FIELD) {
      return <Select aria-label={filter.label} allowClear placeholder={choicePlaceholder} options={approvalStatusOptions} />;
    }
    if (filter.fieldName === '_record_id') {
      return <InputNumber aria-label={filter.label} min={1} max={Number.MAX_SAFE_INTEGER} precision={0} style={{width:'100%'}} placeholder="输入编号" />;
    }
    if (filter.fieldName === '_created_at' || filter.fieldName === '_updated_at') {
      return <DatePicker.RangePicker style={{width:'100%'}} placeholder={['开始日期','结束日期']} />;
    }
    if ((filter.fieldName === '_created_by' || filter.fieldName === '_updated_by') && recordActorOptionLoaders) {
      return <RelationPicker aria-label={filter.label} placeholder="选择人员" modelName="" loadOptions={recordActorOptionLoaders[filter.fieldName]} />;
    }
    if(display==='filters'&&field){
      if(filter.controlType==='relation'&&platformForm)return <RelationPicker formId={platformForm.id} fieldName={field.field_name} contextData={Object.fromEntries((viewConfig?.filters||[]).map(item=>[item.fieldName,filterForm.getFieldValue(item.id)]))} modelName="" placeholder={choicePlaceholder} allowClear={field.typeSettings?.allowClear!==false} showSearch={field.typeSettings?.displayMode!=='dropdown'}/>;
      if(field.controlType==='switch'||field.field_type==='boolean')return <Select allowClear placeholder={choicePlaceholder} options={[{value:true,label:field.typeSettings?.checkedText||'是'},{value:false,label:field.typeSettings?.uncheckedText||'否'}]}/>;
      if(filter.controlType==='select'){
        const mode=fieldControls?.[filter.fieldName];
        const settings=mode?{
          ...field.typeSettings,
          selectionMode:mode==='multi-dropdown'||mode==='checkbox'?'multiple':'single',
          displayMode:mode==='radio'||mode==='checkbox'?'radio':'search',
          maxSelections:100, allowClear:true,
        }:field.typeSettings;
        return <FieldControl type="select" label={filter.label} settings={{...settings,allowCreateOption:false}} options={field.enum_values} placeholder={choicePlaceholder}/>;
      }
      if(filter.controlType==='date'||filter.controlType==='dateRange')return <FieldControl type="datetime" label={filter.label} settings={{dateMode:field.field_type==='date'?'date':field.typeSettings?.dateMode??'datetime',...field.typeSettings}} placeholder={customPlaceholder||'选择日期'}/>;
      if(filter.controlType==='number')return <FieldControl type="number" label={filter.label} settings={field.typeSettings} placeholder={placeholder}/>;
    }
    if (filter.controlType === 'dateRange') return <DatePicker.RangePicker style={{ width: '100%' }} />;
    if (filter.controlType === 'date') return <DatePicker style={{ width: '100%' }} placeholder={customPlaceholder || '选择日期'} />;
    if(filter.controlType==='relation'&&field?.relation_config&&platformForm)return <RelationPicker formId={platformForm.id} fieldName={field.field_name} contextData={{}} modelName="" placeholder={choicePlaceholder}/>;
    if (filter.controlType === 'number') return <InputNumber style={{ width: '100%' }} placeholder={placeholder} />;
    if (filter.controlType === 'select' || field?.field_type === 'enum') {
      const opts = enumOptions(field?.enum_values);
      return <Select allowClear placeholder={choicePlaceholder} options={opts} />;
    }
    return <Input allowClear prefix={filter.controlType === 'keyword' ? <SearchOutlined /> : undefined} placeholder={placeholder} />;
  };

  if (recordOnly && (!pageConfig || !viewConfig)) return withCanonTheme(
    <Drawer title="记录详情" open onClose={closeDetail} width={560} className="mf-canon-drawer" rootClassName="mf-canon-form-root">
      {configError ? <Alert type="error" showIcon message={configError} /> : <Spin tip="正在加载记录"><div /></Spin>}
    </Drawer>
  );
  if (aliasProgramRoute || (!pageConfig && !configError)) {
    return renderWorkspace(<div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>);
  }

  if (!pageConfig || !viewConfig) {
    return renderWorkspace(
      <div onCopyCapture={protectCopy} onCutCapture={protectCopy} className={`mf-canon mf-list-page ${standalone ? 'mf-list-standalone' : 'mf-list-embedded'}`}>
        <div className="mf-list-head">
          <span className={`mf-pill mf-pill-${configDenied ? 'danger' : 'neutral'}`}>{configDenied ? '无访问权限' : '缺少视图配置'}</span>
          {!embedded && workspaceEntry}
        </div>
        <section className="mf-list-card mf-list-empty">
          <StateBlock
            kind={configDenied ? 'denied' : 'empty'}
            title={configDenied ? '无访问权限' : '缺少数据视图配置'}
            description={configError || '当前表单缺少已发布的数据视图配置'}
          />
        </section>
      </div>
    );
  }

  const defaultFormTitle = editingRecord
    ? `编辑${pageConfig.title}`
    : `${platformForm?.runtime_submission_available ? '填写申请：' : '新增记录：'}${pageConfig.title}`;
  const { title, description, titleAlign, titleColor, backgroundColor } = mutationAppearance;
  const formSurfaceStyle = backgroundColor ? { backgroundColor } : undefined;
  const formHeading = title || description || titleAlign || titleColor
    ? <FormAppearanceHeader
        appearance={mutationAppearance}
        fallbackTitle={defaultFormTitle}
        className="record-form-heading"
        defaultAlign="left"
      />
    : defaultFormTitle;

  const keywordInHeader=display==='filters'&&Boolean(toolbarTargetId);
  const keywordField=filterSettings?.showKeyword!==false&&<Form.Item name="keyword" label={keywordInHeader||!filterLayout?undefined:'关键词'} className={keywordInHeader?'component-header-keyword':'mf-filter-keyword'}>
    <Input aria-label="关键词" allowClear prefix={<SearchOutlined />} placeholder="搜索业务记录" form={filterFormId}
      onPressEnter={keywordInHeader?event=>{event.preventDefault();if(canQuery)filterForm.submit();}:undefined}/>
  </Form.Item>;
  const filterActions = (
<Space size={6}>
            {canReset&&<Button onClick={() => {
              if(!canReset)return;
              setAutoFilterRevision(0);
              if(filterSettings?.resetMode==='clear'){
                const cleared=clearedFilterValues(activeFilters);
                filterForm.setFields([{name:'keyword',value:'',errors:[]},...Object.entries(cleared).map(([name,value])=>({name,value,errors:[]}))]);
                setFilterValues(cleared);
              }else{filterForm.resetFields();setFilterValues({});}
              setSearch('');setPage(1);
            }}>{filterSettings?.resetLabel||'重置'}</Button>}
            {canQuery&&filterSettings?.queryMode!=='change'&&<Button type="primary" htmlType="submit" form={filterFormId}>{filterSettings?.queryLabel||'查询'}</Button>}
          </Space>
  );
  // The compact legacy layout keeps its expandable field list.
  const filterRow = !filterLayout;
  const leadFilter = (filter: ViewFilterConfig, index: number) => !filterRow || index < 3 || requiredFilterFields.includes(filter.fieldName);
  const moreFilters = activeFilters.filter((filter, index) => !leadFilter(filter, index));
  const appliedFilterCount = (list: ViewFilterConfig[]) => list.filter(filter => !emptyFilterValue(filterValues[filter.id])).length;
  const moreFilterCount = appliedFilterCount(moreFilters);
  const allFilterCount = appliedFilterCount(activeFilters);
  const filterToggles = filterRow && <>
    {moreFilters.length > 0 && <Button className="mf-filter-toggle mf-filter-toggle-desktop" aria-expanded={filtersExpanded} onClick={() => setFiltersExpanded(open => !open)}>
      {filtersExpanded ? '收起筛选' : `更多筛选${moreFilterCount ? ` (${moreFilterCount})` : ''}`}
    </Button>}
    {activeFilters.length > 0 && <Button className="mf-filter-toggle mf-filter-toggle-mobile" aria-expanded={filtersExpanded} onClick={() => setFiltersExpanded(open => !open)}>
      {filtersExpanded ? '收起筛选' : `筛选${allFilterCount ? ` (${allFilterCount})` : ''}`}
    </Button>}
  </>;
  const showBodyActions = !(display==='filters'&&toolbarTargetId);
  const showFilterActions = showBodyActions && (filterRow || canReset || (canQuery && filterSettings?.queryMode !== 'change'));
  const keywordInGrid = !keywordInHeader && Boolean(keywordField);
  const filterFieldContent = <>
    {keywordInGrid&&keywordField}
    {activeFilters.map((filter, index) => (
      <Form.Item key={filter.id} name={filter.id} label={filter.label}
        className={[
          filterRow && (leadFilter(filter, index) ? 'mf-filter-lead' : 'mf-filter-more'),
          filter.controlType==='dateRange' && isRecordMetadataField(filter.fieldName) && 'mf-filter-record-date-range',
        ].filter(Boolean).join(' ')}
        hidden={!leadFilter(filter, index) && !filtersExpanded}
        rules={[{required:requiredFilterFields.includes(filter.fieldName),validator:(_,value)=>requiredFilterFields.includes(filter.fieldName)&&emptyFilterValue(value)?Promise.reject(new Error(`请填写${filter.label}`)):Promise.resolve()}]}
        initialValue={filter.controlType==='date'?filter.defaultValue&&dayjs(String(filter.defaultValue)):filter.controlType==='dateRange'?Array.isArray(filter.defaultValue)?filter.defaultValue.map(v=>dayjs(v)):undefined:filter.defaultValue}>
        {renderDynamicFilterControl(filter)}
      </Form.Item>
    ))}
  </>;
  const filterContent = (
      <Form id={filterFormId} onValuesChange={()=>setAutoFilterRevision(value=>value+1)} key={activeViewTab?.id || 'default'}
        className={['mf-list-filter', display === 'filters' && 'mf-list-filter-bare', filterRow ? 'mf-list-filter-row' : 'mf-list-filter-configured', filtersExpanded && 'is-expanded'].filter(Boolean).join(' ')}
        form={filterForm}
        colon={false}
        layout="horizontal"
        onFinishFailed={filterRow ? () => setFiltersExpanded(true) : undefined}
        scrollToFirstError={filterLayout ? {block:'nearest', focus:true} : undefined}
        onFinish={(values) => {
          if(display==='filters'&&!canQuery)return;
          setPage(1);
          setSearch(filterSettings?.showKeyword===false?'':String(values.keyword || ''));
          setFilterValues(values);
        }}
      >
        {keywordInHeader&&toolbarTarget&&createPortal(canonPortal(<Space size={8} wrap>{keywordField}{filterActions}</Space>),toolbarTarget)}
        {filterLayout
          ? (keywordInGrid || activeFilters.length > 0) && <FilterFieldsViewport {...filterLayout}
              fieldKey={JSON.stringify([keywordInGrid, ...activeFilters.map(filter=>filter.id)])}>
              {filterFieldContent}
            </FilterFieldsViewport>
          : <div className="mf-list-filter-fields">{filterFieldContent}</div>}
        {(showFilterActions || (filterRow && activeFilters.length > 0)) && <Form.Item className={`mf-list-filter-actions${showBodyActions ? '' : ' mf-list-filter-actions-toggle'}`}>
          <div className="mf-filter-buttons">{filterToggles}{showFilterActions && filterActions}</div>
        </Form.Item>}
      </Form>
  );
  const missingFilterBinding = requiredFilterFields.some(name=>!activeFilters.some(filter=>filter.fieldName===name));
  if (display === 'filters') return withCanonTheme(<div className="mf-canon mf-list-filters-only">
    {missingFilterBinding&&<Alert type="warning" showIcon message="必填筛选字段已失效，请重新配置筛选字段。" />}
    {canQuery&&filterSettings?.queryMode==='change'&&<p className="mf-list-filter-hint">条件变更后自动查询，必填条件校验通过后生效。</p>}
    {configError && <Alert type="warning" showIcon message={configError} />}
    {filterContent}
  </div>);

  const iconOnlyToolbar = Boolean(toolbarTargetId);
  const previewToolbar = iconOnlyToolbar && readOnly;
  const createLabel = platformForm?.runtime_submission_available ? '填写申请' : '新增';
  const createAction = (toolbarActions.includes('create') && (previewToolbar || canRunAction('create'))) && (
    <Tooltip title={iconOnlyToolbar ? createLabel : undefined}>
      <Button aria-label={createLabel} type="primary" icon={<PlusOutlined />} loading={schemaLoading} disabled={readOnly || !toolbarActions.includes('create') || runtimePermissions.create === false} onClick={()=>void openCreateModal()}>{iconOnlyToolbar ? undefined : createLabel}</Button>
    </Tooltip>
  );
  const hasViewsRow = standalone || Boolean(runtimeViewTabs?.length);
  const canRefresh = toolbarActions.includes('refresh');
  const refreshDisabled = runtimePermissions.refresh === false;
  const refreshAction = canRefresh && (
    <Tooltip title="刷新"><Button className="mf-list-refresh" aria-label="刷新" type={hasViewsRow ? 'text' : 'default'} icon={<ReloadOutlined />} loading={loading} disabled={refreshDisabled} onClick={loadData} /></Tooltip>
  );
  const canImport = toolbarActions.includes('import')&&(previewToolbar || canRunAction('import')&&canRunAction('create'));
  const importDisabled = readOnly || !canRunAction('import') || !canRunAction('create');
  const importAction = canImport && <Tooltip title={iconOnlyToolbar ? '批量导入' : undefined}>
    <Button disabled={importDisabled} aria-label="批量导入" icon={<UploadOutlined/>} onClick={()=>setImportOpen(true)}>{iconOnlyToolbar ? undefined : '导入'}</Button>
  </Tooltip>;
  const canExport = toolbarActions.includes('export')&&(previewToolbar || canRunAction('export'));
  const exportDisabled = readOnly || !canRunAction('export');
  const exportPage = async()=>{
        if(!platformForm)return;setExporting(true);
        try{const res=await exportPlatformDynamicRecords(platformForm.id,{page,page_size:viewConfig.table.pageSize,search:(externalSearch??search)||undefined,filters:structuredFilters.length?JSON.stringify(structuredFilters):undefined,sort_field:effectiveSortField||viewConfig.table.defaultSort?.fieldName,sort_order:effectiveSortOrder||(viewConfig.table.defaultSort?.order==='ascend'?'asc':'desc')});
          const url=URL.createObjectURL(new Blob([res.data],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=`${pageConfig.title}-第${page}页.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
        }catch(error:any){message.error(error?.response?.data?.detail||'导出失败');}finally{setExporting(false);}
  };
  const exportAction = canExport && <Tooltip title="导出当前页记录">
    <Button disabled={exportDisabled} aria-label="导出当前页记录" icon={<DownloadOutlined/>} loading={exporting} onClick={exportPage}>{iconOnlyToolbar ? undefined : '导出'}</Button>
  </Tooltip>;
  const showWorkspaceEntry = !embedded && Boolean(workspaceEntry);
  const overflowItems = [
    ...(showWorkspaceEntry ? [{ key: 'ws:form', label: '编辑表单' }, ...workspaceMenuItems.map(item => ({ ...item, key: `ws:${item.key}` }))] : []),
    ...(canImport ? [{ key: 'import', label: '导入', disabled: importDisabled }] : []),
    ...(canExport ? [{ key: 'export', label: '导出当前页', disabled: exportDisabled || exporting }] : []),
    ...(canRefresh && !hasViewsRow ? [{ key: 'refresh', label: '刷新', disabled: refreshDisabled }] : []),
  ];
  const onOverflowAction = ({ key }: { key: string }) => {
    if (key.startsWith('ws:')) openWorkspace(key.slice(3) as WorkspaceEditorTab);
    else if (key === 'import') setImportOpen(true);
    else if (key === 'export') void exportPage();
    else if (key === 'refresh') void loadData();
  };
  const hasListToolbar = Boolean(showWorkspaceEntry || (canRefresh && !hasViewsRow) || importAction || exportAction || createAction);
  const listToolbar = (
        <div className="mf-list-actions">
          <div className="mf-list-actions-desktop">{showWorkspaceEntry && workspaceEntry}{!hasViewsRow && refreshAction}{importAction}{exportAction}{createAction}</div>
          <div className="mf-list-actions-mobile">
            {createAction}
            {overflowItems.length > 0 && <Dropdown trigger={['click']} menu={{ items: overflowItems, onClick: onOverflowAction }}>
              <Button className="mf-list-more" aria-label="更多" icon={<EllipsisOutlined />} />
            </Dropdown>}
          </div>
        </div>
  );
  const formDescription = platformForm?.description?.trim() || '';
  // Generator defaults are placeholders, not descriptions written for this form.
  const pageDescription = ['Created from an AI Agent low-code plan.', 'Database-backed platform form.'].includes(formDescription) ? '' : formDescription;
  const selectionEnabled = Boolean(listSettings?.selection && listSettings.selection !== 'none');
  const listBusy = loading || configRefreshing;
  const listRootId = `${filterFormId}-records`;
  const countPill = !listBusy && <span className="mf-count">{total.toLocaleString()}</span>;
  const listStatus = (visible: boolean) => <span className={`mf-list-status${visible ? '' : ' mf-sr-only'}`} role="status" aria-live="polite">{listBusy ? '正在加载记录…' : `共 ${total.toLocaleString()} 条记录`}</span>;
  const canonScrollX = (tableColumns as Array<{ width?: number; canonMinWidth?: number }>).reduce((sum, column) => sum + (column.canonMinWidth || column.width || 112), selectionEnabled ? 48 : 0);
  const paginationItem = (current: number, type: 'page' | 'prev' | 'next' | 'jump-prev' | 'jump-next', element: React.ReactNode) => {
    const label = type === 'prev' ? '上一页' : type === 'next' ? '下一页' : type === 'jump-prev' ? '向前 5 页' : type === 'jump-next' ? '向后 5 页' : `第 ${current} 页`;
    return React.isValidElement(element) ? React.cloneElement(element as React.ReactElement<any>, { 'aria-label': label }) : element;
  };
  const listAlerts = <>
      {listError&&<Alert type="error" showIcon message={listError} action={<Button size="small" onClick={()=>void loadData()}>重试</Button>} />}
      {listSettings?.columns?.some(name=>!baseViewConfig?.table.columns.some(column=>column.enabled&&column.fieldName===name))&&<Alert type="warning" showIcon message="部分配置列在当前发布视图中不可用，已自动隐藏。" />}
      {configError && <Alert type="warning" showIcon message={configError} action={<Button size="small" onClick={refreshPublishedConfig}>重新加载配置</Button>} />}
  </>;

  const selectedRows = data.filter(row => selectedRowKeys.includes(row.id));
  const canCopy = toolbarActions.includes('copy') && platformForm?.code !== 'alert-center'
    && (previewToolbar || canRunAction('view') && canRunAction('create'));
  const copyRow = selectedRows.length === 1 && selectedRowKeys.length === 1 ? selectedRows[0] : undefined;
  const submittableRows = readOnly || !platformForm?.runtime_submission_available ? [] : selectedRows.filter(row => row._approval?.can_submit);
  const showDeleteSelected = stableListSettings?.toolbarGroups == null || toolbarActions.includes('delete');
  const deletableRows = showDeleteSelected && rowActions.includes('delete') && canRunAction('delete')
    ? selectedRows.filter(row => !row._approval || row._approval.can_edit) : [];
  const bulkDeleteAllowed = deletableRows.length > 0;
  const exportSelected = () => {
    const columns = fields.filter(field => !field.field_name.startsWith('_'));
    const cell = (value: unknown) => {
      const text = value === undefined || value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
      // Keep spreadsheet software from evaluating formula-like cell content.
      const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
      return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const lines = [columns.map(field => cell(field.label)).join(','),
      ...selectedRows.map(row => columns.map(field => cell(row._fieldStates?.[field.field_name]?.masked ? '' : row[field.field_name])).join(','))];
    const url = URL.createObjectURL(new Blob([`\ufeff${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `${pageConfig.title}-已选${selectedRows.length}条.csv`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const runBulk = async (rows: any[], action: (row: any) => Promise<unknown>, verb: string) => {
    setBulkBusy(true);
    let failed = 0;
    for (const row of rows) {
      try { await action(row); } catch { failed += 1; }
    }
    setBulkBusy(false);
    const done = rows.length - failed;
    if (!failed) message.success(`已${verb} ${done} 条记录`);
    else if (done) message.warning(`已${verb} ${done} 条，${failed} 条失败`);
    else message.error(`${verb}失败，请检查记录状态或权限`);
    setSelectedRowKeys([]);
    await loadData();
    if (done) onMutated?.();
  };
  const submitSelected = () => {
    if (!platformForm || !submittableRows.length) return;
    const rows = submittableRows;
    const skipped = selectedRows.length - rows.length;
    Modal.confirm({
      title: `确认提交 ${rows.length} 条记录审批？`,
      content: `${skipped ? `另有 ${skipped} 条当前状态不能提交，将被跳过。` : ''}提交后统一进入流程与待办，审批期间不能修改来源记录。`,
      okText: '提交审批', cancelText: '取消',
      onOk: () => runBulk(rows, row => submitPlatformDynamicRecord(platformForm.id, row.id, row._approval.status), '提交'),
    });
  };
  const deleteSelected = () => {
    if (!platformForm || !deletableRows.length) return;
    const rows = deletableRows;
    const skipped = selectedRows.length - rows.length;
    Modal.confirm({
      title: `确定删除 ${rows.length} 条记录？`,
      content: `${skipped ? `另有 ${skipped} 条当前状态不能删除，将被跳过。` : ''}删除后记录将从列表移除。`,
      okText: '删除', okButtonProps: { danger: true }, cancelText: '取消',
      onOk: () => runBulk(rows, row => deletePlatformDynamicRecord(platformForm.id, row.id), '删除'),
    });
  };
  const detailTitle = (() => {
    const fieldName = listFields.find(name => name !== APPROVAL_STATUS_FIELD && !isRecordMetadataField(name));
    const field = fields.find(item => item.field_name === fieldName);
    const value = fieldName ? detailRecord?.[fieldName] : undefined;
    if (!detailRecord) return '';
    if (!fieldName || detailRecord._fieldStates?.[fieldName]?.masked || value === undefined || value === null || value === '' || typeof value === 'object') return `记录 #${detailRecord.id}`;
    if (referenceLabels[fieldName]?.[String(value)]) return referenceLabels[fieldName][String(value)];
    return field && (field.controlType === 'select' || field.field_type === 'enum') ? choiceLabel(value, field.enum_values) : String(value);
  })();
  const formatHistoryTime = (value: unknown) => {
    const date = parseServerDate(value as string);
    return date ? dayjs(date).format('YYYY-MM-DD HH:mm') : String(value);
  };
  const detailButtons = [
    platformForm && detailRecord?._approval && <Button key="flow" onClick={() => navigate(`/workflow?tab=initiated&source_form_id=${platformForm.id}&source_record_id=${detailRecord.id}`)}>查看流程</Button>,
    !readOnly && (detailRecord?._approval ? detailRecord._approval.can_edit : canRunAction('edit')) && <Button key="edit" onClick={() => detailRecord && openEditModal(detailRecord)}>编辑</Button>,
    !readOnly && detailRecord?._approval?.can_submit && <Button key="submit" type="primary" loading={submittingApproval} onClick={submitApproval}>{detailRecord._approval.status === 'rejected' ? '重新提交' : '提交审批'}</Button>,
  ].filter(Boolean);
  const detailActions = detailButtons.length ? detailButtons : null;

  const listFiltered = Boolean((externalSearch ?? search) || structuredFilters.length);
  const recordTable = (
      <Table
        className={`mf-list-table${!disableRowAction && viewConfig.table.rowClickAction !== 'none' ? ' mf-list-table-clickable' : ''}`}
        tableLayout="fixed"
        sticky={standalone ? { getContainer: () => document.getElementById(listRootId) || window } : undefined}
        dataSource={data}
        columns={tableColumns}
        rowKey="id"
        rowSelection={listSettings?.selection&&listSettings.selection!=='none'?{type:listSettings.selection==='single'?'radio':'checkbox',selectedRowKeys,onChange:keys=>setSelectedRowKeys(keys)}:undefined}
        locale={{emptyText: listError
          ? <StateBlock kind="error" title="记录加载失败" description={listError} action={<Button size="small" onClick={() => void loadData()}>重试</Button>} />
          : listPresentation.emptyText
            ? <StateBlock kind={listFiltered ? 'no-match' : 'empty'} title={listPresentation.emptyText} />
            : listFiltered
              ? <StateBlock kind="no-match" title="暂无匹配记录" description="请调整筛选条件后重新查询。" />
              : <StateBlock kind="empty" title="暂无记录" description={canRunAction('create') && toolbarActions.includes('create') ? '点击上方新增按钮创建第一条记录。' : '记录添加后会显示在这里。'} />}}
        onRow={disableRowAction || viewConfig.table.rowClickAction === 'none' ? undefined : record=>({onClick:event=>{
          if((event.target as HTMLElement).closest('button,a,input,.ant-select,.ant-popover'))return;
          if(viewConfig.table.rowClickAction==='detail')void openDetail(record);
          if(viewConfig.table.rowClickAction==='edit'&&canEditRecord(record))void openEditModal(record);
        }})}
        loading={loading || configRefreshing}
        size={tableDensity ? tableDensity === 'compact' ? 'small' : tableDensity === 'comfortable' ? 'large' : 'middle' : viewConfig.table.density === 'compact' ? 'small' : viewConfig.table.density === 'large' ? 'large' : 'middle'}
        scroll={{x: canonScrollX, y: fitTableHeight ? '100%' : undefined}}
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
          showTotal: (t) => `共 ${t.toLocaleString()} 条`,
          itemRender: paginationItem,
          onChange: (p) => setPage(p),
        }}
      />
  );

  return renderWorkspace(
    <div id={listRootId} onCopyCapture={protectCopy} onCutCapture={protectCopy} className={`mf-canon mf-list-page ${standalone ? 'mf-list-standalone' : 'mf-list-embedded'}`}>
      {!recordOnly && <>
      {standalone ? <header className="mf-list-head">
          <div className="mf-list-heading">
            <h1>{pageConfig.title}</h1>
            {pageDescription && <p>{pageDescription}</p>}
          </div>
          {listToolbar}
        </header>
        : toolbarTargetId ? hasListToolbar && toolbarTarget && createPortal(canonPortal(listToolbar), toolbarTarget)
        : hasListToolbar && <div className="mf-list-head mf-list-head-inline">{listToolbar}</div>}
      {listAlerts}
      {display !== 'list' && (keywordField || activeFilters.length > 0) && filterContent}
      <section className="mf-list-card" aria-label={`${pageConfig.title}记录`}>
        {hasViewsRow ? <div className="mf-list-views">
          {runtimeViewTabs && runtimeViewTabs.length > 0
            ? <Tabs className="mf-list-tabs" activeKey={activeViewTab?.id} onChange={switchViewTab}
                items={runtimeViewTabs.map((tab) => ({ key: tab.id, label: <span className="mf-tab-label">{tab.name}{tab.id === activeViewTab?.id && countPill}</span> }))} />
            : <div className="mf-list-view-current"><span>全部记录</span>{countPill}</div>}
          {listStatus(listBusy)}
          {refreshAction}
        </div> : listStatus(false)}
        {selectionEnabled && selectedRowKeys.length > 0 && <div className="mf-list-bulk" role="region" aria-label="批量操作">
          <strong>已选 {selectedRowKeys.length} 项</strong>
          <button type="button" className="mf-link-btn" onClick={() => setSelectedRowKeys([])}>取消选择</button>
          {(canCopy || canExport || submittableRows.length > 0 || bulkDeleteAllowed) && <span className="mf-list-bulk-divider" aria-hidden />}
          {canCopy && <Tooltip title={readOnly ? '预览中不可复制' : copyRow ? undefined : '请选择一条记录'}>
            <span><button type="button" className="mf-link-btn" disabled={readOnly || !copyRow || schemaLoading || listBusy || bulkBusy}
              onClick={()=>{if (copyRow) void openCreateModal(copyRow.id);}}>复制记录</button></span>
          </Tooltip>}
          {canExport && <button type="button" className="mf-link-btn" disabled={exportDisabled || bulkBusy} onClick={exportSelected}>导出所选</button>}
          {submittableRows.length > 0 && <button type="button" className="mf-link-btn" disabled={bulkBusy} onClick={submitSelected}>批量提交审批 ({submittableRows.length})</button>}
          {bulkDeleteAllowed && <button type="button" className="mf-link-btn mf-link-btn-danger" disabled={bulkBusy} onClick={deleteSelected}>删除</button>}
        </div>}
        {recordTable}
      </section>

      {platformForm&&<FormImport key={platformForm.id} formId={platformForm.id} open={importOpen} onClose={()=>setImportOpen(false)} onImported={()=>{setPage(1);void loadData();onMutated?.();}}/>}
      </>}
      {platformForm?.code==='alert-center'&&(alertCreateOpen||detailRecord)&&<Suspense fallback={<Spin/>}><AlertRecordPanel key={alertCreateOpen?'create':String(detailRecord?.id)} readOnly={readOnly} createOnly={alertCreateOpen} recordId={detailRecord?Number(detailRecord.id):undefined} onClose={()=>{setAlertCreateOpen(false);closeDetail();}} onMutated={()=>{void loadData();onMutated?.();}}/></Suspense>}
      <Drawer title={<div className="mf-canon-drawer-title"><strong title={detailTitle}>{detailTitle || '记录详情'}</strong><span>{pageConfig.title}</span></div>}
        open={(Boolean(detailRecord) && platformForm?.code!=='alert-center') || (recordOnly && !detailRecord)} onClose={closeDetail} width={560}
        className="mf-canon-drawer" rootClassName="mf-canon-form-root"
        extra={detailActions && <div className="mf-canon-drawer-actions">{detailActions}</div>}
        footer={detailActions && <div className="mf-canon-drawer-actions">{detailActions}</div>}>
        {recordOnly && !detailRecord && (recordLinkError ? <Alert type="error" showIcon message={recordLinkError} /> : <Spin tip="正在加载记录"><div /></Spin>)}
        {detailRecord && <>
          {detailRecord._approval && <p className="mf-canon-drawer-status">{APPROVAL_STATUS_LABEL}{renderApprovalStatus(detailRecord._approval)}</p>}
          <Descriptions bordered column={1} size="small" items={(detailFields.length ? detailFields : fields).filter(f => !f.field_name.startsWith('_') && detailRecord._fieldStates?.[f.field_name]?.visible !== false && (!detailRecord._fieldStates || f.field_name in detailRecord._fieldStates)).map(f => ({ key: f.field_name, label: f.label, children: renderDetailValue(f) }))} />
          {detailRecord._approval && <>
            <Typography.Title level={5}>审批与修改记录</Typography.Title>
            <Timeline items={(detailRecord._approval.history || []).map((entry: Record<string, unknown>) => ({ children: <Space direction="vertical" size={0}>
              <Typography.Text>{({ draft: '保存草稿', edit: '修改草稿', create: '保存草稿', update: '修改草稿', submit: '提交审批', approve: '审批通过', reject: '驳回' } as Record<string, string>)[String(entry.action)] || String(entry.action || '审批记录')}</Typography.Text>
              <Typography.Text type="secondary">{[entry.actor_name, entry.comment, entry.created_at && formatHistoryTime(entry.created_at)].filter(Boolean).map(String).join(' · ')}</Typography.Text>
            </Space> }))} />
          </>}
        </>}
      </Drawer>
      <Modal
        className="dynamic-business-modal mf-canon-form"
        rootClassName="mf-canon-form-root"
        title={formHeading}
        open={modalOpen}
        onOk={handleModalOk}
        onCancel={() => setModalOpen(false)}
        confirmLoading={confirmLoading || rulesLoading}
        okButtonProps={{ disabled: Boolean(ruleError)||(usesDraftLifecycle&&!canRunAction('saveDraft')) }}
        okText={usesDraftLifecycle ? '保存草稿' : '保存'}
        cancelText="取消"
        width={720}
        styles={{
          ...(formSurfaceStyle && { content: formSurfaceStyle, header: formSurfaceStyle, body: formSurfaceStyle }),
        }}
      >
        {usesDraftLifecycle && <p className="mf-canon-form-hint"><InfoCircleOutlined aria-hidden />先保存草稿，完成填写后从记录详情提交审批；驳回后可修改并重新提交。</p>}
        <Form
          form={form}
          name={`record-${platformForm?.id ?? 'form'}`}
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
          }} /> : <div className="mf-canon-form-grid">
            {formFields.filter(f => ruleStates?.[f.field_name]?.visible !== false).map(f => (
              <div key={f.field_name} className={isWideFormField(f) ? 'is-wide' : undefined}>
                {renderFormField(f, { formId: platformForm?.id, recordId: editingRecord?.id, data: ruleData, states: ruleStates })}
              </div>
            ))}
          </div>}
        </Form>
      </Modal>
    </div>
  );
}
