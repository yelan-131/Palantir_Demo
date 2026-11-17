import 'reactflow/dist/style.css';
import { useMemo, type Dispatch, type SetStateAction } from 'react';
import { ReloadOutlined, RobotOutlined } from '@ant-design/icons';
import { Button, Card, Divider, Empty, List, Progress, Segmented, Select, Space, Tag, Typography } from 'antd';
import ReactFlow, { Background, Controls, Handle, MiniMap, Position, applyEdgeChanges, applyNodeChanges, type Connection, type Edge, type EdgeChange, type Node, type NodeChange } from 'reactflow';
import type { NavigateFunction } from 'react-router-dom';
import type { OntologyCandidateInfo, SemanticMappingWorkbenchResponse } from '../../services/api';
import { SEMANTIC_MAPPING_STATUS_OPTIONS, semanticNodeTypeLabels, type DataAsset, type OntologyObject } from './semanticAssetShared';

function SemanticMappingFlowNode({ data }: { data: any }) {
  const nodeType = String(data?.nodeType ?? '');
  const canReceive = nodeType === 'object' || nodeType === 'object_field';
  const canSource = nodeType === 'source_table' || nodeType === 'source_field' || nodeType === 'object';
  return (
    <div className={`semantic-flow-node semantic-flow-node-${nodeType}`}>
      {canReceive ? <Handle type="target" position={Position.Left} /> : null}
      <div className="semantic-flow-node-kicker">{semanticNodeTypeLabels[nodeType] ?? nodeType}</div>
      <strong>{data?.label}</strong>
      {data?.subtitle ? <small>{data.subtitle}</small> : null}
      {canSource ? <Handle type="source" position={Position.Right} /> : null}
    </div>
  );
}

type SemanticMappingScope = {
  assets: DataAsset[];
  objects: OntologyObject[];
  mappingObjectCode: string | undefined;
  setMappingObjectCode: Dispatch<SetStateAction<string | undefined>>;
  mappingSourceId: number | undefined;
  setMappingSourceId: Dispatch<SetStateAction<number | undefined>>;
  mappingStatus: string;
  setMappingStatus: Dispatch<SetStateAction<string>>;
  recognizing: boolean;
  runSemanticMappingRecognition: () => Promise<void>;
  navigate: NavigateFunction;
  openCandidateReview: (candidateId: number) => void;
};

type SemanticMappingCanvas = {
  mappingWorkbench: SemanticMappingWorkbenchResponse | undefined;
  mappingNodes: Node[];
  setMappingNodes: Dispatch<SetStateAction<Node[]>>;
  mappingEdges: Edge[];
  setMappingEdges: Dispatch<SetStateAction<Edge[]>>;
  mappingLoading: boolean;
  savingMappingLayout: boolean;
  loadSemanticMappingWorkbench: () => Promise<void>;
  saveCurrentMappingLayout: (nodes?: Node[]) => Promise<void>;
  connectSemanticMapping: (connection: Connection) => Promise<void>;
  selectedMappingElement: Node | Edge | undefined;
  setSelectedMappingElement: Dispatch<SetStateAction<Node | Edge | undefined>>;
};

export function SemanticMappingView({ scope, canvas }: { scope: SemanticMappingScope; canvas: SemanticMappingCanvas }) {
  const {
    assets,
    objects,
    mappingObjectCode,
    setMappingObjectCode,
    mappingSourceId,
    setMappingSourceId,
    mappingStatus,
    setMappingStatus,
    recognizing,
    runSemanticMappingRecognition,
    navigate,
    openCandidateReview,
  } = scope;

  const {
    mappingWorkbench,
    mappingNodes,
    setMappingNodes,
    mappingEdges,
    setMappingEdges,
    mappingLoading,
    savingMappingLayout,
    loadSemanticMappingWorkbench,
    saveCurrentMappingLayout,
    connectSemanticMapping,
    selectedMappingElement,
    setSelectedMappingElement,
  } = canvas;
  const semanticFlowNodeTypes = useMemo(() => ({ semantic: SemanticMappingFlowNode }), []);
  const selectedMappingCandidate = (selectedMappingElement?.data as any)?.candidate as OntologyCandidateInfo | undefined;
  const selectedMappingNodeData = selectedMappingElement && !('source' in selectedMappingElement)
    ? selectedMappingElement.data as Record<string, any>
    : undefined;

  return (
    <div className="semantic-mapping-workbench">
      <aside className="semantic-mapping-sidebar">
        <Card
          className="semantic-side-card"
          title="映射范围"
          extra={<Button size="small" icon={<ReloadOutlined />} loading={mappingLoading} onClick={loadSemanticMappingWorkbench}>刷新</Button>}
        >
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Select
              value={mappingObjectCode}
              placeholder="选择业务对象"
              style={{ width: '100%' }}
              options={objects.map((item) => ({ value: item.code, label: `${item.name} / ${item.code}` }))}
              onChange={setMappingObjectCode}
            />
            <Select
              allowClear
              value={mappingSourceId}
              placeholder="全部数据源"
              style={{ width: '100%' }}
              options={assets.map((item) => ({ value: item.id, label: `${item.name} · ${item.tables.length}表` }))}
              onChange={setMappingSourceId}
            />
            <Segmented
              size="small"
              value={mappingStatus}
              options={SEMANTIC_MAPPING_STATUS_OPTIONS}
              onChange={(value) => setMappingStatus(String(value))}
              block
            />
            <div className="semantic-mapping-metrics">
              <div><strong>{mappingWorkbench?.nodes.length ?? 0}</strong><span>节点</span></div>
              <div><strong>{mappingWorkbench?.edges.filter((edge) => edge.type.includes('semantic')).length ?? 0}</strong><span>语义线</span></div>
              <div><strong>{mappingWorkbench?.candidates.length ?? 0}</strong><span>候选</span></div>
            </div>
            <Divider style={{ margin: '4px 0' }} />
            <Typography.Text type="secondary">来源表</Typography.Text>
            <List
              size="small"
              dataSource={mappingWorkbench?.metadata ?? []}
              locale={{ emptyText: '暂无扫描元数据' }}
              renderItem={(item) => (
                <List.Item className="semantic-mapping-source-item">
                  <List.Item.Meta
                    title={<Space><strong>{item.entity_label || item.entity_name}</strong><Tag>{item.fields.length}字段</Tag></Space>}
                    description={`${item.source_type} / ${item.row_count ?? 0} 行`}
                  />
                </List.Item>
              )}
            />
          </Space>
        </Card>
      </aside>

      <main className="semantic-mapping-canvas-panel">
        <Card
          className="semantic-mapping-canvas-card"
          title={
            <Space direction="vertical" size={2}>
              <Typography.Text strong>语义映射画布</Typography.Text>
              <Typography.Text type="secondary">自由连接来源字段与对象字段；所有新连线先进入候选审核。</Typography.Text>
            </Space>
          }
          extra={(
            <Space>
              <Button loading={savingMappingLayout} onClick={() => saveCurrentMappingLayout()}>保存布局</Button>
              <Button onClick={() => {
                const arranged = mappingNodes.map((node, index) => ({
                  ...node,
                  position: {
                    x: String(node.data?.nodeType).startsWith('source') ? (String(node.data?.nodeType) === 'source_table' ? 40 : 300) : (String(node.data?.nodeType) === 'object' ? 720 : 980),
                    y: 80 + index * 54,
                  },
                }));
                setMappingNodes(arranged);
                saveCurrentMappingLayout(arranged);
              }}>重新布局</Button>
              <Button onClick={() => navigate('/data-center/objects?view=ontology&section=candidates')}>候选审核</Button>
              <Button type="primary" icon={<RobotOutlined />} loading={recognizing} disabled={!mappingSourceId} onClick={runSemanticMappingRecognition}>AI 生成候选</Button>
            </Space>
          )}
        >
          <div className="semantic-mapping-canvas">
            {mappingNodes.length ? (
              <ReactFlow
                nodes={mappingNodes}
                edges={mappingEdges}
                nodeTypes={semanticFlowNodeTypes}
                fitView
                onNodesChange={(changes: NodeChange[]) => setMappingNodes((current) => applyNodeChanges(changes, current))}
                onEdgesChange={(changes: EdgeChange[]) => setMappingEdges((current) => applyEdgeChanges(changes, current))}
                onConnect={connectSemanticMapping}
                onNodeClick={(_, node) => setSelectedMappingElement(node)}
                onEdgeClick={(_, edge) => setSelectedMappingElement(edge)}
                onNodeDragStop={(_, __, nodes) => saveCurrentMappingLayout(nodes)}
              >
                <Background gap={18} size={1} />
                <MiniMap pannable zoomable />
                <Controls />
              </ReactFlow>
            ) : (
              <Empty description={mappingLoading ? '正在加载语义映射' : '暂无画布数据，请先扫描元数据并选择对象'} />
            )}
          </div>
        </Card>
      </main>

      <aside className="semantic-mapping-detail">
        <Card
          className="semantic-side-card"
          title={selectedMappingCandidate ? '候选连线详情' : selectedMappingNodeData ? '节点详情' : '映射详情'}
          extra={selectedMappingCandidate ? <Tag color={selectedMappingCandidate.status === 'pending_review' ? 'warning' : 'processing'}>{selectedMappingCandidate.status}</Tag> : null}
        >
          {selectedMappingCandidate ? (
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Typography.Title level={5}>{selectedMappingCandidate.title}</Typography.Title>
              <Progress percent={Math.round((selectedMappingCandidate.confidence ?? 0) * 100)} size="small" />
              <div className="semantic-mapping-kv">
                <span>类型</span><strong>{selectedMappingCandidate.candidate_type}</strong>
                <span>来源</span><strong>{selectedMappingCandidate.source_ref ?? '-'}</strong>
              </div>
              <pre className="ontology-payload-preview">{JSON.stringify(selectedMappingCandidate.payload, null, 2)}</pre>
              {selectedMappingCandidate.status === 'pending_review' && (
                <Button onClick={() => openCandidateReview(selectedMappingCandidate.id)}>前往候选审核</Button>
              )}
            </Space>
          ) : selectedMappingNodeData ? (
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Space wrap><Tag>{semanticNodeTypeLabels[String(selectedMappingNodeData.nodeType)] ?? selectedMappingNodeData.nodeType}</Tag><Typography.Text strong>{selectedMappingNodeData.label}</Typography.Text></Space>
              <div className="semantic-mapping-kv">
                <span>来源</span><strong>{selectedMappingNodeData.source_name ?? selectedMappingNodeData.object?.code ?? selectedMappingNodeData.object_code ?? '-'}</strong>
                <span>表</span><strong>{selectedMappingNodeData.entity_name ?? '-'}</strong>
                <span>字段</span><strong>{selectedMappingNodeData.field_name ?? selectedMappingNodeData.field?.code ?? '-'}</strong>
              </div>
              {Array.isArray(selectedMappingNodeData.sample_values) && selectedMappingNodeData.sample_values.length ? (
                <div>
                  <Typography.Text type="secondary">样例值</Typography.Text>
                  <Space wrap style={{ marginTop: 8 }}>
                    {selectedMappingNodeData.sample_values.slice(0, 6).map((item: unknown, index: number) => <Tag key={index}>{String(item)}</Tag>)}
                  </Space>
                </div>
              ) : null}
              <pre className="ontology-payload-preview">{JSON.stringify(selectedMappingNodeData, null, 2)}</pre>
            </Space>
          ) : (
            <Empty description="点击节点或连线查看详情；从来源字段拖线到对象字段可创建候选" />
          )}
        </Card>
      </aside>
    </div>
  );
}
