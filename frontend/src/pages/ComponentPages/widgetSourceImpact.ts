import {bindWidgetSource, widgetSourceId, type PageDefinition, type PageWidget} from './model';

function changedText(previous?: string | null, next?: string | null) {
  return Boolean(previous?.trim()) && previous !== next;
}

function changedSetting(previous: unknown, next: unknown) {
  return previous != null && (!Array.isArray(previous) || previous.length > 0)
    && JSON.stringify(previous) !== JSON.stringify(next);
}

function resetSettings(previous: PageWidget, next: PageWidget, hasOldSource: boolean): string[] {
  const oldList = previous.listSettings;
  const newList = next.listSettings;
  const oldFilter = previous.filterSettings;
  const newFilter = next.filterSettings;
  const settings: Array<[boolean, string]> = [
    [hasOldSource && changedText(previous.dimension, next.dimension), '分组字段'],
    [changedText(previous.measure, next.measure) || (Boolean(previous.aggregate) && previous.aggregate !== 'count' && previous.aggregate !== next.aggregate), '统计口径'],
    [changedText(previous.expression, next.expression), '自定义公式'],
    [changedText(previous.sharedMetricId, next.sharedMetricId), '共享指标引用'],
    [changedSetting(oldList?.columns, newList?.columns), '显示列'],
    [changedSetting(oldList?.sortableColumns, newList?.sortableColumns) || changedSetting(oldList?.defaultSort, newList?.defaultSort), '排序设置'],
    [changedSetting(oldList?.displayGroups, newList?.displayGroups), '显示权限组'],
    [changedSetting(previous.filterFields, next.filterFields), '筛选字段'],
    [changedSetting(oldFilter?.requiredFields, newFilter?.requiredFields), '必填筛选条件'],
    [changedSetting(oldFilter?.schemes, newFilter?.schemes), '筛选方案'],
  ];
  return settings.filter(([changed])=>changed).map(([,label])=>label);
}

export function widgetSourceChangeImpact(before: PageDefinition, next: PageDefinition, id: string): string[] {
  const previousWidgets = new Map(before.widgets.map(widget=>[widget.id,widget]));
  const nextWidgets = new Map(next.widgets.map(widget=>[widget.id,widget]));
  const impacts: string[] = [];

  for (const widget of before.widgets) {
    const updated = nextWidgets.get(widget.id);
    if (!updated) continue;

    const sourceId = widgetSourceId(before,widget);
    const settings = resetSettings(widget,updated,sourceId!=null);
    if (widget.id !== id && sourceId !== widgetSourceId(next,updated)) {
      impacts.push(`同步切换「${widget.title}」的业务来源${settings.length?`并重置${settings.join('、')}`:''}`);
    } else if (settings.length) {
      impacts.push(`重置「${widget.title}」的${settings.join('、')}`);
    }

    for (const targetId of new Set(widget.targetWidgetIds)) {
      const target = previousWidgets.get(targetId);
      if (target && sourceId != null && widgetSourceId(before,target) === sourceId && !updated.targetWidgetIds?.includes(targetId)) {
        impacts.push(`移除「${widget.title}」到「${target.title}」的联动`);
      }
    }
  }
  return impacts;
}

export function planWidgetSourceChange(definition: PageDefinition, id: string, formId: number) {
  const widget = definition.widgets.find(item=>item.id===id);
  const next = widget && widgetSourceId(definition,widget) !== formId
    ? bindWidgetSource(definition,id,formId)
    : definition;
  return {
    definition:next,
    impacts:next === definition ? [] : widgetSourceChangeImpact(definition,next,id),
  };
}
