import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeftOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  CopyOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  DragOutlined,
  FileImageOutlined,
  FileSearchOutlined,
  FormOutlined,
  HolderOutlined,
  LinkOutlined,
  LockOutlined,
  NumberOutlined,
  PaperClipOutlined,
  SaveOutlined,
  SearchOutlined,
  SelectOutlined,
  SettingOutlined,
  SwitcherOutlined,
  TableOutlined,
  TagsOutlined,
  UserOutlined,
  UserSwitchOutlined,
} from '@ant-design/icons';
import { Button, Input, Select, Space, Tabs, Tag, Typography, message } from 'antd';
import { useNavigate, useParams } from 'react-router-dom';
import './style.css';

type DesignerTab = 'form' | 'filter' | 'flow' | 'permission';
type ControlSource = 'field' | 'component';

interface DesignerField {
  key: string;
  name: string;
  type: string;
  placeholder: string;
  locked?: boolean;
}

interface DesignerConfig {
  id: string;
  name: string;
  createTitle: string;
  kind: 'business' | 'analysis';
  appName: string;
  dataSource: string;
  primaryKey: string;
  status: string;
  description: string;
  fields: DesignerField[];
  filters: DesignerField[];
  flowSteps: string[];
  roles: string[];
}

interface ComponentDefinition {
  key: string;
  category: string;
  name: string;
  desc: string;
  icon: React.ReactNode;
  controlType: string;
  defaultWidth?: 'half' | 'full';
}

interface LayoutControl {
  id: string;
  source: ControlSource;
  controlType: string;
  name: string;
  desc?: string;
  fieldKey?: string;
  width: 'half' | 'full';
}

const configs: Record<string, DesignerConfig> = {
  'risk-review': {
    id: 'risk-review',
    name: '风险复核',
    createTitle: '新增风险复核单',
    kind: 'business',
    appName: '供应链风险',
    dataSource: 'risk_reviews',
    primaryKey: 'riskNo',
    status: '草稿',
    description: '用于新增风险复核业务数据，而不是配置整个运行页面。',
    fields: [
      { key: 'riskNo', name: '风险单号', type: '文本 / 主键', placeholder: '自动生成 SR-2605-001', locked: true },
      { key: 'subject', name: '风险主题', type: '文本', placeholder: '请输入风险主题' },
      { key: 'level', name: '风险等级', type: '枚举', placeholder: '高 / 中 / 低' },
      { key: 'owner', name: '处理人', type: '人员', placeholder: '选择处理人' },
      { key: 'reason', name: '风险原因', type: '长文本', placeholder: '描述原因和影响范围' },
    ],
    filters: [
      { key: 'keyword', name: '业务编号 / 主题', type: '搜索框', placeholder: '输入关键词' },
      { key: 'status', name: '状态', type: '枚举', placeholder: '请选择状态' },
      { key: 'level', name: '等级', type: '枚举', placeholder: '请选择等级' },
      { key: 'owner', name: '负责人', type: '人员', placeholder: '请选择负责人' },
    ],
    flowSteps: ['提交复核', '风险定级', '责任分派', '处理关闭'],
    roles: ['采购管理', '计划管理', '仓储管理', '系统管理员'],
  },
  'alert-center': {
    id: 'alert-center',
    name: '告警中心',
    createTitle: '新增设备告警',
    kind: 'business',
    appName: '预测性维护',
    dataSource: 'equipment_alerts',
    primaryKey: 'alertId',
    status: '已发布',
    description: '用于新增设备告警数据，字段和风险复核不同。',
    fields: [
      { key: 'alertId', name: '告警编号', type: '文本 / 主键', placeholder: '自动生成 AL-2605-001', locked: true },
      { key: 'title', name: '告警标题', type: '文本', placeholder: '请输入告警标题' },
      { key: 'device', name: '关联设备', type: '关联对象', placeholder: '选择设备' },
      { key: 'level', name: '告警等级', type: '枚举', placeholder: '严重 / 一般 / 提醒' },
      { key: 'owner', name: '处理人', type: '人员', placeholder: '选择处理人' },
    ],
    filters: [
      { key: 'keyword', name: '告警编号 / 标题', type: '搜索框', placeholder: '输入关键词' },
      { key: 'device', name: '设备', type: '关联对象', placeholder: '选择设备' },
      { key: 'level', name: '等级', type: '枚举', placeholder: '请选择等级' },
      { key: 'status', name: '状态', type: '枚举', placeholder: '请选择状态' },
    ],
    flowSteps: ['告警创建', '工程师认领', '现场处理', '关闭归档'],
    roles: ['设备工程', '生产经理', '质量工程师', '系统管理员'],
  },
};

const defaultConfig: DesignerConfig = {
  id: 'unknown',
  name: '表单设置',
  createTitle: '新增业务数据',
  kind: 'business',
  appName: '当前应用',
  dataSource: 'business_records',
  primaryKey: 'id',
  status: '草稿',
  description: '配置当前表单的新增画布、筛选、流程和权限。',
  fields: [
    { key: 'id', name: '编号', type: '文本 / 主键', placeholder: '自动生成', locked: true },
    { key: 'name', name: '名称', type: '文本', placeholder: '请输入名称' },
    { key: 'status', name: '状态', type: '枚举', placeholder: '请选择状态' },
  ],
  filters: [
    { key: 'keyword', name: '关键词', type: '搜索框', placeholder: '请输入关键词' },
    { key: 'status', name: '状态', type: '枚举', placeholder: '请选择状态' },
  ],
  flowSteps: ['提交', '审批', '归档'],
  roles: ['系统管理员'],
};

const tabs = [
  { key: 'form', label: '表单设计', icon: <FormOutlined /> },
  { key: 'filter', label: '数据筛选', icon: <SearchOutlined /> },
  { key: 'flow', label: '流程设计', icon: <UserSwitchOutlined /> },
  { key: 'permission', label: '权限设计', icon: <LockOutlined /> },
];

const versionOptions = [
  { value: 'v0.1', label: 'v0.1 当前草稿' },
  { value: 'v0.0', label: 'v0.0 已发布' },
  { value: 'history', label: '历史版本' },
];

const componentGroups: Array<{ category: string; items: ComponentDefinition[] }> = [
  {
    category: '字段控件',
    items: [
      { key: 'text', category: '字段控件', name: '文本输入', desc: '名称、编号、标题', icon: <FormOutlined />, controlType: 'text' },
      { key: 'textarea', category: '字段控件', name: '多行文本', desc: '备注、原因、说明', icon: <FileSearchOutlined />, controlType: 'textarea', defaultWidth: 'full' },
      { key: 'number', category: '字段控件', name: '数字输入', desc: '数量、金额、评分', icon: <NumberOutlined />, controlType: 'number' },
      { key: 'datetime', category: '字段控件', name: '日期时间', desc: '日期、时间、区间', icon: <CalendarOutlined />, controlType: 'datetime' },
      { key: 'select', category: '字段控件', name: '下拉选择', desc: '枚举字段', icon: <SelectOutlined />, controlType: 'select' },
      { key: 'multi-select', category: '字段控件', name: '多选', desc: '标签、类别、多个原因', icon: <TagsOutlined />, controlType: 'multi-select' },
      { key: 'user', category: '字段控件', name: '人员选择', desc: '负责人、审批人、处理人', icon: <UserOutlined />, controlType: 'user' },
      { key: 'relation', category: '字段控件', name: '关联对象', desc: '设备、供应商、物料、工单', icon: <LinkOutlined />, controlType: 'relation' },
      { key: 'upload', category: '字段控件', name: '附件上传', desc: '图片、文档、证明材料', icon: <PaperClipOutlined />, controlType: 'upload', defaultWidth: 'full' },
      { key: 'switch', category: '字段控件', name: '开关', desc: '是否启用、是否紧急', icon: <SwitcherOutlined />, controlType: 'switch' },
    ],
  },
  {
    category: '布局容器',
    items: [
      { key: 'section', category: '布局容器', name: '分组面板', desc: '基础信息、业务信息、处理信息', icon: <HolderOutlined />, controlType: 'section', defaultWidth: 'full' },
      { key: 'two-columns', category: '布局容器', name: '两列布局', desc: '左右两列排版', icon: <HolderOutlined />, controlType: 'two-columns', defaultWidth: 'full' },
      { key: 'three-columns', category: '布局容器', name: '三列布局', desc: '紧凑字段排版', icon: <HolderOutlined />, controlType: 'three-columns', defaultWidth: 'full' },
      { key: 'collapse', category: '布局容器', name: '折叠区域', desc: '高级配置、补充信息', icon: <HolderOutlined />, controlType: 'collapse', defaultWidth: 'full' },
      { key: 'tabs', category: '布局容器', name: 'Tab 区域', desc: '大型表单分多页签', icon: <HolderOutlined />, controlType: 'tabs', defaultWidth: 'full' },
      { key: 'divider', category: '布局容器', name: '分割线', desc: '视觉分隔', icon: <HolderOutlined />, controlType: 'divider', defaultWidth: 'full' },
      { key: 'hint', category: '布局容器', name: '提示文本', desc: '说明、警告、填写提示', icon: <FileSearchOutlined />, controlType: 'hint', defaultWidth: 'full' },
    ],
  },
  {
    category: '明细组件',
    items: [
      { key: 'editable-table', category: '明细组件', name: '可编辑子表', desc: '物料明细、检验项、风险项', icon: <TableOutlined />, controlType: 'editable-table', defaultWidth: 'full' },
      { key: 'readonly-table', category: '明细组件', name: '只读关联表', desc: '历史告警、风险记录', icon: <TableOutlined />, controlType: 'readonly-table', defaultWidth: 'full' },
      { key: 'detail-cards', category: '明细组件', name: '明细卡片列表', desc: '小数据量明细展示', icon: <TableOutlined />, controlType: 'detail-cards', defaultWidth: 'full' },
    ],
  },
  {
    category: '展示组件',
    items: [
      { key: 'readonly-text', category: '展示组件', name: '只读文本', desc: '系统生成值、说明值', icon: <FileSearchOutlined />, controlType: 'readonly-text' },
      { key: 'status-tag', category: '展示组件', name: '状态标签', desc: '状态、等级、颜色', icon: <TagsOutlined />, controlType: 'status-tag' },
      { key: 'file-preview', category: '展示组件', name: '图片/附件预览', desc: '文件查看与预览', icon: <FileImageOutlined />, controlType: 'file-preview', defaultWidth: 'full' },
      { key: 'description', category: '展示组件', name: '说明块', desc: '填写规则、业务说明', icon: <FileSearchOutlined />, controlType: 'description', defaultWidth: 'full' },
      { key: 'summary-card', category: '展示组件', name: '数据摘要卡', desc: '关联对象摘要', icon: <DatabaseOutlined />, controlType: 'summary-card', defaultWidth: 'full' },
    ],
  },
  {
    category: '业务增强',
    items: [
      { key: 'approval-comment', category: '业务增强', name: '审批意见区', desc: '流程处理意见', icon: <UserSwitchOutlined />, controlType: 'approval-comment', defaultWidth: 'full' },
      { key: 'operation-log', category: '业务增强', name: '操作日志', desc: '历史操作记录', icon: <FileSearchOutlined />, controlType: 'operation-log', defaultWidth: 'full' },
      { key: 'status-flow', category: '业务增强', name: '状态流转条', desc: '草稿、处理中、已关闭', icon: <UserSwitchOutlined />, controlType: 'status-flow', defaultWidth: 'full' },
      { key: 'relation-summary', category: '业务增强', name: '关联对象摘要', desc: '设备/供应商/物料摘要', icon: <LinkOutlined />, controlType: 'relation-summary', defaultWidth: 'full' },
      { key: 'risk-level', category: '业务增强', name: '风险等级选择器', desc: '颜色与规则说明', icon: <TagsOutlined />, controlType: 'risk-level' },
      { key: 'validation-panel', category: '业务增强', name: '校验提示区', desc: '重复、缺失、异常', icon: <FileSearchOutlined />, controlType: 'validation-panel', defaultWidth: 'full' },
    ],
  },
];

function fieldInput(field: DesignerField) {
  if (field.type.includes('枚举') || field.type.includes('人员') || field.type.includes('关联')) {
    return <Select placeholder={field.placeholder} options={[{ value: 'demo', label: field.placeholder }]} />;
  }
  return <Input placeholder={field.placeholder} />;
}

function makeFieldControl(field: DesignerField): LayoutControl {
  return {
    id: `field-${field.key}-${Date.now()}`,
    source: 'field',
    controlType: 'field',
    name: field.name,
    fieldKey: field.key,
    width: field.type.includes('长文本') ? 'full' : 'half',
  };
}

function makeComponentControl(component: ComponentDefinition): LayoutControl {
  return {
    id: `component-${component.key}-${Date.now()}`,
    source: 'component',
    controlType: component.controlType,
    name: component.name,
    desc: component.desc,
    width: component.defaultWidth || 'half',
  };
}

function cloneControl(control: LayoutControl): LayoutControl {
  return {
    ...control,
    id: `${control.id}-copy-${Date.now()}`,
    name: `${control.name}副本`,
  };
}

export default function FormSettingsPage() {
  const { formId } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<DesignerTab>('form');
  const [version, setVersion] = useState('v0.1');
  const baseConfig = (formId && configs[formId]) || { ...defaultConfig, id: formId || defaultConfig.id };
  const [layoutControls, setLayoutControls] = useState<LayoutControl[]>(baseConfig.fields.map(makeFieldControl));
  const [selectedControlId, setSelectedControlId] = useState<string>('');
  const [selectedAssetKey, setSelectedAssetKey] = useState<string>(baseConfig.fields[0]?.key || '');

  useEffect(() => {
    const nextControls = baseConfig.fields.map(makeFieldControl);
    setLayoutControls(nextControls);
    setSelectedControlId(nextControls[0]?.id || '');
    setSelectedAssetKey(baseConfig.fields[0]?.key || '');
    setVersion('v0.1');
  }, [baseConfig.id]);

  const selectedControl = useMemo(
    () => layoutControls.find((control) => control.id === selectedControlId),
    [layoutControls, selectedControlId],
  );
  const selectedField = useMemo(
    () => baseConfig.fields.find((field) => field.key === (selectedControl?.fieldKey || selectedAssetKey)),
    [baseConfig.fields, selectedAssetKey, selectedControl],
  );

  const addFieldToCanvas = (field: DesignerField) => {
    const control = makeFieldControl(field);
    setLayoutControls((current) => [...current, control]);
    setSelectedControlId(control.id);
    setSelectedAssetKey(field.key);
  };

  const addComponentToCanvas = (component: ComponentDefinition) => {
    const control = makeComponentControl(component);
    setLayoutControls((current) => [...current, control]);
    setSelectedControlId(control.id);
  };

  const copySelectedControl = () => {
    if (!selectedControl) return;
    const copied = cloneControl(selectedControl);
    setLayoutControls((current) => [...current, copied]);
    setSelectedControlId(copied.id);
  };

  const removeSelectedControl = () => {
    if (!selectedControl) {
      message.warning('请先选择画布控件');
      return;
    }
    setLayoutControls((current) => current.filter((control) => control.id !== selectedControl.id));
    setSelectedControlId('');
    message.success('已从画布移除，字段资产仍然保留');
  };

  const renderCanvasControl = (control: LayoutControl) => {
    const field = baseConfig.fields.find((item) => item.key === control.fieldKey);
    if (control.source === 'field' && field) {
      return (
        <label
          className={`${control.width === 'full' ? 'create-form-wide' : ''} ${selectedControlId === control.id ? 'canvas-field-active' : ''}`}
          key={control.id}
          onClick={() => {
            setSelectedControlId(control.id);
            setSelectedAssetKey(field.key);
          }}
        >
          <span>{field.name}</span>
          {fieldInput(field)}
        </label>
      );
    }

    if (control.controlType === 'editable-table' || control.controlType === 'readonly-table') {
      return (
        <div
          className={`designer-table-control ${selectedControlId === control.id ? 'canvas-field-active' : ''}`}
          key={control.id}
          onClick={() => setSelectedControlId(control.id)}
        >
          <strong>{control.name}</strong>
          <div className="designer-mini-table">
            <span>列配置</span>
            <span>数据来源</span>
            <span>{control.controlType === 'editable-table' ? '可编辑行' : '只读展示'}</span>
          </div>
        </div>
      );
    }

    return (
      <div
        className={`designer-placeholder-control ${control.width === 'full' ? 'create-form-wide' : ''} ${selectedControlId === control.id ? 'canvas-field-active' : ''}`}
        key={control.id}
        onClick={() => setSelectedControlId(control.id)}
      >
        <strong>{control.name}</strong>
        <span>{control.desc || '纯 UI 组件，可在右侧绑定字段'}</span>
      </div>
    );
  };

  return (
    <div className="form-designer-page">
      <header className="form-designer-toolbar">
        <div className="form-designer-title">
          <Typography.Title level={4}>{baseConfig.name}配置</Typography.Title>
          <Space size={6} wrap>
            <Tag>{baseConfig.status}</Tag>
            <Select className="form-version-select" value={version} onChange={setVersion} options={versionOptions} />
          </Space>
        </div>
        <Tabs
          className="form-designer-tabs"
          activeKey={activeTab}
          onChange={(key) => {
            setActiveTab(key as DesignerTab);
            setSelectedControlId('');
          }}
          items={tabs.map((item) => ({ key: item.key, label: <span>{item.icon}{item.label}</span> }))}
        />
        <Space wrap>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(`/program/${baseConfig.id}`)}>返回表单</Button>
          <Button icon={<SaveOutlined />}>保存草稿</Button>
          <Button type="primary" icon={<CheckCircleOutlined />}>保存配置</Button>
        </Space>
      </header>

      <section className="form-designer-shell">
        <aside className="form-designer-left">
          <div className="designer-panel-head">
            <strong>组件</strong>
            <span>{activeTab === 'form' ? '完整组件库' : tabs.find((item) => item.key === activeTab)?.label}</span>
          </div>

          {activeTab === 'form' ? (
            <div className="designer-component-library">
              {componentGroups.map((group) => (
                <section className="designer-component-group" key={group.category}>
                  <div className="designer-group-title">{group.category}</div>
                  <div className="designer-component-list">
                    {group.items.map((item) => (
                      <div
                        className="designer-component"
                        draggable
                        key={item.key}
                        onClick={() => addComponentToCanvas(item)}
                        onDragStart={(event) => event.dataTransfer.setData('componentKey', item.key)}
                      >
                        <span className="designer-component-icon">{item.icon}</span>
                        <div>
                          <strong>{item.name}</strong>
                          <small>{item.desc}</small>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="designer-component-list">
              <div className="designer-component">
                <span className="designer-component-icon">{tabs.find((item) => item.key === activeTab)?.icon}</span>
                <div>
                  <strong>{tabs.find((item) => item.key === activeTab)?.label}</strong>
                  <small>在中间画布配置当前能力</small>
                </div>
              </div>
            </div>
          )}

          <div className="designer-panel-head designer-panel-head-gap">
            <strong>{activeTab === 'filter' ? '筛选字段' : '字段库'}</strong>
            <span>{(activeTab === 'filter' ? baseConfig.filters : baseConfig.fields).length} 个</span>
          </div>
          <div className="designer-field-list">
            {(activeTab === 'filter' ? baseConfig.filters : baseConfig.fields).map((field) => (
              <div
                className={`designer-field ${selectedAssetKey === field.key ? 'designer-field-active' : ''}`}
                draggable={activeTab === 'form'}
                key={field.key}
                onClick={() => {
                  setSelectedAssetKey(field.key);
                  setSelectedControlId('');
                }}
                onDragStart={(event) => event.dataTransfer.setData('fieldKey', field.key)}
              >
                <DragOutlined />
                <span>{field.name}</span>
                {field.locked && <Tag color="orange">锁定</Tag>}
              </div>
            ))}
          </div>
        </aside>

        <main className="form-designer-canvas">
          <div className="canvas-topbar">
            <Space size={8}>
              {tabs.find((item) => item.key === activeTab)?.icon}
              <strong>{tabs.find((item) => item.key === activeTab)?.label}</strong>
            </Space>
            <Space>
              {activeTab === 'form' && (
                <>
                  <Button size="small" icon={<CopyOutlined />} onClick={copySelectedControl}>复制</Button>
                  <Button size="small" danger icon={<DeleteOutlined />} onClick={removeSelectedControl}>移出画布</Button>
                </>
              )}
              <Tag>{baseConfig.primaryKey}</Tag>
            </Space>
          </div>

          {activeTab === 'form' && (
            <div
              className="canvas-board create-form-canvas"
              onClick={() => setSelectedControlId('')}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const fieldKey = event.dataTransfer.getData('fieldKey');
                const componentKey = event.dataTransfer.getData('componentKey');
                const field = baseConfig.fields.find((item) => item.key === fieldKey);
                const component = componentGroups.flatMap((group) => group.items).find((item) => item.key === componentKey);
                if (field) addFieldToCanvas(field);
                if (component) addComponentToCanvas(component);
              }}
            >
              <div className="create-form-modal" onClick={(event) => event.stopPropagation()}>
                <div className="create-form-modal-head">
                  <strong>{baseConfig.createTitle}</strong>
                  <span>{baseConfig.description}</span>
                </div>
                <div className="create-form-grid">
                  {layoutControls.map(renderCanvasControl)}
                </div>
                <div className="create-form-actions">
                  <Button>取消</Button>
                  <Button type="primary">提交</Button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'filter' && (
            <div className="canvas-board create-form-canvas">
              <div className="create-form-modal">
                <div className="create-form-modal-head">
                  <strong>{baseConfig.name}数据筛选</strong>
                  <span>配置运行页面列表上方的数据查询条件。</span>
                </div>
                <div className="create-form-grid">
                  {baseConfig.filters.map((field) => (
                    <label key={field.key}>
                      <span>{field.name}</span>
                      {fieldInput(field)}
                    </label>
                  ))}
                </div>
                <div className="create-form-actions">
                  <Button>重置</Button>
                  <Button type="primary">查询</Button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'flow' && (
            <div className="canvas-board flow-canvas">
              {baseConfig.flowSteps.map((step, index) => (
                <div className="flow-node" key={step}>
                  <span>{index + 1}</span>
                  <strong>{step}</strong>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'permission' && (
            <div className="canvas-board permission-canvas">
              {baseConfig.roles.map((role) => (
                <div className="permission-row" key={role}>
                  <strong>{role}</strong>
                  <Space wrap>
                    {['查看', '新增', '编辑', '导出', '设置'].map((item) => <Tag color="blue" key={item}>{item}</Tag>)}
                  </Space>
                </div>
              ))}
            </div>
          )}
        </main>

        <aside className="form-designer-right">
          <div className="designer-panel-head">
            <strong>属性</strong>
            <span>当前：{selectedControl ? '控件' : selectedField ? '字段' : '画布'}</span>
          </div>

          {selectedControl ? (
            <Tabs
              size="small"
              items={[
                {
                  key: 'control',
                  label: '控件属性',
                  children: (
                    <div className="designer-props">
                      <label><span>控件名称</span><Input value={selectedControl.name} readOnly /></label>
                      <label><span>控件类型</span><Input value={selectedControl.controlType} readOnly /></label>
                      <label><span>宽度</span><Select value={selectedControl.width} options={[{ value: 'half', label: '半宽' }, { value: 'full', label: '整行' }]} /></label>
                      <label><span>绑定字段</span><Select value={selectedControl.fieldKey || undefined} placeholder="可选择字段绑定" options={baseConfig.fields.map((field) => ({ value: field.key, label: field.name }))} /></label>
                    </div>
                  ),
                },
                {
                  key: 'field',
                  label: '字段属性',
                  children: selectedField ? (
                    <div className="designer-props">
                      <label><span>字段名称</span><Input value={selectedField.name} readOnly /></label>
                      <label><span>字段类型</span><Input value={selectedField.type} readOnly /></label>
                      <label><span>占位提示</span><Input value={selectedField.placeholder} readOnly /></label>
                      <label><span>字段状态</span><Input value={selectedField.locked ? '保存后锁定' : '可编辑'} readOnly /></label>
                    </div>
                  ) : (
                    <div className="designer-empty-props">当前控件未绑定字段</div>
                  ),
                },
              ]}
            />
          ) : selectedField ? (
            <Tabs
              size="small"
              items={[
                {
                  key: 'field',
                  label: '字段属性',
                  children: (
                    <div className="designer-props">
                      <label><span>字段名称</span><Input value={selectedField.name} readOnly /></label>
                      <label><span>字段类型</span><Input value={selectedField.type} readOnly /></label>
                      <label><span>占位提示</span><Input value={selectedField.placeholder} readOnly /></label>
                      <label><span>字段状态</span><Input value={selectedField.locked ? '保存后锁定' : '可编辑'} readOnly /></label>
                    </div>
                  ),
                },
              ]}
            />
          ) : (
            <div className="designer-props">
              <label><span>表单名称</span><Input value={baseConfig.name} readOnly /></label>
              <label><span>新增标题</span><Input value={baseConfig.createTitle} readOnly /></label>
              <label><span>数据表</span><Input value={baseConfig.dataSource} readOnly /></label>
              <label><span>画布列数</span><Select value="2" options={[{ value: '1', label: '单列' }, { value: '2', label: '两列' }, { value: '3', label: '三列' }]} /></label>
            </div>
          )}
        </aside>
      </section>
    </div>
  );
}
