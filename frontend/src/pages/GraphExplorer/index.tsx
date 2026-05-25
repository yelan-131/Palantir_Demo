import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Card,
  Table,
  Tag,
  Space,
  Row,
  Col,
  Typography,
  Input,
  Button,
  Statistic,
  Empty,
  Spin,
  Descriptions,
  Select,
  message,
} from 'antd';
import {
  SearchOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  NodeIndexOutlined,
  AimOutlined,
  BranchesOutlined,
  ApartmentOutlined,
  ExpandOutlined,
} from '@ant-design/icons';
import cytoscape from 'cytoscape';
import dagre from 'cytoscape-dagre';
import { useNavigate } from 'react-router-dom';

import {
  executeCypher,
  getNeighbors,
  getShortestPath,
  getSubgraph,
  getGraphStats,
} from '@/services/api';

cytoscape.use(dagre);

const { Title, Text } = Typography;

interface GraphNode {
  id: number;
  label: string;
  type: string;
  properties: Record<string, unknown>;
}

interface GraphEdge {
  id: number;
  source: number;
  target: number;
  type: string;
  properties: Record<string, unknown>;
}

interface GraphStats {
  node_count: number;
  edge_count: number;
  entity_types: Record<string, number>;
  relation_types: Record<string, number>;
}

const TYPE_COLORS: Record<string, string> = {
  Factory: '#f5222d',
  Workshop: '#fa8c16',
  ProductionLine: '#faad14',
  Equipment: '#52c41a',
  Sensor: '#95de64',
  Product: '#13c2c2',
  Material: '#1677ff',
  SalesOrder: '#722ed1',
  WorkOrder: '#b37feb',
  Worker: '#eb2f96',
  Supplier: '#2f54eb',
  Customer: '#ff85c0',
  Inspection: '#ffc53d',
  Defect: '#ff4d4f',
  factory: '#f5222d',
  workshop: '#fa8c16',
  line: '#faad14',
  equipment: '#52c41a',
  product: '#13c2c2',
  material: '#1677ff',
  order: '#722ed1',
  worker: '#eb2f96',
  supplier: '#2f54eb',
  default: '#8c8c8c',
};

const LAYOUT_OPTIONS = [
  { value: 'dagre', label: '层次布局 (Dagre)' },
  { value: 'breadthfirst', label: '广度优先' },
  { value: 'concentric', label: '同心圆' },
  { value: 'cose', label: '力导向 (CoSE)' },
  { value: 'circle', label: '环形' },
];

const CYPHER_EXAMPLES = [
  'MATCH (n) RETURN n LIMIT 25',
  'MATCH (n:Equipment) RETURN n',
  'MATCH (a)-[r]->(b) RETURN a, r, b LIMIT 20',
  'MATCH (n {name: "CNC-001"}) RETURN n',
];

function getColor(type: string): string {
  return TYPE_COLORS[type] ?? TYPE_COLORS.default;
}

// Convert API graph data to Cytoscape elements
function toCytoscapeElements(nodes: GraphNode[], edges: GraphEdge[]) {
  const seen = new Set<string>();
  const elements: cytoscape.ElementDefinition[] = [];

  for (const n of nodes) {
    const nid = String(n.id);
    if (seen.has(nid)) continue;
    seen.add(nid);
    elements.push({
      group: 'nodes',
      data: {
        id: nid,
        label: (n.label ?? n.id).toString().substring(0, 12),
        fullLabel: (n.label ?? n.id).toString(),
        nodeType: n.type,
        color: getColor(n.type),
        pgId: n.id,
      },
    });
  }

  for (const e of edges) {
    const eid = `e-${e.id}`;
    if (seen.has(eid)) continue;
    seen.add(eid);
    elements.push({
      group: 'edges',
      data: {
        id: eid,
        source: String(e.source),
        target: String(e.target),
        label: e.type,
        edgeType: e.type,
      },
    });
  }

  return elements;
}

export default function GraphExplorerPage() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<GraphStats | null>(null);
  const [searchId, setSearchId] = useState<string>('');
  const [neighbors, setNeighbors] = useState<GraphNode[]>([]);
  const [neighborEdges, setNeighborEdges] = useState<GraphEdge[]>([]);
  const [graphNodes, setGraphNodes] = useState<GraphNode[]>([]);
  const [graphEdges, setGraphEdges] = useState<GraphEdge[]>([]);
  const [pathResult, setPathResult] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [cypherQuery, setCypherQuery] = useState('');
  const [cypherResult, setCyperResult] = useState<Record<string, unknown>[]>([]);
  const [cypherLoading, setCyperLoading] = useState(false);
  const [pathSrc, setPathSrc] = useState<string>('');
  const [pathTgt, setPathTgt] = useState<string>('');
  const [layout, setLayout] = useState('dagre');
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

  const cyContainerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const res = await getGraphStats();
      setStats(res.data ?? null);
    } catch {
      // silently fail
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // Initialize / update Cytoscape when graph data changes
  useEffect(() => {
    if (!cyContainerRef.current) return;

    const elements = toCytoscapeElements(graphNodes, graphEdges);

    if (elements.length === 0) {
      if (cyRef.current) {
        cyRef.current.destroy();
        cyRef.current = null;
      }
      return;
    }

    if (cyRef.current) {
      cyRef.current.destroy();
    }

    const cy = cytoscape({
      container: cyContainerRef.current,
      elements,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': 'data(color)',
            label: 'data(label)',
            'text-valign': 'center',
            'text-halign': 'center',
            'font-size': 10,
            color: '#fff',
            'text-outline-width': 2,
            'text-outline-color': 'data(color)',
            width: 40,
            height: 40,
            'border-width': 2,
            'border-color': '#fff',
            'text-wrap': 'wrap',
            'text-max-width': '60px',
          },
        },
        {
          selector: 'node:selected',
          style: {
            'border-width': 4,
            'border-color': '#1890ff',
          },
        },
        {
          selector: 'edge',
          style: {
            width: 2,
            'line-color': '#d9d9d9',
            'target-arrow-color': '#d9d9d9',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            label: 'data(label)',
            'font-size': 9,
            color: '#8c8c8c',
            'text-rotation': 'autorotate',
            'text-outline-width': 2,
            'text-outline-color': '#fff',
          },
        },
        {
          selector: 'edge:selected',
          style: {
            width: 3,
            'line-color': '#1890ff',
            'target-arrow-color': '#1890ff',
          },
        },
      ],
      layout: getLayoutConfig(layout),
      minZoom: 0.3,
      maxZoom: 3,
      wheelSensitivity: 0.3,
    });

    cy.on('tap', 'node', (evt) => {
      const node = evt.target;
      setSelectedNode({
        id: Number(node.id()),
        label: node.data('fullLabel'),
        type: node.data('nodeType'),
        properties: { pgId: node.data('pgId') },
      });
    });

    cy.on('tap', (evt) => {
      if (evt.target === cy) {
        setSelectedNode(null);
      }
    });

    cyRef.current = cy;

    return () => {
      if (cyRef.current) {
        cyRef.current.destroy();
        cyRef.current = null;
      }
    };
  }, [graphNodes, graphEdges, layout]);

  const runLayout = useCallback((name: string) => {
    if (!cyRef.current) return;
    cyRef.current.layout(getLayoutConfig(name)).run();
  }, []);

  const handleSearch = async () => {
    const id = parseInt(searchId, 10);
    if (isNaN(id)) {
      message.warning('请输入有效的实体 ID');
      return;
    }
    setLoading(true);
    try {
      const [neighborsRes, subgraphRes] = await Promise.all([
        getNeighbors(id, 20),
        getSubgraph(id, 2),
      ]);
      const neighborData = neighborsRes.data ?? {};
      setNeighbors(neighborData.nodes ?? neighborData.neighbors ?? []);
      setNeighborEdges(neighborData.edges ?? neighborData.relations ?? []);

      const subData = subgraphRes.data ?? {};
      setGraphNodes(subData.nodes ?? []);
      setGraphEdges(subData.edges ?? subData.relationships ?? []);
    } catch {
      message.error('查询失败');
      setNeighbors([]);
      setGraphNodes([]);
      setGraphEdges([]);
    } finally {
      setLoading(false);
    }
  };

  const handleExpandNode = async () => {
    if (!selectedNode) return;
    setLoading(true);
    try {
      const res = await getNeighbors(selectedNode.id, 10);
      const data = res.data ?? {};
      const newNodes: GraphNode[] = data.nodes ?? data.neighbors ?? [];
      const newEdges: GraphEdge[] = data.edges ?? data.relations ?? [];

      // Merge new data into existing
      const existingNodeIds = new Set(graphNodes.map((n) => n.id));
      const existingEdgeIds = new Set(graphEdges.map((e) => e.id));
      const mergedNodes = [
        ...graphNodes,
        ...newNodes.filter((n) => !existingNodeIds.has(n.id)),
      ];
      const mergedEdges = [
        ...graphEdges,
        ...newEdges.filter((e) => !existingEdgeIds.has(e.id)),
      ];
      setGraphNodes(mergedNodes);
      setGraphEdges(mergedEdges);
      setNeighbors(mergedNodes.slice(-20));
      setNeighborEdges(mergedEdges.slice(-20));
      message.success(`展开了 ${newNodes.length} 个新节点`);
    } catch {
      message.error('展开失败');
    } finally {
      setLoading(false);
    }
  };

  const handleFindPath = async () => {
    const src = parseInt(pathSrc, 10);
    const tgt = parseInt(pathTgt, 10);
    if (isNaN(src) || isNaN(tgt)) {
      message.warning('请输入有效的起止 ID');
      return;
    }
    setLoading(true);
    try {
      const res = await getShortestPath(src, tgt);
      const data = res.data ?? {};
      const pathNodes = data.nodes ?? [];
      const pathEdges = data.edges ?? data.relationships ?? [];
      setPathResult({ nodes: pathNodes, edges: pathEdges });
      // Also show path in graph
      setGraphNodes(pathNodes);
      setGraphEdges(pathEdges);
    } catch {
      message.error('路径查询失败');
      setPathResult(null);
    } finally {
      setLoading(false);
    }
  };

  const handleCypher = async () => {
    if (!cypherQuery.trim()) return;
    setCyperLoading(true);
    try {
      const res = await executeCypher(cypherQuery);
      const data = res.data;
      setCyperResult(Array.isArray(data) ? data : data?.results ?? data?.rows ?? []);
    } catch {
      message.error('Cypher 查询执行失败');
      setCyperResult([]);
    } finally {
      setCyperLoading(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 12 }}>
        <Title level={4} style={{ margin: 0 }}>关系图谱</Title>
        <Button icon={<SafetyCertificateOutlined />} onClick={() => navigate('/program/quality-event')}>
          进入质量异常影响分析
        </Button>
      </div>

      {/* Stats Row */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card><Statistic title="节点总数" value={stats?.node_count ?? 0} prefix={<NodeIndexOutlined />} /></Card>
        </Col>
        <Col span={6}>
          <Card><Statistic title="边总数" value={stats?.edge_count ?? 0} prefix={<BranchesOutlined />} /></Card>
        </Col>
        <Col span={6}>
          <Card><Statistic title="实体类型" value={stats?.entity_types ? Object.keys(stats.entity_types).length : 0} prefix={<ApartmentOutlined />} /></Card>
        </Col>
        <Col span={6}>
          <Card><Statistic title="关系类型" value={stats?.relation_types ? Object.keys(stats.relation_types).length : 0} prefix={<AimOutlined />} /></Card>
        </Col>
      </Row>

      {/* Type distribution */}
      {stats?.entity_types && Object.keys(stats.entity_types).length > 0 && (
        <Card title="类型分布" size="small" style={{ marginBottom: 16 }}>
          <Space wrap>
            {Object.entries(stats.entity_types).map(([type, count]) => (
              <Tag key={type} color={getColor(type)}>{type}: {count as number}</Tag>
            ))}
          </Space>
        </Card>
      )}

      <Row gutter={16}>
        {/* Left: Graph Visualization */}
        <Col span={16}>
          <Card
            title="图谱探索"
            size="small"
            extra={
              <Space>
                <Select
                  value={layout}
                  onChange={(v) => { setLayout(v); runLayout(v); }}
                  options={LAYOUT_OPTIONS}
                  style={{ width: 160 }}
                  size="small"
                />
                <Button icon={<ReloadOutlined />} size="small" onClick={fetchStats}>刷新</Button>
              </Space>
            }
          >
            <Space style={{ width: '100%', marginBottom: 12 }} wrap>
              <Input
                placeholder="输入实体 ID (如 1)"
                prefix={<SearchOutlined />}
                value={searchId}
                onChange={(e) => setSearchId(e.target.value)}
                onPressEnter={handleSearch}
                style={{ width: 180 }}
              />
              <Button type="primary" onClick={handleSearch} loading={loading}>搜索邻居</Button>
              {selectedNode && (
                <Button icon={<ExpandOutlined />} onClick={handleExpandNode} loading={loading}>
                  展开 {selectedNode.label?.substring(0, 8)}
                </Button>
              )}
            </Space>
            <Spin spinning={loading}>
              {graphNodes.length === 0 ? (
                <div style={{ height: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fafafa', borderRadius: 8 }}>
                  <Empty description="搜索实体以可视化关系图谱" />
                </div>
              ) : (
                <div
                  ref={cyContainerRef}
                  style={{ width: '100%', height: 500, border: '1px solid #f0f0f0', borderRadius: 8, background: '#fafafa' }}
                />
              )}
            </Spin>
            {selectedNode && (
              <div style={{ marginTop: 8, padding: '8px 12px', background: '#f6f6f6', borderRadius: 4 }}>
                <Text strong>{selectedNode.label}</Text>
                <Tag color={getColor(selectedNode.type)} style={{ marginLeft: 8 }}>{selectedNode.type}</Tag>
                <Text type="secondary" style={{ marginLeft: 8 }}>ID: {selectedNode.id}</Text>
              </div>
            )}
          </Card>

          {/* Cypher Query */}
          <Card title="Cypher 查询" size="small" style={{ marginTop: 16 }}>
            <Input.TextArea
              rows={3}
              value={cypherQuery}
              onChange={(e) => setCypherQuery(e.target.value)}
              placeholder="输入 Cypher 查询语句..."
            />
            <div style={{ marginTop: 8, marginBottom: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>示例：</Text>
              <Space wrap size={4}>
                {CYPHER_EXAMPLES.map((q) => (
                  <Tag key={q} style={{ cursor: 'pointer', fontSize: 11 }} color="blue" onClick={() => setCypherQuery(q)}>
                    {q.substring(0, 35)}...
                  </Tag>
                ))}
              </Space>
            </div>
            <Button type="primary" onClick={handleCypher} loading={cypherLoading} style={{ marginTop: 4 }}>执行查询</Button>
            {cypherResult.length > 0 && (
              <pre style={{ marginTop: 12, maxHeight: 300, overflow: 'auto', background: '#f5f5f5', padding: 12, borderRadius: 6, fontSize: 12 }}>
                {JSON.stringify(cypherResult, null, 2)}
              </pre>
            )}
          </Card>
        </Col>

        {/* Right: Neighbors & Path */}
        <Col span={8}>
          <Card title={`邻居节点 (${neighbors.length})`} size="small">
            {neighbors.length === 0 ? (
              <Empty description="搜索实体查看邻居" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <Table
                size="small"
                rowKey="id"
                pagination={false}
                scroll={{ y: 240 }}
                columns={[
                  { title: 'ID', dataIndex: 'id', width: 50 },
                  { title: '标签', dataIndex: 'label', ellipsis: true },
                  {
                    title: '类型',
                    dataIndex: 'type',
                    width: 90,
                    render: (type: string) => <Tag color={getColor(type)}>{type}</Tag>,
                  },
                ]}
                dataSource={neighbors}
              />
            )}
          </Card>

          <Card title="最短路径" size="small" style={{ marginTop: 16 }}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Input placeholder="起始节点 ID" prefix={<AimOutlined />} value={pathSrc} onChange={(e) => setPathSrc(e.target.value)} />
              <Input placeholder="目标节点 ID" prefix={<AimOutlined />} value={pathTgt} onChange={(e) => setPathTgt(e.target.value)} />
              <Button type="primary" onClick={handleFindPath} loading={loading} block>查找路径</Button>
            </Space>
            {pathResult && (
              <div style={{ marginTop: 12 }}>
                <Descriptions size="small" column={1} bordered>
                  <Descriptions.Item label="路径长度">{pathResult.edges.length} 步</Descriptions.Item>
                  <Descriptions.Item label="途经节点">
                    {pathResult.nodes.map((n) => (
                      <Tag key={n.id} color={getColor(n.type)}>{n.label ?? n.id}</Tag>
                    ))}
                  </Descriptions.Item>
                </Descriptions>
              </div>
            )}
          </Card>

          {neighborEdges.length > 0 && (
            <Card title="关联边" size="small" style={{ marginTop: 16 }}>
              <Table
                size="small"
                rowKey="id"
                pagination={false}
                scroll={{ y: 200 }}
                columns={[
                  { title: '类型', dataIndex: 'type', render: (type: string) => <Tag>{type}</Tag> },
                  {
                    title: '源→目标',
                    render: (_: unknown, record: GraphEdge) => (
                      <Text style={{ fontSize: 12 }}>{record.source} → {record.target}</Text>
                    ),
                  },
                ]}
                dataSource={neighborEdges}
              />
            </Card>
          )}
        </Col>
      </Row>
    </div>
  );
}

function getLayoutConfig(name: string): cytoscape.LayoutOptions {
  switch (name) {
    case 'dagre':
      return { name: 'dagre', rankDir: 'TB', spacingFactor: 1.2, fit: true, padding: 30, animate: true } as cytoscape.LayoutOptions;
    case 'breadthfirst':
      return { name: 'breadthfirst', directed: true, spacingFactor: 1.2, fit: true, padding: 30, animate: true };
    case 'concentric':
      return { name: 'concentric', concentric: (n) => n.degree(), minNodeSpacing: 40, fit: true, padding: 30, animate: true };
    case 'cose':
      return { name: 'cose', nodeRepulsion: 8000, idealEdgeLength: 100, fit: true, padding: 30, animate: true };
    case 'circle':
      return { name: 'circle', spacingFactor: 1.2, fit: true, padding: 30, animate: true };
    default:
      return { name: 'dagre', fit: true, padding: 30, animate: true } as cytoscape.LayoutOptions;
  }
}
