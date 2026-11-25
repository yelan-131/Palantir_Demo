# 代码框架

更新日期：2026-11-17（对应代码版本 0.3.22 草稿）

本文按目录说明代码放在哪里、各模块负责什么。整体架构和运行流程见[系统架构总览](overview.md)。

## 1. 仓库目录

```text
backend/            FastAPI 后端：应用代码、Alembic 迁移、测试、运维与验收脚本
frontend/           React 前端：源码、node:test 单元测试、Dockerfile 与 nginx 配置
data/               种子数据、演示知识资产、AI 技能与工具注册表种子、行业模板
docker/             Docker Compose 文件（开发、生产叠加、私有化发布、外部数据源演示）
docs/               项目文档
scripts/            部署、发布、种子数据、数据修复、注册表升级等脚本
.agent/             AI Agent 说明：运行时只读取 agent.md；action-contracts.md 仅供测试与打包，skills.md、tools.md 不被代码读取
.github/workflows/  持续集成（ci.yml）
release.json        发布清单，后端 /api/v1/release/current 读取此文件
```

## 2. 后端 `backend/app`

### 2.1 入口与基础设施

| 文件 | 职责 |
| --- | --- |
| `main.py` | 创建 FastAPI 应用；CORS、请求 ID 与耗时统计中间件、全局异常处理；系统接口；挂载全部路由；在 `lifespan` 中启动 AI 记忆清理与流程下发后台循环 |
| `config.py` | `pydantic-settings` 配置，读取环境变量和 `.env`；`validate_runtime()` 在生产模式下拒绝不安全配置 |
| `database.py` | 选择 PostgreSQL 或 SQLite 引擎、创建 Neo4j 驱动；SQLite 模式下 `init_db()` 建表、补列并安装内置 AI 工具 |

### 2.2 `app/core`

| 文件 | 职责 |
| --- | --- |
| `db.py` | `db_session()` 会话上下文 |
| `security.py` | JWT 签发与解析、密码哈希 |
| `principal.py` | 从令牌载荷读取当前用户、租户，`ensure_admin` |
| `permissions.py` | 通用资源权限、表单权限、字段权限判定 |
| `audit.py` | 审计日志写入 |
| `identifiers.py` | 动态表名、列名的安全校验 |
| `logging.py`、`production_errors.py` | 日志初始化、生产环境错误处理 |
| `seed_config.py` | 种子表的列定义与插入 SQL 生成 |
| `agent_registry_schema.py`、`application_menu_registry_schema.py`、`component_page_registry_schema.py` | SQLite 模式下补齐 AI 注册表结构并安装应用菜单、组件页面相关的内置工具 |

### 2.3 `app/api`（HTTP 适配层）

每个文件对应一个 `/api/v1/<前缀>`，完整对应关系见 [API 参考](../development/api-reference.md)。几个需要注意的文件：

- `deps.py`：`get_db`、`get_current_user`、`require_admin`、`require_platform_admin`、`require_platform_admin_for_writes`、`require_permission`、`require_form_permission`。
- `forms.py`：表单平台的主要入口。0.3.22 起大部分逻辑已迁入服务层，此文件保留路由并再导出旧符号以兼容调用方。
- `model_driven.py`：聚合 `model_driven_meta.py`、`model_driven_data.py`、`model_driven_menus.py` 三个子路由，并统一要求写操作由平台管理员执行。
- `ai_harness.py`：Harness 运行时回调平台工具的 MCP 入口，使用桥接令牌而非用户令牌鉴权。

### 2.4 `app/services`（业务服务层）

| 领域 | 模块 |
| --- | --- |
| 表单定义与设计 | `form_schemas`（请求模型）、`form_definition`（规范化、序列化、设计快照、影响检查）、`form_fields`、`form_layouts`、`form_view_tabs`、`form_admin`、`designer_permissions` |
| 表单发布与运行 | `form_versions`（预览、发布、恢复、版本读取）、`form_published_payload`、`form_runtime`（发布字段解析与记录载荷规范化） |
| 表单规则与控件 | `form_rules`、`form_rule_preview`、`form_calculations`、`form_defaults`、`form_control_validation`、`field_limits`、`field_policies`、`field_uniqueness`、`static_options`、`form_option_sources`、`option_search` |
| 导入与附件 | `form_imports`（CSV/XLSX 预览、字段映射、批量写入）、`form_files`（附件存储与校验） |
| 表单存储引擎 | `form_engine/`：`naming`（表名和租户命名空间）、`physical`（建表加列）、`query`、`encoding`（自动编码）、`sequences`（编码流水号）、`validation` |
| 业务记录 | `records`（UI、AI、看板、流程共用的记录读写边界）、`record_domains` |
| 应用与菜单 | `applications`、`application_menus`、`application_menu_nodes` |
| 组件页面 | `component_page_definitions`、`component_page_editor`、`component_shared_metrics`、`page_content_migration` |
| 分析看板 | `analytics_data`、`analytics_runtime`、`analytics_editor`、`analytics_dataset_range`、`analytics_metric_library`、`dashboard_programs` |
| 流程与审批 | `workflow_routing`（条件路由）、`workflow_approvals`、`workflow_views`、`workflow_field_policy`、`workflow_dispatch`（自动下发）、`approval_groups`、`approval_notifications`、`form_approval_config`、`form_application_lifecycle`、`form_workflow_start`、`material_workflow` |
| 告警 | `alert_service`、`alert_records` |
| 身份与租户 | `iam`（会话、密码策略）、`tenant_onboarding`、`reference_data_defaults` |
| 数据与语义 | `metadata_scan_service`、`internal_data_assets`、`ontology_service`、`ontology_candidate_service`、`ontology_ai_candidate_service`、`semantic_mapping_service`、`graph_service`、`graph_fallback`、`knowledge_retrieval`（知识检索：入库文档用哈希伪向量加词面打分，TF-IDF 只用于默认关闭的静态演示分块） |

### 2.5 `app/services/ai`

| 分组 | 模块 |
| --- | --- |
| 运行时 | `harness_runtime`（DeepSeek Harness 封装与 MCP 桥）、`harness_parameters`、`harness_skills`、`harness_updates`、`runtime`、`orchestrator`、`agent_runs`、`run_recovery`、`events`、`hooks` |
| 工具边界 | `tool_registry`、`tool_envelope`（权限、确认、审计、执行事件）、`tool_handlers`（可执行处理器白名单）、`tool_executor`、`policies`、`permission_resolver`、`confirmations`、`confirmation_store` |
| 注册表与技能 | `agent_registry`、`agent_definition`、`agent_validation`、`skills`、`skill_loader`、`skill_import`（导入 SKILL.md）、`business_skills/*/SKILL.md`、`page_skill_registry`、`application_menu_registry` |
| 业务工具 | `form_configuration_tools`、`form_record_tools`、`form_menu_tools`、`low_code_tools`、`dashboard_tools`、`component_page_tools`、`application_admin_tools`、`menu_admin_tools`、`dynamic_record_drafts` |
| 页面联动 | `page_controls`、`component_page_controls`（让 AI 操作当前打开的设计器页面，由用户最终确认） |
| 上下文与记忆 | `context_builder`、`agent_context_router`、`identity_context`、`tenant_context`、`tenant_profile`、`memory`、`chat_attachments` |
| 模型与配置 | `settings`（AI 设置默认值与合并）、`model_catalog`、`providers`、`client`、`credential_store`（加密保存模型凭据） |
| 知识处理 | `knowledge_ingestion`、`ocr_service`、`ontology_extraction`、`demo_knowledge_seed` |
| 运行辅助 | `agent_items`（运行步骤协议）、`configuration_completion`、`configuration_review`、`form_analysis`、`audit`（AI 审计，只保存在进程内存的环形缓冲区，不写 `audit_logs`） |
| 旧规划链路 | `planner`、`semantic_planner`、`intent_router`：Harness 之前的规划器，`tool_envelope`、`tool_handlers`、`runtime` 仍引用其中部分函数 |
| 打包资源 | `assets/`（注册表种子的打包副本，供只含后端的镜像使用；由 `scripts/sync_ai_assets.py` 刷新）、`harness-*.patch.yml` |

### 2.6 `app/models`

- `relational.py`：全部 99 张关系表的 SQLAlchemy 模型，分组见[数据模型](data-model.md)。
- `graph_models.py`：Neo4j 节点标签与关系类型常量。

### 2.7 迁移、测试与脚本

| 目录 | 内容 |
| --- | --- |
| `backend/alembic/versions/` | 45 个迁移文件，`0021` 有两个并行分支，在 `0022` 合并；当前最新为 `0044_component_page_ai_tools` |
| `backend/tests/` | 110 个 `test_*.py`；`legacy_agent/` 保存旧版规划器的测试 |
| `backend/scripts/` | 验收和运维脚本：多用户与审批验收、组件页面填充与校验、PostgreSQL 记录校验、看板 AI 注册表升级、基础数据初始化、料号申请拆分迁移等。多数脚本默认只读或演练（dry-run），只允许连接本机地址 |

## 3. 前端 `frontend/src`

### 3.1 入口与全局

| 文件或目录 | 职责 |
| --- | --- |
| `main.tsx` | React 入口：创建路由、配置 Ant Design 中文语言包与 `theme/techWhite.ts` 主题、引入全局样式 |
| `App.tsx` | 登录守卫、应用外壳（应用栏、上下文菜单、页头、全局搜索、通知中心、版本记录弹窗、AI 助手浮窗）、全部路由 |
| `config/navigation.ts` | 五个导航区域、各区域入口、旧地址重定向表、设置中心分组 |
| `config/menus.ts` | 旧版静态菜单与面包屑 |
| `config/readyPathSmoke.ts` | SaaS 第一阶段的路由与菜单清单；目前没有任何模块或测试导入，不会执行，其中 `/system-admin`、`/reports` 已不是现行路由 |
| `config/appAssemblyMenus.ts`、`config/dataCenter.ts` | 应用装配的本地兜底菜单、数据中心页签定义 |
| `services/api.ts` | axios 实例与大部分接口封装；`alerts.ts`、`formApprovals.ts`、`materialApplications.ts` 为独立领域封装 |
| `stores/authStore.ts` | Zustand 登录状态，读写 `localStorage` 中的 `mf_token`、`mf_user` |
| `hooks/` | `useApi`、`useShellPreferences`（侧栏、密度、AI 浮窗显隐等个人偏好） |
| `theme/` | Ant Design 主题与图表配色 |
| `utils/` | 表单布局、计算、默认值、控件、视图配置、菜单、知识 Markdown、时间、UUID 等纯函数，大多有对应单元测试 |
| `index.css`、`shell.css`、`workspace.css`、`ui-system.css`、`responsive.css` | 全局样式、应用外壳、工作台、设计系统、响应式规则 |

### 3.2 页面 `pages/`

| 目录 | 路由或使用位置 |
| --- | --- |
| `Login` | `/login` |
| `Workspace` | `/` 我的工作台 |
| `Workflow` | `/workflow` 流程与待办（入口 `index.tsx`；同目录的 `MyApprovals`、`MyApplications`、`WorkflowList`、`DispatchLog` 是未被引用的旧组件） |
| `Scheduler` | `/scheduler` 日常任务 |
| `NavigationArea` | `/studio/*`、`/data-center/*`、`/admin/*` 的分发页，按路径渲染下列页面，也提供 `/account-center` |
| `ComponentPages` | 组件页面画布与属性面板（`/pages/:code`、`/studio/page-design`），以及表单页面入口 `FormPageEntry`（`/dynamic/:slug`、`/program/:programId`） |
| `FormSettings` | `/studio/business-data/:formId/design` 内编辑录入和流程。角色权限从原权限管理入口打开 |
| `DynamicPage` | 未启用组件页面时的业务记录列表与表单 |
| `AppPrograms` | 未启用组件页面时的 `/program/*` 程序页；内部复用 `Dashboard` |
| `AlertCenter`、`MaterialApplications` | 告警中心、料号申请 |
| `SystemAdmin` | 应用与菜单、业务数据、基础数据、身份与权限、语义资产与知识中心 |
| `DataCenterWorkspace` | 「数据资产」和「对象与关系」两个工作区，内部使用 `DataSource`、`Pipeline`、`SemanticAssetCenter`、`ObjectBrowser` 和 `RelationshipExplorer` |
| `AccountCenter` | 账号与安全、工作偏好，以及后台的 AI 设置和审计面板 |
| `BackendSettings` | 后台高级工具：实体时间旅行、图谱分析、模型与页面工具（复用 `ModelDriven`）、AI 建议、配置导入导出、模块成熟度 |
| `QualityImpact` | `/admin/quality-impact` 质量影响与时间线 |
| `TemplateMarket` | `/studio/templates` 模板中心 |

以下目录当前没有被任何路由或模块引用，是历史页面，修改前先确认是否还需要：`AIAssistant`、`Maintenance`、`Quality`、`ReportCenter`、`RuleEngine`、`SupplyChain`、`TaobaoPrototype`。

### 3.3 公共组件 `components/`

| 目录 | 用途 |
| --- | --- |
| `ShellNavigation`、`AccountMenu`、`GlobalSearch`、`NotificationCenter`、`SettingsTabs`、`ThemePalette` | 应用外壳 |
| `AiChatWidget` | AI 助手浮窗、事件流、确认卡片、页面联动控制器（`pageControls.tsx`） |
| `FormWidgets`、`FormLayout`、`OptionPicker`、`FieldProtection` | 字段控件、布局渲染、选项选择、字段脱敏与保护 |
| `FormImport`、`FormApprovalSettings` | 导入弹窗、审批设置 |
| `DragCanvas`、`ComponentPanel`、`ConfigPanel`、`PropertyInspector` | 设计器画布与属性面板 |
| `ReportWidgets` | 图表与指标卡 |
| `KnowledgeExplorer`、`KnowledgeReader` | 知识浏览与阅读 |

### 3.4 设计预览入口

`design-preview/unified-form/`（入口 `unified-form-design.html`）和 `design-review/`（入口 `ui-review.html`，配置 `vite.review.config.ts`，端口 13003）是独立的设计评审页面，不随主应用发布。

## 4. 修改代码后同步哪些文档

| 改动 | 需要更新 |
| --- | --- |
| 新增或修改接口 | 运行 `python scripts/docs/generate_api_reference.py`；公开接口还要同步 `test_route_auth_coverage.py` |
| 新增前端路由、导航入口 | [前端开发指南](../development/frontend.md)、本文第 3 节 |
| 新增表或迁移 | [数据模型](data-model.md) |
| 认证、角色、权限校验 | [权限体系](permissions.md) |
| 表单、字段、发布、业务记录、组件页面 | [低代码平台](low-code/platform.md)、[表单](low-code/forms.md)；影响配置人员操作时同步[业务表单使用指南](../guides/low-code/business-form-guide.md) |
| 应用、菜单、工作台、通知 | [应用](low-code/applications.md)、[工作台与通知](low-code/workbench.md) |
| 知识库、图谱 | [知识库](knowledge/knowledge-base.md)、[图谱](knowledge/graph.md)、[知识库工作流](../guides/knowledge/knowledge-workflow.md) |
| AI 能力、运行时、技能与工具 | [AI 概览](ai/README.md)、[Harness 运行时](ai/harness-runtime.md)、[技能与工具契约](ai/skill-contract.md) |
| 外部数据源接入 | [系统集成](integration.md) |
| 部署、端口、环境变量变化 | [部署说明](../operations/deployment.md)、[私有化部署](../operations/private-deployment.md) |
| 测试或 CI 变化 | [测试说明](../operations/testing.md) |
| 版本发布 | 按[版本规则](../operations/version-policy.md)使用 `scripts/bump_release.py`，并编写 `docs/releases/release-X.Y.Z.md` |
