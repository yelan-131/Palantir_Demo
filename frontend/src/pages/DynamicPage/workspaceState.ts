import type { ViewConfig, ViewFilterConfig } from '@/utils/viewConfig';

export interface RuntimeSortState { field?: string; order?: 'asc' | 'desc' }

const sameFilter = (before: ViewFilterConfig, after: ViewFilterConfig) => before.fieldName === after.fieldName
  && before.controlType === after.controlType && before.operator === after.operator;

/** Keep user input only where the newly published schema still gives it the same meaning. */
export function reconcilePublishedViewState(
  previous: ViewConfig | null,
  next: ViewConfig | null,
  values: Record<string, unknown>,
  sort: RuntimeSortState,
): { filterValues: Record<string, unknown>; sortState: RuntimeSortState } {
  const filterValues: Record<string, unknown> = {};
  if (Object.prototype.hasOwnProperty.call(values, 'keyword')) filterValues.keyword = values.keyword;
  for (const filter of next?.filters || []) {
    if (!filter.enabled) continue;
    const previousFilter = previous?.filters.find(item => item.id === filter.id && sameFilter(item, filter))
      || previous?.filters.find(item => sameFilter(item, filter));
    if (previousFilter && Object.prototype.hasOwnProperty.call(values, previousFilter.id)) filterValues[filter.id] = values[previousFilter.id];
  }
  const sortable = next?.table.columns.some(column => column.enabled && column.sortable && column.fieldName === sort.field);
  return { filterValues, sortState: sortable && sort.order ? { ...sort } : {} };
}

export function canConfigureWorkspace(isAdmin: boolean, configureAllowed: boolean): boolean {
  // Business toolbar visibility cannot remove an administrator's design access.
  return isAdmin && configureAllowed;
}
