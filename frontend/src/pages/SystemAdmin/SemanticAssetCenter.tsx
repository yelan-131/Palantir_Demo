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
  Typography,
  Upload,
  message,
} from 'antd';
import cytoscape from 'cytoscape';
import dagre from 'cytoscape-dagre';
import {
  approveKnowledgeExtractionJob,
  commitKnowledgeExtractionJobToGraph,
  createKnowledgeAgentConversation,
  createKnowledgeExtractionJob,
  exportKnowledgeExtractionJob,
  getGraphAssetQuality,
  getKnowledgeOcrPipeline,
  getRelatedKnowledgeCards,
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
  listSemanticOntologyObjects,
  listSemanticOntologyRelations,
  searchKnowledge,
  sendKnowledgeAgentMessage,
  testDataSourceConfig,
  uploadKnowledgeAsset,
} from '../../services/api';

cytoscape.use(dagre);

type DataAsset = {
  id: number;
  name: string;
  type: string;
  owner: string;
  status: string;
  freshness: string;
  tables: Array<{
    id: string;
    name: string;
    label: string;
    rows: number;
    quality_score: number;
    fields: Array<{ name: string; label: string; type: string; primary_key?: boolean; searchable?: boolean; visible?: boolean; quality?: string }>;
  }>;
};

type OntologyObject = {
  id: string;
  name: string;
  code: string;
  source: string;
  description: string;
  fields: Array<{ name: string; label: string; type: string; source_field?: string; list?: boolean; form?: boolean; search?: boolean }>;
};

type OntologyRelation = {
  id: string;
  source: string;
  target: string;
  label: string;
  type: string;
  graph?: boolean;
  description?: string;
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
    relations: ExtractionRelation[];
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
type KnowledgeDocument = { id: string; title: string; source_id?: string; summary?: string; updated_at?: string };
type KnowledgeCard = { id: string; title: string; scenario?: string; owner?: string; updated_at?: string };
type KnowledgeChunk = { id: string; document_title?: string; chunk_text: string; source_ref?: string };
type KnowledgeChatMessage = { id: string; role: 'assistant' | 'user'; content: string };

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

const fallbackAssets: DataAsset[] = [
  {
    id: 1,
    name: 'Manufacturing PostgreSQL',
    type: 'postgresql',
    owner: '平台管理员',
    status: 'connected',
    freshness: '5 分钟前',
    tables: [
      {
        id: 'equipment',
        name: 'equipment',
        label: '设备主数据',
        rows: 128,
        quality_score: 98,
        fields: [
          { name: 'equipment_id', label: '设备ID', type: 'string', primary_key: true, searchable: true, visible: true, quality: 'good' },
          { name: 'name', label: '设备名称', type: 'string', searchable: true, visible: true, quality: 'good' },
          { name: 'line_id', label: '产线ID', type: 'string', visible: true, quality: 'good' },
          { name: 'status', label: '状态', type: 'enum', searchable: true, visible: true, quality: 'good' },
        ],
      },
      {
        id: 'work_orders',
        name: 'work_orders',
        label: '维修/生产工单',
        rows: 246,
        quality_score: 94,
        fields: [
          { name: 'work_order_id', label: '工单ID', type: 'string', primary_key: true, searchable: true, visible: true, quality: 'good' },
          { name: 'equipment_id', label: '设备ID', type: 'string', searchable: true, visible: true, quality: 'good' },
          { name: 'status', label: '状态', type: 'enum', searchable: true, visible: true, quality: 'warning' },
        ],
      },
    ],
  },
];

const fallbackObjects: OntologyObject[] = [
  {
    id: 'equipment',
    name: '设备',
    code: 'Equipment',
    source: 'equipment',
    description: '制造现场可维护、可监控、可关联工单和质量事件的设备对象。',
    fields: [
      { name: 'equipment_id', label: '设备ID', type: 'string', source_field: 'equipment_id', list: true, form: true, search: true },
      { name: 'name', label: '设备名称', type: 'string', source_field: 'name', list: true, form: true, search: true },
      { name: 'status', label: '状态', type: 'enum', source_field: 'status', list: true, form: true, search: true },
    ],
  },
  {
    id: 'defect',
    name: '缺陷',
    code: 'Defect',
    source: 'quality_defects',
    description: '质量异常、缺陷类型、严重度和证据来源的统一语义对象。',
    fields: [
      { name: 'defect_id', label: '缺陷ID', type: 'string', source_field: 'defect_id', list: true, form: true, search: true },
      { name: 'severity', label: '严重度', type: 'enum', source_field: 'severity', list: true, form: true, search: true },
    ],
  },
];

const fallbackRelations: OntologyRelation[] = [
  { id: 'equipment-workorder', source: 'equipment', target: 'work_order', label: '产生工单', type: 'GENERATES', graph: true, description: '设备异常或计划维护触发工单。' },
  { id: 'defect-equipment', source: 'defect', target: 'equipment', label: '关联设备', type: 'RELATED_TO', graph: true, description: '缺陷可追溯到相关设备或工序。' },
];

const fallbackGraphNodes: GraphAssetNode[] = [
  { id: 'demo-ent-supplier-beichen', name: '北辰电子材料', type: 'Supplier', confidence: 0.96, source_document_id: 'demo-doc-supplier-8d', source_location: '8D:供应商信息', knowledge_job_id: 'demo-job-supplier-8d', review_status: 'approved', publish_status: 'published', binding_status: 'unbound' },
  { id: 'demo-ent-material-mb7781', name: 'MB-7781 焊锡膏 S12', type: 'MaterialBatch', confidence: 0.94, source_document_id: 'demo-doc-supplier-8d', source_location: '8D:D3 围堵措施', knowledge_job_id: 'demo-job-supplier-8d', review_status: 'approved', publish_status: 'published', binding_status: 'unbound' },
  { id: 'demo-ent-defect-void', name: 'BGA 焊点虚焊', type: 'Defect', confidence: 0.91, source_document_id: 'demo-doc-supplier-8d', source_location: '8D:D2 问题描述', knowledge_job_id: 'demo-job-supplier-8d', review_status: 'approved', publish_status: 'published', binding_status: 'unbound' },
  { id: 'demo-ent-capa-072', name: 'CAPA-072 批次冻结与复检', type: 'CAPA', confidence: 0.88, source_document_id: 'demo-doc-supplier-8d', source_location: '8D:D5/D6 纠正措施', knowledge_job_id: 'demo-job-supplier-8d', review_status: 'approved', publish_status: 'published', binding_status: 'unbound' },
  { id: 'demo-ent-sop-q14', name: 'SOP-QA-014 焊点虚焊复检流程', type: 'KnowledgeCard', confidence: 0.92, source_document_id: 'demo-doc-quality-sop', source_location: 'SOP:3.2-4.1', knowledge_job_id: 'demo-job-quality-sop', review_status: 'approved', publish_status: 'published', binding_status: 'unbound' },
  { id: 'demo-ent-equipment-smt03', name: 'SMT-03 回流炉', type: 'Equipment', confidence: 0.93, source_document_id: 'demo-doc-equipment-log', source_location: '设备日志:09:12', knowledge_job_id: 'demo-job-equipment-log', review_status: 'approved', publish_status: 'published', binding_status: 'unbound' },
  { id: 'demo-ent-workorder-017', name: 'WO-260521-017 电控模块工单', type: 'WorkOrder', confidence: 0.9, source_document_id: 'demo-doc-workorder-exception', source_location: '工单异常记录:line 6', knowledge_job_id: 'demo-job-workorder-exception', review_status: 'approved', publish_status: 'published', binding_status: 'unbound' },
  { id: 'demo-ent-customer-order-8821', name: 'SO-8821 客户订单', type: 'CustomerOrder', confidence: 0.8, source_document_id: 'demo-doc-workorder-exception', source_location: '工单异常记录:line 12', knowledge_job_id: 'demo-job-workorder-exception', review_status: 'approved', publish_status: 'published', binding_status: 'unbound' },
];

const fallbackGraphRelationships: GraphAssetRelationship[] = [
  { id: 'demo-rel-supplier-material', source_name: '北辰电子材料', target_name: 'MB-7781 焊锡膏 S12', relation_type: 'SUPPLIES', confidence: 0.93, source_document_id: 'demo-doc-supplier-8d', source_location: '8D:供应商信息', knowledge_job_id: 'demo-job-supplier-8d', publish_status: 'published' },
  { id: 'demo-rel-material-defect', source_name: 'MB-7781 焊锡膏 S12', target_name: 'BGA 焊点虚焊', relation_type: 'MAY_CAUSE', confidence: 0.82, source_document_id: 'demo-doc-supplier-8d', source_location: '8D:D4 根因分析', knowledge_job_id: 'demo-job-supplier-8d', publish_status: 'published' },
  { id: 'demo-rel-defect-capa', source_name: 'BGA 焊点虚焊', target_name: 'CAPA-072 批次冻结与复检', relation_type: 'TRIGGERS', confidence: 0.89, source_document_id: 'demo-doc-supplier-8d', source_location: '8D:D5/D6 纠正措施', knowledge_job_id: 'demo-job-supplier-8d', publish_status: 'published' },
  { id: 'demo-rel-sop-defect', source_name: 'SOP-QA-014 焊点虚焊复检流程', target_name: 'BGA 焊点虚焊', relation_type: 'EVIDENCE_FOR', confidence: 0.87, source_document_id: 'demo-doc-quality-sop', source_location: 'SOP:3.2', knowledge_job_id: 'demo-job-quality-sop', publish_status: 'published' },
  { id: 'demo-rel-workorder-equipment', source_name: 'WO-260521-017 电控模块工单', target_name: 'SMT-03 回流炉', relation_type: 'USES_EQUIPMENT', confidence: 0.87, source_document_id: 'demo-doc-workorder-exception', source_location: '工单异常记录:line 6', knowledge_job_id: 'demo-job-workorder-exception', publish_status: 'published' },
  { id: 'demo-rel-product-order', source_name: 'PB-260521-A 电控模块产品批', target_name: 'SO-8821 客户订单', relation_type: 'AFFECTS_ORDER', confidence: 0.8, source_document_id: 'demo-doc-workorder-exception', source_location: '工单异常记录:line 12', knowledge_job_id: 'demo-job-workorder-exception', publish_status: 'published' },
];

const fallbackGraphEvidence: GraphAssetEvidence[] = [
  ...fallbackGraphNodes.map((node) => ({ id: `${node.id}:evidence`, asset_type: 'node', asset_name: node.name, source_document_id: node.source_document_id, source_location: node.source_location, confidence: node.confidence, knowledge_job_id: node.knowledge_job_id })),
  ...fallbackGraphRelationships.map((rel) => ({ id: `${rel.id}:evidence`, asset_type: 'relationship', asset_name: `${rel.source_name} -> ${rel.target_name}`, source_document_id: rel.source_document_id, source_location: rel.source_location, confidence: rel.confidence, knowledge_job_id: rel.knowledge_job_id })),
];

const fallbackGraphQuality = {
  summary: {
    nodes: fallbackGraphNodes.length,
    relationships: fallbackGraphRelationships.length,
    missing_evidence: 0,
    low_confidence: 0,
    unbound_nodes: fallbackGraphNodes.length,
  },
  items: fallbackGraphNodes.map((node) => ({ severity: 'INFO', code: 'UNBOUND_MASTER_DATA', target: node.name, asset_id: node.id })),
};

function confidencePercent(value: number) {
  return Math.round((Number(value) || 0) * 100);
}

function boolTag(value?: boolean) {
  return value ? <Tag color="success">是</Tag> : <Tag>否</Tag>;
}

type SemanticAssetCenterView = 'data' | 'ontology' | 'graph-assets';

export default function SemanticAssetCenter({ view }: { view?: SemanticAssetCenterView } = {}) {
  const [dataSourceForm] = Form.useForm();
  const [assets, setAssets] = useState<DataAsset[]>(fallbackAssets);
  const [objects, setObjects] = useState<OntologyObject[]>(fallbackObjects);
  const [relations, setRelations] = useState<OntologyRelation[]>(fallbackRelations);
  const [selectedAssetId, setSelectedAssetId] = useState<number>(fallbackAssets[0].id);
  const [selectedTableId, setSelectedTableId] = useState<string>(fallbackAssets[0].tables[0].id);
  const [selectedObjectId, setSelectedObjectId] = useState<string>(fallbackObjects[0].id);
  const [assetSearch, setAssetSearch] = useState('');
  const [activeDomain, setActiveDomain] = useState('全部');
  const [sourceModalOpen, setSourceModalOpen] = useState(false);
  const [sourceStep, setSourceStep] = useState(0);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionTestResult, setConnectionTestResult] = useState<'success' | 'error' | undefined>();
  const [scanning, setScanning] = useState(false);
  const [semanticReadyTables, setSemanticReadyTables] = useState<string[]>([]);
  const [publishedTables, setPublishedTables] = useState<string[]>([]);
  const [qualityRuleState, setQualityRuleState] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const selectedAsset = useMemo(() => assets.find((item) => item.id === selectedAssetId) ?? assets[0], [assets, selectedAssetId]);
  const allTables = useMemo(
    () => assets.flatMap((asset) => asset.tables.map((table) => ({ ...table, assetName: asset.name, assetType: asset.type, owner: asset.owner, freshness: asset.freshness, status: asset.status }))),
    [assets],
  );
  const selectedTable = useMemo(() => allTables.find((item) => item.id === selectedTableId) ?? allTables[0], [allTables, selectedTableId]);
  const selectedObject = useMemo(() => objects.find((item) => item.id === selectedObjectId) ?? objects[0], [objects, selectedObjectId]);
  const objectRelations = relations.filter((item) => item.source === selectedObject?.id || item.target === selectedObject?.id);
  const filteredTables = useMemo(() => {
    const keyword = assetSearch.trim().toLowerCase();
    return (selectedAsset?.tables ?? []).filter((table) => {
      const inKeyword = !keyword
        || table.name.toLowerCase().includes(keyword)
        || table.label.toLowerCase().includes(keyword)
        || table.fields.some((field) => field.name.toLowerCase().includes(keyword) || field.label.toLowerCase().includes(keyword));
      const inDomain = activeDomain === '全部'
        || (activeDomain === '设备' && table.fields.some((field) => field.name.includes('equipment') || field.label.includes('设备')))
        || (activeDomain === '生产' && (table.name.includes('work') || table.label.includes('生产') || table.label.includes('工单')))
        || (activeDomain === '质量' && (table.name.includes('quality') || table.label.includes('质量') || table.fields.some((field) => field.name.includes('status'))))
        || (activeDomain === '供应链' && (table.name.includes('supplier') || table.label.includes('供应')))
        || (activeDomain === '仓储' && (table.name.includes('inventory') || table.label.includes('仓')))
        || (activeDomain === '客户' && (table.name.includes('customer') || table.label.includes('客户')));
      return inKeyword && inDomain;
    });
  }, [activeDomain, assetSearch, selectedAsset]);
  const assetStats = useMemo(() => {
    const tableCount = allTables.length;
    const totalRows = allTables.reduce((sum, table) => sum + Number(table.rows || 0), 0);
    const avgQuality = tableCount ? Math.round(allTables.reduce((sum, table) => sum + Number(table.quality_score || 0), 0) / tableCount) : 0;
    const mappedCount = allTables.filter((table) => objects.some((object) => object.source === table.id)).length;
    return { tableCount, totalRows, avgQuality, mappedCount };
  }, [allTables, objects]);

  const load = async () => {
    setLoading(true);
    try {
      const [assetRes, objectRes, relationRes] = await Promise.all([
        listSemanticDataAssets(),
        listSemanticOntologyObjects(),
        listSemanticOntologyRelations(),
      ]);
      const nextAssets = assetRes.data?.data?.length ? assetRes.data.data : fallbackAssets;
      const nextObjects = objectRes.data?.data?.length ? objectRes.data.data : fallbackObjects;
      setAssets(nextAssets);
      setObjects(nextObjects);
      setRelations(relationRes.data?.data?.length ? relationRes.data.data : fallbackRelations);
      setSelectedAssetId((prev) => prev ?? nextAssets[0]?.id);
      setSelectedTableId((prev) => nextAssets.flatMap((asset: DataAsset) => asset.tables).some((table: DataAsset['tables'][number]) => table.id === prev) ? prev : nextAssets[0]?.tables[0]?.id);
      setSelectedObjectId((prev) => prev ?? nextObjects[0]?.id);
    } catch {
      setAssets(fallbackAssets);
      setObjects(fallbackObjects);
      setRelations(fallbackRelations);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (filteredTables.length && !filteredTables.some((table) => table.id === selectedTableId)) {
      setSelectedTableId(filteredTables[0].id);
    }
  }, [filteredTables, selectedTableId]);

  const openDataSourceWizard = () => {
    setSourceStep(0);
    setConnectionTestResult(undefined);
    dataSourceForm.setFieldsValue({
      type: 'postgresql',
      host: 'localhost',
      port: 5432,
      database: 'mf_mes_execution',
      schema: 'source',
      auth_type: 'password',
      username: 'mf_readonly',
      password: 'readonly_demo_123',
      owner: '平台管理员',
      sync_frequency: '每 5 分钟',
      sync_mode: 'metadata',
      business_domain: '生产',
      network_zone: '内网 Connector Agent',
      ssl_enabled: true,
      save_secret: true,
      allow_ai: true,
      allow_ontology: true,
      allow_graph: false,
      sync_scope: ['metadata', 'profile', 'sample'],
      tables: ['equipment', 'work_orders'],
    });
    setSourceModalOpen(true);
  };

  const closeDataSourceWizard = () => {
    setSourceModalOpen(false);
    setSourceStep(0);
    setConnectionTestResult(undefined);
  };

  const nextSourceStep = async () => {
    const stepFields = [
      ['type'],
      ['host', 'port', 'database'],
      ['auth_type', 'username', 'password'],
      ['sync_scope', 'tables'],
      ['business_domain', 'owner'],
    ][sourceStep] ?? [];
    await dataSourceForm.validateFields(stepFields);
    setSourceStep((prev) => Math.min(prev + 1, 4));
  };

  const testDataSourceConnection = async () => {
    const values = await dataSourceForm.validateFields(['type', 'host', 'port', 'database', 'schema', 'auth_type', 'username', 'password', 'ssl_enabled']);
    setTestingConnection(true);
    setConnectionTestResult(undefined);
    try {
      const res = await testDataSourceConfig({
        source_type: values.type,
        host: values.host,
        port: values.port,
        database: values.database,
        schema_name: values.schema || 'source',
        username: values.username,
        password: values.password,
        ssl_enabled: Boolean(values.ssl_enabled),
      });
      setConnectionTestResult('success');
      const tables = res.data?.tables ?? [];
      if (tables.length) {
        dataSourceForm.setFieldsValue({ tables: tables.slice(0, 4).map((table: any) => table.name) });
      }
      message.success(`连接测试通过：发现 ${tables.length || 0} 张候选表`);
    } catch (error: any) {
      setConnectionTestResult('error');
      message.error(error?.response?.data?.detail ?? '连接测试失败');
    } finally {
      setTestingConnection(false);
    }
  };

  const addDataSource = async () => {
    const values = await dataSourceForm.validateFields();
    const nextId = Math.max(0, ...assets.map((asset) => asset.id)) + 1;
    const sourceName = String(values.name || `${values.type}://${values.host}/${values.database}`);
    const sourceType = String(values.type);
    const firstTableId = `${sourceType}_${nextId}_dataset`;
    const tableNames = Array.isArray(values.tables) && values.tables.length ? values.tables : ['equipment', 'work_orders'];
    const nextAsset: DataAsset = {
      id: nextId,
      name: sourceName,
      type: sourceType,
      owner: String(values.owner ?? '平台管理员'),
      status: 'connected',
      freshness: '刚刚',
      tables: tableNames.map((tableName: string, index: number) => ({
        id: index === 0 ? firstTableId : `${sourceType}_${nextId}_${tableName}`,
        name: tableName,
        label: tableName === 'equipment' ? '设备主数据' : tableName === 'work_orders' ? '维修/生产工单' : `${tableName} 数据集`,
        rows: 0,
        quality_score: 82,
        fields: [
          { name: 'id', label: '主键ID', type: 'string', primary_key: true, searchable: true, visible: true, quality: 'good' },
          { name: 'name', label: '名称', type: 'string', searchable: true, visible: true, quality: 'good' },
          { name: 'updated_at', label: '更新时间', type: 'datetime', visible: true, quality: 'warning' },
        ],
      })),
    };
    setAssets((prev) => [nextAsset, ...prev]);
    setSelectedAssetId(nextId);
    setSelectedTableId(firstTableId);
    closeDataSourceWizard();
    dataSourceForm.resetFields();
    message.success('数据源已接入，已生成待扫描的元数据集');
  };

  const scanMetadata = () => {
    if (!selectedAsset) return;
    setScanning(true);
    window.setTimeout(() => {
      setAssets((prev) => prev.map((asset) => asset.id === selectedAsset.id
        ? {
            ...asset,
            freshness: '刚刚',
            tables: asset.tables.map((table) => ({
              ...table,
              rows: table.rows || 64,
              quality_score: Math.max(table.quality_score, 88),
            })),
          }
        : asset));
      setScanning(false);
      message.success('元数据扫描完成，已刷新记录数、质量分和字段画像');
    }, 650);
  };

  const runSemanticRecognition = () => {
    if (!selectedTable) return;
    setSemanticReadyTables((prev) => Array.from(new Set([...prev, selectedTable.id])));
    message.success(`已为「${selectedTable.label}」生成候选实体、属性和关系映射`);
  };

  const publishToOntology = () => {
    if (!selectedTable) return;
    const existing = objects.some((object) => object.source === selectedTable.id);
    if (!existing) {
      const code = selectedTable.label.replace(/主数据|数据集|数据表/g, '') || selectedTable.label;
      const nextObject: OntologyObject = {
        id: selectedTable.id,
        name: code,
        code: selectedTable.name.replace(/(^|_)(\w)/g, (_, __, char: string) => char.toUpperCase()),
        source: selectedTable.id,
        description: `由数据资产「${selectedTable.label}」发布生成的候选本体对象。`,
        fields: selectedTable.fields.map((field) => ({
          name: field.name,
          label: field.label,
          type: field.type,
          source_field: field.name,
          list: Boolean(field.visible),
          form: !field.primary_key,
          search: Boolean(field.searchable),
        })),
      };
      setObjects((prev) => [nextObject, ...prev]);
      setSelectedObjectId(nextObject.id);
    }
    setSemanticReadyTables((prev) => Array.from(new Set([...prev, selectedTable.id])));
    setPublishedTables((prev) => Array.from(new Set([...prev, selectedTable.id])));
    message.success(`「${selectedTable.label}」已发布为本体建模候选对象`);
  };

  const updateQualityRule = (rule: string, checked: boolean) => {
    if (!selectedTable) return;
    setQualityRuleState((prev) => ({ ...prev, [`${selectedTable.id}:${rule}`]: checked ? 'enabled' : 'disabled' }));
  };

  const dataAssetView = (
    <>
    <div className="data-asset-workbench">
      <aside className="data-asset-directory">
        <Card className="semantic-side-card" title="数据资产目录" extra={<Button size="small" icon={<ReloadOutlined />} onClick={load}>刷新</Button>}>
          <Input.Search placeholder="搜索数据源、表、字段" allowClear value={assetSearch} onChange={(event) => setAssetSearch(event.target.value)} />
          <div className="data-directory-section">
            <Typography.Text type="secondary">数据源</Typography.Text>
            <List
              loading={loading}
              dataSource={assets}
              renderItem={(item) => (
                <List.Item
                  className={item.id === selectedAsset?.id ? 'semantic-list-item active' : 'semantic-list-item'}
                  onClick={() => {
                    setSelectedAssetId(item.id);
                    setSelectedTableId(item.tables[0]?.id);
                  }}
                >
                  <List.Item.Meta
                    avatar={<DatabaseOutlined />}
                    title={<Space><span>{item.name}</span><Tag color="success">{item.status}</Tag></Space>}
                    description={`${item.type} / ${item.owner} / ${item.freshness}`}
                  />
                </List.Item>
              )}
            />
          </div>
          <div className="data-directory-section">
            <Typography.Text type="secondary">业务域</Typography.Text>
            <div className="data-domain-list">
              {['全部', '生产', '设备', '质量', '供应链', '仓储', '客户'].map((domain, index) => (
                <button key={domain} type="button" className={activeDomain === domain ? 'active' : ''} onClick={() => setActiveDomain(domain)}>
                  <span>{domain}</span>
                  <Tag>{domain === '全部' ? selectedAsset?.tables.length ?? 0 : Math.max(0, index + 1)}</Tag>
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
              <Typography.Text type="secondary">接入、盘点、治理并发布可进入本体建模的数据资产</Typography.Text>
            </Space>
          }
          extra={
            <Space wrap>
              <Button icon={<DatabaseOutlined />} onClick={openDataSourceWizard}>接入数据源</Button>
              <Button icon={<ReloadOutlined />} loading={scanning} onClick={scanMetadata}>扫描元数据</Button>
              <Button icon={<RobotOutlined />} onClick={runSemanticRecognition}>AI 语义识别</Button>
              <Button type="primary" icon={<NodeIndexOutlined />} onClick={publishToOntology}>发布到本体建模</Button>
            </Space>
          }
        >
          <div className="data-asset-metrics">
            <div><span>数据源</span><strong>{assets.length}</strong></div>
            <div><span>数据表 / 数据集</span><strong>{assetStats.tableCount}</strong></div>
            <div><span>总记录数</span><strong>{assetStats.totalRows.toLocaleString()}</strong></div>
            <div><span>平均质量分</span><strong>{assetStats.avgQuality}</strong></div>
            <div><span>已映射本体</span><strong>{assetStats.mappedCount}</strong></div>
          </div>

          <Table
            className="data-asset-table"
            rowKey="id"
            dataSource={filteredTables}
            pagination={false}
            locale={{ emptyText: <Empty description="没有匹配的数据资产" /> }}
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
                  const text = published ? '已发布本体' : mapped ? '已映射本体' : ready ? '已识别' : '待识别';
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
                      {[
                        ['主键唯一性', '已通过', 'success', true],
                        ['必填字段完整性', '已通过', 'success', true],
                        ['状态枚举合法值', selectedTable.fields.some((field) => field.quality === 'warning') ? '需复核' : '已通过', selectedTable.fields.some((field) => field.quality === 'warning') ? 'warning' : 'success', true],
                        ['跨表引用一致性', '待配置', 'default', false],
                      ].map(([name, status, color, enabled]) => (
                        <div className="data-quality-row" key={String(name)}>
                          <Checkbox
                            checked={(qualityRuleState[`${selectedTable.id}:${name}`] ?? (enabled ? 'enabled' : 'disabled')) === 'enabled'}
                            onChange={(event) => updateQualityRule(String(name), event.target.checked)}
                          >
                            {String(name)}
                          </Checkbox>
                          <Tag color={String(color)}>{String(status)}</Tag>
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
                      <Alert showIcon type="info" message="AI 已根据字段名、样例值和业务域生成候选本体映射，确认后可进入本体建模中心。" />
                      <div className="data-mapping-card">
                        <Typography.Text type="secondary">推荐实体</Typography.Text>
                        <Typography.Title level={5}>{selectedTable.label.replace('主数据', '') || selectedTable.label}</Typography.Title>
                        <Space wrap style={{ marginBottom: 8 }}>
                          <Tag color={semanticReadyTables.includes(selectedTable.id) ? 'processing' : 'default'}>{semanticReadyTables.includes(selectedTable.id) ? '已生成候选映射' : '等待 AI 识别'}</Tag>
                          <Tag color={publishedTables.includes(selectedTable.id) ? 'success' : 'default'}>{publishedTables.includes(selectedTable.id) ? '已发布' : '未发布'}</Tag>
                        </Space>
                        <Space wrap>
                          {selectedTable.fields.slice(0, 5).map((field) => (
                            <Tag key={field.name}>{field.name} → {field.label}</Tag>
                          ))}
                        </Space>
                      </div>
                      <Button type="primary" block icon={<NodeIndexOutlined />} onClick={publishToOntology}>送入本体建模中心</Button>
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
      title="接入数据源"
      open={sourceModalOpen}
      onCancel={closeDataSourceWizard}
      width={900}
      destroyOnHidden
      footer={
        <Space>
          <Button onClick={closeDataSourceWizard}>取消</Button>
          {sourceStep > 0 && <Button onClick={() => setSourceStep((prev) => prev - 1)}>上一步</Button>}
          {sourceStep < 4 ? (
            <Button type="primary" onClick={nextSourceStep}>下一步</Button>
          ) : (
            <Button type="primary" onClick={addDataSource}>接入并生成资产</Button>
          )}
        </Space>
      }
    >
      <div className="source-onboarding">
        <Steps
          size="small"
          current={sourceStep}
          items={[
            { title: '类型' },
            { title: '连接' },
            { title: '凭据' },
            { title: '范围' },
            { title: '治理' },
          ]}
        />
        <Form form={dataSourceForm} layout="vertical" className="source-onboarding-form">
          {sourceStep === 0 && (
            <div className="source-step-grid">
              <Form.Item name="type" label="数据源类型" rules={[{ required: true }]}>
                <Select
                  options={[
                    { value: 'postgresql', label: 'PostgreSQL' },
                    { value: 'mysql', label: 'MySQL' },
                    { value: 'sqlserver', label: 'SQL Server' },
                    { value: 'oracle', label: 'Oracle' },
                    { value: 'rest_api', label: 'REST API' },
                    { value: 'excel', label: 'Excel / CSV' },
                    { value: 'opcua', label: 'OPC UA' },
                  ]}
                />
              </Form.Item>
              <Form.Item name="name" label="资产显示名称">
                <Input placeholder="例如：MES PostgreSQL" />
              </Form.Item>
              <Alert
                showIcon
                type="info"
                message="接入不是直接把所有数据搬进平台，而是先建立连接、凭据、范围、权限和元数据扫描策略。"
              />
            </div>
          )}
          {sourceStep === 1 && (
            <>
              <div className="source-form-grid">
                <Form.Item name="host" label="主机 / IP" rules={[{ required: true, message: '请输入主机或 IP' }]}>
                  <Input placeholder="10.10.20.15" />
                </Form.Item>
                <Form.Item name="port" label="端口" rules={[{ required: true, message: '请输入端口' }]}>
                  <InputNumber min={1} max={65535} style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item name="database" label="数据库 / 服务名" rules={[{ required: true, message: '请输入数据库名' }]}>
                  <Input placeholder="manufacturing" />
                </Form.Item>
                <Form.Item name="schema" label="Schema / Namespace">
                  <Input placeholder="public" />
                </Form.Item>
                <Form.Item name="network_zone" label="网络区域 / Connector Agent">
                  <Select
                    options={[
                      { value: '内网 Connector Agent', label: '内网 Connector Agent' },
                      { value: '平台直连', label: '平台直连' },
                      { value: 'VPN 专线', label: 'VPN 专线' },
                    ]}
                  />
                </Form.Item>
                <Form.Item name="ssl_enabled" label="SSL / TLS" valuePropName="checked">
                  <Switch checkedChildren="开启" unCheckedChildren="关闭" />
                </Form.Item>
              </div>
              <Alert showIcon message="建议优先使用企业内网 Connector Agent，由代理访问数据库，平台只接收授权后的元数据和数据流。" />
            </>
          )}
          {sourceStep === 2 && (
            <>
              <div className="source-form-grid">
                <Form.Item name="auth_type" label="认证方式" rules={[{ required: true }]}>
                  <Select
                    options={[
                      { value: 'password', label: '用户名 / 密码' },
                      { value: 'token', label: 'Token / API Key' },
                      { value: 'oauth', label: 'OAuth' },
                      { value: 'kerberos', label: 'Kerberos / LDAP' },
                    ]}
                  />
                </Form.Item>
                <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
                  <Input placeholder="readonly_user" />
                </Form.Item>
                <Form.Item name="password" label="密码 / Secret" rules={[{ required: true, message: '请输入密码或 Secret' }]}>
                  <Input.Password placeholder="不会在页面回显保存后的密钥" />
                </Form.Item>
                <Form.Item name="save_secret" label="保存到凭据库" valuePropName="checked">
                  <Switch checkedChildren="保存" unCheckedChildren="不保存" />
                </Form.Item>
              </div>
              <Space wrap>
                <Button icon={<CheckCircleOutlined />} loading={testingConnection} onClick={testDataSourceConnection}>测试连接</Button>
                {connectionTestResult === 'success' && <Tag color="success">连接成功 / 只读权限 / 延迟 38ms</Tag>}
                {connectionTestResult === 'error' && <Tag color="error">连接失败</Tag>}
              </Space>
            </>
          )}
          {sourceStep === 3 && (
            <>
              <Form.Item name="sync_scope" label="同步对象" rules={[{ required: true, message: '请选择同步对象' }]}>
                <Checkbox.Group
                  options={[
                    { label: '表结构', value: 'metadata' },
                    { label: '字段画像', value: 'profile' },
                    { label: '样例数据', value: 'sample' },
                    { label: '全量数据', value: 'full' },
                    { label: '增量数据', value: 'incremental' },
                  ]}
                />
              </Form.Item>
              <Form.Item name="tables" label="候选表 / 数据集" rules={[{ required: true, message: '请选择至少一张表' }]}>
                <Checkbox.Group
                  className="source-table-picker"
                  options={[
                    { label: 'equipment 设备主数据', value: 'equipment' },
                    { label: 'work_orders 维修/生产工单', value: 'work_orders' },
                    { label: 'operation_events 设备事件', value: 'operation_events' },
                    { label: 'materials 物料主数据', value: 'materials' },
                    { label: 'customer_orders 客户订单', value: 'customer_orders' },
                    { label: 'purchase_orders 采购订单', value: 'purchase_orders' },
                    { label: 'quality_defects 质量缺陷', value: 'quality_defects' },
                    { label: 'inspections 质检记录', value: 'inspections' },
                    { label: 'capa_actions CAPA 措施', value: 'capa_actions' },
                    { label: 'suppliers 供应商主数据', value: 'suppliers' },
                    { label: 'shipments 供应发运', value: 'shipments' },
                    { label: 'inventory_balances 库存余额', value: 'inventory_balances' },
                    { label: 'material_lots 物料批次', value: 'material_lots' },
                  ]}
                />
              </Form.Item>
              <Form.Item name="sync_mode" label="同步方式">
                <Select
                  options={[
                    { value: 'metadata', label: '仅元数据扫描' },
                    { value: 'batch', label: '定时批量同步' },
                    { value: 'incremental', label: '增量同步' },
                    { value: 'cdc', label: 'CDC' },
                  ]}
                />
              </Form.Item>
              <Form.Item name="sync_frequency" label="同步频率">
                <Select
                  options={[
                    { value: '实时', label: '实时' },
                    { value: '每 5 分钟', label: '每 5 分钟' },
                    { value: '每小时', label: '每小时' },
                    { value: '每日', label: '每日' },
                  ]}
                />
              </Form.Item>
            </>
          )}
          {sourceStep === 4 && (
            <>
              <div className="source-form-grid">
                <Form.Item name="business_domain" label="业务域" rules={[{ required: true }]}>
                  <Select options={['生产', '设备', '质量', '供应链', '仓储', '客户'].map((item) => ({ value: item, label: item }))} />
                </Form.Item>
                <Form.Item name="owner" label="负责人" rules={[{ required: true, message: '请输入负责人' }]}>
                  <Input />
                </Form.Item>
                <Form.Item name="sensitivity" label="数据分级">
                  <Select
                    options={[
                      { value: 'internal', label: '内部' },
                      { value: 'confidential', label: '敏感' },
                      { value: 'restricted', label: '受限' },
                    ]}
                  />
                </Form.Item>
              </div>
              <Divider />
              <div className="source-governance-switches">
                <Form.Item name="allow_ai" label="允许 AI 使用" valuePropName="checked">
                  <Switch />
                </Form.Item>
                <Form.Item name="allow_ontology" label="允许进入本体建模" valuePropName="checked">
                  <Switch />
                </Form.Item>
                <Form.Item name="allow_graph" label="允许生成知识图谱实例" valuePropName="checked">
                  <Switch />
                </Form.Item>
              </div>
              <Alert showIcon type="success" message="完成后会生成数据资产，随后可扫描元数据、识别语义并发布到本体建模中心。" />
            </>
          )}
        </Form>
      </div>
    </Modal>
    </>
  );

  const ontologyView = (
    <Row className="semantic-data-asset-grid" gutter={[16, 16]}>
      <Col xs={24} lg={7}>
        <Card className="semantic-side-card" title="本体对象" extra={<Tag>{objects.length}</Tag>}>
          <Select value={selectedObject?.id} style={{ width: '100%', marginBottom: 12 }} options={objects.map((item) => ({ label: `${item.name} / ${item.code}`, value: item.id }))} onChange={setSelectedObjectId} />
          <List
            dataSource={objects}
            renderItem={(item) => (
              <List.Item className={item.id === selectedObject?.id ? 'semantic-list-item active' : 'semantic-list-item'} onClick={() => setSelectedObjectId(item.id)}>
                <List.Item.Meta avatar={<ApartmentOutlined />} title={item.name} description={`${item.code} -> ${item.source}`} />
              </List.Item>
            )}
          />
        </Card>
      </Col>
      <Col xs={24} lg={17}>
        {selectedObject ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Card title={<Space><NodeIndexOutlined />{selectedObject.name}<Tag>{selectedObject.code}</Tag></Space>} extra={<Tag color="processing">绑定数据集：{selectedObject.source}</Tag>}>
              <Typography.Paragraph>{selectedObject.description}</Typography.Paragraph>
              <Table
                size="small"
                rowKey="name"
                dataSource={selectedObject.fields}
                pagination={false}
                columns={[
                  { title: '对象字段', dataIndex: 'label' },
                  { title: '字段编码', dataIndex: 'name' },
                  { title: '类型', dataIndex: 'type', render: (type: string) => <Tag>{type}</Tag> },
                  { title: '来源字段', dataIndex: 'source_field' },
                  { title: '列表', dataIndex: 'list', render: boolTag },
                  { title: '表单', dataIndex: 'form', render: boolTag },
                  { title: '搜索', dataIndex: 'search', render: boolTag },
                ]}
              />
            </Card>
            <Card title={<Space><BranchesOutlined />对象关系 / 图谱边</Space>}>
              <Table
                size="small"
                rowKey="id"
                dataSource={objectRelations}
                pagination={false}
                columns={[
                  { title: '源对象', dataIndex: 'source' },
                  { title: '关系', dataIndex: 'label', render: (text, record: OntologyRelation) => <Space><Tag color="blue">{record.type}</Tag>{text}</Space> },
                  { title: '目标对象', dataIndex: 'target' },
                  { title: '进入图谱', dataIndex: 'graph', render: boolTag },
                  { title: '说明', dataIndex: 'description' },
                ]}
              />
            </Card>
            <Card title="来自抽取任务的本体建议" size="small">
              <Alert showIcon type="info" message="抽取工作台发现未匹配的实体类型或关系类型时，会在这里形成建议，管理员确认后再进入正式本体。" />
            </Card>
          </Space>
        ) : (
          <Empty />
        )}
      </Col>
    </Row>
  );

  const viewContent = {
    data: dataAssetView,
    ontology: ontologyView,
    'graph-assets': <KnowledgeGraphCenterV2 />,
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
          <Typography.Text type="secondary">统一管理数据资产、本体建模、文档知识抽取和后台知识图谱发布。</Typography.Text>
        </div>
        <Space>
          <Tag icon={<FileSearchOutlined />}>Graph Governance</Tag>
          <Button icon={<ReloadOutlined />} onClick={load}>重新读取</Button>
        </Space>
      </section>
      <Tabs
        items={[
          { key: 'data', label: '数据资产中心', children: dataAssetView },
          { key: 'ontology', label: '本体建模中心', children: ontologyView },
          { key: 'graph-assets', label: '知识图谱中心', children: <KnowledgeGraphCenterV2 /> },
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
      setNodes(fallbackGraphNodes);
      setRelationships(fallbackGraphRelationships);
      setEvidence(fallbackGraphEvidence);
      setQuality(fallbackGraphQuality);
      message.warning('后端图谱接口暂不可用，已展示本地演示案例');
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

function KnowledgeGraphCenterV2() {
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
      setNodes(fallbackGraphNodes);
      setRelationships(fallbackGraphRelationships);
      setEvidence(fallbackGraphEvidence);
      setQuality(fallbackGraphQuality);
      message.warning('后端图谱接口暂不可用，已展示本地演示案例');
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
    return matchedSearch && matchedType && matchedPublish && matchedBinding;
  }), [bindingStatus, entityType, nodes, publishStatus, search]);
  const baseVisibleNodeNames = useMemo(() => new Set(baseVisibleNodes.map((node) => node.name)), [baseVisibleNodes]);
  const baseVisibleRelationships = useMemo(() => relationships.filter((rel) => {
    const matchedSearch = !search || `${rel.source_name} ${rel.target_name} ${rel.relation_type} ${rel.knowledge_job_id ?? ''}`.toLowerCase().includes(search.toLowerCase());
    return matchedSearch && baseVisibleNodeNames.has(rel.source_name) && baseVisibleNodeNames.has(rel.target_name);
  }), [baseVisibleNodeNames, relationships, search]);
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
    <Space className="graph-asset-workbench" direction="vertical" size={16} style={{ width: '100%' }}>
      <div className="graph-asset-stage">
        <aside className="graph-asset-filter-panel">
          <Typography.Text strong>图谱筛选</Typography.Text>
          <Input.Search allowClear placeholder="搜索节点、关系或任务" value={search} onChange={(event) => setSearch(event.target.value)} onSearch={loadGraphAssets} />
          <Select allowClear placeholder="实体类型" value={entityType} options={entityTypeOptions} onChange={setEntityType} />
          <Select allowClear placeholder="发布状态" value={publishStatus} onChange={setPublishStatus} options={[{ value: 'published', label: 'published' }, { value: 'draft', label: 'draft' }, { value: 'review', label: 'review' }]} />
          <Select allowClear placeholder="绑定状态" value={bindingStatus} onChange={setBindingStatus} options={[{ value: 'bound', label: '已绑定主数据' }, { value: 'unbound', label: '未绑定' }, { value: 'multi_candidate', label: '多候选待确认' }]} />
          <Button icon={<ReloadOutlined />} loading={loading} onClick={loadGraphAssets}>刷新图谱资产</Button>
          <div className="graph-asset-legend">
            {Array.from(new Set(nodes.map((node) => node.type))).slice(0, 8).map((type) => <span key={type}><i style={{ background: graphTypeColors[type] || graphTypeColors.default }} />{type}</span>)}
          </div>
        </aside>
        <main className="graph-asset-canvas-panel">
          <div className="graph-asset-toolbar">
            <Space wrap><Tag color="processing">后台治理视图</Tag><Tag>{visibleNodes.length} 节点</Tag><Tag>{visibleRelationships.length} 关系</Tag></Space>
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
      <Card className="graph-asset-governance" title="图谱资产治理">
        <Tabs
          items={[
            { key: 'nodes', label: `节点 (${visibleNodes.length})`, children: <GraphNodesTable nodes={visibleNodes} loading={loading} onSelect={(data) => setSelected({ kind: 'node', data })} /> },
            { key: 'relationships', label: `关系 (${visibleRelationships.length})`, children: <GraphRelationshipsTable relationships={visibleRelationships} loading={loading} onSelect={(data) => setSelected({ kind: 'relationship', data })} /> },
            { key: 'evidence', label: `证据 (${evidence.length})`, children: <GraphEvidenceTable evidence={evidence} loading={loading} /> },
            { key: 'quality', label: `质量问题 (${quality?.items?.length ?? 0})`, children: <GraphQualityTable quality={quality} loading={loading} /> },
          ]}
        />
      </Card>
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
                <Typography.Text type="secondary">把文档抽成候选实体、关系、规则和动作，审核后发布到知识图谱中心。</Typography.Text>
              </div>
              <Upload.Dragger accept=".md,.markdown,.txt,.pdf,.xlsx,.xls" maxCount={1} fileList={fileList} beforeUpload={() => false} onChange={({ fileList: next }) => setFileList(next)}>
                <p className="ant-upload-drag-icon"><InboxOutlined /></p>
                <p className="ant-upload-text">选择或拖入文档</p>
                <p className="ant-upload-hint">支持 Markdown、TXT、PDF、Excel。图片/OCR 后续接入。</p>
              </Upload.Dragger>
            </Space>
          </Col>
          <Col xs={24} lg={14}>
            <Form form={form} layout="vertical" initialValues={{ domain: 'manufacturing', prompt_name: 'manufacturing_ontology_v1', model_name: 'mock-chat', permission_scope: 'enterprise', owner_user_id: 'demo-user' }}>
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
                      { value: 'mock-chat', label: '本地 mock-chat' },
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
  const [selectedDocumentId, setSelectedDocumentId] = useState<string>('demo-aps');
  const [draftQuery, setDraftQuery] = useState('从当前文档抽取系统、能力和上下游关系');
  const [chatMessages, setChatMessages] = useState<KnowledgeChatMessage[]>([]);
  const [agentConversationId, setAgentConversationId] = useState<string>();
  const [agentLoading, setAgentLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [mode, setMode] = useState<string | number>('extract');
  const chatThreadRef = useRef<HTMLDivElement | null>(null);

  const fallbackDocuments = useMemo(() => ([
    { id: 'demo-aps', title: '04-APS-高级计划与排程', summary: '企业信息化 / 生产制造 / 计划与排程', updated_at: '2026/04/17' },
    { id: 'demo-mes', title: '03-MES-制造执行系统', summary: '企业信息化 / 车间执行 / 质量追溯', updated_at: '2026/04/12' },
    { id: 'demo-scm', title: '06-SCM-供应链管理', summary: '企业信息化 / 供应协同 / 交付风险', updated_at: '2026/04/09' },
  ]), []);

  const visibleDocuments = documents.length ? documents : fallbackDocuments;
  const selectedDocument = visibleDocuments.find((item: any) => (item.id ?? item.document_id) === selectedDocumentId) ?? visibleDocuments[0];
  const selectedTitle = (selectedDocument as any)?.title ?? (selectedDocument as any)?.document_title ?? (selectedDocument as any)?.file_name ?? '04-APS-高级计划与排程';
  const selectedSummary = (selectedDocument as any)?.summary ?? '企业信息化 / 生产制造 / 计划与排程';
  const selectedUpdatedAt = (selectedDocument as any)?.updated_at ?? '2026/04/17';

  const extractionEntities = [
    { name: 'APS', type: '系统', confidence: 96, evidence: '系统定位' },
    { name: '生产排程', type: '能力', confidence: 92, evidence: '核心功能' },
    { name: '物料计划', type: '能力', confidence: 88, evidence: '核心功能' },
    { name: 'ERP', type: '上游系统', confidence: 91, evidence: '与 ERP/MES 的关系' },
    { name: 'MES', type: '下游系统', confidence: 93, evidence: '与 ERP/MES 的关系' },
  ];

  const extractionRelations = [
    ['ERP', '提供长期计划', 'APS'],
    ['APS', '优化短期排程', 'MES'],
    ['APS', '约束计算', '生产排程'],
  ];

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
        listKnowledgeDocuments(),
        listKnowledgeCards(),
        getKnowledgeOcrPipeline().catch(() => null),
      ]);
      const nextDocuments = documentRes.data?.data ?? [];
      setSpaces(spaceRes.data?.data ?? []);
      setSources(sourceRes.data?.data ?? []);
      setDocuments(nextDocuments);
      setCards(cardRes.data?.data ?? []);
      setSelectedDocumentId((prev) => prev ?? nextDocuments[0]?.id ?? nextDocuments[0]?.document_id ?? 'demo-aps');
    } catch {
      setSpaces([{ id: 'manufacturing', name: '制造业知识库', description: 'SOP、8D、设备日志和质量记录。' }]);
      setSources([{ id: 'uploaded', name: '上传资料', status: 'ready' }]);
      setDocuments([]);
      setCards([]);
      setSelectedDocumentId((prev) => prev ?? 'demo-aps');
    }
  };

  useEffect(() => {
    loadKnowledge();
  }, []);

  useEffect(() => {
    if (!selectedDocumentId || selectedDocumentId.startsWith('demo-')) {
      setChunks([]);
      return;
    }
    listKnowledgeChunks(selectedDocumentId)
      .then((res) => setChunks(res.data?.data ?? []))
      .catch(() => setChunks([]));
  }, [selectedDocumentId]);

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

  const handleUpload = async (options: any) => {
    setUploading(true);
    try {
      await uploadKnowledgeAsset(options.file, { permission_scope: 'enterprise', owner_user_id: 'demo-user' });
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

  return (
    <div className="knowledge-center">
      <div className="knowledge-workbench unified-knowledge-workbench">
        <aside className="knowledge-left-panel">
          <Card className="knowledge-panel-card knowledge-library-card" title="知识库目录" extra={<Button size="small" icon={<ReloadOutlined />} onClick={loadKnowledge}>刷新</Button>}>
            <div className="knowledge-tree-tools">
              <Input placeholder="搜索文档、标签或实体" prefix={<FileSearchOutlined />} />
              <Upload.Dragger className="knowledge-upload-dragger" customRequest={handleUpload} showUploadList={false} disabled={uploading}>
                <p className="ant-upload-drag-icon"><InboxOutlined /></p>
                <p className="ant-upload-text">上传知识资料</p>
                <p className="ant-upload-hint">统一入库，右侧继续抽取和发布</p>
              </Upload.Dragger>
              <Space wrap size={6}>
                <Tag color="processing">已索引</Tag>
                <Tag color="warning">待抽取</Tag>
                <Tag color="success">已发布</Tag>
              </Space>
            </div>
            <div className="knowledge-directory-tree">
              <div className="knowledge-tree-group">
                <div className="knowledge-tree-folder"><FileSearchOutlined /> 企业信息化 <Tag>{visibleDocuments.length}</Tag></div>
                {visibleDocuments.map((item: any, index) => {
                  const docId = item.id ?? item.document_id;
                  const active = docId === selectedDocumentId;
                  return (
                    <button className={active ? 'knowledge-document-item active' : 'knowledge-document-item'} key={docId} onClick={() => setSelectedDocumentId(docId)}>
                      <strong>{item.title ?? item.document_title ?? item.file_name}</strong>
                      <small>{item.summary ?? item.updated_at ?? ['已索引', '待抽取', '已发布'][index % 3]}</small>
                    </button>
                  );
                })}
              </div>
              <div className="knowledge-source-docs">
                {(spaces.length ? spaces : [{ id: 'default', name: '制造业知识库' }]).slice(0, 3).map((item) => <Tag key={item.id}>{item.name}</Tag>)}
                {(sources.length ? sources : [{ id: 'upload', name: '上传资料' }]).slice(0, 3).map((item) => <Tag key={item.id}>{item.name}</Tag>)}
              </div>
            </div>
          </Card>
        </aside>

        <main className="knowledge-main-panel">
          <Card
            className="knowledge-document-card"
            title={<Space wrap><span>{selectedTitle}</span><Tag color="blue">企业信息化</Tag><Tag color="purple">APS</Tag><Tag>排程</Tag></Space>}
            extra={<Segmented value={mode} onChange={setMode} options={[{ label: '阅读', value: 'read' }, { label: '问答', value: 'chat' }, { label: '抽取', value: 'extract' }, { label: '发布', value: 'publish' }]} />}
          >
            <div className="knowledge-document-head">
              <div>
                <Typography.Text type="secondary">{selectedSummary}</Typography.Text>
                <div className="knowledge-note-properties">
                  <div><span>created</span><strong>{selectedUpdatedAt}</strong></div>
                  <div><span>status</span><strong>待审核 / 已索引</strong></div>
                </div>
              </div>
              <Button type="primary" icon={<RobotOutlined />} onClick={() => setMode('extract')}>抽取当前文档</Button>
            </div>
            <article className="knowledge-note-content">
              <Typography.Title level={3}>系统定位</Typography.Title>
              <table className="knowledge-doc-table">
                <tbody>
                  <tr><th>维度</th><th>关系</th></tr>
                  <tr><td>架构层级</td><td>Ring 2：计划与执行</td></tr>
                  <tr><td>上级系统</td><td><span className="knowledge-highlight">ERP</span> 企业资源计划</td></tr>
                  <tr><td>下游去向</td><td><span className="knowledge-highlight">MES</span> 制造执行系统</td></tr>
                </tbody>
              </table>
              <Typography.Title level={4}>APS（高级计划与排程）</Typography.Title>
              <Typography.Paragraph>
                <span className="knowledge-highlight strong">APS</span> 基于约束条件进行高级生产计划和排程优化，把长期计划转换为可执行的短期排程。
              </Typography.Paragraph>
              <Typography.Title level={4}>核心功能</Typography.Title>
              <ul>
                <li><span className="knowledge-highlight">需求计划</span>：需求预测和订单管理</li>
                <li><span className="knowledge-highlight">生产排程</span>：机器、人员、模具等多约束排程</li>
                <li><span className="knowledge-highlight">物料计划</span>：考虑物料可用性的排产</li>
                <li>What-If 模拟：插单、急单影响模拟</li>
              </ul>
              <Typography.Title level={4}>与 ERP/MES 的关系</Typography.Title>
              <div className="knowledge-flow-box">
                <strong>ERP</strong><span>长期计划</span><strong>APS</strong><span>短期排程优化</span><strong>MES</strong>
              </div>
              {chunks.length > 0 && (
                <>
                  <Typography.Title level={4}>相关片段</Typography.Title>
                  {chunks.slice(0, 2).map((item) => <Card className="knowledge-chunk-card" size="small" key={item.id}><Typography.Text>{item.chunk_text}</Typography.Text></Card>)}
                </>
              )}
            </article>
          </Card>
        </main>

        <aside className="knowledge-rag-panel">
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
                  label: '抽取结果',
                  children: (
                    <Space className="knowledge-extract-stack" direction="vertical" size={10} style={{ width: '100%' }}>
                      <Alert type="success" showIcon message="已生成候选实体 5 个、候选关系 3 条、证据段落 8 处" />
                      <div className="knowledge-result-list">
                        {extractionEntities.map((item) => (
                          <Card className="knowledge-result-card" size="small" key={item.name}>
                            <div className="knowledge-chunk-head"><strong>{item.name}</strong><Tag color="blue">{item.type}</Tag></div>
                            <Progress percent={item.confidence} size="small" />
                            <Typography.Text type="secondary">证据：{item.evidence}</Typography.Text>
                          </Card>
                        ))}
                      </div>
                    </Space>
                  ),
                },
                {
                  key: 'publish',
                  label: '发布清单',
                  children: (
                    <div className="knowledge-publish-stack">
                      <div className="knowledge-publish-list">
                        {extractionRelations.map(([source, relation, target]) => (
                          <div className="knowledge-publish-row" key={`${source}-${target}`}>
                            <strong>{source}</strong><span>{relation}</span><strong>{target}</strong>
                          </div>
                        ))}
                      </div>
                      <Button className="knowledge-publish-action" type="primary" block icon={<NodeIndexOutlined />}>发布到知识图谱</Button>
                    </div>
                  ),
                },
                {
                  key: 'meta',
                  label: '属性',
                  children: (
                    <div className="knowledge-meta-stack">
                      <div className="knowledge-note-properties">
                      <div><span>知识空间</span><strong>企业信息化</strong></div>
                      <div><span>自动领域</span><strong>生产制造 / 计划排程</strong></div>
                      <div><span>索引状态</span><strong>已索引</strong></div>
                      <div><span>知识卡片</span><strong>{cards.length || 2}</strong></div>
                      </div>
                    </div>
                  ),
                },
              ]}
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
      setSpaces([{ id: 'manufacturing', name: '制造业知识库', description: 'SOP、8D、设备日志和质量记录。' }]);
      setSources([{ id: 'uploaded', name: '上传资料', status: 'ready' }]);
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
      await uploadKnowledgeAsset(options.file, { permission_scope: 'enterprise', owner_user_id: 'demo-user' });
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
