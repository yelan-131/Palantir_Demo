import { AimOutlined, ArrowRightOutlined, EditOutlined, ReloadOutlined } from '@/components/Icon/ant';
import { Alert, Button, Card, Empty, Segmented, Select, Spin, Tag, Typography, message } from 'antd';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  listObjectRecords, loadObjectTypes, objectRuntimeError, objectTypeId, readObjectRecordForEdit, updateObjectRecord,
  type ObjectRecord, type RelationshipObjectEditSnapshot, type RelationshipRecordMetadata, type RuntimeObjectType,
} from '../../services/objectRuntime';
import { CHART_SERIES_COLORS } from '../../theme/charts';
import { MANUFACTURING_MATCH_TYPES } from './manufacturingMatch';
import RelationshipMap from './RelationshipMap';
import RelationshipNodePreview, { relationshipPropertyLabel, relationshipValue, type RelationshipCardMatch } from './RelationshipNodePreview';
import { RELATIONSHIP_OBJECT_EDITOR_FORM_ID } from './RelationshipObjectEditor';
import RelationshipObjectWiki from './RelationshipObjectWiki';
import {
  loadRelationshipGraph, loadRelationshipOverview, relationshipNodeId, renameRelationshipNode,
  type RelationshipGraph, type RelationshipNode,
} from './relationshipGraph';
import { loadRelationshipMatchEvidence, type RelationshipMatchEvidence } from './relationshipMatchEvidence';
import { buildRelationshipCandidateEdges } from './relationshipCandidateEdges';
import { useRelationshipSimilarityScene } from './relationshipSimilarityScene';
import './relationshipExplorer.css';

type RelationshipDepth = 'all' | 1 | 2;
type NodeHover = { id: string; x: number; y: number };
const retiredGraphParams = ['axisType', 'axisX', 'axisY', 'axisZ', 'matchSource'];
const previewCloseDelay = 450;

function normalizeRecordMetadata(metadata: RelationshipRecordMetadata): RelationshipRecordMetadata {
  return {
    tags: metadata.tags && [...new Set(metadata.tags.map(tag => tag.trim()).filter(Boolean))],
    properties: metadata.properties.map(({ id, name, value }) => ({ id, name: name.trim(), value })),
    property_labels: Object.fromEntries(Object.entries(metadata.property_labels ?? {}).sort(([left], [right]) => left.localeCompare(right))),
  };
}

export default function RelationshipExplorer({ isAdmin }: { isAdmin: boolean }) {
  const [params, setParams] = useSearchParams();
  const legacyMatching = params.get('explore') === 'matching';
  const [catalogResult, setCatalogResult] = useState<{ revision: number; items: RuntimeObjectType[] }>();
  const [catalogError, setCatalogError] = useState('');
  const [records, setRecords] = useState<ObjectRecord[]>([]);
  const [recordsType, setRecordsType] = useState<number>();
  const [firstRecord, setFirstRecord] = useState<{ typeId: number; key: string }>();
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordsError, setRecordsError] = useState('');
  const [recordSearch, setRecordSearch] = useState('');
  const [revision, setRevision] = useState(0);
  const [recordRevision, setRecordRevision] = useState(0);
  const [loaded, setLoaded] = useState<{ request: string; graph?: RelationshipGraph; error?: string }>();
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [selectedEdgeId, setSelectedEdgeId] = useState<string>();
  const [editSession, setEditSession] = useState<{
    nodeId: string;
    snapshot?: RelationshipObjectEditSnapshot;
    recordMetadataDraft?: RelationshipRecordMetadata;
  }>();
  const [saving, setSaving] = useState(false);
  const editorRequest = useRef<AbortController>();
  const savePending = useRef(false);
  const [hover, setHover] = useState<NodeHover | null>(null);
  const previewCloseTimer = useRef<number>();
  const mapStage = useRef<HTMLDivElement>(null);
  const inspectorBody = useRef<HTMLDivElement>(null);
  const [matchEvidence, setMatchEvidence] = useState<{ graph: RelationshipGraph; byNode: ReadonlyMap<string, readonly RelationshipMatchEvidence[]> }>();
  const [resetSignal, setResetSignal] = useState(0);

  const catalog = catalogResult?.revision === revision ? catalogResult.items : undefined;
  const models = useMemo(() => (catalog ?? []).filter(item => item.status === 'published'
    && (item.record_bound ?? Boolean(item.record_binding))), [catalog]);
  const requestedType = params.get('objectType');
  const requestedKey = params.get('objectKey');
  const retiredStart = /^-[1-9]\d*$/.test(requestedType ?? '');
  const resetScope = retiredStart || params.get('matchSource') === 'demo';
  const requestedDepth = resetScope ? 'all' : params.get('relationDepth');
  const depth: RelationshipDepth = requestedDepth === 'all' ? 'all' : requestedDepth === '1' ? 1
    : requestedDepth === '2' || requestedType || requestedKey ? 2 : 'all';
  const overview = depth === 'all';
  const model = overview ? undefined : requestedType
    ? models.find(item => String(objectTypeId(item)) === requestedType || item.code === requestedType) : models[0];
  const typeId = model && objectTypeId(model);
  const typeName = model?.name;
  const key = model ? requestedKey ?? (typeId === firstRecord?.typeId ? firstRecord?.key : undefined) : undefined;
  const rootId = typeId && key ? relationshipNodeId(typeId, key) : undefined;
  const request = overview && catalog ? `overview:${revision}` : rootId ? `${rootId}:${depth}:${revision}` : undefined;
  const current = loaded?.request === request ? loaded : undefined;
  const liveGraph = current?.graph;
  const graphError = catalogError || (!overview && recordsError) || current?.error;
  const graph = liveGraph?.nodes.length ? liveGraph : undefined;
  const activeGraphRequest = useRef(request);

  useLayoutEffect(() => {
    activeGraphRequest.current = request;
    return () => { activeGraphRequest.current = undefined; };
  }, [request]);

  useEffect(() => {
    if (!retiredStart && !legacyMatching && !retiredGraphParams.some(name => params.has(name))) return;
    setParams(previous => {
      const next = new URLSearchParams(previous);
      if (legacyMatching) next.delete('explore');
      for (const name of retiredGraphParams) next.delete(name);
      if (retiredStart) {
        next.delete('objectType');
        next.delete('objectKey');
      }
      if (resetScope) next.set('relationDepth', 'all');
      return next;
    }, { replace: true });
  }, [legacyMatching, params, resetScope, retiredStart, setParams]);

  useEffect(() => {
    const controller = new AbortController();
    setCatalogError('');
    loadObjectTypes(controller.signal).then(response => {
      if (!controller.signal.aborted) setCatalogResult({ revision, items: response.data.data });
    }).catch(error => {
      if (!controller.signal.aborted) setCatalogError(objectRuntimeError(error, '无法读取对象目录。'));
    });
    return () => controller.abort();
  }, [revision]);

  useEffect(() => {
    if (!typeId) return;
    const controller = new AbortController();
    const query = recordSearch.trim();
    setRecordsLoading(true);
    setRecordsError('');
    const timer = window.setTimeout(() => {
      listObjectRecords(typeId, { q: query || undefined, page: 1, page_size: 30 }, controller.signal).then(response => {
        const items = response.data.data.items;
        setRecords(items);
        setRecordsType(typeId);
        if (!query) setFirstRecord(items[0] ? { typeId, key: items[0].key } : undefined);
      }).catch(error => {
        if (!controller.signal.aborted) setRecordsError(objectRuntimeError(error, '无法读取该类型的对象记录。'));
      }).finally(() => {
        if (!controller.signal.aborted) setRecordsLoading(false);
      });
    }, query ? 250 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [typeId, recordSearch, revision, recordRevision]);

  useEffect(() => {
    if (!request) return;
    const controller = new AbortController();
    const result = depth === 'all' ? loadRelationshipOverview(models, controller.signal)
      : typeId && typeName && key ? loadRelationshipGraph({ typeId, typeName, key }, depth, controller.signal) : undefined;
    if (!result) return;
    result.then(graphResult => {
      if (!controller.signal.aborted) setLoaded({ request, graph: graphResult });
    }).catch(error => {
      if (!controller.signal.aborted) setLoaded({ request, error: objectRuntimeError(error, depth === 'all'
        ? '无法读取业务对象关系。' : '无法读取起点对象的关系。') });
    });
    return () => controller.abort();
  }, [models, typeId, typeName, key, depth, request, recordRevision]);

  useEffect(() => {
    if (!liveGraph) return;
    const controller = new AbortController();
    loadRelationshipMatchEvidence(liveGraph, models, controller.signal).then(byNode => {
      if (!controller.signal.aborted) setMatchEvidence({ graph: liveGraph, byNode });
    }).catch(() => {});
    return () => controller.abort();
  }, [liveGraph, models]);

  const visibleRecords = recordsType === typeId ? records : [];
  const recordOptions = visibleRecords.map(item => ({ value: item.key, label: item.key }));
  if (key && !recordOptions.some(item => item.value === key)) recordOptions.unshift({ value: key, label: key });
  const typeColors = useMemo(() => new Map(models.map((model, index) => [
    objectTypeId(model), CHART_SERIES_COLORS[index % CHART_SERIES_COLORS.length],
  ])), [models]);
  const graphNodes = useMemo(() => graph?.nodes.map(node => ({
    id: node.id, label: node.key, color: typeColors.get(node.typeId) ?? CHART_SERIES_COLORS[0],
  })) ?? [], [graph, typeColors]);
  const graphEvidence = matchEvidence?.graph === liveGraph ? matchEvidence?.byNode : undefined;
  const candidateEdges = useMemo(() => graph ? buildRelationshipCandidateEdges(graph, graphEvidence) : [], [graph, graphEvidence]);
  const graphEdges = useMemo(() => [...(graph?.edges ?? []), ...candidateEdges.map(item => item.edge)], [graph, candidateEdges]);
  const { positions, nearby } = useRelationshipSimilarityScene(graph?.nodes, models);
  const nodesById = new Map(graph?.nodes.map(node => [node.id, node]));
  const selectedEdge = graphEdges.find(edge => edge.id === selectedEdgeId);
  const selectedNode = nodesById.get(selectedNodeId ?? '') ?? nodesById.get(graph?.rootId ?? '');
  const editor = editSession?.nodeId === selectedNode?.id ? editSession : undefined;
  const editLocked = Boolean(editor) || saving;
  const hoveredNode = hover ? nodesById.get(hover.id) : undefined;
  const hoveredNeighbor = hoveredNode && nearby(hoveredNode.id)[0];
  const incidentEdges = graphEdges.filter(edge => edge.source === selectedNode?.id || edge.target === selectedNode?.id);
  const relatedTypes = new Map(graph?.nodes.map(node => [node.typeId, node.typeName]));
  const selectedModel = models.find(item => objectTypeId(item) === selectedNode?.typeId);
  const selectedCandidate = candidateEdges.find(item => item.edge.id === selectedEdge?.id)?.match;
  const edgeSource = selectedEdge && nodesById.get(selectedEdge.source);
  const edgeTarget = selectedEdge && nodesById.get(selectedEdge.target);
  const edgeFieldLabel = (code: string, node?: RelationshipNode) =>
    relationshipPropertyLabel(code, models.find(item => objectTypeId(item) === node?.typeId));

  useEffect(() => {
    inspectorBody.current?.scrollTo({ top: 0 });
  }, [selectedNode?.id, selectedEdge?.id]);

  useEffect(() => () => {
    editorRequest.current?.abort();
    window.clearTimeout(previewCloseTimer.current);
  }, []);

  useEffect(() => {
    if (!hover) return;
    function dismissOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      window.clearTimeout(previewCloseTimer.current);
      setHover(null);
    }
    window.addEventListener('keydown', dismissOnEscape);
    return () => window.removeEventListener('keydown', dismissOnEscape);
  }, [hover]);

  useEffect(() => {
    if (!editSession || editor) return;
    editorRequest.current?.abort();
    setEditSession(undefined);
  }, [editSession, editor]);

  function nodeMatches(id: string): RelationshipCardMatch[] {
    return graphEvidence?.get(id)?.map(({ result, fit }) => ({ status: result.status, checks: result.checks, context: fit.key })) ?? [];
  }
  const wikiNeighbors = incidentEdges.flatMap(edge => {
    const outgoing = edge.source === selectedNode?.id;
    const node = nodesById.get(outgoing ? edge.target : edge.source);
    return node ? [{ node, label: edge.label, edgeId: edge.id, kind: edge.kind,
      direction: outgoing ? 'outgoing' : 'incoming' } as const] : [];
  });
  const trialModel = models.find(item => item.code === MANUFACTURING_MATCH_TYPES.trial.code);
  const graphTrials = trialModel ? [...new Map(wikiNeighbors.filter(({ node }) => node.typeId === objectTypeId(trialModel))
    .map(({ node }) => [node.id, { key: node.key, values: node.values, bindingForm: node.bindingForm }])).values()] : undefined;
  const selectedEvidence = selectedNode ? graphEvidence?.get(selectedNode.id) : undefined;
  const soleEvidence = selectedEvidence?.length === 1 ? selectedEvidence[0] : undefined;
  const wikiTrials = selectedNode?.id === soleEvidence?.participants.material.id ? soleEvidence?.trials : graphTrials;

  function keepPreviewOpen() {
    window.clearTimeout(previewCloseTimer.current);
  }

  function closePreview() {
    keepPreviewOpen();
    setHover(null);
  }

  function updatePreview(node: NodeHover | null) {
    keepPreviewOpen();
    if (node) setHover(node);
    else previewCloseTimer.current = window.setTimeout(closePreview, previewCloseDelay);
  }

  function clearSelection() {
    setSelectedNodeId(undefined);
    setSelectedEdgeId(undefined);
    closePreview();
  }

  function setStart(id: number, recordKey?: string) {
    setRecordSearch('');
    clearSelection();
    setParams(previous => {
      const next = new URLSearchParams(previous);
      next.set('view', 'graph');
      if (overview) next.set('relationDepth', '2');
      next.set('objectType', String(id));
      if (recordKey) next.set('objectKey', recordKey);
      else next.delete('objectKey');
      return next;
    });
  }

  function selectDepth(nextDepth: RelationshipDepth) {
    const start = overview && nextDepth !== 'all'
      ? selectedNode ?? (requestedType || requestedKey ? undefined : graph?.nodes[0]) : undefined;
    setRecordSearch('');
    clearSelection();
    setParams(previous => {
      const next = new URLSearchParams(previous);
      next.set('relationDepth', String(nextDepth));
      if (start) {
        next.set('objectType', String(start.typeId));
        next.set('objectKey', start.key);
      }
      return next;
    });
  }

  function selectNode(id: string) {
    if (editLocked) return;
    setSelectedNodeId(id);
    setSelectedEdgeId(undefined);
    closePreview();
  }

  function selectEdge(id: string) {
    if (editLocked) return;
    const edge = graphEdges.find(item => item.id === id);
    if (!edge) return;
    if (selectedNode?.id !== edge.source && selectedNode?.id !== edge.target) setSelectedNodeId(edge.source);
    setSelectedEdgeId(id);
    closePreview();
  }

  function cancelEdit() {
    editorRequest.current?.abort();
    setEditSession(undefined);
  }

  async function startEdit(node: RelationshipNode) {
    if (editLocked) return;
    editorRequest.current?.abort();
    closePreview();
    const controller = new AbortController();
    editorRequest.current = controller;
    setEditSession({ nodeId: node.id });
    try {
      const { data: { data: snapshot } } = await readObjectRecordForEdit(node.typeId, node.key, controller.signal);
      if (controller.signal.aborted) return;
      if (!snapshot.fields.length && !snapshot.record_metadata) {
        setEditSession(undefined);
        message.info('此对象没有可编辑的属性。');
        return;
      }
      const fields = snapshot.fields.map(field => {
        const label = relationshipPropertyLabel(field.code, selectedModel);
        return { ...field, label: label === field.code ? field.label : label };
      });
      setEditSession({ nodeId: node.id, snapshot: { ...snapshot, fields }, recordMetadataDraft: snapshot.record_metadata });
    } catch (error) {
      if (controller.signal.aborted) return;
      setEditSession(undefined);
      message.error(objectRuntimeError(error, '无法读取对象编辑信息。'));
    }
  }

  async function saveEdit(data: Record<string, unknown>, expectedValues: Record<string, unknown>) {
    if (!selectedNode || !editor?.snapshot || savePending.current) return;
    const original = editor.snapshot.record_metadata;
    const pending = editor.recordMetadataDraft && normalizeRecordMetadata(editor.recordMetadataDraft);
    if (pending?.properties.some(property => !property.name)) {
      message.warning('请填写自定义属性的名称。');
      return;
    }
    const metadata = original && pending && JSON.stringify(pending) !== JSON.stringify(normalizeRecordMetadata(original))
      ? { record_metadata: pending, expected_record_metadata: original } : undefined;
    if (!Object.keys(data).length && !metadata) {
      cancelEdit();
      return;
    }
    savePending.current = true;
    setSaving(true);
    try {
      const { data: { data: saved } } = await updateObjectRecord(selectedNode.typeId, selectedNode.key, editor.snapshot.token, data, expectedValues, metadata);
      if (activeGraphRequest.current !== request) return;
      if (saved.key !== selectedNode.key) {
        const nextId = relationshipNodeId(selectedNode.typeId, saved.key);
        const isRoot = rootId === selectedNode.id;
        const nextRequest = isRoot ? `${nextId}:${depth}:${revision}` : request;
        setLoaded(previous => previous?.request === request && previous?.graph && nextRequest
          ? { ...previous, request: nextRequest, graph: renameRelationshipNode(previous.graph, selectedNode, saved.key, data) }
          : previous);
        setSelectedNodeId(nextId);
        setSelectedEdgeId(undefined);
        const isStoredStart = requestedKey === selectedNode.key && (!requestedType
          || requestedType === String(selectedNode.typeId) || requestedType === selectedModel?.code);
        if (isRoot || isStoredStart) setParams(previous => {
          const next = new URLSearchParams(previous);
          next.set('objectKey', saved.key);
          return next;
        }, { replace: true });
      }
      setEditSession(undefined);
      setRecordRevision(value => value + 1);
      message.success('对象记录已保存');
    } catch (error) {
      message.error(objectRuntimeError(error, '对象记录保存失败。'));
    } finally {
      savePending.current = false;
      setSaving(false);
    }
  }

  return <div className="relationship-explorer">
    <div className="relationship-explorer-toolbar">
      <div className="relationship-explorer-controls">
        <Segmented<RelationshipDepth> aria-label="关系范围" value={depth} disabled={editLocked} onChange={selectDepth}
          options={[{ value: 'all', label: '全部' }, { value: 1, label: '一层关系' }, { value: 2, label: '两层关系' }]} />
        {!overview && <><label>起点对象类型<Select aria-label="起点对象类型" value={typeId} placeholder="选择对象类型" showSearch optionFilterProp="label" disabled={editLocked}
          loading={!catalog && !catalogError} options={models.map(item => ({ value: objectTypeId(item), label: item.name }))}
          onChange={id => setStart(id)} /></label>
        <label>起点记录<Select aria-label="起点记录" value={key} placeholder="搜索对象标识" showSearch filterOption={false}
          searchValue={recordSearch} onSearch={setRecordSearch} loading={Boolean(typeId && recordsLoading)} disabled={typeId === undefined || editLocked}
          options={recordOptions} onChange={value => { if (typeId) setStart(typeId, value); }} /></label></>}
      </div>
      <div className="relationship-explorer-controls">
        <Button icon={<ReloadOutlined />} disabled={editLocked} onClick={() => {
          closePreview();
          setRevision(value => value + 1);
        }}>刷新关系</Button>
        <Button icon={<AimOutlined />} disabled={!graph} onClick={() => {
          closePreview();
          setResetSignal(value => value + 1);
        }}>重置视角</Button>
      </div>
    </div>
    {graphError && <Alert type="error" showIcon message={graphError} />}
    {liveGraph && (liveGraph.truncated || liveGraph.failedExpansions > 0 || liveGraph.unresolvedRelations > 0) && <Alert type="info" showIcon message={[
      liveGraph.truncated && (overview ? '当前全览仅展示部分对象或关系，可选择起点查看局部关系' : '当前图中仅展示部分关联，选择其他起点可继续探索'),
      liveGraph.failedExpansions > 0 && (overview ? '部分对象或关系读取失败' : `${liveGraph.failedExpansions} 个对象的下级关系读取失败`),
      liveGraph.unresolvedRelations > 0 && `${liveGraph.unresolvedRelations} 组关系没有可展示的匹配记录`,
    ].filter(Boolean).join('。')} />}
    {!graphError && !graph && <Card>
      {(!catalog || (request && !current) || (typeId && (recordsLoading || recordsType !== typeId)))
        ? <div className="relationship-explorer-loading"><Spin /></div>
        : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={overview ? '暂无可查看的业务对象记录' : key ? '当前起点记录不可浏览' : typeId !== undefined ? '暂无可查看的对象记录' : requestedType ? '当前对象类型不可浏览' : '请选择起点对象类型'}>
          {isAdmin && !models.length && <Link to="?view=ontology">前往模型设计</Link>}
        </Empty>}
    </Card>}
    {graph && <div className="relationship-explorer-board">
        <section className="relationship-explorer-main" aria-label="对象关系图">
          <div className="relationship-explorer-caption">
            <Typography.Text strong>对象关系图</Typography.Text>
            <Typography.Text type="secondary">{graphNodes.length} 个对象 · {graph.edges.length} 条记录关系{candidateEdges.length > 0 ? ` · ${candidateEdges.length} 条候选` : ''}</Typography.Text>
          </div>
          <div className="relationship-explorer-map" ref={mapStage}>
            <RelationshipMap key={graph.rootId} nodes={graphNodes} edges={graphEdges} selectedNodeId={selectedNode?.id}
              positions={positions} selectedEdgeId={selectedEdge?.id} onSelectNode={selectNode} onSelectEdge={selectEdge}
              resetSignal={resetSignal} onHoverNode={updatePreview} />
            {hover && hoveredNode && <RelationshipNodePreview key={hoveredNode.id} node={hoveredNode} anchor={hover} stage={mapStage}
              model={models.find(item => objectTypeId(item) === hoveredNode.typeId)} matches={nodeMatches(hoveredNode.id)}
              links={graphEdges.filter(edge => edge.source === hoveredNode.id || edge.target === hoveredNode.id).length}
              comparison={hoveredNeighbor}
              onPointerEnter={keepPreviewOpen} onPointerLeave={() => updatePreview(null)} />}
          </div>
          <div className="relationship-explorer-legend">
            {[...relatedTypes].map(([id, name]) => <span key={id}><i style={{ backgroundColor: typeColors.get(id) ?? CHART_SERIES_COLORS[0] }} />{name}</span>)}
            {graph.edges.length > 0 && <span><i className="relationship-legend-line" />记录关系</span>}
            {candidateEdges.length > 0 && <span><i className="relationship-legend-line relationship-legend-line--candidate" />候选关系</span>}
            <span className="relationship-explorer-help">悬停预览 · 点击在侧栏查看 · 左拖旋转 · 右拖平移 · 中键上下拖动或滚轮缩放</span>
          </div>
        </section>
        <aside className="relationship-explorer-inspector" aria-label="关系图详情">
          <div className="relationship-explorer-inspector-toolbar">
            <Typography.Text strong>{selectedEdge ? '连线详情' : '属性'}</Typography.Text>
            {selectedNode && !selectedEdge && <div className="relationship-explorer-inspector-actions">{editor ? <>
              <Button disabled={saving} onClick={cancelEdit}>取消</Button>
              <Button type="primary" htmlType="submit" form={RELATIONSHIP_OBJECT_EDITOR_FORM_ID}
                loading={saving || !editor.snapshot} disabled={!editor.snapshot}>保存</Button>
            </> : <Button icon={<EditOutlined />} onClick={() => void startEdit(selectedNode)}>编辑</Button>}</div>}
          </div>
          <div className="relationship-explorer-inspector-body" ref={inspectorBody}>
            {selectedEdge && <section className="relationship-explorer-selected-edge" aria-label="当前连线">
              <header><Typography.Text strong>{selectedEdge.label}</Typography.Text>
                <Tag color={selectedEdge.kind === 'candidate' ? 'gold' : undefined}>{selectedEdge.kind === 'candidate' ? '候选' : '记录关系'}</Tag>
              </header>
              <div className="relationship-explorer-endpoints">
                {edgeSource && <Button type="link" size="small" onClick={() => selectNode(edgeSource.id)}>{edgeSource.key}</Button>}
                <ArrowRightOutlined />
                {edgeTarget && <Button type="link" size="small" onClick={() => selectNode(edgeTarget.id)}>{edgeTarget.key}</Button>}
              </div>
              {selectedCandidate ? <>
                <Typography.Text type="secondary">适配方案 {selectedCandidate.fit.key}</Typography.Text>
                <ul aria-label="规则依据">
                  {selectedCandidate.result.checks.map(check => <li key={check.code}><strong>{check.label}</strong><div>{check.explanation}</div></li>)}
                </ul>
              </> : selectedEdge.evidence ? <dl aria-label="匹配依据">
                <dt>来源 · {edgeFieldLabel(selectedEdge.evidence.sourceField, edgeSource)}</dt>
                <dd>{relationshipValue(selectedEdge.evidence.sourceValue)}</dd>
                <dt>目标 · {edgeFieldLabel(selectedEdge.evidence.targetField, edgeTarget)}</dt>
                <dd>{relationshipValue(selectedEdge.evidence.targetValue)}</dd>
              </dl> : <Typography.Text type="secondary">暂无可查看的匹配字段和值</Typography.Text>}
            </section>}
            {selectedNode ? <RelationshipObjectWiki key={selectedNode.id} node={selectedNode} model={selectedModel}
              related={wikiNeighbors} onOpenRelated={selectNode} onSelectRelationship={selectEdge}
              comparisons={nearby(selectedNode.id)}
              matches={nodeMatches(selectedNode.id)} trials={wikiTrials} selectedTrialKey={soleEvidence?.result.selectedTrial?.key}
              editSnapshot={editor?.snapshot} onSubmitEdit={editor?.snapshot ? saveEdit : undefined} saving={saving}
              recordMetadataDraft={editor?.recordMetadataDraft} onRecordMetadataChange={draft => {
                setEditSession(session => session?.nodeId === selectedNode.id ? { ...session, recordMetadataDraft: draft } : session);
              }} />
              : <Typography.Text type="secondary">点击图中对象查看卡片</Typography.Text>}
          </div>
        </aside>
      </div>}
  </div>;
}
