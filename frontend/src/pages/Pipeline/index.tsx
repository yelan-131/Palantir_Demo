import React, { useState, useEffect, useCallback } from 'react';
import {
  Card,
  Table,
  Button,
  Modal,
  Form,
  Input,
  Select,
  Tag,
  Space,
  Row,
  Col,
  Typography,
  Statistic,
  message,
  Popconfirm,
  Steps,
  Descriptions,
} from 'antd';
import {
  PlusOutlined,
  ReloadOutlined,
  PlayCircleOutlined,
  BranchesOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  SyncOutlined,
  EyeOutlined,
} from '@ant-design/icons';
import {
  listPipelines,
  createPipeline,
  getPipeline,
  runPipeline,
  listPipelineRuns,
} from '@/services/api';
import { formatServerDateTime } from '@/utils/dateTime';

const { Title, Text } = Typography;
const { Option } = Select;
const { TextArea } = Input;

interface Pipeline {
  id: number;
  name: string;
  description: string;
  source_type: string;
  source_id: number;
  target_type: string;
  target_id: number;
  schedule: string;
  status: string;
  steps: PipelineStep[];
  created_at: string;
  updated_at: string;
}

interface PipelineStep {
  name: string;
  type: string;
  config: Record<string, unknown>;
}

interface PipelineRun {
  id: number;
  pipeline_id: number;
  status: string;
  started_at: string;
  finished_at: string | null;
  duration_seconds: number | null;
  records_processed: number;
  error_message: string | null;
}

const STATUS_CONFIG: Record<string, { color: string; text: string; icon: React.ReactNode }> = {
  active: { color: 'success', text: '活跃', icon: <CheckCircleOutlined /> },
  inactive: { color: 'default', text: '未激活', icon: <ClockCircleOutlined /> },
  error: { color: 'error', text: '异常', icon: <CloseCircleOutlined /> },
  running: { color: 'processing', text: '运行中', icon: <SyncOutlined spin /> },
};

const RUN_STATUS_CONFIG: Record<string, { color: string; text: string }> = {
  success: { color: 'success', text: '成功' },
  running: { color: 'processing', text: '运行中' },
  failed: { color: 'error', text: '失败' },
  pending: { color: 'default', text: '等待中' },
  cancelled: { color: 'warning', text: '已取消' },
};

const STEP_TYPES = [
  { value: 'extract', label: '数据抽取 (Extract)' },
  { value: 'transform', label: '数据转换 (Transform)' },
  { value: 'validate', label: '数据校验 (Validate)' },
  { value: 'load', label: '数据加载 (Load)' },
  { value: 'filter', label: '数据过滤 (Filter)' },
  { value: 'aggregate', label: '数据聚合 (Aggregate)' },
  { value: 'enrich', label: '数据增强 (Enrich)' },
];

const SCHEDULE_OPTIONS = [
  { value: 'manual', label: '手动触发' },
  { value: '*/5 * * * *', label: '每 5 分钟' },
  { value: '*/15 * * * *', label: '每 15 分钟' },
  { value: '*/30 * * * *', label: '每 30 分钟' },
  { value: '0 * * * *', label: '每小时' },
  { value: '0 */6 * * *', label: '每 6 小时' },
  { value: '0 0 * * *', label: '每天零点' },
  { value: '0 8 * * *', label: '每天早 8 点' },
];

export default function PipelinePage() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [runsLoading, setRunsLoading] = useState(false);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [selectedPipeline, setSelectedPipeline] = useState<Pipeline | null>(null);
  const [pipelineRunsData, setPipelineRunsData] = useState<PipelineRun[]>([]);
  const [form] = Form.useForm();

  const fetchPipelines = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listPipelines();
      setPipelines(Array.isArray(res.data) ? res.data : res.data?.data ?? res.data?.items ?? []);
    } catch {
      message.error('加载管线列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPipelines();
  }, [fetchPipelines]);

  const handleCreate = async (values: Record<string, unknown>) => {
    try {
      const payload = {
        ...values,
        steps: values.steps
          ? (values.steps as string[]).map((name, i) => ({
              name,
              type: name,
              config: {},
              order: i,
            }))
          : [],
      };
      await createPipeline(payload);
      message.success('管线创建成功');
      setCreateModalVisible(false);
      form.resetFields();
      fetchPipelines();
    } catch {
      message.error('创建管线失败');
    }
  };

  const handleRun = async (id: number) => {
    try {
      await runPipeline(id);
      message.success('管线已触发运行');
      fetchPipelines();
    } catch {
      message.error('运行管线失败');
    }
  };

  const handleViewDetail = async (record: Pipeline) => {
    setSelectedPipeline(record);
    setDetailModalVisible(true);
    setRunsLoading(true);
    try {
      const res = await listPipelineRuns(record.id);
      setPipelineRunsData(Array.isArray(res.data) ? res.data : res.data?.data ?? res.data?.items ?? []);
    } catch {
      setPipelineRunsData([]);
    } finally {
      setRunsLoading(false);
    }
  };

  const activeCount = pipelines.filter((p) => p.status === 'active').length;
  const runningCount = pipelines.filter((p) => p.status === 'running').length;
  const errorCount = pipelines.filter((p) => p.status === 'error').length;

  const pipelineColumns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 50 },
    {
      title: '管线名称',
      dataIndex: 'name',
      key: 'name',
      width: 180,
      render: (text: string) => <Text strong>{text}</Text>,
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      render: (text: string) => formatServerDateTime(text),
    },
    {
      title: '调度',
      dataIndex: 'schedule',
      key: 'schedule',
      width: 120,
      render: (schedule: string) => {
        const opt = SCHEDULE_OPTIONS.find((o) => o.value === schedule);
        return <Tag>{opt?.label ?? schedule ?? '手动'}</Tag>;
      },
    },
    {
      title: '步骤数',
      key: 'step_count',
      width: 80,
      render: (_: unknown, record: Pipeline) => record.steps?.length ?? 0,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => {
        const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.inactive;
        return (
          <Tag color={cfg.color} icon={cfg.icon}>
            {cfg.text}
          </Tag>
        );
      },
    },
    {
      title: '更新时间',
      dataIndex: 'updated_at',
      key: 'updated_at',
      width: 170,
      render: (text: string) => text ?? '-',
    },
    {
      title: '操作',
      key: 'actions',
      width: 200,
      render: (_: unknown, record: Pipeline) => (
        <Space size="small">
          <Popconfirm
            title="确定要运行此管线吗？"
            onConfirm={() => handleRun(record.id)}
            okText="运行"
            cancelText="取消"
          >
            <Button type="link" size="small" icon={<PlayCircleOutlined />} disabled={record.status === 'running'}>
              运行
            </Button>
          </Popconfirm>
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => handleViewDetail(record)}>
            详情
          </Button>
        </Space>
      ),
    },
  ];

  const runColumns = [
    { title: '运行 ID', dataIndex: 'id', key: 'id', width: 70 },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (status: string) => {
        const cfg = RUN_STATUS_CONFIG[status] ?? RUN_STATUS_CONFIG.pending;
        return <Tag color={cfg.color}>{cfg.text}</Tag>;
      },
    },
    {
      title: '开始时间',
      dataIndex: 'started_at',
      key: 'started_at',
      width: 160,
    },
    {
      title: '结束时间',
      dataIndex: 'finished_at',
      key: 'finished_at',
      width: 160,
      render: (text: string | null) => text ?? '-',
    },
    {
      title: '耗时',
      dataIndex: 'duration_seconds',
      key: 'duration_seconds',
      width: 90,
      render: (val: number | null) => {
        if (val === null) return '-';
        if (val < 60) return `${val}s`;
        const min = Math.floor(val / 60);
        const sec = val % 60;
        return `${min}m ${sec}s`;
      },
    },
    {
      title: '处理记录',
      dataIndex: 'records_processed',
      key: 'records_processed',
      width: 90,
      render: (val: number) => val?.toLocaleString() ?? 0,
    },
    {
      title: '错误信息',
      dataIndex: 'error_message',
      key: 'error_message',
      ellipsis: true,
      render: (text: string | null) =>
        text ? <Text type="danger" style={{ fontSize: 12 }}>{text}</Text> : '-',
    },
  ];

  return (
    <div>
      <Title level={4}>数据管线</Title>

      {/* Stats */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card>
            <Statistic title="管线总数" value={pipelines.length} prefix={<BranchesOutlined />} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="活跃管线"
              value={activeCount}
              valueStyle={{ color: '#52c41a' }}
              prefix={<CheckCircleOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="运行中"
              value={runningCount}
              valueStyle={{ color: '#1677ff' }}
              prefix={<SyncOutlined spin={runningCount > 0} />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="异常"
              value={errorCount}
              valueStyle={{ color: errorCount > 0 ? '#ff4d4f' : '#8c8c8c' }}
              prefix={<CloseCircleOutlined />}
            />
          </Card>
        </Col>
      </Row>

      {/* Pipeline Table */}
      <Card
        title="管线列表"
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={fetchPipelines}>
              刷新
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateModalVisible(true)}>
              新建管线
            </Button>
          </Space>
        }
      >
        <Table
          rowKey="id"
          columns={pipelineColumns}
          dataSource={pipelines}
          loading={loading}
          pagination={{ pageSize: 10, showTotal: (total) => `共 ${total} 条` }}
        />
      </Card>

      {/* Create Modal */}
      <Modal
        title="新建数据管线"
        open={createModalVisible}
        onCancel={() => {
          setCreateModalVisible(false);
          form.resetFields();
        }}
        onOk={() => form.submit()}
        width={620}
      >
        <Form form={form} layout="vertical" onFinish={handleCreate}>
          <Form.Item name="name" label="管线名称" rules={[{ required: true, message: '请输入管线名称' }]}>
            <Input placeholder="例如：MES 数据同步管线" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <TextArea rows={2} placeholder="管线用途说明" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="source_type" label="数据源类型" rules={[{ required: true }]}>
                <Select placeholder="选择类型">
                  <Option value="mysql">MySQL</Option>
                  <Option value="postgresql">PostgreSQL</Option>
                  <Option value="mongodb">MongoDB</Option>
                  <Option value="api">REST API</Option>
                  <Option value="csv">CSV</Option>
                  <Option value="opcua">OPC UA</Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="source_id" label="数据源 ID" rules={[{ required: true }]}>
                <Input type="number" placeholder="关联的数据源 ID" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="target_type" label="目标类型">
                <Select placeholder="选择目标类型">
                  <Option value="ontology">本体实例</Option>
                  <Option value="graph">图数据库</Option>
                  <Option value="data_warehouse">数据仓库</Option>
                  <Option value="elasticsearch">搜索引擎</Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="target_id" label="目标 ID">
                <Input type="number" placeholder="目标资源 ID" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="schedule" label="调度策略">
            <Select placeholder="选择调度频率">
              {SCHEDULE_OPTIONS.map((opt) => (
                <Option key={opt.value} value={opt.value}>
                  {opt.label}
                </Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="steps" label="处理步骤">
            <Select mode="multiple" placeholder="选择处理步骤（按顺序）">
              {STEP_TYPES.map((st) => (
                <Option key={st.value} value={st.value}>
                  {st.label}
                </Option>
              ))}
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      {/* Detail Modal */}
      <Modal
        title={`管线详情 - ${selectedPipeline?.name ?? ''}`}
        open={detailModalVisible}
        onCancel={() => setDetailModalVisible(false)}
        footer={null}
        width={900}
      >
        {selectedPipeline && (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="ID">{selectedPipeline.id}</Descriptions.Item>
              <Descriptions.Item label="名称">{selectedPipeline.name}</Descriptions.Item>
              <Descriptions.Item label="描述" span={2}>
                {selectedPipeline.description ?? '-'}
              </Descriptions.Item>
              <Descriptions.Item label="数据源类型">{selectedPipeline.source_type}</Descriptions.Item>
              <Descriptions.Item label="数据源 ID">{selectedPipeline.source_id}</Descriptions.Item>
              <Descriptions.Item label="目标类型">{selectedPipeline.target_type}</Descriptions.Item>
              <Descriptions.Item label="目标 ID">{selectedPipeline.target_id ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="调度">
                {SCHEDULE_OPTIONS.find((o) => o.value === selectedPipeline.schedule)?.label ?? selectedPipeline.schedule ?? '手动'}
              </Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag color={STATUS_CONFIG[selectedPipeline.status]?.color ?? 'default'}>
                  {STATUS_CONFIG[selectedPipeline.status]?.text ?? selectedPipeline.status}
                </Tag>
              </Descriptions.Item>
            </Descriptions>

            {selectedPipeline.steps && selectedPipeline.steps.length > 0 && (
              <>
                <Title level={5}>处理步骤</Title>
                <Steps
                  size="small"
                  items={selectedPipeline.steps.map((step, i) => ({
                    title: step.name,
                    description: step.type,
                    status: 'finish' as const,
                  }))}
                />
              </>
            )}

            <Title level={5}>执行历史</Title>
            <Table
              size="small"
              rowKey="id"
              columns={runColumns}
              dataSource={pipelineRunsData}
              loading={runsLoading}
              pagination={{ pageSize: 5, showTotal: (total) => `共 ${total} 次` }}
            />
          </Space>
        )}
      </Modal>
    </div>
  );
}
