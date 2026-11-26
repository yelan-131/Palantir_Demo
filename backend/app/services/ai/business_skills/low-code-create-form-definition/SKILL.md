---
name: low-code-create-form-definition
description: "根据应用和页面上下文定位业务表单，为新建或调整表单规划字段、填写规则和布局，生成可复核的草稿。登记入口、业务列表和看板使用通用页面技能。"
compatibility: 需要连接 ManuFoundry，并由平台提供有权使用的业务工具。
metadata:
  version: "1.1.0"
  manufoundry-registry-id: "low_code.create_form_definition"
---

# 生成与调整表单草稿

适用：用户要求配置业务数据表单的字段、填写规则，或继续调整当前表单设计器草稿。搭建面向用户的登记入口、业务列表、台账或看板时，使用通用页面技能组合组件。纯咨询直接回答。

1. 先判断用户要查表单配置、查或填记录、调整表单、搭建草稿，还是交付应用入口。用户明确指定的应用优先。提到「当前」「这里」「这张表」时，用 `applicationName`、`designerContext`、`componentPageContext` 和当前路由定位。只按读到的真实应用 ID、表单 ID 或编码执行。当前设计器草稿用 `draft_id`。
2. 用 `platform.application_settings.query` 核对指定应用，用户未指定时核对当前应用。按 `application_id` 和 `form_name` 查该应用的表单，已有 ID 或编码时精确查询。通用页面可核对其数据源。匹配明确时复用。范围仍不明确或多个合理候选影响操作对象时，请用户一次选定。用户明确在租户级业务数据中建表时按租户范围查重并准备独立草稿。
3. 网页已连接时，新建使用 `ui.form_designer` 的 `draft_new`，提交完整字段计划。属于应用时，传已核实的 `draft.application_id`。租户级独立表单省略该参数。原设计器一次应用完整计划，收到全部字段的回执后展示复核卡片。打开设计器并准备本地草稿无需事先确认。
4. 按业务含义选择字段类型，例如 `code` 自动编号、`enum` 选择、`attachment` 附件、`boolean` 是非、`decimal` 金额。参数以当前工具 schema 为准。规则超出当前工具能力时说明缺项，保留业务要求供用户复核。
5. 调整当前草稿时使用 `draft_id`。多个字段变化合并为 `configure_fields`，单个追加可用 `add_field`。保留已有字段、编码和业务规则，仅传需要的变化。
6. 新建表单可在 `draft.layout_operations` 中提交布局。调整已有表单或当前草稿时，先用 `inspect_layout` 读取控件 ID、父级和位置，再用 `configure_layout` 提交布局操作。`add` 支持 `container`、`two-columns`、`tabs`、`divider`。`update` 按 `control_id` 修改，`move` 按 `control_id` 或唯一 `field_name` 移动。`unplaced_fields` 提供可放入的字段。先新增父控件，再引用其 ID。`slot_id` 采用容器的 `body`、多列从 `0` 开始的字符串列号，或页签 ID。省略 `parent_id` 表示移到顶层，`before_id` 指定同一位置内的顺序。列数和页签调整前先移出被删除位置中的控件。已有表单调整布局后可在对话中确认保存，新建表单使用「确认创建草稿」。
7. 用 `platform.tools.describe` 加载实际可用的工具定义，再用 `platform.tools.invoke` 执行。无网页连接时，可用 `forms.create_form_definition` 准备保存草稿的确认卡，应用内建表传 `form.application_id`。页面执行失败时根据回执说明已完成的部分和失败原因。权限拒绝时结束该操作。
8. 有页面回执时说明本地草稿已准备，用户确认后按保存回执报告。只有用户要求交付应用入口时，才继续核对应用、用实际表单 ID 配置通用页面、发布页面并用 `menus.create_entry` 挂载。表单发布使用 `forms.preview_publish` 和 `forms.publish` 或原设计器。沿用旧入口时按兼容技能使用 `draft.menu_target` 或 `forms.publish_to_menu`。写入步骤分别确认，完成后核对实际回执。

回复说明实际目标表单、归属应用、草稿状态和需复核的默认值。应用内草稿保存后以真实绑定回执为准，租户级表单说明未绑定应用。需要交付入口时说明其发布和挂载状态，关联应用的表单草稿与应用菜单入口分别以各自回执为准。

## 使用示例

> 在当前应用建一张物料档案表，包含物料编码、名称和计量单位。

核对当前应用后，按其 ID 准备草稿。设计器回执确认三个字段均已加入后，提示用户复核表单和应用，再点击「确认创建草稿」。
