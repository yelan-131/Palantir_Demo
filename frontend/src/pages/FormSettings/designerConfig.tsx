import { CalendarOutlined, CheckCircleOutlined, DatabaseOutlined, FileImageOutlined, FileSearchOutlined, FormOutlined, HolderOutlined, LinkOutlined, LockOutlined, NumberOutlined, PaperClipOutlined, SelectOutlined, SettingOutlined, SwitcherOutlined, TableOutlined, TagsOutlined, UserOutlined, UserSwitchOutlined } from '@ant-design/icons';
import { getPlatformForm, getPlatformFormByCode, listPlatformForms } from '@/services/api';
import type { PlatformForm } from '@/services/api';
import React from 'react';
import { isRecord } from './designerTypes';
import type { AnalyticsDataset, AnalyticsDesign, AnalyticsMetric, AnalyticsStyle, AnalyticsWidget, ComponentDefinition, DesignerConfig, FlowNodeDefinition } from './designerTypes';

export function makeDefaultAnalyticsStyle(): AnalyticsStyle {
  return {
    gridSize: 44, cardOpacity: 0.78, cardBlur: 12,
    preset: 'clean',
    background: '#f6f8fa',
    componentGap: 16,
    cardRadius: 12,
    cardBorder: 'light',
    chartPalette: 'manufacturing',
    tableDensity: 'standard',
    filterTheme: 'toolbar',
  };
}

export const flowNodePalette: FlowNodeDefinition[] = [
  { key: 'start', name: '开始节点', desc: '流程入口，仅保留一个', role: 'start', icon: <CheckCircleOutlined /> },
  { key: 'approve', name: '审批节点', desc: '人工审核、同意或驳回', role: 'task', icon: <UserSwitchOutlined /> },
  { key: 'handle', name: '处理节点', desc: '业务办理、补充资料', role: 'task', icon: <SettingOutlined /> },
  { key: 'dispatch', name: '分发节点', desc: '按规则分派责任人', role: 'task', icon: <LinkOutlined /> },
  { key: 'condition', name: '条件分支', desc: '按字段或规则走不同路径', role: 'task', icon: <TagsOutlined /> },
  { key: 'cc', name: '抄送节点', desc: '通知相关角色或人员', role: 'task', icon: <UserOutlined /> },
  { key: 'automation', name: '自动任务', desc: '调用接口、写入数据、触发消息', role: 'task', icon: <DatabaseOutlined /> },
  { key: 'end', name: '结束节点', desc: '流程归档出口', role: 'end', icon: <LockOutlined /> },
];

export const configs: Record<string, DesignerConfig> = {
  'risk-review': {
    id: 'risk-review',
    name: '风险复核',
    createTitle: '新增风险复核单',
    kind: 'business',
    appName: '供应链风险',
    dataSource: 'risk_reviews',
    primaryKey: 'riskNo',
    status: '草稿',
    version: 'v1',
    description: '用于新增风险复核业务数据，而不是配置整个运行页面。',
    fields: [
      { key: 'riskNo', name: '风险单号', type: '文本 / 自动编号', businessType: 'code', placeholder: '自动生成 SR-2605-001', locked: true, required: true, listVisible: true, searchable: true, sortable: true, validation: '系统唯一编号，不允许重复' },
      { key: 'subject', name: '风险主题', type: '文本输入', placeholder: '请输入风险主题', required: true, listVisible: true, searchable: true, validation: '2-80 个字符' },
      { key: 'level', name: '风险等级', type: '下拉选择', placeholder: '高 / 中 / 低', required: true, listVisible: true, searchable: true, optionSource: '高、中、低' },
      { key: 'owner', name: '处理人', type: '人员选择', placeholder: '选择处理人', required: true, listVisible: true, searchable: true, optionSource: '组织人员' },
      { key: 'reason', name: '风险原因', type: '多行文本', placeholder: '描述风险原因和影响范围', listVisible: false, validation: '最多 500 字' },
    ],
    filters: [
      { key: 'keyword', name: '业务编号 / 主题', type: '搜索输入', placeholder: '请输入关键词' },
      { key: 'status', name: '状态', type: '下拉选择', placeholder: '请选择状态' },
      { key: 'level', name: '等级', type: '下拉选择', placeholder: '请选择等级' },
      { key: 'owner', name: '负责人', type: '人员选择', placeholder: '请选择负责人' },
    ],
    flowSteps: ['提交复核', '风险定级', '责任分派', '处理关闭'],
    roles: ['采购管理', '计划管理', '仓储管理', '系统管理员'],
  },
  'alert-center': {
    id: 'alert-center',
    name: '告警中心',
    createTitle: '新增设备告警',
    kind: 'business',
    appName: '预测性维护',
    dataSource: 'business_alert_center',
    primaryKey: 'alertId',
    status: '已发布',
    version: 'v1',
    description: '用于新增设备告警数据，字段和风险复核不同。',
    fields: [
      { key: 'alertId', name: '告警编号', type: '文本 / 自动编号', businessType: 'code', placeholder: '自动生成 AL-2605-001', locked: true, required: true, listVisible: true, searchable: true, sortable: true, validation: '系统唯一编号，不允许重复' },
      { key: 'title', name: '告警标题', type: '文本输入', placeholder: '请输入告警标题', required: true, listVisible: true, searchable: true, validation: '2-80 个字符' },
      { key: 'device', name: '关联设备', type: '关联对象', placeholder: '选择设备', required: true, listVisible: true, searchable: true, optionSource: '设备台账' },
      { key: 'level', name: '告警等级', type: '下拉选择', placeholder: '严重 / 一般 / 提醒', required: true, listVisible: true, searchable: true, optionSource: '严重、一般、提醒' },
      { key: 'source', name: '告警来源', type: '下拉选择', placeholder: '系统监测 / 人工上报 / 外部接口', required: true, listVisible: true, searchable: true, optionSource: '系统监测、人工上报、外部接口' },
      { key: 'occurredAt', name: '发生时间', type: '日期控件', placeholder: '选择告警发生时间', required: true, listVisible: true, sortable: true },
      { key: 'owner', name: '处理人', type: '人员选择', placeholder: '选择处理人', listVisible: true, searchable: true, optionSource: '组织人员' },
      { key: 'dueAt', name: '处理时限', type: '日期控件', placeholder: '选择处理截止时间', listVisible: true, sortable: true, validation: '严重告警必须配置处理时限' },
      { key: 'status', name: '告警状态', type: '下拉选择', placeholder: '待处理 / 处理中 / 已关闭', listVisible: true, searchable: true, optionSource: '待处理、处理中、已关闭' },
      { key: 'resolution', name: '处理结论', type: '多行文本', placeholder: '填写处理过程和关闭结论', listVisible: false, validation: '关闭告警时必填' },
      { key: 'evidence', name: '附件证据', type: '附件控件', placeholder: '上传现场图片、日志或凭证', listVisible: false, validation: '严重告警建议必填' },
    ],
    filters: [
      { key: 'keyword', name: '告警编号 / 标题', type: '搜索输入', placeholder: '请输入关键词' },
      { key: 'device', name: '设备', type: '关联对象', placeholder: '请选择设备' },
      { key: 'level', name: '等级', type: '下拉选择', placeholder: '请选择等级' },
      { key: 'status', name: '状态', type: '下拉选择', placeholder: '请选择状态' },
    ],
    flowSteps: ['告警登记', '维护确认', '维修处理', '关闭归档'],
    roles: ['设备管理员', '维修工程师', '生产经理', '系统管理员'],
  },
};

export const defaultConfig: DesignerConfig = {
  id: 'unknown',
  name: '表单设置',
  createTitle: '新增业务记录',
  kind: 'business',
  appName: '当前应用',
  dataSource: 'business_records',
  primaryKey: 'id',
  status: '草稿',
  version: 'v1',
  description: '用于配置新增业务数据的表单。',
  fields: [
    { key: 'id', name: '编号', type: '文本 / 自动编号', businessType: 'code', placeholder: '自动生成编号', locked: true, required: true, listVisible: true, searchable: true, validation: '系统唯一编号' },
    { key: 'name', name: '名称', type: '文本输入', placeholder: '请输入名称', required: true, listVisible: true, searchable: true },
    { key: 'status', name: '状态', type: '下拉选择', placeholder: '请选择状态', listVisible: true, searchable: true },
  ],
  filters: [
    { key: 'keyword', name: '关键词', type: '搜索输入', placeholder: '请输入关键词' },
    { key: 'status', name: '状态', type: '下拉选择', placeholder: '请选择状态' },
  ],
  flowSteps: ['提交', '审批', '归档'],
  roles: ['系统管理员'],
};

export function isNumericFormRouteId(value: string) {
  return /^\d+$/.test(value.trim());
}

export async function resolvePlatformFormForConfig(configId: string) {
  if (isNumericFormRouteId(configId)) {
    const detailResponse = await getPlatformForm(configId, { schema: 'draft', scope: 'designer' });
    const form = detailResponse.data?.data as PlatformForm | undefined;
    return form || null;
  }
  try {
    const detailResponse = await getPlatformFormByCode(configId, { schema: 'draft', scope: 'designer' });
    const form = detailResponse.data?.data as PlatformForm | undefined;
    if (form) return form;
  } catch {
    // Keep compatibility with older backends that only support list + id lookup.
  }
  const formsResponse = await listPlatformForms();
  const forms = (formsResponse.data?.data || []) as PlatformForm[];
  const matchedForm = forms.find((form) => form.code === configId);
  if (!matchedForm) return null;
  const detailResponse = await getPlatformForm(matchedForm.id, { schema: 'draft', scope: 'designer' });
  return (detailResponse.data?.data || matchedForm) as PlatformForm;
}

export function inferDesignerKindFromMeta(kindValue?: unknown, codeValue?: unknown, tabValue?: unknown): DesignerConfig['kind'] {
  const kind = String(kindValue || '').toLowerCase();
  const code = String(codeValue || '').toLowerCase();
  const tab = String(tabValue || '').toLowerCase();
  if (
    ['analysis', 'analytics', 'dashboard', 'report', 'bi_report', 'metric_dashboard', 'list_analysis'].includes(kind)
    || ['dashboard', 'dataset', 'style'].includes(tab)
    || code.includes('dashboard')
    || code.includes('overview')
    || code.includes('report')
    || code.includes('analysis')
  ) {
    return 'analysis';
  }
  return 'business';
}

export function inferFormDesignerKind(form: PlatformForm): DesignerConfig['kind'] {
  const config = (form.config || {}) as Record<string, unknown>;
  return inferDesignerKindFromMeta(config.assemblyKind || config.kind || config.type, form.code);
}

export function makeDefaultAnalyticsDesign(config: DesignerConfig): AnalyticsDesign {
  const dimensions = config.fields.filter(field => field.businessType !== 'number').slice(0, 8).map(field => field.key);
  const measures = config.fields.filter(field => field.businessType === 'number' || field.type.includes('数值')).map(field => field.key);
  const dimension = dimensions.includes('date') ? 'date' : dimensions[0];
  const datasetId = `${config.id}-dataset`;
  const metrics: AnalyticsMetric[] = [{ id: 'metric-total', name: '记录数', expression: 'count(*)', datasetId, format: 'number', threshold: '正常 >= 0' }];
  if (measures.length) metrics.push({ id: 'metric-primary', name: `${measures[0]}合计`, expression: `sum(${measures[0]})`, datasetId, format: 'number', threshold: '正常 >= 0' });
  if (dimensions.includes('status')) metrics.push({ id: 'metric-rate', name: '已关闭占比', expression: 'count_if(status == "已关闭") / count(*)', datasetId, format: 'percent', threshold: '绿色 >= 90%' });
  const widgets: AnalyticsWidget[] = [{ id: 'widget-total', title: '核心指标', type: 'metric-card', datasetId, metricIds: metrics.map(metric => metric.id), width: 'full', interaction: 'none' }];
  if (dimension) widgets.push(
    { id: 'widget-trend', title: '分组分析', type: 'line', datasetId, metricIds: ['metric-total'], dimension, width: 'half', interaction: 'filter' },
    { id: 'widget-rank', title: '数量排行', type: 'rank-table', datasetId, metricIds: ['metric-total'], dimension, width: 'half', interaction: 'drilldown' },
  );
  widgets.push({ id: 'widget-detail', title: '明细列表', type: 'detail-table', datasetId, metricIds: ['metric-total'], dimension, width: 'full', interaction: 'navigate' });
  return {
    datasets: [{ id: datasetId, name: `${config.name}数据集`, sourceType: 'businessForm', source: config.id, refreshMode: 'realtime', dimensions, measures }],
    metrics, widgets, globalFilters: dimensions.slice(0, 3),
    interactions: dimension ? [{ sourceWidgetId: 'widget-trend', targetWidgetId: 'widget-detail', action: 'filter' }, { sourceWidgetId: 'widget-rank', targetWidgetId: 'widget-detail', action: 'drilldown' }] : [],
    style: makeDefaultAnalyticsStyle(),
  };
}

export function normalizeAnalyticsDesign(value: unknown, fallback: AnalyticsDesign): AnalyticsDesign {
  if (!value || typeof value !== 'object') return fallback;
  const draft = value as Partial<AnalyticsDesign>;
  return {
    datasets: Array.isArray(draft.datasets) ? draft.datasets as AnalyticsDataset[] : fallback.datasets,
    metrics: Array.isArray(draft.metrics) ? draft.metrics as AnalyticsMetric[] : fallback.metrics,
    widgets: Array.isArray(draft.widgets) ? draft.widgets as AnalyticsWidget[] : fallback.widgets,
    globalFilters: Array.isArray(draft.globalFilters) ? draft.globalFilters.map(String) : fallback.globalFilters,
    interactions: Array.isArray(draft.interactions) ? draft.interactions as AnalyticsDesign['interactions'] : fallback.interactions,
    style: { ...fallback.style, ...(isRecord(draft.style) ? draft.style : {}) } as AnalyticsStyle,
  };
}

export function getStoredAnalyticsDesign(form: PlatformForm | null | undefined, designerConfig: DesignerConfig): AnalyticsDesign {
  const fallback = makeDefaultAnalyticsDesign(designerConfig);
  const config = (form?.config || {}) as Record<string, unknown>;
  return normalizeAnalyticsDesign(config.analyticsDesignDraft || config.analyticsDesign, fallback);
}

export const defaultComponentGroups: Array<{ category: string; items: ComponentDefinition[] }> = [
  {
    category: '基础输入',
    items: [
      { key: 'text', category: '基础输入', name: '文本控件', desc: '单行文本输入', icon: <FormOutlined />, controlType: 'text' },
      { key: 'textarea', category: '基础输入', name: '多行文本', desc: '长文本、备注、说明录入', icon: <FormOutlined />, controlType: 'textarea', defaultWidth: 'full' },
      { key: 'number', category: '基础输入', name: '数值控件', desc: '数量、金额、百分比', icon: <NumberOutlined />, controlType: 'number' },
      { key: 'code', category: '基础输入', name: '编码控件', desc: '自动编号、业务编号、流水号', icon: <NumberOutlined />, controlType: 'code' },
    ],
  },
  {
    category: '选择控件',
    items: [
      { key: 'select', category: '选择控件', name: '选择控件', desc: '固定选项、字典、人员及关联记录', icon: <SelectOutlined />, controlType: 'select' },
      { key: 'datetime', category: '选择控件', name: '日期选择', desc: '日期、时间、时间范围', icon: <CalendarOutlined />, controlType: 'datetime' },
      { key: 'switch', category: '选择控件', name: '布尔选择', desc: '是/否、启用/停用', icon: <SwitcherOutlined />, controlType: 'switch' },
      { key: 'upload', category: '选择控件', name: '附件上传', desc: '图片、文件、凭证上传', icon: <PaperClipOutlined />, controlType: 'upload', defaultWidth: 'full' },
    ],
  },
  {
    category: '布局容器',
    items: [
      { key: 'container', category: '布局容器', name: '容器', desc: '分组面板、基础信息区', icon: <HolderOutlined />, controlType: 'container', defaultWidth: 'full' },
      { key: 'two-columns', category: '布局容器', name: '多列布局', desc: '两列、三列、高密度字段排版', icon: <HolderOutlined />, controlType: 'two-columns', defaultWidth: 'full' },
      { key: 'tabs', category: '布局容器', name: 'Tab 页', desc: '切换页签、次要信息收起', icon: <HolderOutlined />, controlType: 'tabs', defaultWidth: 'full' },
      { key: 'divider', category: '布局容器', name: '分割符', desc: '分割线、区块说明', icon: <FileSearchOutlined />, controlType: 'divider', defaultWidth: 'full' },
    ],
  },
  {
    category: '数据展示',
    items: [
      { key: 'editable-table', category: '数据展示', name: '表格', desc: '可编辑子表、明细行', icon: <TableOutlined />, controlType: 'editable-table', defaultWidth: 'full' },
      { key: 'readonly-table', category: '数据展示', name: '关联表格', desc: '只读关联表、分页详情', icon: <TableOutlined />, controlType: 'readonly-table', defaultWidth: 'full' },
      { key: 'summary-card', category: '数据展示', name: '数据摘要', desc: '摘要卡、统计值、关联对象概览', icon: <DatabaseOutlined />, controlType: 'summary-card', defaultWidth: 'full' },
      { key: 'status-tag', category: '数据展示', name: '状态标签', desc: '状态、等级、结果标识', icon: <TagsOutlined />, controlType: 'status-tag' },
      { key: 'file-preview', category: '数据展示', name: '媒体预览', desc: '图片、附件、凭证预览', icon: <FileImageOutlined />, controlType: 'file-preview', defaultWidth: 'full' },
    ],
  },
];

export const defaultCommonControlKeys = ['text', 'number', 'code', 'select', 'datetime'];

export const componentIconMap: Record<string, React.ReactNode> = {
  text: <FormOutlined />,
  textarea: <FormOutlined />,
  form: <FormOutlined />,
  number: <NumberOutlined />,
  code: <NumberOutlined />,
  select: <SelectOutlined />,
  relation: <LinkOutlined />,
  datetime: <CalendarOutlined />,
  switch: <SwitcherOutlined />,
  upload: <PaperClipOutlined />,
  table: <TableOutlined />,
  database: <DatabaseOutlined />,
  tag: <TagsOutlined />,
  media: <FileImageOutlined />,
  layout: <HolderOutlined />,
  divider: <FileSearchOutlined />,
};
