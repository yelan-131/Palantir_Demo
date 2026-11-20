# AI 能力概览

更新日期：2026-11-17（对应代码版本 0.3.22 草稿）

本文是 AI 部分的入口，说明当前代码已经实现的 AI 能力、界面与接口入口、写操作的确认流程、主要约束，以及 AI 运行时仍依赖的演示与静态数据。
运行时内部机制见 [DeepSeek Harness 运行时](harness-runtime.md)，技能、工具、权限与确认的具体规则见 [AI 技能与工具契约](skill-contract.md)。AIP 风格的产品愿景放在 [AIP 智能层设计](../../design/palantir/aip-intelligence-layer.md)，不代表已实现。

## 1. 组成与文档分工

AI 是业务服务之上的一层适配：模型通过 DeepSeek Harness 运行，只能经平台提供的工具读写数据，工具再调用与页面相同的业务服务。AI 不另写一套业务校验，也不直接执行 SQL。

| 文档 | 内容 |
| --- | --- |
| 本文 | 能力分类、入口、确认流程概要、约束、静态数据依赖、未实现项 |
| [DeepSeek Harness 运行时](harness-runtime.md) | SDK 依赖与补丁、一次运行的处理过程、请求级 MCP 桥、工具按需加载、技能投放、模型配置与 DeepSeek 上限、会话与运行记录存储、部署约束 |
| [AI 技能与工具契约](skill-contract.md) | 注册表结构与生命周期、工具与技能清单、技能版本、`platform.skills.read`、权限判定、确认与幂等、确认令牌存储、页面工具与数据库处理器的区别 |

代码位置：后端运行时与工具在 `backend/app/services/ai/`，HTTP 入口在 `backend/app/api/ai_assistant.py`、`backend/app/api/ai_harness.py`、`backend/app/api/ai_builder.py` 和 `backend/app/api/knowledge.py`（知识中心对话）；前端浮窗在 `frontend/src/components/AiChatWidget/`，AI 设置在 `frontend/src/pages/AccountCenter/`。

## 2. 已实现的能力

下表按能力类别列出代码中真实可用的工具。工具名称和处理器以注册表为准，完整清单见[契约文档的工具清单](skill-contract.md#4-工具清单)。“确认后执行”表示模型调用时只生成待确认卡片，用户确认后才写入。“所需能力”指角色 AI 策略中的能力项，默认角色策略见[契约第 7 节](skill-contract.md#7-权限判定)。

| 类别 | 主要工具 | 写入方式 | 所需能力与前提 |
| --- | --- | --- | --- |
| 知识问答 | `knowledge.search` | 只读 | `rag`；检索方式见[知识库](../knowledge/knowledge-base.md) |
| 业务数据读取 | `forms.query_records`、`forms.get_record`、`pages.query`、`dashboards.query` | 只读，仍按表单权限、字段权限和数据范围过滤 | `business_query`（记录）或 `qa`（页面与看板数据） |
| 平台配置读取 | `platform.form_settings.query`、`platform.application_settings.query`、`platform.identity_settings.query`、`forms.preview_publish`、`forms.list_versions` 等 | 只读 | `config`，默认只有管理员角色具备；应用设置查询还要求管理员身份 |
| 业务记录草稿 | `forms.create_dynamic_record_draft` | 确认后写成目标表单的一条 `draft` 状态记录 | `save_draft`，且对目标表单有新增权限 |
| 修改业务记录 | `forms.update_record` | 确认后执行 | `save_draft`，对目标记录和字段有修改权限；需要全局执行模式为“确认后执行” |
| 业务单据草稿 | 技能 `quality.create_capa_draft`、`maintenance.create_work_order_draft`、`supply.create_purchase_request_draft`、`material.create_material_application_draft`、`forms.create_record_draft` | 技能只是给模型的操作说明，最终都调用 `forms.create_dynamic_record_draft` 生成表单草稿记录，不提交审批 | 同“业务记录草稿”；调用参数必须给出目标表单编码，否则确认执行时报“请选择可创建草稿的业务表单” |
| 表单配置 | `forms.create_form_definition`、`forms.add_form_field`、`forms.update_field`、`forms.save_layout`、`forms.publish`、`forms.publish_to_menu`，以及动作、权限、流程绑定的增删改 | 确认后执行 | `config` 与 `low-code` 业务域，处理器另要求管理员；需要“确认后执行”模式 |
| 表单设计器联动 | `ui.form_designer` | 只改浏览器中当前设计器的本地草稿，由用户保存 | 管理员，`low-code` 业务域，且浮窗连接了可操控的设计器页面 |
| 看板 | `dashboards.preview_source`、`dashboards.create`、`dashboards.get`、`dashboards.save_draft`、`dashboards.publish` | 预览与读取只读，其余确认后执行 | `config`，处理器要求管理员；写入需要“确认后执行”模式 |
| 组件页面 | `pages.list`、`pages.get`、`pages.create`、`pages.save_draft`、`pages.publish` | 写入确认后执行，按修订号防止覆盖 | `pages.list`、`pages.query` 只需 `qa`；其余需要 `config`、`low-code` 业务域和管理员身份；写入需要“确认后执行”模式 |
| 组件页面画布联动 | `ui.component_page.inspect`、`.add`、`.update_properties`、`.update_appearance`、`.set_interaction` | 只改浏览器中当前画布的本地草稿，由用户点“保存草稿” | 管理员，且浮窗连接了当前打开的组件页面编辑器 |
| 应用与菜单 | `applications.create`、`.update`、`.publish`、`.disable`、`.enable`、`.delete`，`menus.create_group`、`.create_entry`、`.update_entry`、`.reorder`、`.delete_entry` | 确认后执行，确认时校验配置快照 | 管理员身份、`config`、`low-code` 业务域；需要“确认后执行”模式；删除类工具默认被安全策略禁用 |
| 模型与页面建议 | `/ai-builder/suggest-model`、`/ai-builder/suggest-page` | 只返回建议，不保存 | 登录用户 |

全局执行模式（“执行与安全”页签中的“Agent 执行模式”，设置项 `agentMode`）默认是“仅生成草稿”（`draft`）。在这个模式下，只有草稿类工具（`forms.create_dynamic_record_draft` 和画布联动工具）可以使用，修改记录、表单配置、看板、页面、应用与菜单等写工具都会被拒绝，并且不会出现在模型可见的工具列表中。管理员需要把执行模式改为“确认后执行”（`confirm`）才能使用这些能力。

几点说明：

- “模型与页面建议”是按关键词匹配的固定字段模板（`backend/app/api/ai_builder.py`），不调用模型，也不经过 Harness。
- 注册表中还有若干没有处理器的占位工具（例如 `workflow.start`、`notifications.create`、`inventory.get_stock`、`knowledge.ingest_document`），它们的处理器是 `not_implemented`，不会出现在模型可见的工具列表中，详见第 8 节。
- 如果配置请求缺少关键参数、无法生成确认卡片，模型会调用 `platform.report_configuration_status` 报告“需要补充信息”或“被阻止”，这个工具本身不写任何数据。

## 3. 入口

### 3.1 界面入口

| 入口 | 位置 | 说明 |
| --- | --- | --- |
| AI 助手浮窗 | 工作区右下角，`frontend/src/components/AiChatWidget/` | 主要入口。会话、流式回答、确认卡片、页面联动都在这里；在表单设计器和组件页面编辑器中会把当前页面状态作为上下文传给后端 |
| 知识中心对话 | 数据中心的知识库页面，`frontend/src/pages/SystemAdmin/KnowledgeCenter.tsx` | 针对当前文档提问，只开放 `knowledge.*` 工具 |
| AI 与平台设置 | `/admin/ai`（仅管理员） | 平台管理员可配置模型服务、模型用途和全局执行策略。平台 AI 总开关在「模型服务」。租户管理员进入「工具与技能」管理当前租户的注册表。 |
| 模型与页面建议 | `/admin/ai-builder`（仅管理员） | 调用 `/ai-builder/*` 获取字段模板建议 |

`frontend/src/pages/AIAssistant/index.tsx` 仍在仓库中，但没有被任何路由引用；访问 `/ai-assistant` 会重定向到首页。

### 3.2 接口入口

全部 AI 接口挂在 `/api/v1/ai`、`/api/v1/ai-builder` 和 `/api/v1/knowledge/agent/*` 下，完整列表见 [API 参考](../../development/api-reference.md) 的 `ai`、`ai-builder`、`knowledge` 三节。常用接口：

| 接口 | 用途 |
| --- | --- |
| `POST /ai/agent/stream` | 浮窗使用的主接口，以服务端事件（SSE）返回执行过程和最终回答 |
| `POST /ai/agent-runs/{run_id}/confirm/stream`、`/confirm` | 确认或拒绝待确认操作 |
| `POST /ai/agent-runs/{run_id}/cancel` | 取消待确认操作 |
| `POST /ai/agent-runs/{run_id}/configuration-review` | 确认前修改“新建表单”卡片中的表单名称、字段名称和是否必填 |
| `POST /ai/page-actions/{action_id}/result` | 浏览器回传页面联动操作的执行回执 |
| `/ai/agent/conversations/*` | 浮窗会话的创建、列表、消息、改名、关闭 |
| `PUT /ai/settings`、`POST /ai/settings/test`、`POST /ai/provider/test` | 平台管理员可保存全局 AI 设置或测试模型服务。 |
| `GET /ai/settings`、`POST /ai/settings/effective` | 管理员可读取脱敏设置及预览生效参数。 |
| `/ai/agent-registry*` | 管理员可管理当前租户的技能和工具。 |
| `POST /ai/harness/mcp` | Harness 子进程回调平台工具的入口，不接受用户令牌，见[运行时文档](harness-runtime.md#4-请求级-mcp-桥) |

`POST /ai/chat`、`/ai/analyze`、`/ai/agent`、`/ai/agent-runs` 是同一运行时的非流式兼容入口，浮窗不使用。其中只有带 `conversation_id` 调用的 `/ai/agent` 与 `/ai/agent/stream` 会把本轮写入数据库；`/ai/agent-runs` 的运行记录只保存在进程内存中。

## 4. 一次对话的处理过程

1. 后端从数据库重新读取当前用户的角色（`identity_context.py`），并检查平台 AI 开关和角色 AI 策略是否允许问答。
2. 如果请求带有会话 ID，读取该会话最近 8 条消息和上一轮未完成的配置草稿。
3. `agent_context_router.py` 按关键词把请求归为普通对话、页面帮助、知识检索、业务查询、起草动作等类别：前三类使用“对话”用途的模型，其余使用“推理”用途的模型；业务查询类请求还会先检查 `business_query` 能力，并预先读取相关的语义对象作为上下文。
4. `HarnessRuntime` 启动 DeepSeek Harness，模型通过请求级 MCP 桥调用平台工具。只读工具直接执行并返回结果；非只读工具只生成待确认动作。
5. 运行结束后，后端对每个待确认动作再做一次权限判定和参数校验，生成确认令牌和确认卡片，返回给前端。
6. 如果开启了审计（`auditEnabled`，默认开启）且请求带会话 ID，本轮的用户消息、助手回答和运行记录写入 `ai_conversations`、`ai_messages`、`ai_agent_runs`。

各步骤的实现细节见[运行时文档](harness-runtime.md#3-一次运行的处理过程)。

浮窗运行中展开「执行过程」，结束后先显示回答。新工具调用和结果共享 `tool_call_id`，每次操作标记为 Tools。成功读取已注册技能后记录 Skills。历史事件在相邻且归属明确时也可合并。展开单行可查看工具名、失败原因和支持的结果预览，预览最多列出 6 项。

「执行说明」根据记录到的工具和技能事件生成。DeepSeek 等模型经 Harness 以公开 `reasoning` 块返回的文本走独立的 `harness.reasoning` 事件，经凭据遮蔽后显示在本轮的「模型推理」。这类文本随当前对话流显示。平台历史记录保留工具结果和技能事件。

## 5. 确认与执行

所有非只读工具都遵循同一条规则：模型调用时不写入，只生成确认卡片；用户确认后，后端重新校验并调用业务服务执行。

1. 浮窗展示确认卡片，列出将要执行的操作和参数摘要。对“新建表单”卡片，用户可以直接修改表单名称、字段名称和必填项，后端会重新校验并换发新的确认令牌，旧标签页里的确认请求随之失效。
2. 用户点击确认后，后端核对令牌属于当前用户、未过期（30 分钟），并用数据库条件更新把运行状态从“等待确认”改为“已确认”，保证同一操作只执行一次。
3. 执行前重新做权限判定；应用、菜单、组件页面类操作还会比对确认时生成的配置快照，配置已经变化则拒绝执行并提示重新发起。
4. 执行结果写回运行记录。浮窗收到成功回执后，AI 在原对话中继续处理最初的请求。新写入会另生成确认卡片。同一确认请求重复提交时直接返回已有结果。
5. 用户也可以拒绝或取消，运行状态改为“已取消”。

页面联动工具是例外：`ui.form_designer` 和 `ui.component_page.*` 不生成确认卡片，只修改浏览器中尚未保存的草稿，最终由用户在设计器里保存。表单设计器草稿完成后，浮窗会显示“确认创建”卡片，用户确认后由前端调用设计器自身的保存逻辑；如果草稿指定了目标菜单，后端随后直接准备一张 `forms.publish_to_menu` 确认卡片，这一步不再调用模型。

令牌、快照、回执和并发控制的具体规则见[契约文档第 8 节](skill-contract.md#8-写操作与确认)。

## 6. 主要约束

- 权限继承：AI 只能读写当前用户本身有权访问的数据。工具处理器内部仍调用表单权限、字段权限、数据范围检查，以及 `ensure_admin` 等服务层校验。
- 角色 AI 策略与执行模式：每个角色有可用能力、业务域和角色执行模式，平台另有全局执行模式；两者中任一为只读或关闭时，所有写工具都不可用。默认值和判定顺序见[契约第 7 节](skill-contract.md#7-权限判定)。
- 默认禁止的操作：安全设置 `forbiddenActions` 默认包含自动下单、删除数据、修改权限三类，按工具名匹配。因此 `forms.delete`、`applications.delete`、`menus.delete_entry` 以及表单动作、权限、流程绑定的删除工具，在默认设置下都不可用。
- 模型输出不等于授权：模型回复“已确认”或“已完成”不会触发写入；工具结果和文档内容在提示词中都被标注为数据，不作为权限依据。
- 只开放平台工具：Harness 的终端、文件系统、MCP 资源等原生工具都已禁用，模型只能看到平台 MCP 桥提供的工具。
- 敏感信息：安全设置 `sensitiveMasking` 默认开启，发往模型的用户消息、上下文、技能列表、工具结果以及模型回答都会遮蔽密钥、令牌、密码类内容；模型凭据加密保存，接口返回时显示为 `********`。

## 7. 仍依赖的演示与静态数据

下列演示或静态数据仍被 AI 相关代码使用。新的运行时代码不应再引入业务静态数据；描述行为、上限和安全回退的工程默认值可以保留在代码中。

| 位置 | 内容 | 对 AI 的影响 |
| --- | --- | --- |
| `backend/app/services/ai/dynamic_record_drafts.py` 的 `SKILL_FORM_CANDIDATES` | 按技能名猜测目标表单编码，例如工单对应 `work-order`、`maintenance-order`，物料申请只对应 `material-application`，CAPA 对应 `capa`、`quality-event` | 只在没有 Harness 工具标记的旧式技能动作中使用（`tool_executor.py`），找不到表单时改存 `ai_drafts`。当前运行时生成的待确认动作都带工具标记，走 `forms.create_dynamic_record_draft` 处理器，不使用这张表 |
| `backend/app/api/knowledge.py` 的 `KNOWLEDGE_SPACES`、`KNOWLEDGE_DIRECTORIES`、`DEMO_KNOWLEDGE_DOCUMENT_ORDER` | 写死的知识空间、目录树和演示文档排序 | 知识中心的空间与目录不是数据库数据 |
| `backend/app/services/knowledge_retrieval.py` 的 `KNOWLEDGE_SOURCES`、`KNOWLEDGE_DOCUMENTS`、`KNOWLEDGE_CHUNKS` | 内置的演示知识文档与分块 | 只有设置环境变量 `PALANTIR_ENABLE_STATIC_KNOWLEDGE_RUNTIME=true` 时才参与检索，默认关闭 |
| `backend/app/services/ai/demo_knowledge_seed.py` | 生成 Word、Excel、PDF 演示知识资产并写入知识索引 | 只由 `scripts/seed_data.py` 和 `scripts/seed_demo_knowledge.py` 显式调用，见[演示知识资产](../../operations/demo-knowledge-assets.md) |
| `backend/app/api/ai_builder.py` | 设备、工单、供应商、质检、人员五类关键词与字段模板 | “模型与页面建议”的全部输出都来自这些模板 |
| `backend/app/api/ai_assistant.py` 的 `INTENT_RESPONSES` 与 `handle_*_query` | 早期按关键词回答 OEE、设备、产量问题的函数 | 已不在请求链路中，只有 `tests/test_ai_assistant.py` 测试 `detect_intent` |
| `backend/app/services/ai/settings.py` | 角色策略、风险策略、上下文、知识检索、安全、Harness 参数的默认值 | 属于工程默认值；保存过 AI 设置后以数据库中的值为准 |
| `.agent/agent.md` | 系统提示词（只读取其中“System Prompt”一节） | 每次运行都会加载；`.agent/action-contracts.md` 只被测试读取，`.agent/skills.md` 与 `.agent/tools.md` 不被代码读取 |

## 8. 边界与未实现

已实现但有限制：

- 平台“记忆”已停用：保存设置时会强制关闭记忆收集和平台会话摘要，后台每小时的清理任务也不再删除数据。历史记忆条目仍可由本人通过 `/ai/memories` 查看和删除。
- 开启 AI 审计后，表单记录查询成功与权限拦截写入平台 `audit_logs`。管理员在「审计与日志」选择「AI 助手」查看本租户的发起人、结果和原因。`GET /ai/audit` 也从本租户的平台审计读取。日志记录执行元数据，用户提示词、模型回答和记录内容不写入这类条目。
- 问答完成、确认、取消、配置卡片修改、草稿保存等运行事件仍写入进程内的环形缓冲区（最多 2000 条，`services/ai/audit.py`），重启后丢失。确认后由业务服务执行的写入，按业务服务自身的规则记录审计。
- 知识检索没有语义能力（哈希伪向量加英文词面打分，中文查询排序基本随机，见[知识库](../knowledge/knowledge-base.md)），AI 设置中不能选择远程向量模型。
- 后端必须以单进程单 worker 运行，原因见[运行时部署约束](harness-runtime.md#9-部署约束)。

尚未实现：

- 提交审批流程（`workflow.start`）、发送通知（`notifications.create`）、库存与质量事件查询（`inventory.get_stock`、`quality.get_event`）、图谱影响分析（`graph.query_impact`）、通过 AI 导入和切分知识文档（`knowledge.ingest_document` 等）：注册表中有定义，处理器为 `not_implemented`（未实现）。
- 定时巡检、主动预警、按规则自动执行等主动式 AI（未实现）。
- 对外部系统（ERP、MES 等）的写入（未实现）。

## 9. 相关文档

- [DeepSeek Harness 运行时](harness-runtime.md)
- [AI 技能与工具契约](skill-contract.md)
- [权限体系](../permissions.md)
- [数据模型](../data-model.md)
- [知识库](../knowledge/knowledge-base.md)
- [表单管理](../low-code/forms.md)、[应用管理](../low-code/applications.md)
- [后端开发指南](../../development/backend.md)
