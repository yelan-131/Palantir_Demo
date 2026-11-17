import type { Dispatch, SetStateAction } from 'react';
import { ApartmentOutlined, BranchesOutlined, CheckCircleOutlined, NodeIndexOutlined, ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Checkbox, Col, Empty, Form, Input, List, Modal, Progress, Row, Select, Space, Spin, Switch, Table, Tabs, Tag, Typography, type FormInstance } from 'antd';
import type { OntologyCandidateInfo } from '../../services/api';
import { boolTag, type OntologyMapping, type OntologyObject, type OntologyRelation, type OntologyVersion } from './semanticAssetShared';

type OntologyModelState = {
  candidateStats: { total: number; objects: number; fields: number; relations: number; mappings: number };
  impactLoading: boolean;
  impactResult: any;
  loadFailed: boolean;
  loading: boolean;
  objectRelations: OntologyRelation[];
  objects: OntologyObject[];
  ontologyCandidates: OntologyCandidateInfo[];
  ontologyPublishStats: { objects: number; fields: number; relations: number; graphRelations: number; mappings: number };
  ontologyTab: string;
  setOntologyTab: Dispatch<SetStateAction<string>>;
  ontologyVersions: OntologyVersion[];
  relations: OntologyRelation[];
  requestedCandidate: number | undefined;
  reviewingCandidateId: number | undefined;
  selectedCandidate: OntologyCandidateInfo | undefined;
  setSelectedCandidateId: Dispatch<SetStateAction<number | undefined>>;
  selectedObject: OntologyObject | undefined;
  setSelectedObjectId: Dispatch<SetStateAction<string | undefined>>;
  selectedObjectMappings: OntologyMapping[];
};

type OntologyActions = {
  deprecateSelectedObject: () => void;
  objectModalOpen: boolean;
  setObjectModalOpen: Dispatch<SetStateAction<boolean>>;
  ontologyObjectForm: FormInstance;
  openObjectModal: (object?: OntologyObject) => void;
  saveOntologyObject: () => Promise<void>;
  savingObject: boolean;
  openRelationModal: () => void;
  relationModalOpen: boolean;
  setRelationModalOpen: Dispatch<SetStateAction<boolean>>;
  ontologyRelationForm: FormInstance;
  saveOntologyRelation: () => Promise<void>;
  savingRelation: boolean;
  publishOntologyVersion: () => Promise<void>;
  publishingOntology: boolean;
  refreshOntologyGovernance: () => Promise<void>;
  reviewCandidate: (candidate: OntologyCandidateInfo, action: 'approve' | 'reject') => Promise<void>;
  runImpactAnalysis: (fieldCode?: string) => Promise<void>;
  load: () => Promise<void>;
};

export function OntologyView({ model, actions }: { model: OntologyModelState; actions: OntologyActions }) {
  const {
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
    setOntologyTab,
    ontologyVersions,
    relations,
    requestedCandidate,
    reviewingCandidateId,
    selectedCandidate,
    setSelectedCandidateId,
    selectedObject,
    setSelectedObjectId,
    selectedObjectMappings,
  } = model;

  const {
    deprecateSelectedObject,
    objectModalOpen,
    setObjectModalOpen,
    ontologyObjectForm,
    openObjectModal,
    saveOntologyObject,
    savingObject,
    openRelationModal,
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
  } = actions;
  const unavailable = loadFailed
    ? <Alert type="error" message="无法读取数据中心" action={<Button size="small" onClick={load}>重试</Button>} />
    : <div className="data-center-empty"><Spin /></div>;

  return (
    <>
      {!objects.length && !relations.length && !ontologyCandidates.length && !ontologyVersions.length
        ? loading || loadFailed ? unavailable : <section className="data-center-empty">
          <h3>还没有业务对象</h3>
          <p>新建第一个对象，定义它的字段，再建立对象之间的关系。</p>
          <Button type="primary" icon={<ApartmentOutlined />} onClick={() => openObjectModal()}>新增对象</Button>
        </section>
        : <div className="ontology-workbench">
        <aside className="ontology-directory">
          <Card
            className="semantic-side-card"
            title="对象目录"
            extra={<Button size="small" icon={<ApartmentOutlined />} onClick={() => openObjectModal()}>新增</Button>}
          >
            <div className="ontology-quick-stats">
              <div><strong>{ontologyPublishStats.objects}</strong><span>对象</span></div>
              <div><strong>{ontologyPublishStats.relations}</strong><span>关系</span></div>
              <div><strong>{candidateStats.total}</strong><span>待审核</span></div>
            </div>
            <Select
              value={selectedObject?.id}
              style={{ width: '100%', marginBottom: 12 }}
              options={objects.map((item) => ({ label: `${item.name} / ${item.code}`, value: item.id }))}
              onChange={setSelectedObjectId}
              placeholder="选择对象"
            />
            <List
              className="ontology-object-list"
              dataSource={objects}
              locale={{ emptyText: '暂无正式对象，可从候选审核批准或手工新增' }}
              renderItem={(item) => (
                <List.Item
                  className={item.id === selectedObject?.id ? 'semantic-list-item active' : 'semantic-list-item'}
                  onClick={() => setSelectedObjectId(item.id)}
                >
                  <List.Item.Meta
                    avatar={<ApartmentOutlined />}
                    title={<Space><span>{item.name}</span><Tag>{item.status ?? 'published'}</Tag></Space>}
                    description={`${item.code} · ${item.fields.length} 字段 · ${item.source}`}
                  />
                </List.Item>
              )}
            />
          </Card>
        </aside>
        <main className="ontology-main">
          <section className="ontology-toolbar">
            <div>
              <Typography.Text type="secondary">候选对象须审核后发布为正式模型。</Typography.Text>
            </div>
            <Space wrap>
              <Button icon={<ReloadOutlined />} onClick={refreshOntologyGovernance}>刷新</Button>
              <Button icon={<BranchesOutlined />} onClick={openRelationModal} disabled={!objects.length}>新增关系</Button>
              <Button type="primary" icon={<CheckCircleOutlined />} loading={publishingOntology} onClick={publishOntologyVersion}>发布版本</Button>
            </Space>
          </section>
          <Tabs
            className="ontology-governance-tabs"
            activeKey={ontologyTab}
            onChange={setOntologyTab}
            items={[
              {
                key: 'objects',
                label: '对象模型',
                children: selectedObject ? (
                  <Space direction="vertical" size={14} style={{ width: '100%' }}>
                    <Card
                      title={<Space><NodeIndexOutlined />{selectedObject.name}<Tag>{selectedObject.code}</Tag></Space>}
                      extra={(
                        <Space>
                          <Tag color="processing">来源：{selectedObject.source}</Tag>
                          <Button size="small" onClick={() => openObjectModal(selectedObject)}>编辑</Button>
                          <Button size="small" danger onClick={deprecateSelectedObject}>废弃</Button>
                          <Button size="small" loading={impactLoading} onClick={() => runImpactAnalysis()}>看影响</Button>
                        </Space>
                      )}
                    >
                      <Typography.Paragraph>{selectedObject.description || '暂无对象说明'}</Typography.Paragraph>
                      <div className="ontology-object-meta">
                        <div><span>领域</span><strong>{selectedObject.domain ?? 'manufacturing'}</strong></div>
                        <div><span>状态</span><strong>{selectedObject.status ?? 'published'}</strong></div>
                        <div><span>置信度</span><strong>{Math.round((selectedObject.confidence ?? 1) * 100)}%</strong></div>
                        <div><span>映射</span><strong>{selectedObjectMappings.length}</strong></div>
                      </div>
                    </Card>
                    <Card title="字段定义">
                      <Table
                        size="small"
                        rowKey={(record) => record.id ?? record.name}
                        dataSource={selectedObject.fields}
                        pagination={{ pageSize: 8 }}
                        columns={[
                          { title: '对象字段', dataIndex: 'label' },
                          { title: '字段编码', dataIndex: 'name' },
                          { title: '类型', dataIndex: 'type', render: (type: string) => <Tag>{type}</Tag> },
                          { title: '来源字段', dataIndex: 'source_field' },
                          { title: '列表', dataIndex: 'list', render: boolTag },
                          { title: '表单', dataIndex: 'form', render: boolTag },
                          { title: '搜索', dataIndex: 'search', render: boolTag },
                          { title: '影响', width: 92, render: (_, record) => <Button size="small" onClick={() => runImpactAnalysis(record.name)}>检查</Button> },
                        ]}
                      />
                    </Card>
                    <Card title="数据映射">
                      <Table
                        size="small"
                        rowKey="id"
                        dataSource={selectedObjectMappings}
                        pagination={{ pageSize: 5 }}
                        locale={{ emptyText: '暂无字段映射，可从数据资产候选审核生成' }}
                        columns={[
                          { title: '来源系统', dataIndex: 'source_system', width: 100 },
                          { title: '来源实体', dataIndex: 'source_entity' },
                          { title: '来源字段', dataIndex: 'source_field' },
                          { title: '目标字段', dataIndex: 'target_field_code' },
                          { title: '置信度', dataIndex: 'confidence', width: 120, render: (value: number) => <Progress percent={Math.round((value ?? 0) * 100)} size="small" /> },
                        ]}
                      />
                    </Card>
                  </Space>
                ) : <Empty description="暂无对象模型" />,
              },
              {
                key: 'relations',
                label: '关系模型',
                children: (
                  <Row gutter={[16, 16]}>
                    <Col xs={24} xl={15}>
                      <Card title={<Space><BranchesOutlined />对象关系 / 图谱边</Space>} extra={<Button size="small" onClick={openRelationModal}>新增关系</Button>}>
                        <Table
                          size="small"
                          rowKey="id"
                          dataSource={relations}
                          pagination={{ pageSize: 10 }}
                          columns={[
                            { title: '源对象', dataIndex: 'source' },
                            { title: '关系', dataIndex: 'label', render: (text, record: OntologyRelation) => <Space><Tag color="blue">{record.type}</Tag>{text}</Space> },
                            { title: '目标对象', dataIndex: 'target' },
                            { title: '进入图谱', dataIndex: 'graph', render: boolTag },
                            { title: '状态', dataIndex: 'status', render: (value) => <Tag>{value ?? 'published'}</Tag> },
                          ]}
                        />
                      </Card>
                    </Col>
                    <Col xs={24} xl={9}>
                      <Card title="关系图预览">
                        <div className="ontology-graph-preview">
                          <div className="ontology-graph-node main">{selectedObject?.code ?? 'Object'}</div>
                          {objectRelations.slice(0, 4).map((relation, index) => {
                            const target = relation.source === selectedObject?.code || relation.source === selectedObject?.id ? relation.target : relation.source;
                            return (
                              <div className={`ontology-graph-node node-${index + 1}`} key={relation.id}>
                                <span>{target}</span>
                                <small>{relation.type}</small>
                              </div>
                            );
                          })}
                        </div>
                      </Card>
                    </Col>
                  </Row>
                ),
              },
              {
                key: 'candidates',
                label: `候选审核 ${candidateStats.total}`,
                children: (
                  <Row gutter={[16, 16]}>
                    <Col xs={24} xl={15}>
                      <Card
                        title="候选审核队列"
                        extra={<Space><Tag>对象 {candidateStats.objects}</Tag><Tag>关系 {candidateStats.relations}</Tag><Tag>映射 {candidateStats.mappings}</Tag></Space>}
                      >
                        <Table
                          size="small"
                          rowKey="id"
                          dataSource={ontologyCandidates}
                          pagination={{
                            pageSize: 10,
                            defaultCurrent: Math.max(1, Math.floor(ontologyCandidates.findIndex(item => item.id === requestedCandidate) / 10) + 1),
                          }}
                          onRow={(record) => ({ onClick: () => setSelectedCandidateId(record.id) })}
                          rowClassName={(record) => record.id === selectedCandidate?.id ? 'active-row' : ''}
                          columns={[
                            { title: '类型', dataIndex: 'candidate_type', width: 110, render: (value: string) => <Tag color={value === 'relation' ? 'blue' : value === 'mapping' ? 'green' : 'gold'}>{value}</Tag> },
                            { title: '候选', dataIndex: 'title', ellipsis: true },
                            { title: '来源', dataIndex: 'source_ref', ellipsis: true },
                            { title: '置信度', dataIndex: 'confidence', width: 130, render: (value: number) => <Progress percent={Math.round((value ?? 0) * 100)} size="small" /> },
                            { title: '操作', width: 150, render: (_, record) => (
                              <Space>
                                <Button size="small" type="primary" loading={reviewingCandidateId === record.id} onClick={(event) => { event.stopPropagation(); reviewCandidate(record, 'approve'); }}>批准</Button>
                                <Button size="small" danger loading={reviewingCandidateId === record.id} onClick={(event) => { event.stopPropagation(); reviewCandidate(record, 'reject'); }}>拒绝</Button>
                              </Space>
                            ) },
                          ]}
                        />
                      </Card>
                    </Col>
                    <Col xs={24} xl={9}>
                      <Card title="候选详情">
                        {selectedCandidate ? (
                          <Space direction="vertical" size={12} style={{ width: '100%' }}>
                            <Space wrap><Tag>{selectedCandidate.candidate_type}</Tag><Tag color="processing">{selectedCandidate.status}</Tag><Tag>{Math.round(selectedCandidate.confidence * 100)}%</Tag></Space>
                            <Typography.Title level={5}>{selectedCandidate.title}</Typography.Title>
                            <Typography.Text type="secondary">{selectedCandidate.source_ref}</Typography.Text>
                            <pre className="ontology-payload-preview">{JSON.stringify(selectedCandidate.payload, null, 2)}</pre>
                            <Space>
                              <Button type="primary" icon={<CheckCircleOutlined />} loading={reviewingCandidateId === selectedCandidate.id} onClick={() => reviewCandidate(selectedCandidate, 'approve')}>批准进入正式模型</Button>
                              <Button danger loading={reviewingCandidateId === selectedCandidate.id} onClick={() => reviewCandidate(selectedCandidate, 'reject')}>拒绝</Button>
                            </Space>
                          </Space>
                        ) : <Empty description="暂无待审核候选" />}
                      </Card>
                    </Col>
                  </Row>
                ),
              },
              {
                key: 'publish',
                label: '发布治理',
                children: (
                  <Row gutter={[16, 16]}>
                    <Col xs={24} xl={9}>
                      <Card title="发布前检查">
                        <Space direction="vertical" size={12} style={{ width: '100%' }}>
                          <Alert type="success" showIcon message={`${ontologyPublishStats.objects} 个对象，${ontologyPublishStats.fields} 个字段`} />
                          <Alert type="success" showIcon message={`${ontologyPublishStats.relations} 条关系，${ontologyPublishStats.graphRelations} 条进入图谱`} />
                          <Alert type={candidateStats.total ? 'warning' : 'success'} showIcon message={candidateStats.total ? `${candidateStats.total} 条候选仍待审核` : '候选队列已清空'} />
                          <Alert type="info" showIcon message={`${ontologyPublishStats.mappings} 条数据字段映射`} />
                          <Button type="primary" block icon={<CheckCircleOutlined />} loading={publishingOntology} onClick={publishOntologyVersion}>发布 Ontology 新版本</Button>
                        </Space>
                      </Card>
                    </Col>
                    <Col xs={24} xl={15}>
                      <Card title="版本历史">
                        <Table
                          size="small"
                          rowKey="id"
                          dataSource={ontologyVersions}
                          pagination={false}
                          columns={[
                            { title: '版本', dataIndex: 'version', width: 90, render: (value) => <Tag color="blue">v{value}</Tag> },
                            { title: '标题', dataIndex: 'title' },
                            { title: '发布时间', dataIndex: 'published_at', width: 210 },
                            { title: '快照', width: 220, render: (_, record: OntologyVersion) => `${record.snapshot?.objects?.length ?? 0} 对象 / ${record.snapshot?.relations?.length ?? 0} 关系 / ${record.snapshot?.mappings?.length ?? 0} 映射` },
                          ]}
                        />
                      </Card>
                    </Col>
                  </Row>
                ),
              },
              {
                key: 'impact',
                label: '影响分析',
                children: (
                  <Row gutter={[16, 16]}>
                    <Col xs={24} xl={8}>
                      <Card title="分析目标">
                        <Space direction="vertical" style={{ width: '100%' }}>
                          <Select value={selectedObject?.id} options={objects.map((item) => ({ label: `${item.name} / ${item.code}`, value: item.id }))} onChange={setSelectedObjectId} />
                          <Button type="primary" loading={impactLoading} onClick={() => runImpactAnalysis()} block>检查对象影响</Button>
                          <Typography.Text type="secondary">废弃、重命名或修改字段前，先检查运行表单、数据映射、知识链接和 AI 工具引用。</Typography.Text>
                        </Space>
                      </Card>
                    </Col>
                    <Col xs={24} xl={16}>
                      <Card title={`影响结果：${selectedObject?.code ?? '-'}`}>
                        {impactResult ? (
                          <Space direction="vertical" size={12} style={{ width: '100%' }}>
                            <Alert type={impactResult.blocking ? 'error' : 'success'} showIcon message={impactResult.blocking ? '存在阻断影响，需要变更评审' : '暂无阻断影响'} />
                            {Object.entries(impactResult.items ?? {}).map(([key, value]) => (
                              <div className="ontology-impact-section" key={key}>
                                <Typography.Text strong>{key}</Typography.Text>
                                <List
                                  size="small"
                                  dataSource={Array.isArray(value) ? value : []}
                                  locale={{ emptyText: '无影响项' }}
                                  renderItem={(item: any) => <List.Item>{item.name ?? item.label ?? item.field ?? item.document_id ?? item.id}<Typography.Text type="secondary">{item.impact ? ` · ${item.impact}` : ''}</Typography.Text></List.Item>}
                                />
                              </div>
                            ))}
                          </Space>
                        ) : <Empty description="选择对象后运行影响分析" />}
                      </Card>
                    </Col>
                  </Row>
                ),
              },
            ]}
          />
        </main>
      </div>}
      <Modal title="对象模型" open={objectModalOpen} onCancel={() => setObjectModalOpen(false)} onOk={saveOntologyObject} confirmLoading={savingObject} width={780} okText="保存">
        <Form form={ontologyObjectForm} layout="vertical">
          <Row gutter={12}>
            <Col span={12}><Form.Item name="name" label="对象名称" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="code" label="对象编码" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="domain" label="领域"><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="status" label="状态"><Select options={[{ value: 'draft', label: 'draft' }, { value: 'published', label: 'published' }, { value: 'deprecated', label: 'deprecated' }]} /></Form.Item></Col>
          </Row>
          <Form.Item name="description" label="说明"><Input.TextArea rows={2} /></Form.Item>
          <Form.List name="fields">
            {(fields, { add, remove }) => (
              <Space direction="vertical" style={{ width: '100%' }}>
                <Space style={{ justifyContent: 'space-between', width: '100%' }}><Typography.Text strong>字段</Typography.Text><Button size="small" onClick={() => add({ type: 'string', list: true, form: true })}>新增字段</Button></Space>
                {fields.map((field) => (
                  <Row gutter={8} key={field.key} align="middle">
                    <Col span={5}><Form.Item name={[field.name, 'code']} rules={[{ required: true }]}><Input placeholder="编码" /></Form.Item></Col>
                    <Col span={5}><Form.Item name={[field.name, 'label']}><Input placeholder="名称" /></Form.Item></Col>
                    <Col span={4}><Form.Item name={[field.name, 'type']}><Select options={['string', 'number', 'datetime', 'enum', 'boolean'].map((value) => ({ value, label: value }))} /></Form.Item></Col>
                    <Col span={5}><Form.Item name={[field.name, 'source_field']}><Input placeholder="来源字段" /></Form.Item></Col>
                    <Col span={3}><Form.Item name={[field.name, 'search']} valuePropName="checked"><Checkbox>搜索</Checkbox></Form.Item></Col>
                    <Col span={2}><Button danger size="small" onClick={() => remove(field.name)}>删</Button></Col>
                  </Row>
                ))}
              </Space>
            )}
          </Form.List>
        </Form>
      </Modal>
      <Modal title="对象关系" open={relationModalOpen} onCancel={() => setRelationModalOpen(false)} onOk={saveOntologyRelation} confirmLoading={savingRelation} okText="保存">
        <Form form={ontologyRelationForm} layout="vertical">
          <Form.Item name="name" label="关系名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="source_object_code" label="源对象" rules={[{ required: true }]}><Select options={objects.map((item) => ({ value: item.code, label: `${item.name} / ${item.code}` }))} /></Form.Item></Col>
            <Col span={12}><Form.Item name="target_object_code" label="目标对象" rules={[{ required: true }]}><Select options={objects.map((item) => ({ value: item.code, label: `${item.name} / ${item.code}` }))} /></Form.Item></Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="relation_type" label="关系类型"><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="graph_enabled" label="进入图谱" valuePropName="checked"><Switch /></Form.Item></Col>
          </Row>
          <Form.Item name="description" label="说明"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}
