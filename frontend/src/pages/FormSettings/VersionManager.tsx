import './designer-dialog.css';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Drawer, Empty, Input, Modal, Segmented, Spin, Tag } from 'antd';
import { ArrowRightOutlined, CheckCircleOutlined, FileTextOutlined, HistoryOutlined, ReloadOutlined, SaveOutlined, SearchOutlined, UndoOutlined } from '@ant-design/icons';
import { listPlatformFormVersions, type PlatformForm, type PlatformFormVersion } from '@/services/api';
import { compareVersions, filterVersions, formatVersionTime, getVersionFields, sortVersions } from './versionUtils';
import './version-manager.css';

interface Props {
  open: boolean;
  form: PlatformForm | null;
  name: string;
  hasUnsavedChanges: boolean;
  draftStatus?: string;
  savedAt?: string;
  busy: boolean;
  loadError?: string;
  onClose: () => void;
  onEdit: () => void;
  onSave: () => Promise<boolean>;
  onPublish: () => Promise<boolean>;
  onRestore: () => Promise<boolean>;
}

export default function VersionManager(props: Props) {
  const { open, form, name, hasUnsavedChanges, draftStatus, savedAt, busy, loadError } = props;
  const [versions, setVersions] = useState<PlatformFormVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [action, setAction] = useState<'save' | 'publish' | 'restore' | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const [detailTab, setDetailTab] = useState('fields');
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const request = useRef(0);
  const actionLock = useRef(false);

  useEffect(() => {
    if (!open) return;
    setSelected(null);
    setQuery('');
    setActionError('');
    setConfirmRestore(false);
  }, [open, form?.id]);

  useEffect(() => {
    const epoch = ++request.current;
    if (!open) return;
    setError('');
    setVersions([]);
    if (!form?.id) { setLoading(false); return; }
    setLoading(true);
    listPlatformFormVersions(form.id).then(response => {
      if (request.current !== epoch) return;
      setVersions(sortVersions(response.data?.data || []));
    }).catch(() => {
      if (request.current === epoch) setError('发布记录加载失败，请重试。');
    }).finally(() => { if (request.current === epoch) setLoading(false); });
    return () => { request.current += 1; };
  }, [open, form?.id, refreshKey]);

  const latest = versions.find(item => ['published', 'active'].includes(item.status));
  const selectedVersion = versions.find(item => item.version === selected);
  const selectedIndex = versions.findIndex(item => item.version === selected);
  const previous = selectedIndex >= 0 ? versions[selectedIndex + 1] : undefined;
  const pending = hasUnsavedChanges || draftStatus === 'draft' || !latest;
  const unavailable = busy || Boolean(action);
  const cannotPersist = unavailable || Boolean(loadError);
  const status = hasUnsavedChanges ? '未保存' : loading || error ? '已保存' : pending ? '待发布' : '已同步';
  const filtered = filterVersions(versions, query);
  const fields = selectedVersion ? getVersionFields(selectedVersion.snapshot) : [];
  const changes = selectedVersion ? compareVersions(selectedVersion.snapshot, previous?.snapshot) : null;
  const hasRecordedChecks = Boolean(selectedVersion && Array.isArray(selectedVersion.impact_report?.items));
  const reportItems = selectedVersion && Array.isArray(selectedVersion.impact_report?.items)
    ? selectedVersion.impact_report.items as Array<{ level?: string; label?: string; type?: string; detail?: string }>
    : [];

  const runAction = async (kind: 'save' | 'publish' | 'restore') => {
    if (unavailable || actionLock.current || (kind !== 'restore' && loadError)) return;
    actionLock.current = true;
    setAction(kind);
    setActionError('');
    try {
      const ok = await (kind === 'save' ? props.onSave() : kind === 'publish' ? props.onPublish() : props.onRestore());
      if (!ok) { setActionError(kind === 'save' ? '保存未完成，当前修改仍保留在编辑器中。' : kind === 'publish' ? '发布检查未完成，当前修改仍保留，请重试。' : '未能重置草稿，请重试。'); return; }
      if (kind === 'publish') props.onClose();
      if (kind === 'restore') { setConfirmRestore(false); setRefreshKey(key => key + 1); }
    } catch {
      setActionError('操作未完成，请检查网络后重试。');
    } finally {
      actionLock.current = false;
      setAction(null);
    }
  };

  return <>
    <Drawer open={open} onClose={() => { if (!action) props.onClose(); }} width={960}
      rootClassName="form-version-workbench" title={<div className="vm-heading"><HistoryOutlined /><div><strong>版本管理</strong><span>{name}</span></div></div>}
      extra={<Button type="text" onClick={props.onEdit} disabled={Boolean(action)}>返回编辑器 <ArrowRightOutlined /></Button>}>
      <div className="vm-workspace">
        <section className="vm-draft">
          <div className="vm-section-eyebrow"><span>工作草稿</span><Tag className={`vm-state vm-state-${hasUnsavedChanges ? 'warning' : 'neutral'}`}>{status}</Tag></div>
          <div className="vm-draft-main">
            <div><h2>{hasUnsavedChanges ? '有修改尚未保存' : pending && !loading && !error ? '准备下一次发布' : '当前配置已保存'}</h2>
              <p>{hasUnsavedChanges ? '发布前会先保存完整草稿，再检查并确认发布。' : loading || error ? '保存草稿后，可进入发布检查。' : !latest ? '首次发布后，业务页面将使用这份配置。' : pending ? `草稿已保存，线上仍使用 v${latest.version}。` : `与线上 v${latest.version} 保持同步。继续编辑后可发布新版本。`}</p>
              <span className="vm-saved-time">最近保存 · {formatVersionTime(savedAt)}</span>
            </div>
            <div className="vm-draft-actions">
              <Button icon={<SaveOutlined />} loading={action === 'save'} disabled={cannotPersist || (!hasUnsavedChanges && Boolean(form))} onClick={() => void runAction('save')}>保存草稿</Button>
              <Button type="primary" icon={<ArrowRightOutlined />} loading={action === 'publish'} disabled={cannotPersist || loading || Boolean(error) || !pending} onClick={() => void runAction('publish')}>检查并发布</Button>
            </div>
          </div>
          {latest && !loading && !error && <div className="vm-draft-foot"><span><CheckCircleOutlined /> 线上版本 v{latest.version} · {formatVersionTime(latest.published_at)}</span>
            <Button type="text" icon={<UndoOutlined />} disabled={unavailable || (!pending && !loadError)} onClick={() => setConfirmRestore(true)}>用线上配置重置草稿</Button></div>}
        </section>
        {(loadError || actionError) && <Alert type="error" showIcon message={loadError || actionError} />}

        <section className="vm-history">
          <div className="vm-history-head"><div><h3>发布记录 <span>{versions.length}</span></h3><p>每次发布保留一份配置快照</p></div>
            <div className="vm-history-tools"><Input prefix={<SearchOutlined />} aria-label="搜索版本号" placeholder="搜索版本号" allowClear value={query} onChange={event => { setQuery(event.target.value); setSelected(null); }} disabled={loading || Boolean(error)} />
              <Button icon={<ReloadOutlined />} aria-label="刷新发布记录" title="刷新发布记录" disabled={loading || unavailable} onClick={() => { setSelected(null); setRefreshKey(key => key + 1); }} /></div>
          </div>
          {loading ? <div className="vm-feedback"><Spin /><span>正在读取发布记录</span></div> : error ? <div className="vm-feedback"><Alert type="error" showIcon message={error} /><Button onClick={() => setRefreshKey(key => key + 1)}>重新加载</Button></div> : !versions.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚无发布记录，首次发布后会显示在这里" /> : !filtered.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的版本号"><Button onClick={() => setQuery('')}>清除搜索</Button></Empty> : <div className="vm-records">
            <div className="vm-record-columns"><span>版本</span><span>发布时间</span><span>状态</span><span /></div>
            {filtered.map(item => <button key={item.id} className={`vm-record ${selected === item.version ? 'is-selected' : ''}`} aria-expanded={selected === item.version} onClick={() => { setSelected(selected === item.version ? null : item.version); setDetailTab('fields'); }}>
              <span className="vm-record-version"><FileTextOutlined /><strong>v{item.version}</strong></span><time>{formatVersionTime(item.published_at)}</time>
              <span><Tag className={`vm-state ${item.version === latest?.version ? 'vm-state-live' : 'vm-state-neutral'}`}>{item.version === latest?.version ? '线上生效' : '历史版本'}</Tag></span><span className="vm-record-link">{selected === item.version ? '收起详情' : '查看详情'} <ArrowRightOutlined /></span>
            </button>)}
          </div>}
        </section>

        {selectedVersion && !loading && !error && <section className="vm-detail">
          <div className="vm-detail-head"><div><span className="vm-section-eyebrow">只读快照</span><h3>v{selectedVersion.version} <span>发布详情</span></h3><p>{formatVersionTime(selectedVersion.published_at)}</p></div><Button type="text" onClick={() => setSelected(null)}>收起详情</Button></div>
          <Segmented block value={detailTab} onChange={value => setDetailTab(String(value))} options={[{ label: `表单字段 · ${fields.length}`, value: 'fields' }, { label: '版本变更', value: 'changes' }, { label: '发布时检查', value: 'checks' }]} />
          {detailTab === 'fields' && <div className="vm-field-table">
            <div className="vm-field-header"><span>字段名称</span><span>字段标识</span><span>类型</span><span>必填</span></div>
            {fields.map(field => <div className="vm-field-row" key={field.key}><strong>{field.name}</strong><span>{field.key}</span><span>{field.type}</span><span>{field.required ? '必填' : '—'}</span></div>)}
            {!fields.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="此版本没有记录字段快照" />}
          </div>}
          {detailTab === 'changes' && <div className="vm-changes">
            <p>{previous ? `与上一次发布 v${previous.version} 比较` : '这是首个发布快照，没有更早的版本可比较。'}</p>
            {/* Change summaries are calculated from the two saved snapshots. */}
            {previous && changes && <div className="vm-change-list">{changes.map(change => <div className="vm-change-row" key={change.key}><div><strong>{change.label}</strong><Tag className={`vm-state ${change.changed ? 'vm-state-warning' : 'vm-state-neutral'}`}>{change.changed ? '有变更' : '未变更'}</Tag></div><p>{Array.isArray(change.details) ? change.details.join('；') : change.details}</p></div>)}</div>}
          </div>}
          {detailTab === 'checks' && <div className="vm-checks"><p>记录发布当时的检查结果</p>{reportItems.length ? reportItems.map((item, index) => <div className="vm-check-row" key={index}><Tag className={`vm-state ${item.level === 'blocking' ? 'vm-state-error' : item.level === 'warning' ? 'vm-state-warning' : 'vm-state-neutral'}`}>{item.level === 'warning' ? '提醒' : item.level === 'blocking' ? '阻断' : '信息'}</Tag><div><strong>{item.label || item.type || '配置检查'}</strong><p>{item.detail}</p></div></div>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={hasRecordedChecks ? '当时的检查未发现配置影响项' : '此版本未记录检查明细'} />}</div>}
        </section>}
      </div>
    </Drawer>
    <Modal className="form-designer-dialog" centered open={confirmRestore} title="用线上配置重置草稿？" okText="确认重置草稿" cancelText="继续保留草稿" confirmLoading={action === 'restore'} okButtonProps={{ danger: true, disabled: busy }} cancelButtonProps={{ disabled: action === 'restore' }} closable={action !== 'restore'} maskClosable={false} onCancel={() => setConfirmRestore(false)} onOk={() => runAction('restore')}>
      <p>将使用线上版本 v{latest?.version} 的表单布局、数据视图、权限及流程关联配置覆盖当前设计草稿，同时恢复字段默认值。</p>
      <p>{hasUnsavedChanges ? '当前未保存的修改也会被替换。' : '当前已保存但未发布的配置会被替换。'}重置后可继续编辑，再发布为新版本。</p>
      <Alert type="info" showIcon message="线上页面与业务数据保持不变" />
      {actionError && <Alert type="error" message={actionError} style={{ marginTop: 12 }} />}
    </Modal>
  </>;
}
