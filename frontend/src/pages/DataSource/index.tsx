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
  Tabs,
} from 'antd';
import {
  PlusOutlined,
  ReloadOutlined,
  LinkOutlined,
  SyncOutlined,
  EyeOutlined,
  DeleteOutlined,
  DatabaseOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
} from '@ant-design/icons';
import {
  listDataSources,
  createDataSource,
  deleteDataSource,
  testConnection,
  triggerSync,
  getSyncStatus,
  previewData,
} from '@/services/api';
import { formatServerDateTime } from '@/utils/dateTime';

const { Title } = Typography;
const { Option } = Select;

interface DataSource {
  id: number;
  name: string;
  type: string;
  host: string;
  port: number;
  database: string;
  status: string;
  last_sync: string | null;
  created_at: string;
  description: string;
}

const STATUS_MAP: Record<string, { color: string; text: string; icon: React.ReactNode }> = {
  connected: { color: 'success', text: '已连接', icon: <CheckCircleOutlined /> },
  disconnected: { color: 'error', text: '已断开', icon: <CloseCircleOutlined /> },
  syncing: { color: 'processing', text: '同步中', icon: <LoadingOutlined /> },
  error: { color: 'warning', text: '异常', icon: <CloseCircleOutlined /> },
  idle: { color: 'default', text: '空闲', icon: <DatabaseOutlined /> },
};

const DS_TYPES = [
  { value: 'mysql', label: 'MySQL' },
  { value: 'postgresql', label: 'PostgreSQL' },
  { value: 'oracle', label: 'Oracle' },
  { value: 'sqlserver', label: 'SQL Server' },
  { value: 'mongodb', label: 'MongoDB' },
  { value: 'redis', label: 'Redis' },
  { value: 'kafka', label: 'Kafka' },
  { value: 'mqtt', label: 'MQTT' },
  { value: 'opcua', label: 'OPC UA' },
  { value: 'modbus', label: 'Modbus' },
  { value: 'csv', label: 'CSV 文件' },
  { value: 'api', label: 'REST API' },
];

export default function DataSourcePage() {
  const [dataSources, setDataSources] = useState<DataSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewDataState, setPreviewDataState] = useState<{ columns: string[]; rows: Record<string, unknown>[] }>({
    columns: [],
    rows: [],
  });
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewName, setPreviewName] = useState('');
  const [testingIds, setTestingIds] = useState<Set<number>>(new Set());
  const [syncingIds, setSyncingIds] = useState<Set<number>>(new Set());
  const [form] = Form.useForm();

  const fetchDataSources = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listDataSources();
      setDataSources(Array.isArray(res.data) ? res.data : res.data?.data ?? res.data?.items ?? []);
    } catch {
      message.error('加载数据源列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDataSources();
  }, [fetchDataSources]);

  const handleCreate = async (values: Record<string, unknown>) => {
    try {
      await createDataSource(values);
      message.success('数据源创建成功');
      setModalVisible(false);
      form.resetFields();
      fetchDataSources();
    } catch {
      message.error('创建数据源失败');
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteDataSource(id);
      message.success('已删除');
      fetchDataSources();
    } catch {
      message.error('删除失败');
    }
  };

  const handleTestConnection = async (id: number) => {
    setTestingIds((prev) => new Set(prev).add(id));
    try {
      const res = await testConnection(id);
      const success = res.data?.success ?? res.data?.connected;
      if (success) {
        message.success('连接测试成功');
      } else {
        message.error(`连接失败: ${res.data?.error ?? '未知错误'}`);
      }
    } catch {
      message.error('连接测试请求失败');
    } finally {
      setTestingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleSync = async (id: number) => {
    setSyncingIds((prev) => new Set(prev).add(id));
    try {
      await triggerSync(id);
      message.success('同步已触发');
      fetchDataSources();
      // Poll sync status
      const pollInterval = setInterval(async () => {
        try {
          const statusRes = await getSyncStatus(id);
          if (statusRes.data?.status !== 'syncing') {
            clearInterval(pollInterval);
            setSyncingIds((prev) => {
              const next = new Set(prev);
              next.delete(id);
              return next;
            });
            fetchDataSources();
          }
        } catch {
          clearInterval(pollInterval);
        }
      }, 3000);
    } catch {
      message.error('触发同步失败');
      setSyncingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handlePreview = async (record: DataSource) => {
    setPreviewVisible(true);
    setPreviewName(record.name);
    setPreviewLoading(true);
    try {
      const res = await previewData(record.id, 50);
      const data = res.data;
      if (Array.isArray(data) && data.length > 0) {
        setPreviewDataState({ columns: Object.keys(data[0]), rows: data });
      } else if (data?.columns && data?.rows) {
        setPreviewDataState({ columns: data.columns, rows: data.rows });
      } else {
        setPreviewDataState({ columns: [], rows: [] });
      }
    } catch {
      message.error('预览数据加载失败');
    } finally {
      setPreviewLoading(false);
    }
  };

  const connectedCount = dataSources.filter((ds) => ds.status === 'connected').length;
  const syncingCount = dataSources.filter((ds) => ds.status === 'syncing').length;
  const errorCount = dataSources.filter((ds) => ds.status === 'error').length;

  const columns = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 60,
    },
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string) => <Typography.Text strong>{text}</Typography.Text>,
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 120,
      render: (type: string) => {
        const dsType = DS_TYPES.find((t) => t.value === type);
        return <Tag>{dsType?.label ?? type}</Tag>;
      },
    },
    {
      title: '连接地址',
      key: 'connection',
      width: 240,
      render: (_: unknown, record: DataSource) =>
        `${record.host}${record.port ? ':' + record.port : ''}${record.database ? '/' + record.database : ''}`,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (status: string) => {
        const cfg = STATUS_MAP[status] ?? STATUS_MAP.idle;
        return (
          <Tag color={cfg.color} icon={cfg.icon}>
            {cfg.text}
          </Tag>
        );
      },
    },
    {
      title: '最近同步',
      dataIndex: 'last_sync',
      key: 'last_sync',
      width: 180,
      render: (text: string | null) => formatServerDateTime(text),
    },
    {
      title: '操作',
      key: 'actions',
      width: 280,
      render: (_: unknown, record: DataSource) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            icon={<LinkOutlined />}
            loading={testingIds.has(record.id)}
            onClick={() => handleTestConnection(record.id)}
          >
            测试
          </Button>
          <Button
            type="link"
            size="small"
            icon={<SyncOutlined />}
            loading={syncingIds.has(record.id)}
            onClick={() => handleSync(record.id)}
          >
            同步
          </Button>
          <Button
            type="link"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => handlePreview(record)}
          >
            预览
          </Button>
          <Popconfirm
            title="确定要删除此数据源吗？"
            onConfirm={() => handleDelete(record.id)}
            okText="确定"
            cancelText="取消"
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Title level={4}>数据源管理</Title>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card>
            <Statistic title="数据源总数" value={dataSources.length} prefix={<DatabaseOutlined />} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="已连接"
              value={connectedCount}
              valueStyle={{ color: '#52c41a' }}
              prefix={<CheckCircleOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="同步中"
              value={syncingCount}
              valueStyle={{ color: '#1677ff' }}
              prefix={<SyncOutlined spin={syncingCount > 0} />}
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

      <Card
        title="数据源列表"
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={fetchDataSources}>
              刷新
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalVisible(true)}>
              新建数据源
            </Button>
          </Space>
        }
      >
        <Table
          rowKey="id"
          columns={columns}
          dataSource={dataSources}
          loading={loading}
          pagination={{ pageSize: 10, showTotal: (total) => `共 ${total} 条` }}
        />
      </Card>

      <Modal
        title="新建数据源"
        open={modalVisible}
        onCancel={() => {
          setModalVisible(false);
          form.resetFields();
        }}
        onOk={() => form.submit()}
        width={560}
      >
        <Form form={form} layout="vertical" onFinish={handleCreate}>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入数据源名称' }]}>
            <Input placeholder="例如：MES 生产数据库" />
          </Form.Item>
          <Form.Item name="type" label="类型" rules={[{ required: true, message: '请选择数据源类型' }]}>
            <Select placeholder="选择类型">
              {DS_TYPES.map((t) => (
                <Option key={t.value} value={t.value}>
                  {t.label}
                </Option>
              ))}
            </Select>
          </Form.Item>
          <Row gutter={16}>
            <Col span={16}>
              <Form.Item name="host" label="主机地址" rules={[{ required: true, message: '请输入主机地址' }]}>
                <Input placeholder="192.168.1.100" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="port" label="端口">
                <Input placeholder="3306" type="number" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="database" label="数据库/路径">
            <Input placeholder="数据库名称或资源路径" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="username" label="用户名">
                <Input placeholder="用户名" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="password" label="密码">
                <Input.Password placeholder="密码" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} placeholder="数据源用途说明" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`数据预览 - ${previewName}`}
        open={previewVisible}
        onCancel={() => setPreviewVisible(false)}
        footer={null}
        width={900}
      >
        <Tabs
          items={[
            {
              key: 'table',
              label: '表格视图',
              children: (
                <Table
                  size="small"
                  scroll={{ x: 'max-content' }}
                  loading={previewLoading}
                  columns={previewDataState.columns.map((col) => ({
                    title: col,
                    dataIndex: col,
                    key: col,
                    ellipsis: true,
                    width: 150,
                  }))}
                  dataSource={previewDataState.rows.map((row, i) => ({ ...row, _key: i }))}
                  rowKey="_key"
                  pagination={{ pageSize: 10 }}
                />
              ),
            },
            {
              key: 'json',
              label: 'JSON 视图',
              children: (
                <pre style={{ maxHeight: 500, overflow: 'auto', background: '#f5f5f5', padding: 12, borderRadius: 6 }}>
                  {JSON.stringify(previewDataState.rows, null, 2)}
                </pre>
              ),
            },
          ]}
        />
      </Modal>
    </div>
  );
}
