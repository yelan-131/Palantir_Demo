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
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  List,
  Progress,
  Row,
  Segmented,
  Select,
  Space,
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
  listKnowledgeSources,
  listKnowledgeSpaces,
  listSemanticDataAssets,
  listSemanticOntologyObjects,
  listSemanticOntologyRelations,
  searchKnowledge,
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

export default function SemanticAssetCenter() {
  const [assets, setAssets] = useState<DataAsset[]>(fallbackAssets);
  const [objects, setObjects] = useState<OntologyObject[]>(fallbackObjects);
  const [relations, setRelations] = useState<OntologyRelation[]>(fallbackRelations);
  const [selectedAssetId, setSelectedAssetId] = useState<number>(fallbackAssets[0].id);
  const [selectedObjectId, setSelectedObjectId] = useState<string>(fallbackObjects[0].id);
  const [loading, setLoading] = useState(false);

  const selectedAsset = useMemo(() => assets.find((item) => item.id === selectedAssetId) ?? assets[0], [assets, selectedAssetId]);
  const selectedObject = useMemo(() => objects.find((item) => item.id === selectedObjectId) ?? objects[0], [objects, selectedObjectId]);
  const objectRelations = relations.filter((item) => item.source === selectedObject?.id || item.target === selectedObject?.id);

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

  const dataAssetView = (
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={7}>
        <Card className="semantic-side-card" title="数据资产" extra={<Tag>{assets.length}</Tag>}>
          <List
            loading={loading}
            dataSource={assets}
            renderItem={(item) => (
              <List.Item className={item.id === selectedAsset?.id ? 'semantic-list-item active' : 'semantic-list-item'} onClick={() => setSelectedAssetId(item.id)}>
                <List.Item.Meta avatar={<DatabaseOutlined />} title={<Space><span>{item.name}</span><Tag color="success">{item.status}</Tag></Space>} description={`${item.type} / ${item.owner} / ${item.freshness}`} />
              </List.Item>
            )}
          />
        </Card>
      </Col>
      <Col xs={24} lg={17}>
        <Card title={selectedAsset?.name ?? '数据资产'} extra={<Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>}>
          <Table
            rowKey="id"
            dataSource={selectedAsset?.tables ?? []}
            pagination={false}
            columns={[
              { title: '数据表/数据集', dataIndex: 'label', render: (text, record: any) => <Space direction="vertical" size={0}><strong>{text}</strong><Typography.Text type="secondary">{record.name}</Typography.Text></Space> },
              { title: '记录数', dataIndex: 'rows', width: 110 },
              { title: '质量分', dataIndex: 'quality_score', width: 110, render: (score: number) => <Tag color={score >= 95 ? 'success' : 'warning'}>{score}</Tag> },
              { title: '字段', dataIndex: 'fields', render: (fields: any[]) => <Space wrap>{fields.slice(0, 5).map((field) => <Tag key={field.name}>{field.label}</Tag>)}</Space> },
            ]}
          />
        </Card>
      </Col>
    </Row>
  );

  const ontologyView = (
    <Row gutter={[16, 16]}>
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
          { key: 'extraction', label: '知识抽取工作台', children: <KnowledgeExtractionWorkbench /> },
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
