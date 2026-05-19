import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ApartmentOutlined,
  CheckCircleOutlined,
  DatabaseOutlined,
  EditOutlined,
  EyeOutlined,
  FileDoneOutlined,
  FormOutlined,
  LockOutlined,
  NodeIndexOutlined,
  PartitionOutlined,
  SaveOutlined,
  SendOutlined,
  SettingOutlined,
  TeamOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import {
  Button,
  Card,
  Checkbox,
  Col,
  Form,
  Input,
  Row,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';

type FieldType = 'text' | 'number' | 'select' | 'date' | 'upload' | 'subtable';

interface FormField {
  id: string;
  label: string;
  type: FieldType;
  binding: string;
  required: boolean;
  visible: boolean;
  readonly: boolean;
  group: string;
}

interface FlowNode {
  id: string;
  title: string;
  role: string;
  status: 'draft' | 'active' | 'done';
  trigger: string;
}

interface PermissionRow {
  role: string;
  view: boolean;
  create: boolean;
  edit: boolean;
  delete: boolean;
  export: boolean;
  scope: string;
}

const targetNameMap: Record<string, string> = {
  '/dashboard': '生产态势 Dashboard',
  '/maintenance': '设备维护表单',
  '/quality': '质量检验表单',
  '/supply-chain': '供应链风险表单',
  '/reports': '报表中心页面',
  '/ontology': '数据模型页面',
  '/data-sources': '数据源管理页面',
  '/pipeline': '数据管道页面',
  '/graph': '图谱探索页面',
  '/rules': '规则引擎页面',
};

const fieldTypes: { label: string; value: FieldType }[] = [
  { label: '文本', value: 'text' },
  { label: '数字', value: 'number' },
  { label: '下拉选择', value: 'select' },
  { label: '日期', value: 'date' },
  { label: '附件上传', value: 'upload' },
  { label: '子表', value: 'subtable' },
];

const initialFields: FormField[] = [
  {
    id: 'inspection-code',
    label: '点检编号',
    type: 'text',
    binding: 'inspection.code',
    required: true,
    visible: true,
    readonly: true,
    group: '基础信息',
  },
  {
    id: 'equipment',
    label: '设备',
    type: 'select',
    binding: 'equipment.name',
    required: true,
    visible: true,
    readonly: false,
    group: '基础信息',
  },
  {
    id: 'inspection-date',
    label: '点检日期',
    type: 'date',
    binding: 'inspection.date',
    required: true,
    visible: true,
    readonly: false,
    group: '基础信息',
  },
  {
    id: 'health-score',
    label: '健康评分',
    type: 'number',
    binding: 'inspection.health_score',
    required: false,
    visible: true,
    readonly: false,
    group: '点检结果',
  },
  {
    id: 'attachments',
    label: '现场附件',
    type: 'upload',
    binding: 'inspection.attachments',
    required: false,
    visible: true,
    readonly: false,
    group: '点检结果',
  },
];

const flowNodes: FlowNode[] = [
  { id: 'draft', title: '填写草稿', role: '点检员', status: 'done', trigger: '新建表单' },
  { id: 'review', title: '班组长审核', role: '班组长', status: 'active', trigger: '提交后自动进入' },
  { id: 'repair', title: '异常维修任务', role: '维修工程师', status: 'draft', trigger: '健康评分低于 80' },
  { id: 'archive', title: '归档关闭', role: '系统', status: 'draft', trigger: '审核通过后自动归档' },
];

const permissions: PermissionRow[] = [
  { role: '平台管理员', view: true, create: true, edit: true, delete: true, export: true, scope: '全部工厂' },
  { role: '生产经理', view: true, create: true, edit: true, delete: false, export: true, scope: '所属工厂' },
  { role: '班组长', view: true, create: true, edit: true, delete: false, export: false, scope: '所属产线' },
  { role: '点检员', view: true, create: true, edit: false, delete: false, export: false, scope: '本人数据' },
];

export default function AppBuilder() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const targetPage = searchParams.get('target') || '/maintenance';
  const targetName = targetNameMap[targetPage] || '当前业务页面';
  const [fields, setFields] = useState<FormField[]>(initialFields);
  const [selectedId, setSelectedId] = useState(initialFields[0].id);

  const selected = fields.find((field) => field.id === selectedId) ?? fields[0];

  const studioSchema = useMemo(() => ({
    page: targetPage,
    title: targetName,
    form: fields,
    workflow: flowNodes,
    permissions,
    version: 'draft',
  }), [fields, targetName, targetPage]);

  const updateSelected = (patch: Partial<FormField>) => {
    setFields((prev) => prev.map((field) => (field.id === selected.id ? { ...field, ...patch } : field)));
  };

  const handleDraft = () => {
    message.success('已保存为草稿');
  };

  const handlePublish = () => {
    message.success('已发布配置');
  };

  const tabs = [
    {
      key: 'form',
      label: '表单设置',
      children: (
        <FormSettings
          fields={fields}
          selected={selected}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onUpdate={updateSelected}
        />
      ),
    },
    {
      key: 'workflow',
      label: '流程设置',
      children: <WorkflowSettings />,
    },
    {
      key: 'permission',
      label: '权限设置',
      children: <PermissionSettings />,
    },
  ];

  return (
    <div className="app-builder-page form-studio-page">
      <section className="builder-header form-studio-header">
        <div>
          <Tag className="system-tag">Form Studio</Tag>
          <Typography.Title level={3}>{targetName}配置</Typography.Title>
          <Typography.Paragraph>
            正在配置：{targetPage}。这里统一管理该页面的表单、流程和权限，发布后影响业务运行态。
          </Typography.Paragraph>
        </div>
        <Space wrap>
          <Button icon={<EyeOutlined />} onClick={() => navigate(targetPage)}>
            返回业务页
          </Button>
          <Button icon={<SaveOutlined />} onClick={handleDraft}>
            保存草稿
          </Button>
          <Button type="primary" icon={<SendOutlined />} onClick={handlePublish}>
            发布配置
          </Button>
        </Space>
      </section>

      <Card className="studio-tabs-card">
        <Tabs defaultActiveKey="form" items={tabs} />
      </Card>

      <Card className="schema-card" title="配置 Schema / Runtime Contract">
        <pre>{JSON.stringify(studioSchema, null, 2)}</pre>
      </Card>
    </div>
  );
}

function FormSettings({
  fields,
  selected,
  selectedId,
  onSelect,
  onUpdate,
}: {
  fields: FormField[];
  selected: FormField;
  selectedId: string;
  onSelect: (id: string) => void;
  onUpdate: (patch: Partial<FormField>) => void;
}) {
  return (
    <div className="builder-shell form-settings-shell">
      <aside className="builder-sidebar">
        <PanelTitle icon={<FormOutlined />} title="字段与组件" />
        <div className="builder-palette">
          {fields.map((field) => (
            <button
              key={field.id}
              className={selectedId === field.id ? 'active' : ''}
              onClick={() => onSelect(field.id)}
            >
              <span><FieldIcon type={field.type} /></span>
              <strong>{field.label}</strong>
              <small>{field.binding}</small>
            </button>
          ))}
        </div>
      </aside>

      <main className="builder-canvas form-canvas">
        <div className="canvas-topbar">
          <span>业务表单画布</span>
          <Space size={6}>
            <Tag>双列布局</Tag>
            <Tag>{fields.length} fields</Tag>
            <Tag color="processing">Draft</Tag>
          </Space>
        </div>
        <Row gutter={[12, 12]}>
          {fields.map((field) => (
            <Col xs={24} md={field.type === 'upload' || field.type === 'subtable' ? 24 : 12} key={field.id}>
              <button
                className={`form-field-preview ${selectedId === field.id ? 'selected' : ''}`}
                onClick={() => onSelect(field.id)}
              >
                <label>
                  {field.label}
                  {field.required && <Tag color="red">必填</Tag>}
                  {field.readonly && <Tag>只读</Tag>}
                </label>
                <div className={`field-control field-${field.type}`}>
                  <span>{fieldTypes.find((type) => type.value === field.type)?.label}</span>
                </div>
                <small>{field.group} · {field.binding}</small>
              </button>
            </Col>
          ))}
        </Row>
      </main>

      <aside className="builder-properties">
        <PanelTitle icon={<SettingOutlined />} title="字段属性" />
        <Form layout="vertical" size="small">
          <Form.Item label="字段名称">
            <Input value={selected.label} onChange={(event) => onUpdate({ label: event.target.value })} />
          </Form.Item>
          <Form.Item label="控件类型">
            <Select value={selected.type} options={fieldTypes} onChange={(type) => onUpdate({ type })} />
          </Form.Item>
          <Form.Item label="数据绑定">
            <Input value={selected.binding} onChange={(event) => onUpdate({ binding: event.target.value })} />
          </Form.Item>
          <Form.Item label="所属分组">
            <Select
              value={selected.group}
              options={['基础信息', '点检结果', '异常处理', '附件信息'].map((group) => ({ label: group, value: group }))}
              onChange={(group) => onUpdate({ group })}
            />
          </Form.Item>
          <div className="property-switches">
            <Switch checked={selected.required} onChange={(required) => onUpdate({ required })} />
            <span>必填</span>
            <Switch checked={selected.visible} onChange={(visible) => onUpdate({ visible })} />
            <span>可见</span>
            <Switch checked={selected.readonly} onChange={(readonly) => onUpdate({ readonly })} />
            <span>只读</span>
          </div>
        </Form>
      </aside>
    </div>
  );
}

function WorkflowSettings() {
  return (
    <div className="studio-two-column">
      <Card className="studio-panel" title="流程节点">
        <div className="flow-canvas">
          {flowNodes.map((node, index) => (
            <div className={`flow-node flow-node-${node.status}`} key={node.id}>
              <span>{index + 1}</span>
              <div>
                <strong>{node.title}</strong>
                <small>{node.role} · {node.trigger}</small>
              </div>
              <Tag color={node.status === 'done' ? 'success' : node.status === 'active' ? 'processing' : 'default'}>
                {node.status === 'done' ? '已完成' : node.status === 'active' ? '进行中' : '待配置'}
              </Tag>
            </div>
          ))}
        </div>
      </Card>
      <Card className="studio-panel" title="节点属性">
        <Form layout="vertical" size="small">
          <Form.Item label="默认审批角色">
            <Select value="班组长" options={['班组长', '生产经理', '质量工程师', '平台管理员'].map((role) => ({ label: role, value: role }))} />
          </Form.Item>
          <Form.Item label="触发条件">
            <Input value="提交表单后自动进入审批" readOnly />
          </Form.Item>
          <Form.Item label="异常分支">
            <Checkbox.Group value={['repair', 'notify']} options={[
              { label: '生成维修任务', value: 'repair' },
              { label: '通知生产经理', value: 'notify' },
              { label: '锁定记录', value: 'lock' },
            ]} />
          </Form.Item>
          <Form.Item label="超时策略">
            <Select value="24h-remind" options={[
              { label: '24 小时未处理自动提醒', value: '24h-remind' },
              { label: '48 小时自动升级', value: '48h-escalate' },
            ]} />
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}

function PermissionSettings() {
  const columns = [
    { title: '角色', dataIndex: 'role', key: 'role' },
    { title: '查看', dataIndex: 'view', key: 'view', render: renderSwitch },
    { title: '新增', dataIndex: 'create', key: 'create', render: renderSwitch },
    { title: '编辑', dataIndex: 'edit', key: 'edit', render: renderSwitch },
    { title: '删除', dataIndex: 'delete', key: 'delete', render: renderSwitch },
    { title: '导出', dataIndex: 'export', key: 'export', render: renderSwitch },
    { title: '数据范围', dataIndex: 'scope', key: 'scope' },
  ];

  return (
    <div className="permission-settings">
      <Card className="studio-panel" title="角色权限矩阵">
        <Table rowKey="role" columns={columns} dataSource={permissions} pagination={false} size="small" />
      </Card>
      <Row gutter={[12, 12]}>
        <Col xs={24} lg={12}>
          <Card className="studio-panel" title="字段级权限">
            <div className="permission-list">
              <PermissionItem title="健康评分" detail="班组长可编辑，点检员只读" icon={<LockOutlined />} />
              <PermissionItem title="现场附件" detail="点检员可上传，生产经理可查看" icon={<FileDoneOutlined />} />
              <PermissionItem title="异常原因" detail="维修工程师可编辑" icon={<ThunderboltOutlined />} />
            </div>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card className="studio-panel" title="发布范围">
            <div className="permission-list">
              <PermissionItem title="组织范围" detail="华东工厂 / A 产线 / 维修班组" icon={<ApartmentOutlined />} />
              <PermissionItem title="数据范围" detail="按所属工厂、所属产线和本人数据过滤" icon={<DatabaseOutlined />} />
              <PermissionItem title="审计策略" detail="记录字段变更、审批动作和发布版本" icon={<TeamOutlined />} />
            </div>
          </Card>
        </Col>
      </Row>
    </div>
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

function FieldIcon({ type }: { type: FieldType }) {
  if (type === 'select') return <NodeIndexOutlined />;
  if (type === 'date') return <CheckCircleOutlined />;
  if (type === 'upload') return <FileDoneOutlined />;
  if (type === 'subtable') return <PartitionOutlined />;
  if (type === 'number') return <EditOutlined />;
  return <FormOutlined />;
}

function PermissionItem({ title, detail, icon }: { title: string; detail: string; icon: ReactNode }) {
  return (
    <div className="permission-item">
      <span>{icon}</span>
      <div>
        <strong>{title}</strong>
        <small>{detail}</small>
      </div>
    </div>
  );
}

function renderSwitch(value: boolean) {
  return <Switch size="small" checked={value} />;
}
