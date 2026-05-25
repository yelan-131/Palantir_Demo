import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  BranchesOutlined,
  CheckCircleOutlined,
  EyeOutlined,
  FileDoneOutlined,
  FormOutlined,
  LockOutlined,
  NodeIndexOutlined,
  SaveOutlined,
  SendOutlined,
  SettingOutlined,
  TableOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { Button, Card, Checkbox, Col, Empty, Form, Input, Row, Select, Space, Switch, Table, Tabs, Tag, Typography, message } from 'antd';
import { getSemanticPageContract } from '@/services/api';

type FieldContract = {
  name: string;
  label: string;
  type: string;
  source_field: string;
  list: boolean;
  form: boolean;
  search: boolean;
};

type RelationContract = {
  id: number;
  source: string;
  type: string;
  label: string;
  target: string;
  graph: boolean;
  description: string;
};

type EntityContract = {
  id: string;
  name: string;
  code: string;
  source: string;
  description: string;
  fields: FieldContract[];
};

type PageContract = {
  route: string;
  title: string;
  entity: string;
  description: string;
  components: string[];
  actions: string[];
  entity_detail?: EntityContract;
  relations?: RelationContract[];
};

const fallbackContract: PageContract = {
  route: '/maintenance',
  title: '预测性维护',
  entity: 'Device',
  description: '以设备为主对象，配置健康总览、故障预测和工单流转。',
  components: ['设备健康总览', '健康分析', '故障预测', '工单管理'],
  actions: ['创建维修工单', '确认告警', '查看关联图谱'],
  entity_detail: {
    id: 'Device',
    name: '设备',
    code: 'Device',
    source: 'equipment',
    description: '制造现场的核心设备对象。',
    fields: [
      { name: 'name', label: '设备名称', type: 'string', source_field: 'equipment.name', list: true, form: true, search: true },
      { name: 'model', label: '型号', type: 'string', source_field: 'equipment.model', list: true, form: true, search: true },
      { name: 'status', label: '运行状态', type: 'enum', source_field: 'equipment.status', list: true, form: true, search: true },
      { name: 'health_score', label: '健康分', type: 'float', source_field: 'equipment.health_score', list: true, form: false, search: false },
    ],
  },
  relations: [
    { id: 1, source: 'Device', type: 'GENERATES', label: '产生', target: 'Alert', graph: true, description: '设备异常产生告警' },
    { id: 2, source: 'Alert', type: 'CREATES', label: '触发', target: 'WorkOrder', graph: true, description: '告警触发工单' },
  ],
};

const permissions = [
  { role: '平台管理员', view: true, create: true, edit: true, approve: true, export: true, scope: '全部对象和字段' },
  { role: '生产经理', view: true, create: true, edit: true, approve: true, export: true, scope: '当前应用绑定对象' },
  { role: '质量工程师', view: true, create: true, edit: false, approve: false, export: true, scope: '质量相关对象只读' },
  { role: '普通用户', view: true, create: false, edit: false, approve: false, export: false, scope: '本人相关记录' },
];

export default function AppBuilder() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const targetPage = searchParams.get('target') || '/maintenance';
  const [contract, setContract] = useState<PageContract>(fallbackContract);
  const [loading, setLoading] = useState(false);
  const [selectedField, setSelectedField] = useState<string>('');

  useEffect(() => {
    setLoading(true);
    getSemanticPageContract(targetPage)
      .then((res) => {
        const next = res.data?.data ?? fallbackContract;
        setContract(next);
        setSelectedField(next.entity_detail?.fields?.[0]?.name ?? '');
      })
      .catch(() => {
        setContract({ ...fallbackContract, route: targetPage });
        setSelectedField(fallbackContract.entity_detail?.fields?.[0]?.name ?? '');
      })
      .finally(() => setLoading(false));
  }, [targetPage]);

  const fields = contract.entity_detail?.fields ?? [];
  const selected = useMemo(
    () => fields.find((field) => field.name === selectedField) ?? fields[0],
    [fields, selectedField],
  );

  const tabs = [
    {
      key: 'form',
      label: '表单设置',
      children: (
        <FormSettings
          contract={contract}
          fields={fields}
          selected={selected}
          selectedField={selectedField}
          onSelect={setSelectedField}
        />
      ),
    },
    {
      key: 'workflow',
      label: '流程设置',
      children: <WorkflowSettings contract={contract} />,
    },
    {
      key: 'permission',
      label: '权限设置',
      children: <PermissionSettings />,
    },
  ];

  return (
    <div className="app-builder-page form-studio-page semantic-page-config">
      <section className="builder-header form-studio-header">
        <div>
          <Typography.Title level={3}>{contract.title}设置</Typography.Title>
          <Typography.Paragraph>
            当前页面绑定本体对象 <Tag color="processing">{contract.entity}</Tag>
            ，字段、流程、权限都从该对象的语义模型中配置。
          </Typography.Paragraph>
        </div>
        <Space wrap>
          <Button icon={<EyeOutlined />} onClick={() => navigate(targetPage)}>
            返回页面
          </Button>
          <Button icon={<SaveOutlined />} onClick={() => message.success('已保存为草稿')}>
            保存草稿
          </Button>
          <Button type="primary" icon={<SendOutlined />} onClick={() => message.success('页面配置已发布')}>
            发布配置
          </Button>
        </Space>
      </section>

      <Row gutter={[16, 16]} className="semantic-contract-summary">
        <Col xs={24} lg={8}>
          <SummaryCard icon={<NodeIndexOutlined />} label="绑定对象" value={contract.entity_detail?.name ?? contract.entity} detail={contract.entity_detail?.source ?? '-'} />
        </Col>
        <Col xs={24} lg={8}>
          <SummaryCard icon={<TableOutlined />} label="页面组件" value={`${contract.components.length} 个`} detail={contract.components.join(' / ')} />
        </Col>
        <Col xs={24} lg={8}>
          <SummaryCard icon={<BranchesOutlined />} label="图谱关系" value={`${contract.relations?.length ?? 0} 条`} detail="用于详情关联图、路径分析和影响分析" />
        </Col>
      </Row>

      <Card className="studio-tabs-card" loading={loading}>
        <Tabs defaultActiveKey="form" items={tabs} />
      </Card>
    </div>
  );
}

function FormSettings({
  contract,
  fields,
  selected,
  selectedField,
  onSelect,
}: {
  contract: PageContract;
  fields: FieldContract[];
  selected?: FieldContract;
  selectedField: string;
  onSelect: (field: string) => void;
}) {
  if (!contract.entity_detail) {
    return <Empty description="该页面还没有绑定本体对象" />;
  }

  return (
    <div className="builder-shell form-settings-shell">
      <aside className="builder-sidebar">
        <PanelTitle icon={<FormOutlined />} title="对象字段" />
        <div className="builder-palette">
          {fields.map((field) => (
            <button
              key={field.name}
              className={selectedField === field.name ? 'active' : ''}
              onClick={() => onSelect(field.name)}
            >
              <span><FormOutlined /></span>
              <strong>{field.label}</strong>
              <small>{field.source_field}</small>
            </button>
          ))}
        </div>
      </aside>

      <main className="builder-canvas form-canvas">
        <div className="canvas-topbar">
          <span>{contract.title} / {contract.entity_detail.name}</span>
          <Space size={6}>
            <Tag>{contract.entity_detail.source}</Tag>
            <Tag>{fields.length} fields</Tag>
            <Tag color="processing">Draft</Tag>
          </Space>
        </div>
        <Row gutter={[12, 12]}>
          {fields.map((field) => (
            <Col xs={24} md={field.name === 'health_score' ? 12 : 8} key={field.name}>
              <button
                className={`form-field-preview ${selectedField === field.name ? 'selected' : ''}`}
                onClick={() => onSelect(field.name)}
              >
                <label>
                  {field.label}
                  {field.list && <Tag color="blue">列表</Tag>}
                  {field.form && <Tag color="green">表单</Tag>}
                </label>
                <div className="field-control field-form">
                  <FormOutlined />
                  <span>{field.type}</span>
                </div>
                <small>{field.source_field}</small>
              </button>
            </Col>
          ))}
        </Row>
      </main>

      <aside className="builder-properties">
        <PanelTitle icon={<SettingOutlined />} title="字段属性" />
        {selected ? (
          <Form layout="vertical" size="small">
            <Form.Item label="字段名称">
              <Input value={selected.label} readOnly />
            </Form.Item>
            <Form.Item label="字段编码">
              <Input value={selected.name} readOnly />
            </Form.Item>
            <Form.Item label="来源字段">
              <Input value={selected.source_field} readOnly />
            </Form.Item>
            <Form.Item label="字段类型">
              <Select value={selected.type} options={[{ label: selected.type, value: selected.type }]} />
            </Form.Item>
            <div className="property-switches">
              <Switch checked={selected.list} />
              <span>列表展示</span>
              <Switch checked={selected.form} />
              <span>表单编辑</span>
              <Switch checked={selected.search} />
              <span>查询条件</span>
            </div>
          </Form>
        ) : (
          <Typography.Text type="secondary">请选择一个字段</Typography.Text>
        )}
      </aside>
    </div>
  );
}

function WorkflowSettings({ contract }: { contract: PageContract }) {
  const actions = contract.actions.map((action, index) => ({
    id: action,
    step: index + 1,
    action,
    role: index === 0 ? '业务负责人' : index === 1 ? '审批人' : '平台规则',
    trigger: `${contract.entity}.${action}`,
  }));

  return (
    <div className="studio-two-column">
      <Card className="studio-panel" title="对象动作流程">
        <div className="flow-canvas">
          {actions.map((item) => (
            <div className="flow-node flow-node-active" key={item.id}>
              <span>{item.step}</span>
              <div>
                <strong>{item.action}</strong>
                <small>{item.role} / {item.trigger}</small>
              </div>
              <Tag color="processing">可配置</Tag>
            </div>
          ))}
        </div>
      </Card>
      <Card className="studio-panel" title="流程规则">
        <Form layout="vertical" size="small">
          <Form.Item label="触发对象">
            <Input value={contract.entity} readOnly />
          </Form.Item>
          <Form.Item label="审批策略">
            <Select value="role-chain" options={[{ label: '按角色链路审批', value: 'role-chain' }]} />
          </Form.Item>
          <Form.Item label="超时动作">
            <Select value="24h-remind" options={[{ label: '24 小时未处理提醒', value: '24h-remind' }]} />
          </Form.Item>
          <Form.Item label="联动能力">
            <Checkbox.Group value={['notify', 'graph']} options={[
              { label: '发送通知', value: 'notify' },
              { label: '写入对象时间线', value: 'timeline' },
              { label: '更新图谱关系', value: 'graph' },
            ]} />
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}

function PermissionSettings() {
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card className="studio-panel" title="对象权限矩阵">
        <Table
          rowKey="role"
          size="small"
          dataSource={permissions}
          pagination={false}
          columns={[
            { title: '角色', dataIndex: 'role' },
            { title: '查看', dataIndex: 'view', render: boolTag },
            { title: '新增', dataIndex: 'create', render: boolTag },
            { title: '编辑', dataIndex: 'edit', render: boolTag },
            { title: '审批', dataIndex: 'approve', render: boolTag },
            { title: '导出', dataIndex: 'export', render: boolTag },
            { title: '数据范围', dataIndex: 'scope' },
          ]}
        />
      </Card>
      <Row gutter={[12, 12]}>
        <Col xs={24} lg={8}>
          <PermissionItem title="字段级权限" detail="控制敏感字段是否可见、可编辑、可导出。" icon={<LockOutlined />} />
        </Col>
        <Col xs={24} lg={8}>
          <PermissionItem title="动作级权限" detail="控制按钮、流程动作和批量操作入口。" icon={<ThunderboltOutlined />} />
        </Col>
        <Col xs={24} lg={8}>
          <PermissionItem title="对象级范围" detail="按应用、组织、角色和本人数据过滤记录。" icon={<FileDoneOutlined />} />
        </Col>
      </Row>
    </Space>
  );
}

function SummaryCard({ icon, label, value, detail }: { icon: ReactNode; label: string; value: string; detail: string }) {
  return (
    <Card className="semantic-summary-card">
      <Space align="start">
        <span className="semantic-summary-icon">{icon}</span>
        <div>
          <Typography.Text type="secondary">{label}</Typography.Text>
          <Typography.Title level={4}>{value}</Typography.Title>
          <Typography.Text type="secondary">{detail}</Typography.Text>
        </div>
      </Space>
    </Card>
  );
}

function PanelTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="builder-panel-title">
      {icon}
      <span>{title}</span>
    </div>
  );
}

function PermissionItem({ title, detail, icon }: { title: string; detail: string; icon: ReactNode }) {
  return (
    <Card className="studio-panel permission-item-card">
      <Space align="start">
        <span className="semantic-summary-icon">{icon}</span>
        <div>
          <Typography.Text strong>{title}</Typography.Text>
          <br />
          <Typography.Text type="secondary">{detail}</Typography.Text>
        </div>
      </Space>
    </Card>
  );
}

function boolTag(value: boolean) {
  return value ? <Tag color="success" icon={<CheckCircleOutlined />}>允许</Tag> : <Tag>禁止</Tag>;
}

