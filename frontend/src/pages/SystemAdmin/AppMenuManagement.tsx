import './assembly.css';
import { MenuAccessPanel, FieldStructurePanel, type AssemblyRole, type NewAssemblyField } from './AssemblyPropertyPanels';
import { useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  AppstoreAddOutlined,
  AppstoreOutlined,
  BarChartOutlined,
  CheckCircleOutlined,
  DashboardOutlined,
  DeleteOutlined,
  DragOutlined,
  FolderOutlined,
  FormOutlined,
  PlusOutlined,
  MenuOutlined,
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
  Empty,
  Dropdown,
  Modal,
  Form,
  Input,
  List,
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
import {
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
  upsertApplicationFormBinding,
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

type AppFormConfig = {
  appId: number;
  formId: string;
  alias: string;
  enabled: boolean;
  defaultView: string;
  dataScope: string;
  allowCreate: boolean;
  allowEdit: boolean;
  allowExport: boolean;
};

type MenuNode = DataNode & {
  key: string;
  title: ReactNode;
  dbId?: number;
  parentDbId?: number | null;
  formId?: string;
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
): MenuNode {
  return {
    key,
    title: <MenuTitle label={label} formId={formId} defaultEntry={defaultEntry} />,
    formId,
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

function resolveMenuRoutePath(formId?: unknown, forms: FormRecord[] = [], fallback?: string): string | undefined {
  const form = formId ? forms.find((item) => item.id === String(formId)) : undefined;
  if (form?.code) {
    return form.category === 'analytics' ? `/program/${form.code}` : `/dynamic/${form.code}`;
  }
  if (fallback) return fallback;
  const numericFormId = formId ? Number(formId) : undefined;
  return numericFormId && !Number.isNaN(numericFormId) ? `/dynamic/${numericFormId}` : undefined;
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

function collectMenuFormIds(nodes: MenuNode[]): string[] {
  return nodes.flatMap((node) => [
    ...(node.formId ? [node.formId] : []),
    ...collectMenuFormIds(node.children ?? []),
  ]);
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

export default function AppMenuManagement() {
  const navigate = useNavigate();
  const [appForm] = Form.useForm();
  const [formForm] = Form.useForm();
  const [menuForm] = Form.useForm();
  const [applications, setApplications] = useState<AppRecord[]>([]);
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [creatorNames, setCreatorNames] = useState<Record<number, string>>({});
  const [forms, setForms] = useState<FormRecord[]>([]);
  const [configs, setConfigs] = useState<AppFormConfig[]>([]);
  const [menusByApp, setMenusByApp] = useState<Record<number, MenuNode[]>>({});
  const [selectedAppId, setSelectedAppId] = useState(0);
  const [selectedFormId, setSelectedFormId] = useState('');
  const [selectedMenuKey, setSelectedMenuKey] = useState('');
  const [menuSyncing, setMenuSyncing] = useState(false);
  const [propertySaving, setPropertySaving] = useState(false);
  const propertyOperation = useRef(false);
  const [loading, setLoading] = useState(true);

  const selectedApp = applications.find((item) => item.id === selectedAppId) ?? applications[0];
  const selectedForm = forms.find((item) => item.id === selectedFormId) ?? forms[0];
  const appConfigs = selectedApp ? configs.filter((item) => item.appId === selectedApp.id) : [];
  const currentMenus = selectedApp ? menusByApp[selectedApp.id] ?? [] : [];
  const selectedMenu = findMenuNode(currentMenus, selectedMenuKey);

  useEffect(() => {
    let cancelled = false;
    adminListUsers().then(response => {
      if (!cancelled) setCreatorNames(Object.fromEntries((response.data?.data || []).map((user: any) => [user.id, user.display_name || user.username])));
    }).catch(() => { /* Retain the immutable creator ID when directory lookup is unavailable. */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    Promise.all([adminListApplications(), adminListRoles(), listPlatformForms()])
      .then(([appsRes, rolesRes, formsRes]) => {
        const apiApps = appsRes.data?.data ?? [];
        const apiRoles = rolesRes.data?.data ?? [];
        const platformForms = unwrapApiList<PlatformForm>(formsRes);
        if (apiApps.length) {
          setApplications(apiApps);
          setSelectedAppId((current) => current || apiApps[0].id);
        }
        if (apiRoles.length) setRoles(apiRoles);
        if (platformForms.length) {
          const mappedPlatformForms = platformForms.map(mapPlatformFormToRecord);
          setForms((prev) => mergeFormRecords(prev, mappedPlatformForms));
          setSelectedFormId(String(platformForms[0].id));
        }
      })
      .catch(() => {
        message.error('菜单管理数据加载失败');
      }).finally(() => setLoading(false));
  }, []);

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
    appForm.setFieldsValue({
      name: selectedApp.name,
      code: selectedApp.code,
      description: selectedApp.description,
      icon: selectedApp.icon || 'AppstoreOutlined',
      default_route: selectedApp.default_route,
      sort_order: selectedApp.sort_order,
      status: selectedApp.status,
      is_pinned: selectedApp.is_pinned,
    });
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
    const form = forms.find((item) => item.id === selectedMenu?.formId);
    menuForm.setFieldsValue({
      title: getMenuLabel(selectedMenu),
      formId: selectedMenu?.formId,
      formName: form?.name,
      routePath: selectedMenu?.routePath,
      visible: selectedMenu?.visible ?? true,
      defaultEntry: selectedMenu?.defaultEntry ?? false,
      permissionMode: selectedMenu?.permissionMode ?? 'inherit',
      roleIds: selectedMenu?.roleIds ?? [],
    });
  }, [forms, menuForm, selectedMenu]);

  const boundFormIds = new Set(collectMenuFormIds(currentMenus));

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
  const saveApp = () => runPropertyOperation(async () => { await persistAppDraft(); message.success('应用属性已保存'); });
  const saveForm = () => runPropertyOperation(async () => { await persistFormDraft(); message.success('表单/看板属性已保存'); });
  const enterFormDesigner = () => runPropertyOperation(async () => {
    const saved = await persistFormDraft();
    navigate(`/form-settings/${encodeURIComponent(saved.code)}`);
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
      name: '\u65b0\u5efa\u4e1a\u52a1\u8868\u5355',
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
    message.success('\u5df2\u521b\u5efa\u8868\u5355\u8349\u7a3f\uff0c\u53ef\u5728\u7c7b\u578b\u5b57\u6bb5\u4e2d\u9009\u62e9\u4e1a\u52a1\u4ea4\u4e92\u7c7b\u6216\u5206\u6790\u5c55\u793a\u7c7b');
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
    if (configs.some((item) => item.formId === selectedForm.id)) {
      message.warning('该表单已被菜单管理使用，请先解除绑定');
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

  const toggleBinding = (formId: string) => {
    const exists = configs.some((item) => item.appId === selectedApp.id && item.formId === formId);
    if (exists) {
      setConfigs((prev) => prev.filter((item) => !(item.appId === selectedApp.id && item.formId === formId)));
      return;
    }
    const form = forms.find((item) => item.id === formId);
    if (!form) return;
    setConfigs((prev) => [
      ...prev,
      {
        appId: selectedApp.id,
        formId,
        alias: form.name,
        enabled: true,
        defaultView: '列表 + 详情',
        dataScope: 'current_app',
        allowCreate: true,
        allowEdit: true,
        allowExport: true,
      },
    ]);
  };

  const addFormToMenu = async (form: FormRecord) => {
    if (selectedApp.id < 0) { message.warning('请先保存应用属性，再配置菜单'); return; }
    const existingNode = findMenuNodeByForm(currentMenus, form.id);
    if (existingNode) {
      setSelectedMenuKey(existingNode.key);
      if (!boundFormIds.has(form.id)) toggleBinding(form.id);
      return;
    }
    const numericFormId = Number(form.id);
    if (Number.isNaN(numericFormId)) {
      message.warning('请先保存表单/看板属性，再加入菜单');
      return;
    }
    setMenuSyncing(true);
    try {
      const res = await createPlatformMenuNode(selectedApp.id, {
        node_type: 'form',
        title: form.name,
        form_id: numericFormId,
        visible: true,
        default_entry: false,
        sort_order: currentMenus.length,
      });
      const created = unwrapApiItem<PlatformMenuNode>(res);
      if (!created) throw new Error('empty menu node response');
      await upsertApplicationFormBinding(selectedApp.id, {
        form_id: numericFormId,
        alias: form.name,
        enabled: true,
        default_view: 'list',
        data_scope: 'current_app',
        allow_create: true,
        allow_edit: true,
        allow_delete: true,
        allow_export: true,
        sort_order: currentMenus.length,
      });
      const nextNode = mapPlatformMenuNodesToTree([created])[0];
      setMenusByApp((prev) => ({
        ...prev,
        [selectedApp.id]: [...(prev[selectedApp.id] ?? []), nextNode],
      }));
      setConfigs((prev) => [
        ...prev.filter((item) => !(item.appId === selectedApp.id && item.formId === form.id)),
        {
          appId: selectedApp.id,
          formId: form.id,
          alias: form.name,
          enabled: true,
          defaultView: 'list',
          dataScope: 'current_app',
          allowCreate: true,
          allowEdit: true,
          allowExport: true,
        },
      ]);
      setSelectedMenuKey(nextNode.key);
      message.success('Menu node saved to database.');
    } catch {
      message.error('Failed to save menu node to database.');
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

    if (target.formId && !hasFormInMenus(nextTree, target.formId)) {
      setConfigs((prev) => prev.filter((item) => !(item.appId === selectedApp.id && item.formId === target.formId)));
      message.success('已删除菜单入口，并解除该表单与当前应用的绑定');
      return;
    }

    if (!target.formId && (target.children?.length ?? 0) > 0) {
      message.success('已删除分组，分组下的节点已提升到同级');
      return;
    }

    message.success('菜单节点已删除');
  };

  const saveMenuNode = async () => {
    if (!selectedMenu?.dbId) { message.warning('请先选择一个已保存的菜单节点'); return; }
    const values = await menuForm.validateFields();
    const numericFormId = values.formId ? Number(values.formId) : undefined;
    if (values.formId && Number.isNaN(numericFormId)) {
      message.warning('Only database-backed forms can be saved to application menus.');
      return;
    }
    if (selectedMenu?.dbId) {
      setMenuSyncing(true);
      try {
        await updatePlatformMenuNode(selectedApp.id, selectedMenu.dbId, {
          title: values.title,
          form_id: numericFormId,
          route_path: resolveMenuRoutePath(values.formId, forms, selectedMenu.routePath),
          node_type: numericFormId ? 'form' : 'group',
          visible: values.visible,
          default_entry: values.defaultEntry,
          config: {
            ...cleanMenuNodeConfig(selectedMenu.config),
            permission_mode: values.permissionMode ?? 'inherit',
            role_ids: values.permissionMode === 'custom' ? values.roleIds ?? [] : [],
            permission_actions: ['view'],
          },
        });
      } catch {
        message.error('Failed to update menu node in database.');
        setMenuSyncing(false);
        return;
      }
      setMenuSyncing(false);
    }
    setMenusByApp((prev) => ({
      ...prev,
      [selectedApp.id]: updateMenuNode(prev[selectedApp.id] ?? [], selectedMenuKey, values, forms),
    }));
    message.success('菜单节点已更新');
    notifyApplicationsChanged();
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

  if (!selectedApp) {
    return <Empty description="暂无可管理应用"><Button icon={<PlusOutlined />} onClick={createDraftApp}>新增应用</Button></Empty>;
  }

  return (
    <div className="app-admin-workspace" aria-busy={menuSyncing}>
      <AssemblyWorkspace
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
        configs={appConfigs}
        menus={currentMenus}
        selectedAppId={selectedApp.id}
        selectedMenuKey={selectedMenuKey}
        selectedMenu={selectedMenu}
        boundFormIds={boundFormIds}
        onSelectApp={setSelectedAppId}
        onOpenFormConfig={(formId) => {
          setSelectedFormId(formId);
        }}
        onToggleBinding={toggleBinding}
        onAddFormToMenu={addFormToMenu}
        onAddMenuGroup={addMenuGroup}
        onSelectMenu={setSelectedMenuKey}
        onDropMenu={onDropMenu}
        menuForm={menuForm}
        onSaveMenu={() => runPropertyOperation(saveMenuNode)}
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
}: {
  status: string;
  allowRepublish?: boolean;
  onSave: () => void;
  onPublish: () => void;
  onDisable: () => void;
  onEnable: () => void;
  onDeleteDraft: () => void;
  onCopyDraft: () => void;
}) {
  if (status === 'published') {
    return (
      <Space wrap>
        <Button icon={<SaveOutlined />} onClick={onSave}>保存变更</Button>
        {allowRepublish && <Button type="primary" icon={<SendOutlined />} onClick={onPublish}>发布更新</Button>}
        <Dropdown trigger={['click']} menu={{ items: [
          { key: 'copy', label: '复制为草稿', icon: <AppstoreAddOutlined />, onClick: onCopyDraft },
          { key: 'disable', label: '停用', icon: <StopOutlined />, danger: true, onClick: () => Modal.confirm({ title: '确认停用？', okText: '停用', cancelText: '取消', okButtonProps: { danger: true }, onOk: onDisable }) },
        ] }}><Button>更多操作</Button></Dropdown>
      </Space>
    );
  }

  if (status === 'disabled') {
    return (
      <Space wrap>
        <Button icon={<SaveOutlined />} onClick={onSave}>保存配置</Button>
        <Button type="primary" icon={<CheckCircleOutlined />} onClick={onEnable}>启用</Button>
      </Space>
    );
  }

  return (
    <Space wrap>
      <Button icon={<SaveOutlined />} onClick={onSave}>保存草稿</Button>
      <Button type="primary" icon={<SendOutlined />} onClick={onPublish}>发布</Button>
      <Popconfirm title="确认删除草稿？" onConfirm={onDeleteDraft}>
        <Button danger icon={<DeleteOutlined />}>删除草稿</Button>
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
  apps,
  appForm, formForm, selectedForm, propertySaving, onCreateApp, onCreateForm, onSaveApp, onSaveForm, onEnterDesign,
  appActions, formActions, creatorName, onCreateField, onUpdateField, onDeleteField, onRoleCreated,
  roles,
  forms,
  configs,
  menus,
  selectedAppId,
  selectedMenuKey,
  selectedMenu,
  boundFormIds,
  onSelectApp,
  onOpenFormConfig,
  onToggleBinding,
  onAddFormToMenu,
  onAddMenuGroup,
  onSelectMenu,
  onDropMenu,
  menuForm,
  onSaveMenu,
  onDeleteMenu,
}: {
  apps: AppRecord[];
  appForm: ReturnType<typeof Form.useForm>[0];
  formForm: ReturnType<typeof Form.useForm>[0];
  selectedForm?: FormRecord;
  propertySaving: boolean;
  onCreateApp: () => void;
  onCreateForm: () => void;
  onSaveApp: () => void;
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
  configs: AppFormConfig[];
  menus: MenuNode[];
  selectedAppId: number;
  selectedMenuKey: string;
  selectedMenu?: MenuNode;
  boundFormIds: Set<string>;
  onSelectApp: (id: number) => void;
  onOpenFormConfig: (id: string) => void;
  onToggleBinding: (id: string) => void;
  onAddFormToMenu: (form: FormRecord) => void;
  onAddMenuGroup: () => void;
  onSelectMenu: (key: string) => void;
  onDropMenu: (info: any) => void;
  menuForm: ReturnType<typeof Form.useForm>[0];
  onSaveMenu: () => void;
  onDeleteMenu: () => void;
}) {
  const [propertyTarget, setPropertyTarget] = useState<'app' | 'form' | 'menu'>('menu');
  const currentFormName = Form.useWatch('name', formForm) || selectedForm?.name || '表单';
  const currentMenuName = Form.useWatch('title', menuForm);
  const currentAppName = Form.useWatch('name', appForm);
  const selectedApp = apps.find((item) => item.id === selectedAppId) ?? apps[0];
  const currentAppForms = forms.filter((form) => boundFormIds.has(form.id));
  const otherForms = forms.filter((form) => !boundFormIds.has(form.id));
  const formCountLabel = `全部 ${forms.length} / 已绑定 ${currentAppForms.length}`;
  const [mouseDraggingFormId, setMouseDraggingFormId] = useState<string | null>(null);

  useEffect(() => {
    const finishMouseDrag = (event: MouseEvent) => {
      if (!mouseDraggingFormId) return;
      const target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
      if (target?.closest('.assembly-menu-card')) {
        const form = forms.find((item) => item.id === mouseDraggingFormId);
        if (form) { onAddFormToMenu(form); setPropertyTarget('menu'); }
      }
      setMouseDraggingFormId(null);
    };
    document.addEventListener('mouseup', finishMouseDrag);
    return () => document.removeEventListener('mouseup', finishMouseDrag);
  }, [forms, mouseDraggingFormId, onAddFormToMenu]);

  const renderFormCard = (form: FormRecord) => {
    const config = configs.find((item) => item.formId === form.id);
    const bound = boundFormIds.has(form.id);
    return (
      <div
        className={`assembly-form-card ${bound ? 'bound' : ''}${propertyTarget === 'form' && selectedForm?.id === form.id ? ' is-selected' : ''}`}
        draggable
        key={form.id}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'copy';
          event.dataTransfer.setData('application/x-form-id', form.id);
          event.dataTransfer.setData('text/plain', form.id);
        }}
        onDragEnd={(event) => {
          const target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
          if (target?.closest('.assembly-menu-card')) onAddFormToMenu(form);
          setMouseDraggingFormId(null);
        }}
        onMouseDown={() => setMouseDraggingFormId(form.id)}
        onClick={() => { if (!propertySaving) { onOpenFormConfig(form.id); setPropertyTarget('form'); } }}
        role="button" tabIndex={0}
        aria-label={`编辑${form.category === 'analytics' ? '看板' : '表单'}属性：${form.name}`}
        onKeyDown={event => { if (!propertySaving && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onOpenFormConfig(form.id); setPropertyTarget('form'); } }}
      >
        {form.category === 'analytics' ? <BarChartOutlined className="assembly-row-icon" /> : <FormOutlined className="assembly-row-icon" />}
        <Typography.Text strong ellipsis>{config?.alias ?? form.name}</Typography.Text>
      </div>
    );
  };
  const dropFormIntoMenu = (event: React.DragEvent) => {
    const formId = event.dataTransfer.getData('application/x-form-id') || event.dataTransfer.getData('text/plain');
    if (!formId) return;
    event.preventDefault();
    event.stopPropagation();
    const form = forms.find((item) => item.id === formId);
    if (form) { onAddFormToMenu(form); setPropertyTarget('menu'); }
  };
  const expandedMenuKeys = collectMenuKeys(menus);

  return (
    <div className="app-assembly-workspace">
      <Row className="assembly-grid">
        <Col>
          <Card title="应用" className="assembly-column-card" extra={<Tooltip title="新增应用"><Button type="text" size="small" aria-label="新增应用" icon={<PlusOutlined />} disabled={propertySaving} onClick={() => { onCreateApp(); setPropertyTarget('app'); }} /></Tooltip>}>
            <List
              dataSource={apps}
              renderItem={(app) => (
                <List.Item
                  className={`admin-app-list-item ${app.id === selectedAppId ? 'active' : ''}`}
                  onClick={() => { if (!propertySaving) { onSelectApp(app.id); setPropertyTarget('app'); } }}
                >
                  <span className="application-icon">{renderIcon(app.icon)}</span>
                  <div>
                    <strong>{app.name}</strong>
                  </div>
                </List.Item>
              )}
            />
          </Card>
        </Col>

        <Col>
          <Card title="表单/看板" className="assembly-column-card" extra={<Space size={4}><Tag>{formCountLabel}</Tag><Tooltip title="新增表单/看板"><Button type="text" size="small" aria-label="新增表单或看板" icon={<PlusOutlined />} disabled={propertySaving} onClick={() => { onCreateForm(); setPropertyTarget('form'); }} /></Tooltip></Space>}>
            <div className="assembly-form-list">
              <div className="assembly-form-section-title">当前应用表单/看板</div>
              {currentAppForms.map(renderFormCard)}
              {!currentAppForms.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无已绑定表单" />}
              <div className="assembly-form-section-title">其他可用表单/看板</div>
              {otherForms.map(renderFormCard)}
              {!otherForms.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无其他可用表单/看板" />}

            </div>
          </Card>
        </Col>

        <Col>
              <Card
                title={<Space><MenuOutlined />菜单结构</Space>}
                className="assembly-menu-card"
                extra={<Button size="small" icon={<AppstoreAddOutlined />} onClick={() => { onAddMenuGroup(); setPropertyTarget('menu'); }}>添加分组</Button>}
                onDragOver={(event) => event.preventDefault()}
                onDrop={dropFormIntoMenu}
              >
                {menus.length ? (
                  <div
                    className="assembly-menu-dropzone"
                    onDragOver={(event) => event.preventDefault()}
                    onDropCapture={dropFormIntoMenu}
                  >
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
                  <Empty description="把中间表单加到菜单结构里" />
                )}
              </Card>
        </Col>
        <Col>
              <Card title="属性" className="assembly-property-card" extra={propertyTarget === 'menu'
                ? <Tag>菜单节点</Tag>
                : <PropertyStatus status={propertyTarget === 'app' ? selectedApp.status : selectedForm?.status || 'draft'} />} >
                {propertyTarget === 'app' ? <fieldset disabled={propertySaving} className="assembly-property-editor">
                  <div className="assembly-property-scroll">
                    <PropertyIdentity icon={renderIcon(selectedApp.icon)} name={currentAppName || selectedApp.name} detail="应用配置" />
                    <AppConfigForm form={appForm} />
                  </div>
                  <div className="assembly-property-actions"><Button onClick={() => appForm.setFieldsValue(selectedApp)}>取消更改</Button><LifecycleActions status={selectedApp.status} onSave={onSaveApp} {...appActions} /></div>
                </fieldset> : propertyTarget === 'form' && selectedForm ? <fieldset disabled={propertySaving} className="assembly-property-editor">
                  <div className="assembly-property-scroll">
                  <PropertyIdentity icon={selectedForm.category === 'analytics' ? <BarChartOutlined /> : <FormOutlined />} name={currentFormName} detail={selectedForm.category === 'analytics' ? '看板配置' : '表单配置'} />
                  <FormConfigForm form={formForm} creatorName={creatorName || selectedForm.creator} isPersisted={/^\d+$/.test(selectedForm.id)} />
                  <FieldStructurePanel fields={selectedForm.fieldRows || []} formName={currentFormName} onCreate={onCreateField} onUpdate={onUpdateField} onDelete={onDeleteField} disabled={propertySaving} />
                  </div>
                  <div className="assembly-property-actions">
                    <Button className="assembly-design-link" loading={propertySaving} onClick={onEnterDesign}>进入设计</Button>
                    <Button onClick={() => formForm.setFieldsValue(selectedForm)}>取消更改</Button>
                    <LifecycleActions allowRepublish status={selectedForm.status} onSave={onSaveForm} {...formActions} />
                  </div>
                </fieldset> : selectedMenu ? (
                  <Form form={menuForm} disabled={propertySaving} layout="vertical" className="assembly-node-editor">
                    <div className="assembly-property-scroll">
                    <PropertyIdentity icon={<MenuOutlined />} name={currentMenuName || getMenuLabel(selectedMenu)} detail={`${selectedApp.name} / 菜单入口`} />
                    <PropertySection title="入口信息">
                      <Form.Item name="title" label="菜单名称" rules={[{ required: true, whitespace: true, message: '请输入菜单名称' }]}><Input /></Form.Item>
                      {selectedMenu.formId && <Form.Item name="formId" label="目标表单 / 看板" rules={[{ required: true, message: '请选择目标表单或看板' }]}>
                        <Select showSearch optionFilterProp="label" options={forms.filter(item => /^\d+$/.test(item.id)).map(item => ({ label: item.name, value: item.id }))} />
                      </Form.Item>}
                    </PropertySection>
                    <section className="assembly-property-section"><h3>导航行为</h3>
                      <div className="assembly-setting-row"><div><strong>在菜单中显示</strong><p>关闭后，用户将看不到这个入口。</p></div><Form.Item name="visible" noStyle valuePropName="checked"><Switch aria-label="在菜单中显示" /></Form.Item></div>
                      <div className="assembly-setting-row"><div><strong>设为应用默认入口</strong><p>进入「{selectedApp.name}」时首先打开此页面。</p></div><Form.Item name="defaultEntry" noStyle valuePropName="checked"><Switch aria-label="设为应用默认入口" /></Form.Item></div>
                    </section>
                    <MenuAccessPanel form={menuForm} roles={roles} inheritedIds={(selectedApp.roles || []).map(role => role.id)} applicationName={selectedApp.name}
                      onRoleCreated={onRoleCreated} disabled={propertySaving} />
                    </div>
                    <div className="assembly-property-actions">
                      <Button onClick={() => menuForm.setFieldsValue({ title: getMenuLabel(selectedMenu), formId: selectedMenu.formId, visible: selectedMenu.visible ?? true, defaultEntry: selectedMenu.defaultEntry ?? false, permissionMode: selectedMenu.permissionMode || 'inherit', roleIds: selectedMenu.roleIds || [] })}>取消更改</Button>
                      <Button type="primary" icon={<SaveOutlined />} onClick={onSaveMenu}>
                        保存属性
                      </Button>
                      <Popconfirm
                        title={selectedMenu.formId ? '删除这个表单入口？' : '删除这个分组？'}
                        description={
                          selectedMenu.formId
                            ? '如果这是该表单在当前应用里的最后一个菜单入口，会同步解除应用与表单的绑定。'
                            : '分组下的表单不会被删除，会自动提升到同级菜单。'
                        }
                        okText="删除"
                        cancelText="取消"
                        okButtonProps={{ danger: true }}
                        onConfirm={onDeleteMenu}
                      >
                        <Button danger icon={<DeleteOutlined />}>
                          删除
                        </Button>
                      </Popconfirm>
                    </div>
                  </Form>
                ) : (
                  <Empty description="选择应用、表单/看板或菜单节点以编辑属性" />
                )}
              </Card>
        </Col>
      </Row>
    </div>
  );
}

function PropertyStatus({ status }: { status: string }) {
  return <Tag color={status === 'published' ? 'success' : status === 'disabled' ? 'default' : 'processing'}>
    {status === 'published' ? '已发布' : status === 'disabled' ? '已停用' : '草稿'}
  </Tag>;
}

function PropertyIdentity({ icon, name, detail }: { icon: ReactNode; name: string; detail: string }) {
  return <div className="assembly-property-identity">
    <span className="assembly-identity-icon">{icon}</span>
    <div><Typography.Text type="secondary">{detail}</Typography.Text><Typography.Title level={5}>{name}</Typography.Title></div>
  </div>;
}

function PropertySection({ title, children, note }: { title: string; children: ReactNode; note?: string }) {
  return <section className="assembly-property-section" aria-label={title}>
    <h3>{title}</h3>{note && <p className="assembly-section-note">{note}</p>}
    <div className="assembly-property-fields">{children}</div>
  </section>;
}

function AppConfigForm({ form }: { form: ReturnType<typeof Form.useForm>[0] }) {
  return <Form form={form} layout="vertical" className="app-config-form">
    <PropertySection title="基本信息">
      <Form.Item name="name" label="应用名称" rules={[{ required: true }]}><Input /></Form.Item>
      <Form.Item name="code" label="应用编码" rules={[{ required: true }]}><Input /></Form.Item>
      <Form.Item name="icon" label="应用图标"><Select optionLabelProp="label"
        options={iconOptions.map(item => ({ value: item.value, label: item.label }))}
        optionRender={option => <Space>{renderIcon(option.data.value)}{option.data.label}</Space>} /></Form.Item>
      <Form.Item name="description" label="应用说明" className="assembly-field-wide"><Input.TextArea rows={2} /></Form.Item>
    </PropertySection>
    <PropertySection title="导航设置">
      <Form.Item name="sort_order" label="排列顺序"><Input type="number" /></Form.Item>
      <Form.Item name="is_pinned" label="置顶到应用栏" valuePropName="checked"><Switch /></Form.Item>
    </PropertySection>
  </Form>;
}

function FormConfigForm({ form, isPersisted, creatorName }: { form: ReturnType<typeof Form.useForm>[0]; isPersisted: boolean; creatorName: string }) {
  const category = Form.useWatch('category', form) ?? 'interaction';
  const structureLocked = Boolean(Form.useWatch('structureLocked', form));
  const isAnalytics = category === 'analytics';
  return <Form form={form} layout="vertical" className="form-config-form">
    <Form.Item name="structureLocked" hidden valuePropName="checked"><Switch /></Form.Item>
    <PropertySection title="基本信息">
      <Form.Item name="name" label={isAnalytics ? '看板名称' : '表单名称'} rules={[{ required: true }]}><Input /></Form.Item>
      <Form.Item name="code" label={isAnalytics ? '看板编码' : '表单编码'} rules={[{ required: true }]}><Input disabled={structureLocked || isPersisted} /></Form.Item>
      <Form.Item label="创建人" htmlFor="assembly-form-creator"><Input id="assembly-form-creator" readOnly value={creatorName} /></Form.Item>
      <Form.Item name="description" label="说明" className="assembly-field-wide"><Input.TextArea rows={2} placeholder="添加用途说明" /></Form.Item>
    </PropertySection>
    <PropertySection title="类型与数据" note={structureLocked ? '结构已锁定，可进入设计维护字段与布局。' : undefined}>
      <Form.Item name="category" label="类型"><Select disabled={structureLocked}
        onChange={value => {
          form.setFieldValue('mode', value === 'analytics' ? 'bi_report' : undefined);
          form.setFieldValue('source', value === 'analytics' ? 'existing_dataset' : 'generated_table');
          form.setFieldValue('entity', value === 'analytics' ? 'MetricDataset' : 'NewEntity');
        }} options={[{label:'业务表单',value:'interaction'},{label:'分析看板',value:'analytics'}]} /></Form.Item>
      {isAnalytics && <Form.Item name="mode" label="展示模式"><Select disabled={structureLocked} options={analyticsModeOptions} /></Form.Item>}
      <Form.Item name="entity" label={isAnalytics ? '分析对象' : '数据实体'}><Input disabled={structureLocked} prefix={<NodeIndexOutlined />} /></Form.Item>
      <Form.Item name="source" label={isAnalytics ? '数据集来源' : '数据来源'} className="assembly-field-wide"><Input disabled placeholder="保存后自动生成" /></Form.Item>
    </PropertySection>
  </Form>;
}

function MenuTitle({ label, formId, defaultEntry }: { label: string; formId?: string; defaultEntry?: boolean }) {
  return (
    <Space size={8} className="assembly-menu-title">
      <DragOutlined className="drag-handle" />
      {!formId && <FolderOutlined className="assembly-folder-icon" />}
      <span className="assembly-menu-label">{label}</span>
      {formId && <Tag>{formId}</Tag>}
      {!formId && <Tag>分组</Tag>}
      {defaultEntry && <Tag color="processing">默认</Tag>}
    </Space>
  );
}

function getMenuLabel(node?: MenuNode) {
  if (!node) return '';
  const title = node.title as any;
  return title?.props?.label ?? String(node.key);
}

function findMenuNode(nodes: MenuNode[], key: string): MenuNode | undefined {
  for (const node of nodes) {
    if (node.key === key) return node;
    const child = findMenuNode(node.children ?? [], key);
    if (child) return child;
  }
  return undefined;
}

function findMenuNodeByForm(nodes: MenuNode[], formId: string): MenuNode | undefined {
  for (const node of nodes) {
    if (node.formId === formId) return node;
    const child = findMenuNodeByForm(node.children ?? [], formId);
    if (child) return child;
  }
  return undefined;
}

function collectMenuKeys(nodes: MenuNode[]): string[] {
  return nodes.flatMap((node) => [node.key, ...collectMenuKeys(node.children ?? [])]);
}

function hasFormInMenus(nodes: MenuNode[], formId: string): boolean {
  return nodes.some((node) => node.formId === formId || hasFormInMenus(node.children ?? [], formId));
}

function removeMenuNodePromoteChildren(nodes: MenuNode[], key: string): MenuNode[] {
  return nodes.flatMap((node): MenuNode[] => {
    if (node.key === key) return ((node.children ?? []) as MenuNode[]).map((child) => ({ ...child, parentDbId: node.parentDbId ?? null }));
    return [{ ...node, children: removeMenuNodePromoteChildren(node.children ?? [], key) }];
  });
}

function updateMenuNode(nodes: MenuNode[], key: string, values: any, forms: FormRecord[] = []): MenuNode[] {
  return nodes.map((node) => {
    if (node.key === key) {
      return {
        ...node,
        title: <MenuTitle label={values.title} formId={values.formId} defaultEntry={values.defaultEntry} />,
        formId: values.formId,
        routePath: resolveMenuRoutePath(values.formId, forms, node.routePath),
        visible: values.visible,
        defaultEntry: values.defaultEntry,
        permissionMode: values.permissionMode,
        roleIds: values.roleIds,
        permissionActions: ['view'],
        permissionRules: values.permissionMode === 'custom'
          ? [{ subjectType: 'roles', roleIds: values.roleIds ?? [], actions: ['view'], effect: 'allow' }]
          : defaultPermissionRules(),
        config: {
          ...cleanMenuNodeConfig(node.config),
          permission_mode: values.permissionMode ?? 'inherit',
          role_ids: values.permissionMode === 'custom' ? values.roleIds ?? [] : [],
          permission_actions: ['view'],
        },
      };
    }
    return { ...node, children: updateMenuNode(node.children ?? [], key, values, forms) };
  });
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
