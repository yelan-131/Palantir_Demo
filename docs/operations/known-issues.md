# 已知问题

更新日期：2026-11-17（对应代码版本 0.3.22 草稿）

本文汇总 2026-11-17 对照代码核对文档时发现、尚未修复的代码问题，供排期使用。每条注明代码位置；“已核实”表示读代码确认过调用链，“待验证”表示只读了代码、没有实际运行。修复后请从本文删除对应条目，并在当次发布说明中记录。

## 1. 安全

| # | 问题 | 位置 | 状态 |
| --- | --- | --- | --- |
| S1 | **OIDC 可伪造登录。** `exchange_oidc_code` 不区分运行模式，收到 `demo:` 开头的授权码就直接解码为用户声明，且这一判断在“OIDC 是否启用”检查之前。启用 OIDC 时，任何人可以先调用 `/auth/oidc/login-url` 取得合法 `state`，再向 `/auth/oidc/callback` 提交写有他人邮箱的伪造授权码，回调会按邮箱匹配到已有用户（包括管理员）并完成登录。未启用 OIDC 时 `login-url` 返回 503，此路径不可用 | `backend/app/services/iam.py` 的 `_decode_demo_claims`、`exchange_oidc_code`；`backend/app/api/auth.py` 的 `oidc_callback` | 已核实 |
| S2 | **数据源密码泄露。** 连接配置（含数据库密码）以明文保存；`GET /data-sources/{id}` 原样返回 `connection_config`，只对接口类型数据源限制为管理员，非管理员可读取数据库类型数据源的密码 | `backend/app/api/data_sources.py` 的 `get_data_source` | 已核实 |
| S3 | **Neo4j 与图谱资产没有租户隔离。** 图节点不带 `tenant_id`；`/graph/assets/*` 汇总所有租户已发布的数据；`/ontology` 的关系表回退查询没有租户条件 | `backend/app/services/graph_service.py`、`backend/app/api/graph.py`、`backend/app/api/ontology.py` | 待验证 |
| S4 | 身份安全设置存在平台级 `system_settings` 中，不区分租户，任一租户管理员可通过 `/admin/iam/settings` 修改 | `backend/app/services/iam.py`、`backend/app/api/admin.py` | 待验证 |
| S5 | `require_platform_mfa` 只在配置接口中返回，登录流程不据此强制 MFA | `backend/app/services/iam.py`、`backend/app/api/auth.py` | 待验证 |
| S6 | 任何登录用户都能通过 `POST /notifications` 给同租户的人发送通知 | `backend/app/api/notifications.py` 的 `create_notification` | 已核实 |
| S7 | `PUT /admin/applications/{id}/bindings` 不校验 `edit_token`，也不校验角色是否属于当前租户 | `backend/app/api/applications.py` | 待验证 |
| S8 | 后端没有请求频率限制（前端处理了 429，但后端不会返回） | — | 待验证 |

## 2. 部署与运维

| # | 问题 | 位置 | 状态 |
| --- | --- | --- | --- |
| D1 | **私有化全新安装会在迁移 `0010` 停止。** 部署脚本执行 `docker exec manufoundry-backend alembic upgrade head` 时不传 `PALANTIR_SEED_ADMIN_PASSWORD`，release compose 也不提供该变量。补救步骤见[私有化部署](private-deployment.md) | `scripts/deploy-private.sh`、`scripts/deploy-private.ps1`、`docker/docker-compose.release.yml` | 已核实 |
| D2 | **按模板私有化部署时后端启动失败。** `.env.private.example` 中 `SMTP_HOST` 为空，而生产模式启动时要求它；`scripts/doctor.py` 不检查这一项 | `.env.private.example`、`backend/app/config.py` 的 `validate_runtime` | 已核实 |
| D3 | 离线环境无法回滚：回滚脚本先改写 `.env`，随后必须执行 `pull` | `scripts/rollback-private.sh`、`.ps1` | 待验证 |
| D4 | 知识库原始文件目录 `KNOWLEDGE_STORAGE_DIR` 在生产与 release compose 中没有挂载卷，容器重建后丢失 | `docker/docker-compose.prod.yml`、`docker/docker-compose.release.yml` | 待验证 |
| D5 | `/system/readiness` 判定 `strongSecret` 使用的弱密钥列表与 `validate_runtime` 不一致，默认演示密钥会被判为强密钥；`postgresRequired` 要求显式设置 `DATABASE_BACKEND=postgresql`，默认值 `auto` 被判为未就绪 | `backend/app/main.py`、`backend/app/config.py` | 待验证 |
| D6 | `AI_PROVIDER=mock` 不在支持的提供方列表中，会被当作 `glm` 处理 | `backend/app/services/ai/settings.py` | 待验证 |
| D7 | `register_demo_external_sources.py` 请求时不带登录令牌，现在会返回 401 | `scripts/register_demo_external_sources.py` | 待验证 |

## 3. 功能缺陷

| # | 问题 | 位置 | 状态 |
| --- | --- | --- | --- |
| F1 | **知识检索没有语义能力。** 入库文档的“向量”是整段文本 SHA-256 摘要切成的 16 个数；词面打分只识别英文字母与数字，中文查询的词面分为 0，排序基本随机 | `backend/app/services/ai/providers.py` 的 `_stable_embedding`、`backend/app/services/ai/knowledge_ingestion.py` 的 `lexical_score` | 已核实 |
| F2 | 记录读写接口不检查表单状态，停用的表单仍可读写记录 | `backend/app/services/records.py` | 已核实 |
| F3 | 删除草稿表单会级联删除 `dynamic_records`，但物理表留在库中；已分配过编码的草稿删除时可能因 `form_code_sequences` 外键失败（待验证） | `backend/app/services/form_admin.py` | 已核实（外键部分待验证） |
| F4 | 字段编码规则前后端不一致：字段结构面板允许大写字母和下划线开头，后端只接受 `^[a-z][a-z0-9_]*$`，返回 400 | 前端字段结构面板、`backend/app/core/identifiers.py` 的 `assert_safe_identifier` | 待验证 |
| F5 | 复制表单会原样复制 `config` 中的 `componentPageCode` 和流程定义 ID，新表单仍指向源表单的组件页面与流程 | `backend/app/services/form_admin.py` 的 `copy_form` | 已核实 |
| F6 | 设计器发布不是原子操作：先保存流程定义与绑定再发布表单，表单发布被拒绝时流程修改已经生效 | `frontend/src/pages/FormSettings/index.tsx` 的 `confirmPublish` | 已核实 |
| F7 | 后端不要求表单至少有一个字段；前端只在“应用与菜单”的发布按钮中检查，设计器发布不检查 | `backend/app/services/form_versions.py`、`frontend/src/pages/SystemAdmin/AppMenuManagement.tsx` | 待验证 |
| F8 | `/admin/applications` 不校验状态取值与流转：新建默认 `published`，任何状态都能删除；发布不做完整性检查；租户没有应用时返回 409 导致“应用与菜单”加载失败 | `backend/app/services/applications.py` | 待验证 |
| F9 | 删除表单菜单节点后 `application_forms` 绑定保留，应用可见角色仍间接拥有该表单权限 | `backend/app/services/application_menu_nodes.py` | 待验证 |
| F10 | 模板中心提示“已成功应用”，但 `templates/{id}/instantiate` 只返回 `packaged` 状态，没有导入任何内容 | `backend/app/api/templates.py`、模板中心页面 | 待验证 |
| F11 | 导出只导出当前一页 | `frontend/src/pages/DynamicPage/index.tsx` 的 `exportPage` | 待验证 |
| F12 | 角色权限界面的动作下拉中没有“导入”，无法单独授予批量导入所需的权限 | `frontend/src/pages/SystemAdmin/RoleManagement.tsx` | 待验证 |
| F14 | 图谱种子用 `CREATE` 写关系，重复运行会产生重复的边 | `backend/app/services/graph_service.py` | 待验证 |
| F15 | 前端“其他数据源”列出 MongoDB、Kafka、OPC UA 等后端不支持的类型，保存后变成 `postgresql` | 数据中心数据源页面、`backend/app/api/data_sources.py` 的 `_normalize_data_source_type` | 待验证 |
| F16 | 前端会显示“已退回”状态，但后端 `/act` 只接受通过和驳回，没有“退回修改” | `backend/app/api/workflow.py` | 待验证 |
| F17 | 审批设置组件 `components/FormApprovalSettings` 没有页面引用，`/approval-settings` 没有界面入口；`form_actions` 表在运行时没有任何读取方 | `frontend/src/components/FormApprovalSettings`、`backend/app/models/relational.py` | 待验证 |
| F18 | AI 记忆清理任务每小时运行，但 `purge_expired` 为空操作；AI 审计只写进程内环形缓冲区，重启后丢失 | `backend/app/services/ai/memory.py`、`backend/app/services/ai/audit.py` | 已核实 |
| F19 | 应用可见角色没有编辑界面，“应用访问”只读展示 | 应用配置页面、`backend/app/api/applications.py` | 待验证 |

## 4. 未使用的代码

以下代码没有被引用，可在确认后删除：

- `frontend/src/config/readyPathSmoke.ts`（其中 `/system-admin`、`/reports` 也已不是现行路由）。
- `frontend/src/pages/Workflow/` 下的 `MyApprovals`、`MyApplications`、`WorkflowList`、`DispatchLog`。
- 没有挂路由的旧页面：`pages/Quality`、`AIAssistant`、`RuleEngine`、`ReportCenter`、`Maintenance`、`SupplyChain`。
- `backend/app/api/applications.py` 中的 `DEFAULT_*`、`_mock_*`、`_ensure_default_seed`、`_rule_actions_match`、`_menu_rule_subject_matches`。
- `backend/app/api/deps.py` 中的 `require_permission`、`require_form_permission`（没有路由使用）。
- `send_notification` 没有调用方。
