import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Form,
  Input,
  message,
  Progress,
  Row,
  Select,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from 'antd';
import type { UploadFile } from 'antd';
import {
  ApartmentOutlined,
  AppstoreOutlined,
  CheckCircleOutlined,
  CloudUploadOutlined,
  DatabaseOutlined,
  DownloadOutlined,
  FileSearchOutlined,
  FileTextOutlined,
  SearchOutlined,
  ShopOutlined,
  ToolOutlined,
  UserOutlined,
} from '@ant-design/icons';
import {
  approveKnowledgeExtractionJob,
  commitKnowledgeExtractionJobToGraph,
  createKnowledgeExtractionJob,
  exportKnowledgeExtractionJob,
  getEntityType,
  listEntityInstances,
  listEntityTypes,
  listRelationTypes,
} from '@/services/api';

const { Title, Text, Paragraph } = Typography;

interface EntityProperty {
  name: string;
  display_name?: string;
  label?: string;
  data_type?: string;
  type?: string;
  required?: boolean;
  indexed?: boolean;
}

interface EntityType {
  name?: string;
  type?: string;
  label?: string;
  display_name?: string;
  description?: string;
  icon?: string;
  properties?: EntityProperty[];
  outgoing_relations?: string[];
}

interface EntityInstance {
  id: number;
  [key: string]: unknown;
}

interface RelationType {
  name?: string;
  type?: string;
  source_type?: string;
  target_type?: string;
  description?: string;
  label?: string;
}

interface ExtractionEntity {
  candidate_id: string;
  name: string;
  entity_type: string;
  description?: string;
  confidence: number;
  source_location?: string;
  status?: string;
}

interface ExtractionRelation {
  candidate_id: string;
  source_name: string;
  source_type: string;
  target_name: string;
  target_type: string;
  relation_type: string;
  confidence: number;
  source_location?: string;
  status?: string;
}

interface QualityItem {
  severity: 'FATAL' | 'ERROR' | 'WARNING' | 'INFO';
  code: string;
  message: string;
  target?: string;
}

interface ExtractionJob {
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
  approved_result?: ExtractionJob['result'] | null;
  quality_report: {
    blocking: boolean;
    counts: Record<string, number>;
    items: QualityItem[];
  };
}

const ICON_MAP: Record<string, React.ReactNode> = {
  factory: <ShopOutlined />,
  workshop: <AppstoreOutlined />,
  line: <ApartmentOutlined />,
  equipment: <ToolOutlined />,
  product: <AppstoreOutlined />,
  material: <DatabaseOutlined />,
  order: <FileTextOutlined />,
  worker: <UserOutlined />,
  supplier: <ShopOutlined />,
  default: <DatabaseOutlined />,
};

const severityColors: Record<string, string> = {
  FATAL: 'red',
  ERROR: 'volcano',
  WARNING: 'gold',
  INFO: 'blue',
};

function confidencePercent(value: number) {
  return Math.round((Number(value) || 0) * 100);
}

export default function OntologyPage() {
  const [entityTypes, setEntityTypes] = useState<EntityType[]>([]);
  const [relationTypes, setRelationTypes] = useState<RelationType[]>([]);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [entityDetail, setEntityDetail] = useState<EntityType | null>(null);
  const [instances, setInstances] = useState<EntityInstance[]>([]);
  const [loading, setLoading] = useState(false);
  const [instanceLoading, setInstanceLoading] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [job, setJob] = useState<ExtractionJob | null>(null);
  const [form] = Form.useForm();

  const fetchEntityTypes = useCallback(async () => {
    setLoading(true);
    try {
      const [entitiesRes, relationsRes] = await Promise.all([listEntityTypes(), listRelationTypes()]);
      setEntityTypes(entitiesRes.data?.data ?? entitiesRes.data?.items ?? []);
      setRelationTypes(relationsRes.data?.data ?? []);
    } catch {
      message.warning('本体数据暂时不可用');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEntityTypes();
  }, [fetchEntityTypes]);

  const handleSelectEntity = async (typeName: string) => {
    setSelectedType(typeName);
    setInstanceLoading(true);
    try {
      const [detailRes, instancesRes] = await Promise.all([
        getEntityType(typeName),
        listEntityInstances(typeName, { page_size: 100 }),
      ]);
      setEntityDetail(detailRes.data ?? null);
      setInstances(instancesRes.data?.data ?? []);
    } catch {
      setEntityDetail(null);
      setInstances([]);
    } finally {
      setInstanceLoading(false);
    }
  };

  const filteredEntities = entityTypes.filter((et) => {
    const key = et.name ?? et.type ?? '';
    const label = et.display_name ?? et.label ?? '';
    return key.toLowerCase().includes(searchText.toLowerCase()) || label.includes(searchText);
  });

  const filteredRelations = selectedType
    ? relationTypes.filter((r) => r.source_type === selectedType || r.target_type === selectedType || r.type)
    : relationTypes;

  const instanceColumns = useMemo(() => {
    const properties = entityDetail?.properties ?? [];
    return [
      { title: 'ID', dataIndex: 'id', key: 'id', width: 70 },
      ...properties
        .filter((prop) => prop.name !== 'id')
        .slice(0, 8)
        .map((prop) => ({
          title: prop.display_name ?? prop.label ?? prop.name,
          dataIndex: prop.name,
          key: prop.name,
          ellipsis: true as const,
          width: 150,
          render: (value: unknown) => {
            if (value === null || value === undefined || value === '') return <Text type="secondary">-</Text>;
            if (typeof value === 'boolean') return value ? <Tag color="green">是</Tag> : <Tag>否</Tag>;
            if (typeof value === 'object') return <Text code>{JSON.stringify(value)}</Text>;
            return String(value);
          },
        })),
    ];
  }, [entityDetail]);

  const runExtraction = async () => {
    const file = fileList[0]?.originFileObj;
    if (!file) {
      message.warning('请先选择一个文档');
      return;
    }
    const values = await form.validateFields();
    setExtracting(true);
    try {
      const response = await createKnowledgeExtractionJob(file, values);
      setJob(response.data?.data?.job);
      message.success('抽取任务已完成，等待人工审核');
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
      message.success('已提交到图谱与对象链接');
    } catch (error: any) {
      message.error(error?.response?.data?.detail ?? '提交图谱失败');
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

  const browserTab = (
    <Row gutter={16} style={{ minHeight: 620 }}>
      <Col span={6}>
        <Card title="实体类型" size="small" extra={<Text type="secondary">{entityTypes.length} 种</Text>}>
          <Input
            placeholder="搜索实体类型"
            prefix={<SearchOutlined />}
            size="small"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            style={{ marginBottom: 12 }}
            allowClear
          />
          <Spin spinning={loading}>
            <div style={{ maxHeight: 540, overflowY: 'auto' }}>
              {filteredEntities.length === 0 && !loading ? (
                <Empty description="暂无实体类型" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : (
                filteredEntities.map((entityType) => {
                  const key = entityType.name ?? entityType.type ?? '';
                  const selected = selectedType === key;
                  const iconKey = (entityType.icon ?? 'default').toLowerCase();
                  return (
                    <Tooltip key={key} title={entityType.description ?? entityType.label} placement="right">
                      <div
                        onClick={() => handleSelectEntity(key)}
                        style={{
                          padding: '8px 12px',
                          marginBottom: 4,
                          borderRadius: 6,
                          cursor: 'pointer',
                          background: selected ? '#e6f4ff' : 'transparent',
                          borderLeft: selected ? '3px solid #1677ff' : '3px solid transparent',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                        }}
                      >
                        <span style={{ fontSize: 16, color: selected ? '#1677ff' : '#8c8c8c' }}>
                          {ICON_MAP[iconKey] ?? ICON_MAP.default}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: selected ? 600 : 400 }}>{entityType.display_name ?? entityType.label ?? key}</div>
                          <Text type="secondary" style={{ fontSize: 11 }}>{key}</Text>
                        </div>
                      </div>
                    </Tooltip>
                  );
                })
              )}
            </div>
          </Spin>
        </Card>
      </Col>
      <Col span={18}>
        {!selectedType ? (
          <Card style={{ minHeight: 620, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Empty description="请在左侧选择一个实体类型" />
          </Card>
        ) : (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Card
              size="small"
              title={(
                <Space>
                  {ICON_MAP[(entityDetail?.icon ?? 'default').toLowerCase()] ?? ICON_MAP.default}
                  <span>{entityDetail?.display_name ?? entityDetail?.label ?? selectedType}</span>
                  <Tag>{selectedType}</Tag>
                </Space>
              )}
            >
              <Descriptions size="small" column={1} bordered>
                <Descriptions.Item label="名称">{entityDetail?.display_name ?? entityDetail?.label ?? selectedType}</Descriptions.Item>
                <Descriptions.Item label="说明">{entityDetail?.description ?? '-'}</Descriptions.Item>
              </Descriptions>
              <Title level={5} style={{ marginTop: 16 }}>属性定义</Title>
              <Table
                size="small"
                pagination={false}
                rowKey="name"
                columns={[
                  { title: '属性名', dataIndex: 'name', key: 'name', width: 150 },
                  { title: '显示名', key: 'label', width: 140, render: (_, record: EntityProperty) => record.display_name ?? record.label ?? '-' },
                  { title: '类型', key: 'type', width: 110, render: (_, record: EntityProperty) => <Tag color="blue">{record.data_type ?? record.type ?? 'string'}</Tag> },
                  { title: '必填', dataIndex: 'required', key: 'required', width: 80, render: (value: boolean) => value ? <Tag color="red">必填</Tag> : <Tag>可选</Tag> },
                  { title: '索引', dataIndex: 'indexed', key: 'indexed', width: 80, render: (value: boolean) => value ? <Tag color="geekblue">已索引</Tag> : <Tag>未索引</Tag> },
                ]}
                dataSource={entityDetail?.properties ?? []}
              />
              <Title level={5} style={{ marginTop: 16 }}>关联关系</Title>
              <Table
                size="small"
                pagination={false}
                rowKey={(record) => record.name ?? record.type ?? `${record.source_type}-${record.target_type}`}
                columns={[
                  { title: '关系', key: 'name', width: 150, render: (_, record: RelationType) => record.name ?? record.type ?? record.label },
                  { title: '来源', dataIndex: 'source_type', key: 'source_type', width: 130 },
                  { title: '目标', dataIndex: 'target_type', key: 'target_type', width: 130 },
                  { title: '说明', dataIndex: 'description', key: 'description' },
                ]}
                dataSource={filteredRelations}
                locale={{ emptyText: '暂无关联关系' }}
              />
            </Card>
            <Card title={`实例列表 (${instances.length})`} size="small" extra={<Text type="secondary">展示前 100 条</Text>}>
              <Table
                size="small"
                rowKey="id"
                loading={instanceLoading}
                columns={instanceColumns}
                dataSource={instances}
                pagination={{ pageSize: 10, showTotal: (total) => `共 ${total} 条` }}
                scroll={{ x: 'max-content' }}
              />
            </Card>
          </Space>
        )}
      </Col>
    </Row>
  );

  const extractionTab = (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card>
        <Row gutter={24}>
          <Col span={10}>
            <Title level={4}>知识抽取工作台</Title>
            <Paragraph type="secondary">
              上传制造业文档，抽取候选实体、关系、规则和动作。结果需要人工审核后才能写入正式图谱。
            </Paragraph>
            <Upload.Dragger
              accept=".md,.markdown,.txt,.pdf,.xlsx,.xls"
              maxCount={1}
              fileList={fileList}
              beforeUpload={() => false}
              onChange={({ fileList: next }) => setFileList(next)}
            >
              <p className="ant-upload-drag-icon"><CloudUploadOutlined /></p>
              <p className="ant-upload-text">选择或拖入文档</p>
              <p className="ant-upload-hint">支持 Markdown、TXT、PDF、Excel。扫描件和图片保留到 OCR 阶段。</p>
            </Upload.Dragger>
          </Col>
          <Col span={14}>
            <Form
              form={form}
              layout="vertical"
              initialValues={{
                domain: 'manufacturing',
                prompt_name: 'manufacturing_ontology_v1',
                model_name: 'mock-chat',
                permission_scope: 'enterprise',
                owner_user_id: 'demo-user',
              }}
            >
              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item label="业务领域" name="domain" rules={[{ required: true }]}>
                    <Select
                      options={[
                        { value: 'manufacturing', label: '制造业' },
                        { value: 'quality', label: '质量管理' },
                        { value: 'supply_chain', label: '供应链' },
                        { value: 'maintenance', label: '设备维护' },
                      ]}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="Prompt 模板" name="prompt_name" rules={[{ required: true }]}>
                    <Select
                      options={[
                        { value: 'manufacturing_ontology_v1', label: '制造业本体抽取 v1' },
                        { value: 'quality_event_v1', label: '质量事件抽取 v1' },
                        { value: 'supplier_8d_v1', label: '供应商 8D 抽取 v1' },
                      ]}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="模型" name="model_name" rules={[{ required: true }]}>
                    <Select
                      options={[
                        { value: 'mock-chat', label: '本地 mock-chat' },
                        { value: 'glm-4-flash', label: 'GLM-4-Flash' },
                        { value: 'qwen-plus', label: 'Qwen Plus' },
                        { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
                      ]}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="知识范围" name="permission_scope" rules={[{ required: true }]}>
                    <Select
                      options={[
                        { value: 'enterprise', label: '企业' },
                        { value: 'department', label: '部门' },
                        { value: 'team-quality', label: '质量团队' },
                        { value: 'personal', label: '个人' },
                      ]}
                    />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item label="上传人" name="owner_user_id">
                <Input />
              </Form.Item>
              <Button
                type="primary"
                icon={<FileSearchOutlined />}
                loading={extracting}
                onClick={runExtraction}
              >
                开始抽取
              </Button>
            </Form>
          </Col>
        </Row>
      </Card>

      {!job ? (
        <Card>
          <Empty description="暂无抽取结果" />
        </Card>
      ) : (
        <>
          <Card
            title={(
              <Space>
                <span>抽取任务</span>
                <Tag color={job.status === 'committed' ? 'green' : job.status === 'blocked' ? 'red' : 'blue'}>{job.status}</Tag>
                <Text code>{job.job_id}</Text>
              </Space>
            )}
            extra={(
              <Space>
                <Button icon={<CheckCircleOutlined />} onClick={approveJob}>审核确认</Button>
                <Button type="primary" loading={committing} disabled={job.quality_report.blocking} onClick={commitJob}>
                  写入图谱
                </Button>
                <Button icon={<DownloadOutlined />} onClick={() => exportJob('json')}>JSON</Button>
                <Button icon={<DownloadOutlined />} onClick={() => exportJob('csv')}>CSV</Button>
                <Button icon={<DownloadOutlined />} onClick={() => exportJob('yaml')}>YAML</Button>
                <Button icon={<DownloadOutlined />} onClick={() => exportJob('turtle')}>RDF</Button>
              </Space>
            )}
          >
            {job.quality_report.blocking ? (
              <Alert type="error" showIcon message="存在 FATAL 问题，修复前不能写入图谱" style={{ marginBottom: 12 }} />
            ) : (
              <Alert type="success" showIcon message="抽取结果可审核并写入图谱" style={{ marginBottom: 12 }} />
            )}
            <Row gutter={16}>
              {['FATAL', 'ERROR', 'WARNING', 'INFO'].map((severity) => (
                <Col span={6} key={severity}>
                  <Card size="small">
                    <Space>
                      <Tag color={severityColors[severity]}>{severity}</Tag>
                      <Text strong>{job.quality_report.counts?.[severity] ?? 0}</Text>
                    </Space>
                  </Card>
                </Col>
              ))}
            </Row>
          </Card>

          <Row gutter={16}>
            <Col span={14}>
              <Card title={`候选实体 (${job.result.entities.length})`} size="small">
                <Table
                  size="small"
                  rowKey="candidate_id"
                  dataSource={job.result.entities}
                  pagination={{ pageSize: 6 }}
                  columns={[
                    { title: '名称', dataIndex: 'name', key: 'name', ellipsis: true },
                    { title: '类型', dataIndex: 'entity_type', key: 'entity_type', width: 130, render: (value) => <Tag color="blue">{value}</Tag> },
                    {
                      title: '置信度',
                      dataIndex: 'confidence',
                      key: 'confidence',
                      width: 140,
                      render: (value: number) => <Progress size="small" percent={confidencePercent(value)} />,
                    },
                    { title: '证据', dataIndex: 'source_location', key: 'source_location', width: 110 },
                  ]}
                />
              </Card>
            </Col>
            <Col span={10}>
              <Card title={`候选关系 (${job.result.relations.length})`} size="small">
                <Table
                  size="small"
                  rowKey="candidate_id"
                  dataSource={job.result.relations}
                  pagination={{ pageSize: 6 }}
                  columns={[
                    { title: '来源', dataIndex: 'source_name', key: 'source_name', ellipsis: true },
                    { title: '关系', dataIndex: 'relation_type', key: 'relation_type', width: 110, render: (value) => <Tag>{value}</Tag> },
                    { title: '目标', dataIndex: 'target_name', key: 'target_name', ellipsis: true },
                  ]}
                />
              </Card>
            </Col>
          </Row>

          <Card title="质量报告" size="small">
            <Table
              size="small"
              rowKey={(record) => `${record.severity}-${record.code}-${record.target}`}
              dataSource={job.quality_report.items}
              pagination={false}
              columns={[
                { title: '级别', dataIndex: 'severity', key: 'severity', width: 110, render: (value) => <Tag color={severityColors[value]}>{value}</Tag> },
                { title: '代码', dataIndex: 'code', key: 'code', width: 220 },
                { title: '对象', dataIndex: 'target', key: 'target', width: 220 },
                { title: '说明', dataIndex: 'message', key: 'message' },
              ]}
            />
          </Card>
        </>
      )}
    </Space>
  );

  return (
    <div>
      <Title level={4}>本体建模</Title>
      <Tabs
        defaultActiveKey="browser"
        items={[
          { key: 'browser', label: '本体浏览', children: browserTab },
          { key: 'extraction', label: '知识抽取工作台', children: extractionTab },
        ]}
      />
    </div>
  );
}
