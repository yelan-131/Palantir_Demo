import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Dropdown, Empty, Input, Popover, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import { BookOutlined, CheckOutlined, DownOutlined, FileTextOutlined, FolderOutlined, MoreOutlined, PlusOutlined, ProjectOutlined, SearchOutlined, SortAscendingOutlined, StarFilled, StarOutlined } from '@ant-design/icons';
import { useAuthStore } from '../../stores/authStore';
import { explorerDefaults, explorerStorageKey, moveExplorerDocument, normalizeExplorerPreferences, removeExplorerFolder, sortExplorerDocuments, type ExplorerDocument, type ExplorerFolder, type ExplorerPreferences } from '../../utils/knowledgeExplorer';
import { createUuid } from '../../utils/uuid';
import './style.css';

type Props = { documents: ExplorerDocument[]; selectedId: string; onOpen: (id: string) => void };
const icons = { folder: <FolderOutlined />, book: <BookOutlined />, project: <ProjectOutlined /> };
const colors: ExplorerFolder['color'][] = ['primary', 'success', 'warning', 'focus'];
const colorNames = { primary: '蓝灰', success: '松绿', warning: '琥珀', focus: '柔蓝' };
export default function KnowledgeExplorer(props: Props) {
  const user = useAuthStore(state => state.user);
  const key = explorerStorageKey(user?.tenant_id, user?.id);
  return <PersonalExplorer {...props} key={key} storageKey={key} />;
}
function PersonalExplorer({ documents, selectedId, onOpen, storageKey }: Props & { storageKey: string }) {
  const [preferences, setPreferences] = useState(() => {
    try { return normalizeExplorerPreferences(JSON.parse(localStorage.getItem(storageKey) || '{}')); } catch { return explorerDefaults(); }
  });
  const [view, setView] = useState<'collections' | 'all' | 'favorites'>('collections');
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [editing, setEditing] = useState<{ id: string; name: string; documentId?: string }>();
  const [error, setError] = useState('');
  const [dropTarget, setDropTarget] = useState<string>();
  const [saved, setSaved] = useState(true);
  const dirty = useRef(false);
  const drag = useRef<{ id: string; x: number; y: number }>();
  const handled = useRef(false);
  const update = (operation: (previous: ExplorerPreferences) => ExplorerPreferences) => {
    dirty.current = true;
    setPreferences(previous => normalizeExplorerPreferences(operation(previous)));
  };
  useEffect(() => {
    if (!dirty.current) return;
    dirty.current = false;
    try { localStorage.setItem(storageKey, JSON.stringify(preferences)); setSaved(true); } catch { setSaved(false); }
  }, [preferences, storageKey]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== storageKey) return;
      try { dirty.current = false; setPreferences(normalizeExplorerPreferences(JSON.parse(event.newValue || '{}'))); } catch { /* Ignore malformed external storage. */ }
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [storageKey]);
  const ordered = useMemo(() => sortExplorerDocuments(documents, preferences), [documents, preferences]);
  const filtered = ordered.filter(doc => (view !== 'favorites' || preferences.favorites.includes(doc.id)) && `${doc.title} ${doc.filename} ${doc.searchText}`.toLowerCase().includes(query.trim().toLowerCase()));
  const toggleFavorite = (id: string) => update(previous => ({ ...previous, favorites: previous.favorites.includes(id) ? previous.favorites.filter(item => item !== id) : [...previous.favorites, id] }));
  const move = (id: string, folderId: string, beforeId?: string) => {
    update(previous => moveExplorerDocument(previous, id, folderId, ordered.map(doc => doc.id), beforeId));
    setCollapsed(previous => previous.filter(item => item !== folderId));
  };
  const finishDrop = (event: { clientX: number; clientY: number }) => {
    const source = drag.current;
    if (!source || handled.current || Math.hypot(event.clientX - source.x, event.clientY - source.y) < 8) return;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-explorer-document], [data-explorer-folder]');
    if (!target || !target.hasAttribute('data-explorer-folder') || target.dataset.explorerDocument === source.id) return;
    const folderId = target.dataset.explorerFolder || '';
    let beforeId = target.dataset.explorerDocument;
    if (beforeId && event.clientY > target.getBoundingClientRect().top + target.getBoundingClientRect().height / 2) {
      const siblings = ordered.filter(doc => (preferences.assignments[doc.id] || '') === folderId && doc.id !== source.id);
      beforeId = siblings[siblings.findIndex(doc => doc.id === beforeId) + 1]?.id;
    }
    handled.current = true;
    move(source.id, folderId, beforeId);
  };
  useEffect(() => {
    const finish = (event: MouseEvent) => { finishDrop(event); drag.current = undefined; setDropTarget(undefined); };
    document.addEventListener('mouseup', finish);
    return () => document.removeEventListener('mouseup', finish);
  }, [ordered, preferences]);
  const newFolder = (documentId?: string) => { setView('collections'); setError(''); setEditing({ id: createUuid(), name: '', documentId }); };
  const saveName = () => {
    if (!editing) return;
    const name = editing.name.trim();
    if (!name) { setError('给分组起个名字'); return; }
    if (preferences.folders.some(folder => folder.id !== editing.id && folder.name === name)) { setError('这个名称已被使用'); return; }
    update(previous => {
      const next = { ...previous, grouping: 'custom' as const, folders: previous.folders.some(folder => folder.id === editing.id) ? previous.folders.map(folder => folder.id === editing.id ? { ...folder, name } : folder) : [...previous.folders, { id: editing.id, name, icon: 'folder' as const, color: 'primary' as const }] };
      return editing.documentId ? moveExplorerDocument(next, editing.documentId, editing.id, ordered.map(doc => doc.id)) : next;
    });
    setEditing(undefined); setError('');
  };
  const nameEditor = <div className="shelf-name-editor"><Input autoFocus aria-label="分组名称" placeholder="输入分组名称" maxLength={40} value={editing?.name} onChange={event => { setEditing(previous => previous && ({ ...previous, name: event.target.value })); setError(''); }} onPressEnter={saveName} onKeyDown={event => { if (event.key === 'Escape') setEditing(undefined); }} /><Button type="text" icon={<CheckOutlined />} aria-label="保存分组" onClick={saveName} /><Button type="text" aria-label="取消编辑分组" onClick={() => setEditing(undefined)}>取消</Button>{error && <small role="alert">{error}</small>}</div>;
  const documentMenu = (doc: ExplorerDocument): MenuProps['items'] => [
    { key: 'move', label: '移动到分组', children: [
      ...preferences.folders.map(folder => ({ key: folder.id, icon: icons[folder.icon], label: folder.name, onClick: () => move(doc.id, folder.id) })),
      { key: 'unfiled', label: '未分组', onClick: () => move(doc.id, '') },
      { type: 'divider' }, { key: 'new', label: '新建分组并移入', icon: <PlusOutlined />, onClick: () => newFolder(doc.id) },
    ] },
  ];
  const renderDocument = (doc: ExplorerDocument, folderId?: string) => <Dropdown key={doc.id} menu={{ items: documentMenu(doc) }} trigger={['contextMenu']}><div className={`shelf-document${selectedId === doc.id ? ' is-selected' : ''}`} data-explorer-document={doc.id} data-explorer-folder={folderId}
    draggable={view === 'collections' && !query}
    onMouseDown={event => { if (event.button === 0 && view === 'collections' && !query && !(event.target as HTMLElement).closest('button')) { drag.current = { id: doc.id, x: event.clientX, y: event.clientY }; handled.current = false; } }}
    onDragStart={event => { drag.current = { id: doc.id, x: event.clientX, y: event.clientY }; handled.current = false; event.dataTransfer.setData('text/plain', doc.id); event.dataTransfer.effectAllowed = 'move'; }}
    onDragEnd={event => { finishDrop(event); drag.current = undefined; setDropTarget(undefined); }}>
    <button className="shelf-document-open" onClick={() => { if (!handled.current) onOpen(doc.id); handled.current = false; }} title={doc.filename}><FileTextOutlined /><span>{doc.title}<small>{doc.typeLabel}</small></span></button>
    <div className="shelf-document-actions"><Button type="text" size="small" className={preferences.favorites.includes(doc.id) ? 'is-favorite' : ''} aria-label={`${preferences.favorites.includes(doc.id) ? '取消收藏' : '收藏'}：${doc.title}`} icon={preferences.favorites.includes(doc.id) ? <StarFilled /> : <StarOutlined />} onClick={() => toggleFavorite(doc.id)} /><Dropdown menu={{ items: documentMenu(doc) }} trigger={['click']}><Button type="text" size="small" icon={<MoreOutlined />} aria-label={`文档操作：${doc.title}`} /></Dropdown></div>
  </div></Dropdown>;
  const groups = [...preferences.folders.map(folder => ({ id: folder.id, name: folder.name, folder })), { id: '', name: preferences.folders.length ? '未分组' : '我的文档', folder: undefined }];
  return <div className="knowledge-custom-explorer knowledge-shelf">
    <Input aria-label="搜索知识文档" placeholder="搜索你的知识" prefix={<SearchOutlined />} value={query} allowClear onChange={event => setQuery(event.target.value)} />
    <nav className="shelf-tabs" aria-label="目录视图">{([{ id: 'collections', name: '分组' }, { id: 'all', name: '全部' }, { id: 'favorites', name: '收藏' }] as const).map(tab => <button key={tab.id} aria-pressed={view === tab.id} onClick={() => setView(tab.id)}>{tab.name}{tab.id === 'favorites' && <small>{documents.filter(doc => preferences.favorites.includes(doc.id)).length}</small>}</button>)}<Dropdown menu={{ selectable: true, selectedKeys: [preferences.sort], items: [{ key: 'manual', label: '手动排序' }, { key: 'name', label: '按名称排序' }, { key: 'recent', label: '按最近更新排序' }], onClick: ({ key }) => update(previous => ({ ...previous, sort: key as ExplorerPreferences['sort'] })) }} trigger={['click']}><Button type="text" size="small" aria-label="文档排序" icon={<SortAscendingOutlined />} /></Dropdown></nav>
    <div className="shelf-scroll">
      {view === 'collections' ? <>
        <div className="shelf-caption"><span>我的资料架 <small>{documents.length}</small></span><Tooltip title="新建分组"><Button type="text" size="small" aria-label="新建分组" icon={<PlusOutlined />} onClick={() => newFolder()} /></Tooltip></div>
        {editing && !preferences.folders.some(folder => folder.id === editing.id) && nameEditor}
        {groups.map(group => {
          const docs = filtered.filter(doc => (preferences.assignments[doc.id] || '') === group.id);
          if (query && !docs.length) return null;
          const folder = group.folder;
          return <section key={group.id} className={`shelf-collection color-${folder?.color || 'primary'}${dropTarget === group.id ? ' is-drop-target' : ''}`} data-explorer-folder={group.id} onDragOver={event => { event.preventDefault(); setDropTarget(group.id); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropTarget(undefined); }} onDrop={event => { event.preventDefault(); finishDrop(event); drag.current = undefined; setDropTarget(undefined); }}>
            {editing?.id === group.id ? nameEditor : <header className="shelf-collection-heading">
              {folder ? <Popover trigger="click" placement="rightTop" content={<div className="shelf-style-picker"><span>分组图标</span><div>{(Object.keys(icons) as ExplorerFolder['icon'][]).map(icon => <Button key={icon} type={folder.icon === icon ? 'primary' : 'text'} aria-label={`图标：${icon}`} icon={icons[icon]} onClick={() => update(previous => ({ ...previous, folders: previous.folders.map(item => item.id === folder.id ? { ...item, icon } : item) }))} />)}</div><span>强调颜色</span><div>{colors.map(color => <button key={color} aria-label={`颜色：${colorNames[color]}`} aria-pressed={folder.color === color} className={`shelf-color color-${color}`} onClick={() => update(previous => ({ ...previous, folders: previous.folders.map(item => item.id === folder.id ? { ...item, color } : item) }))}>{folder.color === color && <CheckOutlined />}</button>)}</div></div>}><button className="shelf-folder-icon" aria-label={`调整分组风格：${group.name}`}>{icons[folder.icon]}</button></Popover> : <span className="shelf-folder-icon"><FolderOutlined /></span>}
              <button className="shelf-group-toggle" aria-expanded={!collapsed.includes(group.id)} onClick={() => setCollapsed(previous => previous.includes(group.id) ? previous.filter(id => id !== group.id) : [...previous, group.id])}><strong>{group.name}</strong><small>{docs.length}</small><DownOutlined className={collapsed.includes(group.id) ? 'is-collapsed' : ''} /></button>
              {folder && <Dropdown trigger={['click']} menu={{ items: [{ key: 'rename', label: '重命名', onClick: () => { setEditing({ id: folder.id, name: folder.name }); setError(''); } }, ...[-1, 1].map(direction => ({ key: String(direction), label: direction < 0 ? '上移' : '下移', disabled: preferences.folders.indexOf(folder) + direction < 0 || preferences.folders.indexOf(folder) + direction >= preferences.folders.length, onClick: () => update(previous => { const folders = [...previous.folders]; const index = folders.findIndex(item => item.id === folder.id); [folders[index], folders[index + direction]] = [folders[index + direction], folders[index]]; return { ...previous, folders }; }) })), { type: 'divider' }, { key: 'remove', label: '解散分组，保留文档', onClick: () => update(previous => removeExplorerFolder(previous, folder.id)) }] }}><Button type="text" size="small" icon={<MoreOutlined />} aria-label={`分组操作：${group.name}`} /></Dropdown>}
            </header>}
            {(!collapsed.includes(group.id) || query) && <div className="shelf-collection-documents">{docs.map(doc => renderDocument(doc, group.id))}{!docs.length && <div className="shelf-drop-hint">拖入文档，开始整理这个分组</div>}</div>}
          </section>;
        })}
        {!editing && <button className="shelf-add-collection" onClick={() => newFolder()}><PlusOutlined /> 新建一个分组</button>}
        {query && !filtered.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的文档" />}
      </> : <><div className="shelf-caption"><span>{view === 'favorites' ? '收藏的文档' : '全部文档'} <small>{filtered.length}</small></span></div>{filtered.map(doc => renderDocument(doc))}{!filtered.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={query ? '没有匹配的文档' : '点亮文档旁的星标，留在这里'} />}</>}
    </div>
    <div className="shelf-footer"><span>{saved ? '拖动归类 · 点击图标换风格' : '本次调整未保存到浏览器'}</span></div>
  </div>;
}
