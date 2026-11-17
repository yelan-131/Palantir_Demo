# 数据模型

更新日期：2026-11-17（对应代码版本 0.3.22 草稿，迁移最新为 `0044_component_page_ai_tools`）

以代码为准：`backend/app/models/relational.py`（99 张表）、`backend/app/models/graph_models.py`（Neo4j 标签）、`backend/alembic/versions/`（45 个迁移）、`backend/app/services/form_engine/`（表单物理表）。

## 1. 存储组成

| 存储 | 内容 |
| --- | --- |
| PostgreSQL（或本地 SQLite） | 下文列出的 99 张 ORM 表，以及表单物理表 |
| 表单物理表 | 物理存储表单的业务数据，表名 `business_<编码>`；新建表单带租户前缀 `t<租户ID>_business_<编码>`；分析类表单使用 `analysis_` 前缀 |
| Neo4j | 制造业对象图，可由种子数据或同步接口重建 |
| 文件目录 | 表单附件（`FORM_FILE_STORAGE_DIR`）、知识资产（`KNOWLEDGE_STORAGE_DIR`） |

约定：

- 除下列 9 张表外，所有表都带 `tenant_id`，服务层按当前租户过滤：`tenants`、`system_settings`（平台级）、`meta_models`、`meta_fields`、`meta_relations`、`page_configs`、`model_versions`（旧版模型驱动，按平台共享）、`workflow_approvals`（经所属流程实例确定租户）、`ai_confirmation_tokens`。
- 大多数表混入 `TimestampMixin`，带 `created_at`、`updated_at`。
- JSON 列在 PostgreSQL 中是 JSON/JSONB，在 SQLite 中是 JSON 文本；写入时使用 `ensure_ascii=False`。

## 2. 关系表分组

### 2.1 制造业主数据（23）

`factories`、`workshops`、`production_lines`、`equipment`、`sensors`、`sensor_readings`、`products`、`materials`、`bom`、`process_routes`、`sales_orders`、`work_orders`、`operations`、`suppliers`、`customers`、`warehouses`、`inventory`、`shipments`、`inspections`、`defects`、`spc_points`、`capa`、`workers`

- 用于运营总览、设备维护、质量、供应链、图谱等演示模块。
- 其中 16 张表有种子文件 `data/seed/<表名>.json`（`bom`、`process_routes`、`operations`、`warehouses`、`inventory`、`shipments`、`capa` 没有）。
- `sensor_readings` 是普通关系表，没有使用时序数据库。

### 2.2 租户与身份（14）

| 表 | 用途 |
| --- | --- |
| `tenants` | 租户；`status` 为 `active` 才能登录；`config`、`limits` 为 JSON。租户 1 是平台租户 |
| `tenant_domains`、`tenant_invites`、`tenant_exports` | 租户域名、邀请、脱敏导出任务 |
| `users` | 账号；包含锁定、强制改密、MFA、单点登录标识等字段 |
| `org_units`、`user_org_memberships` | 组织树与成员，作为数据范围权限的依据 |
| `roles`、`user_roles` | 角色与用户角色 |
| `role_permissions` | 角色权限：`resource_type`、`resource_key`、`action`、`effect`（允许/拒绝）、`data_scope`、`condition_json`（行条件）、`field_rules_json`（字段规则）、`priority`、`enabled` |
| `user_sessions` | 登录会话；令牌中的 `sid` 对应此表，撤销后令牌立即失效 |
| `password_history`、`password_reset_tokens`、`oidc_states` | 密码历史、重置令牌、OIDC 登录状态 |

### 2.3 应用与表单平台（14）

| 表 | 用途 |
| --- | --- |
| `applications` | 应用：编码、图标、默认入口 `default_route`、状态、是否置顶 |
| `application_roles`、`application_menus` | 应用可见角色、旧版应用菜单 |
| `application_menu_nodes` | 应用菜单树：节点类型、关联表单 `form_id` 或路由、是否默认入口、排序、`config`（权限等） |
| `application_forms` | 应用与表单的绑定 |
| `forms` | 表单定义：编码、`storage_mode`、`table_name`、状态、`config`（设计器配置、审批、视图页签等） |
| `form_fields` | 字段：名称、类型、控件、必填、列表/表单可见、选项、`ui_config` 等 |
| `form_layouts`、`form_actions`、`form_permissions` | 布局、动作按钮、表单级与字段级权限 |
| `form_versions` | 发布快照：`version`、`snapshot`、`impact_report`、发布人与时间；运行期字段以最新快照为准 |
| `form_code_sequences` | 自动编码（如料号）的原子流水号，按范围计数 |
| `dynamic_records` | JSON 存储表单的业务记录：`data`、`schema_version`、`status`、创建与修改人、`deleted_at`（软删除） |
| `workflow_bindings` | 表单动作与流程定义的绑定 |

### 2.4 组件页面与分析（6）

| 表 | 用途 |
| --- | --- |
| `component_pages` | 组件页面：`code`、`draft`（草稿定义）、`revision`（并发修改检查）、`published_version` |
| `component_page_versions` | 页面发布快照；页面发布与来源表单的发布互相独立 |
| `analytics_shared_metrics`、`analytics_shared_metric_versions` | 租户共享指标库的草稿与不可变发布版本 |
| `reports`、`report_snapshots` | 报表定义与快照 |

### 2.5 流程与通知（5）

| 表 | 用途 |
| --- | --- |
| `workflow_defs` | 流程定义：节点、路由条件、自动下发等配置在 `config`，`version` 为当前版本号 |
| `workflow_def_versions` | 每个版本的不可变快照 |
| `workflow_instances` | 流程实例：启动时固定 `workflow_version`，`form_data` 为业务数据，`workflow_state` 为运行状态（当前节点、执行路径、下发状态等） |
| `workflow_approvals` | 审批记录 |
| `notifications` | 站内通知 |

### 2.6 旧版模型驱动（6）

`meta_models`、`meta_fields`、`meta_relations`、`page_configs`、`menu_items`、`model_versions`

供 `/api/v1/model-driven/*` 使用，与新的表单平台并存。读取需要登录，写入只允许平台管理员。

### 2.7 规则、任务、审计与设置（4）

| 表 | 用途 |
| --- | --- |
| `rules` | 校验规则与触发器 |
| `scheduled_jobs` | 定时任务定义 |
| `audit_logs` | 审计日志（登录、权限变更、业务记录写入等） |
| `system_settings` | 键值形式的平台设置，例如 AI 设置 |

### 2.8 数据集成与语义资产（13）

| 表 | 用途 |
| --- | --- |
| `data_sources`、`data_source_metadata`、`data_source_sync_status` | 外部数据源、扫描得到的元数据、同步状态 |
| `pipelines`、`pipeline_runs` | 数据管道与运行记录 |
| `ontology_objects`、`ontology_fields`、`ontology_relations` | 本体对象、字段、关系 |
| `ontology_mappings`、`ontology_mapping_layouts` | 数据资产到本体的映射及映射画布布局 |
| `ontology_candidates` | 由元数据或 AI 生成、待审核的本体候选 |
| `ontology_versions`、`ontology_publish_logs` | 本体发布版本与发布日志 |

### 2.9 知识库（5）

| 表 | 用途 |
| --- | --- |
| `knowledge_documents` | 文档：来源文件、类型、标题、Markdown 正文、OCR 结果、权限范围、所有者、状态 |
| `knowledge_chunks` | 文档分块及其 `embedding`（16 维哈希伪向量，不含语义），用于检索 |
| `knowledge_ingestion_jobs` | 上传解析任务 |
| `knowledge_extraction_results` | 实体与关系抽取结果，审核后可提交到图谱 |
| `knowledge_object_links` | 文档与业务对象的关联 |

### 2.10 AI 运行时（9）

| 表 | 用途 |
| --- | --- |
| `ai_conversations`、`ai_messages` | 会话与消息 |
| `ai_agent_runs` | 一次 Agent 运行：状态、输入、回答、步骤 `items`、证据、待确认动作、风险等级、确认载荷 |
| `ai_tool_calls` | 工具调用记录；目前只记录知识检索（`knowledge.search`）的证据 |
| `ai_confirmation_tokens` | 确认令牌的持久化存储，仅在 AI 安全策略 `persistConfirmations` 为真时使用（默认为假，令牌存在进程内存中）。Harness 主链路防止重复执行靠 `ai_agent_runs` 状态的条件更新 |
| `ai_drafts` | 无法直接落到表单时保存的 AI 草稿 |
| `ai_memory_entries` | 记忆条目，含可见性、敏感级别、过期时间。后台清理任务每小时运行一次，但 `memory.purge_expired` 目前为空操作，过期条目不会被删除 |
| `ai_agent_skill_definitions`、`ai_agent_tool_definitions` | 按租户管理的技能与工具注册表 |

## 3. 表单的两种存储方式

| 方面 | JSON 存储 | 物理表存储 |
| --- | --- | --- |
| `forms.storage_mode` | 非物理模式 | `physical_table` 或 `business_table` |
| 数据位置 | `dynamic_records.data` | `forms.table_name` 指向的表 |
| 加字段 | 只改元数据 | 由 `form_engine/physical.py` 执行加列 |
| 归档字段 | 只改元数据 | 保留物理列，不删除数据 |

两种方式都通过 `services/records.py` 读写，统一处理租户、权限、字段投影、编码、校验和审计。业务数据中的值不能覆盖记录的保留元数据（ID、状态、创建人等）。
`scripts/materialize_business_forms.py` 可把 JSON 存储的正式表单迁移到物理表，`scripts/archive_migrated_dynamic_records.py` 归档迁移后的旧记录。

新表单默认使用物理表：`POST /api/v1/forms` 收到 `storage_mode=dynamic` 且没有 `table_name` 时，会改为 `physical_table` 并按租户生成表名；复制表单（`services/form_admin.py`）和 AI 创建表单同样生成物理表。JSON 存储仍用于早期创建的表单。因此，表单配置并不都是“只改元数据”：创建物理表单和加字段会执行 `CREATE TABLE`、`ALTER TABLE`，统一由 `form_engine/physical.py` 完成，界面与 AI 的字段操作都经过 `services/form_fields.py`，AI 处理函数中不要另写建表语句。

一次配置到录入的过程依次写入这些表：

| 步骤 | 写入 |
| --- | --- |
| 创建应用 | `applications` |
| 在应用下创建表单 | `forms`、`application_forms`、默认的 `form_layouts` 与 `form_actions`；物理表单同时建表 |
| 添加字段 | `form_fields`；物理表单同时加列（校验字段名、类型和启用字段数量上限） |
| 配置页面、按钮、权限、审批 | `form_layouts`、`form_actions`、`form_permissions`、`workflow_bindings` |
| 装配菜单 | `application_forms`、`application_menu_nodes` |
| 发布 | `form_versions`（由 `services/form_versions.py` 校验后保存快照） |
| 录入业务数据 | `dynamic_records.data` 或表单物理表 |

运行时，应用菜单优先读取 `application_menu_nodes`，表单菜单指向前端 `/dynamic/<表单 ID 或编码>`。该页面按最新发布快照渲染字段；表单从未发布时，退回读取字段元数据。

## 4. Neo4j 图模型

节点标签（`NodeLabel`）：`Factory`、`Workshop`、`ProductionLine`、`Equipment`、`Sensor`、`Product`、`Material`、`SalesOrder`、`WorkOrder`、`Supplier`、`Customer`、`Warehouse`、`Inspection`、`Defect`、`Worker`。

关系类型（`RelType`）：`CONTAINS`、`PRODUCES`、`REQUIRES`、`SUPPLIES`、`INSPECTS`、`MAINTAINS`、`FEEDS`、`ASSIGNED_TO`、`STORED_IN`、`SHIPS_TO`、`FULFILLS`、`FOUND_IN`。

图数据由 `scripts/seed_data.py`（或 SQLite 演示种子）从 `data/seed/` 构建，`POST /api/v1/graph/sync/quality-demo` 也会写入。知识抽取“提交到图谱”（`services/ai/ontology_extraction.py`）按抽取出的实体类型写节点（缺省为 `KnowledgeCard`），关系统一为 `RELATED_TO`，这些标签不在上面的枚举中。Neo4j 不可用时，部分图谱接口使用 `services/graph_fallback.py` 降级。

## 5. 迁移历史

`0001_initial` 用**当前**模型执行 `create_all`：已有数据库是当年逐个迁移升级上来的，全新数据库则在第一步就建出全部表，后续迁移会跳过已存在的对象。`0021` 有两个并行迁移，在 `0022` 合并。

| 迁移 | 内容 |
| --- | --- |
| `0001`–`0005` | 初始结构、审计日志、规则、模型版本、应用 |
| `0006_platform_forms` | 表单平台基础表 |
| `0007`–`0009` | 通知资源、SaaS 租户、索引优化 |
| `0010`–`0013` | 初始化超级管理员、演示账号、演示应用角色、演示组织（密码从环境变量读取） |
| `0014`–`0017` | 知识抽取、AI Agent 运行时、知识 OCR 结果、AI 记忆扩展 |
| `0018`–`0020` | 系统设置、身份访问中心、租户开通 |
| `0021_form_versions`、`0021_tenant_operations` | 表单发布版本；租户运营 |
| `0022`、`0023` | 业务表租户隔离、SaaS 加固 |
| `0024`–`0028` | 应用装配种子、AI 草稿、菜单节点配置、本体中心、用户头像 |
| `0029_form_physical_tables` | 表单物理表 |
| `0030`–`0032` | 平台配置种子、角色启用状态、数据质量规则 |
| `0033`、`0034` | AI Agent items 协议、AI 注册表 |
| `0035`、`0036` | 表单编码流水号、本体映射布局 |
| `0037_workflow_def_versions` | 流程定义版本快照 |
| `0038_analytics_shared_metrics` | 共享指标库 |
| `0039_component_pages` | 组件页面 |
| `0040`–`0044` | 组件画布 AI 工具、内置技能创建器、注册表按租户隔离、应用菜单 AI 工具、组件页面 AI 工具 |

新增迁移的规则见[后端开发指南](../development/backend.md#6-数据库与迁移)。

## 6. 种子与演示数据

| 位置 | 内容 | 导入方式 |
| --- | --- | --- |
| `data/seed/*.json` | 16 张制造业主数据表 | `scripts/seed_data.py`（PostgreSQL）；SQLite 设置 `ENABLE_MANUFACTURING_DEMO_SEED=1` 后启动时导入 |
| `data/agent_registry/skills.json`、`tools.json` | AI 技能与工具注册表种子 | `POST /api/v1/ai/agent-registry/seed`，或 `scripts/register_*`、`upgrade_*` 增量脚本 |
| `data/knowledge_assets/` | 6 份演示知识文档（PDF、Word、Excel） | `scripts/seed_demo_knowledge.py` |
| `data/templates/manufacturing_demo/` | 行业模板清单 | 模板中心 |
| `data/simulators/generate_sample_data.py` | 生成演示数据的脚本 | 手动运行 |

`scripts/reseed_business_data.py` 可以在已有数据库中重新加载制造业主数据。
