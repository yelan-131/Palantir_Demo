import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRightOutlined, BellOutlined, CheckOutlined, ClockCircleOutlined, FormOutlined, AppstoreOutlined,
  ReloadOutlined, SearchOutlined, StarFilled, StarOutlined, HistoryOutlined, FieldTimeOutlined,
} from '@ant-design/icons';
import { Alert, Button, Drawer, Empty, Input, Segmented, Skeleton, Tooltip, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import { wfListBusinessItems } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { APPROVAL_NOTIFICATIONS_CHANGED } from '@/components/NotificationCenter';
import { formatServerShortDateTime } from '@/utils/dateTime';
import { itemTime, workspaceGroups, workspaceItemRoute, workspaceOverview, workspaceStatus, type WorkspaceItem } from './workspaceData';
import './style.css';

interface BusinessForm {
  id: number; code: string; name: string; route_path?: string;
  approval_configured?: boolean; can_create?: boolean;
}
type FormFilter = 'all' | 'favorites' | 'approval' | 'direct' | 'readonly';
const formKey = (form: BusinessForm) => form.code || String(form.id);
const submissionMode = (form: BusinessForm) => form.can_create === false ? 'readonly' : form.approval_configured ? 'approval' : 'direct';
const modeLabels = { approval: '申请审批', direct: '普通填报', readonly: '查看表单' };
function readFavorites(key: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === 'string'))].slice(0, 500) : [];
  } catch { return []; }
}
function readFocus(key: string) { try { return localStorage.getItem(key) || ''; } catch { return ''; } }
const fieldValue = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:/.test(value) ? formatServerShortDateTime(value) : typeof value === 'object' ? JSON.stringify(value) : String(value);
const itemLabel = (item: WorkspaceItem) => item.form?.name || item.application?.name || '业务申请';
const displayNode = (item: WorkspaceItem) => item.current_node && !/^[\s?？—-]+$/.test(item.current_node) && !['表单记录', '流程中'].includes(item.current_node) ? item.current_node : '';
const itemDate = (item: WorkspaceItem) => formatServerShortDateTime(item.updated_at || item.created_at, '更新时间未知');

export default function WorkspacePage() {
  const navigate = useNavigate();
  const user = useAuthStore(state => state.user);
  const scope = `${user?.tenant_id ?? 'default'}:${user?.id ?? 'anonymous'}`;
  const favoriteKey = `mf_workspace_favorites_${scope}`;
  const focusKey = `mf_workspace_focus_${scope}`;
  const [focus, setFocus] = useState(() => ({ key: focusKey, id: readFocus(focusKey) }));
  const [forms, setForms] = useState<BusinessForm[]>([]);
  const [items, setItems] = useState<WorkspaceItem[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [hasData, setHasData] = useState(false);
  const [refreshing, setRefreshing] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [filter, setFilter] = useState<FormFilter>('all');
  const [recentFilter, setRecentFilter] = useState('all');
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [unfinishedExpanded, setUnfinishedExpanded] = useState(false);
  const [favoriteState, setFavoriteState] = useState(() => ({ key: favoriteKey, ids: readFavorites(favoriteKey) }));
  const favorites = useMemo(() => favoriteState.key === favoriteKey ? favoriteState.ids : readFavorites(favoriteKey), [favoriteState, favoriteKey]);
  const requestId = useRef(0);
  const heroHeading = useRef<HTMLHeadingElement>(null);


  const loadWorkbench = useCallback(async () => {
    const current = ++requestId.current;
    setRefreshing(true);
    try {
      const response = await wfListBusinessItems();
      if (current !== requestId.current) return;
      const payload = response.data?.data || {};
      const nextCounts: Record<string, number> = {};
      for (const key of ['pending', 'initiated', 'processed']) {
        const value = Number(payload.view_counts?.[key]);
        nextCounts[key] = Number.isFinite(value) && value >= 0 ? value : 0;
      }
      setForms(Array.isArray(payload.forms) ? payload.forms : []);
      setItems(Array.isArray(payload.items) ? payload.items : []);
      setCounts(nextCounts); setHasData(true); setLoadError(false);
    } catch { if (current === requestId.current) setLoadError(true); }
    finally { if (current === requestId.current) setRefreshing(false); }
  }, []);

  useEffect(() => {
    setForms([]); setItems([]); setCounts({}); setHasData(false); setLoadError(false);
    setKeyword(''); setFilter('all'); setRecentFilter('all'); setCatalogOpen(false); setActivityOpen(false); setUnfinishedExpanded(false);
    void loadWorkbench();
    return () => { requestId.current += 1; };
  }, [scope, loadWorkbench]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === focusKey || event.key === null) setFocus({ key: focusKey, id: readFocus(focusKey) });
      if (event.key === favoriteKey || event.key === null) setFavoriteState({ key: favoriteKey, ids: readFavorites(favoriteKey) });
    };
    const refresh = () => { void loadWorkbench(); };
    window.addEventListener('storage', sync);
    window.addEventListener(APPROVAL_NOTIFICATIONS_CHANGED, refresh);
    return () => { window.removeEventListener('storage', sync); window.removeEventListener(APPROVAL_NOTIFICATIONS_CHANGED, refresh); };
  }, [favoriteKey, focusKey, loadWorkbench]);

  const statusLabel = (item: WorkspaceItem) => item.status === 'draft' && forms.some(form => form.id === item.form?.id && !form.approval_configured) ? '已保存' : workspaceStatus[item.status] || item.status;
  const groups = useMemo(() => workspaceGroups(items, forms), [items, forms]);
  const latestWork = useMemo(() => [...items].sort((a, b) => itemTime(b) - itemTime(a))[0], [items]);
  const overview = workspaceOverview(items);
  const focusId = focus.key === focusKey ? focus.id : readFocus(focusKey);
  const current = groups.unfinished.find(item => item.id === focusId) || groups.unfinished[0] || groups.waiting[0];
  const isUnfinished = Boolean(current && groups.unfinished.some(item => item.id === current.id));
  const others = groups.unfinished.filter(item => item.id !== current?.id);
  const savedFields = current?.fields?.filter(field => field.value !== null && field.value !== undefined && field.value !== '') || [];
  const step = isUnfinished ? 0 : 1;
  const selectCurrent = (item: WorkspaceItem) => {
    setFocus({ key: focusKey, id: item.id });
    try { localStorage.setItem(focusKey, item.id); } catch { message.warning('当前选择已生效，浏览器暂时无法保存'); }
    requestAnimationFrame(() => heroHeading.current?.focus({ preventScroll: true }));
  };
  const recent = groups.recent.filter(item => item.id !== current?.id && (recentFilter === 'all' || item.views?.includes(recentFilter)));
  const waiting = groups.waiting.filter(item => item.id !== current?.id).slice(0, 2);
  const showCatalog = () => setCatalogOpen(true);
  const openItem = (item: WorkspaceItem, view: 'initiated' | 'pending' = 'initiated') => navigate(workspaceItemRoute(item, view));
  const toggleFavorite = (form: BusinessForm) => {
    const id = formKey(form);
    const next = favorites.includes(id) ? favorites.filter(value => value !== id) : [...favorites, id];
    setFavoriteState({ key: favoriteKey, ids: next });
    try { localStorage.setItem(favoriteKey, JSON.stringify(next)); }
    catch { message.warning('常用已在当前页面生效，浏览器暂时无法保存偏好'); }
  };
  const filteredForms = useMemo(() => {
    const query = keyword.trim().toLocaleLowerCase();
    return forms.filter(form => (filter === 'all' || filter === 'favorites' && favorites.includes(formKey(form)) || submissionMode(form) === filter)
      && (!query || `${form.name} ${form.code}`.toLocaleLowerCase().includes(query)))
      .sort((a, b) => Number(favorites.includes(formKey(b))) - Number(favorites.includes(formKey(a))));
  }, [forms, keyword, filter, favorites]);
  const filterOptions = [{ value: 'all', label: '全部' }, { value: 'favorites', label: '常用' }, { value: 'approval', label: '申请审批' }, { value: 'direct', label: '普通填报' },
    ...(forms.some(form => form.can_create === false) ? [{ value: 'readonly', label: '仅查看' }] : [])];
  const formCards = (list: BusinessForm[]) => <div className="wh-form-grid">{list.map(form => <div className="wh-form-card" key={form.id}>
    <button className="wh-form-entry" type="button" onClick={() => navigate(form.route_path || `/program/${encodeURIComponent(form.code)}`)}>
      <span className="wh-icon"><FormOutlined /></span><span><strong>{form.name}</strong><small>{modeLabels[submissionMode(form)]}</small></span>
    </button><Tooltip title={favorites.includes(formKey(form)) ? '取消常用' : '设为常用'}><Button type="text" size="small" className={favorites.includes(formKey(form)) ? 'wh-star active' : 'wh-star'}
      icon={favorites.includes(formKey(form)) ? <StarFilled /> : <StarOutlined />} aria-label={`${favorites.includes(formKey(form)) ? '取消常用' : '设为常用'}：${form.name}`} aria-pressed={favorites.includes(formKey(form))} onClick={() => toggleFavorite(form)} /></Tooltip>
  </div>)}</div>;

  return <div className="workspace-home wh-page">
    <header className="wh-intro"><div><h1>让工作，从这里有序开始</h1><p>接续未完成的事项，掌握进展，快速开启下一项工作。</p></div><div className="wh-intro-actions">
      <Tooltip title="刷新首页数据"><Button type="text" icon={<ReloadOutlined />} loading={refreshing} onClick={() => void loadWorkbench()} aria-label="刷新首页数据" /></Tooltip>
    </div></header>
    {loadError && <Alert type="warning" showIcon message={hasData ? '刷新失败，当前显示上次成功加载的数据' : '首页数据加载失败，请重试'} action={<Button size="small" loading={refreshing} onClick={() => void loadWorkbench()}>重试</Button>} />}
    {!hasData && refreshing ? <Skeleton active paragraph={{ rows: 9 }} /> : hasData && <>
      <nav className="wh-entry-overview" aria-label="工作空间快捷入口">
        <button type="button" className="wh-entry-metric wh-entry-activity" onClick={() => setActivityOpen(true)}>
          <span className="wh-entry-metric-top"><span>近 7 日更新</span><span className="wh-entry-metric-icon"><HistoryOutlined /></span></span>
          <span className="wh-entry-metric-value">{overview.recentUpdates.length}<small>条记录</small></span>
          <span className="wh-entry-metric-footer"><span>与我相关的工作动态</span><span>查看动态 <ArrowRightOutlined /></span></span>
        </button>
        <button type="button" className="wh-entry-metric wh-entry-attention" disabled={!overview.oldestWaiting} onClick={() => overview.oldestWaiting && openItem(overview.oldestWaiting)}>
          <span className="wh-entry-metric-top"><span>最久未更新的申请</span><span className="wh-entry-metric-icon"><FieldTimeOutlined /></span></span>
          <span className="wh-entry-metric-value">{overview.oldestWaiting ? overview.unchangedDays === 0 ? '不足 1' : overview.unchangedDays : '—'}<small>{overview.oldestWaiting ? '天未更新' : '暂无流转中的申请'}</small></span>
          <span className="wh-entry-metric-footer"><span title={overview.oldestWaiting?.title}>{overview.oldestWaiting?.title || '申请提交后可在这里跟进'}</span><span>{overview.oldestWaiting ? '查看进展' : '暂无记录'} <ArrowRightOutlined /></span></span>
        </button>
        <button type="button" className="wh-entry-metric wh-entry-latest" disabled={!latestWork} onClick={() => latestWork && openItem(latestWork, latestWork.views?.includes('pending') ? 'pending' : 'initiated')}>
          <span className="wh-entry-metric-top"><span>最近一次工作</span><span className="wh-entry-metric-icon"><ClockCircleOutlined /></span></span>
          <span className="wh-entry-metric-value wh-entry-metric-date">{latestWork ? itemDate(latestWork) : '暂无记录'}</span>
          <span className="wh-entry-metric-footer"><span title={latestWork?.title}>{latestWork ? latestWork.title : '开始工作后在这里接续'}</span><span>{latestWork ? '打开记录' : '等待更新'} <ArrowRightOutlined /></span></span>
        </button>
      </nav>
      <div className="wh-dashboard-grid"><div className="wh-dashboard-column">
        <div className="wh-feature-group">
          <article className="wh-feature" aria-labelledby="wh-current-title">
            <div className="wh-feature-head"><span className="wh-icon"><FormOutlined /></span><strong>{isUnfinished ? '继续工作' : current ? '继续跟进' : '我的工作'}</strong>
              {groups.unfinished.length > 0 && <small>{groups.unfinished.length} 项未完成</small>}{current && <span className={`wh-status ${current.status}`}>{statusLabel(current)}</span>}
            </div>
            <h2 title={current?.title} id="wh-current-title" ref={heroHeading} tabIndex={-1}>{current?.title || '当前没有未完成的申请'}</h2>
            <p className="wh-feature-context">{current ? <>{itemLabel(current)}<span>更新于 {itemDate(current)}</span></> : '从下方业务表单开始新工作，已提交的申请可在右侧跟进。'}</p>
            {current && <>
              <ol className="wh-steps" aria-label="申请阶段">{['填写信息', '提交审核', '审核完成'].map((label, i) => <li key={label} className={i === step ? 'current' : i < step ? 'done' : ''} aria-current={i === step ? 'step' : undefined}><span>{i < step ? <CheckOutlined /> : i + 1}</span>{label}</li>)}</ol>
              <div className="wh-context-note"><span>{isUnfinished ? '下一步' : '当前进展'}</span><strong>{isUnfinished ? current.status === 'returned' ? '查看退回意见，修改后重新提交' : '继续完善申请，确认后提交审核' : displayNode(current) || '申请正在审核中，可查看流转详情'}</strong></div>
              {savedFields.length > 0 && <div className="wh-snapshot">{savedFields.slice(0, 2).map((field, i) => <span key={`${field.label}-${i}`}><small>{field.label}</small><strong title={fieldValue(field.value)}>{fieldValue(field.value)}</strong></span>)}</div>}
            </>}
            <footer className="wh-feature-footer"><span><ClockCircleOutlined />{current ? isUnfinished ? '已保存的内容会在业务记录中恢复' : '审核期间可查看申请记录与流程' : '按当前账号权限展示可用业务入口'}</span>
              <Button type="primary" icon={<ArrowRightOutlined />} onClick={() => current ? openItem(current) : showCatalog()}>{current ? isUnfinished ? current.status === 'returned' ? '查看并修改' : '继续填写' : '查看进展' : '浏览业务表单'}</Button>
            </footer>
          </article>
          {others.length > 0 && <section className="wh-queue" aria-labelledby="wh-other-title">
            <div className="wh-section-head"><h2 id="wh-other-title">其他未完成工作 <span className="wh-count">{others.length}</span></h2><small>点击切换主卡片</small></div>
            <div className="wh-queue-list">{(unfinishedExpanded ? others : others.slice(0, 4)).map(item => <button type="button" key={item.id} onClick={() => selectCurrent(item)} aria-label={`切换到${item.title}`}><span className="wh-icon"><FormOutlined /></span><span><strong>{item.title}</strong><small>{itemLabel(item)} · {workspaceStatus[item.status]}</small></span><ArrowRightOutlined /></button>)}</div>
            {others.length > 4 && <Button type="link" size="small" onClick={() => setUnfinishedExpanded(value => !value)}>{unfinishedExpanded ? '收起列表' : '展开全部未完成工作'}</Button>}
          </section>}
        </div>
        <section className="wh-panel wh-recent-panel" aria-labelledby="wh-recent-title"><div className="wh-section-head"><h2 id="wh-recent-title"><ClockCircleOutlined /> 最近工作 <small>按更新时间</small></h2><Segmented size="small" aria-label="筛选最近工作" value={recentFilter} onChange={value => setRecentFilter(String(value))} options={[{ label: '全部', value: 'all' }, { label: '我发起的', value: 'initiated' }, { label: '我已处理的', value: 'processed' }]} /></div>
        {recent.length ? <div className="wh-recent-list">{recent.slice(0, 5).map(item => <button type="button" key={item.id} className="wh-recent-item" onClick={() => openItem(item, item.views?.includes('pending') ? 'pending' : 'initiated')}><span className="wh-icon"><FormOutlined /></span><span className="wh-recent-info"><strong>{item.title}</strong><small>{itemLabel(item)}</small></span><span className="wh-recent-end"><span className={`wh-status ${item.status}`}>{statusLabel(item)}</span><time>{itemDate(item)}</time></span><ArrowRightOutlined /></button>)}</div> : <div className="wh-recent-empty"><ClockCircleOutlined /><span>暂无其他工作记录</span><small>未完成的申请已收在上方，随时可以继续。</small></div>}
        <footer className="wh-panel-footer"><Button type="link" size="small" onClick={() => navigate(`/workflow?tab=${recentFilter === 'processed' ? 'processed' : 'initiated'}`)}>查看全部记录 <ArrowRightOutlined /></Button><small>未完成工作已收在上方</small></footer>
      </section>
      </div><div className="wh-dashboard-column">
        <aside className="wh-support">
          <section><div className="wh-section-head"><h2>需要我处理 <span className="wh-count">{counts.pending ?? 0}</span></h2><Button type="link" size="small" onClick={() => navigate('/workflow?tab=pending')}>全部 <ArrowRightOutlined /></Button></div>
            {groups.pending.length ? groups.pending.slice(0, 2).map(item => <button type="button" key={item.id} className="wh-side-item" onClick={() => openItem(item, 'pending')}><span className="wh-icon"><BellOutlined /></span><span><strong>{item.title}</strong><small>{itemLabel(item)} · {statusLabel(item)}</small></span><ArrowRightOutlined /></button>) : <div className="wh-quiet"><CheckOutlined /><span>暂时没有需要处理的审批<small>新事项会在这里显示</small></span></div>}
          </section>
          <section className="wh-waiting"><div className="wh-section-head"><h2>我发起的 <span className="wh-count">{counts.initiated ?? 0}</span></h2><Button type="link" size="small" onClick={() => navigate('/workflow?tab=initiated')}>全部 <ArrowRightOutlined /></Button></div><p>等待流转，无需重复操作</p>
            {waiting.length ? waiting.map(item => <button className="wh-side-item" type="button" key={item.id} onClick={() => openItem(item)}><span className="wh-dot" /><span><strong>{item.title}</strong><small>{displayNode(item) || statusLabel(item)}</small></span><ArrowRightOutlined /></button>) : <div className="wh-side-empty">暂无审核中的申请</div>}
          </section>
          <button className="wh-processed" type="button" onClick={() => navigate('/workflow?tab=processed')}><span><CheckOutlined /> 我已处理的</span><strong>{counts.processed ?? 0}</strong><ArrowRightOutlined /></button>
        </aside>
      <section className="wh-panel wh-forms-panel" aria-labelledby="wh-forms-title" ><div className="wh-section-head"><h2 id="wh-forms-title"><AppstoreOutlined /> 业务表单</h2><Button type="link" size="small" onClick={showCatalog}>查看全部 <ArrowRightOutlined /></Button></div>
        <div className="wh-form-toolbar"><Segmented size="small" aria-label="按提交方式筛选表单" value={filter} options={filterOptions} onChange={value => setFilter(value as FormFilter)} /><Input prefix={<SearchOutlined />} allowClear placeholder="搜索表单名称或编码" aria-label="搜索业务表单" value={keyword} maxLength={100} onChange={event => setKeyword(event.target.value)} /></div>
        {filteredForms.length ? formCards(filteredForms.slice(0, 6)) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={filter === 'favorites' && !keyword ? '还没有常用表单，点击星标即可收藏' : '没有匹配的业务表单'}><Button size="small" onClick={() => { setKeyword(''); setFilter('all'); }}>查看全部表单</Button></Empty>}
        <footer className="wh-panel-footer"><small>星标固定常用入口 · {filteredForms.length > 6 ? `显示前 6 个，共 ${filteredForms.length} 个` : `${filteredForms.length} 个表单`}</small>{filteredForms.length > 6 && <Button type="link" size="small" onClick={showCatalog}>展开全部表单 <ArrowRightOutlined /></Button>}</footer>
      </section>
      </div></div>
    </>}
    <Drawer title="近 7 日工作动态" open={activityOpen} onClose={() => setActivityOpen(false)} width={680} rootClassName="wh-activity-drawer">
      <p className="wh-catalog-copy">近 7 天有更新的记录 · 按最近更新时间排序，同一记录仅计一次。</p>
      {overview.recentUpdates.length ? <div className="wh-recent-list">{overview.recentUpdates.map(item => <button type="button" key={item.id} className="wh-recent-item" onClick={() => openItem(item, item.views?.includes('pending') ? 'pending' : 'initiated')}><span className="wh-icon"><FormOutlined /></span><span className="wh-recent-info"><strong title={item.title}>{item.title}</strong><small>{itemLabel(item)}</small></span><span className="wh-recent-end"><span className={`wh-status ${item.status}`}>{statusLabel(item)}</span><time>{itemDate(item)}</time></span><ArrowRightOutlined /></button>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="近 7 天暂无更新记录" />}
    </Drawer>
    <Drawer title={filter === 'favorites' ? '常用业务表单' : '业务表单'} open={catalogOpen} onClose={() => setCatalogOpen(false)} width={680} rootClassName="wh-catalog-drawer"><p className="wh-catalog-copy">选择业务表单，进入对应页面填写或查看。星标可固定常用入口。</p><div className="wh-form-toolbar"><Segmented aria-label="筛选业务入口" value={filter} options={filterOptions} onChange={value => setFilter(value as FormFilter)} /><Input prefix={<SearchOutlined />} allowClear placeholder="搜索表单名称或编码" aria-label="搜索全部业务表单" value={keyword} onChange={event => setKeyword(event.target.value)} maxLength={100} /></div>{filteredForms.length ? formCards(filteredForms) : <Empty description={filter === 'favorites' && !keyword ? '还没有常用表单，点击星标即可收藏' : '没有匹配的业务表单'} />}</Drawer>
  </div>;
}
