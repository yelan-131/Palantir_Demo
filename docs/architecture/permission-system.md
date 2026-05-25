# Permission System

Last updated: 2026-05-24

Source of truth: `backend/app/core/permissions.py`,
`backend/app/api/deps.py`, `backend/app/api/admin.py`,
`backend/app/api/applications.py`, `backend/app/api/forms.py`, and
`backend/app/models/relational.py`.

## Current Positioning

The permission system is now a backend-enforced boundary for system
administration, application visibility, and platform form records.

The intended model is:

```text
Authentication -> user identity
Organizations  -> data-scope source
Roles          -> business responsibility
Permissions    -> resource/action grants
Applications   -> workspace visibility
Forms          -> data object access
Records        -> runtime business data
```

Frontend menu and button visibility can improve user experience, but it is not
the security boundary. Backend APIs must always perform the final permission
decision.

## Authentication

Users authenticate through `/api/v1/auth/login`. The backend issues a JWT with:

```text
sub      = username
uid      = user id
is_admin = admin bypass flag
```

Clients send the token as:

```http
Authorization: Bearer <token>
```

`backend/app/api/deps.py` exposes:

- `get_current_user`: resolves the current principal from the Bearer token.
- `require_admin`: rejects non-admin users with `403`.

Important production rule:

```text
DEMO_AUTH_OPTIONAL=false
```

When `DEMO_AUTH_OPTIONAL=true`, missing or invalid tokens can fall back to a
guest principal for demo compatibility. This must not be treated as production
security posture.

## Data Model

The current relational permission model is RBAC-centered.

Core tables:

| Table | Meaning |
| --- | --- |
| `users` | Login identity and admin flag |
| `org_units` | Company/factory/department/team hierarchy |
| `user_org_memberships` | User organization memberships and primary position |
| `roles` | Business or system roles |
| `user_roles` | Many-to-many user-role assignment |
| `role_permissions` | Generic resource/action grants |
| `applications` | Business workspace/application |
| `application_roles` | Roles allowed to see or enter an application |
| `application_forms` | Forms available inside an application and action flags |
| `application_menu_nodes` | Application menu tree |
| `form_permissions` | Form and field permissions by role |
| `dynamic_records` | Platform form runtime records |

`role_permissions` uses this shape:

```text
resource_type + resource_key + action
```

Examples:

```text
menu      /quality                 view
form      maintenance_order        edit
workflow  *                        approve
report    process_dashboard        view
all       *                        *
```

`resource_key="*"` and `action="*"` are supported wildcards.

## Identity, Role, And Organization

The current design keeps role and organization separate:

```text
User -> Roles        -> what the user can do
User -> Organization -> where the user belongs and what data scope they may see
```

That means a production manager role should not encode a specific factory or
department. The role grants capabilities such as viewing production dashboards
or approving work orders. The user's organization membership supplies the
future data filter, such as "Shanghai Plant A", "Quality Department", or
"Warehouse Team".

Admin APIs now expose these identity surfaces together:

```text
GET    /api/v1/admin/users
POST   /api/v1/admin/users
PUT    /api/v1/admin/users/{user_id}
DELETE /api/v1/admin/users/{user_id}

GET    /api/v1/admin/roles
POST   /api/v1/admin/roles
PUT    /api/v1/admin/roles/{role_id}/permissions
DELETE /api/v1/admin/roles/{role_id}

GET    /api/v1/admin/org-units
POST   /api/v1/admin/org-units
PUT    /api/v1/admin/org-units/{org_id}
DELETE /api/v1/admin/org-units/{org_id}
```

The frontend exposes this as one workbench: **用户与权限**.

Recommended administration flow:

1. Maintain organization hierarchy in **组织管理**.
2. Maintain permission packages in **角色管理**.
3. Bind every account to both role and organization in **用户管理**.
4. Configure application visibility, menu access, form permissions, and workflow
   assignees by selecting roles from this shared identity system.

Current organization-aware seed data:

| User | Primary organization | Position |
| --- | --- | --- |
| `admin` | ManuFoundry 制造集团 | 系统超级管理员 |
| `pm_li` | 生产运营部 | 生产经理 |
| `qe_wang` | 质量管理部 | 质量工程师 |
| `mm_zhou` | 设备维护部 | 设备维护经理 |
| `me_sun` | 设备维护部 | 维修工程师 |
| `pe_huang` | 工艺工程部 | 工艺工程师 |
| `scm_liu` | 供应链管理部 | 供应链经理 |
| `wh_feng` | 仓储物流组 | 仓储操作员 |
| `ds_he` | 数据治理组 | 数据专员 |
| `auditor_gu` | 审计观察组 | 审计观察员 |

## Permission Decision Helpers

The central backend implementation lives in
`backend/app/core/permissions.py`.

Important helpers:

| Helper | Purpose |
| --- | --- |
| `get_user_role_ids(user, db)` | Reads current role membership from the database |
| `has_permission(user, resource_type, resource_key, action, db)` | Checks generic `role_permissions` |
| `require_permission(resource_type, resource_key, action)` | FastAPI dependency factory for generic permissions |
| `has_form_permission(user, form_id, action, db, field_name=None)` | Checks platform form permissions |
| `require_form_permission(action)` | Dependency factory for form routes with `form_id` path param |

The current matching rules are:

- `is_admin=true` bypasses permission checks.
- Generic permissions support `resource_type="all"`.
- `resource_key="*"` matches any resource key.
- `action="*"` matches any action.
- Action aliases are recognized:
  - `view` matches `read`
  - `edit` matches `update`
  - `delete` matches `remove`

## Application Access

Application runtime APIs now enforce application visibility on the backend.

Relevant routes:

```text
GET /api/v1/applications
GET /api/v1/applications/{app_id}
GET /api/v1/applications/{app_id}/menus
```

Behavior:

- Admin users can see all applications.
- Non-admin users only see published applications assigned to one of their
  roles through `application_roles`.
- A user cannot fetch menus for an application they cannot access, even if they
  know the `app_id`.
- Non-admin users cannot fetch disabled/unpublished applications.

This means application visibility is enforced independently from the frontend
application switcher.

## Admin API Access

The `/api/v1/admin` router is protected by `require_admin`.

Protected surfaces include:

```text
/admin/users
/admin/roles
/admin/audit-logs
/admin/applications
```

This makes user management, role management, permission editing, audit log
viewing, and application administration admin-only backend operations.

## Platform Form Access

The `/api/v1/forms` API is split into two categories.

### Configuration APIs

Configuration APIs are admin-only:

```text
POST   /forms
PUT    /forms/{form_id}
POST   /forms/{form_id}/fields
PUT    /forms/{form_id}/fields/{field_id}
DELETE /forms/{form_id}/fields/{field_id}
PUT    /forms/{form_id}/layouts/{layout_type}
POST   /forms/{form_id}/actions
PUT    /forms/{form_id}/actions/{action_id}
DELETE /forms/{form_id}/actions/{action_id}
GET    /forms/{form_id}/permissions
POST   /forms/{form_id}/permissions
PUT    /forms/{form_id}/permissions/{permission_id}
DELETE /forms/{form_id}/permissions/{permission_id}
GET    /forms/{form_id}/workflow-bindings
POST   /forms/{form_id}/workflow-bindings
PUT    /forms/{form_id}/workflow-bindings/{binding_id}
DELETE /forms/{form_id}/workflow-bindings/{binding_id}
GET    /forms/applications/{application_id}/forms
PUT    /forms/applications/{application_id}/forms
DELETE /forms/applications/{application_id}/forms/{form_id}
GET    /forms/applications/{application_id}/menu-nodes
POST   /forms/applications/{application_id}/menu-nodes
PUT    /forms/applications/{application_id}/menu-nodes/{node_id}
DELETE /forms/applications/{application_id}/menu-nodes/{node_id}
```

### Runtime APIs

Runtime form APIs are available to normal users only when their roles allow the
corresponding action:

```text
GET    /forms
GET    /forms/{form_id}
GET    /forms/{form_id}/layouts
GET    /forms/{form_id}/actions
GET    /forms/{form_id}/records
POST   /forms/{form_id}/records
PUT    /forms/{form_id}/records/{record_id}
DELETE /forms/{form_id}/records/{record_id}
```

Runtime action mapping:

| API behavior | Required action |
| --- | --- |
| List/read form metadata | `view` |
| List dynamic records | `view` |
| Create dynamic record | `create` |
| Update dynamic record | `edit` |
| Delete dynamic record | `delete` |

## Form Permission Resolution

`has_form_permission` resolves access in this order:

1. Admin users are allowed.
2. The user's current role ids are loaded from `user_roles`.
3. Matching rows in `form_permissions` are evaluated.
4. `effect="deny"` wins over `effect="allow"`.
5. If no explicit form permission matches, application-form bindings are used
   as fallback:
   - user role must be assigned to the application through
     `application_roles`
   - the form must be bound to that application through `application_forms`
   - the relevant `allow_*` flag must be true

Fallback action flags:

| Action | Binding flag |
| --- | --- |
| `view` | `application_forms.enabled` |
| `create` | `allow_create` |
| `edit` | `allow_edit` |
| `delete` | `allow_delete` |
| `export` | `allow_export` |

This gives administrators two ways to grant access:

- Coarse application assembly: role can enter app, form binding allows actions.
- Explicit form permissions: role has specific allow/deny rows for a form or
  field.

## Field-Level Permission

`form_permissions.field_name` exists and is supported in the permission helper.

Current implementation status:

- Backend can evaluate a field-specific permission row.
- Runtime record read/write currently still returns and accepts whole JSON
  payloads after form-level access is granted.

Planned next step:

```text
Read path: remove fields the user cannot view/export.
Write path: reject edits to fields the user cannot edit.
```

Until that is implemented, field-level permissions are configuration-ready but
not a complete data masking layer.

## Adding New Protected APIs

When adding a new endpoint, choose one of these patterns.

Admin-only endpoint:

```python
from app.api.deps import require_admin

@router.post("/dangerous-config")
async def update_config(user: dict = Depends(require_admin)):
    ...
```

Generic RBAC endpoint:

```python
from app.core.permissions import require_permission

@router.post("/reports/{report_code}/publish")
async def publish_report(
    report_code: str,
    user: dict = Depends(require_permission("report", "quality", "publish")),
):
    ...
```

Form runtime endpoint:

```python
from app.core.permissions import has_form_permission

if not await has_form_permission(user, form_id, "edit", db):
    raise HTTPException(403, "Form permission denied")
```

For dynamic resource keys, call `has_permission(...)` inside the route rather
than hard-coding a dependency with a fixed key.

## Current Limitations

- Several legacy routers still authenticate lightly or rely on module-specific
  behavior. The newly centralized permission helper should be adopted as those
  APIs are hardened.
- `DEMO_AUTH_OPTIONAL=true` remains useful for demos but weakens missing-token
  behavior.
- Field-level filtering is not fully enforced on runtime JSON records yet.
- Data-scope filtering such as own department, own factory, own records, or
  organization tree is not implemented as a reusable policy engine yet.
- Role membership is read from the database during authorization; mock fallback
  users are still present for demo flows when the database is unavailable.

## Verification

Focused tests:

```bash
cd backend
python -m pytest tests/test_security.py tests/test_forms_platform.py
```

Known current status after this permission update:

- Focused permission/form tests pass.
- The full suite currently has unrelated `rules` / `rules_trigger` failures in
  the existing test set and should be addressed separately.
