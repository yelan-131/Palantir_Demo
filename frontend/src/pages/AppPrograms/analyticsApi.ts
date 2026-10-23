import api, { getAppProgramData } from '@/services/api';
import type { AnalyticsEditorState, AnalyticsFilters, AnalyticsVersion, AnalyticsVersionDetail, RuntimeAnalyticsData, RuntimeAnalyticsDesign, SharedMetricDefinition, SharedMetricEntry, SharedMetricReferences, SharedMetricImpact } from './analyticsTypes';

const path = (programId: string) => `/dashboard/programs/${encodeURIComponent(programId)}/analytics`;
export const getAnalyticsEditor = (programId: string) => api.get<AnalyticsEditorState>(`${path(programId)}/editor`);
export const previewAnalyticsDesign = (programId: string, design: RuntimeAnalyticsDesign, query?: {filters: AnalyticsFilters; widget_filters: Record<string, AnalyticsFilters>}) =>
  api.post<{analyticsDesign: RuntimeAnalyticsDesign; analyticsData: RuntimeAnalyticsData}>(`${path(programId)}/preview`, {design, limit: 500, ...query});
export const saveAnalyticsDraft = (programId: string, design: RuntimeAnalyticsDesign, expectedRevision: string) =>
  api.put<AnalyticsEditorState>(`${path(programId)}/draft`, {design, expectedRevision});
export const publishAnalyticsDesign = (programId: string, design: RuntimeAnalyticsDesign, expectedRevision: string, note = '') =>
  api.post<AnalyticsEditorState>(`${path(programId)}/publish`, {design, expectedRevision, note});
export const listAnalyticsVersions = (programId: string, offset = 0) =>
  api.get<{items: AnalyticsVersion[]; total: number}>(`${path(programId)}/versions`, {params: {offset, limit: 20}});
export const getAnalyticsVersion = (programId: string, version: number) =>
  api.get<AnalyticsVersionDetail>(`${path(programId)}/versions/${version}`);

const libraryPath = '/dashboard/analytics/metrics';
export const listSharedAnalyticsMetrics = () => api.get<{items: SharedMetricEntry[]}>(libraryPath);
export const getSharedAnalyticsMetric = (id: string) => api.get<SharedMetricEntry>(`${libraryPath}/${encodeURIComponent(id)}`);
export const createSharedAnalyticsMetric = (definition: SharedMetricDefinition) => api.post<SharedMetricEntry>(libraryPath, definition);
export const saveSharedAnalyticsMetric = (id: string, definition: SharedMetricDefinition, expectedRevision: string) =>
  api.put<SharedMetricEntry>(`${libraryPath}/${encodeURIComponent(id)}/draft`, {definition, expectedRevision});
export const getSharedMetricReferences = (id: string) => api.get<SharedMetricReferences>(`${libraryPath}/${encodeURIComponent(id)}/references`);
export const checkSharedMetricImpact = (id: string, definition: SharedMetricDefinition, expectedRevision: string) =>
  api.post<SharedMetricImpact>(`${libraryPath}/${encodeURIComponent(id)}/impact`, {definition, expectedRevision});
export const publishSharedAnalyticsMetric = (id: string, definition: SharedMetricDefinition, expectedRevision: string, impactToken: string, note: string) =>
  api.post<SharedMetricEntry & {updatedBoards: Array<{programId: string; version: number}>; impact: SharedMetricReferences['counts']}>(`${libraryPath}/${encodeURIComponent(id)}/publish`, {definition, expectedRevision, impactToken, note});

export async function loadPublishedAnalytics(programId: string, query: {filters: AnalyticsFilters; widget_filters: Record<string, AnalyticsFilters>}) {
  try {
    return await getAppProgramData(programId, 500, {filters: JSON.stringify(query.filters), widget_filters: JSON.stringify(query.widget_filters)});
  } catch (error) {
    const response = (error as {response?: {status?: number; data?: {detail?: unknown}}})?.response;
    const staleFilter = response?.status === 422 && (response.data?.detail === '筛选字段未配置为全局筛选器' || response.data?.detail === '组件筛选字段不可用');
    if (!staleFilter) throw error;
    // Another tab may have removed a filter or widget. Read the new published
    // design once so the dashboard can discard invalid local filter bindings.
    return getAppProgramData(programId, 500, {filters: '{}', widget_filters: '{}'});
  }
}
