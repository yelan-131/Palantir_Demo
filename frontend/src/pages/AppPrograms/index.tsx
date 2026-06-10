import React from 'react';
import { AppstoreOutlined, ArrowLeftOutlined, BarChartOutlined, CheckCircleOutlined, DatabaseOutlined, DownloadOutlined, ExperimentOutlined, ExpandOutlined, FieldTimeOutlined, FileSearchOutlined, LineChartOutlined, PlusOutlined, ReloadOutlined, SearchOutlined, SettingOutlined, ShopOutlined, ToolOutlined, UploadOutlined, WarningOutlined } from '@ant-design/icons';
import { Button, Card, Col, DatePicker, Descriptions, Drawer, Empty, Form, Input, InputNumber, Modal, Progress, Row, Select, Skeleton, Space, Statistic, Table, Tabs, Tag, Timeline, Tooltip, Typography, message } from 'antd';
import type { ColumnsType, ColumnType } from 'antd/es/table';
import { useNavigate, useParams } from 'react-router-dom';
import DashboardPage from '../Dashboard';
import {
  createPlatformDynamicRecord,
  getAppProgramData,
  getPlatformForm,
  listPlatformForms,
  type PlatformForm,
  type PlatformFormField,
} from '@/services/api';
import {
  normalizeViewConfig,
  sortByOrder,
  type ViewConfig,
  type ViewFilterConfig,
} from '@/utils/viewConfig';
import './style.css';

const { RangePicker } = DatePicker;

type ProgramKind = 'business' | 'analysis';

type ProgramRow = Record<string, unknown>;

function isDataColumn(column: ColumnsType<ProgramRow>[number]): column is ColumnType<ProgramRow> {
  return 'dataIndex' in column;
}

interface ProgramDefinition {
  id: string;
  title: string;
  subtitle: string;
  kind: ProgramKind;
  owner: string;
  icon: React.ReactNode;
  metrics: Array<{
    label: string;
    value: string | number;
    suffix?: string;
    tone: 'blue' | 'green' | 'orange' | 'red';
  }>;
  focus: string[];
  columns: ColumnsType<ProgramRow>;
  rows: ProgramRow[];
  viewConfig?: ViewConfig;
}

interface ProgramDataPayload {
  metrics?: ProgramDefinition['metrics'];
  rows?: ProgramRow[];
  viewConfig?: ViewConfig;
  analyticsDesign?: RuntimeAnalyticsDesign | null;
  analyticsData?: {
    metricValues?: Record<string, string | number>;
    rows?: ProgramRow[];
  };
  form?: {
    id: number;
    code: string;
    name: string;
    kind?: string;
  } | null;
  source?: string;
}

type RuntimeAnalyticsWidgetType = 'metric-card' | 'line' | 'bar' | 'pie' | 'rank-table' | 'detail-table';

interface RuntimeAnalyticsMetric {
  id: string;
  name: string;
  format?: 'number' | 'percent' | 'currency' | string;
}

interface RuntimeAnalyticsWidget {
  id: string;
  title: string;
  type: RuntimeAnalyticsWidgetType | string;
  datasetId?: string;
  metricIds?: string[];
  dimension?: string;
  width?: 'quarter' | 'half' | 'full' | string;
  interaction?: string;
}

interface RuntimeAnalyticsDesign {
  metrics?: RuntimeAnalyticsMetric[];
  widgets?: RuntimeAnalyticsWidget[];
  style?: Record<string, unknown>;
}

const programDefinitions: Record<string, ProgramDefinition> = {
  'alert-center': {
    id: 'alert-center',
    title: '告警中心',
    subtitle: '聚合设备、质量、交付和库存告警，支持处置优先级排序。',
    kind: 'business',
    owner: '运营指挥',
    icon: <WarningOutlined />,
    metrics: [
      { label: '未关闭告警', value: 308, tone: 'orange' },
      { label: '严重告警', value: 28, tone: 'red' },
      { label: '已确认', value: 96, tone: 'blue' },
      { label: '已关闭', value: 52, tone: 'green' },
    ],
    focus: ['告警等级', '责任域分派', '处置时效'],
    columns: [
      { title: '告警', dataIndex: 'name' },
      { title: '来源', dataIndex: 'source' },
      { title: '等级', dataIndex: 'level', render: (value) => <Tag color={value === '严重' ? 'red' : value === '中等' ? 'orange' : 'blue'}>{value}</Tag> },
      { title: '状态', dataIndex: 'status' },
    ],
    rows: [],
  },
  'risk-review': {
    id: 'risk-review',
    title: '风险复核',
    subtitle: '对供应链风险进行人工复核、定级、分派和关闭。',
    kind: 'business',
    owner: '供应链风控',
    icon: <FileSearchOutlined />,
    metrics: [
      { label: '待复核', value: 17, tone: 'orange' },
      { label: '升级处理', value: 4, tone: 'red' },
      { label: '已关闭', value: 29, tone: 'green' },
      { label: '平均响应', value: 3.4, suffix: 'h', tone: 'blue' },
    ],
    focus: ['风险复核结论', '责任人分派', '处置闭环'],
    columns: [
      { title: '风险单', dataIndex: 'riskNo' },
      { title: '主题', dataIndex: 'subject' },
      { title: '等级', dataIndex: 'level', render: (value) => <Tag color={value === '高' ? 'red' : 'orange'}>{value}</Tag> },
      { title: '处理人', dataIndex: 'owner' },
    ],
    rows: [],
  },
};

const fieldLabelMap: Record<string, string> = {
  riskNo: '风险单',
  subject: '主题',
  level: '等级',
  owner: '处理人',
  material: '料号 / 物料',
  supplier: '供应商',
  category: '品类',
  risk: '风险',
  reason: '原因',
  action: '建议动作',
  status: '状态',
  asset: '设备',
  health: '健康度',
  line: '产线',
  product: '产品',
  count: '数量',
};
const toneClassMap: Record<ProgramDefinition['metrics'][number]['tone'], string> = {
  blue: 'program-stat-blue',
  green: 'program-stat-green',
  orange: 'program-stat-orange',
  red: 'program-stat-red',
};
const routedProgramIds = new Set<string>();
const configuredFormProgramIds = new Set([
  'production-plan-entry',
  'maintenance-order',
  'equipment-inspection',
  'inspection-batch',
  'quality-event',
  'capa-tracking',
  'inventory-impact',
  'supplier-scorecard',
  'ai_material_master_form_5',
  'production-overview',
  'oee-trend-report',
  'line-status',
  'line-load-analysis',
  'device-health',
  'device-health-dashboard',
  'fault-prediction',
  'failure-trend-analysis',
  'quality-overview',
  'defect-analysis',
  'defect-analysis-report',
  'process-capability-dashboard',
  'supplier-risk',
  'material-impact',
  'material-impact-report',
  'supply-overview',
  'supply-risk-dashboard',
]);

function hasRuntimeAnalyticsDesign(payload: ProgramDataPayload | null | undefined): payload is ProgramDataPayload & { analyticsDesign: RuntimeAnalyticsDesign } {
  return Boolean(payload?.analyticsDesign?.widgets?.length);
}

function hasConfiguredFormRuntime(payload: ProgramDataPayload | null | undefined): payload is ProgramDataPayload & { form: NonNullable<ProgramDataPayload['form']> } {
  return Boolean(payload?.form);
}

function buildConfiguredProgram(programId: string, payload: ProgramDataPayload, fallback?: ProgramDefinition): ProgramDefinition {
  const form = payload.form;
  const viewColumns = payload.viewConfig?.table?.columns || [];
  const columns: ColumnsType<ProgramRow> = viewColumns.map((column) => ({
    title: column.label,
    dataIndex: column.fieldName,
    key: column.fieldName,
    width: column.width,
  }));
  return {
    id: form?.code || programId,
    title: form?.name || fallback?.title || programId,
    subtitle: fallback?.subtitle || '后台配置驱动的业务交互表',
    kind: form?.kind === 'analysis' ? 'analysis' : 'business',
    owner: fallback?.owner || '业务配置',
    icon: fallback?.icon || <DatabaseOutlined />,
    metrics: Array.isArray(payload.metrics) ? payload.metrics : [],
    focus: fallback?.focus || [],
    columns,
    rows: Array.isArray(payload.rows) ? payload.rows : [],
    viewConfig: payload.viewConfig || fallback?.viewConfig,
  };
}

function AppProgramPage() {
  const { programId } = useParams();
  const navigate = useNavigate();
  const [programData, setProgramData] = React.useState<ProgramDataPayload | null | undefined>(undefined);
  const [programLoading, setProgramLoading] = React.useState(false);

  const staticProgram = programId ? programDefinitions[programId] : undefined;
  const baseProgram = programId && configuredFormProgramIds.has(programId) ? undefined : staticProgram;
  const loadProgramData = React.useCallback(async () => {
    if (!programId || routedProgramIds.has(programId)) {
      setProgramData(null);
      return;
    }
    setProgramLoading(true);
    try {
      const response = await getAppProgramData(programId, 500);
      const payload = response.data as ProgramDataPayload;
      setProgramData(payload?.form || payload?.viewConfig || payload?.rows || payload?.metrics || payload?.analyticsDesign ? payload : null);
    } catch {
      setProgramData(null);
    } finally {
      setProgramLoading(false);
    }
  }, [programId]);

  React.useEffect(() => {
    setProgramData(undefined);
    void loadProgramData();
  }, [loadProgramData]);

  const program = React.useMemo(() => {
    if (hasConfiguredFormRuntime(programData) && programId) {
      return buildConfiguredProgram(programId, programData, baseProgram);
    }
    if (!baseProgram) return undefined;
    const serverRows = Array.isArray(programData?.rows) ? programData.rows : [];
    const serverMetrics = Array.isArray(programData?.metrics) ? programData.metrics : [];
    return {
      ...baseProgram,
      metrics: serverMetrics,
      rows: serverRows,
      viewConfig: programData?.viewConfig || baseProgram.viewConfig,
    };
  }, [baseProgram, programData, programId]);

  if (programData === undefined || programLoading) {
    return (
      <div className="dashboard-page">
        <Skeleton active paragraph={{ rows: 12 }} />
      </div>
    );
  }

  if (programId === 'production-overview') {
    if (programData === undefined || programLoading) {
      return (
        <div className="dashboard-page">
          <Skeleton active paragraph={{ rows: 12 }} />
        </div>
      );
    }
    if (hasRuntimeAnalyticsDesign(programData) && program) {
      return (
        <ConfiguredAnalysisDashboard
          program={program}
          payload={programData}
          onSettings={() => navigate('/form-settings/production-overview?tab=dashboard')}
          onReload={loadProgramData}
          loading={programLoading}
        />
      );
    }
    if (hasConfiguredFormRuntime(programData) && program) {
      return (
        <div className="app-program-page app-program-business">
          <BusinessProgram
            program={{ ...program, kind: 'business' }}
            onSettings={() => navigate('/form-settings/production-overview?tab=dashboard')}
            onReload={loadProgramData}
            loading={programLoading}
          />
        </div>
      );
    }
    return <DashboardPage />;
  }

  if (!program) {
    return (
      <Card>
        <Empty description="未找到对应表单页面">
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>返回</Button>
        </Empty>
      </Card>
    );
  }

  const openSettings = () => {
    const tab = programData?.form?.kind === 'analysis' ? '?tab=dashboard' : '';
    navigate(`/form-settings/${program.id}${tab}`);
  };

  return (
    <div className={`app-program-page app-program-${program.kind}`}>
      {hasRuntimeAnalyticsDesign(programData) ? (
        <ConfiguredAnalysisDashboard program={program} payload={programData} onSettings={openSettings} onReload={loadProgramData} loading={programLoading} />
      ) : hasConfiguredFormRuntime(programData) || program.kind === 'business' ? (
        <BusinessProgram program={program} onSettings={openSettings} onReload={loadProgramData} loading={programLoading} />
      ) : (
        <>
          <ProgramHeader program={program} onSettings={openSettings} onReload={loadProgramData} loading={programLoading} />
          <AnalysisProgram program={program} onSettings={openSettings} loading={programLoading} />
        </>
      )}
    </div>
  );
}

function ProgramHeader({
  program,
  onSettings,
  onReload,
  loading,
}: {
  program: ProgramDefinition;
  onSettings: () => void;
  onReload: () => void;
  loading?: boolean;
}) {
  return (
    <div className="app-program-header">
      <div className="app-program-title-block">
        <span className="app-program-icon">{program.icon}</span>
        <div>
          <Space size={8} align="center" wrap>
            <Typography.Title level={3}>{program.title}</Typography.Title>
            <Tag color={program.kind === 'analysis' ? 'blue' : 'green'}>
              {program.kind === 'analysis' ? '分析看板' : '业务交互'}
            </Tag>
          </Space>
          <Typography.Text type="secondary">{program.subtitle}</Typography.Text>
        </div>
      </div>
      <Space wrap>
        <Button icon={<ReloadOutlined />} loading={loading} onClick={onReload}>刷新</Button>
        <Button icon={<DownloadOutlined />}>导出</Button>
        <Button icon={<ExpandOutlined />}>全屏</Button>
        <Button icon={<BarChartOutlined />}>切换维度</Button>
        <Button icon={<SettingOutlined />} onClick={onSettings}>设置</Button>
      </Space>
    </div>
  );
}

function formatRuntimeMetricValue(value: string | number | undefined, metric?: RuntimeAnalyticsMetric) {
  if (value === undefined || value === null || value === '') return metric?.format === 'percent' ? '0%' : '0';
  if (metric?.format === 'percent') return `${value}%`;
  if (metric?.format === 'currency') return `¥${Number(value || 0).toLocaleString('zh-CN')}`;
  return typeof value === 'number' ? value.toLocaleString('zh-CN') : value;
}

function pickRuntimeRows(payload: ProgramDataPayload): ProgramRow[] {
  const runtimeRows = payload.analyticsData?.rows;
  if (Array.isArray(runtimeRows) && runtimeRows.length) return runtimeRows;
  return Array.isArray(payload.rows) ? payload.rows : [];
}

function readRuntimeNumber(row: ProgramRow, keys: string[], fallback: number) {
  for (const key of keys) {
    const value = row[key];
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return fallback;
}

function ConfiguredAnalysisDashboard({
  program,
  payload,
  onSettings,
  onReload,
  loading,
}: {
  program: ProgramDefinition;
  payload: ProgramDataPayload & { analyticsDesign: RuntimeAnalyticsDesign };
  onSettings: () => void;
  onReload: () => void;
  loading?: boolean;
}) {
  const design = payload.analyticsDesign;
  const widgets = design.widgets || [];
  const metrics = design.metrics || [];
  const metricMap = new Map(metrics.map((metric) => [metric.id, metric]));
  const metricValues = payload.analyticsData?.metricValues || {};
  const rows = pickRuntimeRows(payload);
  const chartRows = rows.length ? rows.slice(-8) : Array.from({ length: 4 }).map((_, index) => ({ key: `sample-${index}`, actual: 24 + index * 12 }));

  const renderMetricCards = (widget: RuntimeAnalyticsWidget) => {
    const metricIds = widget.metricIds?.length ? widget.metricIds : metrics.slice(0, 3).map((metric) => metric.id);
    return (
      <div className="runtime-analytics-metrics">
        {metricIds.map((metricId) => {
          const metric = metricMap.get(metricId);
          return (
            <div key={metricId}>
              <span>{metric?.name || metricId}</span>
              <strong>{formatRuntimeMetricValue(metricValues[metricId], metric)}</strong>
            </div>
          );
        })}
      </div>
    );
  };

  const renderChart = (widget: RuntimeAnalyticsWidget) => {
    const values = chartRows.map((row, index) => readRuntimeNumber(row, ['actual', 'planned', 'yieldRate', 'value'], 24 + index * 16));
    const max = Math.max(...values, 1);
    return (
      <div className={`runtime-analytics-chart runtime-analytics-chart-${widget.type}`}>
        {values.map((value, index) => (
          <span key={`${widget.id}-${index}`} style={{ height: `${Math.max(18, Math.round((value / max) * 100))}%` }} />
        ))}
      </div>
    );
  };

  const renderTable = (widget: RuntimeAnalyticsWidget) => {
    const sample = rows[0] || {};
    const keys = Object.keys(sample).filter((key) => !key.startsWith('_') && key !== 'key').slice(0, 4);
    const dataKeys = keys.length ? keys : ['date', 'planned', 'actual', 'status'];
    const columns = dataKeys.map((key) => ({
      title: key === widget.dimension ? '对象' : fieldLabelMap[key] || key,
      dataIndex: key,
      key,
      ellipsis: true,
      render: (value: unknown) => formatDetailValue(value),
    }));
    return (
      <Table
        columns={columns}
        dataSource={rows.slice(0, widget.type === 'rank-table' ? 6 : 8)}
        pagination={false}
        rowKey={(row, index) => String(row.key || row.date || row.id || `row-${index}`)}
        size="small"
      />
    );
  };

  const renderWidgetBody = (widget: RuntimeAnalyticsWidget) => {
    if (widget.type === 'metric-card') return renderMetricCards(widget);
    if (widget.type === 'rank-table' || widget.type === 'detail-table') return renderTable(widget);
    if (widget.type === 'pie') {
      const percentValue = Number(metricValues[widget.metricIds?.[0] || ''] || 68);
      return <Progress type="circle" percent={Math.max(0, Math.min(100, percentValue))} size={142} />;
    }
    return renderChart(widget);
  };

  return (
    <div className="app-program-page app-program-analysis runtime-analytics-page">
      <ProgramHeader program={program} onSettings={onSettings} onReload={onReload} loading={loading} />
      <div className="runtime-analytics-canvas">
        {widgets.map((widget) => (
          <Card
            className={`runtime-analytics-widget runtime-analytics-widget-${widget.width || 'half'}`}
            key={widget.id}
            size="small"
            title={widget.title}
            extra={<Tag>{widget.type}</Tag>}
          >
            {renderWidgetBody(widget)}
          </Card>
        ))}
      </div>
    </div>
  );
}

function programFieldsForView(program: ProgramDefinition) {
  return program.columns
    .map((column) => {
      if (!isDataColumn(column)) return null;
      const dataColumn = column;
      const fieldName = typeof dataColumn.dataIndex === 'string' ? dataColumn.dataIndex : '';
      if (!fieldName) return null;
      return {
        fieldName,
        label: typeof dataColumn.title === 'string' ? dataColumn.title : fieldName,
        fieldType: fieldName.includes('status') || fieldName.includes('level') ? 'enum' : 'text',
        searchable: true,
        sortable: Boolean(dataColumn.sorter),
        visibleInList: true,
      };
    })
    .filter((field): field is NonNullable<typeof field> => Boolean(field));
}

function programValueMatchesFilter(row: ProgramRow, filter: ViewFilterConfig, value: unknown) {
  if (value === undefined || value === null || value === '') return true;
  const actual = row[filter.fieldName];
  if (filter.operator === 'equals') return String(actual) === String(value);
  return String(actual || '').toLowerCase().includes(String(value).toLowerCase());
}

function getRowFormData(row: ProgramRow | null): Record<string, unknown> {
  const formData = row?._formData;
  if (formData && typeof formData === 'object' && !Array.isArray(formData)) {
    return formData as Record<string, unknown>;
  }
  return row || {};
}

function formatDetailValue(value: unknown) {
  if (value === undefined || value === null || value === '') return '-';
  if (Array.isArray(value) || typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function readProgramField(row: ProgramRow | null, key: string, fallback = '-') {
  if (!row) return fallback;
  const formData = getRowFormData(row);
  const value = row[key] ?? formData[key];
  if (value === undefined || value === null || value === '') return fallback;
  return formatDetailValue(value);
}

function parseAlertTime(value: unknown) {
  if (!value) return null;
  const timestamp = Date.parse(String(value));
  return Number.isNaN(timestamp) ? null : timestamp;
}

function formatAlertTime(value: unknown) {
  const timestamp = parseAlertTime(value);
  if (!timestamp) return formatDetailValue(value);
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp);
}

function getAlertTone(row: ProgramRow | null) {
  const level = readProgramField(row, 'level', '');
  if (level.includes('严重') || level.includes('critical')) return 'critical';
  if (level.includes('中') || level.includes('高') || level.includes('warning')) return 'warning';
  if (level.includes('提醒') || level.includes('minor')) return 'notice';
  return 'normal';
}

function getAlertTagColor(row: ProgramRow | null) {
  const tone = getAlertTone(row);
  if (tone === 'critical') return 'red';
  if (tone === 'warning') return 'orange';
  if (tone === 'notice') return 'blue';
  return 'geekblue';
}

function isAlertClosed(row: ProgramRow | null) {
  const status = readProgramField(row, 'status', '');
  const processStatus = readProgramField(row, 'processStatus', '');
  return status.includes('关闭') || processStatus.includes('完成') || processStatus.includes('closed');
}

function getAlertSlaPercent(row: ProgramRow | null) {
  const occurred = parseAlertTime(row ? readProgramField(row, 'occurredAt', '') : '');
  const due = parseAlertTime(row ? readProgramField(row, 'dueAt', '') : '');
  const completed = parseAlertTime(row ? readProgramField(row, 'completedAt', '') : '');
  if (!occurred || !due || due <= occurred) return isAlertClosed(row) ? 100 : 62;
  const compareAt = completed || Date.now();
  return Math.max(6, Math.min(100, Math.round(((compareAt - occurred) / (due - occurred)) * 100)));
}

function getAlertSlaStatus(row: ProgramRow | null): 'success' | 'normal' | 'exception' {
  if (isAlertClosed(row)) return 'success';
  return getAlertSlaPercent(row) >= 92 ? 'exception' : 'normal';
}

function getAlertEvidenceCount(row: ProgramRow | null) {
  if (!row) return 0;
  const formData = getRowFormData(row);
  const evidence = row.evidence ?? formData.evidence;
  return Array.isArray(evidence) ? evidence.length : evidence ? 1 : 0;
}

function getInteractionEntries(row: ProgramRow | null) {
  const formData = getRowFormData(row);
  const source = formData.interactionLog || row?.interactionLog;
  if (!Array.isArray(source)) {
    return [];
  }
  return source.map((item, index) => {
    if (item && typeof item === 'object') {
      const entry = item as Record<string, unknown>;
      return {
        title: String(entry.action || entry.title || `处理记录 ${index + 1}`),
        description: [entry.time, entry.actor].filter(Boolean).map(String).join(' · ') || '系统记录',
      };
    }
    return { title: String(item), description: '系统记录' };
  });
}

function AlertBusinessProgram({
  program,
  onSettings,
  onReload,
  loading,
}: {
  program: ProgramDefinition;
  onSettings: () => void;
  onReload: () => void;
  loading?: boolean;
}) {
  const [selectedRow, setSelectedRow] = React.useState<ProgramRow | null>(null);
  const [filterValues, setFilterValues] = React.useState<Record<string, unknown>>({});
  const [filterForm] = Form.useForm();
  const viewConfig = React.useMemo(() => normalizeViewConfig(program.viewConfig, programFieldsForView(program)), [program]);
  const activeFilters = React.useMemo(() => sortByOrder(viewConfig.filters).filter((filter) => filter.enabled), [viewConfig.filters]);
  const viewColumns = React.useMemo(() => sortByOrder(viewConfig.table.columns).filter((column) => column.enabled), [viewConfig.table.columns]);
  const filteredRows = React.useMemo(() => program.rows.filter((row) => activeFilters.every((filter) => (
    programValueMatchesFilter(row, filter, filterValues[filter.id] ?? filter.defaultValue)
  ))), [activeFilters, filterValues, program.rows]);
  const selectedKey = selectedRow ? String(selectedRow.key || selectedRow.recordId || selectedRow.alertId || '') : '';

  React.useEffect(() => {
    if (!filteredRows.length) {
      setSelectedRow(null);
      return;
    }
    const stillVisible = selectedRow && filteredRows.some((row) => String(row.key || row.recordId || row.alertId) === selectedKey);
    if (!stillVisible) setSelectedRow(filteredRows[0]);
  }, [filteredRows, selectedKey, selectedRow]);

  const configuredColumns = React.useMemo(() => {
    const columns: ColumnsType<ProgramRow> = viewColumns
      .map<ColumnType<ProgramRow>>((viewColumn) => {
        const source = program.columns.find((column) => isDataColumn(column) && column.dataIndex === viewColumn.fieldName) as ColumnType<ProgramRow> | undefined;
        const renderCell = (value: unknown, record: ProgramRow) => {
          const formData = getRowFormData(record);
          const actual = value ?? formData[viewColumn.fieldName];
          if (actual === undefined || actual === null || actual === '') return viewColumn.emptyText || '-';
          if (viewColumn.fieldName === 'level') return <Tag color={getAlertTagColor(record)}>{String(actual)}</Tag>;
          if (viewColumn.fieldName === 'status' || viewColumn.fieldName === 'processStatus') return <Tag color={isAlertClosed(record) ? 'default' : 'blue'}>{String(actual)}</Tag>;
          if (viewColumn.fieldName === 'occurredAt' || viewColumn.fieldName === 'dueAt') return formatAlertTime(actual);
          if (viewColumn.fieldName === 'title') return <Typography.Text strong>{String(actual)}</Typography.Text>;
          if (viewColumn.renderType === 'tag') return <Tag>{String(actual)}</Tag>;
          return String(actual);
        };
        return {
          ...(source || {}),
          title: viewColumn.label,
          dataIndex: source?.dataIndex || viewColumn.fieldName,
          key: source?.key || viewColumn.fieldName,
          width: viewColumn.width || (viewColumn.fieldName === 'title' ? 240 : 130),
          fixed: viewColumn.fixed,
          sorter: viewColumn.sortable ? source?.sorter || ((a: ProgramRow, b: ProgramRow) => String(a[viewColumn.fieldName] || '').localeCompare(String(b[viewColumn.fieldName] || ''))) : undefined,
          render: source?.render || renderCell,
        };
      });
    return [
      ...columns,
      {
        title: '操作',
        key: 'action',
        fixed: 'right' as const,
        width: 132,
        render: (_: unknown, record: ProgramRow) => (
          <Space onClick={(event) => event.stopPropagation()}>
            <Button type="link" size="small" onClick={() => setSelectedRow(record)}>查看</Button>
            <Button type="link" size="small">处理</Button>
          </Space>
        ),
      },
    ];
  }, [program.columns, viewColumns]);

  const renderFilterControl = (filter: ViewFilterConfig) => {
    const placeholder = filter.placeholder || filter.label;
    if (filter.controlType === 'dateRange') return <RangePicker />;
    if (filter.controlType === 'select' || filter.controlType === 'relation' || filter.operator === 'equals') {
      const options = Array.from(new Set(program.rows.map((row) => row[filter.fieldName] ?? getRowFormData(row)[filter.fieldName]).filter(Boolean))).map((value) => ({ value: String(value), label: String(value) }));
      return <Select allowClear placeholder={placeholder} options={options} />;
    }
    return <Input allowClear prefix={filter.controlType === 'keyword' || filter.fieldName === 'title' ? <SearchOutlined /> : undefined} placeholder={placeholder} />;
  };

  const selectedTitle = readProgramField(selectedRow, 'title', readProgramField(selectedRow, 'name', '告警记录'));
  const interactionEntries = React.useMemo(() => getInteractionEntries(selectedRow), [selectedRow]);

  return (
    <div className="alert-business-page">
      <div className="alert-business-header">
        <div className="alert-business-heading">
          <span className="alert-business-icon"><WarningOutlined /></span>
          <div>
            <Space size={8} align="center" wrap>
              <Typography.Title level={4}>告警中心</Typography.Title>
              <Tag color="green">业务交互</Tag>
            </Space>
            <Typography.Text type="secondary">用于告警登记、确认、派工、处理和关闭；不是独立分析看板。</Typography.Text>
          </div>
        </div>
        <div className="alert-business-actions">
          <Tooltip title="新增告警">
            <Button type="primary" aria-label="新增告警" icon={<PlusOutlined />}>新增告警</Button>
          </Tooltip>
          <Tooltip title="批量处理">
            <Button className="alert-business-batch-action" aria-label="批量处理" icon={<CheckCircleOutlined />} disabled={!selectedRow}>批量处理</Button>
          </Tooltip>
          <Tooltip title="刷新">
            <Button aria-label="刷新" icon={<ReloadOutlined />} loading={loading} onClick={onReload}>刷新</Button>
          </Tooltip>
          <Tooltip title="导出">
            <Button aria-label="导出" icon={<DownloadOutlined />}>导出</Button>
          </Tooltip>
          <Tooltip title="设置">
            <Button aria-label="设置" icon={<SettingOutlined />} onClick={onSettings}>设置</Button>
          </Tooltip>
        </div>
      </div>

      <Form
        className="alert-business-filter-form"
        form={filterForm}
        colon={false}
        layout="horizontal"
        onFinish={(values) => setFilterValues(values)}
      >
        {activeFilters.slice(0, 8).map((filter) => (
          <Form.Item key={filter.id} name={filter.id} label={filter.label} initialValue={filter.defaultValue}>
            {renderFilterControl(filter)}
          </Form.Item>
        ))}
        <Form.Item className="alert-business-filter-actions" label=" ">
          <Space>
            <Button onClick={() => { filterForm.resetFields(); setFilterValues({}); }}>重置</Button>
            <Button type="primary" htmlType="submit" icon={<SearchOutlined />}>查询</Button>
          </Space>
        </Form.Item>
      </Form>

      <div className="alert-business-body">
        <section className="alert-business-table-panel">
          <Table<ProgramRow>
            className="alert-business-table"
            rowKey={(record) => String(record.key || record.recordId || record.alertId)}
            size={viewConfig.table.density === 'compact' ? 'small' : 'middle'}
            columns={configuredColumns}
            dataSource={filteredRows}
            loading={loading}
            pagination={{ pageSize: viewConfig.table.pageSize, showSizeChanger: false, showTotal: (total) => `共 ${total} 条记录` }}
            scroll={{ x: 1280, y: '100%' }}
            rowClassName={(record) => String(record.key || record.recordId || record.alertId) === selectedKey ? 'alert-business-row-selected' : ''}
            onRow={(record) => ({
              onClick: () => setSelectedRow(record),
            })}
          />
        </section>

        <aside className="alert-business-record-panel">
          {selectedRow ? (
            <>
              <div className="alert-business-record-head">
                <div>
                  <Typography.Title level={5}>{selectedTitle}</Typography.Title>
                  <Typography.Text type="secondary">{readProgramField(selectedRow, 'alertId', String(selectedKey))}</Typography.Text>
                </div>
                <Tag color={isAlertClosed(selectedRow) ? 'default' : 'processing'}>{readProgramField(selectedRow, 'status', '-')}</Tag>
              </div>

              <Descriptions size="small" column={1} className="alert-business-descriptions">
                <Descriptions.Item label="关联设备">{readProgramField(selectedRow, 'device', '-')}</Descriptions.Item>
                <Descriptions.Item label="告警等级"><Tag color={getAlertTagColor(selectedRow)}>{readProgramField(selectedRow, 'level', '一般')}</Tag></Descriptions.Item>
                <Descriptions.Item label="告警来源">{readProgramField(selectedRow, 'source', '-')}</Descriptions.Item>
                <Descriptions.Item label="发生时间">{formatAlertTime(readProgramField(selectedRow, 'occurredAt', ''))}</Descriptions.Item>
                <Descriptions.Item label="处理时限">{formatAlertTime(readProgramField(selectedRow, 'dueAt', ''))}</Descriptions.Item>
                <Descriptions.Item label="当前处理人">{readProgramField(selectedRow, 'currentHandler', readProgramField(selectedRow, 'owner', '未分配'))}</Descriptions.Item>
              </Descriptions>

              <div className="alert-business-sla">
                <div>
                  <span>SLA 进度</span>
                  <strong>{getAlertSlaPercent(selectedRow)}%</strong>
                </div>
                <Progress percent={getAlertSlaPercent(selectedRow)} status={getAlertSlaStatus(selectedRow)} />
              </div>

              <div className="alert-business-section">
                <div className="alert-business-section-title">处置结论</div>
                <p>{readProgramField(selectedRow, 'resolution', isAlertClosed(selectedRow) ? '已关闭，等待归档复核。' : '等待责任人补充处置结论。')}</p>
              </div>

              <div className="alert-business-section">
                <div className="alert-business-section-title">流程记录</div>
                <Timeline
                  items={(interactionEntries.length ? interactionEntries : [
                    { title: '创建告警', description: formatAlertTime(readProgramField(selectedRow, 'occurredAt', '')) },
                    { title: readProgramField(selectedRow, 'currentNode', '业务处理'), description: readProgramField(selectedRow, 'currentHandler', readProgramField(selectedRow, 'owner', '未分配')) },
                  ]).map((entry, index) => ({
                    color: index === 0 ? 'blue' : isAlertClosed(selectedRow) ? 'green' : 'gray',
                    children: (
                      <div className="workflow-step-item">
                        <strong>{entry.title}</strong>
                        <span>{entry.description}</span>
                      </div>
                    ),
                  }))}
                />
              </div>

              <Space wrap className="alert-business-record-actions">
                <Button type="primary">处理</Button>
                <Button>转派</Button>
                <Button>关闭</Button>
              </Space>
            </>
          ) : (
            <Empty description="请选择一条告警记录" />
          )}
        </aside>
      </div>
    </div>
  );
}

type BusinessCreateField = Pick<
  PlatformFormField,
  'field_name' | 'label' | 'field_type' | 'required' | 'visible_in_form' | 'enum_values' | 'default_value' | 'ui_config' | 'sort_order'
> & {
  editable?: boolean;
};

function isCodeCreateField(field: BusinessCreateField) {
  const uiConfig = field.ui_config || {};
  return (
    field.field_type === 'code'
    || uiConfig.businessType === 'code'
    || uiConfig.controlType === 'code'
    || Boolean(uiConfig.encodingRule)
  );
}

function makeAutoCodeValue(field: BusinessCreateField) {
  const rule = (field.ui_config?.encodingRule || {}) as Record<string, unknown>;
  const prefix = String(rule.prefix || field.field_name.slice(0, 2).toUpperCase());
  const now = new Date();
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('');
  const seqLength = Number(rule.sequenceLength || 3);
  const seq = String(Math.floor(Math.random() * (10 ** Math.min(seqLength, 6)))).padStart(seqLength, '0');
  return `${prefix}-${date}-${seq}`;
}

function enumOptionsForCreateField(field: BusinessCreateField) {
  const raw = field.enum_values;
  if (!raw) return [];
  const values = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as Record<string, unknown>).values)
      ? (raw as { values: unknown[] }).values
      : typeof (raw as Record<string, unknown>).source === 'string'
        ? String((raw as Record<string, unknown>).source).split(/[、,，/]/).map((item) => item.trim()).filter(Boolean)
        : Object.entries(raw).map(([value, label]) => ({ value, label }));
  return values.map((item: any) => (
    typeof item === 'string'
      ? { label: item, value: item }
      : { label: String(item.label ?? item.value), value: String(item.value ?? item.label) }
  ));
}

function normalizeBusinessCreateValue(value: unknown) {
  if (value && typeof value === 'object' && 'format' in value && typeof (value as { format?: unknown }).format === 'function') {
    return (value as { format: (pattern?: string) => string }).format('YYYY-MM-DDTHH:mm:ss');
  }
  return value;
}

function businessCreateInitialValues(fields: BusinessCreateField[]) {
  return fields.reduce<Record<string, unknown>>((values, field) => {
    if (field.default_value !== undefined && field.default_value !== null && field.default_value !== '') {
      values[field.field_name] = field.default_value;
    } else if (isCodeCreateField(field)) {
      values[field.field_name] = makeAutoCodeValue(field);
    }
    return values;
  }, {});
}

function renderBusinessCreateField(field: BusinessCreateField) {
  const disabled = field.editable === false || (isCodeCreateField(field) && field.ui_config?.locked !== false);
  const rules = disabled ? [] : [{ required: field.required, message: `请输入${field.label}` }];
  const commonProps = {
    key: field.field_name,
    name: field.field_name,
    label: field.label,
    rules,
  };
  if (field.field_type === 'number' || field.field_type === 'integer' || field.field_type === 'decimal') {
    return (
      <Form.Item {...commonProps}>
        <InputNumber style={{ width: '100%' }} disabled={disabled} placeholder={`请输入${field.label}`} />
      </Form.Item>
    );
  }
  if (field.field_type === 'enum') {
    return (
      <Form.Item {...commonProps}>
        <Select allowClear disabled={disabled} options={enumOptionsForCreateField(field)} placeholder={`请选择${field.label}`} />
      </Form.Item>
    );
  }
  if (field.field_type === 'date' || field.field_type === 'datetime') {
    return (
      <Form.Item {...commonProps}>
        <DatePicker showTime={field.field_type === 'datetime'} style={{ width: '100%' }} disabled={disabled} placeholder={`请选择${field.label}`} />
      </Form.Item>
    );
  }
  if (field.field_type === 'boolean') {
    return (
      <Form.Item {...commonProps}>
        <Select
          disabled={disabled}
          options={[{ value: true, label: '是' }, { value: false, label: '否' }]}
          placeholder={`请选择${field.label}`}
        />
      </Form.Item>
    );
  }
  if (field.field_type === 'text' || field.field_type === 'json') {
    return (
      <Form.Item {...commonProps}>
        <Input.TextArea rows={3} disabled={disabled} placeholder={`请输入${field.label}`} />
      </Form.Item>
    );
  }
  return (
    <Form.Item {...commonProps}>
      <Input disabled={disabled} placeholder={disabled ? '自动生成' : `请输入${field.label}`} />
    </Form.Item>
  );
}

function BusinessProgram({
  program,
  onSettings,
  onReload,
  loading,
}: {
  program: ProgramDefinition;
  onSettings: () => void;
  onReload: () => void;
  loading?: boolean;
}) {
  const [createOpen, setCreateOpen] = React.useState(false);
  const [selectedRow, setSelectedRow] = React.useState<ProgramRow | null>(null);
  const [filterValues, setFilterValues] = React.useState<Record<string, unknown>>({});
  const [createForm] = Form.useForm();
  const [filterForm] = Form.useForm();
  const [runtimeForm, setRuntimeForm] = React.useState<PlatformForm | null>(null);
  const [runtimeFormLoading, setRuntimeFormLoading] = React.useState(false);
  const [createSubmitting, setCreateSubmitting] = React.useState(false);
  const viewConfig = React.useMemo(() => normalizeViewConfig(program.viewConfig, programFieldsForView(program)), [program]);
  const activeFilters = React.useMemo(() => sortByOrder(viewConfig.filters).filter((filter) => filter.enabled), [viewConfig.filters]);
  const viewColumns = React.useMemo(() => sortByOrder(viewConfig.table.columns).filter((column) => column.enabled), [viewConfig.table.columns]);
  const runtimeCreateFields = React.useMemo<BusinessCreateField[]>(() => {
    if (!runtimeForm?.fields?.length) return [];
    const fieldPermissions = runtimeForm.runtime_field_permissions || {};
    return [...runtimeForm.fields]
      .filter((field) => !field.archived && field.visible_in_form && fieldPermissions[field.field_name]?.visible !== false)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((field) => ({
        ...field,
        required: Boolean(fieldPermissions[field.field_name]?.required ?? field.required),
        editable: fieldPermissions[field.field_name]?.editable !== false,
      }));
  }, [program, runtimeForm]);
  const filteredRows = React.useMemo(() => program.rows.filter((row) => activeFilters.every((filter) => (
    programValueMatchesFilter(row, filter, filterValues[filter.id] ?? filter.defaultValue)
  ))), [activeFilters, filterValues, program.rows]);
  const selectedRowTitle = selectedRow
    ? String(selectedRow.name || selectedRow.title || selectedRow.planNo || selectedRow.requestNo || selectedRow.key || '记录详情')
    : '记录详情';
  const detailItems = React.useMemo(() => {
    if (!selectedRow) return [];
    const formData = getRowFormData(selectedRow);
    const visibleFields = viewColumns
      .map((viewColumn) => ({
        key: viewColumn.fieldName,
        label: viewColumn.label,
        value: selectedRow[viewColumn.fieldName] ?? formData[viewColumn.fieldName],
      }))
      .filter((item) => item.value !== undefined && item.value !== null && item.value !== '');
    const visibleKeys = new Set(visibleFields.map((item) => item.key));
    const extraFields = Object.entries(formData)
      .filter(([key, value]) => !key.startsWith('_') && key !== 'key' && !visibleKeys.has(key) && value !== undefined && value !== null && value !== '')
      .map(([key, value]) => ({ key, label: fieldLabelMap[key] || key, value }));
    return [...visibleFields, ...extraFields];
  }, [selectedRow, viewColumns]);
  const interactionEntries = React.useMemo(() => getInteractionEntries(selectedRow), [selectedRow]);
  const progressStatus = selectedRow
    ? String(selectedRow.processStatus || selectedRow.status || '未启动')
    : '未启动';
  const currentNode = selectedRow
    ? String(selectedRow.currentNode || selectedRow.status || '业务记录')
    : '业务记录';
  const currentHandler = selectedRow
    ? String(selectedRow.currentHandler || selectedRow.owner || '未分配')
    : '未分配';
  const configuredColumns = React.useMemo(() => {
    const baseColumns: ColumnsType<ProgramRow> = viewColumns
      .map<ColumnType<ProgramRow>>((viewColumn) => {
        const source = program.columns.find((column) => isDataColumn(column) && column.dataIndex === viewColumn.fieldName) as ColumnType<ProgramRow> | undefined;
        const renderCell = (value: unknown, record: ProgramRow) => {
          const formData = getRowFormData(record);
          const actual = value ?? formData[viewColumn.fieldName];
          if (actual === undefined || actual === null || actual === '') return viewColumn.emptyText || '-';
          if (viewColumn.renderType === 'tag') return <Tag>{String(actual)}</Tag>;
          return String(actual);
        };
        return {
          ...(source || {}),
          title: viewColumn.label,
          dataIndex: source?.dataIndex || viewColumn.fieldName,
          key: source?.key || viewColumn.fieldName,
          width: viewColumn.width,
          fixed: viewColumn.fixed,
          sorter: viewColumn.sortable ? source?.sorter || ((a: ProgramRow, b: ProgramRow) => String(a[viewColumn.fieldName] || '').localeCompare(String(b[viewColumn.fieldName] || ''))) : undefined,
          render: source?.render || renderCell,
        };
      });
    return [...baseColumns, { title: '操作', key: 'action', fixed: 'right' as const, width: 160, render: (_: unknown, record: ProgramRow) => <Space onClick={(event) => event.stopPropagation()}><Button type="link" size="small" onClick={() => setSelectedRow(record)}>详情</Button><Button type="link" size="small">处理</Button></Space> }];
  }, [program.columns, viewColumns]);

  const closeCreateModal = () => {
    setCreateOpen(false);
    createForm.resetFields();
  };

  React.useEffect(() => {
    let cancelled = false;
    const loadRuntimeForm = async () => {
      setRuntimeFormLoading(true);
      try {
        const formsResponse = await listPlatformForms();
        const forms = (formsResponse.data?.data || []) as PlatformForm[];
        const matchedForm = forms.find((form) => form.code === program.id);
        if (!matchedForm) {
          if (!cancelled) setRuntimeForm(null);
          return;
        }
        const detailResponse = await getPlatformForm(matchedForm.id, { schema: 'published' });
        if (!cancelled) {
          const detail = (detailResponse.data?.data || matchedForm) as PlatformForm;
          setRuntimeForm(detail.fields?.length ? detail : null);
        }
      } catch (error) {
        if (!cancelled) {
          setRuntimeForm(null);
          console.warn('business form load failed', error);
        }
      } finally {
        if (!cancelled) setRuntimeFormLoading(false);
      }
    };
    void loadRuntimeForm();
    return () => {
      cancelled = true;
    };
  }, [program.id]);

  const openCreateModal = () => {
    if (!runtimeForm) {
      message.warning('当前页面没有绑定后台表单设计，不能新增业务记录');
      return;
    }
    createForm.resetFields();
    createForm.setFieldsValue(businessCreateInitialValues(runtimeCreateFields));
    setCreateOpen(true);
  };

  const submitCreateModal = async () => {
    const values = await createForm.validateFields();
    const payload = Object.fromEntries(
      Object.entries(values).map(([key, value]) => [key, normalizeBusinessCreateValue(value)]),
    );
    if (!runtimeForm) {
      message.warning('当前页面还没有绑定后台表单设计，不能写入业务记录');
      return;
    }
    setCreateSubmitting(true);
    try {
      await createPlatformDynamicRecord(runtimeForm.id, payload);
      message.success(`${runtimeForm.name || program.title} 已新增`);
      closeCreateModal();
      onReload();
    } catch (error) {
      console.error('create dynamic record failed', error);
      message.error('新增失败，请检查表单字段和权限配置');
    } finally {
      setCreateSubmitting(false);
    }
  };

  const renderProgramFilterControl = (filter: ViewFilterConfig) => {
    const placeholder = filter.placeholder || filter.label;
    if (filter.controlType === 'dateRange') return <RangePicker />;
    if (filter.controlType === 'select' || filter.controlType === 'relation') {
      const options = Array.from(new Set(program.rows.map((row) => row[filter.fieldName]).filter(Boolean))).map((value) => ({ value: String(value), label: String(value) }));
      return <Select allowClear placeholder={placeholder} options={options} />;
    }
    return <Input allowClear prefix={filter.controlType === 'keyword' ? <SearchOutlined /> : undefined} placeholder={placeholder} />;
  };

  return (
    <>
      <div className="app-business-page">
      <div className="app-business-content">
        <div className="app-business-title-row">
          <Typography.Title level={4}>{program.title}</Typography.Title>
          <Space size={8} wrap>
            <Button type="primary" icon={<PlusOutlined />} loading={runtimeFormLoading} onClick={openCreateModal}>新增</Button>
            <Button icon={<UploadOutlined />}>申请</Button>
            <Button>批量处理</Button>
            <Button icon={<ReloadOutlined />} loading={loading} onClick={onReload}>刷新</Button>
            <Button icon={<DownloadOutlined />}>导出</Button>
            <Button icon={<SettingOutlined />} onClick={onSettings}>设置</Button>
          </Space>
        </div>
        <Form
          className="app-business-search-grid app-business-configured-search"
          form={filterForm}
          colon={false}
          layout="horizontal"
          onFinish={(values) => setFilterValues(values)}
        >
          {activeFilters.map((filter) => (
            <Form.Item key={filter.id} name={filter.id} label={filter.label} initialValue={filter.defaultValue}>
              {renderProgramFilterControl(filter)}
            </Form.Item>
          ))}
          <Form.Item className="app-business-search-actions" label=" ">
            <Space>
              <Button onClick={() => { filterForm.resetFields(); setFilterValues({}); }}>重置</Button>
              <Button type="primary" htmlType="submit" icon={<SearchOutlined />}>查询</Button>
            </Space>
          </Form.Item>
        </Form>

        <Table<ProgramRow>
          className="app-business-data-table"
          rowKey="key"
          size={viewConfig.table.density === 'compact' ? 'small' : viewConfig.table.density === 'large' ? 'large' : 'middle'}
          columns={configuredColumns}
          dataSource={filteredRows}
          loading={loading}
          pagination={{ pageSize: viewConfig.table.pageSize, showSizeChanger: false, showTotal: (total) => `共 ${total} 条记录` }}
          scroll={{ x: 1100, y: '100%' }}
          rowClassName={(record) => record.key === selectedRow?.key ? 'app-business-row-selected' : ''}
          onRow={(record) => ({
            onClick: () => setSelectedRow(record),
          })}
        />
      </div>
    </div>

      <Modal
        title={`新增${runtimeForm?.name || program.title}`}
        open={createOpen}
        width={820}
        okText={runtimeForm ? '保存' : '确认'}
        cancelText="取消"
        confirmLoading={createSubmitting}
        onCancel={closeCreateModal}
        onOk={submitCreateModal}
      >
        <Form form={createForm} layout="vertical" className="app-business-create-form">
          <Row gutter={12}>
            {runtimeCreateFields.map((field) => (
              <Col key={field.field_name} xs={24} md={field.field_type === 'text' || field.field_type === 'json' ? 24 : 12}>
                {renderBusinessCreateField(field)}
              </Col>
            ))}
          </Row>
        </Form>
      </Modal>

      <Drawer
        className="workflow-detail-drawer app-business-detail-drawer"
        destroyOnClose
        extra={(
          <Space>
            <Button size="small">处理</Button>
            <Button size="small" type="primary">编辑</Button>
          </Space>
        )}
        onClose={() => setSelectedRow(null)}
        open={Boolean(selectedRow)}
        placement="right"
        title={selectedRowTitle}
        width={460}
      >
        {selectedRow ? (
          <div className="workflow-detail-content app-business-detail-body">
            <div className="workflow-detail-head">
              <FileSearchOutlined />
              <div>
                <Typography.Text strong>{selectedRowTitle}</Typography.Text>
                <Typography.Text type="secondary">{program.title} · 表单记录</Typography.Text>
              </div>
              {selectedRow.status ? <Tag color={String(selectedRow.status).includes('关闭') ? 'default' : 'processing'}>{String(selectedRow.status)}</Tag> : null}
            </div>
            <Tabs
              className="workflow-detail-tabs"
              items={[
                {
                  key: 'form',
                  label: '表单信息',
                  children: (
                    <div className="workflow-tab-page">
                      <Form layout="vertical" className="workflow-business-form">
                        <div className="workflow-form-section-title">业务表单</div>
                        <Row gutter={12}>
                          {detailItems.map((item) => (
                            <Col xs={24} md={12} key={item.key}>
                              <Form.Item label={item.label}>
                                <Input value={formatDetailValue(item.value)} readOnly />
                              </Form.Item>
                            </Col>
                          ))}
                        </Row>
                      </Form>
                    </div>
                  ),
                },
                {
                  key: 'progress',
                  label: '流程进度',
                  children: (
                    <div className="workflow-tab-page">
                      <div className="workflow-progress-summary">
                        <div>
                          <span>当前节点</span>
                          <strong>{currentNode}</strong>
                        </div>
                        <div>
                          <span>当前处理人</span>
                          <strong>{currentHandler}</strong>
                        </div>
                        <Tag color={progressStatus.includes('完成') || progressStatus.includes('关闭') ? 'green' : 'blue'}>{progressStatus}</Tag>
                      </div>
                      <div className="workflow-progress-card">
                        <div className="workflow-form-section-title">处理记录</div>
                        <Timeline
                          items={(interactionEntries.length ? interactionEntries : [
                            { title: '创建业务记录', description: formatDetailValue(selectedRow._createdAt || selectedRow.occurredAt) },
                            { title: currentNode, description: currentHandler },
                          ]).map((entry, index) => ({
                            color: index === 0 ? 'blue' : 'gray',
                            children: (
                              <div className="workflow-step-item">
                                <strong>{entry.title}</strong>
                                <span>{entry.description}</span>
                              </div>
                            ),
                          }))}
                        />
                      </div>
                    </div>
                  ),
                },
              ]}
            />
          </div>
        ) : null}
      </Drawer>
    </>
  );
}function AnalysisProgram({ program, onSettings, loading }: { program: ProgramDefinition; onSettings: () => void; loading?: boolean }) {
  return (
    <>
      <Card title="分析筛选" className="app-program-card app-program-filter-card">
        <div className="app-program-filter-grid">
          <RangePicker />
          <Select allowClear placeholder="分析维度" options={[{ value: 'line', label: '按产线' }, { value: 'asset', label: '按设备' }, { value: 'supplier', label: '按供应商' }]} />
          <Select allowClear placeholder="组织范围" options={[{ value: 'factory', label: '当前工厂' }, { value: 'workshop', label: '当前车间' }]} />
          <Input allowClear prefix={<SearchOutlined />} placeholder="搜索对象" />
          <Space>
            <Button type="primary" icon={<SearchOutlined />}>分析</Button>
            <Button>重置</Button>
          </Space>
        </div>
      </Card>

      <Row gutter={[12, 12]}>
        {program.metrics.map((metric) => (
          <Col xs={24} sm={12} lg={6} key={metric.label}>
            <Card className={`app-program-stat ${toneClassMap[metric.tone]}`}>
              <Statistic title={metric.label} value={metric.value} suffix={metric.suffix} />
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[12, 12]} className="app-program-body">
        <Col xs={24} xl={14}>
          <Card title="趋势分析" extra={<Button type="link" size="small">钻取明细</Button>} className="app-program-card app-program-chart-card">
            <div className="app-program-line-chart">
              {[46, 58, 52, 71, 64, 76, 69, 82, 74, 88, 79, 91].map((height, index) => (
                <span key={index} style={{ height: `${height}%` }} />
              ))}
            </div>
          </Card>
        </Col>
        <Col xs={24} xl={10}>
          <Card title="重点关注" className="app-program-card app-program-chart-card">
            <Space direction="vertical" size={10} className="app-program-focus">
              {program.focus.map((item, index) => (
                <div className="app-program-focus-item" key={item}>
                  <span className="app-program-focus-index">{index + 1}</span>
                  <Typography.Text>{item}</Typography.Text>
                </div>
              ))}
            </Space>
          </Card>
        </Col>
        <Col xs={24} xl={10}>
          <Card title="分布占比" className="app-program-card app-program-chart-card">
            <div className="app-program-donut-wrap">
              <div className="app-program-donut" />
              <Space direction="vertical" size={6}>
                <Tag color="red">高风险 18%</Tag>
                <Tag color="orange">中风险 34%</Tag>
                <Tag color="green">正常 48%</Tag>
              </Space>
            </div>
          </Card>
        </Col>
        <Col xs={24} xl={14}>
          <Card title="钻取明细" extra={<Button type="link" size="small">下载图表</Button>} className="app-program-card">
            <Table<ProgramRow>
              rowKey="key"
              size="middle"
              columns={program.columns}
              dataSource={program.rows}
              loading={loading}
              pagination={false}
              scroll={{ x: 760 }}
            />
          </Card>
        </Col>
      </Row>
    </>
  );
}
export default AppProgramPage;
