import { AimOutlined, ArrowRightOutlined, EditOutlined, ReloadOutlined } from '@/components/Icon/ant';
import { Alert, Button, Card, Empty, Segmented, Select, Spin, Tag, Typography, message } from 'antd';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { getRelationshipQuery } from '../../components/AiChatWidget/relationshipQuery';
import {
  listObjectRecords, loadObjectTypes, objectRuntimeError, objectTypeId, readObjectRecordForEdit, updateObjectRecord,
  type ObjectRecord, type RelationshipObjectEditSnapshot, type RelationshipRecordMetadata, type RuntimeObjectType,
} from '../../services/objectRuntime';
import { CHART_SERIES_COLORS } from '../../theme/charts';
import { MANUFACTURING_MATCH_TYPES } from './manufacturingMatch';
import RelationshipMap from './RelationshipMap';
import { relationshipNodeLabel, relationshipPropertyLabel, relationshipValue, type RelationshipCardMatch } from './relationshipCardDetails';
import { RELATIONSHIP_OBJECT_EDITOR_FORM_ID } from './RelationshipObjectEditor';
import RelationshipObjectWiki from './RelationshipObjectWiki';
import {
  loadRelationshipGraph, loadRelationshipOverview, relationshipEdgeId, relationshipNodeId, renameRelationshipNode,
  type RelationshipGraph, type RelationshipNode,
} from './relationshipGraph';
import { loadRelationshipMatchEvidence, type RelationshipMatchEvidence } from './relationshipMatchEvidence';
import { buildRelationshipCandidateEdges } from './relationshipCandidateEdges';
import { loadRelationshipMaterialTrials } from './relationshipMaterialTrials';
import { useRelationshipSimilarityScene } from './relationshipSimilarityScene';
import RelationshipTrialEvidence from './RelationshipTrialEvidence';
import RelationshipValveDurabilityEvidencePanel from './RelationshipValveDurabilityEvidence';
import { buildRelationshipValveDurability, loadRelationshipValveRequirements } from './relationshipValveDurabilityScene';
import RelationshipAttributeEvidence from './RelationshipAttributeEvidence';
import { loadRelationshipAttributeDiscovery, type RelationshipAttributeDiscovery } from './relationshipAttributeDiscoveryScene';
import RelationshipMaterialReviewPanel from './RelationshipMaterialReviewPanel';
import './relationshipExplorer.css';

type RelationshipDepth = 'all' | 1 | 2;
const retiredGraphParams = ['axisType', 'axisX', 'axisY', 'axisZ', 'matchSource', 'attributeExample'];
const materialReviewParam = 'materialParameterReview';
const relationshipQueryParam = 'relationshipQuery';
const materialReviewProductKey = 'VALVE-03';
const materialReviewProductType = 'demo_relation_valve_product';
const materialReviewGrade = 'A280G6 RH';

function normalizeRecordMetadata(metadata: RelationshipRecordMetadata): RelationshipRecordMetadata {
  return {
    tags: metadata.tags && [...new Set(metadata.tags.map(tag => tag.trim()).filter(Boolean))],
    properties: metadata.properties.map(({ id, name, value }) => ({ id, name: name.trim(), value })),
    property_labels: Object.fromEntries(Object.entries(metadata.property_labels ?? {}).sort(([left], [right]) => left.localeCompare(right))),
    hidden_property_codes: metadata.hidden_property_codes && [...new Set(metadata.hidden_property_codes)].sort(),
    note_markdown: metadata.note_markdown,
  };
}

function comparableRecordMetadata(normalized: RelationshipRecordMetadata) {
  return JSON.stringify({
    ...normalized,
    hidden_property_codes: normalized.hidden_property_codes ?? [],
    note_markdown: normalized.note_markdown ?? '',
  });
}

export default function RelationshipExplorer({ isAdmin }: { isAdmin: boolean }) {
  const [params, setParams] = useSearchParams();
  const { state: navigationState } = useLocation();
  const linkedQuery = useMemo(() => getRelationshipQuery(navigationState), [navigationState]);
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
    importingMarkdown?: boolean;
  }>();
  const [saving, setSaving] = useState(false);
  const [markdownImportTarget, setMarkdownImportTarget] = useState<HTMLSpanElement | null>(null);
  const editorRequest = useRef<AbortController>();
  const savePending = useRef(false);
  const inspectorBody = useRef<HTMLDivElement>(null);
  const [matchEvidence, setMatchEvidence] = useState<{ graph: RelationshipGraph; byNode: ReadonlyMap<string, readonly RelationshipMatchEvidence[]> }>();
  const [trialEvidence, setTrialEvidence] = useState<{
    graph: RelationshipGraph;
    data: Awaited<ReturnType<typeof loadRelationshipMaterialTrials>>;
  }>();
  const [valveRequirements, setValveRequirements] = useState<{
    graph: RelationshipGraph;
    data: Awaited<ReturnType<typeof loadRelationshipValveRequirements>>;
  }>();
  const [attributeSearch, setAttributeSearch] = useState<{
    graph: RelationshipGraph;
    node: RelationshipNode;
    result?: RelationshipAttributeDiscovery;
    error?: string;
  }>();
  const [resetSignal, setResetSignal] = useState(0);

  const catalog = catalogResult?.revision === revision ? catalogResult.items : undefined;
  const models = useMemo(() => (catalog ?? []).filter(item => item.status === 'published'
    && (item.record_bound ?? Boolean(item.record_binding))), [catalog]);
  const requestedType = params.get('objectType');
  const requestedKey = params.get('objectKey');
  const retiredStart = params.has('attributeExample') || /^-[1-9]\d*$/.test(requestedType ?? '');
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
  const graphQueryMode = params.get(relationshipQueryParam);
  const aiMaterialQuery = graphQueryMode === 'materials' && depth === 1
    && model?.code === materialReviewProductType && Boolean(key);
  const aiRelationshipQuery = graphQueryMode === 'relationships' && depth === 1 && Boolean(rootId);
  const materialReview = !aiRelationshipQuery && params.get(materialReviewParam) === '1' && depth === 1
    && model?.code === materialReviewProductType && (aiMaterialQuery || key === materialReviewProductKey);
  const focusRecordEvidence = materialReview || aiRelationshipQuery;
  const activeQuery = linkedQuery?.object_type_id === typeId && linkedQuery?.object_key === key
    && ((aiMaterialQuery && linkedQuery?.intent === 'material_review' && linkedQuery.material_parameter_review === materialReview)
      || (aiRelationshipQuery && linkedQuery?.intent === 'relationships')) ? linkedQuery : undefined;
  const valveMaterialModel = models.find(item => item.code === 'demo_relation_valve_material');
  const valveMaterialTypeId = valveMaterialModel && objectTypeId(valveMaterialModel);
  const comparisonMaterial = activeQuery?.comparison_materials.find(record => record.object_type_id === valveMaterialTypeId);
  const discoveryGraph = useMemo(() => {
    if (!materialReview || !liveGraph) return liveGraph;
    const nodes = liveGraph.nodes.filter(node => node.typeId !== valveMaterialTypeId).map(node => node.id === liveGraph.rootId ? {
      ...node, values: { ...node.values, cover_grade_no: null, body_grade_no: null },
    } : node);
    const visible = new Set(nodes.map(node => node.id));
    return { ...liveGraph, nodes, edges: liveGraph.edges.filter(edge => visible.has(edge.source) && visible.has(edge.target)) };
  }, [liveGraph, materialReview, valveMaterialTypeId]);
  const materialTrials = !focusRecordEvidence && trialEvidence?.graph === liveGraph ? trialEvidence?.data : undefined;
  const visibleValveRequirements = !focusRecordEvidence && valveRequirements?.graph === liveGraph ? valveRequirements?.data : undefined;
  const scopedAttributeSearch = !focusRecordEvidence && attributeSearch?.graph === discoveryGraph ? attributeSearch : undefined;
  const graph = useMemo(() => {
    if (!discoveryGraph?.nodes.length) return undefined;
    const neighbors = [...(materialTrials?.peers ?? []), ...(scopedAttributeSearch?.result?.peers ?? [])];
    if (scopedAttributeSearch) neighbors.push(scopedAttributeSearch.node);
    if (!neighbors.length) return discoveryGraph;
    const nodes = new Map(discoveryGraph.nodes.map(node => [node.id, node]));
    for (const node of neighbors) {
      if (!nodes.has(node.id)) nodes.set(node.id, node);
    }
    return { ...discoveryGraph, nodes: [...nodes.values()] };
  }, [discoveryGraph, materialTrials, scopedAttributeSearch]);
  const nodesById = useMemo(() => new Map(graph?.nodes.map(node => [node.id, node])), [graph]);
  const selectedNode = nodesById.get(selectedNodeId ?? '') ?? nodesById.get(graph?.rootId ?? '');
  const selectedAttributeSearch = scopedAttributeSearch?.node.id === selectedNode?.id ? scopedAttributeSearch : undefined;
  const attributeDiscovery = selectedAttributeSearch?.result;
  const valveDurability = useMemo(() => liveGraph && visibleValveRequirements
    ? buildRelationshipValveDurability(liveGraph, visibleValveRequirements, materialTrials?.trialsByGrade, materialTrials?.trialsComplete)
    : undefined, [liveGraph, visibleValveRequirements, materialTrials]);
  const activeGraphRequest = useRef(request);

  useLayoutEffect(() => {
    if (!activeQuery) return;
    setSelectedNodeId(undefined);
    setSelectedEdgeId(undefined);
    setRecordSearch('');
  }, [activeQuery]);

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
    if (!liveGraph || focusRecordEvidence) return;
    const controller = new AbortController();
    loadRelationshipMatchEvidence(liveGraph, models, controller.signal).then(byNode => {
      if (!controller.signal.aborted) setMatchEvidence({ graph: liveGraph, byNode });
    }).catch(() => {});
    return () => controller.abort();
  }, [focusRecordEvidence, liveGraph, models]);

  useEffect(() => {
    if (!liveGraph || focusRecordEvidence) return;
    const controller = new AbortController();
    loadRelationshipMaterialTrials(liveGraph, models, controller.signal).then(data => {
      if (!controller.signal.aborted) setTrialEvidence({ graph: liveGraph, data });
    }).catch(() => {});
    return () => controller.abort();
  }, [focusRecordEvidence, liveGraph, models]);

  useEffect(() => {
    if (!liveGraph || focusRecordEvidence) return;
    const controller = new AbortController();
    loadRelationshipValveRequirements(liveGraph, models, controller.signal).then(data => {
      if (!controller.signal.aborted) setValveRequirements({ graph: liveGraph, data });
    }).catch(() => {});
    return () => controller.abort();
  }, [focusRecordEvidence, liveGraph, models]);

  useEffect(() => {
    if (!discoveryGraph || !selectedNode || focusRecordEvidence) return;
    const controller = new AbortController();
    loadRelationshipAttributeDiscovery(selectedNode, discoveryGraph, models, controller.signal).then(result => {
      if (!controller.signal.aborted) setAttributeSearch({ graph: discoveryGraph, node: selectedNode, result });
    }).catch(error => {
      if (!controller.signal.aborted) setAttributeSearch({
        graph: discoveryGraph, node: selectedNode, error: objectRuntimeError(error, '属性发现暂不可用。'),
      });
    });
    return () => controller.abort();
  }, [discoveryGraph, focusRecordEvidence, models, selectedNode]);

  const visibleRecords = recordsType === typeId ? records : [];
  const recordOptions = visibleRecords.map(item => ({ value: item.key, label: item.key }));
  if (key && !recordOptions.some(item => item.value === key)) recordOptions.unshift({ value: key, label: key });
  const typeColors = useMemo(() => new Map(models.map((model, index) => [
    objectTypeId(model), CHART_SERIES_COLORS[index % CHART_SERIES_COLORS.length],
  ])), [models]);
  const graphNodes = useMemo(() => graph?.nodes.map(node => ({
    id: node.id, label: relationshipNodeLabel(node), color: typeColors.get(node.typeId) ?? CHART_SERIES_COLORS[0],
  })) ?? [], [graph, typeColors]);
  const graphEvidence = !focusRecordEvidence && matchEvidence?.graph === liveGraph ? matchEvidence?.byNode : undefined;
  const candidateEdges = useMemo(() => graph ? buildRelationshipCandidateEdges(graph, graphEvidence) : [], [graph, graphEvidence]);
  const graphEdges = useMemo(() => [
    ...(graph?.edges ?? []), ...candidateEdges.map(item => item.edge), ...(materialTrials?.edges.map(item => item.edge) ?? []),
    ...(attributeDiscovery?.matches.map(item => item.edge) ?? []),
  ], [graph, candidateEdges, materialTrials, attributeDiscovery]);
  const candidateCount = graphEdges.length - (graph?.edges.length ?? 0);
  const { positions, nearby } = useRelationshipSimilarityScene(graph?.nodes, models, revision);
  const selectedEdge = graphEdges.find(edge => edge.id === selectedEdgeId);
  const editor = !materialReview && editSession?.nodeId === selectedNode?.id ? editSession : undefined;
  const editLocked = Boolean(editor) || saving;
  const incidentEdges = graphEdges.filter(edge => edge.source === selectedNode?.id || edge.target === selectedNode?.id);
  const relatedTypes = new Map(graph?.nodes.map(node => [node.typeId, node.typeName]));
  const selectedModel = models.find(item => objectTypeId(item) === selectedNode?.typeId);
  const canReviewMaterial = selectedNode?.key === materialReviewProductKey && selectedModel?.code === materialReviewProductType;
  const selectedCandidate = candidateEdges.find(item => item.edge.id === selectedEdge?.id)?.match;
  const selectedAttributeMatch = attributeDiscovery?.matches.find(item => item.edge.id === selectedEdge?.id)?.match;
  const selectedTrialComparison = materialTrials?.edges.find(item => item.edge.id === selectedEdge?.id)?.comparison;
  const selectedValveDurability = selectedEdge && valveDurability?.byEdge.get(selectedEdge.id);
  const selectedProductDurability = selectedNode && valveDurability?.byProduct.get(selectedNode.id);
  const selectedMaterialTrials = selectedNode && selectedNode.typeId === materialTrials?.materialTypeId
    ? materialTrials.trialsByGrade.get(selectedNode.key) : undefined;
  const edgeSource = selectedEdge && nodesById.get(selectedEdge.source);
  const edgeTarget = selectedEdge && nodesById.get(selectedEdge.target);
  const edgeFieldLabel = (code: string, node?: RelationshipNode) =>
    relationshipPropertyLabel(code, models.find(item => objectTypeId(item) === node?.typeId));

  useEffect(() => {
    inspectorBody.current?.scrollTo({ top: 0 });
  }, [activeQuery, materialReview, selectedNode?.id, selectedEdge?.id]);

  useEffect(() => () => {
    editorRequest.current?.abort();
  }, []);

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
      direction: edge.symmetric ? 'peer' : outgoing ? 'outgoing' : 'incoming' } as const] : [];
  });
  const reviewTestType = (materialReview || aiMaterialQuery) && models.find(item => item.code === 'demo_relation_valve_burst');
  const reviewTestTypeId = reviewTestType ? objectTypeId(reviewTestType) : undefined;
  const { reviewTests, queryEdges, highlightedEdgeIds } = useMemo(() => {
    const tests = new Map<string, RelationshipNode>();
    const edges: RelationshipGraph['edges'] = [];
    if ((reviewTestTypeId || aiRelationshipQuery) && graph?.rootId) {
      const evidenceEdges = activeQuery?.edges && new Set(activeQuery.edges.map(edge => relationshipEdgeId(edge.relation_id,
        relationshipNodeId(edge.source_type_id, edge.source_key), relationshipNodeId(edge.target_type_id, edge.target_key))));
      const evidenceIds = activeQuery && new Set(activeQuery.evidence_records.map(record =>
        relationshipNodeId(record.object_type_id, record.object_key)));
      for (const edge of graph.edges) {
        const relatedId = edge.source === graph.rootId ? edge.target : edge.target === graph.rootId ? edge.source : undefined;
        const related = relatedId ? nodesById.get(relatedId) : undefined;
        if (!related || (evidenceEdges ? !evidenceEdges.has(edge.id) : evidenceIds && !evidenceIds.has(related.id))) continue;
        const materialEvidence = related.typeId === reviewTestTypeId;
        if (materialEvidence) tests.set(related.id, related);
        if (aiRelationshipQuery || (aiMaterialQuery && materialEvidence)) edges.push(edge);
      }
    }
    return { reviewTests: [...tests.values()], queryEdges: edges, highlightedEdgeIds: new Set(edges.map(edge => edge.id)) };
  }, [activeQuery, aiMaterialQuery, aiRelationshipQuery, graph, nodesById, reviewTestTypeId]);
  const trialModel = models.find(item => item.code === MANUFACTURING_MATCH_TYPES.trial.code);
  const graphTrials = trialModel ? [...new Map(wikiNeighbors.filter(({ node }) => node.typeId === objectTypeId(trialModel))
    .map(({ node }) => [node.id, { key: node.key, values: node.values, bindingForm: node.bindingForm }])).values()] : undefined;
  const selectedEvidence = selectedNode ? graphEvidence?.get(selectedNode.id) : undefined;
  const soleEvidence = selectedEvidence?.length === 1 ? selectedEvidence[0] : undefined;
  const wikiTrials = selectedNode?.id === soleEvidence?.participants.material.id ? soleEvidence?.trials : graphTrials;

  function clearSelection() {
    setSelectedNodeId(undefined);
    setSelectedEdgeId(undefined);
  }

  function setStart(id: number, recordKey?: string) {
    setRecordSearch('');
    clearSelection();
    setParams(previous => {
      const next = new URLSearchParams(previous);
      next.set('view', 'graph');
      next.delete(materialReviewParam);
      next.delete(relationshipQueryParam);
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
      next.delete(materialReviewParam);
      next.delete(relationshipQueryParam);
      if (start) {
        next.set('objectType', String(start.typeId));
        next.set('objectKey', start.key);
      }
      return next;
    });
  }

  function toggleMaterialReview() {
    if (!materialReview && (!selectedNode || !canReviewMaterial)) return;
    setRecordSearch('');
    clearSelection();
    setParams(previous => {
      const next = new URLSearchParams(previous);
      next.delete(relationshipQueryParam);
      if (materialReview) next.delete(materialReviewParam);
      else if (selectedNode) {
        next.set('view', 'graph');
        next.set('relationDepth', '1');
        next.set('objectType', String(selectedNode.typeId));
        next.set('objectKey', selectedNode.key);
        next.set(materialReviewParam, '1');
      }
      return next;
    });
  }

  function selectNode(id: string) {
    if (editLocked) return;
    setSelectedNodeId(id);
    setSelectedEdgeId(undefined);
  }

  function selectEdge(id: string) {
    if (editLocked) return;
    const edge = graphEdges.find(item => item.id === id);
    if (!edge) return;
    if (selectedNode?.id !== edge.source && selectedNode?.id !== edge.target) setSelectedNodeId(edge.source);
    setSelectedEdgeId(id);
  }

  function cancelEdit() {
    editorRequest.current?.abort();
    setEditSession(undefined);
  }

  async function startEdit(node: RelationshipNode) {
    if (editLocked || materialReview) return;
    editorRequest.current?.abort();
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
    if (!selectedNode || !editor?.snapshot || editor.importingMarkdown || savePending.current) return;
    const original = editor.snapshot.record_metadata;
    const pending = editor.recordMetadataDraft && normalizeRecordMetadata(editor.recordMetadataDraft);
    if (pending?.properties.some(property => !property.name)) {
      message.warning('请填写自定义属性的名称。');
      return;
    }
    const metadata = original && pending && comparableRecordMetadata(pending) !== comparableRecordMetadata(normalizeRecordMetadata(original))
      ? {
        record_metadata: { ...pending, note_markdown: editor.snapshot.can_edit_note_markdown ? pending.note_markdown : undefined },
        expected_record_metadata: original,
      } : undefined;
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

  return <div className="relationship-explorer" data-relationship-editing={editLocked || undefined}>
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
        {(materialReview || canReviewMaterial) && <Button disabled={editLocked} onClick={toggleMaterialReview}>
          {materialReview ? '退出选材试算' : '牌号留空试算'}
        </Button>}
        <Button icon={<ReloadOutlined />} disabled={editLocked} onClick={() => {
          setRevision(value => value + 1);
        }}>刷新关系</Button>
        <Button icon={<AimOutlined />} disabled={!graph} onClick={() => {
          setResetSignal(value => value + 1);
        }}>重置视角</Button>
      </div>
    </div>
    {graphError && <Alert type="error" showIcon message={graphError} />}
    {selectedAttributeSearch?.error && <Alert type="warning" showIcon message={selectedAttributeSearch.error} />}
    {(attributeDiscovery?.truncated || Boolean(attributeDiscovery?.failedTypes)) && <Alert type="info" showIcon
      message="属性发现只扫描了部分可查看记录。" />}
    {materialTrials?.truncated && <Alert type="info" showIcon message="当前图中仅展示部分材料试验或同工况候选关系。" />}
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
          <header className="relationship-explorer-caption">
            <h2 className="relationship-explorer-panel-title">对象关系图</h2>
            <span className="relationship-explorer-caption-detail" aria-live="polite">
              {graphNodes.length} 个对象 · {graph.edges.length} 条记录关系{candidateCount > 0 ? ` · ${candidateCount} 条候选` : ''}
            </span>
            {!overview && key && <span className="relationship-explorer-caption-detail">起点 <code>{key}</code></span>}
            {(aiMaterialQuery || aiRelationshipQuery) && <span className="relationship-explorer-caption-detail" role="status">
              {highlightedEdgeIds.size ? `已高亮 ${highlightedEdgeIds.size} 条查询依据` : '暂无可高亮的查询依据'}
            </span>}
            {!focusRecordEvidence && selectedNode && !selectedAttributeSearch && <span className="relationship-explorer-caption-detail" role="status">正在发现属性匹配…</span>}
            {attributeDiscovery && !attributeDiscovery.matches.length && <span className="relationship-explorer-caption-detail">未发现匹配属性</span>}
          </header>
          <div className="relationship-explorer-graph-content">
            <div className="relationship-explorer-map">
              <RelationshipMap key={graph.rootId} nodes={graphNodes} edges={graphEdges} selectedNodeId={selectedNode?.id}
                positions={positions} selectedEdgeId={selectedEdge?.id} onSelectNode={selectNode} onSelectEdge={selectEdge}
                resetSignal={resetSignal} highlightedEdgeIds={highlightedEdgeIds} />
            </div>
            <div className="relationship-explorer-legend">
              {[...relatedTypes].map(([id, name]) => <span key={id}><i style={{ backgroundColor: typeColors.get(id) ?? CHART_SERIES_COLORS[0] }} />{name}</span>)}
              {graph.edges.length > 0 && <span><i className="relationship-legend-line" />记录关系</span>}
              {candidateCount > 0 && <span><i className="relationship-legend-line relationship-legend-line--candidate" />候选关系</span>}
              {highlightedEdgeIds.size > 0 && <span><i className="relationship-legend-line relationship-legend-line--query" />查询依据</span>}
              <span className="relationship-explorer-help">悬停高亮 · 点击在侧栏查看 · 左拖旋转 · 右拖平移 · 中键上下拖动或滚轮缩放</span>
            </div>
          </div>
        </section>
        <aside className="relationship-explorer-inspector" aria-label="关系图详情">
          <header className="relationship-explorer-inspector-toolbar">
            <h2 className="relationship-explorer-panel-title">{selectedEdge ? '连线详情' : '对象详情'}</h2>
            {selectedNode && !selectedEdge && !materialReview && <div className="relationship-explorer-inspector-actions">{editor ? <>
              <span className="relationship-explorer-markdown-import" ref={setMarkdownImportTarget} />
              <Button disabled={saving} onClick={cancelEdit}>取消</Button>
              <Button type="primary" htmlType="submit" form={RELATIONSHIP_OBJECT_EDITOR_FORM_ID}
                loading={saving || !editor.snapshot} disabled={!editor.snapshot || editor.importingMarkdown}>保存</Button>
            </> : <Button icon={<EditOutlined />} onClick={() => void startEdit(selectedNode)}>编辑</Button>}</div>}
          </header>
          <div className="relationship-explorer-inspector-body" ref={inspectorBody}>
            {aiRelationshipQuery && !selectedEdge && selectedNode && selectedNode.id === graph.rootId &&
              <section className="relationship-query-summary" aria-label="对象与关系查询结果">
                <h3>对象与关系查询结果</h3>
                <p><strong>{relationshipNodeLabel(selectedNode)}</strong> · {queryEdges.length} 条记录关系</p>
                {activeQuery?.truncated && <p>本次只返回了部分直接关系。</p>}
                {!!queryEdges.length && <ul>{queryEdges.map(edge => {
                  const related = nodesById.get(edge.source === graph.rootId ? edge.target : edge.source);
                  return related && <li key={edge.id}>
                    <Button type="link" size="small" onClick={() => selectEdge(edge.id)}>
                      {edge.label} · {relationshipNodeLabel(related)}
                    </Button>
                  </li>;
                })}</ul>}
              </section>}
            {materialReview && !selectedEdge && selectedNode && selectedNode.id === graph.rootId && selectedModel &&
              <RelationshipMaterialReviewPanel product={selectedNode} productModel={selectedModel}
                materialModel={activeQuery && !comparisonMaterial ? undefined : valveMaterialModel}
                materialKey={comparisonMaterial?.object_key ?? materialReviewGrade} relatedTests={reviewTests}
                fromQuery={aiMaterialQuery} />}
            {selectedEdge && <section className="relationship-explorer-selected-edge" aria-label="当前连线">
              <header><Typography.Text strong>{selectedEdge.label}</Typography.Text>
                <Tag color={selectedEdge.kind === 'candidate' ? 'gold' : undefined}>{selectedEdge.kind === 'candidate' ? '候选' : '记录关系'}</Tag>
              </header>
              <div className="relationship-explorer-endpoints">
                {edgeSource && <Button type="link" size="small" onClick={() => selectNode(edgeSource.id)}>{selectedAttributeMatch ? relationshipNodeLabel(edgeSource) : edgeSource.key}</Button>}
                {selectedEdge.symmetric ? <span aria-hidden="true">↔</span> : <ArrowRightOutlined />}
                {edgeTarget && <Button type="link" size="small" onClick={() => selectNode(edgeTarget.id)}>{selectedAttributeMatch ? relationshipNodeLabel(edgeTarget) : edgeTarget.key}</Button>}
              </div>
              {selectedAttributeMatch && edgeSource && edgeTarget
                ? <RelationshipAttributeEvidence comparison={selectedAttributeMatch} source={edgeSource} target={edgeTarget} />
                : selectedTrialComparison ? <RelationshipTrialEvidence comparison={selectedTrialComparison} /> : selectedCandidate ? <>
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
              {selectedValveDurability && <RelationshipValveDurabilityEvidencePanel entries={selectedValveDurability} nodesById={nodesById} onOpenRequirement={selectNode} />}
            </section>}
            {selectedNode ? <RelationshipObjectWiki key={selectedNode.id} node={selectedNode} model={selectedModel}
              referenceRecords={graph.nodes}
              related={wikiNeighbors} onOpenRelated={selectNode} onSelectRelationship={selectEdge}
              comparisons={nearby(selectedNode.id)}
              matches={nodeMatches(selectedNode.id)} trials={wikiTrials} selectedTrialKey={soleEvidence?.result.selectedTrial?.key}
              materialTrials={selectedMaterialTrials}
              valveDurability={!selectedValveDurability && selectedProductDurability
                ? <RelationshipValveDurabilityEvidencePanel entries={selectedProductDurability} nodesById={nodesById} onOpenRequirement={selectNode} /> : undefined}
              editSnapshot={editor?.snapshot} onSubmitEdit={editor?.snapshot ? saveEdit : undefined} saving={saving}
              markdownImportTarget={markdownImportTarget}
              onMarkdownImportingChange={importingMarkdown => {
                setEditSession(session => session?.nodeId === selectedNode.id ? { ...session, importingMarkdown } : session);
              }}
              recordMetadataDraft={editor?.recordMetadataDraft} onRecordMetadataChange={draft => {
                setEditSession(session => session?.nodeId === selectedNode.id ? { ...session, recordMetadataDraft: draft } : session);
              }} />
              : <Typography.Text type="secondary">点击图中对象查看卡片</Typography.Text>}
          </div>
        </aside>
      </div>}
  </div>;
}
