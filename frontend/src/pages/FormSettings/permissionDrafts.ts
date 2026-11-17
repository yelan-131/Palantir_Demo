import type { DesignerField, FormPermissionRow, PermissionDesignDraft, PermissionDraftMap } from './designerTypes';

export const permissionActionDefinitions = [
  { key: 'view', name: '查看页面', desc: '打开菜单、查看列表和详情', risk: 'low' },
  { key: 'create', name: '新增入口', desc: '显示新增按钮并打开新增表单，不代表已提交', risk: 'medium' },
  { key: 'import', name: '导入入口', desc: '显示批量导入入口，按导入流程写入数据', risk: 'high' },
  { key: 'export', name: '导出入口', desc: '下载列表或报表数据', risk: 'high' },
  { key: 'saveDraft', name: '保存草稿', desc: '保存未提交的表单草稿', risk: 'medium' },
  { key: 'submit', name: '提交表单', desc: '提交当前表单并触发后续流程', risk: 'medium' },
  { key: 'edit', name: '修改记录', desc: '修改已存在的告警记录', risk: 'medium' },
  { key: 'delete', name: '删除', desc: '移除记录，高风险动作', risk: 'high' },
  { key: 'approve', name: '审批处理', desc: '处理流程节点、同意、驳回或关闭', risk: 'medium' },
] as const;

export const permissionActionGroups = [
  { key: 'entry', title: '列表入口与批量动作', desc: '控制列表页和工具栏入口', actionKeys: ['view', 'create', 'import', 'export'] },
  { key: 'form', title: '表单内动作', desc: '控制打开表单后的底部按钮', actionKeys: ['saveDraft', 'submit', 'edit', 'delete'] },
  { key: 'workflow', title: '流程动作', desc: '控制流程节点处理按钮', actionKeys: ['approve'] },
];

export function getDefaultPermissionActionEnabled(roleKind: 'system' | 'manager' | 'operator', actionKey: string) {
  if (actionKey === 'view') return true;
  if (actionKey === 'delete') return roleKind === 'system';
  return roleKind !== 'operator';
}

export function makePermissionDesignDraft(roleKind: 'system' | 'manager' | 'operator', orgUnits: number[]): PermissionDesignDraft {
  return {
    page: {
      menu: true,
      enter: true,
      detail: true,
      designTab: roleKind !== 'operator',
      preview: roleKind !== 'operator',
      publish: roleKind === 'system',
    },
    actions: Object.fromEntries(
      permissionActionDefinitions.map((definition) => [
        definition.key,
        getDefaultPermissionActionEnabled(roleKind, definition.key),
      ]),
    ),
    fields: {},
    data: {
      scope: roleKind === 'system' ? 'all' : roleKind === 'manager' ? 'org_tree' : 'assigned',
      orgUnits: orgUnits.slice(0, 2),
      sensitiveFields: roleKind === 'system' ? 'full' : 'mask',
      ownership: {
        createdByMe: true,
        assignedToMe: true,
        sameOrg: roleKind !== 'operator',
        crossOrg: roleKind === 'system',
        statistics: roleKind === 'system',
      },
    },
  };
}

export function permissionDraftsFromConfig(config?: Record<string, unknown> | null): PermissionDraftMap {
  const permissionDesign = config?.permissionDesignDraft || config?.permissionDesign;
  if (!permissionDesign || typeof permissionDesign !== 'object') return {};
  const roles = (permissionDesign as { roles?: unknown }).roles;
  return roles && typeof roles === 'object' ? roles as PermissionDraftMap : {};
}

export function getPermissionRoleKind(roleIndex: number, roleName = ''): 'system' | 'manager' | 'operator' {
  const normalized = roleName.toLowerCase();
  if (roleIndex === 0 || normalized.includes('admin') || normalized.includes('system')) return 'system';
  if (roleIndex < 4 || normalized.includes('manager') || normalized.includes('lead')) return 'manager';
  return 'operator';
}

export function defaultRoleFieldPermission(field: DesignerField, index: number, roleKind: 'system' | 'manager' | 'operator') {
  return {
    visible: true,
    editable: !field.locked && (roleKind === 'system' || index < 5),
    required: Boolean(field.required),
    exportable: roleKind !== 'operator' || index <= 4,
  };
}

export function permissionDraftsFromRows(
  rows: FormPermissionRow[],
  roles: Array<{ id: number; name: string; label: string }>,
  fields: DesignerField[],
  orgUnits: number[],
): PermissionDraftMap {
  const roleById = new Map(roles.map((role) => [role.id, role]));
  const roleIndexById = new Map(roles.map((role, index) => [role.id, index]));
  const drafts: PermissionDraftMap = {};

  for (const row of rows) {
    const role = roleById.get(row.role_id);
    const roleName = role?.label || role?.name || `role-${row.role_id}`;
    const roleKind = getPermissionRoleKind(roleIndexById.get(row.role_id) ?? 99, role?.name || roleName);
    const draft = drafts[roleName] || makePermissionDesignDraft(roleKind, orgUnits);
    const enabled = row.effect !== 'deny';

    if (!row.field_name) {
      if (permissionActionDefinitions.some((definition) => definition.key === row.action)) {
        draft.actions[row.action] = enabled;
      }
      drafts[roleName] = draft;
      continue;
    }

    const field = fields.find((item) => item.key === row.field_name);
    if (!field) {
      drafts[roleName] = draft;
      continue;
    }
    const fieldIndex = Math.max(fields.findIndex((item) => item.key === row.field_name), 0);
    const current = draft.fields[row.field_name] || defaultRoleFieldPermission(field, fieldIndex, roleKind);
    if (row.action === 'view') current.visible = enabled;
    if (row.action === 'edit') current.editable = enabled;
    if (row.action === 'export') current.exportable = enabled;
    if (row.action === 'create') current.editable = current.editable && enabled;
    draft.fields[row.field_name] = current;
    drafts[roleName] = draft;
  }

  return drafts;
}

export function mergePermissionDraftSources(primary: PermissionDraftMap, fallback: PermissionDraftMap): PermissionDraftMap {
  return Object.keys(primary).length ? primary : fallback;
}

export function sanitizePermissionDesignDraft(draft: PermissionDesignDraft): PermissionDesignDraft {
  const actions = Object.fromEntries(
    Object.entries(draft.actions || {}).filter(([key]) => key !== 'configure'),
  ) as Record<string, boolean>;
  const data = draft.data || {
    scope: 'assigned',
    orgUnits: [],
    sensitiveFields: 'mask',
    ownership: {},
  };
  const orgUnits = Array.from(new Set(
    (Array.isArray(data.orgUnits) ? data.orgUnits : [])
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0),
  ));
  return {
    page: draft.page || {},
    actions,
    fields: draft.fields || {},
    data: {
      ...data,
      orgUnits,
    },
  };
}
