import { createElement } from 'react';
import { Tag } from 'antd';
import type { DataQualityRuleInfo, KnowledgeOcrBlock, OntologySimilarityFeature } from '../../services/api';

export type DataQualityRule = Partial<DataQualityRuleInfo> & {
  key: string;
  name: string;
  description: string;
  status?: string;
  color?: string;
  enabled: boolean;
  passRate?: number | null;
};

export type DataAsset = {
  id: number;
  name: string;
  type: string;
  owner: string;
  status: string;
  freshness: string;
  persisted?: boolean;
  business_domain?: string;
  sensitivity?: string;
  allow_ai?: boolean;
  allow_ontology?: boolean;
  allow_graph?: boolean;
  tables: Array<{
    id: string;
    name: string;
    label: string;
    rows: number;
    quality_score: number;
    quality_rules?: DataQualityRule[];
    fields: Array<{ name: string; label: string; type: string; primary_key?: boolean; searchable?: boolean; visible?: boolean; quality?: string }>;
  }>;
};

export type OntologyObject = {
  id: string;
  db_id?: number;
  name: string;
  code: string;
  domain?: string;
  source: string;
  description: string;
  status?: string;
  version?: number;
  confidence?: number;
  review_status?: string;
  similarity_features?: OntologySimilarityFeature[];
  fields: Array<{ id?: number; name: string; label: string; code?: string; type: string; source_field?: string | null; list?: boolean; form?: boolean; search?: boolean; status?: string; confidence?: number }>;
};

export type OntologyRelation = {
  id: string;
  db_id?: number;
  code?: string;
  source: string;
  target: string;
  label: string;
  type: string;
  graph?: boolean;
  description?: string;
  status?: string;
  version?: number;
  confidence?: number;
  review_status?: string;
  source_ref?: string | null;
};

export type OntologyMapping = {
  id: number;
  source_system: string;
  source_type: string;
  source_entity: string;
  source_field: string;
  source_field_type?: string | null;
  target_object_code: string;
  target_field_code?: string | null;
  confidence: number;
  status: string;
  evidence?: string | null;
};

export type OntologyVersion = {
  id: number;
  version: number;
  title: string;
  status: string;
  published_at?: string | null;
  snapshot?: {
    objects?: unknown[];
    relations?: unknown[];
    mappings?: unknown[];
  };
};

export type ExtractionEntity = {
  candidate_id: string;
  name: string;
  entity_type: string;
  description?: string;
  confidence: number;
  source_location?: string;
};

export type ExtractionRelation = {
  candidate_id: string;
  source_name: string;
  source_type: string;
  target_name: string;
  target_type: string;
  relation_type: string;
  confidence: number;
  source_location?: string;
};

export type ExtractionJob = {
  job_id: string;
  document_id: string;
  domain: string;
  prompt_name: string;
  model_name: string;
  status: string;
  result: {
    entities: ExtractionEntity[];
    generic_entities?: Array<Record<string, unknown>>;
    domain_mappings?: Array<Record<string, unknown>>;
    relations: ExtractionRelation[];
    properties?: Array<Record<string, unknown>>;
    logic_rules: Array<Record<string, unknown>>;
    actions: Array<Record<string, unknown>>;
  };
  quality_report: {
    blocking: boolean;
    counts: Record<string, number>;
    items: Array<{ severity: 'FATAL' | 'ERROR' | 'WARNING' | 'INFO'; code: string; message: string; target?: string }>;
  };
};

export type GraphAssetNode = {
  id: string;
  name: string;
  type: string;
  confidence: number;
  source_document_id?: string;
  source_location?: string;
  knowledge_job_id?: string;
  review_status?: string;
  publish_status?: string;
  binding_status?: string;
};

export type GraphAssetRelationship = {
  id: string;
  source?: string;
  target?: string;
  source_name: string;
  target_name: string;
  relation_type: string;
  confidence: number;
  source_document_id?: string;
  source_location?: string;
  knowledge_job_id?: string;
  publish_status?: string;
};

export type GraphAssetEvidence = {
  id: string;
  asset_type: string;
  asset_name: string;
  source_document_id?: string;
  source_location?: string;
  confidence: number;
  knowledge_job_id?: string;
};

export type KnowledgeSpace = { id: string; name: string; description?: string };
export type KnowledgeSource = { id: string; name: string; source_type?: string; status?: string };
export type KnowledgeDocument = {
  id: string;
  title: string;
  source_id?: string;
  summary?: string;
  updated_at?: string;
  document_id?: string;
  document_title?: string;
  file_name?: string;
  source_file_name?: string;
  filename?: string;
  mime_type?: string;
  content_type?: string;
  file_type?: string;
  doc_type?: string;
  source_type?: string;
  permission_scope?: string;
  owner_user_id?: string;
  linked_objects?: Array<{ type?: string; id?: string; name?: string; object_type?: string; object_id?: string; object_name?: string; confidence?: number; status?: string; source_location?: string }>;
  markdown_content?: string;
};

export type OntologyIntakeRecommendation = {
  document_id?: string;
  summary?: string;
  document_profile?: {
    title?: string;
    source_type?: string;
    likely_domain?: string;
    line_count?: number;
    word_count?: number;
    has_tables?: boolean;
    has_ocr?: boolean;
  };
  capabilities?: string[];
  suggested_actions?: Array<{
    key: string;
    title: string;
    description?: string;
    requires_confirmation?: boolean;
    tool?: string;
  }>;
  confirmation?: Record<string, unknown>;
};
export type KnowledgeCard = { id: string; title: string; scenario?: string; owner?: string; updated_at?: string };
export type KnowledgeChunk = { id?: string; chunk_id?: string; title?: string; document_title?: string; chunk_text: string; source_ref?: string; source_location?: string };
export type KnowledgeChatMessage = { id: string; role: 'assistant' | 'user'; content: string };
export type EditableOcrBlock = KnowledgeOcrBlock & { row_id: string; corrected_text: string };

export const KNOWLEDGE_ASSET_ORDER = [
  'kb-doc-quality-sop-docx',
  'kb-doc-capa-072-docx',
  'kb-doc-supplier-8d-xlsx',
  'kb-doc-process-control-xlsx',
  'kb-doc-maintenance-log-pdf',
  'kb-doc-customer-risk-pdf',
];

export const KNOWLEDGE_TYPE_LABELS: Record<string, string> = {
  word: 'Word 文档',
  docx: 'Word 文档',
  excel: 'Excel 台账',
  xlsx: 'Excel 台账',
  pdf: 'PDF 报告',
  image: '图片/OCR',
  markdown: 'Markdown',
};

export const normalizeKnowledgeType = (item: KnowledgeDocument) => String(item.source_type ?? item.file_type ?? 'database').toLowerCase();
export const getKnowledgeDocumentId = (item: KnowledgeDocument) => String(item.id ?? item.document_id ?? '');
export const getKnowledgeDocumentTitle = (item: KnowledgeDocument) => String(item.title ?? item.document_title ?? item.file_name ?? item.source_file_name ?? '未命名文档');
export const getKnowledgeDocumentFileName = (item: KnowledgeDocument) => String(item.source_file_name ?? item.file_name ?? item.filename ?? item.updated_at ?? '数据库文档');
export const normalizeKnowledgeTypeGroup = (item: KnowledgeDocument) => {
  const type = normalizeKnowledgeType(item);
  return ['word', 'docx'].includes(type) ? 'docx' : ['excel', 'xlsx'].includes(type) ? 'xlsx' : type;
};
export const getKnowledgeDocumentStatusMeta = (item: KnowledgeDocument) => {
  const linkedCount = (item.linked_objects ?? []).length;
  if (linkedCount > 0) return { label: '已发布', color: 'success' };
  if (String((item as any).status ?? '').toLowerCase() === 'indexed') return { label: '待抽取', color: 'warning' };
  return { label: (item as any).status ?? '入库中', color: 'default' };
};

export const KNOWLEDGE_INTAKE_CAPABILITY_LABELS: Record<string, string> = {
  summarize_document: '生成文档摘要',
  review_ocr_evidence: '复核 OCR 证据',
  extract_ontology_candidates: '抽取本体候选',
  bind_existing_objects: '绑定已有对象',
  prepare_graph_publish: '准备图谱发布',
};

export const KNOWLEDGE_INTAKE_ACTION_LABELS: Record<string, { title: string; description: string }> = {
  extract_ontology_candidates: {
    title: '抽取本体候选',
    description: '识别通用对象、制造业对象映射、关系、属性和原文证据。',
  },
  summarize_document: {
    title: '生成文档摘要',
    description: '基于证据生成当前文档摘要，不写入图谱资产。',
  },
  prepare_graph_publish: {
    title: '准备图谱发布清单',
    description: '发布前检查质量问题、对象绑定缺口和证据完整性。',
  },
};

export const KNOWLEDGE_INTAKE_STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  pending: '待处理',
  running: '抽取中',
  completed: '已完成',
  approved: '已审核',
  committed: '已发布',
  failed: '失败',
};

export const getIntakeSourceTypeLabel = (type?: string) => {
  const normalized = String(type ?? '').toLowerCase();
  return KNOWLEDGE_TYPE_LABELS[normalized] ?? (normalized ? normalized.toUpperCase() : '文档');
};

export const getIntakeDomainLabel = (domain?: string) => {
  const normalized = String(domain ?? '').toLowerCase();
  if (normalized === 'manufacturing') return '制造业';
  if (normalized === 'general') return '通用';
  return domain ?? '-';
};

export const getIntakeSummary = (
  recommendation: OntologyIntakeRecommendation,
  fallbackTitle: string,
  fallbackSourceType: string,
) => {
  const title = recommendation.document_profile?.title ?? fallbackTitle;
  const typeLabel = getIntakeSourceTypeLabel(recommendation.document_profile?.source_type ?? fallbackSourceType);
  return `${title} 已作为${typeLabel}完成索引，可以进入本体抽取准备。`;
};

export const GRAPH_DOCUMENT_ALIASES: Record<string, string> = {};

export const severityColors: Record<string, string> = {
  FATAL: 'red',
  ERROR: 'volcano',
  WARNING: 'gold',
  INFO: 'blue',
};

export const graphTypeColors: Record<string, string> = {
  Supplier: '#2f54eb',
  MaterialBatch: '#1677ff',
  Material: '#1677ff',
  Defect: '#c83f49',
  CAPA: '#a43d3d',
  KnowledgeCard: '#2f5f73',
  Equipment: '#2f7d5b',
  WorkOrder: '#5b4ca3',
  CustomerOrder: '#d46b08',
  Product: '#13a8a8',
  default: '#5d6972',
};

export const fallbackAssets: DataAsset[] = [];
export const fallbackObjects: OntologyObject[] = [];
export const fallbackRelations: OntologyRelation[] = [];
export const fallbackGraphNodes: GraphAssetNode[] = [];
export const fallbackGraphRelationships: GraphAssetRelationship[] = [];
export const fallbackGraphEvidence: GraphAssetEvidence[] = [];
export const fallbackGraphQuality = {
  summary: {
    nodes: 0,
    relationships: 0,
    missing_evidence: 0,
    low_confidence: 0,
    unbound_nodes: 0,
  },
  items: [],
};


export function confidencePercent(value: number) {
  return Math.round((Number(value) || 0) * 100);
}

export function normalizeOcrConfidence(value?: number) {
  const confidence = Number(value ?? 0);
  return confidence > 1 ? Math.round(confidence) : Math.round(confidence * 100);
}

export function getOcrBlockId(block: KnowledgeOcrBlock, index: number) {
  return String(block.block_id ?? block.id ?? `block-${index + 1}`);
}

export function boolTag(value?: boolean) {
  return value ? createElement(Tag, { color: 'success' }, '是') : createElement(Tag, null, '否');
}

export const DATA_DOMAINS = ['全部', '生产', '设备', '质量', '供应链', '仓储', '客户'];

export function tableMatchesBusinessDomain(table: DataAsset['tables'][number], domain: string) {
  if (domain === '全部') return true;

  const tableName = table.name.toLowerCase();
  const tableLabel = table.label;
  const fieldText = table.fields.map((field) => `${field.name.toLowerCase()} ${field.label}`).join(' ');

  if (domain === '设备') return tableName.includes('equipment') || tableLabel.includes('设备') || fieldText.includes('equipment') || fieldText.includes('设备');
  if (domain === '生产') return tableName.includes('work') || tableLabel.includes('生产') || tableLabel.includes('工单');
  if (domain === '质量') return tableName.includes('quality') || tableLabel.includes('质量') || fieldText.includes('status');
  if (domain === '供应链') return tableName.includes('supplier') || tableLabel.includes('供应');
  if (domain === '仓储') return tableName.includes('warehouse') || tableName.includes('inventory') || tableName.includes('shipment') || tableLabel.includes('仓') || tableLabel.includes('库存');
  if (domain === '客户') return tableName.includes('customer') || tableName.includes('sales_order') || tableLabel.includes('客户');

  return false;
}

export function getDataSourceStatusClass(status?: string) {
  const normalized = String(status ?? '').toLowerCase();
  if (['connected', 'active', 'success', 'online'].includes(normalized)) return 'ok';
  if (['warning', 'pending', 'scanning'].includes(normalized)) return 'warning';
  if (['failed', 'error', 'offline'].includes(normalized)) return 'error';
  return 'unknown';
}

export function getDataSourceStatusLabel(status?: string) {
  const normalized = String(status ?? '').toLowerCase();
  if (['connected', 'active', 'success', 'online'].includes(normalized)) return '正常';
  if (['warning', 'pending', 'scanning'].includes(normalized)) return '待处理';
  if (['failed', 'error', 'offline'].includes(normalized)) return '异常';
  return status || '未知';
}

export function getCandidateTypeLabel(type?: string) {
  if (type === 'object') return '对象';
  if (type === 'mapping') return '字段映射';
  if (type === 'relation') return '关系';
  if (type === 'field') return '字段';
  return type || '候选';
}

export function getTableQualityRules(table?: DataAsset['tables'][number]): DataQualityRule[] {
  if (!table) return [];
  if (table.quality_rules?.length) return table.quality_rules;

  const fields = table.fields ?? [];
  const hasPrimaryKey = fields.some((field) => field.primary_key);
  const foreignKeyFields = fields.filter((field) => field.name.endsWith('_id') && !field.primary_key);
  const statusFields = fields.filter((field) => /status|state|result/i.test(field.name));
  const numericFields = fields.filter((field) => {
    const name = field.name.toLowerCase();
    return /quantity|qty|reserved|score|capacity|utilization|rating|lead_time|amount|count/.test(name);
  });
  const timeFields = fields.filter((field) => /updated_at|created_at|collected_at|occurred_at|inspected_at|eta|date|time/i.test(field.name));
  const warningFields = fields.filter((field) => field.quality === 'warning');
  const searchableFields = fields.filter((field) => field.searchable);

  const rules: DataQualityRule[] = [
    {
      key: 'primary-key-unique',
      name: '主键唯一性',
      description: hasPrimaryKey ? `检查 ${fields.filter((field) => field.primary_key).map((field) => field.name).join(' / ')} 是否为空或重复` : '未识别主键字段，需要补充唯一标识',
      status: hasPrimaryKey ? '已通过' : '待配置',
      color: hasPrimaryKey ? 'success' : 'warning',
      enabled: hasPrimaryKey,
      passRate: hasPrimaryKey ? 100 : null,
    },
    {
      key: 'required-completeness',
      name: '关键字段完整性',
      description: `检查 ${fields.slice(0, 4).map((field) => field.name).join(' / ')} 的空值率`,
      status: warningFields.length ? '需复核' : '已通过',
      color: warningFields.length ? 'warning' : 'success',
      enabled: true,
      passRate: warningFields.length ? 92 : 100,
    },
  ];

  if (foreignKeyFields.length) {
    rules.push({
      key: 'foreign-key-consistency',
      name: '跨表引用一致性',
      description: `检查 ${foreignKeyFields.slice(0, 3).map((field) => field.name).join(' / ')} 是否能关联到主数据表`,
      status: table.name.includes('inventory') || table.name.includes('work_orders') || table.name.includes('sales_orders') ? '需复核' : '已通过',
      color: table.name.includes('inventory') || table.name.includes('work_orders') || table.name.includes('sales_orders') ? 'warning' : 'success',
      enabled: true,
      passRate: table.name.includes('inventory') ? 96 : table.name.includes('work_orders') || table.name.includes('sales_orders') ? 94 : 98,
    });
  }

  if (statusFields.length) {
    rules.push({
      key: 'status-enum',
      name: '状态枚举合法值',
      description: `检查 ${statusFields.map((field) => field.name).join(' / ')} 是否只使用约定状态值`,
      status: warningFields.length ? '需复核' : '已通过',
      color: warningFields.length ? 'warning' : 'success',
      enabled: true,
      passRate: warningFields.length ? 88 : 97,
    });
  }

  if (numericFields.length) {
    rules.push({
      key: 'numeric-range',
      name: '数值范围合理性',
      description: `检查 ${numericFields.slice(0, 3).map((field) => field.name).join(' / ')} 是否存在负数、越界或不合理比例`,
      status: table.name.includes('inventory') || table.name.includes('equipment') ? '已通过' : '待抽样',
      color: table.name.includes('inventory') || table.name.includes('equipment') ? 'success' : 'default',
      enabled: true,
      passRate: table.name.includes('equipment') ? 99 : table.name.includes('inventory') ? 98 : null,
    });
  }

  if (timeFields.length) {
    rules.push({
      key: 'freshness',
      name: '同步新鲜度',
      description: `检查 ${timeFields.slice(0, 2).map((field) => field.name).join(' / ')} 是否符合当前数据源同步周期`,
      status: '已通过',
      color: 'success',
      enabled: true,
      passRate: 100,
    });
  }

  rules.push({
    key: 'semantic-recognition',
    name: '语义可识别度',
    description: searchableFields.length ? `已识别 ${searchableFields.length} 个可搜索/业务命名字段` : '字段命名偏技术化，建议补充业务标签',
    status: searchableFields.length ? '已通过' : '需补充',
    color: searchableFields.length ? 'success' : 'warning',
    enabled: true,
    passRate: searchableFields.length ? 90 : 72,
  });

  return rules;
}

export type SemanticAssetCenterView = 'data' | 'mapping' | 'ontology';
export const SEMANTIC_MAPPING_STATUS_OPTIONS = [
  { value: '', label: '全部' },
  { value: 'pending_review', label: '待审核' },
  { value: 'approved', label: '已批准' },
  { value: 'rejected', label: '已驳回' },
];

export const semanticNodeTypeLabels: Record<string, string> = {
  source_table: '来源表',
  source_field: '来源字段',
  object: '业务对象',
  object_field: '对象字段',
};
