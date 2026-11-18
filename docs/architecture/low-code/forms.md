# 表单

更新日期：2026-11-17（对应代码版本 0.3.22 草稿）

本文描述业务表单与分析表单在当前代码中的实现：表单定义与配置、字段、布局与视图、规则、自动编码、发布与版本、流程与审批、记录运行期、复制与删除、AI 工具，以及前端的表单设置页面。共享服务分层、存储引擎和组件页面见[低代码平台](platform.md)，表结构见[数据模型](../data-model.md)，权限判定顺序见[身份与权限体系](../permissions.md#8-表单权限)，完整接口清单见 [API 参考](../../development/api-reference.md)。

以代码为准：`backend/app/api/forms.py`、`backend/app/api/form_approvals.py`、`backend/app/services/form_*.py`、`backend/app/services/form_engine/`、`backend/app/services/records.py`、`backend/app/services/field_uniqueness.py`、`backend/app/services/field_limits.py`、`backend/app/services/designer_permissions.py`、`backend/app/services/ai/form_configuration_tools.py`、`backend/app/services/ai/low_code_tools.py`、`frontend/src/pages/FormSettings/`、`frontend/src/pages/SystemAdmin/AppMenuManagement.tsx`、`frontend/src/pages/SystemAdmin/AssemblyPropertyPanels.tsx`。

## 1. 组成

一张表单由以下几部分组成，都按 `tenant_id` 隔离：

| 部分 | 存储 | 说明 |
| --- | --- | --- |
| 表单定义 | `forms` | 名称、编码、存储方式、物理表名、状态、负责人、`config` |
| 字段 | `form_fields` | 字段元数据，只归档不删除 |
| 布局 | `form_layouts` | 按 `layout_type`（`list`、`form`、`view` 等）各一行 |
| 动作 | `form_actions` | 按钮元数据，见 4.4 |
| 角色权限 | `form_permissions` | 表单级与字段级允许或拒绝 |
| 流程绑定 | `workflow_bindings` | 表单动作与流程定义的连接 |
| 发布版本 | `form_versions` | 不可变快照与影响报告 |
| 编码流水号 | `form_code_sequences` | 自动编码字段的计数器 |
| 业务记录 | `dynamic_records` 或表单物理表 | 见[低代码平台](platform.md#4-表单存储引擎) |

设计器的大部分配置放在 `forms.config` 这个 JSON 中，常见键如下：

| 键 | 内容 |
| --- | --- |
| `formDesignerControls` | 设计器画布上的控件：绑定字段、规则、类型设置、默认值、计算、编码、选项来源、赋值规则 |
| `formLayout` | 运行期表单布局 |
| `viewConfig`、`viewConfigDraft`、`viewConfigMeta` | 列表视图（含多个视图页签）的生效配置、草稿和版本信息 |
| `permissionDesign`、`permissionDesignDraft` | 设计器中的角色权限，见第 7 节 |
| `analyticsDesign`、`analyticsDesignDraft`、`analyticsDesignMeta` | 分析表单的看板设计，见第 11 节 |
| `workflowDesigner` | 设计器使用的流程定义 ID（`draftWorkflowId`、`publishedWorkflowId` 等） |
| `publishedSchemaVersion`、`publishedAt` | 最近一次发布的版本号与时间 |
| `assemblyKind` | 表单类型；`analysis`、`dashboard`、`report` 等表示分析表单 |
| `componentPageEnabled`、`componentPageCode` | 绑定的组件页面，见[低代码平台](platform.md#6-组件页面) |
| `structureLocked` | 前端在保存后锁定字段编码和类型的标记，后端不读取 |

## 2. 表单定义与状态

### 2.1 新建

`POST /forms` 仍由 `api/forms.py` 的 `_create_form` 实现，要求管理员：

- 编码必须匹配 `[A-Za-z0-9][A-Za-z0-9_-]{0,99}`，租户内唯一，否则返回 400 或 409。
- 请求中 `storage_mode` 为 `dynamic` 且没有 `table_name` 时，改为 `physical_table` 并生成表名，随后立即建表。表名规则见[低代码平台](platform.md#42-命名规则)。
- 自动创建 `list`、`form` 两个布局和 `create`、`edit`、`delete`、`export` 四个动作；带 `application_id` 时同时写入应用绑定 `application_forms`。
- 带 `designer_draft` 时（AI 设计器草稿的确认路径），在同一事务中批量创建 1 到 60 个字段、写入 `view` 布局和草稿流程定义，状态固定为 `draft`。`draft_id` 与请求摘要作为回执保存在 `config._designerDraftReceipt` 中，同一个人重复提交同样的草稿时直接返回已创建的表单。

不带 `designer_draft` 时，后端不要求表单有任何字段。

### 2.2 状态

`forms.status` 是自由字符串，默认 `draft`。代码中实际使用的值：

- `draft`：新建。
- `published`：`form_versions.publish_form` 发布成功后写入。
- `disabled`：前端“停用”通过 `PUT /forms/{id}` 写入。
- `active`：独立表单设置页为非 AI 草稿新建平台表单时使用的初始状态。
- `archived`：只在少数读取逻辑中被识别（例如审批设置拒绝归档表单，前端把它显示为停用），没有设置入口。

`PUT /forms/{id}`（`form_admin.update_form`）接受任意状态值和任意 `config`，不校验状态流转。它用 `expected_token` 做并发检查；当看板配置已由看板编辑器接管（`analyticsDesignMeta.managedBy` 为 `analytics-editor`）时，拒绝修改看板相关键并返回 409；修改 `table_name` 时校验命名空间，但不迁移已有数据。

状态的目标规则（包括停用后禁止新增数据）见[配置资产生命周期](../../design/low-code/configuration-lifecycle.md)，本节只描述现状。

## 3. 字段

### 3.1 类型

`form_definition.FIELD_TYPE_ALIASES` 把传入的类型规范化为存储类型，不认识的类型返回 422：

| 传入 | 存储类型 |
| --- | --- |
| `string`、`code`、`person` | `string` |
| `text`、`longText`、`long_text` | `text` |
| `number`、`integer`/`int`、`decimal`、`float` | 各自对应 |
| `boolean`/`bool`、`date`、`datetime` | 各自对应 |
| `enum`、`select` | `enum` |
| `relation` | `relation` |
| `attachment`、`json` | `json` |

物理列类型的映射见[低代码平台](platform.md#43-建表与加列)。业务语义（`business_type`）、控件类型（`control_type`）、数据来源（`data_source`）和编码规则（`encoding_rule`）不单独建列，而是写入字段的 `ui_config`（`businessType`、`controlType`、`dataSource`、`encodingRule`）。业务类型为 `code` 或带编码规则的字段被视为编码字段。

前端“字段结构”面板提供的类型为：文本、长文本、布尔、明细 / JSON、整数、小数、日期、日期时间、单选、人员、附件。设计器的业务类型为：文本、多行文本、数值、日期、日期时间、枚举/下拉、人员、关联对象、附件、编码。设计器控件类型为：编码、文本输入、多行文本、数值输入、选择控件、日期时间、附件上传、开关切换、只读展示。

### 3.2 命名与上限

- 字段名必须匹配 `^[a-z][a-z0-9_]*$`（`core/identifiers.py` 的 `assert_safe_identifier`），同一表单内唯一（已归档字段也占用名称），重复返回 409。
- 每张表单最多 200 个未归档字段（`field_limits.DEFAULT_FORM_FIELDS`），新增或取消归档超出时返回 422。
- 默认字节上限：`string`、`code`、`person`、`enum` 为 1024，`text` 为 65536，`json` 为 1 MiB；`string`、`text`、`enum`、`code` 可通过 `validation.maxBytes` 设置 1 到 1073741823 字节。单条记录不超过 2 MiB。
- 物理表中新增的列都允许为空。字段没有“允许为空”“唯一约束”“索引”这类存储层属性；必填和唯一由规则在写入时校验（见第 5 节），`searchable`、`sortable` 不建索引。

### 3.3 新增、修改、归档

- 新增（`form_fields.add_form_fields`）：先锁定表单行，再对整批字段做名称、类型、上限校验，全部通过后才写元数据，物理表单随后加列。AI 新增字段时传 `sync_layouts=True`，把字段追加到列表和表单布局；界面新增不改布局。
- 修改（`update_form_field`）：改为必填时，如果已有记录缺值返回 409；修改类型、选项或校验时，如果已有记录不兼容返回 409。兼容的类型修改会被接受，但不改变物理列类型。
- 归档（`archive_form_field`）：只把 `archived` 置为 `true` 并返回影响统计，物理列和历史数据保留。运行期字段来自发布快照，所以归档在下一次发布后才对运行页生效。

前端「字段结构」面板中的「删除字段」调用归档接口。字段编码仅在新增字段时输入，首次保存后只读且可复制。新增编码以小写字母开头，允许小写字母、数字和下划线，最多 63 个字符。字段更新接口没有字段编码的更新项。字段类型可选择，存储大小按类型显示为只读；已有字段可保留既有的字节上限，改类型时使用新类型的默认值。

## 4. 布局、视图与设计器配置

### 4.1 布局

`form_layouts.upsert_form_layout` 按 `layout_type` 新建或整体替换一行布局配置，要求管理员；读取只要求表单 `view` 权限。`append_field_to_layouts` 把新字段追加到 `list` 布局的列和 `form` 布局中。

### 4.2 设计器控件

设计器保存草稿时，控件写入 `config.formDesignerControls`，不改 `form_fields`。发布时，`form_definition._apply_designer_field_settings` 把控件设置合并进快照中的字段：

- 标签、占位提示、帮助文字、规则（显示、必填、只读、唯一、脱敏、复制等）、类型设置、计算公式、默认值规则、编码规则、赋值规则。
- 控件类型；静态选项解析后写入 `enum_values`。
- 选项来源：`masterData`、`businessForm`、`organization` 转为 `relation_config.target_model`，`dictionary`、`externalApi` 转为对应的来源配置；赋值规则中来源为 `record.*` 的项转为关联回填 `backfill`。
- 必填同时考虑上级容器的显示规则：容器隐藏时字段不必填。
- 存在视图列配置时，`visible_in_list` 和 `sortable` 由已启用的视图列决定。

因此字段元数据（`form_fields`）保存的是结构，设计器设置只在发布快照中与之合并；保存草稿不会影响运行页。

### 4.3 列表视图

列表视图配置保存在 `viewConfigDraft`，发布时提升为 `viewConfig`。视图可以有多个页签（`tabs`），每个页签有列、筛选、默认排序和可见范围 `audience`（角色、用户、组织）。运行期 `form_view_tabs.runtime_view_config` 按用户筛选可见页签，并去掉用户无权查看的字段对应的列、筛选和默认排序。视图只是展示裁剪，记录与字段权限仍由记录服务判定。

已绑定组件页面的表单，列表、筛选和权限主要在组件页面中配置，见[低代码平台](platform.md#6-组件页面)。

### 4.4 动作与按钮

`form_actions` 支持增删改查，新建表单时预置四个动作，但当前没有运行期代码读取这张表：记录接口不检查它，前端只在 `services/api.ts` 中定义了调用函数而没有使用。运行页的按钮由以下几项决定：

- `GET /forms/{id}` 返回的 `runtime_permissions`（`view`、`create`、`edit`、`delete`、`import`、`export`、`configure`、`approve`、`saveDraft`、`submit`），其中 `saveDraft`、`submit` 来自设计器角色权限中的动作开关。
- 视图和组件页面中的工具栏、行操作配置。

## 5. 规则、默认值、计算与校验

规则在服务端统一求值，页面预览、AI 和每一次记录写入使用同一套代码（`form_rules.evaluate`）：

- 显示、必填、只读（`form_rules.states`）：控件规则可以带条件或条件组（组内全部满足、组间任一满足），支持 `equals`、`notEquals`、`isEmpty`、`notEmpty`、`contains`、`in`、`notIn`、`gt`、`gte`、`lt`、`lte`。隐藏的字段不必填；自动生成的编码字段、计算字段和只读控件不可编辑。
- 关联选项（`archive_options`）：内置档案白名单为设备、产线、用户、组织、角色、物料、供应商；其他来源按表单编码解析为业务表单，并按当前用户对该表单的行和字段权限读取。字典和外部接口来源由 `form_option_sources` 提供，外部接口只读、最多 1000 个选项、响应不超过 2 MiB。
- 默认值（`form_defaults`）：固定值或按规则拼接，只在新建时预填，不覆盖已填写内容。
- 计算（`form_calculations`）：受限的公式语言，支持四则运算、文本拼接和 `IF`、`ROUND`、`ABS`、`MIN`、`MAX`、`COALESCE`，不执行任意代码。
- 控件校验（`form_control_validation`）：选择数量、文本格式等；设计错误在发布时作为阻断项返回。
- 唯一校验（`field_uniqueness`）：唯一规则可以限定在本表单、跨表单（`global`）或按组合字段（`compound`）；写入和发布前都会检查，并用租户级锁串行化。
- 附件（`form_files`）：按字段规则检查扩展名和大小，只能通过已鉴权的接口下载。

规则预览接口有两类：运行期 `POST /forms/{id}/rules/evaluate` 只要求登录和表单的新建或编辑权限；设计器的 `rules/preview`、选项预览和选项搜索预览要求管理员，可以对尚未保存的控件求值。

## 6. 自动编码

编码字段的规则保存在 `ui_config.encodingRule`（设计器中的控件规则在发布时覆盖到快照）。`form_engine/encoding.py` 负责渲染：

- 分段规则：固定文本、日期、流水号、字段取值；每段有长度和补位方式（左补零、右补零、截断）。超出长度且不截断时返回 422。
- 条件规则：`rules` 中可以配置多条带条件的子规则，写入时必须恰好命中一条，同时命中多条或一条都不命中都返回 422。
- 重置周期：按日、月、年、不重置，或按依赖字段取值（`dependency`）分别计数。
- 旧式模板：`template` 中的 `{yyyyMMdd}`、`{date}`、`{seq}` 占位符。
- 生成方式为手动或允许手动覆盖时，编码字段可以由用户填写。

流水号由 `form_engine/sequences.py` 在 `form_code_sequences` 中原子分配，物理表的编码列另有唯一索引，见[低代码平台](platform.md#44-引擎模块)。

## 7. 权限

表单权限有两个来源：

- 通过 `/forms/{id}/permissions` 直接维护的 `form_permissions` 行，保存后立即生效。
- 设计器“权限设计”页签中的角色配置，草稿保存在 `permissionDesignDraft`，发布时由 `designer_permissions.sync_published` 写成 `form_permissions` 行并复制为 `permissionDesign`。其中的数据范围、归属限制、字段隐藏与脱敏、统计权限、`saveDraft`/`submit` 开关由服务层直接读取。

两者与 `role_permissions`、应用表单绑定兜底一起参与判定，判定顺序、数据范围和字段投影见[身份与权限体系](../permissions.md#8-表单权限)。

## 8. 发布与版本

### 8.1 发布预检

`form_versions.preview_form_publish` 生成影响报告而不写入。报告对比上一个发布快照和当前草稿快照，并扫描全部已有记录：

| 级别 | 类型 |
| --- | --- |
| 阻断 | 类型修改与已有值不兼容、已有字段改为必填而已有记录缺值、枚举收窄而已有记录使用了被删除的选项、控件配置错误 |
| 警告 | 已归档或移除的字段仍有历史值 |
| 信息 | 新增字段 |

“控件配置错误”汇总了控件设计错误、字段脱敏与复制策略错误、关联来源不可用、已有记录违反唯一规则，以及分析表单的看板设计、共享指标和来源字段错误。

### 8.2 发布

`form_versions.publish_form`：

1. 取租户级锁。设计器提交了流程草稿 ID 时，在同一事务中更新流程定义、版本快照及触发绑定。生成影响报告，有阻断项时返回 409 并回滚发布。
2. 把 `viewConfigDraft`、`permissionDesignDraft`、`analyticsDesignDraft` 提升为生效配置，写入 `publishedSchemaVersion` 和 `publishedAt`。
3. 同步设计器角色权限到 `form_permissions`，再把同步后的权限行写入快照。
4. 写入新的 `form_versions` 行（快照包括表单、合并后的字段、布局、动作、权限和流程绑定），把表单状态置为 `published`。

发布不提交任何业务记录。哪些配置要等发布、哪些立即生效，见[低代码平台](platform.md#3-配置与运行的分离)。

### 8.3 版本与恢复

- 版本列表和单个版本只要求表单 `view` 权限，单个版本返回完整快照和当时的影响报告。
- 恢复草稿（`POST /forms/{id}/draft/restore`，可指定版本号，默认最新版本）把快照中的字段属性写回 `form_fields`（快照里缺少的字段会补建元数据），整体替换同类型布局，并把快照中的生效配置作为新的草稿配置，同时清除 `workflowDesigner.draftWorkflowId`。快照之后新增的字段保留。恢复不改变表单状态、业务记录、流程绑定和 `form_permissions`，也不新增物理列。

## 9. 流程绑定与审批

### 9.1 绑定

`workflow_bindings` 把表单的触发动作（通常是 `submit`，料号申请为 `manual_submit`）连到流程定义。绑定和流程定义都必须属于当前租户；保存后立即作用于之后的提交。表单设计器“流程与审批”页签发布时，先把流程定义保存为已发布、写入或更新各触发动作的绑定，再调用表单发布。

记录创建或提交时，`form_workflow_start._start_form_workflows` 读取当前启用的绑定；流程定义不是已发布状态时返回 409。条件路由在流程启动时确定执行路径，并行和汇聚网关被 `workflow_routing.py` 拒绝；当前审批节点的字段策略会收窄记录可见字段，见[身份与权限体系](../permissions.md#94-字段可见与可编辑)。

### 9.2 申请生命周期

表单存在启用的 `submit` 绑定时（料号申请与告警中心除外），新记录只能保存为草稿（需要 `saveDraft` 动作），之后通过 `POST /forms/{id}/records/{record_id}/submit` 提交审批，`expected_status` 必须是 `draft` 或 `rejected`。有申请历史的记录只能由创建人（或管理员）在草稿、驳回状态下修改，状态只能由提交和审批操作改变（`form_application_lifecycle.guard_edit`）。

### 9.3 固定审批设置

`GET/PUT /forms/{id}/approval-settings`（`api/form_approvals.py`，要求管理员）提供不依赖流程设计器的固定顺序审批：最多 20 个节点，每个节点 1 到 100 名本租户有效用户，模式为单人或会签。服务（`form_approval_config`）生成 `domainCode` 为 `form-approval:<表单ID>` 的已发布流程定义和绑定，修改时递增流程版本并写快照，不影响在途实例。表单已有设计器流程或与其他表单共享的流程时，需要显式 `replace_existing` 才会替换；分析表单和归档表单不能配置。

对 `form-approval:<表单ID>` 流程中审批进行中的记录，`_protect_pending_form_record` 拒绝修改和删除。

前端组件 `components/FormApprovalSettings` 调用这组接口，但当前没有页面引用它；设计器的“流程与审批”页签在读取旧的线性步骤时会在内存中转换为流程图。

## 10. 业务记录运行期

所有记录读写都经过 `services/records.py`，写入顺序、读取投影、列表的 SQL 下推与内存路径见[低代码平台](platform.md#5-业务记录边界)。表单相关的补充：

- 运行期字段来自最新发布快照（`form_runtime._runtime_form_fields`）；从未发布的表单直接使用 `form_fields`。
- 两种存储由同一组函数处理：物理表走 `INSERT ... RETURNING`、`UPDATE` 语句，JSON 存储走 `DynamicRecord` ORM。
- 删除是软删除：物理表写 `deleted_at`，JSON 记录同样写 `deleted_at`。料号申请记录不能通过通用表单接口删除。
- 导入（`form_imports`）要求表单已发布，且用户同时有 `import` 和 `create` 权限；支持 CSV/XLSX，文件不超过 5 MiB、500 行、100 列；按字段名或标签自动映射，排除只读、自动生成和回填字段；用 `request_key` 保证同一次导入只执行一次。
- 导出（`GET /forms/{id}/records-export`）要求 `export` 权限，按页导出当前用户可见的行和字段，输出带 BOM 的 CSV。

## 11. 分析表单

`config.assemblyKind`（或 `kind`、`type`）为 `analysis`、`analytics`、`dashboard`、`report`、`bi_report`、`metric_dashboard`、`list_analysis` 之一的表单是分析表单（`form_engine/naming._is_analysis_form_config`）：

- 物理表使用 `analysis_` 前缀。
- 看板设计保存在 `analyticsDesignDraft`，发布时提升为 `analyticsDesign`。表单发布时校验看板设计、共享指标引用和来源字段。
- 看板编辑器通过 `/dashboard/programs/{program_id}/analytics/*` 单独保存和发布看板，用 `expectedRevision` 做并发检查；首次发布仍需先完成一次表单发布。看板由看板编辑器接管后，`PUT /forms/{id}` 不能再修改看板配置。
- 不能配置固定审批设置。
- AI 创建分析表单时保持草稿，不自动发布。

分析表单可从「业务数据」进入组件页面配置看板。由既有看板编辑器管理的运行看板仍可从 `/program/<编码>?edit=1` 编辑。

## 12. 复制与删除

复制（`form_admin.copy_form`，要求管理员）：新编码必须符合编码规则且租户内唯一。目标表单固定为物理表存储、草稿状态、当前用户为负责人，并立即建表；复制字段、布局、动作和 `form_permissions` 行，不复制业务记录、发布版本和流程绑定。`config` 整体深拷贝，只去掉 `publishedSchemaVersion`、`publishedAt` 并把 `viewConfigMeta` 重置为草稿。

删除（`form_admin.delete_form`，要求管理员）：

- 只允许 `draft` 状态，否则返回 409。
- 表单存在任何应用绑定（`application_forms`）或菜单节点时返回 409。
- 删除通过 ORM 级联删除字段、布局、动作、权限、版本、流程绑定、应用绑定和 `dynamic_records` 中的记录，不检查是否已有记录；物理表不会被删除。

## 13. AI 工具

AI 工具的通用权限、确认与注册表机制见[低代码平台](platform.md#7-ai-工具入口)和 [AI Agent 技能与工具契约](../ai/skill-contract.md)。与表单相关、已在代码中注册处理器的工具：

| 工具 | 实现 |
| --- | --- |
| `forms.preview_publish`、`forms.list_versions`、`forms.get_version`、`forms.get_layouts`、`forms.evaluate_rules` | `form_configuration_tools.execute_form_configuration_tool`，只读，要求管理员 |
| `forms.update_field`、`forms.archive_field`、`forms.save_layout`、`forms.publish`、`forms.restore_draft`、`forms.update_definition`、`forms.copy`、`forms.delete` | `FORM_DESIGN_TOOLS` 白名单映射到 `form_fields`、`form_layouts`、`form_versions`、`form_admin`，要求管理员 |
| `forms.{list,create,update,delete}_{actions,permissions,workflow_bindings}` | 同上，映射到 `form_admin` |
| `forms.create_form_definition`、`forms.add_form_field` | `low_code_tools`：创建表单（物理表、批量字段、布局、可选应用绑定与菜单，业务表单首次发布）和追加字段（同步布局） |
| `forms.publish_to_menu` | `form_menu_tools`，把表单挂到应用菜单 |
| `forms.query_records`、`forms.get_record`、`forms.update_record`、`forms.create_dynamic_record_draft` | 通过 `services/records.py` 读写记录或生成记录草稿 |

设计写入工具的请求模型禁止额外字段，资源 ID 和请求体分别校验。设计器页面联动工具 `ui.form_designer`（`page_controls.py`）只操作浏览器中的未保存草稿，创建新表单需要用户在“确认创建草稿”时确认，不会自动发布。

## 14. 前端页面

### 14.1 入口

- “应用配置 → 应用与菜单”（`/studio/applications`）和“业务数据”（`/studio/business-data`）由 `AppMenuManagement.tsx` 实现：左侧为表单列表，右侧为表单属性和“字段结构”面板（`AssemblyPropertyPanels.tsx` 的 `FieldStructurePanel`，列为字段名称、字段编码、类型、大小（字节））。表单的生命周期按钮按状态显示：草稿为“保存草稿”“发布”“删除草稿”；已发布为“保存变更”“发布更新”和“更多操作”中的“复制为草稿”“停用”；已停用为“保存配置”“启用”，“启用”等同于再次发布。
- 表单设计器 `FormSettingsPage`（`pages/FormSettings/index.tsx`）支持组件页面的「录入」「流程」，见[低代码平台](platform.md#62-与表单的绑定)。原权限管理入口 `/form-settings/:formId?tab=permission` 单独打开权限配置。其他历史设计地址会跳转到 `/studio/business-data/:formId/design` 的对应界面。AI 新建的未保存草稿在业务数据的新建界面使用同一表单画布，保存后打开对应的「录入」页签。

「录入」页签的左侧包含「添加控件」和「表单字段」。点击未使用的字段即可将其添加到画布。字段新增和归档在「字段结构」面板完成。首次确认 AI 新建表单草稿时，系统会批量创建草稿中的字段。

### 14.2 保存与发布流程

- “保存草稿”：写入设计器控件、视图草稿、默认值修改，并把流程保存为草稿定义；不影响运行页。
- “发布”：保存草稿后直接提交发布请求。配置了流程时，表单版本、流程定义和触发绑定在同一事务中生效。发布失败时提示服务端返回的原因。
- “版本管理”（嵌入时为“数据源版本管理”，`VersionManager.tsx`）：显示工作草稿状态，提供“保存草稿”“检查并发布”“用线上配置重置草稿”；发布记录中每个版本可查看“表单字段”“版本变更”“发布时检查”，并可“恢复到草稿”。版本比较在前端用两份快照计算（`versionUtils.ts`）。

“应用与菜单”中的“发布”会在业务表单没有字段时提示“草稿已保存，请先进入设计添加字段，再发布”并停止；设计器和表单发布接口允许发布无字段的表单。

### 14.3 子模块

0.3.22 把设计器的画布、视图设计和属性面板从 `index.tsx` 拆到同目录模块，`index.tsx` 仍持有状态和保存、发布逻辑（约 3700 行）：

| 模块 | 内容 |
| --- | --- |
| `CanvasStage.tsx` | 画布控件、容器与表格属性、试填预览 |
| `PropertyPanels.tsx` | 控件属性：基本信息、显示、数据来源、编码规则、类型设置（文本、数值、选择、日期、上传、布尔）、填写规则、默认值、计算、赋值与搜索设置 |
| `DataViewDesigner.tsx` | “数据筛选”页签的筛选区和数据列表区 |
| `ViewTabsEditor.tsx` | 视图页签与可见范围 |
| `ProfessionalFlowDesigner.tsx`、`flowGeometry.ts`、`workflowConfig.ts` | 流程图设计、节点校验、旧线性步骤转换、视图与布局载荷 |
| `AnalyticsDesigners.tsx` | 分析表单的看板、数据集、筛选与样式设计 |
| `VersionManager.tsx`、`versionUtils.ts` | 版本管理 |
| `designerConfig.tsx`、`designerOptions.ts`、`designerTypes.ts` | 内置配置、页签定义、选项常量与类型 |
| `fieldModel.tsx`、`fieldBusinessType.ts`、`platformFields.ts`、`encodingRules.ts` | 控件与字段模型、平台字段转换、编码规则编辑 |
| `permissionDrafts.ts`、`previewPermissions.ts`、`nativeDraft.ts` | 角色权限草稿、预览权限、AI 原生草稿转换 |

业务人员如何使用这些页面见[业务表单使用指南](../../guides/low-code/business-form-guide.md)。

## 15. 已知限制

- 记录读写不检查表单状态。`services/records.py` 的 `create_record`、`update_record`、`delete_record`、`get_record`、`list_records` 只校验租户和权限，停用（`disabled`）或草稿表单的记录仍可被有权限的调用方直接读写；停用只通过菜单、工作台和组件页面宿主检查让入口消失。
- 删除草稿表单时级联删除其 `dynamic_records`，且不检查是否已有记录；物理表单的物理表留在数据库中，没有清理或归档流程。
- 后端不要求表单至少有一个字段：`POST /forms`（不带 `designer_draft` 时）和发布都不检查。唯一的前端检查在“应用与菜单”的发布按钮中，表单设计器的发布不检查。
- 字段类型变更必须与已有记录兼容。物理表中的字段还要求新类型与现有存储列兼容。
- `PUT /forms/{id}` 不校验状态流转，也可以修改 `storage_mode`、`table_name` 而不迁移数据。
- `form_actions` 只有元数据，运行期不读取。
- 设计器发布时先写流程定义和绑定再发布表单；表单发布若在服务端被拒绝，流程侧的修改已经生效。
- 复制表单时 `config` 中的 `componentPageCode`、`workflowDesigner` 等引用被原样带到副本，副本会引用源表单的组件页面和流程定义 ID。
- 版本快照（含权限行和完整配置）对有表单 `view` 权限的普通用户可读。

## 16. 测试

| 测试 | 覆盖内容 |
| --- | --- |
| `tests/test_form_shared_services.py` | 两种存储下 HTTP 与 AI 的字段一致性、整批拒绝、字段上限、租户边界、注册表分发、AI 创建 |
| `tests/test_forms_platform.py`、`tests/test_form_lifecycle_integration.py` | 表单平台接口、发布与申请生命周期 |
| `tests/test_form_rules.py`、`tests/test_form_calculations.py`、`tests/test_form_defaults.py`、`tests/test_form_control_validation.py` | 规则、计算、默认值、控件校验 |
| `tests/test_conditional_encoding_rules.py` | 条件编码规则 |
| `tests/test_form_approval_config.py`、`tests/test_business_form_approvals.py` | 固定审批设置与业务表单审批 |
| `tests/test_form_sources_imports.py`、`tests/test_form_view_tabs.py` | 选项来源与导入、视图页签 |
| `tests/test_ai_form_design_tools.py`、`tests/test_ai_form_menu_tools.py` | AI 表单设计与挂菜单工具 |
| `tests/test_record_service.py` | 记录边界 |

运行方式见[测试说明](../../operations/testing.md)。
