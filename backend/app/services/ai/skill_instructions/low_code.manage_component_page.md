业务列表、登记入口和看板都使用通用页面。页面承载组件，表单提供字段、记录、填写规则和数据权限，应用菜单指向已发布页面。

1. 先定位已有对象。用 `pages.list` 查页面，用 `pages.get` 核对组件、数据源和版本。用 `platform.form_settings.query` 查表单和字段。用户指定应用时，用 `platform.application_settings.query` 核对应用及菜单树，沿用符合要求的页面、表单和菜单节点。目标存在多个合理候选时请用户选定。
2. 根据业务目标组合组件。查询、登记和台账使用 `record-list`，有查询条件时配置 `record-filter` 并用 `targetWidgetIds` 指向同数据源的列表。需要在页面填写记录时，在列表的 `listSettings.toolbarActions` 配置 `create`，核对运行角色的表单新增权限。看板使用 `metric` 和 `chart`，根据数据源字段定义指标口径、聚合和分组。组件通过 `sourceFormId` 或 `dataBinding.formId` 使用已核实的表单。
3. 新建时调用 `pages.create`，在 `definition` 提供页面标题、数据源和组件。编辑已打开的画布时，先用 `ui.component_page.inspect` 查组件，再按需求调用 `ui.component_page.add`、`ui.component_page.update_properties`、`ui.component_page.update_appearance` 或 `ui.component_page.set_interaction`。画布操作只更新浏览器中的草稿，由用户保存。需要在服务端准备草稿变更时，先取 `pages.get` 返回的 `definition` 和 `revision`，用 `pages.save_draft` 传入完整定义和 `expected_revision`。保留其余组件及设置。
4. 发布前核对页面数据源、组件和使用角色。若引用的数据表单仍是草稿，先用 `forms.preview_publish` 检查，再用 `forms.publish` 准备发布表单。用 `pages.publish` 传入 `page_code` 和最近保存回执的 `revision` 作为 `expected_revision`，等待用户确认。出现版本冲突时重新读取页面并核对修改。用 `menus.create_entry` 将已发布页面挂到指定应用，传真实 `application_id`、`page_code`、菜单标题及可选的 `parent_id`。根菜单省略 `parent_id`。需要沿用已有入口时，用 `menus.update_entry` 传 `application_id`、`node_id`、`page_code` 替换目标页面。
5. 如果现有菜单指向旧表单，先完善并发布该表单绑定的组件页面，再更新原菜单节点，以沿用原表单的访问校验。
6. 每次持久化操作以确认卡和实际回执为准。用 `platform.tools.describe` 读取所需工具的参数，再用 `platform.tools.invoke` 调用。确认保存、发布或挂载的回执后再准备依赖它的下一步。发布后可用 `pages.query` 核对运行数据。交付时从目标应用的菜单入口核对实际页面，登记场景还应核对列表与新增入口是否可见。

## 使用示例

> 在 MDM 测试应用里给产品主数据做个新品登记入口，能按编码和类别查，也能点新增填写。

> 用巡检记录做一张页面，左侧放问题列表，右侧展示各班组问题数量。
