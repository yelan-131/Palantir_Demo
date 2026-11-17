import type { ViewColumnRenderType, ViewControlType, ViewFilterOperator } from '@/utils/viewConfig';
import type { ControlRuleKey, EncodingGenerationMode, EncodingGenerationTiming, EncodingPadding, EncodingSegmentType, EncodingUniquenessScope, FieldBusinessType, ReferenceSourceKind } from './designerTypes';

export const controlWidthOptions = [
  { value: 'quarter', label: '25%' },
  { value: 'third', label: '33%' },
  { value: 'half', label: '50%' },
  { value: 'twoThird', label: '67%' },
  { value: 'threeQuarter', label: '75%' },
  { value: 'full', label: '100%' },
];

export const defaultControlTypeOptions = [
  { value: 'code', label: '编码' },
  { value: 'text', label: '文本输入' },
  { value: 'textarea', label: '多行文本' },
  { value: 'number', label: '数值输入' },
  { value: 'select', label: '选择控件' },
  { value: 'datetime', label: '日期时间' },
  { value: 'upload', label: '附件上传' },
  { value: 'switch', label: '开关切换' },
  { value: 'readonly-text', label: '只读展示' },
];

export const defaultTextFormatOptions = [
  { value: 'plain', label: '普通文本' },
  { value: 'email', label: '邮箱' },
  { value: 'phone', label: '手机号' },
  { value: 'url', label: '链接' },
  { value: 'idNo', label: '证件号' },
  { value: 'custom', label: '自定义正则' },
];

export const defaultTextTrimModeOptions = [
  { value: 'none', label: '不处理' },
  { value: 'trim', label: '去首尾空格' },
  { value: 'trimAll', label: '去全部空格' },
];

export const defaultTextCaseModeOptions = [
  { value: 'original', label: '保持原样' },
  { value: 'upper', label: '自动大写' },
  { value: 'lower', label: '自动小写' },
];

export const defaultSelectionModeOptions = [
  { value: 'single', label: '单选' },
  { value: 'multiple', label: '多选' },
];

export const defaultSelectionDisplayOptions = [
  { value: 'dropdown', label: '下拉' },
  { value: 'search', label: '搜索选择' },
  { value: 'radio', label: '平铺单选' },
  { value: 'tags', label: '标签多选' },
];

export const defaultDateModeOptions = [
  { value: 'date', label: '日期' },
  { value: 'datetime', label: '日期时间' },
  { value: 'range', label: '日期范围' },
];

export const defaultDateValueOptions = [
  { value: 'none', label: '无默认值' },
  { value: 'today', label: '当天' },
  { value: 'now', label: '当前时间' },
];

export const fieldBusinessTypeOptions: Array<{ value: FieldBusinessType; label: string }> = [
  { value: 'text', label: '文本' },
  { value: 'longText', label: '多行文本' },
  { value: 'number', label: '数值' },
  { value: 'date', label: '日期' },
  { value: 'datetime', label: '日期时间' },
  { value: 'enum', label: '枚举/下拉' },
  { value: 'person', label: '人员' },
  { value: 'relation', label: '关联对象' },
  { value: 'attachment', label: '附件' },
  { value: 'code', label: '编码' },
];

export const defaultEncodingResetCycleOptions = [
  { value: 'none', label: '不重置' },
  { value: 'day', label: '按天重置' },
  { value: 'month', label: '按月重置' },
  { value: 'year', label: '按年重置' },
  { value: 'dependency', label: '按依赖字段重置' },
];

export const encodingDatePatternOptions = [
  { value: 'YYMM', label: 'YYMM（4位）' },
  { value: 'YYYYMMDD', label: 'YYYYMMDD（8位）' },
  { value: 'YYYY', label: 'YYYY（4位）' },
  { value: 'MMDD', label: 'MMDD（4位）' },
  { value: 'none', label: '不使用日期段' },
];

export const encodingSegmentTypeOptions: Array<{ value: EncodingSegmentType; label: string }> = [
  { value: 'fixed', label: '固定文本' },
  { value: 'date', label: '日期时间' },
  { value: 'field', label: '表单字段' },
  { value: 'masterData', label: '基础档案' },
  { value: 'organization', label: '组织信息' },
  { value: 'sequence', label: '流水号' },
];

export const encodingPaddingOptions: Array<{ value: EncodingPadding; label: string }> = [
  { value: 'none', label: '不补位' },
  { value: 'leftZero', label: '左侧补 0' },
  { value: 'rightZero', label: '右侧补 0' },
  { value: 'truncate', label: '超长截断' },
];

export const encodingGenerationModeOptions: Array<{ value: EncodingGenerationMode; label: string }> = [
  { value: 'auto', label: '自动生成' },
  { value: 'autoEditable', label: '自动生成后可改' },
  { value: 'manual', label: '手工录入' },
];

export const encodingGenerationTimingOptions: Array<{ value: EncodingGenerationTiming; label: string }> = [
  { value: 'create', label: '新建时生成' },
  { value: 'save', label: '保存草稿时生成' },
  { value: 'submit', label: '提交时生成' },
  { value: 'workflowNode', label: '流程节点生成' },
];

export const encodingUniquenessScopeOptions: Array<{ value: EncodingUniquenessScope; label: string }> = [
  { value: 'form', label: '当前表单唯一' },
  { value: 'global', label: '同租户同编码字段唯一' },
  { value: 'organization', label: '组织内唯一' },
  { value: 'dependency', label: '依赖范围内唯一' },
];

export const referenceSourceKindOptions: Array<{ value: ReferenceSourceKind; label: string }> = [
  { value: 'static', label: '静态选项' },
  { value: 'dictionary', label: '数据字典' },
  { value: 'masterData', label: '基础档案' },
  { value: 'businessForm', label: '业务表单' },
  { value: 'organization', label: '用户组织' },
  { value: 'externalApi', label: '外部接口' },
];

export const referenceSourceRegistry: Record<ReferenceSourceKind, {
  setup: string;
  placeholder: string;
  objects: Array<{ value: string; label: string }>;
  valueFields: Array<{ value: string; label: string }>;
  labelFields: Array<{ value: string; label: string }>;
  preview: string[];
}> = {
  static: {
    setup: '当前字段配置中维护，适合只服务本字段的小枚举',
    placeholder: '例如：系统监测、人工上报、外部接口',
    objects: [{ value: 'inline_options', label: '字段私有选项' }],
    valueFields: [{ value: 'value', label: '选项值' }],
    labelFields: [{ value: 'label', label: '选项名称' }],
    preview: ['系统监测', '人工上报', '外部接口'],
  },
  dictionary: {
    setup: '系统管理 / 数据字典与基础档案 / 数据字典',
    placeholder: '选择数据字典，例如 alert_level',
    objects: [
      { value: 'alert_source', label: '告警来源' },
      { value: 'alert_level', label: '告警等级' },
      { value: 'alert_status', label: '告警状态' },
      { value: 'priority', label: '优先级' },
    ],
    valueFields: [{ value: 'item_value', label: '字典项编码' }],
    labelFields: [{ value: 'item_label', label: '字典项名称' }],
    preview: ['严重', '一般', '提醒'],
  },
  masterData: {
    setup: '系统管理 / 数据字典与基础档案 / 基础档案',
    placeholder: '选择基础档案，例如 equipment_master',
    objects: [
      { value: 'equipment', label: '设备档案' },
      { value: 'production_lines', label: '产线档案' },
      { value: 'material_master', label: '物料档案' },
      { value: 'supplier_master', label: '供应商档案' },
    ],
    valueFields: [
      { value: 'id', label: '内部 ID' },
      { value: 'code', label: '档案编码' },
      { value: 'equipment_no', label: '设备编号' },
    ],
    labelFields: [
      { value: 'name', label: '档案名称' },

    ],
    preview: ['SMT-03 回流焊', '空压站 2#', 'Assembly-A 主线'],
  },
  businessForm: {
    setup: '系统管理 / 应用与菜单 / 表单资产',
    placeholder: '选择业务表单，例如 alert-center',
    objects: [
      { value: 'alert-center', label: '告警中心' },
      { value: 'risk-review', label: '风险复核' },
      { value: 'maintenance-order', label: '维修工单' },
    ],
    valueFields: [{ value: 'id', label: '记录 ID' }, { value: 'code', label: '业务编号' }],
    labelFields: [{ value: 'title', label: '标题' }, { value: 'name', label: '名称' }],
    preview: ['AL-20260529-001', 'AL-20260529-002'],
  },
  organization: {
    setup: '系统管理 / 用户与权限 / 组织管理、用户管理、角色管理',
    placeholder: '选择组织、角色或人员范围',
    objects: [
      { value: 'users', label: '用户' },
      { value: 'roles', label: '角色' },
      { value: 'org_units', label: '组织' },
    ],
    valueFields: [{ value: 'id', label: '记录 ID' }],
    labelFields: [{ value: 'name', label: '名称（人员显示姓名）' }],
    preview: ['李明', '孙浩', '周强'],
  },
  externalApi: {
    setup: '数据源管理 / REST API 或系统管理 / 数据资产与本体',
    placeholder: '选择已接入的 API 数据源',
    objects: [
      { value: 'mes-alert-api', label: 'MES 告警接口' },
      { value: 'erp-material-api', label: 'ERP 物料接口' },
    ],
    valueFields: [{ value: 'id', label: '接口返回 ID' }, { value: 'code', label: '接口返回编码' }],
    labelFields: [{ value: 'name', label: '接口返回名称' }, { value: 'label', label: '接口返回标签' }],
    preview: ['外部接口项 A', '外部接口项 B'],
  },
};

export const ruleLabels: Record<ControlRuleKey, string> = {
  visible: '默认显示',
  readonly: '默认只读',
  required: '默认必输',
  unique: '唯一校验',
  masked: '默认脱敏',
  copyable: '允许复制',
  optionSort: '选项排序',
};

export const ruleOperatorOptions = [
  { value: 'equals', label: '等于' },
  { value: 'notEquals', label: '不等于' },
  { value: 'contains', label: '包含' },
  { value: 'notEmpty', label: '不为空' },
];

export const ruleStrategyOptions: Partial<Record<ControlRuleKey, Array<{ value: string; label: string }>>> = {
  unique: [
    { value: 'form', label: '当前表单唯一' },
    { value: 'global', label: '同租户同编码字段唯一' },
    { value: 'compound', label: '组合字段唯一' },
  ],
  masked: [
    { value: 'role', label: '按角色脱敏' },
    { value: 'partial', label: '保留首尾' },
    { value: 'hidden', label: '全量隐藏' },
  ],
  copyable: [
    { value: 'normal', label: '允许复制文本' },
    { value: 'maskedCopy', label: '复制时脱敏' },
    { value: 'disabled', label: '禁止复制' },
  ],
  optionSort: [
    { value: 'sourceOrder', label: '按数据源顺序' },
    { value: 'labelAsc', label: '按显示名称升序' },
    { value: 'valueAsc', label: '按编码/值升序' },
    { value: 'custom', label: '自定义排序' },
  ],
};

export const viewControlOptions: Array<{ value: ViewControlType; label: string }> = [
  { value: 'keyword', label: '关键词' },
  { value: 'text', label: '文本输入' },
  { value: 'select', label: '选择控件' },
  { value: 'dateRange', label: '日期范围' },
  { value: 'date', label: '单日期' },
  { value: 'number', label: '数字' },
];

export const viewFilterOperatorOptions: Array<{ value: ViewFilterOperator; label: string }> = [
  { value: 'contains', label: '包含' },
  { value: 'equals', label: '等于' },
  { value: 'between', label: '范围内' },
  { value: 'gte', label: '大于等于' },
  { value: 'lte', label: '小于等于' },
];

export const viewColumnRenderOptions: Array<{ value: ViewColumnRenderType; label: string }> = [
  { value: 'text', label: '文本' },
  { value: 'tag', label: '标签' },
  { value: 'date', label: '日期' },
  { value: 'number', label: '数字' },
  { value: 'progress', label: '进度条' },
];

export const FLOW_NODE_WIDTH = 220;

export const FLOW_NODE_HEIGHT = 72;
