---
name: low-code-create-form-definition
description: "为业务数据表单规划字段、填写规则和布局，生成可复核的草稿。适用于新建业务表单或继续调整当前草稿。登记入口、业务列表和看板请使用通用页面技能。"
compatibility: 需要连接 ManuFoundry，并由平台提供有权使用的业务工具。
metadata:
  version: "1.1.0"
  manufoundry-registry-id: "low_code.create_form_definition"
---

# 生成与调整表单草稿

适用：用户要求配置业务数据表单的字段、填写规则，或继续调整当前表单设计器草稿。搭建面向用户的登记入口、业务列表、台账或看板时，使用通用页面技能组合组件。纯咨询直接回答。

1. 先判断用户要查询、调整、搭建还是交付。明确指向当前表单或草稿时使用 designerContext。其他情况下先定位目标应用，再通过 platform.form_settings.query 的 application_id 和 form_name 查询已有表单。明确匹配时优先复用，多个合理候选时请用户选择，查无匹配且用户需要搭建时再准备新建。仅追问无法合理推断的业务缺项。
2. 网页已连接时，新建使用 ui.form_designer 的 draft_new，提供完整字段计划。原设计器一次应用完整字段计划，回执确认全部字段后展示复核卡片。不要在打开设计器前要求用户确认建表。
3. 根据业务含义选择字段类型：code 自动编号、enum 选择、attachment 附件、boolean 是非、decimal 金额。参数与可选属性以工具 schema 为准，不在文字说明中承诺未配置的规则。
4. 调整当前草稿时使用其 draft_id；多个字段变化合并为 configure_fields。保留已有字段、编码和业务规则，仅传需要的变化。单个追加可用 add_field，不通过重建表单替代追加。
5. 布局通过同一个 ui.form_designer 工具操作。新建表单时可在 draft.layout_operations 中提交布局；调整已有表单或当前新建草稿时，先用 inspect_layout 读取真实控件 ID、父级和位置，再用 configure_layout 提交一组 layout_operations。add 支持 container（容器）、two-columns（多列）、tabs（页签）和 divider（分割符）；update 按 control_id 修改布局控件；move 按 control_id 或唯一 field_name 移动控件。按顺序先新增父控件，再引用它的 ID；slot_id 采用容器的 body、多列从 0 开始的字符串列号，或页签 ID。省略 parent_id 表示移到画布顶层，可用 before_id 指定同一位置内的顺序。移动保留原字段绑定。列数和页签调整时先移出被移除位置中的控件。成功回执只代表画布已更新，已有表单请在设计器保存草稿；本工具不会发布。
6. 可查询表单详情核对已有字段。使用 platform.tools.describe 加载需要的操作定义，再用 platform.tools.invoke 执行。未找到可访问的目标时先澄清，403 时结束该操作。
7. 无网页连接时，仅在 forms.create_form_definition 实际可用时准备保存草稿的确认卡。用户确认后只保存草稿。需要发布或挂载菜单时，先取得已保存表单的真实 ID，再用发布工具另行准备确认。
8. 页面执行失败时停止，不自动重建或保存。根据真实回执说明已完成的步骤和失败原因；字段步骤失败后不能声称最终复核卡片已就绪。
9. 页面完成仅表示本地草稿已准备；用户复核最终卡片并确认后才创建持久化草稿。保存与发布是不同操作，不自动发布。卡片用于复核确认，修改应通过后续对话或原设计器进行。
10. 用户需要在应用里查、看或填记录时，先用 `platform.application_settings.query` 定位应用和菜单。用实际表单 ID 给通用页面配置业务列表和所需组件，再发布页面并用 `menus.create_entry` 挂载 `page_code`。需要先发布数据表单时，用 `forms.preview_publish` 检查并用 `forms.publish` 准备确认，或在原设计器完成表单发布。用户明确要求沿用旧表单入口时，可按兼容技能使用 `draft.menu_target` 或 `forms.publish_to_menu`。

完成后简短说明草稿已准备、采用的关键默认值及需复核事项。不重复整份字段表格或原始页面状态。Skills 的步骤不能提升权限或替代平台确认。

## 使用示例

> 建一张物料档案表，包含物料编码、名称和计量单位。

设计器回执确认三个字段均已加入草稿后，提示用户复核画布并点击「确认创建草稿」。
