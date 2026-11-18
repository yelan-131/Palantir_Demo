# 应用与应用菜单

更新日期：2026-11-17（对应代码版本 0.3.22 草稿）

本文描述“应用”这一低代码资产在当前代码中的实现：应用的标识与属性、可见性、菜单树、启动入口、运行时加载方式，以及管理应用和菜单的 AI 工具。表单本身的字段、布局和发布见[表单管理](forms.md)，权限判定的通用机制见[权限体系](../permissions.md)，完整接口清单见 [API 参考](../../development/api-reference.md)。应用生命周期的目标规则属于设计内容，见[配置资产生命周期](../../design/low-code/configuration-lifecycle.md)。

以代码为准：`backend/app/api/applications.py`、`backend/app/services/applications.py`、`backend/app/services/application_menus.py`、`backend/app/services/application_menu_nodes.py`、`backend/app/api/forms.py`（菜单节点与表单绑定路由）、`backend/app/services/ai/application_admin_tools.py`、`backend/app/services/ai/menu_admin_tools.py`、`frontend/src/App.tsx`、`frontend/src/pages/SystemAdmin/AppMenuManagement.tsx`。

## 1. 概念

应用是业务人员进入系统后看到的业务工作包，例如“生产态势”“质量分析”。一个应用由三部分组成：

- 应用自身：名称、编码、图标、说明、状态、排序、是否置顶、启动页面。
- 可见角色：哪些角色可以在应用栏中看到并进入这个应用。
- 菜单树：应用内部的分组和入口，入口指向业务表单或组件页面。

应用不保存业务数据，也不定义字段。表单与应用是多对多关系：同一张表单可以挂到多个应用的菜单中。

## 2. 数据表

| 表 | 用途 |
| --- | --- |
| `applications` | 应用本身。`(tenant_id, code)` 唯一 |
| `application_roles` | 应用与角色的绑定，决定应用可见性 |
| `application_menu_nodes` | 当前使用的菜单树：分组、表单入口、页面入口 |
| `application_forms` | 应用与表单的绑定，带别名、启用状态、`data_scope` 和增删改导出开关 |
| `application_menus`、`menu_items` | 旧版应用菜单，仅在应用没有任何菜单节点和表单绑定时作为回退来源 |

`applications` 的主要字段：

| 字段 | 说明 |
| --- | --- |
| `name`、`code` | 显示名称与租户内唯一编码。编码可以修改，修改时同样校验唯一性 |
| `description`、`icon` | 说明和图标。图标保存 Ant Design 图标名，例如 `DashboardOutlined` |
| `default_route` | 启动页面，默认 `/` |
| `sort_order` | 排序，数值越小越靠前 |
| `status` | 字符串，代码中使用 `draft`、`published`、`disabled` 三个值（见第 6 节） |
| `is_pinned` | 是否置顶到应用栏 |

所有应用相关表都带 `tenant_id`，查询一律按当前租户过滤。新建应用前会检查租户配额（`tenant_onboarding.assert_tenant_quota`，默认每个租户 20 个应用）。

## 3. 可见性

### 3.1 应用可见性

`GET /api/v1/applications` 返回当前用户可见的应用，按 `sort_order`、`id` 排序：

- 只返回当前租户中 `status = published` 的应用。
- 管理员看到全部已发布应用。
- 普通用户只看到通过 `application_roles` 绑定了自己角色的应用。匹配按角色名在当前租户内进行，没有任何角色的用户看不到应用。

`GET /api/v1/applications/{id}` 和 `GET /api/v1/applications/{id}/menus` 使用同一套判定：未发布的应用对普通用户返回 404，没有绑定角色返回 403。管理员通过 `GET /applications/{id}` 可以读取未发布应用。

应用的可见角色目前只能通过 `PUT /api/v1/admin/applications/{id}/bindings` 的 `role_ids` 整体替换。前端“应用与菜单”页面的“应用访问”分组只展示已绑定的角色，开关不可编辑，也没有调用该接口；演示环境中的绑定由迁移 `0012_seed_demo_application_roles` 写入。

### 3.2 应用绑定对表单权限的影响

`application_forms` 不只是菜单的附属数据。表单权限判定（`app/core/permissions.py`）在角色权限和表单级权限都没有命中时，会检查“用户角色所绑定的应用中是否绑定了这张表单”：只要绑定处于启用状态，就允许查看；新增、编辑、删除、导出分别再看 `allow_create`、`allow_edit`、`allow_delete`、`allow_export`。因此，把表单挂到应用菜单会间接给该应用的可见角色授予表单访问权限。判定顺序和拒绝规则见[权限体系](../permissions.md)。

### 3.3 菜单节点可见性

`GET /api/v1/applications/{id}/menus` 只返回 `visible = true` 的节点，并逐个检查：

1. 页面入口（`node_type = page`）：路由必须是 `/pages/<页面编码>`，页面必须有已发布版本，这两条对管理员同样生效。普通用户还要满足：页面设置了角色范围时角色必须命中；页面绑定了宿主表单时，该表单已发布且用户有查看权限。
2. 管理员：通过以上检查后，其余节点全部可见。
3. 表单入口：表单必须属于当前租户、处于 `published` 状态，且用户有该表单的 `view` 权限。
4. 权限来源：节点 `config.permission_mode` 不是 `custom` 时，跟随应用可见性；为 `custom` 时，看角色权限表中是否有 `menu` 资源 `menu_node:<节点ID>` 的 `view` 授权。

被过滤掉的节点不会出现在返回的树中。分组节点没有表单或页面目标，只按第 4 步判断，因此即使其下所有入口都被过滤，分组本身仍会返回。

## 4. 菜单树

### 4.1 节点类型与目标

| `node_type` | 目标 | 路由 |
| --- | --- | --- |
| `group` | 无，仅用于分组 | 空 |
| `form` | `form_id` 指向一张表单 | 未显式给出 `route_path` 时自动生成：分析类表单（`config.assemblyKind` 等为 `analysis`、`dashboard`、`report` 等）用 `/program/<表单编码>`，其他用 `/dynamic/<表单编码>` |
| `page` | 已发布的组件页面 | `/pages/<页面编码>`；创建时传 `page_code`，后端校验页面已发布，否则返回 409 |

创建或更新表单入口时，服务层会自动补一条启用状态的 `application_forms` 绑定。删除表单入口不会删除这条绑定，因此第 3.2 节的表单访问权限仍然保留，需要时在“业务数据”中解除绑定（`DELETE /forms/applications/{id}/forms/{form_id}`）。

### 4.2 写入规则

菜单的配置接口挂在 `/api/v1/forms/applications/{id}/` 下（`menu-nodes`、`menu-order`、`forms`），全部要求当前租户管理员。共同规则：

- 写入前获取租户级写锁，并对应用行加锁（SQLite 下用一次空更新代替 `FOR UPDATE`）。
- 父节点必须属于同一应用，不允许形成循环。
- 删除节点时，其直接子节点按原顺序提升到被删节点的同级；节点上的菜单权限一并删除。
- `PUT menu-order` 必须提交当前应用的完整菜单结构，同时带上 `expected`（编辑前的结构）。结构已被他人改动时返回 409，同级排序重复时返回 422。

### 4.3 节点级访问权限

节点的 `config` 中保存 `permission_mode`（`inherit` 或 `custom`）和 `role_ids`。保存时，服务层把 `custom` 模式的角色同步写入 `role_permissions`：

- `resource_type = menu`，`resource_key = menu_node:<节点ID>`，`action = view`，`effect = allow`。
- 节点隐藏时这些授权被置为未启用，但 `config` 中保留角色选择，重新显示时恢复。
- 同步后 `config` 带 `permission_synced = true`，运行时只认角色权限表中的授权。

前端“访问权限”面板提供“跟随应用权限”和“为此菜单单独设置”两种模式，并可以在面板中直接新建角色。

## 5. 启动页面与默认入口

`applications.default_route` 是应用的启动页面，菜单节点上的 `default_entry` 与它保持同步：

- 把某个可见节点设为默认入口时，应用的 `default_route` 改为该节点的路由，同一应用的其他节点取消默认标记。节点没有路由时返回 422。
- 直接修改应用的 `default_route` 时，第一个路由相同且可见的节点被标记为默认入口；路由为 `/` 时不标记任何节点。
- 删除默认入口节点，或取消它的默认标记时，`default_route` 重置为 `/`。

“应用与菜单”页面中，“启动页面”下拉框列出“工作台首页”（`/`）和应用内所有可见入口的路由。

## 6. 状态与生命周期（当前实现）

应用的状态流转主要由前端和 AI 工具约束，HTTP 接口本身不校验：

| 操作 | 前端“应用与菜单” | AI 工具 | `/admin/applications` 接口 |
| --- | --- | --- | --- |
| 新建 | 先在本地生成草稿，保存时以 `draft` 创建 | `applications.create` 固定为 `draft` | `status` 默认值为 `published`，可传任意字符串 |
| 发布 | 草稿改为 `published` | 只允许 `draft → published` | 任意修改 `status` |
| 停用 | `published → disabled`，需二次确认 | 只允许 `published` 或 `active` → `disabled` | 同上 |
| 启用 | `disabled → published` | 只允许 `disabled → published` | 同上 |
| 删除 | 只对草稿显示删除按钮 | 只允许删除草稿，确认卡片列出受影响的菜单节点和表单绑定数量 | 任何状态都可删除 |
| 复制 | 已发布应用可“复制为草稿”，只复制应用属性，不复制菜单和角色 | 无 | 无 |

发布时没有额外的完整性检查（例如可见角色、启动页面是否有效），只校验编码唯一。停用的效果是应用不再出现在 `GET /applications` 中，菜单接口对普通用户返回 404；菜单、表单绑定和角色绑定都保留。

删除应用（`DELETE /admin/applications/{id}`）会删除该应用的菜单节点及其菜单权限、`application_forms` 绑定、`application_roles` 和旧版 `application_menus`（通过 ORM 级联），并写审计日志。表单和业务数据不受影响。

`draft → published → disabled → archived` 的完整目标模型（含归档、删除保护、发布检查）尚未实现，见[配置资产生命周期](../../design/low-code/configuration-lifecycle.md)。

## 7. 并发编辑保护

应用和菜单节点的读取结果都带 `edit_token`，是关键字段序列化后的 SHA-256。更新应用（`PUT /admin/applications/{id}`）或菜单节点时传 `expected_token`，与当前值不一致返回 409“配置已被其他编辑更新”。不传 `expected_token` 时不做检查。菜单排序使用第 4.2 节的 `expected` 结构做同样的保护。

## 8. 运行时加载（前端）

应用外壳在 `frontend/src/App.tsx` 中：

1. 登录后请求 `GET /applications`，得到可见应用列表。应用栏按“置顶优先”排列，置顶来自 `is_pinned`。
2. 用户在 `/more`（应用中心）可以为自己修改应用的显示名称、图标和是否置顶。这些修改只保存在浏览器本地的个人偏好中（`useShellPreferences` 的 `appOverrides`），不写回后端。
3. 首次进入 `/` 时，自动打开排在最前的应用的 `default_route`；点击应用栏的“工作台”才停留在[我的工作台](workbench.md)。当前应用 ID 保存在 `localStorage` 的 `mf_current_app_id`。
4. 进入应用后请求 `GET /applications/{id}/menus` 渲染左侧菜单。前端再隐藏 `is_visible = false` 的节点，并把料号申请入口从应用菜单中移除（料号申请归入流程中心）。
5. 通过书签或搜索结果打开某个业务页面时，外壳先按 `default_route` 匹配，再逐个查询其他应用的菜单，找到包含该路由的应用并自动切换。
6. 应用配置保存后，配置页面派发 `applications-changed` 事件，外壳重新加载应用列表。

菜单入口打开的 `/dynamic/:slug`、`/program/:programId` 如何解析为组件页面或旧页面，见[前端开发指南](../../development/frontend.md)。

### 8.1 菜单数据的回退顺序

`GET /applications/{id}/menus` 按以下顺序取第一个有数据的来源：

1. `application_menu_nodes`（当前方式），返回树形结构。
2. `application_forms` 中启用且已发布、用户有查看权限的表单，平铺返回。分析类表单使用 `/program/<编码>`，其他表单使用 `/dynamic/<编码>`。
3. 旧版 `application_menus` + `menu_items`。

新配置的应用都会走第 1 条；第 2、3 条只用于兼容早期数据。

## 9. 配置界面

“应用配置 → 应用与菜单”（`/studio/applications`，仅管理员）由 `pages/SystemAdmin/AppMenuManagement.tsx` 实现，同一组件以“业务数据”模式服务 `/studio/business-data`。

- 左侧选择应用，中间是菜单树，右侧属性面板在“应用设置”“菜单属性”“表单属性”之间切换。
- 应用属性分三组：基本信息（名称、编码、图标、说明）、入口与导航（启动页面、排列顺序、置顶）、应用访问（只读的角色清单）。
- 菜单树支持新建分组、把已发布的组件页面加入菜单、拖拽排序、编辑名称和可见性、设置默认入口、按节点设置访问角色。
- 未保存的修改在切换应用或离开页面时会提示确认。

## 10. AI 工具

AI 管理应用和菜单的工具都是业务服务的薄适配，写操作只生成确认卡片，用户确认后才执行。工具只允许管理员调用（`ensure_admin`），执行前比对确认时的快照摘要，应用或菜单在确认期间被改动则返回 409，要求重新生成确认卡片。

| 工具 | 作用 |
| --- | --- |
| `platform.application_settings.query` | 只读。`subject` 为 `applications`（默认）、`menus`（需 `application_id`）或 `pages`（已发布的组件页面及其 `page_code`） |
| `applications.create`、`applications.update` | 新建草稿应用；修改名称、编码、说明、图标、启动页面、排序、置顶。不能修改状态和可见角色 |
| `applications.publish`、`applications.disable`、`applications.enable`、`applications.delete` | 按第 6 节表中的状态约束流转或删除草稿 |
| `menus.create_group`、`menus.create_entry` | 新建分组；把已发布的页面（`page_code`）或已发布的表单（`form_id`）加入菜单 |
| `menus.update_entry` | 改名、设置可见性或默认入口；可把现有入口改指向一个已发布组件页面，但该页面必须绑定原入口的表单 |
| `menus.reorder`、`menus.delete_entry` | 移动到指定分组和位置（从 1 开始）；删除节点并提升其子节点 |
| `forms.publish_to_menu` | 把标准业务表单（非分析类）挂到已发布应用的菜单，表单未发布时先发布 |

`applications.*` 和 `menus.*` 由迁移 `0043_application_menu_ai_tools`（SQLite 模式下由 `app/core/application_menu_registry_schema.py`）写入每个租户的工具注册表，不在 `data/agent_registry/tools.json` 中。Harness 运行时通过工具发现（`platform.tools.describe` / `platform.tools.invoke`）向模型提供注册表中已启用、当前用户有权调用的工具。技能 `low_code.manage_component_page` 的允许清单包含 `menus.create_entry` 和 `menus.update_entry`，`low_code.publish_form_to_menu` 使用 `forms.publish_to_menu`。工具契约见 [AI 技能与工具契约](../ai/skill-contract.md)。

## 11. 已知限制

- 应用可见角色没有可用的编辑界面，只能调用 `PUT /admin/applications/{id}/bindings`。该接口按请求整体替换角色和旧版菜单绑定，不校验 `edit_token`，也不校验角色是否属于当前租户（运行时可见性判定会按租户过滤角色，跨租户角色不会生效）。
- `/admin/applications` 接口不校验状态取值和流转，也不阻止删除已发布应用；这些约束只在前端和 AI 工具中实现。
- 租户中没有任何应用时，`GET /admin/applications` 返回 409（`SEED_DATA_REQUIRED`），“应用与菜单”页面会显示加载失败。此时可以通过 AI 工具 `applications.create` 或直接调用 `POST /admin/applications` 创建第一个应用。
- 用户在应用中心做的名称、图标、置顶修改只存在当前浏览器，换设备不会同步。
- `backend/app/api/applications.py` 中的 `DEFAULT_APPLICATIONS`、`DEFAULT_MENUS`、`_mock_*`、`_ensure_default_seed`、`_rule_actions_match`、`_menu_rule_subject_matches` 没有被任何代码调用，是早期遗留，不代表当前行为。

## 12. 尚未实现

以下内容曾在产品设计中提出，当前代码没有对应字段或逻辑：

- 应用负责人或团队（owner / team）。
- 应用级业务范围（例如按工厂、组织限制应用）。
- 独立于 `default_route` 的“默认菜单入口”字段；当前通过节点的 `default_entry` 与 `default_route` 同步实现。
- 应用属性的实时预览卡片。
- 发布前的完整性检查、停用后的提示、归档状态，见[配置资产生命周期](../../design/low-code/configuration-lifecycle.md)。
