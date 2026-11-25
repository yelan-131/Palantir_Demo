const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const { Fragment, isValidElement } = require('react');
const ts = require('typescript');

function load(file, imports = {}) {
  const exports = {};
  const source = readFileSync(join(__dirname, '../src/pages/ComponentPages', file), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } });
  runInNewContext(outputText, { exports, structuredClone, require: name => imports[name] || require(name) });
  return exports;
}

function component(file, imports) {
  const hooks = [];
  let cursor;
  let effects;
  const react = {
    useMemo: calculate => calculate(),
    useState(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial;
      return [hooks[index], value => {
        hooks[index] = typeof value === 'function' ? value(hooks[index]) : value;
      }];
    },
    useEffect(effect, dependencies) {
      const index = cursor++;
      const previous = hooks[index];
      hooks[index] = dependencies;
      if (!previous || dependencies.some((value, index) => !Object.is(value, previous[index]))) effects.push(effect);
    },
  };
  const render = load(file, { react, ...imports }).default;
  return props => {
    cursor = 0;
    effects = [];
    const result = render(props);
    effects.forEach(effect => effect());
    return result;
  };
}

const dynamicPage = () => null;
const tabs = () => null;
const filterWidget = () => null;
const businessComponents = load('businessComponents.ts');
const createFilter = (useListConfigurationPreview = () => undefined) => component('FilterWidget.tsx', {
  antd: { Empty: () => null, Tabs: tabs },
  '../DynamicPage': dynamicPage,
  './ListConfigurationPreview': { useListConfigurationPreview },
  './businessComponents': businessComponents,
});
const createList = useListConfigurationPreview => component('RecordListWidget.tsx', {
  antd: { Alert: () => null },
  '../DynamicPage': dynamicPage,
  './ListConfigurationPreview': { useListConfigurationPreview },
  './FilterWidget': filterWidget,
  './businessComponents': businessComponents,
});

const group = (id, columns) => ({ id, columns, name: id, roleIds: [], actions: [] });
const recordMetadataFields = ['_record_id', '_created_at', '_updated_at', '_created_by', '_updated_by'];
const isRecordMetadata = field => recordMetadataFields.includes(field);
const widget = { id: 'products', type: 'record-list', filterSettings: { schemes: [
  { id: 'default', name: '默认方案', showKeyword: true,
    groups: [group('details', ['code', 'name', 'category', 'status'])] },
  { id: 'second', name: '方案 2', showKeyword: false,
    groups: [group('amounts', ['price', 'weight']), group('extra', ['price'])],
    fieldControls: { price: 'radio' }, fieldsPerRow: 2, defaultRows: 1 },
] } };
const plain = value => JSON.parse(JSON.stringify(value));

test('the inspector and canvas use one active scheme and stop applying the previous scheme immediately', () => {
  const renderFilter = createFilter();
  const globalFilters = [{ field: 'plant', op: 'equals', value: 'A' }];
  const firstFilters = [{ field: 'code', op: 'contains', value: 'FG' }];
  const secondFilters = [{ field: 'price', op: 'equals', value: 100 }];
  let selected = 'default';
  const select = id => { selected = id; };
  const renderList = createList(id => {
    assert.equal(id, widget.id);
    return { filterScheme: { id: selected, onSelect: select }, displayGroup: { onSelect() {} } };
  });
  const render = () => {
    const result = renderList({ widget, sourceId: 17, externalSearch: 'shared',
      externalFilters: globalFilters });
    const [filter, list] = result.props.children;
    assert.equal(filter.type, filterWidget);
    assert.equal(list.type, dynamicPage);
    assert.equal(list.props.showRecordMetadata, true);
    const [tabBar, form] = renderFilter(filter.props).props.children;
    assert.equal(tabBar.type, tabs);
    return { tabBar, form, list };
  };

  let { tabBar, form, list } = render();
  assert.equal(tabBar.props.activeKey, 'default');
  assert.deepEqual(plain(form.props.filterFields), ['code', 'name', 'category', 'status']);
  form.props.onFilterChange({ search: 'own', filters: firstFilters, ready: true });
  ({ list } = render());
  assert.equal(list.props.externalSearch, 'shared own');
  assert.deepEqual(plain(list.props.externalFilters), [...globalFilters, ...firstFilters]);

  select('second');
  ({ tabBar, form, list } = render());
  assert.equal(tabBar.props.activeKey, 'second');
  assert.deepEqual(plain(form.props.filterFields), ['price', 'weight']);
  assert.deepEqual(plain(form.props.fieldControls), { price: 'radio' });
  assert.deepEqual(plain(form.props.filterLayout), { rows: 1, columns: 2 });
  assert.equal(form.props.filterSettings.showKeyword, false);
  assert.equal(list.props.externalSearch, 'shared');
  assert.deepEqual(plain(list.props.externalFilters), globalFilters);

  select('default');
  ({ list } = render());
  assert.deepEqual(plain(list.props.externalFilters), globalFilters);
  select('second');
  ({ form } = render());
  form.props.onFilterChange({ search: '', filters: secondFilters, ready: true });
  ({ tabBar, list } = render());
  assert.deepEqual(plain(list.props.externalFilters), [...globalFilters, ...secondFilters]);
  tabBar.props.onChange('default');
  assert.equal(selected, 'default');
  ({ tabBar, form, list } = render());
  assert.equal(tabBar.props.activeKey, 'default');
  assert.equal(form.props.filterSettings.showKeyword, true);
  assert.deepEqual(plain(list.props.externalFilters), globalFilters);
});

test('a standalone filter widget still supports switching schemes without an inspector', () => {
  const renderFilter = createFilter();
  const contributions = [];
  const render = () => renderFilter({ widget, sourceId: 17, onChange: value => contributions.push(plain(value)) });
  const [tabBar] = render().props.children;
  tabBar.props.onChange('second');
  const [selected, form] = render().props.children;
  assert.equal(selected.props.activeKey, 'second');
  assert.deepEqual(plain(form.props.filterFields), ['price', 'weight']);
  form.props.onFilterChange({ search: '', filters: [], ready: true });
  assert.equal(contributions.at(-1).schemeId, 'second');
});

test('a standalone filter shares the scheme selected in its inspector', () => {
  let selected = 'second';
  const contributions = [];
  const render = createFilter(() => ({filterScheme:{id:selected,onSelect:id=>{selected=id;}}}));
  const [tabBar, form] = render({widget,sourceId:17,onChange:value=>contributions.push(plain(value))}).props.children;
  assert.equal(tabBar.props.activeKey, 'second');
  assert.deepEqual(plain(form.props.filterLayout), {rows:1,columns:2});
  tabBar.props.onChange('default');
  assert.equal(selected, 'default');
  assert.deepEqual(contributions, [{schemeId:'default',search:'',filters:[],ready:true}]);
});

test('inline filters receive inherited layout defaults and keep explicit automatic rows', () => {
  const renderFilter = createFilter();
  const [first] = widget.filterSettings.schemes;
  const layoutFor = scheme => {
    const result = renderFilter({ widget: { ...widget, filterSettings: { schemes: [scheme] } },
      sourceId: 17, inline: true, onChange() {} });
    return plain(result.props.children[1].props.filterLayout);
  };
  assert.deepEqual(layoutFor(first), { rows: 2, columns: 4 });
  assert.deepEqual(layoutFor({ ...first, defaultRows: 0, fieldsPerRow: 3 }), { rows: 0, columns: 3 });
});

test('filter viewport measures only visible rows, reserves missing rows and supports auto height', () => {
  const { filterViewportHeight } = load('../DynamicPage/FilterFieldsViewport.tsx');
  assert.equal(filterViewportHeight([32, 49, 100], 12, 2, 32), 93);
  assert.equal(filterViewportHeight([35.25], 12, 3, 32), 124);
  assert.equal(filterViewportHeight([], 12, 2, 32), 76);
  assert.equal(filterViewportHeight([80], 12, 0, 32), 0);
});

test('the canvas previews one display group while the published list combines matching groups', () => {
  const first = { ...group('default', ['code', 'name']), sortableColumns: ['name'],
    defaultSort: { field: 'name', order: 'asc' }, pageSize: 10, emptyText: '暂无基础记录' };
  const second = { ...group('amounts', ['weight', 'price']), sortableColumns: ['weight'],
    defaultSort: { field: 'weight', order: 'desc' }, pageSize: 30, emptyText: '暂无计量记录' };
  const listSettings = { displayGroups: [first, second] };
  const originalSettings = plain(listSettings);
  const sourceView = { table: { columns: ['code', 'name', 'weight', 'price'].map(fieldName => ({
    fieldName, enabled: true, sortable: true,
  })), pageSize: 20 } };
  let editing = true;
  let selected;
  const select = id => { selected = id; };
  const renderList = createList(() => editing ? {
    filterScheme: { onSelect() {} }, displayGroup: { id: selected, onSelect: select },
  } : undefined);
  const presentation = () => {
    const result = renderList({ widget: { ...widget, listSettings }, sourceId: 17, listSettings });
    const list = result.props.children[1];
    assert.equal(list.type, dynamicPage);
    const settings = list.props.listSettings;
    const { table } = businessComponents.resolveListView(sourceView, settings);
    return plain({ columns: table.columns.map(column => [column.fieldName, column.sortable]),
      sort: table.defaultSort, pageSize: table.pageSize,
      emptyText: businessComponents.resolveListPresentation(settings).emptyText });
  };

  const firstPresentation = { columns: [['code', false], ['name', true]],
    sort: { fieldName: 'name', order: 'ascend' }, pageSize: 10, emptyText: '暂无基础记录' };
  assert.deepEqual(presentation(), firstPresentation);
  select('amounts');
  assert.deepEqual(presentation(), { columns: [['weight', true], ['price', false]],
    sort: { fieldName: 'weight', order: 'descend' }, pageSize: 30, emptyText: '暂无计量记录' });
  select('deleted-group');
  assert.deepEqual(presentation(), firstPresentation);

  select('amounts');
  editing = false;
  assert.deepEqual(presentation(), { ...firstPresentation,
    columns: [['code', false], ['name', true], ['weight', true], ['price', false]] });
  assert.deepEqual(listSettings, originalSettings);
});

function findElement(tree, predicate) {
  if (Array.isArray(tree)) {
    for (const child of tree) {
      const found = findElement(child, predicate);
      if (found) return found;
    }
    return;
  }
  if (isValidElement(tree)) return predicate(tree) ? tree : findElement(tree.props.children, predicate);
}

function loadBusinessConfigurationEditor() {
  const columnPicker = () => null;
  const inspectorTabs = () => null;
  const propertyRow = () => null;
  const inputNumber = () => null;
  const filterControls = load('filterControls.ts', {
    './businessComponents': businessComponents, '@/utils/viewConfig': load('../../utils/viewConfig.ts'),
  });
  const imports = {
    antd: { Button: 'button', Input: 'input', InputNumber: inputNumber, Select: 'select', Switch: 'input', Tooltip: 'span' },
    '@/components/Icon/ant': { CopyOutlined: 'i', DeleteOutlined: 'i', PlusOutlined: 'i' },
    '@/components/PropertyInspector': { PropertyGroup: 'section', PropertyHelp: 'span', PropertyRow: propertyRow },
    '@/components/PropertyInspector/InspectorTabs': inspectorTabs,
    './businessComponents': businessComponents,
    './filterControls': filterControls,
    './ColumnPicker': columnPicker,
  };
  const configurationTabs = load('ConfigurationTabs.tsx', imports);
  const editorImports = { ...imports, './ConfigurationTabs': configurationTabs };
  const toolbar = load('ToolbarGroups.tsx', { ...editorImports,
    react: { Fragment, useEffect() {}, useRef: initial => ({ current: initial }), useState: initial => [initial, () => {}] },
    './PermissionTemplates': () => null, './toolbar-groups.css': {}, '@/services/api': {}, '@/utils/uuid': {},
  });
  let nextId = 0;
  const filterSchemes = load('FilterSchemes.tsx', { ...editorImports, './ToolbarGroups': toolbar, '@/utils/uuid': {createUuid: () => `new-${++nextId}`} });
  const businessProperties = load('BusinessProperties.tsx', {
    ...editorImports, './FilterSchemes': filterSchemes, './ToolbarGroups': toolbar,
  }).default;
  return { businessProperties, filterSchemes, toolbar, configurationTabs, columnPicker, inspectorTabs, inputNumber, propertyRow };
}

test('adding a filter scheme selects the new copy in the shared preview', () => {
  const {filterSchemes} = loadBusinessConfigurationEditor();
  const updates = [];
  const selected = [];
  const editor = filterSchemes.default({settings: widget.filterSettings, selected: 'second', options: [], names: [], roles: [],
    disabled: false, onChange: update => updates.push(update), onSelect: id => selected.push(id),
  });
  findElement(editor.props.actions, node => node.props['aria-label'] === '新增筛选方案').props.onClick();
  const added = updates[0].schemes.at(-1);
  assert.deepEqual(selected, [added.id]);
  assert.deepEqual(plain(added.fieldControls), {price: 'radio'});
  assert.notEqual(added.groups[0].id, widget.filterSettings.schemes[1].groups[0].id);
});

test('filter and display configuration share the tab editor and display changes keep their existing payload', () => {
  const { businessProperties, filterSchemes, toolbar, configurationTabs, columnPicker, inspectorTabs, inputNumber } = loadBusinessConfigurationEditor();
  const first = group('standard', ['code']);
  const second = { ...group('amounts', ['weight']), pageSize: 30 };
  const listSettings = { displayGroups: [first, second], pageSize: 20 };
  const patches = [];
  const editorProps = { widget: { ...widget, listSettings }, tab: 'data', roles: [], disabled: false,
    fields: ['code', 'weight', 'disabled_in_view', 'outside_view'].map(field_name => ({ field_name, label: field_name })),
    view: { table: { columns: [{ fieldName: 'code' }, { fieldName: 'weight' }, { fieldName: 'disabled_in_view', enabled: false }] } },
    selectedFilterScheme: 'second', selectedDisplayGroup: 'amounts', onChange: patch => patches.push(plain(patch)),
  };
  const editor = businessProperties(editorProps);
  const tabEditor = node => node.type === configurationTabs.default;
  const fieldEditor = node => node.type === configurationTabs.ConfigurationName;
  const filter = findElement(editor, node => node.type === filterSchemes.default);
  assert.deepEqual(plain(filter.props.options.map(option => option.value)), ['code', 'weight', 'disabled_in_view', 'outside_view', ...recordMetadataFields]);
  const filterTabs = findElement(filterSchemes.default(filter.props), tabEditor);
  assert.equal(filterTabs.props.selected, 'second');
  assert.ok(findElement(configurationTabs.default(filterTabs.props), fieldEditor));

  const display = findElement(editor, node => node.type === toolbar.default);
  const displayTabs = findElement(toolbar.default(display.props), tabEditor);
  assert.equal(displayTabs.props.selected, 'amounts');
  const displayBody = configurationTabs.default(displayTabs.props);
  assert.ok(findElement(displayBody, node => node.type === inspectorTabs));
  assert.ok(findElement(displayBody, fieldEditor));
  const subsection = title => findElement(displayBody, node => node.type === toolbar.PropertySubgroup && node.props.title === title);
  const picker = findElement(subsection('显示区域'), node => node.type === columnPicker);
  assert.deepEqual(plain(picker.props.value.filter(field => !isRecordMetadata(field))), ['weight']);
  assert.deepEqual(plain(picker.props.options.filter(option => !isRecordMetadata(option.value))
    .map(option => [option.value, option.available !== false])), [
    ['code', true], ['weight', true], ['disabled_in_view', false], ['outside_view', false],
  ]);
  const defaultEditor = businessProperties({ ...editorProps, widget });
  const defaultDisplay = findElement(defaultEditor, node => node.type === toolbar.default);
  assert.deepEqual(plain(defaultDisplay.props.groups[0].columns.filter(field => !isRecordMetadata(field))), ['code', 'weight']);

  const paginationSettings = subsection('排序、分页与空提示');
  const pageSize = findElement(paginationSettings, node => node.type === inputNumber);
  assert.equal(pageSize.props.value, 30);
  pageSize.props.onChange(45);
  assert.deepEqual(patches, [{ listSettings: { ...listSettings, displayGroups: [first, { ...second, pageSize: 45 }] } }]);
});

test('approval status is optional for filtering and display changes record an explicit column selection', () => {
  const { businessProperties, filterSchemes, toolbar, columnPicker } = loadBusinessConfigurationEditor();
  const approvalStatus = '_approval_status';
  const listSettings = { displayGroups: [group('status-view', ['status'])] };
  const patches = [];
  const editorProps = { widget: { ...widget, listSettings }, tab: 'data', roles: [], disabled: false,
    fields: [{ field_name: 'status', label: '业务状态' }],
    view: { table: { columns: [{ fieldName: 'status' }] } },
    onChange: patch => patches.push(plain(patch)),
  };
  const pickers = editor => {
    const filter = findElement(editor, node => node.type === filterSchemes.default);
    const filterGroup = findElement(filterSchemes.default(filter.props), node => node.type === toolbar.default);
    const display = findElement(editor, node => node.type === toolbar.default);
    const columnControl = component => findElement(toolbar.default(component.props), node => node.type === columnPicker).props;
    return { filter: columnControl(filterGroup), display: columnControl(display) };
  };
  const withoutApprovals = pickers(businessProperties(editorProps));
  assert.deepEqual(plain(withoutApprovals.filter.options.map(option => option.value)), ['status', ...recordMetadataFields]);
  assert.deepEqual(plain(withoutApprovals.filter.options.filter(option=>option.system).map(option=>option.controlLabel)),
    ['数字输入', '日期范围', '日期范围', '人员选择', '人员选择']);
  assert.ok(recordMetadataFields.every(field => !withoutApprovals.filter.value.includes(field)));
  assert.equal(withoutApprovals.filter.renderFieldSettings('status', true), '文本输入');
  assert.deepEqual(plain(withoutApprovals.display.options.map(option => option.value).filter(field => !isRecordMetadata(field))), ['status']);

  const approvalProps = { ...editorProps, approvalStatusAvailable: true, approvalStatusDefaultVisible: true };
  const { filter, display } = pickers(businessProperties(approvalProps));
  const filterOption = filter.options.find(option => option.value === approvalStatus);
  assert.equal(filterOption?.label, '审批状态');
  assert.equal(filterOption.system, true);
  assert.equal(filter.renderFieldSettings(approvalStatus, false), '下拉单选');
  assert.ok(!filter.value.includes(approvalStatus));
  filter.onChange([...filter.value, approvalStatus]);
  assert.ok(patches.shift().filterSettings.schemes[0].groups[0].columns.includes(approvalStatus));

  assert.deepEqual(plain(display.value.filter(field => !isRecordMetadata(field))), ['status', approvalStatus]);
  assert.equal(display.options.find(option => option.value === approvalStatus).sortable, false);
  display.onChange([approvalStatus, 'status']);
  const reordered = patches.shift().listSettings.displayGroups[0];
  assert.equal(reordered.approvalStatusConfigured, true);
  assert.deepEqual(reordered.columns, [approvalStatus, 'status']);

  display.onChange(['status']);
  const saved = patches.shift().listSettings;
  assert.equal(saved.displayGroups[0].approvalStatusConfigured, true);
  assert.deepEqual(saved.displayGroups[0].columns, ['status']);
  assert.deepEqual(plain(pickers(businessProperties({ ...approvalProps,
    widget: { ...widget, listSettings: saved },
  })).display.value), ['status']);
});

test('filter editor limits eligible business fields to the source indexes and restores empty button labels to defaults', () => {
  const { businessProperties, filterSchemes, propertyRow } = loadBusinessConfigurationEditor();
  const patches = [];
  const fields = [
    {field_name:'code', label:'编码', searchable:true},
    {field_name:'quantity', label:'数量', sortable:true},
    {field_name:'notes', label:'备注', searchable:false, sortable:false},
  ];
  const props = {
    widget: {id:'list', type:'record-list', filterSettings:{queryLabel:'搜索',resetLabel:'还原'}},
    tab:'data', fields, roles:[], disabled:false, onChange:value=>patches.push(plain(value.filterSettings)),
  };
  const findFilter = editor => findElement(editor, node => node.type === filterSchemes.default);
  const filter = findFilter(businessProperties(props));
  assert.deepEqual(plain(filter.props.names), ['code','quantity']);
  const withViewTabs = findFilter(businessProperties({...props, view:{
    filters:[{fieldName:'code',enabled:true}], tabs:[{filters:[{fieldName:'quantity',enabled:true}]}],
  }}));
  assert.deepEqual(plain(withViewTabs.props.names), ['quantity']);
  assert.deepEqual(plain(filter.props.options.slice(0, 3).map(option=>option.available)), [true,true,false]);
  assert.ok(filter.props.options.slice(3).every(option=>option.system&&option.available!==false));
  const control = label => findElement(filter.props.children, node=>node.type===propertyRow&&node.props.label===label).props.children.props;
  control('查询文字').onChange({target:{value:''}});
  control('重置文字').onChange({target:{value:'  '}});
  control('查询文字').onChange({target:{value:'筛选列表'}});
  assert.deepEqual(patches, [{resetLabel:'还原'}, {queryLabel:'搜索'}, {queryLabel:'筛选列表',resetLabel:'还原'}]);
});

test('system record metadata is visible by default and its exact column order and visibility can be saved', () => {
  const { businessProperties, toolbar, columnPicker } = loadBusinessConfigurationEditor();
  const legacySettings = { displayGroups: [group('metadata-view', ['name'])] };
  const patches = [];
  const displayPicker = listSettings => {
    const editor = businessProperties({ widget: { ...widget, listSettings }, tab: 'data', roles: [], disabled: false,
      fields: [{ field_name: 'name', label: '名称' }], view: { table: { columns: [{ fieldName: 'name' }] } },
      onChange: patch => patches.push(plain(patch)),
    });
    const display = findElement(editor, node => node.type === toolbar.default);
    return findElement(toolbar.default(display.props), node => node.type === columnPicker).props;
  };
  const picker = displayPicker(legacySettings);
  const metadataOptions = picker.options.filter(option => option.system);
  assert.deepEqual(new Set(metadataOptions.map(option => option.value)), new Set(recordMetadataFields));
  assert.ok(metadataOptions.every(option => option.available && option.sortable === false));
  assert.deepEqual(new Set(picker.value), new Set(['name', ...recordMetadataFields]));
  assert.deepEqual(new Set(displayPicker(undefined).value), new Set(['name', ...recordMetadataFields]));

  const chosen = ['_updated_by', 'name', '_record_id'];
  picker.onChange(chosen);
  const settings = patches.shift().listSettings;
  assert.equal(settings.displayGroups[0].recordMetadataConfigured, true);
  assert.deepEqual(settings.displayGroups[0].columns, chosen);
  assert.deepEqual(plain(displayPicker(settings).value), chosen);
});

test('display configuration uses enabled columns across source view tabs and preserves legacy sorting', () => {
  const {businessProperties, toolbar, columnPicker}=loadBusinessConfigurationEditor();
  const listSettings={sortableColumns:['code']};
  const editor=businessProperties({widget:{...widget,listSettings},tab:'data',roles:[],disabled:false,onChange() {},
    fields:['code','warehouse','draft_only'].map(field_name=>({field_name,label:field_name,sortable:true})),
    view:{table:{columns:[{fieldName:'draft_only'}]},tabs:[
      {table:{columns:[{fieldName:'code',sortable:true}]}},
      {table:{columns:[{fieldName:'warehouse',sortable:true}]}},
    ]},
  });
  const display=findElement(editor,node=>node.type===toolbar.default);
  const picker=findElement(toolbar.default(display.props),node=>node.type===columnPicker).props;
  assert.deepEqual(plain(picker.options.filter(option=>!option.system).map(option=>[option.value,option.available])),[
    ['code',true],['warehouse',true],['draft_only',false],
  ]);
  assert.deepEqual(plain(picker.value.filter(field=>!isRecordMetadata(field))),['code','warehouse']);
  assert.deepEqual(plain(picker.sortableColumns),['code']);
});

test('display picker shows closed fields as disabled and skips them during bulk selection', () => {
  const checkbox = () => null;
  const dropdown = () => null;
  const picker = load('ColumnPicker.tsx', {
    react: { useId: () => 'column-picker', useState: initial => [initial, () => {}] },
    antd: { Button: 'button', Checkbox: checkbox, Dropdown: dropdown, Empty: 'div', Input: 'input', Pagination: 'nav' },
    '@/components/Icon/ant': { FilterOutlined: 'i', HolderOutlined: 'i', MoreOutlined: 'i' },
    '@/components/PropertyInspector': { PropertyHelp: 'span' },
    './column-picker.css': {},
  }).default;
  const selections = [];
  const render = value => picker({ value, options: [
    { value: 'code', label: '编码' }, { value: 'name', label: '名称' },
    { value: 'description', label: '描述', available: false },
  ], disabled: false, onChange: value => selections.push(plain(value)), sortableColumns: [], onSortingChange() {} });
  const labeledCheckbox = (tree, label) => findElement(tree, node => node.type === checkbox && node.props['aria-label'] === label);
  const tree = render(['code']);
  const status = findElement(tree, node => node.props.className === 'component-inline-columns-status');
  assert.equal(status.props.children[1].props.children.join(''), '可选业务字段 2');
  assert.equal(status.props.children[2].props.children.join(''), '系统字段 0');
  assert.equal(labeledCheckbox(tree, '显示字段 名称').props.disabled, false);
  assert.equal(labeledCheckbox(tree, '显示字段 描述').props.disabled, true);

  const bulk = findElement(tree, node => node.type === dropdown && node.props.menu.items.some(item => item.key === 'add'));
  assert.equal(bulk.props.menu.items.find(item => item.key === 'add').disabled, false);
  bulk.props.menu.onClick({ key: 'add' });

  const stale = render(['code', 'description']);
  const staleToggle = labeledCheckbox(stale, '显示字段 描述');
  assert.equal(staleToggle.props.disabled, false);
  assert.equal(labeledCheckbox(stale, '允许排序 描述').props.disabled, true);
  staleToggle.props.onChange({ target: { checked: false } });
  assert.deepEqual(selections, [['code', 'name'], ['code']]);
});

function loadFieldPicker(currentSearch) {
  return load('ColumnPicker.tsx', {
    react: { useId: () => 'field-picker', useState: initial => [initial === '' ? currentSearch() : initial, () => {}] },
    antd: { Button: 'button', Checkbox: 'input', Dropdown: 'div', Empty: 'div', Input: 'input', Pagination: 'nav' },
    '@/components/Icon/ant': { FilterOutlined: 'i', HolderOutlined: 'i', MoreOutlined: 'i' },
    '@/components/PropertyInspector': { PropertyHelp: 'span' },
    './column-picker.css': {},
  }).default;
}

test('field pickers show configured counts and mount controls only for enabled filters', () => {
  let search = '';
  const picker = loadFieldPicker(() => search);
  const renderedControls = [];
  const props = {
    value: ['name'], options: [{ value: '_approval_status', label: '审批状态', system: true }, { value: 'name', label: '名称' }],
    disabled: false, onChange() {}, sortableColumns: [], onSortingChange() {},
    renderFieldSettings: name => {
      renderedControls.push(name);
      return '文本输入';
    },
  };
  const byClass = (tree, name) => findElement(tree, element => element.props.className === name);
  const filter = picker({ ...props, mode: 'filters' });
  const rows = byClass(filter, 'component-inline-columns-list').props.children[0];
  assert.deepEqual(plain(rows.map(row => row.key)), ['name', '_approval_status']);
  assert.deepEqual(plain(renderedControls), ['name']);
  assert.equal(byClass(rows[1], 'component-inline-column-marker').props.children, '系统');
  assert.equal(byClass(rows[1], 'component-inline-column-mode').props.children, '—');
  assert.equal(byClass(filter, 'component-inline-columns-table-heading').props.children[2].props.children, '筛选控件');

  search = '审批';
  const filtered = picker({ ...props, mode: 'filters' });
  const filterStatus = byClass(filtered, 'component-inline-columns-status').props.children;
  assert.equal(filterStatus[0].props.children.join(''), '已启用 1 · 共 2');
  assert.equal(filterStatus[1].props.children.join(''), '可选业务字段 1');
  assert.equal(filterStatus[2].props.children.join(''), '系统字段 1');
  assert.equal(filterStatus[3].props.children.join(''), '匹配 1');

  const display = picker(props);
  const displayStatus = byClass(display, 'component-inline-columns-status').props.children;
  assert.equal(displayStatus[0].props.children.join(''), '已显示 1 · 共 2');
  assert.equal(displayStatus[1].props.children.join(''), '可选业务字段 1');
  assert.equal(displayStatus[2].props.children.join(''), '系统字段 1');
  assert.equal(byClass(display, 'component-inline-columns-table-heading').props.children[2].props.children, '允许排序');
});

test('filter picker caps unique fields across the scheme and allows reuse across permission groups', () => {
  let search = '';
  const picker = loadFieldPicker(() => search);
  const updates = [];
  const render = () => picker({
    mode: 'filters', value: ['name'], schemeSelectedFields: ['name', 'code', ...Array.from({ length: 28 }, (_, index) => `field${index}`)],
    options: [{ value: 'name', label: '名称' }, { value: 'code', label: '编码' }, { value: '_record_id', label: '记录编号', system: true }],
    disabled: false, onChange: next => updates.push(plain(next)), sortableColumns: [], onSortingChange() {},
  });
  const checkbox = (tree, label) => findElement(tree, node => node.props['aria-label'] === `筛选字段 ${label}`);
  const menu = tree => findElement(tree, node => node.props.menu?.items.some(item => item.key === 'add')).props.menu;
  const tree = render();
  assert.equal(checkbox(tree, '编码').props.disabled, false);
  assert.equal(checkbox(tree, '记录编号').props.disabled, true);
  assert.equal(menu(tree).items.find(item => item.key === 'add').disabled, true);

  search = '编码';
  const reuse = menu(render());
  assert.equal(reuse.items.find(item => item.key === 'add').disabled, false);
  reuse.onClick({ key: 'add' });
  assert.deepEqual(updates, [['name', 'code']]);
});
