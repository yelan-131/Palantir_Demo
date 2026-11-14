import { widgetSourceId, type PageDefinition, type PageWidget, type WidgetType } from './model';

export const componentNames: Record<WidgetType, string> = {
  'record-list': '业务列表', 'record-filter': '业务筛选', metric: '指标卡', chart: '分组图表', workspace: '工作台模块',
};

type ComponentProperties = Partial<Pick<PageWidget, 'title' | 'width' | 'dataBinding' | 'dimension' |
  'measure' | 'aggregate' | 'expression' | 'customWidth' | 'customHeight' | 'height' |
  'showFilters' | 'filterFields' | 'chartType' | 'format' | 'unit' | 'threshold'>>;

export type ComponentOperation =
  | { action: 'add'; widget_id: string; widget_type: WidgetType }
  | { action: 'edit'; widget_id: string; properties?: ComponentProperties;
      appearance?: PageWidget['appearance']; interaction?: Pick<Partial<PageWidget>, 'interaction' | 'targetWidgetIds'>;
      list_settings?: PageWidget['listSettings']; filter_settings?: PageWidget['filterSettings'] };

export function newComponent(definition: PageDefinition, id: string, type: WidgetType, firstField?: string): PageWidget {
  return {
    id, type, title: componentNames[type], width: type === 'metric' ? 6 : 24, aggregate: 'count',
    showFilters: false,
    targetWidgetIds: type === 'record-filter' ? definition.widgets.filter(widget =>
      widget.type === 'record-list' && widgetSourceId(definition, widget) === definition.sourceFormId).map(widget => widget.id) : undefined,
    dimension: type === 'chart' ? definition.filterFields[0] || firstField : undefined,
  };
}

export function applyComponentOperations(definition: PageDefinition, operations: ComponentOperation[],
  formFields: (id: number) => string[] | undefined) {
  if (!Array.isArray(operations) || operations.length === 0) throw new Error('请提供至少一项组件操作');
  const widgets = [...definition.widgets];
  const changed = new Set<string>();
  for (const operation of operations) {
    const index = widgets.findIndex(widget => widget.id === operation.widget_id);
    if (operation.action === 'add') {
      if (index !== -1) throw new Error(`组件标识已存在：${operation.widget_id}`);
      if (widgets.length >= 30) throw new Error('页面最多支持 30 个组件');
      const firstField = definition.sourceFormId ? formFields(definition.sourceFormId)?.[0] : undefined;
      widgets.push(newComponent({ ...definition, widgets }, operation.widget_id, operation.widget_type, firstField));
    } else if (operation.action === 'edit') {
      if (index === -1) throw new Error(`找不到组件：${operation.widget_id}`);
      const current = widgets[index];
      if (operation.list_settings && current.type !== 'record-list') throw new Error('列表设置仅适用于业务列表');
      if (operation.filter_settings && current.type !== 'record-filter') throw new Error('筛选设置仅适用于业务筛选');
      if (operation.interaction?.interaction !== undefined && current.type !== 'chart'
        && !(current.type === 'record-filter' && operation.interaction.interaction === 'filter')) {
        throw new Error('点击行为仅适用于分组图表');
      }
      if (operation.interaction?.targetWidgetIds !== undefined && !['record-filter', 'chart'].includes(current.type)) {
        throw new Error('业务筛选和分组图表可以设置联动目标');
      }
      widgets[index] = {
        ...current, ...operation.properties, ...operation.interaction,
        ...(operation.appearance ? { appearance: { ...current.appearance, ...operation.appearance } } : {}),
        ...(operation.list_settings ? { listSettings: { ...current.listSettings, ...operation.list_settings } } : {}),
        ...(operation.filter_settings ? { filterSettings: { ...current.filterSettings, ...operation.filter_settings } } : {}),
      };
    } else {
      throw new Error('不支持此组件操作');
    }
    changed.add(operation.widget_id);
  }
  const next = { ...definition, widgets };
  for (const widget of widgets) {
    const source = widgetSourceId(next, widget);
    const previous = definition.widgets.find(item => item.id === widget.id);
    if (changed.has(widget.id) && (!previous || widgetSourceId(definition, previous) !== source
      || previous.dimension !== widget.dimension || previous.measure !== widget.measure
      || previous.filterFields !== widget.filterFields || previous.filterSettings !== widget.filterSettings
      || previous.listSettings !== widget.listSettings)) {
      const fields = source ? formFields(source) : undefined;
      if (widget.dataBinding?.formId && !fields) throw new Error(`「${widget.title}」的业务来源不可用`);
      for (const field of [widget.dimension, widget.measure, ...(widget.filterFields ?? []),
        ...(widget.filterSettings?.requiredFields ?? []), ...(widget.listSettings?.columns ?? []),
        ...(widget.listSettings?.sortableColumns ?? []), widget.listSettings?.defaultSort?.field]) {
        if (field && !fields?.includes(field)) throw new Error(`「${widget.title}」的来源中没有字段 ${field}`);
      }
    }
    for (const id of widget.targetWidgetIds ?? []) {
      if (!changed.has(widget.id) && !changed.has(id)) continue;
      const target = widgets.find(item => item.id === id);
      if (!target || target.id === widget.id || target.type === 'record-filter' || !source || widgetSourceId(next, target) !== source) {
        throw new Error(`「${widget.title}」的联动目标必须是同一业务来源的其他列表、指标或图表`);
      }
    }
  }
  return next;
}
