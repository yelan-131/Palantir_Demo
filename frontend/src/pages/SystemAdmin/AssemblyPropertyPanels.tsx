import { PropertyGroup } from '@/components/PropertyInspector';
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Alert, Button, Empty, Popconfirm, Drawer, Form, Input, Select, Space, Switch, Table, message } from 'antd';
import type { PlatformFormField } from '@/services/api';
import type { FormInstance } from 'antd';
import { CloseOutlined, DeleteOutlined, SafetyCertificateOutlined, SaveOutlined } from '@ant-design/icons';
import { adminCreateRole } from '@/services/api';
import { propertyError, fieldStorageSize } from './assemblyPersistence';
import { defaultRoleAccessGroups, RoleAccessSettings, type RoleAccessGroup } from '../ComponentPages/ToolbarGroups';

export type AssemblyRole = { id: number; name: string; label: string; description?: string };
export type AssemblyField = { id: string; label: string; code: string; dataType: string; allowNull: boolean; list: boolean; raw?: PlatformFormField };
export type AssemblyFieldChanges = { label: string; type: string; options?: string; searchable?: boolean; sortable?: boolean };
export type NewAssemblyField = AssemblyFieldChanges & { code: string };
export const fieldTypeOptions = [
  { label: '文本', value: 'string' }, { label: '长文本', value: 'text' },
  { label: '布尔', value: 'boolean' }, { label: '明细 / JSON', value: 'json' },
  { label: '整数', value: 'integer' }, { label: '小数', value: 'decimal' },
  { label: '日期', value: 'date' }, { label: '日期时间', value: 'datetime' },
  { label: '单选', value: 'enum' }, { label: '人员', value: 'person' }, { label: '附件', value: 'attachment' },
];
export function fieldTypeLabel(type: string) { return fieldTypeOptions.find(item => item.value === type)?.label || type; }

export function MenuAccessPanel({ form, roles, inheritedGroups, applicationName, onRoleCreated, disabled,
  renameGroupId, onRenameInherited, onRenameCustom, onRenameStarted }: {
  form: FormInstance; roles: AssemblyRole[]; inheritedGroups: RoleAccessGroup[]; applicationName: string;
  onRoleCreated: (role: AssemblyRole) => void; disabled?: boolean;
  renameGroupId?: string;
  onRenameInherited?: (id: string) => void;
  onRenameCustom?: (id: string) => void;
  onRenameStarted?: () => void;
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
      const groups: RoleAccessGroup[] = form.getFieldValue('accessGroups') ?? [];
      if (groups.length) {
        const [first, ...rest] = groups;
        form.setFieldValue('accessGroups', [{...first, roleIds: [...new Set([...first.roleIds, saved.id])]}, ...rest]);
      } else {
        form.setFieldValue('accessGroups', defaultRoleAccessGroups([saved.id]));
      }
      setOpen(false); roleForm.resetFields();
      message.success('角色已创建，保存菜单后生效');
    } catch (failure: any) { if (!failure?.errorFields) setError(propertyError(failure, '新建角色失败，请重试')); }
    finally { lock.current = false; setBusy(false); }
  };
  return <PropertyGroup title="访问权限">
    <Form.Item name="permissionMode" label="权限来源" tooltip={mode === 'custom'
      ? '仅调整当前菜单的访问角色。'
      : `与「${applicationName}」保持一致，应用授权变化时同步生效。`}><Select options={[
      { label: '跟随应用权限', value: 'inherit' }, { label: '为此菜单单独设置', value: 'custom' },
    ]} /></Form.Item>
    {mode === 'custom' ? <>
      <Form.Item className="assembly-role-field" name="accessGroups" rules={[{ validator: (_, value: RoleAccessGroup[] | undefined) =>
        value?.some(group => group.roleIds.length) ? Promise.resolve() : Promise.reject(new Error('请至少选择一个访问角色')) }]}>
        <RoleAccessSettings target="菜单" roles={roles} disabled={Boolean(disabled)} renameGroupId={renameGroupId}
          onRenameRequest={onRenameCustom} onRenameStarted={onRenameStarted} />
      </Form.Item>
      <Button className="assembly-menu-create-role" type="link" size="small" disabled={disabled}
        onClick={() => { roleForm.resetFields(); setError(''); setOpen(true); }}>新建角色</Button>
    </> : <RoleAccessSettings target="菜单" roles={roles} value={inheritedGroups} disabled onRenameRequest={onRenameInherited} />}
    <Drawer title="新建角色" width={420} open={open} onClose={() => !busy && setOpen(false)} maskClosable={!busy} closable={!busy}
      destroyOnClose className="assembly-property-drawer" footer={<Space><Button disabled={busy} onClick={() => setOpen(false)}>取消</Button><Button type="primary" loading={busy} onClick={save}>创建角色</Button></Space>}>
      <p className="assembly-drawer-intro">创建后将加入此菜单的第一个权限组，保存菜单后生效。</p>
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
  return <section className="assembly-field-table" aria-label="字段列表" tabIndex={0}>
    <Table<AssemblyField> rowKey="id" size="small" tableLayout="fixed" pagination={false} dataSource={fields}
      rowClassName={field => field.id === selectedId ? 'assembly-selected-field' : ''}
      onRow={field => ({
        className: disabled ? undefined : 'assembly-editable-field',
        onClick: disabled ? undefined : () => onSelect(field.id),
      })}
      locale={{ emptyText: '暂无字段' }}
      columns={[
        { title: '字段名称', dataIndex: 'label', width: '25%', render: (label, field) => (
          <Button type="link" size="small" disabled={disabled} aria-current={field.id === selectedId ? 'true' : undefined}
            onClick={event => { event.stopPropagation(); onSelect(field.id); }}>{label}</Button>
        ) },
        { title: '字段编码', dataIndex: 'code', render: code => <code>{code}</code> },
        { title: '类型', dataIndex: 'dataType', width: 76, render: fieldTypeLabel },
        { title: '大小（字节）', key: 'size', width: 144, render: (_, field) => fieldStorageSize(field.dataType, field.raw?.validation?.maxBytes) },
      ]} />
  </section>;
}

export function fieldPropertyValues(field?: AssemblyField) {
  return field ? {
    label: field.label,
    type: field.dataType,
    options: Array.isArray(field.raw?.enum_values?.values) ? field.raw.enum_values.values.join('\n') : undefined,
    searchable: Boolean(field.raw?.searchable),
    sortable: Boolean(field.raw?.sortable),
  } : { type: 'string', searchable: false, sortable: false };
}

export function FieldPropertiesPanel({ editing, creating, fieldForm, actionsTarget, onCreate, onUpdate, onDelete, onClose, disabled }: {
  editing?: AssemblyField;
  creating: boolean;
  fieldForm: FormInstance;
  actionsTarget: HTMLDivElement | null;
  onCreate: (field: NewAssemblyField) => Promise<void>;
  onUpdate: (id: string, field: AssemblyFieldChanges) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
  disabled: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState('');
  const fieldType = Form.useWatch('type', fieldForm);
  const selectedType = fieldType ?? editing?.dataType ?? 'string';
  const originalSize = selectedType === editing?.dataType ? editing?.raw?.validation?.maxBytes : undefined;
  const editableEnum = selectedType === 'enum' && (editing?.dataType !== 'enum' ||
    (Array.isArray(editing.raw?.enum_values?.values) && editing.raw.enum_values.values.every((item: unknown) => typeof item === 'string')));
  const active = creating || Boolean(editing);
  const save = async () => {
    if (lock.current) return;
    lock.current = true;
    let validated = false;
    try {
      const { code, type, label, ...settings }: NewAssemblyField = await fieldForm.validateFields();
      validated = true;
      setBusy(true); setError('');
      const changes = { ...settings, label: label.trim(), type };
      if (editing) await onUpdate(editing.id, changes);
      else await onCreate({ ...changes, code: code.trim() });
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
  return <Form name="assembly-field-properties" form={fieldForm} layout="horizontal" size="small" colon={false} disabled={disabled || busy}
      className="assembly-property-editor assembly-field-properties assembly-property-form property-inspector">
      {active ? <>
        <div className="property-inspector-compact-body" role="region" aria-label="属性内容" tabIndex={0}>
          {error && <Alert type="error" showIcon message={error} />}
          <PropertyGroup title="基本信息" hint="必填、列表显示和展示布局在表单设计中配置。">
            <Form.Item name="label" label="字段名称" rules={[{ required: true, whitespace: true, message: '请填写字段名称' }, { max: 200 }]}><Input autoFocus placeholder="例如：申请数量" /></Form.Item>
            {editing ? (
              <Form.Item label="字段编码" htmlFor="assembly-field-code-view">
                <Input id="assembly-field-code-view" value={editing.code} readOnly />
              </Form.Item>
            ) : (
              <Form.Item name="code" label="字段编码" tooltip="编码在当前表单内唯一，首次保存后锁定。" rules={[
                { required: true, message: '请填写字段编码' },
                { pattern: /^[a-z][a-z0-9_]{0,62}$/, message: '以小写字母开头，仅使用小写字母、数字或下划线，最多 63 个字符' },
              ]}>
                <Input placeholder="例如：request_quantity" />
              </Form.Item>
            )}
            <Form.Item name="type" label="字段类型" tooltip={editing ? '保存时校验现有存储列和记录是否兼容。' : undefined}
              rules={[{ required: true }]}>
              <Select options={editing && !fieldTypeOptions.some(item => item.value === editing.dataType)
                ? [...fieldTypeOptions, { label: fieldTypeLabel(editing.dataType), value: editing.dataType }]
                : fieldTypeOptions} />
            </Form.Item>
            {editableEnum && <Form.Item name="options" label="单选选项" tooltip="每行填写一个选项。" rules={[{ required: true, whitespace: true, message: '请填写单选选项' }]}><Input.TextArea rows={3} placeholder={'待处理\n处理中\n已完成'} /></Form.Item>}
            <Form.Item label="存储大小" htmlFor="assembly-field-storage-size">
              <Input id="assembly-field-storage-size" readOnly value={fieldStorageSize(selectedType, originalSize)} />
            </Form.Item>
          </PropertyGroup>
          <PropertyGroup title="查询与排序">
            <Form.Item name="searchable" label="可搜索" valuePropName="checked" className="assembly-switch-field"
              tooltip="将此字段纳入关键词搜索，并允许按字段筛选。">
              <Switch aria-label="可搜索" />
            </Form.Item>
            <Form.Item name="sortable" label="可排序" valuePropName="checked" className="assembly-switch-field"
              tooltip="允许按此字段排序和筛选。开启后可在列表中配置排序入口。">
              <Switch aria-label="可排序" />
            </Form.Item>
          </PropertyGroup>
        </div>
        {actionsTarget && createPortal(<>
          <Button size="small" type="text" icon={<CloseOutlined />} aria-label="取消更改" title="取消更改"
            disabled={disabled || busy} onClick={onClose} />
          <Button size="small" type="primary" icon={<SaveOutlined />} aria-label={editing ? '保存字段' : '添加字段'}
            title={editing ? '保存字段' : '添加字段'} loading={busy} disabled={disabled} onClick={save} />
          {editing && <Popconfirm title={`删除字段「${editing.label}」？`} description="从草稿中移除，已有数据保留；发布后生效。"
            okText="删除字段" cancelText="取消" onConfirm={remove} disabled={disabled || busy}>
            <Button size="small" type="text" danger icon={<DeleteOutlined />} aria-label="删除字段" title="删除字段" disabled={disabled || busy} />
          </Popconfirm>}
        </>, actionsTarget)}
      </> : <Empty className="assembly-property-empty" image={Empty.PRESENTED_IMAGE_SIMPLE} description="请选择字段查看属性" />}
    </Form>;
}
