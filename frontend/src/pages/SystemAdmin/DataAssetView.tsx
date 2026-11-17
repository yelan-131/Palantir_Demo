import type { Dispatch, SetStateAction } from 'react';
import { DatabaseOutlined, DeleteOutlined, EditOutlined, NodeIndexOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { Button, Card, Checkbox, Col, Empty, Form, Input, InputNumber, List, Modal, Row, Select, Slider, Space, Spin, Switch, Table, Tabs, Tag, Typography, type FormInstance } from 'antd';
import type { NavigateFunction } from 'react-router-dom';
import type { OntologyCandidateInfo } from '../../services/api';
import { DATA_DOMAINS, getCandidateTypeLabel, getDataSourceStatusClass, getDataSourceStatusLabel, tableMatchesBusinessDomain, type DataAsset, type DataQualityRule, type OntologyMapping, type OntologyObject } from './semanticAssetShared';

type DataAssetCatalog = {
  activeDomain: string;
  setActiveDomain: Dispatch<SetStateAction<string>>;
  assetSearch: string;
  setAssetSearch: Dispatch<SetStateAction<string>>;
  assetStats: { tableCount: number; totalRows: number; avgQuality: number; mappedCount: number };
  assets: DataAsset[];
  assetLoadFailed: boolean;
  loading: boolean;
  selectedAsset: DataAsset | undefined;
  setSelectedAssetId: Dispatch<SetStateAction<number | undefined>>;
  setSelectedTableId: Dispatch<SetStateAction<string | undefined>>;
  selectedAssetStats: { tableCount: number; fieldCount: number; totalRows: number; avgQuality: number; mappedCount: number };
  filteredTables: Array<DataAsset['tables'][number]>;
  selectedTable: DataAsset['tables'][number] & { assetName: string; assetType: string; owner: string; freshness: string; status: string };
  scanning: boolean;
  assetCandidates: OntologyCandidateInfo[];
};

type DataAssetQuality = {
  editingQualityRule: DataQualityRule | undefined;
  setEditingQualityRule: Dispatch<SetStateAction<DataQualityRule | undefined>>;
  qualityRuleForm: FormInstance;
  qualityRuleModalOpen: boolean;
  setQualityRuleModalOpen: Dispatch<SetStateAction<boolean>>;
  qualityRuleState: Record<string, string>;
  qualityScoreForm: FormInstance;
  qualityScoreStandardOpen: boolean;
  setQualityScoreStandardOpen: Dispatch<SetStateAction<boolean>>;
  selectedQualityRuleStats: { total: number; enabled: number; custom: number; scoring: number };
  selectedQualityRules: DataQualityRule[];
  savingQualityRule: boolean;
  openQualityRuleModal: (rule?: DataQualityRule) => void;
  openQualityScoreStandard: () => void;
  removeQualityRule: (rule: DataQualityRule) => void;
  saveQualityRule: () => Promise<void>;
  saveQualityScoreStandard: () => Promise<void>;
  updateQualityRule: (rule: DataQualityRule, checked: boolean) => Promise<void>;
};

type DataAssetCandidates = {
  ontologyMappings: OntologyMapping[];
  objects: OntologyObject[];
  candidatesForTable: (table: { id: string; name: string }) => OntologyCandidateInfo[];
  selectedTableCandidates: OntologyCandidateInfo[];
  openCandidateReview: (candidateId: number) => void;
};

type DataAssetActions = {
  load: () => Promise<void>;
  navigate: NavigateFunction;
  clearMetadataView: () => void;
  openMapping: () => void;
  scanMetadata: () => Promise<void>;
};

export function DataAssetView({ catalog, quality, candidates, actions }: { catalog: DataAssetCatalog; quality: DataAssetQuality; candidates: DataAssetCandidates; actions: DataAssetActions }) {
  const {
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
  } = catalog;

  const {
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
  } = quality;

  const {
    ontologyMappings,
    objects,
    candidatesForTable,
    selectedTableCandidates,
    openCandidateReview,
  } = candidates;

  const {
    load,
    navigate,
    clearMetadataView,
    openMapping,
    scanMetadata,
  } = actions;
  return (
    <>
    {!assets.length ? loading ? <div className="data-center-empty"><Spin /></div> : <section className="data-center-empty">
      <h3>{assetLoadFailed ? '暂时无法读取资产目录' : '还没有数据源'}</h3>
      <p>{assetLoadFailed ? '可以重试读取，或接入新的数据源。' : '接入数据源后，即可扫描表和字段，建立资产目录。'}</p>
      <Space>
        <Button type="primary" icon={<DatabaseOutlined />} onClick={() => navigate('/data-center/sources')}>前往连接管理</Button>
        {assetLoadFailed && <Button onClick={load}>重试</Button>}
      </Space>
    </section> : <div className="data-asset-workbench">
      <aside className="data-asset-directory">
        <Card
          className="semantic-side-card"
          title="数据源"
          extra={(
            <Space size={4}>
              <Button size="small" onClick={() => navigate('/data-center/sources')}>连接管理</Button>
              <Button size="small" icon={<ReloadOutlined />} onClick={load}>刷新</Button>
            </Space>
          )}
        >
          <Input.Search placeholder="搜索数据源、表、字段" allowClear value={assetSearch} onChange={(event) => setAssetSearch(event.target.value)} />
          <div className="data-directory-section">
            <div className="data-source-section-header">
              <Typography.Text type="secondary">数据源</Typography.Text>
            </div>
            <div className="data-source-compact-summary">
              <div>
                <strong>{assets.length}</strong>
                <span>数据源</span>
              </div>
              <div>
                <strong>{assetStats.tableCount}</strong>
                <span>表</span>
              </div>
              <div>
                <strong>{assetStats.mappedCount}</strong>
                <span>已映射</span>
              </div>
            </div>
            <div className="data-source-list-head">
              <span>来源系统</span>
              <span>资产</span>
              <span>状态</span>
            </div>
            <div className="data-source-compact-list" aria-busy={loading}>
              {assets.length ? assets.map((item) => (
                <div
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  className={item.id === selectedAsset?.id ? 'data-source-compact-row active' : 'data-source-compact-row'}
                  onClick={() => {
                    setSelectedAssetId(item.id);
                    setSelectedTableId(item.tables[0]?.id);
                  }}
                  aria-pressed={item.id === selectedAsset?.id}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelectedAssetId(item.id);
                      setSelectedTableId(item.tables[0]?.id);
                    }
                  }}
                >
                  <span className="data-source-row-main">
                    <strong>{item.name}</strong>
                    <small>{item.type} · {item.owner || '未设置负责人'}</small>
                  </span>
                  <span className="data-source-row-count">{item.tables.length}表</span>
                  <span className={`data-source-status-dot ${getDataSourceStatusClass(item.status)}`} title={getDataSourceStatusLabel(item.status)} />
                </div>
              )) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={loading ? '加载中' : '暂无数据源'} />
              )}
            </div>
          </div>
          <div className="data-directory-section">
            <Typography.Text type="secondary">业务域</Typography.Text>
            <div className="data-domain-list">
              {DATA_DOMAINS.map((domain) => (
                <button key={domain} type="button" className={activeDomain === domain ? 'active' : ''} onClick={() => setActiveDomain(domain)}>
                  <span>{domain}</span>
                  <Tag>{selectedAsset?.tables.filter((table) => tableMatchesBusinessDomain(table, domain)).length ?? 0}</Tag>
                </button>
              ))}
            </div>
          </div>
        </Card>
      </aside>

      <section className="data-asset-main">
        <Card
          className="data-asset-main-card"
          title={
            <Space direction="vertical" size={2}>
              <Typography.Text strong>{selectedAsset?.name ?? '结构化数据资产'}</Typography.Text>
              <Typography.Text type="secondary">选择数据表查看字段画像，完成识别后发布到对象与关系中心</Typography.Text>
            </Space>
          }
          extra={
            <Space wrap>
              <Button icon={<ReloadOutlined />} loading={scanning} disabled={!selectedAsset} onClick={scanMetadata}>扫描元数据</Button>
              <Button danger disabled={!selectedAsset || scanning || !selectedAsset.tables.length} onClick={clearMetadataView}>清空元数据</Button>
              <Button type="primary" icon={<NodeIndexOutlined />} onClick={openMapping}>前往字段映射</Button>
            </Space>
          }
        >
          <div className="data-asset-metrics">
            <div><span>来源类型</span><strong>{selectedAsset?.type?.toUpperCase() ?? '-'}</strong></div>
            <div><span>数据表 / 数据集</span><strong>{selectedAssetStats.tableCount}</strong></div>
            <div><span>字段数量</span><strong>{selectedAssetStats.fieldCount}</strong></div>
            <div><span>记录数</span><strong>{selectedAssetStats.totalRows.toLocaleString()}</strong></div>
            <div><span>平均质量分</span><strong>{selectedAssetStats.avgQuality}</strong></div>
            <div><span>候选项</span><strong>{assetCandidates.length}</strong></div>
          </div>

          <Table
            className="data-asset-table"
            rowKey="id"
            size="small"
            scroll={{ x: 620 }}
            dataSource={filteredTables}
            pagination={false}
            locale={{ emptyText: <Empty description={selectedAsset?.tables.length ? '没有匹配的数据资产' : '等待扫描元数据'} /> }}
            onRow={(record) => ({
              onClick: () => setSelectedTableId(record.id),
            })}
            rowClassName={(record) => (record.id === selectedTable?.id ? 'active-row' : '')}
            columns={[
              {
                title: '数据资产',
                dataIndex: 'label',
                width: 190,
                render: (text, record: any) => (
                  <Space direction="vertical" size={2}>
                    <Space wrap>
                      <strong>{text}</strong>
                      {text !== record.name && <Tag>{record.name}</Tag>}
                    </Space>
                    <Typography.Text type="secondary">{record.fields.length} 个字段</Typography.Text>
                  </Space>
                ),
              },
              { title: '记录数', dataIndex: 'rows', width: 80, align: 'right' },
              {
                title: '质量分',
                dataIndex: 'quality_score',
                width: 90,
                render: (score: number) => (
                  <Space>
                    <Tag color={score >= 95 ? 'success' : 'warning'}>{score}</Tag>
                  </Space>
                ),
              },
              {
                title: '语义状态',
                width: 110,
                render: (_, record: any) => {
                  const mapped = ontologyMappings.some(mapping =>
                    mapping.source_system === String(selectedAsset?.id)
                    && (mapping.source_entity === record.name || mapping.source_entity === record.id)
                    && mapping.status === 'approved'
                  );
                  const count = candidatesForTable(record).length;
                  const status = count ? `${count} 条待审核` : mapped ? '已映射本体' : '暂无映射';
                  return <Tag color={count ? 'processing' : mapped ? 'success' : 'default'}>{status}</Tag>;
                },
              },
              {
                title: '字段摘要',
                dataIndex: 'fields',
                render: (fields: any[]) => <Space wrap>{fields.slice(0, 4).map((field) => <Tag key={field.name}>{field.label}</Tag>)}</Space>,
              },
            ]}
          />
        </Card>
      </section>

      <aside className="data-asset-detail">
        <Card className="data-asset-detail-card" title={selectedTable?.label ?? '资产详情'} extra={<Tag color={selectedTable?.quality_score >= 95 ? 'success' : 'warning'}>质量 {selectedTable?.quality_score ?? '-'}</Tag>}>
          {selectedTable ? (
            <Tabs
              size="small"
              items={[
                {
                  key: 'profile',
                  label: '字段画像',
                  children: (
                    <Space direction="vertical" size={12} style={{ width: '100%' }}>
                      <div className="data-asset-summary">
                        <span>物理表</span><strong>{selectedTable.name}</strong>
                        <span>负责人</span><strong>{selectedTable.owner}</strong>
                        <span>同步状态</span><strong>{selectedTable.status}</strong>
                      </div>
                      <List
                        dataSource={selectedTable.fields}
                        renderItem={(field) => (
                          <List.Item className="data-field-item">
                            <List.Item.Meta
                              title={<Space wrap><strong>{field.label}</strong>{field.label !== field.name && <Tag>{field.name}</Tag>}<Tag>{field.type}</Tag>{field.primary_key ? <Tag color="blue">主键</Tag> : null}</Space>}
                              description={<Space wrap><span>空值率 0%</span><span>唯一性 {field.primary_key ? '100%' : '86%'}</span><span>质量 {field.quality === 'warning' ? '需复核' : '正常'}</span></Space>}
                            />
                          </List.Item>
                        )}
                      />
                    </Space>
                  ),
                },
                {
                  key: 'quality',
                  label: '质量规则',
                  children: (
                    <Space className="data-quality-panel" direction="vertical" size={10} style={{ width: '100%' }}>
                      <div className="data-quality-definition-summary">
                        <div>
                          <strong>评分指标</strong>
                          <span>新增规则就是新增质量指标；分数评判标准用于设置各指标如何合成总分。</span>
                        </div>
                        <Tag color={selectedTable.quality_score >= 95 ? 'success' : 'warning'}>{selectedTable.quality_score} 分</Tag>
                      </div>
                      <div className="data-quality-mini-stats">
                        <span>指标 {selectedQualityRuleStats.total}</span>
                        <span>启用 {selectedQualityRuleStats.enabled}</span>
                        <span>自定义 {selectedQualityRuleStats.custom}</span>
                        <span>计分 {selectedQualityRuleStats.scoring}</span>
                      </div>
                      {selectedQualityRules.map((rule) => (
                        <div className="data-quality-row" key={rule.key}>
                          <Checkbox
                            checked={(qualityRuleState[`${selectedTable.id}:${rule.key}`] ?? (rule.enabled ? 'enabled' : 'disabled')) === 'enabled'}
                            onChange={(event) => updateQualityRule(rule, event.target.checked)}
                          >
                            <span className="data-quality-rule-title">{rule.name}</span>
                            <span className="data-quality-rule-desc">{rule.description}</span>
                            <span className="data-quality-rule-meta">
                              <Tag>{String(rule.dimension ?? 'custom')}</Tag>
                              {rule.id || rule.custom ? <Tag color="processing">自定义</Tag> : <Tag>自动</Tag>}
                              <Tag>权重 {Number(rule.weight ?? 1)}</Tag>
                              <Tag>阈值 {Number(rule.threshold ?? 95)}%</Tag>
                            </span>
                          </Checkbox>
                          <Space className="data-quality-result" direction="vertical" size={4} align="end">
                            <Space size={6}>
                              {rule.passRate === null || rule.passRate === undefined ? <Tag>待算</Tag> : <Tag>{rule.passRate}%</Tag>}
                              <Tag color={rule.color}>{rule.status ?? '已配置'}</Tag>
                            </Space>
                            <Space size={2}>
                              <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openQualityRuleModal(rule)} />
                              <Button size="small" type="text" danger icon={<DeleteOutlined />} disabled={!rule.id} onClick={() => removeQualityRule(rule)} />
                            </Space>
                          </Space>
                        </div>
                      ))}
                      <div className="data-quality-bottom-actions">
                        <Button onClick={openQualityScoreStandard}>分数评判标准</Button>
                        <Button type="primary" icon={<PlusOutlined />} onClick={() => openQualityRuleModal()}>新增规则</Button>
                      </div>
                    </Space>
                  ),
                },
                {
                  key: 'mapping',
                  label: '当前表映射',
                  children: (
                    <Space direction="vertical" size={12} style={{ width: '100%' }}>
                      <div className="data-candidate-list">
                        <div className="data-candidate-list-head">
                          <Typography.Text strong>候选明细</Typography.Text>
                          <Tag>{selectedTableCandidates.length}</Tag>
                        </div>
                        {selectedTableCandidates.length ? (
                          <List
                            size="small"
                            dataSource={selectedTableCandidates}
                            renderItem={(candidate) => (
                              <List.Item className="data-candidate-item">
                                <Space direction="vertical" size={3} style={{ width: '100%' }}>
                                  <Space wrap>
                                    <Tag color={candidate.candidate_type === 'object' ? 'blue' : candidate.candidate_type === 'relation' ? 'purple' : 'default'}>{getCandidateTypeLabel(candidate.candidate_type)}</Tag>
                                    <Typography.Text strong>{candidate.title}</Typography.Text>
                                  </Space>
                                  <Space wrap>
                                    <span>置信度 {Math.round(Number(candidate.confidence || 0) * 100)}%</span>
                                    <span>状态 {candidate.status === 'pending_review' ? '待审核' : candidate.status}</span>
                                  </Space>
                                </Space>
                              </List.Item>
                            )}
                          />
                        ) : (
                          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无待审核候选，可前往字段与语义映射生成" />
                        )}
                      </div>
                      <Button
                        disabled={!selectedTableCandidates.length}
                        onClick={() => {
                          const candidate = selectedTableCandidates[0];
                          if (candidate) openCandidateReview(candidate.id);
                        }}
                      >查看待审核候选</Button>
                    </Space>
                  ),
                },
                {
                  key: 'lineage',
                  label: '血缘下游',
                  children: (
                    <Space direction="vertical" size={10} style={{ width: '100%' }}>
                      <div className="data-lineage-step"><Tag>来源</Tag><span>{selectedTable.assetName}</span></div>
                      <div className="data-lineage-step"><Tag color="blue">本体</Tag><span>{objects.some((object) => object.source === selectedTable.id) ? '已绑定对象' : '等待建模'}</span></div>
                      <div className="data-lineage-step"><Tag color="purple">图谱</Tag><span>查看实体与关系实例</span></div>

                    </Space>
                  ),
                },
              ]}
            />
          ) : (
            <Empty />
          )}
        </Card>
      </aside>
    </div>}
    <Modal
      title="评分公式设置"
      open={qualityScoreStandardOpen}
      onCancel={() => setQualityScoreStandardOpen(false)}
      onOk={saveQualityScoreStandard}
      confirmLoading={savingQualityRule}
      okText="保存公式"
      cancelText="取消"
      width={860}
      destroyOnHidden
    >
      <Space className="quality-score-standard" direction="vertical" size={14}>
        <Form form={qualityScoreForm} className="quality-score-rule-form">
          <div className="quality-score-editor-head">
            <div className="quality-score-current">
              <span>当前质量分</span>
              <strong>{selectedTable?.quality_score ?? '-'}</strong>
              <small>按当前公式预估</small>
            </div>
            <div className="quality-formula-builder">
              <div className="quality-formula-topline">
                <Typography.Text strong>自定义评分公式</Typography.Text>
                <Form.Item name="formula_mode" noStyle>
                  <Select
                    className="quality-formula-mode"
                    options={[
                      { value: 'weighted_average', label: '加权平均' },
                      { value: 'minimum_gate', label: '门槛优先' },
                      { value: 'custom_expression', label: '自定义表达式' },
                    ]}
                  />
                </Form.Item>
              </div>
              <Form.Item
                name="formula_expression"
                rules={[{ required: true, message: '请输入评分公式' }]}
                className="quality-formula-expression"
              >
                <Input.TextArea
                  autoSize={{ minRows: 2, maxRows: 4 }}
                  placeholder="例如：sum(passRate * weight) / sum(weight)"
                />
              </Form.Item>
              <div className="quality-formula-token-row">
                <span>可用变量</span>
                {['passRate', 'weight', 'threshold', 'enabled', 'includeInScore'].map((token) => (
                  <Tag className="quality-formula-token" key={token}>{token}</Tag>
                ))}
              </div>
              <Typography.Text type="secondary">
                下面每一行是参与公式计算的质量指标；新增规则会新增指标，是否计分由右侧开关控制。
              </Typography.Text>
            </div>
          </div>
          <Form.List name="rules">
            {(fields) => (
              <div className="quality-score-rule-list">
                {fields.map((field, index) => {
                  const rule = selectedQualityRules[index];
                  const passRate = rule?.passRate === null || rule?.passRate === undefined ? null : Number(rule.passRate);
                  return (
                    <div className="quality-score-rule-row" key={field.key}>
                      <div className="quality-score-rule-name">
                        <strong>{rule?.name ?? '-'}</strong>
                        <span>{rule?.field_name ? `字段：${rule.field_name}` : '整表指标'} · {String(rule?.dimension ?? 'custom')}</span>
                        <Form.Item name={[field.name, 'key']} hidden><Input /></Form.Item>
                      </div>
                      <div className="quality-score-pass">
                        <Tag color={passRate === null ? 'default' : passRate >= Number(rule?.threshold ?? 95) ? 'success' : 'warning'}>
                          {passRate === null ? '待执行' : `${passRate}%`}
                        </Tag>
                        <span>通过率</span>
                      </div>
                      <div className="quality-score-weight">
                        <Form.Item name={[field.name, 'weight']} rules={[{ required: true }]} noStyle>
                          <Slider min={0} max={5} step={0.5} tooltip={{ formatter: (value) => `权重 ${value}` }} />
                        </Form.Item>
                      </div>
                      <Form.Item name={[field.name, 'threshold']} rules={[{ required: true }]} noStyle>
                        <InputNumber className="quality-score-threshold" min={0} max={100} addonAfter="%" />
                      </Form.Item>
                      <div className="quality-score-switches">
                        <label>
                          <span>启用</span>
                          <Form.Item name={[field.name, 'enabled']} valuePropName="checked" noStyle>
                            <Switch size="small" />
                          </Form.Item>
                        </label>
                        <label>
                          <span>计分</span>
                          <Form.Item name={[field.name, 'include_in_score']} valuePropName="checked" noStyle>
                            <Switch size="small" />
                          </Form.Item>
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Form.List>
        </Form>
        <div className="quality-score-band-strip">
          <span><Tag color="success">98-100</Tag>优秀</span>
          <span><Tag color="processing">95-97</Tag>良好</span>
          <span><Tag color="warning">90-94</Tag>需复核</span>
          <span><Tag color="error">0-89</Tag>异常</span>
        </div>
      </Space>
    </Modal>
    <Modal
      title={editingQualityRule?.id || editingQualityRule?.custom ? '编辑质量指标' : editingQualityRule ? '配置自动指标' : '新增质量指标'}
      open={qualityRuleModalOpen}
      onCancel={() => {
        setQualityRuleModalOpen(false);
        setEditingQualityRule(undefined);
        qualityRuleForm.resetFields();
      }}
      onOk={saveQualityRule}
      confirmLoading={savingQualityRule}
      okText="保存"
      cancelText="取消"
      width={720}
      destroyOnHidden
    >
      <Form form={qualityRuleForm} className="quality-rule-form" layout="horizontal" labelCol={{ flex: '112px' }} wrapperCol={{ flex: 1 }} colon={false}>
        <div className="quality-rule-context">
          <span>当前数据源</span><strong>{selectedAsset?.name ?? '-'}</strong>
          <span>当前表</span><strong>{selectedTable?.name ?? '-'}</strong>
        </div>
        <Form.Item label="指标名称" name="name" rules={[{ required: true, message: '请输入指标名称' }]}>
          <Input placeholder="例如：设备健康分范围检查" />
        </Form.Item>
        <Form.Item label="指标 Key" name="key" tooltip="同一张表内唯一；留空时后台会按指标名称生成。">
          <Input placeholder="例如：health-score-range" disabled={Boolean(editingQualityRule?.id)} />
        </Form.Item>
        <Form.Item label="指标类型" name="rule_type" rules={[{ required: true }]}>
          <Select options={[
            { value: 'not_null', label: '非空检查' },
            { value: 'unique', label: '唯一性检查' },
            { value: 'enum', label: '枚举合法值' },
            { value: 'range', label: '数值范围' },
            { value: 'regex', label: '格式正则' },
            { value: 'foreign_key', label: '引用一致性' },
            { value: 'freshness', label: '同步新鲜度' },
            { value: 'custom', label: '自定义表达式' },
          ]} />
        </Form.Item>
        <Form.Item label="检查字段" name="field_name">
          <Select allowClear placeholder="不选则表示整表指标" options={(selectedTable?.fields ?? []).map((field) => ({ value: field.name, label: `${field.name} · ${field.label}` }))} />
        </Form.Item>
        <Form.Item label="质量维度" name="dimension" rules={[{ required: true }]}>
          <Select options={[
            { value: 'completeness', label: '完整性' },
            { value: 'uniqueness', label: '唯一性' },
            { value: 'validity', label: '有效性' },
            { value: 'consistency', label: '一致性' },
            { value: 'freshness', label: '时效性' },
            { value: 'reasonableness', label: '合理性' },
            { value: 'custom', label: '自定义' },
          ]} />
        </Form.Item>
        <Row gutter={12}>
          <Col span={8}><Form.Item label="达标阈值" name="threshold" rules={[{ required: true }]} labelCol={{ span: 24 }} wrapperCol={{ span: 24 }}><InputNumber min={0} max={100} addonAfter="%" style={{ width: '100%' }} /></Form.Item></Col>
          <Col span={8}><Form.Item label="评分权重" name="weight" rules={[{ required: true }]} labelCol={{ span: 24 }} wrapperCol={{ span: 24 }}><InputNumber min={0} step={0.5} style={{ width: '100%' }} /></Form.Item></Col>
          <Col span={8}><Form.Item label="严重级别" name="severity" rules={[{ required: true }]} labelCol={{ span: 24 }} wrapperCol={{ span: 24 }}><Select options={[{ value: 'info', label: '提示' }, { value: 'warning', label: '警告' }, { value: 'blocking', label: '阻断' }]} /></Form.Item></Col>
        </Row>
        <Form.Item label="启用设置">
          <Space size={20}>
            <Form.Item name="enabled" valuePropName="checked" noStyle><Switch checkedChildren="启用" unCheckedChildren="停用" /></Form.Item>
            <Form.Item name="include_in_score" valuePropName="checked" noStyle><Checkbox>参与质量分</Checkbox></Form.Item>
          </Space>
        </Form.Item>
        <Form.Item label="指标说明" name="description">
          <Input.TextArea rows={3} placeholder="说明业务口径，例如 health_score 必须在 0 到 100 之间。" />
        </Form.Item>
        <Form.Item label="指标参数" name="configText" tooltip="用于保存枚举值、范围、正则或表达式参数。">
          <Input.TextArea rows={4} placeholder='例如 {"min":0,"max":100} 或 {"values":["running","stopped"]}' />
        </Form.Item>
      </Form>
    </Modal>
    </>
  );
}
