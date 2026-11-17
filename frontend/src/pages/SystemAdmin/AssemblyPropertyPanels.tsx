import { PropertyGroup } from '@/components/PropertyInspector';
import { useRef, useState } from 'react';
import { Alert, Button, Empty, Popconfirm, Popover, Drawer, Form, Input, InputNumber, Select, Space, Switch, Table, message } from 'antd';
import type { PlatformFormField } from '@/services/api';
import type { FormInstance } from 'antd';
import { InfoCircleOutlined, PlusOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { adminCreateRole } from '@/services/api';
import { propertyError, fieldStorageSize, supportsFieldByteLimit } from './assemblyPersistence';

export type AssemblyRole = { id: number; name: string; label: string; description?: string };
export type AssemblyField = { id: string; label: string; code: string; dataType: string; allowNull: boolean; list: boolean; raw?: PlatformFormField };
export type NewAssemblyField = { label: string; code: string; type: string; maxBytes?: number | null; options?: string; searchable?: boolean; sortable?: boolean };
export const fieldTypeOptions = [
  { label: '文本', value: 'string' }, { label: '长文本', value: 'text' },
  { label: '布尔', value: 'boolean' }, { label: '明细 / JSON', value: 'json' },
  { label: '整数', value: 'integer' }, { label: '小数', value: 'decimal' },
  { label: '日期', value: 'date' }, { label: '日期时间', value: 'datetime' },
  { label: '单选', value: 'enum' }, { label: '人员', value: 'person' }, { label: '附件', value: 'attachment' },
];
export function fieldTypeLabel(type: string) { return fieldTypeOptions.find(item => item.value === type)?.label || type; }

export function RoleChecklist({ roles, inheritedIds, custom = false, value = [], onChange, onNewRole, disabled }: {
  roles: AssemblyRole[]; inheritedIds: number[]; custom?: boolean; value?: number[];
  onChange?: (ids: number[]) => void; onNewRole?: () => void; disabled?: boolean;
}) {
  const selected = custom ? value : inheritedIds;
  const selectedRoles = roles.filter(role => selected.includes(role.id));
  const availableRoles = roles.filter(role => !selected.includes(role.id));
  const [pickerOpen, setPickerOpen] = useState(false);
  return <>
    <div className="assembly-section-heading"><strong>角色清单 <span>{selected.length} 个可访问</span></strong>
      {custom && <Popover trigger="click" placement="bottomRight" open={pickerOpen && !disabled}
        onOpenChange={setPickerOpen} content={
          <Space direction="vertical">
            <Select aria-label="选择已有角色" placeholder="搜索已有角色" showSearch optionFilterProp="label"
              style={{ width: 220 }} options={availableRoles.map(role => ({ value: role.id, label: role.label || role.name }))}
              notFoundContent="暂无可添加角色" onChange={id => {
                onChange?.([...value, id]);
                setPickerOpen(false);
              }} />
            {onNewRole && <Button type="link" onClick={() => { setPickerOpen(false); onNewRole(); }}>新建角色</Button>}
          </Space>
        }>
        <Button size="small" icon={<PlusOutlined />} disabled={disabled}>添加角色</Button>
      </Popover>}</div>
    {selectedRoles.length ? (
      <div className="assembly-role-switches">
        <table aria-label="访问角色">
          <thead>
            <tr><th scope="col">角色名称</th><th scope="col">角色编码</th><th scope="col">允许访问</th></tr>
          </thead>
          <tbody>
            {selectedRoles.map(role => {
              const name = role.label || role.name;
              return <tr key={role.id}>
                <td title={name}>{name}</td>
                <td title={role.name}>{role.name}</td>
                <td>
                  <Switch size="small" aria-label={`允许${name}访问`} checked
                    disabled={disabled || !custom}
                    onChange={() => onChange?.(value.filter(id => id !== role.id))} />
                </td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
    ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无已授权角色" />}
  </>;
}

export function MenuAccessPanel({ form, roles, inheritedIds, applicationName, onRoleCreated, disabled }: {
  form: FormInstance; roles: AssemblyRole[]; inheritedIds: number[]; applicationName: string;
  onRoleCreated: (role: AssemblyRole) => void; disabled?: boolean;
}) {
  const mode = Form.useWatch('permissionMode', { form, preserve: true }) || 'inherit';
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState('');
  const [roleForm] = Form.useForm();
  const save = async () => {
    if (lock.current) return;
    lock.current = true;
    try {
      const values = await roleForm.validateFields();
      lock.current = true; setBusy(true); setError('');
      const payload = { name: values.code.trim(), label: values.label.trim(), description: values.description?.trim() || '' };
      const response = await adminCreateRole(payload);
      const saved = response.data;
      if (!saved?.id) throw new Error('角色保存接口未返回有效编号');
      onRoleCreated({ ...payload, id: saved.id, name: saved.name || payload.name });
      const ids: number[] = form.getFieldValue('roleIds') ?? [];
      form.setFieldValue('roleIds', [...new Set([...ids, saved.id])]);
      setOpen(false); roleForm.resetFields();
      message.success('角色已创建，保存菜单后生效');
    } catch (failure: any) { if (!failure?.errorFields) setError(propertyError(failure, '新建角色失败，请重试')); }
    finally { lock.current = false; setBusy(false); }
  };
  return <PropertyGroup title="访问权限">
    <Form.Item name="permissionMode" label="权限来源"><Select options={[
      { label: '跟随应用权限', value: 'inherit' }, { label: '为此菜单单独设置', value: 'custom' },
    ]} /></Form.Item>
    <p className="assembly-inspector-note">{mode === 'custom' ? '仅调整此菜单的访问角色，应用内其他菜单保持原有设置。' : `与「${applicationName}」保持一致，应用授权变化时同步生效。`}</p>
    <Form.Item className="assembly-role-field" name="roleIds" dependencies={['permissionMode']} rules={[{ validator: (_, value) =>
      form.getFieldValue('permissionMode') !== 'custom' || value?.length ? Promise.resolve() : Promise.reject(new Error('请至少选择一个访问角色')) }]}>
      <RoleChecklist roles={roles} inheritedIds={inheritedIds} custom={mode === 'custom'} disabled={disabled}
        onNewRole={() => { roleForm.resetFields(); setError(''); setOpen(true); }} />
    </Form.Item>
    <p className="assembly-inspector-note"><InfoCircleOutlined /> 控制此菜单的可见与进入权限；记录和字段权限由表单设计管理。</p>
    <Drawer title="新建角色" width={420} open={open} onClose={() => !busy && setOpen(false)} maskClosable={!busy} closable={!busy}
      destroyOnClose className="assembly-property-drawer" footer={<Space><Button disabled={busy} onClick={() => setOpen(false)}>取消</Button><Button type="primary" loading={busy} onClick={save}>创建角色</Button></Space>}>
      <p className="assembly-drawer-intro">创建后将加入此菜单的角色清单，保存菜单后生效。</p>
      {error && <Alert type="error" showIcon message={error} />}
      <Form name="assembly-new-role" form={roleForm} layout="vertical" disabled={busy} preserve={false}>
        <Form.Item name="label" label="角色名称" rules={[{ required: true, whitespace: true, message: '请填写角色名称' }, { max: 200 }]}><Input autoFocus placeholder="例如：设备工程师" /></Form.Item>
        <Form.Item name="code" label="角色编码" extra="使用英文小写字母、数字或下划线。" rules={[{ required: true, message: '请填写角色编码' }, { pattern: /^[a-z][a-z0-9_]{0,99}$/, message: '以英文小写字母开头，仅使用小写字母、数字或下划线' }]}><Input placeholder="例如：equipment_engineer" /></Form.Item>
        <Form.Item name="description" label="角色说明"><Input.TextArea rows={3} placeholder="说明此角色的职责或使用范围" /></Form.Item>
      </Form>
      <p className="assembly-access-note"><SafetyCertificateOutlined /> 角色成员与数据权限在角色管理中维护。</p>
    </Drawer>
  </PropertyGroup>;
}

export function FieldStructurePanel({ fields, selectedId, onSelect, disabled }: {
  fields: AssemblyField[]; selectedId?: string; onSelect: (id: string) => void; disabled?: boolean;
}) {
  return <section className="assembly-field-summary" aria-label="字段列表">
    <Table<AssemblyField> rowKey="id" size="small" pagination={false} dataSource={fields}
      rowClassName={field => field.id === selectedId ? 'assembly-selected-field' : ''}
      onRow={field => ({
        onClick: disabled ? undefined : () => onSelect(field.id),
        className: disabled ? undefined : 'assembly-editable-field',
      })}
      locale={{ emptyText: '尚未配置字段，可点击“新增字段”开始创建' }} columns={[
        { title: '字段名称', dataIndex: 'label', render: (label, field) => <Button type="link" size="small" disabled={disabled}
          aria-current={field.id === selectedId ? 'true' : undefined} onClick={event => { event.stopPropagation(); onSelect(field.id); }}>{label}</Button> },
        { title: '字段编码', dataIndex: 'code', render: value => <code>{value}</code> },
        { title: '类型', dataIndex: 'dataType', render: fieldTypeLabel },
        { title: '大小（字节）', key: 'size', render: (_, field) => fieldStorageSize(field.dataType, field.raw?.validation?.maxBytes) },
      ]} />
  </section>;
}

export function fieldPropertyValues(field?: AssemblyField) {
  return field ? {
    label: field.label,
    code: field.code,
    type: field.dataType,
    maxBytes: field.raw?.validation?.maxBytes,
    options: Array.isArray(field.raw?.enum_values?.values) ? field.raw.enum_values.values.join('\n') : undefined,
    searchable: Boolean(field.raw?.searchable),
    sortable: Boolean(field.raw?.sortable),
  } : { type: 'string', searchable: false, sortable: false };
}

export function FieldPropertiesPanel({ editing, creating, fieldForm, onCreate, onUpdate, onDelete, onClose, disabled }: {
  editing?: AssemblyField;
  creating: boolean;
  fieldForm: FormInstance;
  onCreate: (field: NewAssemblyField) => Promise<void>;
  onUpdate: (id: string, field: NewAssemblyField) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
  disabled: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState('');
  const fieldType = Form.useWatch('type', fieldForm);
  const active = creating || Boolean(editing);
  const save = async () => {
    if (lock.current) return;
    lock.current = true;
    let validated = false;
    try {
      const values = await fieldForm.validateFields();
      validated = true;
      setBusy(true); setError('');
      const payload = { ...values, label: values.label.trim(), code: values.code.trim() };
      if (editing) await onUpdate(editing.id, payload); else await onCreate(payload);
      onClose();
      message.success('字段已保存到草稿，进入设计可配置展示位置，发布后供运行页使用');
    } catch (failure: any) { if (validated || !failure?.errorFields) setError(failure?.errorFields ? '请先完善表单属性中的必填项，再保存字段' : propertyError(failure, editing ? '保存字段失败，请重试' : '新增字段失败，请重试')); }
    finally { lock.current = false; setBusy(false); }
  };
  const remove = async () => {
    if (!editing || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      await onDelete(editing.id); onClose();
      message.success('字段已从草稿删除，已有数据保留；发布后生效');
    } catch (failure) { setError(propertyError(failure, '删除字段失败，请重试')); }
    finally { lock.current = false; setBusy(false); }
  };
  return <Form name="assembly-field-properties" form={fieldForm} layout="vertical" disabled={disabled || busy}
      className="assembly-property-editor assembly-field-properties">
      {active ? <>
        <div className="assembly-property-scroll">
          {error && <Alert type="error" showIcon message={error} />}
          <Form.Item name="label" label="字段名称" rules={[{ required: true, whitespace: true, message: '请填写字段名称' }, { max: 200 }]}><Input autoFocus placeholder="例如：申请数量" /></Form.Item>
          <Form.Item name="code" label="字段编码" extra={editing ? '字段编码与类型保存后固定，保留已有数据和设计引用。' : '编码需唯一，使用英文字母、数字或下划线。'} rules={[{ required: true, message: '请填写字段编码' }, ...(editing ? [] : [{ pattern: /^[A-Za-z_][A-Za-z0-9_]{0,62}$/, message: '以字母或下划线开头，最长 63 个字符' }])]}><Input readOnly={Boolean(editing)} placeholder="例如：request_quantity" /></Form.Item>
          <Form.Item name="type" label="字段类型" rules={[{ required: true }]}><Select disabled={Boolean(editing)} options={editing && !fieldTypeOptions.some(item => item.value === editing.dataType) ? [...fieldTypeOptions, { label: fieldTypeLabel(editing.dataType), value: editing.dataType }] : fieldTypeOptions} /></Form.Item>
          {fieldType === 'enum' && (!editing || (Array.isArray(editing.raw?.enum_values?.values) && editing.raw.enum_values.values.every((item: unknown) => typeof item === 'string'))) && <Form.Item name="options" label="单选选项" extra="每行填写一个选项。" rules={[{ required: true, whitespace: true, message: '请填写单选选项' }]}><Input.TextArea rows={3} placeholder={'待处理\n处理中\n已完成'} /></Form.Item>}
          {supportsFieldByteLimit(fieldType) ? <Form.Item name="maxBytes" label="最大长度（字节）" extra="按 UTF-8 编码计算；留空表示不设字节上限，字节数不等于字符数。" rules={[{ type: 'integer', min: 1, max: 1073741823, message: '请输入 1 至 1073741823 之间的整数' }]}><InputNumber min={1} precision={0} max={1073741823} placeholder="不限制" style={{ width: '100%' }} /></Form.Item> : <div className="assembly-section-note">存储大小：{fieldStorageSize(fieldType)}</div>}
          <Form.Item name="searchable" label="可搜索" valuePropName="checked"
            extra="将此字段纳入关键词搜索，并允许按字段筛选。">
            <Switch aria-label="可搜索" />
          </Form.Item>
          <Form.Item name="sortable" label="可排序" valuePropName="checked"
            extra="允许按此字段排序和筛选。开启后可在列表中配置排序入口。">
            <Switch aria-label="可排序" />
          </Form.Item>
          <p className="assembly-section-note">必填、列表显示和展示布局在表单设计中配置。</p>
        </div>
        <div className="assembly-field-actions">
          {editing && <Popconfirm title={`删除字段「${editing.label}」？`} description="从草稿中移除，已有数据保留；发布后生效。"
            okText="删除字段" cancelText="取消" onConfirm={remove} disabled={disabled || busy}>
            <Button danger disabled={disabled || busy}>删除字段</Button>
          </Popconfirm>}
          <Space>
            <Button disabled={disabled || busy} onClick={onClose}>取消</Button>
            <Button type="primary" loading={busy} disabled={disabled} onClick={save}>{editing ? '保存更改' : '添加字段'}</Button>
          </Space>
        </div>
      </> : <Empty className="assembly-property-empty" image={Empty.PRESENTED_IMAGE_SIMPLE} description="请选择字段查看属性" />}
    </Form>;
}
