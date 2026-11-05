import InspectorTabs from '@/components/PropertyInspector/InspectorTabs';
import { PropertyGroup } from '@/components/PropertyInspector';
import './assembly.css';
import { MenuAccessPanel, FieldStructurePanel, RoleChecklist, type AssemblyRole, type NewAssemblyField } from './AssemblyPropertyPanels';
import { useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  AppstoreAddOutlined,
  AppstoreOutlined,
  BarChartOutlined,
  CheckCircleOutlined,
  CloseOutlined,
  DashboardOutlined,
  DeleteOutlined,
  DragOutlined,
  EditOutlined,
  FolderOutlined,
  FormOutlined,
  PlusOutlined,
  MenuOutlined,
  MoreOutlined,
  NodeIndexOutlined,
  SafetyCertificateOutlined,
  SaveOutlined,
  SendOutlined,
  ShopOutlined,
  StopOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import {
  Button,
  Card,
  Col,
  ConfigProvider,
  Empty,
  Dropdown,
  Modal,
  Form,
  Input,
  Popconfirm,
  Row,
  Select,
  Space,
  Switch,
  Tag,
  Table,
  Spin,
  Tree,
  Tooltip,
  Typography,
  message,
} from 'antd';
import type { DataNode } from 'antd/es/tree';
import api, {
  adminListApplications,
  adminCreateApplication,
  adminDeleteApplication,
  getPlatformForm,
  publishPlatformForm,
  copyPlatformForm,
  createPlatformForm,
  updatePlatformForm,
  adminListRoles,
  adminListUsers,
  createPlatformFormField,
  updatePlatformFormField,
  archivePlatformFormField,
  adminUpdateApplication,
  createPlatformMenuNode,
  deletePlatformMenuNode,
  deletePlatformForm,
  listPlatformForms,
  listPlatformMenuNodes,
  updatePlatformMenuNode,
  type PlatformForm,
  type PlatformFormField,
  type PlatformMenuNode,
} from '@/services/api';
import {
  type SavedAssemblyMenuNode,
} from '@/config/appAssemblyMenus';

import { persistApplication, persistForm, propertyError, assemblyFieldPayload, assemblyFieldUpdatePayload } from './assemblyPersistence';

const persistenceApi = { adminCreateApplication, adminUpdateApplication, getPlatformForm, createPlatformForm, updatePlatformForm };
const notifyApplicationsChanged = () => window.dispatchEvent(new Event('applications-changed'));

type AppRecord = {
  id: number;
  name: string;
  code: string;
  description?: string;
  icon?: string;
  default_route: string;
  sort_order: number;
  status: string;
  is_pinned: boolean;
  roles?: RoleRecord[];
};

type RoleRecord = {
  id: number;
  name: string;
  label: string;
};

type PermissionRule = {
  subjectType: 'app_roles' | 'roles' | 'users';
  roleIds?: number[];
  userKeys?: string[];
  actions: string[];
  effect: 'allow' | 'deny';
};

type FormRecord = {
  id: string;
  name: string;
  code: string;
  category?: 'interaction' | 'analytics';
  mode?: string;
  structureLocked?: boolean;
  entity: string;
  source: string;
  status: 'draft' | 'published' | 'disabled';
  creator: string;
  creatorId?: number | null;
  description: string;
  fields: number;
  fieldRows?: FieldRecord[];
  config?: Record<string, unknown>;
};

type FieldRecord = {
  raw?: PlatformFormField;
  id: string;
  label: string;
  code: string;
  columnName: string;
  dataType: string;
  length?: string;
  allowNull: boolean;
  unique: boolean;
  indexed: boolean;
  component: string;
  list: boolean;
  form: boolean;
  search: boolean;
};

type MenuNode = DataNode & {
  key: string;
  title: ReactNode;
  dbId?: number;
  parentDbId?: number | null;
  formId?: string;
  pageCode?: string;
  routePath?: string;
  visible?: boolean;
  defaultEntry?: boolean;
  permissionMode?: 'inherit' | 'custom';
  roleIds?: number[];
  permissionActions?: string[];
  permissionRules?: PermissionRule[];
  sortOrder?: number;
  config?: Record<string, unknown> | null;
  children?: MenuNode[];
};

type MenuPage = { code: string; title: string; publishedVersion: number };

const iconMap: Record<string, ReactNode> = {
  DashboardOutlined: <DashboardOutlined />,
  ToolOutlined: <ToolOutlined />,
  SafetyCertificateOutlined: <SafetyCertificateOutlined />,
  ShopOutlined: <ShopOutlined />,
  AppstoreOutlined: <AppstoreOutlined />,
};

const iconOptions = [
  { value: 'DashboardOutlined', label: 'Dashboard' },
  { value: 'ToolOutlined', label: 'Tool' },
  { value: 'SafetyCertificateOutlined', label: 'Quality' },
  { value: 'ShopOutlined', label: 'Supply Chain' },
  { value: 'AppstoreOutlined', label: 'Application' },
];

const analyticsModeOptions = [
  { label: '列表分析', value: 'list_analysis' },
  { label: 'BI 报表', value: 'bi_report' },
  { label: '指标看板', value: 'metric_dashboard' },
  { label: '经营驾驶舱', value: 'cockpit' },
];

function menuNode(
  key: string,
  label: string,
  formId?: string,
  children?: MenuNode[],
  defaultEntry = false,
  permissionMode: 'inherit' | 'custom' = 'inherit',
  roleIds: number[] = [],
  permissionActions: string[] = ['view'],
  permissionRules: PermissionRule[] = defaultPermissionRules(),
  pageCode?: string,
): MenuNode {
  return {
    key,
    title: <MenuTitle label={label} formId={formId} pageCode={pageCode} defaultEntry={defaultEntry} />,
    formId,
    pageCode,
    visible: true,
    defaultEntry,
    permissionMode,
    roleIds,
    permissionActions,
    permissionRules,
    children,
  };
}

function renderIcon(name?: string) {
  return iconMap[name || ''] || <AppstoreOutlined />;
}

function defaultPermissionRules(): PermissionRule[] {
  return [{ subjectType: 'app_roles', actions: ['view'], effect: 'allow' }];
}

function normalizePermissionRules(raw: unknown): PermissionRule[] {
  if (!Array.isArray(raw)) return defaultPermissionRules();
  const rules = raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const source = item as Record<string, unknown>;
      const subjectType = ['app_roles', 'roles', 'users'].includes(String(source.subjectType))
        ? (source.subjectType as PermissionRule['subjectType'])
        : 'app_roles';
      const effect = source.effect === 'deny' ? 'deny' : 'allow';
      const roleIds = Array.isArray(source.roleIds)
        ? source.roleIds.map((roleId) => Number(roleId)).filter(Number.isFinite)
        : [];
      const userKeys = Array.isArray(source.userKeys)
        ? source.userKeys.map((userKey) => String(userKey)).filter(Boolean)
        : [];
      const actions = ['view'];
      return { subjectType, roleIds, userKeys, actions, effect };
    })
    .filter(Boolean) as PermissionRule[];
  return rules.length ? rules : defaultPermissionRules();
}

function cleanMenuNodeConfig(config?: Record<string, unknown> | null): Record<string, unknown> {
  const {
    data_scope: _dataScope,
    permission_actions: _permissionActions,
    permission_rules: _permissionRules,
    ...rest
  } = config ?? {};
  return rest;
}

function serializeMenuNodes(nodes: MenuNode[]): SavedAssemblyMenuNode[] {
  return nodes.map((node) => ({
    key: node.key,
    label: getMenuLabel(node),
    formId: node.formId,
    routePath: node.routePath,
    visible: node.visible,
    defaultEntry: node.defaultEntry,
    permissionMode: node.permissionMode,
    roleIds: node.roleIds,
    permissionActions: node.permissionActions,
    permissionRules: node.permissionRules,
    children: node.children?.length ? serializeMenuNodes(node.children) : undefined,
  }));
}

function restoreMenuNodes(nodes: SavedAssemblyMenuNode[]): MenuNode[] {
  return nodes.map((node) => ({
    ...menuNode(
      node.key,
      node.label,
      node.formId,
      node.children?.length ? restoreMenuNodes(node.children) : undefined,
      node.defaultEntry,
      node.permissionMode,
      node.roleIds ?? [],
      node.permissionActions ?? ['view'],
      normalizePermissionRules(node.permissionRules),
    ),
    visible: node.visible ?? true,
    routePath: node.routePath,
    permissionMode: node.permissionMode ?? 'inherit',
    roleIds: node.roleIds ?? [],
    permissionActions: node.permissionActions ?? ['view'],
    permissionRules: normalizePermissionRules(node.permissionRules),
  }));
}

function unwrapApiList<T>(payload: unknown): T[] {
  if (!payload || typeof payload !== 'object') return [];
  const data = (payload as { data?: unknown }).data;
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === 'object' && Array.isArray((data as { data?: unknown }).data)) {
    return (data as { data: T[] }).data;
  }
  return [];
}

function unwrapApiItem<T>(payload: unknown): T | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = (payload as { data?: unknown }).data;
  if (data && typeof data === 'object' && 'data' in data) {
    return ((data as { data?: T }).data ?? null);
  }
  return (data as T) ?? null;
}

function stringFromConfigValue(...values: unknown[]): string | undefined {
  const value = values.find((item) => item !== undefined && item !== null && item !== '');
  return value === undefined ? undefined : String(value);
}

function boolFromConfigValue(...values: unknown[]): boolean {
  const value = values.find((item) => item !== undefined && item !== null);
  return value === true || value === 'true' || value === 1 || value === '1';
}

function mapPlatformFieldToRow(field: PlatformFormField): FieldRecord {
  const validation = field.validation ?? {};
  const uiConfig = field.ui_config ?? {};
  const controlType = field.control_type ?? stringFromConfigValue(uiConfig.controlType, uiConfig.component);
  return {
    id: String(field.id),
    raw: field,
    label: field.label || field.field_name,
    code: field.field_name,
    columnName: field.field_name,
    dataType: field.business_type || field.field_type,
    length: stringFromConfigValue(validation.maxLength, validation.max_length, validation.length, uiConfig.length),
    allowNull: !field.required,
    unique: boolFromConfigValue(validation.unique, uiConfig.unique),
    indexed: boolFromConfigValue(validation.indexed, uiConfig.indexed),
    component: controlType || field.field_type,
    list: Boolean(field.visible_in_list),
    form: Boolean(field.visible_in_form),
    search: Boolean(field.searchable),
  };
}

function mapPlatformFormToRecord(form: PlatformForm): FormRecord {
  const status: FormRecord['status'] = form.status === 'active' || form.status === 'published'
    ? 'published'
    : form.status === 'archived' || form.status === 'disabled'
      ? 'disabled'
      : 'draft';
  const config = form.config ?? {};
  const assemblyKind = String(config.assemblyKind ?? config.kind ?? config.type ?? '').toLowerCase();
  const hasAnalyticsDesign = Boolean(config.analyticsDesign || config.analyticsDesignDraft);
  const analyticsCodes = new Set(['inventory-impact', 'supplier-scorecard']);
  const isAnalytics = assemblyKind === 'analysis' || hasAnalyticsDesign || analyticsCodes.has(form.code);
  const fieldRows = (form.fields ?? [])
    .filter((field) => !field.archived)
    .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0) || left.id - right.id)
    .map(mapPlatformFieldToRow);

  return {
    id: String(form.id),
    name: form.name,
    code: form.code,
    category: isAnalytics ? 'analytics' : 'interaction',
    mode: isAnalytics ? String(config.analyticsMode || 'metric_dashboard') : undefined,
    config,
    structureLocked: Boolean(config.structureLocked) || form.status !== 'draft',
    entity: String(config.entityLabel || form.code),
    source: form.table_name || 'dynamic_records',
    status,
    creator: form.owner_id ? `用户 #${form.owner_id}` : '系统',
    creatorId: form.owner_id,
    description: form.description || 'Database-backed platform form.',
    fields: fieldRows.length,
    fieldRows,
  };
}

function mergeFormRecords(existingForms: FormRecord[], incomingForms: FormRecord[]): FormRecord[] {
  const orderedIds: string[] = [];
  const byId = new Map<string, FormRecord>();
  const idByCode = new Map<string, string>();

  const upsert = (form: FormRecord) => {
    const existingId = idByCode.get(form.code);
    const targetId = existingId ?? form.id;
    const merged = { ...byId.get(targetId), ...form };

    if (existingId && existingId !== form.id) {
      const existingIndex = orderedIds.indexOf(existingId);
      if (existingIndex >= 0) orderedIds[existingIndex] = form.id;
      byId.delete(existingId);
    } else if (!byId.has(form.id)) {
      orderedIds.push(form.id);
    }

    byId.set(form.id, merged);
    idByCode.set(form.code, form.id);
  };

  existingForms.forEach(upsert);
  incomingForms.forEach(upsert);

  return orderedIds
    .map((id) => byId.get(id))
    .filter((form): form is FormRecord => Boolean(form));
}

function mapPlatformMenuNodesToTree(nodes: PlatformMenuNode[]): MenuNode[] {
  const byParent = new Map<number | null, PlatformMenuNode[]>();
  nodes.forEach((node) => {
    const parentId = node.parent_id ?? null;
    byParent.set(parentId, [...(byParent.get(parentId) ?? []), node]);
  });
  byParent.forEach((items) => items.sort((left, right) => left.sort_order - right.sort_order || left.id - right.id));

  const build = (parentId: number | null): MenuNode[] => (
    (byParent.get(parentId) ?? []).map((node) => {
      const permissionMode = node.config?.permission_mode === 'custom' ? 'custom' : 'inherit';
      const roleIds = Array.isArray(node.config?.role_ids)
        ? node.config.role_ids.map((roleId) => Number(roleId)).filter(Number.isFinite)
        : [];
      const permissionActions = ['view'];
      const permissionRules = permissionMode === 'custom'
        ? [{ subjectType: 'roles' as const, roleIds, actions: permissionActions, effect: 'allow' as const }]
        : defaultPermissionRules();
      return {
        ...menuNode(
          `db-${node.id}`,
          node.title,
          node.form_id ? String(node.form_id) : undefined,
          build(node.id),
          node.default_entry,
          permissionMode,
          roleIds,
          permissionActions,
          permissionRules,
          node.page_code ?? undefined,
        ),
        dbId: node.id,
        parentDbId: node.parent_id ?? null,
        routePath: node.route_path ?? undefined,
        visible: node.visible,
        defaultEntry: node.default_entry,
        permissionMode,
        roleIds,
        permissionActions,
        permissionRules,
        sortOrder: node.sort_order,
        config: node.config,
      };
    })
  );

  return build(null);
}

function getParentDbId(nodes: MenuNode[], key: string, parentDbId: number | null = null): number | null {
  for (const node of nodes) {
    if (node.key === key) return parentDbId;
    const found = getParentDbId(node.children ?? [], key, node.dbId ?? null);
    if (found !== null) return found;
  }
  return null;
}

function getSiblingOrder(nodes: MenuNode[], parentDbId: number | null): MenuNode[] {
  if (parentDbId === null) return nodes;
  const parent = nodes.flatMap((node): MenuNode[] => [node, ...(node.children ? getAllMenuNodes(node.children) : [])])
    .find((node) => node.dbId === parentDbId);
  return parent?.children ?? [];
}

function getAllMenuNodes(nodes: MenuNode[]): MenuNode[] {
  return nodes.flatMap((node) => [node, ...getAllMenuNodes(node.children ?? [])]);
}

export default function AppMenuManagement({ businessData = false, initialFormId }: { businessData?: boolean; initialFormId?: string } = {}) {
  const navigate = useNavigate();
  const [appForm] = Form.useForm();
  const [formForm] = Form.useForm();
  const [menuForm] = Form.useForm();
  const [applications, setApplications] = useState<AppRecord[]>([]);
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [creatorNames, setCreatorNames] = useState<Record<number, string>>({});
  const [forms, setForms] = useState<FormRecord[]>([]);
  const [menusByApp, setMenusByApp] = useState<Record<number, MenuNode[]>>({});
  const [menuPages, setMenuPages] = useState<MenuPage[]>([]);
  const [selectedAppId, setSelectedAppId] = useState(0);
  const [selectedFormId, setSelectedFormId] = useState('');
  const [selectedMenuKey, setSelectedMenuKey] = useState('');
  const [menuSyncing, setMenuSyncing] = useState(false);
  const [propertySaving, setPropertySaving] = useState(false);
  const propertyOperation = useRef(false);
  const [loading, setLoading] = useState(true);

  const selectedApp = applications.find((item) => item.id === selectedAppId) ?? applications[0];
  const selectedForm = forms.find((item) => item.id === selectedFormId) ?? forms[0];
  const currentMenus = selectedApp ? menusByApp[selectedApp.id] ?? [] : [];
  const selectedMenu = findMenuNode(currentMenus, selectedMenuKey);

  useEffect(() => {
    if (businessData) return;
    let cancelled = false;
    api.get<{ items: MenuPage[] }>('/pages').then(({ data }) => {
      if (!cancelled) setMenuPages(data.items.filter(page => page.publishedVersion > 0));
    }).catch(() => { if (!cancelled) message.error('页面列表加载失败'); });
    return () => { cancelled = true; };
  }, [businessData]);

  useEffect(() => {
    if (!businessData) return;
    let cancelled = false;
    adminListUsers().then(response => {
      if (!cancelled) setCreatorNames(Object.fromEntries((response.data?.data || []).map((user: any) => [user.id, user.display_name || user.username])));
    }).catch(() => { /* Retain the immutable creator ID when directory lookup is unavailable. */ });
    return () => { cancelled = true; };
  }, [businessData]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      businessData ? undefined : adminListApplications(),
      businessData ? undefined : adminListRoles(),
      listPlatformForms(),
    ])
      .then(([appsRes, rolesRes, formsRes]) => {
        if (cancelled) return;
        const apiApps = appsRes?.data?.data ?? [];
        const apiRoles = rolesRes?.data?.data ?? [];
        const platformForms = unwrapApiList<PlatformForm>(formsRes);
        if (apiApps.length) {
          setApplications(apiApps);
          setSelectedAppId((current) => current || apiApps[0].id);
        }
        if (apiRoles.length) setRoles(apiRoles);
        if (platformForms.length) {
          const mappedPlatformForms = platformForms.map(mapPlatformFormToRecord);
          setForms((prev) => mergeFormRecords(prev, mappedPlatformForms));
          const initialForm = platformForms.find(form => String(form.id) === initialFormId) ?? platformForms[0];
          setSelectedFormId(String(initialForm.id));
        }
      })
      .catch(() => {
        if (!cancelled) message.error(businessData ? '业务来源加载失败' : '应用与菜单加载失败');
      }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [businessData, initialFormId]);

  useEffect(() => {
    if (selectedAppId <= 0) { setSelectedMenuKey(''); return; }
    let cancelled = false;
    setMenuSyncing(true);
    listPlatformMenuNodes(selectedAppId).then(response => {
      if (cancelled) return;
      const tree = mapPlatformMenuNodesToTree(unwrapApiList<PlatformMenuNode>(response));
      setMenusByApp(previous => ({ ...previous, [selectedAppId]: tree }));
      setSelectedMenuKey(current => findMenuNode(tree, current) ? current : tree[0]?.key || '');
    }).catch(() => { if (!cancelled) message.error('应用菜单加载失败'); })
      .finally(() => { if (!cancelled) setMenuSyncing(false); });
    return () => { cancelled = true; };
  }, [selectedAppId]);

  useEffect(() => {
    if (!selectedApp) return;
    appForm.setFieldsValue(appPropertyValues(selectedApp));
  }, [appForm, selectedApp]);

  useEffect(() => {
    if (!selectedForm) return;
    formForm.setFieldsValue({
      category: 'interaction',
      mode: undefined,
      structureLocked: selectedForm?.status !== 'draft',
      ...selectedForm,
    });
  }, [formForm, selectedForm]);

  useEffect(() => {
    menuForm.setFieldsValue(menuPropertyValues(selectedMenu));
  }, [menuForm, selectedMenu]);


  const commitForm = (raw: PlatformForm, previousId: string) => {
    const saved = mapPlatformFormToRecord(raw);
    setForms(previous => previous.map(item => item.id === previousId ? saved : item));
    setSelectedFormId(saved.id);
    return saved;
  };

  const runPropertyOperation = async (action: () => Promise<void>) => {
    if (propertyOperation.current) return;
    propertyOperation.current = true;
    setPropertySaving(true);
    try { await action(); }
    catch (error: any) { if (!error?.errorFields) message.error(propertyError(error, '操作失败，请重试')); }
    finally { propertyOperation.current = false; setPropertySaving(false); }
  };

  const persistAppDraft = async (status = selectedApp.status) => {
    const values = await appForm.validateFields();
    const saved = await persistApplication(persistenceApi, selectedApp, values, status) as AppRecord;
    setApplications(previous => previous.map(item => item.id === selectedApp.id ? saved : item));
    setSelectedAppId(saved.id);
    notifyApplicationsChanged();
    return saved;
  };
  const persistFormDraft = async () => {
    const values = await formForm.validateFields();
    const raw = await persistForm(persistenceApi, selectedForm, values);
    return commitForm(raw, selectedForm.id);
  };
  const createAssemblyField = async (values: NewAssemblyField) => {
    if (propertyOperation.current) throw new Error('正在保存配置，请稍后重试');
    propertyOperation.current = true; setPropertySaving(true);
    try {
      const saved = await persistFormDraft();
      await createPlatformFormField(saved.id, assemblyFieldPayload(values, saved.fields));
      const response = await getPlatformForm(saved.id, { schema: 'draft', scope: 'designer' });
      commitForm(response.data.data, saved.id);
    } finally { propertyOperation.current = false; setPropertySaving(false); }
  };
  const mutateAssemblyField = async (id: string, values?: NewAssemblyField) => {
    if (propertyOperation.current) throw new Error('正在保存配置，请稍后重试');
    propertyOperation.current = true; setPropertySaving(true);
    try {
      const saved = await persistFormDraft();
      const latest = (await getPlatformForm(saved.id, { schema: 'draft', scope: 'designer' })).data.data;
      const field = latest.fields?.find((item: PlatformFormField) => String(item.id) === id && !item.archived);
      if (!field) throw new Error('此字段已删除或不存在，请刷新后重试');
      if (values) await updatePlatformFormField(saved.id, id, assemblyFieldUpdatePayload(values, field));
      else await archivePlatformFormField(saved.id, id);
      commitForm((await getPlatformForm(saved.id, { schema: 'draft', scope: 'designer' })).data.data, saved.id);
    } finally { propertyOperation.current = false; setPropertySaving(false); }
  };
  const saveApp = (onSaved: () => void) => runPropertyOperation(async () => {
    await persistAppDraft();
    onSaved();
    message.success('应用属性已保存');
  });
  const saveForm = () => runPropertyOperation(async () => { await persistFormDraft(); message.success('表单/看板属性已保存'); });
  const enterFormDesigner = () => runPropertyOperation(async () => {
    const saved = await persistFormDraft();
    navigate(selectedForm.category === 'analytics'
      ? `/program/${encodeURIComponent(saved.code)}`
      : `/form-settings/${saved.id}?source=business-data`);
  });

  const createDraftApp = () => {
    const nextId = Math.min(...applications.map((app) => app.id), 0) - 1;
    const nextApp: AppRecord = {
      id: nextId,
      name: '新建应用',
      code: `app-${Date.now()}`,
      description: '待配置的应用草稿',
      icon: 'AppstoreOutlined',
      default_route: '/',
      sort_order: applications.length + 1,
      status: 'draft',
      is_pinned: false,
      roles: [],
    };
    setApplications((prev) => [...prev, nextApp]);
    setSelectedAppId(nextId);
    message.success('已添加应用草稿，请在右侧属性中配置并保存');
  };

  const publishSelectedApp = () => runPropertyOperation(async () => {
    await persistAppDraft('published'); message.success('应用已发布');
  });
  const disableSelectedApp = () => runPropertyOperation(async () => {
    await persistAppDraft('disabled'); message.success('应用已停用');
  });
  const enableSelectedApp = () => runPropertyOperation(async () => {
    await persistAppDraft('published'); message.success('应用已启用');
  });
  const deleteSelectedDraftApp = () => runPropertyOperation(async () => {
    if (selectedApp.status !== 'draft') { message.warning('只能删除草稿应用'); return; }
    if (selectedApp.id > 0) await adminDeleteApplication(selectedApp.id);
    const remaining = applications.filter(item => item.id !== selectedApp.id);
    setApplications(remaining); setSelectedAppId(remaining[0]?.id || 0);
    notifyApplicationsChanged(); message.success('应用草稿已删除');
  });

  const copySelectedAppAsDraft = () => runPropertyOperation(async () => {
    const values = await appForm.validateFields();
    const copied = await persistApplication(persistenceApi, { ...selectedApp, id: -1 }, {
      ...values, name: values.name + ' 副本', code: 'app-copy-' + Date.now(), is_pinned: false,
    }, 'draft') as AppRecord;
    setApplications(previous => [...previous, copied]); setSelectedAppId(copied.id);
    message.success('应用属性已复制并保存为草稿');
  });

  const createDraftForm = () => {
    const nextId = `form-${Date.now()}`;
    const nextForm: FormRecord = {
      id: nextId,
      name: '新建表单',
      code: nextId,
      category: 'interaction',
      mode: undefined,
      structureLocked: false,
      entity: 'NewEntity',
      source: 'generated_table',
      status: 'draft',
      creator: '保存后自动记录',
      description: '\u7528\u4e8e\u5f55\u5165\u3001\u7f16\u8f91\u3001\u5ba1\u6279\u548c\u914d\u7f6e\u4e1a\u52a1\u6570\u636e\u7684\u8349\u7a3f\u3002',
      fields: 0,
      fieldRows: [],
    };
    setForms((prev) => [nextForm, ...prev]);
    setSelectedFormId(nextId);
    formForm.setFieldsValue(nextForm);
    message.success('已创建通用表单草稿，请配置字段和录入规则');
  };

  const publishSelectedForm = () => runPropertyOperation(async () => {
    const saved = await persistFormDraft();
    if (saved.category !== 'analytics' && saved.fields === 0) {
      message.warning('草稿已保存，请先进入设计添加字段，再发布'); return;
    }
    await publishPlatformForm(saved.id);
    const response = await getPlatformForm(saved.id, { schema: 'draft', scope: 'designer' });
    commitForm(response.data.data, saved.id);
    message.success('表单/看板已发布，版本已保存');
  });
  const disableSelectedForm = () => runPropertyOperation(async () => {
    const saved = await persistFormDraft();
    await updatePlatformForm(saved.id, { status: 'disabled' });
    const response = await getPlatformForm(saved.id, { schema: 'draft', scope: 'designer' });
    commitForm(response.data.data, saved.id); message.success('表单/看板已停用');
  });
  const enableSelectedForm = publishSelectedForm;

  const deleteSelectedDraftForm = async () => {
    if (selectedForm.status !== 'draft') {
      message.warning('已发布或停用的表单不能直接删除');
      return;
    }
    const isPersistedForm = /^\d+$/.test(selectedForm.id);
    if (isPersistedForm) {
      try {
        await deletePlatformForm(selectedForm.id);
      } catch {
        message.error('删除草稿失败，请确认表单仍为草稿且未绑定菜单');
        return;
      }
    }
    const nextForms = forms.filter((item) => item.id !== selectedForm.id);
    setForms(nextForms);
    setSelectedFormId(nextForms[0]?.id ?? '');
    message.success('表单草稿已删除');
  };

  const copySelectedFormAsDraft = () => runPropertyOperation(async () => {
    const response = await copyPlatformForm(selectedForm.id, { name: selectedForm.name + ' 副本', code: 'form-copy-' + Date.now() });
    const copied = mapPlatformFormToRecord(response.data.data);
    setForms(previous => [copied, ...previous]); setSelectedFormId(copied.id);
    message.success('已复制表单/看板，字段及设计配置已保存为草稿');
  });

  const addPageToMenu = async (page: MenuPage) => {
    if (propertySaving || menuSyncing) return false;
    if (selectedApp.id < 0) {
      message.warning('请先保存应用属性，再添加页面');
      return false;
    }
    const parentId = selectedMenu && isMenuGroup(selectedMenu) ? selectedMenu.dbId ?? null : null;
    const sortOrder = getSiblingOrder(currentMenus, parentId)
      .reduce((last, node) => Math.max(last, node.sortOrder ?? 0), -1) + 1;
    setMenuSyncing(true);
    try {
      const response = await createPlatformMenuNode(selectedApp.id, {
        page_code: page.code, title: page.title, parent_id: parentId, sort_order: sortOrder,
      });
      const created = unwrapApiItem<PlatformMenuNode>(response);
      if (!created) throw new Error('empty menu node response');
      const entry = {
        ...mapPlatformMenuNodesToTree([{ ...created, parent_id: null }])[0],
        parentDbId: parentId,
      };
      setMenusByApp(previous => ({
        ...previous,
        [selectedApp.id]: appendMenuNode(previous[selectedApp.id] ?? [], entry, parentId),
      }));
      setSelectedMenuKey(entry.key);
      notifyApplicationsChanged();
      message.success('页面已添加到菜单');
      return true;
    } catch (error) {
      message.error(propertyError(error, '添加页面失败'));
      return false;
    } finally {
      setMenuSyncing(false);
    }
  };

  const addMenuGroup = async () => {
    if (selectedApp.id < 0) { message.warning('请先保存应用属性，再添加分组'); return; }
    setMenuSyncing(true);
    try {
      const res = await createPlatformMenuNode(selectedApp.id, {
        node_type: 'group',
        title: 'New Group',
        visible: true,
        default_entry: false,
        sort_order: currentMenus.length,
      });
      const created = unwrapApiItem<PlatformMenuNode>(res);
      if (!created) throw new Error('empty menu node response');
      const nextNode = mapPlatformMenuNodesToTree([created])[0];
      setMenusByApp((prev) => ({
        ...prev,
        [selectedApp.id]: [...(prev[selectedApp.id] ?? []), nextNode],
      }));
      setSelectedMenuKey(nextNode.key);
      message.success('Menu group saved to database.');
    } catch {
      message.error('Failed to save menu group to database.');
    } finally {
      setMenuSyncing(false);
    }
    return;
    const nextNode = menuNode(`${selectedApp.id}-group-${Date.now()}`, '新建分组');
    setMenusByApp((prev) => ({
      ...prev,
      [selectedApp.id]: [...(prev[selectedApp.id] ?? []), nextNode],
    }));
    setSelectedMenuKey(nextNode.key);
  };

  const deleteSelectedMenuNode = async () => {
    if (!selectedMenu) return;
    const target = selectedMenu;
    if (target.dbId) {
      setMenuSyncing(true);
      try {
        await Promise.all(
          ((target.children ?? []) as MenuNode[])
            .filter((child) => child.dbId)
            .map((child, index) => updatePlatformMenuNode(selectedApp.id, child.dbId!, {
              parent_id: target.parentDbId ?? null,
              sort_order: index,
            })),
        );
        await deletePlatformMenuNode(selectedApp.id, target.dbId);
      } catch {
        message.error('Failed to delete menu node from database.');
        setMenuSyncing(false);
        return;
      }
      setMenuSyncing(false);
    }
    const nextTree = removeMenuNodePromoteChildren(currentMenus, selectedMenuKey);
    const nextKeys = collectMenuKeys(nextTree);
    setMenusByApp((prev) => ({
      ...prev,
      [selectedApp.id]: nextTree,
    }));
    setSelectedMenuKey(nextKeys[0] ?? '');

    if (isMenuGroup(target) && (target.children?.length ?? 0) > 0) {
      message.success('已删除分组，分组下的节点已提升到同级');
      return;
    }

    message.success('菜单节点已删除');
  };

  const saveMenuNode = async () => {
    if (!selectedMenu?.dbId) { message.warning('请先选择一个已保存的菜单节点'); return; }
    const values = await menuForm.validateFields();
    setMenuSyncing(true);
    try {
      const response = await updatePlatformMenuNode(selectedApp.id, selectedMenu.dbId, {
        title: values.title,
        ...(values.pageCode && values.pageCode !== selectedMenu.pageCode ? { page_code: values.pageCode } : {}),
        visible: values.visible,
        default_entry: values.defaultEntry,
        config: {
          ...cleanMenuNodeConfig(selectedMenu.config),
          permission_mode: values.permissionMode ?? 'inherit',
          role_ids: values.permissionMode === 'custom' ? values.roleIds ?? [] : [],
          permission_actions: ['view'],
        },
      });
      const updated = unwrapApiItem<PlatformMenuNode>(response);
      if (!updated) throw new Error('empty menu node response');
      const entry = {
        ...mapPlatformMenuNodesToTree([{ ...updated, parent_id: null }])[0],
        parentDbId: updated.parent_id ?? null,
      };
      setMenusByApp(previous => ({
        ...previous,
        [selectedApp.id]: replaceMenuNode(previous[selectedApp.id] ?? [], entry),
      }));
      message.success('菜单节点已更新');
      notifyApplicationsChanged();
      return true;
    } catch (error) {
      message.error(propertyError(error, '保存菜单失败'));
    } finally {
      setMenuSyncing(false);
    }
  };

  const onDropMenu = async (info: any) => {
    if (!info?.dragNode?.key || !info?.node?.key) return;
    const dragKey = info.dragNode.key;
    const dropKey = info.node.key;
    const dropPosition = info.dropPosition;
    const dropToGap = info.dropToGap;
    const nextTree = moveNode(currentMenus, dragKey, dropKey, dropPosition, dropToGap);
    setMenusByApp((prev) => ({ ...prev, [selectedApp.id]: nextTree }));
    const dragged = findMenuNode(nextTree, dragKey);
    if (!dragged?.dbId) return;
    const parentDbId = getParentDbId(nextTree, dragKey);
    const siblings = getSiblingOrder(nextTree, parentDbId);
    setMenuSyncing(true);
    try {
      await Promise.all(
        siblings
          .filter((node) => node.dbId)
          .map((node, index) => updatePlatformMenuNode(selectedApp.id, node.dbId!, { sort_order: index, parent_id: parentDbId })),
      );
    } catch {
      message.error('Failed to persist menu order.');
    } finally {
      setMenuSyncing(false);
    }
  };

  if (loading) return <Spin tip="正在读取配置"><div style={{ minHeight: 240 }} /></Spin>;

  if (!businessData && !selectedApp) {
    return <Empty description="暂无可管理应用"><Button icon={<PlusOutlined />} onClick={createDraftApp}>新增应用</Button></Empty>;
  }

  return (
    <div className="app-admin-workspace" aria-busy={menuSyncing}>
      <AssemblyWorkspace
        businessData={businessData}
        apps={applications}
        appForm={appForm}
        formForm={formForm}
        selectedForm={selectedForm}
        propertySaving={propertySaving}
        onCreateApp={createDraftApp}
        onCreateForm={createDraftForm}
        onSaveApp={saveApp}
        onSaveForm={saveForm}
        onEnterDesign={enterFormDesigner}
        appActions={{ onPublish: publishSelectedApp, onDisable: disableSelectedApp, onEnable: enableSelectedApp, onDeleteDraft: deleteSelectedDraftApp, onCopyDraft: copySelectedAppAsDraft }}
        formActions={{ onPublish: publishSelectedForm, onDisable: disableSelectedForm, onEnable: enableSelectedForm, onDeleteDraft: deleteSelectedDraftForm, onCopyDraft: copySelectedFormAsDraft }}
        roles={roles}
        creatorName={selectedForm?.creatorId ? creatorNames[selectedForm.creatorId] || selectedForm.creator : selectedForm?.creator}
        onCreateField={createAssemblyField}
        onUpdateField={(id, values) => mutateAssemblyField(id, values)}
        onDeleteField={id => mutateAssemblyField(id)}
        onRoleCreated={role => setRoles(previous => [role, ...previous.filter(item => item.id !== role.id)])}
        forms={forms}
        menus={currentMenus}
        menuPages={menuPages}
        onAddPageToMenu={addPageToMenu}
        onOpenPageDesign={code => navigate(`/pages/${encodeURIComponent(code)}?edit=1`)}
        selectedAppId={selectedApp?.id ?? 0}
        selectedMenuKey={selectedMenuKey}
        selectedMenu={selectedMenu}
        onSelectApp={setSelectedAppId}
        onOpenFormConfig={setSelectedFormId}
        onOpenPageLibrary={() => navigate('/studio/page-design')}
        menuSyncing={menuSyncing}
        onAddMenuGroup={addMenuGroup}
        onSelectMenu={setSelectedMenuKey}
        onDropMenu={onDropMenu}
        menuForm={menuForm}
        onSaveMenu={onSaved => runPropertyOperation(async () => {
          if (await saveMenuNode()) onSaved();
        })}
        onDeleteMenu={deleteSelectedMenuNode}
      />
    </div>
  );
}

function LifecycleActions({
  status,
  onSave,
  onPublish,
  onDisable,
  onEnable,
  onDeleteDraft,
  onCopyDraft,
  allowRepublish = false,
  iconOnly = false,
  disabled = false,
}: {
  status: string;
  allowRepublish?: boolean;
  iconOnly?: boolean;
  disabled?: boolean;
  onSave: () => void;
  onPublish: () => void;
  onDisable: () => void;
  onEnable: () => void;
  onDeleteDraft: () => void;
  onCopyDraft: () => void;
}) {
  const actionProps = (label: string) => iconOnly
    ? { size: 'small' as const, 'aria-label': label, title: label, disabled }
    : {};
  if (status === 'published') {
    return (
      <Space size={iconOnly ? 4 : 8} wrap={!iconOnly}>
        <Button {...actionProps('保存变更')} icon={<SaveOutlined />} onClick={onSave}>{!iconOnly && '保存变更'}</Button>
        {allowRepublish && <Button {...actionProps('发布更新')} type="primary" icon={<SendOutlined />} onClick={onPublish}>{!iconOnly && '发布更新'}</Button>}
        <Dropdown disabled={disabled} trigger={['click']} menu={{ items: [
          { key: 'copy', label: '复制为草稿', icon: <AppstoreAddOutlined />, onClick: onCopyDraft },
          { key: 'disable', label: '停用', icon: <StopOutlined />, danger: true, onClick: () => Modal.confirm({ title: '确认停用？', okText: '停用', cancelText: '取消', okButtonProps: { danger: true }, onOk: onDisable }) },
        ] }}><Button {...actionProps('更多操作')} icon={iconOnly ? <MoreOutlined /> : undefined}>{!iconOnly && '更多操作'}</Button></Dropdown>
      </Space>
    );
  }

  if (status === 'disabled') {
    return (
      <Space size={iconOnly ? 4 : 8} wrap={!iconOnly}>
        <Button {...actionProps('保存配置')} icon={<SaveOutlined />} onClick={onSave}>{!iconOnly && '保存配置'}</Button>
        <Button {...actionProps('启用')} type="primary" icon={<CheckCircleOutlined />} onClick={onEnable}>{!iconOnly && '启用'}</Button>
      </Space>
    );
  }

  return (
    <Space size={iconOnly ? 4 : 8} wrap={!iconOnly}>
      <Button {...actionProps('保存草稿')} icon={<SaveOutlined />} onClick={onSave}>{!iconOnly && '保存草稿'}</Button>
      <Button {...actionProps('发布')} type="primary" icon={<SendOutlined />} onClick={onPublish}>{!iconOnly && '发布'}</Button>
      <Popconfirm title="确认删除草稿？" disabled={disabled} onConfirm={onDeleteDraft}>
        <Button {...actionProps('删除草稿')} danger icon={<DeleteOutlined />}>{!iconOnly && '删除草稿'}</Button>
      </Popconfirm>
    </Space>
  );
}

type PropertyLifecycleActions = {
  onPublish: () => void;
  onDisable: () => void;
  onEnable: () => void;
  onDeleteDraft: () => void;
  onCopyDraft: () => void;
};

function AssemblyWorkspace({
  businessData,
  apps,
  appForm, formForm, selectedForm, propertySaving, onCreateApp, onCreateForm, onSaveApp, onSaveForm, onEnterDesign,
  appActions, formActions, creatorName, onCreateField, onUpdateField, onDeleteField, onRoleCreated,
  roles,
  forms,
  menus,
  menuPages,
  onAddPageToMenu,
  onOpenPageDesign,
  selectedAppId,
  selectedMenuKey,
  selectedMenu,
  onSelectApp,
  onOpenFormConfig,
  onOpenPageLibrary,
  menuSyncing,
  onAddMenuGroup,
  onSelectMenu,
  onDropMenu,
  menuForm,
  onSaveMenu,
  onDeleteMenu,
}: {
  businessData: boolean;
  apps: AppRecord[];
  appForm: ReturnType<typeof Form.useForm>[0];
  formForm: ReturnType<typeof Form.useForm>[0];
  selectedForm?: FormRecord;
  propertySaving: boolean;
  onCreateApp: () => void;
  onCreateForm: () => void;
  onSaveApp: (onSaved: () => void) => void;
  onSaveForm: () => void;
  onEnterDesign: () => void;
  appActions: PropertyLifecycleActions;
  formActions: PropertyLifecycleActions;
  roles: RoleRecord[];
  creatorName?: string;
  onCreateField: (field: NewAssemblyField) => Promise<void>;
  onUpdateField: (id: string, field: NewAssemblyField) => Promise<void>;
  onDeleteField: (id: string) => Promise<void>;
  onRoleCreated: (role: AssemblyRole) => void;
  forms: FormRecord[];
  menus: MenuNode[];
  menuPages: MenuPage[];
  onAddPageToMenu: (page: MenuPage) => Promise<boolean>;
  onOpenPageDesign: (code: string) => void;
  selectedAppId: number;
  selectedMenuKey: string;
  selectedMenu?: MenuNode;
  onSelectApp: (id: number) => void;
  onOpenFormConfig: (id: string) => void;
  onOpenPageLibrary: () => void;
  menuSyncing: boolean;
  onAddMenuGroup: () => void;
  onSelectMenu: (key: string) => void;
  onDropMenu: (info: any) => void;
  menuForm: ReturnType<typeof Form.useForm>[0];
  onSaveMenu: (onSaved: () => void) => void;
  onDeleteMenu: () => void;
}) {
  const [propertyTarget, setPropertyTarget] = useState<'app' | 'form' | 'menu'>(businessData ? 'form' : 'menu');
  const [menuEditing, setMenuEditing] = useState(false);
  useEffect(() => setMenuEditing(false), [selectedAppId, selectedMenuKey]);
  const menuReadOnly = propertySaving || !menuEditing;
  const cancelMenuEdit = () => {
    menuForm.resetFields();
    menuForm.setFieldsValue(menuPropertyValues(selectedMenu));
    setMenuEditing(false);
  };
  const activeForm = businessData ? selectedForm : undefined;
  const watchedFormName = Form.useWatch('name', formForm);
  const currentFormName = activeForm ? watchedFormName || activeForm.name : '表单设置';
  const currentMenuName = Form.useWatch('title', menuForm);
  const currentAppName = Form.useWatch('name', appForm);
  const menuPropertyTitle = selectedMenu ? `${currentMenuName || getMenuLabel(selectedMenu)} 属性设置` : '菜单属性';
  const formPropertyTitle = activeForm ? `${currentFormName} 属性设置` : currentFormName;
  const selectedApp = apps.find((item) => item.id === selectedAppId) ?? apps[0];
  const [appEditing, setAppEditing] = useState(false);
  useEffect(() => setAppEditing(selectedAppId < 0), [selectedAppId, selectedApp?.status]);
  const appPropertyTitle = `${currentAppName || selectedApp?.name || '应用'} 属性设置`;
  const propertyTitle = propertyTarget === 'app' ? appPropertyTitle
    : propertyTarget === 'form' ? formPropertyTitle : menuPropertyTitle;
  const [resourceQuery, setResourceQuery] = useState('');
  const query = resourceQuery.trim().toLowerCase();
  const visibleForms = forms.filter(form => form.name.toLowerCase().includes(query));
  const visiblePages = menuPages.filter(page => page.title.toLowerCase().includes(query));
  const menuBusy = propertySaving || menuSyncing;
  const [pagePickerOpen, setPagePickerOpen] = useState(false);
  const [pageToAdd, setPageToAdd] = useState<string>();
  const selectedPageCode = selectedMenu?.pageCode ?? selectedMenu?.routePath?.match(/^\/pages\/([^/?#]+)$/)?.[1];
  const pageOptions = menuPages.map(page => ({ label: page.title, value: page.code }));

  const renderFormCard = (form: FormRecord) => {
    return (
      <div
        className={`assembly-form-card${selectedForm?.id === form.id ? ' is-selected' : ''}`}
        key={form.id}
        onClick={() => { if (!propertySaving) onOpenFormConfig(form.id); }}
        role="button" tabIndex={0}
        aria-label={`${businessData ? '查看属性' : '前往业务数据'}：${form.name}`}
        onKeyDown={event => {
          if (!propertySaving && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            onOpenFormConfig(form.id);
          }
        }}
      >
        {form.category === 'analytics' ? <BarChartOutlined className="assembly-row-icon" /> : <FormOutlined className="assembly-row-icon" />}
        <div className="assembly-resource-copy"><Typography.Text strong ellipsis>{form.name}</Typography.Text><small>{form.category === 'analytics' ? '数据看板' : '业务表单'}</small></div>
      </div>
    );
  };
  const expandedMenuKeys = collectMenuKeys(menus);

  return (
    <div className={`app-assembly-workspace${businessData ? ' assembly-business-data' : ''}`}>
      <header className="assembly-page-heading">
        {businessData ? <>
          <div><h2>业务数据</h2><p>管理业务来源、字段与录入配置。同一业务来源可供多个列表使用。</p></div>
          <Button icon={<PlusOutlined />} disabled={propertySaving} onClick={onCreateForm}>新增表单</Button>
        </> : <>
          <div><h2>应用管理</h2><p>管理应用与菜单入口，并将已发布页面加入导航。</p></div>
          <Button icon={<PlusOutlined />} disabled={propertySaving} onClick={() => { onCreateApp(); setPropertyTarget('app'); }}>新增应用</Button>
        </>}
      </header>
      {!businessData && <section className="assembly-app-switcher" aria-label="选择应用">
        <InspectorTabs
          className="assembly-app-tabs"
          aria-label="选择应用"
          activeKey={String(selectedAppId)}
          items={apps.map(app => ({
            key: String(app.id),
            label: <span className="assembly-app-tab-label">{renderIcon(app.icon)}{app.name}</span>,
            disabled: propertySaving,
          }))}
          onTabClick={key => {
            if (propertySaving) return;
            onSelectApp(Number(key));
            setPropertyTarget('app');
            setResourceQuery('');
          }}
        />
        <Button type="text" disabled={propertySaving} icon={<ToolOutlined />} onClick={() => setPropertyTarget('app')}>应用设置</Button>
      </section>}
      <Row className="assembly-grid">
        <Col>
          <Card title={<Space><FormOutlined />{businessData ? '表单' : '已发布页面'}</Space>}
            className="assembly-column-card assembly-resources-card"
            extra={!businessData && <Button type="link" size="small" onClick={onOpenPageLibrary}>页面设计</Button>}>
            <div className="assembly-resource-tools">
              <Input.Search aria-label={businessData ? '搜索表单' : '搜索页面'} placeholder="搜索名称" allowClear
                value={resourceQuery} onChange={event => setResourceQuery(event.target.value)} />
            </div>
            <div className="assembly-form-list">
              {businessData ? visibleForms.map(renderFormCard) : visiblePages.map(page => (
                <div className="assembly-form-card" key={page.code}>
                  <FormOutlined className="assembly-row-icon" />
                  <div className="assembly-resource-copy"><Typography.Text strong ellipsis>{page.title}</Typography.Text></div>
                  <Button type="text" size="small" icon={<PlusOutlined />} disabled={menuBusy}
                    aria-label={`添加${page.title}到菜单`} title="添加到菜单"
                    onClick={() => void onAddPageToMenu(page).then(added => { if (added) setPropertyTarget('menu'); })} />
                </div>
              ))}
              {!(businessData ? visibleForms.length : visiblePages.length) && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={query ? '没有匹配的结果' : businessData ? '暂无表单' : '暂无已发布页面'} />}
            </div>
            {!businessData && <p className="assembly-resource-hint">点 ＋ 添加页面。选中分组时添加到该分组。</p>}
          </Card>
        </Col>

        {!businessData && <Col>
              <Card
                title={<Space><MenuOutlined />菜单结构</Space>}
                className="assembly-menu-card"
                extra={<Space size={4}>
                  <Button size="small" type="primary" icon={<PlusOutlined />} disabled={menuBusy}
                    onClick={() => { setPageToAdd(undefined); setPagePickerOpen(true); }}>添加页面</Button>
                  <Button size="small" icon={<AppstoreAddOutlined />} onClick={() => { onAddMenuGroup(); setPropertyTarget('menu'); }}>添加分组</Button>
                </Space>}
              >
                <p className="assembly-menu-hint">拖动调整顺序与层级，点击设置入口属性。</p>
                {menus.length ? (
                  <div className="assembly-menu-dropzone">
                    <Tree
                      key={`${selectedAppId}-${expandedMenuKeys.join('|')}`}
                      draggable
                      blockNode
                      treeData={menus}
                      selectedKeys={[selectedMenuKey]}
                      defaultExpandAll
                      defaultExpandedKeys={expandedMenuKeys}
                      onSelect={(keys) => { if (!propertySaving) { onSelectMenu(String(keys[0] ?? selectedMenuKey)); setPropertyTarget('menu'); } }}
                      onDrop={onDropMenu}
                    />
                  </div>
                ) : (
                  <Empty description="添加已发布的页面，建立应用菜单" />
                )}
              </Card>
        </Col>}
        <Col>
              <Card
                title={<span title={propertyTitle}>{propertyTitle}</span>}
                className="assembly-property-card"
                extra={propertyTarget === 'app' ? (
                  <div className="assembly-inspector-header-actions">
                    <PropertyStatus status={selectedApp.status} />
                    {appEditing ? (
                      <ConfigProvider componentSize="small" componentDisabled={propertySaving}>
                        <Button type="text" icon={<CloseOutlined />} aria-label="取消更改" title="取消更改"
                          onClick={() => {
                            appForm.resetFields();
                            appForm.setFieldsValue(appPropertyValues(selectedApp));
                            setAppEditing(false);
                          }} />
                        <LifecycleActions status={selectedApp.status} onSave={() => onSaveApp(() => setAppEditing(false))} {...appActions} />
                      </ConfigProvider>
                    ) : (
                      <Button size="small" type="text" icon={<EditOutlined />} aria-label="编辑应用属性" title="编辑应用属性"
                        disabled={propertySaving} onClick={() => setAppEditing(true)} />
                    )}
                  </div>
                ) : propertyTarget === 'menu' ? selectedMenu && (
                  <div className="assembly-inspector-header-actions">
                    {selectedPageCode && <Button size="small" type="text" icon={<FormOutlined />} aria-label="打开页面设计"
                      title="打开页面设计" disabled={propertySaving || menuEditing} onClick={() => onOpenPageDesign(selectedPageCode)} />}
                    {!menuEditing ? (
                      <Button size="small" type="text" icon={<EditOutlined />} aria-label="编辑菜单属性" title="编辑菜单属性"
                        disabled={propertySaving} onClick={() => setMenuEditing(true)} />
                    ) : <>
                      <Button size="small" type="text" icon={<CloseOutlined />} aria-label="取消更改" title="取消更改"
                        disabled={propertySaving} onClick={cancelMenuEdit} />
                      <Button size="small" type="primary" icon={<SaveOutlined />} aria-label="保存属性" title="保存属性"
                        disabled={propertySaving} loading={propertySaving} onClick={() => onSaveMenu(() => setMenuEditing(false))} />
                      <Popconfirm
                        title={isMenuGroup(selectedMenu) ? '删除这个分组？' : '删除这个菜单入口？'}
                        description={isMenuGroup(selectedMenu)
                          ? '分组下的入口会自动提升到同级菜单。'
                          : '删除后，关联的页面、表单和业务数据会保留。'}
                        okText="删除"
                        cancelText="取消"
                        okButtonProps={{ danger: true, disabled: propertySaving }}
                        disabled={propertySaving}
                        onConfirm={onDeleteMenu}
                      >
                        <Button size="small" type="text" danger icon={<DeleteOutlined />} aria-label="删除菜单" title="删除菜单" disabled={propertySaving} />
                      </Popconfirm>
                    </>}
                  </div>
                ) : activeForm && (
                  <div className="assembly-inspector-header-actions">
                    <PropertyStatus status={activeForm.status} />
                    <Button size="small" type="text" icon={<FormOutlined />} aria-label="进入设计" title="进入设计"
                      disabled={propertySaving} onClick={onEnterDesign} />
                    <Button size="small" type="text" icon={<CloseOutlined />} aria-label="取消更改" title="取消更改"
                      disabled={propertySaving} onClick={() => formForm.setFieldsValue(activeForm)} />
                    <LifecycleActions iconOnly disabled={propertySaving} allowRepublish status={activeForm.status} onSave={onSaveForm} {...formActions} />
                  </div>
                )}
              >
                {!businessData && <InspectorTabs
                  className="assembly-property-switch"
                  aria-label="属性设置"
                  activeKey={propertyTarget}
                  items={[
                    { label: '应用设置', key: 'app', disabled: propertySaving },
                    { label: '菜单设置', key: 'menu', disabled: propertySaving },
                  ]}
                  onChange={key => setPropertyTarget(key === 'app' ? 'app' : 'menu')}
                />}
                {propertyTarget === 'app' && selectedApp ? (
                  <fieldset disabled={propertySaving || !appEditing} className="assembly-property-editor">
                    <div className="assembly-property-scroll assembly-inspector-content">
                      <AppConfigForm form={appForm} app={selectedApp} menus={menus} roles={roles} disabled={propertySaving || !appEditing} />
                    </div>
                  </fieldset>
                ) : propertyTarget === 'form' && activeForm ? <fieldset disabled={propertySaving} className="assembly-property-editor">
                  <div className="assembly-property-scroll assembly-inspector-content">
                    <FormConfigForm form={formForm} creatorName={creatorName || activeForm.creator}
                      isPersisted={/^\d+$/.test(activeForm.id)} isAnalytics={activeForm.category === 'analytics'} />
                    <FieldStructurePanel fields={activeForm.fieldRows || []} formName={currentFormName} onCreate={onCreateField} onUpdate={onUpdateField} onDelete={onDeleteField} disabled={propertySaving} />
                  </div>
                </fieldset> : propertyTarget === 'form' ? (
                  <Empty className="assembly-property-empty" image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="请从左侧选择表单或看板" />
                ) : selectedMenu ? (
                  <Form form={menuForm} disabled={menuReadOnly} layout="horizontal" colon={false} size="small"
                    className="assembly-node-editor assembly-property-form property-inspector">
                    <div className="assembly-property-scroll assembly-inspector-content">
                      <PropertyGroup title="入口信息">
                        <Form.Item name="title" label="菜单名称" rules={[{ required: true, whitespace: true, message: '请输入菜单名称' }]}>
                          <Input />
                        </Form.Item>
                        {selectedMenu.formId && !selectedMenu.pageCode && (
                          <Form.Item label="当前入口">
                            <Input readOnly value={forms.find(form => form.id === selectedMenu.formId)?.name ?? selectedMenu.routePath} />
                          </Form.Item>
                        )}
                        {!isMenuGroup(selectedMenu) && <Form.Item name="pageCode" label="目标页面"
                          rules={selectedMenu.pageCode ? [{ required: true, message: '请选择目标页面' }] : undefined}>
                          <Select showSearch optionFilterProp="label" placeholder="选择已发布页面"
                            options={selectedMenu.pageCode && !pageOptions.some(page => page.value === selectedMenu.pageCode)
                              ? [...pageOptions, { value: selectedMenu.pageCode, label: selectedMenu.pageCode, disabled: true }]
                              : pageOptions} />
                        </Form.Item>}
                      </PropertyGroup>
                      <PropertyGroup title="导航行为">
                        <Form.Item name="visible" label="在菜单中显示" tooltip="在应用的导航菜单中显示此入口。"
                          valuePropName="checked" className="assembly-switch-field">
                          <Switch />
                        </Form.Item>
                        <Form.Item name="defaultEntry" label="设为应用默认入口" tooltip={`进入「${selectedApp.name}」时优先打开此页面。`}
                          valuePropName="checked" className="assembly-switch-field">
                          <Switch />
                        </Form.Item>
                      </PropertyGroup>
                      <MenuAccessPanel key={selectedMenu.key} form={menuForm} roles={roles} inheritedIds={(selectedApp.roles || []).map(role => role.id)}
                        applicationName={selectedApp.name} onRoleCreated={onRoleCreated} disabled={menuReadOnly} />
                    </div>
                  </Form>
                ) : (
                  <Empty className="assembly-property-empty" image={Empty.PRESENTED_IMAGE_SIMPLE} description="请从菜单结构中选择入口或分组" />
                )}
              </Card>
        </Col>
      </Row>
      {!businessData && <Modal title="添加页面到菜单" open={pagePickerOpen} okText="添加" cancelText="取消"
        confirmLoading={menuSyncing} okButtonProps={{ disabled: !pageToAdd || menuBusy }}
        onCancel={() => { if (!menuSyncing) setPagePickerOpen(false); }}
        onOk={async () => {
          const page = menuPages.find(item => item.code === pageToAdd);
          if (page && await onAddPageToMenu(page)) {
            setPropertyTarget('menu');
            setPagePickerOpen(false);
          }
        }}>
        <Select aria-label="目标页面" showSearch optionFilterProp="label" style={{ width: '100%' }}
          placeholder="选择已发布页面" options={pageOptions} value={pageToAdd} onChange={setPageToAdd} />
      </Modal>}
    </div>
  );
}

function PropertyStatus({ status }: { status: string }) {
  return <Tag color={status === 'published' ? 'success' : status === 'disabled' ? 'default' : 'processing'}>
    {status === 'published' ? '已发布' : status === 'disabled' ? '已停用' : '草稿'}
  </Tag>;
}

function appPropertyValues(app: AppRecord) {
  return {
    name: app.name,
    code: app.code,
    description: app.description,
    icon: app.icon || 'AppstoreOutlined',
    default_route: app.default_route,
    sort_order: app.sort_order,
    status: app.status,
    is_pinned: app.is_pinned,
  };
}

function PropertySection({ title, children, note }: { title: string; children: ReactNode; note?: string }) {
  return <section className="assembly-property-section" aria-label={title}>
    <h3>{title}</h3>{note && <p className="assembly-section-note">{note}</p>}
    <div className="assembly-property-fields">{children}</div>
  </section>;
}

function AppConfigForm({ form, app, menus, roles, disabled }: {
  form: ReturnType<typeof Form.useForm>[0];
  app: AppRecord;
  menus: MenuNode[];
  roles: AssemblyRole[];
  disabled: boolean;
}) {
  const entryOptions = new Map([['/', '工作台首页']]);
  for (const node of getAllMenuNodes(menus)) {
    if (node.visible !== false && node.routePath && !entryOptions.has(node.routePath)) {
      entryOptions.set(node.routePath, getMenuLabel(node));
    }
  }
  if (app.default_route && !entryOptions.has(app.default_route)) {
    entryOptions.set(app.default_route, `当前入口 · ${app.default_route}`);
  }

  return <Form form={form} disabled={disabled} layout="horizontal" colon={false} size="small"
    className="assembly-property-form property-inspector">
    <PropertyGroup title="基本信息">
      <Form.Item name="name" label="应用名称" rules={[{ required: true, whitespace: true, max: 200 }]}>
        <Input maxLength={200} />
      </Form.Item>
      <Form.Item name="code" label="应用编码" rules={[{ required: true, whitespace: true, max: 100 }]}>
        <Input maxLength={100} />
      </Form.Item>
      <Form.Item name="icon" label="应用图标">
        <Select optionLabelProp="label"
          options={iconOptions.map(item => ({ value: item.value, label: item.label }))}
          optionRender={option => <Space>{renderIcon(option.data.value)}{option.data.label}</Space>} />
      </Form.Item>
      <Form.Item name="description" label="应用说明">
        <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} placeholder="填写应用用途" />
      </Form.Item>
    </PropertyGroup>
    <PropertyGroup title="入口与导航">
      <Form.Item name="default_route" label="启动页面" tooltip="从应用栏打开此应用时进入的页面。">
        <Select showSearch optionFilterProp="label" options={Array.from(entryOptions, ([value, label]) => ({ value, label }))} />
      </Form.Item>
      <Form.Item name="sort_order" label="排列顺序" tooltip="数值越小，应用越靠前。">
        <Input type="number" />
      </Form.Item>
      <Form.Item name="is_pinned" label="置顶到应用栏" valuePropName="checked" className="assembly-switch-field">
        <Switch />
      </Form.Item>
    </PropertyGroup>
    <PropertyGroup title="应用访问" hint="菜单选择跟随应用权限时，会使用应用绑定的角色。">
      <div className="assembly-role-field">
        <RoleChecklist roles={roles} inheritedIds={(app.roles ?? []).map(role => role.id)} />
      </div>
    </PropertyGroup>
  </Form>;
}

function FormConfigForm({ form, isPersisted, isAnalytics, creatorName }: {
  form: ReturnType<typeof Form.useForm>[0]; isPersisted: boolean; isAnalytics: boolean; creatorName: string;
}) {
  const structureLocked = Boolean(Form.useWatch('structureLocked', form));
  return <Form form={form} layout="vertical" className="form-config-form">
    <Form.Item name="structureLocked" hidden valuePropName="checked"><Switch /></Form.Item>
    <PropertySection title="基本信息">
      <Form.Item name="name" label={isAnalytics ? '看板名称' : '表单名称'} rules={[{ required: true }]}><Input /></Form.Item>
      <Form.Item name="code" label={isAnalytics ? '看板编码' : '表单编码'} rules={[{ required: true }]}><Input disabled={structureLocked || isPersisted} /></Form.Item>
      <Form.Item label="创建人" htmlFor="assembly-form-creator"><Input id="assembly-form-creator" readOnly value={creatorName} /></Form.Item>
      <Form.Item name="description" label="说明" className="assembly-field-wide"><Input.TextArea rows={2} placeholder="添加用途说明" /></Form.Item>
    </PropertySection>
    <PropertySection title={isAnalytics ? '历史看板配置' : '数据来源'}>
      {isAnalytics && <Form.Item name="mode" label="展示模式"><Select disabled options={analyticsModeOptions} /></Form.Item>}
      <Form.Item name="entity" label={isAnalytics ? '分析对象' : '数据实体'}><Input disabled={structureLocked} prefix={<NodeIndexOutlined />} /></Form.Item>
      <Form.Item name="source" label={isAnalytics ? '数据集来源' : '数据来源'} className="assembly-field-wide"><Input disabled placeholder="保存后自动生成" /></Form.Item>
    </PropertySection>
  </Form>;
}

function MenuTitle({ label, formId, pageCode, defaultEntry }: { label: string; formId?: string; pageCode?: string; defaultEntry?: boolean }) {
  return (
    <Space size={8} className="assembly-menu-title">
      <DragOutlined className="drag-handle" />
      {!formId && !pageCode && <FolderOutlined className="assembly-folder-icon" />}
      <span className="assembly-menu-label">{label}</span>
      {formId && <Tag>{formId}</Tag>}
      {pageCode && <Tag>页面</Tag>}
      {!formId && !pageCode && <Tag>分组</Tag>}
      {defaultEntry && <Tag color="processing">默认</Tag>}
    </Space>
  );
}

function getMenuLabel(node?: MenuNode) {
  if (!node) return '';
  const title = node.title as any;
  return title?.props?.label ?? String(node.key);
}

function menuPropertyValues(node?: MenuNode) {
  return {
    title: getMenuLabel(node),
    pageCode: node?.pageCode,
    visible: node?.visible ?? true,
    defaultEntry: node?.defaultEntry ?? false,
    permissionMode: node?.permissionMode ?? 'inherit',
    roleIds: node?.roleIds ?? [],
  };
}

function isMenuGroup(node: MenuNode) {
  return !node.formId && !node.pageCode && !node.routePath;
}

function findMenuNode(nodes: MenuNode[], key: string): MenuNode | undefined {
  for (const node of nodes) {
    if (node.key === key) return node;
    const child = findMenuNode(node.children ?? [], key);
    if (child) return child;
  }
  return undefined;
}

function collectMenuKeys(nodes: MenuNode[]): string[] {
  return nodes.flatMap((node) => [node.key, ...collectMenuKeys(node.children ?? [])]);
}

function appendMenuNode(nodes: MenuNode[], entry: MenuNode, parentId: number | null): MenuNode[] {
  if (parentId === null) return [...nodes, entry];
  return nodes.map(node => node.dbId === parentId
    ? { ...node, children: [...(node.children ?? []), entry] }
    : { ...node, children: appendMenuNode(node.children ?? [], entry, parentId) });
}

function removeMenuNodePromoteChildren(nodes: MenuNode[], key: string): MenuNode[] {
  return nodes.flatMap((node): MenuNode[] => {
    if (node.key === key) return ((node.children ?? []) as MenuNode[]).map((child) => ({ ...child, parentDbId: node.parentDbId ?? null }));
    return [{ ...node, children: removeMenuNodePromoteChildren(node.children ?? [], key) }];
  });
}

function replaceMenuNode(nodes: MenuNode[], entry: MenuNode): MenuNode[] {
  return nodes.map(node => node.key === entry.key
    ? { ...entry, children: node.children }
    : { ...node, children: replaceMenuNode(node.children ?? [], entry) });
}

function moveNode(nodes: MenuNode[], dragKey: string, dropKey: string, dropPosition: number, dropToGap: boolean) {
  const data = [...nodes];
  let dragNode: MenuNode | undefined;

  const remove = (items: MenuNode[]): MenuNode[] => {
    return items
      .filter((item) => {
        if (item.key === dragKey) {
          dragNode = item;
          return false;
        }
        return true;
      })
      .map((item) => ({ ...item, children: remove(item.children ?? []) }));
  };

  const insert = (items: MenuNode[]): MenuNode[] => {
    if (!dragNode) return items;
    return items.map((item) => {
      if (item.key === dropKey && !dropToGap) {
        return { ...item, children: [...(item.children ?? []), dragNode!] };
      }
      return { ...item, children: insert(item.children ?? []) };
    });
  };

  let withoutDrag = remove(data);
  if (!dragNode) return nodes;
  if (!dropToGap) return insert(withoutDrag);

  const insertNear = (items: MenuNode[]): MenuNode[] => {
    const index = items.findIndex((item) => item.key === dropKey);
    if (index >= 0) {
      const next = [...items];
      const targetIndex = dropPosition < 0 ? index : index + 1;
      next.splice(targetIndex, 0, dragNode!);
      return next;
    }
    return items.map((item) => ({ ...item, children: insertNear(item.children ?? []) }));
  };

  withoutDrag = insertNear(withoutDrag);
  return withoutDrag;
}
