import { Button, Checkbox, Input, InputNumber, Select, Space, Switch, Tag, Typography } from 'antd';
import { CalendarOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { sortByOrder } from '@/utils/viewConfig';
import type { ViewConfig, ViewFilterConfig, ViewTableColumnConfig } from '@/utils/viewConfig';
import ViewTabsEditor from './ViewTabsEditor';
import { viewColumnRenderOptions } from './designerOptions';
import type { DesignerConfig } from './designerTypes';

export interface DataViewDesignerActions {
  setActiveViewTabId: (id: string) => void;
  setExpandedViewRow: (id: string) => void;
  setViewConfig: (next: ViewConfig) => void;
  markUnsaved: () => void;
  setFilterFieldPickerOpen: (open: boolean) => void;
  setTableFieldPickerOpen: (open: boolean) => void;
  setDraggedViewFilterId: (id: string) => void;
  setDraggedViewColumnId: (id: string) => void;
  reorderViewFilters: (draggedId: string, targetId: string) => void;
  reorderViewColumns: (draggedId: string, targetId: string) => void;
  updateViewConfig: (updater: (current: ViewConfig) => ViewConfig) => void;
  updateViewColumn: (id: string, patch: Partial<ViewTableColumnConfig>) => void;
  moveViewItem: (kind: 'filter' | 'column', id: string, direction: -1 | 1) => void;
}

export interface DataViewDesignerProps {
  storedViewConfig: ViewConfig;
  viewConfig: ViewConfig;
  activeViewId: string;
  baseConfig: DesignerConfig;
  expandedViewRow: string;
  draggedViewFilterId: string;
  draggedViewColumnId: string;
  identityRoleRecords: Array<{ id: number; name: string; label: string }>;
  identityUsers: Array<{ id: number; username: string; label: string }>;
  permissionOrgUnits: Array<{ id: number; name: string }>;
  actions: DataViewDesignerActions;
}

export function DataViewDesigner({
  storedViewConfig,
  viewConfig,
  activeViewId,
  baseConfig,
  expandedViewRow,
  draggedViewFilterId,
  draggedViewColumnId,
  identityRoleRecords,
  identityUsers,
  permissionOrgUnits,
  actions,
}: DataViewDesignerProps) {
  const {
    setActiveViewTabId,
    setExpandedViewRow,
    setViewConfig,
    markUnsaved,
    setFilterFieldPickerOpen,
    setTableFieldPickerOpen,
    setDraggedViewFilterId,
    setDraggedViewColumnId,
    reorderViewFilters,
    reorderViewColumns,
    updateViewConfig,
    updateViewColumn,
    moveViewItem,
  } = actions;
  const activeViewTab = { id: activeViewId };
  const viewFieldOptions = baseConfig.fields.map((field) => ({ value: field.key, label: `${field.name} (${field.key})` }));
  const sortedViewFilters = sortByOrder(viewConfig.filters);
  const sortedViewColumns = sortByOrder(viewConfig.table.columns);
  const enabledViewColumns = sortedViewColumns.filter((column) => column.enabled);

  const renderViewFilterControl = (filter: ViewFilterConfig) => {
    const placeholder = filter.placeholder || filter.label;
    if (filter.controlType === 'select' || filter.controlType === 'relation') {
      return <Select allowClear disabled placeholder={placeholder} options={[{ value: 'demo', label: placeholder }]} />;
    }
    if (filter.controlType === 'dateRange') {
      return <Input disabled prefix={<CalendarOutlined />} placeholder="开始日期  →  结束日期" />;
    }
    return <Input disabled prefix={filter.controlType === 'keyword' ? <SearchOutlined /> : undefined} placeholder={placeholder} />;
  };

  const renderViewFilterRow = (filter: ViewFilterConfig, index: number) => {
    return (
      <div
        className={`view-config-row ${draggedViewFilterId === filter.id ? 'view-config-row-dragging' : ''}`}
        draggable
        key={filter.id}
        onDragEnd={() => setDraggedViewFilterId('')}
        onDragOver={(event) => {
          if (!draggedViewFilterId || draggedViewFilterId === filter.id) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
        }}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move';
          setDraggedViewFilterId(filter.id);
        }}
        onDrop={(event) => {
          event.preventDefault();
          reorderViewFilters(draggedViewFilterId, filter.id);
          setDraggedViewFilterId('');
        }}
      >
        <div
          className="view-config-row-main view-filter-config-main"
        >
          <label className="view-filter-config-form-item">
            <span className="view-filter-config-label">{filter.label}</span>
            <span className="view-filter-config-control">{renderViewFilterControl(filter)}</span>
          </label>
        </div>
      </div>
    );
  };

  const renderViewColumnRow = (column: ViewTableColumnConfig, index: number) => {
    const expanded = expandedViewRow === column.id;
    return (
      <div className={`view-config-row ${expanded ? 'view-config-row-expanded' : ''}`} key={column.id}>
        <button className="view-config-row-main" type="button" onClick={() => setExpandedViewRow(expanded ? '' : column.id)}>
          <span className="view-config-order">{index + 1}</span>
          <span className="view-config-primary">
            <strong>{column.label}</strong>
            <small>{column.fieldName} · {viewColumnRenderOptions.find((item) => item.value === column.renderType)?.label} · {column.width || 140}px</small>
          </span>
          <Tag color={column.enabled ? 'green' : 'default'}>{column.enabled ? '展示' : '隐藏'}</Tag>
          {column.sortable && <Tag color="blue">可排序</Tag>}
          {column.fixed && <Tag color="purple">固定{column.fixed === 'left' ? '左侧' : '右侧'}</Tag>}
        </button>
        <Space size={4} className="view-config-row-actions">
          <Button size="small" onClick={() => moveViewItem('column', column.id, -1)} disabled={index === 0}>上移</Button>
          <Button size="small" onClick={() => moveViewItem('column', column.id, 1)} disabled={index === sortedViewColumns.length - 1}>下移</Button>
          <Switch size="small" checked={column.enabled} onChange={(enabled) => updateViewColumn(column.id, { enabled })} />
        </Space>
        {expanded && (
          <div className="view-config-inline-editor view-config-inline-editor-wide">
            <label><span>绑定字段</span><Select value={column.fieldName} options={viewFieldOptions} onChange={(fieldName) => {
              const field = baseConfig.fields.find((item) => item.key === fieldName);
              updateViewColumn(column.id, { fieldName, label: field?.name || column.label });
            }} /></label>
            <label><span>列标题</span><Input value={column.label} onChange={(event) => updateViewColumn(column.id, { label: event.target.value })} /></label>
            <label><span>列宽</span><InputNumber min={80} max={420} value={column.width || 140} onChange={(width) => updateViewColumn(column.id, { width: Number(width || 140) })} /></label>
            <label><span>渲染类型</span><Select value={column.renderType} options={viewColumnRenderOptions} onChange={(renderType) => updateViewColumn(column.id, { renderType })} /></label>
            <label><span>固定列</span><Select value={column.fixed || 'none'} options={[{ value: 'none', label: '不固定' }, { value: 'left', label: '固定左侧' }, { value: 'right', label: '固定右侧' }]} onChange={(value) => updateViewColumn(column.id, { fixed: value === 'none' ? undefined : value as 'left' | 'right' })} /></label>
            <label><span>空值展示</span><Input value={column.emptyText} onChange={(event) => updateViewColumn(column.id, { emptyText: event.target.value })} /></label>
            <label><span>允许排序</span><Switch size="small" checked={column.sortable} onChange={(sortable) => updateViewColumn(column.id, { sortable })} /></label>
          </div>
        )}
      </div>
    );
  };

  const renderDataViewDesigner = () => (
    <div className="data-view-designer">
      <ViewTabsEditor config={storedViewConfig} activeId={activeViewTab.id} onSelect={(id) => { setActiveViewTabId(id); setExpandedViewRow(''); }}
        onChange={(next) => { setViewConfig(next); markUnsaved(); }}
        roles={identityRoleRecords.map((role) => ({ value: role.id, label: role.label }))}
        users={identityUsers.map((user) => ({ value: user.id, label: user.label }))}
        organizations={permissionOrgUnits.map((org) => ({ value: org.id, label: org.name }))} />
      <section className="view-config-section">
        <div className="view-config-section-head">
          <div><strong>筛选区</strong><span>配置查询条件、操作符、默认值和常用/高级位置。</span></div>
          <Button
            aria-label="新增筛选项"
            icon={<PlusOutlined />}
            onClick={() => setFilterFieldPickerOpen(true)}
            size="small"
            title="新增筛选项"
            type="text"
          />
        </div>
        <div className="view-config-filter-shell">
          <div className="view-config-list view-config-filter-grid">
            {sortedViewFilters.map(renderViewFilterRow)}
          </div>
          <Space className="view-config-filter-actions">
            <Button size="small" disabled title="设计预览，不执行查询">重置</Button>
            <Button icon={<SearchOutlined />} size="small" type="primary" disabled title="发布后在运行页查询">查询</Button>
          </Space>
        </div>
      </section>

      <section className="view-config-section">
        <div className="view-config-section-head">
          <div><strong>数据列表区</strong><span>配置表格列、操作、排序、分页和行交互。</span></div>
          <Button
            aria-label="新增列表字段"
            icon={<PlusOutlined />}
            onClick={() => setTableFieldPickerOpen(true)}
            size="small"
            title="新增列表字段"
            type="text"
          />
        </div>
        <Space wrap style={{marginBottom:12}}><Checkbox checked={viewConfig.table.toolbarActions.includes('import')} onChange={event=>updateViewConfig(current=>({...current,table:{...current.table,toolbarActions:event.target.checked?[...new Set([...current.table.toolbarActions,'import'])]:current.table.toolbarActions.filter(action=>action!=='import')}}))}>显示批量导入入口</Checkbox><Typography.Text type="secondary">发布后生效；导入还需角色具有“导入”和“新增”权限。</Typography.Text></Space>
        <div className="view-config-table-shell">
          <div className="view-config-table-preview">
            <div
              className="view-config-table-head-row"
              style={{ gridTemplateColumns: `${enabledViewColumns.map((column) => `${column.width || 140}px`).join(' ')} 128px` }}
            >
              {enabledViewColumns.map((column) => (
                <div
                  className={`view-config-table-head-cell ${draggedViewColumnId === column.id ? 'view-config-table-cell-dragging' : ''}`}
                  draggable
                  key={column.id}
                  onDragEnd={() => setDraggedViewColumnId('')}
                  onDragOver={(event) => {
                    if (!draggedViewColumnId || draggedViewColumnId === column.id) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                  }}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = 'move';
                    setDraggedViewColumnId(column.id);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    reorderViewColumns(draggedViewColumnId, column.id);
                    setDraggedViewColumnId('');
                  }}
                  title="拖拽调整列顺序"
                >
                  {column.label}
                </div>
              ))}
              <div className="view-config-table-head-cell view-config-table-action-cell">操作</div>
            </div>
            <div className="view-config-table-empty">
              暂无数据
            </div>
          </div>
        </div>
      </section>

    </div>
  );

  return renderDataViewDesigner();
}
