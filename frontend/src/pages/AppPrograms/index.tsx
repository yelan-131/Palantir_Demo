import React from 'react';
import { AppstoreOutlined, ArrowLeftOutlined, CheckCircleOutlined, DatabaseOutlined, ExperimentOutlined, FieldTimeOutlined, FileSearchOutlined, LineChartOutlined, ShopOutlined, ToolOutlined, WarningOutlined } from '@ant-design/icons';
import { Button, Card, Col, Empty, Progress, Row, Space, Statistic, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useNavigate, useParams } from 'react-router-dom';
import './style.css';

type ProgramKind = 'business' | 'analysis';

type ProgramRow = Record<string, string | number>;

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
  'quality-event': {
    id: 'quality-event',
    title: '质量事件',
    subtitle: '跟踪 CAPA、临时遏制、根因分析和长期改善。',
    kind: 'business',
    owner: '质量负责人',
    icon: <CheckCircleOutlined />,
    metrics: [
      { label: '打开事件', value: 12, tone: 'orange' },
      { label: '逾期风险', value: 2, tone: 'red' },
      { label: '已关闭', value: 34, tone: 'green' },
      { label: '平均周期', value: 5.8, suffix: 'd', tone: 'blue' },
    ],
    focus: ['事件分级', '根因与措施', '关闭验证'],
    columns: [
      { title: '事件编号', dataIndex: 'eventNo' },
      { title: '主题', dataIndex: 'subject' },
      { title: '责任人', dataIndex: 'owner' },
      { title: '阶段', dataIndex: 'stage' },
    ],
    rows: [
      { key: 'qe-1', eventNo: 'QE-2605-006', subject: '电控板虚焊复发', owner: '王工', stage: '根因分析' },
      { key: 'qe-2', eventNo: 'QE-2605-011', subject: '涂层色差客户反馈', owner: '赵工', stage: '措施验证' },
      { key: 'qe-3', eventNo: 'QE-2605-014', subject: '包装破损抽检异常', owner: '钱工', stage: '临时遏制' },
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
    rows: [
      { key: 'rr-1', riskNo: 'SR-2605-031', subject: '压铸件供应中断风险', level: '高', owner: '采购一组' },
      { key: 'rr-2', riskNo: 'SR-2605-045', subject: '进口芯片清关延迟', level: '中', owner: '计划二组' },
      { key: 'rr-3', riskNo: 'SR-2605-052', subject: '包装材料安全库存不足', level: '中', owner: '仓储组' },
    ],
  },
};

const toneClassMap: Record<ProgramDefinition['metrics'][number]['tone'], string> = {
  blue: 'program-stat-blue',
  green: 'program-stat-green',
  orange: 'program-stat-orange',
  red: 'program-stat-red',
};

function AppProgramPage() {
  const { programId } = useParams();
  const navigate = useNavigate();
  const program = programId ? programDefinitions[programId] : undefined;

  if (!program) {
    return (
      <Card>
        <Empty description="未找到对应的菜单程序">
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>返回</Button>
        </Empty>
      </Card>
    );
  }

  return (
    <div className="app-program-page">
      <div className="app-program-header">
        <div className="app-program-title-block">
          <span className="app-program-icon">{program.icon}</span>
          <div>
            <Space size={8} align="center" wrap>
              <Typography.Title level={3}>{program.title}</Typography.Title>
              <Tag color={program.kind === 'analysis' ? 'blue' : 'green'}>
                {program.kind === 'analysis' ? '分析展示类' : '业务交互类'}
              </Tag>
            </Space>
            <Typography.Text type="secondary">{program.subtitle}</Typography.Text>
          </div>
        </div>
        <Space>
          <Tag color="default">负责人：{program.owner}</Tag>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>返回</Button>
        </Space>
      </div>

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
        <Col xs={24} lg={7}>
          <Card title="程序关注点" className="app-program-card">
            <Space direction="vertical" size={10} className="app-program-focus">
              {program.focus.map((item, index) => (
                <div className="app-program-focus-item" key={item}>
                  <span>{index + 1}</span>
                  <Typography.Text>{item}</Typography.Text>
                </div>
              ))}
            </Space>
          </Card>
        </Col>
        <Col xs={24} lg={17}>
          <Card title="主题数据" className="app-program-card">
            <Table<ProgramRow>
              rowKey="key"
              size="middle"
              columns={program.columns}
              dataSource={program.rows}
              pagination={false}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}

export default AppProgramPage;
