---
name: low-code-manage-application
description: "管理应用及菜单，配置角色权限、启动入口和顺序，复制菜单分组，并保存或使用应用模板。"
compatibility: 需要连接 ManuFoundry，并由平台提供有权使用的业务工具。
metadata:
  version: "1.0.0"
  manufoundry-registry-id: "low_code.manage_application"
---

# 管理应用、菜单和模板

1. 用 `platform.application_settings.query` 核对用户指定的应用。未指定且操作指向当前工作区时，核对上下文中的 `applicationName`。跨应用操作分别确认源和目标应用的 ID。用 `applications.inspect` 核对实际菜单节点、父分组、应用默认入口和权限组。需要角色时用 `platform.identity_settings.query` 查 ID。无法从上下文区分多个候选时请用户选定。
2. `applications.create` 创建草稿。用 `applications.update` 修改名称、图标、说明、启动页面、置顶和访问权限组。调整应用位置使用 `applications.reorder`，位置从 1 开始。
3. 用 `menus.create_group` 新建分组。要连同入口创建同名页面草稿时，调用 `menus.create_page_draft`。已发布页面用 `menus.create_entry` 传 `page_code` 挂载。`menus.update_entry` 可以改名、设置菜单可见或默认入口；分组的默认入口选项只读。用 `menus.update_properties` 改图标、说明或权限来源，自定义权限组用 `access_groups` 完整提交。跟随应用权限使用 `permission_mode: inherit`。记录与字段权限沿用业务表单配置。
4. 新增应用或菜单权限组时，使用 `applications.update` 或 `menus.update_properties` 的 `add_access_group`。为新组提供唯一的 `id`、组名 `name` 和本租户角色 `roleIds`，已有组会保留。`access_groups` 用于完整替换。菜单当前跟随应用权限时，先确认用户希望改成独立授权，再在同一次调用中设置 `permission_mode: custom`。
5. 要给菜单创建并授权一个新角色，在 `menus.update_properties` 提供 `new_role`，其中 `name` 为角色编码，`label` 为角色名称。新角色加入本次追加的组，或当前第一个权限组。先核对租户中是否已有该角色，并在确认卡里说明将创建角色和授权的目标菜单。角色成员与数据权限在角色管理和业务表单中设置。
6. 用 `menus.reorder` 移动同级位置或者改父分组。复制选中的菜单用 `menus.copy`，跨应用时明确提供 `source_application_id`、目标 `application_id` 和源 `node_ids`。`parent_id` 省略表示目标根菜单。选中分组包含全部子菜单，页面、表单沿用原引用，目标应用的默认入口继续生效。
7. `applications.copy_draft` 仅复制应用基本属性。要复用菜单层级，用 `applications.save_template` 保存应用模板，再用 `applications.list_templates` 查模板 ID，并用 `applications.instantiate_template` 创建草稿。模板沿用现有页面和表单，草稿访问权限按默认值初始化。
8. 持久化前用 `platform.tools.describe` 核对工具参数，再用 `platform.tools.invoke` 准备确认。根据用户确认后的实际回执继续下一步。收到配置冲突时重新读取当前对象，再生成确认。应用发布、停用、启用及删除各有独立工具。只删除草稿应用。验收菜单时核对页面发布状态和运行角色的访问条件。回复说明实际目标应用、菜单位置、入口引用及保存或发布状态。

框选、展开状态和属性栏布局由浏览器管理。工具使用明确的应用和菜单 ID 表达选区和目标。
