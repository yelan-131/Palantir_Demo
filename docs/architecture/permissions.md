# 身份与权限体系

更新日期：2026-11-17（对应代码版本 0.3.22 草稿）

本文描述后端当前实现的认证、租户隔离、角色权限、应用与菜单可见性、表单运行时权限、字段与数据范围限制，以及新增接口时如何接入这些检查。
AI 工具的权限与确认机制见 [AI Agent 技能与工具契约](ai/skill-contract.md)；完整接口清单见 [API 参考](../development/api-reference.md)，本文不重复列出。

以代码为准：`backend/app/api/deps.py`、`backend/app/core/permissions.py`、`backend/app/core/principal.py`、`backend/app/core/security.py`、`backend/app/services/iam.py`、`backend/app/api/auth.py`、`backend/app/api/admin.py`、`backend/app/api/applications.py`、`backend/app/api/platform.py`、`backend/app/services/records.py`、`backend/app/services/designer_permissions.py`、`backend/app/services/field_policies.py`、`backend/app/models/relational.py`。

## 1. 总体原则

- 后端是唯一的安全边界。前端隐藏菜单或按钮只改善体验，接口必须自行判定。
- 除少数公开接口外，所有接口都要求登录，由 `backend/tests/test_route_auth_coverage.py` 强制检查。
- 角色决定“能做什么”，组织决定“属于哪里、能看哪些数据”，两者分开维护。
- 所有身份和权限数据都按租户隔离，权限判定只读取当前租户的数据。
- 拒绝优先：同一层规则中只要命中一条 `deny`，结果就是拒绝。

## 2. 认证

### 2.1 登录方式

| 方式 | 接口 | 说明 |
| --- | --- | --- |
| 本地账号 | `POST /api/v1/auth/login` | 用户名或邮箱加密码，可选 `tenant_id`、`mfa_code` |
| 邀请激活 | `POST /api/v1/auth/invite/accept` | 用邀请令牌设置密码并直接登录 |
| OIDC 单点登录 | `POST /api/v1/auth/oidc/login-url`、`POST /api/v1/auth/oidc/callback` | 需要先在“组织、身份与权限”中启用并配置 OIDC |

本地登录按以下规则确定租户（`auth.py` 的 `_db_login`）：

- 请求带 `tenant_id` 时，在该租户内按用户名或邮箱查找账号。
- 登录名含 `@` 时，按邮箱域名在 `tenant_domains` 中解析租户；域名未登记返回 `404`，对应租户未启用返回 `403`，同一域名对应多个启用租户返回 `409`。
- 只给用户名时，如果多个租户存在同名账号，返回 `400`，要求改用邮箱或 `tenant_id`。

登录过程中：租户必须为 `active`；账号被停用返回 `401`；账号处于锁定期返回 `423`；密码错误会累加失败次数，达到阈值后锁定，并写入 `login_failed` 审计。账号开启 MFA 时，第一次请求只返回 `requires_mfa: true`，需要带 TOTP 验证码再次登录。

OIDC 登录要求请求中带 `tenant_id`、`tenant_slug` 或可解析租户的 `login_hint`，否则返回 `400`。回调时依次按 `sso_subject`、邮箱在该租户内匹配账号；都匹配不到时创建新账号，并在租户存在 `viewer` 角色时授予该角色。

### 2.2 令牌与会话

登录成功后，后端签发 HS256 JWT（`core/security.py`，签名密钥为 `SECRET_KEY`，有效期 `ACCESS_TOKEN_EXPIRE_MINUTES`，默认 480 分钟），载荷包括：

```text
sub        用户名
uid        用户 ID
is_admin   签发时的管理员标记
tenant_id  租户 ID
sid        会话 ID（对应 user_sessions.session_id）
```

每次登录（本地、邀请、OIDC）都会在 `user_sessions` 中写入一条会话，记录登录方式、IP、User-Agent 和过期时间。

令牌有两种携带方式，后端都接受，`Authorization` 头优先：

- `Authorization: Bearer <token>`
- HttpOnly Cookie `access_token`（登录时写入，`SameSite=Lax`，生产模式下带 `Secure`）

当前前端把登录返回的令牌保存在 `localStorage` 的 `mf_token` 中，每个请求附带 Bearer 头，同时以 `withCredentials` 发送 Cookie；页面刷新时用 `GET /api/v1/auth/me` 恢复登录状态。查询字符串中的令牌不被接受（`tests/test_auth_hardening.py`）。

`POST /api/v1/auth/logout` 清除 Cookie 并撤销当前会话。

### 2.3 每次请求的校验

`get_current_user`（`api/deps.py`）在验证签名之外，每次都重新查库确认：

1. 令牌中的 `uid` 对应的账号存在、处于启用状态，且账号所属租户与令牌中的 `tenant_id` 一致。
2. 该租户存在且状态为 `active`。
3. 令牌带 `sid` 时，会话未被撤销、未过期，且会话所属账号和租户仍然启用（`services/iam.py` 的 `is_session_active`）。

任一条件不满足都返回 `401`。因此，停用账号、暂停租户或撤销会话会立即让已签发的令牌失效。`is_admin` 和用户名以数据库中的当前值为准，覆盖令牌中签发时的值，撤销管理员身份同样立即生效。没有 `sid` 的旧令牌只做前两项检查。

服务层通过 `core/principal.py` 读取身份：`current_tenant_id(user)` 在缺少租户时返回 `403`，`current_user_id(user)` 返回用户 ID，`ensure_admin(user)` 对非管理员返回 `403`。

### 2.4 账号安全策略

| 策略 | 默认值（`app/config.py`） | 实现 |
| --- | --- | --- |
| 密码长度 | 至少 10 位 | `validate_password_policy` |
| 密码复杂度 | 大写、小写、数字、符号四类中至少三类 | 同上 |
| 密码历史 | 不能与最近 3 次相同 | `ensure_password_not_reused`，`password_history` 表 |
| 登录锁定 | 连续失败 5 次锁定 15 分钟 | `_db_login` |
| MFA | 用户自行开启的 TOTP（30 秒步长，允许前后各一个窗口） | `/auth/mfa/setup`、`/auth/mfa/enable`、`/auth/mfa/disable` |

以上策略和 OIDC 配置可以由管理员在 `PUT /api/v1/admin/iam/settings` 中修改，保存在 `system_settings` 的 `identity_access_settings` 键下，覆盖环境变量默认值。`client_secret` 不会出现在读取接口的返回中。

管理员还可以通过 `PUT /api/v1/admin/users/{user_id}/security` 重置密码（默认要求下次登录修改）、锁定或解锁账号、停用账号、设置 SSO 绑定；通过 `GET /admin/users/{user_id}/sessions` 和 `POST /admin/sessions/{session_id}/revoke` 查看和撤销会话。这些操作都写审计日志。

自助找回密码：`POST /auth/password-reset/request` 按邮箱域名解析租户（域名未登记返回 `404`），再生成 2 小时有效的重置令牌并通过 SMTP 发送链接；租户内没有该邮箱或账号已停用时同样返回成功；演示模式下响应中会直接带回重置链接，生产模式只返回是否已发送。邀请令牌有效期 7 天。令牌在库中只保存 SHA-256 摘要。

### 2.5 没有游客访问

系统不提供游客或匿名身份。缺少令牌、令牌无效都返回 `401`。`DEMO_AUTH_OPTIONAL` 仍保留在配置中，只为让旧配置文件能够加载，它不再影响鉴权；`APP_MODE=production` 时它为 `true` 会导致启动失败（`Settings.validate_runtime`）。

公开接口只有登录、邀请激活、OIDC、找回密码、健康与就绪检查、版本信息和 AI Harness 的 MCP 桥（由处理函数自行校验短时桥接令牌），完整列表以 `test_route_auth_coverage.py` 的 `PUBLIC_ROUTES` 为准，也列在 [API 参考](../development/api-reference.md)中。

## 3. 租户

- 采用共享数据库加 `tenant_id` 隔离。除 `tenants`、`system_settings`、旧版模型驱动元数据表等少数平台级表外，所有表都带 `tenant_id`，具体例外见[数据模型](data-model.md)。
- 租户 1 是平台租户。平台级操作只允许租户 1 的管理员执行。
- 租户状态为 `active`、`suspended` 或 `archived`。非 `active` 的租户无法登录，已有令牌也会在下一次请求时失效；`archived` 必须先改为 `suspended` 才能恢复为 `active`。
- 访问其他租户的资源时，服务层通常返回 `404`（例如表单、应用不属于当前租户），部分接口返回 `403`。
- 每个租户有资源配额，默认用户 50、应用 20、业务记录 100000（`services/tenant_onboarding.py` 的 `DEFAULT_TENANT_LIMITS`），可在 `tenants.limits` 中覆盖。超出时返回 `403`。物理表存储的表单记录也计入 `dynamicRecords` 配额。

租户运营接口挂在 `/api/v1/platform` 下，整个路由器依赖 `require_platform_admin`，包括租户列表、详情、创建、修改，邀请的创建、重发、撤销，为指定用户生成重置密码令牌，以及租户数据导出。创建租户时会建立 `admin`、`member` 两个角色，并可为租户管理员邮箱创建一个待激活账号和邀请。租户导出会把键名含 `password`、`token`、`secret`、`credential`、`smtp`、`api_key` 的值替换为 `[REDACTED]`。

普通租户管理员在本租户内使用 `/api/v1/admin` 接口，不使用平台接口。

## 4. 身份数据模型

| 表 | 作用 |
| --- | --- |
| `users` | 登录账号；租户内用户名和邮箱各自唯一；含 `is_active`、`is_admin`、锁定、MFA、SSO 绑定字段 |
| `org_units` | 组织树（公司、工厂、部门、班组），`parent_id` 表示上级 |
| `user_org_memberships` | 用户所属组织、岗位、是否主组织 |
| `roles` | 角色；租户内 `name` 唯一 |
| `user_roles` | 用户与角色的多对多关系 |
| `role_permissions` | 通用授权：资源类型、资源键、动作、允许或拒绝、数据范围、行条件、字段规则、优先级、是否启用 |
| `application_roles` | 哪些角色可以进入某个应用 |
| `application_forms` | 应用中可用的表单及 `allow_create`、`allow_edit`、`allow_delete`、`allow_export` 开关和 `data_scope` |
| `application_menu_nodes` | 应用菜单树，`config` 中保存入口权限设置 |
| `form_permissions` | 按角色的表单级和字段级授权（`field_name` 为空表示表单级） |
| `user_sessions`、`password_history`、`password_reset_tokens`、`oidc_states` | 会话、密码历史、重置令牌、OIDC 登录状态 |
| `tenants`、`tenant_domains`、`tenant_invites`、`tenant_exports` | 租户、邮箱域名、邀请、导出任务 |

令牌只携带稳定的身份信息，角色成员关系在每次判定时从 `user_roles` 读取，所以调整用户角色后无需重新登录。

### 4.1 角色与组织

角色不应编码具体工厂或部门。例如“生产经理”角色授予查看生产看板、审批工单等能力；用户所在的组织（例如“生产运营部”）再决定数据范围（见第 9 节）。

前端在“后台设置 › 组织、身份与权限”（`/admin/identity`）中提供租户管理、访问控制总览、用户管理、角色管理、组织管理几个标签页。建议的维护顺序是：先建组织树，再建角色和授权，然后为每个账号同时分配角色和组织，最后在应用、菜单、表单权限和审批人设置中选择这些角色。

`GET /api/v1/admin/role-templates` 返回内置的角色模板（`services/iam.py` 的 `ROLE_TEMPLATES`），包括平台管理员（`all/*/*`）、业务管理员、审批负责人、数据专员、只读审计员和普通成员，供创建角色时参考。

### 4.2 演示账号与组织

在设置了 `PALANTIR_SEED_DEMO_PASSWORD` 的空库上执行迁移时，`0011_seed_demo_users` 创建演示角色和账号，`0013_seed_demo_org_units` 创建组织树并绑定主组织：

| 账号 | 主组织 | 岗位 |
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

`admin` 的密码来自 `PALANTIR_SEED_ADMIN_PASSWORD`（迁移 `0010_seed_super_admin`）。演示密码的处理见[后端开发指南](../development/backend.md)。

## 5. 管理员与平台管理员

`users.is_admin` 表示当前租户的管理员。管理员在权限判定中直接放行（应用可见性、表单权限、通用权限都跳过），但仍受租户隔离约束。平台管理员是租户 1 中的管理员。

| 依赖（`api/deps.py`） | 要求 | 典型使用位置 |
| --- | --- | --- |
| `get_current_user` | 已登录 | 几乎所有接口 |
| `require_admin` | 当前租户管理员，否则 `403` | `/api/v1/admin/*`（整个路由器）、`/admin/applications`、表单配置接口、`/system/metrics` |
| `require_platform_admin` | 租户 1 的管理员，否则 `403` | `/api/v1/platform/*`、`/api/v1/config/*`、`PUT /api/v1/ai/settings`、AI 模型连接测试 |
| `require_platform_admin_for_writes` | `GET`、`HEAD`、`OPTIONS` 只需登录，其他方法需要平台管理员 | `/api/v1/model-driven/*`（平台共享的旧版元模型） |
| `require_permission(type, key, action)` | 通用角色授权，见第 6 节 | 已提供，目前没有路由使用 |
| `require_form_permission(action)` | 路径参数 `form_id` 上的表单授权，见第 8 节 | 已提供，目前没有路由使用；表单运行接口改为在服务层调用同名函数 `services/records.require_form_permission` |

`/api/v1/admin` 下的能力包括：用户、角色、组织的增删改，角色授权设置（`PUT /admin/roles/{role_id}/permissions`），账号安全与会话管理，身份安全设置，权限模拟，审计日志，基础数据，以及应用管理（`/admin/applications` 及其绑定）。

管理页的角色 AI 策略作用于平台共享设置，由平台管理员维护。各租户管理员可以通过 `/api/v1/ai/agent-registry` 管理本租户的技能和工具，接口从登录身份确定租户。

## 6. 通用权限判定

`has_permission(user, resource_type, resource_key, action, db)`（`core/permissions.py`）按以下规则判定 `role_permissions`：

1. 管理员直接允许。
2. 读取用户在当前租户的角色；没有角色则拒绝。
3. 取这些角色在当前租户中 `enabled=true`、`resource_type` 等于请求类型或 `all` 的授权行。
4. `resource_key` 为 `*` 或与请求相同即匹配；`action` 为 `*`、与请求相同或互为别名即匹配。别名：`view`/`read`、`edit`/`update`、`delete`/`remove`。
5. 命中行中有 `deny` 则拒绝；否则有 `allow` 则允许；都没有则拒绝。

授权行的形态：

```text
resource_type  resource_key        action
menu           menu_node:12        view
form           maintenance_order   edit
workflow       *                   approve
report         process_dashboard   view
all            *                   *
```

`resource_type=form` 的授权行既可以用表单 ID 也可以用表单编码作为 `resource_key`，并参与表单权限判定（第 8 节）。

## 7. 应用与菜单可见性

应用运行时接口在后端过滤可见性：

- `GET /api/v1/applications` 只返回当前租户中已发布的应用。非管理员只能看到通过 `application_roles` 分配给自己某个角色的应用；没有角色时返回空列表。
- `GET /api/v1/applications/{app_id}`：应用不属于当前租户返回 `404`；非管理员访问未发布应用返回 `404`；角色未被分配返回 `403`。
- `GET /api/v1/applications/{app_id}/menus`：应用未发布或不属于当前租户返回 `404`（管理员也一样），无权进入返回 `403`。
- 管理员查看全部应用（包括未发布的）使用 `GET /api/v1/admin/applications`。

应用的可见角色（`application_roles`）目前没有编辑界面：“应用访问”只读展示，唯一的修改接口 `PUT /api/v1/admin/applications/{id}/bindings` 没有前端调用，详见[应用](low-code/applications.md)。由于表单挂到应用菜单后会写入 `application_forms`，可见角色还会间接获得这些表单的权限（第 8 节的应用表单绑定兜底）。

应用有数据库菜单节点（`application_menu_nodes`）时，菜单接口逐个判定节点，只返回可见的节点：

- 只返回 `visible=true` 的节点。
- 组件页面节点：路由必须是 `/pages/<编码>`，页面必须已发布（对管理员同样适用）；页面定义了受众角色时，非管理员必须拥有其中一个角色；页面绑定了宿主表单时还要通过宿主检查。
- 关联表单的节点：表单必须属于当前租户、已发布，且用户对其有 `view` 权限。
- 入口权限：节点 `config.permission_mode` 不是 `custom` 时，继承应用的角色分配；为 `custom` 时，用户需要拥有授权 `menu / menu_node:<节点ID> / view`。

保存菜单节点时（`services/application_menu_nodes.py`），`config.role_ids` 会同步写入 `role_permissions`（`resource_type=menu`、`resource_key=menu_node:<ID>`、`action=view`），节点隐藏时这些授权被禁用但保留角色选择。旧版 `config.permission_rules` 在保存时会被丢弃，不再生效。

应用没有菜单节点时，菜单接口回退为列出应用绑定的、已发布且用户有 `view` 权限的表单；再没有时使用旧版 `menu_items` 菜单。

## 8. 表单权限

### 8.1 配置接口与运行接口

`/api/v1/forms` 下的接口分两类：

- 配置接口：创建和修改表单、字段、布局、动作、权限、流程绑定、发布、版本、应用表单绑定、应用菜单节点等，都依赖 `require_admin`。
- 运行接口：读取表单、列出和读写记录、导入导出、提交审批，只要求登录，由 `services/records.py` 等服务按表单权限判定。

动作与接口的对应：

| 行为 | 所需动作 |
| --- | --- |
| 读取表单元数据、列出或读取记录 | `view` |
| 新建记录 | `create` |
| 修改记录 | `edit` |
| 删除记录 | `delete` |
| 导入记录 | `import` |
| 导出记录 | `export` |

`GET /api/v1/forms` 对非管理员只返回有 `view` 权限的表单。`GET /api/v1/forms/{form_id}` 额外返回 `runtime_permissions`（`view`、`create`、`edit`、`delete`、`import`、`export`、`configure`、`approve`、`saveDraft`、`submit` 是否允许）和 `runtime_field_permissions`，供页面渲染按钮和字段状态；真正的拦截仍在记录接口中进行。

### 8.2 判定顺序

`evaluate_form_permission`（`core/permissions.py`）返回带来源和原因的判定结果，`has_form_permission` 只取其中的是否允许。顺序如下：

1. 管理员直接允许。
2. 用户在当前租户没有角色则拒绝。
3. `role_permissions` 中 `resource_type` 为 `form` 或 `all`、资源键匹配表单 ID 或编码、动作匹配的启用行。带 `condition_json` 的行在逐行判定时按记录内容求值（见 9.2）；不带记录的表单级判定会忽略带条件的拒绝行。命中 `deny` 则拒绝，命中 `allow` 则允许。
4. `form_permissions` 中该表单、用户角色、动作匹配的行（`field_name` 为空，或等于正在判定的字段）。命中 `deny` 则拒绝，命中 `allow` 则允许。
5. 正在判定某个字段且前面都没有允许时，拒绝该字段。
6. 应用表单绑定兜底：用户的某个角色可以进入应用（`application_roles`），且表单绑定在该应用中（`application_forms`），再按下表检查开关。

| 动作 | 绑定条件 |
| --- | --- |
| `view` | `enabled` |
| `create` | `enabled` 且 `allow_create` |
| `edit` | `enabled` 且 `allow_edit` |
| `delete` | `enabled` 且 `allow_delete` |
| `export` | `enabled` 且 `allow_export` |
| 其他动作（如 `import`） | 不能通过绑定获得，必须显式授权 |

所以管理员有两种授权方式：粗粒度地把表单装配到应用并分配角色；或在 `role_permissions`、`form_permissions` 中为角色显式允许或拒绝某个表单、某个字段。

### 8.3 表单设计器中的角色权限

业务表单设置页可以为每个角色配置动作开关、字段可见与可编辑、数据范围和敏感字段处理，草稿保存在 `forms.config.permissionDesignDraft`。只有在发布表单时，`services/designer_permissions.py` 的 `sync_published` 才在同一事务中把它写成 `form_permissions` 行（动作级与字段级的允许或拒绝），并复制为生效的 `forms.config.permissionDesign`。保存草稿不会改变运行期权限。

生效配置中还有几项不落在 `form_permissions` 里、由服务层直接读取：

- `saveDraft`、`submit` 动作被关闭时，保存草稿或提交审批返回 `403`（`require_action`）。
- 行范围与归属限制（见 9.3）。
- 字段必填、隐藏，以及敏感字段的隐藏或脱敏方式。
- 是否允许查看统计汇总（`allow_statistics`）。

设计器按角色的 `name` 或 `label` 匹配配置；管理员不受这些配置限制。

### 8.4 权限模拟

`POST /api/v1/admin/permissions/simulate` 以指定用户的身份执行一次判定：带 `form_id` 时调用 `evaluate_form_permission`（可指定字段和一条示例记录），否则调用 `has_permission`，返回是否允许、来源、原因和命中的规则，用于排查配置。每次模拟写审计日志。

## 9. 记录范围与字段限制

非管理员读写记录时，`services/records.py` 依次执行：表单级判定、逐行判定、字段投影。

### 9.1 数据范围

逐行判定（`record_allowed`）先要求该记录在当前租户、对应动作被允许、且通过设计器行范围（9.3），再看命中的允许规则中的 `data_scope`，任一规则满足即可：

| `data_scope` | 含义 |
| --- | --- |
| `all`、`current_app`、`tenant`，或未设置 | 不限制 |
| `self`、`own` | 记录的 `created_by` 是当前用户 |
| `own_org` | 记录数据中的 `org_unit_id` 属于用户所在组织 |
| `org_tree` | 记录数据中的 `org_unit_id` 属于用户所在组织或其下级 |
| `condition`、`selected_orgs` | 来自带 `condition_json` 的角色授权，条件已按该行求值通过 |

列表接口不会因为无权查看的记录报错，而是直接跳过它们；读取、修改、删除单条无权记录返回 `403`。新建记录时也按将要写入的数据做一次逐行判定。

### 9.2 行条件

`role_permissions.condition_json` 使用 `services/iam.py` 的 `condition_matches` 求值，形如：

```json
{"rules": [{"field": "plant", "op": "equals", "value": "A"},
           {"field": "created_by", "op": "equals", "value": "$current_user_id"}]}
```

支持的操作符为 `equals`、`contains`、`in`、`between`，所有规则都满足才算匹配。值可以使用 `$current_user_id`、`$current_tenant_id`、`$current_org_ids` 占位符。可用字段包括记录数据中的字段以及 `created_by`、`updated_by`、`record_id`。

### 9.3 设计器行范围

表单设计器中为角色设置的 `data.scope`（`designer_permissions.row_allowed`）在上述判定之外再做一层过滤：

| 范围 | 允许的记录 |
| --- | --- |
| `all` | 全部 |
| `assigned` | 自己创建的，或 `assigned_to`、`assignee_id`、`current_assignee`、`handler_id` 之一是自己 |
| `org` | 记录的 `org_unit_id` 属于用户所在组织 |
| `org_tree` | 记录的 `org_unit_id` 属于用户所在组织或其下级 |
| `custom` | 记录的 `org_unit_id` 在配置的组织列表中 |

还可以用 `ownership` 开关（我创建的、分配给我的、同组织、跨组织）进一步收窄。用户有多个角色时，任一角色允许即可。

### 9.4 字段可见与可编辑

`allowed_form_fields` 为每个字段判定 `view`、`create` 或 `edit`：字段默认继承表单级授权，显式的字段级拒绝优先；设计器中隐藏的字段一律移除。在此基础上：

- 读取：记录只返回可见字段（`project_record`）。搜索、筛选只在可见字段上进行，对不可见字段筛选或排序会被拒绝，所以隐藏字段的值不会影响搜索结果和计数。
- 写入：新建或修改时提交了不可编辑的字段，返回 `403 Field permission denied`；提交了不存在的字段返回 `422`。
- 审批节点：记录处于进行中的审批时，当前节点配置为不可见的字段也会从返回中移除（`services/workflow_field_policy.py`）。

### 9.5 脱敏与复制

字段可以配置脱敏规则（按角色、部分遮盖或完全隐藏）和复制策略（`services/field_policies.py`）。脱敏只作用于返回值，数据库中保存原值。脱敏规则对管理员同样生效；依赖脱敏字段计算出的字段也会被遮盖，防止从计算结果反推原值。被脱敏的字段不能直接修改，也不能作为乐观并发比较的原值，否则返回 `403`。

### 9.6 生产模式的查询限制

`APP_MODE=production` 时，带搜索词的记录查询要求表单中至少有一个可见的 `searchable` 字段，按字段筛选要求该字段为 `searchable` 或 `sortable`，否则返回 `400`，不会退化为全表扫描。

## 10. 新增接口时如何保护

先按[后端开发指南](../development/backend.md)第 5 节选择访问级别。常用写法：

当前租户管理员：

```python
from app.api.deps import require_admin

@router.post("/dangerous-config")
async def update_config(user: dict = Depends(require_admin)):
    ...
```

固定资源键的通用授权：

```python
from app.api.deps import require_permission

@router.post("/reports/quality/publish")
async def publish_quality_report(
    user: dict = Depends(require_permission("report", "quality", "publish")),
):
    ...
```

资源键来自路径参数或请求体时，不能用固定键的依赖，应在函数内调用 `has_permission(user, "report", report_code, "publish", db)`。

表单运行时接口：路径上有 `form_id` 时可以用 `Depends(require_form_permission("edit"))`；涉及具体记录时应调用 `services/records.py` 中的函数（例如 `create_record`、`update_record`、`list_records`），它们已包含表单级、行级、字段级判定和审计，不要在路由里自己读写 `dynamic_records` 或物理表。

其他约定：

- 服务层不得导入 `app.api.deps`，需要管理员判定时用 `app.core.principal.ensure_admin`（`tests/test_layering.py` 检查）。
- 只依赖 `get_current_user` 的写接口意味着所有登录用户都能调用，必须在服务层补足判定。
- 确实不需要登录的接口，要同时加入 `test_route_auth_coverage.py` 的 `PUBLIC_ROUTES`。
- 查询必须带 `tenant_id` 过滤，跨租户的资源一律按不存在处理。

## 11. 已知限制

- 部分旧模块（质量、维护、供应链、分析等）的接口只要求登录，没有接入 `has_permission` 等统一的资源权限判定。
- 非管理员的记录列表在 Python 中逐批（每批 200 行）读取并判定行权限后再分页，权限条件没有下推到 SQL，大数据量下性能有限。
- `own_org`、`org_tree` 等组织范围依赖记录数据中的 `org_unit_id` 字段，没有该字段的表单无法按组织过滤。
- 身份安全设置（密码策略、锁定策略、OIDC 配置）保存在平台级的 `system_settings` 中，不区分租户，任意租户的管理员都可以通过 `/admin/iam/settings` 修改。
- OIDC 配置中的 `require_platform_mfa` 只在配置接口中返回，登录流程没有据此强制 MFA。
- `exchange_oidc_code` 会把以 `demo:` 开头的授权码直接解码为用户声明，不区分运行模式。启用 OIDC 的环境需要注意这一点。
- 没有登录接口的请求频率限制，只有按账号的失败锁定。

## 12. 测试

| 测试 | 覆盖内容 |
| --- | --- |
| `tests/test_route_auth_coverage.py` | 非公开接口都依赖 `get_current_user`；匿名请求返回 `401`；模型驱动写操作和 `/config/*` 需要平台管理员 |
| `tests/test_auth_hardening.py` | Bearer 令牌、拒绝查询字符串令牌、OIDC 必须带租户、同名账号登录需消歧 |
| `tests/test_security.py` | JWT 签发与校验、密码哈希、权限匹配中的别名与通配符 |
| `tests/test_identity_access_center.py` | TOTP、行条件 DSL、字段规则读写判定、密码策略 |
| `tests/test_field_policies.py` | 脱敏、复制策略、计算字段保护 |
| `tests/test_tenant_onboarding.py` | 邀请、邮箱登录、重置密码、跨租户防护、域名状态与配额、平台租户运营 |
| `tests/test_business_tenant_isolation.py`、`tests/test_saas_hardening.py` | 业务模块租户隔离、租户导出脱敏 |
| `tests/test_forms_platform.py` | 隐藏字段不可查询、筛选与排序字段限制、生产模式查询限制 |
| `tests/test_multi_user_business_acceptance.py` | 多用户矩阵：应用与菜单可见性、显式拒绝、部门范围、审批节点字段可见性、撤销授权与停用账号后已有令牌失效、登录 Cookie 与注销 |
| `tests/test_record_service.py` | 行范围、字段脱敏、条件拒绝在计数前生效，页面与 AI 共用同一套判定 |

```bash
cd backend
python -m pytest tests/test_route_auth_coverage.py tests/test_auth_hardening.py \
  tests/test_security.py tests/test_identity_access_center.py tests/test_forms_platform.py \
  tests/test_multi_user_business_acceptance.py tests/test_record_service.py
```

这些测试在 CI 中随后端全量测试一起运行，见[测试说明](../operations/testing.md)。
