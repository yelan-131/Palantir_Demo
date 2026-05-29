import React from 'react';
import { AppstoreOutlined, ArrowLeftOutlined, BarChartOutlined, CheckCircleOutlined, DatabaseOutlined, DownloadOutlined, ExperimentOutlined, ExpandOutlined, FieldTimeOutlined, FileSearchOutlined, LineChartOutlined, PlusOutlined, ReloadOutlined, SearchOutlined, SettingOutlined, ShopOutlined, ToolOutlined, UploadOutlined, WarningOutlined } from '@ant-design/icons';
import { Button, Card, Col, DatePicker, Drawer, Empty, Form, Input, Modal, Progress, Row, Select, Space, Statistic, Table, Tabs, Tag, Timeline, Typography } from 'antd';
import type { ColumnsType, ColumnType } from 'antd/es/table';
import { useNavigate, useParams } from 'react-router-dom';
import DashboardPage from '../Dashboard';
import MaintenancePage from '../Maintenance';
import QualityPage from '../Quality';
import QualityImpactWorkbench from '../QualityImpact';
import SupplyChainPage from '../SupplyChain';
import { getAppProgramData } from '@/services/api';
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
  source?: string;
}

const lineNames = ['总装 A 线', '总装 B 线', 'SMT-01', 'SMT-02', 'SMT-03', '涂装 C 线', '压铸 D 线', '电控装配线', '终检 E 线', '包装 F 线'];
const shifts = ['早班', '中班', '夜班'];
const products = ['电控模块 V2', '伺服驱动器 A1', '智能网关 P8', '工业控制板 C3', '铝壳体 A 型', '传感器组件 S12'];
const owners = ['李明', '王磊', '周强', '陈晨', '孙浩', '赵敏', '刘洋', '吴越'];
const stations = ['上料工位', '焊接 OP20', '锁付 OP30', '电检台', '老化房', '终检台', '包装线'];
const alertSources = ['生产执行', '设备监测', '能源站', '质量系统', '供应链', '仓储物流'];
const alertTitles = ['产线节拍低于目标', '回流焊温区波动', '空压站压力低', '关键物料到料延迟', 'AOI 连续检出异常', '设备健康分下降', '工单完工延迟', '安全库存低于阈值'];

function pick<T>(items: T[], index: number) {
  return items[index % items.length];
}

function makeAlertRows(count = 360): ProgramRow[] {
  const levels = ['严重', '中等', '提醒'];
  const statuses = ['待处理', '确认中', '处理中', '已派发', '跟进中', '已关闭'];
  return Array.from({ length: count }, (_, index) => {
    const line = pick(lineNames, index);
    const level = index % 13 === 0 ? '严重' : pick(levels, index);
    const status = index % 7 === 0 ? '已关闭' : pick(statuses, index + 2);
    return {
      key: `ac-${index + 1}`,
      name: `${line} ${pick(alertTitles, index)}`,
      source: pick(alertSources, index + 1),
      level,
      status,
      owner: pick(owners, index),
      occurredAt: `2026-05-${String(1 + (index % 27)).padStart(2, '0')}`,
    };
  });
}

function makeProductionRows(count = 420): ProgramRow[] {
  return Array.from({ length: count }, (_, index) => {
    const plan = 760 + ((index * 37) % 1180);
    const actual = Math.max(0, Math.round(plan * (0.84 + ((index % 15) / 100))));
    return {
      key: `po-${index + 1}`,
      shift: pick(shifts, index),
      line: pick(lineNames, index),
      plan,
      actual,
      status: actual >= plan * 0.92 ? '正常' : '需关注',
    };
  });
}

function makeLineRows(count = 260): ProgramRow[] {
  return Array.from({ length: count }, (_, index) => ({
    key: `ls-${index + 1}`,
    line: `${pick(lineNames, index)}-${String(1 + (index % 12)).padStart(2, '0')}`,
    product: pick(products, index + 2),
    station: pick(stations, index),
    load: 52 + ((index * 11) % 47),
  }));
}

function makePlanRows(count = 380): ProgramRow[] {
  const statuses = ['草稿', '待确认', '已确认', '需调整'];
  return Array.from({ length: count }, (_, index) => ({
    key: `ppe-${index + 1}`,
    planNo: `PP-2605${String(1 + (index % 27)).padStart(2, '0')}-${String(index + 1).padStart(4, '0')}`,
    product: pick(products, index),
    line: pick(lineNames, index + 1),
    quantity: 420 + ((index * 29) % 1680),
    status: pick(statuses, index),
  }));
}

const programDefinitions: Record<string, ProgramDefinition> = {
  'production-overview': {
    id: 'production-overview',
    title: '生产总览',
    subtitle: '面向车间调度的产量、节拍、达成率和异常状态汇总。',
    kind: 'analysis',
    owner: '生产运营',
    icon: <LineChartOutlined />,
    metrics: [
      { label: '今日达成率', value: 94.6, suffix: '%', tone: 'green' },
      { label: '计划产量', value: 12840, tone: 'blue' },
      { label: '异常工单', value: 7, tone: 'orange' },
      { label: '平均节拍', value: 48, suffix: 's', tone: 'blue' },
    ],
    focus: ['按班次汇总产量与良率', '对比计划与实际进度', '暴露影响交付的异常点'],
    columns: [
      { title: '班次', dataIndex: 'shift' },
      { title: '产线', dataIndex: 'line' },
      { title: '计划', dataIndex: 'plan' },
      { title: '实际', dataIndex: 'actual' },
      { title: '状态', dataIndex: 'status', render: (value) => <Tag color={value === '正常' ? 'green' : 'orange'}>{value}</Tag> },
    ],
    rows: [
      { key: 'po-1', shift: '早班', line: '总装 A 线', plan: 3200, actual: 3158, status: '正常' },
      { key: 'po-2', shift: '早班', line: '焊装 B 线', plan: 2860, actual: 2714, status: '需关注' },
      { key: 'po-3', shift: '中班', line: '涂装 C 线', plan: 3020, actual: 2988, status: '正常' },
    ],
  },
  'oee-trend-report': {
    id: 'oee-trend-report',
    title: 'OEE 趋势报表',
    subtitle: '聚焦 OEE 的日趋势、目标差异、产线对比和异常波动原因。',
    kind: 'analysis',
    owner: '生产运营',
    icon: <LineChartOutlined />,
    metrics: [
      { label: '本周 OEE', value: 86.8, suffix: '%', tone: 'green' },
      { label: '较目标差异', value: -2.4, suffix: '%', tone: 'orange' },
      { label: '低于目标产线', value: 3, tone: 'red' },
      { label: '最高产线 OEE', value: 91.6, suffix: '%', tone: 'blue' },
    ],
    focus: ['OEE 趋势与目标线', '可用率、性能、质量三因子拆解', '异常日期和产线下钻'],
    columns: [
      { title: '日期', dataIndex: 'date', width: 120 },
      { title: '产线', dataIndex: 'line', width: 140 },
      { title: 'OEE', dataIndex: 'oee', width: 100 },
      { title: '可用率', dataIndex: 'availability', width: 100 },
      { title: '主要原因', dataIndex: 'reason', width: 180 },
    ],
    rows: [
      { key: 'oee-1', date: '05-18', line: '总装 A 线', oee: '88.4%', availability: '92.1%', reason: '换型等待 18 分钟' },
      { key: 'oee-2', date: '05-19', line: '焊装 B 线', oee: '82.7%', availability: '86.9%', reason: '夹具点检延迟' },
      { key: 'oee-3', date: '05-20', line: '涂装 C 线', oee: '91.6%', availability: '95.2%', reason: '运行稳定' },
    ],
  },
  'line-status': {
    id: 'line-status',
    title: '产线状态',
    subtitle: '查看每条产线的运行模式、瓶颈工位和实时负荷。',
    kind: 'business',
    owner: '车间班组',
    icon: <FieldTimeOutlined />,
    metrics: [
      { label: '运行产线', value: 11, tone: 'green' },
      { label: '待料产线', value: 2, tone: 'orange' },
      { label: '换型中', value: 1, tone: 'blue' },
      { label: '停线', value: 0, tone: 'green' },
    ],
    focus: ['产线当前工况', '瓶颈工位与节拍差异', '换型和待料影响'],
    columns: [
      { title: '产线', dataIndex: 'line' },
      { title: '当前产品', dataIndex: 'product' },
      { title: '瓶颈工位', dataIndex: 'station' },
      { title: '负荷', dataIndex: 'load', render: (value) => <Progress percent={Number(value)} size="small" /> },
    ],
    rows: [
      { key: 'ls-1', line: '冲压 01', product: '前围板', station: 'OP30 成形', load: 86 },
      { key: 'ls-2', line: '总装 03', product: 'MF-220 标准型', station: '电检', load: 74 },
      { key: 'ls-3', line: '涂装 02', product: '银灰外饰', station: '烘干炉', load: 91 },
    ],
  },
  'line-load-analysis': {
    id: 'line-load-analysis',
    title: '产线负荷分析',
    subtitle: '按产线、班次和瓶颈工位分析负荷水平，辅助排产均衡。',
    kind: 'analysis',
    owner: '计划调度',
    icon: <FieldTimeOutlined />,
    metrics: [
      { label: '平均负荷', value: 78.5, suffix: '%', tone: 'blue' },
      { label: '过载产线', value: 2, tone: 'orange' },
      { label: '空闲产能', value: 16.2, suffix: '%', tone: 'green' },
      { label: '瓶颈工位', value: 5, tone: 'red' },
    ],
    focus: ['产线负荷热区', '班次能力差异', '瓶颈工位转移建议'],
    columns: [
      { title: '产线', dataIndex: 'line', width: 140 },
      { title: '班次', dataIndex: 'shift', width: 100 },
      { title: '负荷率', dataIndex: 'load', width: 120, render: (value) => <Progress percent={Number(value)} size="small" /> },
      { title: '瓶颈工位', dataIndex: 'station', width: 160 },
      { title: '建议动作', dataIndex: 'action', width: 180 },
    ],
    rows: [
      { key: 'lla-1', line: '总装 A 线', shift: '早班', load: 92, station: '电检', action: '中班补充 1 名检验员' },
      { key: 'lla-2', line: '焊装 B 线', shift: '中班', load: 84, station: '夹具 OP20', action: '提前准备换型夹具' },
      { key: 'lla-3', line: '涂装 C 线', shift: '夜班', load: 63, station: '烘干炉', action: '承接 A 线转移批次' },
    ],
  },
  'production-plan-entry': {
    id: 'production-plan-entry',
    title: '生产计划填报',
    subtitle: '表单性质的业务表，用于维护计划产量、产品、班次和确认状态。',
    kind: 'business',
    owner: '生产计划',
    icon: <AppstoreOutlined />,
    metrics: [
      { label: '待提交计划', value: 6, tone: 'orange' },
      { label: '已确认计划', value: 28, tone: 'green' },
      { label: '待调整批次', value: 4, tone: 'red' },
      { label: '覆盖产线', value: 12, tone: 'blue' },
    ],
    focus: ['计划录入和保存草稿', '班次产量确认', '排产调整原因留痕'],
    columns: [
      { title: '计划单号', dataIndex: 'planNo', width: 150 },
      { title: '产品', dataIndex: 'product', width: 150 },
      { title: '产线', dataIndex: 'line', width: 130 },
      { title: '计划数量', dataIndex: 'quantity', width: 110 },
      { title: '状态', dataIndex: 'status', width: 100, render: (value) => <Tag color={value === '已确认' ? 'green' : 'orange'}>{value}</Tag> },
    ],
    rows: [
      { key: 'ppe-1', planNo: 'PP-260520-001', product: 'MF-220 标准型', line: '总装 A 线', quantity: 1200, status: '已确认' },
      { key: 'ppe-2', planNo: 'PP-260520-002', product: '电控模块 V2', line: '电控装配', quantity: 860, status: '草稿' },
      { key: 'ppe-3', planNo: 'PP-260520-003', product: '铝壳体 A 型', line: '压铸 D 线', quantity: 1500, status: '待确认' },
    ],
  },
  'device-health': {
    id: 'device-health',
    title: '设备健康',
    subtitle: '沉淀关键设备的健康评分、风险因子和维护建议。',
    kind: 'analysis',
    owner: '设备工程',
    icon: <ToolOutlined />,
    metrics: [
      { label: '平均健康度', value: 88.2, suffix: '%', tone: 'green' },
      { label: '高风险设备', value: 4, tone: 'red' },
      { label: '待保养', value: 13, tone: 'orange' },
      { label: '在线设备', value: 216, tone: 'blue' },
    ],
    focus: ['设备健康评分', '振动与温度异常', '保养策略推荐'],
    columns: [
      { title: '设备', dataIndex: 'asset' },
      { title: '健康度', dataIndex: 'health', render: (value) => <Progress percent={Number(value)} size="small" /> },
      { title: '主要风险', dataIndex: 'risk' },
      { title: '建议', dataIndex: 'action' },
    ],
    rows: [
      { key: 'dh-1', asset: 'CNC-17 主轴', health: 68, risk: '振动升高', action: '48 小时内点检' },
      { key: 'dh-2', asset: '空压机 2#', health: 81, risk: '油温偏高', action: '观察趋势' },
      { key: 'dh-3', asset: 'AGV-06', health: 92, risk: '无明显风险', action: '按计划保养' },
    ],
  },
  'device-health-dashboard': {
    id: 'device-health-dashboard',
    title: '设备健康看板',
    subtitle: '面向预测性维护的总览看板，汇总设备健康度、风险分布、待处理建议和关键设备排行。',
    kind: 'analysis',
    owner: '设备团队',
    icon: <ToolOutlined />,
    metrics: [
      { label: '平均健康度', value: 88.6, suffix: '%', tone: 'green' },
      { label: '高风险设备', value: 5, tone: 'red' },
      { label: '待保养设备', value: 14, tone: 'orange' },
      { label: '在线设备', value: 216, tone: 'blue' },
    ],
    focus: ['设备健康度分布', '高风险设备排行', '保养建议闭环'],
    columns: [
      { title: '设备', dataIndex: 'asset', width: 150 },
      { title: '健康度', dataIndex: 'health', width: 160, render: (value) => <Progress percent={Number(value)} size="small" /> },
      { title: '风险等级', dataIndex: 'level', width: 120 },
      { title: '主要风险', dataIndex: 'risk', width: 180 },
      { title: '建议动作', dataIndex: 'action', width: 180 },
    ],
    rows: [
      { key: 'dhd-1', asset: 'CNC-17 主轴', health: 68, level: '高', risk: '振动升高', action: '48 小时内点检' },
      { key: 'dhd-2', asset: '空压机 2#', health: 81, level: '中', risk: '油温偏高', action: '观察趋势' },
      { key: 'dhd-3', asset: 'AGV-06', health: 92, level: '低', risk: '无明显风险', action: '按计划保养' },
    ],
  },
  'fault-prediction': {
    id: 'fault-prediction',
    title: '故障预测',
    subtitle: '根据历史维修、传感器趋势和运行时长预测故障窗口。',
    kind: 'analysis',
    owner: '可靠性团队',
    icon: <WarningOutlined />,
    metrics: [
      { label: '预测命中率', value: 82.5, suffix: '%', tone: 'green' },
      { label: '未来 7 天风险', value: 9, tone: 'orange' },
      { label: '严重预警', value: 2, tone: 'red' },
      { label: '模型版本', value: 'v3.4', tone: 'blue' },
    ],
    focus: ['故障概率排序', '预测依据解释', '维护窗口建议'],
    columns: [
      { title: '对象', dataIndex: 'asset' },
      { title: '预测故障', dataIndex: 'fault' },
      { title: '概率', dataIndex: 'probability' },
      { title: '预计窗口', dataIndex: 'window' },
    ],
    rows: [
      { key: 'fp-1', asset: '压铸机 D12', fault: '液压压力衰减', probability: '76%', window: '05-22 上午' },
      { key: 'fp-2', asset: '机器人 R08', fault: '关节过热', probability: '63%', window: '05-23 夜班' },
      { key: 'fp-3', asset: '输送线 L05', fault: '电机电流异常', probability: '58%', window: '05-25 中班' },
    ],
  },
  'maintenance-order': {
    id: 'maintenance-order',
    title: '维修工单',
    subtitle: '跟踪维修工单的派发、执行、备件和验收闭环。',
    kind: 'business',
    owner: '维修班组',
    icon: <AppstoreOutlined />,
    metrics: [
      { label: '打开工单', value: 18, tone: 'orange' },
      { label: '今日完成', value: 11, tone: 'green' },
      { label: '待备件', value: 3, tone: 'red' },
      { label: '平均处理', value: 2.6, suffix: 'h', tone: 'blue' },
    ],
    focus: ['工单责任人', '维修进度', '备件与验收状态'],
    columns: [
      { title: '工单号', dataIndex: 'orderNo' },
      { title: '设备', dataIndex: 'asset' },
      { title: '负责人', dataIndex: 'owner' },
      { title: '进度', dataIndex: 'status', render: (value) => <Tag color={value === '已完成' ? 'green' : 'processing'}>{value}</Tag> },
    ],
    rows: [
      { key: 'mo-1', orderNo: 'WO-260520-018', asset: '涂装风机 F02', owner: '李工', status: '处理中' },
      { key: 'mo-2', orderNo: 'WO-260520-022', asset: '总装电检台', owner: '陈工', status: '待验收' },
      { key: 'mo-3', orderNo: 'WO-260520-027', asset: 'AGV 充电桩', owner: '周工', status: '已完成' },
    ],
  },
  'failure-trend-analysis': {
    id: 'failure-trend-analysis',
    title: '故障趋势分析',
    subtitle: '按时间、设备类型和故障原因分析维修故障趋势，区别于单台设备预测。',
    kind: 'analysis',
    owner: '维护团队',
    icon: <LineChartOutlined />,
    metrics: [
      { label: '本月故障数', value: 42, tone: 'orange' },
      { label: '环比变化', value: -8.6, suffix: '%', tone: 'green' },
      { label: '重复故障', value: 7, tone: 'red' },
      { label: '平均间隔', value: 18.4, suffix: 'h', tone: 'blue' },
    ],
    focus: ['故障趋势按周分析', '重复故障设备识别', '主要原因与责任区域'],
    columns: [
      { title: '周次', dataIndex: 'week', width: 120 },
      { title: '设备类型', dataIndex: 'type', width: 140 },
      { title: '故障次数', dataIndex: 'count', width: 100 },
      { title: '主要原因', dataIndex: 'reason', width: 180 },
      { title: '趋势', dataIndex: 'trend', width: 100 },
    ],
    rows: [
      { key: 'fta-1', week: '第 20 周', type: '机器人', count: 11, reason: '关节温升', trend: '下降' },
      { key: 'fta-2', week: '第 20 周', type: '输送线', count: 9, reason: '电机电流波动', trend: '持平' },
      { key: 'fta-3', week: '第 20 周', type: '压铸设备', count: 14, reason: '液压压力异常', trend: '上升' },
    ],
  },
  'alert-center': {
    id: 'alert-center',
    title: '告警中心',
    subtitle: '聚合设备、质量、交付和库存告警，支持处置优先级排序。',
    kind: 'business',
    owner: '运营指挥',
    icon: <WarningOutlined />,
    metrics: [
      { label: '未关闭告警', value: 26, tone: 'orange' },
      { label: '严重告警', value: 3, tone: 'red' },
      { label: '已确认', value: 15, tone: 'blue' },
      { label: '自动恢复', value: 8, tone: 'green' },
    ],
    focus: ['告警等级', '责任域分派', '处置时效'],
    columns: [
      { title: '告警', dataIndex: 'name' },
      { title: '来源', dataIndex: 'source' },
      { title: '等级', dataIndex: 'level', render: (value) => <Tag color={value === '严重' ? 'red' : 'orange'}>{value}</Tag> },
      { title: '状态', dataIndex: 'status' },
    ],
    rows: [
      { key: 'ac-1', name: '压缩空气压力低', source: '能源站', level: '严重', status: '已派发' },
      { key: 'ac-2', name: 'A 线节拍延迟', source: '生产执行', level: '中等', status: '确认中' },
      { key: 'ac-3', name: '来料批次延迟', source: '供应链', level: '中等', status: '跟进中' },
    ],
  },
  'quality-overview': {
    id: 'quality-overview',
    title: '质量总览',
    subtitle: '汇总检验合格率、缺陷分布、返工趋势和关键质量事件。',
    kind: 'analysis',
    owner: '质量部',
    icon: <CheckCircleOutlined />,
    metrics: [
      { label: '一次合格率', value: 97.8, suffix: '%', tone: 'green' },
      { label: '待复检', value: 42, tone: 'orange' },
      { label: '重大事件', value: 1, tone: 'red' },
      { label: 'CPK 均值', value: 1.43, tone: 'blue' },
    ],
    focus: ['批次质量表现', '缺陷趋势', '过程能力监控'],
    columns: [
      { title: '产品族', dataIndex: 'family' },
      { title: '抽检数', dataIndex: 'sample' },
      { title: '合格率', dataIndex: 'yieldRate' },
      { title: '主要缺陷', dataIndex: 'defect' },
    ],
    rows: [
      { key: 'qo-1', family: '动力壳体', sample: 620, yieldRate: '98.4%', defect: '毛刺' },
      { key: 'qo-2', family: '电控模块', sample: 410, yieldRate: '96.9%', defect: '焊点虚焊' },
      { key: 'qo-3', family: '内饰组件', sample: 780, yieldRate: '97.6%', defect: '色差' },
    ],
  },
  'inspection-batch': {
    id: 'inspection-batch',
    title: '检验批次',
    subtitle: '管理来料、过程和出货检验批次的抽检结论。',
    kind: 'business',
    owner: '检验小组',
    icon: <FileSearchOutlined />,
    metrics: [
      { label: '今日批次', value: 67, tone: 'blue' },
      { label: '已放行', value: 51, tone: 'green' },
      { label: '隔离中', value: 6, tone: 'orange' },
      { label: '判退', value: 2, tone: 'red' },
    ],
    focus: ['批次状态', '抽样方案', '放行与隔离记录'],
    columns: [
      { title: '批次号', dataIndex: 'batch' },
      { title: '物料', dataIndex: 'material' },
      { title: '检验类型', dataIndex: 'type' },
      { title: '结论', dataIndex: 'result', render: (value) => <Tag color={value === '放行' ? 'green' : 'orange'}>{value}</Tag> },
    ],
    rows: [
      { key: 'ib-1', batch: 'IQC-0520-17', material: '轴承组件', type: '来料检验', result: '放行' },
      { key: 'ib-2', batch: 'PQC-0520-08', material: '电控板', type: '过程检验', result: '隔离' },
      { key: 'ib-3', batch: 'OQC-0520-11', material: '整机套件', type: '出货检验', result: '复检' },
    ],
  },
  'defect-analysis': {
    id: 'defect-analysis',
    title: '缺陷分析',
    subtitle: '对缺陷类型、工位、供应商和责任原因进行分层分析。',
    kind: 'analysis',
    owner: '质量工程',
    icon: <ExperimentOutlined />,
    metrics: [
      { label: '缺陷件数', value: 128, tone: 'orange' },
      { label: '重复缺陷', value: 19, tone: 'red' },
      { label: 'Top1 占比', value: 31.4, suffix: '%', tone: 'blue' },
      { label: '关闭率', value: 86, suffix: '%', tone: 'green' },
    ],
    focus: ['缺陷 Pareto', '责任原因归类', '改善效果跟踪'],
    columns: [
      { title: '缺陷类型', dataIndex: 'defect' },
      { title: '发生工位', dataIndex: 'station' },
      { title: '数量', dataIndex: 'count' },
      { title: '趋势', dataIndex: 'trend' },
    ],
    rows: [
      { key: 'da-1', defect: '焊点虚焊', station: 'SMT-04', count: 40, trend: '上升' },
      { key: 'da-2', defect: '涂层颗粒', station: '喷涂室 2', count: 27, trend: '持平' },
      { key: 'da-3', defect: '尺寸偏差', station: 'CNC-09', count: 18, trend: '下降' },
    ],
  },
  'defect-analysis-report': {
    id: 'defect-analysis-report',
    title: '缺陷分析报表',
    subtitle: '按缺陷类型、责任工位和改善状态拆解质量问题，避免与缺陷处理表单共用一个页面。',
    kind: 'analysis',
    owner: '质量团队',
    icon: <ExperimentOutlined />,
    metrics: [
      { label: '本月缺陷数', value: 96, tone: 'orange' },
      { label: '重大缺陷', value: 8, tone: 'red' },
      { label: '重复发生率', value: 12.5, suffix: '%', tone: 'blue' },
      { label: '改善关闭率', value: 84.2, suffix: '%', tone: 'green' },
    ],
    focus: ['缺陷 Pareto 分析', '责任工位归因', '改善闭环趋势'],
    columns: [
      { title: '缺陷类型', dataIndex: 'defect', width: 150 },
      { title: '责任工位', dataIndex: 'station', width: 140 },
      { title: '发生次数', dataIndex: 'count', width: 110 },
      { title: '主要原因', dataIndex: 'reason', width: 180 },
      { title: '改善状态', dataIndex: 'status', width: 120 },
    ],
    rows: [
      { key: 'dar-1', defect: '尺寸超差', station: 'CNC-07', count: 24, reason: '刀具磨损补偿滞后', status: '处理中' },
      { key: 'dar-2', defect: '表面划伤', station: '装配-02', count: 18, reason: '周转器具防护不足', status: '已验证' },
      { key: 'dar-3', defect: '焊点虚焊', station: '焊接-03', count: 13, reason: '温度曲线偏低', status: '待复核' },
    ],
  },
  'process-capability-dashboard': {
    id: 'process-capability-dashboard',
    title: '过程能力看板',
    subtitle: '聚焦 CPK、PPK、超限批次和稳定性趋势，是质量监控看板，不再复用质量总览。',
    kind: 'analysis',
    owner: '质量团队',
    icon: <CheckCircleOutlined />,
    metrics: [
      { label: '平均 CPK', value: 1.42, tone: 'green' },
      { label: '低能力工序', value: 4, tone: 'red' },
      { label: '超限批次', value: 6, tone: 'orange' },
      { label: '受控特性', value: 38, tone: 'blue' },
    ],
    focus: ['关键特性能力排名', 'SPC 超限追踪', '低 CPK 工序改善'],
    columns: [
      { title: '工序', dataIndex: 'process', width: 150 },
      { title: '质量特性', dataIndex: 'feature', width: 150 },
      { title: 'CPK', dataIndex: 'cpk', width: 100 },
      { title: 'PPK', dataIndex: 'ppk', width: 100 },
      { title: '状态', dataIndex: 'status', width: 120 },
    ],
    rows: [
      { key: 'pcd-1', process: 'CNC 精加工', feature: '外径', cpk: 1.18, ppk: 1.12, status: '需改善' },
      { key: 'pcd-2', process: '压装', feature: '压入力', cpk: 1.56, ppk: 1.49, status: '稳定' },
      { key: 'pcd-3', process: '终检', feature: '间隙', cpk: 1.33, ppk: 1.28, status: '观察' },
    ],
  },  'quality-event': {
    id: 'quality-event',
    title: '料号追踪',
    subtitle: '围绕料号查看供应、检验、库存、生产、交付、异常和知识证据。',
    kind: 'business',
    owner: '质量 / 供应链',
    icon: <CheckCircleOutlined />,
    metrics: [
      { label: '关联对象', value: 16, tone: 'blue' },
      { label: '关系链路', value: 24, tone: 'green' },
      { label: '风险节点', value: 4, tone: 'orange' },
      { label: '证据条目', value: 3, tone: 'blue' },
    ],
    focus: ['料号全链路', 'Neo4j 子图', '异常与证据'],
    columns: [
      { title: '对象编号', dataIndex: 'eventNo' },
      { title: '对象名称', dataIndex: 'subject' },
      { title: '归属', dataIndex: 'owner' },
      { title: '状态', dataIndex: 'stage' },
    ],
    rows: [
      { key: 'mat-1', eventNo: 'MB-7781', subject: '焊锡膏 S12', owner: '供应链 / 质量', stage: '待判定' },
      { key: 'mat-2', eventNo: 'INV-7781-A', subject: '待判定库存', owner: '仓储 / 质量', stage: '冻结' },
      { key: 'mat-3', eventNo: 'PB-260521-A', subject: '电控模块 V2', owner: '生产 / 交付', stage: '隔离' },
    ],
  },
  'supplier-risk': {
    id: 'supplier-risk',
    title: '供应商风险',
    subtitle: '评估供应商交付、质量、产能和地域风险。',
    kind: 'analysis',
    owner: '采购管理',
    icon: <ShopOutlined />,
    metrics: [
      { label: '高风险供应商', value: 5, tone: 'red' },
      { label: '交付准时率', value: 91.2, suffix: '%', tone: 'green' },
      { label: '待整改', value: 8, tone: 'orange' },
      { label: '覆盖品类', value: 23, tone: 'blue' },
    ],
    focus: ['供应商风险评分', '交付与质量波动', '替代来源建议'],
    columns: [
      { title: '供应商', dataIndex: 'supplier' },
      { title: '品类', dataIndex: 'category' },
      { title: '风险', dataIndex: 'risk', render: (value) => <Tag color={value === '高' ? 'red' : 'orange'}>{value}</Tag> },
      { title: '原因', dataIndex: 'reason' },
    ],
    rows: [
      { key: 'sr-1', supplier: '华东精密', category: '铝压铸件', risk: '高', reason: '产能受限' },
      { key: 'sr-2', supplier: '北辰电子', category: '控制板', risk: '中', reason: '良率波动' },
      { key: 'sr-3', supplier: '安捷物流', category: '干线运输', risk: '中', reason: '时效延迟' },
    ],
  },
  'supply-overview': {
    id: 'supply-overview',
    title: '供应总览',
    subtitle: '查看供应链库存水位、缺料风险和交付承诺。',
    kind: 'analysis',
    owner: '供应链计划',
    icon: <DatabaseOutlined />,
    metrics: [
      { label: '缺料风险', value: 14, tone: 'orange' },
      { label: '安全库存命中', value: 88.7, suffix: '%', tone: 'green' },
      { label: '在途批次', value: 126, tone: 'blue' },
      { label: '停线风险', value: 1, tone: 'red' },
    ],
    focus: ['库存覆盖天数', '供应承诺差异', '缺料风险预警'],
    columns: [
      { title: '物料组', dataIndex: 'group' },
      { title: '覆盖天数', dataIndex: 'days' },
      { title: '在途', dataIndex: 'transit' },
      { title: '风险等级', dataIndex: 'risk' },
    ],
    rows: [
      { key: 'so-1', group: '电子元件', days: 6.5, transit: 28, risk: '中' },
      { key: 'so-2', group: '压铸毛坯', days: 3.2, transit: 11, risk: '高' },
      { key: 'so-3', group: '包装材料', days: 14.8, transit: 7, risk: '低' },
    ],
  },
  'material-impact': {
    id: 'material-impact',
    title: '物料影响',
    subtitle: '分析物料短缺对工单、产线和客户交付的影响范围。',
    kind: 'analysis',
    owner: '计划协同',
    icon: <DatabaseOutlined />,
    metrics: [
      { label: '受影响工单', value: 21, tone: 'orange' },
      { label: '客户订单', value: 9, tone: 'red' },
      { label: '可替代料', value: 6, tone: 'green' },
      { label: '预计缺口', value: 1840, tone: 'blue' },
    ],
    focus: ['缺料影响链路', '替代料可用性', '客户交期冲击'],
    columns: [
      { title: '物料', dataIndex: 'material' },
      { title: '缺口', dataIndex: 'gap' },
      { title: '影响产线', dataIndex: 'line' },
      { title: '缓解动作', dataIndex: 'action' },
    ],
    rows: [
      { key: 'mi-1', material: 'IGBT 模块', gap: 420, line: '电控装配', action: '启用替代供应' },
      { key: 'mi-2', material: '铝壳体 A 型', gap: 860, line: '总装 A 线', action: '调整排产' },
      { key: 'mi-3', material: '密封圈 S12', gap: 560, line: '终检返修', action: '加急采购' },
    ],
  },
  'material-impact-report': {
    id: 'material-impact-report',
    title: '物料影响报表',
    subtitle: '把缺料对产线、工单和客户订单的影响拆开分析，不再复用通用物料影响页。',
    kind: 'analysis',
    owner: '供应链团队',
    icon: <DatabaseOutlined />,
    metrics: [
      { label: '受影响工单', value: 18, tone: 'orange' },
      { label: '停线风险', value: 5, tone: 'red' },
      { label: '可替代物料', value: 12, tone: 'green' },
      { label: '预计缺口', value: 3260, tone: 'blue' },
    ],
    focus: ['缺料影响工单', '客户订单风险', '替代料可用性'],
    columns: [
      { title: '物料', dataIndex: 'material', width: 150 },
      { title: '影响对象', dataIndex: 'target', width: 150 },
      { title: '缺口数量', dataIndex: 'gap', width: 110 },
      { title: '预计影响', dataIndex: 'impact', width: 160 },
      { title: '应对动作', dataIndex: 'action', width: 180 },
    ],
    rows: [
      { key: 'mir-1', material: '伺服驱动器', target: 'A 线工单 WO-0521', gap: 24, impact: '延迟 6 小时', action: '调用安全库存' },
      { key: 'mir-2', material: '视觉镜头', target: '客户订单 SO-8831', gap: 16, impact: '交期风险', action: '启用替代型号' },
      { key: 'mir-3', material: '铝型材', target: '装配 B 线', gap: 310, impact: '班次产能下降', action: '供应商加急' },
    ],
  },
  'supply-risk-dashboard': {
    id: 'supply-risk-dashboard',
    title: '供应风险看板',
    subtitle: '展示供应风险等级、关键品类和替代方案，是供应链风险看板，不再复用供应链总览。',
    kind: 'analysis',
    owner: '供应链团队',
    icon: <ShopOutlined />,
    metrics: [
      { label: '高风险供应商', value: 6, tone: 'red' },
      { label: '风险品类', value: 14, tone: 'orange' },
      { label: '替代方案覆盖', value: 72.4, suffix: '%', tone: 'green' },
      { label: '待复核风险', value: 9, tone: 'blue' },
    ],
    focus: ['高风险供应商排行', '关键物料风险', '替代方案覆盖缺口'],
    columns: [
      { title: '供应商', dataIndex: 'supplier', width: 160 },
      { title: '风险品类', dataIndex: 'category', width: 140 },
      { title: '风险等级', dataIndex: 'level', width: 110 },
      { title: '主要原因', dataIndex: 'reason', width: 180 },
      { title: '缓解方案', dataIndex: 'mitigation', width: 180 },
    ],
    rows: [
      { key: 'srd-1', supplier: '华东精密件', category: 'CNC 外协', level: '高', reason: '交付连续延期', mitigation: '切换二供产能' },
      { key: 'srd-2', supplier: '北方电子', category: '控制板', level: '中', reason: '关键芯片短缺', mitigation: '锁定滚动预测' },
      { key: 'srd-3', supplier: '远航物流', category: '跨区运输', level: '中', reason: '干线波动', mitigation: '增加备用线路' },
    ],
  },  'risk-review': {
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
    rows: [
      { key: 'rr-1', riskNo: 'SR-2605-031', subject: '压铸件供应中断风险', level: '高', owner: '采购一组' },
      { key: 'rr-2', riskNo: 'SR-2605-045', subject: '进口芯片清关延迟', level: '中', owner: '计划二组' },
      { key: 'rr-3', riskNo: 'SR-2605-052', subject: '包装材料安全库存不足', level: '中', owner: '仓储组' },
    ],
  },
};

programDefinitions['production-overview'] = {
  ...programDefinitions['production-overview'],
  title: '生产总览',
  subtitle: '面向车间调度的产量、节拍、达成率和异常状态汇总。',
  owner: '生产运营',
  metrics: [
    { label: '今日达成率', value: 94.6, suffix: '%', tone: 'green' },
    { label: '计划产量', value: 12840, tone: 'blue' },
    { label: '异常工单', value: 37, tone: 'orange' },
    { label: '平均节拍', value: 48, suffix: 's', tone: 'blue' },
  ],
  focus: ['按班次汇总产量与良率', '对比计划与实际进度', '暴露影响交付的异常点'],
  columns: [
    { title: '班次', dataIndex: 'shift' },
    { title: '产线', dataIndex: 'line' },
    { title: '计划', dataIndex: 'plan', sorter: (a, b) => Number(a.plan) - Number(b.plan) },
    { title: '实际', dataIndex: 'actual', sorter: (a, b) => Number(a.actual) - Number(b.actual) },
    { title: '状态', dataIndex: 'status', render: (value) => <Tag color={value === '正常' ? 'green' : 'orange'}>{value}</Tag> },
  ],
  rows: makeProductionRows(),
};

programDefinitions['line-status'] = {
  ...programDefinitions['line-status'],
  title: '产线状态',
  subtitle: '查看每条产线的运行模式、瓶颈工位和实时负荷。',
  owner: '车间班组',
  metrics: [
    { label: '运行产线', value: 214, tone: 'green' },
    { label: '待料产线', value: 21, tone: 'orange' },
    { label: '换型中', value: 18, tone: 'blue' },
    { label: '停线', value: 7, tone: 'red' },
  ],
  focus: ['产线当前工况', '瓶颈工位与节拍差异', '换型和待料影响'],
  columns: [
    { title: '产线', dataIndex: 'line' },
    { title: '当前产品', dataIndex: 'product' },
    { title: '瓶颈工位', dataIndex: 'station' },
    { title: '负荷', dataIndex: 'load', render: (value) => <Progress percent={Number(value)} size="small" /> },
  ],
  rows: makeLineRows(),
};

programDefinitions['production-plan-entry'] = {
  ...programDefinitions['production-plan-entry'],
  title: '生产计划填报',
  subtitle: '维护计划产量、产品、班次和确认状态。',
  owner: '生产计划',
  metrics: [
    { label: '待提交计划', value: 46, tone: 'orange' },
    { label: '已确认计划', value: 238, tone: 'green' },
    { label: '待调整批次', value: 34, tone: 'red' },
    { label: '覆盖产线', value: 96, tone: 'blue' },
  ],
  focus: ['计划录入和保存草稿', '班次产量确认', '排产调整原因留痕'],
  columns: [
    { title: '计划单号', dataIndex: 'planNo', width: 150 },
    { title: '产品', dataIndex: 'product', width: 150 },
    { title: '产线', dataIndex: 'line', width: 130 },
    { title: '计划数量', dataIndex: 'quantity', width: 110, sorter: (a, b) => Number(a.quantity) - Number(b.quantity) },
    { title: '状态', dataIndex: 'status', width: 100, render: (value) => <Tag color={value === '已确认' ? 'green' : 'orange'}>{value}</Tag> },
  ],
  rows: makePlanRows(),
};

programDefinitions['alert-center'] = {
  ...programDefinitions['alert-center'],
  title: '告警中心',
  subtitle: '聚合设备、质量、交付和库存告警，支持处置优先级排序。',
  owner: '运营指挥',
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
  rows: makeAlertRows(),
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
const routedProgramIds = new Set(['production-overview', 'device-health', 'quality-overview', 'quality-event', 'supply-overview']);

function AppProgramPage() {
  const { programId } = useParams();
  const navigate = useNavigate();
  const [programData, setProgramData] = React.useState<ProgramDataPayload | null>(null);
  const [programLoading, setProgramLoading] = React.useState(false);

  const baseProgram = programId ? programDefinitions[programId] : undefined;
  const loadProgramData = React.useCallback(async () => {
    if (!programId || routedProgramIds.has(programId) || !programDefinitions[programId]) return;
    setProgramLoading(true);
    try {
      const response = await getAppProgramData(programId, 500);
      const payload = response.data as ProgramDataPayload;
      setProgramData(payload?.rows || payload?.metrics ? payload : null);
    } catch {
      setProgramData(null);
    } finally {
      setProgramLoading(false);
    }
  }, [programId]);

  React.useEffect(() => {
    setProgramData(null);
    void loadProgramData();
  }, [loadProgramData]);

  const program = React.useMemo(() => {
    if (!baseProgram) return undefined;
    return {
      ...baseProgram,
      metrics: programData?.metrics?.length ? programData.metrics : baseProgram.metrics,
      rows: programData?.rows?.length ? programData.rows : baseProgram.rows,
    };
  }, [baseProgram, programData]);

  if (programId === 'production-overview') {
    return <DashboardPage />;
  }

  if (programId === 'device-health') {
    return <MaintenancePage />;
  }

  if (programId === 'quality-overview') {
    return <QualityPage />;
  }

  if (programId === 'quality-event') {
    return <QualityImpactWorkbench />;
  }

  if (programId === 'supply-overview') {
    return <SupplyChainPage />;
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
    navigate(`/form-settings/${program.id}`);
  };

  return (
    <div className={`app-program-page app-program-${program.kind}`}>
      {program.kind === 'business' ? (
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
  const viewConfig = React.useMemo(() => normalizeViewConfig(program.viewConfig, programFieldsForView(program)), [program]);
  const activeFilters = React.useMemo(() => sortByOrder(viewConfig.filters).filter((filter) => filter.enabled), [viewConfig.filters]);
  const viewColumns = React.useMemo(() => sortByOrder(viewConfig.table.columns).filter((column) => column.enabled), [viewConfig.table.columns]);
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
    const baseColumns = viewColumns
      .map((viewColumn) => {
        const source = program.columns.find((column) => isDataColumn(column) && column.dataIndex === viewColumn.fieldName) as ColumnType<ProgramRow> | undefined;
        if (!source) return null;
        return {
          ...source,
          title: viewColumn.label,
          width: viewColumn.width,
          fixed: viewColumn.fixed,
          sorter: viewColumn.sortable ? source.sorter || ((a: ProgramRow, b: ProgramRow) => String(a[viewColumn.fieldName] || '').localeCompare(String(b[viewColumn.fieldName] || ''))) : undefined,
        };
      })
      .filter((column): column is NonNullable<typeof column> => Boolean(column));
    return [...baseColumns, { title: '操作', key: 'action', fixed: 'right' as const, width: 160, render: (_: unknown, record: ProgramRow) => <Space onClick={(event) => event.stopPropagation()}><Button type="link" size="small" onClick={() => setSelectedRow(record)}>详情</Button><Button type="link" size="small">处理</Button></Space> }];
  }, [program.columns, viewColumns]);

  const closeCreateModal = () => {
    setCreateOpen(false);
    createForm.resetFields();
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
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新增</Button>
            <Button icon={<UploadOutlined />}>申请</Button>
            <Button>批量处理</Button>
            <Button icon={<ReloadOutlined />} loading={loading} onClick={onReload}>刷新</Button>
            <Button icon={<DownloadOutlined />}>导出</Button>
            <Button icon={<SettingOutlined />} onClick={onSettings}>设置</Button>
          </Space>
        </div>
        <div className="app-business-search-grid">
          <label>
            <span>业务编号</span>
            <Input allowClear placeholder="请输入" />
          </label>
          <label>
            <span>主题</span>
            <Input allowClear placeholder="请输入" />
          </label>
          <label>
            <span>状态</span>
            <Select allowClear placeholder="请选择" options={[{ value: 'pending', label: '待处理' }, { value: 'processing', label: '处理中' }, { value: 'closed', label: '已关闭' }]} />
          </label>
          <label>
            <span>负责人</span>
            <Select allowClear placeholder="请选择" options={[{ value: 'me', label: '我负责的' }, { value: 'team', label: '团队范围' }]} />
          </label>
          <label>
            <span>申请时间</span>
            <RangePicker />
          </label>
          <label>
            <span>等级</span>
            <Select allowClear placeholder="请选择" options={[{ value: 'high', label: '高' }, { value: 'medium', label: '中' }, { value: 'low', label: '低' }]} />
          </label>
          <label>
            <span>处理人</span>
            <Input allowClear placeholder="请输入" />
          </label>
          <div className="app-business-search-actions">
            <Button>重置</Button>
            <Button type="primary" icon={<SearchOutlined />}>查询</Button>
          </div>
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
        title={`${program.title} - 料号申请`}
        open={createOpen}
        width={820}
        okText="提交申请"
        cancelText="取消"
        onCancel={closeCreateModal}
        onOk={async () => {
          await createForm.validateFields();
          closeCreateModal();
        }}
      >
        <Form form={createForm} layout="vertical" className="app-business-create-form">
          <Row gutter={12}>
            <Col xs={24} md={12}>
              <Form.Item label="申请单号" name="requestNo" initialValue="MR-260520-001">
                <Input disabled />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="申请类型" name="requestType" initialValue="料号申请" rules={[{ required: true, message: '请选择申请类型' }]}>
                <Select options={[{ value: '料号申请', label: '料号申请' }, { value: '替代料申请', label: '替代料申请' }, { value: '风险复核申请', label: '风险复核申请' }]} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="料号" name="partNo" rules={[{ required: true, message: '请输入料号' }]}>
                <Input placeholder="请输入料号" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="物料名称" name="materialName" rules={[{ required: true, message: '请输入物料名称' }]}>
                <Input placeholder="请输入物料名称" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="规格型号" name="spec">
                <Input placeholder="请输入规格型号" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="供应商" name="supplier" rules={[{ required: true, message: '请选择供应商' }]}>
                <Select placeholder="请选择供应商" options={[{ value: '华东精密件', label: '华东精密件' }, { value: '北辰电子', label: '北辰电子' }, { value: '安捷物流', label: '安捷物流' }]} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label="风险类型" name="riskType" rules={[{ required: true, message: '请选择风险类型' }]}>
                <Select placeholder="请选择" options={[{ value: '交付风险', label: '交付风险' }, { value: '质量风险', label: '质量风险' }, { value: '库存风险', label: '库存风险' }]} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label="影响等级" name="riskLevel" rules={[{ required: true, message: '请选择影响等级' }]}>
                <Select placeholder="请选择" options={[{ value: '高', label: '高' }, { value: '中', label: '中' }, { value: '低', label: '低' }]} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label="需求数量" name="quantity" rules={[{ required: true, message: '请输入需求数量' }]}>
                <Input placeholder="请输入数量" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="期望到货日期" name="expectedDate" rules={[{ required: true, message: '请选择日期' }]}>
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="申请人" name="applicant" initialValue="系统管理员">
                <Input />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item label="申请原因" name="reason" rules={[{ required: true, message: '请输入申请原因' }]}>
                <Input.TextArea rows={3} placeholder="说明料号申请背景、影响范围和处理建议" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      <Drawer
        className="app-business-detail-drawer"
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
          <Space className="app-business-detail-body" direction="vertical" size={14}>
            <div className="app-business-detail-summary">
              <Typography.Text type="secondary">业务记录</Typography.Text>
              <Typography.Title level={5}>{selectedRowTitle}</Typography.Title>
              <Space wrap>
                {selectedRow.level ? <Tag color={String(selectedRow.level).includes('严重') ? 'red' : 'blue'}>{String(selectedRow.level)}</Tag> : null}
                {selectedRow.status ? <Tag color={String(selectedRow.status).includes('关闭') ? 'default' : 'processing'}>{String(selectedRow.status)}</Tag> : null}
                {selectedRow.source ? <Tag color="cyan">{String(selectedRow.source)}</Tag> : null}
              </Space>
            </div>
            <Descriptions bordered column={1} size="small">
              {detailItems.map((item) => (
                <Descriptions.Item key={item.key} label={item.label}>
                  {formatDetailValue(item.value)}
                </Descriptions.Item>
              ))}
            </Descriptions>
          </Space>
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
