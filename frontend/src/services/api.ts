import axios from 'axios';

const apiBaseURL = import.meta.env.VITE_API_BASE_URL || '/api/v1';

const api = axios.create({
  baseURL: apiBaseURL,
  timeout: 30000,
  withCredentials: true,
});

// ── Request interceptor: attach Authorization: Bearer <token> ─────
api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem('mf_token');
  if (token) {
    cfg.headers = cfg.headers ?? {};
    (cfg.headers as Record<string, string>).Authorization = `Bearer ${token}`;
  }
  return cfg;
});

// ── Response interceptor: auto-logout on 401 ──────────────────────
api.interceptors.response.use(
  (resp) => resp,
  (err) => {
    const status = err?.response?.status;
    if (status === 401) {
      localStorage.removeItem('mf_token');
      localStorage.removeItem('mf_user');
      // Avoid redirect loop on the login page itself
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  },
);

// Dashboard
export const getOverview = () => api.get('/dashboard/overview');
export const getOEE = (lineId?: number) => api.get('/dashboard/oee', { params: { line_id: lineId } });
export const getProductionStats = (days?: number) => api.get('/dashboard/production', { params: { days } });
export const getAlerts = (limit?: number) => api.get('/dashboard/alerts', { params: { limit } });

// Data Sources
export const listDataSources = (params?: Record<string, string>) => api.get('/data-sources', { params });
export const createDataSource = (data: Record<string, unknown>) => api.post('/data-sources', data);
export const getDataSource = (id: number) => api.get(`/data-sources/${id}`);
export const deleteDataSource = (id: number) => api.delete(`/data-sources/${id}`);
export const testConnection = (id: number) => api.post(`/data-sources/${id}/test`);
export const triggerSync = (id: number) => api.post(`/data-sources/${id}/sync`);
export const getSyncStatus = (id: number) => api.get(`/data-sources/${id}/status`);
export const previewData = (id: number, limit?: number) => api.get(`/data-sources/${id}/preview`, { params: { limit } });

// Ontology
export const listEntityTypes = () => api.get('/ontology/entities');
export const getEntityType = (type: string) => api.get(`/ontology/entities/${type}`);
export const listEntityInstances = (type: string, params?: Record<string, number>) =>
  api.get(`/ontology/entities/${type}/instances`, { params });
export const listRelationTypes = () => api.get('/ontology/relations');

// Graph
export const executeCypher = (query: string, params?: Record<string, unknown>) =>
  api.post('/graph/query', { query, params });
export const getNeighbors = (entityId: number, limit?: number) =>
  api.get(`/graph/neighbors/${entityId}`, { params: { limit } });
export const getShortestPath = (srcId: number, tgtId: number) =>
  api.get('/graph/path', { params: { src_id: srcId, tgt_id: tgtId } });
export const getSubgraph = (entityId: number, depth?: number) =>
  api.get(`/graph/subgraph/${entityId}`, { params: { depth } });
export const getGraphStats = () => api.get('/graph/stats');
export const listGraphAssetNodes = (params?: { search?: string; entity_type?: string }) =>
  api.get('/graph/assets/nodes', { params });
export const listGraphAssetRelationships = (params?: { search?: string; relation_type?: string }) =>
  api.get('/graph/assets/relationships', { params });
export const getGraphAssetQuality = () => api.get('/graph/assets/quality');
export const listGraphAssetEvidence = () => api.get('/graph/assets/evidence');

// Graph — new endpoints (Phase 2)
export const getGraphEntity = (label: string, entityId: number) =>
  api.get(`/graph/entity/${label}/${entityId}`);
export const getGraphRelationships = (label: string, entityId: number, params?: Record<string, unknown>) =>
  api.get(`/graph/entity/${label}/${entityId}/relationships`, { params });
export const getImpactAnalysis = (entityId: number, maxHops?: number) =>
  api.get(`/graph/impact-analysis/${entityId}`, { params: { max_hops: maxHops } });
export const getTraceChain = (entityId: number, maxHops?: number) =>
  api.get(`/graph/trace/${entityId}`, { params: { max_hops: maxHops } });
export const getCentrality = (limit?: number) =>
  api.get('/graph/analytics/centrality', { params: { limit } });
export const syncQualityDemoGraph = () => api.post('/graph/sync/quality-demo');
export const getBusinessImpactAnalysis = (params: {
  object_type: string;
  object_id: string;
  max_hops?: number;
  limit?: number;
}) => api.get('/graph/impact-analysis-by-object', { params, timeout: 6000 });
export const getEntityRelationships = (entityType: string, entityId: number, relType?: string) =>
  api.get(`/ontology/entities/${entityType}/instances/${entityId}/relationships`, { params: { rel_type: relType } });

// Semantic low-code assets
export const listSemanticDataAssets = () => api.get('/semantic-assets/data-assets');
export const listSemanticOntologyObjects = () => api.get('/semantic-assets/ontology-objects');
export const listSemanticOntologyRelations = () => api.get('/semantic-assets/ontology-relations');
export const listSemanticPageContracts = () => api.get('/semantic-assets/page-contracts');
export const getSemanticPageContract = (route: string) =>
  api.get('/semantic-assets/page-contracts/by-route', { params: { route } });

// Knowledge base / local RAG MVP
export const listKnowledgeSpaces = () => api.get('/knowledge/spaces');
export const listKnowledgeSources = () => api.get('/knowledge/sources');
export const listKnowledgeDocuments = (sourceId?: string) =>
  api.get('/knowledge/documents', { params: { source_id: sourceId } });
export const listKnowledgeChunks = (documentId: string) =>
  api.get(`/knowledge/documents/${documentId}/chunks`);
export const listKnowledgeCards = (params?: { space_id?: string; status?: string }) =>
  api.get('/knowledge/cards', { params });
export const getRelatedKnowledgeCards = (params?: { object_type?: string; object_id?: string; limit?: number }) =>
  api.get('/knowledge/related-cards', { params });
export const getRelatedKnowledge = (params?: { object_type?: string; object_id?: string; limit?: number }) =>
  api.get('/knowledge/related', { params });
export const suggestKnowledgeBindings = (data: { text: string; limit?: number }) =>
  api.post('/knowledge/binding-candidates', data);
export const getKnowledgeOcrPipeline = () => api.get('/knowledge/ocr-pipeline');
export const uploadKnowledgeAsset = (
  file: File,
  params?: { permission_scope?: string; owner_user_id?: string },
) => {
  const formData = new FormData();
  formData.append('file', file);
  return api.post('/knowledge/assets/upload', formData, {
    params,
    headers: { 'Content-Type': 'multipart/form-data' },
  });
};
export const createKnowledgeExtractionJob = (
  file: File,
  params?: {
    domain?: string;
    prompt_name?: string;
    model_name?: string;
    permission_scope?: string;
    owner_user_id?: string;
  },
) => {
  const formData = new FormData();
  formData.append('file', file);
  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      formData.append(key, String(value));
    }
  });
  return api.post('/knowledge/extraction-jobs', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
};
export const getKnowledgeExtractionJob = (jobId: string) =>
  api.get(`/knowledge/extraction-jobs/${jobId}`);
export const approveKnowledgeExtractionJob = (jobId: string, approvedResult?: Record<string, unknown>) =>
  api.post(`/knowledge/extraction-jobs/${jobId}/approve`, { approved_result: approvedResult });
export const commitKnowledgeExtractionJobToGraph = (jobId: string) =>
  api.post(`/knowledge/extraction-jobs/${jobId}/commit-to-graph`);
export const exportKnowledgeExtractionJob = (jobId: string, format: string) =>
  api.get(`/knowledge/extraction-jobs/${jobId}/export`, { params: { format }, responseType: 'blob' });
export const searchKnowledge = (data: {
  query: string;
  limit?: number;
  object_type?: string;
  object_id?: string;
}) => api.post('/knowledge/search', data);

// Pipeline
export const listPipelines = () => api.get('/pipelines');
export const createPipeline = (data: Record<string, unknown>) => api.post('/pipelines', data);
export const getPipeline = (id: number) => api.get(`/pipelines/${id}`);
export const runPipeline = (id: number) => api.post(`/pipelines/${id}/run`);
export const listPipelineRuns = (id: number) => api.get(`/pipelines/${id}/runs`);

// Analytics — Chart Binding (Phase 3)
export const getAggregate = (params: Record<string, unknown>) =>
  api.get('/analytics/aggregate', { params });
export const getTimeseries = (params: Record<string, unknown>) =>
  api.get('/analytics/timeseries', { params });
export const getDistribution = (params: Record<string, unknown>) =>
  api.get('/analytics/distribution', { params });

// Maintenance
export const getEquipmentHealth = () => api.get('/maintenance/equipment-health');
export const getSingleEquipmentHealth = (id: number) => api.get(`/maintenance/equipment/${id}/health`);
export const getFaultPredictions = (params?: Record<string, unknown>) =>
  api.get('/maintenance/predictions', { params });
export const getWorkOrders = (params?: Record<string, string>) =>
  api.get('/maintenance/work-orders', { params });

// Quality
export const getSPCData = (parameter: string, params?: Record<string, unknown>) =>
  api.get(`/quality/spc/${parameter}`, { params });
export const listDefects = (params?: Record<string, unknown>) => api.get('/quality/defects', { params });
export const getDefectPareto = (days?: number) => api.get('/quality/defects/pareto', { params: { days } });
export const getTraceability = (entityId: number, entityType?: string) =>
  api.get(`/quality/traceability/${entityId}`, { params: { entity_type: entityType } });
export const listInspections = (params?: Record<string, unknown>) => api.get('/quality/inspections', { params });
export const listQualityEvents = () => api.get('/quality/events');
export const getQualityEventImpact = (eventId: string | number) => api.get(`/quality/events/${eventId}/impact`);
export const getQualityEventAiSuggestion = (eventId: string | number) => api.post(`/quality/events/${eventId}/ai-suggestion`);
export const executeQualityEventAction = (eventId: string | number, data: Record<string, unknown>) =>
  api.post(`/quality/events/${eventId}/actions`, data);
export const createCapa = (data: Record<string, unknown>) => api.post('/quality/capa', data);

// Supply Chain
export const listSuppliers = (params?: Record<string, unknown>) => api.get('/supply-chain/suppliers', { params });
export const getInventoryOverview = () => api.get('/supply-chain/inventory');
export const listShipments = (params?: Record<string, string>) => api.get('/supply-chain/shipments', { params });
export const getRiskAssessment = () => api.get('/supply-chain/risk-assessment');
export const getSupplyChainAnalytics = () => api.get('/supply-chain/analytics');

// AI Assistant
export const sendChat = (message: string, sessionId?: string) =>
  api.post('/ai/chat', { message, session_id: sessionId });
export const smartAnalyze = (query: string) => api.post('/ai/analyze', { query });
export const sendAgentChat = (data: Record<string, unknown>) => api.post('/ai/agent', data);
export const testAIProvider = (providerConfig: Record<string, unknown>) =>
  api.post('/ai/provider/test', { provider_config: providerConfig });
export const getAISettings = () => api.get('/ai/settings');
export const updateAISettings = (settings: Record<string, unknown>) => api.put('/ai/settings', { settings });
export const testSavedAISettings = () => api.post('/ai/settings/test');

// Reports
export const listReports = (params?: Record<string, unknown>) => api.get('/reports', { params });
export const createReport = (data: Record<string, unknown>) => api.post('/reports', data);
export const getReport = (id: number) => api.get(`/reports/${id}`);
export const updateReport = (id: number, data: Record<string, unknown>) => api.put(`/reports/${id}`, data);
export const deleteReport = (id: number) => api.delete(`/reports/${id}`);
export const createSnapshot = (id: number) => api.post(`/reports/${id}/snapshot`);
export const listSnapshots = (id: number) => api.get(`/reports/${id}/snapshots`);

// Model-Driven (Phase 2)
export const listModels = () => api.get('/model-driven/models');
export const createModel = (data: Record<string, unknown>) => api.post('/model-driven/models', data);
export const updateModel = (id: number, data: Record<string, unknown>) => api.put(`/model-driven/models/${id}`, data);
export const deleteModel = (id: number) => api.delete(`/model-driven/models/${id}`);
export const addField = (modelId: number, data: Record<string, unknown>) => api.post(`/model-driven/models/${modelId}/fields`, data);
export const importFromOntology = () => api.post('/model-driven/models/import-from-ontology');

export const listPages = () => api.get('/model-driven/pages');
export const createPage = (data: Record<string, unknown>) => api.post('/model-driven/pages', data);
export const generatePage = (data: Record<string, unknown>) => api.post('/model-driven/pages/generate', data);
export const deletePage = (id: number) => api.delete(`/model-driven/pages/${id}`);
export const getPageByName = (name: string) => api.get(`/model-driven/pages`).then(res => {
  const pages = res.data?.data || [];
  const page = pages.find((p: any) => p.name === name || p.route_path === `/dynamic/${name}`);
  return { data: page || null };
});

export const getModelData = (modelName: string, params?: Record<string, unknown>) =>
  api.get(`/model-driven/data/${modelName}`, { params });
export const createModelData = (modelName: string, data: Record<string, unknown>) =>
  api.post(`/model-driven/data/${modelName}`, data);
export const updateModelData = (modelName: string, id: number, data: Record<string, unknown>) =>
  api.put(`/model-driven/data/${modelName}/${id}`, data);
export const deleteModelData = (modelName: string, id: number) =>
  api.delete(`/model-driven/data/${modelName}/${id}`);

export const getFieldOptions = (
  modelName: string,
  params?: { label_field?: string; cascade_from?: string; cascade_value?: string | number },
) => api.get(`/model-driven/data/${modelName}/options`, { params });

export const getChildren = (modelName: string, recordId: number, childTable: string) =>
  api.get(`/model-driven/data/${modelName}/${recordId}/children/${childTable}`);

export const listMenus = () => api.get('/model-driven/menus');
export const createMenu = (data: Record<string, unknown>) => api.post('/model-driven/menus', data);
export const updateMenu = (id: number, data: Record<string, unknown>) => api.put(`/model-driven/menus/${id}`, data);
export const deleteMenu = (id: number) => api.delete(`/model-driven/menus/${id}`);

// Auth (Phase 3) — token now travels via Authorization header (interceptor above)
// Applications
export const listApplications = () => api.get('/applications');
export const getApplication = (id: number) => api.get(`/applications/${id}`);
export const listApplicationMenus = (id: number) => api.get(`/applications/${id}/menus`);
export const adminListApplications = () => api.get('/admin/applications');
export const adminCreateApplication = (data: Record<string, unknown>) => api.post('/admin/applications', data);
export const adminUpdateApplication = (id: number, data: Record<string, unknown>) => api.put(`/admin/applications/${id}`, data);
export const adminDeleteApplication = (id: number) => api.delete(`/admin/applications/${id}`);
export const adminUpdateApplicationBindings = (id: number, data: Record<string, unknown>) =>
  api.put(`/admin/applications/${id}/bindings`, data);

export const authLogin = (username: string, password: string) =>
  api.post('/auth/login', { username, password });
export const authLogout = () => api.post('/auth/logout');
export const authMe = () => api.get('/auth/me');

// Admin (Phase 3)
export const adminListUsers = () => api.get('/admin/users');
export const adminCreateUser = (data: Record<string, unknown>) => api.post('/admin/users', data);
export const adminUpdateUser = (id: number, data: Record<string, unknown>) => api.put(`/admin/users/${id}`, data);
export const adminDeleteUser = (id: number) => api.delete(`/admin/users/${id}`);
export const adminListOrgUnits = () => api.get('/admin/org-units');
export const adminCreateOrgUnit = (data: Record<string, unknown>) => api.post('/admin/org-units', data);
export const adminUpdateOrgUnit = (id: number, data: Record<string, unknown>) => api.put(`/admin/org-units/${id}`, data);
export const adminDeleteOrgUnit = (id: number) => api.delete(`/admin/org-units/${id}`);
export const adminListRoles = () => api.get('/admin/roles');
export const adminCreateRole = (data: Record<string, unknown>) => api.post('/admin/roles', data);
export const adminDeleteRole = (id: number) => api.delete(`/admin/roles/${id}`);
export const adminSetPermissions = (data: Record<string, unknown>) => api.put('/admin/roles/0/permissions', data);

// Audit Logs
export const listAuditLogs = (params?: Record<string, unknown>) => api.get('/admin/audit-logs', { params });

// Workflow (Phase 3)
export const wfListDefinitions = () => api.get('/workflow/definitions');
export const wfGetDefinition = (id: number) => api.get(`/workflow/definitions/${id}`);
export const wfCreateDefinition = (data: Record<string, unknown>) => api.post('/workflow/definitions', data);
export const wfUpdateDefinition = (id: number, data: Record<string, unknown>) => api.put(`/workflow/definitions/${id}`, data);
export const wfDeleteDefinition = (id: number) => api.delete(`/workflow/definitions/${id}`);
export const wfStartInstance = (defId: number, data: Record<string, unknown>) =>
  api.post(`/workflow/definitions/${defId}/start`, data);
export const wfListInstances = (params?: Record<string, unknown>) =>
  api.get('/workflow/instances', { params });
export const wfApproveOrReject = (instId: number, data: Record<string, unknown>) =>
  api.post(`/workflow/instances/${instId}/act`, data);
export const wfCancelInstance = (instId: number) =>
  api.post(`/workflow/instances/${instId}/cancel`);
export const wfListNotifications = (userId: number) =>
  api.get('/workflow/notifications', { params: { user_id: userId } });
export const wfMarkNotificationRead = (id: number) =>
  api.post(`/workflow/notifications/${id}/read`);
export const wfMarkAllRead = (userId: number) =>
  api.post('/workflow/notifications/read-all', null, { params: { user_id: userId } });

// Notifications (Phase 3)
export const listNotifications = (params?: Record<string, unknown>) =>
  api.get('/notifications', { params });
export const createNotification = (data: Record<string, unknown>) =>
  api.post('/notifications', data);
export const markNotificationRead = (id: number) =>
  api.post(`/notifications/${id}/read`);
export const markAllNotificationsRead = (userId: number) =>
  api.post('/notifications/read-all', { user_id: userId });
export const getUnreadCount = (userId: number) =>
  api.get('/notifications/unread-count', { params: { user_id: userId } });
export const deleteNotification = (id: number) =>
  api.delete(`/notifications/${id}`);

// Rules Engine (Phase 3)
export const listRules = (params?: Record<string, unknown>) => api.get('/rules', { params });
export const createRule = (data: Record<string, unknown>) => api.post('/rules', data);
export const updateRule = (id: number, data: Record<string, unknown>) => api.put(`/rules/${id}`, data);
export const deleteRule = (id: number) => api.delete(`/rules/${id}`);
export const validateRule = (id: number) => api.post(`/rules/${id}/validate`);

// Template Marketplace (Phase 4)
export const listTemplates = () => api.get('/templates');
export const getTemplate = (id: number) => api.get(`/templates/${id}`);
export const instantiateTemplate = (id: number, data?: Record<string, unknown>) =>
  api.post(`/templates/${id}/instantiate`, data || {});

// Configuration Import/Export (Phase 4)
export const exportConfig = () => api.get('/config/export');
export const exportModelConfig = (modelName: string) => api.get(`/config/export/${modelName}`);
export const importConfig = (config: Record<string, unknown>, mode?: string) =>
  api.post('/config/import', { config, mode: mode || 'merge' });

// Scheduler (Phase 4)
export const listScheduledJobs = () => api.get('/scheduler/jobs');
export const createScheduledJob = (data: Record<string, unknown>) => api.post('/scheduler/jobs', data);
export const updateScheduledJob = (id: number, data: Record<string, unknown>) => api.put(`/scheduler/jobs/${id}`, data);
export const deleteScheduledJob = (id: number) => api.delete(`/scheduler/jobs/${id}`);
export const triggerJob = (id: number) => api.post(`/scheduler/jobs/${id}/trigger`);

// Full-Text Search (Phase 4)
export const crossEntitySearch = (q: string, models?: string) =>
  api.get('/search', { params: { q, models } });

// AI Builder (Phase 4)
export const suggestModel = (description: string) => api.post('/ai-builder/suggest-model', { description });
export const suggestPage = (modelName: string) => api.post('/ai-builder/suggest-page', { model_name: modelName });

// Platform Forms
export type PlatformFormStatus = 'draft' | 'active' | 'archived';
export type PlatformFieldType =
  | 'string'
  | 'text'
  | 'number'
  | 'integer'
  | 'decimal'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'enum'
  | 'json'
  | 'relation';

export interface PlatformFormField {
  id: number;
  form_id: number;
  field_name: string;
  label: string;
  field_type: PlatformFieldType | string;
  required: boolean;
  visible_in_list: boolean;
  visible_in_form: boolean;
  searchable: boolean;
  sortable: boolean;
  archived: boolean;
  default_value?: string | null;
  enum_values?: Record<string, unknown> | null;
  validation?: Record<string, unknown> | null;
  ui_config?: Record<string, unknown> | null;
  sort_order: number;
}

export interface PlatformForm {
  id: number;
  name: string;
  code: string;
  description?: string | null;
  model_id?: number | null;
  table_name?: string | null;
  status: PlatformFormStatus | string;
  config?: Record<string, unknown> | null;
  owner_id?: number | null;
  fields?: PlatformFormField[];
  applications?: Array<Record<string, unknown>>;
}

export interface PlatformMenuNode {
  id: number;
  application_id: number;
  parent_id?: number | null;
  node_type: 'group' | 'form' | string;
  title: string;
  icon?: string | null;
  form_id?: number | null;
  route_path?: string | null;
  visible: boolean;
  default_entry: boolean;
  sort_order: number;
  config?: Record<string, unknown> | null;
}

export interface PlatformDynamicRecord {
  id: number;
  form_id: number;
  data: Record<string, unknown>;
  status: string;
  created_by?: number | null;
  updated_by?: number | null;
  created_at?: string;
  updated_at?: string;
}

export interface PlatformApplicationFormBinding {
  id: number;
  application_id: number;
  form_id: number;
  alias?: string | null;
  enabled: boolean;
  default_view: string;
  data_scope?: string | null;
  allow_create: boolean;
  allow_edit: boolean;
  allow_delete: boolean;
  allow_export: boolean;
  sort_order: number;
  form?: PlatformForm | null;
}

export const listPlatformForms = (params?: { application_id?: number }) =>
  api.get('/forms', { params });
export const createPlatformForm = (data: Record<string, unknown>) =>
  api.post('/forms', data);
export const getPlatformForm = (id: number | string) =>
  api.get(`/forms/${id}`);
export const updatePlatformForm = (id: number | string, data: Record<string, unknown>) =>
  api.put(`/forms/${id}`, data);
export const deletePlatformForm = (id: number | string) =>
  api.delete(`/forms/${id}`);

export const listApplicationFormBindings = (applicationId: number | string) =>
  api.get(`/forms/applications/${applicationId}/forms`);
export const upsertApplicationFormBinding = (applicationId: number | string, data: Record<string, unknown>) =>
  api.put(`/forms/applications/${applicationId}/forms`, data);
export const deleteApplicationFormBinding = (applicationId: number | string, formId: number | string) =>
  api.delete(`/forms/applications/${applicationId}/forms/${formId}`);

export const createPlatformFormField = (formId: number | string, data: Record<string, unknown>) =>
  api.post(`/forms/${formId}/fields`, data);
export const updatePlatformFormField = (
  formId: number | string,
  fieldId: number | string,
  data: Record<string, unknown>,
) => api.put(`/forms/${formId}/fields/${fieldId}`, data);
export const archivePlatformFormField = (formId: number | string, fieldId: number | string) =>
  api.delete(`/forms/${formId}/fields/${fieldId}`);

export const listPlatformFormLayouts = (formId: number | string) =>
  api.get(`/forms/${formId}/layouts`);
export const upsertPlatformFormLayout = (
  formId: number | string,
  layoutType: string,
  data: Record<string, unknown>,
) => api.put(`/forms/${formId}/layouts/${layoutType}`, data);

export const listPlatformFormActions = (formId: number | string) =>
  api.get(`/forms/${formId}/actions`);
export const upsertPlatformFormAction = (formId: number | string, data: Record<string, unknown>) =>
  api.post(`/forms/${formId}/actions`, data);
export const updatePlatformFormAction = (
  formId: number | string,
  actionId: number | string,
  data: Record<string, unknown>,
) => api.put(`/forms/${formId}/actions/${actionId}`, data);
export const deletePlatformFormAction = (formId: number | string, actionId: number | string) =>
  api.delete(`/forms/${formId}/actions/${actionId}`);

export const listPlatformFormPermissions = (formId: number | string) =>
  api.get(`/forms/${formId}/permissions`);
export const upsertPlatformFormPermission = (formId: number | string, data: Record<string, unknown>) =>
  api.post(`/forms/${formId}/permissions`, data);
export const updatePlatformFormPermission = (
  formId: number | string,
  permissionId: number | string,
  data: Record<string, unknown>,
) => api.put(`/forms/${formId}/permissions/${permissionId}`, data);
export const deletePlatformFormPermission = (formId: number | string, permissionId: number | string) =>
  api.delete(`/forms/${formId}/permissions/${permissionId}`);

export const listPlatformDynamicRecords = (formId: number | string, params?: Record<string, unknown>) =>
  api.get(`/forms/${formId}/records`, { params });
export const createPlatformDynamicRecord = (formId: number | string, data: Record<string, unknown>) =>
  api.post(`/forms/${formId}/records`, { data });
export const getPlatformDynamicRecord = (formId: number | string, recordId: number | string) =>
  api.get(`/forms/${formId}/records/${recordId}`);
export const updatePlatformDynamicRecord = (
  formId: number | string,
  recordId: number | string,
  data: Record<string, unknown>,
) => api.put(`/forms/${formId}/records/${recordId}`, { data });
export const deletePlatformDynamicRecord = (formId: number | string, recordId: number | string) =>
  api.delete(`/forms/${formId}/records/${recordId}`);

export const listPlatformMenuNodes = (applicationId: number | string) =>
  api.get(`/forms/applications/${applicationId}/menu-nodes`);
export const createPlatformMenuNode = (applicationId: number | string, data: Record<string, unknown>) =>
  api.post(`/forms/applications/${applicationId}/menu-nodes`, data);
export const updatePlatformMenuNode = (
  applicationId: number | string,
  nodeId: number | string,
  data: Record<string, unknown>,
) => api.put(`/forms/applications/${applicationId}/menu-nodes/${nodeId}`, data);
export const deletePlatformMenuNode = (applicationId: number | string, nodeId: number | string) =>
  api.delete(`/forms/applications/${applicationId}/menu-nodes/${nodeId}`);

export const listWorkflowBindings = (formId: number | string) =>
  api.get(`/forms/${formId}/workflow-bindings`);
export const upsertWorkflowBinding = (formId: number | string, data: Record<string, unknown>) =>
  api.post(`/forms/${formId}/workflow-bindings`, data);
export const updateWorkflowBinding = (
  formId: number | string,
  bindingId: number | string,
  data: Record<string, unknown>,
) => api.put(`/forms/${formId}/workflow-bindings/${bindingId}`, data);
export const deleteWorkflowBinding = (formId: number | string, bindingId: number | string) =>
  api.delete(`/forms/${formId}/workflow-bindings/${bindingId}`);

export default api;
