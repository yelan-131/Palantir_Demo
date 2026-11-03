# AI Agent Skill/Tool Contract

## 当前规范与代码审视（2026-11-03）

本节是当前 AI 架构规范。下文标为历史设计的内容保留用于追溯，不代表当前运行模式。
审视范围为本地工作区代码，不代表生产服务器已同步，也不证明真实模型的所有业务链路已验收。

### 1. 架构分工

主链路应为：用户请求 → 平台认证与上下文装配 → DSH → 按需读取 Skill → MCP Tool → 后端业务服务。
写入由平台准备可复核操作，用户确认后再校验权限和版本并执行，随后记录结果与审计。

- **DSH**：唯一的 Agent 调用循环，负责模型推理、选择工具和会话压缩。平台可实施超时、预算和取消控制，但不另建关键词业务规划循环与其竞争。
- **Skill**：面向任务的业务操作说明，描述适用场景、前置条件、步骤、所需 Tools、缺信息时的处理、完成标准及确认节点。一个 Skill 可组合多个 Tools，一个 Tool 可被多个 Skills 复用。
- **Tool**：边界清晰的可执行能力，参数 schema、返回结构、处理器、副作用和权限要求统一维护。业务规则由领域服务实施。
- **平台后端**：认证、租户和资源权限、参数校验、确认、幂等、超时、审计及持久化。Skill 和提示词不能代替这些检查。
- **前端设计器**：维护可编辑本地草稿并返回执行回执。页面成功不等于保存或发布成功。

### 2. 当前代码事实

- `runtime.py` 的 `AgentRuntime` 继承 `HarnessRuntime`；`orchestrator.py` 直接调用 `harness_runtime.run()`。主入口已经使用 DSH；`legacy_runtime.py`、`tool_use_loop.py` 的存在不代表当前入口同时启用了双循环。
- `agent_registry.py` 从数据库加载启用的注册项，校验后设置运行时缓存。`data/agent_registry/*.json` 是显式初始化种子，`backend/app/services/ai/assets/` 是打包副本；不能把三者描述成三个可独立编辑的运行时来源。
- `PlatformBridge.available_tools()` 过滤权限并生成 MCP 定义；`api/ai_harness.py` 的 `tools/list` 和 `tools/call` 提供模型调用边界。
- `skills.py` 的 `SkillDefinition` 保留数据库注册元数据。表单生成的正文已独立到 `form_design_skill.md`，由 `skill_loader.py` 提供版本和内容摘要，经 `platform.skills.read` 按需读取。系统提示仅提供用途目录，正文不提前注入。这是平台 MCP 适配，不是 DSH 原生技能目录集成；其他业务技能仍以注册元数据为主。
- `platform.skills.read` 是 Bridge 自带的只读协议工具，与页面工具类似，不冒充数据库业务 handler。技能名与正文文件采用后端固定映射，不接受模型提供文件路径；每次读取重新加载启用的注册项并检查用户策略。读取计入工具预算，返回 name/version/digest，运行项记录这些标识。已读取技能与已授权执行是不同状态，不能从加载记录推导工具授权。
- 普通只读工具进入 `ToolExecutionEnvelope`；写入先在 Bridge 生成待确认动作，确认后经 `tool_executor.py` 执行。`ui.form_designer` 走专门的页面回执路径，因此“全部调用经过同一 envelope”目前不准确。

### 3. 审视发现及整改优先级

**P1：业务流程迁移仅完成首个场景。** 建表与当前草稿调整的步骤已迁入按需正文，设计器 Tool description 已缩短；看板创建和更新记录等步骤仍分散在 `.agent/agent.md`、`harness_options()` 和工具描述中。新增业务场景应继续沿 Skill 正文扩展，避免重新扩大全局提示。

整改：先选建表或看板一个场景，补齐可版本化的 Skill 正文和按需读取入口；验证 DSH 确实读到了指定版本并执行步骤后，再迁移其他场景。接入 DSH 原生技能机制前须核实当前安装版本的实际接口，不能仅凭生成 SKILL.md 就宣称集成完成。

**P1：工具参数存在多处独立描述。** 注册表 `input_schema`、`to_openai_function()` 的专门补丁、`low_code_tools.py` 的参数说明及处理器校验需要对齐。此前系统提示还重复注入完整 action contracts，已在本地去掉这处注入；其他来源的一致性尚未全部解决。

整改：按 Tool 选定一个 schema 定义来源，MCP 和注册管理界面从其生成；业务校验继续由领域服务执行。种子及打包副本通过同步脚本生成，不独立手改。数据库配置的 schema 更新必须显式校验并迁移，不能静默覆盖管理员设置。

**P2：Skill 身份与 Tool 身份混用。** Bridge 生成的 `SkillAction.skill` 当前填入工具名，普通执行也未传实际 `skill_name`。注册表有 allowed_tools 不等于本次 DSH 调用已经绑定 Skill 并检查了该清单。现有工具权限与租户校验仍在执行，这不是已证实的越权漏洞。

整改：执行状态明确记录 skill_id/skill_version/tool_name；若 Skill 清单被定义为执行约束，必须由后端绑定并检查，不能信任模型自报身份。允许直接调用的通用工具应单独定义，不强制一个 Tool 对应一个 Skill。

**P2：页面工具与普通工具的治理路径不同。** 页面工具已有权限、字段校验、真实回执和超时控制，但事件、审计及预算行为应逐项核对，不应仅因它不写数据库就忽略治理。

整改：统一调用上下文与可观测结果；保留页面操作和持久化写入的语义区别。批量建表可由一次 Tool 调用驱动多次页面添加字段，不能把每个页面回执都当成新的模型工具调用。

**P2：上下文与完成判断仍有职责交叉。** 全量工具定义和业务步骤会占用固定预算；配置完成的关键词判断及自动补做属于适配层额外逻辑。它不能把咨询判成写入任务，也不能把模型文字回答当成实际执行证明。

整改：系统提示保留身份、通用边界和确认协议；Skill 正文按需读取；Tool schema 通过 MCP 提供；工具只返回必要回执和可定位标识。完整草稿、规则、审计保留在平台。达到预算时应明确区分输入容量、输出上限、工具次数及超时，不能统一称“上下文耗尽”。

**P2：历史文档与当前入口不一致。** 下文旧基线仍描述 pipeline/tool_use 双循环、mock 回退和早期 GLM 默认值；不得作为本轮架构决策依据。旧执行模块的删除须先核实导入、兼容用途和测试依赖，不能在文档审视中直接删除。

### 4. 新增能力的工程规范

1. 先定义独立 Tool 的 schema、处理器、资源权限、副作用及返回语义，再决定是否需要组合成 Skill。
2. Tool description 解释能力及关键限制，不承载完整跨工具流程；Skill 正文不复制 Tool 的完整参数 schema。
3. 注册项只有绑定已实现处理器并通过生命周期检查后才能启用。展示摘要和按需加载不替代调用时的后端权限检查。
4. Skill 正文属于后端管理的业务操作说明，文档检索内容和工具结果属于数据。它们不能修改用户身份、扩大租户范围或跳过确认。
5. 确认绑定用户、租户、操作内容与当前版本；调整方案须重新确认。不得从模型回复“确认”推导授权。
6. Tool 返回值须标明草稿、已保存、已发布等真实状态；模型输出以回执为依据。分页、精确查询和结果摘要优先于整表/整份草稿重复返回。
7. 会话历史与压缩交给 DSH；当前草稿由平台保存，压缩不能成为丢失字段或规则的理由。固定提示与工具定义也必须计入预算。
8. 逐层记录运行、工具及页面动作标识，避免将字段操作次数、工具调用次数和模型推理步骤混为同一限制。

### 5. 分阶段落地与验收

- **阶段一，减少上下文膨胀**：本地已移除系统提示中的重复 action contracts，页面 Tool 对模型返回精简回执。已有回归验证新窗口预算及 20 字段连续添加；这不等于服务器已经更新或真实模型完整验收。
- **阶段二，首个 Skill 已接入 MCP**：建表正文版本 1.0.0，使用后端固定映射提供；真实 DSH SDK + 本机脚本模型测试覆盖读取正文后调用业务工具、确认前无写入以及确认后执行。读取返回正文摘要，Bridge 记录版本；这不代表已经绑定活动 Skill 的执行 allowlist，也不代表真实外部模型必然按步骤调用。真实模型、浏览器及服务器验收仍需单独进行。正文修改不依赖修改全局系统提示。
- **阶段三，统一治理和 schema 来源**：对齐注册表、MCP、处理器、确认执行及页面路径；补上生命周期、权限、错误和版本冲突用例。
- **阶段四，清理历史兼容层**：根据依赖图和回归结果移除未使用路径，并更新架构文档与部署记录。

最低验收应包括：新会话直接完成 20 字段草稿；追加字段保留旧规则；失败字段停止后续步骤；只咨询不触发创建；确认前没有持久化写入；旧确认不能重放；跨租户与无权限调用被拒绝；历史增长或压缩后仍可继续处理草稿。真实模型、浏览器和服务器验证结果须分别记录，模拟测试不能替代它们。

---

## 历史设计（2026-05-29，以下为旧版基线与路线图）

Last updated: 2026-05-29

Status: scaffold implemented + roadmap. This document defines the intended
AI skill/tool contract and staged migration path. Current API entry points are
listed in the baseline section.

Version: v0.2

Scope: ManuFoundry system AI Agent architecture, skill/tool contracts, staged
delivery path, risk policy, confirmation strategy, and migration from demo mock
skills to real backend skills.

## 1. Purpose

This document turns the AI capability direction into an engineering contract.

`AI Capability Map` answers **what AI should eventually do**. This document answers **how an AI Agent is allowed to do it safely**:

- A **Skill** is a user-facing business capability, such as "create a material number application draft" or "analyze a quality event".
- A **Tool** is a backend callable operation used by a skill, such as searching knowledge, querying inventory, creating a dynamic record, starting workflow, or sending a notification.
- A **Policy** decides whether a tool call is read-only, draft-only, confirmed-write, admin-gated, or disallowed.
- A **Confirmation** records what the user reviewed before the system performs a business-effecting action.

The current implementation is mostly rule-based and mock-oriented. The target architecture keeps that demo surface useful while gradually replacing mock skills with permissioned backend skills.

## 2. Current Baseline

Current AI entry points:

| Area | Current module | Current behavior |
| --- | --- | --- |
| Chat assistant | `backend/app/api/ai_assistant.py` | Intent-like keyword routing with DB/mock fallback for OEE, equipment, production, quality, and supply-chain answers. |
| AI Builder | `backend/app/api/ai_builder.py` | Keyword-based model and page suggestions. |
| Knowledge base | `backend/app/api/knowledge.py` | Local TF-IDF retrieval over demo spaces, sources, documents, Markdown, chunks, cards, upload simulation, and binding candidates. |
| Frontend assistant | `frontend/src/pages/AIAssistant/index.tsx`, `frontend/src/components/AiChatWidget` | UI entry points for asking AI questions. |

Near-term work should preserve these APIs where possible and move orchestration behind them. Routers should remain thin; business logic belongs in `backend/app/services/ai/*` and existing domain services.

Current AI system settings are backend-owned. The frontend Account Center can
edit provider settings, but runtime provider selection and tests go through
`/api/v1/ai/settings`, `/api/v1/ai/settings/test`, and
`/api/v1/ai/provider/test`.

GLM is treated as an explicit provider (`provider = "glm"`) rather than a
generic OpenAI-compatible label. The first implementation can reuse the
OpenAI-compatible request shape, while keeping a separate provider name for
future GLM-specific authentication, model naming, embedding, and vision
behavior.

### 2.1 Implemented Scaffold

The first OpenClaw-style enterprise scaffold is now present in the backend:

| Layer | Module / API | Current scope |
| --- | --- | --- |
| Skill Registry | `backend/app/services/ai/skills.py`, `GET /api/v1/ai/skills` | Built-in enterprise skills with allowed tools, risk level, permissions, confirmation policy, and output shape. |
| Tool Registry | `backend/app/services/ai/tool_registry.py`, `GET /api/v1/ai/tools` | Typed tool contracts for knowledge search/ingestion, form drafts, workflow, notifications, inventory, quality event reads, and impact graph queries. |
| Agent Runtime | `backend/app/services/ai/orchestrator.py`, `POST /api/v1/ai/agent-runs` | Creates structured runs with steps, evidence, actions, risk level, and confirmation payloads. |
| Confirmation | `backend/app/services/ai/confirmations.py` | Server-generated confirmation tokens for write-like AI actions. |
| Agent Run State | `backend/app/services/ai/agent_runs.py` | In-memory lifecycle for the general AI assistant: create, fetch, confirm, cancel. |
| Intent Router | `backend/app/services/ai/intent_router.py` | Routes each turn into conversation, knowledge, business query, page help, or action preparation. |
| Action State | `backend/app/services/ai/action_state.py` | Maintains multi-turn slot filling for pending action preparation. |
| Action Payloads | `backend/app/services/ai/action_payloads.py` | Builds conservative action payloads from action contracts and collected slots. |
| Audit | `backend/app/services/ai/audit.py`, `GET /api/v1/ai/audit` | Shared in-memory AI audit helper used by agent and draft flows. |
| AI Draft Persistence | `backend/app/api/ai_assistant.py`, migration `0025_ai_drafts.py`, `GET /api/v1/ai/drafts` | Persists confirmed or saved Agent drafts by tenant/user/skill/payload/evidence/status. |
| Knowledge Agent Persistence | `backend/app/api/knowledge.py`, migration `0015_ai_agent_runtime.py` | Relational persistence for knowledge-center conversations, messages, runs, tool calls, and memory entries. |
| Knowledge Directories | `GET/POST/PUT /api/v1/knowledge/directories`, `POST /api/v1/knowledge/directories/{id}/move` | Demo directory tree API for the Obsidian-style knowledge page. |
| Low-Code Agent Tools | `backend/app/services/ai/planner.py`, `backend/app/services/ai/low_code_tools.py`, `backend/app/services/ai/dynamic_record_drafts.py` | Deterministic planning, confirmed admin-only form-definition creation, and confirmed domain draft creation into platform dynamic records when a matching form exists. |
| Model-Driven Tool Loop | `backend/app/services/ai/tool_use_loop.py`, safety policy `agentLoopMode` | Opt-in LLM function-calling loop: the model plans tool calls, read/analyze tools execute through the envelope, side-effect tools freeze into `FrozenContext` + confirmation token, `resume()` continues after explicit confirmation. Default stays `pipeline`. |

The legacy `/api/v1/ai/agent` endpoint remains compatible, but it now also
creates an observable `run_id` and returns `steps`, `risk_level`, and
`confirmation_payload` when a draft action is prepared.

Durability is currently split:

- `/api/v1/ai/agent-runs` uses the general Agent scaffold and is suitable for
  demo and contract iteration; persisted run rows are used when available for
  confirmation fallback and final-state synchronization.
- `/api/v1/ai/agent/conversations/*` stores general Agent conversations and
  memories for the floating assistant, including pending action state.
- `/api/v1/ai/drafts` stores saved or confirmed Agent drafts in `ai_drafts`
  with an in-memory fallback when the database is unavailable.
- `/api/v1/knowledge/agent/conversations/*` writes relational AI runtime rows
  for knowledge-center chat.

Before general-purpose agentic work is considered production-ready, remaining
in-memory fallback behavior should be moved behind the same database-backed
repository pattern.

## 3. Core Concepts

### 3.1 Skill

A skill is the contract the product exposes to users and agents. It describes intent, inputs, allowed tools, risk level, confirmation requirement, output shape, and audit needs.

Skill examples:

- `knowledge.answer_question`
- `quality.analyze_event`
- `quality.prepare_capa_draft`
- `supply_chain.prepare_purchase_request`
- `maintenance.prepare_work_order`
- `low_code.suggest_model`
- `low_code.save_model_draft`
- `workflow.submit_instance`

### 3.2 Tool

A tool is a backend operation callable by the AI orchestrator. A tool must be deterministic enough to validate and audit.

Tool examples:

- `knowledge.search`
- `knowledge.ingest_document`
- `knowledge.embed_chunks`
- `graph.query_impact`
- `inventory.get_stock`
- `quality.get_event`
- `forms.create_dynamic_record_draft`
- `workflow.start`
- `notifications.create`
- `rules.validate`
- `ai_builder.suggest_model`

The Agent never writes directly to the database from a prompt. It calls registered tools that enforce schemas, permissions, validation, idempotency, and audit.

### 3.3 Agent

An Agent is an orchestrated runtime that can classify intent, choose skills, call tools, prepare a plan, ask for confirmation, and execute approved actions.

Recommended runtime flow:

```text
User / Scheduler / Rule Trigger
  -> AI Orchestrator
  -> Intent classification
  -> Skill selection
  -> Context assembly
  -> Policy and permission check
  -> Tool call plan
  -> Dry run / draft result
  -> Confirmation gate when needed
  -> Tool execution
  -> Audit log
  -> User-visible result with evidence
```

LLM provider settings, including GLM system configuration, are backend-owned.
The Agent may request a model capability such as "chat", "summarize", or
"embed", but it must not accept a raw API key, arbitrary base URL, or unreviewed
system prompt from the browser.

### 3.3.1 Loop Modes

The runtime supports two scheduling modes selected by the
`safetyPolicy.agentLoopMode` setting:

| Mode | Module | Planner | Notes |
| --- | --- | --- | --- |
| `pipeline` (default) | `runtime._run_agent_loop` | Deterministic operation state machine (preflight -> intent -> retrieve -> prepare -> answer). LLM is used for semantic slot extraction and final answer only. | Stable demo behavior; works without tool-calling models. |
| `model` / `tool_use` | `tool_use_loop.ToolUseLoopRunner` | The LLM plans each turn via OpenAI-format function calling. | Requires a configured external provider; falls back to `pipeline` when unconfigured. |

Both modes share the same enforcement plane: every tool call flows through
`ToolExecutionEnvelope` (permission hooks, payload validation, confirmation
gating, timeout, audit), token usage is tracked by `BudgetTracker`, and one
`EventBus` per run carries `PRE_TOOL_USE` / `POST_TOOL_USE` / compaction /
budget events.

In `model` mode, side-effecting tool calls never execute inline: the loop
freezes the full conversation into a `FrozenContext`, issues a confirmation
token through the pluggable `ConfirmationStore` (atomic single-use consume),
and `AgentRuntime.resume_tool_use()` thaws the context after the user
confirms.

## 4. Skill Contract

Each skill should be registered with a structured definition.

```json
{
  "name": "quality.prepare_capa_draft",
  "version": "0.1.0",
  "description": "Prepare a CAPA draft from a quality event, evidence, and related objects.",
  "capability_level": "agentic",
  "risk_level": "medium",
  "default_mode": "draft",
  "allowed_triggers": ["user"],
  "required_permissions": [
    {"resource": "quality_event", "action": "view"},
    {"resource": "capa", "action": "create_draft"}
  ],
  "input_schema": "PrepareCapaDraftInput",
  "output_schema": "PrepareCapaDraftOutput",
  "allowed_tools": [
    "quality.get_event",
    "knowledge.search",
    "graph.query_impact",
    "forms.create_dynamic_record_draft"
  ],
  "confirmation": "required_before_write",
  "audit": "write_intent_and_result",
  "idempotency": {
    "required": true,
    "key_fields": ["skill_name", "quality_event_id", "target_form", "user_id"]
  }
}
```

Required skill fields:

| Field | Requirement |
| --- | --- |
| `name` | Stable dot-separated identifier. |
| `version` | Increment when input/output behavior changes. |
| `capability_level` | `qa`, `assisted`, `proactive`, or `agentic`. |
| `risk_level` | `low`, `medium`, `high`, or `critical`. |
| `default_mode` | `read`, `recommend`, `draft`, `confirmed_write`, or `admin_publish`. |
| `allowed_triggers` | `user`, `scheduler`, `rule`, or `system`. |
| `required_permissions` | Permissions checked against the current user or service principal. |
| `input_schema` | Pydantic model or equivalent JSON schema. |
| `output_schema` | Structured result returned to frontend and audit. |
| `allowed_tools` | Tool allowlist. The Agent cannot call tools outside this list for the skill. |
| `confirmation` | Confirmation policy before write or high-risk action. |
| `audit` | Audit level. All writes require intent and result logging. |
| `idempotency` | Required for writes, workflow submission, external sync, and notifications. |

## 5. Tool Contract

Every tool should be registered with a strict backend contract.

```json
{
  "name": "forms.create_dynamic_record_draft",
  "version": "0.1.0",
  "description": "Create a draft dynamic record for a configured form.",
  "side_effect": "draft_write",
  "risk_level": "medium",
  "permission_check": "current_user",
  "input_schema": "CreateDynamicRecordDraftInput",
  "output_schema": "CreateDynamicRecordDraftOutput",
  "timeout_ms": 3000,
  "result_limit": 1,
  "idempotency_required": true,
  "audit_required": true,
  "dry_run_supported": true
}
```

Tool side-effect classes:

| Class | Meaning | Example |
| --- | --- | --- |
| `read` | Reads data only. | Search knowledge, read inventory, read workflow status. |
| `analyze` | Computes derived insight without write. | Quality trend explanation, supplier risk summary. |
| `index_write` | Writes internal retrieval artifacts but not business records. | Store parsed Markdown, chunks, embeddings, vector index rows. |
| `draft_write` | Creates or updates a draft with no final business commitment. | CAPA draft, purchase request draft, low-code config draft. |
| `workflow_action` | Starts, approves, rejects, or advances workflow. | Submit material number application. |
| `notification` | Sends or schedules user-visible messages. | Notify quality owner. |
| `configuration_write` | Changes model, page, rule, permission, or app configuration. | Save generated form definition. |
| `external_write` | Calls ERP/MES/SRM/WMS or other external system. | Create ERP purchase request. |

Tool implementation rules:

- Validate input with a schema before calling domain code.
- Enforce current user permissions before reading or writing.
- Support `dry_run` for any write-like tool whenever practical.
- Return structured results with affected object IDs, warnings, and source references.
- Use idempotency keys for repeated writes and workflow/external calls.
- Never accept raw SQL, raw Python, or arbitrary endpoint names from an LLM.
- Keep sensitive values out of prompts, tool logs, and frontend responses.
- Keep provider credentials and system prompts on the backend. Current GLM-
  compatible settings use `AI_PROVIDER=glm`, `AI_BASE_URL`, `AI_API_KEY`,
  `AI_CHAT_MODEL`, `AI_REASONING_MODEL`, `AI_EMBEDDING_MODEL`, and
  `AI_VISION_MODEL`; these are configuration inputs to the provider adapter,
  not user-provided tool arguments.

### 5.1 Knowledge Ingestion Tools

Knowledge ingestion is a controlled internal write path. It prepares retrieval
evidence but does not by itself publish enterprise knowledge or execute business
actions.

Recommended ingestion tools:

| Tool | Side effect | Purpose |
| --- | --- | --- |
| `knowledge.ingest_document` | `index_write` | Accept uploaded or synchronized source files, persist source metadata, and start parsing. |
| `knowledge.convert_to_markdown` | `index_write` | Normalize PDF, Word, spreadsheet, image OCR, or plain text into reviewable Markdown. |
| `knowledge.chunk_markdown` | `index_write` | Split Markdown into stable chunks with source offsets, headings, and evidence metadata. |
| `knowledge.embed_chunks` | `index_write` | Generate embeddings through the backend provider adapter and write pgvector-ready rows. |
| `knowledge.search` | `read` | Retrieve chunks/cards as RAG evidence with permission filtering and source references. |

The canonical retrieval path is:

```text
raw file
  -> Markdown normalization
  -> chunking with document/page/heading metadata
  -> embedding
  -> pgvector-ready index
  -> RAG retrieval
  -> cited assistant answer or draft skill context
```

Ingestion tools must be idempotent by document version and chunk hash so that a
re-ingest updates changed chunks without duplicating unchanged vectors. Parsed
Markdown and embedding rows should keep links back to the original source file,
document version, page or section, uploader, permission scope, and review state.

## 6. Risk Levels

Risk is assigned by business impact, reversibility, data sensitivity, and whether the action leaves the system boundary.

| Level | Definition | Examples | Default control |
| --- | --- | --- | --- |
| Low | Read-only or reversible suggestion with limited data scope. | Knowledge Q&A, page usage help, read workflow status. | No confirmation; show sources when available. |
| Medium | Draft creation, retrieval-index writes, or recommendation that may influence business decisions. | CAPA draft, repair order draft, purchase request draft, model suggestion, document ingestion. | User review before save/publish/submit; audit write if saved or indexed. |
| High | Write action, workflow submission, operational commitment, or broad data impact. | Submit workflow, send notifications to many users, publish generated config, create purchase request. | Explicit confirmation with reviewed payload; audit required. |
| Critical | Financial/legal/external system commitment, permission/security change, irreversible action. | Create purchase order in ERP, change role permissions, delete data, auto-order goods. | Admin or role-owner approval; policy limits; idempotency; reconciliation plan. |

Default posture:

- Read tools can run after permission checks.
- Draft tools can prepare content, but the user must review what will be saved.
- Workflow and external writes require explicit confirmation.
- Permission changes and publish actions require admin-level confirmation.
- Fully automatic critical actions are out of scope until policy, audit, reconciliation, and rollback are proven.

## 7. Confirmation Strategy

Confirmation is not just a yes/no modal. It is a reviewable contract between the Agent and the user.

### 7.1 Confirmation Levels

| Confirmation | Applies to | Required user-visible content |
| --- | --- | --- |
| `none` | Low-risk read-only answers. | Answer, sources, confidence when available. |
| `review_recommended` | Medium-risk recommendations that are not saved. | Reasoning, assumptions, source data, alternatives. |
| `required_before_draft_save` | Medium-risk draft writes. | Draft fields, source records, missing fields, validation warnings. |
| `required_before_submit` | High-risk workflow or business action. | Action summary, affected records, workflow target, assignee/owner, irreversible effects. |
| `admin_required` | Critical configuration, permission, or external commitment. | Full payload diff, policy checks, approver identity, idempotency key, rollback/reconciliation note. |

### 7.2 Confirmation Payload

Any write-like skill should produce a `confirmation_payload` before execution.

```json
{
  "skill_name": "supply_chain.prepare_purchase_request",
  "risk_level": "high",
  "mode": "confirmed_write",
  "summary": "Create a purchase request draft for SKF bearing 6205.",
  "affected_objects": [
    {"type": "Material", "id": "material-5", "name": "SKF bearing 6205"},
    {"type": "Supplier", "id": "supplier-2", "name": "Preferred supplier"}
  ],
  "proposed_changes": {
    "target": "purchase_request",
    "fields": {
      "material_id": "material-5",
      "quantity": 300,
      "reason": "Available inventory below safety stock"
    }
  },
  "evidence": [
    {"type": "inventory", "id": "inventory-material-5", "label": "Available 700 units"},
    {"type": "policy", "id": "safety-stock", "label": "Safety stock threshold"}
  ],
  "warnings": [],
  "idempotency_key": "supply_chain.prepare_purchase_request:material-5:user-123:20260522"
}
```

The frontend can display this payload in a business-specific review panel. The backend must still enforce the confirmation token or equivalent server-side state before executing the final action.

## 8. Agent Phased Roadmap

| Phase | Goal | Skill/tool scope | Engineering deliverables | Exit criteria |
| --- | --- | --- | --- | --- |
| Phase 0 | Preserve demo usefulness | Existing chat, AI Builder, knowledge search | Document contracts, identify mock boundaries, keep current endpoints stable | Demo behavior remains unchanged. |
| Phase 1 | Source-aware read skills | Q&A, knowledge, graph, business data reads | `services/ai` scaffolding, skill registry, read tool registry, structured evidence output | AI answers can cite local knowledge/business sources. |
| Phase 2 | Assisted draft skills | CAPA draft, repair order draft, purchase request draft, model/page suggestions | Draft-first tools, validation, confirmation payloads, audit for saved drafts, pgvector-ready ingestion | Users can review and save drafts without final workflow submission; knowledge files can flow raw file -> Markdown -> embedding -> RAG. |
| Phase 3 | Confirmed workflow actions | Submit workflow, notify owner, create follow-up task | Confirmation token, idempotency, workflow tool wrappers, audit result records | AI can execute selected actions only after explicit confirmation. |
| Phase 4 | Proactive agent runs | Scheduled risk patrol, overdue approval reminders, inventory alerts | Scheduler-triggered skills, service principal policy, notification rules, result review queue | AI can prepare alerts/drafts from scheduled checks. |
| Phase 5 | Policy-based automation | Low-risk auto reminders and narrow auto-drafts | Policy engine, allowlists, amount/category limits, reconciliation reports | Automation is limited, observable, and reversible. |
| Phase 6 | External system actions | ERP/MES/SRM/WMS sync and external commits | External tool contracts, idempotency, reconciliation, rollback playbooks | External writes are confirmed, auditable, and reconciled. |

## 9. Demo Mock Skill To Real Backend Skill Migration

The migration path should avoid a big rewrite. Keep the user-facing skill stable and replace internals in layers.

### 9.1 Migration Pattern

```text
Demo/mock handler
  -> Skill wrapper with stable input/output
  -> Tool registry entry
  -> Read-only real backend tool
  -> Draft-write backend tool
  -> Confirmed execution backend tool
  -> Proactive/scheduled skill
```

### 9.2 Example: Quality Event To CAPA Draft

| Stage | Implementation | Behavior |
| --- | --- | --- |
| Mock | Hardcoded quality answer in `ai_assistant.py`. | Returns generic quality summary. |
| Skill wrapper | `quality.analyze_event` returns structured insight and evidence fields. | Same UI can render sources and recommendations. |
| Read tools | `quality.get_event`, `knowledge.search`, `graph.query_impact`. | Reads real event, SOP/CAPA evidence, affected objects. |
| Draft tool | `forms.create_dynamic_record_draft` for CAPA form. | Creates CAPA draft only after review. |
| Workflow tool | `workflow.start` after confirmation. | Submits CAPA workflow with audit and idempotency. |
| Proactive | Scheduler runs quality patrol. | Creates review queue item or notification, not final action by default. |

### 9.3 Example: AI Builder Mock To Real Low-Code Skill

| Stage | Implementation | Behavior |
| --- | --- | --- |
| Mock | `ai_builder.suggest_model` keyword templates. | Suggests fields and page layout. |
| Skill wrapper | `low_code.suggest_model` normalizes output into model/page/rule draft schema. | Frontend receives stable structured draft. |
| Validation tool | `forms.validate_definition`, `rules.validate`. | Checks field names, required fields, enum values, action bindings. |
| Draft save tool | `forms.save_definition_draft`. | Saves metadata draft without publishing. |
| Publish tool | `forms.publish_definition` with `admin_required`. | Admin reviews diff and publishes configuration. |

### 9.3.1 Current: Conversational Form Creation Skill

The low-code form creation flow has split into two distinct tools:

| Stage | Tool / module | Behavior |
| --- | --- | --- |
| Semantic planning | `ai.semantic_plan_low_code_form`, `backend/app/services/ai/semantic_planner.py` | Uses the configured LLM to convert a user turn and pending draft into a structured operation such as `create_form`, `rename_form`, or `add_field`. This is read-only and may fall back to deterministic planning. |
| Draft state merge | `backend/app/services/ai/action_state.py` | Merges structured semantic slots into the pending action state without letting regex extraction overwrite explicit LLM slots. |
| Confirmation card | `low_code.create_form_definition` skill output | Shows the current form draft and waits for human confirmation. |
| Configuration write | `forms.create_form_definition`, `backend/app/services/ai/low_code_tools.py` | Creates form metadata, fields, layouts, optional menu binding, audit event, and route only after confirmation and permission checks. |
| Existing form field change | `low_code.add_form_field` -> `forms.add_form_field` | Adds fields to an existing form after the same semantic planning, permission, confirmation, and audit gates. |

This means conversational edits should be represented as form deltas before they
become a write payload:

```json
{
  "operation": "add_field",
  "fields": [
    {"field_name": "supplier_rating", "label": "供应商等级", "field_type": "string", "required": false}
  ]
}
```

The `low_code.create_form_definition` skill allows both
`ai.semantic_plan_low_code_form` and `forms.create_form_definition`; the former
has no side effect, while the latter is a high-risk configuration write that
requires `config` permission and confirmation.

For an existing form, field additions are modeled as a separate skill instead of
being hidden inside form creation:

```json
{
  "skill": "low_code.add_form_field",
  "tool": "forms.add_form_field",
  "payload": {
    "form_code": "material_master",
    "fields": [
      {"field_name": "supplier_rating", "label": "供应商等级", "field_type": "string"}
    ]
  }
}
```

### 9.4 Example: Supply Chain Recommendation To Purchase Request Draft

| Stage | Implementation | Behavior |
| --- | --- | --- |
| Mock | Supply-chain intent returns inventory alert text. | User sees generic risk summary. |
| Read tools | `inventory.get_stock`, `supplier.list_candidates`, `knowledge.search`. | Agent uses real inventory and supplier evidence. |
| Recommendation skill | `supply_chain.recommend_replenishment`. | Returns quantity, supplier alternatives, assumptions. |
| Draft tool | `forms.create_dynamic_record_draft` for purchase request. | Buyer reviews draft fields. |
| Workflow tool | `workflow.start` after confirmation. | Purchase request enters approval workflow. |
| External tool | ERP/SRM sync in later phase. | Requires critical-risk policy and reconciliation. |

## 10. Recommended Backend Shape

Target service layout:

```text
backend/app/services/ai/
  __init__.py
  client.py             # LLM provider adapter; optional in early phases
  config.py             # backend-owned provider/system settings resolver
  orchestrator.py       # intent, planning, skill routing
  skills.py             # skill registry and skill contracts
  tools.py              # current mock business draft helpers
  tool_registry.py      # typed tool registry and tool contracts
  planner.py            # deterministic turn planner for action vs Q&A
  low_code_tools.py     # confirmed low-code form creation helpers
  policies.py           # risk, permission, and confirmation policy
  schemas.py            # shared Pydantic input/output schemas
  agent_runs.py         # run state, steps, evidence, status
  confirmations.py      # confirmation payloads/tokens
  audit.py              # AI action log helpers
  evidence.py           # source/result normalization
```

Relational AI runtime tables currently live in `backend/app/models/relational.py`
and migration `0015_ai_agent_runtime.py`:

```text
ai_conversations
ai_messages
ai_agent_runs
ai_tool_calls
ai_memory_entries
```

Router responsibilities:

- `/api/v1/ai/chat` should call the orchestrator for conversational read/assist skills.
- `/api/v1/ai/analyze` should call analysis skills with structured context.
- `/api/v1/ai-builder/*` should become low-code skills behind the same endpoint contract.
- `/api/v1/knowledge/*` can remain a direct local RAG API and also be registered as tools.

Backend provider configuration must be centralized behind the AI service layer.
GLM-compatible credentials and system settings should be loaded from environment
variables or backend-managed settings, then passed to `client.py` by the
orchestrator. The frontend should only send user intent, conversation context,
selected business mode, and uploaded document references.

Domain services remain the source of truth for business behavior. The AI layer composes them; it does not replace them.

## 11. Initial Skill Backlog

| Priority | Skill | Risk | First real tool dependencies |
| --- | --- | --- | --- |
| P0 | `knowledge.answer_question` | Low | `knowledge.search` |
| P0 | `knowledge.ingest_for_rag` | Medium | `knowledge.ingest_document`, `knowledge.convert_to_markdown`, `knowledge.embed_chunks` |
| P0 | `quality.analyze_event` | Medium | `quality.get_event`, `knowledge.search`, `graph.query_impact` |
| P1 | `quality.prepare_capa_draft` | Medium | `forms.create_dynamic_record_draft`, `rules.validate` |
| P1 | `low_code.suggest_model` | Medium | Existing AI Builder logic behind skill wrapper |
| P1 | `maintenance.prepare_work_order` | Medium | `maintenance.get_equipment`, `forms.create_dynamic_record_draft` |
| P2 | `supply_chain.prepare_purchase_request` | High | `inventory.get_stock`, `supplier.list_candidates`, `forms.create_dynamic_record_draft` |
| P2 | `workflow.submit_instance` | High | `workflow.start`, confirmation token, idempotency |
| P3 | `notifications.notify_owner` | High | `notifications.create`, audience limit policy |
| P3 | `low_code.publish_configuration` | Critical | Admin confirmation, config diff, rollback/export |
| P4 | `external.sync_purchase_request` | Critical | ERP/SRM connector, reconciliation, retry and idempotency |

## 12. Non-Goals For The Next Phase

- Do not let prompts issue raw SQL or arbitrary backend endpoint calls.
- Do not auto-create purchase orders or external commitments.
- Do not auto-change role permissions.
- Do not publish low-code configuration without admin review.
- Do not remove mock fallbacks until real tools are tested and documented.
- Do not make frontend code changes as part of this document-only task.

## 13. Related Documents

- [AI Capability Map](ai-capability-map.md)
- [AIP-Style Intelligence Layer](aip-style-intelligence-layer.md)
- [Knowledge Base](knowledge-base.md)
- [Architecture Overview](overview.md)
