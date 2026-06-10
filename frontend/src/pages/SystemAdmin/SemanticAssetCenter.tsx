import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ApartmentOutlined,
  BranchesOutlined,
  CheckCircleOutlined,
  DatabaseOutlined,
  DownloadOutlined,
  FileSearchOutlined,
  InboxOutlined,
  NodeIndexOutlined,
  ReloadOutlined,
  RobotOutlined,
  SendOutlined,
  UserOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Divider,
  Empty,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Progress,
  Row,
  Segmented,
  Select,
  Space,
  Steps,
  Switch,
  Table,
  Tabs,
  Tag,
  Tree,
  Typography,
  Upload,
  message,
} from 'antd';
import type { DataNode } from 'antd/es/tree';
import cytoscape from 'cytoscape';
import dagre from 'cytoscape-dagre';
import {
  approveKnowledgeExtractionJob,
  commitKnowledgeExtractionJobToGraph,
  createDataSource as createBackendDataSource,
  createKnowledgeAgentConversation,
  createKnowledgeDocumentExtractionJob,
  createKnowledgeExtractionJob,
  createKnowledgeOntologyIntake,
  deleteDataSource as deleteBackendDataSource,
  enhanceKnowledgeDocumentOcr,
  exportKnowledgeExtractionJob,
  getGraphAssetQuality,
  getKnowledgeDocumentMarkdown,
  getKnowledgeDocumentOcr,
  getKnowledgeOcrPipeline,
  KnowledgeOcrBlock,
  getDataSource as getBackendDataSource,
  generateSemanticOntologyCandidates,
  getRelatedKnowledgeCards,
  getSemanticOntologyImpact,
  adminListUsers,
  getReferenceData,
  listGraphAssetEvidence,
  listGraphAssetNodes,
  listGraphAssetRelationships,
  listKnowledgeCards,
  listKnowledgeChunks,
  listKnowledgeDocuments,
  listKnowledgeAgentMessages,
  listKnowledgeSources,
  listKnowledgeSpaces,
  listSemanticDataAssets,
  listSemanticOntologyCandidates,
  listSemanticOntologyMappings,
  listSemanticOntologyObjects,
  listSemanticOntologyRelations,
  listSemanticOntologyVersions,
  OntologyCandidateInfo,
  approveSemanticOntologyCandidate,
  createSemanticOntologyObject,
  createSemanticOntologyRelation,
  publishSemanticOntology,
  rejectSemanticOntologyCandidate,
  scanSemanticDataAssetMetadata,
  searchKnowledge,
  sendKnowledgeAgentMessage,
  saveKnowledgeDocumentOcrCorrections,
  testDataSourceConfig,
  updateDataSource as updateBackendDataSource,
  uploadKnowledgeAsset,
} from '../../services/api';
import { useAuthStore } from '../../stores/authStore';

cytoscape.use(dagre);

type DataQualityRule = {
  key: string;
  name: string;
  description: string;
  status: string;
  color: string;
  enabled: boolean;
  passRate: number | null;
};

type DataAsset = {
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

type OntologyObject = {
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
  fields: Array<{ id?: number; name: string; label: string; code?: string; type: string; source_field?: string | null; list?: boolean; form?: boolean; search?: boolean; status?: string; confidence?: number }>;
};

type OntologyRelation = {
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

type OntologyMapping = {
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

type OntologyVersion = {
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

type ExtractionEntity = {
  candidate_id: string;
  name: string;
  entity_type: string;
  description?: string;
  confidence: number;
  source_location?: string;
};

type ExtractionRelation = {
  candidate_id: string;
  source_name: string;
  source_type: string;
  target_name: string;
  target_type: string;
  relation_type: string;
  confidence: number;
  source_location?: string;
};

type ExtractionJob = {
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

type GraphAssetNode = {
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

type GraphAssetRelationship = {
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

type GraphAssetEvidence = {
  id: string;
  asset_type: string;
  asset_name: string;
  source_document_id?: string;
  source_location?: string;
  confidence: number;
  knowledge_job_id?: string;
};

type KnowledgeSpace = { id: string; name: string; description?: string };
type KnowledgeSource = { id: string; name: string; source_type?: string; status?: string };
type KnowledgeDocument = {
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

type OntologyIntakeRecommendation = {
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
type KnowledgeCard = { id: string; title: string; scenario?: string; owner?: string; updated_at?: string };
type KnowledgeChunk = { id?: string; chunk_id?: string; title?: string; document_title?: string; chunk_text: string; source_ref?: string; source_location?: string };
type KnowledgeChatMessage = { id: string; role: 'assistant' | 'user'; content: string };
type EditableOcrBlock = KnowledgeOcrBlock & { row_id: string; corrected_text: string };

const KNOWLEDGE_ASSET_ORDER = [
  'kb-doc-quality-sop-docx',
  'kb-doc-capa-072-docx',
  'kb-doc-supplier-8d-xlsx',
  'kb-doc-process-control-xlsx',
  'kb-doc-maintenance-log-pdf',
  'kb-doc-customer-risk-pdf',
];

const KNOWLEDGE_TYPE_LABELS: Record<string, string> = {
  word: 'Word 文档',
  docx: 'Word 文档',
  excel: 'Excel 台账',
  xlsx: 'Excel 台账',
  pdf: 'PDF 报告',
  image: '图片/OCR',
  markdown: 'Markdown',
};

const normalizeKnowledgeType = (item: KnowledgeDocument) => String(item.source_type ?? item.file_type ?? 'database').toLowerCase();
const getKnowledgeDocumentId = (item: KnowledgeDocument) => String(item.id ?? item.document_id ?? '');
const getKnowledgeDocumentTitle = (item: KnowledgeDocument) => String(item.title ?? item.document_title ?? item.file_name ?? item.source_file_name ?? '未命名文档');
const getKnowledgeDocumentFileName = (item: KnowledgeDocument) => String(item.source_file_name ?? item.file_name ?? item.filename ?? item.updated_at ?? '数据库文档');
const normalizeKnowledgeTypeGroup = (item: KnowledgeDocument) => {
  const type = normalizeKnowledgeType(item);
  return ['word', 'docx'].includes(type) ? 'docx' : ['excel', 'xlsx'].includes(type) ? 'xlsx' : type;
};
const getKnowledgeDocumentStatusMeta = (item: KnowledgeDocument) => {
  const linkedCount = (item.linked_objects ?? []).length;
  if (linkedCount > 0) return { label: '已发布', color: 'success' };
  if (String((item as any).status ?? '').toLowerCase() === 'indexed') return { label: '待抽取', color: 'warning' };
  return { label: (item as any).status ?? '入库中', color: 'default' };
};

const KNOWLEDGE_INTAKE_CAPABILITY_LABELS: Record<string, string> = {
  summarize_document: '生成文档摘要',
  review_ocr_evidence: '复核 OCR 证据',
  extract_ontology_candidates: '抽取本体候选',
  bind_existing_objects: '绑定已有对象',
  prepare_graph_publish: '准备图谱发布',
};

const KNOWLEDGE_INTAKE_ACTION_LABELS: Record<string, { title: string; description: string }> = {
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

const KNOWLEDGE_INTAKE_STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  pending: '待处理',
  running: '抽取中',
  completed: '已完成',
  approved: '已审核',
  committed: '已发布',
  failed: '失败',
};

const getIntakeSourceTypeLabel = (type?: string) => {
  const normalized = String(type ?? '').toLowerCase();
  return KNOWLEDGE_TYPE_LABELS[normalized] ?? (normalized ? normalized.toUpperCase() : '文档');
};

const getIntakeDomainLabel = (domain?: string) => {
  const normalized = String(domain ?? '').toLowerCase();
  if (normalized === 'manufacturing') return '制造业';
  if (normalized === 'general') return '通用';
  return domain ?? '-';
};

const getIntakeSummary = (
  recommendation: OntologyIntakeRecommendation,
  fallbackTitle: string,
  fallbackSourceType: string,
) => {
  const title = recommendation.document_profile?.title ?? fallbackTitle;
  const typeLabel = getIntakeSourceTypeLabel(recommendation.document_profile?.source_type ?? fallbackSourceType);
  return `${title} 已作为${typeLabel}完成索引，可以进入本体抽取准备。`;
};

const GRAPH_DOCUMENT_ALIASES: Record<string, string> = {};

const severityColors: Record<string, string> = {
  FATAL: 'red',
  ERROR: 'volcano',
  WARNING: 'gold',
  INFO: 'blue',
};

const graphTypeColors: Record<string, string> = {
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

const fallbackAssets: DataAsset[] = [];
const fallbackObjects: OntologyObject[] = [];
const fallbackRelations: OntologyRelation[] = [];
const fallbackGraphNodes: GraphAssetNode[] = [];
const fallbackGraphRelationships: GraphAssetRelationship[] = [];
const fallbackGraphEvidence: GraphAssetEvidence[] = [];
const fallbackGraphQuality = {
  summary: {
    nodes: 0,
    relationships: 0,
    missing_evidence: 0,
    low_confidence: 0,
    unbound_nodes: 0,
  },
  items: [],
};


function confidencePercent(value: number) {
  return Math.round((Number(value) || 0) * 100);
}

function normalizeOcrConfidence(value?: number) {
  const confidence = Number(value ?? 0);
  return confidence > 1 ? Math.round(confidence) : Math.round(confidence * 100);
}

function getOcrBlockId(block: KnowledgeOcrBlock, index: number) {
  return String(block.block_id ?? block.id ?? `block-${index + 1}`);
}

function boolTag(value?: boolean) {
  return value ? <Tag color="success">是</Tag> : <Tag>否</Tag>;
}

const DATA_DOMAINS = ['全部', '生产', '设备', '质量', '供应链', '仓储', '客户'];

function tableMatchesBusinessDomain(table: DataAsset['tables'][number], domain: string) {
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

function getDataSourceStatusClass(status?: string) {
  const normalized = String(status ?? '').toLowerCase();
  if (['connected', 'active', 'success', 'online'].includes(normalized)) return 'ok';
  if (['warning', 'pending', 'scanning'].includes(normalized)) return 'warning';
  if (['failed', 'error', 'offline'].includes(normalized)) return 'error';
  return 'unknown';
}

function getDataSourceStatusLabel(status?: string) {
  const normalized = String(status ?? '').toLowerCase();
  if (['connected', 'active', 'success', 'online'].includes(normalized)) return '正常';
  if (['warning', 'pending', 'scanning'].includes(normalized)) return '待处理';
  if (['failed', 'error', 'offline'].includes(normalized)) return '异常';
  return status || '未知';
}

function getCandidateTypeLabel(type?: string) {
  if (type === 'object') return '对象';
  if (type === 'mapping') return '字段映射';
  if (type === 'relation') return '关系';
  if (type === 'field') return '字段';
  return type || '候选';
}

function getTableQualityRules(table?: DataAsset['tables'][number]): DataQualityRule[] {
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

type SemanticAssetCenterView = 'data' | 'ontology';
type DiscoveredSourceTable = { name: string; rows?: number };
type GovernanceUserOption = { id: number; label: string; value: string; email?: string };
type SourceConnectionDraft = {
  type: string;
  host: string;
  port: number;
  database: string;
  schema: string;
  auth_type: string;
  username: string;
  password: string;
  ssl_enabled: boolean;
};

const DEFAULT_BUSINESS_DOMAINS = ['生产', '设备', '质量', '供应链', '仓储', '客户'];
const ENABLED_DATA_SOURCE_TYPES = new Set(['postgresql']);
const INVALID_SOURCE_TEXTS = new Set(['', 'undefined', 'null', 'none', 'nan']);
const DEFAULT_SOURCE_CONNECTION_DRAFT: SourceConnectionDraft = {
  type: 'postgresql',
  host: 'localhost',
  port: 15432,
  database: 'mf_mes_execution',
  schema: 'source',
  auth_type: 'password',
  username: 'mf_mes_readonly',
  password: 'readonly_demo_123',
  ssl_enabled: false,
};
const DATA_SENSITIVITY_OPTIONS = [
  { value: 'internal', label: '内部', description: '可用于元数据扫描、AI 识别和对象建模。' },
  { value: 'confidential', label: '敏感', description: '允许建模，AI 使用需记录审计，样例数据需谨慎。' },
  { value: 'restricted', label: '受限', description: '默认禁止 AI 使用和图谱实例，避免高敏数据扩散。' },
];

const cleanSourceText = (value: unknown) => String(value ?? '').trim();

const hasInvalidSourceText = (value: unknown) => {
  const text = cleanSourceText(value).toLowerCase();
  return INVALID_SOURCE_TEXTS.has(text) || text.includes('undefined://') || text.includes('/undefined');
};

const hasInvalidSourceName = (value: unknown) => {
  const text = cleanSourceText(value).toLowerCase();
  return !text || text.includes('undefined://') || text === 'undefined://undefined/undefined';
};

const editableSourceText = (value: unknown) => {
  const text = cleanSourceText(value);
  return hasInvalidSourceText(text) ? '' : text;
};

const normalizeWizardSourceType = (value: unknown) => {
  const text = cleanSourceText(value).toLowerCase();
  if (text === 'database' || INVALID_SOURCE_TEXTS.has(text)) {
    return 'postgresql';
  }
  return text;
};

export default function SemanticAssetCenter({ view }: { view?: SemanticAssetCenterView } = {}) {
  const [dataSourceForm] = Form.useForm();
  const currentUser = useAuthStore((state) => state.user);
  const [ontologyObjectForm] = Form.useForm();
  const [ontologyRelationForm] = Form.useForm();
  const [assets, setAssets] = useState<DataAsset[]>([]);
  const [objects, setObjects] = useState<OntologyObject[]>([]);
  const [relations, setRelations] = useState<OntologyRelation[]>([]);
  const [ontologyCandidates, setOntologyCandidates] = useState<OntologyCandidateInfo[]>([]);
  const [ontologyMappings, setOntologyMappings] = useState<OntologyMapping[]>([]);
  const [ontologyVersions, setOntologyVersions] = useState<OntologyVersion[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<number | undefined>();
  const [selectedTableId, setSelectedTableId] = useState<string | undefined>();
  const [selectedObjectId, setSelectedObjectId] = useState<string | undefined>();
  const [selectedCandidateId, setSelectedCandidateId] = useState<number | undefined>();
  const [assetSearch, setAssetSearch] = useState('');
  const [activeDomain, setActiveDomain] = useState('全部');
  const [ontologyTab, setOntologyTab] = useState('objects');
  const [sourceModalOpen, setSourceModalOpen] = useState(false);
  const [objectModalOpen, setObjectModalOpen] = useState(false);
  const [relationModalOpen, setRelationModalOpen] = useState(false);
  const [sourceStep, setSourceStep] = useState(0);
  const [sourceEditingId, setSourceEditingId] = useState<number | undefined>();
  const [sourceNameInput, setSourceNameInput] = useState('');
  const [sourceConnectionDraft, setSourceConnectionDraft] = useState<SourceConnectionDraft>(DEFAULT_SOURCE_CONNECTION_DRAFT);
  const [discoveredSourceTables, setDiscoveredSourceTables] = useState<DiscoveredSourceTable[]>([]);
  const [businessDomainOptions, setBusinessDomainOptions] = useState(DEFAULT_BUSINESS_DOMAINS);
  const [governanceUsers, setGovernanceUsers] = useState<GovernanceUserOption[]>([]);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionTestResult, setConnectionTestResult] = useState<'success' | 'error' | undefined>();
  const [scanning, setScanning] = useState(false);
  const [recognizing, setRecognizing] = useState(false);
  const [reviewingCandidateId, setReviewingCandidateId] = useState<number | undefined>();
  const [publishingOntology, setPublishingOntology] = useState(false);
  const [savingObject, setSavingObject] = useState(false);
  const [savingRelation, setSavingRelation] = useState(false);
  const [impactLoading, setImpactLoading] = useState(false);
  const [impactResult, setImpactResult] = useState<any>(null);
  const [semanticReadyTables, setSemanticReadyTables] = useState<string[]>([]);
  const [candidateCountByAsset, setCandidateCountByAsset] = useState<Record<number, number>>({});
  const [candidateCountByTable, setCandidateCountByTable] = useState<Record<string, number>>({});
  const [publishedTables, setPublishedTables] = useState<string[]>([]);
  const [qualityRuleState, setQualityRuleState] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const selectedAsset = useMemo(() => assets.find((item) => item.id === selectedAssetId) ?? assets[0], [assets, selectedAssetId]);
  const selectedAssetTables = useMemo(
    () => (selectedAsset?.tables ?? []).map((table) => ({ ...table, assetName: selectedAsset.name, assetType: selectedAsset.type, owner: selectedAsset.owner, freshness: selectedAsset.freshness, status: selectedAsset.status })),
    [selectedAsset],
  );
  const allTables = useMemo(
    () => assets.flatMap((asset) => asset.tables.map((table) => ({ ...table, assetName: asset.name, assetType: asset.type, owner: asset.owner, freshness: asset.freshness, status: asset.status }))),
    [assets],
  );
  const selectedTable = useMemo(() => selectedAssetTables.find((item) => item.id === selectedTableId) ?? selectedAssetTables[0], [selectedAssetTables, selectedTableId]);
  const selectedCandidate = useMemo(
    () => ontologyCandidates.find((item) => item.id === selectedCandidateId) ?? ontologyCandidates[0],
    [ontologyCandidates, selectedCandidateId],
  );
  const selectedTableCandidates = useMemo(() => {
    if (!selectedTable) return [];
    return ontologyCandidates.filter((candidate) => {
      const payloadSource = candidate.payload?.source as { entity_name?: unknown; source_id?: unknown } | undefined;
      const entityName = String(payloadSource?.entity_name ?? '');
      const sourceId = Number(payloadSource?.source_id ?? 0);
      return (entityName === selectedTable.name || entityName === selectedTable.id)
        && (!selectedAsset || !sourceId || sourceId === selectedAsset.id);
    });
  }, [ontologyCandidates, selectedAsset, selectedTable]);
  const selectedObject = useMemo(() => objects.find((item) => item.id === selectedObjectId) ?? objects[0], [objects, selectedObjectId]);
  const objectRelations = relations.filter((item) => item.source === selectedObject?.id || item.target === selectedObject?.id);
  const selectedObjectMappings = useMemo(
    () => ontologyMappings.filter((item) => item.target_object_code === selectedObject?.code),
    [ontologyMappings, selectedObject],
  );
  const candidateStats = useMemo(() => {
    const counts = ontologyCandidates.reduce<Record<string, number>>((acc, item) => {
      acc[item.candidate_type] = (acc[item.candidate_type] ?? 0) + 1;
      return acc;
    }, {});
    return {
      total: ontologyCandidates.length,
      objects: counts.object ?? 0,
      fields: counts.field ?? 0,
      relations: counts.relation ?? 0,
      mappings: counts.mapping ?? 0,
    };
  }, [ontologyCandidates]);
  const ontologyPublishStats = useMemo(() => ({
    objects: objects.length,
    fields: objects.reduce((sum, item) => sum + item.fields.length, 0),
    relations: relations.length,
    graphRelations: relations.filter((item) => item.graph).length,
    mappings: ontologyMappings.length,
  }), [objects, ontologyMappings, relations]);
  const filteredTables = useMemo(() => {
    const keyword = assetSearch.trim().toLowerCase();
    return (selectedAsset?.tables ?? []).filter((table) => {
      const inKeyword = !keyword
        || table.name.toLowerCase().includes(keyword)
        || table.label.toLowerCase().includes(keyword)
        || table.fields.some((field) => field.name.toLowerCase().includes(keyword) || field.label.toLowerCase().includes(keyword));
      return inKeyword && tableMatchesBusinessDomain(table, activeDomain);
    });
  }, [activeDomain, assetSearch, selectedAsset]);
  const assetStats = useMemo(() => {
    const tableCount = allTables.length;
    const totalRows = allTables.reduce((sum, table) => sum + Number(table.rows || 0), 0);
    const avgQuality = tableCount ? Math.round(allTables.reduce((sum, table) => sum + Number(table.quality_score || 0), 0) / tableCount) : 0;
    const mappedCount = allTables.filter((table) => objects.some((object) => object.source === table.id)).length;
    return { tableCount, totalRows, avgQuality, mappedCount };
  }, [allTables, objects]);
  const selectedAssetStats = useMemo(() => {
    const tables = selectedAsset?.tables ?? [];
    const tableCount = tables.length;
    const fieldCount = tables.reduce((sum, table) => sum + table.fields.length, 0);
    const totalRows = tables.reduce((sum, table) => sum + Number(table.rows || 0), 0);
    const avgQuality = tableCount ? Math.round(tables.reduce((sum, table) => sum + Number(table.quality_score || 0), 0) / tableCount) : 0;
    const mappedCount = tables.filter((table) => objects.some((object) => object.source === table.id)).length;
    return { tableCount, fieldCount, totalRows, avgQuality, mappedCount };
  }, [objects, selectedAsset]);
  const watchedSensitivity = Form.useWatch('sensitivity', dataSourceForm);

  const hydrateConnectionForm = (draft: SourceConnectionDraft = sourceConnectionDraft) => {
    dataSourceForm.setFieldsValue({
      ...draft,
      name: cleanSourceText(sourceNameInput || dataSourceForm.getFieldValue('name')),
    });
  };

  const handleSourceFormValuesChange = (changedValues: Record<string, any>) => {
    if (Object.prototype.hasOwnProperty.call(changedValues, 'name')) {
      setSourceNameInput(changedValues.name ?? '');
    }
    const draftPatch: Partial<SourceConnectionDraft> = {};
    (['type', 'host', 'port', 'database', 'schema', 'auth_type', 'username', 'password', 'ssl_enabled'] as const).forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(changedValues, key)) {
        (draftPatch as any)[key] = changedValues[key];
      }
    });
    if (Object.keys(draftPatch).length) {
      setSourceConnectionDraft((prev) => ({ ...prev, ...draftPatch }));
    }
  };

  const loadGovernanceOptions = async () => {
    try {
      const [refRes, userRes] = await Promise.all([getReferenceData(), adminListUsers()]);
      const dictionaries = refRes.data?.data?.dictionaries ?? [];
      const businessDomainDict = dictionaries.find((dict: any) => ['business_domain', 'data_asset_business_domain'].includes(String(dict.dictCode)));
      const nextDomains = Array.isArray(businessDomainDict?.options)
        ? businessDomainDict.options
          .filter((item: any) => item.enabled !== false)
          .map((item: any) => String(item.label || item.value))
          .filter(Boolean)
        : [];
      setBusinessDomainOptions(nextDomains.length ? nextDomains : DEFAULT_BUSINESS_DOMAINS);

      const users = userRes.data?.data ?? [];
      const nextUsers = users
        .filter((user: any) => user.is_active !== false)
        .map((user: any) => ({
          id: Number(user.id),
          label: String(user.display_name || user.username),
          value: String(user.display_name || user.username),
          email: user.email,
        }));
      setGovernanceUsers(nextUsers);
    } catch {
      const fallbackUser = currentUser
        ? [{ id: currentUser.id, label: currentUser.display_name || currentUser.username, value: currentUser.display_name || currentUser.username, email: currentUser.email }]
        : [];
      setBusinessDomainOptions(DEFAULT_BUSINESS_DOMAINS);
      setGovernanceUsers(fallbackUser);
    }
  };

  const applySensitivityPolicy = (sensitivity?: string) => {
    if (sensitivity === 'restricted') {
      const currentScope = dataSourceForm.getFieldValue('sync_scope');
      dataSourceForm.setFieldsValue({
        allow_ai: false,
        allow_graph: false,
        sync_scope: Array.isArray(currentScope)
          ? currentScope.filter((item) => !['sample', 'full', 'incremental'].includes(item))
          : ['metadata', 'profile'],
      });
      message.info('受限数据已自动关闭 AI 使用和图谱实例，并移除样例/全量/增量采集。');
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      const [assetRes, objectRes, relationRes, mappingRes, versionRes] = await Promise.all([
        listSemanticDataAssets(),
        listSemanticOntologyObjects(),
        listSemanticOntologyRelations(),
        listSemanticOntologyMappings(),
        listSemanticOntologyVersions(),
      ]);
      const candidateRes = await listSemanticOntologyCandidates({ status: 'pending_review' });
      const nextAssets = assetRes.data?.data ?? [];
      const nextObjects = objectRes.data?.data ?? [];
      const nextCandidates = candidateRes.data?.data ?? [];
      setAssets(nextAssets);
      setObjects(nextObjects);
      setRelations(relationRes.data?.data ?? []);
      setOntologyCandidates(nextCandidates);
      setOntologyMappings(mappingRes.data?.data ?? []);
      setOntologyVersions(versionRes.data?.data ?? []);
      setSelectedAssetId((prev) => prev ?? nextAssets[0]?.id);
      setSelectedTableId((prev) => nextAssets.flatMap((asset: DataAsset) => asset.tables).some((table: DataAsset['tables'][number]) => table.id === prev) ? prev : nextAssets[0]?.tables[0]?.id);
      setSelectedObjectId((prev) => prev ?? nextObjects[0]?.id);
      setSelectedCandidateId((prev) => prev ?? nextCandidates[0]?.id);
    } catch {
      setAssets([]);
      setObjects([]);
      setRelations([]);
      setOntologyCandidates([]);
      setOntologyMappings([]);
      setOntologyVersions([]);
      setSelectedAssetId(undefined);
      setSelectedTableId(undefined);
      setSelectedObjectId(undefined);
      setSelectedCandidateId(undefined);
      message.warning('后端语义资产接口暂不可用，未展示本地兜底数据');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    loadGovernanceOptions();
  }, []);

  useEffect(() => {
    applySensitivityPolicy(watchedSensitivity);
  }, [watchedSensitivity]);

  useEffect(() => {
    if (filteredTables.length && !filteredTables.some((table) => table.id === selectedTableId)) {
      setSelectedTableId(filteredTables[0].id);
    }
  }, [filteredTables, selectedTableId]);

  const openDataSourceWizard = () => {
    setSourceEditingId(undefined);
    setSourceStep(0);
    setConnectionTestResult(undefined);
    setDiscoveredSourceTables([]);
    setSourceNameInput('');
    setSourceConnectionDraft(DEFAULT_SOURCE_CONNECTION_DRAFT);
    dataSourceForm.setFieldsValue({
      name: '',
      ...DEFAULT_SOURCE_CONNECTION_DRAFT,
      owner: currentUser?.display_name || currentUser?.username || '平台管理员',
      sync_frequency: '每 5 分钟',
      sync_mode: 'metadata',
      business_domain: '生产',
      sensitivity: 'internal',
      network_zone: '内网 Connector Agent',
      ssl_enabled: false,
      save_secret: true,
      allow_ai: true,
      allow_ontology: true,
      allow_graph: false,
      sync_scope: ['metadata', 'profile'],
      tables: [],
    });
    setSourceModalOpen(true);
  };

  const openDataSourceEditor = async (asset: DataAsset, event?: { stopPropagation: () => void }) => {
    event?.stopPropagation();
    setSourceEditingId(asset.id);
    setSourceStep(0);
    setConnectionTestResult(undefined);
    let config: Record<string, any> = {};
    let schedule = asset.freshness || '每 5 分钟';
    try {
      const res = await getBackendDataSource(asset.id);
      config = JSON.parse(res.data?.connection_config || '{}');
      schedule = res.data?.schedule || schedule;
    } catch {
      config = {};
    }
    const savedTableNames = config.selected_tables || [];
    const savedDiscoveredTables = Array.isArray(config.discovered_tables) && config.discovered_tables.length
      ? config.discovered_tables
      : (asset.tables?.length
        ? asset.tables.map((table) => ({ name: table.name, rows: table.rows }))
        : savedTableNames.map((name: string) => ({ name, rows: undefined })));
    setDiscoveredSourceTables(savedDiscoveredTables);
    const editorSourceType = normalizeWizardSourceType(config.type || config.source_type || asset.type);
    const editableName = editableSourceText(asset.name);
    const editorDraft: SourceConnectionDraft = {
      type: ENABLED_DATA_SOURCE_TYPES.has(editorSourceType) ? editorSourceType : 'postgresql',
      host: editableSourceText(config.host) || 'localhost',
      port: Number(config.port || 5432),
      database: editableSourceText(config.database) || '',
      schema: config.schema || config.schema_name || 'source',
      auth_type: config.auth_type || 'password',
      username: editableSourceText(config.username) || 'mf_readonly',
      password: config.password || '',
      ssl_enabled: config.ssl_enabled ?? false,
    };
    setSourceNameInput(editableName);
    setSourceConnectionDraft(editorDraft);
    dataSourceForm.setFieldsValue({
      ...editorDraft,
      name: editableName,
      owner: config.owner || asset.owner || '平台管理员',
      sync_frequency: schedule,
      sync_mode: config.sync_mode || 'metadata',
      business_domain: config.business_domain || '生产',
      sensitivity: config.sensitivity || asset.sensitivity || 'internal',
      network_zone: config.network_zone || '内网 Connector Agent',
      ssl_enabled: config.ssl_enabled ?? false,
      save_secret: true,
      allow_ai: config.allow_ai ?? true,
      allow_ontology: config.allow_ontology ?? true,
      allow_graph: config.allow_graph ?? false,
      sync_scope: config.sync_scope || ['metadata', 'profile'],
      tables: (config.selected_tables || asset.tables).map((table: any) => typeof table === 'string' ? table : table.name),
    });
    setSourceModalOpen(true);
  };

  const closeDataSourceWizard = () => {
    setSourceModalOpen(false);
    setSourceStep(0);
    setSourceEditingId(undefined);
    setConnectionTestResult(undefined);
    setDiscoveredSourceTables([]);
    setSourceNameInput('');
    setSourceConnectionDraft(DEFAULT_SOURCE_CONNECTION_DRAFT);
  };

  const nextSourceStep = async () => {
    const normalizedName = cleanSourceText(sourceNameInput || dataSourceForm.getFieldValue('name'));
    dataSourceForm.setFieldsValue({ name: normalizedName, ...sourceConnectionDraft });
    if (sourceStep === 0 && hasInvalidSourceName(normalizedName)) {
      dataSourceForm.setFields([{ name: 'name', errors: ['请输入连接名称'] }]);
      dataSourceForm.scrollToField('name', { block: 'center' });
      message.error('请输入连接名称');
      return;
    }
    const stepFields = [
      ['type', 'host', 'port', 'database', 'schema', 'auth_type', 'username', 'password'],
      ['sync_scope', 'tables', 'sync_mode', 'sync_frequency'],
      ['business_domain', 'owner'],
    ][sourceStep] ?? [];
    try {
      await dataSourceForm.validateFields(stepFields);
      if (sourceStep === 0 && discoveredSourceTables.length === 0) {
        message.warning('请先测试连接，读取真实数据库表');
        return;
      }
      setSourceStep((prev) => Math.min(prev + 1, 2));
    } catch (error: any) {
      const firstField = error?.errorFields?.[0]?.name;
      if (firstField) {
        dataSourceForm.scrollToField(firstField, { block: 'center' });
      }
      message.warning('请先填写必填项');
    }
  };

  const testDataSourceConnection = async () => {
    hydrateConnectionForm();
    const values = await dataSourceForm.validateFields(['type', 'host', 'port', 'database', 'schema', 'auth_type', 'username', 'password', 'ssl_enabled']);
    const draft = { ...sourceConnectionDraft, ...values };
    const sourceType = normalizeWizardSourceType(draft.type);
    if (!ENABLED_DATA_SOURCE_TYPES.has(sourceType)) {
      message.error('数据源类型无效，请选择 PostgreSQL 后再测试连接');
      return;
    }
    setTestingConnection(true);
    setConnectionTestResult(undefined);
    try {
      const res = await testDataSourceConfig({
        source_type: sourceType,
        host: cleanSourceText(draft.host),
        port: draft.port,
        database: cleanSourceText(draft.database),
        schema_name: draft.schema || 'public',
        username: cleanSourceText(draft.username),
        password: draft.password,
        ssl_enabled: Boolean(draft.ssl_enabled),
      });
      setConnectionTestResult('success');
      const tables = res.data?.tables ?? [];
      const realTables = tables.map((table: any) => ({ name: String(table.name), rows: Number(table.rows ?? 0) }));
      setDiscoveredSourceTables(realTables);
      if (tables.length) {
        dataSourceForm.setFieldsValue({ tables: realTables.map((table: DiscoveredSourceTable) => table.name) });
      }
      message.success(`连接测试通过：发现 ${tables.length || 0} 张候选表`);
    } catch (error: any) {
      setConnectionTestResult('error');
      message.error(error?.response?.data?.detail ?? '连接测试失败');
    } finally {
      setTestingConnection(false);
    }
  };

  const saveDataSource = async () => {
    const normalizedName = cleanSourceText(sourceNameInput || dataSourceForm.getFieldValue('name'));
    dataSourceForm.setFieldsValue({ name: normalizedName, ...sourceConnectionDraft });
    const values = await dataSourceForm.validateFields();
    const draft = { ...sourceConnectionDraft, ...values };
    const editingAsset = assets.find((asset) => asset.id === sourceEditingId);
    const sourceName = normalizedName;
    const sourceType = normalizeWizardSourceType(draft.type);
    if (!ENABLED_DATA_SOURCE_TYPES.has(sourceType)) {
      message.error('数据源类型无效，请选择 PostgreSQL 后再保存');
      setSourceStep(0);
      return;
    }
    if (hasInvalidSourceName(sourceName)) {
      dataSourceForm.setFields([{ name: 'name', errors: ['请输入连接名称'] }]);
      dataSourceForm.scrollToField('name', { block: 'center' });
      message.error('请输入连接名称');
      setSourceStep(0);
      return;
    }
    const tableNames = Array.isArray(values.tables) ? values.tables : [];
    const connectionConfig = {
      type: sourceType,
      source_type: sourceType,
      host: cleanSourceText(draft.host),
      port: draft.port,
      database: cleanSourceText(draft.database),
      schema: draft.schema || 'public',
      schema_name: draft.schema || 'public',
      auth_type: draft.auth_type,
      username: cleanSourceText(draft.username),
      password: draft.password,
      ssl_enabled: Boolean(draft.ssl_enabled),
      owner: values.owner ?? '平台管理员',
      business_domain: values.business_domain,
      sensitivity: values.sensitivity || 'internal',
      network_zone: values.network_zone,
      sync_scope: values.sync_scope ?? ['metadata', 'profile'],
      sync_mode: values.sync_mode ?? 'metadata',
      allow_ai: Boolean(values.allow_ai),
      allow_ontology: Boolean(values.allow_ontology),
      allow_graph: Boolean(values.allow_graph),
      selected_tables: tableNames,
      discovered_tables: discoveredSourceTables,
    };
    const payload = {
      name: sourceName,
      source_type: sourceType,
      connection_config: JSON.stringify(connectionConfig),
      schedule: String(values.sync_frequency ?? '每 5 分钟'),
      status: 'active',
    };
    try {
      const res = editingAsset
        ? await updateBackendDataSource(editingAsset.id, payload)
        : await createBackendDataSource(payload);
      const nextId = Number(res.data?.id ?? editingAsset?.id);
      closeDataSourceWizard();
      dataSourceForm.resetFields();
      await load();
      setSelectedAssetId(nextId);
      message.success(editingAsset ? '数据源配置已保存到后台数据库' : '数据源已保存到后台数据库');
    } catch (error: any) {
      message.error(error?.response?.data?.detail ?? '数据源保存失败');
    }
  };

  const deleteDataSource = (asset: DataAsset, event?: { stopPropagation: () => void }) => {
    event?.stopPropagation();
    Modal.confirm({
      title: '删除数据源',
      content: `确定删除「${asset.name}」吗？已发布对象不会被自动删除。`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteBackendDataSource(asset.id);
          const nextAssets = assets.filter((item) => item.id !== asset.id);
          setAssets(nextAssets);
          if (selectedAssetId === asset.id) {
            setSelectedAssetId(nextAssets[0]?.id);
            setSelectedTableId(nextAssets[0]?.tables[0]?.id);
          }
          await load();
          message.success('数据源已从后台数据库删除');
        } catch (error: any) {
          message.error(error?.response?.data?.detail ?? '数据源删除失败');
        }
      },
    });
  };

  const scanMetadata = async () => {
    if (!selectedAsset) return;
    const assetId = selectedAsset.id;
    setScanning(true);
    setAssets((prev) => prev.map((asset) => asset.id === assetId ? { ...asset, status: 'scanning' } : asset));
    try {
      const res = await scanSemanticDataAssetMetadata(assetId, { limit_tables: 24, sample_limit: 3 });
      const scannedAsset = res.data?.data as DataAsset | undefined;
      const scan = res.data?.scan as { tables_scanned?: number; fields_scanned?: number; records_profiled?: number } | undefined;
      if (!scannedAsset) {
        throw new Error('扫描结果为空');
      }
      setAssets((prev) => prev.map((asset) => asset.id === assetId ? scannedAsset : asset));
      setSelectedAssetId(scannedAsset.id);
      setSelectedTableId((prev) => scannedAsset.tables.some((table) => table.id === prev) ? prev : scannedAsset.tables[0]?.id);
      message.success(`元数据扫描完成：${scan?.tables_scanned ?? scannedAsset.tables.length} 张表，${scan?.fields_scanned ?? scannedAsset.tables.reduce((sum, table) => sum + table.fields.length, 0)} 个字段`);
    } catch (error: any) {
      setAssets((prev) => prev.map((asset) => asset.id === assetId ? { ...asset, status: selectedAsset.status || 'connected' } : asset));
      message.error(error?.response?.data?.detail ?? error?.message ?? '元数据扫描失败');
    } finally {
      setScanning(false);
    }
  };

  const clearMetadataView = () => {
    if (!selectedAsset) return;
    const tableIds = selectedAsset.tables.map((table) => table.id);
    setAssets((prev) => prev.map((asset) => asset.id === selectedAsset.id
      ? { ...asset, freshness: '待扫描', tables: [] }
      : asset));
    setSelectedTableId(undefined);
    setSemanticReadyTables((prev) => prev.filter((tableId) => !tableIds.includes(tableId)));
    setPublishedTables((prev) => prev.filter((tableId) => !tableIds.includes(tableId)));
    setCandidateCountByAsset((prev) => ({ ...prev, [selectedAsset.id]: 0 }));
    setCandidateCountByTable((prev) => {
      const next = { ...prev };
      tableIds.forEach((tableId) => {
        delete next[tableId];
      });
      return next;
    });
    message.success('已清空当前数据源的元数据展示，可点击“扫描元数据”重新生成');
  };

  const runSemanticRecognition = async () => {
    if (!selectedAsset) return;
    if (selectedAsset.allow_ai === false) {
      message.warning('当前数据源未授权 AI 使用，请在治理使用中开启后再识别');
      return;
    }
    setRecognizing(true);
    try {
      const res = await generateSemanticOntologyCandidates({ source_id: selectedAsset.id });
      const candidates = res.data?.data ?? [];
      setOntologyCandidates((prev) => {
        const nextById = new Map(prev.map((candidate) => [candidate.id, candidate]));
        candidates.forEach((candidate) => nextById.set(candidate.id, candidate));
        return Array.from(nextById.values());
      });
      const tableNames = new Set(selectedAsset.tables.map((table) => table.name));
      const tableCounts: Record<string, number> = {};
      candidates.forEach((candidate) => {
        const payloadSource = candidate.payload?.source as { entity_name?: unknown } | undefined;
        const entityName = String(payloadSource?.entity_name ?? '');
        const table = selectedAsset.tables.find((item) => item.name === entityName || item.id === entityName);
        if (table && tableNames.has(table.name)) {
          tableCounts[table.id] = (tableCounts[table.id] ?? 0) + 1;
        }
      });
      setCandidateCountByAsset((prev) => ({ ...prev, [selectedAsset.id]: candidates.length }));
      setCandidateCountByTable((prev) => ({ ...prev, ...tableCounts }));
      setSemanticReadyTables((prev) => Array.from(new Set([...prev, ...Object.keys(tableCounts)])));
      message.success(`AI 语义识别完成：生成 ${candidates.length} 条对象、字段、关系和映射候选`);
    } catch (error: any) {
      message.error(error?.response?.data?.detail ?? 'AI 语义识别失败，请先扫描元数据');
    } finally {
      setRecognizing(false);
    }
  };

  const publishToOntology = () => {
    if (!selectedTable) return;
    if (selectedAsset?.allow_ontology === false) {
      message.warning('当前数据源未授权对象建模，请在治理使用中开启后再发布');
      return;
    }
    if (!semanticReadyTables.includes(selectedTable.id)) {
      message.warning('请先执行 AI 语义识别，生成候选后再送入对象与关系中心');
      return;
    }
    setSemanticReadyTables((prev) => Array.from(new Set([...prev, selectedTable.id])));
    setPublishedTables((prev) => Array.from(new Set([...prev, selectedTable.id])));
    const firstCandidate = selectedTableCandidates[0];
    if (firstCandidate) {
      setSelectedCandidateId(firstCandidate.id);
    }
    setOntologyTab('candidates');
    message.success(`「${selectedTable.label}」已送入候选审核，批准后才会进入正式对象目录`);
  };

  const refreshOntologyGovernance = async () => {
    const [objectRes, relationRes, candidateRes, mappingRes, versionRes] = await Promise.all([
      listSemanticOntologyObjects(),
      listSemanticOntologyRelations(),
      listSemanticOntologyCandidates({ status: 'pending_review' }),
      listSemanticOntologyMappings(),
      listSemanticOntologyVersions(),
    ]);
    const nextObjects = objectRes.data?.data ?? [];
    const nextCandidates = candidateRes.data?.data ?? [];
    setObjects(nextObjects);
    setRelations(relationRes.data?.data ?? []);
    setOntologyCandidates(nextCandidates);
    setOntologyMappings(mappingRes.data?.data ?? []);
    setOntologyVersions(versionRes.data?.data ?? []);
    setSelectedObjectId((prev) => nextObjects.some((item: OntologyObject) => item.id === prev) ? prev : nextObjects[0]?.id);
    setSelectedCandidateId((prev) => nextCandidates.some((item: OntologyCandidateInfo) => item.id === prev) ? prev : nextCandidates[0]?.id);
  };

  const reviewCandidate = async (candidate: OntologyCandidateInfo, action: 'approve' | 'reject') => {
    setReviewingCandidateId(candidate.id);
    try {
      if (action === 'approve') {
        await approveSemanticOntologyCandidate(candidate.id);
        message.success('候选已批准并写入正式对象模型');
      } else {
        await rejectSemanticOntologyCandidate(candidate.id);
        message.success('候选已拒绝');
      }
      await refreshOntologyGovernance();
    } catch (error: any) {
      message.error(error?.response?.data?.detail ?? '候选审核失败');
    } finally {
      setReviewingCandidateId(undefined);
    }
  };

  const openObjectModal = (object?: OntologyObject) => {
    ontologyObjectForm.setFieldsValue(object ? {
      name: object.name,
      code: object.code,
      domain: object.domain ?? 'manufacturing',
      description: object.description,
      status: object.status ?? 'published',
      source_type: 'manual',
      source_ref: object.source,
    } : {
      domain: 'manufacturing',
      status: 'draft',
      source_type: 'manual',
      fields: [],
    });
    setObjectModalOpen(true);
  };

  const saveOntologyObject = async () => {
    const values = await ontologyObjectForm.validateFields();
    setSavingObject(true);
    try {
      await createSemanticOntologyObject({
        name: values.name,
        code: values.code,
        domain: values.domain,
        description: values.description,
        status: values.status,
        source_type: values.source_type ?? 'manual',
        source_ref: values.source_ref,
        fields: (values.fields ?? []).map((field: any) => ({
          name: field.code || field.name,
          code: field.code || field.name,
          label: field.label || field.name,
          type: field.type || 'string',
          source_field: field.source_field,
          list: field.list ?? true,
          form: field.form ?? true,
          search: field.search ?? false,
        })),
      });
      setObjectModalOpen(false);
      ontologyObjectForm.resetFields();
      await refreshOntologyGovernance();
      message.success('对象模型已保存');
    } catch (error: any) {
      message.error(error?.response?.data?.detail ?? '对象保存失败');
    } finally {
      setSavingObject(false);
    }
  };

  const deprecateSelectedObject = () => {
    if (!selectedObject) return;
    Modal.confirm({
      title: '废弃对象',
      content: `废弃「${selectedObject.name}」前建议先查看影响分析。对象不会被物理删除，会标记为 deprecated。`,
      okText: '废弃',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        await createSemanticOntologyObject({
          ...selectedObject,
          status: 'deprecated',
          source_type: 'manual',
          source_ref: selectedObject.source,
        });
        await refreshOntologyGovernance();
        message.success('对象已标记为废弃');
      },
    });
  };

  const openRelationModal = () => {
    ontologyRelationForm.setFieldsValue({
      relation_type: 'RELATED_TO',
      graph_enabled: true,
      source_object_code: selectedObject?.code,
    });
    setRelationModalOpen(true);
  };

  const saveOntologyRelation = async () => {
    const values = await ontologyRelationForm.validateFields();
    setSavingRelation(true);
    try {
      await createSemanticOntologyRelation({
        name: values.name,
        code: values.code,
        relation_type: values.relation_type,
        source_object_code: values.source_object_code,
        target_object_code: values.target_object_code,
        description: values.description,
        graph_enabled: values.graph_enabled,
        source_type: 'manual',
      });
      setRelationModalOpen(false);
      ontologyRelationForm.resetFields();
      await refreshOntologyGovernance();
      message.success('对象关系已保存');
    } catch (error: any) {
      message.error(error?.response?.data?.detail ?? '关系保存失败');
    } finally {
      setSavingRelation(false);
    }
  };

  const publishOntologyVersion = async () => {
    setPublishingOntology(true);
    try {
      const title = `Object model v${(ontologyVersions[0]?.version ?? 0) + 1}`;
      await publishSemanticOntology({ title });
      await refreshOntologyGovernance();
      message.success('对象与关系模型已发布新版本');
    } catch (error: any) {
      message.error(error?.response?.data?.detail ?? '发布失败');
    } finally {
      setPublishingOntology(false);
    }
  };

  const runImpactAnalysis = async (fieldCode?: string) => {
    if (!selectedObject) return;
    setImpactLoading(true);
    try {
      const res = await getSemanticOntologyImpact({ object_code: selectedObject.code, field_code: fieldCode });
      setImpactResult(res.data?.data ?? null);
      setOntologyTab('impact');
    } catch (error: any) {
      message.error(error?.response?.data?.detail ?? '影响分析失败');
    } finally {
      setImpactLoading(false);
    }
  };

  const updateQualityRule = (rule: string, checked: boolean) => {
    if (!selectedTable) return;
    setQualityRuleState((prev) => ({ ...prev, [`${selectedTable.id}:${rule}`]: checked ? 'enabled' : 'disabled' }));
  };

  const dataAssetView = (
    <>
    <div className="data-asset-workbench">
      <aside className="data-asset-directory">
        <Card
          className="semantic-side-card"
          title="数据资产目录"
          extra={(
            <Space size={4}>
              <Button size="small" icon={<DatabaseOutlined />} onClick={openDataSourceWizard}>接入</Button>
              <Button size="small" disabled={!selectedAsset?.persisted} onClick={() => selectedAsset && openDataSourceEditor(selectedAsset)}>编辑</Button>
              <Button size="small" danger disabled={!selectedAsset?.persisted} onClick={() => selectedAsset && deleteDataSource(selectedAsset)}>删除</Button>
              <Button size="small" icon={<ReloadOutlined />} onClick={load}>刷新</Button>
            </Space>
          )}
        >
          <Input.Search placeholder="搜索数据源、表、字段" allowClear value={assetSearch} onChange={(event) => setAssetSearch(event.target.value)} />
          <div className="data-directory-section">
            <div className="data-source-section-header">
              <Typography.Text type="secondary">数据源</Typography.Text>
            </div>
            <div className="data-source-compact-summary">
              <div>
                <strong>{assets.length}</strong>
                <span>数据源</span>
              </div>
              <div>
                <strong>{assetStats.tableCount}</strong>
                <span>表</span>
              </div>
              <div>
                <strong>{assetStats.mappedCount}</strong>
                <span>已映射</span>
              </div>
            </div>
            <div className="data-source-list-head">
              <span>来源系统</span>
              <span>资产</span>
              <span>状态</span>
            </div>
            <div className="data-source-compact-list" aria-busy={loading}>
              {assets.length ? assets.map((item) => (
                <div
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  className={item.id === selectedAsset?.id ? 'data-source-compact-row active' : 'data-source-compact-row'}
                  onClick={() => {
                    setSelectedAssetId(item.id);
                    setSelectedTableId(item.tables[0]?.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      setSelectedAssetId(item.id);
                      setSelectedTableId(item.tables[0]?.id);
                    }
                  }}
                >
                  <span className="data-source-row-main">
                    <strong>{item.name}</strong>
                    <small>{item.owner || item.type} · {item.freshness || '本地'}</small>
                  </span>
                  <span className="data-source-row-count">{item.tables.length}表</span>
                  <span className={`data-source-status-dot ${getDataSourceStatusClass(item.status)}`} title={getDataSourceStatusLabel(item.status)} />
                </div>
              )) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={loading ? '加载中' : '暂无数据源'} />
              )}
            </div>
          </div>
          <div className="data-directory-section">
            <Typography.Text type="secondary">业务域</Typography.Text>
            <div className="data-domain-list">
              {DATA_DOMAINS.map((domain) => (
                <button key={domain} type="button" className={activeDomain === domain ? 'active' : ''} onClick={() => setActiveDomain(domain)}>
                  <span>{domain}</span>
                  <Tag>{selectedAsset?.tables.filter((table) => tableMatchesBusinessDomain(table, domain)).length ?? 0}</Tag>
                </button>
              ))}
            </div>
          </div>
        </Card>
      </aside>

      <main className="data-asset-main">
        <Card
          className="data-asset-main-card"
          title={
            <Space direction="vertical" size={2}>
              <Typography.Text strong>结构化数据资产</Typography.Text>
              <Typography.Text type="secondary">接入、盘点、治理并发布可进入对象与关系建模的数据资产</Typography.Text>
            </Space>
          }
          extra={
            <Space wrap>
              <Button icon={<ReloadOutlined />} loading={scanning} disabled={!selectedAsset} onClick={scanMetadata}>扫描元数据</Button>
              <Button danger disabled={!selectedAsset || scanning || !selectedAsset.tables.length} onClick={clearMetadataView}>清空元数据</Button>
              <Button icon={<RobotOutlined />} loading={recognizing} disabled={!selectedAsset || scanning || selectedAsset.allow_ai === false} onClick={runSemanticRecognition}>AI 语义识别</Button>
              <Button type="primary" icon={<NodeIndexOutlined />} disabled={!selectedTable || selectedAsset?.allow_ontology === false || !semanticReadyTables.includes(selectedTable.id)} onClick={publishToOntology}>发布到对象与关系中心</Button>
            </Space>
          }
        >
          <div className="data-asset-metrics">
            <div><span>来源类型</span><strong>{selectedAsset?.type?.toUpperCase() ?? '-'}</strong></div>
            <div><span>数据表 / 数据集</span><strong>{selectedAssetStats.tableCount}</strong></div>
            <div><span>字段数量</span><strong>{selectedAssetStats.fieldCount}</strong></div>
            <div><span>记录数</span><strong>{selectedAssetStats.totalRows.toLocaleString()}</strong></div>
            <div><span>平均质量分</span><strong>{selectedAssetStats.avgQuality}</strong></div>
            <div><span>候选项</span><strong>{selectedAsset ? candidateCountByAsset[selectedAsset.id] ?? 0 : 0}</strong></div>
          </div>

          <Table
            className="data-asset-table"
            rowKey="id"
            dataSource={filteredTables}
            pagination={false}
            locale={{ emptyText: <Empty description={selectedAsset?.tables.length ? '没有匹配的数据资产' : '等待扫描元数据'} /> }}
            onRow={(record) => ({
              onClick: () => setSelectedTableId(record.id),
            })}
            rowClassName={(record) => (record.id === selectedTable?.id ? 'active-row' : '')}
            columns={[
              {
                title: '数据资产',
                dataIndex: 'label',
                render: (text, record: any) => (
                  <Space direction="vertical" size={2}>
                    <Space wrap>
                      <strong>{text}</strong>
                      <Tag>{record.name}</Tag>
                    </Space>
                    <Typography.Text type="secondary">{selectedAsset?.name} / {selectedAsset?.type} / {selectedAsset?.freshness}</Typography.Text>
                  </Space>
                ),
              },
              { title: '记录数', dataIndex: 'rows', width: 100 },
              {
                title: '质量分',
                dataIndex: 'quality_score',
                width: 150,
                render: (score: number) => (
                  <Space>
                    <Progress percent={score} size="small" showInfo={false} strokeColor={score >= 95 ? '#2f7d5b' : '#d46b08'} style={{ width: 72 }} />
                    <Tag color={score >= 95 ? 'success' : 'warning'}>{score}</Tag>
                  </Space>
                ),
              },
              {
                title: '语义状态',
                width: 130,
                render: (_, record: any) => {
                  const mapped = objects.some((object) => object.source === record.id);
                  const ready = semanticReadyTables.includes(record.id);
                  const published = publishedTables.includes(record.id);
                  const candidateCount = candidateCountByTable[record.id] ?? 0;
                  const text = published ? '已送审' : mapped ? '已映射本体' : candidateCount ? `${candidateCount} 条候选` : ready ? '已识别' : '待识别';
                  return <Tag color={published ? 'success' : mapped || ready ? 'processing' : 'default'}>{text}</Tag>;
                },
              },
              {
                title: '字段摘要',
                dataIndex: 'fields',
                render: (fields: any[]) => <Space wrap>{fields.slice(0, 4).map((field) => <Tag key={field.name}>{field.label}</Tag>)}</Space>,
              },
            ]}
          />
        </Card>
      </main>

      <aside className="data-asset-detail">
        <Card className="data-asset-detail-card" title={selectedTable?.label ?? '资产详情'} extra={<Tag color={selectedTable?.quality_score >= 95 ? 'success' : 'warning'}>质量 {selectedTable?.quality_score ?? '-'}</Tag>}>
          {selectedTable ? (
            <Tabs
              size="small"
              items={[
                {
                  key: 'profile',
                  label: '字段画像',
                  children: (
                    <Space direction="vertical" size={12} style={{ width: '100%' }}>
                      <div className="data-asset-summary">
                        <span>物理表</span><strong>{selectedTable.name}</strong>
                        <span>负责人</span><strong>{selectedTable.owner}</strong>
                        <span>同步状态</span><strong>{selectedTable.status}</strong>
                      </div>
                      <List
                        dataSource={selectedTable.fields}
                        renderItem={(field) => (
                          <List.Item className="data-field-item">
                            <List.Item.Meta
                              title={<Space wrap><strong>{field.label}</strong><Tag>{field.name}</Tag><Tag>{field.type}</Tag>{field.primary_key ? <Tag color="blue">主键</Tag> : null}</Space>}
                              description={<Space wrap><span>空值率 0%</span><span>唯一性 {field.primary_key ? '100%' : '86%'}</span><span>质量 {field.quality === 'warning' ? '需复核' : '正常'}</span></Space>}
                            />
                          </List.Item>
                        )}
                      />
                    </Space>
                  ),
                },
                {
                  key: 'quality',
                  label: '质量规则',
                  children: (
                    <Space direction="vertical" size={10} style={{ width: '100%' }}>
                      {getTableQualityRules(selectedTable).map((rule) => (
                        <div className="data-quality-row" key={rule.key}>
                          <Checkbox
                            checked={(qualityRuleState[`${selectedTable.id}:${rule.key}`] ?? (rule.enabled ? 'enabled' : 'disabled')) === 'enabled'}
                            onChange={(event) => updateQualityRule(rule.key, event.target.checked)}
                          >
                            <span className="data-quality-rule-title">{rule.name}</span>
                            <span className="data-quality-rule-desc">{rule.description}</span>
                          </Checkbox>
                          <Space size={6}>
                            {rule.passRate === null ? <Tag>待算</Tag> : <Tag>{rule.passRate}%</Tag>}
                            <Tag color={rule.color}>{rule.status}</Tag>
                          </Space>
                        </div>
                      ))}
                    </Space>
                  ),
                },
                {
                  key: 'mapping',
                  label: '语义映射',
                  children: (
                    <Space direction="vertical" size={12} style={{ width: '100%' }}>
                      <Alert showIcon type="info" message="AI 已根据字段名、样例值和业务域生成候选本体映射，确认后可进入对象与关系中心。" />
                      <div className="data-mapping-card">
                        <Typography.Text type="secondary">推荐实体</Typography.Text>
                        <Typography.Title level={5}>{selectedTable.label.replace('主数据', '') || selectedTable.label}</Typography.Title>
                        <Space wrap style={{ marginBottom: 8 }}>
                          <Tag color={semanticReadyTables.includes(selectedTable.id) ? 'processing' : 'default'}>{selectedTableCandidates.length ? `已生成 ${selectedTableCandidates.length} 条候选` : candidateCountByTable[selectedTable.id] ? `已生成 ${candidateCountByTable[selectedTable.id]} 条候选` : semanticReadyTables.includes(selectedTable.id) ? '已生成候选映射' : '等待 AI 识别'}</Tag>
                          <Tag color={publishedTables.includes(selectedTable.id) ? 'success' : 'default'}>{publishedTables.includes(selectedTable.id) ? '已送审' : '未送审'}</Tag>
                        </Space>
                        <Space wrap>
                          {selectedTable.fields.slice(0, 5).map((field) => (
                            <Tag key={field.name}>{field.name} → {field.label}</Tag>
                          ))}
                        </Space>
                      </div>
                      <div className="data-candidate-list">
                        <div className="data-candidate-list-head">
                          <Typography.Text strong>候选明细</Typography.Text>
                          <Tag>{selectedTableCandidates.length || candidateCountByTable[selectedTable.id] || 0}</Tag>
                        </div>
                        {selectedTableCandidates.length ? (
                          <List
                            size="small"
                            dataSource={selectedTableCandidates}
                            renderItem={(candidate) => (
                              <List.Item className="data-candidate-item">
                                <Space direction="vertical" size={3} style={{ width: '100%' }}>
                                  <Space wrap>
                                    <Tag color={candidate.candidate_type === 'object' ? 'blue' : candidate.candidate_type === 'relation' ? 'purple' : 'default'}>{getCandidateTypeLabel(candidate.candidate_type)}</Tag>
                                    <Typography.Text strong>{candidate.title}</Typography.Text>
                                  </Space>
                                  <Space wrap>
                                    <span>置信度 {Math.round(Number(candidate.confidence || 0) * 100)}%</span>
                                    <span>状态 {candidate.status === 'pending_review' ? '待审核' : candidate.status}</span>
                                  </Space>
                                </Space>
                              </List.Item>
                            )}
                          />
                        ) : (
                          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无候选明细，点击 AI 语义识别后生成" />
                        )}
                      </div>
                      <Button type="primary" block icon={<NodeIndexOutlined />} disabled={selectedAsset?.allow_ontology === false} onClick={publishToOntology}>送入对象与关系中心</Button>
                    </Space>
                  ),
                },
                {
                  key: 'lineage',
                  label: '血缘下游',
                  children: (
                    <Space direction="vertical" size={10} style={{ width: '100%' }}>
                      <div className="data-lineage-step"><Tag>来源</Tag><span>{selectedTable.assetName}</span></div>
                      <div className="data-lineage-step"><Tag color="blue">本体</Tag><span>{objects.some((object) => object.source === selectedTable.id) ? '已绑定对象' : '等待建模'}</span></div>
                      <div className="data-lineage-step"><Tag color="purple">图谱</Tag><span>发布后生成实体与关系实例</span></div>
                      <div className="data-lineage-step"><Tag color="green">AI</Tag><span>可用于结构化问答与诊断分析</span></div>
                    </Space>
                  ),
                },
              ]}
            />
          ) : (
            <Empty />
          )}
        </Card>
      </aside>
    </div>
    <Modal
      title={sourceEditingId ? '编辑数据源' : '接入数据源'}
      open={sourceModalOpen}
      onCancel={closeDataSourceWizard}
      width={980}
      destroyOnHidden
      footer={
        <Space>
          <Button onClick={closeDataSourceWizard}>取消</Button>
          {sourceStep > 0 && <Button onClick={() => setSourceStep((prev) => prev - 1)}>上一步</Button>}
          {sourceStep < 2 ? (
            <Button type="primary" onClick={nextSourceStep}>下一步</Button>
          ) : (
            <Button type="primary" onClick={saveDataSource}>{sourceEditingId ? '保存修改' : '接入并生成资产'}</Button>
          )}
        </Space>
      }
    >
      <div className="source-onboarding">
        <Steps
          size="small"
          current={sourceStep}
          items={[
            { title: '连接' },
            { title: '采集范围' },
            { title: '治理使用' },
          ]}
        />
        <Form
          form={dataSourceForm}
          layout="vertical"
          className="source-onboarding-form"
          onValuesChange={handleSourceFormValuesChange}
        >
          {sourceStep === 0 && <section className="source-form-section source-connection-section">
            <div className="source-section-title">
              <Typography.Text strong>连接与凭据</Typography.Text>
              <Space size={6}>
                {connectionTestResult === 'success' && <Tag color="success">连接成功</Tag>}
                {connectionTestResult === 'error' && <Tag color="error">连接失败</Tag>}
              </Space>
            </div>
            <div className="source-connection-visual">
              <div className="source-connection-node">
                <DatabaseOutlined />
                <span>平台</span>
              </div>
              <div className="source-connection-line" />
              <div className="source-connection-node">
                <DatabaseOutlined />
                <span>数据库</span>
              </div>
            </div>
            <div className="source-connection-fields">
              <div className="source-connection-row">
                <span className="source-connection-label required">类型:</span>
                <Form.Item name="type" rules={[{ required: true }]}>
                  <Select
                    options={[
                      { value: 'postgresql', label: 'PostgreSQL' },
                      { value: 'mysql', label: 'MySQL 待开发', disabled: true },
                      { value: 'sqlserver', label: 'SQL Server 待开发', disabled: true },
                      { value: 'oracle', label: 'Oracle 待开发', disabled: true },
                      { value: 'rest_api', label: 'REST API 待开发', disabled: true },
                      { value: 'excel', label: 'Excel / CSV 待开发', disabled: true },
                      { value: 'opcua', label: 'OPC UA 待开发', disabled: true },
                    ]}
                  />
                </Form.Item>
              </div>
              <div className="source-connection-row">
                <span className="source-connection-label required">连接名称:</span>
                <Form.Item
                  name="name"
                  rules={[{ required: true, message: '请输入连接名称' }]}
                >
                  <Input placeholder="MES PostgreSQL 生产执行库" />
                </Form.Item>
              </div>
              <div className="source-connection-row">
                <span className="source-connection-label required">主机:</span>
                <Form.Item name="host" rules={[{ required: true, message: '请输入主机或 IP' }]}>
                  <Input placeholder="localhost" />
                </Form.Item>
              </div>
              <div className="source-connection-row short">
                <span className="source-connection-label required">端口:</span>
                <Form.Item name="port" rules={[{ required: true, message: '请输入端口' }]}>
                  <InputNumber min={1} max={65535} />
                </Form.Item>
              </div>
              <div className="source-connection-row">
                <span className="source-connection-label required">初始数据库:</span>
                <Form.Item name="database" rules={[{ required: true, message: '请输入数据库名' }]}>
                  <Input placeholder="mf_mes_execution" />
                </Form.Item>
              </div>
              <div className="source-connection-row">
                <span className="source-connection-label">Schema/命名空间:</span>
                <Form.Item name="schema" extra="可选。PostgreSQL 默认通常是 public；本演示库表在 source。">
                  <Input placeholder="默认 public；演示库填 source" />
                </Form.Item>
              </div>
              <div className="source-connection-row">
                <span className="source-connection-label required">认证:</span>
                <Form.Item name="auth_type" rules={[{ required: true, message: '请选择认证方式' }]}>
                  <Select
                    options={[
                      { value: 'password', label: '用户名 / 密码' },
                      { value: 'token', label: 'Token / API Key 待开发', disabled: true },
                      { value: 'oauth', label: 'OAuth 待开发', disabled: true },
                      { value: 'kerberos', label: 'Kerberos / LDAP 待开发', disabled: true },
                    ]}
                  />
                </Form.Item>
              </div>
              <div className="source-connection-row medium">
                <span className="source-connection-label required">用户名:</span>
                <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
                  <Input placeholder="mf_mes_readonly" />
                </Form.Item>
              </div>
              <div className="source-connection-row medium">
                <span className="source-connection-label required">密码:</span>
                <Form.Item name="password" rules={[{ required: true, message: '请输入密码或 Secret' }]}>
                  <Input.Password placeholder="readonly_demo_123" />
                </Form.Item>
              </div>
              <div className="source-connection-row">
                <span className="source-connection-label">网络:</span>
                <Form.Item name="network_zone">
                  <Select
                    options={[
                      { value: '内网 Connector Agent', label: '内网 Connector Agent' },
                      { value: '平台直连', label: '平台直连' },
                      { value: 'VPN 专线', label: 'VPN 专线' },
                    ]}
                  />
                </Form.Item>
              </div>
              <div className="source-connection-row controls">
                <span className="source-connection-label">选项:</span>
                <div className="source-connection-checks">
                  <Form.Item name="ssl_enabled" valuePropName="checked">
                    <Checkbox>SSL / TLS</Checkbox>
                  </Form.Item>
                  <Form.Item name="save_secret" valuePropName="checked">
                    <Checkbox>保存密码</Checkbox>
                  </Form.Item>
                </div>
              </div>
              <div className="source-connection-row action">
                <span className="source-connection-label" />
                <Button icon={<CheckCircleOutlined />} loading={testingConnection} onClick={testDataSourceConnection}>测试连接</Button>
              </div>
            </div>
          </section>}

          {sourceStep === 1 && <section className="source-form-section">
            <div className="source-section-title">
              <Typography.Text strong>采集范围</Typography.Text>
              <Typography.Text type="secondary">采集内容决定抓取粒度，纳入目录的表决定本次资产边界。</Typography.Text>
            </div>
            <div className="source-range-grid">
              <Form.Item name="sync_scope" label="采集内容" rules={[{ required: true, message: '请选择采集内容' }]}>
                <Checkbox.Group
                  className="source-scope-picker"
                  options={[
                    { label: '表结构', value: 'metadata' },
                    { label: '字段画像', value: 'profile' },
                    { label: '样例数据', value: 'sample' },
                    { label: '全量数据', value: 'full' },
                    { label: '增量数据', value: 'incremental' },
                  ]}
                />
              </Form.Item>
              <div className="source-schedule-grid">
                <Form.Item name="sync_mode" label="采集方式">
                  <Select
                    options={[
                      { value: 'metadata', label: '仅元数据扫描' },
                      { value: 'batch', label: '定时批量同步' },
                      { value: 'incremental', label: '增量同步' },
                      { value: 'cdc', label: 'CDC' },
                    ]}
                  />
                </Form.Item>
                <Form.Item name="sync_frequency" label="频率">
                  <Select
                    options={[
                      { value: '实时', label: '实时' },
                      { value: '每 5 分钟', label: '每 5 分钟' },
                      { value: '每小时', label: '每小时' },
                      { value: '每日', label: '每日' },
                    ]}
                  />
                </Form.Item>
              </div>
            </div>
            <Form.Item name="tables" label="纳入资产目录的表" rules={[{ required: true, message: '请选择至少一张表' }]}>
              {discoveredSourceTables.length ? (
                <Checkbox.Group
                  className="source-table-picker"
                  options={discoveredSourceTables.map((table) => ({
                    label: `${table.name}${typeof table.rows === 'number' ? ` (${table.rows} 行)` : ''}`,
                    value: table.name,
                  }))}
                />
              ) : (
                <Alert showIcon type="warning" message="请先返回连接步骤，点击测试连接读取真实数据库表。" />
              )}
            </Form.Item>
          </section>}

          {sourceStep === 2 && <section className="source-form-section">
            <div className="source-section-title">
              <Typography.Text strong>归属与使用</Typography.Text>
              <Typography.Text type="secondary">决定这个数据源归谁管理，以及后续能否被 AI、对象建模和图谱使用。</Typography.Text>
            </div>
            <div className="source-governance-panel">
              <div className="source-governance-block">
                <div className="source-governance-head">
                  <Typography.Text strong>资产归属</Typography.Text>
                  <Typography.Text type="secondary">用于目录筛选、责任追踪和后续影响分析。</Typography.Text>
                </div>
                <div className="source-governance-grid">
                  <Form.Item name="business_domain" label="业务域" rules={[{ required: true, message: '请选择业务域' }]}>
                    <Select
                      showSearch
                      optionFilterProp="label"
                      options={businessDomainOptions.map((item) => ({ value: item, label: item }))}
                      placeholder="从数据字典读取"
                    />
                  </Form.Item>
                  <Form.Item name="owner" label="负责人" rules={[{ required: true, message: '请选择负责人' }]}>
                    <Select
                      showSearch
                      optionFilterProp="label"
                      options={governanceUsers.map((user) => ({ value: user.value, label: user.email ? `${user.label} · ${user.email}` : user.label }))}
                      placeholder="从系统用户读取"
                    />
                  </Form.Item>
                </div>
              </div>

              <div className="source-governance-block">
                <div className="source-governance-head">
                  <Typography.Text strong>数据分级</Typography.Text>
                  <Typography.Text type="secondary">分级会影响样例采集、AI 使用和图谱实例授权。</Typography.Text>
                </div>
                <Form.Item name="sensitivity" rules={[{ required: true, message: '请选择数据分级' }]}>
                  <Segmented
                    block
                    options={DATA_SENSITIVITY_OPTIONS.map((item) => ({ value: item.value, label: item.label }))}
                  />
                </Form.Item>
                <div className="source-sensitivity-desc">
                  {DATA_SENSITIVITY_OPTIONS.find((item) => item.value === watchedSensitivity)?.description ?? DATA_SENSITIVITY_OPTIONS[0].description}
                </div>
              </div>

              <div className="source-governance-block">
                <div className="source-governance-head">
                  <Typography.Text strong>使用授权</Typography.Text>
                  <Typography.Text type="secondary">控制扫描后的数据能进入哪些治理能力。</Typography.Text>
                </div>
                <div className="source-governance-switches">
                  <div className="source-permission-toggle">
                    <div>
                      <span><RobotOutlined />AI 使用</span>
                      <em>允许生成语义候选</em>
                    </div>
                    <Form.Item name="allow_ai" valuePropName="checked" noStyle>
                      <Switch disabled={watchedSensitivity === 'restricted'} />
                    </Form.Item>
                  </div>
                  <div className="source-permission-toggle">
                    <div>
                      <span><NodeIndexOutlined />对象建模</span>
                      <em>允许发布对象候选</em>
                    </div>
                    <Form.Item name="allow_ontology" valuePropName="checked" noStyle>
                      <Switch />
                    </Form.Item>
                  </div>
                  <div className="source-permission-toggle">
                    <div>
                      <span><BranchesOutlined />图谱实例</span>
                      <em>允许进入关系图谱</em>
                    </div>
                    <Form.Item name="allow_graph" valuePropName="checked" noStyle>
                      <Switch disabled={watchedSensitivity === 'restricted'} />
                    </Form.Item>
                  </div>
                </div>
              </div>
            </div>
          </section>}
        </Form>
      </div>
    </Modal>
    </>
  );

  const ontologyView = (
    <>
      <div className="ontology-workbench">
        <aside className="ontology-directory">
          <Card
            className="semantic-side-card"
            title="对象目录"
            extra={<Button size="small" icon={<ApartmentOutlined />} onClick={() => openObjectModal()}>新增</Button>}
          >
            <div className="ontology-quick-stats">
              <div><strong>{ontologyPublishStats.objects}</strong><span>对象</span></div>
              <div><strong>{ontologyPublishStats.relations}</strong><span>关系</span></div>
              <div><strong>{candidateStats.total}</strong><span>待审核</span></div>
            </div>
            <Select
              value={selectedObject?.id}
              style={{ width: '100%', marginBottom: 12 }}
              options={objects.map((item) => ({ label: `${item.name} / ${item.code}`, value: item.id }))}
              onChange={setSelectedObjectId}
              placeholder="选择对象"
            />
            <List
              className="ontology-object-list"
              dataSource={objects}
              locale={{ emptyText: '暂无正式对象，可从候选审核批准或手工新增' }}
              renderItem={(item) => (
                <List.Item
                  className={item.id === selectedObject?.id ? 'semantic-list-item active' : 'semantic-list-item'}
                  onClick={() => setSelectedObjectId(item.id)}
                >
                  <List.Item.Meta
                    avatar={<ApartmentOutlined />}
                    title={<Space><span>{item.name}</span><Tag>{item.status ?? 'published'}</Tag></Space>}
                    description={`${item.code} · ${item.fields.length} 字段 · ${item.source}`}
                  />
                </List.Item>
              )}
            />
          </Card>
        </aside>
        <main className="ontology-main">
          <section className="ontology-toolbar">
            <div>
              <Typography.Title level={4}>对象与关系中心</Typography.Title>
              <Typography.Text type="secondary">从数据资产中心和知识中心进入的候选，需要审核后才能成为正式企业对象模型。</Typography.Text>
            </div>
            <Space wrap>
              <Button icon={<ReloadOutlined />} onClick={refreshOntologyGovernance}>刷新</Button>
              <Button icon={<BranchesOutlined />} onClick={openRelationModal} disabled={!objects.length}>新增关系</Button>
              <Button type="primary" icon={<CheckCircleOutlined />} loading={publishingOntology} onClick={publishOntologyVersion}>发布版本</Button>
            </Space>
          </section>
          <Tabs
            className="ontology-governance-tabs"
            activeKey={ontologyTab}
            onChange={setOntologyTab}
            items={[
              {
                key: 'objects',
                label: '对象模型',
                children: selectedObject ? (
                  <Space direction="vertical" size={14} style={{ width: '100%' }}>
                    <Card
                      title={<Space><NodeIndexOutlined />{selectedObject.name}<Tag>{selectedObject.code}</Tag></Space>}
                      extra={(
                        <Space>
                          <Tag color="processing">来源：{selectedObject.source}</Tag>
                          <Button size="small" onClick={() => openObjectModal(selectedObject)}>编辑</Button>
                          <Button size="small" danger onClick={deprecateSelectedObject}>废弃</Button>
                          <Button size="small" loading={impactLoading} onClick={() => runImpactAnalysis()}>看影响</Button>
                        </Space>
                      )}
                    >
                      <Typography.Paragraph>{selectedObject.description || '暂无对象说明'}</Typography.Paragraph>
                      <div className="ontology-object-meta">
                        <div><span>领域</span><strong>{selectedObject.domain ?? 'manufacturing'}</strong></div>
                        <div><span>状态</span><strong>{selectedObject.status ?? 'published'}</strong></div>
                        <div><span>置信度</span><strong>{Math.round((selectedObject.confidence ?? 1) * 100)}%</strong></div>
                        <div><span>映射</span><strong>{selectedObjectMappings.length}</strong></div>
                      </div>
                    </Card>
                    <Card title="字段定义">
                      <Table
                        size="small"
                        rowKey={(record) => record.id ?? record.name}
                        dataSource={selectedObject.fields}
                        pagination={{ pageSize: 8 }}
                        columns={[
                          { title: '对象字段', dataIndex: 'label' },
                          { title: '字段编码', dataIndex: 'name' },
                          { title: '类型', dataIndex: 'type', render: (type: string) => <Tag>{type}</Tag> },
                          { title: '来源字段', dataIndex: 'source_field' },
                          { title: '列表', dataIndex: 'list', render: boolTag },
                          { title: '表单', dataIndex: 'form', render: boolTag },
                          { title: '搜索', dataIndex: 'search', render: boolTag },
                          { title: '影响', width: 92, render: (_, record) => <Button size="small" onClick={() => runImpactAnalysis(record.name)}>检查</Button> },
                        ]}
                      />
                    </Card>
                    <Card title="数据映射">
                      <Table
                        size="small"
                        rowKey="id"
                        dataSource={selectedObjectMappings}
                        pagination={{ pageSize: 5 }}
                        locale={{ emptyText: '暂无字段映射，可从数据资产候选审核生成' }}
                        columns={[
                          { title: '来源系统', dataIndex: 'source_system', width: 100 },
                          { title: '来源实体', dataIndex: 'source_entity' },
                          { title: '来源字段', dataIndex: 'source_field' },
                          { title: '目标字段', dataIndex: 'target_field_code' },
                          { title: '置信度', dataIndex: 'confidence', width: 120, render: (value: number) => <Progress percent={Math.round((value ?? 0) * 100)} size="small" /> },
                        ]}
                      />
                    </Card>
                  </Space>
                ) : <Empty description="暂无对象模型" />,
              },
              {
                key: 'relations',
                label: '关系模型',
                children: (
                  <Row gutter={[16, 16]}>
                    <Col xs={24} xl={15}>
                      <Card title={<Space><BranchesOutlined />对象关系 / 图谱边</Space>} extra={<Button size="small" onClick={openRelationModal}>新增关系</Button>}>
                        <Table
                          size="small"
                          rowKey="id"
                          dataSource={relations}
                          pagination={{ pageSize: 10 }}
                          columns={[
                            { title: '源对象', dataIndex: 'source' },
                            { title: '关系', dataIndex: 'label', render: (text, record: OntologyRelation) => <Space><Tag color="blue">{record.type}</Tag>{text}</Space> },
                            { title: '目标对象', dataIndex: 'target' },
                            { title: '进入图谱', dataIndex: 'graph', render: boolTag },
                            { title: '状态', dataIndex: 'status', render: (value) => <Tag>{value ?? 'published'}</Tag> },
                          ]}
                        />
                      </Card>
                    </Col>
                    <Col xs={24} xl={9}>
                      <Card title="关系图预览">
                        <div className="ontology-graph-preview">
                          <div className="ontology-graph-node main">{selectedObject?.code ?? 'Object'}</div>
                          {objectRelations.slice(0, 4).map((relation, index) => {
                            const target = relation.source === selectedObject?.code || relation.source === selectedObject?.id ? relation.target : relation.source;
                            return (
                              <div className={`ontology-graph-node node-${index + 1}`} key={relation.id}>
                                <span>{target}</span>
                                <small>{relation.type}</small>
                              </div>
                            );
                          })}
                        </div>
                      </Card>
                    </Col>
                  </Row>
                ),
              },
              {
                key: 'candidates',
                label: `候选审核 ${candidateStats.total}`,
                children: (
                  <Row gutter={[16, 16]}>
                    <Col xs={24} xl={15}>
                      <Card
                        title="候选审核队列"
                        extra={<Space><Tag>对象 {candidateStats.objects}</Tag><Tag>关系 {candidateStats.relations}</Tag><Tag>映射 {candidateStats.mappings}</Tag></Space>}
                      >
                        <Table
                          size="small"
                          rowKey="id"
                          dataSource={ontologyCandidates}
                          pagination={{ pageSize: 10 }}
                          onRow={(record) => ({ onClick: () => setSelectedCandidateId(record.id) })}
                          rowClassName={(record) => record.id === selectedCandidate?.id ? 'active-row' : ''}
                          columns={[
                            { title: '类型', dataIndex: 'candidate_type', width: 110, render: (value: string) => <Tag color={value === 'relation' ? 'blue' : value === 'mapping' ? 'green' : 'gold'}>{value}</Tag> },
                            { title: '候选', dataIndex: 'title', ellipsis: true },
                            { title: '来源', dataIndex: 'source_ref', ellipsis: true },
                            { title: '置信度', dataIndex: 'confidence', width: 130, render: (value: number) => <Progress percent={Math.round((value ?? 0) * 100)} size="small" /> },
                            { title: '操作', width: 150, render: (_, record) => (
                              <Space>
                                <Button size="small" type="primary" loading={reviewingCandidateId === record.id} onClick={(event) => { event.stopPropagation(); reviewCandidate(record, 'approve'); }}>批准</Button>
                                <Button size="small" danger loading={reviewingCandidateId === record.id} onClick={(event) => { event.stopPropagation(); reviewCandidate(record, 'reject'); }}>拒绝</Button>
                              </Space>
                            ) },
                          ]}
                        />
                      </Card>
                    </Col>
                    <Col xs={24} xl={9}>
                      <Card title="候选详情">
                        {selectedCandidate ? (
                          <Space direction="vertical" size={12} style={{ width: '100%' }}>
                            <Space wrap><Tag>{selectedCandidate.candidate_type}</Tag><Tag color="processing">{selectedCandidate.status}</Tag><Tag>{Math.round(selectedCandidate.confidence * 100)}%</Tag></Space>
                            <Typography.Title level={5}>{selectedCandidate.title}</Typography.Title>
                            <Typography.Text type="secondary">{selectedCandidate.source_ref}</Typography.Text>
                            <pre className="ontology-payload-preview">{JSON.stringify(selectedCandidate.payload, null, 2)}</pre>
                            <Space>
                              <Button type="primary" icon={<CheckCircleOutlined />} loading={reviewingCandidateId === selectedCandidate.id} onClick={() => reviewCandidate(selectedCandidate, 'approve')}>批准进入正式模型</Button>
                              <Button danger loading={reviewingCandidateId === selectedCandidate.id} onClick={() => reviewCandidate(selectedCandidate, 'reject')}>拒绝</Button>
                            </Space>
                          </Space>
                        ) : <Empty description="暂无待审核候选" />}
                      </Card>
                    </Col>
                  </Row>
                ),
              },
              {
                key: 'publish',
                label: '发布治理',
                children: (
                  <Row gutter={[16, 16]}>
                    <Col xs={24} xl={9}>
                      <Card title="发布前检查">
                        <Space direction="vertical" size={12} style={{ width: '100%' }}>
                          <Alert type="success" showIcon message={`${ontologyPublishStats.objects} 个对象，${ontologyPublishStats.fields} 个字段`} />
                          <Alert type="success" showIcon message={`${ontologyPublishStats.relations} 条关系，${ontologyPublishStats.graphRelations} 条进入图谱`} />
                          <Alert type={candidateStats.total ? 'warning' : 'success'} showIcon message={candidateStats.total ? `${candidateStats.total} 条候选仍待审核` : '候选队列已清空'} />
                          <Alert type="info" showIcon message={`${ontologyPublishStats.mappings} 条数据字段映射`} />
                          <Button type="primary" block icon={<CheckCircleOutlined />} loading={publishingOntology} onClick={publishOntologyVersion}>发布 Ontology 新版本</Button>
                        </Space>
                      </Card>
                    </Col>
                    <Col xs={24} xl={15}>
                      <Card title="版本历史">
                        <Table
                          size="small"
                          rowKey="id"
                          dataSource={ontologyVersions}
                          pagination={false}
                          columns={[
                            { title: '版本', dataIndex: 'version', width: 90, render: (value) => <Tag color="blue">v{value}</Tag> },
                            { title: '标题', dataIndex: 'title' },
                            { title: '发布时间', dataIndex: 'published_at', width: 210 },
                            { title: '快照', width: 220, render: (_, record: OntologyVersion) => `${record.snapshot?.objects?.length ?? 0} 对象 / ${record.snapshot?.relations?.length ?? 0} 关系 / ${record.snapshot?.mappings?.length ?? 0} 映射` },
                          ]}
                        />
                      </Card>
                    </Col>
                  </Row>
                ),
              },
              {
                key: 'impact',
                label: '影响分析',
                children: (
                  <Row gutter={[16, 16]}>
                    <Col xs={24} xl={8}>
                      <Card title="分析目标">
                        <Space direction="vertical" style={{ width: '100%' }}>
                          <Select value={selectedObject?.id} options={objects.map((item) => ({ label: `${item.name} / ${item.code}`, value: item.id }))} onChange={setSelectedObjectId} />
                          <Button type="primary" loading={impactLoading} onClick={() => runImpactAnalysis()} block>检查对象影响</Button>
                          <Typography.Text type="secondary">废弃、重命名或修改字段前，先检查运行表单、数据映射、知识链接和 AI 工具引用。</Typography.Text>
                        </Space>
                      </Card>
                    </Col>
                    <Col xs={24} xl={16}>
                      <Card title={`影响结果：${selectedObject?.code ?? '-'}`}>
                        {impactResult ? (
                          <Space direction="vertical" size={12} style={{ width: '100%' }}>
                            <Alert type={impactResult.blocking ? 'error' : 'success'} showIcon message={impactResult.blocking ? '存在阻断影响，需要变更评审' : '暂无阻断影响'} />
                            {Object.entries(impactResult.items ?? {}).map(([key, value]) => (
                              <div className="ontology-impact-section" key={key}>
                                <Typography.Text strong>{key}</Typography.Text>
                                <List
                                  size="small"
                                  dataSource={Array.isArray(value) ? value : []}
                                  locale={{ emptyText: '无影响项' }}
                                  renderItem={(item: any) => <List.Item>{item.name ?? item.label ?? item.field ?? item.document_id ?? item.id}<Typography.Text type="secondary">{item.impact ? ` · ${item.impact}` : ''}</Typography.Text></List.Item>}
                                />
                              </div>
                            ))}
                          </Space>
                        ) : <Empty description="选择对象后运行影响分析" />}
                      </Card>
                    </Col>
                  </Row>
                ),
              },
            ]}
          />
        </main>
      </div>
      <Modal title="对象模型" open={objectModalOpen} onCancel={() => setObjectModalOpen(false)} onOk={saveOntologyObject} confirmLoading={savingObject} width={780} okText="保存">
        <Form form={ontologyObjectForm} layout="vertical">
          <Row gutter={12}>
            <Col span={12}><Form.Item name="name" label="对象名称" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="code" label="对象编码" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="domain" label="领域"><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="status" label="状态"><Select options={[{ value: 'draft', label: 'draft' }, { value: 'published', label: 'published' }, { value: 'deprecated', label: 'deprecated' }]} /></Form.Item></Col>
          </Row>
          <Form.Item name="description" label="说明"><Input.TextArea rows={2} /></Form.Item>
          <Form.List name="fields">
            {(fields, { add, remove }) => (
              <Space direction="vertical" style={{ width: '100%' }}>
                <Space style={{ justifyContent: 'space-between', width: '100%' }}><Typography.Text strong>字段</Typography.Text><Button size="small" onClick={() => add({ type: 'string', list: true, form: true })}>新增字段</Button></Space>
                {fields.map((field) => (
                  <Row gutter={8} key={field.key} align="middle">
                    <Col span={5}><Form.Item name={[field.name, 'code']} rules={[{ required: true }]}><Input placeholder="编码" /></Form.Item></Col>
                    <Col span={5}><Form.Item name={[field.name, 'label']}><Input placeholder="名称" /></Form.Item></Col>
                    <Col span={4}><Form.Item name={[field.name, 'type']}><Select options={['string', 'number', 'datetime', 'enum', 'boolean'].map((value) => ({ value, label: value }))} /></Form.Item></Col>
                    <Col span={5}><Form.Item name={[field.name, 'source_field']}><Input placeholder="来源字段" /></Form.Item></Col>
                    <Col span={3}><Form.Item name={[field.name, 'search']} valuePropName="checked"><Checkbox>搜索</Checkbox></Form.Item></Col>
                    <Col span={2}><Button danger size="small" onClick={() => remove(field.name)}>删</Button></Col>
                  </Row>
                ))}
              </Space>
            )}
          </Form.List>
        </Form>
      </Modal>
      <Modal title="对象关系" open={relationModalOpen} onCancel={() => setRelationModalOpen(false)} onOk={saveOntologyRelation} confirmLoading={savingRelation} okText="保存">
        <Form form={ontologyRelationForm} layout="vertical">
          <Form.Item name="name" label="关系名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="source_object_code" label="源对象" rules={[{ required: true }]}><Select options={objects.map((item) => ({ value: item.code, label: `${item.name} / ${item.code}` }))} /></Form.Item></Col>
            <Col span={12}><Form.Item name="target_object_code" label="目标对象" rules={[{ required: true }]}><Select options={objects.map((item) => ({ value: item.code, label: `${item.name} / ${item.code}` }))} /></Form.Item></Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="relation_type" label="关系类型"><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="graph_enabled" label="进入图谱" valuePropName="checked"><Switch /></Form.Item></Col>
          </Row>
          <Form.Item name="description" label="说明"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>
    </>
  );

  const viewContent = {
    data: dataAssetView,
    ontology: ontologyView,
  }[view ?? 'data'];

  if (view) {
    return (
      <div className="semantic-center semantic-asset-center semantic-asset-center-single">
        {viewContent}
      </div>
    );
  }

  return (
    <div className="semantic-center semantic-asset-center">
      <section className="semantic-center-header">
        <div>
          <Typography.Title level={4}>语义资产中心</Typography.Title>
          <Typography.Text type="secondary">统一管理数据资产、对象关系建模和文档知识抽取，图谱视图已融入知识库中心。</Typography.Text>
        </div>
        <Space>
          <Tag icon={<FileSearchOutlined />}>Graph Governance</Tag>
          <Button icon={<ReloadOutlined />} onClick={load}>重新读取</Button>
        </Space>
      </section>
      <Tabs
        items={[
          { key: 'data', label: '数据资产中心', children: dataAssetView },
          { key: 'ontology', label: '对象与关系中心', children: ontologyView },
        ]}
      />
    </div>
  );
}

function KnowledgeGraphCenter() {
  const [nodes, setNodes] = useState<GraphAssetNode[]>([]);
  const [relationships, setRelationships] = useState<GraphAssetRelationship[]>([]);
  const [evidence, setEvidence] = useState<GraphAssetEvidence[]>([]);
  const [quality, setQuality] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [entityType, setEntityType] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  const loadGraphAssets = async () => {
    setLoading(true);
    try {
      const [nodeRes, relRes, evidenceRes, qualityRes] = await Promise.all([
        listGraphAssetNodes({ search: search || undefined, entity_type: entityType }),
        listGraphAssetRelationships({ search: search || undefined }),
        listGraphAssetEvidence(),
        getGraphAssetQuality(),
      ]);
      setNodes(nodeRes.data?.data ?? []);
      setRelationships(relRes.data?.data ?? []);
      setEvidence(evidenceRes.data?.data ?? []);
      setQuality(qualityRes.data?.data ?? null);
    } catch {
      setNodes([]);
      setRelationships([]);
      setEvidence([]);
      setQuality(null);
      message.warning('后端图谱接口暂不可用，未展示本地兜底案例');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadGraphAssets();
  }, []);

  const entityTypeOptions = Array.from(new Set(nodes.map((item) => item.type).filter(Boolean))).map((type) => ({ value: type, label: type }));

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Row gutter={[16, 16]}>
        <Col xs={24} md={6}><GraphMetric title="已发布节点" value={nodes.length} /></Col>
        <Col xs={24} md={6}><GraphMetric title="已发布关系" value={relationships.length} /></Col>
        <Col xs={24} md={6}><GraphMetric title="证据链" value={evidence.length} /></Col>
        <Col xs={24} md={6}><GraphMetric title="待绑定主数据" value={quality?.summary?.unbound_nodes ?? 0} /></Col>
      </Row>
      <Card>
        <Space wrap style={{ marginBottom: 16 }}>
          <Input.Search allowClear placeholder="搜索节点、关系或来源任务" value={search} onChange={(event) => setSearch(event.target.value)} onSearch={loadGraphAssets} style={{ width: 280 }} />
          <Select allowClear placeholder="实体类型" value={entityType} options={entityTypeOptions} onChange={setEntityType} style={{ width: 180 }} />
          <Button icon={<ReloadOutlined />} loading={loading} onClick={loadGraphAssets}>刷新图谱资产</Button>
          <Tag color="processing">后台治理视图</Tag>
        </Space>
        <Tabs
          items={[
            {
              key: 'nodes',
              label: `节点 (${nodes.length})`,
              children: (
                <Table
                  size="small"
                  rowKey="id"
                  loading={loading}
                  dataSource={nodes}
                  pagination={{ pageSize: 8 }}
                  columns={[
                    { title: '名称', dataIndex: 'name', ellipsis: true },
                    { title: '类型', dataIndex: 'type', width: 140, render: (value) => <Tag color="blue">{value}</Tag> },
                    { title: '绑定状态', dataIndex: 'binding_status', width: 120, render: (value) => <Tag color={value === 'bound' ? 'success' : 'gold'}>{value || 'unbound'}</Tag> },
                    { title: '发布', dataIndex: 'publish_status', width: 110, render: (value) => <Tag color={value === 'published' ? 'green' : 'default'}>{value}</Tag> },
                    { title: '置信度', dataIndex: 'confidence', width: 140, render: (value: number) => <Progress size="small" percent={confidencePercent(value)} /> },
                    { title: '证据', dataIndex: 'source_location', width: 120 },
                    { title: '抽取任务', dataIndex: 'knowledge_job_id', width: 180, ellipsis: true },
                  ]}
                />
              ),
            },
            {
              key: 'relationships',
              label: `关系 (${relationships.length})`,
              children: (
                <Table
                  size="small"
                  rowKey="id"
                  loading={loading}
                  dataSource={relationships}
                  pagination={{ pageSize: 8 }}
                  columns={[
                    { title: '起点', dataIndex: 'source_name', ellipsis: true },
                    { title: '关系', dataIndex: 'relation_type', width: 130, render: (value) => <Tag color="purple">{value}</Tag> },
                    { title: '终点', dataIndex: 'target_name', ellipsis: true },
                    { title: '发布', dataIndex: 'publish_status', width: 110, render: (value) => <Tag color={value === 'published' ? 'green' : 'default'}>{value}</Tag> },
                    { title: '置信度', dataIndex: 'confidence', width: 140, render: (value: number) => <Progress size="small" percent={confidencePercent(value)} /> },
                    { title: '证据', dataIndex: 'source_location', width: 120 },
                  ]}
                />
              ),
            },
            {
              key: 'evidence',
              label: `证据 (${evidence.length})`,
              children: (
                <Table
                  size="small"
                  rowKey="id"
                  loading={loading}
                  dataSource={evidence}
                  pagination={{ pageSize: 8 }}
                  columns={[
                    { title: '对象', dataIndex: 'asset_name', ellipsis: true },
                    { title: '类型', dataIndex: 'asset_type', width: 130, render: (value) => <Tag>{value}</Tag> },
                    { title: '来源文档', dataIndex: 'source_document_id', width: 180, ellipsis: true },
                    { title: '位置', dataIndex: 'source_location', width: 120 },
                    { title: '置信度', dataIndex: 'confidence', width: 140, render: (value: number) => <Progress size="small" percent={confidencePercent(value)} /> },
                    { title: '抽取任务', dataIndex: 'knowledge_job_id', width: 180, ellipsis: true },
                  ]}
                />
              ),
            },
            {
              key: 'quality',
              label: `质量问题 (${quality?.items?.length ?? 0})`,
              children: (
                <Table
                  size="small"
                  rowKey={(record: any) => `${record.code}-${record.asset_id}-${record.target}`}
                  loading={loading}
                  dataSource={quality?.items ?? []}
                  pagination={{ pageSize: 8 }}
                  columns={[
                    { title: '级别', dataIndex: 'severity', width: 110, render: (value) => <Tag color={severityColors[value] || 'default'}>{value}</Tag> },
                    { title: '代码', dataIndex: 'code', width: 220 },
                    { title: '对象', dataIndex: 'target', ellipsis: true },
                    { title: '资产ID', dataIndex: 'asset_id', width: 180, ellipsis: true },
                  ]}
                />
              ),
            },
          ]}
        />
      </Card>
    </Space>
  );
}

function KnowledgeGraphCenterV2({ embedded = false, sourceDocumentId }: { embedded?: boolean; sourceDocumentId?: string } = {}) {
  const [nodes, setNodes] = useState<GraphAssetNode[]>([]);
  const [relationships, setRelationships] = useState<GraphAssetRelationship[]>([]);
  const [evidence, setEvidence] = useState<GraphAssetEvidence[]>([]);
  const [quality, setQuality] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [entityType, setEntityType] = useState<string | undefined>();
  const [publishStatus, setPublishStatus] = useState<string | undefined>();
  const [bindingStatus, setBindingStatus] = useState<string | undefined>();
  const [hideIsolated, setHideIsolated] = useState(false);
  const [neighborFocus, setNeighborFocus] = useState(true);
  const [relationshipLabels, setRelationshipLabels] = useState(true);
  const [layoutMode, setLayoutMode] = useState('治理视图');
  const [selected, setSelected] = useState<{ kind: 'node'; data: GraphAssetNode } | { kind: 'relationship'; data: GraphAssetRelationship } | null>(null);
  const [loading, setLoading] = useState(false);
  const cyContainerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const effectiveSourceDocumentId = sourceDocumentId ? (GRAPH_DOCUMENT_ALIASES[sourceDocumentId] ?? sourceDocumentId) : undefined;

  const loadGraphAssets = async () => {
    setLoading(true);
    try {
      const [nodeRes, relRes, evidenceRes, qualityRes] = await Promise.all([
        listGraphAssetNodes({ search: search || undefined, entity_type: entityType }),
        listGraphAssetRelationships({ search: search || undefined }),
        listGraphAssetEvidence(),
        getGraphAssetQuality(),
      ]);
      setNodes(nodeRes.data?.data ?? []);
      setRelationships(relRes.data?.data ?? []);
      setEvidence(evidenceRes.data?.data ?? []);
      setQuality(qualityRes.data?.data ?? null);
    } catch {
      setNodes([]);
      setRelationships([]);
      setEvidence([]);
      setQuality(null);
      message.warning('后端图谱接口暂不可用，未展示本地兜底案例');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadGraphAssets();
  }, []);

  const entityTypeOptions = Array.from(new Set(nodes.map((item) => item.type).filter(Boolean))).map((type) => ({ value: type, label: type }));
  const baseVisibleNodes = useMemo(() => nodes.filter((node) => {
    const matchedSearch = !search || `${node.name} ${node.type} ${node.knowledge_job_id ?? ''}`.toLowerCase().includes(search.toLowerCase());
    const matchedType = !entityType || node.type === entityType;
    const matchedPublish = !publishStatus || node.publish_status === publishStatus;
    const matchedBinding = !bindingStatus || (node.binding_status || 'unbound') === bindingStatus;
    const matchedDocument = !embedded || !effectiveSourceDocumentId || node.source_document_id === effectiveSourceDocumentId;
    return matchedSearch && matchedType && matchedPublish && matchedBinding && matchedDocument;
  }), [bindingStatus, effectiveSourceDocumentId, embedded, entityType, nodes, publishStatus, search]);
  const baseVisibleNodeNames = useMemo(() => new Set(baseVisibleNodes.map((node) => node.name)), [baseVisibleNodes]);
  const baseVisibleRelationships = useMemo(() => relationships.filter((rel) => {
    const matchedSearch = !search || `${rel.source_name} ${rel.target_name} ${rel.relation_type} ${rel.knowledge_job_id ?? ''}`.toLowerCase().includes(search.toLowerCase());
    const matchedDocument = !embedded || !effectiveSourceDocumentId || rel.source_document_id === effectiveSourceDocumentId;
    return matchedSearch && matchedDocument && baseVisibleNodeNames.has(rel.source_name) && baseVisibleNodeNames.has(rel.target_name);
  }), [baseVisibleNodeNames, effectiveSourceDocumentId, embedded, relationships, search]);
  const connectedNodeNames = useMemo(() => new Set(baseVisibleRelationships.flatMap((rel) => [rel.source_name, rel.target_name])), [baseVisibleRelationships]);
  const visibleNodes = useMemo(() => (hideIsolated ? baseVisibleNodes.filter((node) => connectedNodeNames.has(node.name)) : baseVisibleNodes), [baseVisibleNodes, connectedNodeNames, hideIsolated]);
  const visibleNodeNames = useMemo(() => new Set(visibleNodes.map((node) => node.name)), [visibleNodes]);
  const visibleRelationships = useMemo(() => baseVisibleRelationships.filter((rel) => visibleNodeNames.has(rel.source_name) && visibleNodeNames.has(rel.target_name)), [baseVisibleRelationships, visibleNodeNames]);
  const selectedEvidence = useMemo(() => {
    if (!selected) return evidence.slice(0, 6);
    const name = selected.kind === 'node' ? selected.data.name : `${selected.data.source_name} -> ${selected.data.target_name}`;
    return evidence.filter((item) => item.asset_name === name || item.asset_name.includes(name)).slice(0, 6);
  }, [evidence, selected]);

  const zoomGraph = (delta: number) => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.animate({ zoom: Math.min(2.2, Math.max(0.35, cy.zoom() + delta)), center: { eles: cy.elements() } }, { duration: 180 });
  };

  const resetGraphView = () => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.elements().removeClass('faded focused');
    cy.elements().unselect();
    setSelected(null);
    cy.layout(getGraphAssetLayout(layoutMode)).run();
    window.setTimeout(() => cy.fit(undefined, 36), 220);
  };

  useEffect(() => {
    if (!cyContainerRef.current) return;
    if (cyRef.current) {
      cyRef.current.destroy();
      cyRef.current = null;
    }
    if (!visibleNodes.length) return;

    const edgeElements = visibleRelationships.map((rel) => {
      const source = visibleNodes.find((node) => node.name === rel.source_name);
      const target = visibleNodes.find((node) => node.name === rel.target_name);
      if (!source || !target) return null;
      return { group: 'edges' as const, data: { id: rel.id, source: source.id, target: target.id, label: rel.relation_type } };
    }).filter(Boolean) as cytoscape.ElementDefinition[];

    const cy = cytoscape({
      container: cyContainerRef.current,
      elements: [
        ...visibleNodes.map((node) => ({
          group: 'nodes' as const,
          data: { id: node.id, label: node.name, color: graphTypeColors[node.type] || graphTypeColors.default },
        })),
        ...edgeElements,
      ],
      style: [
        { selector: 'node', style: { 'background-color': 'data(color)', label: 'data(label)', color: '#172026', 'font-size': 11, 'font-weight': 700, 'text-valign': 'bottom', 'text-halign': 'center', 'text-margin-y': 8, 'text-wrap': 'wrap', 'text-max-width': '110px', width: 56, height: 56, 'border-width': 4, 'border-color': '#fff' } },
        { selector: 'node:selected', style: { 'border-color': '#172026', 'border-width': 5 } },
        { selector: 'edge', style: { width: 2, 'line-color': '#b9c5ce', 'target-arrow-color': '#b9c5ce', 'target-arrow-shape': 'triangle', 'curve-style': 'bezier', label: relationshipLabels ? 'data(label)' : '', 'font-size': 10, color: '#52616b', 'text-background-color': '#fff', 'text-background-opacity': 0.9, 'text-background-padding': '3px', 'text-rotation': 'autorotate' } },
        { selector: 'edge:selected', style: { width: 4, 'line-color': '#2f5f73', 'target-arrow-color': '#2f5f73' } },
        { selector: '.faded', style: { opacity: 0.16 } },
        { selector: '.focused', style: { opacity: 1 } },
        { selector: 'node.focused', style: { 'border-color': '#172026', 'border-width': 5 } },
        { selector: 'edge.focused', style: { width: 4, 'line-color': '#2f5f73', 'target-arrow-color': '#2f5f73' } },
      ] as unknown as cytoscape.StylesheetCSS[],
      layout: getGraphAssetLayout(layoutMode),
      minZoom: 0.35,
      maxZoom: 2.2,
      wheelSensitivity: 0.25,
    });

    const focusElements = (target: cytoscape.SingularElementReturnValue) => {
      cy.elements().removeClass('faded focused');
      if (!neighborFocus) return;
      const focused = target.isNode()
        ? target.closedNeighborhood()
        : (target as any).connectedNodes().add(target);
      cy.elements().not(focused).addClass('faded');
      focused.addClass('focused');
      cy.animate({ fit: { eles: focused, padding: 90 } }, { duration: 240 });
    };

    cy.on('tap', 'node', (event) => {
      const node = visibleNodes.find((item) => item.id === event.target.id());
      if (node) {
        setSelected({ kind: 'node', data: node });
        focusElements(event.target);
      }
    });
    cy.on('tap', 'edge', (event) => {
      const rel = visibleRelationships.find((item) => item.id === event.target.id());
      if (rel) {
        setSelected({ kind: 'relationship', data: rel });
        focusElements(event.target);
      }
    });
    cy.on('tap', (event) => {
      if (event.target === cy) {
        setSelected(null);
        cy.elements().removeClass('faded focused');
      }
    });

    cyRef.current = cy;
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [layoutMode, neighborFocus, relationshipLabels, visibleNodes, visibleRelationships]);

  return (
    <Space className={embedded ? 'graph-asset-workbench embedded' : 'graph-asset-workbench'} direction="vertical" size={16} style={{ width: '100%' }}>
      <div className={embedded ? 'graph-asset-stage embedded' : 'graph-asset-stage'}>
        {!embedded && <aside className="graph-asset-filter-panel">
          <Typography.Text strong>图谱筛选</Typography.Text>
          <Input.Search allowClear placeholder="搜索节点、关系或任务" value={search} onChange={(event) => setSearch(event.target.value)} onSearch={loadGraphAssets} />
          <Select allowClear placeholder="实体类型" value={entityType} options={entityTypeOptions} onChange={setEntityType} />
          <Select allowClear placeholder="发布状态" value={publishStatus} onChange={setPublishStatus} options={[{ value: 'published', label: 'published' }, { value: 'draft', label: 'draft' }, { value: 'review', label: 'review' }]} />
          <Select allowClear placeholder="绑定状态" value={bindingStatus} onChange={setBindingStatus} options={[{ value: 'bound', label: '已绑定主数据' }, { value: 'unbound', label: '未绑定' }, { value: 'multi_candidate', label: '多候选待确认' }]} />
          <Button icon={<ReloadOutlined />} loading={loading} onClick={loadGraphAssets}>刷新图谱资产</Button>
          <div className="graph-asset-legend">
            {Array.from(new Set(nodes.map((node) => node.type))).slice(0, 8).map((type) => <span key={type}><i style={{ background: graphTypeColors[type] || graphTypeColors.default }} />{type}</span>)}
          </div>
        </aside>}
        <main className="graph-asset-canvas-panel">
          <div className="graph-asset-toolbar">
            <Space wrap><Tag color="processing">{embedded ? '当前文档图谱' : '后台治理视图'}</Tag><Tag>{visibleNodes.length} 节点</Tag><Tag>{visibleRelationships.length} 关系</Tag></Space>
            <Space wrap>
              <span className="graph-asset-stat">正式节点 <strong>{nodes.length}</strong></span>
              <span className="graph-asset-stat">正式关系 <strong>{relationships.length}</strong></span>
              <span className="graph-asset-stat">证据 <strong>{evidence.length}</strong></span>
              <span className="graph-asset-stat warning">待绑定 <strong>{quality?.summary?.unbound_nodes ?? 0}</strong></span>
              <Segmented value={layoutMode} onChange={(value) => setLayoutMode(String(value))} options={['治理视图', '关系视图', '类型视图', '证据视图']} />
            </Space>
          </div>
          <div className="graph-asset-actions">
            <Button size="small" onClick={() => zoomGraph(0.18)}>放大</Button>
            <Button size="small" onClick={() => zoomGraph(-0.18)}>缩小</Button>
            <Button size="small" icon={<NodeIndexOutlined />} onClick={() => cyRef.current?.fit(undefined, 32)}>适配画布</Button>
            <Button size="small" onClick={() => cyRef.current?.layout(getGraphAssetLayout(layoutMode)).run()}>重新布局</Button>
            <Button size="small" type={neighborFocus ? 'primary' : 'default'} onClick={() => setNeighborFocus((value) => !value)}>邻居高亮</Button>
            <Button size="small" type={hideIsolated ? 'primary' : 'default'} onClick={() => setHideIsolated((value) => !value)}>隐藏孤立点</Button>
            <Button size="small" type={relationshipLabels ? 'primary' : 'default'} onClick={() => setRelationshipLabels((value) => !value)}>关系标签</Button>
            <Button size="small" onClick={resetGraphView}>清除选择</Button>
          </div>
          <div className="graph-asset-canvas" ref={cyContainerRef}>{!visibleNodes.length && <Empty description="没有符合筛选条件的图谱资产" />}</div>
        </main>
        <aside className="graph-asset-detail-panel">
          <Typography.Text strong>{selected?.kind === 'relationship' ? '关系详情' : '节点详情'}</Typography.Text>
          {selected ? <GraphAssetDetail selected={selected} evidence={selectedEvidence} /> : <Empty description="点击画布中的节点或关系查看详情" />}
        </aside>
      </div>
      {!embedded && <Card className="graph-asset-governance" title="图谱资产治理">
        <Tabs
          items={[
            { key: 'nodes', label: `节点 (${visibleNodes.length})`, children: <GraphNodesTable nodes={visibleNodes} loading={loading} onSelect={(data) => setSelected({ kind: 'node', data })} /> },
            { key: 'relationships', label: `关系 (${visibleRelationships.length})`, children: <GraphRelationshipsTable relationships={visibleRelationships} loading={loading} onSelect={(data) => setSelected({ kind: 'relationship', data })} /> },
            { key: 'evidence', label: `证据 (${evidence.length})`, children: <GraphEvidenceTable evidence={evidence} loading={loading} /> },
            { key: 'quality', label: `质量问题 (${quality?.items?.length ?? 0})`, children: <GraphQualityTable quality={quality} loading={loading} /> },
          ]}
        />
      </Card>}
    </Space>
  );
}

function getGraphAssetLayout(layoutMode: string): cytoscape.LayoutOptions {
  if (layoutMode === '关系视图') return { name: 'dagre', rankDir: 'LR', fit: true, padding: 36, spacingFactor: 1.15 } as cytoscape.LayoutOptions;
  if (layoutMode === '类型视图') return { name: 'concentric', fit: true, padding: 42, minNodeSpacing: 38 } as cytoscape.LayoutOptions;
  if (layoutMode === '证据视图') return { name: 'breadthfirst', directed: true, fit: true, padding: 42, spacingFactor: 1.1 } as cytoscape.LayoutOptions;
  return { name: 'dagre', rankDir: 'TB', fit: true, padding: 36, spacingFactor: 1.05 } as cytoscape.LayoutOptions;
}

function GraphNodesTable({ nodes, loading, onSelect }: { nodes: GraphAssetNode[]; loading: boolean; onSelect: (node: GraphAssetNode) => void }) {
  return (
    <Table size="small" rowKey="id" loading={loading} dataSource={nodes} pagination={{ pageSize: 8 }} onRow={(record) => ({ onClick: () => onSelect(record) })} columns={[
      { title: '名称', dataIndex: 'name', ellipsis: true },
      { title: '类型', dataIndex: 'type', width: 140, render: (value) => <Tag color="blue">{value}</Tag> },
      { title: '绑定状态', dataIndex: 'binding_status', width: 120, render: (value) => <Tag color={value === 'bound' ? 'success' : 'gold'}>{value || 'unbound'}</Tag> },
      { title: '发布', dataIndex: 'publish_status', width: 110, render: (value) => <Tag color={value === 'published' ? 'green' : 'default'}>{value}</Tag> },
      { title: '置信度', dataIndex: 'confidence', width: 140, render: (value: number) => <Progress size="small" percent={confidencePercent(value)} /> },
      { title: '证据', dataIndex: 'source_location', width: 120 },
      { title: '抽取任务', dataIndex: 'knowledge_job_id', width: 180, ellipsis: true },
    ]} />
  );
}

function GraphRelationshipsTable({ relationships, loading, onSelect }: { relationships: GraphAssetRelationship[]; loading: boolean; onSelect: (relationship: GraphAssetRelationship) => void }) {
  return (
    <Table size="small" rowKey="id" loading={loading} dataSource={relationships} pagination={{ pageSize: 8 }} onRow={(record) => ({ onClick: () => onSelect(record) })} columns={[
      { title: '起点', dataIndex: 'source_name', ellipsis: true },
      { title: '关系', dataIndex: 'relation_type', width: 130, render: (value) => <Tag color="purple">{value}</Tag> },
      { title: '终点', dataIndex: 'target_name', ellipsis: true },
      { title: '发布', dataIndex: 'publish_status', width: 110, render: (value) => <Tag color={value === 'published' ? 'green' : 'default'}>{value}</Tag> },
      { title: '置信度', dataIndex: 'confidence', width: 140, render: (value: number) => <Progress size="small" percent={confidencePercent(value)} /> },
      { title: '证据', dataIndex: 'source_location', width: 120 },
    ]} />
  );
}

function GraphEvidenceTable({ evidence, loading }: { evidence: GraphAssetEvidence[]; loading: boolean }) {
  return (
    <Table size="small" rowKey="id" loading={loading} dataSource={evidence} pagination={{ pageSize: 8 }} columns={[
      { title: '对象', dataIndex: 'asset_name', ellipsis: true },
      { title: '类型', dataIndex: 'asset_type', width: 130, render: (value) => <Tag>{value}</Tag> },
      { title: '来源文档', dataIndex: 'source_document_id', width: 180, ellipsis: true },
      { title: '位置', dataIndex: 'source_location', width: 120 },
      { title: '置信度', dataIndex: 'confidence', width: 140, render: (value: number) => <Progress size="small" percent={confidencePercent(value)} /> },
      { title: '抽取任务', dataIndex: 'knowledge_job_id', width: 180, ellipsis: true },
    ]} />
  );
}

function GraphQualityTable({ quality, loading }: { quality: any; loading: boolean }) {
  return (
    <Table size="small" rowKey={(record: any) => `${record.code}-${record.asset_id}-${record.target}`} loading={loading} dataSource={quality?.items ?? []} pagination={{ pageSize: 8 }} columns={[
      { title: '级别', dataIndex: 'severity', width: 110, render: (value) => <Tag color={severityColors[value] || 'default'}>{value}</Tag> },
      { title: '代码', dataIndex: 'code', width: 220 },
      { title: '对象', dataIndex: 'target', ellipsis: true },
      { title: '资产 ID', dataIndex: 'asset_id', width: 180, ellipsis: true },
    ]} />
  );
}

function GraphAssetDetail({ selected, evidence }: { selected: { kind: 'node'; data: GraphAssetNode } | { kind: 'relationship'; data: GraphAssetRelationship }; evidence: GraphAssetEvidence[] }) {
  if (selected.kind === 'relationship') {
    const rel = selected.data;
    return (
      <Space direction="vertical" size={12} style={{ width: '100%', marginTop: 12 }}>
        <Space wrap><Tag color="purple">{rel.relation_type}</Tag><Tag color={rel.publish_status === 'published' ? 'green' : 'default'}>{rel.publish_status || 'draft'}</Tag></Space>
        <Typography.Title level={5}>{rel.source_name} {'->'} {rel.target_name}</Typography.Title>
        <GraphAssetKv rows={[['置信度', `${confidencePercent(rel.confidence)}%`], ['来源文档', rel.source_document_id || '-'], ['证据位置', rel.source_location || '-'], ['抽取任务', rel.knowledge_job_id || '-']]} />
        <GraphAssetEvidenceList evidence={evidence} />
      </Space>
    );
  }

  const node = selected.data;
  return (
    <Space direction="vertical" size={12} style={{ width: '100%', marginTop: 12 }}>
      <Space wrap><Tag color="blue">{node.type}</Tag><Tag color={node.publish_status === 'published' ? 'green' : 'default'}>{node.publish_status || 'draft'}</Tag><Tag color={node.binding_status === 'bound' ? 'success' : 'gold'}>{node.binding_status || 'unbound'}</Tag></Space>
      <Typography.Title level={5}>{node.name}</Typography.Title>
      <Typography.Paragraph type="secondary">{node.source_location || node.source_document_id || '暂无来源位置'}</Typography.Paragraph>
      <Progress percent={confidencePercent(node.confidence)} />
      <GraphAssetKv rows={[['审核状态', node.review_status || '-'], ['来源文档', node.source_document_id || '-'], ['抽取任务', node.knowledge_job_id || '-']]} />
      <GraphAssetEvidenceList evidence={evidence} />
    </Space>
  );
}

function GraphAssetKv({ rows }: { rows: Array<[string, string]> }) {
  return <Table size="small" pagination={false} showHeader={false} rowKey="0" dataSource={rows.map(([key, value]) => ({ key, value }))} columns={[{ dataIndex: 'key', width: 90 }, { dataIndex: 'value' }]} />;
}

function GraphAssetEvidenceList({ evidence }: { evidence: GraphAssetEvidence[] }) {
  return (
    <div className="graph-asset-evidence-list">
      <Typography.Text type="secondary">来源证据</Typography.Text>
      {evidence.length ? evidence.map((item) => (
        <div key={item.id} className="graph-asset-evidence-item">
          <strong>{item.source_document_id || '未知文档'}</strong>
          <small>{item.source_location || '未标注位置'} / {confidencePercent(item.confidence)}%</small>
        </div>
      )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无匹配证据" />}
    </div>
  );
}

function GraphMetric({ title, value }: { title: string; value: number }) {
  return (
    <Card size="small">
      <Space direction="vertical" size={4}>
        <Typography.Text type="secondary">{title}</Typography.Text>
        <Typography.Title level={3} style={{ margin: 0 }}>{value}</Typography.Title>
      </Space>
    </Card>
  );
}

function KnowledgeExtractionWorkbench() {
  const [form] = Form.useForm();
  const [fileList, setFileList] = useState<any[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [job, setJob] = useState<ExtractionJob | null>(null);

  const runExtraction = async () => {
    const file = fileList[0]?.originFileObj as File | undefined;
    if (!file) {
      message.warning('请先选择一个文档');
      return;
    }
    const values = await form.validateFields();
    setExtracting(true);
    try {
      const response = await createKnowledgeExtractionJob(file, values);
      setJob(response.data?.data?.job);
      message.success('抽取任务已完成，请先审核候选结果');
    } catch (error: any) {
      message.error(error?.response?.data?.detail ?? '抽取任务创建失败');
    } finally {
      setExtracting(false);
    }
  };

  const approveJob = async () => {
    if (!job) return;
    try {
      const response = await approveKnowledgeExtractionJob(job.job_id);
      setJob(response.data?.data);
      message.success('候选结果已审核确认');
    } catch (error: any) {
      message.error(error?.response?.data?.detail ?? '审核确认失败');
    }
  };

  const commitJob = async () => {
    if (!job) return;
    setCommitting(true);
    try {
      const response = await commitKnowledgeExtractionJobToGraph(job.job_id);
      setJob(response.data?.data?.job);
      message.success('已写入图谱中心');
    } catch (error: any) {
      message.error(error?.response?.data?.detail ?? '写入图谱失败');
    } finally {
      setCommitting(false);
    }
  };

  const exportJob = async (format: string) => {
    if (!job) return;
    const response = await exportKnowledgeExtractionJob(job.job_id, format);
    const url = URL.createObjectURL(response.data);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${job.job_id}.${format === 'turtle' ? 'ttl' : format}`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="semantic-center">
      <Card>
        <Row gutter={[24, 16]}>
          <Col xs={24} lg={10}>
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <div>
                <Typography.Title level={4}>知识抽取工作台</Typography.Title>
                <Typography.Text type="secondary">把文档抽成候选实体、关系、规则和动作，审核后发布到知识库图谱。</Typography.Text>
              </div>
              <Upload.Dragger accept=".md,.markdown,.txt,.pdf,.xlsx,.xls" maxCount={1} fileList={fileList} beforeUpload={() => false} onChange={({ fileList: next }) => setFileList(next)}>
                <p className="ant-upload-drag-icon"><InboxOutlined /></p>
                <p className="ant-upload-text">选择或拖入文档</p>
                <p className="ant-upload-hint">支持 Markdown、TXT、PDF、Excel。图片/OCR 后续接入。</p>
              </Upload.Dragger>
            </Space>
          </Col>
          <Col xs={24} lg={14}>
            <Form form={form} layout="vertical" initialValues={{ domain: 'manufacturing', prompt_name: 'manufacturing_ontology_v1', model_name: 'deterministic-extractor', permission_scope: 'enterprise', owner_user_id: 'knowledge-admin' }}>
              <Row gutter={12}>
                <Col xs={24} md={12}>
                  <Form.Item label="业务领域" name="domain" rules={[{ required: true }]}>
                    <Select options={[
                      { value: 'manufacturing', label: '制造业' },
                      { value: 'quality', label: '质量管理' },
                      { value: 'supply_chain', label: '供应链' },
                      { value: 'maintenance', label: '设备维护' },
                    ]} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item label="Prompt 模板" name="prompt_name" rules={[{ required: true }]}>
                    <Select options={[
                      { value: 'manufacturing_ontology_v1', label: '制造业本体抽取 v1' },
                      { value: 'quality_event_v1', label: '质量事件抽取 v1' },
                      { value: 'supplier_8d_v1', label: '供应商 8D 抽取 v1' },
                    ]} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item label="模型" name="model_name" rules={[{ required: true }]}>
                    <Select options={[
                      { value: 'deterministic-extractor', label: 'Deterministic extractor' },
                      { value: 'glm-4-flash', label: 'GLM-4-Flash' },
                      { value: 'qwen-plus', label: 'Qwen Plus' },
                      { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
                    ]} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item label="知识范围" name="permission_scope" rules={[{ required: true }]}>
                    <Select options={[
                      { value: 'enterprise', label: '企业' },
                      { value: 'department', label: '部门' },
                      { value: 'team-quality', label: '质量团队' },
                      { value: 'personal', label: '个人' },
                    ]} />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item label="上传人" name="owner_user_id"><Input /></Form.Item>
              <Button type="primary" icon={<FileSearchOutlined />} loading={extracting} onClick={runExtraction}>开始抽取</Button>
            </Form>
          </Col>
        </Row>
      </Card>

      {!job ? (
        <Card style={{ marginTop: 16 }}><Empty description="上传文档并开始抽取后，这里会显示候选实体、关系和质量报告" /></Card>
      ) : (
        <Space direction="vertical" size={16} style={{ width: '100%', marginTop: 16 }}>
          <Card
            title={<Space wrap><span>抽取任务</span><Tag color={job.status === 'committed' ? 'green' : job.status === 'blocked' ? 'red' : 'blue'}>{job.status}</Tag><Typography.Text code>{job.job_id}</Typography.Text></Space>}
            extra={<Space wrap>
              <Button icon={<CheckCircleOutlined />} onClick={approveJob}>审核确认</Button>
              <Button type="primary" loading={committing} disabled={job.quality_report.blocking} onClick={commitJob}>写入图谱中心</Button>
              {['json', 'csv', 'yaml', 'turtle'].map((format) => <Button key={format} icon={<DownloadOutlined />} onClick={() => exportJob(format)}>{format === 'turtle' ? 'RDF' : format.toUpperCase()}</Button>)}
            </Space>}
          >
            <Alert type={job.quality_report.blocking ? 'error' : 'success'} showIcon message={job.quality_report.blocking ? '存在 FATAL 问题，暂不能写入图谱' : '抽取完成，可以审核并写入图谱中心'} style={{ marginBottom: 12 }} />
            <Row gutter={12}>
              {['FATAL', 'ERROR', 'WARNING', 'INFO'].map((severity) => (
                <Col xs={12} md={6} key={severity}>
                  <Card size="small"><Space><Tag color={severityColors[severity]}>{severity}</Tag><Typography.Text strong>{job.quality_report.counts?.[severity] ?? 0}</Typography.Text></Space></Card>
                </Col>
              ))}
            </Row>
          </Card>
          <Row gutter={[16, 16]}>
            <Col xs={24} lg={14}>
              <Card title={`候选实体 (${job.result.entities.length})`} size="small">
                <Table size="small" rowKey="candidate_id" dataSource={job.result.entities} pagination={{ pageSize: 6 }} columns={[
                  { title: '名称', dataIndex: 'name', ellipsis: true },
                  { title: '类型', dataIndex: 'entity_type', width: 130, render: (value) => <Tag color="blue">{value}</Tag> },
                  { title: '置信度', dataIndex: 'confidence', width: 140, render: (value: number) => <Progress size="small" percent={confidencePercent(value)} /> },
                  { title: '证据', dataIndex: 'source_location', width: 110 },
                ]} />
              </Card>
            </Col>
            <Col xs={24} lg={10}>
              <Card title={`候选关系 (${job.result.relations.length})`} size="small">
                <Table size="small" rowKey="candidate_id" dataSource={job.result.relations} pagination={{ pageSize: 6 }} columns={[
                  { title: '来源', dataIndex: 'source_name', ellipsis: true },
                  { title: '关系', dataIndex: 'relation_type', width: 110, render: (value) => <Tag>{value}</Tag> },
                  { title: '目标', dataIndex: 'target_name', ellipsis: true },
                ]} />
              </Card>
            </Col>
          </Row>
          <Card title="质量报告" size="small">
            <Table size="small" rowKey={(record) => `${record.severity}-${record.code}-${record.target}`} dataSource={job.quality_report.items} pagination={false} columns={[
              { title: '级别', dataIndex: 'severity', width: 110, render: (value) => <Tag color={severityColors[value]}>{value}</Tag> },
              { title: '代码', dataIndex: 'code', width: 220 },
              { title: '对象', dataIndex: 'target', width: 220 },
              { title: '说明', dataIndex: 'message' },
            ]} />
          </Card>
        </Space>
      )}
    </div>
  );
}

export function KnowledgeCenter() {
  const [spaces, setSpaces] = useState<KnowledgeSpace[]>([]);
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [cards, setCards] = useState<KnowledgeCard[]>([]);
  const [chunks, setChunks] = useState<KnowledgeChunk[]>([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string>('');
  const [knowledgeSearch, setKnowledgeSearch] = useState('');
  const [documentMarkdown, setDocumentMarkdown] = useState('');
  const [markdownLoading, setMarkdownLoading] = useState(false);
  const [draftQuery, setDraftQuery] = useState('从当前文档抽取系统、能力和上下游关系');
  const [chatMessages, setChatMessages] = useState<KnowledgeChatMessage[]>([]);
  const [agentConversationId, setAgentConversationId] = useState<string>();
  const [agentLoading, setAgentLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [intakeRecommendation, setIntakeRecommendation] = useState<OntologyIntakeRecommendation | null>(null);
  const [intakeLoading, setIntakeLoading] = useState(false);
  const [ontologyJob, setOntologyJob] = useState<ExtractionJob | null>(null);
  const [ontologyExtracting, setOntologyExtracting] = useState(false);
  const [ontologyApproving, setOntologyApproving] = useState(false);
  const [ontologyCommitting, setOntologyCommitting] = useState(false);
  const [mode, setMode] = useState<string | number>('original');
  const [ocrBlocks, setOcrBlocks] = useState<EditableOcrBlock[]>([]);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrSaving, setOcrSaving] = useState(false);
  const [ocrEnhancing, setOcrEnhancing] = useState(false);
  const [ocrAverageConfidence, setOcrAverageConfidence] = useState<number>();
  const [ocrLowConfidenceCount, setOcrLowConfidenceCount] = useState(0);
  const [ocrEnhanced, setOcrEnhanced] = useState(false);
  const chatThreadRef = useRef<HTMLDivElement | null>(null);

  const visibleDocuments = useMemo(() => {
    const keyword = knowledgeSearch.trim().toLowerCase();
    const filtered = keyword
      ? documents.filter((item: any) => [
        item.title,
        item.document_title,
        item.source_file_name,
        item.file_name,
        item.summary,
        item.source_type,
        item.permission_scope,
        item.owner_user_id,
        ...(item.linked_objects ?? []).flatMap((link: any) => [link.type, link.id, link.name, link.object_type, link.object_id, link.object_name]),
      ].filter(Boolean).join(' ').toLowerCase().includes(keyword))
      : documents;
    return [...filtered].sort((a: any, b: any) => {
      const aId = a.id ?? a.document_id ?? '';
      const bId = b.id ?? b.document_id ?? '';
      const aIndex = KNOWLEDGE_ASSET_ORDER.indexOf(aId);
      const bIndex = KNOWLEDGE_ASSET_ORDER.indexOf(bId);
      if (aIndex !== bIndex) return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
      return String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? ''));
    });
  }, [documents, knowledgeSearch]);
  const sourceLabelById = useMemo(() => {
    const labels = new Map<string, string>();
    sources.forEach((source) => labels.set(source.id, source.name));
    labels.set('database', labels.get('database') ?? '数据库知识资产');
    labels.set('uploaded', labels.get('uploaded') ?? '上传资料');
    return labels;
  }, [sources]);
  const knowledgeTree = useMemo(() => {
    const typeOrder = ['docx', 'xlsx', 'pdf', 'image', 'markdown'];
    const expandedKeys: string[] = [];
    const sourceBuckets = visibleDocuments.reduce<Record<string, KnowledgeDocument[]>>((acc, item) => {
      const sourceId = item.source_id ?? 'database';
      acc[sourceId] = [...(acc[sourceId] ?? []), item];
      return acc;
    }, {});
    const sourceNodes = Object.entries(sourceBuckets).map(([sourceId, sourceDocuments]) => {
      const sourceKey = `source:${sourceId}`;
      expandedKeys.push(sourceKey);
      const typeBuckets = sourceDocuments.reduce<Record<string, KnowledgeDocument[]>>((acc, item) => {
        const type = normalizeKnowledgeTypeGroup(item);
        acc[type] = [...(acc[type] ?? []), item];
        return acc;
      }, {});
      const typeNodes = Object.entries(typeBuckets)
        .sort(([a], [b]) => {
          const aIndex = typeOrder.indexOf(a);
          const bIndex = typeOrder.indexOf(b);
          return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
        })
        .map(([type, typeDocuments]) => {
          const typeKey = `${sourceKey}:type:${type}`;
          expandedKeys.push(typeKey);
          return {
            key: typeKey,
            title: (
              <div className="knowledge-tree-node folder">
                <span className="knowledge-tree-node-title"><FileSearchOutlined /><strong>{KNOWLEDGE_TYPE_LABELS[type] ?? type.toUpperCase()}</strong></span>
                <Tag>{typeDocuments.length}</Tag>
              </div>
            ),
            children: typeDocuments.map((item) => {
              const docId = getKnowledgeDocumentId(item);
              const linkedObjects = item.linked_objects ?? [];
              const statusMeta = getKnowledgeDocumentStatusMeta(item);
              if (docId === selectedDocumentId) expandedKeys.push(`doc:${docId}`);
              return {
                key: `doc:${docId}`,
                title: (
                  <div className="knowledge-tree-node document">
                    <span className="knowledge-tree-node-title"><strong>{getKnowledgeDocumentTitle(item)}</strong><Tag color={statusMeta.color}>{statusMeta.label}</Tag></span>
                    <small>{getKnowledgeDocumentFileName(item)}{linkedObjects.length ? ` · ${linkedObjects.length} 个对象` : ''}</small>
                  </div>
                ),
                children: linkedObjects.map((link, index) => {
                  const type = link.type ?? link.object_type ?? 'Object';
                  const objectId = link.id ?? link.object_id ?? index;
                  const name = link.name ?? link.object_name ?? objectId;
                  return {
                    key: `object:${docId}:${type}:${objectId}`,
                    title: (
                      <div className="knowledge-tree-node object">
                        <span className="knowledge-tree-node-title"><BranchesOutlined /><strong>{name}</strong></span>
                        <small>{type} · {objectId}</small>
                      </div>
                    ),
                  };
                }),
              };
            }),
          };
        });
      return {
        key: sourceKey,
        title: (
          <div className="knowledge-tree-node source">
            <span className="knowledge-tree-node-title"><DatabaseOutlined /><strong>{sourceLabelById.get(sourceId) ?? sourceId}</strong></span>
            <Tag>{sourceDocuments.length}</Tag>
          </div>
        ),
        children: typeNodes,
      };
    });
    const rootKey = `space:${spaces[0]?.id ?? 'manufacturing'}`;
    expandedKeys.unshift(rootKey);
    const treeData: DataNode[] = visibleDocuments.length
      ? [{
        key: rootKey,
        title: (
          <div className="knowledge-tree-node root">
            <span className="knowledge-tree-node-title"><ApartmentOutlined /><strong>{spaces[0]?.name ?? '制造业知识库'}</strong></span>
            <Tag color="processing">{visibleDocuments.length}</Tag>
          </div>
        ),
        children: sourceNodes,
      }]
      : [];
    return { data: treeData, expandedKeys };
  }, [selectedDocumentId, sourceLabelById, spaces, visibleDocuments]);
  const selectedDocument = visibleDocuments.find((item: any) => (item.id ?? item.document_id) === selectedDocumentId) ?? visibleDocuments[0];
  const selectedTitle = (selectedDocument as any)?.title ?? (selectedDocument as any)?.document_title ?? (selectedDocument as any)?.file_name ?? '暂无知识文档';
  const selectedSummary = (selectedDocument as any)?.summary ?? (selectedDocument ? `来源文件：${(selectedDocument as any)?.source_file_name ?? (selectedDocument as any)?.file_name ?? '数据库文档'}` : '上传或完成种子数据后，知识库目录会按数据库内容自动刷新。');
  const selectedUpdatedAt = (selectedDocument as any)?.updated_at ?? '-';
  const selectedLinks = ((selectedDocument as any)?.linked_objects ?? []) as Array<{ type?: string; id?: string; name?: string; object_type?: string; object_id?: string; object_name?: string; confidence?: number; status?: string; source_location?: string }>;
  const selectedRawText = documentMarkdown || (selectedDocument as any)?.markdown_content || '';
  const selectedSourceType = String((selectedDocument as any)?.source_type ?? (selectedDocument as any)?.doc_type ?? 'database');
  const selectedDomainTags = selectedDocument
    ? [selectedSourceType.toUpperCase(), (selectedDocument as any)?.permission_scope ?? 'enterprise', (selectedDocument as any)?.owner_user_id ?? 'knowledge']
    : ['DATABASE'];
  const selectedDocumentName = String(
    (selectedDocument as any)?.file_name
      ?? (selectedDocument as any)?.source_file_name
      ?? (selectedDocument as any)?.filename
      ?? (selectedDocument as any)?.title
      ?? (selectedDocument as any)?.document_title
      ?? '',
  ).toLowerCase();
  const selectedDocumentMime = String(
    (selectedDocument as any)?.mime_type
      ?? (selectedDocument as any)?.content_type
      ?? (selectedDocument as any)?.file_type
      ?? (selectedDocument as any)?.source_type
      ?? '',
  ).toLowerCase();
  const indexedDocumentCount = documents.filter((item: any) => (item.status ?? '').toLowerCase() === 'indexed').length;
  const pendingExtractCount = documents.filter((item: any) => !((item.linked_objects ?? []).length)).length;
  const publishedDocumentCount = documents.filter((item: any) => (item.linked_objects ?? []).length > 0).length;
  const selectedIsOcrDocument = Boolean(
    selectedDocumentId
      && (
        selectedDocumentMime.includes('pdf')
        || selectedDocumentMime.startsWith('image/')
        || /\.(pdf|png|jpe?g|webp|tiff?|bmp)$/i.test(selectedDocumentName)
      ),
  );
  const ocrConfidencePercent = normalizeOcrConfidence(
    ocrAverageConfidence
      ?? (ocrBlocks.length
        ? ocrBlocks.reduce((sum, block) => sum + Number(block.confidence ?? 0), 0) / ocrBlocks.length
        : 0),
  );
  const ontologyEntities = (ontologyJob?.result?.entities ?? []) as any[];
  const ontologyRelations = (ontologyJob?.result?.relations ?? []) as any[];

  const toChatMessage = (item: any): KnowledgeChatMessage => ({
    id: item.message_id ?? item.id,
    role: item.role === 'user' ? 'user' : 'assistant',
    content: item.content ?? '',
  });

  const loadKnowledge = async () => {
    try {
      const [spaceRes, sourceRes, documentRes, cardRes] = await Promise.all([
        listKnowledgeSpaces(),
        listKnowledgeSources(),
        listKnowledgeDocuments('database'),
        listKnowledgeCards(),
        getKnowledgeOcrPipeline().catch(() => null),
      ]);
      const nextDocuments = documentRes.data?.data ?? [];
      setSpaces(spaceRes.data?.data ?? []);
      setSources(sourceRes.data?.data ?? []);
      setDocuments(nextDocuments);
      setCards(cardRes.data?.data ?? []);
      setSelectedDocumentId((prev) => (
        nextDocuments.some((item: any) => (item.id ?? item.document_id) === prev)
          ? prev
          : nextDocuments[0]?.id ?? nextDocuments[0]?.document_id ?? ''
      ));
    } catch {
      setSpaces([]);
      setSources([]);
      setDocuments([]);
      setCards([]);
      setSelectedDocumentId((prev) => prev ?? '');
    }
  };

  useEffect(() => {
    loadKnowledge();
  }, []);

  const loadOcr = async () => {
    if (!selectedDocumentId || !selectedIsOcrDocument) {
      setOcrBlocks([]);
      setOcrAverageConfidence(undefined);
      setOcrLowConfidenceCount(0);
      setOcrEnhanced(false);
      return;
    }
    setOcrLoading(true);
    try {
      const res = await getKnowledgeDocumentOcr(selectedDocumentId);
      const payload = (res.data as any)?.data ?? res.data ?? {};
      const blocks: KnowledgeOcrBlock[] = payload.blocks ?? [];
      const editableBlocks = blocks.map((block, index) => ({
        ...block,
        row_id: getOcrBlockId(block, index),
        corrected_text: block.corrected_text ?? block.text ?? block.raw_text ?? '',
      }));
      setOcrBlocks(editableBlocks);
      setOcrAverageConfidence(payload.average_confidence ?? payload.avg_confidence);
      setOcrLowConfidenceCount(
        payload.low_confidence_count
          ?? editableBlocks.filter((block) => normalizeOcrConfidence(block.confidence) < 80).length,
      );
      setOcrEnhanced(Boolean(payload.enhanced ?? editableBlocks.some((block) => block.enhanced)));
    } catch (error: any) {
      setOcrBlocks([]);
      setOcrAverageConfidence(undefined);
      setOcrLowConfidenceCount(0);
      setOcrEnhanced(false);
      if (error?.response?.status !== 404) {
        message.error(error?.response?.data?.detail ?? 'OCR result is unavailable');
      }
    } finally {
      setOcrLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedDocumentId) {
      setChunks([]);
      return;
    }
    listKnowledgeChunks(selectedDocumentId)
      .then((res) => setChunks(res.data?.data ?? []))
      .catch(() => setChunks([]));
  }, [selectedDocumentId]);

  useEffect(() => {
    let cancelled = false;
    const loadIntake = async () => {
      setOntologyJob(null);
      if (!selectedDocumentId) {
        setIntakeRecommendation(null);
        return;
      }
      setIntakeLoading(true);
      try {
        const res = await createKnowledgeOntologyIntake(selectedDocumentId, { domain_hint: 'manufacturing', mode: 'recommend' });
        if (!cancelled) {
          setIntakeRecommendation(res.data?.data ?? null);
        }
      } catch {
        if (!cancelled) {
          setIntakeRecommendation(null);
        }
      } finally {
        if (!cancelled) {
          setIntakeLoading(false);
        }
      }
    };
    loadIntake();
    return () => {
      cancelled = true;
    };
  }, [selectedDocumentId]);

  useEffect(() => {
    let cancelled = false;
    const loadMarkdown = async () => {
      if (!selectedDocumentId) {
        setDocumentMarkdown('');
        return;
      }
      setMarkdownLoading(true);
      try {
        const res = await getKnowledgeDocumentMarkdown(selectedDocumentId);
        const payload = res.data?.data ?? res.data ?? {};
        if (!cancelled) {
          setDocumentMarkdown(payload.markdown_content ?? '');
        }
      } catch {
        if (!cancelled) {
          setDocumentMarkdown((selectedDocument as any)?.markdown_content ?? '');
        }
      } finally {
        if (!cancelled) {
          setMarkdownLoading(false);
        }
      }
    };
    loadMarkdown();
    return () => {
      cancelled = true;
    };
  }, [selectedDocumentId, selectedDocument]);

  useEffect(() => {
    if (mode === 'ocr') {
      loadOcr();
    }
  }, [mode, selectedDocumentId, selectedIsOcrDocument]);

  useEffect(() => {
    let cancelled = false;
    const syncConversation = async () => {
      if (!selectedDocumentId) return;
      setAgentLoading(true);
      try {
        const conversationRes = await createKnowledgeAgentConversation({
          document_id: selectedDocumentId,
          document_title: selectedTitle,
          page: 'knowledge-center',
          metadata: { source: 'knowledge-center' },
        });
        const conversation = conversationRes.data?.data;
        const nextConversationId = conversation?.conversation_id ?? conversation?.id;
        if (!nextConversationId) return;
        const messagesRes = await listKnowledgeAgentMessages(nextConversationId);
        if (!cancelled) {
          setAgentConversationId(nextConversationId);
          setChatMessages((messagesRes.data?.data ?? []).map(toChatMessage));
        }
      } catch {
        if (!cancelled) {
          setAgentConversationId(undefined);
          setChatMessages([]);
          message.warning('知识 Agent 会话暂不可用，当前对话仅在页面内保留');
        }
      } finally {
        if (!cancelled) {
          setAgentLoading(false);
        }
      }
    };
    syncConversation();
    return () => {
      cancelled = true;
    };
  }, [selectedDocumentId, selectedTitle]);

  useEffect(() => {
    const thread = chatThreadRef.current;
    if (thread) {
      thread.scrollTop = thread.scrollHeight;
    }
  }, [chatMessages, searching]);

  const runSearch = async () => {
    const nextQuery = draftQuery.trim();
    if (!nextQuery || searching) return;

    let activeConversationId = agentConversationId;
    const userMessage: KnowledgeChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: nextQuery,
    };

    setChatMessages((prev) => [...prev, userMessage]);
    setDraftQuery('');
    setSearching(true);
    try {
      if (!activeConversationId) {
        const conversationRes = await createKnowledgeAgentConversation({
          document_id: selectedDocumentId,
          document_title: selectedTitle,
          page: 'knowledge-center',
          metadata: { source: 'knowledge-center' },
        });
        const conversation = conversationRes.data?.data;
        activeConversationId = conversation?.conversation_id ?? conversation?.id;
        setAgentConversationId(activeConversationId);
      }
      if (!activeConversationId) {
        throw new Error('Agent conversation is unavailable');
      }
      const res = await sendKnowledgeAgentMessage(activeConversationId, {
        content: nextQuery,
        context: { document_id: selectedDocumentId, document_title: selectedTitle },
      });
      const payload = res.data?.data ?? {};
      const serverMessages = [payload.user_message, payload.assistant_message].filter(Boolean).map(toChatMessage);
      setChatMessages((prev) => [...prev.filter((item) => item.id !== userMessage.id), ...serverMessages]);
    } catch {
      setChatMessages((prev) => [
        ...prev,
        {
          id: `assistant-error-${Date.now()}`,
          role: 'assistant',
          content: '知识 Agent 服务暂不可用，我已保留你的问题；请稍后重试。',
        },
      ]);
    } finally {
      setSearching(false);
    }
  };

  const updateOcrBlockCorrection = (rowId: string, correctedText: string) => {
    setOcrBlocks((prev) => prev.map((block) => (
      block.row_id === rowId ? { ...block, corrected_text: correctedText } : block
    )));
  };

  const saveOcrCorrections = async () => {
    if (!selectedDocumentId) return;
    setOcrSaving(true);
    try {
      await saveKnowledgeDocumentOcrCorrections(selectedDocumentId, ocrBlocks.map(({ row_id, ...block }) => block));
      message.success('OCR corrections saved');
      loadOcr();
    } catch (error: any) {
      message.error(error?.response?.data?.detail ?? 'Failed to save OCR corrections');
    } finally {
      setOcrSaving(false);
    }
  };

  const enhanceOcr = async () => {
    if (!selectedDocumentId) return;
    setOcrEnhancing(true);
    try {
      await enhanceKnowledgeDocumentOcr(selectedDocumentId);
      message.success('OCR enhancement started');
      await loadOcr();
    } catch (error: any) {
      message.error(error?.response?.data?.detail ?? 'Failed to enhance OCR');
    } finally {
      setOcrEnhancing(false);
    }
  };

  const handleUpload = async (options: any) => {
    setUploading(true);
    try {
      const response = await uploadKnowledgeAsset(options.file, { permission_scope: 'enterprise', owner_user_id: 'knowledge-admin' });
      const payload = response.data?.data ?? {};
      const uploadedDocumentId = payload.document?.document_id ?? payload.document?.id;
      if (uploadedDocumentId) {
        setSelectedDocumentId(uploadedDocumentId);
      }
      setIntakeRecommendation(payload.intake_recommendation ?? null);
      setOntologyJob(null);
      message.success('资料已进入知识库，可在当前文档右侧继续抽取、审核和发布');
      options.onSuccess?.({});
      loadKnowledge();
    } catch (error: any) {
      message.error(error?.response?.data?.detail ?? '上传失败');
      options.onError?.(error);
    } finally {
      setUploading(false);
    }
  };

  const startOntologyExtraction = async () => {
    if (!selectedDocumentId || ontologyExtracting) return;
    setOntologyExtracting(true);
    try {
      const response = await createKnowledgeDocumentExtractionJob(selectedDocumentId, {
        domain: intakeRecommendation?.document_profile?.likely_domain ?? 'general',
        prompt_name: 'manufacturing_ontology_v1',
        model_name: 'deterministic-extractor',
      });
      const nextJob = response.data?.data?.job;
      setOntologyJob(nextJob ?? null);
      setMode('objects');
      message.success('Ontology candidates are ready for review.');
    } catch (error: any) {
      message.error(error?.response?.data?.detail ?? 'Failed to extract ontology candidates');
    } finally {
      setOntologyExtracting(false);
    }
  };

  const approveOntologyJob = async () => {
    if (!ontologyJob || ontologyApproving) return;
    setOntologyApproving(true);
    try {
      const response = await approveKnowledgeExtractionJob(ontologyJob.job_id);
      setOntologyJob(response.data?.data ?? null);
      message.success('Ontology candidates approved.');
    } catch (error: any) {
      message.error(error?.response?.data?.detail ?? 'Failed to approve ontology candidates');
    } finally {
      setOntologyApproving(false);
    }
  };

  const commitOntologyJob = async () => {
    if (!ontologyJob || ontologyCommitting) return;
    setOntologyCommitting(true);
    try {
      const response = await commitKnowledgeExtractionJobToGraph(ontologyJob.job_id);
      setOntologyJob(response.data?.data?.job ?? null);
      await loadKnowledge();
      setMode('graph');
      message.success('Ontology candidates were published to graph assets.');
    } catch (error: any) {
      message.error(error?.response?.data?.detail ?? 'Failed to publish ontology candidates');
    } finally {
      setOntologyCommitting(false);
    }
  };

  const ocrPanel = (
    <div className="knowledge-ocr-panel">
      {!selectedIsOcrDocument ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="OCR correction is available after selecting an uploaded PDF or image document."
        />
      ) : (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <div className="knowledge-ocr-summary">
            <Card size="small">
              <Typography.Text type="secondary">Average confidence</Typography.Text>
              <Progress percent={ocrConfidencePercent} size="small" status={ocrConfidencePercent < 80 ? 'exception' : 'success'} />
            </Card>
            <Card size="small">
              <Typography.Text type="secondary">Low confidence</Typography.Text>
              <Typography.Title level={4}>{ocrLowConfidenceCount}</Typography.Title>
            </Card>
            <Card size="small">
              <Typography.Text type="secondary">Enhanced</Typography.Text>
              <div><Tag color={ocrEnhanced ? 'success' : 'default'}>{ocrEnhanced ? 'Yes' : 'No'}</Tag></div>
            </Card>
          </div>
          <div className="knowledge-ocr-toolbar">
            <Typography.Text type="secondary">{ocrBlocks.length} OCR blocks</Typography.Text>
            <Space>
              <Button loading={ocrLoading} onClick={loadOcr}>Refresh</Button>
              <Button loading={ocrEnhancing} onClick={enhanceOcr}>Enhance</Button>
              <Button type="primary" loading={ocrSaving} disabled={!ocrBlocks.length} onClick={saveOcrCorrections}>Save corrections</Button>
            </Space>
          </div>
          <Table
            className="knowledge-ocr-table"
            rowKey="row_id"
            size="small"
            loading={ocrLoading}
            dataSource={ocrBlocks}
            pagination={{ pageSize: 5 }}
            locale={{ emptyText: 'No OCR blocks found for this document.' }}
            columns={[
              {
                title: 'Block',
                width: 86,
                render: (_value, record: EditableOcrBlock, index) => (
                  <Space direction="vertical" size={2}>
                    <Tag>{record.block_id ?? record.id ?? index + 1}</Tag>
                    {(record.page ?? record.page_number) && <Typography.Text type="secondary">p.{record.page ?? record.page_number}</Typography.Text>}
                  </Space>
                ),
              },
              {
                title: 'Original text',
                dataIndex: 'text',
                render: (_value, record: EditableOcrBlock) => (
                  <Typography.Paragraph className="knowledge-ocr-original">
                    {record.text ?? record.raw_text ?? '-'}
                  </Typography.Paragraph>
                ),
              },
              {
                title: 'Corrected text',
                dataIndex: 'corrected_text',
                render: (_value, record: EditableOcrBlock) => (
                  <Input.TextArea
                    autoSize={{ minRows: 2, maxRows: 6 }}
                    value={record.corrected_text}
                    onChange={(event) => updateOcrBlockCorrection(record.row_id, event.target.value)}
                  />
                ),
              },
              {
                title: 'Confidence',
                width: 120,
                render: (_value, record: EditableOcrBlock) => {
                  const percent = normalizeOcrConfidence(record.confidence);
                  return <Progress percent={percent} size="small" status={percent < 80 ? 'exception' : 'normal'} />;
                },
              },
            ]}
          />
        </Space>
      )}
    </div>
  );

  return (
    <div className="knowledge-center">
      <div className="knowledge-workbench unified-knowledge-workbench">
        <aside className="knowledge-left-panel">
          <Card className="knowledge-panel-card knowledge-library-card" title="知识库目录" extra={<Button size="small" icon={<ReloadOutlined />} onClick={loadKnowledge}>刷新</Button>}>
            <div className="knowledge-tree-tools">
              <Input
                placeholder="搜索文档、标签或实体"
                prefix={<FileSearchOutlined />}
                value={knowledgeSearch}
                onChange={(event) => setKnowledgeSearch(event.target.value)}
                allowClear
              />
              <Space wrap size={6}>
                <Tag color="processing">已索引 {indexedDocumentCount}</Tag>
                <Tag color="warning">待抽取 {pendingExtractCount}</Tag>
                <Tag color="success">已发布 {publishedDocumentCount}</Tag>
              </Space>
            </div>
            <div className="knowledge-directory-tree">
              {knowledgeTree.data.length ? (
                <div className="knowledge-tree-viewport">
                  <Tree
                    key={`${knowledgeSearch}-${selectedDocumentId}-${visibleDocuments.length}`}
                    blockNode
                    showLine
                    treeData={knowledgeTree.data}
                    selectedKeys={selectedDocumentId ? [`doc:${selectedDocumentId}`] : []}
                    defaultExpandedKeys={knowledgeTree.expandedKeys}
                    onSelect={(keys) => {
                      const key = String(keys[0] ?? '');
                      if (key.startsWith('doc:')) {
                        setSelectedDocumentId(key.slice(4));
                        return;
                      }
                      if (key.startsWith('object:')) {
                        setSelectedDocumentId(key.split(':')[1]);
                      }
                    }}
                  />
                </div>
              ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无入库文档" />}
            </div>
            <Upload.Dragger className="knowledge-upload-dragger" customRequest={handleUpload} showUploadList={false} disabled={uploading}>
              <p className="ant-upload-drag-icon"><InboxOutlined /></p>
              <p className="ant-upload-text">上传知识资料</p>
              <p className="ant-upload-hint">统一入库，右侧继续抽取和发布</p>
            </Upload.Dragger>
          </Card>
        </aside>

        <main className="knowledge-main-panel">
          <Card
            className="knowledge-document-card"
            title={<Space wrap><span>{selectedTitle}</span>{selectedDomainTags.map((tag) => <Tag key={tag}>{tag}</Tag>)}</Space>}
            extra={<Segmented value={mode} onChange={setMode} options={[{ label: '原文', value: 'original' }, { label: '关联对象', value: 'objects' }, { label: '知识图谱', value: 'graph' }]} />}
          >
            <div className="knowledge-document-head">
              <div>
                <Typography.Text type="secondary">{selectedSummary}</Typography.Text>
                <div className="knowledge-note-properties">
                  <div><span>created</span><strong>{selectedUpdatedAt}</strong></div>
                  <div><span>status</span><strong>{(selectedDocument as any)?.status ?? 'indexed'}</strong></div>
                  <div><span>objects</span><strong>{selectedLinks.length} 个关联对象</strong></div>
                </div>
              </div>
              <Button icon={<ReloadOutlined />} onClick={loadKnowledge}>刷新当前知识</Button>
            </div>
            {mode === 'objects' ? (
              <div className="knowledge-object-panel">
                {selectedLinks.length ? selectedLinks.map((item) => {
                  const type = item.type ?? item.object_type ?? 'Object';
                  const objectId = item.id ?? item.object_id ?? '-';
                  const name = item.name ?? item.object_name ?? objectId;
                  return (
                    <Card className="knowledge-object-card" size="small" key={`${type}-${objectId}`}>
                      <div className="knowledge-object-card-head">
                        <Space wrap><Tag color="blue">{type}</Tag><Typography.Text strong>{name}</Typography.Text></Space>
                        <Tag color={item.status === 'committed' ? 'success' : 'gold'}>{item.status ?? 'candidate'}</Tag>
                      </div>
                      <div className="knowledge-note-properties compact">
                        <div><span>对象编号</span><strong>{objectId}</strong></div>
                        <div><span>置信度</span><strong>{item.confidence ? `${confidencePercent(item.confidence)}%` : '-'}</strong></div>
                        <div><span>证据位置</span><strong>{item.source_location ?? '当前文档'}</strong></div>
                      </div>
                    </Card>
                  );
                }) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前文档暂无已确认关联对象" />}
              </div>
            ) : mode === 'graph' ? (
              <KnowledgeGraphCenterV2 embedded sourceDocumentId={selectedDocumentId} />
            ) : (
              <article className="knowledge-note-content">
                {markdownLoading ? <Progress percent={70} status="active" showInfo={false} /> : null}
                {selectedRawText ? (
                  <pre className="knowledge-original-text">{selectedRawText}</pre>
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前文档暂无可展示原文" />
                )}
              </article>
            )}
          </Card>
        </main>

        <aside className="knowledge-rag-panel">
          <Card
            className="knowledge-rag-card knowledge-intake-card"
            title={<Space><NodeIndexOutlined />AI 本体抽取准备</Space>}
            loading={intakeLoading}
          >
            {intakeRecommendation ? (
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Alert
                  type="info"
                  showIcon
                  message={intakeRecommendation.document_profile?.title ?? selectedTitle}
                  description={getIntakeSummary(intakeRecommendation, selectedTitle, selectedSourceType)}
                />
                <div className="knowledge-note-properties compact">
                  <div><span>类型</span><strong>{getIntakeSourceTypeLabel(intakeRecommendation.document_profile?.source_type ?? selectedSourceType)}</strong></div>
                  <div><span>领域</span><strong>{getIntakeDomainLabel(intakeRecommendation.document_profile?.likely_domain ?? 'general')}</strong></div>
                  <div><span>行数</span><strong>{intakeRecommendation.document_profile?.line_count ?? '-'}</strong></div>
                </div>
                <Space wrap size={6}>{(intakeRecommendation.capabilities ?? []).map((item) => <Tag key={item}>{KNOWLEDGE_INTAKE_CAPABILITY_LABELS[item] ?? item}</Tag>)}</Space>
                {(intakeRecommendation.suggested_actions ?? []).map((action) => (
                  <div className="knowledge-intake-action" key={action.key}>
                    <Space direction="vertical" size={4} style={{ width: '100%' }}>
                      <Space wrap>
                        <Typography.Text strong>{KNOWLEDGE_INTAKE_ACTION_LABELS[action.key]?.title ?? action.title}</Typography.Text>
                        {action.requires_confirmation ? <Tag color="gold">需确认</Tag> : <Tag>只读</Tag>}
                      </Space>
                      <Typography.Text type="secondary">{KNOWLEDGE_INTAKE_ACTION_LABELS[action.key]?.description ?? action.description}</Typography.Text>
                    </Space>
                  </div>
                ))}
                <Button type="primary" icon={<FileSearchOutlined />} loading={ontologyExtracting} disabled={!selectedDocumentId} onClick={startOntologyExtraction} block>
                  开始本体抽取
                </Button>
              </Space>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="上传或选择已索引文档后，可开始本体抽取准备。" />
            )}
            {ontologyJob ? (
              <div className="knowledge-ontology-review">
                <Divider />
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  <Space wrap><Tag color={ontologyJob.status === 'committed' ? 'green' : ontologyJob.quality_report?.blocking ? 'red' : 'blue'}>{KNOWLEDGE_INTAKE_STATUS_LABELS[ontologyJob.status] ?? ontologyJob.status}</Tag><Typography.Text code>{ontologyJob.job_id}</Typography.Text></Space>
                  <Row gutter={8}>
                    <Col span={8}><div className="knowledge-intake-metric"><Typography.Text type="secondary">通用对象</Typography.Text><Typography.Title level={5}>{ontologyJob.result.generic_entities?.length ?? ontologyJob.result.entities.length}</Typography.Title></div></Col>
                    <Col span={8}><div className="knowledge-intake-metric"><Typography.Text type="secondary">领域映射</Typography.Text><Typography.Title level={5}>{ontologyJob.result.domain_mappings?.length ?? 0}</Typography.Title></div></Col>
                    <Col span={8}><div className="knowledge-intake-metric"><Typography.Text type="secondary">关系</Typography.Text><Typography.Title level={5}>{ontologyJob.result.relations.length}</Typography.Title></div></Col>
                  </Row>
                  <Table
                    size="small"
                    rowKey="candidate_id"
                    dataSource={ontologyJob.result.entities}
                    pagination={{ pageSize: 4 }}
                    columns={[
                      { title: '名称', dataIndex: 'name', ellipsis: true },
                      { title: '类型', dataIndex: 'entity_type', width: 120, render: (value) => <Tag color="blue">{value}</Tag> },
                      { title: '证据', dataIndex: 'source_location', width: 110 },
                    ]}
                  />
                  <Alert type={ontologyJob.quality_report?.blocking ? 'error' : 'success'} showIcon message={ontologyJob.quality_report?.blocking ? '存在阻断问题，需要先审核' : '已准备好审核并发布到图谱'} />
                  <Space wrap>
                    <Button icon={<CheckCircleOutlined />} loading={ontologyApproving} onClick={approveOntologyJob}>审核通过</Button>
                    <Button type="primary" icon={<NodeIndexOutlined />} loading={ontologyCommitting} disabled={ontologyJob.quality_report?.blocking} onClick={commitOntologyJob}>发布到图谱</Button>
                  </Space>
                </Space>
              </div>
            ) : null}
          </Card>
          <Card className="knowledge-rag-card knowledge-chat-card" title={<Space><RobotOutlined />知识助手</Space>}>
            <Tabs
              size="small"
              items={[
                {
                  key: 'chat',
                  label: '对话',
                  children: (
                    <div className="knowledge-chat-stack">
                      <div className="knowledge-chat-thread" ref={chatThreadRef}>
                        <div className="knowledge-chat-row assistant">
                          <div className="knowledge-chat-avatar"><RobotOutlined /></div>
                          <div className="knowledge-chat-bubble">
                            <span className="knowledge-chat-name">知识助手</span>
                            <div className="knowledge-chat-message">我会基于《{selectedTitle}》抽取系统、能力、上下游关系，并保留证据段落供你审核。</div>
                          </div>
                        </div>
                        {chatMessages.map((item) => (
                          <div className={`knowledge-chat-row ${item.role}`} key={item.id}>
                            {item.role === 'assistant' && <div className="knowledge-chat-avatar"><RobotOutlined /></div>}
                            <div className="knowledge-chat-bubble">
                              <span className="knowledge-chat-name">{item.role === 'assistant' ? '知识助手' : '我'}</span>
                              <div className="knowledge-chat-message">{item.content}</div>
                            </div>
                            {item.role === 'user' && <div className="knowledge-chat-avatar"><UserOutlined /></div>}
                          </div>
                        ))}
                        {agentLoading && (
                          <div className="knowledge-chat-row assistant">
                            <div className="knowledge-chat-avatar"><RobotOutlined /></div>
                            <div className="knowledge-chat-bubble">
                              <span className="knowledge-chat-name">知识助手</span>
                              <div className="knowledge-chat-message">正在恢复历史会话...</div>
                            </div>
                          </div>
                        )}
                        {searching && (
                          <div className="knowledge-chat-row assistant">
                            <div className="knowledge-chat-avatar"><RobotOutlined /></div>
                            <div className="knowledge-chat-bubble">
                              <span className="knowledge-chat-name">知识助手</span>
                              <div className="knowledge-chat-message">正在检索知识库...</div>
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="knowledge-chat-composer">
                        <Input.TextArea
                          className="knowledge-chat-input"
                          autoSize={{ minRows: 2, maxRows: 4 }}
                          value={draftQuery}
                          onChange={(event) => setDraftQuery(event.target.value)}
                          onPressEnter={(event) => {
                            if (!event.shiftKey) {
                              event.preventDefault();
                              runSearch();
                            }
                          }}
                        />
                        <Button className="knowledge-chat-send" type="primary" icon={<SendOutlined />} loading={searching} disabled={agentLoading || !draftQuery.trim()} onClick={runSearch}>发送</Button>
                      </div>
                    </div>
                  ),
                },
                {
                  key: 'extract',
                  label: 'Extraction results',
                  children: (
                    <Space className="knowledge-extract-stack" direction="vertical" size={10} style={{ width: '100%' }}>
                      <Alert
                        type={ontologyJob ? 'success' : 'info'}
                        showIcon
                        message={`Entities ${ontologyEntities.length}, relations ${ontologyRelations.length}`}
                      />
                      <div className="knowledge-result-list">
                        {ontologyEntities.length ? ontologyEntities.map((item) => (
                          <Card className="knowledge-result-card" size="small" key={item.candidate_id ?? item.name}>
                            <div className="knowledge-chunk-head"><strong>{item.name ?? item.candidate_id}</strong><Tag color="blue">{item.entity_type ?? item.type ?? '-'}</Tag></div>
                            <Progress percent={confidencePercent(Number(item.confidence ?? 0))} size="small" />
                            <Typography.Text type="secondary">{item.source_location ?? item.evidence ?? '-'}</Typography.Text>
                          </Card>
                        )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No extraction results from database" />}
                      </div>
                    </Space>
                  ),
                },
                {
                  key: 'publish',
                  label: 'Publish list',
                  children: (
                    <div className="knowledge-publish-stack">
                      <div className="knowledge-publish-list">
                        {ontologyRelations.length ? ontologyRelations.map((item, index) => {
                          const source = item.source_name ?? item.source ?? item.source_candidate_id ?? '-';
                          const target = item.target_name ?? item.target ?? item.target_candidate_id ?? '-';
                          const relation = item.relation_type ?? item.type ?? item.label ?? '-';
                          return (
                            <div className="knowledge-publish-row" key={item.candidate_id ?? `${source}-${target}-${index}`}>
                              <strong>{source}</strong><span>{relation}</span><strong>{target}</strong>
                            </div>
                          );
                        }) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No relations ready to publish" />}
                      </div>
                      <Button
                        className="knowledge-publish-action"
                        type="primary"
                        block
                        icon={<NodeIndexOutlined />}
                        loading={ontologyCommitting}
                        disabled={!ontologyJob || !ontologyRelations.length || ontologyJob.quality_report?.blocking}
                        onClick={commitOntologyJob}
                      >Publish to graph</Button>
                    </div>
                  ),
                },
                {
                  key: 'meta',
                  label: 'Attributes',
                  children: (
                    <div className="knowledge-meta-stack">
                      <div className="knowledge-note-properties">
                        <div><span>Document</span><strong>{selectedTitle}</strong></div>
                        <div><span>Source type</span><strong>{selectedSourceType}</strong></div>
                        <div><span>Status</span><strong>{(selectedDocument as any)?.status ?? '-'}</strong></div>
                        <div><span>Knowledge cards</span><strong>{cards.length}</strong></div>
                      </div>
                    </div>
                  ),
                },              ]}
            />
          </Card>
        </aside>
      </div>
    </div>
  );
}

function LegacyKnowledgeCenter() {
  const [spaces, setSpaces] = useState<KnowledgeSpace[]>([]);
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [cards, setCards] = useState<KnowledgeCard[]>([]);
  const [chunks, setChunks] = useState<KnowledgeChunk[]>([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string>();
  const [query, setQuery] = useState('供应商 8D 报告里有哪些整改措施？');
  const [answer, setAnswer] = useState('');
  const [uploading, setUploading] = useState(false);
  const [searching, setSearching] = useState(false);

  const loadKnowledge = async () => {
    try {
      const [spaceRes, sourceRes, documentRes, cardRes] = await Promise.all([
        listKnowledgeSpaces(),
        listKnowledgeSources(),
        listKnowledgeDocuments(),
        listKnowledgeCards(),
        getKnowledgeOcrPipeline().catch(() => null),
      ]);
      const nextDocuments = documentRes.data?.data ?? [];
      setSpaces(spaceRes.data?.data ?? []);
      setSources(sourceRes.data?.data ?? []);
      setDocuments(nextDocuments);
      setCards(cardRes.data?.data ?? []);
      setSelectedDocumentId((prev) => prev ?? nextDocuments[0]?.id ?? nextDocuments[0]?.document_id);
    } catch {
      setSpaces([]);
      setSources([]);
      setDocuments([]);
      setCards([]);
    }
  };

  useEffect(() => {
    loadKnowledge();
  }, []);

  useEffect(() => {
    if (!selectedDocumentId) {
      setChunks([]);
      return;
    }
    listKnowledgeChunks(selectedDocumentId)
      .then((res) => setChunks(res.data?.data ?? []))
      .catch(() => setChunks([]));
  }, [selectedDocumentId]);

  const runSearch = async () => {
    setSearching(true);
    try {
      const res = await searchKnowledge({ query, limit: 5 });
      setAnswer(res.data?.data?.answer ?? '已完成检索。');
    } catch {
      setAnswer('知识检索服务暂不可用，请稍后重试。');
    } finally {
      setSearching(false);
    }
  };

  const handleUpload = async (options: any) => {
    setUploading(true);
    try {
      await uploadKnowledgeAsset(options.file, { permission_scope: 'enterprise', owner_user_id: 'knowledge-admin' });
      message.success('资料已入库，可在知识抽取工作台继续发布到图谱');
      options.onSuccess?.({});
      loadKnowledge();
    } catch (error: any) {
      message.error(error?.response?.data?.detail ?? '上传失败');
      options.onError?.(error);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="knowledge-center">
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={7}>
          <Card title="知识空间" extra={<Tag>{spaces.length}</Tag>}>
            <List dataSource={spaces} renderItem={(item) => <List.Item><List.Item.Meta avatar={<FileSearchOutlined />} title={item.name} description={item.description} /></List.Item>} />
          </Card>
          <Card title="知识来源" style={{ marginTop: 16 }} extra={<Tag>{sources.length}</Tag>}>
            <List dataSource={sources} renderItem={(item) => <List.Item><List.Item.Meta title={item.name} description={item.status} /></List.Item>} />
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card title="文档资料" extra={<Button icon={<ReloadOutlined />} onClick={loadKnowledge}>刷新</Button>}>
            <Upload.Dragger customRequest={handleUpload} showUploadList={false} disabled={uploading}>
              <p className="ant-upload-drag-icon"><InboxOutlined /></p>
              <p className="ant-upload-text">上传知识资料</p>
              <p className="ant-upload-hint">入库后可在知识抽取工作台发起图谱抽取。</p>
            </Upload.Dragger>
            <List
              style={{ marginTop: 16 }}
              dataSource={documents}
              locale={{ emptyText: '暂无文档' }}
              renderItem={(item: any) => (
                <List.Item className={(item.id ?? item.document_id) === selectedDocumentId ? 'semantic-list-item active' : 'semantic-list-item'} onClick={() => setSelectedDocumentId(item.id ?? item.document_id)}>
                  <List.Item.Meta title={item.title ?? item.document_title ?? item.file_name} description={item.summary ?? item.updated_at} />
                </List.Item>
              )}
            />
          </Card>
        </Col>
        <Col xs={24} lg={7}>
          <Card title={<Space><RobotOutlined />知识问答</Space>}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Input.TextArea rows={3} value={query} onChange={(event) => setQuery(event.target.value)} />
              <Button block type="primary" icon={<RobotOutlined />} loading={searching} onClick={runSearch}>检索知识库</Button>
              {answer && <Alert type="info" showIcon message={answer} />}
              <Typography.Text type="secondary">相关片段</Typography.Text>
              <List dataSource={chunks.slice(0, 3)} locale={{ emptyText: '选择文档后显示片段' }} renderItem={(item) => <List.Item><Typography.Text>{item.chunk_text}</Typography.Text></List.Item>} />
              <Typography.Text type="secondary">知识卡片</Typography.Text>
              <List dataSource={cards.slice(0, 3)} locale={{ emptyText: '暂无卡片' }} renderItem={(item) => <List.Item><List.Item.Meta title={item.title} description={item.scenario ?? item.owner} /></List.Item>} />
            </Space>
          </Card>
        </Col>
      </Row>
    </div>
  );
}

