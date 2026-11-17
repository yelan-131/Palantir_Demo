import useSettingsDraft from './useSettingsDraft';
import InspectorTabs from '@/components/PropertyInspector/InspectorTabs';
import { PropertyGroup } from '@/components/PropertyInspector';
import './assembly.css';
import { MenuAccessPanel, FieldStructurePanel, FieldPropertiesPanel, fieldPropertyValues, RoleChecklist, type AssemblyRole, type NewAssemblyField } from './AssemblyPropertyPanels';
import { useBlocker, useNavigate } from 'react-router-dom';
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
  Alert,
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
  adminReorderApplications,
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
  savePlatformMenuOrder,
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

import { isApplicationCodeLocked, persistApplication, persistForm, propertyError, assemblyFieldPayload, assemblyFieldUpdatePayload } from './assemblyPersistence';

const persistenceApi = { adminCreateApplication, adminUpdateApplication, getPlatformForm, createPlatformForm, updatePlatformForm };
const notifyApplicationsChanged = () => window.dispatchEvent(new Event('applications-changed'));

type AppRecord = {
  edit_token?: string;
  code_locked?: boolean;
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
  edit_token?: string;
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
  editToken?: string;
  key: string;
  title: ReactNode;
  dbId?: number;
  isDraftEntry?: boolean;
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
    edit_token: form.edit_token,
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
        editToken: node.edit_token,
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

function serializeMenuOrder(nodes: MenuNode[], normalize: boolean, parentId: number | null = null):
  Array<{id: number; parent_id: number | null; sort_order: number}> {
  return nodes.flatMap((node, index) => {
    if (!node.dbId) return [];
    return [
      {id: node.dbId, parent_id: parentId, sort_order: normalize ? index : node.sortOrder ?? index},
      ...serializeMenuOrder(node.children ?? [], normalize, node.dbId),
    ];
  });
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
  const [fieldForm] = Form.useForm();
  const [fieldTarget, setFieldTarget] = useState<{ formId: string; fieldId?: string }>();
  const [applications, setApplications] = useState<AppRecord[]>([]);
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [creatorNames, setCreatorNames] = useState<Record<number, string>>({});
  const [forms, setForms] = useState<FormRecord[]>([]);
  const [menusByApp, setMenusByApp] = useState<Record<number, MenuNode[]>>({});
  const [menuPages, setMenuPages] = useState<MenuPage[]>([]);
  const [selectedAppId, setSelectedAppId] = useState(0);
  const [selectedFormId, setSelectedFormId] = useState('');
  const [selectedMenuKey, setSelectedMenuKey] = useState('');
  const [newMenuEntry, setNewMenuEntry] = useState<MenuNode>();
  const previousMenuKey = useRef('');
  const [menuSyncing, setMenuSyncing] = useState(false);
  const [propertySaving, setPropertySaving] = useState(false);
  const propertyOperation = useRef(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);

  const selectedApp = applications.find((item) => item.id === selectedAppId) ?? applications[0];
  const selectedForm = forms.find((item) => item.id === selectedFormId) ?? forms[0];
  const currentFieldTarget = fieldTarget?.formId === selectedForm?.id ? fieldTarget : undefined;
  const selectedField = selectedForm?.fieldRows?.find(field => field.id === currentFieldTarget?.fieldId);
  const creatingField = Boolean(currentFieldTarget && currentFieldTarget.fieldId === undefined);
  const fieldEditorKey = JSON.stringify([selectedForm?.id, selectedField?.id, creatingField]);
  const currentMenus = selectedApp ? menusByApp[selectedApp.id] ?? [] : [];
  const menuTree = newMenuEntry ? appendMenuNode(currentMenus, newMenuEntry, newMenuEntry.parentDbId ?? null) : currentMenus;
  const selectedMenu = findMenuNode(menuTree, selectedMenuKey);
  const cancelNewMenu = () => {
    setNewMenuEntry(undefined);
    setSelectedMenuKey(previousMenuKey.current);
  };

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
    setLoading(true);
    setLoadError('');
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
        if (!cancelled) setLoadError(businessData ? '业务来源加载失败，请重试。' : '应用与菜单加载失败，请重试。');
      }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [businessData, initialFormId, loadAttempt]);

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

  const appDraft = useSettingsDraft(appForm, String(selectedApp?.id ?? ''), selectedApp ? appPropertyValues(selectedApp) : {}, selectedApp?.edit_token, Boolean(selectedApp && selectedApp.id < 0));
  const formValues = selectedForm ? { category: 'interaction', mode: undefined, structureLocked: selectedForm.status !== 'draft', ...selectedForm } : {};
  const formDraft = useSettingsDraft(formForm, selectedForm?.id ?? '', formValues, selectedForm?.edit_token, Boolean(selectedForm && !/^\d+$/.test(selectedForm.id)));
  const menuDraft = useSettingsDraft(menuForm, selectedMenu?.key ?? '', menuPropertyValues(selectedMenu), selectedMenu?.editToken, Boolean(selectedMenu?.isDraftEntry));
  const fieldDraft = useSettingsDraft(fieldForm, fieldEditorKey, fieldPropertyValues(selectedField));
  const fieldDirty = Boolean((selectedField || creatingField) && fieldDraft.dirty);
  const dirty = appDraft.dirty || formDraft.dirty || menuDraft.dirty || fieldDirty;
  const busy = propertySaving || menuSyncing;
  const savedNavigation = useRef(false);
  const discardSettings = () => {
    appDraft.discard();
    formDraft.discard();
    menuDraft.discard();
    if (newMenuEntry) cancelNewMenu();
    fieldDraft.discard();
    setFieldTarget(undefined);
    if (selectedApp?.id < 0) {
      setApplications(previous => previous.filter(app => app.id !== selectedApp.id));
      setSelectedAppId(applications.find(app => app.id > 0)?.id ?? 0);
    }
    if (selectedForm && !/^\d+$/.test(selectedForm.id)) {
      setForms(previous => previous.filter(form => form.id !== selectedForm.id));
      setSelectedFormId(forms.find(form => /^\d+$/.test(form.id))?.id ?? '');
    }
  };
  const confirmSwitch = (action: () => void) => {
    if (busy) { message.info('正在保存，请稍候'); return; }
    if (!dirty) { action(); return; }
    Modal.confirm({
      title: '有尚未保存的修改',
      content: '继续切换将放弃当前修改。',
      okText: '放弃修改并继续', cancelText: '继续编辑',
      onOk: () => { discardSettings(); action(); },
    });
  };
  const selectField = (fieldId?: string) => {
    if (!selectedForm || busy || (currentFieldTarget && fieldId === currentFieldTarget.fieldId)) return;
    const select = () => setFieldTarget({ formId: selectedForm.id, fieldId });
    if (!fieldDirty) { select(); return; }
    Modal.confirm({
      title: '字段有尚未保存的修改',
      content: '继续切换将放弃当前字段修改。',
      okText: '放弃修改并继续', cancelText: '继续编辑',
      onOk: select,
    });
  };
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (savedNavigation.current) { savedNavigation.current = false; return false; }
    const changed = appDraft.isDirty() || formDraft.isDirty() || menuDraft.isDirty() || Boolean((selectedField || creatingField) && fieldDraft.isDirty());
    return (changed || busy) && (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search);
  });
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (busy) { message.info('正在保存，请稍候'); blocker.reset(); return; }
    const modal = Modal.confirm({
      title: '有尚未保存的修改',
      content: '离开页面将放弃当前修改。',
      okText: '放弃修改并离开', cancelText: '继续编辑',
      onOk: () => { discardSettings(); blocker.proceed(); },
      onCancel: blocker.reset,
    });
    return () => modal.destroy();
  }, [blocker.state]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty || busy) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty, busy]);

  const commitForm = (raw: PlatformForm, previousId: string) => {
    const saved = mapPlatformFormToRecord(raw);
    formDraft.accept(saved.id, {category: 'interaction', mode: undefined, structureLocked: saved.status !== 'draft', ...saved}, saved.edit_token);
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
    const saved = await persistApplication(persistenceApi, {...selectedApp, edit_token: appDraft.token()}, selectedApp.id < 0 ? { ...values, sort_order: selectedApp.sort_order } : values, status) as AppRecord;
    appDraft.accept(String(saved.id), appPropertyValues(saved), saved.edit_token);
    setApplications(previous => previous.map(item => item.id === selectedApp.id ? saved : item));
    setSelectedAppId(saved.id);
    try {
      const response = await listPlatformMenuNodes(saved.id);
      setMenusByApp(previous => ({...previous, [saved.id]: mapPlatformMenuNodesToTree(unwrapApiList<PlatformMenuNode>(response))}));
    } catch {
      message.warning('应用已保存，菜单状态请稍后刷新');
    }
    notifyApplicationsChanged();
    return saved;
  };
  const persistFormDraft = async () => {
    const values = await formForm.validateFields();
    const raw = await persistForm(persistenceApi, {...selectedForm, edit_token: formDraft.token()}, values);
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
    savedNavigation.current = true;
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
      sort_order: Math.max(0, ...applications.map(app => app.sort_order)) + 1,
      status: 'draft',
      is_pinned: false,
      roles: [],
    };
    setApplications((prev) => [...prev, nextApp]);
    setSelectedAppId(nextId);
    message.success('已添加应用草稿，请在右侧属性中配置并保存');
  };

  const reorderApplications = (order: number[]) => runPropertyOperation(async () => {
    const expected = applications.filter(app => app.id > 0).map(app => app.id);
    try {
      const response = await adminReorderApplications(expected, order);
      setApplications(response.data.data);
      notifyApplicationsChanged();
      message.success('应用顺序已保存');
    } catch (failure) {
      if ((failure as { response?: { status: number } }).response?.status === 409) {
        const response = await adminListApplications();
        setApplications(response.data.data);
      }
      throw failure;
    }
  });

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
      ...values, name: values.name + ' 副本', code: 'app-copy-' + Date.now(), is_pinned: false, role_ids: undefined,
    }, 'draft') as AppRecord;
    setApplications(previous => [...previous, copied]); setSelectedAppId(copied.id);
    message.success('应用属性已复制并保存为草稿');
  });

  const createDraftForm = () => {
    const nextId = `form-${Date.now()}`;
    const nextForm: FormRecord = {
      id: nextId,
      name: '新建业务数据',
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

  const startMenuEntry = () => {
    if (selectedApp.id < 0) {
      message.warning('请先保存应用属性，再新建菜单');
      return;
    }
    const node: MenuNode = {
      key: 'new-menu-entry',
      title: <MenuTitle label="新建菜单" draft />,
      parentDbId: selectedMenu && isMenuGroup(selectedMenu) ? selectedMenu.dbId ?? null : null,
      isDraftEntry: true,
    };
    previousMenuKey.current = selectedMenuKey;
    setNewMenuEntry(node);
    setSelectedMenuKey(node.key);
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
    if (!selectedMenu?.dbId || menuSyncing || propertySaving) return;
    const target = selectedMenu;
    const applicationId = selectedApp.id;
    setMenuSyncing(true);
    try {
      const response = await deletePlatformMenuNode(applicationId, target.dbId!);
      const tree = mapPlatformMenuNodesToTree(unwrapApiList<PlatformMenuNode>(response));
      setMenusByApp(previous => ({...previous, [applicationId]: tree}));
      setSelectedMenuKey(collectMenuKeys(tree)[0] ?? '');
      if (target.defaultEntry) {
        setApplications(previous => previous.map(app =>
          app.id === applicationId ? {...app, default_route: '/'} : app));
      }
      notifyApplicationsChanged();
      message.success(isMenuGroup(target) && target.children?.length
        ? '已删除分组，子节点已提升到同级' : '菜单节点已删除');
    } catch (error) {
      message.error(propertyError(error, '删除菜单失败'));
    } finally {
      setMenuSyncing(false);
    }
  };

  const saveMenuNode = async () => {
    if (!selectedMenu || (!selectedMenu.dbId && !selectedMenu.isDraftEntry)) return false;
    const values = await menuForm.validateFields();
    setMenuSyncing(true);
    try {
      const config = {
        ...cleanMenuNodeConfig(selectedMenu.config),
        permission_mode: values.permissionMode ?? 'inherit',
        role_ids: values.permissionMode === 'custom' ? values.roleIds ?? [] : [],
        permission_actions: ['view'],
      };
      const properties = {
        title: values.title.trim(),
        visible: values.visible,
        default_entry: values.defaultEntry,
        config,
      };
      const parentId = selectedMenu.parentDbId ?? null;
      const response = selectedMenu.isDraftEntry
        ? await createPlatformMenuNode(selectedApp.id, {
          ...properties,
          create_page: true,
          parent_id: parentId,
          sort_order: getSiblingOrder(currentMenus, parentId)
            .reduce((last, node) => Math.max(last, node.sortOrder ?? 0), -1) + 1,
        })
        : await updatePlatformMenuNode(selectedApp.id, selectedMenu.dbId!, {
          ...properties,
          expected_token: menuDraft.token(),
        });
      const updated = unwrapApiItem<PlatformMenuNode>(response);
      if (!updated) throw new Error('empty menu node response');
      const entry = {
        ...mapPlatformMenuNodesToTree([{ ...updated, parent_id: null }])[0],
        parentDbId: updated.parent_id ?? null,
      };
      menuDraft.accept(entry.key, menuPropertyValues(entry), updated.edit_token);
      let defaultRoute = selectedApp.default_route;
      if (updated.default_entry) defaultRoute = updated.route_path || '/';
      else if (selectedMenu.defaultEntry) defaultRoute = '/';
      setApplications(previous => previous.map(app =>
        app.id === selectedApp.id ? {...app, default_route: defaultRoute} : app));
      setMenusByApp(previous => {
        const nodes = previous[selectedApp.id] ?? [];
        const tree = selectedMenu.isDraftEntry ? appendMenuNode(nodes, entry, entry.parentDbId ?? null) : replaceMenuNode(nodes, entry);
        const syncDefaults = (items: MenuNode[]): MenuNode[] => items.map(item => {
          let defaultEntry = item.defaultEntry;
          if (updated.default_entry) defaultEntry = item.key === entry.key;
          else if (selectedMenu.defaultEntry) defaultEntry = false;
          return {
            ...item,
            defaultEntry,
            title: <MenuTitle label={getMenuLabel(item)} formId={item.formId}
              pageCode={item.pageCode} defaultEntry={defaultEntry} />,
            children: syncDefaults(item.children ?? []),
          };
        });
        return {...previous, [selectedApp.id]: syncDefaults(tree)};
      });
      if (selectedMenu.isDraftEntry) {
        setNewMenuEntry(undefined);
        setSelectedMenuKey(entry.key);
      }
      message.success(selectedMenu.isDraftEntry ? '菜单已创建' : '菜单节点已更新');
      notifyApplicationsChanged();
      return true;
    } catch (error) {
      message.error(propertyError(error, '保存菜单失败'));
    } finally {
      setMenuSyncing(false);
    }
  };

  const onDropMenu = async (info: any) => {
    if (menuSyncing || propertySaving || !info?.dragNode?.key || !info?.node?.key) return;
    const applicationId = selectedApp.id;
    const nextTree = moveNode(currentMenus, info.dragNode.key, info.node.key, info.dropPosition, info.dropToGap);
    setMenuSyncing(true);
    try {
      const response = await savePlatformMenuOrder(applicationId, serializeMenuOrder(currentMenus, false), serializeMenuOrder(nextTree, true));
      const tree = mapPlatformMenuNodesToTree(unwrapApiList<PlatformMenuNode>(response));
      setMenusByApp(previous => ({...previous, [applicationId]: tree}));
      notifyApplicationsChanged();
    } catch (error) {
      message.error(propertyError(error, '菜单移动未保存，请重试'));
      try {
        const response = await listPlatformMenuNodes(applicationId);
        setMenusByApp(previous => ({...previous, [applicationId]: mapPlatformMenuNodesToTree(unwrapApiList<PlatformMenuNode>(response))}));
      } catch {
        message.warning('暂时无法刷新菜单，请稍后重新加载页面');
      }
    } finally {
      setMenuSyncing(false);
    }
  };

  if (loading) return <Spin tip="正在读取配置"><div style={{ minHeight: 240 }} /></Spin>;

  if (loadError) return <Alert type="error" showIcon message={loadError} action={<Button onClick={() => setLoadAttempt(value => value + 1)}>重试</Button>} />;

  if (!businessData && !selectedApp) {
    return <Empty description="暂无可管理应用"><Button icon={<PlusOutlined />} onClick={createDraftApp}>新增应用</Button></Empty>;
  }

  return (
    <div className="app-admin-workspace" aria-busy={menuSyncing}>
      <AssemblyWorkspace
        businessData={businessData}
        onSwitch={confirmSwitch}
        apps={applications}
        onReorderApps={reorderApplications}
        appForm={appForm}
        formForm={formForm}
        selectedForm={selectedForm}
        propertySaving={propertySaving}
        onCreateApp={createDraftApp}
        onCreateForm={() => confirmSwitch(createDraftForm)}
        onSaveApp={saveApp}
        onSaveForm={saveForm}
        onEnterDesign={enterFormDesigner}
        appActions={{ onPublish: publishSelectedApp, onDisable: disableSelectedApp, onEnable: enableSelectedApp, onDeleteDraft: deleteSelectedDraftApp, onCopyDraft: copySelectedAppAsDraft }}
        formActions={{ onPublish: publishSelectedForm, onDisable: disableSelectedForm, onEnable: enableSelectedForm, onDeleteDraft: deleteSelectedDraftForm, onCopyDraft: copySelectedFormAsDraft }}
        roles={roles}
        creatorName={selectedForm?.creatorId ? creatorNames[selectedForm.creatorId] || selectedForm.creator : selectedForm?.creator}
        fieldId={selectedField?.id}
        onSelectField={selectField}
        fieldProperties={businessData && <FieldPropertiesPanel key={fieldEditorKey}
          editing={selectedField} creating={creatingField} fieldForm={fieldForm}
          onCreate={createAssemblyField} onUpdate={(id, values) => mutateAssemblyField(id, values)}
          onDelete={id => mutateAssemblyField(id)} disabled={propertySaving}
          onClose={() => setFieldTarget(undefined)} />}
        onRoleCreated={role => setRoles(previous => [role, ...previous.filter(item => item.id !== role.id)])}
        forms={forms}
        menus={menuTree}
        menuPages={menuPages}
        onStartMenuEntry={startMenuEntry}
        onCancelNewMenu={cancelNewMenu}
        onOpenPageDesign={code => navigate(`/pages/${encodeURIComponent(code)}?edit=1`)}
        selectedAppId={selectedApp?.id ?? 0}
        selectedMenuKey={selectedMenuKey}
        selectedMenu={selectedMenu}
        onSelectApp={setSelectedAppId}
        onOpenFormConfig={setSelectedFormId}
        menuSyncing={menuSyncing}
        onAddMenuGroup={addMenuGroup}
        onSelectMenu={setSelectedMenuKey}
        onDropMenu={info => confirmSwitch(() => { void onDropMenu(info); })}
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
  onReorderApps,
  onSwitch, appForm, formForm, selectedForm, propertySaving, onCreateApp, onCreateForm, onSaveApp, onSaveForm, onEnterDesign,
  appActions, formActions, creatorName, fieldId, onSelectField, fieldProperties, onRoleCreated,
  roles,
  forms,
  menus,
  menuPages,
  onStartMenuEntry,
  onCancelNewMenu,
  onOpenPageDesign,
  selectedAppId,
  selectedMenuKey,
  selectedMenu,
  onSelectApp,
  onOpenFormConfig,
  menuSyncing,
  onAddMenuGroup,
  onSelectMenu,
  onDropMenu,
  menuForm,
  onSaveMenu,
  onDeleteMenu,
}: {
  onSwitch: (action: () => void) => void;
  businessData: boolean;
  apps: AppRecord[];
  onReorderApps: (order: number[]) => void;
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
  fieldId?: string;
  onSelectField: (id?: string) => void;
  fieldProperties: ReactNode;
  onRoleCreated: (role: AssemblyRole) => void;
  forms: FormRecord[];
  menus: MenuNode[];
  menuPages: MenuPage[];
  onStartMenuEntry: () => void;
  onCancelNewMenu: () => void;
  onOpenPageDesign: (code: string) => void;
  selectedAppId: number;
  selectedMenuKey: string;
  selectedMenu?: MenuNode;
  onSelectApp: (id: number) => void;
  onOpenFormConfig: (id: string) => void;
  menuSyncing: boolean;
  onAddMenuGroup: () => void;
  onSelectMenu: (key: string) => void;
  onDropMenu: (info: any) => void;
  menuForm: ReturnType<typeof Form.useForm>[0];
  onSaveMenu: (onSaved: () => void) => void;
  onDeleteMenu: () => void;
}) {
  const [propertyTarget, setPropertyTarget] = useState<'app' | 'form' | 'menu'>(businessData ? 'form' : 'menu');
  const [editingMenuKey, setEditingMenuKey] = useState<string>();
  useEffect(() => setEditingMenuKey(undefined), [selectedAppId, selectedMenuKey]);
  const menuEditing = Boolean(selectedMenu && (selectedMenu.isDraftEntry || editingMenuKey === selectedMenu.key));
  const menuReadOnly = propertySaving || !menuEditing;
  const cancelMenuEdit = () => {
    if (selectedMenu?.isDraftEntry) { onCancelNewMenu(); return; }
    menuForm.resetFields();
    menuForm.setFieldsValue(menuPropertyValues(selectedMenu));
    setEditingMenuKey(undefined);
  };
  const activeForm = businessData ? selectedForm : undefined;
  const watchedFormName = Form.useWatch('name', formForm);
  const currentFormName = activeForm ? watchedFormName || activeForm.name : '表单设置';
  const currentMenuName = Form.useWatch('title', menuForm);
  const currentAppName = Form.useWatch('name', appForm);
  const menuPropertyTitle = selectedMenu ? `${currentMenuName || getMenuLabel(selectedMenu)}` : '菜单属性';
  const formPropertyTitle = currentFormName;
  const selectedApp = apps.find((item) => item.id === selectedAppId) ?? apps[0];
  const [appEditing, setAppEditing] = useState(false);
  useEffect(() => setAppEditing(selectedAppId < 0), [selectedAppId, selectedApp?.status]);
  const appPropertyTitle = `${currentAppName || selectedApp?.name || '应用'}`;
  const propertyTitle = propertyTarget === 'app' ? appPropertyTitle
    : propertyTarget === 'form' ? formPropertyTitle : menuPropertyTitle;
  const [resourceQuery, setResourceQuery] = useState('');
  const query = resourceQuery.trim().toLowerCase();
  const visibleForms = forms.filter(form => form.name.toLowerCase().includes(query));
  const visibleApps = apps.filter(app => app.name.toLowerCase().includes(query));
  const menuBusy = propertySaving || menuSyncing;
  const [draggedAppId, setDraggedAppId] = useState<number>();
  const [appDropTarget, setAppDropTarget] = useState<{ id: number; after: boolean }>();
  const appOrder = apps.filter(app => app.id > 0).map(app => app.id);
  const canReorderApps = !menuBusy && !query && appOrder.length > 1 && apps.length === appOrder.length;
  const moveApp = (source: number, target: number, after: boolean) => {
    if (!canReorderApps || source === target || !appOrder.includes(source) || !appOrder.includes(target)) return;
    const order = appOrder.filter(id => id !== source);
    order.splice(order.indexOf(target) + Number(after), 0, source);
    if (order.every((id, index) => id === appOrder[index])) return;
    onSwitch(() => onReorderApps(order));
  };
  const clearAppDrag = () => {
    setDraggedAppId(undefined);
    setAppDropTarget(undefined);
  };
  const [businessPropertyTab, setBusinessPropertyTab] = useState('form');
  useEffect(() => setBusinessPropertyTab('form'), [activeForm?.id]);
  const showFieldProperties = (id?: string) => {
    setBusinessPropertyTab('field');
    onSelectField(id);
  };
  const selectedPageCode = selectedMenu?.pageCode ?? selectedMenu?.routePath?.match(/^\/pages\/([^/?#]+)$/)?.[1];
  const publishedPageCodes = new Set(menuPages.map(page => page.code));

  const renderFormCard = (form: FormRecord) => {
    return (
      <div
        className={`assembly-form-card${selectedForm?.id === form.id ? ' is-selected' : ''}`}
        key={form.id}
        onClick={() => { if (selectedForm?.id !== form.id) onSwitch(() => onOpenFormConfig(form.id)); }}
        role="button" tabIndex={0}
        aria-label={`${businessData ? '查看属性' : '前往业务数据'}：${form.name}`}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (!propertySaving && selectedForm?.id !== form.id) onSwitch(() => onOpenFormConfig(form.id));
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
      {businessData && <header className="assembly-page-heading">
        <Button icon={<PlusOutlined />} disabled={propertySaving} onClick={onCreateForm}>新增业务数据</Button>
      </header>}
      <Row className="assembly-grid">
        <Col className={businessData ? undefined : 'assembly-app-column'}>
          <Card title={<Space>{businessData ? <FormOutlined /> : <AppstoreOutlined />}{businessData ? '业务数据' : '应用'}</Space>}
            className="assembly-column-card assembly-resources-card"
            extra={!businessData && <Button size="small" icon={<PlusOutlined />} disabled={propertySaving}
              onClick={() => onSwitch(() => { onCreateApp(); setPropertyTarget('app'); })}>新增应用</Button>}>
            <div className="assembly-resource-tools">
              <Input.Search aria-label={businessData ? '搜索业务数据' : '搜索应用'} placeholder="搜索名称" allowClear
                value={resourceQuery} onChange={event => setResourceQuery(event.target.value)} />
            </div>
            <div className="assembly-form-list">
              {businessData ? visibleForms.map(renderFormCard) : visibleApps.map(app => (
                <button
                  type="button"
                  key={app.id}
                  className={`assembly-form-card assembly-app-option${app.id === selectedAppId ? ' is-selected' : ''}`}
                  data-drop-position={appDropTarget?.id === app.id ? (appDropTarget.after ? 'after' : 'before') : undefined}
                  draggable={canReorderApps}
                  onDragStart={event => {
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', String(app.id));
                    setDraggedAppId(app.id);
                  }}
                  onDragOver={event => {
                    if (!canReorderApps || draggedAppId === undefined || draggedAppId === app.id) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    const bounds = event.currentTarget.getBoundingClientRect();
                    setAppDropTarget({ id: app.id, after: event.clientY >= bounds.top + bounds.height / 2 });
                  }}
                  onDrop={event => {
                    if (draggedAppId === undefined) return;
                    event.preventDefault();
                    const bounds = event.currentTarget.getBoundingClientRect();
                    moveApp(draggedAppId, app.id, event.clientY >= bounds.top + bounds.height / 2);
                    clearAppDrag();
                  }}
                  onDragEnd={clearAppDrag}
                  onKeyDown={event => {
                    if (!canReorderApps || !event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
                    event.preventDefault();
                    const down = event.key === 'ArrowDown';
                    const target = appOrder[appOrder.indexOf(app.id) + (down ? 1 : -1)];
                    if (target !== undefined) moveApp(app.id, target, down);
                  }}
                  aria-current={app.id === selectedAppId ? 'true' : undefined}
                  title={canReorderApps ? `${app.name} · 拖动排序，或按 Alt + ↑ / ↓` : app.name}
                  disabled={menuBusy}
                  onClick={() => {
                    if (app.id === selectedAppId && propertyTarget === 'app') return;
                    onSwitch(() => {
                      onSelectApp(app.id);
                      setPropertyTarget('app');
                    });
                  }}
                >
                  <span className="assembly-row-icon">{renderIcon(app.icon)}</span>
                  <Typography.Text ellipsis>{app.name}</Typography.Text>
                  {canReorderApps && <DragOutlined className="assembly-app-drag-icon" aria-hidden="true" />}
                </button>
              ))}
              {!(businessData ? visibleForms.length : visibleApps.length) && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={query ? '没有匹配的结果' : businessData ? '暂无业务数据' : '暂无可管理应用'} />}
            </div>
          </Card>
        </Col>

        {!businessData && <Col>
              <Card
                title="菜单结构"
                className="assembly-menu-card"
                extra={<Space size={8} wrap>
                  <Button size="small" type="primary" icon={<PlusOutlined />} disabled={menuBusy || selectedMenu?.isDraftEntry}
                    onClick={() => onSwitch(() => { onStartMenuEntry(); setPropertyTarget('menu'); })}>新建菜单</Button>
                  <Button size="small" icon={<AppstoreAddOutlined />} disabled={menuBusy}
                    onClick={() => onSwitch(() => { onAddMenuGroup(); setPropertyTarget('menu'); })}>添加分组</Button>
                </Space>}
              >
                {menus.length ? (
                  <div className="assembly-menu-dropzone">
                    <Tree
                      key={`${selectedAppId}-${expandedMenuKeys.join('|')}`}
                      draggable={!selectedMenu?.isDraftEntry}
                      blockNode
                      treeData={menus}
                      selectedKeys={[selectedMenuKey]}
                      defaultExpandAll
                      defaultExpandedKeys={expandedMenuKeys}
                      onSelect={keys => {
                        if (menuBusy) return;
                        const key = String(keys[0] ?? selectedMenuKey);
                        if (key === selectedMenuKey && propertyTarget === 'menu') return;
                        onSwitch(() => { onSelectMenu(key); setPropertyTarget('menu'); });
                      }}
                      onDrop={onDropMenu}
                    />
                  </div>
                ) : (
                  <Empty description="暂无菜单，请新建菜单或添加分组" />
                )}
              </Card>
        </Col>}
        <Col className={businessData ? 'assembly-fields-column' : undefined}>
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
                        disabled={propertySaving} onClick={() => setEditingMenuKey(selectedMenu.key)} />
                    ) : <>
                      <Button size="small" type="text" icon={<CloseOutlined />} aria-label="取消更改" title="取消更改"
                        disabled={propertySaving} onClick={cancelMenuEdit} />
                      <Button size="small" type="primary" icon={<SaveOutlined />} aria-label="保存属性" title="保存属性"
                        disabled={propertySaving} loading={propertySaving} onClick={() => onSaveMenu(() => setEditingMenuKey(undefined))} />
                      {!selectedMenu.isDraftEntry && <Popconfirm
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
                      </Popconfirm>}
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
                  onChange={key => onSwitch(() => setPropertyTarget(key === 'app' ? 'app' : 'menu'))}
                />}
                {propertyTarget === 'app' && selectedApp ? (
                  <fieldset disabled={propertySaving || !appEditing} className="assembly-property-editor">
                    <div className="assembly-property-scroll assembly-inspector-content">
                      <AppConfigForm form={appForm} app={selectedApp} menus={menus} roles={roles} publishedPageCodes={publishedPageCodes} disabled={propertySaving || !appEditing} />
                    </div>
                  </fieldset>
                ) : propertyTarget === 'form' && activeForm ? <fieldset disabled={propertySaving} className="assembly-property-editor">
                  <div className="assembly-property-scroll assembly-inspector-content">
                    <div className="assembly-section-heading">
                      <h3>字段列表 <span>{activeForm.fieldRows?.length ?? 0}</span></h3>
                      <Button size="small" icon={<PlusOutlined />} disabled={propertySaving} onClick={() => showFieldProperties()}>新增字段</Button>
                    </div>
                    <FieldStructurePanel fields={activeForm.fieldRows || []} selectedId={fieldId} onSelect={showFieldProperties} disabled={propertySaving} />
                  </div>
                </fieldset> : propertyTarget === 'form' ? (
                  <Empty className="assembly-property-empty" image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="请从左侧选择业务数据" />
                ) : selectedMenu ? (
                  <Form form={menuForm} disabled={menuReadOnly} layout="horizontal" colon={false} size="small"
                    className="assembly-node-editor assembly-property-form property-inspector">
                    <div className="assembly-property-scroll assembly-inspector-content">
                      <PropertyGroup title="入口信息">
                        <Form.Item name="title" label="菜单名称" rules={[{ required: true, whitespace: true, message: '请输入菜单名称' },
                          ...(selectedMenu.isDraftEntry ? [{ max: 100, message: '菜单名称最多 100 个字符' }] : [])]}>
                          <Input />
                        </Form.Item>
                        {selectedMenu.formId && !selectedMenu.pageCode && (
                          <Form.Item label="当前入口">
                            <Input readOnly value={forms.find(form => form.id === selectedMenu.formId)?.name ?? selectedMenu.routePath} />
                          </Form.Item>
                        )}
                        {selectedMenu.isDraftEntry && <p className="assembly-inspector-note">保存后将自动创建同名页面草稿，发布页面后才会显示在应用导航中。</p>}
                      </PropertyGroup>
                      <PropertyGroup title="导航行为">
                        <Form.Item name="visible" label="在菜单中显示" tooltip="在应用的导航菜单中显示此入口。"
                          valuePropName="checked" className="assembly-switch-field">
                          <Switch />
                        </Form.Item>
                        <Form.Item name="defaultEntry" label="设为应用默认入口" tooltip={`进入「${selectedApp.name}」时优先打开此页面。`}
                          valuePropName="checked" className="assembly-switch-field">
                          <Switch disabled={menuReadOnly || !selectedMenu.routePath || Boolean(selectedMenu.pageCode && !publishedPageCodes.has(selectedMenu.pageCode))} />
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
        {businessData && <Col className="assembly-field-properties-column">
          <Card title="属性" className="assembly-property-card assembly-business-inspector">
            <InspectorTabs aria-label="业务数据属性" className="assembly-property-switch"
              activeKey={businessPropertyTab} onChange={setBusinessPropertyTab} items={[
                { key: 'form', label: '表单属性与数据来源', forceRender: true, children: activeForm ? (
                  <fieldset disabled={propertySaving} className="assembly-property-editor">
                    <div className="assembly-property-scroll">
                      <FormConfigForm form={formForm} creatorName={creatorName || activeForm.creator}
                        isPersisted={/^\d+$/.test(activeForm.id)} isAnalytics={activeForm.category === 'analytics'} />
                    </div>
                  </fieldset>
                ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请从左侧选择业务数据" /> },
                { key: 'field', label: '字段属性', forceRender: true, children: fieldProperties },
              ]} />
          </Card>
        </Col>}
      </Row>
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
    role_ids: (app.roles ?? []).map(role => role.id),
    name: app.name,
    code: app.code,
    description: app.description,
    icon: app.icon || 'AppstoreOutlined',
    default_route: app.default_route,
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

function AppConfigForm({ form, app, menus, roles, publishedPageCodes, disabled }: {
  form: ReturnType<typeof Form.useForm>[0];
  app: AppRecord;
  menus: MenuNode[];
  roles: AssemblyRole[];
  publishedPageCodes: Set<string>;
  disabled: boolean;
}) {
  const codeLocked = isApplicationCodeLocked(app);
  const entryOptions = new Map([['/', '工作台首页']]);
  for (const node of getAllMenuNodes(menus)) {
    if (node.visible !== false && node.routePath && !entryOptions.has(node.routePath)
      && (!node.pageCode || publishedPageCodes.has(node.pageCode))) {
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
      <Form.Item name="code" label="应用编码" tooltip={codeLocked ? '首次发布后，应用编码不可修改。' : undefined}
        rules={[{ required: true, whitespace: true, max: 100 }]}>
        <Input maxLength={100} disabled={codeLocked || disabled} />
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
      <Form.Item name="is_pinned" label="在主导航优先显示" valuePropName="checked" className="assembly-switch-field"
        tooltip="开启后，此应用默认排在左侧主导航中未开启的应用之前。用户可在自己的偏好中调整。">
        <Switch />
      </Form.Item>
    </PropertyGroup>
    <PropertyGroup title="应用访问" hint="菜单选择跟随应用权限时，会使用应用绑定的角色。">
      <Form.Item name="role_ids" className="assembly-role-field">
        <RoleChecklist roles={roles} inheritedIds={[]} custom disabled={disabled} />
      </Form.Item>
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

function MenuTitle({ label, formId, pageCode, defaultEntry, draft }: { label: string; formId?: string; pageCode?: string; defaultEntry?: boolean; draft?: boolean }) {
  return (
    <Space size={8} className="assembly-menu-title">
      <DragOutlined className="drag-handle" />
      {!draft && !formId && !pageCode && <FolderOutlined className="assembly-folder-icon" />}
      <span className="assembly-menu-label">{label}</span>
      {formId && <Tag>{formId}</Tag>}
      {pageCode && <Tag>页面</Tag>}
      {!draft && !formId && !pageCode && <Tag>分组</Tag>}
      {draft && <Tag>待配置</Tag>}
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
    visible: node?.visible ?? true,
    defaultEntry: node?.defaultEntry ?? false,
    permissionMode: node?.permissionMode ?? 'inherit',
    roleIds: node?.roleIds ?? [],
  };
}

function isMenuGroup(node: MenuNode) {
  return !node.isDraftEntry && !node.formId && !node.pageCode && !node.routePath;
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
