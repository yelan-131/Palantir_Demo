import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Input } from 'antd';
import type { InputRef } from 'antd';
import {
  AppstoreOutlined,
  CloseCircleFilled,
  FileTextOutlined,
  HomeOutlined,
  LoadingOutlined,
  SearchOutlined,
  SettingOutlined,
} from '@/components/Icon/ant';
import { useLocation, useNavigate } from 'react-router-dom';
import { settingsNavigationGroups, visibleNavigationEntries } from '../../config/navigation';
import { listApplicationMenus, listApplications } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import { UI_SCALE } from '../../theme/cards';
import './style.css';

type GroupKey = 'apps' | 'pages' | 'workspace' | 'settings';

interface SearchItem {
  key: string;
  title: string;
  path: string;
  group: GroupKey;
  to: string;
  state?: unknown;
  keywords?: string[];
}

interface MatchedItem extends SearchItem {
  rank: number;
  keyword?: string;
}

interface ApplicationInfo {
  id: number;
  name: string;
  default_route?: string;
}

interface ApplicationMenu {
  id: number;
  parent_id: number | null;
  title: string;
  route_path?: string;
  is_visible?: boolean;
  children?: ApplicationMenu[];
}

interface ApplicationIndex {
  apps: { app: ApplicationInfo; menus: ApplicationMenu[] | null }[];
  partial: boolean;
}

type IndexStatus = 'idle' | 'loading' | 'ready' | 'error';

const GROUPS: { key: GroupKey; label: string; icon: React.ReactNode }[] = [
  { key: 'apps', label: '应用', icon: <AppstoreOutlined /> },
  { key: 'pages', label: '页面与表单', icon: <FileTextOutlined /> },
  { key: 'workspace', label: '工作台', icon: <HomeOutlined /> },
  { key: 'settings', label: '设置中心', icon: <SettingOutlined /> },
];

/** Material requests live in the workflow center, matching the shell's application menus. */
const WORKFLOW_OWNED_ROUTES = ['/program/material-application', '/workflow?section=materials'];

/** Older names users still type for settings destinations. */
const SETTINGS_KEYWORDS: Record<string, string[]> = {
  '/data-center/assets': ['数据接入', '数据源', '连接管理', '资产目录', '同步', '管道'],
  '/data-center/objects': ['模型设计', '字段映射', '语义', '图谱', '本体'],
  '/data-center/reference': ['字典', '基础档案'],
  '/studio/applications': ['菜单', '页面设计', '表单设计'],
  '/admin/audit': ['日志'],
  '/admin/ai': ['模型'],
  '/account-center': ['密码', '个人信息'],
};

const IDENTITY_TABS = [
  { tab: 'users', title: '用户管理' },
  { tab: 'roles', title: '角色管理' },
  { tab: 'orgs', title: '组织管理' },
  { tab: 'tenants', title: '租户管理' },
];

const IS_MAC = (() => {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return /mac|iphone|ipad/i.test(nav.userAgentData?.platform || nav.platform || nav.userAgent);
})();
const SHORTCUT_LABEL = IS_MAC ? '⌘K' : 'Ctrl+K';

const ROOT_STYLE = {
  '--gs-focus-ring': 'color-mix(in srgb, var(--canon-focus) 20%, transparent)',
  '--gs-shadow': 'var(--ui-shadow-popover)',
  fontFamily: UI_SCALE.fontFamily,
} as React.CSSProperties;

let indexCache: { userId: number | string; promise: Promise<ApplicationIndex> } | null = null;

function loadApplicationIndex(userId: number | string, force = false): Promise<ApplicationIndex> {
  if (!force && indexCache?.userId === userId) return indexCache.promise;
  const promise = listApplications().then(async response => {
    const apps: ApplicationInfo[] = response.data?.data || [];
    const withMenus = await Promise.all(apps.map(app => listApplicationMenus(app.id)
      .then(menuResponse => ({ app, menus: (menuResponse.data?.data || []) as ApplicationMenu[] }))
      .catch(() => ({ app, menus: null }))));
    return { apps: withMenus, partial: withMenus.some(entry => entry.menus === null) };
  });
  indexCache = { userId, promise };
  promise.catch(() => { if (indexCache?.promise === promise) indexCache = null; });
  return promise;
}

function useApplicationIndex(userId: number | string | undefined) {
  const [status, setStatus] = useState<IndexStatus>('idle');
  const [data, setData] = useState<ApplicationIndex | null>(null);
  const request = useRef(0);

  const load = useCallback((force = false) => {
    if (userId === undefined) return;
    const current = ++request.current;
    setStatus('loading');
    loadApplicationIndex(userId, force)
      .then(result => { if (current === request.current) { setData(result); setStatus('ready'); } })
      .catch(() => { if (current === request.current) setStatus('error'); });
  }, [userId]);

  useEffect(() => { setStatus('idle'); setData(null); request.current += 1; }, [userId]);

  useEffect(() => {
    const invalidate = () => { indexCache = null; setStatus('idle'); };
    window.addEventListener('applications-changed', invalidate);
    return () => window.removeEventListener('applications-changed', invalidate);
  }, []);

  return { status, data, load };
}

function menuDestinations(app: ApplicationInfo, menus: ApplicationMenu[]): SearchItem[] {
  const items: SearchItem[] = [];
  const walk = (nodes: ApplicationMenu[], trail: string[]) => {
    for (const node of nodes) {
      if (node.is_visible === false) continue;
      const route = (node.route_path || '').split('#')[0].replace(/(.)\/$/, '$1');
      if (route && !WORKFLOW_OWNED_ROUTES.includes(route)) {
        items.push({ key: `page:${route}`, title: node.title, path: [app.name, ...trail].join(' / '), group: 'pages', to: route });
      }
      if (node.children?.length) walk(node.children, [...trail, node.title]);
    }
  };
  walk(menus, []);
  return items;
}

function firstRoute(menus: ApplicationMenu[] | null): string | undefined {
  for (const node of menus || []) {
    if (node.is_visible === false) continue;
    if (node.route_path && !WORKFLOW_OWNED_ROUTES.includes(node.route_path)) return node.route_path;
    const child = firstRoute(node.children || null);
    if (child) return child;
  }
  return undefined;
}

function buildIndex(isAdmin: boolean, applications: ApplicationIndex | null): SearchItem[] {
  const items: SearchItem[] = [];
  const storedAppId = Number(localStorage.getItem('mf_current_app_id'));
  const apps = applications?.apps || [];

  for (const { app, menus } of apps) {
    const to = app.default_route && app.default_route !== '/' ? app.default_route : firstRoute(menus);
    if (to) items.push({ key: `app:${app.id}`, title: app.name, path: '应用中心', group: 'apps', to });
  }
  const preferred = [...apps].sort((a, b) => Number(b.app.id === storedAppId) - Number(a.app.id === storedAppId));
  for (const { app, menus } of preferred) {
    if (menus) items.push(...menuDestinations(app, menus));
  }

  for (const entry of visibleNavigationEntries('business', isAdmin)) {
    items.push({ key: `nav:${entry.path}`, title: entry.label, path: '工作台', group: 'workspace', to: entry.path, state: entry.path === '/' ? { workspaceHome: true } : undefined });
  }
  items.push(
    { key: 'nav:/program/material-application', title: '料号申请', path: '工作台 / 流程与待办', group: 'workspace', to: '/program/material-application' },
    { key: 'nav:/more', title: '应用中心', path: '工作台', group: 'workspace', to: '/more' },
  );

  for (const group of settingsNavigationGroups(isAdmin)) {
    for (const entry of group.entries) {
      items.push({ key: `nav:${entry.path}`, title: entry.label, path: `设置中心 / ${group.label}`, group: 'settings', to: entry.path, keywords: SETTINGS_KEYWORDS[entry.path] });
      if (entry.path === '/admin/identity') {
        for (const tab of IDENTITY_TABS) {
          items.push({ key: `nav:/admin/identity?tab=${tab.tab}`, title: tab.title, path: `设置中心 / ${group.label} / ${entry.label}`, group: 'settings', to: `/admin/identity?tab=${tab.tab}` });
        }
      }
    }
  }

  const seen = new Set<string>();
  return items.filter(item => {
    const destination = item.group === 'apps' ? item.key : item.to;
    if (seen.has(destination)) return false;
    seen.add(destination);
    return true;
  });
}

function matchItems(items: SearchItem[], query: string): MatchedItem[] {
  const matched: MatchedItem[] = [];
  for (const item of items) {
    const title = item.title.toLowerCase();
    if (title.startsWith(query)) { matched.push({ ...item, rank: 0 }); continue; }
    if (title.includes(query)) { matched.push({ ...item, rank: 1 }); continue; }
    const keyword = item.keywords?.find(word => word.toLowerCase().includes(query));
    if (keyword) { matched.push({ ...item, rank: 2, keyword }); continue; }
    if (item.path.toLowerCase().includes(query)) matched.push({ ...item, rank: 3 });
  }
  return matched.sort((a, b) => a.rank - b.rank);
}

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const lower = text.toLowerCase();
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let found = lower.indexOf(query);
  while (found !== -1) {
    if (found > cursor) parts.push(text.slice(cursor, found));
    parts.push(<mark key={found}>{text.slice(found, found + query.length)}</mark>);
    cursor = found + query.length;
    found = lower.indexOf(query, cursor);
  }
  parts.push(text.slice(cursor));
  return <>{parts}</>;
}

export default function GlobalSearch() {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((state) => state.user);
  const isAdmin = Boolean(user?.is_admin);
  const inputRef = useRef<InputRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const { status, data, load } = useApplicationIndex(user?.id ?? user?.username);

  const open = useCallback(() => {
    setExpanded(true);
    if (status === 'idle') load();
  }, [status, load]);

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if ((IS_MAC ? event.metaKey : event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus({ cursor: 'all' });
        open();
      }
    };
    const outside = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setExpanded(false);
    };
    window.addEventListener('keydown', keyboard);
    document.addEventListener('pointerdown', outside);
    return () => {
      window.removeEventListener('keydown', keyboard);
      document.removeEventListener('pointerdown', outside);
    };
  }, [open]);

  useEffect(() => { setQuery(''); setExpanded(false); setActiveIndex(0); }, [location.pathname, location.search]);

  const index = useMemo(() => buildIndex(isAdmin, data), [isAdmin, data]);
  useEffect(() => { setActiveIndex(0); }, [index]);
  const normalizedQuery = query.trim().toLowerCase();
  const matches = useMemo(() => normalizedQuery ? matchItems(index, normalizedQuery) : [], [index, normalizedQuery]);
  const grouped = GROUPS
    .map(group => ({ ...group, items: matches.filter(item => item.group === group.key) }))
    .filter(group => group.items.length);
  const ordered = grouped.flatMap(group => group.items);

  const showResults = expanded && Boolean(normalizedQuery);
  const selectedIndex = Math.min(activeIndex, Math.max(0, ordered.length - 1));
  const optionId = (position: number) => `${listId}-option-${position}`;
  const activeOptionId = showResults && ordered.length ? optionId(selectedIndex) : undefined;

  useEffect(() => {
    const list = listRef.current;
    const selected = activeOptionId ? document.getElementById(activeOptionId) : null;
    if (!list || !selected) return;
    if (selectedIndex === 0) { list.scrollTop = 0; return; }
    const listBox = list.getBoundingClientRect();
    const optionBox = selected.getBoundingClientRect();
    if (optionBox.top < listBox.top) list.scrollTop -= listBox.top - optionBox.top;
    else if (optionBox.bottom > listBox.bottom) list.scrollTop += optionBox.bottom - listBox.bottom;
  }, [activeOptionId, selectedIndex]);

  const selectItem = (item: SearchItem) => {
    setExpanded(false);
    setQuery('');
    inputRef.current?.blur();
    navigate(item.to, item.state ? { state: item.state } : undefined);
  };

  const loading = status === 'loading' || status === 'idle';
  const statusMessage = status === 'error'
    ? '应用和页面暂时无法加载，当前只显示工作台和设置入口。'
    : status === 'ready' && data?.partial ? '部分应用的页面未能加载。' : '';
  const announcement = !showResults ? ''
    : ordered.length ? `找到 ${ordered.length} 个结果`
    : loading ? '正在加载应用和页面' : `没有找到“${query.trim()}”相关的应用或页面`;
  let position = -1;

  return <div className="shell-inline-search gs-root" ref={containerRef} style={ROOT_STYLE}>
    <Input
      ref={inputRef}
      className="gs-input"
      prefix={<SearchOutlined aria-hidden />}
      suffix={query ? undefined : <kbd className="gs-kbd gs-kbd-hint" aria-hidden>{SHORTCUT_LABEL}</kbd>}
      placeholder="搜索应用、页面或表单"
      aria-label={`搜索应用、页面或表单，快捷键 ${SHORTCUT_LABEL}`}
      role="combobox"
      aria-autocomplete="list"
      aria-haspopup="listbox"
      aria-expanded={showResults}
      aria-controls={showResults ? listId : undefined}
      aria-activedescendant={activeOptionId}
      value={query}
      allowClear={{ clearIcon: <CloseCircleFilled aria-label="清除搜索内容" /> }}
      autoComplete="off"
      spellCheck={false}
      onFocus={open}
      onBlur={event => { if (!containerRef.current?.contains(event.relatedTarget)) setExpanded(false); }}
      onChange={event => { setQuery(event.target.value); setActiveIndex(0); open(); }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          if (showResults) setExpanded(false);
          else if (query) setQuery('');
          else inputRef.current?.blur();
        }
        if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && normalizedQuery && ordered.length) {
          event.preventDefault();
          if (!showResults) { open(); return; }
          setActiveIndex(previous => (Math.min(previous, ordered.length - 1) + (event.key === 'ArrowDown' ? 1 : -1) + ordered.length) % ordered.length);
        }
        if (event.key === 'Enter' && showResults && ordered.length) {
          event.preventDefault();
          selectItem(ordered[selectedIndex]);
        }
      }}
    />
    {showResults && <div className="gs-popup">
      <div className="gs-listbox" ref={listRef} id={listId} role="listbox" aria-label="搜索结果">
        {grouped.map(group => <div className="gs-group" role="group" key={group.key} aria-labelledby={`${listId}-${group.key}`}>
          <div className="gs-group-label" id={`${listId}-${group.key}`} aria-hidden>{group.label}</div>
          {group.items.map(item => {
            position += 1;
            const itemPosition = position;
            return <div
              key={item.key}
              id={optionId(itemPosition)}
              role="option"
              aria-selected={itemPosition === selectedIndex}
              className="gs-option"
              onMouseDown={event => event.preventDefault()}
              onClick={() => selectItem(item)}
            >
              <span className="gs-option-icon" aria-hidden>{group.icon}</span>
              <span className="gs-option-title"><Highlight text={item.title} query={normalizedQuery} /></span>
              <span className="gs-option-path">
                <Highlight text={item.path} query={item.rank === 3 ? normalizedQuery : ''} />
                {item.keyword && <> · <Highlight text={item.keyword} query={normalizedQuery} /></>}
              </span>
            </div>;
          })}
        </div>)}
      </div>
      {!ordered.length && !loading && <div className="gs-empty">
        <div className="gs-empty-title">没有找到“{query.trim()}”相关的应用或页面</div>
        <div className="gs-empty-hint">记录内容不在这里搜索：打开对应列表，在“关键词”筛选中查找。</div>
      </div>}
      {loading && <div className="gs-status"><LoadingOutlined aria-hidden />正在加载应用和页面…</div>}
      {statusMessage && <div className="gs-status gs-status-error">
        <span>{statusMessage}</span>
        <button type="button" className="gs-retry" onMouseDown={event => event.preventDefault()} onClick={() => load(true)}>重试</button>
      </div>}
      {ordered.length > 0 && <div className="gs-footer" aria-hidden>
        <span><kbd className="gs-kbd">↑</kbd><kbd className="gs-kbd">↓</kbd> 选择</span>
        <span><kbd className="gs-kbd">Enter</kbd> 打开</span>
        <span><kbd className="gs-kbd">Esc</kbd> 关闭</span>
      </div>}
    </div>}
    <div className="gs-sr-only" role="status" aria-live="polite">{announcement}</div>
  </div>;
}
