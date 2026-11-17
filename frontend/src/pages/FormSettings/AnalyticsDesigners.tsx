import type { CSSProperties } from 'react';
import { Button, Input, InputNumber, Select, Space, Tag, message } from 'antd';
import { DatabaseOutlined, DeleteOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import type { PlatformForm, PlatformFormField } from '@/services/api';
import type { AnalyticsDataset, AnalyticsDesign, AnalyticsMetric, AnalyticsStyle, AnalyticsWidget, AnalyticsWidgetType } from './designerTypes';

type SelectOption = { value: string; label: string };
type UpdateAnalyticsDesign = (updater: (current: AnalyticsDesign) => AnalyticsDesign) => void;

export interface AnalyticsDatasetDesignerProps {
  analyticsDesign: AnalyticsDesign;
  referenceForms: PlatformForm[];
  analyticsSourceFields: Record<string, PlatformFormField[]>;
  analyticsDatasetOptions: SelectOption[];
  updateAnalyticsDesign: UpdateAnalyticsDesign;
  updateAnalyticsDataset: (id: string, patch: Partial<AnalyticsDataset>) => void;
  updateAnalyticsMetric: (id: string, patch: Partial<AnalyticsMetric>) => void;
  addAnalyticsDataset: () => void;
  addAnalyticsMetric: () => void;
}

export interface AnalyticsDashboardDesignerProps {
  analyticsDesign: AnalyticsDesign;
  formName: string;
  analyticsDatasetOptions: SelectOption[];
  selectedAnalyticsWidget?: AnalyticsWidget;
  analyticsLibrarySearch: string;
  setAnalyticsLibrarySearch: (value: string) => void;
  draggedAnalyticsWidgetId: string;
  setDraggedAnalyticsWidgetId: (value: string) => void;
  setSelectedAnalyticsWidgetId: (value: string) => void;
  analyticsCanvasStyle: CSSProperties;
  analyticsWidgetStyle: CSSProperties;
  addAnalyticsWidget: (type: AnalyticsWidgetType) => void;
  updateAnalyticsDesign: UpdateAnalyticsDesign;
  updateAnalyticsWidget: (id: string, patch: Partial<AnalyticsWidget>) => void;
}

export interface AnalyticsFilterDesignerProps {
  analyticsDesign: AnalyticsDesign;
  analyticsWidgetOptions: SelectOption[];
  updateAnalyticsDesign: UpdateAnalyticsDesign;
}

export interface AnalyticsStyleDesignerProps {
  analyticsStyle: AnalyticsStyle;
  updateAnalyticsStyle: (patch: Partial<AnalyticsStyle>) => void;
}

export function AnalyticsWidgetPreview({ widget, metrics }: { widget: AnalyticsWidget; metrics: AnalyticsMetric[] }) {
  if (widget.type === 'metric-card') {
    return (
      <div className="analytics-widget-metrics">
        {widget.metricIds.map((metricId) => metrics.find((metric) => metric.id === metricId)).filter(Boolean).map((metric) => (
          <div key={metric!.id}><span>{metric!.name}</span><strong>{'—'}</strong></div>
        ))}
      </div>
    );
  }
  if (widget.type === 'detail-table' || widget.type === 'rank-table') {
    return (
      <div className="analytics-widget-table">
        <div><span>对象</span><span>指标</span><span>状态</span></div>
        {[1, 2, 3].map((row) => <div key={row}><span>示意行 {row}</span><span>—</span><span>—</span></div>)}
      </div>
    );
  }
  return (
    <div className={`analytics-widget-chart analytics-widget-chart-${widget.type}`}>
      <span />
      <span />
      <span />
      <span />
    </div>
  );
}

export function AnalyticsDatasetDesigner({ analyticsDesign, referenceForms, analyticsSourceFields, analyticsDatasetOptions, updateAnalyticsDesign, updateAnalyticsDataset, updateAnalyticsMetric, addAnalyticsDataset, addAnalyticsMetric }: AnalyticsDatasetDesignerProps) {
  return (
    <div className="analytics-designer analytics-dataset-designer">
      <section className="analytics-section">
        <div className="analytics-section-head">
          <div>
            <strong>数据源与数据集</strong>
            <span>配置看板取数来源、刷新策略、维度字段和可计算字段。</span>
          </div>
          <Space size={6}>
            <Tag color="blue">{analyticsDesign.datasets.length} 个数据集</Tag>
            <Button size="small" icon={<PlusOutlined />} onClick={addAnalyticsDataset}>新增数据集</Button>
          </Space>
        </div>
        <div className="analytics-dataset-grid">
          {analyticsDesign.datasets.map((dataset) => (
            <div className="analytics-dataset-card" key={dataset.id}>
              <div className="analytics-card-title">
                <DatabaseOutlined />
                <Input aria-label="数据集名称" value={dataset.name} onChange={(event) => updateAnalyticsDataset(dataset.id, { name: event.target.value })} />
                <Button size="small" danger title="删除数据集" icon={<DeleteOutlined />} onClick={() => {
                  if (analyticsDesign.metrics.some(metric => metric.datasetId === dataset.id) || analyticsDesign.widgets.some(widget => widget.datasetId === dataset.id)) { message.warning('请先删除或重新绑定引用此数据集的指标和组件'); return; }
                  updateAnalyticsDesign(current => ({...current, datasets: current.datasets.filter(item => item.id !== dataset.id)}));
                }} />
              </div>
              <div className="analytics-card-form-grid">
                <label><span>来源类型</span><Select value={dataset.sourceType} options={[
                  { value: 'businessForm', label: '业务表单' },
                  { value: 'ontology', label: '本体对象（暂未接入）', disabled: true },
                  { value: 'sql', label: 'SQL 数据集（暂未接入）', disabled: true },
                  { value: 'api', label: 'API 数据源（暂未接入）', disabled: true },
                ]} onChange={(sourceType) => updateAnalyticsDataset(dataset.id, { sourceType })} /></label>
                <label><span>来源表单编码</span><Select showSearch value={dataset.source} optionFilterProp="label" options={referenceForms.map(form => ({ value: form.code, label: `${form.name} (${form.code})` }))} onChange={(source) => updateAnalyticsDataset(dataset.id, { source, dimensions: [], measures: [] })} /><small>切换来源后请重新配置该表单的维度与数值字段。</small></label>
                <label><span>刷新策略</span><Select value={dataset.refreshMode} options={[
                  { value: 'realtime', label: '自动读取（每 30 秒）' },
                  { value: 'scheduled', label: '定时刷新' },
                  { value: 'manual', label: '手动刷新' },
                ]} onChange={(refreshMode) => updateAnalyticsDataset(dataset.id, { refreshMode })} /></label>
                {dataset.refreshMode === 'scheduled' && <label><span>刷新间隔（秒）</span><InputNumber min={10} max={86400} value={dataset.refreshInterval || 60} onChange={value => updateAnalyticsDataset(dataset.id, { refreshInterval: Number(value || 60) })} /></label>}
              </div>
              <div className="analytics-card-form-grid analytics-card-form-grid-wide">
                <label><span>维度字段</span><Select mode="multiple" options={(analyticsSourceFields[dataset.source] || []).filter(field => !field.archived).map(field => ({value: field.field_name, label: `${field.label} (${field.field_name})`}))} value={dataset.dimensions} onChange={(dimensions) => updateAnalyticsDataset(dataset.id, { dimensions })} /></label>
                <label><span>指标字段</span><Select mode="multiple" options={(analyticsSourceFields[dataset.source] || []).filter(field => !field.archived && /number|int|float|decimal|numeric|double|currency/.test(field.field_type)).map(field => ({value: field.field_name, label: `${field.label} (${field.field_name})`}))} value={dataset.measures} onChange={(measures) => updateAnalyticsDataset(dataset.id, { measures })} /></label>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="analytics-section">
        <div className="analytics-section-head">
          <div>
            <strong>指标口径</strong>
            <span>支持 count(*)、sum(actual)、avg(actual)、count_distinct(subject)、count_if(status == "已关闭")。百分比公式返回比例，例如 sum(actual) / sum(target)，展示时乘以 100；分母为零显示 —。</span>
          </div>
          <Button size="small" icon={<PlusOutlined />} onClick={addAnalyticsMetric}>新增指标</Button>
        </div>
        <div className="analytics-metric-list">
          {analyticsDesign.metrics.map((metric) => (
            <div className="analytics-metric-row" key={metric.id}>
              <Input value={metric.name} onChange={(event) => updateAnalyticsMetric(metric.id, { name: event.target.value })} />
              <Select value={metric.datasetId} options={analyticsDatasetOptions} onChange={(datasetId) => updateAnalyticsMetric(metric.id, { datasetId })} />
              <Input value={metric.expression} onChange={(event) => updateAnalyticsMetric(metric.id, { expression: event.target.value })} />
              <Select value={metric.format} options={[
                { value: 'number', label: '数值' },
                { value: 'percent', label: '百分比' },
                { value: 'currency', label: '金额' },
                { value: 'duration', label: '时长' },
              ]} onChange={(format) => updateAnalyticsMetric(metric.id, { format })} />
              <Input aria-label="指标阈值" value={metric.threshold} onChange={(event) => updateAnalyticsMetric(metric.id, { threshold: event.target.value })} />
              <Button danger size="small" title="删除指标" icon={<DeleteOutlined />} onClick={() => updateAnalyticsDesign(current => ({...current, metrics: current.metrics.filter(item => item.id !== metric.id), widgets: current.widgets.map(widget => ({...widget, metricIds: widget.metricIds.filter(id => id !== metric.id)}))}))} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export function AnalyticsDashboardDesigner({ analyticsDesign, formName, analyticsDatasetOptions, selectedAnalyticsWidget, analyticsLibrarySearch, setAnalyticsLibrarySearch, draggedAnalyticsWidgetId, setDraggedAnalyticsWidgetId, setSelectedAnalyticsWidgetId, analyticsCanvasStyle, analyticsWidgetStyle, addAnalyticsWidget, updateAnalyticsDesign, updateAnalyticsWidget }: AnalyticsDashboardDesignerProps) {
  return (
    <div className="analytics-board-workbench">
      <aside className="analytics-board-left form-designer-left">
        <div className="designer-panel-head">
          <strong>控件</strong>
          <span>BI 组件库</span>
        </div>
        <div className="designer-library-search">
          <Input allowClear prefix={<SearchOutlined />} placeholder="搜索组件类型" value={analyticsLibrarySearch} onChange={event => setAnalyticsLibrarySearch(event.target.value)} />
          <small>点击添加组件；拖动画布中的组件可调整顺序。画布为布局示意，真实数据请到运行页查看。</small>
        </div>
        <div className="designer-component-library">
          <section className="designer-component-group">
            <div className="designer-group-title">
              <span>分析组件</span>
              <small>点击添加</small>
            </div>
            <div className="designer-component-list analytics-control-list">
              {[
                { type: 'metric-card' as const, name: '指标卡', desc: '展示核心 KPI 与阈值状态' },
                { type: 'line' as const, name: '折线图', desc: '展示时间趋势' },
                { type: 'bar' as const, name: '柱状图', desc: '展示分类对比' },
                { type: 'pie' as const, name: '饼图', desc: '展示占比结构' },
                { type: 'rank-table' as const, name: '排行表', desc: '展示 Top N 排名' },
                { type: 'detail-table' as const, name: '明细表', desc: '承接下钻和跳转' },
              ].filter(item => item.name.includes(analyticsLibrarySearch.trim()) || item.desc.includes(analyticsLibrarySearch.trim())).map((item) => (
                <button className="designer-component analytics-control-item" data-desc={item.desc} title={`${item.name} / ${item.desc}`} key={item.type} type="button" onClick={() => addAnalyticsWidget(item.type)}>
                  <span>{item.name}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      </aside>

      <main className="analytics-board-middle form-designer-canvas">
        <div className="canvas-board create-form-canvas analytics-dashboard-shell">
          <div className="create-form-modal analytics-dashboard-modal">
            <section className="create-form-grid analytics-dashboard-canvas" style={analyticsCanvasStyle}>
              {analyticsDesign.widgets.map((widget) => (
                <button
                  className={`analytics-widget analytics-widget-${widget.width} ${selectedAnalyticsWidget?.id === widget.id ? 'analytics-widget-selected' : ''}`}
                  key={widget.id}
                  style={analyticsWidgetStyle}
                  type="button"
                  draggable
                  onDragStart={() => setDraggedAnalyticsWidgetId(widget.id)}
                  onDragEnd={() => setDraggedAnalyticsWidgetId('')}
                  onDragOver={event => event.preventDefault()}
                  onDrop={event => { event.preventDefault(); if (!draggedAnalyticsWidgetId || draggedAnalyticsWidgetId === widget.id) return; updateAnalyticsDesign(current => { const widgets = [...current.widgets]; const from = widgets.findIndex(item => item.id === draggedAnalyticsWidgetId); const to = widgets.findIndex(item => item.id === widget.id); if (from < 0 || to < 0) return current; widgets.splice(to, 0, widgets.splice(from, 1)[0]); return {...current, widgets}; }); setDraggedAnalyticsWidgetId(''); }}
                  onClick={() => setSelectedAnalyticsWidgetId(widget.id)}
                >
                  <div className="analytics-widget-head">
                    <strong>{widget.title}</strong>
                    <Tag>{widget.type}</Tag>
                  </div>
                  <AnalyticsWidgetPreview widget={widget} metrics={analyticsDesign.metrics} />
                </button>
              ))}
            </section>
          </div>
        </div>
      </main>

      <aside className="analytics-board-right form-designer-right">
        <div className="designer-panel-head">
          <strong>属性</strong>
          <span>{selectedAnalyticsWidget?.title || '画布'}</span>
        </div>
        <div className="designer-prop-summary">
          <span className="designer-prop-summary-badge">{selectedAnalyticsWidget ? '组件' : '画布'}</span>
          <strong>{selectedAnalyticsWidget?.title || formName}</strong>
          <small>{selectedAnalyticsWidget ? `${selectedAnalyticsWidget.type} · ${selectedAnalyticsWidget.metricIds.length} 个指标` : `${analyticsDesign.widgets.length} 个组件`}</small>
        </div>

        <div className="designer-props">
          {selectedAnalyticsWidget && (
            <section className="designer-prop-section designer-prop-section-primary">
              <strong className="designer-prop-section-title">组件属性</strong>
              <Space wrap><Button size="small" disabled={analyticsDesign.widgets[0]?.id === selectedAnalyticsWidget.id} onClick={() => updateAnalyticsDesign(current => { const widgets = [...current.widgets]; const index = widgets.findIndex(item => item.id === selectedAnalyticsWidget.id); if(index > 0) [widgets[index - 1], widgets[index]] = [widgets[index], widgets[index - 1]]; return {...current, widgets}; })}>上移</Button>
              <Button size="small" disabled={analyticsDesign.widgets[analyticsDesign.widgets.length - 1]?.id === selectedAnalyticsWidget.id} onClick={() => updateAnalyticsDesign(current => { const widgets = [...current.widgets]; const index = widgets.findIndex(item => item.id === selectedAnalyticsWidget.id); if(index >= 0 && index < widgets.length - 1) [widgets[index + 1], widgets[index]] = [widgets[index], widgets[index + 1]]; return {...current, widgets}; })}>下移</Button>
              <Button size="small" danger onClick={() => { updateAnalyticsDesign(current => ({...current, widgets: current.widgets.filter(item => item.id !== selectedAnalyticsWidget.id), interactions: current.interactions.filter(link => link.sourceWidgetId !== selectedAnalyticsWidget.id && link.targetWidgetId !== selectedAnalyticsWidget.id)})); setSelectedAnalyticsWidgetId(''); }}>删除组件</Button></Space>
              <label><span>标题</span><Input value={selectedAnalyticsWidget.title} onChange={(event) => updateAnalyticsWidget(selectedAnalyticsWidget.id, { title: event.target.value })} /></label>
              <label><span>图表类型</span><Select value={selectedAnalyticsWidget.type} options={[
                { value: 'metric-card', label: '指标卡' },
                { value: 'line', label: '折线图' },
                { value: 'bar', label: '柱状图' },
                { value: 'pie', label: '饼图' },
                { value: 'rank-table', label: '排行表' },
                { value: 'detail-table', label: '明细表' },
              ]} onChange={(type) => updateAnalyticsWidget(selectedAnalyticsWidget.id, { type })} /></label>
              <label><span>占位宽度</span><Select value={selectedAnalyticsWidget.width} options={[{ value: 'quarter', label: '25%' }, { value: 'half', label: '50%' }, { value: 'full', label: '100%' }]} onChange={(width) => updateAnalyticsWidget(selectedAnalyticsWidget.id, { width })} /></label>
            </section>
          )}

          {selectedAnalyticsWidget && (
            <section className="designer-prop-section">
              <strong className="designer-prop-section-title">数据绑定</strong>
              <label><span>数据集</span><Select value={selectedAnalyticsWidget.datasetId} options={analyticsDatasetOptions} onChange={(datasetId) => updateAnalyticsWidget(selectedAnalyticsWidget.id, { datasetId, metricIds: [], dimension: analyticsDesign.datasets.find(item => item.id === datasetId)?.dimensions[0] })} /></label>
              <label>
                <span>指标</span>
                <Select
                  mode="multiple"
                  value={selectedAnalyticsWidget.metricIds}
                  options={analyticsDesign.metrics.filter(metric => metric.datasetId === selectedAnalyticsWidget.datasetId).map(metric => ({value: metric.id, label: metric.name}))}
                  onChange={(metricIds) => updateAnalyticsWidget(selectedAnalyticsWidget.id, { metricIds })}
                  placeholder="选择当前组件指标"
                />
              </label>
              <label><span>维度</span><Select allowClear value={selectedAnalyticsWidget.dimension} options={(analyticsDesign.datasets.find(item => item.id === selectedAnalyticsWidget.datasetId)?.dimensions || []).map(value => ({value, label: value}))} onChange={dimension => updateAnalyticsWidget(selectedAnalyticsWidget.id, { dimension })} /></label>
            </section>
          )}

          {selectedAnalyticsWidget && (
            <section className="designer-prop-section">
              <strong className="designer-prop-section-title">交互行为</strong>
              <label><span>点击动作</span><Select value={selectedAnalyticsWidget.interaction} options={[
                { value: 'none', label: '无交互' },
                { value: 'filter', label: '点击筛选' },
                { value: 'drilldown', label: '下钻明细' },
                { value: 'navigate', label: '跳转业务页' },
              ]} onChange={(interaction) => updateAnalyticsWidget(selectedAnalyticsWidget.id, { interaction })} /></label>
            </section>
          )}
        </div>

      </aside>
    </div>
  );
}

export function AnalyticsFilterDesigner({ analyticsDesign, analyticsWidgetOptions, updateAnalyticsDesign }: AnalyticsFilterDesignerProps) {
  return (
    <div className="analytics-designer analytics-filter-designer">
      <section className="analytics-section">
        <div className="analytics-section-head">
          <div>
            <strong>全局筛选器</strong>
            <span>作用于整个看板，可绑定日期、组织、状态、供应商等维度。</span>
          </div>
          <Tag color="blue">{analyticsDesign.globalFilters.length} 个筛选器</Tag>
        </div>
        <Select
          mode="multiple"
          options={Array.from(new Set(analyticsDesign.datasets.flatMap(dataset => dataset.dimensions).concat(analyticsDesign.datasets.some(dataset => dataset.dimensions.includes('date')) ? ['dateRange'] : []))).map(value => ({value, label: value}))}
          className="analytics-full-control"
          value={analyticsDesign.globalFilters}
          onChange={(globalFilters) => updateAnalyticsDesign((current) => ({ ...current, globalFilters }))}
          placeholder="输入或选择筛选字段"
        />
      </section>
      <section className="analytics-section">
        <div className="analytics-section-head">
          <div>
            <strong>组件联动</strong>
            <span>配置点击图表后的筛选、下钻或跳转业务动作。</span>
          </div>
          <Button size="small" icon={<PlusOutlined />} onClick={() => updateAnalyticsDesign((current) => ({
            ...current,
            interactions: [
              ...current.interactions,
              {
                sourceWidgetId: current.widgets[0]?.id || '',
                targetWidgetId: current.widgets[current.widgets.length - 1]?.id || '',
                action: 'filter',
              },
            ],
          }))}>新增联动</Button>
        </div>
        <div className="analytics-interaction-list">
          {analyticsDesign.interactions.map((interaction, index) => (
            <div className="analytics-interaction-row" key={`${interaction.sourceWidgetId}-${interaction.targetWidgetId}-${index}`}>
              <Select value={interaction.sourceWidgetId} options={analyticsWidgetOptions} onChange={(sourceWidgetId) => updateAnalyticsDesign((current) => ({
                ...current,
                interactions: current.interactions.map((item, itemIndex) => itemIndex === index ? { ...item, sourceWidgetId } : item),
              }))} />
              <Select value={interaction.action} options={[
                { value: 'filter', label: '筛选目标组件' },
                { value: 'drilldown', label: '下钻明细' },
                { value: 'navigate', label: '跳转业务页' },
              ]} onChange={(action) => updateAnalyticsDesign((current) => ({
                ...current,
                interactions: current.interactions.map((item, itemIndex) => itemIndex === index ? { ...item, action } : item),
              }))} />
              <Select value={interaction.targetWidgetId} options={analyticsWidgetOptions.filter(item => item.value !== interaction.sourceWidgetId)} onChange={(targetWidgetId) => updateAnalyticsDesign((current) => ({
                ...current,
                interactions: current.interactions.map((item, itemIndex) => itemIndex === index ? { ...item, targetWidgetId } : item),
              }))} /><Button danger size="small" title="删除联动" icon={<DeleteOutlined />} onClick={() => updateAnalyticsDesign(current => ({...current, interactions: current.interactions.filter((_, itemIndex) => itemIndex !== index)}))} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export function AnalyticsStyleDesigner({ analyticsStyle, updateAnalyticsStyle }: AnalyticsStyleDesignerProps) {
  return (
    <div className="analytics-designer analytics-style-designer">
      <section className="analytics-section">
        <div className="analytics-section-head">
          <div>
            <strong>主题预设</strong>
            <span>先选择看板整体气质，再按业务场景微调组件与图表样式。</span>
          </div>
          <Tag color="blue">主题应用于整张看板</Tag>
        </div>
        <div className="analytics-style-preset-grid">
          {[
            { value: 'clean' as const, label: '清爽运营', desc: '白底、轻边框，适合日常管理看板' },
            { value: 'executive' as const, label: '经营驾驶舱', desc: '高对比指标卡，适合管理层总览' },
            { value: 'factory' as const, label: '工厂现场', desc: '偏设备与产线监控，强调状态识别' },
            { value: 'dark' as const, label: '深色大屏', desc: '适合投屏、战情室和全天候展示' },
          ].map((preset) => (
            <button
              className={`analytics-style-preset ${analyticsStyle.preset === preset.value ? 'analytics-style-preset-active' : ''}`}
              key={preset.value}
              type="button"
              onClick={() => updateAnalyticsStyle({ preset: preset.value, background: preset.value === 'dark' ? '#101c26' : preset.value === 'factory' ? '#edf4f5' : preset.value === 'executive' ? '#f1f3f8' : '#f6f8fa', cardBorder: preset.value === 'executive' ? 'strong' : 'light', chartPalette: preset.value === 'executive' ? 'business' : 'manufacturing' })}
            >
              <strong>{preset.label}</strong>
              <span>{preset.desc}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="analytics-section">
        <div className="analytics-section-head">
          <div>
            <strong>画布与组件</strong>
            <span>控制整张看板的背景、间距、卡片形态和视觉密度。</span>
          </div>
        </div>
        <div className="analytics-style-form-grid">
          <label><span>画布背景</span><Input value={analyticsStyle.background} onChange={(event) => updateAnalyticsStyle({ background: event.target.value })} /></label>
          <label><span>组件间距</span><InputNumber min={0} max={32} value={analyticsStyle.componentGap} onChange={(componentGap) => updateAnalyticsStyle({ componentGap: Number(componentGap || 0) })} /></label>
          <label><span>卡片圆角</span><InputNumber min={0} max={20} value={analyticsStyle.cardRadius} onChange={(cardRadius) => updateAnalyticsStyle({ cardRadius: Number(cardRadius || 0) })} /></label>
          <label><span>卡片边框</span><Select value={analyticsStyle.cardBorder} options={[
            { value: 'none', label: '无边框' },
            { value: 'light', label: '轻边框' },
            { value: 'strong', label: '强调边框' },
          ]} onChange={(cardBorder) => updateAnalyticsStyle({ cardBorder })} /></label>
        </div>
      </section>

      <section className="analytics-section">
        <div className="analytics-section-head">
          <div>
            <strong>图表、表格与筛选器</strong>
            <span>统一配置图表色板、表格密度和过滤组件主题。</span>
          </div>
        </div>
        <div className="analytics-style-form-grid">
          <label><span>图表配色</span><Select value={analyticsStyle.chartPalette} options={[
            { value: 'manufacturing', label: '制造蓝绿' },
            { value: 'business', label: '经营彩色' },
            { value: 'warning', label: '风险预警' },
            { value: 'mono', label: '单色专业' },
          ]} onChange={(chartPalette) => updateAnalyticsStyle({ chartPalette })} /></label>
          <label><span>表格密度</span><Select value={analyticsStyle.tableDensity} options={[
            { value: 'compact', label: '紧凑' },
            { value: 'standard', label: '标准' },
            { value: 'comfortable', label: '宽松' },
          ]} onChange={(tableDensity) => updateAnalyticsStyle({ tableDensity })} /></label>
          <label><span>筛选器样式</span><Select value={analyticsStyle.filterTheme} options={[
            { value: 'toolbar', label: '顶部工具栏' },
            { value: 'inline', label: '嵌入画布' },
            { value: 'panel', label: '侧边筛选面板' },
          ]} onChange={(filterTheme) => updateAnalyticsStyle({ filterTheme })} /></label>
        </div>
      </section>
    </div>
  );
}
