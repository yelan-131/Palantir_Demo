import { createUuid } from '@/utils/uuid';
import { useMemo, useState } from 'react';
import { Alert, App, Button, Drawer, Input, Modal, Segmented, Select, Switch, Tag, Tooltip } from 'antd';
import { ApartmentOutlined, ArrowDownOutlined, ArrowLeftOutlined, ArrowRightOutlined, ArrowUpOutlined, CheckCircleOutlined, CheckOutlined, ClockCircleOutlined, CloseOutlined, CopyOutlined, DatabaseOutlined, DeleteOutlined, EditOutlined, EyeOutlined, FileTextOutlined, FormOutlined, HistoryOutlined, InfoCircleOutlined, LayoutOutlined, LockOutlined, NumberOutlined, PlusOutlined, QuestionCircleOutlined, RedoOutlined, SaveOutlined, SelectOutlined, SettingOutlined, UndoOutlined } from '@ant-design/icons';
import FormSurface from './FormSurface';
import { createField, initialDesign, moveField, validateRecord, type DesignField, type FieldType, type FormDesign } from './model';

type Mode = 'use' | 'design';
type Panel = 'versions' | 'flow' | 'permissions' | 'data' | 'guide' | null;
type PublishedVersion = { version: number; title: string; time: string; design: FormDesign };
const storageKey = 'mf:unified-form-design-prototype:v1';
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const equal = (a: FormDesign, b: FormDesign) => JSON.stringify(a) === JSON.stringify(b);
const startingValues: Record<string, string | number> = { material_code: 'MAT-2026-0008', material_type: '成品', unit: '件', safety_stock: 0, status: '启用' };
const fieldTypes: { type: FieldType; label: string; icon: React.ReactNode }[] = [
  { type: 'text', label: '文本', icon: <FormOutlined /> }, { type: 'number', label: '数值', icon: <NumberOutlined /> },
  { type: 'select', label: '下拉选择', icon: <SelectOutlined /> }, { type: 'textarea', label: '多行文本', icon: <FileTextOutlined /> },
];
function loadSaved() {
  try {
    const data = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (Array.isArray(data?.draft?.fields) && data?.published?.fields?.length && Number.isInteger(data.version) && Array.isArray(data.versions)) return data as { draft: FormDesign; published: FormDesign; version: number; versions: PublishedVersion[] };
  } catch { /* A preview always starts clean when browser storage is unavailable. */ }
  return { draft: clone(initialDesign), published: clone(initialDesign), version: 1, versions: [{ version: 1, title: '初始示例版本', time: '原型初始配置', design: clone(initialDesign) }] };
}

export default function UnifiedFormPreview() {
  const { message } = App.useApp();
  const [initial] = useState(loadSaved);
  const [mode, setMode] = useState<Mode>('design');
  const [draft, setDraft] = useState<FormDesign>(initial.draft);
  const [saved, setSaved] = useState<FormDesign>(clone(initial.draft));
  const [published, setPublished] = useState<FormDesign>(initial.published);
  const [version, setVersion] = useState(initial.version);
  const [versions, setVersions] = useState<PublishedVersion[]>(initial.versions);
  const [selectedId, setSelectedId] = useState<string | null>(initial.draft.fields.find(field => field.key === 'material_name')?.id || null);
  const [values, setValues] = useState<Record<string, string | number>>(startingValues);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [undoStack, setUndoStack] = useState<FormDesign[]>([]);
  const [redoStack, setRedoStack] = useState<FormDesign[]>([]);
  const [previewDraft, setPreviewDraft] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const selected = draft.fields.find(field => field.id === selectedId) || null;
  const dirty = !equal(draft, saved);
  const pending = !equal(draft, published);
  const visibleDesign = mode === 'design' || previewDraft ? draft : published;
  const changedFields = useMemo(() => draft.fields.filter(field => JSON.stringify(field) !== JSON.stringify(published.fields.find(item => item.id === field.id))).map(field => field.label), [draft, published]);
  const removedFields = published.fields.filter(field => !draft.fields.some(item => item.id === field.id));
  const saveLocal = (data: { draft: FormDesign; published: FormDesign; version: number; versions: PublishedVersion[] }) => {
    try { localStorage.setItem(storageKey, JSON.stringify(data)); return true; }
    catch { message.warning('浏览器未允许保存，本次页面中的修改仍保留。'); return false; }
  };
  const change = (next: FormDesign) => {
    if (equal(next, draft)) return;
    setUndoStack(stack => [...stack.slice(-39), clone(draft)]);
    setRedoStack([]);
    setDraft(next);
  };
  const updateField = (patch: Partial<DesignField>) => {
    if (!selected) return;
    change({ ...draft, fields: draft.fields.map(field => field.id === selected.id ? { ...field, ...patch } : field) });
  };
  const move = (sourceId: string, targetId: string) => change({ ...draft, fields: moveField(draft.fields, sourceId, targetId) });
  const add = (type: FieldType) => {
    const field = createField(type);
    change({ ...draft, fields: [...draft.fields, field] });
    setSelectedId(field.id);
    message.success(`已添加${fieldTypes.find(item => item.type === type)?.label}字段`);
  };
  const undo = () => {
    const previous = undoStack[undoStack.length - 1]; if (!previous) return;
    setRedoStack(stack => [...stack, clone(draft)]); setUndoStack(stack => stack.slice(0, -1)); setDraft(previous);
  };
  const redo = () => {
    const next = redoStack[redoStack.length - 1]; if (!next) return;
    setUndoStack(stack => [...stack, clone(draft)]); setRedoStack(stack => stack.slice(0, -1)); setDraft(next);
  };
  const saveDraft = () => {
    if (saveLocal({ draft, published, version, versions })) { setSaved(clone(draft)); message.success('草稿已保存到本原型'); }
  };
  const publish = () => {
    const nextVersion = version + 1;
    const nextVersions = [{ version: nextVersion, title: '页面配置已更新', time: new Date().toLocaleString('zh-CN', { hour12: false }), design: clone(draft) }, ...versions];
    if (!saveLocal({ draft, published: draft, version: nextVersion, versions: nextVersions })) return;
    setPublished(clone(draft)); setSaved(clone(draft)); setVersion(nextVersion); setVersions(nextVersions); setPublishOpen(false);
    message.success(`v${nextVersion} 已在本原型中生效，可以切换「业务使用」体验`);
  };
  const submit = () => {
    const issues = validateRecord(visibleDesign, values); setErrors(issues);
    if (Object.keys(issues).length) { message.warning('请先完成标记的字段'); return; }
    setResultOpen(true);
  };
  const switchMode = (value: string | number) => { setMode(value as Mode); setPreviewDraft(false); setErrors({}); };
  const openDraftPreview = () => { setPreviewDraft(true); setMode('use'); setErrors({}); };
  const selectedIndex = draft.fields.findIndex(field => field.id === selectedId);
  const designIssues = [
    ...(!draft.title.trim() ? ['请填写表单标题'] : []),
    ...(!draft.fields.some(field => !field.hidden) ? ['请保留至少一个可见字段'] : []),
    ...draft.fields.filter(field => !field.label.trim()).map(() => '请补全字段名称'),
    ...draft.fields.filter(field => !field.hidden && field.required && field.readonly && (startingValues[field.key] === undefined || String(startingValues[field.key]).trim() === '')).map(field => `${field.label}为必填且只读，当前没有自动值，请取消必填或只读`),
  ];
  const canPublish = pending && !designIssues.length;

  return <div className={`uf-app uf-mode-${mode}`}>
    <aside className="uf-sidebar">
      <div className="uf-brand"><div className="uf-brand-icon"><ApartmentOutlined /></div><div className="uf-nav-label"><strong>制造数智平台</strong><span>业务工作空间</span></div></div>
      <div className="uf-nav-section uf-nav-label">业务应用</div>
      <button className="uf-nav-item is-active" onClick={() => { setMode('use'); setPreviewDraft(false); }}><DatabaseOutlined /><span className="uf-nav-label">物料主数据</span></button>
      <div className="uf-nav-section uf-nav-label">当前页面</div>
      <button className="uf-nav-item" onClick={() => setPanel('versions')}><HistoryOutlined /><span className="uf-nav-label">版本记录</span></button>
      <button className="uf-nav-item" onClick={() => setPanel('guide')}><QuestionCircleOutlined /><span className="uf-nav-label">体验说明</span></button>
      <div className="uf-sidebar-foot"><span className="uf-avatar">设</span><div className="uf-nav-label"><strong>设计者视角</strong><span>可编辑页面配置</span></div></div>
    </aside>
    <main className="uf-main">
      <header className="uf-topbar"><div className="uf-breadcrumb">业务应用 <span>/</span> 基础资料 <span>/</span> <strong>物料主数据</strong></div><Tooltip title="示例数据，保存与发布只在本原型中生效"><span className="uf-prototype-badge"><InfoCircleOutlined /> 交互原型</span></Tooltip></header>
      <div className="uf-page-header"><div className="uf-page-title"><h1>物料主数据</h1><p>{mode === 'design' ? '在真实页面上调整布局、字段与交互' : '建立统一物料档案，连接采购、生产与库存'}</p></div>
        <Segmented className="uf-mode-switch" value={mode} onChange={switchMode} options={[{ value: 'use', label: <span><FileTextOutlined /> 业务使用</span> }, { value: 'design', label: <span><EditOutlined /> 页面设计</span> }]} /></div>
      <div className="uf-commandbar">
        <div className="uf-command-context"><span className={`uf-status-dot ${dirty && mode === 'design' ? 'is-dirty' : ''}`} /><strong>{mode === 'design' ? '工作草稿' : previewDraft ? '草稿预览' : `已发布 v${version}`}</strong><span>{mode === 'design' ? dirty ? '有未保存的修改' : pending ? '已保存，等待发布' : `与 v${version} 同步` : previewDraft ? '仅供你体验，发布后才对其他人可见' : '当前业务页面'}</span></div>
        <div className="uf-command-actions">{mode === 'design' ? <>
          <Tooltip title="撤销"><Button aria-label="撤销修改" type="text" icon={<UndoOutlined />} disabled={!undoStack.length} onClick={undo} /></Tooltip>
          <Tooltip title="重做"><Button aria-label="重做修改" type="text" icon={<RedoOutlined />} disabled={!redoStack.length} onClick={redo} /></Tooltip>
          <span className="uf-command-separator" />
          <Button type="text" icon={<ApartmentOutlined />} onClick={() => setPanel('flow')}>流程</Button>
          <Button type="text" icon={<LockOutlined />} onClick={() => setPanel('permissions')}>权限</Button>
          <Button type="text" icon={<EyeOutlined />} onClick={openDraftPreview}>预览草稿</Button>
          <Button icon={<SaveOutlined />} onClick={saveDraft} disabled={!dirty}>保存草稿</Button>
          <Button type="primary" icon={<CheckCircleOutlined />} disabled={!canPublish} onClick={() => setPublishOpen(true)}>发布更改</Button>
        </> : previewDraft ? <Button icon={<ArrowLeftOutlined />} onClick={() => setMode('design')}>继续设计</Button> : <><Button type="text" icon={<HistoryOutlined />} onClick={() => setPanel('versions')}>版本记录</Button><Button icon={<EditOutlined />} onClick={() => setMode('design')}>编辑此页面</Button></>}</div>
      </div>

      <div className="uf-workarea">
        {mode === 'design' && <aside className="uf-outline">
          <div className="uf-panel-head"><strong>页面结构</strong><span>{draft.fields.length} 个字段</span></div>
          <button className={`uf-outline-item ${!selected ? 'is-selected' : ''}`} onClick={() => setSelectedId(null)}><LayoutOutlined /><span>表单页面<small>标题与说明</small></span><SettingOutlined /></button>
          <div className="uf-outline-section">基础信息</div>
          {draft.fields.map(field => <button key={field.id} className={`uf-outline-item ${selectedId === field.id ? 'is-selected' : ''}`} onClick={() => setSelectedId(field.id)}><span>{fieldTypes.find(item => item.type === field.type)?.icon}</span><span>{field.label}<small>{field.hidden ? '已隐藏' : field.required ? '必填' : '选填'} · {field.width}%</small></span>{field.readonly && <LockOutlined />}</button>)}
          <div className="uf-outline-section">添加字段</div><div className="uf-add-grid">{fieldTypes.map(type => <Button key={type.type} icon={type.icon} onClick={() => add(type.type)}>{type.label}</Button>)}</div>
          <p className="uf-outline-note"><InfoCircleOutlined /> 点击字段编辑属性；拖动字段手柄调整顺序。</p>
          <Button block type="text" icon={<DatabaseOutlined />} onClick={() => setPanel('data')}>数据来源</Button>
        </aside>}
        <section className="uf-stage">
          <div className="uf-stage-top"><div className="uf-stage-breadcrumb"><FileTextOutlined /><span>{mode === 'design' ? '表单页面' : '新建物料'}</span>{mode === 'design' && <Tag bordered={false}>实时画布</Tag>}</div><span className="uf-selection-hint">{mode === 'design' ? '点击页面中的任意字段开始编辑' : '标记 * 的项目为必填'}</span></div>
          {(mode === 'design' || previewDraft) && designIssues.length > 0 && <Alert style={{ marginBottom: 16 }} showIcon type="warning" message="发布前需要处理" description={designIssues.join('；')} />}
          <FormSurface design={visibleDesign} mode={mode} selectedId={selectedId} values={values} errors={errors} onSelect={setSelectedId} onValueChange={(key, value) => { setValues(current => ({ ...current, [key]: value })); setErrors(current => ({ ...current, [key]: '' })); }} onMove={move} />
          <div className="uf-form-footer"><span><LockOutlined /> {mode === 'design' ? '这里的更改保留为草稿，发布后生效' : '本次填写仅用于体验，不会写入业务系统'}</span><div>{mode === 'design' ? <Button icon={<EyeOutlined />} onClick={openDraftPreview}>体验填写效果</Button> : <><Button onClick={() => { setValues({ ...startingValues, material_name: '伺服驱动器', spec_model: 'SD-200 / 220V', safety_stock: 20 }); setErrors({}); }}>填入示例</Button><Button type="primary" onClick={submit}>验证并提交 <ArrowRightOutlined /></Button></>}</div></div>
          <div className="uf-stage-footnote">{mode === 'design' ? <><CheckOutlined /> 编辑画布与使用页面共用同一张表单</> : <><CheckOutlined /> 表单布局与校验来自当前页面配置</>}</div>
        </section>
        {mode === 'design' && <aside className="uf-inspector">
          <div className="uf-inspector-heading"><div className="uf-inspector-icon">{selected ? fieldTypes.find(item => item.type === selected.type)?.icon : <LayoutOutlined />}</div><div><strong>{selected?.label || '页面属性'}</strong><span>{selected ? '字段属性' : '页面基础配置'}</span></div><Tooltip title="查看页面属性"><Button type="text" aria-label="取消字段选择" icon={<CloseOutlined />} onClick={() => setSelectedId(null)} /></Tooltip></div>
          {selected ? <>
            <section className="uf-inspector-section"><h3>基本信息</h3><label className="uf-property"><span>字段名称</span><Input aria-label="字段名称" value={selected.label} onChange={event => updateField({ label: event.target.value })} /></label><label className="uf-property"><span>字段类型</span><Input value={fieldTypes.find(item => item.type === selected.type)?.label} readOnly /></label><div className="uf-property"><span>字段标识</span><code>{selected.key}</code></div></section>
            <section className="uf-inspector-section"><h3>布局</h3><div className="uf-property"><span>控件宽度</span><div className="uf-width-options" role="group" aria-label="控件宽度">{([25, 33, 50, 75, 100] as const).map(width => <button type="button" key={width} aria-label={`控件宽度 ${width}%`} aria-pressed={selected.width === width} className={selected.width === width ? 'is-active' : ''} onClick={() => updateField({ width })}>{width}%</button>)}</div></div><label className="uf-property"><span>标题位置</span><Select aria-label="标题位置" value={selected.labelPosition || 'top'} options={[{ value: 'top', label: '上方' }, { value: 'left', label: '左侧' }]} onChange={labelPosition => updateField({ labelPosition })} /></label></section>
            <section className="uf-inspector-section"><h3>填写规则</h3><div className="uf-switch-row"><span>必填字段</span><Switch size="small" aria-label="必填字段" checked={selected.required} onChange={required => updateField({ required })} /></div><div className="uf-switch-row"><span>只读</span><Switch size="small" aria-label="只读字段" checked={Boolean(selected.readonly)} onChange={readonly => updateField({ readonly })} /></div><div className="uf-switch-row"><span>显示字段</span><Switch size="small" aria-label="显示字段" checked={!selected.hidden} onChange={visible => updateField({ hidden: !visible })} /></div><label className="uf-property"><span>占位提示</span><Input aria-label="占位提示" value={selected.placeholder || ''} onChange={event => updateField({ placeholder: event.target.value })} /></label><label className="uf-property"><span>帮助说明</span><Input.TextArea aria-label="帮助说明" autoSize={{ minRows: 2, maxRows: 4 }} value={selected.helpText || ''} placeholder="填写时需要知道的说明" onChange={event => updateField({ helpText: event.target.value })} /></label>{selected.type === 'select' && <label className="uf-property"><span>下拉选项</span><Input.TextArea aria-label="下拉选项" value={(selected.options || []).join('\n')} autoSize={{ minRows: 2, maxRows: 4 }} onChange={event => updateField({ options: event.target.value.split('\n') })} /><small>每行一个选项</small></label>}</section>
            <div className="uf-inspector-actions"><Tooltip title="上移字段"><Button aria-label="上移字段" icon={<ArrowUpOutlined />} disabled={selectedIndex <= 0} onClick={() => move(selected.id, draft.fields[selectedIndex - 1].id)} /></Tooltip><Tooltip title="下移字段"><Button aria-label="下移字段" icon={<ArrowDownOutlined />} disabled={selectedIndex >= draft.fields.length - 1} onClick={() => move(selected.id, draft.fields[selectedIndex + 1].id)} /></Tooltip><Button icon={<CopyOutlined />} onClick={() => { const copied = { ...clone(selected), id: createUuid(), key: `${selected.key}_${createUuid().slice(0, 6)}`, label: `${selected.label}副本`, readonly: false }; change({ ...draft, fields: [...draft.fields.slice(0, selectedIndex + 1), copied, ...draft.fields.slice(selectedIndex + 1)] }); setSelectedId(copied.id); }}>复制</Button><Button danger type="text" aria-label="移除字段" icon={<DeleteOutlined />} onClick={() => setDeleteOpen(true)} /></div>
          </> : <section className="uf-inspector-section"><h3>页面内容</h3><label className="uf-property"><span>表单标题</span><Input aria-label="表单标题" value={draft.title} onChange={event => change({ ...draft, title: event.target.value })} /></label><label className="uf-property"><span>表单说明</span><Input.TextArea aria-label="表单说明" value={draft.description} autoSize={{ minRows: 3, maxRows: 6 }} onChange={event => change({ ...draft, description: event.target.value })} /></label><div className="uf-outline-note">选择画布中的字段，可以修改宽度、填写规则和显示方式。</div></section>}
        </aside>}
      </div>
      <footer className="uf-prototype-note"><InfoCircleOutlined /> 独立交互原型 · 示例数据 · 保存与发布仅影响本预览 <button onClick={() => setPanel('guide')}>体验说明 <ArrowRightOutlined /></button></footer>
    </main>

    <Modal centered open={publishOpen} title="发布页面更改" okText={`发布为 v${version + 1}`} onOk={publish} onCancel={() => setPublishOpen(false)}><p>当前草稿会成为本原型「业务使用」模式中的新版本。</p><div className="uf-publish-summary"><span>{draft.fields.filter(field => !field.hidden).length} 个可见字段</span><span>{draft.fields.filter(field => field.required && !field.hidden).length} 个必填项</span></div><div className="uf-change-summary"><strong>本次更改</strong>{changedFields.length > 0 && <p>调整字段：{changedFields.join('、')}</p>}{removedFields.length > 0 && <p>移除字段：{removedFields.map(field => field.label).join('、')}</p>}{draft.title !== published.title && <p>表单标题已更新</p>}{draft.description !== published.description && <p>表单说明已更新</p>}{!changedFields.length && !removedFields.length && <p>页面内容或字段顺序已调整</p>}</div><Alert showIcon type="info" message="本次发布只用于原型体验，不修改实际业务配置。" /></Modal>
    <Modal centered open={deleteOpen} title={`移除「${selected?.label || '字段'}」？`} okText="移除字段" okButtonProps={{ danger: true }} onCancel={() => setDeleteOpen(false)} onOk={() => { change({ ...draft, fields: draft.fields.filter(field => field.id !== selectedId) }); setSelectedId(null); setDeleteOpen(false); }}><p>从当前草稿移除这个字段。可以通过工具栏的撤销恢复。</p></Modal>
    <Modal centered open={resultOpen} title="填写体验完成" footer={<Button type="primary" onClick={() => setResultOpen(false)}>返回表单</Button>} onCancel={() => setResultOpen(false)}><div className="uf-success-panel"><CheckCircleOutlined /><strong>校验通过</strong><p>已生成本次体验的示例记录，未写入业务系统。</p></div><div className="uf-setting-list">{visibleDesign.fields.filter(field => !field.hidden).map(field => <div className="uf-setting-row" key={field.id}><span>{field.label}</span><strong>{String(values[field.key] ?? '—')}</strong></div>)}</div></Modal>
    <Drawer open={Boolean(panel)} onClose={() => setPanel(null)} width={460} title={{ versions: '版本记录', flow: '流程配置', permissions: '权限配置', data: '数据来源', guide: '一体化页面 · 体验说明' }[panel || 'guide']}>
      {panel === 'versions' && <><p className="uf-drawer-note">使用模式读取已发布版本；设计修改保留在工作草稿中。</p>{versions.map(item => <div className="uf-version-card" key={item.version}><div><strong>v{item.version}</strong><Tag bordered={false}>{item.version === version ? '当前使用' : '历史版本'}</Tag></div><h4>{item.title}</h4><p><ClockCircleOutlined /> {item.time}</p><span>{item.design.fields.length} 个字段 · {item.design.title}</span></div>)}</>}
      {panel === 'guide' && <div className="uf-guide"><p>同一张表单，在使用与设计之间切换。</p><ol><li><strong>点击字段，直接编辑</strong><p>选择画布中的字段，在右侧修改名称、宽度、标题位置或填写规则。</p></li><li><strong>先体验，再发布</strong><p>「预览草稿」可体验未发布的改动；「业务使用」始终显示已发布版本。</p></li><li><strong>修改有边界</strong><p>草稿可保存、撤销、重做。发布后，新布局才出现在本原型的使用模式中。</p></li><li><strong>复杂配置就地展开</strong><p>流程、权限和数据来源通过侧栏打开，保留正在编辑的表单上下文。这三个侧栏本轮展示配置结构。</p></li></ol><Alert type="info" showIcon message="独立原型" description="使用示例字段；浏览器本地保存页面草稿与示例版本。没有连接业务接口，不会覆盖你原页面的修改。" /><Button style={{ marginTop: 24 }} icon={<RedoOutlined />} onClick={() => setResetOpen(true)}>重置体验</Button></div>}
      {panel === 'flow' && <><Tag bordered={false}>配置结构预览</Tag><p className="uf-drawer-note">从当前表单展开流程配置，关闭侧栏即可继续编辑。</p><div className="uf-flow-preview">{['填写物料信息', '字段与数据校验', '负责人审批', '完成入库'].map((step, index) => <div key={step}><span>{index + 1}</span><strong>{step}</strong>{index < 3 && <ArrowDownOutlined />}</div>)}</div><p className="uf-drawer-note">此处用于展示一体化工作区中的配置入口，审批流程尚未接入业务执行。</p></>}
      {panel === 'permissions' && <><Tag bordered={false}>配置结构预览</Tag><p className="uf-drawer-note">按角色集中配置页面、字段与操作权限。</p><div className="uf-setting-list">{[['业务人员', '查看与填写已发布页面'], ['页面设计者', '编辑、预览与保存草稿'], ['发布管理员', '检查并发布页面变更']].map(([role, scope]) => <div className="uf-setting-row" key={role}><strong>{role}</strong><span>{scope}</span></div>)}</div><Alert type="info" showIcon message="设计模式仅向有配置权限的人开放" /></>}
      {panel === 'data' && <><Tag bordered={false}>配置结构预览</Tag><p className="uf-drawer-note">当前原型使用物料主数据的示例字段，不读取或写入实际记录。</p><div className="uf-setting-list"><div className="uf-setting-row"><span>业务对象</span><strong>物料主数据</strong></div><div className="uf-setting-row"><span>对应数据表</span><code>business_material_master</code></div><div className="uf-setting-row"><span>字段映射</span><strong>{draft.fields.length} 个字段</strong></div></div>{draft.fields.map(field => <div className="uf-setting-row" key={field.id}><span>{field.label}</span><code>{field.key}</code></div>)}</>}
    </Drawer>
    <Modal centered title="重置本原型？" open={resetOpen} okText="重置体验" onCancel={() => setResetOpen(false)} onOk={() => {
      const original = clone(initialDesign);
      const originalVersions = [{ version: 1, title: '初始示例版本', time: '原型初始配置', design: clone(original) }];
      if (!saveLocal({ draft: original, published: original, version: 1, versions: originalVersions })) return;
      setDraft(original); setSaved(clone(original)); setPublished(clone(original)); setVersion(1); setVersions(originalVersions);
      setUndoStack([]); setRedoStack([]); setValues({ ...startingValues }); setErrors({}); setSelectedId('material-name');
      setMode('design'); setPreviewDraft(false); setPanel(null); setResetOpen(false); message.success('已恢复初始体验');
    }}><p>将清除本原型中的示例版本和页面修改，恢复初始体验。实际业务页面不受影响。</p></Modal>
  </div>;
}
