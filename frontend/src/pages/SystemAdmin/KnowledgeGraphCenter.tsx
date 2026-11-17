import { useEffect, useMemo, useRef, useState } from 'react';
import { NodeIndexOutlined, ReloadOutlined } from '@ant-design/icons';
import { Button, Card, Col, Empty, Input, Progress, Row, Segmented, Select, Space, Table, Tabs, Tag, Typography, message } from 'antd';
import cytoscape from 'cytoscape';
import dagre from 'cytoscape-dagre';
import { getGraphAssetQuality, listGraphAssetEvidence, listGraphAssetNodes, listGraphAssetRelationships } from '../../services/api';
import { GRAPH_DOCUMENT_ALIASES, confidencePercent, graphTypeColors, severityColors, type GraphAssetEvidence, type GraphAssetNode, type GraphAssetRelationship } from './semanticAssetShared';

cytoscape.use(dagre);

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

export function KnowledgeGraphCenterV2({ embedded = false, sourceDocumentId }: { embedded?: boolean; sourceDocumentId?: string } = {}) {
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
