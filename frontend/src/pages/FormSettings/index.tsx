import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { Button, Input, Segmented, Select, Space, Tabs, Tag, Typography, message } from 'antd';
import { useNavigate, useParams } from 'react-router-dom';
import './style.css';

type DesignerTab = 'form' | 'filter' | 'flow' | 'permission';
type ComponentPanel = 'components' | 'fieldTypes';
type ControlSource = 'field' | 'component';
type ControlWidth = 'half' | 'full';

interface DesignerField {
  key: string;
  name: string;
  type: string;
  placeholder: string;
  locked?: boolean;
  required?: boolean;
  listVisible?: boolean;
  searchable?: boolean;
  sortable?: boolean;
  defaultValue?: string;
  validation?: string;
  optionSource?: string;
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
  version: string;
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
  defaultWidth?: ControlWidth;
}

interface LayoutControl {
  id: string;
  source: ControlSource;
  controlType: string;
  name: string;
  desc?: string;
  fieldKey?: string;
  width: ControlWidth;
}

interface FlowNode {
  id: string;
  label: string;
  role: string;
  x: number;
  y: number;
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
    version: 'v0.1',
    description: '用于新增风险复核业务数据，而不是配置整个运行页面。',
    fields: [
      { key: 'riskNo', name: '风险单号', type: '文本 / 自动编号', placeholder: '自动生成 SR-2605-001', locked: true, required: true, listVisible: true, searchable: true, sortable: true, validation: '系统唯一编号，不允许重复' },
      { key: 'subject', name: '风险主题', type: '文本输入', placeholder: '请输入风险主题', required: true, listVisible: true, searchable: true, validation: '2-80 个字符' },
      { key: 'level', name: '风险等级', type: '下拉选择', placeholder: '高 / 中 / 低', required: true, listVisible: true, searchable: true, optionSource: '高、中、低' },
      { key: 'owner', name: '处理人', type: '人员选择', placeholder: '选择处理人', required: true, listVisible: true, searchable: true, optionSource: '组织人员' },
      { key: 'reason', name: '风险原因', type: '多行文本', placeholder: '描述风险原因和影响范围', listVisible: false, validation: '最多 500 字' },
    ],
    filters: [
      { key: 'keyword', name: '业务编号 / 主题', type: '搜索输入', placeholder: '请输入关键词' },
      { key: 'status', name: '状态', type: '下拉选择', placeholder: '请选择状态' },
      { key: 'level', name: '等级', type: '下拉选择', placeholder: '请选择等级' },
      { key: 'owner', name: '负责人', type: '人员选择', placeholder: '请选择负责人' },
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
    version: 'v0.1',
    description: '用于新增设备告警数据，字段和风险复核不同。',
    fields: [
      { key: 'alertId', name: '告警编号', type: '文本 / 自动编号', placeholder: '自动生成 AL-2605-001', locked: true, required: true, listVisible: true, searchable: true, sortable: true, validation: '系统唯一编号，不允许重复' },
      { key: 'title', name: '告警标题', type: '文本输入', placeholder: '请输入告警标题', required: true, listVisible: true, searchable: true, validation: '2-80 个字符' },
      { key: 'device', name: '关联设备', type: '关联对象', placeholder: '选择设备', required: true, listVisible: true, searchable: true, optionSource: '设备台账' },
      { key: 'level', name: '告警等级', type: '下拉选择', placeholder: '严重 / 一般 / 提醒', required: true, listVisible: true, searchable: true, optionSource: '严重、一般、提醒' },
      { key: 'owner', name: '处理人', type: '人员选择', placeholder: '选择处理人', listVisible: true, searchable: true, optionSource: '组织人员' },
    ],
    filters: [
      { key: 'keyword', name: '告警编号 / 标题', type: '搜索输入', placeholder: '请输入关键词' },
      { key: 'device', name: '设备', type: '关联对象', placeholder: '请选择设备' },
      { key: 'level', name: '等级', type: '下拉选择', placeholder: '请选择等级' },
      { key: 'status', name: '状态', type: '下拉选择', placeholder: '请选择状态' },
    ],
    flowSteps: ['告警登记', '维护确认', '维修处理', '关闭归档'],
    roles: ['设备管理员', '维修工程师', '生产经理', '系统管理员'],
  },
};

const defaultConfig: DesignerConfig = {
  id: 'unknown',
  name: '表单设置',
  createTitle: '新增业务记录',
  kind: 'business',
  appName: '当前应用',
  dataSource: 'business_records',
  primaryKey: 'id',
  status: '草稿',
  version: 'v0.1',
  description: '用于配置新增业务数据的表单。',
  fields: [
    { key: 'id', name: '编号', type: '文本 / 自动编号', placeholder: '自动生成编号', locked: true, required: true, listVisible: true, searchable: true, validation: '系统唯一编号' },
    { key: 'name', name: '名称', type: '文本输入', placeholder: '请输入名称', required: true, listVisible: true, searchable: true },
    { key: 'status', name: '状态', type: '下拉选择', placeholder: '请选择状态', listVisible: true, searchable: true },
  ],
  filters: [
    { key: 'keyword', name: '关键词', type: '搜索输入', placeholder: '请输入关键词' },
    { key: 'status', name: '状态', type: '下拉选择', placeholder: '请选择状态' },
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
      { key: 'text', category: '字段控件', name: '文本输入', desc: '单行文本、名称、标题', icon: <FormOutlined />, controlType: 'text' },
      { key: 'textarea', category: '字段控件', name: '多行文本', desc: '备注、原因、描述', icon: <FileSearchOutlined />, controlType: 'textarea', defaultWidth: 'full' },
      { key: 'number', category: '字段控件', name: '数字输入', desc: '数量、金额、百分比', icon: <NumberOutlined />, controlType: 'number' },
      { key: 'datetime', category: '字段控件', name: '日期时间', desc: '日期、时间范围', icon: <CalendarOutlined />, controlType: 'datetime' },
      { key: 'select', category: '字段控件', name: '下拉选择', desc: '枚举字段', icon: <SelectOutlined />, controlType: 'select' },
      { key: 'multi-select', category: '字段控件', name: '多选', desc: '标签、多个对象', icon: <TagsOutlined />, controlType: 'multi-select' },
      { key: 'user', category: '字段控件', name: '人员选择', desc: '负责人、审批人', icon: <UserOutlined />, controlType: 'user' },
      { key: 'relation', category: '字段控件', name: '关联对象', desc: '设备、供应商、物料', icon: <LinkOutlined />, controlType: 'relation' },
      { key: 'upload', category: '字段控件', name: '附件上传', desc: '图片、文件、凭证', icon: <PaperClipOutlined />, controlType: 'upload', defaultWidth: 'full' },
      { key: 'switch', category: '字段控件', name: '开关', desc: '是否、启用状态', icon: <SwitcherOutlined />, controlType: 'switch' },
    ],
  },
  {
    category: '布局容器',
    items: [
      { key: 'section', category: '布局容器', name: '分组面板', desc: '基础信息、业务信息分区', icon: <HolderOutlined />, controlType: 'section', defaultWidth: 'full' },
      { key: 'two-columns', category: '布局容器', name: '两列布局', desc: '常规双列录入', icon: <HolderOutlined />, controlType: 'two-columns', defaultWidth: 'full' },
      { key: 'three-columns', category: '布局容器', name: '三列布局', desc: '高密度字段排版', icon: <HolderOutlined />, controlType: 'three-columns', defaultWidth: 'full' },
      { key: 'collapse', category: '布局容器', name: '折叠区域', desc: '次要信息收起', icon: <HolderOutlined />, controlType: 'collapse', defaultWidth: 'full' },
      { key: 'tabs', category: '布局容器', name: 'Tab 区域', desc: '多组信息切换', icon: <HolderOutlined />, controlType: 'tabs', defaultWidth: 'full' },
      { key: 'divider', category: '布局容器', name: '分割线', desc: '视觉分割', icon: <HolderOutlined />, controlType: 'divider', defaultWidth: 'full' },
      { key: 'hint', category: '布局容器', name: '提示文本', desc: '说明、风险提示', icon: <FileSearchOutlined />, controlType: 'hint', defaultWidth: 'full' },
    ],
  },
  {
    category: '明细组件',
    items: [
      { key: 'editable-table', category: '明细组件', name: '可编辑子表', desc: '一张单据下多行明细', icon: <TableOutlined />, controlType: 'editable-table', defaultWidth: 'full' },
      { key: 'readonly-table', category: '明细组件', name: '只读关联表', desc: '展示设备历史、风险记录', icon: <TableOutlined />, controlType: 'readonly-table', defaultWidth: 'full' },
      { key: 'detail-cards', category: '明细组件', name: '明细卡片列表', desc: '移动端友好的明细展示', icon: <TableOutlined />, controlType: 'detail-cards', defaultWidth: 'full' },
    ],
  },
  {
    category: '展示组件',
    items: [
      { key: 'readonly-text', category: '展示组件', name: '只读文本', desc: '展示计算或引用值', icon: <FileSearchOutlined />, controlType: 'readonly-text' },
      { key: 'status-tag', category: '展示组件', name: '状态标签', desc: '状态、等级、结果', icon: <TagsOutlined />, controlType: 'status-tag' },
      { key: 'file-preview', category: '展示组件', name: '图片/附件预览', desc: '查看附件内容', icon: <FileImageOutlined />, controlType: 'file-preview', defaultWidth: 'full' },
      { key: 'description', category: '展示组件', name: '说明块', desc: '固定说明文案', icon: <FileSearchOutlined />, controlType: 'description', defaultWidth: 'full' },
      { key: 'summary-card', category: '展示组件', name: '数据摘要卡', desc: '关联数据摘要', icon: <DatabaseOutlined />, controlType: 'summary-card', defaultWidth: 'full' },
    ],
  },
  {
    category: '业务增强组件',
    items: [
      { key: 'approval-comment', category: '业务增强组件', name: '审批意见区', desc: '流程处理意见', icon: <UserSwitchOutlined />, controlType: 'approval-comment', defaultWidth: 'full' },
      { key: 'operation-log', category: '业务增强组件', name: '操作日志', desc: '历史操作记录', icon: <FileSearchOutlined />, controlType: 'operation-log', defaultWidth: 'full' },
      { key: 'status-flow', category: '业务增强组件', name: '状态流转条', desc: '草稿、处理中、已关闭', icon: <UserSwitchOutlined />, controlType: 'status-flow', defaultWidth: 'full' },
      { key: 'relation-summary', category: '业务增强组件', name: '关联对象摘要', desc: '设备、供应商摘要', icon: <LinkOutlined />, controlType: 'relation-summary', defaultWidth: 'full' },
      { key: 'risk-level', category: '业务增强组件', name: '风险等级选择器', desc: '带颜色和校验规则', icon: <TagsOutlined />, controlType: 'risk-level' },
      { key: 'validation-panel', category: '业务增强组件', name: '校验提示区', desc: '集中展示错误提示', icon: <FileSearchOutlined />, controlType: 'validation-panel', defaultWidth: 'full' },
    ],
  },
];

const fieldTypeComponentGroups = [{ ...componentGroups[0], category: '\u5b57\u6bb5\u79cd\u7c7b' }];
const generalComponentGroups = componentGroups.slice(1);

function fieldInput(field: DesignerField) {
  if (field.type.includes('下拉') || field.type.includes('人员') || field.type.includes('关联')) {
    return <Select placeholder={field.placeholder} options={[{ value: 'demo', label: field.placeholder }]} />;
  }
  if (field.type.includes('多行')) {
    return <Input.TextArea placeholder={field.placeholder} autoSize={{ minRows: 2, maxRows: 4 }} />;
  }
  return <Input placeholder={field.placeholder} />;
}

function makeFieldControl(field: DesignerField): LayoutControl {
  return {
    id: `field-${field.key}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    source: 'field',
    controlType: 'field',
    name: field.name,
    fieldKey: field.key,
    width: field.type.includes('多行') ? 'full' : 'half',
  };
}

function makeComponentControl(component: ComponentDefinition): LayoutControl {
  return {
    id: `component-${component.key}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
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
    id: `${control.id}-copy-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: control.name,
  };
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return ['input', 'textarea', 'select'].includes(tagName) || target.isContentEditable || Boolean(target.closest('.ant-select'));
}

function makeFlowNodes(steps: string[]): FlowNode[] {
  return steps.map((step, index) => ({
    id: `flow-${index}`,
    label: step,
    role: index === 0 ? 'start' : index === steps.length - 1 ? 'end' : 'task',
    x: 56 + index * 172,
    y: index % 2 === 0 ? 118 : 240,
  }));
}

export default function FormSettingsPage() {
  const { formId } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<DesignerTab>('form');
  const [componentPanel, setComponentPanel] = useState<ComponentPanel>('components');
  const [version, setVersion] = useState('v0.1');
  const baseConfig = (formId && configs[formId]) || { ...defaultConfig, id: formId || defaultConfig.id };
  const [layoutControls, setLayoutControls] = useState<LayoutControl[]>(baseConfig.fields.map(makeFieldControl));
  const [selectedControlId, setSelectedControlId] = useState<string>('');
  const [selectedAssetKey, setSelectedAssetKey] = useState<string>(baseConfig.fields[0]?.key || '');
  const [copiedControl, setCopiedControl] = useState<LayoutControl | null>(null);
  const [history, setHistory] = useState<LayoutControl[][]>([]);
  const [flowNodes, setFlowNodes] = useState<FlowNode[]>(() => makeFlowNodes(baseConfig.flowSteps));
  const flowCanvasRef = useRef<HTMLDivElement | null>(null);
  const draggingFlowNodeRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    scaleX: number;
    scaleY: number;
  } | null>(null);

  useEffect(() => {
    const nextControls = baseConfig.fields.map(makeFieldControl);
    setLayoutControls(nextControls);
    setSelectedControlId(nextControls[0]?.id || '');
    setSelectedAssetKey(baseConfig.fields[0]?.key || '');
    setVersion(baseConfig.version);
    setCopiedControl(null);
    setHistory([]);
    setFlowNodes(makeFlowNodes(baseConfig.flowSteps));
  }, [baseConfig.id, baseConfig.version, baseConfig.fields, baseConfig.flowSteps]);

  const selectedControl = useMemo(
    () => layoutControls.find((control) => control.id === selectedControlId),
    [layoutControls, selectedControlId],
  );
  const selectedField = useMemo(
    () => baseConfig.fields.find((field) => field.key === (selectedControl?.fieldKey || selectedAssetKey)),
    [baseConfig.fields, selectedAssetKey, selectedControl],
  );

  const startFlowNodeDrag = (event: React.PointerEvent<HTMLDivElement>, node: FlowNode) => {
    const canvas = flowCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / canvas.offsetWidth || 1;
    const scaleY = rect.height / canvas.offsetHeight || 1;
    draggingFlowNodeRef.current = {
      id: node.id,
      startX: event.clientX,
      startY: event.clientY,
      originX: node.x,
      originY: node.y,
      scaleX,
      scaleY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveFlowNode = (event: React.PointerEvent<HTMLDivElement>) => {
    const dragState = draggingFlowNodeRef.current;
    const canvas = flowCanvasRef.current;
    if (!dragState || !canvas) return;
    const nextX = dragState.originX + (event.clientX - dragState.startX) / dragState.scaleX;
    const nextY = dragState.originY + (event.clientY - dragState.startY) / dragState.scaleY;
    const maxX = Math.max(40, canvas.offsetWidth - 196);
    const maxY = Math.max(60, canvas.offsetHeight - 112);
    setFlowNodes((current) => current.map((node) => (
      node.id === dragState.id
        ? { ...node, x: Math.min(Math.max(28, nextX), maxX), y: Math.min(Math.max(72, nextY), maxY) }
        : node
    )));
  };

  const stopFlowNodeDrag = () => {
    draggingFlowNodeRef.current = null;
  };

  const commitLayoutChange = (updater: (current: LayoutControl[]) => LayoutControl[]) => {
    setLayoutControls((current) => {
      const next = updater(current);
      setHistory((previous) => [...previous.slice(-19), current]);
      return next;
    });
  };

  const undoLayoutChange = () => {
    setHistory((current) => {
      const previous = current[current.length - 1];
      if (!previous) return current;
      setLayoutControls(previous);
      setSelectedControlId('');
      message.success('已撤回上一步画布操作');
      return current.slice(0, -1);
    });
  };

  const addFieldToCanvas = (field: DesignerField) => {
    const control = makeFieldControl(field);
    commitLayoutChange((current) => [...current, control]);
    setSelectedControlId(control.id);
    setSelectedAssetKey(field.key);
  };

  const addComponentToCanvas = (component: ComponentDefinition) => {
    const control = makeComponentControl(component);
    commitLayoutChange((current) => [...current, control]);
    setSelectedControlId(control.id);
  };

  const duplicateControl = (control?: LayoutControl | null) => {
    if (!control) return;
    const copied = cloneControl(control);
    setCopiedControl(control);
    commitLayoutChange((current) => [...current, copied]);
    setSelectedControlId(copied.id);
  };

  const copyControlToClipboard = (control?: LayoutControl | null) => {
    if (!control) return;
    setCopiedControl(control);
    message.success('已复制控件，可使用 Ctrl+V 粘贴');
  };

  const pasteCopiedControl = () => {
    if (!copiedControl) {
      message.warning('还没有复制控件');
      return;
    }
    const pasted = cloneControl(copiedControl);
    commitLayoutChange((current) => [...current, pasted]);
    setSelectedControlId(pasted.id);
  };

  const removeControl = (controlId?: string) => {
    const targetId = controlId || selectedControlId;
    const target = layoutControls.find((control) => control.id === targetId);
    if (!target) {
      message.warning('请先选择画布控件');
      return;
    }
    commitLayoutChange((current) => current.filter((control) => control.id !== targetId));
    setSelectedControlId('');
    message.success('已从画布移出控件，字段资产仍然保留');
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (activeTab !== 'form' || isEditableTarget(event.target)) return;
      const metaKey = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (metaKey && key === 'c') {
        event.preventDefault();
        copyControlToClipboard(selectedControl);
      }
      if (metaKey && key === 'v') {
        event.preventDefault();
        pasteCopiedControl();
      }
      if (metaKey && key === 'z') {
        event.preventDefault();
        undoLayoutChange();
      }
      if (!metaKey && (event.key === 'Delete' || event.key === 'Backspace') && selectedControl) {
        event.preventDefault();
        removeControl(selectedControl.id);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, copiedControl, selectedControl, selectedControlId, layoutControls]);

  const renderControlActions = (control: LayoutControl) => (
    <span className="designer-control-actions" onClick={(event) => event.stopPropagation()}>
      <Button size="small" type="text" title="复制" icon={<CopyOutlined />} onClick={() => duplicateControl(control)} />
      <Button size="small" type="text" danger title="移出画布" icon={<DeleteOutlined />} onClick={() => removeControl(control.id)} />
    </span>
  );

  const renderCanvasControl = (control: LayoutControl) => {
    const field = baseConfig.fields.find((item) => item.key === control.fieldKey);
    if (control.source === 'field' && field) {
      return (
        <div
          className={`designer-field-control ${control.width === 'full' ? 'create-form-wide' : ''} ${selectedControlId === control.id ? 'canvas-field-active' : ''}`}
          key={control.id}
          onClick={() => {
            setSelectedControlId(control.id);
            setSelectedAssetKey(field.key);
          }}
        >
          {renderControlActions(control)}
          <label>
            <span>{field.name}</span>
            {fieldInput(field)}
          </label>
        </div>
      );
    }

    if (control.controlType === 'editable-table' || control.controlType === 'readonly-table') {
      return (
        <div
          className={`designer-table-control ${selectedControlId === control.id ? 'canvas-field-active' : ''}`}
          key={control.id}
          onClick={() => setSelectedControlId(control.id)}
        >
          {renderControlActions(control)}
          <strong>{control.name}</strong>
          <div className="designer-mini-table">
            <span>列配置</span>
            <span>数据来源</span>
            <span>{control.controlType === 'editable-table' ? '可新增/删除行' : '分页/点击详情'}</span>
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
        {renderControlActions(control)}
        <strong>{control.name}</strong>
        <span>{control.desc || '纯 UI 控件，可在右侧绑定字段或配置展示方式。'}</span>
      </div>
    );
  };

  const renderTableProperties = () => {
    if (!selectedControl || !['editable-table', 'readonly-table'].includes(selectedControl.controlType)) return null;
    const editable = selectedControl.controlType === 'editable-table';
    return (
      <section className="designer-prop-section">
        <strong className="designer-prop-section-title">{editable ? '子表属性' : '关联表属性'}</strong>
        <label><span>数据来源</span><Input value={editable ? `${baseConfig.dataSource}_items` : 'related_records'} readOnly /></label>
        <label><span>{editable ? '列配置' : '展示列'}</span><Input value={editable ? '物料、数量、单位、备注' : '编号、名称、状态、时间'} readOnly /></label>
        <label><span>{editable ? '允许新增行' : '分页显示'}</span><Select value="yes" options={[{ value: 'yes', label: '是' }, { value: 'no', label: '否' }]} /></label>
        <label><span>{editable ? '允许删除行' : '点击查看详情'}</span><Select value="yes" options={[{ value: 'yes', label: '是' }, { value: 'no', label: '否' }]} /></label>
        <label><span>{editable ? '行校验规则' : '排序规则'}</span><Input value={editable ? '明细行不能为空，数量必须大于 0' : '按时间倒序'} readOnly /></label>
      </section>
    );
  };

  const renderFieldProperties = (field?: DesignerField) => {
    if (!field) {
      return <div className="designer-empty-props">当前控件未绑定字段，可在控件属性中选择绑定字段。</div>;
    }
    return (
      <div className="designer-props">
        <section className="designer-prop-section">
          <strong className="designer-prop-section-title">字段资产</strong>
          <label><span>字段编码</span><Input value={field.key} readOnly /></label>
          <label><span>字段名称</span><Input value={field.name} readOnly /></label>
          <label><span>字段类型</span><Input value={field.type} readOnly /></label>
          <label><span>字段状态</span><Input value={field.locked ? '锁定字段' : '可配置字段'} readOnly /></label>
        </section>
        <section className="designer-prop-section">
          <strong className="designer-prop-section-title">数据与校验</strong>
          <label><span>是否必填</span><Select value={field.required ? 'yes' : 'no'} options={[{ value: 'yes', label: '是' }, { value: 'no', label: '否' }]} /></label>
          <label><span>默认值</span><Input value={field.defaultValue || '无'} readOnly /></label>
          <label><span>校验规则</span><Input value={field.validation || '未配置'} readOnly /></label>
          <label><span>枚举/关联来源</span><Input value={field.optionSource || '无'} readOnly /></label>
        </section>
        <section className="designer-prop-section">
          <strong className="designer-prop-section-title">列表与检索</strong>
          <label><span>列表展示</span><Select value={field.listVisible ? 'yes' : 'no'} options={[{ value: 'yes', label: '是' }, { value: 'no', label: '否' }]} /></label>
          <label><span>允许搜索</span><Select value={field.searchable ? 'yes' : 'no'} options={[{ value: 'yes', label: '是' }, { value: 'no', label: '否' }]} /></label>
          <label><span>允许排序</span><Select value={field.sortable ? 'yes' : 'no'} options={[{ value: 'yes', label: '是' }, { value: 'no', label: '否' }]} /></label>
        </section>
      </div>
    );
  };

  return (
    <div className="form-designer-page">
      <header className="form-designer-toolbar">
        <div className="form-designer-title">
          <Typography.Title level={4}>{baseConfig.name}配置</Typography.Title>
          <span className="designer-title-meta">{baseConfig.status} · {version}</span>
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
          <Select className="form-version-select" value={version} onChange={setVersion} options={versionOptions} />
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
            <>
              <Segmented
                block
                className="designer-library-switch"
                value={componentPanel}
                onChange={(value) => setComponentPanel(value as ComponentPanel)}
                options={[
                  { label: '各种组件', value: 'components' },
                  { label: '字段种类', value: 'fieldTypes' },
                ]}
              />
              <div className="designer-component-library">
                {(componentPanel === 'components' ? generalComponentGroups : fieldTypeComponentGroups).map((group) => (
                  <section className="designer-component-group" key={group.category}>
                    <div className="designer-group-title">{group.category}</div>
                    <div className="designer-component-list">
                      {group.items.map((item) => (
                        <div
                          className="designer-component"
                          draggable
                          key={item.key}
                          data-desc={item.desc}
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
            </>
          ) : (
            <div className="designer-component-list">
              <div className="designer-component">
                <span className="designer-component-icon">{tabs.find((item) => item.key === activeTab)?.icon}</span>
                <div>
                  <strong>{tabs.find((item) => item.key === activeTab)?.label}</strong>
                  <small>这里配置页面级规则，不拖入表单新增画布。</small>
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
                <div className="create-form-grid">{layoutControls.map(renderCanvasControl)}</div>
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
                  <span>配置运行页面上方的数据查询条件。</span>
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
            <div
              className="canvas-board flow-canvas"
              onPointerMove={moveFlowNode}
              onPointerUp={stopFlowNodeDrag}
              onPointerLeave={stopFlowNodeDrag}
              ref={flowCanvasRef}
            >
              <div className="flow-canvas-guide">
                <strong>流程节点画布</strong>
                <span>拖拽节点调整位置，节点之间的连线会自动跟随。</span>
              </div>
              <svg className="flow-connector-layer" aria-hidden="true">
                <defs>
                  <marker id="flow-arrow" markerHeight="8" markerWidth="8" orient="auto" refX="7" refY="4">
                    <path d="M 0 0 L 8 4 L 0 8 z" />
                  </marker>
                </defs>
                {flowNodes.slice(0, -1).map((node, index) => {
                  const next = flowNodes[index + 1];
                  const startX = node.x + 172;
                  const startY = node.y + 40;
                  const endX = next.x;
                  const endY = next.y + 40;
                  const bend = Math.max(56, Math.abs(endX - startX) / 2);
                  return (
                    <path
                      d={`M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`}
                      key={`${node.id}-${next.id}`}
                    />
                  );
                })}
              </svg>
              {flowNodes.map((node, index) => (
                <div
                  className={`flow-designer-node flow-designer-node-${node.role}`}
                  key={node.id}
                  onPointerDown={(event) => startFlowNodeDrag(event, node)}
                  style={{ left: node.x, top: node.y }}
                >
                  <span className="flow-node-index">{index + 1}</span>
                  <div>
                    <strong>{node.label}</strong>
                    <small>{node.role === 'start' ? '开始节点' : node.role === 'end' ? '结束归档' : '处理节点'}</small>
                  </div>
                  <i className="flow-port flow-port-in" />
                  <i className="flow-port flow-port-out" />
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
                    {['查看', '新增', '编辑', '导入', '导出', '设置'].map((item) => <Tag color="blue" key={item}>{item}</Tag>)}
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
          <div className="designer-prop-summary">
            <span className="designer-prop-summary-badge">{selectedControl ? '控件' : selectedField ? '字段' : '画布'}</span>
            <strong>{selectedControl?.name || selectedField?.name || baseConfig.name}</strong>
            <small>
              {selectedControl
                ? `${selectedControl.controlType} · ${selectedControl.width === 'full' ? '整行' : '半行'}`
                : selectedField
                  ? `${selectedField.type} · ${selectedField.locked ? '锁定字段' : '可配置字段'}`
                  : `${baseConfig.dataSource} · ${baseConfig.primaryKey}`}
            </small>
          </div>

          {selectedControl ? (
            <Tabs
              className="designer-prop-tabs"
              size="small"
              items={[
                {
                  key: 'control',
                  label: '控件属性',
                  children: (
                    <div className="designer-props">
                      <section className="designer-prop-section">
                        <strong className="designer-prop-section-title">基础显示</strong>
                        <label><span>控件名称</span><Input value={selectedControl.name} readOnly /></label>
                        <label><span>控件类型</span><Input value={selectedControl.controlType} readOnly /></label>
                        <label><span>展示标签</span><Select value="show" options={[{ value: 'show', label: '显示' }, { value: 'hide', label: '隐藏' }]} /></label>
                        <label><span>占位提示</span><Input value={selectedField?.placeholder || selectedControl.desc || '未配置'} readOnly /></label>
                        <label><span>宽度</span><Select value={selectedControl.width} options={[{ value: 'half', label: '半行' }, { value: 'full', label: '整行' }]} /></label>
                      </section>
                      <section className="designer-prop-section">
                        <strong className="designer-prop-section-title">交互规则</strong>
                        <label><span>绑定字段</span><Select value={selectedControl.fieldKey || undefined} placeholder="请选择绑定字段" options={baseConfig.fields.map((field) => ({ value: field.key, label: field.name }))} /></label>
                        <label><span>只读</span><Select value="no" options={[{ value: 'yes', label: '是' }, { value: 'no', label: '否' }]} /></label>
                        <label><span>必填</span><Select value={selectedField?.required ? 'yes' : 'no'} options={[{ value: 'yes', label: '是' }, { value: 'no', label: '否' }]} /></label>
                        <label><span>显示条件</span><Input value="默认始终显示" readOnly /></label>
                        <label><span>帮助说明</span><Input value="可在此补充录入说明" readOnly /></label>
                      </section>
                      {renderTableProperties()}
                    </div>
                  ),
                },
                {
                  key: 'field',
                  label: '字段属性',
                  children: renderFieldProperties(selectedField),
                },
              ]}
            />
          ) : selectedField ? (
            <Tabs className="designer-prop-tabs" size="small" items={[{ key: 'field', label: '字段属性', children: renderFieldProperties(selectedField) }]} />
          ) : (
            <div className="designer-props">
              <section className="designer-prop-section">
                <strong className="designer-prop-section-title">画布属性</strong>
                <label><span>表单名称</span><Input value={baseConfig.name} readOnly /></label>
                <label><span>新增标题</span><Input value={baseConfig.createTitle} readOnly /></label>
                <label><span>数据表</span><Input value={baseConfig.dataSource} readOnly /></label>
                <label><span>主键字段</span><Input value={baseConfig.primaryKey} readOnly /></label>
                <label><span>默认列数</span><Select value="2" options={[{ value: '1', label: '单列' }, { value: '2', label: '两列' }, { value: '3', label: '三列' }]} /></label>
                <label><span>字段间距</span><Select value="12" options={[{ value: '8', label: '紧凑' }, { value: '12', label: '标准' }, { value: '16', label: '宽松' }]} /></label>
                <label><span>表单说明</span><Input value={baseConfig.description} readOnly /></label>
              </section>
            </div>
          )}
        </aside>
      </section>
    </div>
  );
}
