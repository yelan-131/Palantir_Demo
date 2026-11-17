import { DEFAULT_FORM_LIMITS } from '../SystemAdmin/assemblyPersistence';
import { defaultRuleErrors } from '@/utils/formDefaults';
import { duplicateFieldBindings } from '@/utils/formControls';
import { isLayoutControl } from '@/utils/formLayout';
import { getViewTabs, type ViewConfig } from '@/utils/viewConfig';
import { validateFlowDesignerConfig, type FlowDesignerConfig } from './ProfessionalFlowDesigner';
import type { AnalyticsDesign, DesignerConfig, LayoutControl, PublishCheckItem } from './designerTypes';

export function buildPublishChecks(input: {
  isAnalysisDesigner: boolean;
  analyticsDesign: AnalyticsDesign;
  baseConfig: Pick<DesignerConfig, 'id' | 'fields'>;
  layoutControls: LayoutControl[];
  searchableFieldCount: number;
  hiddenRequiredControls: LayoutControl[];
  storedViewConfig: ViewConfig;
  professionalFlowConfig: FlowDesignerConfig;
}): PublishCheckItem[] {
  const {
    isAnalysisDesigner,
    analyticsDesign,
    baseConfig,
    layoutControls,
    searchableFieldCount,
    hiddenRequiredControls,
    storedViewConfig,
    professionalFlowConfig,
  } = input;

  if (isAnalysisDesigner) {
    const widgetsWithoutMetric = analyticsDesign.widgets.filter((widget) => !widget.metricIds.length);
    const invalidWidgetDatasets = analyticsDesign.widgets.filter((widget) => !analyticsDesign.datasets.some((dataset) => dataset.id === widget.datasetId));
    const interactiveWidgets = analyticsDesign.widgets.filter((widget) => widget.interaction !== 'none');
    const hasDetailTarget = analyticsDesign.widgets.some((widget) => widget.type === 'detail-table' || widget.type === 'rank-table');
    return [
      {
        level: analyticsDesign.datasets.length ? 'suggestion' : 'error',
        title: '数据集绑定',
        detail: analyticsDesign.datasets.length ? `已配置 ${analyticsDesign.datasets.length} 个数据集，主数据源为 ${analyticsDesign.datasets[0]?.source || '-'}` : 'BI 看板至少需要一个数据集。',
      },
      {
        level: analyticsDesign.metrics.length ? 'suggestion' : 'error',
        title: '指标定义',
        detail: analyticsDesign.metrics.length ? `已配置 ${analyticsDesign.metrics.length} 个指标，可用于指标卡、趋势图和排行。` : '请至少定义一个可计算指标。',
      },
      {
        level: widgetsWithoutMetric.length ? 'error' : 'suggestion',
        title: '图表指标绑定',
        detail: widgetsWithoutMetric.length ? `以下组件缺少指标：${widgetsWithoutMetric.map((widget) => widget.title).join('、')}` : '所有图表组件均已绑定指标。',
      },
      {
        level: invalidWidgetDatasets.length ? 'error' : 'suggestion',
        title: '图表数据集绑定',
        detail: invalidWidgetDatasets.length ? `以下组件绑定的数据集不存在：${invalidWidgetDatasets.map((widget) => widget.title).join('、')}` : '所有图表组件均绑定有效数据集。',
      },
      {
        level: analyticsDesign.globalFilters.length ? 'suggestion' : 'warning',
        title: '全局筛选器',
        detail: analyticsDesign.globalFilters.length ? `已配置 ${analyticsDesign.globalFilters.length} 个全局筛选器。` : '建议配置时间、组织或状态等全局筛选器。',
      },
      {
        level: interactiveWidgets.length && !hasDetailTarget ? 'warning' : 'suggestion',
        title: '联动与下钻',
        detail: interactiveWidgets.length
          ? `已配置 ${interactiveWidgets.length} 个可交互组件${hasDetailTarget ? '，并具备明细承接组件。' : '，建议增加明细表或排行表作为承接。'}`
          : '当前看板为纯展示模式，可按需增加点击筛选、下钻或跳转动作。',
      },
    ];
  }

  const canvasFieldKeys = new Set(layoutControls.map((control) => control.fieldKey).filter(Boolean));
  const missingRequired = baseConfig.fields.filter((field) => field.required && !canvasFieldKeys.has(field.key));
  const enumWithoutSource = baseConfig.fields.filter((field) => field.type.includes('下拉') && !field.optionSource);
  const relationWithoutSource = baseConfig.fields.filter((field) => field.type.includes('关联') && !field.optionSource);
  const viewTabs = getViewTabs(storedViewConfig);
  const enabledFilters = viewTabs.flatMap((tab) => tab.filters.filter((filter) => filter.enabled));
  const enabledColumns = viewTabs.flatMap((tab) => tab.table.columns.filter((column) => column.enabled));
  const emptyTabs = viewTabs.filter((tab) => !tab.table.columns.some((column) => column.enabled));
  const unboundTabs = viewTabs.filter((tab) => tab.audience.mode === 'restricted' && !tab.audience.roleIds.length && !tab.audience.userIds.length && !tab.audience.orgIds.length);
  const flowValidation = validateFlowDesignerConfig(professionalFlowConfig);
  const flowErrors = flowValidation.filter((item) => item.level === 'error');
  const flowWarnings = flowValidation.filter((item) => item.level === 'warning');
  const invalidViewFields = [
    ...enabledFilters.filter((filter) => !baseConfig.fields.some((field) => field.key === filter.fieldName)).map((filter) => filter.label),
    ...enabledColumns.filter((column) => !baseConfig.fields.some((field) => field.key === column.fieldName)).map((column) => column.label),
  ];
  const duplicates = duplicateFieldBindings(layoutControls);
  const unbound = layoutControls.filter((c) => !c.fieldKey && !isLayoutControl(c));
  const defaultErrors = defaultRuleErrors(layoutControls, baseConfig.fields);
  const checks: PublishCheckItem[] = [
    { level: baseConfig.fields.length > DEFAULT_FORM_LIMITS.fields ? 'error' : 'suggestion', title: '表单容量规则', detail: `当前 ${baseConfig.fields.length} 个字段，系统上限 ${DEFAULT_FORM_LIMITS.fields} 个；单条记录最多 2 MiB` },
    { level: defaultErrors.length ? 'error' : 'suggestion', title: '默认值规则', detail: defaultErrors.length ? defaultErrors.join('；') : '默认值字段引用与依赖关系有效' },
    { level: duplicates.length ? 'error' : 'suggestion', title: '字段绑定唯一性', detail: duplicates.length ? `请重新绑定复制控件：${duplicates.join('、')}` : '每个字段仅绑定一个控件' },
    { level: unbound.length ? 'error' : 'suggestion', title: '控件数据绑定', detail: unbound.length ? `请绑定字段或移除控件：${unbound.map((c) => c.name).join('、')}` : '所有输入控件都已绑定字段' },
    {
      level: missingRequired.length ? 'error' : 'suggestion',
      title: '必填字段覆盖',
      detail: missingRequired.length ? `以下必填字段不在表单中：${missingRequired.map((field) => field.name).join('、')}` : '所有必填字段都已放入表单画布。',
    },
    {
      level: enumWithoutSource.length ? 'error' : 'suggestion',
      title: '枚举选项完整性',
      detail: enumWithoutSource.length ? `以下枚举字段缺少选项：${enumWithoutSource.map((field) => field.name).join('、')}` : '枚举字段均已配置选项来源。',
    },
    {
      level: relationWithoutSource.length ? 'warning' : 'suggestion',
      title: '关联数据源',
      detail: relationWithoutSource.length ? `以下关联字段需要补充数据源：${relationWithoutSource.map((field) => field.name).join('、')}` : '关联字段均有数据来源。',
    },
    {
      level: searchableFieldCount ? 'suggestion' : 'warning',
      title: '搜索体验',
      detail: searchableFieldCount ? `已配置 ${searchableFieldCount} 个可搜索字段。` : '建议至少配置一个可搜索字段。',
    },
    {
      level: hiddenRequiredControls.length ? 'error' : 'suggestion',
      title: '规则冲突',
      detail: hiddenRequiredControls.length ? `以下控件同时隐藏且必填：${hiddenRequiredControls.map((control) => control.name).join('、')}` : '未发现隐藏且必填的规则冲突。',
    },
    {
      level: enabledFilters.length ? 'suggestion' : 'warning',
      title: '筛选条件',
      detail: enabledFilters.length ? `已启用 ${enabledFilters.length} 个运行页筛选条件。` : '建议至少启用一个运行页筛选条件。',
    },
    {
      level: emptyTabs.length ? 'error' : 'suggestion',
      title: '数据展示列',
      detail: emptyTabs.length ? `以下 Tab 至少需要一个展示列：${emptyTabs.map((tab) => tab.name).join('、')}` : `所有 ${viewTabs.length} 个 Tab 均已配置展示列。`,
    },
    {
      level: unboundTabs.length ? 'error' : 'suggestion',
      title: 'Tab 可见范围',
      detail: unboundTabs.length ? `以下 Tab 尚未绑定角色、用户或组织：${unboundTabs.map((tab) => tab.name).join('、')}` : '所有 Tab 均已配置可见范围。',
    },
    {
      level: invalidViewFields.length ? 'error' : 'suggestion',
      title: '视图字段绑定',
      detail: invalidViewFields.length ? `以下筛选或列绑定字段不存在：${invalidViewFields.join('、')}` : '筛选条件和表格列均已绑定有效字段。',
    },
    ...(baseConfig.id === 'alert-center' ? [{
      level: 'suggestion' as const,
      title: '严重告警处理规则',
      detail: '建议确认严重告警已配置附件证据和处理时限必填规则。',
    }] : []),
  ];
  checks.push({
    level: flowErrors.length ? 'error' : flowWarnings.length ? 'warning' : 'suggestion',
    title: '流程设计完整性',
    detail: flowErrors.length
      ? `流程存在 ${flowErrors.length} 个阻断项：${flowErrors.map((item) => item.title).join('、')}`
      : flowWarnings.length
        ? `流程存在 ${flowWarnings.length} 个警告项：${flowWarnings.map((item) => item.title).join('、')}`
        : '流程结构、节点规则和触发绑定已通过核心发布校验。',
  });
  return checks;
}
