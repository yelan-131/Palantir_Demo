# AI 技能与工具契约

更新日期：2026-11-17（对应代码版本 0.3.22 草稿）

本文说明 AI 技能与工具的定义方式、注册表的校验与生命周期、当前工具与技能清单、技能版本与 `platform.skills.read`、权限判定、写操作的确认与幂等规则、确认令牌存储，以及页面联动工具与数据库处理器的区别。这里只记录代码中实际执行的规则。
运行时如何启动 Harness、如何按需加载工具见 [DeepSeek Harness 运行时](harness-runtime.md)；能力分类与入口见 [AI 能力概览](README.md)。

## 1. 概念

| 概念 | 含义 | 代码位置 |
| --- | --- | --- |
| 工具（Tool） | 模型可以调用的一个平台操作，有参数结构、副作用类型、风险等级和所需能力 | `services/ai/tool_registry.py` 的 `ToolDefinition` |
| 处理器（Handler） | 工具背后真正执行的函数，按 `handler_key` 绑定，调用业务服务 | `services/ai/tool_handlers.py` 的 `TOOL_HANDLERS` |
| 技能（Skill） | 给模型的操作说明，描述某类任务应按什么步骤使用哪些工具；技能本身不执行任何操作 | `services/ai/skills.py` 的 `SkillDefinition` |
| 注册表 | 每个租户的技能与工具定义集合 | `services/ai/agent_registry.py` |

模型只能调用工具；技能只影响模型“怎么做”，权限、校验和确认都按工具执行。

## 2. 注册表

### 2.1 存储与来源

- 每个租户的定义保存在 `ai_agent_skill_definitions` 和 `ai_agent_tool_definitions` 两张表中，按 `tenant_id` 隔离。初始化标记保存在 `system_settings` 中：租户 1 的键是 `ai.agent_registry`，其他租户是 `ai.agent_registry:{tenant_id}`。
- 租户既没有初始化标记也没有任何定义行时，使用 `data/agent_registry/skills.json`、`tools.json` 种子，再合并平台定义的页面、应用与菜单、组件画布和流程设计工具。
- 只含后端的镜像没有 `data/` 目录，使用打包副本 `services/ai/assets/`。修改种子后运行 `scripts/sync_ai_assets.py` 同步副本（同时同步 `.agent/agent.md` 和 `.agent/action-contracts.md`）；当前副本与种子一致。
- `0034_ai_agent_registry_tables` 建表，`0042_agent_registry_tenants` 将注册表改为按租户隔离。后续迁移为已有租户增量安装内置工具，`0049_workflow_design_ai` 安装流程设计技能和四个工具。SQLite 在启动时增量安装。
- 增量脚本：仓库根目录的 `scripts/register_form_design_tools.py`、`scripts/register_form_menu_tools.py`、`scripts/upgrade_harness_registry.py`，以及 `backend/scripts/upgrade_dashboard_ai_registry.py`。

读取时，停用的工具会被去掉，技能的 `allowed_tools` 和 `default_tool` 中指向停用工具的项也被去掉。已保存的平台内置工具在读取时总是使用当前代码中的参数结构（`_refresh_stored_input_schemas`），避免数据库中的旧结构与处理器不一致。

### 2.2 管理接口

`GET /ai/agent-registry`、`PUT /ai/agent-registry`、`POST /ai/agent-registry/seed`、`POST /ai/agent-registry/parse-skill`、`GET /ai/agent-registry/skill-instructions/{name}` 都只允许管理员调用，界面在 AI 设置的“工具与技能”页签。`PUT` 提交的是完整注册表：不在提交内容中的定义会被删除。保存后立即生效，没有单独的发布步骤。`GET /ai/skills` 与 `GET /ai/tools` 供普通用户查看当前可用的技能和工具。

保存时在 PostgreSQL 上持有按租户的咨询锁，SQLite 上先开启写事务，防止并发保存互相覆盖。

### 2.3 保存时的校验

`validate_registry_payload` 在保存和加载时都会执行：

- 名称不能为空或重复。
- 工具的 `handler_key` 必须是已注册的处理器（未填写时等于工具名）。
- 应用与菜单工具、页面工具、画布工具必须使用与工具同名的内置处理器，其参数结构、副作用类型、所需能力、业务域等字段由平台定义，不能修改。
- 任何工具都不能改变其处理器基准定义的副作用类型和所需能力，也不能把风险等级调低。
- 技能的 `default_tool` 和 `allowed_tools` 必须指向注册表中存在的工具。

`_validate_registry_transition` 校验状态变化：

- 删除技能或工具前，必须先把它保存为停用状态。
- 处理器为 `not_implemented` 的工具不能启用。
- 启用技能时，它的 `default_tool` 和全部 `allowed_tools` 都必须已启用且有实现的处理器。只修改已启用技能的标题、说明或正文时不重复检查。
- 从种子导入时不做以上状态检查。

## 3. 工具定义

| 字段 | 说明 |
| --- | --- |
| `name`、`title`、`description` | 逻辑名、标题、给模型看的说明 |
| `handler_key` | 绑定的处理器 |
| `side_effect` | `read`、`draft_write`、`record_write`、`workflow_action`、`external_write`、`configuration_write` 之一 |
| `risk_level` | `low`、`medium`、`high`、`critical` |
| `permission_check` | 所需的 AI 能力，例如 `qa`、`rag`、`business_query`、`save_draft`、`config`、`workflow` |
| `domain` | 业务域，可为空 |
| `input_schema` | 参数结构；种子中的简写（如 `"string"`）会被规范化为 JSON Schema |
| `output_schema`、`dry_run_supported`、`audit_required` | 描述性字段，运行时不据此改变行为 |

参数在两处校验：调用时由 `agent_validation_service.validate_tool_payload` 按 `input_schema` 检查类型、枚举和必填项（写工具的参数不能为空；新建表单和加字段还会校验字段规则）；执行时处理器用自己的 Pydantic 模型再校验一次。

## 4. 工具清单

工具来自 `data/agent_registry/tools.json` 和平台代码中的内置定义。租户可按需停用已注册的工具。

### 4.1 只读工具

| 工具 | 所需能力 | 说明 |
| --- | --- | --- |
| `knowledge.search` | `rag` | 知识检索，返回证据 |
| `forms.query_records`、`forms.get_record` | `business_query` | 查询业务记录，按表单、字段权限和数据范围过滤 |
| `platform.form_settings.query`、`platform.application_settings.query`、`platform.identity_settings.query` | `config` | 查询表单、应用与菜单、身份配置，由 `platform.query` 处理器实现。应用设置和角色目录查询要求管理员。表单查询只返回用户可见的字段。角色目录接受 `subject=roles`，可按名称或编码精确查找并返回角色 ID。 |
| `ai.semantic_plan_low_code_form` | `qa` | 根据描述生成表单规划建议 |
| `forms.preview_publish`、`forms.list_versions`、`forms.get_version`、`forms.get_layouts`、`forms.evaluate_rules` | `config` | 表单发布检查、版本、布局与规则试算 |
| `forms.list_actions`、`forms.list_permissions`、`forms.list_workflow_bindings` | `config` | 读取表单动作、权限、流程绑定 |
| `forms.get_workflow_design`、`forms.validate_workflow_design` | `config` | 读取表单流程和当前版本，校验起止事件、触发入口、审批、抄送、条件分支和注释成员 |
| `dashboards.preview_source`、`dashboards.get` | `config` | 看板来源预览与编辑配置读取，处理器要求管理员 |
| `dashboards.query` | `qa` | 查询已发布看板的数据 |
| `pages.list`、`pages.query` | `qa` | 列出页面、查询已发布页面数据 |
| `pages.get` | `config` | 读取页面草稿与修订号，要求管理员 |

### 4.2 写工具（确认后执行）

| 工具 | 副作用 | 说明 |
| --- | --- | --- |
| `forms.create_dynamic_record_draft` | `draft_write`，风险中 | 在目标表单中新增一条 `draft` 状态的记录，需要对该表单有新增权限 |
| `forms.update_record` | `record_write`，风险高 | 修改已有记录的指定字段 |
| `forms.create_form_definition`、`forms.add_form_field` | `configuration_write`，风险高 | 新建表单草稿、加字段 |
| `forms.update_field`、`forms.archive_field`、`forms.save_layout`、`forms.publish`、`forms.restore_draft`、`forms.update_definition`、`forms.copy`、`forms.delete` | 同上 | 表单设计操作，处理器要求管理员 |
| `forms.save_workflow_draft`、`forms.publish_workflow_draft` | 同上 | 保存完整的流程设计，或发布已复核的流程草稿及当前表单配置。两步分别确认并校验版本 |
| `forms.create_actions`、`forms.update_actions`、`forms.delete_actions` 及 `_permissions`、`_workflow_bindings` 的对应工具 | 同上 | 表单动作、权限、流程绑定的增改删 |
| `forms.publish_to_menu` | 同上 | 发布表单（如需要）并挂到应用菜单 |
| `dashboards.create`、`dashboards.save_draft`、`dashboards.publish` | 同上 | 新建看板草稿（绑定已有业务表单为来源）、保存、发布 |
| `pages.create`、`pages.save_draft`、`pages.publish` | 同上 | 组件页面写入，要求管理员 |
| `applications.create`、`.update`、`.publish`、`.disable`、`.enable`、`.delete` | 同上 | 应用管理，要求管理员 |
| `menus.create_group`、`.create_entry`、`.update_entry`、`.reorder`、`.delete_entry` | 同上 | 菜单管理，要求管理员 |

### 4.3 页面联动工具

| 工具 | 说明 |
| --- | --- |
| `ui.form_designer` | 在浏览器的表单设计器中搭建或调整本地草稿，不在注册表中，由运行时按条件提供 |
| `ui.component_page.inspect`、`.add`、`.update_properties`、`.update_appearance`、`.set_interaction` | 读取或修改当前组件页面画布的本地草稿；`inspect` 为只读，其余为 `draft_write`、风险低、所需能力 `config`、业务域 `low-code` |

### 4.4 未实现的工具

以下工具在种子中有定义，但处理器为 `not_implemented`，不能启用，也不会出现在模型可见的工具列表中（未实现）：`knowledge.ingest_document`、`knowledge.convert_to_markdown`、`knowledge.chunk_markdown`、`knowledge.embed_chunks`、`knowledge.extract_ontology_candidates`、`knowledge.approve_ontology_candidates`、`knowledge.commit_ontology_to_graph`、`workflow.start`、`notifications.create`、`inventory.get_stock`、`quality.get_event`、`graph.query_impact`。

## 5. 技能

### 5.1 技能定义

| 字段 | 说明 |
| --- | --- |
| `name`、`title`、`description` | 名称、标题、说明 |
| `instructions` | 技能正文，最多 30000 个字符；为空时读取内置 `SKILL.md` 的 Markdown 正文 |
| `source_markdown` | 从 SKILL.md 导入时保留的原文 |
| `model_invocable`、`user_invocable` | 模型能否自动使用、用户能否主动调用 |
| `capability_level` | `qa`、`assisted`、`agentic`，用于界面分类 |
| `permission_capability`、`domain`、`risk_level` | 判断当前用户能否看到这个技能 |
| `default_tool`、`allowed_tools` | 技能涉及的工具，只在保存和启用时校验存在与启用状态 |
| `confirmation_policy`、`required_permissions`、`output_schema` | 描述性字段，运行时不读取 |

技能目录对用户的可见性：知识中心对话不提供技能；其余情况下，技能需要有正文（数据库正文或打包正文），并且按它的 `permission_capability`、`domain`、`risk_level` 通过角色 AI 策略判定。

导入 `SKILL.md`（`POST /ai/agent-registry/parse-skill`，`skill_import.parse_skill_markdown`）接受单个 Markdown 文件。YAML 元数据须包含 `name`（1–64 个小写字母、数字或单连字符）和 `description`（1–1024 个字符）。兼容已有文档的 `disable-model-invocation`、`user-invocable` 开关。导入原文仍会保存，有效的 `license`、`compatibility` 与 `metadata` 会保留到 Harness 的技能文件。导入的 `allowed-tools` 不改变平台工具权限。

### 5.2 内置技能与版本

内置技能位于 `backend/app/services/ai/business_skills/<技能名>/SKILL.md`，按 [Agent Skills 格式规范](https://agentskills.io/specification) 编写。目录名与 YAML 的 `name` 一致。内部注册表 ID 由 `metadata.manufoundry-registry-id` 对应，技能目录和 `platform.skills.read` 返回包的 `metadata.version`。

| 技能 | 版本 | 打包正文 |
| --- | --- | --- |
| `low_code.create_form_definition` | 1.1.0 | `low-code-create-form-definition/SKILL.md` |
| `low_code.manage_component_page` | 1.0.0 | `low-code-manage-component-page/SKILL.md` |
| `low_code.manage_application` | 1.0.0 | `low-code-manage-application/SKILL.md` |
| `low_code.manage_workflow_design` | 1.0.0 | `low-code-manage-workflow-design/SKILL.md` |
| `analysis.manage_dashboard` | 1.1.0 | `analysis-manage-dashboard/SKILL.md` |
| `analysis.query_dashboard` | 1.1.0 | `analysis-query-dashboard/SKILL.md` |
| `low_code.publish_form_to_menu` | 1.1.0 | `low-code-publish-form-to-menu/SKILL.md` |
| `workflow.submit_after_confirmation` | 1.0.1 | `workflow-submit-after-confirmation/SKILL.md` |
| 其余 12 个 | 1.0.0 | `<技能名>/SKILL.md` |

`workflow.submit_after_confirmation` 和其余 12 个打包技能属于 `NATIVE_ONLY_SKILLS`。`platform.skills.read` 可读取上表的七个设计和查询技能，以及数据库中填写了正文的技能。

其中 `knowledge.ingest_for_rag`、`knowledge.intake_document_ontology`、`workflow.submit_after_confirmation` 的默认工具是未实现的工具。内置注册表中它们默认启用，可能出现在技能目录中，但无法完成实际操作；停用后再次启用会被第 2.3 节的规则拒绝。

数据库中的 `instructions` 优先于打包正文。技能投放到 Harness 的方式见[运行时文档](harness-runtime.md#5-技能投放)。

## 6. `platform.skills.read`

只在 `AI_HARNESS_NATIVE_SKILLS=false` 时向模型开放（默认使用原生技能，不开放）。规则：

- 参数只接受 `name`，不接受路径；技能正文来自固定映射或数据库，模型不能读取任意文件。
- 只能读取当前技能目录中的技能，否则返回“技能不存在、已停用或当前用户不可访问”。读取表单搭建技能时还要求用户有表单设计器权限。
- 原生技能模式或知识中心对话中调用会被拒绝。
- 返回技能名、版本、正文的 SHA-256 摘要和正文；同时在本轮执行步骤中记录一条“已读取业务技能”，包含名称、版本和摘要。

原生技能模式下，平台不记录模型读取了哪些技能。

## 7. 权限判定

### 7.1 AI 能力判定

`policies.decide_ai_permission(user, settings, capability, domain, risk_level)` 按顺序检查：

1. 平台 AI 总开关 `aiEnabled`；全局执行模式 `agentMode` 为 `off` 时全部拒绝。
2. `rag` 能力要求知识检索开启；`qa`、`rag`、`business_query`、`report` 要求 `qaEnabled`；`draft`、`save_draft`、`workflow`、`config` 要求 `assistEnabled`，且全局执行模式不能是 `readonly`。
3. 名称命中 `FORBIDDEN_SKILLS`（`purchase.create_purchase_order`、`security.change_permission`、`data.delete_record`、`supply.auto_order`）或 `forbiddenActions` 时拒绝。
4. 只有在没有配置任何角色策略时，管理员才直接按风险策略放行。
5. 否则逐个匹配用户角色名对应的角色策略：能力在策略的 `capabilities` 中、业务域在策略的 `domains` 中（策略未限定业务域时不检查），且角色执行模式不是 `off`（`readonly` 时不能使用写类能力）。匹配到即按风险策略决定是否需要确认；都不匹配则拒绝。

用户角色每次请求都从数据库重新读取（`identity_context.resolve_ai_identity`）；管理员账号视为 `admin` 角色。默认角色策略（`settings.DEFAULT_ROLE_POLICIES`）：

| 角色 | 能力 | 业务域 | 角色执行模式 |
| --- | --- | --- | --- |
| `admin` | `qa`、`rag`、`business_query`、`report`、`draft`、`save_draft`、`workflow`、`config` | 生产、质量、维护、供应链、流程、`low-code` | `save_after_confirm` |
| `production_manager` | 除 `config` 外全部 | 生产、维护、流程 | `save_after_confirm` |
| `quality_engineer`、`maintenance_manager`、`supply_chain_manager` | `qa`、`rag`、`business_query`、`report`、`draft`、`save_draft` | 各自业务域 | `save_after_confirm` |
| `viewer` | `qa`、`rag`、`report` | 生产、质量、维护、供应链 | `readonly` |

默认风险策略：低风险直接执行，中风险需要确认，高风险需要确认并审计，`critical` 禁止。

### 7.2 工具判定

`policies.decide_tool_permission` 是模型可见工具列表、每次工具调用、确认卡片生成、配置卡片修改和确认后执行共用的判定：

1. 工具必须已注册。应用与菜单工具要求管理员身份。
2. 业务域取工具的 `domain`；为空时，所需能力为 `config` 的工具视为 `low-code`，为 `workflow` 的视为 `workflow`；`knowledge`、`analysis`、`dynamic-form` 不参与业务域检查。
3. 按工具的 `permission_check` 做第 7.1 节的能力判定。
4. 按 `forbiddenActions` 检查工具名和处理器名，见第 7.3 节。
5. 非只读工具：全局执行模式和用户各角色的执行模式中只要有 `readonly` 或 `off` 就拒绝；有 `draft` 时只允许 `draft_write` 工具。通过后一律标记为需要确认。
6. 最后由 `PermissionResolver` 按规则判定：先查拒绝规则，再查“需要确认”规则，最后查允许规则。默认规则拒绝 `FORBIDDEN_SKILLS`，高风险及以上需要确认，`knowledge.*` 和 `platform.*` 允许；`safetyPolicy.permissionRules` 中的规则追加在后面，可按工具名、角色、业务域、风险阈值匹配。

全局执行模式默认是 `draft`，所以默认设置下只有 `draft_write` 工具可用，其余写工具需要管理员把执行模式改为 `confirm`。

### 7.3 `forbiddenActions`

`forbiddenActions` 默认为 `auto_order`、`delete_data`、`change_permission`。每一项可以是具体工具名，也可以是以下类别（`policies.action_is_forbidden`）：

| 类别 | 匹配的工具名 |
| --- | --- |
| `auto_order` | `*.auto_order`、`*.create_purchase_order` |
| `delete_data` | `*.delete_*`、`*.delete`、`*.remove_record` |
| `change_permission` | `*.change_permission*`、`*.grant_permission*`、`*.revoke_permission*` |
| `publish_config` | 所有 `configuration_write` 工具 |

因此默认设置下 `forms.delete`、`forms.delete_actions`、`forms.delete_permissions`、`forms.delete_workflow_bindings`、`applications.delete`、`menus.delete_entry` 都被禁用。需要使用时，管理员要从 `forbiddenActions` 中移除 `delete_data`。

## 8. 写操作与确认

### 8.1 调用时只准备，不执行

模型调用非只读工具（或判定为需要确认的工具）时，`PlatformBridge._call_platform_tool` 依次：

1. `forms.update_record`：先读取原记录，检查字段存在、用户对这些字段有查看和修改权限、填写规则通过，并记下待改字段的原值（`expected_values`）。
2. 按参数结构校验（`validate_tool_payload`），不通过则把错误返回给模型。
3. 应用、菜单、页面和流程设计写工具在 `prepare=True` 时只做校验和配置快照摘要。流程设计使用 `_workflow_design_snapshot`，确认执行时会复核草稿版本。`forms.publish_to_menu` 的准备阶段检查表单发布状态和菜单位置。
4. 把动作加入本轮待确认列表，载荷中带上 `_contract.tool` 和 `_harness_tool`（工具名），相同载荷不重复加入；返回 `waiting_confirmation`，模型据此结束本轮。

### 8.2 生成确认卡片

运行结束后，`ai_assistant.create_agent_run` 对全部待确认动作调用 `agent_validation_service.validate_confirmation` 再校验一次，并生成确认载荷：令牌格式为 `confirm-` 加 24 位十六进制，有效期 30 分钟，绑定当前用户和租户。令牌写入进程内的 `CONFIRMATIONS`（最多 2000 条）；持久化的运行同时把确认载荷保存在 `ai_agent_runs` 行中。

### 8.3 修改“新建表单”卡片

`POST /ai/agent-runs/{run_id}/configuration-review`（`configuration_review.py`）只支持 `forms.create_form_definition` 动作，只能修改表单名称、字段名称和是否必填，不接受其他参数、工具名或内部字段。要求运行已持久化、仍在等待确认、令牌有效且未过期；修改后重新做权限判定和参数校验，生成新令牌，旧令牌失效。

### 8.4 确认

`POST /ai/agent-runs/{run_id}/confirm` 与 `/confirm/stream`：

1. 持久化的运行由 `run_recovery.claim_confirmation` 处理：对该行加锁，核对令牌和所有者（不一致按不存在处理），检查是否过期，再用条件更新把状态从 `waiting_confirmation` 改为 `confirmed`。更新行数不为 1 时返回 409。因为令牌与行一起保存，后端重启后仍可在有效期内确认。
2. 已结束（`completed`、`failed`）的运行直接返回原结果。状态已是 `confirmed` 时，如果是单个记录写入且已有执行回执，补记为完成并返回；否则返回 409，提示不要重复创建相同操作。
3. 未持久化的运行使用进程内的 `confirm_agent_run` 和 `consume_confirmation_token`。
4. `tool_executor.execute_confirmed_run` 逐个执行动作。每个动作经 `tool_execution_envelope.execute_callable` 重新做工具权限判定并限制超时（`toolTimeoutSeconds`，限制在 1–600 秒），再由 `dispatch_tool_handler` 调用处理器。第一个失败的动作之后不再继续，整体状态记为失败。
5. 执行结果和 `execution-snapshot` 追加到运行记录（`run_recovery.merge_execution_items`）。确认写入在独立任务中执行，浏览器断开不会中断。

`confirmed=false` 或 `POST /ai/agent-runs/{run_id}/cancel` 取消运行，只有 `waiting_confirmation` 状态可以取消，否则返回 409。

### 8.5 执行时的防覆盖与幂等

| 工具 | 规则 |
| --- | --- |
| 应用、菜单、页面写工具 | 确认载荷必须带配置快照，缺少时返回 409“缺少操作的确认快照”；执行时重新计算快照，与准备时不同则返回 409，要求重新发起 |
| 页面写工具 | 另外按 `expected_revision` 比对页面修订号，不一致返回 409；不允许新增独立的 `record-filter` 组件 |
| `dashboards.save_draft`、`dashboards.publish` | 按看板修订号比对，不一致返回 409 |
| `forms.publish_to_menu` | 菜单位置或表单发布状态与准备时不同则返回 409 |
| `forms.update_record` | 在同一事务中锁定记录，重新检查字段权限，待改字段的当前值与准备时的原值不同则返回 409 |
| `forms.update_record`、`forms.create_dynamic_record_draft` | 执行时带上运行 ID 和动作序号；写入与执行回执在同一事务中提交，同一动作再次执行时直接返回回执中的结果 |

## 9. 确认令牌存储

`services/ai/confirmation_store.py` 定义了 `ConfirmationStore` 接口，以及内存实现 `InMemoryConfirmationStore` 和数据库实现 `DatabaseConfirmationStore`（`ai_confirmation_tokens` 表，用条件更新保证只消费一次）。安全设置 `persistConfirmations`（默认 `false`）决定 `confirmations.py` 中异步接口（`async_create_confirmation_payload` 等）使用哪种实现。

这些异步接口只被 `tests/legacy_agent/tool_use_loop.py` 和测试使用。当前应用的确认流程使用同步的进程内 `CONFIRMATIONS` 加上 `ai_agent_runs` 行的条件更新（第 8.4 节），不读写 `ai_confirmation_tokens`，`persistConfirmations` 对它没有影响。

## 10. 页面联动工具与数据库处理器

| 方面 | 数据库处理器工具 | 页面联动工具（`ui.form_designer`、`ui.component_page.*`） |
| --- | --- | --- |
| 执行位置 | 后端处理器调用业务服务 | 浏览器中当前页面注册的控制器，后端只转发指令并等待回执 |
| 写入结果 | 确认后写入数据库 | 只改页面上未保存的草稿，用户在页面上保存后才经页面自己的接口写入 |
| 确认卡片 | 有 | 没有；表单设计器草稿完成后由浮窗提示用户检查并保存 |
| 可用条件 | 第 7 节的权限判定 | 管理员；浏览器声明支持页面联动；画布工具还要求当前打开组件页面。`ui.component_page.*` 仍经过 `decide_tool_permission`，`ui.form_designer` 经过 `designer_permission_error`（`config` 能力、`low-code` 业务域、管理员、规则未拒绝） |
| 注册表 | 在注册表中，绑定各自的业务处理器 | 画布工具在注册表中，处理器是 `browser_required`，被后端直接调用时只返回“请在目标业务页面的 AI 助手中调用”；`ui.form_designer` 不在注册表中 |

浏览器回执的通道与超时见[运行时文档](harness-runtime.md#43-页面联动的回执通道)。

## 11. 新增工具或技能时的要求

以下规则由代码强制执行，新增时需要满足：

- 工具必须有已注册的处理器，处理器只调用业务服务（例如 `services/records.py`、`services/form_fields.py`），不自己写 SQL 或建表语句；业务服务内部的权限检查不能省略。
- 写工具的 `side_effect` 不能是 `read`。运行时只看副作用类型决定是否确认，标错类型会绕过确认。
- 需要防覆盖的写工具应提供 `prepare` 阶段并在执行时比对快照或修订号，参照第 8.5 节。
- 应用、菜单、页面、画布工具的契约由平台代码定义，在注册表中只能启用、停用。
- 修改内置种子后运行 `scripts/sync_ai_assets.py`；已部署租户的注册表不会自动更新，需要迁移或增量脚本补装。
- 后端开发约定见[后端开发指南](../../development/backend.md)。

相关测试：`test_ai_registry_tenants.py`、`test_ai_registry_lifecycle.py`、`test_ai_skill_loading.py`、`test_ai_configuration.py`、`test_ai_configuration_review.py`、`test_ai_configuration_completion.py`、`test_confirmation_store.py`、`test_ai_form_design_tools.py`、`test_ai_form_menu_tools.py`、`test_ai_dashboard_tools.py`、`test_ai_application_admin_tools.py`、`test_ai_menu_admin_tools.py`、`test_ai_application_menu_integration.py`、`test_ai_page_controls.py`、`test_ai_component_page_controls.py`，均在 `backend/tests/` 下。

## 12. 边界与未实现

- 技能的 `allowed_tools` 只在保存和启用时校验，运行时不限制模型在使用某个技能时只调用这些工具（`tool_registry.validate_tool_call` 未被调用）。
- 待确认动作的 `skill` 字段记录的是工具名，不记录模型依据的技能，所以确认记录无法追溯到技能及其版本。
- 原生技能模式下不记录技能读取。
- 确认令牌的进程内副本不跨进程共享，未持久化的运行在重启或多 worker 下无法确认。
- 依赖未实现工具的技能（知识导入、本体抽取、提交审批）无法完成实际操作（未实现）。
