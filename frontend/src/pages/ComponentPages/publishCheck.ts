import type {PageDefinition, WidgetType} from './model';

type PropertyTarget = 'basic' | 'data' | 'interaction' | 'appearance';
type WidgetIssue = {id: string; errors: string[]; target: PropertyTarget};
export type PublishCheck = {errors: string[]; widgets: WidgetIssue[]};

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

const messages = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())) : [];

function targetFor(path: unknown[], type: WidgetType): PropertyTarget {
  const [field] = path;
  if (field === 'interaction' || field === 'targetWidgetIds') return type === 'record-filter' ? 'data' : 'interaction';
  if (['width', 'height', 'heightPercent', 'customWidth', 'customHeight', 'appearance', 'presentation'].includes(String(field))) return 'appearance';
  if (['title', 'type', 'chartType', 'roleIds', 'accessGroups', 'format', 'unit', 'threshold', 'workspaceModule'].includes(String(field))) return 'basic';
  return 'data';
}

export function normalizePublishCheck(definition: PageDefinition, payload: unknown, fallback?: string): PublishCheck {
  const issues = new Map<string, WidgetIssue>();
  const globalErrors = new Set<string>();
  const widgetIds = new Set(definition.widgets.map(widget => widget.id));
  const addWidgetIssue = (id: string, errors: string[], target: PropertyTarget) => {
    if (errors.length === 0) return;
    if (!widgetIds.has(id)) {
      errors.forEach(error => globalErrors.add(error));
      return;
    }
    const previous = issues.get(id);
    issues.set(id, {id, errors: [...new Set([...(previous?.errors ?? []), ...errors])], target: previous?.target ?? target});
  };

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const issue = asObject(item);
      if (typeof issue.msg !== 'string' || !issue.msg.trim()) continue;
      const location = Array.isArray(issue.loc) ? issue.loc : [];
      const widgetPath = location.indexOf('widgets');
      const index = location[widgetPath + 1];
      const widget = widgetPath >= 0 && typeof index === 'number' && Number.isInteger(index) ? definition.widgets[index] : undefined;
      if (widget) addWidgetIssue(widget.id, [issue.msg], targetFor(location.slice(widgetPath + 2), widget.type));
      else {
        const fieldPath = location.filter(part => part !== 'body').join(' / ');
        globalErrors.add(fieldPath ? `${fieldPath}：${issue.msg}` : issue.msg);
      }
    }
  } else {
    const detail = asObject(payload);
    const targets = asObject(detail.widgetTargets);
    for (const [id, errors] of Object.entries(asObject(detail.widgetErrors))) {
      const target = targets[id];
      addWidgetIssue(id, messages(errors), target === 'basic' || target === 'interaction' || target === 'appearance' ? target : 'data');
    }
    messages(detail.errors).forEach(error => globalErrors.add(error));
  }

  const widgets = [...issues.values()];
  const widgetMessages = new Set(widgets.flatMap(widget => widget.errors));
  const errors = [...globalErrors].filter(error => !widgetMessages.has(error));
  return {errors: errors.length === 0 && widgets.length === 0 && fallback ? [fallback] : errors, widgets};
}
