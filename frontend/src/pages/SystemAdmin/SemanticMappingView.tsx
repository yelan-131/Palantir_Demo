import 'reactflow/dist/style.css';
import './semanticMappingSources.css';
import { createContext, useContext, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { EllipsisOutlined, ReloadOutlined, RobotOutlined } from '@/components/Icon/ant';
import { Button, Card, Dropdown, Empty, Input, List, Modal, Progress, Select, Space, Tag, Typography, type MenuProps } from 'antd';
import ReactFlow, { Background, Controls, Handle, MiniMap, Position, applyEdgeChanges, applyNodeChanges, type Connection, type Edge, type EdgeChange, type Node, type NodeChange, type NodeProps } from 'reactflow';
import type { NavigateFunction } from 'react-router-dom';
import type { OntologyCandidateInfo, SemanticMappingWorkbenchResponse } from '../../services/api';
import { SEMANTIC_MAPPING_STATUS_OPTIONS, semanticNodeTypeLabels, type DataAsset, type OntologyObject } from './semanticAssetShared';

const SourceMenu = createContext<(nodeId: string) => MenuProps | undefined>(() => undefined);

function SourceActionButton({ menu, label }: { menu: MenuProps; label: string }) {
  return (
    <Dropdown menu={menu} trigger={['click']}>
      <Button
        type="text"
        size="small"
        className="semantic-source-action nodrag nopan"
        icon={<EllipsisOutlined />}
        aria-label={`${label}的操作`}
        onClick={(event) => event.stopPropagation()}
      />
    </Dropdown>
  );
}

function SemanticMappingFlowNode({ id, data }: NodeProps) {
  const nodeType = String(data?.nodeType ?? '');
  const sourceMenu = useContext(SourceMenu)(id);
  const canReceive = nodeType === 'object' || nodeType === 'object_field';
  const canSource = nodeType === 'source_table' || nodeType === 'source_field' || nodeType === 'object';
  const content = (
    <div className={`semantic-flow-node semantic-flow-node-${nodeType}${sourceMenu ? ' semantic-flow-node-actionable' : ''}`}>
      {canReceive ? <Handle type="target" position={Position.Left} /> : null}
      <div className="semantic-flow-node-kicker">{semanticNodeTypeLabels[nodeType] ?? nodeType}</div>
      <strong>{data?.label}</strong>
      {data?.subtitle ? <small>{data.subtitle}</small> : null}
      {sourceMenu && <SourceActionButton menu={sourceMenu} label={String(data.label)} />}
      {canSource ? <Handle type="source" position={Position.Right} /> : null}
    </div>
  );
  return sourceMenu ? <Dropdown menu={sourceMenu} trigger={['contextMenu']}>{content}</Dropdown> : content;
}

type SemanticMappingScope = {
  assets: DataAsset[];
  objects: OntologyObject[];
  mappingObjectCode: string | undefined;
  setMappingObjectCode: Dispatch<SetStateAction<string | undefined>>;
  mappingSourceId: number | undefined;
  setMappingSourceId: Dispatch<SetStateAction<number | undefined>>;
  requestedTableName?: string;
  mappingStatus: string;
  setMappingStatus: Dispatch<SetStateAction<string>>;
  recognizing: boolean;
  runSemanticMappingRecognition: () => Promise<void>;
  navigate: NavigateFunction;
  openCandidateReview: (candidateId: number) => void;
  createObjectFromTable?: (sourceTable: Node) => void;
  createPropertyFromField?: (sourceField: Node) => void;
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
  connectSourceField?: (source: Node, target: Node) => Promise<boolean | void>;
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
    requestedTableName,
    mappingStatus,
    setMappingStatus,
    recognizing,
    runSemanticMappingRecognition,
    navigate,
    openCandidateReview,
    createObjectFromTable,
    createPropertyFromField,
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
    connectSourceField,
    selectedMappingElement,
    setSelectedMappingElement,
  } = canvas;
  const semanticFlowNodeTypes = useMemo(() => ({ semantic: SemanticMappingFlowNode }), []);
  const [sourceTableId, setSourceTableId] = useState<string>();
  const [fieldSearch, setFieldSearch] = useState('');
  const [sourceToMap, setSourceToMap] = useState<Node>();
  const [targetFieldId, setTargetFieldId] = useState<string>();
  const [creatingMapping, setCreatingMapping] = useState(false);
  const nodeById = useMemo(() => new Map(mappingNodes.map((node) => [node.id, node])), [mappingNodes]);
  const tableById = useMemo(() => new Map((mappingWorkbench?.metadata ?? []).map((table) => [
    `source-table:${table.source_id}:${table.entity_name}`, table,
  ])), [mappingWorkbench]);
  const requestedTableId = requestedTableName
    ? Array.from(tableById).find(([, table]) => table.entity_name === requestedTableName)?.[0]
    : undefined;
  const selectedTableId = sourceTableId && tableById.has(sourceTableId)
    ? sourceTableId
    : requestedTableId ?? tableById.keys().next().value;
  const selectedTable = selectedTableId ? tableById.get(selectedTableId) : undefined;
  const targetFields = mappingNodes.filter((node) => node.data?.nodeType === 'object_field'
    && node.data?.object_code === (mappingObjectCode ?? mappingWorkbench?.object_code));
  const targetObject = objects.find((item) => item.code === (mappingObjectCode ?? mappingWorkbench?.object_code));
  const selectedMappingCandidate = (selectedMappingElement?.data as any)?.candidate as OntologyCandidateInfo | undefined;
  const selectedMappingNodeData = selectedMappingElement && !('source' in selectedMappingElement)
    ? selectedMappingElement.data as Record<string, any>
    : undefined;

  useEffect(() => {
    setSourceTableId(undefined);
    setFieldSearch('');
  }, [mappingSourceId, requestedTableName]);

  function sourceActions(node: Node): MenuProps | undefined {
    if (node.data?.nodeType === 'source_table' && createObjectFromTable) {
      return {
        items: [{ key: 'create-object', label: '从此表新建对象' }],
        onClick: () => createObjectFromTable({
          ...node,
          data: { ...node.data, fields: tableById.get(node.id)?.fields ?? [] },
        }),
      };
    }
    if (node.data?.nodeType !== 'source_field') return undefined;
    const canConnect = Boolean(targetFields.length && (connectSourceField || nodeById.has(node.id)));
    return {
      items: [
        { key: 'map', label: '映射到已有属性', disabled: !canConnect },
        ...(createPropertyFromField ? [{ key: 'create-property', label: '新建对象属性并映射', disabled: !targetObject }] : []),
      ],
      onClick: ({ key }) => {
        if (key === 'create-property') createPropertyFromField?.(node);
        else {
          setSourceToMap(node);
          setTargetFieldId(undefined);
        }
      },
    };
  }

  async function submitMapping() {
    const target = targetFields.find((node) => node.id === targetFieldId);
    if (!sourceToMap || !target || creatingMapping) return;
    setCreatingMapping(true);
    try {
      const created = connectSourceField
        ? await connectSourceField(sourceToMap, target)
        : await connectSemanticMapping({ source: sourceToMap.id, target: target.id, sourceHandle: null, targetHandle: null });
      if (created !== false) setSourceToMap(undefined);
    } finally {
      setCreatingMapping(false);
    }
  }

  const fieldQuery = fieldSearch.trim().toLowerCase();
  const sourceTableNode = selectedTableId ? nodeById.get(selectedTableId) : undefined;
  const tableMenu = sourceTableNode ? sourceActions(sourceTableNode) : undefined;
  const fieldItems = (selectedTable?.fields ?? []).flatMap((field) => {
    if (typeof field.name !== 'string' || !field.name) return [];
    const name = field.name;
    const label = typeof field.label === 'string' && field.label ? field.label : name;
    return `${label} ${name}`.toLowerCase().includes(fieldQuery) ? [{ name, label, field }] : [];
  });

  return (
    <div className="semantic-mapping-workbench">
      <aside className="semantic-mapping-sidebar">
        <Card
          className="semantic-side-card"
          title="来源数据"
          extra={<Button size="small" icon={<ReloadOutlined />} loading={mappingLoading} onClick={loadSemanticMappingWorkbench}>刷新</Button>}
        >
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Select
              aria-label="选择数据来源"
              allowClear
              value={mappingSourceId}
              placeholder="全部数据源"
              style={{ width: '100%' }}
              showSearch
              optionFilterProp="label"
              options={assets.filter((item) => item.persisted && item.id > 0).map((item) => ({ value: item.id, label: item.name }))}
              onChange={setMappingSourceId}
            />
            <Dropdown menu={tableMenu} trigger={['contextMenu']} disabled={!tableMenu}>
              <div className="semantic-source-list-heading">
                <Select
                  aria-label="选择来源表"
                  value={selectedTableId}
                  placeholder="选择来源表"
                  className="semantic-source-table-select"
                  showSearch
                  optionFilterProp="label"
                  options={Array.from(tableById, ([value, table]) => ({
                    value,
                    label: `${table.entity_label || table.entity_name} · ${nodeById.get(value)?.data?.source_name ?? table.source_id}`,
                  }))}
                  onChange={(value) => {
                    setSourceTableId(value);
                    setFieldSearch('');
                  }}
                />
                {tableMenu && selectedTable && <SourceActionButton menu={tableMenu} label={selectedTable.entity_label || selectedTable.entity_name} />}
              </div>
            </Dropdown>
            {selectedTable && selectedTableId ? (
              <>
                <Input aria-label="搜索来源字段" placeholder="搜索来源字段" allowClear value={fieldSearch} onChange={(event) => setFieldSearch(event.target.value)} />
                <List
                  className="semantic-source-field-list"
                  size="small"
                  dataSource={fieldItems}
                  rowKey="name"
                  locale={{ emptyText: '没有匹配的来源字段' }}
                  renderItem={({ name, label, field }) => {
                    const id = `source-field:${selectedTable.source_id}:${selectedTable.entity_name}.${name}`;
                    const node = nodeById.get(id) ?? {
                      id,
                      position: { x: 0, y: 0 },
                      data: {
                        nodeType: 'source_field',
                        label,
                        source_id: selectedTable.source_id,
                        source_name: sourceTableNode?.data?.source_name ?? String(selectedTable.source_id),
                        source_type: selectedTable.source_type,
                        entity_name: selectedTable.entity_name,
                        field_name: name,
                        field,
                      },
                    };
                    const menu = sourceActions(node);
                    return (
                      <List.Item>
                        <Dropdown menu={menu} trigger={['contextMenu']} disabled={!menu}>
                          <div className="semantic-source-field-row">
                            <Button type="text" className="semantic-source-field-select" title={name} onClick={() => setSelectedMappingElement(node)}>{label}</Button>
                            {menu && <SourceActionButton menu={menu} label={label} />}
                          </div>
                        </Dropdown>
                      </List.Item>
                    );
                  }}
                />
              </>
            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={mappingLoading ? '正在读取来源表' : '暂无已扫描的来源表'} />}
          </Space>
        </Card>
      </aside>

      <main className="semantic-mapping-canvas-panel">
        <Card
          className="semantic-mapping-canvas-card"
          title={
            <Space direction="vertical" size={2}>
              <Typography.Text strong>字段映射画布</Typography.Text>
              <Typography.Text type="secondary">右键来源字段或拖线创建映射候选，审核通过后生效。</Typography.Text>
            </Space>
          }
          extra={(
            <Space wrap>
              <Select
                aria-label="选择目标对象"
                value={mappingObjectCode}
                placeholder="选择目标对象"
                className="semantic-mapping-target-select"
                showSearch
                optionFilterProp="label"
                options={objects.map((item) => ({ value: item.code, label: `${item.name} / ${item.code}` }))}
                onChange={setMappingObjectCode}
              />
              <Select
                aria-label="筛选映射状态"
                value={mappingStatus}
                options={SEMANTIC_MAPPING_STATUS_OPTIONS.map((option) => option.value ? option : { ...option, label: '全部状态' })}
                onChange={setMappingStatus}
              />
            </Space>
          )}
        >
          <div className="semantic-mapping-canvas-actions">
            <Space wrap>
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
          </div>
          <div className="semantic-mapping-canvas">
            {mappingNodes.length ? (
              <SourceMenu.Provider value={(id) => {
                const node = nodeById.get(id);
                return node ? sourceActions(node) : undefined;
              }}>
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
              </SourceMenu.Provider>
            ) : (
              <Empty description={mappingLoading ? '正在加载字段映射' : '接入并扫描数据源后，可从来源表和字段开始建模'} />
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
            <Empty description="选择来源字段、对象属性或连线查看详情" />
          )}
        </Card>
      </aside>
      <Modal
        title="映射到已有属性"
        open={Boolean(sourceToMap)}
        onCancel={() => setSourceToMap(undefined)}
        onOk={() => void submitMapping()}
        confirmLoading={creatingMapping}
        okButtonProps={{ disabled: !targetFieldId }}
        okText="创建映射候选"
        cancelText="取消"
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Typography.Text>来源字段 {sourceToMap?.data?.entity_name}.{sourceToMap?.data?.field_name}</Typography.Text>
          <Typography.Text>目标对象 {targetObject?.name}</Typography.Text>
          <Select
            aria-label="选择目标属性"
            placeholder="选择目标属性"
            showSearch
            optionFilterProp="label"
            style={{ width: '100%' }}
            value={targetFieldId}
            onChange={setTargetFieldId}
            options={targetFields.map((node) => {
              const code = node.data?.field?.code;
              return {
                value: node.id,
                label: code && code !== node.data?.label ? `${node.data.label} · ${code}` : String(node.data?.label ?? code),
              };
            })}
          />
        </Space>
      </Modal>
    </div>
  );
}
