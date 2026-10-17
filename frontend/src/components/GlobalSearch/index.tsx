import React, { useEffect, useId, useRef, useState } from 'react';
import { Input } from 'antd';
import type { InputRef } from 'antd';
import {
  AppstoreOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  SettingOutlined,
  ShopOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import { NAVIGATION_AREAS, NAVIGATION_ENTRIES, type NavigationArea } from '../../config/navigation';
import { useAuthStore } from '../../stores/authStore';

interface SearchItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  category: string;
}

const areaIcons: Record<NavigationArea, React.ReactNode> = {
  business: <DashboardOutlined />,
  studio: <AppstoreOutlined />,
  plugins: <AppstoreOutlined />,
  data: <DatabaseOutlined />,
  admin: <SettingOutlined />,
};

const BUSINESS_ITEMS = [
  { key: '/program/material-application', label: '料号申请表单', icon: <AppstoreOutlined /> },
  { key: '/program/production-overview', label: '生产态势', icon: <DashboardOutlined /> },
  { key: '/program/device-health', label: '预测性维护', icon: <ToolOutlined /> },
  { key: '/program/quality-overview', label: '质量分析', icon: <SafetyCertificateOutlined /> },
  { key: '/program/supply-overview', label: '供应链风险', icon: <ShopOutlined /> },
];

export default function GlobalSearch() {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((state) => state.user);
  const inputRef = useRef<InputRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus({ cursor: 'all' });
        setExpanded(true);
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
  }, []);

  useEffect(() => { setQuery(''); setExpanded(false); setActiveIndex(0); }, [location.pathname, location.search]);

  const visibleAreas = NAVIGATION_AREAS.filter((area) => !area.adminOnly || user?.is_admin);
  const searchItems: SearchItem[] = visibleAreas.flatMap((area) => {
    const entries = NAVIGATION_ENTRIES
      .filter((entry) => entry.area === area.key && (!entry.adminOnly || user?.is_admin))
      .map((entry) => ({ key: entry.path, label: entry.label, icon: areaIcons[area.key], category: area.label }));
    const areaHome = entries.some((entry) => entry.key === area.home)
      ? []
      : [{ key: area.home, label: area.label, icon: areaIcons[area.key], category: area.label }];
    const businessItems = area.key === 'business'
      ? BUSINESS_ITEMS.map((item) => ({ ...item, category: area.label }))
      : [];
    return [...areaHome, ...entries, ...businessItems];
  });
  searchItems.push(
    { key: '/account-center', label: '账号设置', icon: <SettingOutlined />, category: '个人设置' },
    { key: '/more', label: '应用中心', icon: <AppstoreOutlined />, category: '工作空间' },
  );
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = normalizedQuery
    ? searchItems.filter((item) =>
        item.label.toLowerCase().includes(normalizedQuery) ||
        item.category.toLowerCase().includes(normalizedQuery)
      )
    : searchItems;

  const showResults = expanded && Boolean(normalizedQuery);
  const selectedIndex = Math.min(activeIndex, Math.max(0, filtered.length - 1));
  useEffect(() => {
    const list = resultsRef.current;
    const selected = document.getElementById(`${listId}-${selectedIndex}`);
    if (!showResults || !list || !selected) return;
    const top = selected.offsetTop;
    const bottom = top + selected.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }, [showResults, selectedIndex, listId]);

  const selectItem = (item: SearchItem) => { setExpanded(false); setQuery(''); inputRef.current?.blur(); navigate(item.key); };

  return <div className="shell-inline-search" ref={containerRef}>
    <Input
      ref={inputRef}
      className="shell-search-input"
      prefix={<SearchOutlined />}
      suffix={<kbd className="shell-search-shortcut">Ctrl+K</kbd>}
      placeholder="搜索应用、数据或配置"
      aria-label="搜索工作空间"
      role="combobox"
      aria-autocomplete="list"
      aria-expanded={showResults}
      aria-controls={showResults ? listId : undefined}
      aria-activedescendant={showResults && filtered.length ? `${listId}-${selectedIndex}` : undefined}
      value={query}
      allowClear
      onFocus={() => setExpanded(true)}
      onBlur={event => { if (!containerRef.current?.contains(event.relatedTarget)) setExpanded(false); }}
      onChange={event => { setQuery(event.target.value); setExpanded(true); setActiveIndex(0); }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === 'Escape') { event.preventDefault(); setExpanded(false); inputRef.current?.blur(); }
        if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && normalizedQuery && filtered.length) {
          event.preventDefault(); setExpanded(true);
          setActiveIndex(previous => (previous + (event.key === 'ArrowDown' ? 1 : -1) + filtered.length) % filtered.length);
        }
        if (event.key === 'Enter' && showResults && filtered.length && !event.nativeEvent.isComposing) {
          event.preventDefault(); selectItem(filtered[selectedIndex]);
        }
      }}
    />
    {showResults && <div className="shell-search-results" ref={resultsRef} id={listId} role="listbox" aria-label="搜索结果">
      <div className="shell-search-results-heading">{filtered.length ? `找到 ${filtered.length} 个入口` : '没有找到匹配项'}</div>
      {filtered.map((item, index) => <button
        key={item.key}
        id={`${listId}-${index}`}
        type="button"
        role="option"
        aria-selected={index === selectedIndex}
        tabIndex={-1}
        className={`shell-search-result ${index === selectedIndex ? 'is-selected' : ''}`}
        onMouseDown={event => event.preventDefault()}
        onMouseEnter={() => setActiveIndex(index)}
        onClick={() => selectItem(item)}
      ><span className="shell-search-result-icon">{item.icon}</span><span>{item.label}</span><small>{item.category}</small></button>)}
      {filtered.length > 0 && <div className="shell-search-results-footer">↑ ↓ 选择 · Enter 打开 · Esc 收起</div>}
    </div>}
  </div>;
}
