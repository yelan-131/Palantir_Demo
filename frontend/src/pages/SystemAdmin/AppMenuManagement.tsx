import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  AppstoreAddOutlined,
  AppstoreOutlined,
  BarChartOutlined,
  BranchesOutlined,
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
  Divider,
  Drawer,
  Empty,
  Form,
  Input,
  List,
  Popconfirm,
  Row,
  Segmented,
  Select,
  Space,
  Switch,
  Table,
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
  createPlatformMenuNode,
  deletePlatformMenuNode,
  upsertApplicationFormBinding,
  listPlatformForms,
  listPlatformMenuNodes,
  listSemanticOntologyObjects,
  updatePlatformMenuNode,
  type PlatformForm,
  type PlatformMenuNode,
} from '@/services/api';
import {
  loadAssemblyMenus,
  type SavedAssemblyMenuNode,
} from '@/config/appAssemblyMenus';

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
  owner: string;
  description: string;
  fields: number;
};

type FieldRecord = {
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

type MetricRecord = {
  id: string;
  name: string;
  role: string;
  sourceField: string;
  aggregation: string;
  granularity: string;
  defaultFilter: string;
  chartRole: string;
  drilldown: string;
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
  dataScope?: string;
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

const interactionModeOptions = [
  { label: '录入表单', value: 'entry_form' },
  { label: '流程表单', value: 'workflow_form' },
  { label: '配置表单', value: 'settings_form' },
  { label: '详情编辑页', value: 'detail_editor' },
];

const analyticsModeOptions = [
  { label: '列表分析', value: 'list_analysis' },
  { label: 'BI 报表', value: 'bi_report' },
  { label: '指标看板', value: 'metric_dashboard' },
  { label: '驾驶舱', value: 'cockpit' },
];

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
    default_route: '/program/production-overview',
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
    default_route: '/program/device-health-dashboard',
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
    default_route: '/program/quality-overview',
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
    default_route: '/program/supply-overview',
    sort_order: 4,
    status: 'published',
    is_pinned: false,
    roles: [fallbackRoles[0], fallbackRoles[1]],
  },
];

const fallbackForms: FormRecord[] = [
  { id: "device-health", name: "\u4e1a\u52a1\u8868\u5355 1", code: "device-health", category: "interaction", mode: "detail_editor", structureLocked: true, entity: "Device", source: "equipment", status: "published", owner: "\u8bbe\u5907\u56e2\u961f", description: "\u7528\u4e8e\u4e1a\u52a1\u5f55\u5165\u548c\u8be6\u60c5\u7ef4\u62a4\u3002", fields: 8 },
  { id: "device-health-dashboard", name: "\u8bbe\u5907\u5065\u5eb7\u770b\u677f", code: "device-health-dashboard", category: "analytics", mode: "metric_dashboard", structureLocked: true, entity: "DeviceHealthDashboard", source: "equipment_health_summary", status: "published", owner: "\u8bbe\u5907\u56e2\u961f", description: "\u7528\u4e8e\u8bbe\u5907\u5065\u5eb7\u5ea6\u3001\u98ce\u9669\u5206\u5e03\u548c\u4fdd\u517b\u5efa\u8bae\u7684\u770b\u677f\u5c55\u793a\u3002", fields: 8 },
  { id: "fault-prediction", name: "\u5206\u6790\u62a5\u8868 1", code: "fault-prediction", category: "analytics", mode: "bi_report", structureLocked: true, entity: "Device", source: "equipment_health", status: "published", owner: "\u7b97\u6cd5\u56e2\u961f", description: "\u7528\u4e8e\u6307\u6807\u3001\u8d8b\u52bf\u548c\u62a5\u8868\u5206\u6790\u3002", fields: 10 },
  { id: "failure-trend-analysis", name: "\u6545\u969c\u8d8b\u52bf\u5206\u6790", code: "failure-trend-analysis", category: "analytics", mode: "bi_report", structureLocked: true, entity: "FailureTrend", source: "maintenance_failures", status: "published", owner: "\u7ef4\u62a4\u56e2\u961f", description: "\u7528\u4e8e\u6545\u969c\u6b21\u6570\u3001\u4e3b\u8981\u7c7b\u578b\u548c\u8d8b\u52bf\u5206\u6790\u3002", fields: 9 },
  { id: "maintenance-order", name: "\u6d41\u7a0b\u8868\u5355 1", code: "maintenance-order", category: "interaction", mode: "workflow_form", structureLocked: true, entity: "WorkOrder", source: "work_orders", status: "published", owner: "\u7ef4\u62a4\u56e2\u961f", description: "\u7528\u4e8e\u5de5\u5355\u6d41\u8f6c\u548c\u4e1a\u52a1\u5904\u7406\u3002", fields: 12 },
  { id: "alert-center", name: "\u4e1a\u52a1\u8868\u5355 2", code: "alert-center", category: "interaction", mode: "entry_form", structureLocked: true, entity: "Alert", source: "alerts", status: "published", owner: "\u5e73\u53f0\u56e2\u961f", description: "\u7528\u4e8e\u4e1a\u52a1\u5f55\u5165\u548c\u5904\u7406\u3002", fields: 7 },
  { id: "supplier-risk", name: "\u6d41\u7a0b\u8868\u5355 2", code: "supplier-risk", category: "interaction", mode: "workflow_form", structureLocked: true, entity: "Supplier", source: "suppliers", status: "published", owner: "\u4f9b\u5e94\u94fe\u56e2\u961f", description: "\u7528\u4e8e\u98ce\u9669\u590d\u6838\u548c\u4e1a\u52a1\u6d41\u7a0b\u3002", fields: 9 },
  { id: "quality-event", name: "\u6d41\u7a0b\u8868\u5355 3", code: "quality-event", category: "interaction", mode: "workflow_form", structureLocked: true, entity: "QualityEvent", source: "defects", status: "draft", owner: "\u8d28\u91cf\u56e2\u961f", description: "\u7528\u4e8e\u8d28\u91cf\u590d\u6838\u548c\u95ee\u9898\u6539\u8fdb\u3002", fields: 11 },
];

const supplementalForms: FormRecord[] = [
  { id: "production-overview", name: "\u6307\u6807\u770b\u677f 1", code: "production-overview", category: "analytics", mode: "metric_dashboard", structureLocked: true, entity: "ProductionOverview", source: "dashboard_summary", status: "published", owner: "\u751f\u4ea7\u56e2\u961f", description: "\u7528\u4e8e\u6307\u6807\u76d1\u63a7\u548c\u770b\u677f\u5c55\u793a\u3002", fields: 10 },
  { id: "oee-trend-report", name: "OEE \u8d8b\u52bf\u62a5\u8868", code: "oee-trend-report", category: "analytics", mode: "bi_report", structureLocked: true, entity: "OeeTrend", source: "oee_daily", status: "published", owner: "\u751f\u4ea7\u56e2\u961f", description: "\u7528\u4e8e OEE \u8d8b\u52bf\u3001\u8fbe\u6210\u7387\u548c\u4ea7\u7ebf\u5bf9\u6bd4\u5206\u6790\u3002", fields: 8 },
  { id: "line-status", name: "\u5217\u8868\u5206\u6790 1", code: "line-status", category: "analytics", mode: "list_analysis", structureLocked: true, entity: "ProductionLine", source: "production_lines", status: "published", owner: "\u751f\u4ea7\u56e2\u961f", description: "\u7528\u4e8e\u5217\u8868\u67e5\u8be2\u548c\u7ef4\u5ea6\u5206\u6790\u3002", fields: 9 },
  { id: "line-load-analysis", name: "\u4ea7\u7ebf\u8d1f\u8377\u5206\u6790", code: "line-load-analysis", category: "analytics", mode: "list_analysis", structureLocked: true, entity: "LineLoad", source: "line_load_snapshots", status: "published", owner: "\u751f\u4ea7\u56e2\u961f", description: "\u7528\u4e8e\u4ea7\u7ebf\u8d1f\u8377\u3001\u74f6\u9888\u548c\u73ed\u6b21\u5bf9\u6bd4\u3002", fields: 9 },
  { id: "production-plan-entry", name: "\u751f\u4ea7\u8ba1\u5212\u586b\u62a5", code: "production-plan-entry", category: "interaction", mode: "entry_form", structureLocked: true, entity: "ProductionPlan", source: "production_plans", status: "published", owner: "\u751f\u4ea7\u56e2\u961f", description: "\u7528\u4e8e\u751f\u4ea7\u8ba1\u5212\u7684\u5f55\u5165\u3001\u8c03\u6574\u548c\u786e\u8ba4\u3002", fields: 11 },
  { id: "quality-overview", name: "\u6307\u6807\u770b\u677f 2", code: "quality-overview", category: "analytics", mode: "metric_dashboard", structureLocked: true, entity: "QualityOverview", source: "quality_metrics", status: "published", owner: "\u8d28\u91cf\u56e2\u961f", description: "\u7528\u4e8e\u6307\u6807\u76d1\u63a7\u548c\u770b\u677f\u5c55\u793a\u3002", fields: 8 },
  { id: "inspection-batch", name: "\u4e1a\u52a1\u8868\u5355 3", code: "inspection-batch", category: "interaction", mode: "entry_form", structureLocked: true, entity: "Inspection", source: "inspections", status: "published", owner: "\u8d28\u91cf\u56e2\u961f", description: "\u7528\u4e8e\u4e1a\u52a1\u5f55\u5165\u548c\u7ed3\u679c\u8ffd\u8e2a\u3002", fields: 12 },
  { id: "defect-analysis", name: "\u5206\u6790\u62a5\u8868 2", code: "defect-analysis", category: "analytics", mode: "bi_report", structureLocked: true, entity: "Defect", source: "defects", status: "published", owner: "\u8d28\u91cf\u56e2\u961f", description: "\u7528\u4e8e\u6307\u6807\u3001\u8d8b\u52bf\u548c\u62a5\u8868\u5206\u6790\u3002", fields: 11 },
  { id: "defect-analysis-report", name: "\u7f3a\u9677\u5206\u6790\u62a5\u8868", code: "defect-analysis-report", category: "analytics", mode: "bi_report", structureLocked: true, entity: "DefectReport", source: "defect_reports", status: "published", owner: "\u8d28\u91cf\u56e2\u961f", description: "\u7528\u4e8e\u7f3a\u9677 Pareto\u3001\u8d23\u4efb\u5de5\u4f4d\u548c\u6539\u5584\u6548\u679c\u5206\u6790\u3002", fields: 10 },
  { id: "process-capability-dashboard", name: "\u8fc7\u7a0b\u80fd\u529b\u770b\u677f", code: "process-capability-dashboard", category: "analytics", mode: "metric_dashboard", structureLocked: true, entity: "ProcessCapability", source: "spc_capability", status: "published", owner: "\u8d28\u91cf\u56e2\u961f", description: "\u7528\u4e8e CPK\u3001PPK\u3001\u8fc7\u7a0b\u7a33\u5b9a\u6027\u548c\u8d85\u9650\u5206\u6790\u3002", fields: 8 },
  { id: "supply-overview", name: "\u6307\u6807\u770b\u677f 3", code: "supply-overview", category: "analytics", mode: "metric_dashboard", structureLocked: true, entity: "SupplyOverview", source: "supply_summary", status: "published", owner: "\u4f9b\u5e94\u94fe\u56e2\u961f", description: "\u7528\u4e8e\u6307\u6807\u76d1\u63a7\u548c\u770b\u677f\u5c55\u793a\u3002", fields: 8 },
  { id: "material-impact", name: "\u5206\u6790\u62a5\u8868 3", code: "material-impact", category: "analytics", mode: "bi_report", structureLocked: true, entity: "Material", source: "materials", status: "published", owner: "\u4f9b\u5e94\u94fe\u56e2\u961f", description: "\u7528\u4e8e\u6307\u6807\u3001\u8d8b\u52bf\u548c\u62a5\u8868\u5206\u6790\u3002", fields: 10 },
  { id: "material-impact-report", name: "\u7269\u6599\u5f71\u54cd\u62a5\u8868", code: "material-impact-report", category: "analytics", mode: "bi_report", structureLocked: true, entity: "MaterialImpactReport", source: "material_shortage_impacts", status: "published", owner: "\u4f9b\u5e94\u94fe\u56e2\u961f", description: "\u7528\u4e8e\u7f3a\u6599\u5bf9\u4ea7\u7ebf\u3001\u5de5\u5355\u548c\u5ba2\u6237\u8ba2\u5355\u7684\u5f71\u54cd\u5206\u6790\u3002", fields: 10 },
  { id: "supply-risk-dashboard", name: "\u4f9b\u5e94\u98ce\u9669\u770b\u677f", code: "supply-risk-dashboard", category: "analytics", mode: "metric_dashboard", structureLocked: true, entity: "SupplyRiskDashboard", source: "supply_risk_summary", status: "published", owner: "\u4f9b\u5e94\u94fe\u56e2\u961f", description: "\u7528\u4e8e\u4f9b\u5e94\u98ce\u9669\u6307\u6807\u3001\u9ad8\u98ce\u9669\u54c1\u7c7b\u548c\u66ff\u4ee3\u65b9\u6848\u770b\u677f\u5c55\u793a\u3002", fields: 8 },
  { id: "risk-review", name: "\u6d41\u7a0b\u8868\u5355 4", code: "risk-review", category: "interaction", mode: "workflow_form", structureLocked: true, entity: "RiskReview", source: "risk_reviews", status: "draft", owner: "\u4f9b\u5e94\u94fe\u56e2\u961f", description: "\u7528\u4e8e\u98ce\u9669\u590d\u6838\u548c\u4e1a\u52a1\u6d41\u7a0b\u3002", fields: 9 },
  { id: "customer-complaint", name: "\u6d41\u7a0b\u8868\u5355 5", code: "customer-complaint", category: "interaction", mode: "workflow_form", structureLocked: true, entity: "CustomerComplaint", source: "customer_complaints", status: "draft", owner: "\u8d28\u91cf\u56e2\u961f", description: "\u7528\u4e8e\u5ba2\u6237\u6295\u8bc9\u548c\u95ee\u9898\u6539\u8fdb\u6d41\u7a0b\u3002", fields: 13 },
  { id: "change-request", name: "\u6d41\u7a0b\u8868\u5355 6", code: "change-request", category: "interaction", mode: "workflow_form", structureLocked: true, entity: "EngineeringChange", source: "engineering_changes", status: "draft", owner: "\u5de5\u7a0b\u56e2\u961f", description: "\u7528\u4e8e\u53d8\u66f4\u7533\u8bf7\u548c\u5ba1\u6279\u6d41\u7a0b\u3002", fields: 14 },
];

const initialConfigs: AppFormConfig[] = [
  { appId: 2, formId: 'device-health', alias: '设备健康总览', enabled: true, defaultView: '列表 + 详情', dataScope: 'health_score < 95', allowCreate: false, allowEdit: true, allowExport: true },
  { appId: 2, formId: 'device-health-dashboard', alias: '设备健康看板', enabled: true, defaultView: '健康 KPI + 风险排行', dataScope: 'current_factory', allowCreate: false, allowEdit: false, allowExport: true },
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
    menuNode("prod-monitoring", "\u751f\u4ea7\u76d1\u63a7", undefined, [
      menuNode("prod-overview", "\u751f\u4ea7\u603b\u89c8\u770b\u677f", "production-overview", undefined, true),
      menuNode("prod-lines", "\u4ea7\u7ebf\u72b6\u6001\u62a5\u8868", "line-status"),
      menuNode("prod-device", "\u8bbe\u5907\u8fd0\u884c", "device-health"),
    ], true),
    menuNode("prod-reports", "\u751f\u4ea7\u62a5\u8868", undefined, [
      menuNode("prod-oee-report", "OEE \u8d8b\u52bf\u62a5\u8868", "oee-trend-report"),
      menuNode("prod-line-report", "\u4ea7\u7ebf\u8d1f\u8377\u5206\u6790", "line-load-analysis"),
      menuNode("prod-plan-entry", "\u751f\u4ea7\u8ba1\u5212\u586b\u62a5", "production-plan-entry"),
    ]),
    menuNode("prod-exceptions", "\u5f02\u5e38\u5904\u7406", undefined, [
      menuNode("prod-alerts", "\u6d3b\u52a8\u544a\u8b66", "alert-center"),
    ]),
  ],
  2: [
    menuNode("pm-health-group", "\u5065\u5eb7\u4e0e\u9884\u6d4b", undefined, [
      menuNode("pm-health", "\u8bbe\u5907\u5065\u5eb7", "device-health", undefined, true),
      menuNode("pm-predict", "\u6545\u969c\u9884\u6d4b\u62a5\u8868", "fault-prediction"),
    ], true),
    menuNode("pm-report-group", "\u7ef4\u62a4\u62a5\u8868", undefined, [
      menuNode("pm-failure-trend", "\u6545\u969c\u8d8b\u52bf\u5206\u6790", "failure-trend-analysis"),
      menuNode("pm-health-dashboard", "\u8bbe\u5907\u5065\u5eb7\u770b\u677f", "device-health-dashboard"),
    ]),
    menuNode("pm-execution-group", "\u7ef4\u62a4\u6267\u884c", undefined, [
      menuNode("pm-orders", "\u7ef4\u4fee\u5de5\u5355", "maintenance-order"),
      menuNode("pm-alerts", "\u544a\u8b66\u4e2d\u5fc3", "alert-center"),
    ]),
  ],
  3: [
    menuNode("quality-control-group", "\u8d28\u91cf\u76d1\u63a7", undefined, [
      menuNode("quality-overview", "\u8d28\u91cf\u603b\u89c8\u770b\u677f", "quality-overview", undefined, true),
      menuNode("quality-inspection", "\u68c0\u9a8c\u6279\u6b21", "inspection-batch"),
    ], true),
    menuNode("quality-report-group", "\u8d28\u91cf\u62a5\u8868", undefined, [
      menuNode("quality-defect-report", "\u7f3a\u9677\u5206\u6790\u62a5\u8868", "defect-analysis-report"),
      menuNode("quality-capability-report", "\u8fc7\u7a0b\u80fd\u529b\u770b\u677f", "process-capability-dashboard"),
    ]),
    menuNode("quality-improve-group", "\u95ee\u9898\u6539\u8fdb", undefined, [
      menuNode("quality-defect", "\u7f3a\u9677\u5206\u6790", "defect-analysis"),
      menuNode("quality-capa", "CAPA \u8ddf\u8e2a", "quality-event"),
    ]),
  ],
  4: [
    menuNode("supply-risk-group", "\u98ce\u9669\u76d1\u63a7", undefined, [
      menuNode("supply-overview", "\u98ce\u9669\u603b\u89c8\u770b\u677f", "supply-overview", undefined, true),
      menuNode("supply-risk", "\u4f9b\u5e94\u5546\u98ce\u9669", "supplier-risk"),
    ], true),
    menuNode("supply-report-group", "\u4f9b\u5e94\u94fe\u62a5\u8868", undefined, [
      menuNode("supply-material-report", "\u7269\u6599\u5f71\u54cd\u62a5\u8868", "material-impact-report"),
      menuNode("supply-risk-dashboard", "\u4f9b\u5e94\u98ce\u9669\u770b\u677f", "supply-risk-dashboard"),
    ]),
    menuNode("supply-impact-group", "\u5f71\u54cd\u4e0e\u590d\u6838", undefined, [
      menuNode("supply-material", "\u7269\u6599\u5f71\u54cd", "material-impact"),
      menuNode("supply-review", "\u98ce\u9669\u590d\u6838", "risk-review"),
    ]),
  ],
};

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
  dataScope = 'current_app',
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
    dataScope,
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
      const actions = Array.isArray(source.actions) && source.actions.length
        ? source.actions.map((action) => String(action)).filter(Boolean)
        : ['view'];
      return { subjectType, roleIds, userKeys, actions, effect };
    })
    .filter(Boolean) as PermissionRule[];
  return rules.length ? rules : defaultPermissionRules();
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
    dataScope: node.dataScope,
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
      node.dataScope ?? 'current_app',
    ),
    visible: node.visible ?? true,
    routePath: node.routePath,
    permissionMode: node.permissionMode ?? 'inherit',
    roleIds: node.roleIds ?? [],
    permissionActions: node.permissionActions ?? ['view'],
    permissionRules: normalizePermissionRules(node.permissionRules),
    dataScope: node.dataScope ?? 'current_app',
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

function mapPlatformFormToRecord(form: PlatformForm): FormRecord {
  return {
    id: String(form.id),
    name: form.name,
    code: form.code,
    category: 'interaction',
    mode: 'entry_form',
    structureLocked: form.status !== 'draft',
    entity: form.code,
    source: form.table_name || 'dynamic_records',
    status: form.status === 'active' ? 'published' : form.status === 'archived' ? 'disabled' : 'draft',
    owner: form.owner_id ? String(form.owner_id) : 'system',
    description: form.description || 'Database-backed platform form.',
    fields: form.fields?.length ?? 0,
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
      const permissionActions = Array.isArray(node.config?.permission_actions)
        ? node.config.permission_actions.map((action) => String(action))
        : ['view'];
      const permissionRules = normalizePermissionRules(
        node.config?.permission_rules ?? (
          permissionMode === 'custom'
            ? [{ subjectType: 'roles', roleIds, actions: permissionActions, effect: 'allow' }]
            : [{ subjectType: 'app_roles', actions: permissionActions, effect: 'allow' }]
        ),
      );
      const dataScope = typeof node.config?.data_scope === 'string' ? node.config.data_scope : 'current_app';

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
          dataScope,
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
        dataScope,
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
  const [menuSyncing, setMenuSyncing] = useState(false);

  useEffect(() => {
    const stored = loadAssemblyMenus();
    if (!Object.keys(stored).length) return;
    setMenusByApp((prev) => {
      const restored = Object.fromEntries(
        Object.entries(stored).map(([appId, nodes]) => [Number(appId), restoreMenuNodes(nodes)]),
      );
      return { ...prev, ...restored };
    });
  }, []);

  const selectedApp = applications.find((item) => item.id === selectedAppId) ?? applications[0];
  const selectedForm = forms.find((item) => item.id === selectedFormId) ?? forms[0];
  const appConfigs = configs.filter((item) => item.appId === selectedApp.id);
  const currentMenus = menusByApp[selectedApp.id] ?? [];
  const selectedMenu = findMenuNode(currentMenus, selectedMenuKey);

  useEffect(() => {
    Promise.all([adminListApplications(), adminListRoles(), listSemanticOntologyObjects(), listPlatformForms()])
      .then(([appsRes, rolesRes, objectsRes, formsRes]) => {
        const apiApps = appsRes.data?.data ?? [];
        const apiRoles = rolesRes.data?.data ?? [];
        const ontologyObjects = objectsRes.data?.data ?? [];
        const platformForms = unwrapApiList<PlatformForm>(formsRes);
        if (apiApps.length) setApplications(apiApps);
        if (apiRoles.length) setRoles(apiRoles);
        if (platformForms.length) {
          const mappedPlatformForms = platformForms.map(mapPlatformFormToRecord);
          setForms((prev) => mergeFormRecords(prev, mappedPlatformForms));
          setSelectedFormId(String(platformForms[0].id));
        }
        if (ontologyObjects.length) {
          setForms((prev) => mergeOntologyForms(prev, ontologyObjects));
        }
      })
      .catch(() => {
        // Demo data is intentionally enough for this first product pass.
      });
  }, []);

  useEffect(() => {
    if (!selectedAppId) return;
    setMenuSyncing(true);
    listPlatformMenuNodes(selectedAppId)
      .then((res) => {
        const menuNodes = unwrapApiList<PlatformMenuNode>(res);
        if (!menuNodes.length) return;
        const tree = mapPlatformMenuNodesToTree(menuNodes);
        setMenusByApp((prev) => ({ ...prev, [selectedAppId]: tree }));
        setConfigs((prev) => {
          const next = prev.filter((item) => item.appId !== selectedAppId);
          collectMenuFormIds(tree).forEach((formId) => {
            const form = forms.find((item) => item.id === formId);
            next.push({
              appId: selectedAppId,
              formId,
              alias: form?.name ?? formId,
              enabled: true,
              defaultView: 'list',
              dataScope: 'current_app',
              allowCreate: true,
              allowEdit: true,
              allowExport: true,
            });
          });
          return next;
        });
        setSelectedMenuKey(tree[0]?.key ?? '');
      })
      .catch(() => {
        const stored = loadAssemblyMenus();
        const fallback = stored[selectedAppId];
        if (fallback?.length) {
          setMenusByApp((prev) => ({ ...prev, [selectedAppId]: restoreMenuNodes(fallback) }));
        }
      })
      .finally(() => setMenuSyncing(false));
  }, [forms, selectedAppId]);

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
    formForm.setFieldsValue({
      category: 'interaction',
      mode: 'entry_form',
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
      permissionActions: selectedMenu?.permissionActions ?? ['view'],
      permissionRules: selectedMenu?.permissionRules ?? defaultPermissionRules(),
      dataScope: selectedMenu?.dataScope ?? 'current_app',
    });
  }, [forms, menuForm, selectedMenu]);

  const boundFormIds = new Set(collectMenuFormIds(currentMenus));

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
  };

  const saveForm = async () => {
    const values = await formForm.validateFields();
    setForms((prev) => prev.map((item) => (item.id === selectedForm.id ? { ...item, ...values, structureLocked: true } : item)));
    formForm.setFieldValue('structureLocked', true);
    message.success('\u8868\u5355\u914d\u7f6e\u5df2\u4fdd\u5b58\uff0c\u7c7b\u578b\u3001\u6a21\u5f0f\u3001\u7f16\u7801\u548c\u6570\u636e\u6765\u6e90\u5df2\u9501\u5b9a');
  };

  const createDraftApp = () => {
    const nextId = Math.max(...applications.map((app) => app.id), 0) + 1;
    const nextApp: AppRecord = {
      id: nextId,
      name: '新建应用',
      code: `app-${nextId}`,
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
    message.success('已创建应用草稿');
  };

  const updateSelectedAppStatus = (status: string) => {
    setApplications((prev) => prev.map((item) => (item.id === selectedApp.id ? { ...item, status } : item)));
    appForm.setFieldValue('status', status);
  };

  const publishSelectedApp = async () => {
    await saveApp();
    updateSelectedAppStatus('published');
    message.success('应用已发布');
  };

  const disableSelectedApp = () => {
    updateSelectedAppStatus('disabled');
    message.success('应用已停用，配置仍已保留');
  };

  const enableSelectedApp = () => {
    updateSelectedAppStatus('published');
    message.success('应用已启用');
  };

  const deleteSelectedDraftApp = () => {
    if (selectedApp.status !== 'draft') {
      message.warning('已发布或停用的应用不能直接删除，请先停用或归档');
      return;
    }
    const nextApps = applications.filter((item) => item.id !== selectedApp.id);
    setApplications(nextApps);
    setSelectedAppId(nextApps[0]?.id ?? 0);
    message.success('应用草稿已删除');
  };

  const copySelectedAppAsDraft = () => {
    const nextId = Math.max(...applications.map((app) => app.id), 0) + 1;
    const nextApp: AppRecord = {
      ...selectedApp,
      id: nextId,
      name: `${selectedApp.name} Copy`,
      code: `${selectedApp.code}-copy-${nextId}`,
      status: 'draft',
      is_pinned: false,
    };
    setApplications((prev) => [...prev, nextApp]);
    setSelectedAppId(nextId);
    message.success('已复制为新草稿');
  };

  const createDraftForm = () => {
    const nextId = `form-${Date.now()}`;
    const nextForm: FormRecord = {
      id: nextId,
      name: '\u65b0\u5efa\u4e1a\u52a1\u8868\u5355',
      code: nextId,
      category: 'interaction',
      mode: 'entry_form',
      structureLocked: false,
      entity: 'NewEntity',
      source: 'generated_table',
      status: 'draft',
      owner: '\u7cfb\u7edf\u7ba1\u7406\u5458',
      description: '\u7528\u4e8e\u5f55\u5165\u3001\u7f16\u8f91\u3001\u5ba1\u6279\u548c\u914d\u7f6e\u4e1a\u52a1\u6570\u636e\u7684\u8349\u7a3f\u3002',
      fields: 0,
    };
    setForms((prev) => [nextForm, ...prev]);
    setSelectedFormId(nextId);
    formForm.setFieldsValue(nextForm);
    message.success('\u5df2\u521b\u5efa\u8868\u5355\u8349\u7a3f\uff0c\u53ef\u5728\u7c7b\u578b\u5b57\u6bb5\u4e2d\u9009\u62e9\u4e1a\u52a1\u4ea4\u4e92\u7c7b\u6216\u5206\u6790\u5c55\u793a\u7c7b');
  };

  const updateSelectedFormStatus = (status: FormRecord['status']) => {
    setForms((prev) => prev.map((item) => (item.id === selectedForm.id ? { ...item, status } : item)));
    formForm.setFieldValue('status', status);
  };

  const publishSelectedForm = async () => {
    await saveForm();
    if ((selectedForm.category ?? 'interaction') === 'interaction' && (selectedForm.fields ?? 0) <= 0) {
      message.warning('表单需要至少一个字段才能发布');
      return;
    }
    updateSelectedFormStatus('published');
    message.success('表单已发布，数据库结构影响已记录');
  };

  const disableSelectedForm = () => {
    updateSelectedFormStatus('disabled');
    message.success('表单已停用，历史数据保留');
  };

  const enableSelectedForm = () => {
    updateSelectedFormStatus('published');
    message.success('表单已启用');
  };

  const deleteSelectedDraftForm = () => {
    if (selectedForm.status !== 'draft') {
      message.warning('已发布或停用的表单不能直接删除');
      return;
    }
    if (configs.some((item) => item.formId === selectedForm.id)) {
      message.warning('该表单已被菜单管理使用，请先解除绑定');
      return;
    }
    const nextForms = forms.filter((item) => item.id !== selectedForm.id);
    setForms(nextForms);
    setSelectedFormId(nextForms[0]?.id ?? '');
    message.success('表单草稿已删除');
  };

  const copySelectedFormAsDraft = () => {
    const nextId = `${selectedForm.id}-copy-${Date.now()}`;
    const nextForm: FormRecord = {
      ...selectedForm,
      id: nextId,
      name: `${selectedForm.name} Copy`,
      code: nextId,
      status: 'draft',
    };
    setForms((prev) => [nextForm, ...prev]);
    setSelectedFormId(nextId);
    message.success('已复制表单为新草稿');
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

  const addFormToMenu = async (form: FormRecord) => {
    const existingNode = findMenuNodeByForm(currentMenus, form.id);
    if (existingNode) {
      setSelectedMenuKey(existingNode.key);
      if (!boundFormIds.has(form.id)) toggleBinding(form.id);
      return;
    }
    const numericFormId = Number(form.id);
    if (Number.isNaN(numericFormId)) {
      message.warning('Only database-backed forms can be added to database menus.');
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
          route_path: values.routePath,
          node_type: numericFormId ? 'form' : 'group',
          visible: values.visible,
          default_entry: values.defaultEntry,
          config: {
            ...(selectedMenu.config ?? {}),
            permission_mode: values.permissionMode ?? 'inherit',
            role_ids: values.permissionMode === 'custom' ? values.roleIds ?? [] : [],
            permission_actions: values.permissionActions ?? ['view'],
            permission_rules: normalizePermissionRules(values.permissionRules),
            data_scope: values.dataScope ?? 'current_app',
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
      [selectedApp.id]: updateMenuNode(prev[selectedApp.id] ?? [], selectedMenuKey, values),
    }));
    message.success('菜单节点已更新');
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

  return (
    <div className="app-admin-workspace" aria-busy={menuSyncing}>
      <Tabs
        defaultActiveKey="assembly"
        items={[
          {
            key: 'apps',
            label: '应用管理',
            children: (
              <AppManagementPanel
                apps={applications}
                roles={roles}
                selectedAppId={selectedApp.id}
                onSelect={setSelectedAppId}
                form={appForm}
                onCreate={createDraftApp}
                onSave={saveApp}
                onPublish={publishSelectedApp}
                onDisable={disableSelectedApp}
                onEnable={enableSelectedApp}
                onDeleteDraft={deleteSelectedDraftApp}
                onCopyDraft={copySelectedAppAsDraft}
              />
            ),
          },
          {
            key: 'forms',
            label: '表单管理',
            children: (
              <FormManagementPanel
                forms={forms}
                selectedFormId={selectedForm.id}
                onSelect={setSelectedFormId}
                form={formForm}
                onCreate={createDraftForm}
                onSave={saveForm}
                onPublish={publishSelectedForm}
                onDisable={disableSelectedForm}
                onEnable={enableSelectedForm}
                onDeleteDraft={deleteSelectedDraftForm}
                onCopyDraft={copySelectedFormAsDraft}
              />
            ),
          },
          {
            key: 'assembly',
            label: '菜单管理',
            children: (
              <AssemblyWorkspace
                apps={applications}
                roles={roles}
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
        destroyOnClose
        onClose={() => setAppDrawerOpen(false)}
        extra={<Button type="primary" icon={<SaveOutlined />} onClick={saveApp}>保存</Button>}
      >
        <AppConfigForm form={appForm} roles={roles} />
      </Drawer>

      <Drawer
        title="表单配置"
        open={formDrawerOpen}
        width={560}
        destroyOnClose
        onClose={() => setFormDrawerOpen(false)}
        extra={<Button type="primary" icon={<SaveOutlined />} onClick={saveForm}>保存</Button>}
      >
        <FormConfigForm form={formForm} />
      </Drawer>
    </div>
  );
}

function AppManagementPanel({
  apps,
  roles,
  selectedAppId,
  onSelect,
  form,
  onCreate,
  onSave,
  onPublish,
  onDisable,
  onEnable,
  onDeleteDraft,
  onCopyDraft,
}: {
  apps: AppRecord[];
  roles: RoleRecord[];
  selectedAppId: number;
  onSelect: (id: number) => void;
  form: ReturnType<typeof Form.useForm>[0];
  onCreate: () => void;
  onSave: () => void;
  onPublish: () => void;
  onDisable: () => void;
  onEnable: () => void;
  onDeleteDraft: () => void;
  onCopyDraft: () => void;
}) {
  const selected = apps.find((item) => item.id === selectedAppId) ?? apps[0];
  const status = Form.useWatch('status', form) ?? selected?.status;
  const watchedIcon = Form.useWatch('icon', form) ?? selected?.icon;
  const watchedName = Form.useWatch('name', form) ?? selected?.name;
  const watchedDescription = Form.useWatch('description', form) ?? selected?.description;

  return (
    <Row gutter={[16, 16]} className="config-management-grid">
      <Col xs={24} lg={6} xl={5}>
        <Card
          title="应用列表"
          className="config-list-card"
          extra={<Button size="small" icon={<PlusOutlined />} onClick={onCreate}>新增</Button>}
        >
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
                  <Space size={4} wrap>
                    <Tag color={statusColor(app.status)}>{statusText(app.status)}</Tag>
                    {app.is_pinned && <Tag color="processing">置顶</Tag>}
                  </Space>
                </div>
              </List.Item>
            )}
          />
        </Card>
      </Col>
      <Col xs={24} lg={18} xl={19}>
        <Space direction="vertical" size={16} className="config-editor-stack">
          <Card
            className="config-editor-card"
            {...{
              title: (
                <div className="config-editor-title">
                  <span>{watchedName || selected?.name || '-'}</span>
                  <small>{statusText(status)} · {watchedDescription || selected?.code || '-'}</small>
                </div>
              ),
            }}
            extra={(
              <LifecycleActions
                status={status}
                onSave={onSave}
                onPublish={onPublish}
                onDisable={onDisable}
                onEnable={onEnable}
                onDeleteDraft={onDeleteDraft}
                onCopyDraft={onCopyDraft}
              />
            )}
          >
            <div className="config-preview-strip">
              <span className="config-preview-icon">{renderIcon(watchedIcon)}</span>
              <div>
                <Typography.Text strong>{watchedName || '-'}</Typography.Text>
                <Typography.Text type="secondary">{watchedDescription || '暂无描述'}</Typography.Text>
              </div>
              <Tag color={statusColor(status)}>{statusText(status)}</Tag>
            </div>
            <AppConfigForm form={form} roles={roles} />
          </Card>

          <Card className="config-editor-card" title="访问与入口">
            <Row gutter={[12, 12]}>
              <Col xs={24} md={12}>
                <InfoBlock label="默认路由" value={selected?.default_route ?? '-'} />
              </Col>
              <Col xs={24} md={12}>
                <InfoBlock label="可见角色" value={(selected?.roles ?? roles).map((role) => role.label).join(' / ') || '未配置'} />
              </Col>
              <Col xs={24} md={12}>
                <InfoBlock label="排序" value={`${selected?.sort_order ?? 0}`} />
              </Col>
              <Col xs={24} md={12}>
                <InfoBlock label="应用范围" value="当前租户 / 工厂范围后续扩展" />
              </Col>
            </Row>
          </Card>
        </Space>
      </Col>
    </Row>
  );
}

function FormManagementPanel({
  forms,
  selectedFormId,
  onSelect,
  form,
  onCreate,
  onSave,
  onPublish,
  onDisable,
  onEnable,
  onDeleteDraft,
  onCopyDraft,
}: {
  forms: FormRecord[];
  selectedFormId: string;
  onSelect: (id: string) => void;
  form: ReturnType<typeof Form.useForm>[0];
  onCreate: () => void;
  onSave: () => void;
  onPublish: () => void;
  onDisable: () => void;
  onEnable: () => void;
  onDeleteDraft: () => void;
  onCopyDraft: () => void;
}) {
  const selected = forms.find((item) => item.id === selectedFormId) ?? forms[0];
  const status = Form.useWatch('status', form) ?? selected?.status;
  const watchedName = Form.useWatch('name', form) ?? selected?.name;
  const watchedEntity = Form.useWatch('entity', form) ?? selected?.entity;
  const watchedSource = Form.useWatch('source', form) ?? selected?.source;
  const category = Form.useWatch('category', form) ?? selected?.category ?? 'interaction';
  const isAnalytics = category === 'analytics';
  const fields = useMemo(() => buildFieldRows(selected), [selected]);
  const metrics = useMemo(() => buildMetricRows(selected), [selected]);

  return (
    <Row gutter={[16, 16]} className="config-management-grid">
      <Col xs={24} lg={6} xl={5}>
        <Card
          title="表单列表"
          className="config-list-card"
          extra={<Button size="small" icon={<PlusOutlined />} onClick={onCreate}>新增</Button>}
        >
          <List
            dataSource={forms}
            renderItem={(item) => (
              <List.Item
                className={`admin-app-list-item ${item.id === selectedFormId ? 'active' : ''}`}
                onClick={() => onSelect(item.id)}
              >
                <span className="application-icon"><FormOutlined /></span>
                <div>
                  <strong>{item.name}</strong>
                </div>
              </List.Item>
            )}
          />
        </Card>
      </Col>
      <Col xs={24} lg={18} xl={19}>
        <Space direction="vertical" size={16} className="config-editor-stack">
          <Card
            className="config-editor-card"
            title={(
              <div className="config-editor-title">
                <span>{watchedName || selected?.name || '-'}</span>
                <small>{statusText(status)} {'\u00b7'} {isAnalytics ? '\u5206\u6790\u5c55\u793a\u7c7b' : '\u4e1a\u52a1\u4ea4\u4e92\u7c7b'} {'\u00b7'} {watchedEntity || selected?.entity || '-'} / {watchedSource || selected?.source || '-'}</small>
              </div>
            )}
            extra={(
              <LifecycleActions
                status={status}
                onSave={onSave}
                onPublish={onPublish}
                onDisable={onDisable}
                onEnable={onEnable}
                onDeleteDraft={onDeleteDraft}
                onCopyDraft={onCopyDraft}
              />
            )}
          >
            <FormConfigForm form={form} />
          </Card>

          <Card
            className="config-editor-card"
            title={isAnalytics ? '数据集与指标' : '字段结构'}
            extra={(
              <Space>
                <Button size="small" icon={<BranchesOutlined />}>{isAnalytics ? '选择数据源' : '同步字段'}</Button>
                <Button size="small" icon={<PlusOutlined />}>{isAnalytics ? '新增指标' : '新增字段'}</Button>
                <Button size="small" icon={isAnalytics ? <BarChartOutlined /> : <FormOutlined />}>
                  {isAnalytics ? '进入报表设计' : '进入表单设计'}
                </Button>
              </Space>
            )}
          >
            {isAnalytics ? (
              <Table<MetricRecord>
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={metrics}
                scroll={{ x: 980 }}
                columns={[
                  { title: '名称', dataIndex: 'name', fixed: 'left', width: 140 },
                  { title: '类型', dataIndex: 'role', width: 110 },
                  { title: '来源字段', dataIndex: 'sourceField', width: 130 },
                  { title: '聚合方式', dataIndex: 'aggregation', width: 100 },
                  { title: '维度粒度', dataIndex: 'granularity', width: 100 },
                  { title: '默认筛选', dataIndex: 'defaultFilter', width: 140 },
                  { title: '图表角色', dataIndex: 'chartRole', width: 100 },
                  { title: '钻取', dataIndex: 'drilldown', width: 130 },
                ]}
              />
            ) : (
              <Table<FieldRecord>
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={fields}
                scroll={{ x: 980 }}
                columns={[
                  { title: '字段名', dataIndex: 'label', fixed: 'left', width: 140 },
                  { title: '编码', dataIndex: 'code', width: 130 },
                  { title: '列名', dataIndex: 'columnName', width: 130 },
                  { title: '类型', dataIndex: 'dataType', width: 100 },
                  { title: '长度', dataIndex: 'length', width: 90 },
                  { title: '允许为空', dataIndex: 'allowNull', width: 90, render: boolTag },
                  { title: '唯一', dataIndex: 'unique', width: 70, render: boolTag },
                  { title: '索引', dataIndex: 'indexed', width: 70, render: boolTag },
                  { title: '组件', dataIndex: 'component', width: 110 },
                  { title: '列表', dataIndex: 'list', width: 70, render: boolTag },
                  { title: '表单', dataIndex: 'form', width: 70, render: boolTag },
                  { title: '搜索', dataIndex: 'search', width: 70, render: boolTag },
                ]}
              />
            )}
            <div className="database-impact-note">
              {isAnalytics
                ? '分析展示类保存的是数据源、维度、指标、筛选器和图表映射，不直接创建数据库字段。'
                : '业务交互类字段结构会影响数据表、字段类型、索引和默认的录入/列表/搜索配置。'}
            </div>
          </Card>
        </Space>
      </Col>
    </Row>
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
}: {
  status: string;
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
        <Button icon={<AppstoreAddOutlined />} onClick={onCopyDraft}>复制为草稿</Button>
        <Popconfirm title="确认停用？" onConfirm={onDisable}>
          <Button danger icon={<StopOutlined />}>停用</Button>
        </Popconfirm>
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
  roles: RoleRecord[];
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
    if (form) onAddFormToMenu(form);
  };
  const expandedMenuKeys = collectMenuKeys(menus);

  return (
    <div className="app-assembly-workspace">
      <section className="assembly-help">
        <div>
          <Typography.Title level={5}>
            菜单管理
            <Typography.Text className="assembly-current-app">：{selectedApp.name}</Typography.Text>
          </Typography.Title>
          <Typography.Text type="secondary">
            左侧选择应用，中间维护这个应用可用的表单，右侧通过拖拽菜单树把表单组织成导航。
          </Typography.Text>
        </div>
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

        <Col xs={24} xl={5}>
          <Card title="表单" className="assembly-column-card" extra={<Tag>{formCountLabel}</Tag>}>
            <div className="assembly-form-list">
              <div className="assembly-form-section-title">当前应用表单</div>
              {currentAppForms.map(renderFormCard)}
              {!currentAppForms.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无已绑定表单" />}
              <div className="assembly-form-section-title">其他可用表单</div>
              {otherForms.map(renderFormCard)}
              {!otherForms.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无其他可用表单" />}
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

        <Col xs={24} xl={7}>
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
        <Col xs={24} xl={7}>
              <Card title="菜单节点属性" className="assembly-property-card">
                {selectedMenu ? (
                  <Form form={menuForm} layout="vertical" size="small" className="assembly-node-editor">
                    <div className="node-editor-hero">
                      <div>
                        <Typography.Text type="secondary">当前节点</Typography.Text>
                        <Form.Item name="title" noStyle>
                          <Input className="node-title-input" placeholder="菜单名称" />
                        </Form.Item>
                      </div>
                      <div className="node-state-switches">
                        <Form.Item name="visible" valuePropName="checked" noStyle>
                          <Switch checkedChildren="显示" unCheckedChildren="隐藏" />
                        </Form.Item>
                        <Form.Item name="defaultEntry" valuePropName="checked" noStyle>
                          <Switch checkedChildren="入口" unCheckedChildren="入口" />
                        </Form.Item>
                      </div>
                    </div>
                    <div className="node-editor-grid">
                      <div className="node-config-card wide">
                        <div>
                          <Typography.Text strong>导航绑定</Typography.Text>
                          <Typography.Text type="secondary">绑定表单与可选路由，决定菜单点击后的目标。</Typography.Text>
                        </div>
                        <Form.Item name="formId" noStyle>
                          <Select
                            allowClear
                            placeholder="绑定表单"
                            options={forms.map((form) => ({ label: form.name, value: form.id }))}
                          />
                        </Form.Item>
                        <Form.Item name="routePath" noStyle>
                          <Input placeholder="自定义路由，如 /program/device-health" />
                        </Form.Item>
                      </div>
                      <div className="node-config-card">
                        <Typography.Text strong>数据范围</Typography.Text>
                        <Typography.Text type="secondary">进入页面后的默认数据边界。</Typography.Text>
                        <Form.Item name="dataScope" noStyle>
                          <Select
                            options={[
                              { label: '当前应用', value: 'current_app' },
                              { label: '所在组织', value: 'organization' },
                              { label: '所属团队', value: 'team' },
                              { label: '仅本人', value: 'self' },
                            ]}
                          />
                        </Form.Item>
                      </div>
                      <div className="node-config-card wide permission-rule-panel">
                        <Form.List name="permissionRules">
                          {(fields, { add, remove }) => (
                            <>
                              <div className="permission-rule-head">
                                <div className="permission-rule-title">
                                  <span className="permission-rule-icon">
                                    <SafetyCertificateOutlined />
                                  </span>
                                  <div>
                                    <Typography.Text strong>访问权限规则</Typography.Text>
                                    <Typography.Text type="secondary">
                                      每条规则定义一批角色或用户可以执行的操作，可叠加多条规则形成通配授权。
                                    </Typography.Text>
                                  </div>
                                </div>
                                <Button
                                  size="small"
                                  type="primary"
                                  ghost
                                  icon={<PlusOutlined />}
                                  onClick={() => add({ subjectType: 'roles', roleIds: [], userKeys: [], actions: ['view'], effect: 'allow' })}
                                >
                                  新增规则
                                </Button>
                              </div>
                              <div className="permission-rule-list">
                                {fields.length === 0 ? (
                                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无自定义规则" />
                                ) : fields.map((field, index) => (
                                  <div className="permission-rule-row" key={field.key}>
                                    <div className="permission-rule-row-head">
                                      <div className="permission-rule-index">
                                        <span>{String(index + 1).padStart(2, '0')}</span>
                                        <Typography.Text strong>授权规则</Typography.Text>
                                      </div>
                                      <Space size={6} className="permission-rule-actions">
                                        <Button danger type="text" size="small" icon={<DeleteOutlined />} onClick={() => remove(field.name)} />
                                      </Space>
                                    </div>
                                    <div className="permission-rule-decision">
                                      <span>规则结果</span>
                                      <Form.Item name={[field.name, 'effect']} noStyle>
                                        <Segmented
                                          block
                                          className="permission-rule-effect"
                                          size="small"
                                          options={[
                                            { label: '允许访问', value: 'allow' },
                                            { label: '拒绝访问', value: 'deny' },
                                          ]}
                                        />
                                      </Form.Item>
                                    </div>
                                    <div className="permission-rule-fields">
                                      <label className="permission-rule-field">
                                        <span>授权对象</span>
                                        <Form.Item name={[field.name, 'subjectType']} noStyle>
                                          <Select
                                            options={[
                                              { label: '应用默认角色', value: 'app_roles' },
                                              { label: '指定角色', value: 'roles' },
                                              { label: '指定用户', value: 'users' },
                                            ]}
                                          />
                                        </Form.Item>
                                      </label>
                                      <label className="permission-rule-field permission-rule-field-wide">
                                        <span>对象范围</span>
                                        <Form.Item noStyle shouldUpdate>
                                          {({ getFieldValue }) => {
                                            const subjectType = getFieldValue(['permissionRules', field.name, 'subjectType']);
                                            if (subjectType === 'users') {
                                              return (
                                                <Form.Item name={[field.name, 'userKeys']} noStyle>
                                                  <Select mode="tags" placeholder="输入用户账号或邮箱" />
                                                </Form.Item>
                                              );
                                            }
                                            if (subjectType === 'roles') {
                                              return (
                                                <Form.Item name={[field.name, 'roleIds']} noStyle>
                                                  <Select
                                                    mode="multiple"
                                                    placeholder="选择角色"
                                                    options={roles.map((role) => ({ label: `${role.label} / ${role.name}`, value: role.id }))}
                                                  />
                                                </Form.Item>
                                              );
                                            }
                                            return <div className="permission-rule-inherit">跟随当前应用可见角色</div>;
                                          }}
                                        </Form.Item>
                                      </label>
                                      <label className="permission-rule-field permission-rule-field-wide">
                                        <span>可执行操作</span>
                                        <Form.Item name={[field.name, 'actions']} noStyle>
                                          <Select
                                            mode="multiple"
                                            placeholder="操作权限"
                                            options={[
                                              { label: '查看', value: 'view' },
                                              { label: '新增', value: 'create' },
                                              { label: '编辑', value: 'edit' },
                                              { label: '导出', value: 'export' },
                                              { label: '审批', value: 'approve' },
                                              { label: '删除', value: 'delete' },
                                            ]}
                                          />
                                        </Form.Item>
                                      </label>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </>
                          )}
                        </Form.List>
                      </div>
                    </div>
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
    <Form form={form} layout="vertical" className="app-config-form">
      <Row gutter={12}>
        <Col xs={24} md={10}>
          <Form.Item name="name" label="应用名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item name="code" label="应用编码" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
        </Col>
        <Col xs={24} md={6}>
          <Form.Item name="icon" label="应用图标">
            <Select
              optionLabelProp="label"
              options={iconOptions.map((item) => ({
                value: item.value,
                label: item.label,
                display: (
                  <Space>
                    <span className="icon-option-preview">{renderIcon(item.value)}</span>
                    <span>{item.label}</span>
                  </Space>
                ),
              }))}
              optionRender={(option) => option.data.display}
            />
          </Form.Item>
        </Col>
      </Row>
      <Row gutter={12}>
        <Col xs={24} md={14}>
          <Form.Item name="description" label="应用说明">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Col>
        <Col xs={24} md={10}>
          <Form.Item name="default_route" label="默认入口">
            <Input />
          </Form.Item>
        </Col>
      </Row>
      <Row gutter={12}>
        <Col xs={24} md={12}>
          <Form.Item name="role_ids" label="可见角色">
            <Select
              mode="multiple"
              options={roles.map((role) => ({ label: `${role.label} / ${role.name}`, value: role.id }))}
            />
          </Form.Item>
        </Col>
        <Col xs={24} sm={8} md={5}>
          <Form.Item name="status" label="发布状态">
            <Select
              options={[
                { label: '已发布', value: 'published' },
                { label: '草稿', value: 'draft' },
                { label: '已停用', value: 'disabled' },
              ]}
            />
          </Form.Item>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Form.Item name="sort_order" label="排序">
            <Input type="number" />
          </Form.Item>
        </Col>
        <Col xs={12} sm={8} md={3}>
          <Form.Item name="is_pinned" label="置顶" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Col>
      </Row>
    </Form>
  );
}

function FormConfigForm({ form }: { form: ReturnType<typeof Form.useForm>[0] }) {
  const category = Form.useWatch('category', form) ?? 'interaction';
  const structureLocked = Boolean(Form.useWatch('structureLocked', form));
  const modeOptions = category === 'analytics' ? analyticsModeOptions : interactionModeOptions;

  return (
    <Form form={form} layout="vertical" className="form-config-form">
      <Form.Item name="structureLocked" hidden valuePropName="checked">
        <Switch />
      </Form.Item>
      <Row gutter={12}>
        <Col xs={24} md={8}>
          <Form.Item name="name" label={'\u8868\u5355\u540d\u79f0'} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
        </Col>
        <Col xs={24} md={6}>
          <Form.Item name="code" label={'\u8868\u5355\u7f16\u7801'} rules={[{ required: true }]}>
            <Input disabled={structureLocked} />
          </Form.Item>
        </Col>
        <Col xs={12} md={5}>
          <Form.Item name="category" label={'\u7c7b\u578b'}>
            <Select
              disabled={structureLocked}
              onChange={(value) => {
                form.setFieldValue('mode', value === 'analytics' ? 'bi_report' : 'entry_form');
                form.setFieldValue('source', value === 'analytics' ? 'existing_dataset' : 'generated_table');
                form.setFieldValue('entity', value === 'analytics' ? 'MetricDataset' : 'NewEntity');
              }}
              options={[
                { label: '\u4e1a\u52a1\u4ea4\u4e92\u7c7b', value: 'interaction' },
                { label: '\u5206\u6790\u5c55\u793a\u7c7b', value: 'analytics' },
              ]}
            />
          </Form.Item>
        </Col>
        <Col xs={12} md={5}>
          <Form.Item name="mode" label={'\u6a21\u5f0f'}>
            <Select disabled={structureLocked} options={modeOptions} />
          </Form.Item>
        </Col>
      </Row>
      <Row gutter={12}>
        <Col xs={24} md={8}>
          <Form.Item name="entity" label={category === 'analytics' ? '\u5206\u6790\u5bf9\u8c61' : '\u6570\u636e\u5b9e\u4f53'}>
            <Input disabled={structureLocked} prefix={<NodeIndexOutlined />} />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item name="source" label={category === 'analytics' ? '\u6570\u636e\u96c6\u6765\u6e90' : '\u6570\u636e\u6765\u6e90'}>
            <Input disabled={structureLocked} />
          </Form.Item>
        </Col>
        <Col xs={24} md={4}>
          <Form.Item name="status" label={'\u53d1\u5e03\u72b6\u6001'}>
            <Select
              options={[
                { label: '\u5df2\u53d1\u5e03', value: 'published' },
                { label: '\u8349\u7a3f', value: 'draft' },
                { label: '\u5df2\u505c\u7528', value: 'disabled' },
              ]}
            />
          </Form.Item>
        </Col>
        <Col xs={24} md={4}>
          <Form.Item name="owner" label={'\u8d1f\u8d23\u4eba'}>
            <Input />
          </Form.Item>
        </Col>
      </Row>
      <Form.Item name="description" label={category === 'analytics' ? '\u5206\u6790\u8bf4\u660e' : '\u8868\u5355\u8bf4\u660e'}>
        <Input.TextArea rows={2} />
      </Form.Item>
      {structureLocked && (
        <div className="structure-lock-note">
          {'\u7c7b\u578b\u3001\u6a21\u5f0f\u3001\u7f16\u7801\u3001\u6570\u636e\u5b9e\u4f53\u548c\u6570\u636e\u6765\u6e90\u4f1a\u5f71\u54cd\u8bbe\u8ba1\u5668\u5206\u652f\u4e0e\u5e95\u5c42\u7ed3\u6784\uff0c\u4fdd\u5b58\u540e\u53ea\u80fd\u67e5\u770b\uff0c\u907f\u514d\u540e\u7eed\u914d\u7f6e\u5931\u6548\u3002'}
        </div>
      )}
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

function boolTag(value: boolean) {
  return value ? <Tag color="success">是</Tag> : <Tag>否</Tag>;
}

function statusColor(status: string) {
  if (status === 'published') return 'success';
  if (status === 'draft') return 'warning';
  if (status === 'disabled') return 'default';
  if (status === 'archived') return 'default';
  return 'processing';
}

function buildFieldRows(form?: FormRecord): FieldRecord[] {
  if (!form || form.fields <= 0) return [];
  const presets = [
    { label: '名称', code: 'name', dataType: 'string', length: '100', component: 'Text', list: true, form: true, search: true, allowNull: false, unique: false, indexed: true },
    { label: '编码', code: 'code', dataType: 'string', length: '64', component: 'Text', list: true, form: true, search: true, allowNull: false, unique: true, indexed: true },
    { label: '状态', code: 'status', dataType: 'enum', length: '-', component: 'Select', list: true, form: true, search: true, allowNull: false, unique: false, indexed: true },
    { label: '负责人', code: 'owner', dataType: 'string', length: '80', component: 'Text', list: true, form: true, search: false, allowNull: true, unique: false, indexed: false },
    { label: '描述', code: 'description', dataType: 'text', length: '-', component: 'Textarea', list: false, form: true, search: false, allowNull: true, unique: false, indexed: false },
    { label: '创建时间', code: 'created_at', dataType: 'datetime', length: '-', component: 'DateTime', list: true, form: false, search: true, allowNull: false, unique: false, indexed: true },
    { label: '更新时间', code: 'updated_at', dataType: 'datetime', length: '-', component: 'DateTime', list: true, form: false, search: false, allowNull: false, unique: false, indexed: true },
  ];

  return Array.from({ length: form.fields }, (_, index) => {
    const preset = presets[index % presets.length];
    const code = index < presets.length ? preset.code : `${form.code.replace(/-/g, '_')}_field_${index + 1}`;
    return {
      ...preset,
      id: `${form.id}-${code}`,
      label: index < presets.length ? preset.label : `扩展字段 ${index + 1}`,
      code,
      columnName: code,
    };
  });
}

function buildMetricRows(form?: FormRecord): MetricRecord[] {
  if (!form) return [];
  const base = [
    { name: '记录数量', role: '指标', sourceField: 'id', aggregation: 'count', granularity: '-', defaultFilter: '时间范围', chartRole: 'Y 轴', drilldown: '明细列表' },
    { name: '状态分布', role: '维度', sourceField: 'status', aggregation: 'group by', granularity: '-', defaultFilter: '状态', chartRole: '系列', drilldown: '状态详情' },
    { name: '时间趋势', role: '维度', sourceField: 'created_at', aggregation: 'date group', granularity: '月/周/日', defaultFilter: '最近 90 天', chartRole: 'X 轴', drilldown: '时间明细' },
    { name: '负责人分布', role: '维度', sourceField: 'owner', aggregation: 'group by', granularity: '-', defaultFilter: '负责人', chartRole: '筛选器', drilldown: '负责人详情' },
  ];
  return base.map((item, index) => ({
    id: `${form.id}-metric-${index + 1}`,
    ...item,
  }));
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
      category: 'interaction',
      mode: 'entry_form',
      structureLocked: true,
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
  return nodes.flatMap((node): MenuNode[] => {
    if (node.key === key) return ((node.children ?? []) as MenuNode[]).map((child) => ({ ...child, parentDbId: node.parentDbId ?? null }));
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
        routePath: values.routePath,
        visible: values.visible,
        defaultEntry: values.defaultEntry,
        permissionMode: values.permissionMode,
        roleIds: values.roleIds,
        permissionActions: values.permissionActions,
        permissionRules: normalizePermissionRules(values.permissionRules),
        dataScope: values.dataScope,
        config: {
          ...(node.config ?? {}),
          permission_mode: values.permissionMode ?? 'inherit',
          role_ids: values.permissionMode === 'custom' ? values.roleIds ?? [] : [],
          permission_actions: values.permissionActions ?? ['view'],
          permission_rules: normalizePermissionRules(values.permissionRules),
          data_scope: values.dataScope ?? 'current_app',
        },
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
