import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  AppstoreAddOutlined,
  AppstoreOutlined,
  BranchesOutlined,
  DashboardOutlined,
  DeleteOutlined,
  DragOutlined,
  FolderOutlined,
  FormOutlined,
  MenuOutlined,
  NodeIndexOutlined,
  SafetyCertificateOutlined,
  SaveOutlined,
  ShopOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import {
  Button,
  Card,
  Col,
  Divider,
  Drawer,
  Empty,
  Form,
  Input,
  List,
  Popconfirm,
  Row,
  Select,
  Space,
  Switch,
  Tabs,
  Tag,
  Tree,
  Typography,
  message,
} from 'antd';
import type { DataNode } from 'antd/es/tree';
import {
  adminListApplications,
  adminListRoles,
  adminUpdateApplication,
  adminUpdateApplicationBindings,
  listSemanticOntologyObjects,
} from '@/services/api';

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

type FormRecord = {
  id: string;
  name: string;
  code: string;
  entity: string;
  source: string;
  status: 'draft' | 'published' | 'disabled';
  owner: string;
  description: string;
  fields: number;
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
  formId?: string;
  visible?: boolean;
  defaultEntry?: boolean;
  children?: MenuNode[];
};

const iconMap: Record<string, ReactNode> = {
  DashboardOutlined: <DashboardOutlined />,
  ToolOutlined: <ToolOutlined />,
  SafetyCertificateOutlined: <SafetyCertificateOutlined />,
  ShopOutlined: <ShopOutlined />,
  AppstoreOutlined: <AppstoreOutlined />,
};

const fallbackRoles: RoleRecord[] = [
  { id: 1, name: 'admin', label: '平台管理员' },
  { id: 2, name: 'production_manager', label: '生产经理' },
  { id: 3, name: 'quality_engineer', label: '质量工程师' },
];

const fallbackApplications: AppRecord[] = [
  {
    id: 1,
    name: '生产态势',
    code: 'production-situation',
    description: '生产运行、OEE、产线状态和告警工作包。',
    icon: 'DashboardOutlined',
    default_route: '/dashboard',
    sort_order: 1,
    status: 'published',
    is_pinned: true,
    roles: [fallbackRoles[0], fallbackRoles[1]],
  },
  {
    id: 2,
    name: '预测性维护',
    code: 'predictive-maintenance',
    description: '设备健康、故障预测和维修工单工作包。',
    icon: 'ToolOutlined',
    default_route: '/maintenance',
    sort_order: 2,
    status: 'published',
    is_pinned: true,
    roles: [fallbackRoles[0], fallbackRoles[1]],
  },
  {
    id: 3,
    name: '质量分析',
    code: 'quality-analytics',
    description: '质量事件、SPC、缺陷和 CAPA 工作包。',
    icon: 'SafetyCertificateOutlined',
    default_route: '/quality',
    sort_order: 3,
    status: 'published',
    is_pinned: false,
    roles: [fallbackRoles[0], fallbackRoles[2]],
  },
  {
    id: 4,
    name: '供应链风险',
    code: 'supply-chain-risk',
    description: '供应商、物料、交付和风险复核工作包。',
    icon: 'ShopOutlined',
    default_route: '/supply-chain',
    sort_order: 4,
    status: 'published',
    is_pinned: false,
    roles: [fallbackRoles[0], fallbackRoles[1]],
  },
];

const fallbackForms: FormRecord[] = [
  { id: 'device-health', name: '设备健康表单', code: 'device-health', entity: 'Device', source: 'equipment', status: 'published', owner: '设备团队', description: '设备状态、健康分、传感器摘要和维护动作。', fields: 8 },
  { id: 'fault-prediction', name: '故障预测表单', code: 'fault-prediction', entity: 'Device', source: 'equipment_health', status: 'published', owner: '算法团队', description: '故障概率、风险等级、预测原因和处置建议。', fields: 10 },
  { id: 'maintenance-order', name: '维修工单表单', code: 'maintenance-order', entity: 'WorkOrder', source: 'work_orders', status: 'published', owner: '维护团队', description: '维修工单的创建、派发、审批和关闭。', fields: 12 },
  { id: 'alert-center', name: '告警表单', code: 'alert-center', entity: 'Alert', source: 'alerts', status: 'published', owner: '平台团队', description: '设备、质量、供应链告警统一处理。', fields: 7 },
  { id: 'supplier-risk', name: '供应商风险表单', code: 'supplier-risk', entity: 'Supplier', source: 'suppliers', status: 'published', owner: '供应链团队', description: '供应商评分、交付风险和复核流程。', fields: 9 },
  { id: 'quality-event', name: '质量事件表单', code: 'quality-event', entity: 'QualityEvent', source: 'defects', status: 'draft', owner: '质量团队', description: '缺陷、SPC、CAPA 和质量复核。', fields: 11 },
];

const supplementalForms: FormRecord[] = [
  { id: 'production-overview', name: '生产总览表单', code: 'production-overview', entity: 'ProductionOverview', source: 'dashboard_summary', status: 'published', owner: '生产团队', description: '生产节拍、产量、OEE、班次和异常汇总。', fields: 10 },
  { id: 'line-status', name: '产线状态表单', code: 'line-status', entity: 'ProductionLine', source: 'production_lines', status: 'published', owner: '生产团队', description: '产线状态、负荷、计划达成和瓶颈分析。', fields: 9 },
  { id: 'quality-overview', name: '质量总览表单', code: 'quality-overview', entity: 'QualityOverview', source: 'quality_metrics', status: 'published', owner: '质量团队', description: '良率、缺陷率、检验覆盖和过程能力总览。', fields: 8 },
  { id: 'inspection-batch', name: '检验批次表单', code: 'inspection-batch', entity: 'Inspection', source: 'inspections', status: 'published', owner: '质量团队', description: '来料、过程、终检批次的登记和结果追踪。', fields: 12 },
  { id: 'defect-analysis', name: '缺陷分析表单', code: 'defect-analysis', entity: 'Defect', source: 'defects', status: 'published', owner: '质量团队', description: '缺陷类型、严重度、根因、纠正措施和复发趋势。', fields: 11 },
  { id: 'supply-overview', name: '供应链总览表单', code: 'supply-overview', entity: 'SupplyOverview', source: 'supply_summary', status: 'published', owner: '供应链团队', description: '交付、库存、风险和替代方案的综合视图。', fields: 8 },
  { id: 'material-impact', name: '物料影响表单', code: 'material-impact', entity: 'Material', source: 'materials', status: 'published', owner: '供应链团队', description: '物料库存、安全库存、短缺风险和影响工单。', fields: 10 },
  { id: 'risk-review', name: '风险复核表单', code: 'risk-review', entity: 'RiskReview', source: 'risk_reviews', status: 'draft', owner: '供应链团队', description: '高风险供应商、物料短缺和交付延迟的复核流程。', fields: 9 },
  { id: 'customer-complaint', name: '客户投诉表单', code: 'customer-complaint', entity: 'CustomerComplaint', source: 'customer_complaints', status: 'draft', owner: '质量团队', description: '客户投诉、8D、根因和关闭确认。', fields: 13 },
  { id: 'change-request', name: '工程变更表单', code: 'change-request', entity: 'EngineeringChange', source: 'engineering_changes', status: 'draft', owner: '工程团队', description: '工艺、物料、图纸和质量标准变更申请。', fields: 14 },
];

const initialConfigs: AppFormConfig[] = [
  { appId: 2, formId: 'device-health', alias: '设备健康总览', enabled: true, defaultView: '列表 + 详情', dataScope: 'health_score < 95', allowCreate: false, allowEdit: true, allowExport: true },
  { appId: 2, formId: 'fault-prediction', alias: '故障预测', enabled: true, defaultView: '风险看板', dataScope: 'risk_level >= medium', allowCreate: false, allowEdit: false, allowExport: true },
  { appId: 2, formId: 'maintenance-order', alias: '工单管理', enabled: true, defaultView: '列表', dataScope: 'current_app', allowCreate: true, allowEdit: true, allowExport: true },
  { appId: 2, formId: 'alert-center', alias: '告警中心', enabled: true, defaultView: '列表', dataScope: 'source = maintenance', allowCreate: false, allowEdit: true, allowExport: false },
  { appId: 4, formId: 'supplier-risk', alias: '供应商风险', enabled: true, defaultView: '风险看板', dataScope: 'risk_score > 60', allowCreate: true, allowEdit: true, allowExport: true },
];

const supplementalConfigs: AppFormConfig[] = [
  { appId: 1, formId: 'production-overview', alias: '生产总览表单', enabled: true, defaultView: 'KPI 看板', dataScope: 'factory = current', allowCreate: false, allowEdit: false, allowExport: true },
  { appId: 1, formId: 'line-status', alias: '产线状态表单', enabled: true, defaultView: '看板 + 趋势', dataScope: 'line.status != offline', allowCreate: false, allowEdit: true, allowExport: true },
  { appId: 1, formId: 'device-health', alias: '设备运行表单', enabled: true, defaultView: '列表 + 详情', dataScope: 'current_factory', allowCreate: false, allowEdit: false, allowExport: true },
  { appId: 1, formId: 'alert-center', alias: '活动告警表单', enabled: true, defaultView: '告警列表', dataScope: 'source = production', allowCreate: false, allowEdit: true, allowExport: false },
  { appId: 3, formId: 'quality-overview', alias: '质量总览表单', enabled: true, defaultView: '质量看板', dataScope: 'inspection_date >= this_month', allowCreate: false, allowEdit: false, allowExport: true },
  { appId: 3, formId: 'inspection-batch', alias: '检验批次表单', enabled: true, defaultView: '批次列表', dataScope: 'current_app', allowCreate: true, allowEdit: true, allowExport: true },
  { appId: 3, formId: 'defect-analysis', alias: '缺陷分析表单', enabled: true, defaultView: '图表 + 明细', dataScope: 'severity >= minor', allowCreate: true, allowEdit: true, allowExport: true },
  { appId: 3, formId: 'quality-event', alias: 'CAPA 跟踪表单', enabled: true, defaultView: '流程列表', dataScope: 'status != closed', allowCreate: true, allowEdit: true, allowExport: true },
  { appId: 4, formId: 'supply-overview', alias: '供应链总览表单', enabled: true, defaultView: '风险看板', dataScope: 'current_app', allowCreate: false, allowEdit: false, allowExport: true },
  { appId: 4, formId: 'material-impact', alias: '物料影响表单', enabled: true, defaultView: '图谱 + 列表', dataScope: 'shortage_risk > low', allowCreate: false, allowEdit: true, allowExport: true },
  { appId: 4, formId: 'risk-review', alias: '风险复核表单', enabled: true, defaultView: '流程列表', dataScope: 'review_status = pending', allowCreate: true, allowEdit: true, allowExport: true },
];

const initialMenus: Record<number, MenuNode[]> = {
  1: [
    menuNode('prod-root', '生产态势', undefined, [
      menuNode('prod-device', '设备运行总览', 'device-health'),
      menuNode('prod-alerts', '活动告警', 'alert-center'),
    ], true),
  ],
  2: [
    menuNode('pm-root', '预测性维护', undefined, [
      menuNode('pm-health', '设备健康', 'device-health', undefined, true),
      menuNode('pm-predict', '故障预测', 'fault-prediction'),
      menuNode('pm-orders', '工单管理', 'maintenance-order'),
      menuNode('pm-alerts', '告警中心', 'alert-center'),
    ], true),
  ],
  3: [
    menuNode('quality-root', '质量分析', undefined, [
      menuNode('quality-event', '质量事件', 'quality-event'),
    ], true),
  ],
  4: [
    menuNode('supply-root', '供应链风险', undefined, [
      menuNode('supply-risk', '供应商风险', 'supplier-risk', undefined, true),
    ], true),
  ],
};

const richMenusByApp: Record<number, MenuNode[]> = {
  ...initialMenus,
  1: [
    menuNode('prod-root', '生产态势', undefined, [
      menuNode('prod-overview', '生产总览', 'production-overview', undefined, true),
      menuNode('prod-lines', '产线状态', 'line-status'),
      menuNode('prod-device', '设备运行', 'device-health'),
      menuNode('prod-alerts', '活动告警', 'alert-center'),
    ], true),
  ],
  3: [
    menuNode('quality-root', '质量分析', undefined, [
      menuNode('quality-overview', '质量总览', 'quality-overview', undefined, true),
      menuNode('quality-inspection', '检验批次', 'inspection-batch'),
      menuNode('quality-defect', '缺陷分析', 'defect-analysis'),
      menuNode('quality-capa', 'CAPA 跟踪', 'quality-event'),
    ], true),
  ],
  4: [
    menuNode('supply-root', '供应链风险', undefined, [
      menuNode('supply-overview', '风险总览', 'supply-overview', undefined, true),
      menuNode('supply-risk', '供应商风险', 'supplier-risk'),
      menuNode('supply-material', '物料影响', 'material-impact'),
      menuNode('supply-review', '风险复核', 'risk-review'),
    ], true),
  ],
};

const enhancedMenusByApp: Record<number, MenuNode[]> = {
  1: [
    menuNode('prod-monitoring', '生产监控', undefined, [
      menuNode('prod-overview', '生产总览', 'production-overview', undefined, true),
      menuNode('prod-lines', '产线状态', 'line-status'),
      menuNode('prod-device', '设备运行', 'device-health'),
    ], true),
    menuNode('prod-exceptions', '异常处理', undefined, [
      menuNode('prod-alerts', '活动告警', 'alert-center'),
    ]),
  ],
  2: [
    menuNode('pm-health-group', '健康与预测', undefined, [
      menuNode('pm-health', '设备健康', 'device-health', undefined, true),
      menuNode('pm-predict', '故障预测', 'fault-prediction'),
    ], true),
    menuNode('pm-execution-group', '维护执行', undefined, [
      menuNode('pm-orders', '维修工单', 'maintenance-order'),
      menuNode('pm-alerts', '告警中心', 'alert-center'),
    ]),
  ],
  3: [
    menuNode('quality-control-group', '质量监控', undefined, [
      menuNode('quality-overview', '质量总览', 'quality-overview', undefined, true),
      menuNode('quality-inspection', '检验批次', 'inspection-batch'),
    ], true),
    menuNode('quality-improve-group', '问题改进', undefined, [
      menuNode('quality-defect', '缺陷分析', 'defect-analysis'),
      menuNode('quality-capa', 'CAPA 跟踪', 'quality-event'),
    ]),
  ],
  4: [
    menuNode('supply-risk-group', '风险监控', undefined, [
      menuNode('supply-overview', '风险总览', 'supply-overview', undefined, true),
      menuNode('supply-risk', '供应商风险', 'supplier-risk'),
    ], true),
    menuNode('supply-impact-group', '影响与复核', undefined, [
      menuNode('supply-material', '物料影响', 'material-impact'),
      menuNode('supply-review', '风险复核', 'risk-review'),
    ]),
  ],
};

function menuNode(
  key: string,
  label: string,
  formId?: string,
  children?: MenuNode[],
  defaultEntry = false,
): MenuNode {
  return {
    key,
    title: <MenuTitle label={label} formId={formId} defaultEntry={defaultEntry} />,
    formId,
    visible: true,
    defaultEntry,
    children,
  };
}

function renderIcon(name?: string) {
  return iconMap[name || ''] || <AppstoreOutlined />;
}

export default function AppMenuManagement() {
  const [appForm] = Form.useForm();
  const [formForm] = Form.useForm();
  const [menuForm] = Form.useForm();
  const [applications, setApplications] = useState<AppRecord[]>(fallbackApplications);
  const [roles, setRoles] = useState<RoleRecord[]>(fallbackRoles);
  const [forms, setForms] = useState<FormRecord[]>([...fallbackForms, ...supplementalForms]);
  const [configs, setConfigs] = useState<AppFormConfig[]>([...initialConfigs, ...supplementalConfigs]);
  const [menusByApp, setMenusByApp] = useState<Record<number, MenuNode[]>>(enhancedMenusByApp);
  const [selectedAppId, setSelectedAppId] = useState(2);
  const [selectedFormId, setSelectedFormId] = useState('device-health');
  const [selectedMenuKey, setSelectedMenuKey] = useState('pm-health');
  const [appDrawerOpen, setAppDrawerOpen] = useState(false);
  const [formDrawerOpen, setFormDrawerOpen] = useState(false);

  const selectedApp = applications.find((item) => item.id === selectedAppId) ?? applications[0];
  const selectedForm = forms.find((item) => item.id === selectedFormId) ?? forms[0];
  const appConfigs = configs.filter((item) => item.appId === selectedApp.id);
  const currentMenus = menusByApp[selectedApp.id] ?? [];
  const selectedMenu = findMenuNode(currentMenus, selectedMenuKey);

  useEffect(() => {
    Promise.all([adminListApplications(), adminListRoles(), listSemanticOntologyObjects()])
      .then(([appsRes, rolesRes, objectsRes]) => {
        const apiApps = appsRes.data?.data ?? [];
        const apiRoles = rolesRes.data?.data ?? [];
        const ontologyObjects = objectsRes.data?.data ?? [];
        if (apiApps.length) setApplications(apiApps);
        if (apiRoles.length) setRoles(apiRoles);
        if (ontologyObjects.length) {
          setForms((prev) => mergeOntologyForms(prev, ontologyObjects));
        }
      })
      .catch(() => {
        // Demo data is intentionally enough for this first product pass.
      });
  }, []);

  useEffect(() => {
    appForm.setFieldsValue({
      name: selectedApp.name,
      code: selectedApp.code,
      description: selectedApp.description,
      icon: selectedApp.icon || 'AppstoreOutlined',
      default_route: selectedApp.default_route,
      sort_order: selectedApp.sort_order,
      status: selectedApp.status,
      is_pinned: selectedApp.is_pinned,
      role_ids: selectedApp.roles?.map((role) => role.id) ?? [],
    });
  }, [appForm, selectedApp]);

  useEffect(() => {
    formForm.setFieldsValue(selectedForm);
  }, [formForm, selectedForm]);

  useEffect(() => {
    const form = forms.find((item) => item.id === selectedMenu?.formId);
    menuForm.setFieldsValue({
      title: getMenuLabel(selectedMenu),
      formId: selectedMenu?.formId,
      formName: form?.name,
      visible: selectedMenu?.visible ?? true,
      defaultEntry: selectedMenu?.defaultEntry ?? false,
    });
  }, [forms, menuForm, selectedMenu]);

  const boundFormIds = new Set(appConfigs.map((item) => item.formId));

  const saveApp = async () => {
    const values = await appForm.validateFields();
    const roleList = roles.filter((role) => (values.role_ids ?? []).includes(role.id));
    const nextApp = {
      ...selectedApp,
      ...values,
      sort_order: Number(values.sort_order || 0),
      is_pinned: Boolean(values.is_pinned),
      roles: roleList,
    };
    setApplications((prev) => prev.map((item) => (item.id === selectedApp.id ? nextApp : item)));
    try {
      await adminUpdateApplication(selectedApp.id, nextApp);
      await adminUpdateApplicationBindings(selectedApp.id, { role_ids: values.role_ids ?? [], menu_ids: [] });
      message.success('应用配置已保存');
    } catch {
      message.success('应用配置已保存到演示状态');
    }
    setAppDrawerOpen(false);
  };

  const saveForm = async () => {
    const values = await formForm.validateFields();
    setForms((prev) => prev.map((item) => (item.id === selectedForm.id ? { ...item, ...values } : item)));
    message.success('表单配置已保存');
    setFormDrawerOpen(false);
  };

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

  const addFormToMenu = (form: FormRecord) => {
    const existingNode = findMenuNodeByForm(currentMenus, form.id);
    if (existingNode) {
      setSelectedMenuKey(existingNode.key);
      if (!boundFormIds.has(form.id)) toggleBinding(form.id);
      return;
    }
    const nextNode = menuNode(`${selectedApp.id}-${form.id}-${Date.now()}`, form.name, form.id);
    setMenusByApp((prev) => ({
      ...prev,
      [selectedApp.id]: [...(prev[selectedApp.id] ?? []), nextNode],
    }));
    setSelectedMenuKey(nextNode.key);
    if (!boundFormIds.has(form.id)) toggleBinding(form.id);
  };

  const addMenuGroup = () => {
    const nextNode = menuNode(`${selectedApp.id}-group-${Date.now()}`, '新建分组');
    setMenusByApp((prev) => ({
      ...prev,
      [selectedApp.id]: [...(prev[selectedApp.id] ?? []), nextNode],
    }));
    setSelectedMenuKey(nextNode.key);
  };

  const deleteSelectedMenuNode = () => {
    if (!selectedMenu) return;
    const target = selectedMenu;
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
    const values = await menuForm.validateFields();
    setMenusByApp((prev) => ({
      ...prev,
      [selectedApp.id]: updateMenuNode(prev[selectedApp.id] ?? [], selectedMenuKey, values),
    }));
    message.success('菜单节点已更新');
  };

  const onDropMenu = (info: any) => {
    if (!info?.dragNode?.key || !info?.node?.key) return;
    const dragKey = info.dragNode.key;
    const dropKey = info.node.key;
    const dropPosition = info.dropPosition;
    const dropToGap = info.dropToGap;
    const nextTree = moveNode(currentMenus, dragKey, dropKey, dropPosition, dropToGap);
    setMenusByApp((prev) => ({ ...prev, [selectedApp.id]: nextTree }));
  };

  return (
    <div className="app-admin-workspace">
      <Tabs
        defaultActiveKey="assembly"
        items={[
          {
            key: 'apps',
            label: '应用管理',
            children: (
              <AppManagement
                apps={applications}
                roles={roles}
                selectedAppId={selectedApp.id}
                onSelect={setSelectedAppId}
                onOpenConfig={() => setAppDrawerOpen(true)}
              />
            ),
          },
          {
            key: 'forms',
            label: '表单管理',
            children: (
              <FormManagement
                forms={forms}
                selectedFormId={selectedForm.id}
                onSelect={setSelectedFormId}
                onOpenConfig={() => setFormDrawerOpen(true)}
              />
            ),
          },
          {
            key: 'assembly',
            label: '应用装配',
            children: (
              <AssemblyWorkspace
                apps={applications}
                forms={forms}
                configs={appConfigs}
                menus={currentMenus}
                selectedAppId={selectedApp.id}
                selectedMenuKey={selectedMenuKey}
                selectedMenu={selectedMenu}
                boundFormIds={boundFormIds}
                onSelectApp={setSelectedAppId}
                onOpenAppConfig={() => setAppDrawerOpen(true)}
                onOpenFormConfig={(formId) => {
                  setSelectedFormId(formId);
                  setFormDrawerOpen(true);
                }}
                onToggleBinding={toggleBinding}
                onAddFormToMenu={addFormToMenu}
                onAddMenuGroup={addMenuGroup}
                onSelectMenu={setSelectedMenuKey}
                onDropMenu={onDropMenu}
                menuForm={menuForm}
                onSaveMenu={saveMenuNode}
                onDeleteMenu={deleteSelectedMenuNode}
              />
            ),
          },
        ]}
      />

      <Drawer
        title="应用配置"
        open={appDrawerOpen}
        width={520}
        onClose={() => setAppDrawerOpen(false)}
        extra={<Button type="primary" icon={<SaveOutlined />} onClick={saveApp}>保存</Button>}
      >
        <AppConfigForm form={appForm} roles={roles} />
      </Drawer>

      <Drawer
        title="表单配置"
        open={formDrawerOpen}
        width={560}
        onClose={() => setFormDrawerOpen(false)}
        extra={<Button type="primary" icon={<SaveOutlined />} onClick={saveForm}>保存</Button>}
      >
        <FormConfigForm form={formForm} />
      </Drawer>
    </div>
  );
}

function AppManagement({
  apps,
  roles,
  selectedAppId,
  onSelect,
  onOpenConfig,
}: {
  apps: AppRecord[];
  roles: RoleRecord[];
  selectedAppId: number;
  onSelect: (id: number) => void;
  onOpenConfig: () => void;
}) {
  const selected = apps.find((item) => item.id === selectedAppId) ?? apps[0];

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={8}>
        <Card title="应用列表" extra={<Button size="small" icon={<AppstoreAddOutlined />}>新建</Button>}>
          <List
            dataSource={apps}
            renderItem={(app) => (
              <List.Item
                className={`admin-app-list-item ${app.id === selectedAppId ? 'active' : ''}`}
                onClick={() => onSelect(app.id)}
              >
                <span className="application-icon">{renderIcon(app.icon)}</span>
                <div>
                  <strong>{app.name}</strong>
                  <small>{app.code}</small>
                </div>
                <Tag color={app.status === 'published' ? 'success' : 'warning'}>{statusText(app.status)}</Tag>
              </List.Item>
            )}
          />
        </Card>
      </Col>
      <Col xs={24} lg={16}>
        <Card title="应用本身配置" extra={<Button type="primary" icon={<SaveOutlined />} onClick={onOpenConfig}>编辑应用</Button>}>
          <Row gutter={[16, 16]}>
            <Col xs={24} md={12}>
              <InfoBlock label="应用名称" value={selected.name} />
            </Col>
            <Col xs={24} md={12}>
              <InfoBlock label="应用编码" value={selected.code} />
            </Col>
            <Col xs={24} md={12}>
              <InfoBlock label="默认首页" value={selected.default_route} />
            </Col>
            <Col xs={24} md={12}>
              <InfoBlock label="可见角色" value={(selected.roles ?? roles).map((role) => role.label).join(' / ')} />
            </Col>
            <Col span={24}>
              <InfoBlock label="应用描述" value={selected.description ?? '-'} />
            </Col>
          </Row>
        </Card>
      </Col>
    </Row>
  );
}

function FormManagement({
  forms,
  selectedFormId,
  onSelect,
  onOpenConfig,
}: {
  forms: FormRecord[];
  selectedFormId: string;
  onSelect: (id: string) => void;
  onOpenConfig: () => void;
}) {
  const selected = forms.find((item) => item.id === selectedFormId) ?? forms[0];

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={8}>
        <Card title="表单列表" extra={<Button size="small" icon={<FormOutlined />}>新建</Button>}>
          <List
            dataSource={forms}
            renderItem={(form) => (
              <List.Item
                className={`admin-form-list-item ${form.id === selectedFormId ? 'active' : ''}`}
                onClick={() => onSelect(form.id)}
              >
                <span className="application-icon"><FormOutlined /></span>
                <div>
                  <strong>{form.name}</strong>
                  <small>{form.entity} / {form.source}</small>
                </div>
                <Tag>{form.fields} fields</Tag>
              </List.Item>
            )}
          />
        </Card>
      </Col>
      <Col xs={24} lg={16}>
        <Card title="表单本身配置" extra={<Button type="primary" icon={<SaveOutlined />} onClick={onOpenConfig}>编辑表单</Button>}>
          <Row gutter={[16, 16]}>
            <Col xs={24} md={12}>
              <InfoBlock label="表单名称" value={selected.name} />
            </Col>
            <Col xs={24} md={12}>
              <InfoBlock label="表单编码" value={selected.code} />
            </Col>
            <Col xs={24} md={12}>
              <InfoBlock label="绑定本体对象" value={selected.entity} />
            </Col>
            <Col xs={24} md={12}>
              <InfoBlock label="数据来源" value={selected.source} />
            </Col>
            <Col xs={24} md={12}>
              <InfoBlock label="字段数量" value={`${selected.fields}`} />
            </Col>
            <Col xs={24} md={12}>
              <InfoBlock label="负责人" value={selected.owner} />
            </Col>
            <Col span={24}>
              <InfoBlock label="表单描述" value={selected.description} />
            </Col>
          </Row>
        </Card>
      </Col>
    </Row>
  );
}

function AssemblyWorkspace({
  apps,
  forms,
  configs,
  menus,
  selectedAppId,
  selectedMenuKey,
  selectedMenu,
  boundFormIds,
  onSelectApp,
  onOpenAppConfig,
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
  forms: FormRecord[];
  configs: AppFormConfig[];
  menus: MenuNode[];
  selectedAppId: number;
  selectedMenuKey: string;
  selectedMenu?: MenuNode;
  boundFormIds: Set<string>;
  onSelectApp: (id: number) => void;
  onOpenAppConfig: () => void;
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
  const selectedApp = apps.find((item) => item.id === selectedAppId) ?? apps[0];
  const currentAppForms = forms.filter((form) => boundFormIds.has(form.id));
  const otherForms = forms.filter((form) => !boundFormIds.has(form.id));
  const [mouseDraggingFormId, setMouseDraggingFormId] = useState<string | null>(null);

  useEffect(() => {
    const finishMouseDrag = (event: MouseEvent) => {
      if (!mouseDraggingFormId) return;
      const target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
      if (target?.closest('.assembly-menu-card')) {
        const form = forms.find((item) => item.id === mouseDraggingFormId);
        if (form) onAddFormToMenu(form);
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
        className={`assembly-form-card ${bound ? 'bound' : ''}`}
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
      >
        <FormOutlined className="assembly-row-icon" />
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
    if (form) onAddFormToMenu(form);
  };
  const expandedMenuKeys = collectMenuKeys(menus);

  return (
    <div className="app-assembly-workspace">
      <section className="assembly-help">
        <div>
          <Typography.Title level={5}>应用装配</Typography.Title>
          <Typography.Text type="secondary">
            左侧选择应用，中间维护这个应用可用的表单，右侧通过拖拽菜单树把表单组织成导航。
          </Typography.Text>
        </div>
        <Space>
          <Button icon={<AppstoreOutlined />} onClick={onOpenAppConfig}>应用配置</Button>
          <Tag color="processing">{selectedApp.name}</Tag>
        </Space>
      </section>

      <Row gutter={[16, 16]} className="assembly-grid">
        <Col xs={24} xl={5}>
          <Card title="应用" className="assembly-column-card">
            <List
              dataSource={apps}
              renderItem={(app) => (
                <List.Item
                  className={`admin-app-list-item ${app.id === selectedAppId ? 'active' : ''}`}
                  onClick={() => onSelectApp(app.id)}
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

        <Col xs={24} xl={7}>
          <Card title="表单" className="assembly-column-card" extra={<Tag>{configs.length} 已绑定</Tag>}>
            <div className="assembly-form-list">
              <div className="assembly-form-section-title">当前应用表单</div>
              {currentAppForms.map(renderFormCard)}
              <div className="assembly-form-section-title">其他可用表单</div>
              {otherForms.map(renderFormCard)}
              {false && forms.map((form) => {
                const config = configs.find((item) => item.formId === form.id);
                const bound = boundFormIds.has(form.id);
                return (
                  <div className={`assembly-form-card ${bound ? 'bound' : ''}`} key={form.id}>
                    <div>
                      <Space wrap>
                        <Typography.Text strong>{config?.alias ?? form.name}</Typography.Text>
                        <Tag>{form.entity}</Tag>
                        <Tag color={bound ? 'success' : 'default'}>{bound ? '已绑定' : '未绑定'}</Tag>
                      </Space>
                      <Typography.Text type="secondary">{form.description}</Typography.Text>
                      {config && (
                        <div className="assembly-config-line">
                          <span>{config.defaultView}</span>
                          <span>{config.dataScope}</span>
                        </div>
                      )}
                    </div>
                    <Space>
                      <Button size="small" onClick={() => onToggleBinding(form.id)}>{bound ? '解绑' : '绑定'}</Button>
                      <Button size="small" onClick={() => onAddFormToMenu(form)}>加到菜单</Button>
                      <Button size="small" onClick={() => onOpenFormConfig(form.id)}>配置</Button>
                    </Space>
                  </div>
                );
              })}
            </div>
          </Card>
        </Col>

        <Col xs={24} xl={6}>
              <Card
                title={<Space><MenuOutlined />菜单结构</Space>}
                className="assembly-menu-card"
                extra={<Button size="small" icon={<AppstoreAddOutlined />} onClick={onAddMenuGroup}>添加分组</Button>}
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
                      onSelect={(keys) => onSelectMenu(String(keys[0] ?? selectedMenuKey))}
                      onDrop={onDropMenu}
                    />
                  </div>
                ) : (
                  <Empty description="把中间表单加到菜单结构里" />
                )}
              </Card>
        </Col>
        <Col xs={24} xl={6}>
              <Card title="菜单节点属性" className="assembly-property-card">
                {selectedMenu ? (
                  <Form form={menuForm} layout="vertical" size="small">
                    <Form.Item name="title" label="菜单名称">
                      <Input />
                    </Form.Item>
                    <Form.Item name="formId" label="绑定表单">
                      <Select
                        allowClear
                        options={forms.map((form) => ({ label: form.name, value: form.id }))}
                      />
                    </Form.Item>
                    <Form.Item name="visible" label="是否显示" valuePropName="checked">
                      <Switch />
                    </Form.Item>
                    <Form.Item name="defaultEntry" label="默认入口" valuePropName="checked">
                      <Switch />
                    </Form.Item>
                    <Space.Compact block>
                      <Button type="primary" icon={<SaveOutlined />} onClick={onSaveMenu}>
                        保存节点
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
                    </Space.Compact>
                    <Divider />
                    <Typography.Text type="secondary">
                      菜单节点负责导航展示。删除表单节点会移除当前菜单入口；删除分组会保留子节点并上移。
                    </Typography.Text>
                  </Form>
                ) : (
                  <Empty description="请选择菜单节点" />
                )}
              </Card>
        </Col>
      </Row>
    </div>
  );
}

function AppConfigForm({ form, roles }: { form: ReturnType<typeof Form.useForm>[0]; roles: RoleRecord[] }) {
  return (
    <Form form={form} layout="vertical">
      <Form.Item name="name" label="应用名称" rules={[{ required: true }]}>
        <Input />
      </Form.Item>
      <Form.Item name="code" label="应用编码" rules={[{ required: true }]}>
        <Input />
      </Form.Item>
      <Form.Item name="description" label="应用描述">
        <Input.TextArea rows={3} />
      </Form.Item>
      <Row gutter={12}>
        <Col span={12}>
          <Form.Item name="icon" label="应用图标">
            <Select options={Object.keys(iconMap).map((key) => ({ label: key, value: key }))} />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item name="status" label="应用状态">
            <Select
              options={[
                { label: '已发布', value: 'published' },
                { label: '草稿', value: 'draft' },
                { label: '停用', value: 'disabled' },
              ]}
            />
          </Form.Item>
        </Col>
      </Row>
      <Form.Item name="default_route" label="默认首页">
        <Input />
      </Form.Item>
      <Form.Item name="role_ids" label="谁能看这个应用">
        <Select
          mode="multiple"
          options={roles.map((role) => ({ label: `${role.label} / ${role.name}`, value: role.id }))}
        />
      </Form.Item>
      <Row gutter={12}>
        <Col span={12}>
          <Form.Item name="sort_order" label="排序">
            <Input type="number" />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item name="is_pinned" label="是否置顶" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Col>
      </Row>
    </Form>
  );
}

function FormConfigForm({ form }: { form: ReturnType<typeof Form.useForm>[0] }) {
  return (
    <Form form={form} layout="vertical">
      <Form.Item name="name" label="表单名称" rules={[{ required: true }]}>
        <Input />
      </Form.Item>
      <Form.Item name="code" label="表单编码" rules={[{ required: true }]}>
        <Input />
      </Form.Item>
      <Form.Item name="entity" label="绑定本体对象">
        <Input prefix={<NodeIndexOutlined />} />
      </Form.Item>
      <Form.Item name="source" label="数据来源">
        <Input />
      </Form.Item>
      <Form.Item name="description" label="表单描述">
        <Input.TextArea rows={3} />
      </Form.Item>
      <Row gutter={12}>
        <Col span={12}>
          <Form.Item name="owner" label="负责人">
            <Input />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item name="status" label="表单状态">
            <Select
              options={[
                { label: '已发布', value: 'published' },
                { label: '草稿', value: 'draft' },
                { label: '停用', value: 'disabled' },
              ]}
            />
          </Form.Item>
        </Col>
      </Row>
      <Form.Item name="fields" label="字段数量">
        <Input type="number" />
      </Form.Item>
    </Form>
  );
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

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="admin-info-block">
      <Typography.Text type="secondary">{label}</Typography.Text>
      <Typography.Text strong>{value}</Typography.Text>
    </div>
  );
}

function statusText(status: string) {
  if (status === 'published') return '已发布';
  if (status === 'draft') return '草稿';
  if (status === 'disabled') return '停用';
  return status;
}

function mergeOntologyForms(forms: FormRecord[], ontologyObjects: any[]) {
  const byCode = new Map(forms.map((item) => [item.entity, item]));
  ontologyObjects.forEach((item) => {
    if (byCode.has(item.code ?? item.id)) return;
    forms.push({
      id: `${item.code ?? item.id}-form`,
      name: `${item.name ?? item.label}表单`,
      code: `${item.code ?? item.id}-form`,
      entity: item.code ?? item.id,
      source: item.source ?? '-',
      status: 'draft',
      owner: '平台管理员',
      description: item.description ?? '由本体对象生成的表单。',
      fields: item.fields?.length ?? item.properties?.length ?? 0,
    });
  });
  return [...forms];
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
  return nodes.flatMap((node) => {
    if (node.key === key) return node.children ?? [];
    return [{ ...node, children: removeMenuNodePromoteChildren(node.children ?? [], key) }];
  });
}

function updateMenuNode(nodes: MenuNode[], key: string, values: any): MenuNode[] {
  return nodes.map((node) => {
    if (node.key === key) {
      return {
        ...node,
        title: <MenuTitle label={values.title} formId={values.formId} defaultEntry={values.defaultEntry} />,
        formId: values.formId,
        visible: values.visible,
        defaultEntry: values.defaultEntry,
      };
    }
    return { ...node, children: updateMenuNode(node.children ?? [], key, values) };
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
