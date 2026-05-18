import React, { useState, useEffect, useCallback } from 'react';
import {
  Card,
  Table,
  Tag,
  Space,
  Row,
  Col,
  Typography,
  Input,
  Spin,
  Empty,
  Descriptions,
  Tooltip,
} from 'antd';
import {
  ApartmentOutlined,
  DatabaseOutlined,
  SearchOutlined,
  TeamOutlined,
  CarOutlined,
  ToolOutlined,
  FileTextOutlined,
  UserOutlined,
  ShopOutlined,
  AppstoreOutlined,
} from '@ant-design/icons';
import {
  listEntityTypes,
  getEntityType,
  listEntityInstances,
  listRelationTypes,
} from '@/services/api';

const { Title, Text } = Typography;

interface EntityType {
  name: string;
  type?: string;
  label?: string;
  display_name: string;
  description: string;
  icon: string;
  properties: EntityProperty[];
  relations: EntityRelation[];
}

interface EntityProperty {
  name: string;
  display_name: string;
  data_type: string;
  required: boolean;
  indexed: boolean;
}

interface EntityRelation {
  name: string;
  target_type: string;
  cardinality: string;
  description: string;
}

interface EntityInstance {
  id: number;
  [key: string]: unknown;
}

interface RelationType {
  name: string;
  source_type: string;
  target_type: string;
  description: string;
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
  vehicle: <CarOutlined />,
  team: <TeamOutlined />,
  default: <DatabaseOutlined />,
};

const DATA_TYPE_COLORS: Record<string, string> = {
  string: 'blue',
  integer: 'green',
  float: 'cyan',
  boolean: 'orange',
  datetime: 'purple',
  json: 'magenta',
  enum: 'geekblue',
};

export default function OntologyPage() {
  const [entityTypes, setEntityTypes] = useState<EntityType[]>([]);
  const [relationTypes, setRelationTypes] = useState<RelationType[]>([]);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [entityDetail, setEntityDetail] = useState<EntityType | null>(null);
  const [instances, setInstances] = useState<EntityInstance[]>([]);
  const [loading, setLoading] = useState(false);
  const [instanceLoading, setInstanceLoading] = useState(false);
  const [searchText, setSearchText] = useState('');

  const fetchEntityTypes = useCallback(async () => {
    setLoading(true);
    try {
      const [entitiesRes, relationsRes] = await Promise.all([listEntityTypes(), listRelationTypes()]);
      setEntityTypes(entitiesRes.data?.data ?? entitiesRes.data?.items ?? []);
      setRelationTypes(relationsRes.data?.data ?? []);
    } catch {
      // silently fail
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
        listEntityInstances(typeName, { limit: 100 }),
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

  const filteredEntities = entityTypes.filter(
    (et) =>
      (et.name ?? et.type ?? '').toLowerCase().includes(searchText.toLowerCase()) ||
      (et.display_name ?? et.label ?? '').includes(searchText)
  );

  const filteredRelations = selectedType
    ? relationTypes.filter(
        (r) => r.source_type === selectedType || r.target_type === selectedType
      )
    : relationTypes;

  // Build instance table columns from entity detail properties
  const instanceColumns = entityDetail
    ? [
        { title: 'ID', dataIndex: 'id', key: 'id', width: 60 },
        ...entityDetail.properties
          .filter((p) => p.name !== 'id')
          .slice(0, 8)
          .map((prop) => ({
            title: prop.display_name ?? prop.name,
            dataIndex: prop.name,
            key: prop.name,
            ellipsis: true as const,
            width: 150,
            render: (val: unknown) => {
              if (val === null || val === undefined) return <Text type="secondary">-</Text>;
              if (typeof val === 'boolean') return val ? <Tag color="green">是</Tag> : <Tag color="default">否</Tag>;
              if (typeof val === 'object') return <Text code>{JSON.stringify(val)}</Text>;
              return String(val);
            },
          })),
      ]
    : [];

  return (
    <div>
      <Title level={4}>本体建模</Title>
      <Row gutter={16} style={{ minHeight: 600 }}>
        {/* Left Panel: Entity Type Tree */}
        <Col span={6}>
          <Card
            title="实体类型"
            size="small"
            style={{ height: '100%' }}
            extra={<Text type="secondary">{entityTypes.length} 种</Text>}
          >
            <Input
              placeholder="搜索实体类型..."
              prefix={<SearchOutlined />}
              size="small"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              style={{ marginBottom: 12 }}
              allowClear
            />
            <Spin spinning={loading}>
              <div style={{ maxHeight: 520, overflowY: 'auto' }}>
                {filteredEntities.length === 0 && !loading ? (
                  <Empty description="暂无实体类型" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                ) : (
                  filteredEntities.map((et) => {
                    const etKey = et.name ?? et.type;
                    const isSelected = selectedType === etKey;
                    const iconKey = (et.icon ?? 'default').toLowerCase();
                    return (
                      <Tooltip key={etKey} title={et.description ?? et.label} placement="right">
                        <div
                          onClick={() => handleSelectEntity(etKey)}
                          style={{
                            padding: '8px 12px',
                            marginBottom: 4,
                            borderRadius: 6,
                            cursor: 'pointer',
                            background: isSelected ? '#e6f4ff' : 'transparent',
                            borderLeft: isSelected ? '3px solid #1677ff' : '3px solid transparent',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            transition: 'all 0.2s',
                          }}
                        >
                          <span style={{ fontSize: 16, color: isSelected ? '#1677ff' : '#8c8c8c' }}>
                            {ICON_MAP[iconKey] ?? ICON_MAP.default}
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                              style={{
                                fontWeight: isSelected ? 600 : 400,
                                color: isSelected ? '#1677ff' : undefined,
                                fontSize: 13,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {et.display_name ?? et.label ?? et.name}
                            </div>
                            <Text type="secondary" style={{ fontSize: 11 }}>
                              {et.name ?? et.type}
                            </Text>
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

        {/* Right Panel: Entity Detail + Instances */}
        <Col span={18}>
          {!selectedType ? (
            <Card style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Empty description="请在左侧选择一个实体类型" />
            </Card>
          ) : (
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              {/* Entity Detail */}
              <Card
                title={
                  <Space>
                    {ICON_MAP[(entityDetail?.icon ?? 'default').toLowerCase()] ?? ICON_MAP.default}
                    <span>{entityDetail?.display_name ?? selectedType}</span>
                    <Tag>{selectedType}</Tag>
                  </Space>
                }
                size="small"
              >
                <Descriptions size="small" column={1} bordered>
                  <Descriptions.Item label="名称">{entityDetail?.display_name ?? selectedType}</Descriptions.Item>
                  <Descriptions.Item label="描述">{entityDetail?.description ?? '-'}</Descriptions.Item>
                </Descriptions>

                <Title level={5} style={{ marginTop: 16, marginBottom: 8 }}>
                  属性定义
                </Title>
                <Table
                  size="small"
                  pagination={false}
                  rowKey="name"
                  columns={[
                    { title: '属性名', dataIndex: 'name', key: 'name', width: 140 },
                    {
                      title: '显示名',
                      dataIndex: 'display_name',
                      key: 'display_name',
                      width: 120,
                      render: (text: string) => text ?? '-',
                    },
                    {
                      title: '类型',
                      dataIndex: 'data_type',
                      key: 'data_type',
                      width: 100,
                      render: (type: string) => (
                        <Tag color={DATA_TYPE_COLORS[type] ?? 'default'}>{type}</Tag>
                      ),
                    },
                    {
                      title: '必填',
                      dataIndex: 'required',
                      key: 'required',
                      width: 60,
                      render: (val: boolean) =>
                        val ? <Tag color="red">必填</Tag> : <Tag>可选</Tag>,
                    },
                    {
                      title: '索引',
                      dataIndex: 'indexed',
                      key: 'indexed',
                      width: 60,
                      render: (val: boolean) =>
                        val ? <Tag color="blue">已索引</Tag> : <Tag>未索引</Tag>,
                    },
                  ]}
                  dataSource={entityDetail?.properties ?? []}
                />

                <Title level={5} style={{ marginTop: 16, marginBottom: 8 }}>
                  关联关系
                </Title>
                {filteredRelations.length === 0 ? (
                  <Empty description="无关联关系" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                ) : (
                  <Table
                    size="small"
                    pagination={false}
                    rowKey="name"
                    columns={[
                      { title: '关系名', dataIndex: 'name', key: 'name', width: 140 },
                      {
                        title: '方向',
                        key: 'direction',
                        width: 100,
                        render: (_: unknown, record: RelationType) =>
                          record.source_type === selectedType ? (
                            <Tag color="blue">出边 → {record.target_type}</Tag>
                          ) : (
                            <Tag color="green">入边 ← {record.source_type}</Tag>
                          ),
                      },
                      {
                        title: '目标类型',
                        key: 'target',
                        width: 120,
                        render: (_: unknown, record: RelationType) =>
                          record.source_type === selectedType ? record.target_type : record.source_type,
                      },
                      {
                        title: '描述',
                        dataIndex: 'description',
                        key: 'description',
                        render: (text: string) => text ?? '-',
                      },
                    ]}
                    dataSource={filteredRelations}
                  />
                )}
              </Card>

              {/* Instances */}
              <Card
                title={`实例列表 (${instances.length})`}
                size="small"
                extra={
                  <Text type="secondary">
                    展示前 100 条
                  </Text>
                }
              >
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
    </div>
  );
}
