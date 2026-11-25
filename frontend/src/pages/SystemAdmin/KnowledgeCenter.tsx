import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { BranchesOutlined, CheckCircleOutlined, DatabaseOutlined, DownloadOutlined, FileSearchOutlined, FileTextOutlined, FolderOutlined, InboxOutlined, LinkOutlined, MenuFoldOutlined, MenuUnfoldOutlined, NodeIndexOutlined, OrderedListOutlined, ReloadOutlined, RobotOutlined, SearchOutlined, SendOutlined, SettingOutlined, UserOutlined } from '@/components/Icon/ant';
import { Alert, Button, Card, Col, Divider, Empty, Form, Input, List, Modal, Progress, Row, Segmented, Select, Space, Table, Tabs, Tag, Tooltip, Typography, Upload, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import GlobalSearch from '../../components/GlobalSearch';
import NotificationCenter from '../../components/NotificationCenter';
import KnowledgeReader from '../../components/KnowledgeReader';
import KnowledgeExplorer from '../../components/KnowledgeExplorer';
import { parseKnowledgeMarkdown, prepareKnowledgeMarkdown } from '../../utils/knowledgeMarkdown';
import { type KnowledgeOcrBlock, approveKnowledgeExtractionJob, commitKnowledgeExtractionJobToGraph, createKnowledgeAgentConversation, createKnowledgeDocumentExtractionJob, createKnowledgeExtractionJob, createKnowledgeOntologyIntake, enhanceKnowledgeDocumentOcr, exportKnowledgeExtractionJob, getKnowledgeDocumentMarkdown, getKnowledgeDocumentOcr, getKnowledgeOcrPipeline, listKnowledgeAgentMessages, listKnowledgeCards, listKnowledgeChunks, listKnowledgeDocuments, listKnowledgeSources, listKnowledgeSpaces, saveKnowledgeDocumentOcrCorrections, searchKnowledge, sendKnowledgeAgentMessage, uploadKnowledgeAsset } from '../../services/api';
import { KNOWLEDGE_ASSET_ORDER, KNOWLEDGE_INTAKE_ACTION_LABELS, KNOWLEDGE_INTAKE_CAPABILITY_LABELS, KNOWLEDGE_INTAKE_STATUS_LABELS, KNOWLEDGE_TYPE_LABELS, confidencePercent, getIntakeDomainLabel, getIntakeSourceTypeLabel, getIntakeSummary, getKnowledgeDocumentFileName, getKnowledgeDocumentId, getKnowledgeDocumentStatusMeta, getKnowledgeDocumentTitle, getOcrBlockId, normalizeKnowledgeTypeGroup, normalizeOcrConfidence, severityColors, type EditableOcrBlock, type ExtractionJob, type KnowledgeCard, type KnowledgeChatMessage, type KnowledgeChunk, type KnowledgeDocument, type KnowledgeSource, type KnowledgeSpace, type OntologyIntakeRecommendation } from './semanticAssetShared';
import { KnowledgeGraphCenterV2 } from './KnowledgeGraphCenter';

import './knowledgeWorkspace.css';

function KnowledgeExtractionWorkbench() {
  const [form] = Form.useForm();
  const [fileList, setFileList] = useState<any[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [job, setJob] = useState<ExtractionJob | null>(null);

  const runExtraction = async () => {
    const file = fileList[0]?.originFileObj as File | undefined;
    if (!file) {
      message.warning('请先选择一个文档');
      return;
    }
    const values = await form.validateFields();
    setExtracting(true);
    try {
      const response = await createKnowledgeExtractionJob(file, values);
      setJob(response.data?.data?.job);
      message.success('抽取任务已完成，请先审核候选结果');
    } catch (error: any) {
      message.error(error?.response?.data?.detail ?? '抽取任务创建失败');
    } finally {
      setExtracting(false);
    }
  };

  const approveJob = async () => {
    if (!job) return;
    try {
      const response = await approveKnowledgeExtractionJob(job.job_id);
      setJob(response.data?.data);
      message.success('候选结果已审核确认');
    } catch (error: any) {
      message.error(error?.response?.data?.detail ?? '审核确认失败');
    }
  };

  const commitJob = async () => {
    if (!job) return;
    setCommitting(true);
    try {
      const response = await commitKnowledgeExtractionJobToGraph(job.job_id);
      setJob(response.data?.data?.job);
      message.success('已写入图谱中心');
    } catch (error: any) {
      message.error(error?.response?.data?.detail ?? '写入图谱失败');
    } finally {
      setCommitting(false);
    }
  };

  const exportJob = async (format: string) => {
    if (!job) return;
    const response = await exportKnowledgeExtractionJob(job.job_id, format);
    const url = URL.createObjectURL(response.data);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${job.job_id}.${format === 'turtle' ? 'ttl' : format}`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="semantic-center">
      <Card>
        <Row gutter={[24, 16]}>
          <Col xs={24} lg={10}>
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <div>
                <Typography.Title level={4}>知识抽取工作台</Typography.Title>
                <Typography.Text type="secondary">把文档抽成候选实体、关系、规则和动作，审核后发布到知识库图谱。</Typography.Text>
              </div>
              <Upload.Dragger accept=".md,.markdown,.txt,.pdf,.xlsx,.xls" maxCount={1} fileList={fileList} beforeUpload={() => false} onChange={({ fileList: next }) => setFileList(next)}>
                <p className="ant-upload-drag-icon"><InboxOutlined /></p>
                <p className="ant-upload-text">选择或拖入文档</p>
                <p className="ant-upload-hint">支持 Markdown、TXT、PDF、Excel。图片/OCR 后续接入。</p>
              </Upload.Dragger>
            </Space>
          </Col>
          <Col xs={24} lg={14}>
            <Form form={form} layout="vertical" initialValues={{ domain: 'manufacturing', prompt_name: 'manufacturing_ontology_v1', model_name: 'rules-ontology-extractor', permission_scope: 'enterprise', owner_user_id: 'knowledge-admin' }}>
              <Row gutter={12}>
                <Col xs={24} md={12}>
                  <Form.Item label="业务领域" name="domain" rules={[{ required: true }]}>
                    <Select options={[
                      { value: 'manufacturing', label: '制造业' },
                      { value: 'quality', label: '质量管理' },
                      { value: 'supply_chain', label: '供应链' },
                      { value: 'maintenance', label: '设备维护' },
                    ]} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item label="Prompt 模板" name="prompt_name" rules={[{ required: true }]}>
                    <Select options={[
                      { value: 'manufacturing_ontology_v1', label: '制造业本体抽取 v1' },
                      { value: 'quality_event_v1', label: '质量事件抽取 v1' },
                      { value: 'supplier_8d_v1', label: '供应商 8D 抽取 v1' },
                    ]} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item label="模型" name="model_name" rules={[{ required: true }]}>
                    <Select options={[
                      { value: 'rules-ontology-extractor', label: 'Rules extractor' },
                      { value: 'glm-4-flash', label: 'GLM-4-Flash' },
                      { value: 'qwen-plus', label: 'Qwen Plus' },
                      { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
                    ]} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item label="知识范围" name="permission_scope" rules={[{ required: true }]}>
                    <Select options={[
                      { value: 'enterprise', label: '企业' },
                      { value: 'department', label: '部门' },
                      { value: 'team-quality', label: '质量团队' },
                      { value: 'personal', label: '个人' },
                    ]} />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item label="上传人" name="owner_user_id"><Input /></Form.Item>
              <Button type="primary" icon={<FileSearchOutlined />} loading={extracting} onClick={runExtraction}>开始抽取</Button>
            </Form>
          </Col>
        </Row>
      </Card>

      {!job ? (
        <Card style={{ marginTop: 16 }}><Empty description="上传文档并开始抽取后，这里会显示候选实体、关系和质量报告" /></Card>
      ) : (
        <Space direction="vertical" size={16} style={{ width: '100%', marginTop: 16 }}>
          <Card
            title={<Space wrap><span>抽取任务</span><Tag color={job.status === 'committed' ? 'green' : job.status === 'blocked' ? 'red' : 'blue'}>{job.status}</Tag><Typography.Text code>{job.job_id}</Typography.Text></Space>}
            extra={<Space wrap>
              <Button icon={<CheckCircleOutlined />} onClick={approveJob}>审核确认</Button>
              <Button type="primary" loading={committing} disabled={job.quality_report.blocking} onClick={commitJob}>写入图谱中心</Button>
              {['json', 'csv', 'yaml', 'turtle'].map((format) => <Button key={format} icon={<DownloadOutlined />} onClick={() => exportJob(format)}>{format === 'turtle' ? 'RDF' : format.toUpperCase()}</Button>)}
            </Space>}
          >
            <Alert type={job.quality_report.blocking ? 'error' : 'success'} showIcon message={job.quality_report.blocking ? '存在 FATAL 问题，暂不能写入图谱' : '抽取完成，可以审核并写入图谱中心'} style={{ marginBottom: 12 }} />
            <Row gutter={12}>
              {['FATAL', 'ERROR', 'WARNING', 'INFO'].map((severity) => (
                <Col xs={12} md={6} key={severity}>
                  <Card size="small"><Space><Tag color={severityColors[severity]}>{severity}</Tag><Typography.Text strong>{job.quality_report.counts?.[severity] ?? 0}</Typography.Text></Space></Card>
                </Col>
              ))}
            </Row>
          </Card>
          <Row gutter={[16, 16]}>
            <Col xs={24} lg={14}>
              <Card title={`候选实体 (${job.result.entities.length})`} size="small">
                <Table size="small" rowKey="candidate_id" dataSource={job.result.entities} pagination={{ pageSize: 6 }} columns={[
                  { title: '名称', dataIndex: 'name', ellipsis: true },
                  { title: '类型', dataIndex: 'entity_type', width: 130, render: (value) => <Tag color="blue">{value}</Tag> },
                  { title: '置信度', dataIndex: 'confidence', width: 140, render: (value: number) => <Progress size="small" percent={confidencePercent(value)} /> },
                  { title: '证据', dataIndex: 'source_location', width: 110 },
                ]} />
              </Card>
            </Col>
            <Col xs={24} lg={10}>
              <Card title={`候选关系 (${job.result.relations.length})`} size="small">
                <Table size="small" rowKey="candidate_id" dataSource={job.result.relations} pagination={{ pageSize: 6 }} columns={[
                  { title: '来源', dataIndex: 'source_name', ellipsis: true },
                  { title: '关系', dataIndex: 'relation_type', width: 110, render: (value) => <Tag>{value}</Tag> },
                  { title: '目标', dataIndex: 'target_name', ellipsis: true },
                ]} />
              </Card>
            </Col>
          </Row>
          <Card title="质量报告" size="small">
            <Table size="small" rowKey={(record) => `${record.severity}-${record.code}-${record.target}`} dataSource={job.quality_report.items} pagination={false} columns={[
              { title: '级别', dataIndex: 'severity', width: 110, render: (value) => <Tag color={severityColors[value]}>{value}</Tag> },
              { title: '代码', dataIndex: 'code', width: 220 },
              { title: '对象', dataIndex: 'target', width: 220 },
              { title: '说明', dataIndex: 'message' },
            ]} />
          </Card>
        </Space>
      )}
    </div>
  );
}

export function KnowledgeCenter() {
  const navigate = useNavigate();
  const [commandOpen, setCommandOpen] = useState(false);
  const [libraryWidth, setLibraryWidth] = useState(280);
  const [inspectorWidth, setInspectorWidth] = useState(280);
  const resizeStart = useRef<{ side: 'library' | 'inspector'; x: number; width: number } | null>(null);
  const commandRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setCommandOpen(true); }
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, []);
  const [spaces, setSpaces] = useState<KnowledgeSpace[]>([]);
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [cards, setCards] = useState<KnowledgeCard[]>([]);
  const [chunks, setChunks] = useState<KnowledgeChunk[]>([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string>('');
  const [documentMarkdown, setDocumentMarkdown] = useState('');
  const [markdownLoading, setMarkdownLoading] = useState(false);
  const [draftQuery, setDraftQuery] = useState('从当前文档抽取系统、能力和上下游关系');
  const [chatMessages, setChatMessages] = useState<KnowledgeChatMessage[]>([]);
  const [agentConversationId, setAgentConversationId] = useState<string>();
  const [agentLoading, setAgentLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [intakeRecommendation, setIntakeRecommendation] = useState<OntologyIntakeRecommendation | null>(null);
  const [intakeLoading, setIntakeLoading] = useState(false);
  const [ontologyJob, setOntologyJob] = useState<ExtractionJob | null>(null);
  const [ontologyExtracting, setOntologyExtracting] = useState(false);
  const [ontologyApproving, setOntologyApproving] = useState(false);
  const [ontologyCommitting, setOntologyCommitting] = useState(false);
  const [mode, setMode] = useState<string | number>('original');
  const [libraryVisible, setLibraryVisible] = useState(true);
  const [inspectorVisible, setInspectorVisible] = useState(() => window.innerWidth >= 1200);
  const [inspectorTab, setInspectorTab] = useState<string | number>('outline');
  const [openDocumentIds, setOpenDocumentIds] = useState<string[]>([]);
  const readerRef = useRef<HTMLDivElement | null>(null);
  const openDocument = (id: string) => {
    if (id !== selectedDocumentId) setDocumentMarkdown('');
    setSelectedDocumentId(id);
    setMode('original');
  };
  const [ocrBlocks, setOcrBlocks] = useState<EditableOcrBlock[]>([]);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrSaving, setOcrSaving] = useState(false);
  const [ocrEnhancing, setOcrEnhancing] = useState(false);
  const [ocrAverageConfidence, setOcrAverageConfidence] = useState<number>();
  const [ocrLowConfidenceCount, setOcrLowConfidenceCount] = useState(0);
  const [ocrEnhanced, setOcrEnhanced] = useState(false);
  const chatThreadRef = useRef<HTMLDivElement | null>(null);

  const explorerDocuments = useMemo(() => [...documents].sort((a, b) => {
    const aRank = KNOWLEDGE_ASSET_ORDER.indexOf(getKnowledgeDocumentId(a));
    const bRank = KNOWLEDGE_ASSET_ORDER.indexOf(getKnowledgeDocumentId(b));
    return (aRank < 0 ? 999 : aRank) - (bRank < 0 ? 999 : bRank) || String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
  }).map(item => ({
    id: getKnowledgeDocumentId(item), title: getKnowledgeDocumentTitle(item), filename: getKnowledgeDocumentFileName(item),
    type: normalizeKnowledgeTypeGroup(item), typeLabel: KNOWLEDGE_TYPE_LABELS[normalizeKnowledgeTypeGroup(item)] || '其他文档',
    updatedAt: String(item.updated_at || ''),
    searchText: [item.summary, item.permission_scope, ...(item.linked_objects || []).flatMap(link => [link.type, link.id, link.name, link.object_type, link.object_id, link.object_name])].filter(Boolean).join(' '),
  })), [documents]);
  const selectedDocument = documents.find((item: any) => (item.id ?? item.document_id) === selectedDocumentId) ?? documents[0];
  const selectedTitle = (selectedDocument as any)?.title ?? (selectedDocument as any)?.document_title ?? (selectedDocument as any)?.file_name ?? '暂无知识文档';
  const selectedSummary = (selectedDocument as any)?.summary ?? (selectedDocument ? `来源文件：${(selectedDocument as any)?.source_file_name ?? (selectedDocument as any)?.file_name ?? '数据库文档'}` : '上传或完成种子数据后，知识库目录会按数据库内容自动刷新。');
  const selectedUpdatedAt = (selectedDocument as any)?.updated_at ?? '-';
  const selectedLinks = ((selectedDocument as any)?.linked_objects ?? []) as Array<{ type?: string; id?: string; name?: string; object_type?: string; object_id?: string; object_name?: string; confidence?: number; status?: string; source_location?: string }>;
  const selectedRawText = documentMarkdown || (selectedDocument as any)?.markdown_content || '';
  const readerSource = useMemo(() => prepareKnowledgeMarkdown(selectedRawText, selectedTitle), [selectedRawText, selectedTitle]);
  const outline = useMemo(() => parseKnowledgeMarkdown(readerSource).filter(block => block.type === 'heading'), [readerSource]);
  useEffect(() => {
    if (!selectedDocumentId || !documents.some(item => getKnowledgeDocumentId(item) === selectedDocumentId)) return;
    setOpenDocumentIds(previous => [...new Set([...previous.filter(id => documents.some(item => getKnowledgeDocumentId(item) === id)), selectedDocumentId])]);
  }, [selectedDocumentId, documents]);
  const closeDocument = (id: string) => {
    const remaining = openDocumentIds.filter(item => item !== id);
    if (!remaining.length) return;
    setOpenDocumentIds(remaining);
    if (selectedDocumentId === id) openDocument(remaining[Math.max(0, openDocumentIds.indexOf(id) - 1)] || remaining[0]);
  };
  const selectedSourceType = String((selectedDocument as any)?.source_type ?? (selectedDocument as any)?.doc_type ?? 'database');
  const selectedDomainTags = selectedDocument
    ? [selectedSourceType.toUpperCase(), (selectedDocument as any)?.permission_scope ?? 'enterprise', (selectedDocument as any)?.owner_user_id ?? 'knowledge']
    : ['DATABASE'];
  const selectedDocumentName = String(
    (selectedDocument as any)?.file_name
      ?? (selectedDocument as any)?.source_file_name
      ?? (selectedDocument as any)?.filename
      ?? (selectedDocument as any)?.title
      ?? (selectedDocument as any)?.document_title
      ?? '',
  ).toLowerCase();
  const selectedDocumentMime = String(
    (selectedDocument as any)?.mime_type
      ?? (selectedDocument as any)?.content_type
      ?? (selectedDocument as any)?.file_type
      ?? (selectedDocument as any)?.source_type
      ?? '',
  ).toLowerCase();
  const indexedDocumentCount = documents.filter((item: any) => (item.status ?? '').toLowerCase() === 'indexed').length;
  const pendingExtractCount = documents.filter((item: any) => !((item.linked_objects ?? []).length)).length;
  const publishedDocumentCount = documents.filter((item: any) => (item.linked_objects ?? []).length > 0).length;
  const selectedIsOcrDocument = Boolean(
    selectedDocumentId
      && (
        selectedDocumentMime.includes('pdf')
        || selectedDocumentMime.startsWith('image/')
        || /\.(pdf|png|jpe?g|webp|tiff?|bmp)$/i.test(selectedDocumentName)
      ),
  );
  const ocrConfidencePercent = normalizeOcrConfidence(
    ocrAverageConfidence
      ?? (ocrBlocks.length
        ? ocrBlocks.reduce((sum, block) => sum + Number(block.confidence ?? 0), 0) / ocrBlocks.length
        : 0),
  );
  const ontologyEntities = (ontologyJob?.result?.entities ?? []) as any[];
  const ontologyRelations = (ontologyJob?.result?.relations ?? []) as any[];

  const toChatMessage = (item: any): KnowledgeChatMessage => ({
    id: item.message_id ?? item.id,
    role: item.role === 'user' ? 'user' : 'assistant',
    content: item.content ?? '',
  });

  const loadKnowledge = async () => {
    try {
      const [spaceRes, sourceRes, documentRes, cardRes] = await Promise.all([
        listKnowledgeSpaces(),
        listKnowledgeSources(),
        listKnowledgeDocuments('database'),
        listKnowledgeCards(),
        getKnowledgeOcrPipeline().catch(() => null),
      ]);
      const nextDocuments = documentRes.data?.data ?? [];
      setSpaces(spaceRes.data?.data ?? []);
      setSources(sourceRes.data?.data ?? []);
      setDocuments(nextDocuments);
      setCards(cardRes.data?.data ?? []);
      setSelectedDocumentId((prev) => (
        nextDocuments.some((item: any) => (item.id ?? item.document_id) === prev)
          ? prev
          : nextDocuments[0]?.id ?? nextDocuments[0]?.document_id ?? ''
      ));
    } catch {
      setSpaces([]);
      setSources([]);
      setDocuments([]);
      setCards([]);
      setSelectedDocumentId((prev) => prev ?? '');
    }
  };

  useEffect(() => {
    loadKnowledge();
  }, []);

  const loadOcr = async () => {
    if (!selectedDocumentId || !selectedIsOcrDocument) {
      setOcrBlocks([]);
      setOcrAverageConfidence(undefined);
      setOcrLowConfidenceCount(0);
      setOcrEnhanced(false);
      return;
    }
    setOcrLoading(true);
    try {
      const res = await getKnowledgeDocumentOcr(selectedDocumentId);
      const payload = (res.data as any)?.data ?? res.data ?? {};
      const blocks: KnowledgeOcrBlock[] = payload.blocks ?? [];
      const editableBlocks = blocks.map((block, index) => ({
        ...block,
        row_id: getOcrBlockId(block, index),
        corrected_text: block.corrected_text ?? block.text ?? block.raw_text ?? '',
      }));
      setOcrBlocks(editableBlocks);
      setOcrAverageConfidence(payload.average_confidence ?? payload.avg_confidence);
      setOcrLowConfidenceCount(
        payload.low_confidence_count
          ?? editableBlocks.filter((block) => normalizeOcrConfidence(block.confidence) < 80).length,
      );
      setOcrEnhanced(Boolean(payload.enhanced ?? editableBlocks.some((block) => block.enhanced)));
    } catch (error: any) {
      setOcrBlocks([]);
      setOcrAverageConfidence(undefined);
      setOcrLowConfidenceCount(0);
      setOcrEnhanced(false);
      if (error?.response?.status !== 404) {
        message.error(error?.response?.data?.detail ?? 'OCR result is unavailable');
      }
    } finally {
      setOcrLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedDocumentId) {
      setChunks([]);
      return;
    }
    listKnowledgeChunks(selectedDocumentId)
      .then((res) => setChunks(res.data?.data ?? []))
      .catch(() => setChunks([]));
  }, [selectedDocumentId]);

  useEffect(() => {
    let cancelled = false;
    const loadIntake = async () => {
      setOntologyJob(null);
      if (!selectedDocumentId) {
        setIntakeRecommendation(null);
        return;
      }
      setIntakeLoading(true);
      try {
        const res = await createKnowledgeOntologyIntake(selectedDocumentId, { domain_hint: 'manufacturing', mode: 'recommend' });
        if (!cancelled) {
          setIntakeRecommendation(res.data?.data ?? null);
        }
      } catch {
        if (!cancelled) {
          setIntakeRecommendation(null);
        }
      } finally {
        if (!cancelled) {
          setIntakeLoading(false);
        }
      }
    };
    loadIntake();
    return () => {
      cancelled = true;
    };
  }, [selectedDocumentId]);

  useEffect(() => {
    let cancelled = false;
    const loadMarkdown = async () => {
      if (!selectedDocumentId) {
        setDocumentMarkdown('');
        return;
      }
      setMarkdownLoading(true);
      try {
        const res = await getKnowledgeDocumentMarkdown(selectedDocumentId);
        const payload = res.data?.data ?? res.data ?? {};
        if (!cancelled) {
          setDocumentMarkdown(payload.markdown_content ?? '');
        }
      } catch {
        if (!cancelled) {
          setDocumentMarkdown((selectedDocument as any)?.markdown_content ?? '');
        }
      } finally {
        if (!cancelled) {
          setMarkdownLoading(false);
        }
      }
    };
    loadMarkdown();
    return () => {
      cancelled = true;
    };
  }, [selectedDocumentId, selectedDocument]);

  useEffect(() => {
    if (mode === 'ocr') {
      loadOcr();
    }
  }, [mode, selectedDocumentId, selectedIsOcrDocument]);

  useEffect(() => {
    let cancelled = false;
    const syncConversation = async () => {
      if (!selectedDocumentId) return;
      setAgentLoading(true);
      try {
        const conversationRes = await createKnowledgeAgentConversation({
          document_id: selectedDocumentId,
          document_title: selectedTitle,
          page: 'knowledge-center',
          metadata: { source: 'knowledge-center' },
        });
        const conversation = conversationRes.data?.data;
        const nextConversationId = conversation?.conversation_id ?? conversation?.id;
        if (!nextConversationId) return;
        const messagesRes = await listKnowledgeAgentMessages(nextConversationId);
        if (!cancelled) {
          setAgentConversationId(nextConversationId);
          setChatMessages((messagesRes.data?.data ?? []).map(toChatMessage));
        }
      } catch {
        if (!cancelled) {
          setAgentConversationId(undefined);
          setChatMessages([]);
          message.warning('知识 Agent 会话暂不可用，当前对话仅在页面内保留');
        }
      } finally {
        if (!cancelled) {
          setAgentLoading(false);
        }
      }
    };
    syncConversation();
    return () => {
      cancelled = true;
    };
  }, [selectedDocumentId, selectedTitle]);

  useEffect(() => {
    const thread = chatThreadRef.current;
    if (thread) {
      thread.scrollTop = thread.scrollHeight;
    }
  }, [chatMessages, searching]);

  const runSearch = async () => {
    const nextQuery = draftQuery.trim();
    if (!nextQuery || searching) return;

    let activeConversationId = agentConversationId;
    const userMessage: KnowledgeChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: nextQuery,
    };

    setChatMessages((prev) => [...prev, userMessage]);
    setDraftQuery('');
    setSearching(true);
    try {
      if (!activeConversationId) {
        const conversationRes = await createKnowledgeAgentConversation({
          document_id: selectedDocumentId,
          document_title: selectedTitle,
          page: 'knowledge-center',
          metadata: { source: 'knowledge-center' },
        });
        const conversation = conversationRes.data?.data;
        activeConversationId = conversation?.conversation_id ?? conversation?.id;
        setAgentConversationId(activeConversationId);
      }
      if (!activeConversationId) {
        throw new Error('Agent conversation is unavailable');
      }
      const res = await sendKnowledgeAgentMessage(activeConversationId, {
        content: nextQuery,
        context: { document_id: selectedDocumentId, document_title: selectedTitle },
      });
      const payload = res.data?.data ?? {};
      const serverMessages = [payload.user_message, payload.assistant_message].filter(Boolean).map(toChatMessage);
      setChatMessages((prev) => [...prev.filter((item) => item.id !== userMessage.id), ...serverMessages]);
    } catch {
      setChatMessages((prev) => [
        ...prev,
        {
          id: `assistant-error-${Date.now()}`,
          role: 'assistant',
          content: '知识 Agent 服务暂不可用，我已保留你的问题；请稍后重试。',
        },
      ]);
    } finally {
      setSearching(false);
    }
  };

  const updateOcrBlockCorrection = (rowId: string, correctedText: string) => {
    setOcrBlocks((prev) => prev.map((block) => (
      block.row_id === rowId ? { ...block, corrected_text: correctedText } : block
    )));
  };

  const saveOcrCorrections = async () => {
    if (!selectedDocumentId) return;
    setOcrSaving(true);
    try {
      await saveKnowledgeDocumentOcrCorrections(selectedDocumentId, ocrBlocks.map(({ row_id, ...block }) => block));
      message.success('OCR corrections saved');
      loadOcr();
    } catch (error: any) {
      message.error(error?.response?.data?.detail ?? 'Failed to save OCR corrections');
    } finally {
      setOcrSaving(false);
    }
  };

  const enhanceOcr = async () => {
    if (!selectedDocumentId) return;
    setOcrEnhancing(true);
    try {
      await enhanceKnowledgeDocumentOcr(selectedDocumentId);
      message.success('OCR enhancement started');
      await loadOcr();
    } catch (error: any) {
      message.error(error?.response?.data?.detail ?? 'Failed to enhance OCR');
    } finally {
      setOcrEnhancing(false);
    }
  };

  const handleUpload = async (options: any) => {
    setUploading(true);
    try {
      const response = await uploadKnowledgeAsset(options.file, { permission_scope: 'enterprise', owner_user_id: 'knowledge-admin' });
      const payload = response.data?.data ?? {};
      const uploadedDocumentId = payload.document?.document_id ?? payload.document?.id;
      if (uploadedDocumentId) {
        setSelectedDocumentId(uploadedDocumentId);
      }
      setIntakeRecommendation(payload.intake_recommendation ?? null);
      setOntologyJob(null);
      message.success('资料已进入知识库，可在当前文档右侧继续抽取、审核和发布');
      options.onSuccess?.({});
      loadKnowledge();
    } catch (error: any) {
      message.error(error?.response?.data?.detail ?? '上传失败');
      options.onError?.(error);
    } finally {
      setUploading(false);
    }
  };

  const startOntologyExtraction = async () => {
    if (!selectedDocumentId || ontologyExtracting) return;
    setOntologyExtracting(true);
    try {
      const response = await createKnowledgeDocumentExtractionJob(selectedDocumentId, {
        domain: intakeRecommendation?.document_profile?.likely_domain ?? 'general',
        prompt_name: 'manufacturing_ontology_v1',
        model_name: 'rules-ontology-extractor',
      });
      const nextJob = response.data?.data?.job;
      setOntologyJob(nextJob ?? null);
      setMode('objects');
      message.success('Ontology candidates are ready for review.');
    } catch (error: any) {
      message.error(error?.response?.data?.detail ?? 'Failed to extract ontology candidates');
    } finally {
      setOntologyExtracting(false);
    }
  };

  const approveOntologyJob = async () => {
    if (!ontologyJob || ontologyApproving) return;
    setOntologyApproving(true);
    try {
      const response = await approveKnowledgeExtractionJob(ontologyJob.job_id);
      setOntologyJob(response.data?.data ?? null);
      message.success('Ontology candidates approved.');
    } catch (error: any) {
      message.error(error?.response?.data?.detail ?? 'Failed to approve ontology candidates');
    } finally {
      setOntologyApproving(false);
    }
  };

  const commitOntologyJob = async () => {
    if (!ontologyJob || ontologyCommitting) return;
    setOntologyCommitting(true);
    try {
      const response = await commitKnowledgeExtractionJobToGraph(ontologyJob.job_id);
      setOntologyJob(response.data?.data?.job ?? null);
      await loadKnowledge();
      setMode('graph');
      message.success('Ontology candidates were published to graph assets.');
    } catch (error: any) {
      message.error(error?.response?.data?.detail ?? 'Failed to publish ontology candidates');
    } finally {
      setOntologyCommitting(false);
    }
  };

  const ocrPanel = (
    <div className="knowledge-ocr-panel">
      {!selectedIsOcrDocument ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="OCR correction is available after selecting an uploaded PDF or image document."
        />
      ) : (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <div className="knowledge-ocr-summary">
            <Card size="small">
              <Typography.Text type="secondary">Average confidence</Typography.Text>
              <Progress percent={ocrConfidencePercent} size="small" status={ocrConfidencePercent < 80 ? 'exception' : 'success'} />
            </Card>
            <Card size="small">
              <Typography.Text type="secondary">Low confidence</Typography.Text>
              <Typography.Title level={4}>{ocrLowConfidenceCount}</Typography.Title>
            </Card>
            <Card size="small">
              <Typography.Text type="secondary">Enhanced</Typography.Text>
              <div><Tag color={ocrEnhanced ? 'success' : 'default'}>{ocrEnhanced ? 'Yes' : 'No'}</Tag></div>
            </Card>
          </div>
          <div className="knowledge-ocr-toolbar">
            <Typography.Text type="secondary">{ocrBlocks.length} OCR blocks</Typography.Text>
            <Space>
              <Button loading={ocrLoading} onClick={loadOcr}>Refresh</Button>
              <Button loading={ocrEnhancing} onClick={enhanceOcr}>Enhance</Button>
              <Button type="primary" loading={ocrSaving} disabled={!ocrBlocks.length} onClick={saveOcrCorrections}>Save corrections</Button>
            </Space>
          </div>
          <Table
            className="knowledge-ocr-table"
            rowKey="row_id"
            size="small"
            loading={ocrLoading}
            dataSource={ocrBlocks}
            pagination={{ pageSize: 5 }}
            locale={{ emptyText: 'No OCR blocks found for this document.' }}
            columns={[
              {
                title: 'Block',
                width: 86,
                render: (_value, record: EditableOcrBlock, index) => (
                  <Space direction="vertical" size={2}>
                    <Tag>{record.block_id ?? record.id ?? index + 1}</Tag>
                    {(record.page ?? record.page_number) && <Typography.Text type="secondary">p.{record.page ?? record.page_number}</Typography.Text>}
                  </Space>
                ),
              },
              {
                title: 'Original text',
                dataIndex: 'text',
                render: (_value, record: EditableOcrBlock) => (
                  <Typography.Paragraph className="knowledge-ocr-original">
                    {record.text ?? record.raw_text ?? '-'}
                  </Typography.Paragraph>
                ),
              },
              {
                title: 'Corrected text',
                dataIndex: 'corrected_text',
                render: (_value, record: EditableOcrBlock) => (
                  <Input.TextArea
                    autoSize={{ minRows: 2, maxRows: 6 }}
                    value={record.corrected_text}
                    onChange={(event) => updateOcrBlockCorrection(record.row_id, event.target.value)}
                  />
                ),
              },
              {
                title: 'Confidence',
                width: 120,
                render: (_value, record: EditableOcrBlock) => {
                  const percent = normalizeOcrConfidence(record.confidence);
                  return <Progress percent={percent} size="small" status={percent < 80 ? 'exception' : 'normal'} />;
                },
              },
            ]}
          />
        </Space>
      )}
    </div>
  );

  const documentHeading = (<div className="knowledge-document-head">
              <div><h1>{selectedTitle}</h1><Space wrap size={8}><Tag>{KNOWLEDGE_TYPE_LABELS[normalizeKnowledgeTypeGroup(selectedDocument || {} as KnowledgeDocument)] || selectedSourceType.toUpperCase()}</Tag><span>{selectedDocument ? getKnowledgeDocumentStatusMeta(selectedDocument).label : '暂无文档'}</span><span>{selectedLinks.length} 个关联对象</span></Space></div>
            </div>);

  const renderResizeHandle = (side: 'library' | 'inspector') => {
    const width = side === 'library' ? libraryWidth : inspectorWidth;
    const setWidth = side === 'library' ? setLibraryWidth : setInspectorWidth;
    return <div className={`knowledge-pane-resizer ${side}`} role="separator" aria-label={side === 'library' ? '调整文档目录宽度' : '调整文档信息宽度'} aria-orientation="vertical" aria-valuenow={width} aria-valuemin={200} aria-valuemax={420} tabIndex={0}
      onPointerDown={event => { event.preventDefault(); resizeStart.current = { side, x: event.clientX, width }; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { const start = resizeStart.current; if (!start || start.side !== side) return; setWidth(Math.max(200, Math.min(420, start.width + (event.clientX - start.x) * (side === 'library' ? 1 : -1)))); }}
      onPointerUp={() => { resizeStart.current = null; }} onPointerCancel={() => { resizeStart.current = null; }}
      onKeyDown={event => { if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return; event.preventDefault(); setWidth(Math.max(200, Math.min(420, width + (event.key === 'ArrowRight' ? 16 : -16) * (side === 'library' ? 1 : -1)))); }} />;
  };

  return (
    <div className="knowledge-center knowledge-vault">
      <div className={`knowledge-workbench unified-knowledge-workbench knowledge-vault-grid${libraryVisible ? '' : ' is-library-hidden'}${inspectorVisible ? '' : ' is-inspector-hidden'}`} style={{ '--knowledge-library-width': `${libraryWidth}px`, '--knowledge-inspector-width': `${inspectorWidth}px` } as CSSProperties}>

        <aside className="knowledge-left-panel" hidden={!libraryVisible} aria-label="文档目录">
          <Card className="knowledge-panel-card knowledge-library-card" title={<Space><FolderOutlined />知识库</Space>} extra={<Tooltip title="刷新文档"><Button type="text" size="small" icon={<ReloadOutlined />} aria-label="刷新文档" onClick={loadKnowledge} /></Tooltip>}>
            <KnowledgeExplorer documents={explorerDocuments} selectedId={selectedDocumentId} onOpen={openDocument} />
            <Upload.Dragger className="knowledge-upload-dragger" customRequest={handleUpload} showUploadList={false} disabled={uploading}>
              <p className="ant-upload-drag-icon"><InboxOutlined /></p>
              <p className="ant-upload-text">导入文档</p>
              <p className="ant-upload-hint">支持上传资料，保留抽取与发布流程</p>
            </Upload.Dragger>
          </Card>
          <button type="button" className="knowledge-vault-switcher" onClick={() => navigate('/data-center/assets')}><DatabaseOutlined /><span>数据中心</span><SettingOutlined /></button>
          {renderResizeHandle('library')}
        </aside>

        <main className="knowledge-main-panel">
          <div className="knowledge-tab-row">
            <Tooltip title={libraryVisible ? '收起文档目录' : '展开文档目录'}><Button className="knowledge-sidebar-toggle" type="text" aria-label={libraryVisible ? '收起文档目录' : '展开文档目录'} aria-pressed={libraryVisible} icon={libraryVisible ? <MenuFoldOutlined /> : <MenuUnfoldOutlined />} onClick={() => setLibraryVisible(!libraryVisible)} /></Tooltip>
          <Tabs className="knowledge-file-tabs" type="editable-card" hideAdd activeKey={selectedDocumentId} onChange={openDocument} onEdit={(key, action) => { if (action === 'remove') closeDocument(String(key)); }} items={openDocumentIds.filter(id => documents.some(item => getKnowledgeDocumentId(item) === id)).map(id => ({ key: id, label: <span title={getKnowledgeDocumentTitle(documents.find(item => getKnowledgeDocumentId(item) === id)!)}><FileTextOutlined /> {getKnowledgeDocumentTitle(documents.find(item => getKnowledgeDocumentId(item) === id)!)}</span>, closable: openDocumentIds.length > 1 }))} />
          <div className="knowledge-tab-actions">
            <Tooltip title="搜索工作空间 · Ctrl / ⌘ K"><Button type="text" icon={<SearchOutlined />} aria-label="搜索工作空间" onClick={() => setCommandOpen(true)} /></Tooltip>
            <NotificationCenter />
            <Tooltip title={inspectorVisible ? '收起文档信息' : '展开文档信息'}><Button type="text" icon={<OrderedListOutlined />} aria-label={inspectorVisible ? '收起文档信息' : '展开文档信息'} aria-pressed={inspectorVisible} onClick={() => setInspectorVisible(!inspectorVisible)} /></Tooltip>
          </div>
          </div>
          <Card
            className="knowledge-document-card"
            title={<span className="knowledge-document-path">知识库 <span>/</span> {getKnowledgeDocumentFileName(selectedDocument || {} as KnowledgeDocument)}</span>}
            extra={<Segmented value={mode} onChange={setMode} options={[{ label: '阅读', value: 'original' }, { label: '源码', value: 'source' }, { label: '关联', value: 'objects' }, { label: '图谱', value: 'graph' }]} />}
          >
            {(mode === 'objects' || mode === 'graph') && documentHeading}
            {mode === 'objects' ? (
              <div className="knowledge-object-panel">
                {selectedLinks.length ? selectedLinks.map((item) => {
                  const type = item.type ?? item.object_type ?? 'Object';
                  const objectId = item.id ?? item.object_id ?? '-';
                  const name = item.name ?? item.object_name ?? objectId;
                  return (
                    <Card className="knowledge-object-card" size="small" key={`${type}-${objectId}`}>
                      <div className="knowledge-object-card-head">
                        <Space wrap><Tag color="blue">{type}</Tag><Typography.Text strong>{name}</Typography.Text></Space>
                        <Tag color={item.status === 'committed' ? 'success' : 'gold'}>{item.status ?? 'candidate'}</Tag>
                      </div>
                      <div className="knowledge-note-properties compact">
                        <div><span>对象编号</span><strong>{objectId}</strong></div>
                        <div><span>置信度</span><strong>{item.confidence ? `${confidencePercent(item.confidence)}%` : '-'}</strong></div>
                        <div><span>证据位置</span><strong>{item.source_location ?? '当前文档'}</strong></div>
                      </div>
                    </Card>
                  );
                }) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前文档暂无已确认关联对象" />}
              </div>
            ) : mode === 'graph' ? (
              <KnowledgeGraphCenterV2 embedded sourceDocumentId={selectedDocumentId} />
            ) : (
              <article className="knowledge-note-content" ref={readerRef} aria-label="文档阅读区">
                {documentHeading}
                {markdownLoading ? <Progress percent={70} status="active" showInfo={false} /> : null}
                {selectedRawText ? (
                  mode === 'source' ? <pre className="knowledge-original-text">{selectedRawText}</pre> : <KnowledgeReader source={readerSource} />
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前文档暂无可展示原文" />
                )}
              </article>
            )}
          </Card>
        </main>

        <aside className="knowledge-rag-panel knowledge-inspector" hidden={!inspectorVisible} aria-label="文档信息">
          {renderResizeHandle('inspector')}
          <div className="knowledge-inspector-tabs"><Segmented block value={inspectorTab} onChange={setInspectorTab} options={[{ label: '大纲', value: 'outline', icon: <OrderedListOutlined /> }, { label: '关联', value: 'links', icon: <LinkOutlined /> }, { label: '助手', value: 'assistant', icon: <RobotOutlined /> }]} /></div>
          <div className="knowledge-inspector-body">
          {inspectorTab === 'outline' && <section className="knowledge-outline-panel"><header><strong>文档大纲</strong><span>{outline.length} 个标题</span></header>{outline.length ? outline.map(item => item.type === 'heading' && <button key={item.id} type="button" style={{ paddingLeft: 12 + (item.level - 1) * 12 }} onClick={() => { setMode('original'); requestAnimationFrame(() => readerRef.current?.querySelector(`#${item.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })); }}>{item.text}</button>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前文档暂无标题" />}<div className="knowledge-inspector-properties"><h3>文档属性</h3><dl><dt>更新于</dt><dd>{selectedUpdatedAt === '-' ? '—' : new Date(selectedUpdatedAt).toLocaleString('zh-CN')}</dd><dt>关联对象</dt><dd>{selectedLinks.length} 个</dd><dt>内容长度</dt><dd>{selectedRawText.length.toLocaleString()} 字符</dd></dl></div></section>}
          {inspectorTab === 'links' && <section className="knowledge-links-panel"><header><strong>关联对象</strong><span>{selectedLinks.length} 个</span></header>{selectedLinks.length ? selectedLinks.map((item, index) => <div className="knowledge-linked-object" key={index}><BranchesOutlined /><div><strong>{item.name || item.object_name || item.id || item.object_id}</strong><small>{item.type || item.object_type} · {item.id || item.object_id}</small></div></div>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无已确认关联" />}<Button block icon={<NodeIndexOutlined />} onClick={() => setMode('graph')}>查看文档图谱</Button></section>}
          <div className="knowledge-assistant-tools" hidden={inspectorTab !== 'assistant'}>
          <Card
            className="knowledge-rag-card knowledge-intake-card"
            title={<Space><NodeIndexOutlined />AI 本体抽取准备</Space>}
            loading={intakeLoading}
          >
            {intakeRecommendation ? (
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Alert
                  type="info"
                  showIcon
                  message={intakeRecommendation.document_profile?.title ?? selectedTitle}
                  description={getIntakeSummary(intakeRecommendation, selectedTitle, selectedSourceType)}
                />
                <div className="knowledge-note-properties compact">
                  <div><span>类型</span><strong>{getIntakeSourceTypeLabel(intakeRecommendation.document_profile?.source_type ?? selectedSourceType)}</strong></div>
                  <div><span>领域</span><strong>{getIntakeDomainLabel(intakeRecommendation.document_profile?.likely_domain ?? 'general')}</strong></div>
                  <div><span>行数</span><strong>{intakeRecommendation.document_profile?.line_count ?? '-'}</strong></div>
                </div>
                <Space wrap size={6}>{(intakeRecommendation.capabilities ?? []).map((item) => <Tag key={item}>{KNOWLEDGE_INTAKE_CAPABILITY_LABELS[item] ?? item}</Tag>)}</Space>
                {(intakeRecommendation.suggested_actions ?? []).map((action) => (
                  <div className="knowledge-intake-action" key={action.key}>
                    <Space direction="vertical" size={4} style={{ width: '100%' }}>
                      <Space wrap>
                        <Typography.Text strong>{KNOWLEDGE_INTAKE_ACTION_LABELS[action.key]?.title ?? action.title}</Typography.Text>
                        {action.requires_confirmation ? <Tag color="gold">需确认</Tag> : <Tag>只读</Tag>}
                      </Space>
                      <Typography.Text type="secondary">{KNOWLEDGE_INTAKE_ACTION_LABELS[action.key]?.description ?? action.description}</Typography.Text>
                    </Space>
                  </div>
                ))}
                <Button type="primary" icon={<FileSearchOutlined />} loading={ontologyExtracting} disabled={!selectedDocumentId} onClick={startOntologyExtraction} block>
                  开始本体抽取
                </Button>
              </Space>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="上传或选择已索引文档后，可开始本体抽取准备。" />
            )}
            {ontologyJob ? (
              <div className="knowledge-ontology-review">
                <Divider />
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  <Space wrap><Tag color={ontologyJob.status === 'committed' ? 'green' : ontologyJob.quality_report?.blocking ? 'red' : 'blue'}>{KNOWLEDGE_INTAKE_STATUS_LABELS[ontologyJob.status] ?? ontologyJob.status}</Tag><Typography.Text code>{ontologyJob.job_id}</Typography.Text></Space>
                  <Row gutter={8}>
                    <Col span={8}><div className="knowledge-intake-metric"><Typography.Text type="secondary">通用对象</Typography.Text><Typography.Title level={5}>{ontologyJob.result.generic_entities?.length ?? ontologyJob.result.entities.length}</Typography.Title></div></Col>
                    <Col span={8}><div className="knowledge-intake-metric"><Typography.Text type="secondary">领域映射</Typography.Text><Typography.Title level={5}>{ontologyJob.result.domain_mappings?.length ?? 0}</Typography.Title></div></Col>
                    <Col span={8}><div className="knowledge-intake-metric"><Typography.Text type="secondary">关系</Typography.Text><Typography.Title level={5}>{ontologyJob.result.relations.length}</Typography.Title></div></Col>
                  </Row>
                  <Table
                    size="small"
                    rowKey="candidate_id"
                    dataSource={ontologyJob.result.entities}
                    pagination={{ pageSize: 4 }}
                    columns={[
                      { title: '名称', dataIndex: 'name', ellipsis: true },
                      { title: '类型', dataIndex: 'entity_type', width: 120, render: (value) => <Tag color="blue">{value}</Tag> },
                      { title: '证据', dataIndex: 'source_location', width: 110 },
                    ]}
                  />
                  <Alert type={ontologyJob.quality_report?.blocking ? 'error' : 'success'} showIcon message={ontologyJob.quality_report?.blocking ? '存在阻断问题，需要先审核' : '已准备好审核并发布到图谱'} />
                  <Space wrap>
                    <Button icon={<CheckCircleOutlined />} loading={ontologyApproving} onClick={approveOntologyJob}>审核通过</Button>
                    <Button type="primary" icon={<NodeIndexOutlined />} loading={ontologyCommitting} disabled={ontologyJob.quality_report?.blocking} onClick={commitOntologyJob}>发布到图谱</Button>
                  </Space>
                </Space>
              </div>
            ) : null}
          </Card>
          <Card className="knowledge-rag-card knowledge-chat-card" title={<Space><RobotOutlined />知识助手</Space>}>
            <Tabs
              size="small"
              items={[
                {
                  key: 'chat',
                  label: '对话',
                  children: (
                    <div className="knowledge-chat-stack">
                      <div className="knowledge-chat-thread" ref={chatThreadRef}>
                        <div className="knowledge-chat-row assistant">
                          <div className="knowledge-chat-avatar"><RobotOutlined /></div>
                          <div className="knowledge-chat-bubble">
                            <span className="knowledge-chat-name">知识助手</span>
                            <div className="knowledge-chat-message">我会基于《{selectedTitle}》抽取系统、能力、上下游关系，并保留证据段落供你审核。</div>
                          </div>
                        </div>
                        {chatMessages.map((item) => (
                          <div className={`knowledge-chat-row ${item.role}`} key={item.id}>
                            {item.role === 'assistant' && <div className="knowledge-chat-avatar"><RobotOutlined /></div>}
                            <div className="knowledge-chat-bubble">
                              <span className="knowledge-chat-name">{item.role === 'assistant' ? '知识助手' : '我'}</span>
                              <div className="knowledge-chat-message">{item.content}</div>
                            </div>
                            {item.role === 'user' && <div className="knowledge-chat-avatar"><UserOutlined /></div>}
                          </div>
                        ))}
                        {agentLoading && (
                          <div className="knowledge-chat-row assistant">
                            <div className="knowledge-chat-avatar"><RobotOutlined /></div>
                            <div className="knowledge-chat-bubble">
                              <span className="knowledge-chat-name">知识助手</span>
                              <div className="knowledge-chat-message">正在恢复历史会话...</div>
                            </div>
                          </div>
                        )}
                        {searching && (
                          <div className="knowledge-chat-row assistant">
                            <div className="knowledge-chat-avatar"><RobotOutlined /></div>
                            <div className="knowledge-chat-bubble">
                              <span className="knowledge-chat-name">知识助手</span>
                              <div className="knowledge-chat-message">正在检索知识库...</div>
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="knowledge-chat-composer">
                        <Input.TextArea
                          className="knowledge-chat-input"
                          autoSize={{ minRows: 2, maxRows: 4 }}
                          value={draftQuery}
                          onChange={(event) => setDraftQuery(event.target.value)}
                          onPressEnter={(event) => {
                            if (!event.shiftKey) {
                              event.preventDefault();
                              runSearch();
                            }
                          }}
                        />
                        <Button className="knowledge-chat-send" type="primary" icon={<SendOutlined />} loading={searching} disabled={agentLoading || !draftQuery.trim()} onClick={runSearch}>发送</Button>
                      </div>
                    </div>
                  ),
                },
                {
                  key: 'extract',
                  label: '抽取结果',
                  children: (
                    <Space className="knowledge-extract-stack" direction="vertical" size={10} style={{ width: '100%' }}>
                      <Alert
                        type={ontologyJob ? 'success' : 'info'}
                        showIcon
                        message={`Entities ${ontologyEntities.length}, relations ${ontologyRelations.length}`}
                      />
                      <div className="knowledge-result-list">
                        {ontologyEntities.length ? ontologyEntities.map((item) => (
                          <Card className="knowledge-result-card" size="small" key={item.candidate_id ?? item.name}>
                            <div className="knowledge-chunk-head"><strong>{item.name ?? item.candidate_id}</strong><Tag color="blue">{item.entity_type ?? item.type ?? '-'}</Tag></div>
                            <Progress percent={confidencePercent(Number(item.confidence ?? 0))} size="small" />
                            <Typography.Text type="secondary">{item.source_location ?? item.evidence ?? '-'}</Typography.Text>
                          </Card>
                        )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No extraction results from database" />}
                      </div>
                    </Space>
                  ),
                },
                {
                  key: 'publish',
                  label: '发布清单',
                  children: (
                    <div className="knowledge-publish-stack">
                      <div className="knowledge-publish-list">
                        {ontologyRelations.length ? ontologyRelations.map((item, index) => {
                          const source = item.source_name ?? item.source ?? item.source_candidate_id ?? '-';
                          const target = item.target_name ?? item.target ?? item.target_candidate_id ?? '-';
                          const relation = item.relation_type ?? item.type ?? item.label ?? '-';
                          return (
                            <div className="knowledge-publish-row" key={item.candidate_id ?? `${source}-${target}-${index}`}>
                              <strong>{source}</strong><span>{relation}</span><strong>{target}</strong>
                            </div>
                          );
                        }) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No relations ready to publish" />}
                      </div>
                      <Button
                        className="knowledge-publish-action"
                        type="primary"
                        block
                        icon={<NodeIndexOutlined />}
                        loading={ontologyCommitting}
                        disabled={!ontologyJob || !ontologyRelations.length || ontologyJob.quality_report?.blocking}
                        onClick={commitOntologyJob}
                      >Publish to graph</Button>
                    </div>
                  ),
                },
                {
                  key: 'meta',
                  label: '文档属性',
                  children: (
                    <div className="knowledge-meta-stack">
                      <div className="knowledge-note-properties">
                        <div><span>Document</span><strong>{selectedTitle}</strong></div>
                        <div><span>Source type</span><strong>{selectedSourceType}</strong></div>
                        <div><span>Status</span><strong>{(selectedDocument as any)?.status ?? '-'}</strong></div>
                        <div><span>Knowledge cards</span><strong>{cards.length}</strong></div>
                      </div>
                    </div>
                  ),
                },              ]}
            />
          </Card>
          </div>
          </div>
        </aside>
      </div>
      <Modal open={commandOpen} title="搜索工作空间" footer={null} onCancel={() => setCommandOpen(false)} destroyOnClose className="knowledge-command-dialog" afterOpenChange={open => { if (open) commandRef.current?.querySelector<HTMLInputElement>('input')?.focus(); }}><div ref={commandRef}><GlobalSearch /></div></Modal>
      <footer className="knowledge-vault-status"><Space size={14}><span>知识库</span><span>{documents.length} 篇文档</span><span>已索引 {indexedDocumentCount} · 待抽取 {pendingExtractCount} · 已发布 {publishedDocumentCount}</span></Space><span>{markdownLoading ? '正在读取文档…' : selectedDocument ? '文档已加载' : '等待选择文档'}</span><Space size={20}><span>{selectedRawText.length.toLocaleString()} 字符</span><span>{selectedLinks.length} 个关联对象</span></Space></footer>
    </div>
  );
}

function LegacyKnowledgeCenter() {
  const [spaces, setSpaces] = useState<KnowledgeSpace[]>([]);
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [cards, setCards] = useState<KnowledgeCard[]>([]);
  const [chunks, setChunks] = useState<KnowledgeChunk[]>([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string>();
  const [query, setQuery] = useState('供应商 8D 报告里有哪些整改措施？');
  const [answer, setAnswer] = useState('');
  const [uploading, setUploading] = useState(false);
  const [searching, setSearching] = useState(false);

  const loadKnowledge = async () => {
    try {
      const [spaceRes, sourceRes, documentRes, cardRes] = await Promise.all([
        listKnowledgeSpaces(),
        listKnowledgeSources(),
        listKnowledgeDocuments(),
        listKnowledgeCards(),
        getKnowledgeOcrPipeline().catch(() => null),
      ]);
      const nextDocuments = documentRes.data?.data ?? [];
      setSpaces(spaceRes.data?.data ?? []);
      setSources(sourceRes.data?.data ?? []);
      setDocuments(nextDocuments);
      setCards(cardRes.data?.data ?? []);
      setSelectedDocumentId((prev) => prev ?? nextDocuments[0]?.id ?? nextDocuments[0]?.document_id);
    } catch {
      setSpaces([]);
      setSources([]);
      setDocuments([]);
      setCards([]);
    }
  };

  useEffect(() => {
    loadKnowledge();
  }, []);

  useEffect(() => {
    if (!selectedDocumentId) {
      setChunks([]);
      return;
    }
    listKnowledgeChunks(selectedDocumentId)
      .then((res) => setChunks(res.data?.data ?? []))
      .catch(() => setChunks([]));
  }, [selectedDocumentId]);

  const runSearch = async () => {
    setSearching(true);
    try {
      const res = await searchKnowledge({ query, limit: 5 });
      setAnswer(res.data?.data?.answer ?? '已完成检索。');
    } catch {
      setAnswer('知识检索服务暂不可用，请稍后重试。');
    } finally {
      setSearching(false);
    }
  };

  const handleUpload = async (options: any) => {
    setUploading(true);
    try {
      await uploadKnowledgeAsset(options.file, { permission_scope: 'enterprise', owner_user_id: 'knowledge-admin' });
      message.success('资料已入库，可在知识抽取工作台继续发布到图谱');
      options.onSuccess?.({});
      loadKnowledge();
    } catch (error: any) {
      message.error(error?.response?.data?.detail ?? '上传失败');
      options.onError?.(error);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="knowledge-center">
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={7}>
          <Card title="知识空间" extra={<Tag>{spaces.length}</Tag>}>
            <List dataSource={spaces} renderItem={(item) => <List.Item><List.Item.Meta avatar={<FileSearchOutlined />} title={item.name} description={item.description} /></List.Item>} />
          </Card>
          <Card title="知识来源" style={{ marginTop: 16 }} extra={<Tag>{sources.length}</Tag>}>
            <List dataSource={sources} renderItem={(item) => <List.Item><List.Item.Meta title={item.name} description={item.status} /></List.Item>} />
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card title="文档资料" extra={<Button icon={<ReloadOutlined />} onClick={loadKnowledge}>刷新</Button>}>
            <Upload.Dragger customRequest={handleUpload} showUploadList={false} disabled={uploading}>
              <p className="ant-upload-drag-icon"><InboxOutlined /></p>
              <p className="ant-upload-text">上传知识资料</p>
              <p className="ant-upload-hint">入库后可在知识抽取工作台发起图谱抽取。</p>
            </Upload.Dragger>
            <List
              style={{ marginTop: 16 }}
              dataSource={documents}
              locale={{ emptyText: '暂无文档' }}
              renderItem={(item: any) => (
                <List.Item className={(item.id ?? item.document_id) === selectedDocumentId ? 'semantic-list-item active' : 'semantic-list-item'} onClick={() => setSelectedDocumentId(item.id ?? item.document_id)}>
                  <List.Item.Meta title={item.title ?? item.document_title ?? item.file_name} description={item.summary ?? item.updated_at} />
                </List.Item>
              )}
            />
          </Card>
        </Col>
        <Col xs={24} lg={7}>
          <Card title={<Space><RobotOutlined />知识问答</Space>}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Input.TextArea rows={3} value={query} onChange={(event) => setQuery(event.target.value)} />
              <Button block type="primary" icon={<RobotOutlined />} loading={searching} onClick={runSearch}>检索知识库</Button>
              {answer && <Alert type="info" showIcon message={answer} />}
              <Typography.Text type="secondary">相关片段</Typography.Text>
              <List dataSource={chunks.slice(0, 3)} locale={{ emptyText: '选择文档后显示片段' }} renderItem={(item) => <List.Item><Typography.Text>{item.chunk_text}</Typography.Text></List.Item>} />
              <Typography.Text type="secondary">知识卡片</Typography.Text>
              <List dataSource={cards.slice(0, 3)} locale={{ emptyText: '暂无卡片' }} renderItem={(item) => <List.Item><List.Item.Meta title={item.title} description={item.scenario ?? item.owner} /></List.Item>} />
            </Space>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
