import './semanticCenter.css';
import '../QualityImpact/command.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FileSearchOutlined, ReloadOutlined } from '@/components/Icon/ant';
import { Button, Card, Empty, Form, Input, Modal, Segmented, Select, Space, Tabs, Tag, Typography, message } from 'antd';
import { type Connection, type Edge, type Node } from 'reactflow';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { type OntologyCandidateInfo, approveSemanticOntologyCandidate, createSemanticDataQualityRule, createSemanticMappingCandidate, createSemanticOntologyObject, createSemanticOntologyRelation, deleteSemanticDataQualityRule, generateSemanticOntologyCandidates, getSemanticMappingWorkbench, getSemanticOntologyImpact, listSemanticDataAssets, listSemanticOntologyCandidates, listSemanticOntologyMappings, listSemanticOntologyObjects, listSemanticOntologyRelations, listSemanticOntologyVersions, publishSemanticOntology, rejectSemanticOntologyCandidate, saveSemanticMappingLayout, scanSemanticDataAssetMetadata, updateSemanticDataQualityRule, type SemanticMappingWorkbenchResponse } from '../../services/api';
import { getTableQualityRules, tableMatchesBusinessDomain, type DataAsset, type DataQualityRule, type OntologyMapping, type OntologyObject, type OntologyRelation, type OntologyVersion, type SemanticAssetCenterView } from './semanticAssetShared';
import './knowledgeWorkspace.css';
import './dataAssetWorkspace.css';
import { DataAssetView } from './DataAssetView';
import { OntologyView } from './OntologyView';
import { SemanticMappingView } from './SemanticMappingView';
import { ObjectBindingFields } from '../DataCenterWorkspace/ObjectRuntimeSettings';
import MappedFormSyncDialog from '../DataSource/MappedFormSyncDialog';
import { useAuthStore } from '@/stores/authStore';

export { KnowledgeCenter } from './KnowledgeCenter';

type ObjectPropertyDraft = {
  code: string;
  label: string;
  type: string;
  source_field?: string | null;
  search?: boolean;
  list?: boolean;
  form?: boolean;
};

const propertyTypeOptions = ['string', 'number', 'datetime', 'enum', 'boolean'].map(value => ({ value, label: value }));

function propertyTypeForSource(type: string) {
  if (/bool/i.test(type)) return 'boolean';
  if (/date|time/i.test(type)) return 'datetime';
  if (/int|number|numeric|decimal|float|double|real/i.test(type)) return 'number';
  return 'string';
}

export default function SemanticAssetCenter({ view, onViewChange, embedded = false }: { view?: SemanticAssetCenterView; onViewChange?: (view: SemanticAssetCenterView) => void; embedded?: boolean } = {}) {
  const navigate = useNavigate();
  const isAdmin = Boolean(useAuthStore(state => state.user?.is_admin));
  const [params, setParams] = useSearchParams();
  const requestedSource = Number(params.get('sourceId')) || undefined;
  const requestedCandidate = Number(params.get('candidateId')) || undefined;
  const requestedSection = params.get('section') || 'objects';
  const requestedObjectCode = params.get('objectCode') || undefined;
  const requestedSourceKind = params.get('mappingSource') === 'external' || (requestedSource && params.get('mappingSource') !== 'form') ? 'external' : 'form';
  const requestedMappingStatus = params.get('status') || '';
  const [qualityRuleForm] = Form.useForm();
  const [qualityScoreForm] = Form.useForm();
  const [ontologyObjectForm] = Form.useForm();
  const [ontologyRelationForm] = Form.useForm();
  const [propertyCandidateForm] = Form.useForm<ObjectPropertyDraft>();
  const [assets, setAssets] = useState<DataAsset[]>([]);
  const [objects, setObjects] = useState<OntologyObject[]>([]);
  const [relations, setRelations] = useState<OntologyRelation[]>([]);
  const [ontologyCandidates, setOntologyCandidates] = useState<OntologyCandidateInfo[]>([]);
  const [ontologyMappings, setOntologyMappings] = useState<OntologyMapping[]>([]);
  const [ontologyVersions, setOntologyVersions] = useState<OntologyVersion[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<number | undefined>();
  const [selectedTableId, setSelectedTableId] = useState<string | undefined>();
  const [syncTarget, setSyncTarget] = useState<{ id: number; name: string; entity: string }>();
  const [selectedObjectId, setSelectedObjectId] = useState<string | undefined>();
  const [selectedCandidateId, setSelectedCandidateId] = useState(requestedCandidate);
  const [assetSearch, setAssetSearch] = useState('');
  const [activeDomain, setActiveDomain] = useState('全部');
  const [ontologyTab, setOntologyTab] = useState(requestedSection);
  const [objectModalOpen, setObjectModalOpen] = useState(false);
  const [editingObject, setEditingObject] = useState(false);
  const [propertyCandidate, setPropertyCandidate] = useState<{ source: Node; object: OntologyObject }>();
  const [savingPropertyCandidate, setSavingPropertyCandidate] = useState(false);
  const [relationModalOpen, setRelationModalOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [recognizing, setRecognizing] = useState(false);
  const [reviewingCandidateId, setReviewingCandidateId] = useState<number | undefined>();
  const [publishingOntology, setPublishingOntology] = useState(false);
  const [savingObject, setSavingObject] = useState(false);
  const [savingRelation, setSavingRelation] = useState(false);
  const [impactLoading, setImpactLoading] = useState(false);
  const [impactResult, setImpactResult] = useState<any>(null);
  const [qualityRuleState, setQualityRuleState] = useState<Record<string, string>>({});
  const [qualityRuleModalOpen, setQualityRuleModalOpen] = useState(false);
  const [qualityScoreStandardOpen, setQualityScoreStandardOpen] = useState(false);
  const [editingQualityRule, setEditingQualityRule] = useState<DataQualityRule | undefined>();
  const [savingQualityRule, setSavingQualityRule] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [assetLoadFailed, setAssetLoadFailed] = useState(false);
  const [semanticCenterTab, setSemanticCenterTab] = useState<SemanticAssetCenterView>(view ?? 'data');
  const [mappingWorkbench, setMappingWorkbench] = useState<SemanticMappingWorkbenchResponse | undefined>();
  const mappingRequest = useRef(0);
  const [mappingNodes, setMappingNodes] = useState<Node[]>([]);
  const [mappingEdges, setMappingEdges] = useState<Edge[]>([]);
  const [mappingLoading, setMappingLoading] = useState(false);
  const [mappingObjectCode, setMappingObjectCode] = useState(requestedObjectCode);
  const [mappingSourceId, setMappingSourceId] = useState(requestedSource);
  const [mappingSourceKind, setMappingSourceKind] = useState<string>(requestedSourceKind);
  const [mappingStatus, setMappingStatus] = useState(requestedMappingStatus);
  const [selectedMappingElement, setSelectedMappingElement] = useState<Node | Edge | undefined>();
  const [savingMappingLayout, setSavingMappingLayout] = useState(false);

  const selectedAsset = useMemo(() => assets.find((item) => item.id === selectedAssetId) ?? assets[0], [assets, selectedAssetId]);
  const selectedAssetTables = useMemo(
    () => (selectedAsset?.tables ?? []).map((table) => ({ ...table, assetName: selectedAsset.name, assetType: selectedAsset.type, owner: selectedAsset.owner, freshness: selectedAsset.freshness, status: selectedAsset.status })),
    [selectedAsset],
  );
  const allTables = useMemo(
    () => assets.flatMap((asset) => asset.tables.map((table) => ({ ...table, assetId: asset.id, assetName: asset.name, assetType: asset.type, owner: asset.owner, freshness: asset.freshness, status: asset.status }))),
    [assets],
  );
  const selectedTable = useMemo(() => selectedAssetTables.find((item) => item.id === selectedTableId) ?? selectedAssetTables[0], [selectedAssetTables, selectedTableId]);
  const selectedCandidate = useMemo(
    () => ontologyCandidates.find((item) => item.id === selectedCandidateId) ?? ontologyCandidates[0],
    [ontologyCandidates, selectedCandidateId],
  );
  const assetCandidates = ontologyCandidates.filter(candidate => {
    const source = candidate.payload?.source as { source_id?: unknown } | undefined;
    return selectedAsset && Number(source?.source_id) === selectedAsset.id;
  });
  const candidatesForTable = (table: { id: string; name: string }) => assetCandidates.filter(candidate => {
    const source = candidate.payload?.source as { entity_name?: unknown } | undefined;
    return source?.entity_name === table.name || source?.entity_name === table.id;
  });
  const selectedTableCandidates = selectedTable ? candidatesForTable(selectedTable) : [];
  const openCandidateReview = (candidateId: number) => {
    navigate(`/data-center/objects?view=ontology&section=candidates&candidateId=${candidateId}`);
  };
  const openMapping = () => {
    const search = new URLSearchParams({ view: 'ontology', section: 'mapping' });
    if (selectedAsset?.persisted) {
      search.set('sourceId', String(selectedAsset.id));
      if (selectedTable) search.set('entity', selectedTable.name);
    }
    navigate(`/data-center/objects?${search}`);
  };
  const selectedQualityRules = useMemo(() => getTableQualityRules(selectedTable), [selectedTable]);
  const selectedQualityRuleStats = useMemo(() => ({
    total: selectedQualityRules.length,
    enabled: selectedQualityRules.filter((rule) => rule.enabled !== false).length,
    custom: selectedQualityRules.filter((rule) => rule.id || rule.custom).length,
    scoring: selectedQualityRules.filter((rule) => rule.include_in_score !== false && rule.passRate !== null && rule.passRate !== undefined).length,
  }), [selectedQualityRules]);
  const selectedObject = useMemo(() => objects.find((item) => item.id === selectedObjectId) ?? objects[0], [objects, selectedObjectId]);
  const objectRelations = relations.filter(item => item.source === selectedObject?.code || item.target === selectedObject?.code);
  const mappingObject = objects.find(item => item.code === mappingObjectCode);
  const selectedObjectMappings = useMemo(
    () => ontologyMappings.filter((item) => item.target_object_code === selectedObject?.code),
    [ontologyMappings, selectedObject],
  );
  const candidateStats = useMemo(() => {
    const counts = ontologyCandidates.reduce<Record<string, number>>((acc, item) => {
      acc[item.candidate_type] = (acc[item.candidate_type] ?? 0) + 1;
      return acc;
    }, {});
    return {
      total: ontologyCandidates.length,
      objects: counts.object ?? 0,
      fields: counts.field ?? 0,
      relations: counts.relation ?? 0,
      mappings: counts.mapping ?? 0,
    };
  }, [ontologyCandidates]);
  const ontologyPublishStats = useMemo(() => ({
    objects: objects.length,
    fields: objects.reduce((sum, item) => sum + item.fields.length, 0),
    relations: relations.length,
    graphRelations: relations.filter((item) => item.graph).length,
    mappings: ontologyMappings.length,
  }), [objects, ontologyMappings, relations]);
  const filteredTables = useMemo(() => {
    const keyword = assetSearch.trim().toLowerCase();
    return (selectedAsset?.tables ?? []).filter((table) => {
      const inKeyword = !keyword
        || table.name.toLowerCase().includes(keyword)
        || table.label.toLowerCase().includes(keyword)
        || table.fields.some((field) => field.name.toLowerCase().includes(keyword) || field.label.toLowerCase().includes(keyword));
      return inKeyword && tableMatchesBusinessDomain(table, activeDomain);
    });
  }, [activeDomain, assetSearch, selectedAsset]);
  const mappedTables = useMemo(() => new Set(ontologyMappings
    .filter(mapping => ['approved', 'published'].includes(mapping.status) && mapping.target_field_code)
    .map(mapping => JSON.stringify([mapping.source_system, mapping.source_entity]))), [ontologyMappings]);
  const assetStats = useMemo(() => {
    const tableCount = allTables.length;
    const totalRows = allTables.reduce((sum, table) => sum + Number(table.rows || 0), 0);
    const avgQuality = tableCount ? Math.round(allTables.reduce((sum, table) => sum + Number(table.quality_score || 0), 0) / tableCount) : 0;
    const mappedCount = allTables.filter(table => mappedTables.has(JSON.stringify([String(table.assetId), table.name]))).length;
    return { tableCount, totalRows, avgQuality, mappedCount };
  }, [allTables, mappedTables]);
  const selectedAssetStats = useMemo(() => {
    const tables = selectedAsset?.tables ?? [];
    const tableCount = tables.length;
    const fieldCount = tables.reduce((sum, table) => sum + table.fields.length, 0);
    const totalRows = tables.reduce((sum, table) => sum + Number(table.rows || 0), 0);
    const avgQuality = tableCount ? Math.round(tables.reduce((sum, table) => sum + Number(table.quality_score || 0), 0) / tableCount) : 0;
    const mappedCount = tables.filter(table => mappedTables.has(JSON.stringify([String(selectedAsset?.id), table.name]))).length;
    return { tableCount, fieldCount, totalRows, avgQuality, mappedCount };
  }, [mappedTables, selectedAsset]);
  const load = async () => {
    setLoading(true);
    try {
      const [assetResult, ontologyResult] = await Promise.allSettled([
        listSemanticDataAssets(),
        Promise.all([
          listSemanticOntologyObjects(),
          listSemanticOntologyRelations(),
          listSemanticOntologyMappings(),
          listSemanticOntologyVersions(),
          listSemanticOntologyCandidates({ status: 'pending_review' }),
        ]),
      ]);
      setAssetLoadFailed(assetResult.status === 'rejected');
      if (assetResult.status === 'fulfilled') {
        const nextAssets: DataAsset[] = assetResult.value.data?.data ?? [];
        setAssets(nextAssets);
        setSelectedAssetId(prev => prev ?? requestedSource ?? nextAssets[0]?.id);
        setSelectedTableId(prev => nextAssets.some(asset => asset.tables.some(table => table.id === prev)) ? prev : nextAssets[0]?.tables[0]?.id);
      }
      if (ontologyResult.status === 'rejected') throw ontologyResult.reason;
      const [objectRes, relationRes, mappingRes, versionRes, candidateRes] = ontologyResult.value;
      const nextObjects = objectRes.data?.data ?? [];
      const nextCandidates = candidateRes.data?.data ?? [];
      setLoadFailed(false);
      setObjects(nextObjects);
      setRelations(relationRes.data?.data ?? []);
      setOntologyCandidates(nextCandidates);
      setOntologyMappings(mappingRes.data?.data ?? []);
      setOntologyVersions(versionRes.data?.data ?? []);
      setSelectedObjectId((prev) => prev ?? nextObjects[0]?.id);
      setMappingObjectCode((prev) => nextObjects.some(item => item.code === prev) ? prev : nextObjects[0]?.code);
      setSelectedCandidateId((prev) => prev ?? nextCandidates[0]?.id);
    } catch {
      setLoadFailed(true);
      setObjects([]);
      setRelations([]);
      setOntologyCandidates([]);
      setOntologyMappings([]);
      setOntologyVersions([]);
      setSelectedObjectId(undefined);
      setMappingObjectCode(undefined);
      setSelectedCandidateId(undefined);
      message.warning('暂时无法读取对象模型');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    setSemanticCenterTab(view ?? 'data');
  }, [view]);

  useEffect(() => {
    setMappingSourceId(requestedSource);
  }, [requestedSource]);

  useEffect(() => {
    if (requestedCandidate) setSelectedCandidateId(requestedCandidate);
  }, [requestedCandidate]);

  useEffect(() => {
    setOntologyTab(['objects', 'relations', 'mapping', 'candidates', 'publish', 'impact'].includes(requestedSection) ? requestedSection : 'objects');
  }, [requestedSection]);

  useEffect(() => {
    if (requestedObjectCode) setMappingObjectCode(requestedObjectCode);
  }, [requestedObjectCode]);

  useEffect(() => {
    setMappingSourceKind(requestedSourceKind);
  }, [requestedSourceKind]);

  useEffect(() => {
    setMappingStatus(requestedMappingStatus);
  }, [requestedMappingStatus]);

  function changeOntologyTab(tab: string) {
    setOntologyTab(tab);
    if (embedded && view === 'ontology') {
      setParams(previous => {
        const next = new URLSearchParams(previous);
        if (tab === 'objects') next.delete('section');
        else next.set('section', tab);
        if (tab !== 'candidates') next.delete('candidateId');
        return next;
      }, { replace: true });
    }
  }

  function openObjectMapping(object: OntologyObject) {
    setSelectedObjectId(object.id);
    setMappingObjectCode(object.code);
    if (embedded && view === 'ontology') {
      setParams(previous => {
        const next = new URLSearchParams(previous);
        next.set('section', 'mapping');
        next.set('objectCode', object.code);
        return next;
      });
    } else {
      setOntologyTab('mapping');
    }
  }

  useEffect(() => {
    if (filteredTables.length && !filteredTables.some((table) => table.id === selectedTableId)) {
      setSelectedTableId(filteredTables[0].id);
    }
  }, [filteredTables, selectedTableId]);

  const scanMetadata = async () => {
    if (!selectedAsset) return;
    const assetId = selectedAsset.id;
    setScanning(true);
    setAssets((prev) => prev.map((asset) => asset.id === assetId ? { ...asset, status: 'scanning' } : asset));
    try {
      const res = await scanSemanticDataAssetMetadata(assetId, { limit_tables: 24, sample_limit: 3 });
      const scannedAsset = res.data?.data as DataAsset | undefined;
      const scan = res.data?.scan as { tables_scanned?: number; fields_scanned?: number; records_profiled?: number } | undefined;
      if (!scannedAsset) {
        throw new Error('扫描结果为空');
      }
      setAssets((prev) => prev.map((asset) => asset.id === assetId ? scannedAsset : asset));
      setSelectedAssetId(scannedAsset.id);
      setSelectedTableId((prev) => scannedAsset.tables.some((table) => table.id === prev) ? prev : scannedAsset.tables[0]?.id);
      message.success(`元数据扫描完成：${scan?.tables_scanned ?? scannedAsset.tables.length} 张表，${scan?.fields_scanned ?? scannedAsset.tables.reduce((sum, table) => sum + table.fields.length, 0)} 个字段`);
    } catch (error: any) {
      setAssets((prev) => prev.map((asset) => asset.id === assetId ? { ...asset, status: selectedAsset.status || 'connected' } : asset));
      message.error(error?.response?.data?.detail ?? error?.message ?? '元数据扫描失败');
    } finally {
      setScanning(false);
    }
  };

  const clearMetadataView = () => {
    if (!selectedAsset) return;
    setAssets((prev) => prev.map((asset) => asset.id === selectedAsset.id
      ? { ...asset, freshness: '待扫描', tables: [] }
      : asset));
    setSelectedTableId(undefined);
    message.success('已清空当前数据源的元数据展示，可点击“扫描元数据”重新生成');
  };

  const refreshOntologyGovernance = async () => {
    const [objectRes, relationRes, candidateRes, mappingRes, versionRes] = await Promise.all([
      listSemanticOntologyObjects(),
      listSemanticOntologyRelations(),
      listSemanticOntologyCandidates({ status: 'pending_review' }),
      listSemanticOntologyMappings(),
      listSemanticOntologyVersions(),
    ]);
    const nextObjects = objectRes.data?.data ?? [];
    const nextCandidates = candidateRes.data?.data ?? [];
    setObjects(nextObjects);
    setRelations(relationRes.data?.data ?? []);
    setOntologyCandidates(nextCandidates);
    setOntologyMappings(mappingRes.data?.data ?? []);
    setOntologyVersions(versionRes.data?.data ?? []);
    setSelectedObjectId((prev) => nextObjects.some((item: OntologyObject) => item.id === prev) ? prev : nextObjects[0]?.id);
    setSelectedCandidateId((prev) => nextCandidates.some((item: OntologyCandidateInfo) => item.id === prev) ? prev : nextCandidates[0]?.id);
  };

  const reviewCandidate = async (candidate: OntologyCandidateInfo, action: 'approve' | 'reject') => {
    setReviewingCandidateId(candidate.id);
    try {
      if (action === 'approve') {
        await approveSemanticOntologyCandidate(candidate.id);
        message.success(candidate.candidate_type === 'mapping' ? '字段映射已批准' : '候选已批准并写入对象模型');
      } else {
        await rejectSemanticOntologyCandidate(candidate.id);
        message.success('候选已拒绝');
      }
      await refreshOntologyGovernance();
    } catch (error: any) {
      message.error(error?.response?.data?.detail ?? '候选审核失败');
    } finally {
      setReviewingCandidateId(undefined);
    }
  };

  const runSemanticMappingRecognition = async () => {
    const sourceId = mappingSourceId;
    if (!sourceId) {
      message.warning('请先选择数据源');
      return;
    }
    const asset = assets.find((item) => item.id === sourceId);
    if (asset?.allow_ai === false) {
      message.warning('当前数据源未授权 AI 使用，请在治理使用中开启后再识别');
      return;
    }
    setRecognizing(true);
    try {
      const res = await generateSemanticOntologyCandidates({ source_id: sourceId });
      const candidates = res.data?.data ?? [];
      setOntologyCandidates((prev) => {
        const nextById = new Map(prev.map((candidate) => [candidate.id, candidate]));
        candidates.forEach((candidate) => nextById.set(candidate.id, candidate));
        return Array.from(nextById.values());
      });
      message.success(`AI 已生成 ${candidates.length} 条候选`);
      await loadSemanticMappingWorkbench();
    } catch (error: any) {
      message.error(error?.response?.data?.detail ?? 'AI 语义识别失败，请检查 AI 配置和元数据扫描结果');
    } finally {
      setRecognizing(false);
    }
  };


  const toFlowNodes = (nodes: SemanticMappingWorkbenchResponse['nodes']): Node[] => nodes.map((node) => ({
    id: node.id,
    type: 'semantic',
    position: node.position,
    data: {
      ...node.data,
      id: node.id,
      nodeType: node.type,
      label: node.label,
      subtitle: node.type === 'source_table'
        ? `${node.data.source_name ?? '-'} · ${node.data.row_count ?? 0} 行`
        : node.type === 'source_field'
          ? `${node.data.entity_name ?? '-'} · ${(node.data.field as any)?.type ?? '-'}`
          : node.type === 'object_field'
            ? `${node.data.object_code ?? '-'}`
            : (node.data.object as any)?.code,
    },
  }));

  const toFlowEdges = (edges: SemanticMappingWorkbenchResponse['edges']): Edge[] => edges
    .filter((edge) => edge.source && edge.target)
    .map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'smoothstep',
      animated: edge.type === 'semantic_candidate' && edge.status === 'pending_review',
      label: edge.label,
      data: edge.data,
      style: {
        stroke: edge.type === 'semantic_candidate' ? '#d48806' : edge.type === 'semantic_mapping' ? '#2f7d5b' : '#9aa8b3',
        strokeWidth: edge.type.includes('semantic') ? 2 : 1,
      },
      labelStyle: { fill: '#172026', fontSize: 12 },
    }));

  const loadSemanticMappingWorkbench = async () => {
    const request = ++mappingRequest.current;
    setMappingLoading(true);
    try {
      const res = await getSemanticMappingWorkbench({
        object_code: mappingObjectCode,
        source_id: mappingSourceId,
        status: mappingStatus || undefined,
      });
      if (request !== mappingRequest.current) return;
      const data = res.data?.data;
      setMappingWorkbench(data);
      setMappingObjectCode((prev) => prev ?? data?.object_code ?? undefined);
      setMappingNodes(toFlowNodes(data?.nodes ?? []));
      setMappingEdges(toFlowEdges(data?.edges ?? []));
      setSelectedMappingElement(undefined);
    } catch (error: any) {
      if (request !== mappingRequest.current) return;
      message.error(error?.response?.data?.detail ?? '语义映射工作台加载失败');
      setMappingWorkbench(undefined);
      setMappingNodes([]);
      setMappingEdges([]);
    } finally {
      if (request === mappingRequest.current) setMappingLoading(false);
    }
  };

  const externalMappingActive = semanticCenterTab === 'mapping'
    || (semanticCenterTab === 'ontology' && ontologyTab === 'mapping' && mappingSourceKind === 'external');

  useEffect(() => {
    if (externalMappingActive) void loadSemanticMappingWorkbench();
  }, [externalMappingActive, mappingObjectCode, mappingSourceId, mappingStatus]);

  const saveCurrentMappingLayout = async (nodes = mappingNodes) => {
    if (!mappingWorkbench?.object_code && !mappingObjectCode) return;
    setSavingMappingLayout(true);
    try {
      const positions = Object.fromEntries(nodes.map((node) => [node.id, node.position]));
      await saveSemanticMappingLayout({
        object_code: mappingWorkbench?.object_code ?? mappingObjectCode,
        source_id: mappingSourceId ?? null,
        layout: { positions },
      });
    } catch (error: any) {
      message.error(error?.response?.data?.detail ?? '画布布局保存失败');
    } finally {
      setSavingMappingLayout(false);
    }
  };

  const createMappingFromNodes = async (sourceNode: Node, targetNode: Node) => {
    const sourceType = String(sourceNode.data?.nodeType ?? '');
    const targetType = String(targetNode.data?.nodeType ?? '');
    if (sourceType !== 'source_field' || !['object', 'object_field'].includes(targetType)) {
      message.warning('请从来源字段连接到对象或对象字段');
      return false;
    }
    const source = sourceNode.data;
    const target = targetNode.data;
    const sourceId = Number(source.source_id);
    const objectCode = target.object_code ?? target.object?.code;
    const targetFieldCode = target.field?.code;
    const asset = assets.find(item => item.id === sourceId && item.persisted);
    if (asset?.allow_ontology === false) {
      message.warning('当前数据源未开启对象建模权限，请先到数据资产中检查治理设置。');
      return false;
    }
    const conflict = targetFieldCode && ontologyMappings.find(mapping =>
      ['approved', 'published'].includes(mapping.status) && mapping.source_system === String(sourceId)
      && mapping.source_entity === source.entity_name && mapping.target_object_code === objectCode
      && mapping.target_field_code === targetFieldCode && mapping.source_field !== source.field_name,
    );
    if (conflict) {
      message.warning(`此表已通过 ${conflict.source_field} 映射到该属性。`);
      return false;
    }
    const sourceTypeName = source.source_type ?? mappingWorkbench?.metadata.find(item =>
      item.source_id === sourceId && item.entity_name === source.entity_name,
    )?.source_type;
    try {
      const response = await createSemanticMappingCandidate({
        source_node: { id: sourceNode.id, type: sourceType, label: String(source.label ?? ''), data: { ...source, source_type: sourceTypeName }, position: sourceNode.position },
        target_node: { id: targetNode.id, type: targetType, label: String(target.label ?? ''), data: target, position: targetNode.position },
        confidence: 0.72,
        note: '人工在字段映射中选择来源字段与对象属性',
      });
      const candidate = response.data.data;
      if (candidate.status === 'pending_review') {
        setOntologyCandidates(current => [candidate, ...current.filter(item => item.id !== candidate.id)]);
        message.success('已提交映射候选，批准后生效');
      } else {
        message.info('这条字段映射已建立');
      }
      void loadSemanticMappingWorkbench();
      return true;
    } catch (error: any) {
      message.error(error?.response?.data?.detail ?? '创建映射候选失败');
      return false;
    }
  };

  const connectSemanticMapping = async (connection: Connection) => {
    const sourceNode = mappingNodes.find(node => node.id === connection.source);
    const targetNode = mappingNodes.find(node => node.id === connection.target);
    if (sourceNode && targetNode) await createMappingFromNodes(sourceNode, targetNode);
  };

  const openObjectModal = (object?: OntologyObject) => {
    setEditingObject(Boolean(object));
    ontologyObjectForm.resetFields();
    ontologyObjectForm.setFieldsValue(object ? {
      name: object.name,
      code: object.code,
      domain: object.domain ?? 'manufacturing',
      description: object.description,
      status: object.status ?? 'published',
      source_type: 'manual',
      source_ref: object.source,
      fields: object.fields.map(field => ({ ...field, code: field.code || field.name })),
    } : {
      domain: 'manufacturing',
      status: 'draft',
      source_type: 'manual',
      fields: [],
    });
    setObjectModalOpen(true);
  };

  const createObjectFromTable = (sourceTable: Node) => {
    const source = sourceTable.data;
    const sourceId = Number(source.source_id);
    if (assets.some(asset => asset.id === sourceId && asset.persisted && asset.allow_ontology === false)) {
      message.warning('当前数据源未开启对象建模权限，请先到数据资产中检查治理设置。');
      return;
    }
    const metadata = mappingWorkbench?.metadata.find(item => item.source_id === sourceId && item.entity_name === source.entity_name);
    if (!metadata) {
      message.warning('找不到此表的扫描字段，请刷新字段映射。');
      return;
    }
    openObjectModal();
    ontologyObjectForm.setFieldsValue({
      name: metadata.entity_label || metadata.entity_name,
      code: metadata.entity_name.replace(/[^\p{L}\p{N}_-]/gu, '_').slice(0, 120),
      source_ref: metadata.entity_name,
      fields: metadata.fields.filter(field => field.name).map(field => ({
        code: String(field.name), label: String(field.label || field.name), source_field: String(field.name),
        type: propertyTypeForSource(String(field.type || '')), list: true, form: true,
      })),
    });
  };

  const createPropertyFromField = (source: Node) => {
    if (!mappingObject) return;
    propertyCandidateForm.resetFields();
    propertyCandidateForm.setFieldsValue({
      code: source.data.field_name,
      label: source.data.label || source.data.field_name,
      type: propertyTypeForSource(String(source.data.field?.type || '')),
    });
    setPropertyCandidate({ source, object: mappingObject });
  };

  const savePropertyCandidate = async () => {
    if (!propertyCandidate) return;
    const field = await propertyCandidateForm.validateFields();
    const { source, object } = propertyCandidate;
    const code = field.code.trim();
    if (object.fields.some(item => (item.code || item.name) === code)) {
      propertyCandidateForm.setFields([{ name: 'code', errors: ['该属性已存在，请选择映射到现有属性。'] }]);
      return;
    }
    setSavingPropertyCandidate(true);
    try {
      const saved = await createMappingFromNodes(source, {
        id: `object-field:${object.code}.${code}`,
        position: { x: 0, y: 0 },
        data: { nodeType: 'object_field', object_code: object.code, label: field.label, field: { ...field, code } },
      });
      if (saved) setPropertyCandidate(undefined);
    } finally {
      setSavingPropertyCandidate(false);
    }
  };

  const saveOntologyObject = async () => {
    const values = await ontologyObjectForm.validateFields();
    if (!editingObject && objects.some(object => object.code === values.code.trim())) {
      ontologyObjectForm.setFields([{ name: 'code', errors: ['对象编码已存在，请使用新的编码。'] }]);
      return;
    }
    setSavingObject(true);
    try {
      await createSemanticOntologyObject({
        name: values.name,
        code: values.code.trim(),
        domain: values.domain,
        description: values.description,
        status: values.status,
        source_type: values.source_type ?? 'manual',
        source_ref: values.source_ref,
        fields: (values.fields ?? []).map((field: ObjectPropertyDraft) => ({
          name: field.label || field.code,
          code: field.code,
          label: field.label || field.code,
          type: field.type || 'string',
          source_field: field.source_field,
          list: field.list ?? true,
          form: field.form ?? true,
          searchable: field.search ?? false,
        })),
      });
      setObjectModalOpen(false);
      ontologyObjectForm.resetFields();
      await refreshOntologyGovernance();
      message.success('对象模型已保存');
    } catch (error: any) {
      message.error(error?.response?.data?.detail ?? '对象保存失败');
    } finally {
      setSavingObject(false);
    }
  };

  const deprecateSelectedObject = () => {
    if (!selectedObject) return;
    Modal.confirm({
      title: '废弃对象',
      content: `废弃「${selectedObject.name}」前建议先查看影响分析。对象不会被物理删除，会标记为 deprecated。`,
      okText: '废弃',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        await createSemanticOntologyObject({
          ...selectedObject,
          status: 'deprecated',
          source_type: 'manual',
          source_ref: selectedObject.source,
        });
        await refreshOntologyGovernance();
        message.success('对象已标记为废弃');
      },
    });
  };

  const openRelationModal = (source: OntologyObject | undefined = selectedObject) => {
    ontologyRelationForm.resetFields();
    ontologyRelationForm.setFieldsValue({
      relation_type: 'RELATED_TO',
      graph_enabled: true,
      source_object_code: source?.code,
    });
    setRelationModalOpen(true);
  };

  const saveOntologyRelation = async () => {
    const values = await ontologyRelationForm.validateFields();
    setSavingRelation(true);
    try {
      await createSemanticOntologyRelation({
        name: values.name,
        code: values.code,
        relation_type: values.relation_type,
        source_object_code: values.source_object_code,
        target_object_code: values.target_object_code,
        description: values.description,
        graph_enabled: values.graph_enabled,
        source_type: 'manual',
      });
      setRelationModalOpen(false);
      ontologyRelationForm.resetFields();
      await refreshOntologyGovernance();
      message.success('对象关系已保存');
    } catch (error: any) {
      message.error(error?.response?.data?.detail ?? '关系保存失败');
    } finally {
      setSavingRelation(false);
    }
  };

  const publishOntologyVersion = async () => {
    setPublishingOntology(true);
    try {
      const title = `Object model v${(ontologyVersions[0]?.version ?? 0) + 1}`;
      await publishSemanticOntology({ title });
      await refreshOntologyGovernance();
      message.success('对象与关系模型已发布新版本');
    } catch (error: any) {
      message.error(error?.response?.data?.detail ?? '发布失败');
    } finally {
      setPublishingOntology(false);
    }
  };

  const runImpactAnalysis = async (fieldCode?: string) => {
    if (!selectedObject) return;
    setImpactLoading(true);
    try {
      const res = await getSemanticOntologyImpact({ object_code: selectedObject.code, field_code: fieldCode });
      setImpactResult(res.data?.data ?? null);
      setOntologyTab('impact');
    } catch (error: any) {
      message.error(error?.response?.data?.detail ?? '影响分析失败');
    } finally {
      setImpactLoading(false);
    }
  };

  const buildQualityRulePayload = (values: any, baseRule?: DataQualityRule) => ({
    source_id: selectedAsset?.persisted ? selectedAsset.id : undefined,
    entity_name: selectedTable?.name ?? '',
    field_name: values.field_name || null,
    key: values.key || baseRule?.key,
    name: values.name || baseRule?.name || '质量指标',
    rule_type: values.rule_type || baseRule?.rule_type || 'custom',
    dimension: values.dimension || baseRule?.dimension || 'custom',
    description: values.description ?? baseRule?.description ?? '',
    severity: values.severity || baseRule?.severity || 'warning',
    threshold: Number(values.threshold ?? baseRule?.threshold ?? 95),
    weight: Number(values.weight ?? baseRule?.weight ?? 1),
    enabled: values.enabled ?? baseRule?.enabled ?? true,
    include_in_score: values.include_in_score ?? baseRule?.include_in_score ?? true,
    config: values.config ?? baseRule?.config ?? {},
  });

  const openQualityRuleModal = (rule?: DataQualityRule) => {
    if (!selectedTable) return;
    setEditingQualityRule(rule);
    qualityRuleForm.setFieldsValue({
      key: rule?.key,
      name: rule?.name ?? '',
      rule_type: rule?.rule_type ?? 'custom',
      dimension: rule?.dimension ?? 'custom',
      field_name: rule?.field_name ?? undefined,
      severity: rule?.severity ?? 'warning',
      threshold: rule?.threshold ?? 95,
      weight: rule?.weight ?? 1,
      enabled: rule?.enabled ?? true,
      include_in_score: rule?.include_in_score ?? true,
      description: rule?.description ?? '',
      configText: JSON.stringify(rule?.config ?? {}, null, 2),
    });
    setQualityRuleModalOpen(true);
  };

  const openQualityScoreStandard = () => {
    const formulaSource = selectedQualityRules.find((rule) => {
      const config = rule.config as Record<string, any> | undefined;
      return config?.score_formula;
    });
    const formulaConfig = ((formulaSource?.config as Record<string, any> | undefined)?.score_formula ?? {}) as Record<string, any>;
    qualityScoreForm.setFieldsValue({
      formula_mode: formulaConfig.mode ?? 'weighted_average',
      formula_expression: formulaConfig.expression ?? 'sum(passRate * weight) / sum(weight)',
      rules: selectedQualityRules.map((rule) => ({
        key: rule.key,
        weight: rule.weight ?? 1,
        threshold: rule.threshold ?? 95,
        enabled: rule.enabled !== false,
        include_in_score: rule.include_in_score !== false,
      })),
    });
    setQualityScoreStandardOpen(true);
  };

  const saveQualityRule = async () => {
    if (!selectedTable) return;
    const values = await qualityRuleForm.validateFields();
    let config: Record<string, unknown> = {};
    const configText = String(values.configText || '').trim();
    if (configText) {
      try {
        config = JSON.parse(configText);
      } catch {
        message.error('规则参数必须是合法 JSON');
        return;
      }
    }
    setSavingQualityRule(true);
    try {
      const payload = buildQualityRulePayload({ ...values, config }, editingQualityRule);
      if (editingQualityRule?.id) {
        await updateSemanticDataQualityRule(Number(editingQualityRule.id), payload);
      } else {
        await createSemanticDataQualityRule(payload);
      }
      setQualityRuleModalOpen(false);
      setEditingQualityRule(undefined);
      qualityRuleForm.resetFields();
      await load();
      message.success('质量指标已保存');
    } catch (error: any) {
      message.error(error?.response?.data?.detail ?? '质量指标保存失败');
    } finally {
      setSavingQualityRule(false);
    }
  };

  const saveQualityScoreStandard = async () => {
    if (!selectedTable) return;
    const values = await qualityScoreForm.validateFields();
    const rows = Array.isArray(values.rules) ? values.rules : [];
    const formulaConfig = {
      mode: values.formula_mode ?? 'weighted_average',
      expression: String(values.formula_expression ?? 'sum(passRate * weight) / sum(weight)').trim(),
    };
    if (!formulaConfig.expression) {
      message.error('请输入评分公式');
      return;
    }
    setSavingQualityRule(true);
    try {
      for (const row of rows) {
        const rule = selectedQualityRules.find((item) => item.key === row.key);
        if (!rule) continue;
        const ruleConfig = rule.config && typeof rule.config === 'object' ? rule.config : {};
        const payload = buildQualityRulePayload({
          ...rule,
          weight: row.weight,
          threshold: row.threshold,
          enabled: row.enabled,
          include_in_score: row.include_in_score,
          config: {
            ...ruleConfig,
            score_formula: formulaConfig,
          },
        }, rule);
        if (rule.id) {
          await updateSemanticDataQualityRule(Number(rule.id), payload);
        } else {
          await createSemanticDataQualityRule(payload);
        }
      }
      setQualityScoreStandardOpen(false);
      await load();
      message.success('评分公式已保存');
    } catch (error: any) {
      message.error(error?.response?.data?.detail ?? '评分公式保存失败');
    } finally {
      setSavingQualityRule(false);
    }
  };

  const updateQualityRule = async (rule: DataQualityRule, checked: boolean) => {
    if (!selectedTable) return;
    setQualityRuleState((prev) => ({ ...prev, [`${selectedTable.id}:${rule.key}`]: checked ? 'enabled' : 'disabled' }));
    try {
      const payload = buildQualityRulePayload({ ...rule, enabled: checked, config: rule.config ?? {} }, rule);
      if (rule.id) {
        await updateSemanticDataQualityRule(Number(rule.id), payload);
      } else {
        await createSemanticDataQualityRule(payload);
      }
      await load();
    } catch (error: any) {
      setQualityRuleState((prev) => ({ ...prev, [`${selectedTable.id}:${rule.key}`]: rule.enabled ? 'enabled' : 'disabled' }));
      message.error(error?.response?.data?.detail ?? '质量指标状态保存失败');
    }
  };

  const removeQualityRule = (rule: DataQualityRule) => {
    if (!rule.id) {
      message.info('自动指标不能删除，可以关闭或编辑后保存为配置');
      return;
    }
    Modal.confirm({
      title: '删除质量指标',
      content: `确定删除「${rule.name}」吗？`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        await deleteSemanticDataQualityRule(Number(rule.id));
        await load();
        message.success('质量指标已删除');
      },
    });
  };
  const dataAssetView = (
    <DataAssetView
      catalog={{
        activeDomain,
        setActiveDomain,
        assetSearch,
        setAssetSearch,
        assetStats,
        assets,
        assetLoadFailed,
        loading,
        selectedAsset,
        setSelectedAssetId,
        setSelectedTableId,
        selectedAssetStats,
        filteredTables,
        selectedTable,
        scanning,
        assetCandidates,
      }}
      quality={{
        editingQualityRule,
        setEditingQualityRule,
        qualityRuleForm,
        qualityRuleModalOpen,
        setQualityRuleModalOpen,
        qualityRuleState,
        qualityScoreForm,
        qualityScoreStandardOpen,
        setQualityScoreStandardOpen,
        selectedQualityRuleStats,
        selectedQualityRules,
        savingQualityRule,
        openQualityRuleModal,
        openQualityScoreStandard,
        removeQualityRule,
        saveQualityRule,
        saveQualityScoreStandard,
        updateQualityRule,
      }}
      candidates={{
        ontologyMappings,
        objects,
        candidatesForTable,
        selectedTableCandidates,
        openCandidateReview,
      }}
      actions={{
        load,
        navigate,
        clearMetadataView,
        openMapping,
        scanMetadata,
        openSync: isAdmin && selectedAsset?.persisted && selectedAsset.type === 'postgresql' && selectedTable
          ? () => setSyncTarget({ id: selectedAsset.id, name: selectedAsset.name, entity: selectedTable.name })
          : undefined,
      }}
    />
  );
  const semanticMappingView = (
    <SemanticMappingView
      scope={{
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
        createObjectFromTable,
        createPropertyFromField,
        requestedTableName: params.get('entity') || undefined,
      }}
      canvas={{
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
        connectSourceField: createMappingFromNodes,
        selectedMappingElement,
        setSelectedMappingElement,
      }}
    />
  );
  const fieldMapping = <div className="ontology-field-mapping">
    <Segmented
      aria-label="字段映射来源类型"
      value={mappingSourceKind}
      onChange={setMappingSourceKind}
      options={[{ label: '业务表单', value: 'form' }, { label: '外部数据源', value: 'external' }]}
    />
    {ontologyTab === 'mapping' && (mappingSourceKind === 'external' ? semanticMappingView : <Card size="small" title="业务表单字段">
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <div className="ontology-form-mapping-header">
          <Select
            aria-label="绑定业务表单的对象"
            placeholder="选择已发布的对象"
            value={mappingObject?.status === 'published' ? mappingObject.code : undefined}
            onChange={setMappingObjectCode}
            options={objects.filter(object => object.status === 'published').map(object => ({ value: object.code, label: object.name }))}
          />
          <Typography.Text type="secondary">绑定后，对象浏览会使用这张表的记录。</Typography.Text>
        </div>
        {mappingObject?.status === 'published' ? <ObjectBindingFields
          key={mappingObject.id}
          model={mappingObject}
          showSourceFields
          initialFormCode={params.get('formCode') || undefined}
          onChange={() => void refreshOntologyGovernance().catch(() => message.warning('记录来源已保存，刷新对象模型后可查看。'))}
        /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请选择要绑定业务表单的已发布对象" />}
      </Space>
    </Card>)}
  </div>;
  const ontologyView = (
    <OntologyView
      fieldMapping={fieldMapping}
      model={{
        candidateStats,
        impactLoading,
        impactResult,
        loadFailed,
        loading,
        objectRelations,
        objects,
        ontologyCandidates,
        ontologyPublishStats,
        ontologyTab,
        setOntologyTab: changeOntologyTab,
        ontologyVersions,
        relations,
        requestedCandidate,
        reviewingCandidateId,
        selectedCandidate,
        setSelectedCandidateId,
        selectedObject,
        setSelectedObjectId,
        selectedObjectMappings,
      }}
      actions={{
        deprecateSelectedObject,
        objectModalOpen,
        editingObject,
        setObjectModalOpen,
        ontologyObjectForm,
        openObjectModal,
        saveOntologyObject,
        savingObject,
        openRelationModal,
        openObjectMapping,
        relationModalOpen,
        setRelationModalOpen,
        ontologyRelationForm,
        saveOntologyRelation,
        savingRelation,
        publishOntologyVersion,
        publishingOntology,
        refreshOntologyGovernance,
        reviewCandidate,
        runImpactAnalysis,
        load,
      }}
    />
  );

  return (
    <div className={view ? 'semantic-center semantic-asset-center semantic-asset-center-single' : 'semantic-center semantic-asset-center'}>
      {!embedded && <section className="semantic-center-header">
        <div>
          <Typography.Title level={4}>数据语义中心</Typography.Title>
          <Typography.Text type="secondary">从数据资产进入语义映射，再审核发布为对象与关系模型。</Typography.Text>
        </div>
        <Space>
          <Tag icon={<FileSearchOutlined />}>Data Semantic Governance</Tag>
          <Button icon={<ReloadOutlined />} onClick={load}>重新读取</Button>
        </Space>
      </section>}
      {isAdmin && syncTarget && <MappedFormSyncDialog
        sourceId={syncTarget.id} sourceName={syncTarget.name} initialEntity={syncTarget.entity}
        onClose={() => setSyncTarget(undefined)} onSynced={() => void load()}
      />}
      <Modal
        title="新建对象属性并映射"
        open={Boolean(propertyCandidate)}
        onCancel={() => setPropertyCandidate(undefined)}
        onOk={savePropertyCandidate}
        okText="提交候选"
        confirmLoading={savingPropertyCandidate}
        forceRender
      >
        {propertyCandidate && <Typography.Paragraph type="secondary">
          {propertyCandidate.source.data.entity_name}.{propertyCandidate.source.data.field_name} → {propertyCandidate.object.name}
        </Typography.Paragraph>}
        <Form layout="vertical" form={propertyCandidateForm}>
          <Form.Item label="属性名称" name="label" rules={[{ required: true, whitespace: true }, { max: 200 }]}><Input /></Form.Item>
          <Form.Item label="属性编码" name="code" rules={[{ required: true, whitespace: true }, { max: 120 }]}><Input /></Form.Item>
          <Form.Item label="属性类型" name="type" rules={[{ required: true }]}><Select options={propertyTypeOptions} /></Form.Item>
          <Typography.Text type="secondary">候选批准后会同时新建属性和保存映射。</Typography.Text>
        </Form>
      </Modal>
      {embedded ? (view === 'ontology' ? ontologyView : view === 'mapping' ? semanticMappingView : dataAssetView) : view === 'ontology' ? ontologyView : <Tabs
        activeKey={semanticCenterTab}
        onChange={(key) => {
          setSemanticCenterTab(key as SemanticAssetCenterView);
          onViewChange?.(key as SemanticAssetCenterView);
        }}
        items={[
          { key: 'data', label: '数据资产', children: dataAssetView },
          { key: 'mapping', label: '语义映射', children: semanticMappingView },
          ...(!view ? [{ key: 'ontology', label: '对象与关系', children: ontologyView }] : []),
        ]}
      />}
    </div>
  );
}
