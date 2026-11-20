# API 参考

更新日期 2026-11-20，对应代码版本 0.3.26。

接口以代码为准：路由挂载见 `backend/app/main.py`，各模块实现见 `backend/app/api/*.py`。
第 6 节的接口清单由 `scripts/docs/generate_api_reference.py` 静态解析路由装饰器生成，不需要安装后端依赖。
接口有增删或访问要求变化时，运行 `python scripts/docs/generate_api_reference.py` 重新生成，`--check` 参数可检查文档是否过期；不要手工逐条修改清单。

## 1. 访问地址

| 环境 | 基础地址 | 说明 |
| --- | --- | --- |
| 本地后端 | `http://localhost:8000/api/v1` | 演示模式下可打开 `http://localhost:8000/docs` 查看 Swagger |
| 本地前端代理 | `http://localhost:3000/api/v1` | Vite 开发服务器把 `/api` 转发到 `VITE_API_PROXY_TARGET`（默认 `http://localhost:8000`） |
| 生产环境 | `http://<服务器地址>/api/v1` | 由前端 nginx 转发；后端 `8000` 端口只绑定服务器本机，公网不可直接访问 |

`APP_MODE=production` 时，`/docs`、`/redoc` 和 `/openapi.json` 关闭。

## 2. 认证

登录：

```bash
curl -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"<用户名>","password":"<密码>"}'
```

请求体字段：`username`、`password`，可选 `tenant_id`、`mfa_code`。
成功时返回 `token`、`user`、`requires_mfa`、`requires_password_change`，并同时写入 HttpOnly Cookie `access_token`。
开启了 MFA 的账号首次返回 `requires_mfa: true`，需要带 `mfa_code` 再次登录。

后续请求携带令牌：

```http
Authorization: Bearer <token>
```

后端优先读取 `Authorization` 头，没有时读取 `access_token` Cookie。前端把令牌保存在 `localStorage` 的 `mf_token` 中。
令牌有效期由 `ACCESS_TOKEN_EXPIRE_MINUTES` 控制，默认 480 分钟。

每次鉴权（`app/api/deps.py` 的 `get_current_user`）除了校验签名，还会重新检查：账号仍启用、账号所属租户与令牌一致、租户状态为 `active`、令牌中的会话（`sid`）未过期或被撤销。任一不满足都返回 `401`。

## 3. 访问级别

下表中的“访问要求”列取自路由或路由器上声明的依赖：

| 标记 | 含义 | 实现 |
| --- | --- | --- |
| 公开 | 不需要令牌 | 见下方公开接口清单 |
| 登录 | 需要有效令牌；业务规则（表单权限、记录范围、字段权限、审批人身份等）在服务层继续校验 | `get_current_user` |
| 管理员 | 当前租户的管理员 | `require_admin` |
| 平台管理员 | 租户 1 的管理员 | `require_platform_admin` |
| 读：登录；写：平台管理员 | `GET/HEAD/OPTIONS` 只需登录，其他方法需要平台管理员 | `require_platform_admin_for_writes`（`/model-driven/*`） |

“登录”并不代表所有登录用户都能成功调用：例如 `/forms/{form_id}/records` 会在 `services/records.py` 中按表单的查看、新增、编辑、删除权限和数据范围拦截，部分接口在服务层再调用 `ensure_admin`。

公开接口（由 `backend/tests/test_route_auth_coverage.py` 的 `PUBLIC_ROUTES` 锁定，新增公开接口必须同步修改该测试）：

| 方法 | 路径 |
| --- | --- |
| `GET` | `/` |
| `GET` | `/health` |
| `GET` | `/api/v1/system/readiness` |
| `GET` | `/api/v1/release/current` |
| `GET` | `/api/v1/productization/readiness` |
| `POST` | `/api/v1/auth/login` |
| `POST` | `/api/v1/auth/invite/accept` |
| `GET` | `/api/v1/auth/oidc/config` |
| `POST` | `/api/v1/auth/oidc/login-url` |
| `POST` | `/api/v1/auth/oidc/callback` |
| `POST` | `/api/v1/auth/password-reset/request` |
| `POST` | `/api/v1/auth/password-reset/confirm` |
| `POST` | `/api/v1/ai/harness/mcp`（不校验用户令牌，由处理函数校验短时有效的桥接令牌） |

另外，`GET /api/v1/tenant/profile/public` 虽然名称带 public，当前仍要求登录。

## 4. 通用约定

- 响应头 `x-request-id`：沿用请求头中的值，没有时由后端生成，便于在日志中定位请求。
- 未处理异常统一返回 `500`，响应体为 `{"detail": "Internal server error", "type": "<异常类名>"}`，详细堆栈只写入后端日志。
- `401` 表示未登录或会话失效，前端收到后清除本地令牌并跳转 `/login`；`403` 表示已登录但权限不足。
- 跨域：`CORS_ORIGINS` 包含 `*` 时不允许携带凭据；生产模式禁止使用 `*`。

## 5. 模块总览

| 前缀（`/api/v1` 之后） | 路由文件 | 职责 |
| --- | --- | --- |
| `/system` | `main.py` | 就绪检查（数据库、迁移、SMTP、存储、生产配置）与进程内请求指标 |
| `/auth` | `auth.py` | 登录登出、当前用户、改密、邀请注册、找回密码、MFA、OIDC |
| `/admin` | `admin.py`、`applications.py` | 用户、角色、组织、会话、身份设置、权限模拟、审计日志、基础数据；应用的新建、修改、删除与绑定 |
| `/platform` | `platform.py` | 平台管理员的租户开通、邀请、重置密码与租户导出 |
| `/tenant` | `tenant.py` | 当前租户的展示信息（产品名、助手名） |
| `/applications` | `applications.py` | 当前用户可见的应用及其运行态菜单 |
| `/forms` | `forms.py`、`form_approvals.py` | 表单定义、字段、布局、动作、权限、版本与发布、规则计算、业务记录、导入导出、附件、应用表单绑定、菜单节点、审批设置 |
| `/pages` | `component_pages.py` | 组件页面（业务列表、筛选、指标、图表）的草稿、预览、发布、版本，表单页面绑定、工作台首页、权限模板 |
| `/workflow` | `workflow.py` | 流程定义与版本快照、实例、审批、驳回、取消、自动下发、流程通知、统一待办 |
| `/alerts` | `alerts.py` | 告警中心 |
| `/material-applications` | `material_applications.py` | 料号申请 |
| `/notifications` | `notifications.py` | 站内通知 |
| `/dashboard` | `dashboard.py` | 运营总览、OEE、产量、告警、程序页数据、分析看板编辑与版本、共享指标库 |
| `/analytics` | `analytics.py` | 聚合、时序、分布等图表数据 |
| `/maintenance` | `maintenance.py` | 设备健康、故障预测、维修工单 |
| `/quality` | `quality.py` | SPC、缺陷、检验、CAPA、质量事件影响与追溯 |
| `/supply-chain` | `supply_chain.py` | 供应商、库存、发运、风险评估 |
| `/reports` | `reports.py` | 报表定义与快照 |
| `/data-sources` | `data_sources.py` | 数据源管理、连接测试、元数据扫描、数据预览与同步 |
| `/pipelines` | `pipeline.py` | 数据管道与运行记录 |
| `/semantic-assets` | `semantic_assets.py` | 数据资产、本体对象与关系、本体候选与发布、语义映射工作台、页面契约 |
| `/ontology` | `ontology.py` | 实体类型、实例、关系与时间线 |
| `/graph` | `graph.py` | Neo4j 只读查询、邻居、路径、子图、影响分析、追溯 |
| `/knowledge` | `knowledge.py` | 知识空间与目录、文档上传与解析、OCR、分块、抽取任务、检索、知识卡片、知识问答会话 |
| `/ai` | `ai_assistant.py`、`ai_harness.py` | AI 对话与 Agent 运行、确认与取消、会话、记忆、草稿、模型设置、技能和工具注册表、Harness MCP 桥 |
| `/ai-builder` | `ai_builder.py` | 根据描述建议数据模型或页面 |
| `/model-driven` | `model_driven*.py` | 旧版元模型、页面配置、白名单表的数据读写与菜单 |
| `/rules` | `rules.py` | 校验规则与触发器 |
| `/scheduler` | `scheduler.py` | 定时任务 |
| `/search` | `search.py` | 跨实体搜索 |
| `/templates` | `templates.py` | 模板市场与模板实例化 |
| `/config` | `config_io.py` | 平台配置导入导出 |
| `/release` | `release.py` | 读取 `release.json` 中的当前版本与历史记录 |
| `/productization` | `productization.py` | 首个 SaaS 可用路径与模块成熟度 |

## 6. 接口清单

路径省略 `/api/v1` 前缀（`/` 与 `/health` 除外）。处理函数格式为 `模块.函数名`，可直接在 `backend/app/api/` 中搜索。

<!-- api-routes:start -->
共 427 个接口。

### 根路径（2）

| 方法 | 路径 | 访问要求 | 处理函数 |
| --- | --- | --- | --- |
| `GET` | `/` | 公开 | `main.root` |
| `GET` | `/health` | 公开 | `main.health` |

### `admin`（28）

| 方法 | 路径 | 访问要求 | 处理函数 |
| --- | --- | --- | --- |
| `GET` | `/admin/applications` | 管理员 | `applications.admin_list_applications` |
| `POST` | `/admin/applications` | 管理员 | `applications.admin_create_application` |
| `PUT` | `/admin/applications/order` | 管理员 | `applications.admin_reorder_applications` |
| `PUT` | `/admin/applications/{app_id}` | 管理员 | `applications.admin_update_application` |
| `DELETE` | `/admin/applications/{app_id}` | 管理员 | `applications.admin_delete_application` |
| `PUT` | `/admin/applications/{app_id}/bindings` | 管理员 | `applications.admin_update_application_bindings` |
| `GET` | `/admin/audit-logs` | 管理员 | `admin.list_audit_logs` |
| `GET` | `/admin/iam/settings` | 管理员 | `admin.get_iam_settings` |
| `PUT` | `/admin/iam/settings` | 管理员 | `admin.update_iam_settings` |
| `GET` | `/admin/org-units` | 管理员 | `admin.list_org_units` |
| `POST` | `/admin/org-units` | 管理员 | `admin.create_org_unit` |
| `PUT` | `/admin/org-units/{org_id}` | 管理员 | `admin.update_org_unit` |
| `DELETE` | `/admin/org-units/{org_id}` | 管理员 | `admin.delete_org_unit` |
| `POST` | `/admin/permissions/simulate` | 管理员 | `admin.simulate_permission` |
| `GET` | `/admin/reference-data` | 管理员 | `admin.get_reference_data` |
| `PUT` | `/admin/reference-data` | 管理员 | `admin.save_reference_data` |
| `GET` | `/admin/role-templates` | 管理员 | `admin.list_role_templates` |
| `GET` | `/admin/roles` | 管理员 | `admin.list_roles` |
| `POST` | `/admin/roles` | 管理员 | `admin.create_role` |
| `DELETE` | `/admin/roles/{role_id}` | 管理员 | `admin.delete_role` |
| `PUT` | `/admin/roles/{role_id}/permissions` | 管理员 | `admin.set_permissions` |
| `POST` | `/admin/sessions/{session_id}/revoke` | 管理员 | `admin.revoke_user_session` |
| `GET` | `/admin/users` | 管理员 | `admin.list_users` |
| `POST` | `/admin/users` | 管理员 | `admin.create_user` |
| `PUT` | `/admin/users/{user_id}` | 管理员 | `admin.update_user` |
| `DELETE` | `/admin/users/{user_id}` | 管理员 | `admin.delete_user` |
| `PUT` | `/admin/users/{user_id}/security` | 管理员 | `admin.update_user_security` |
| `GET` | `/admin/users/{user_id}/sessions` | 管理员 | `admin.list_user_sessions` |

### `ai`（42）

| 方法 | 路径 | 访问要求 | 处理函数 |
| --- | --- | --- | --- |
| `POST` | `/ai/agent` | 登录 | `ai_assistant.agent_chat` |
| `GET` | `/ai/agent-registry` | 管理员 | `ai_assistant.get_agent_registry` |
| `PUT` | `/ai/agent-registry` | 管理员 | `ai_assistant.update_agent_registry` |
| `POST` | `/ai/agent-registry/parse-skill` | 管理员 | `ai_assistant.parse_registry_skill` |
| `POST` | `/ai/agent-registry/seed` | 管理员 | `ai_assistant.seed_agent_registry` |
| `GET` | `/ai/agent-registry/skill-instructions/{name}` | 管理员 | `ai_assistant.get_registry_skill_instructions` |
| `POST` | `/ai/agent-runs` | 登录 | `ai_assistant.create_ai_agent_run` |
| `GET` | `/ai/agent-runs/{run_id}` | 登录 | `ai_assistant.get_ai_agent_run` |
| `POST` | `/ai/agent-runs/{run_id}/cancel` | 登录 | `ai_assistant.cancel_ai_agent_run` |
| `POST` | `/ai/agent-runs/{run_id}/configuration-review` | 登录 | `ai_assistant.edit_ai_configuration_review` |
| `POST` | `/ai/agent-runs/{run_id}/confirm` | 登录 | `ai_assistant.confirm_ai_agent_run` |
| `POST` | `/ai/agent-runs/{run_id}/confirm/stream` | 登录 | `ai_assistant.confirm_ai_agent_run_stream` |
| `POST` | `/ai/agent-runs/{run_id}/record-review` | 登录 | `ai_assistant.get_ai_record_review` |
| `POST` | `/ai/agent-runs/{run_id}/record-review/revise` | 登录 | `ai_assistant.revise_ai_record_review` |
| `POST` | `/ai/agent/attachment-preview` | 登录 | `ai_assistant.preview_agent_attachment` |
| `GET` | `/ai/agent/conversations` | 登录 | `ai_assistant.list_agent_conversations` |
| `POST` | `/ai/agent/conversations` | 登录 | `ai_assistant.create_agent_conversation` |
| `PATCH` | `/ai/agent/conversations/{conversation_id}` | 登录 | `ai_assistant.update_agent_conversation` |
| `DELETE` | `/ai/agent/conversations/{conversation_id}` | 登录 | `ai_assistant.close_agent_conversation` |
| `POST` | `/ai/agent/conversations/{conversation_id}/confirmations/{run_id}/continue` | 登录 | `ai_assistant.continue_saved_ai_confirmation` |
| `POST` | `/ai/agent/conversations/{conversation_id}/confirmations/{run_id}/stop` | 登录 | `ai_assistant.stop_ai_confirmation_follow_up` |
| `GET` | `/ai/agent/conversations/{conversation_id}/confirmations/{run_id}/stream` | 登录 | `ai_assistant.resume_ai_confirmation_stream` |
| `GET` | `/ai/agent/conversations/{conversation_id}/messages` | 登录 | `ai_assistant.list_agent_conversation_messages` |
| `POST` | `/ai/agent/stream` | 登录 | `ai_assistant.agent_chat_stream` |
| `POST` | `/ai/analyze` | 登录 | `ai_assistant.smart_analyze` |
| `GET` | `/ai/audit` | 管理员 | `ai_assistant.list_ai_audit_logs` |
| `POST` | `/ai/chat` | 登录 | `ai_assistant.chat` |
| `GET` | `/ai/drafts` | 登录 | `ai_assistant.list_ai_drafts` |
| `POST` | `/ai/drafts/save` | 登录 | `ai_assistant.save_ai_draft` |
| `POST` | `/ai/harness/mcp` | 公开 | `ai_harness.harness_mcp` |
| `GET` | `/ai/memories` | 登录 | `ai_assistant.list_ai_memories` |
| `DELETE` | `/ai/memories/{memory_id}` | 登录 | `ai_assistant.delete_ai_memory` |
| `POST` | `/ai/page-actions/{action_id}/result` | 登录 | `ai_assistant.receive_page_action_result` |
| `POST` | `/ai/provider/test` | 平台管理员 | `ai_assistant.test_provider` |
| `GET` | `/ai/sessions` | 登录 | `ai_assistant.list_sessions` |
| `GET` | `/ai/settings` | 管理员 | `ai_assistant.get_ai_settings` |
| `PUT` | `/ai/settings` | 平台管理员 | `ai_assistant.update_ai_settings` |
| `POST` | `/ai/settings/effective` | 管理员 | `ai_assistant.preview_effective_ai_settings` |
| `GET` | `/ai/settings/harness-update` | 管理员 | `ai_assistant.check_harness_updates` |
| `POST` | `/ai/settings/test` | 平台管理员 | `ai_assistant.test_saved_ai_settings` |
| `GET` | `/ai/skills` | 登录 | `ai_assistant.get_ai_skills` |
| `GET` | `/ai/tools` | 登录 | `ai_assistant.get_ai_tools` |

### `ai-builder`（2）

| 方法 | 路径 | 访问要求 | 处理函数 |
| --- | --- | --- | --- |
| `POST` | `/ai-builder/suggest-model` | 登录 | `ai_builder.suggest_model` |
| `POST` | `/ai-builder/suggest-page` | 登录 | `ai_builder.suggest_page` |

### `alerts`（4）

| 方法 | 路径 | 访问要求 | 处理函数 |
| --- | --- | --- | --- |
| `GET` | `/alerts` | 登录 | `alerts.list_alerts` |
| `POST` | `/alerts` | 登录 | `alerts.create_alert` |
| `GET` | `/alerts/{alert_id}` | 登录 | `alerts.get_alert` |
| `POST` | `/alerts/{alert_id}/actions` | 登录 | `alerts.act_on_alert` |

### `analytics`（4）

| 方法 | 路径 | 访问要求 | 处理函数 |
| --- | --- | --- | --- |
| `GET` | `/analytics/aggregate` | 登录 | `analytics.aggregate` |
| `GET` | `/analytics/distribution` | 登录 | `analytics.distribution` |
| `GET` | `/analytics/overview` | 登录 | `analytics.analytics_overview` |
| `GET` | `/analytics/timeseries` | 登录 | `analytics.timeseries` |

### `applications`（3）

| 方法 | 路径 | 访问要求 | 处理函数 |
| --- | --- | --- | --- |
| `GET` | `/applications` | 登录 | `applications.list_applications` |
| `GET` | `/applications/{app_id}` | 登录 | `applications.get_application` |
| `GET` | `/applications/{app_id}/menus` | 登录 | `applications.list_application_menus` |

### `auth`（13）

| 方法 | 路径 | 访问要求 | 处理函数 |
| --- | --- | --- | --- |
| `POST` | `/auth/change-password` | 登录 | `auth.change_password` |
| `POST` | `/auth/invite/accept` | 公开 | `auth.accept_invite` |
| `POST` | `/auth/login` | 公开 | `auth.login` |
| `POST` | `/auth/logout` | 登录 | `auth.logout` |
| `GET` | `/auth/me` | 登录 | `auth.get_me` |
| `POST` | `/auth/mfa/disable` | 登录 | `auth.disable_mfa` |
| `POST` | `/auth/mfa/enable` | 登录 | `auth.enable_mfa` |
| `POST` | `/auth/mfa/setup` | 登录 | `auth.setup_mfa` |
| `POST` | `/auth/oidc/callback` | 公开 | `auth.oidc_callback` |
| `GET` | `/auth/oidc/config` | 公开 | `auth.oidc_config` |
| `POST` | `/auth/oidc/login-url` | 公开 | `auth.oidc_login_url` |
| `POST` | `/auth/password-reset/confirm` | 公开 | `auth.confirm_password_reset` |
| `POST` | `/auth/password-reset/request` | 公开 | `auth.request_password_reset` |

### `config`（3）

| 方法 | 路径 | 访问要求 | 处理函数 |
| --- | --- | --- | --- |
| `GET` | `/config/export` | 平台管理员 | `config_io.export_all_config` |
| `GET` | `/config/export/{model_name}` | 平台管理员 | `config_io.export_single_model_config` |
| `POST` | `/config/import` | 平台管理员 | `config_io.import_config` |

### `dashboard`（18）

| 方法 | 路径 | 访问要求 | 处理函数 |
| --- | --- | --- | --- |
| `GET` | `/dashboard/alerts` | 登录 | `dashboard.get_alerts` |
| `GET` | `/dashboard/analytics/metrics` | 管理员 | `dashboard.list_shared_metrics` |
| `POST` | `/dashboard/analytics/metrics` | 管理员 | `dashboard.create_shared_metric` |
| `GET` | `/dashboard/analytics/metrics/{metric_id}` | 管理员 | `dashboard.get_shared_metric` |
| `PUT` | `/dashboard/analytics/metrics/{metric_id}/draft` | 管理员 | `dashboard.save_shared_metric` |
| `POST` | `/dashboard/analytics/metrics/{metric_id}/impact` | 管理员 | `dashboard.shared_metric_impact` |
| `POST` | `/dashboard/analytics/metrics/{metric_id}/publish` | 管理员 | `dashboard.publish_shared_metric` |
| `GET` | `/dashboard/analytics/metrics/{metric_id}/references` | 管理员 | `dashboard.shared_metric_references` |
| `GET` | `/dashboard/oee` | 登录 | `dashboard.get_oee` |
| `GET` | `/dashboard/overview` | 登录 | `dashboard.get_overview` |
| `GET` | `/dashboard/production` | 登录 | `dashboard.get_production_stats` |
| `GET` | `/dashboard/programs/{program_id}` | 登录 | `dashboard.get_program_data` |
| `PUT` | `/dashboard/programs/{program_id}/analytics/draft` | 管理员 | `dashboard.save_analytics_draft` |
| `GET` | `/dashboard/programs/{program_id}/analytics/editor` | 管理员 | `dashboard.get_analytics_editor` |
| `POST` | `/dashboard/programs/{program_id}/analytics/preview` | 管理员 | `dashboard.preview_analytics` |
| `POST` | `/dashboard/programs/{program_id}/analytics/publish` | 管理员 | `dashboard.publish_analytics` |
| `GET` | `/dashboard/programs/{program_id}/analytics/versions` | 管理员 | `dashboard.list_analytics_versions` |
| `GET` | `/dashboard/programs/{program_id}/analytics/versions/{version_number}` | 管理员 | `dashboard.get_analytics_version` |

### `data-sources`（19）

| 方法 | 路径 | 访问要求 | 处理函数 |
| --- | --- | --- | --- |
| `GET` | `/data-sources` | 登录 | `data_sources.list_data_sources` |
| `POST` | `/data-sources` | 登录 | `data_sources.create_data_source` |
| `POST` | `/data-sources/test-config` | 管理员 | `data_sources.test_connection_config` |
| `GET` | `/data-sources/{source_id}` | 登录 | `data_sources.get_data_source` |
| `PUT` | `/data-sources/{source_id}` | 登录 | `data_sources.update_data_source` |
| `DELETE` | `/data-sources/{source_id}` | 登录 | `data_sources.delete_data_source` |
| `POST` | `/data-sources/{source_id}/mapped-form-sync` | 管理员 | `data_sources.sync_mapped_form` |
| `GET` | `/data-sources/{source_id}/mapped-form-sync-bindings` | 管理员 | `data_sources.list_mapped_form_sync_bindings` |
| `POST` | `/data-sources/{source_id}/mapped-form-sync-bindings` | 管理员 | `data_sources.save_mapped_form_sync_binding` |
| `GET` | `/data-sources/{source_id}/mapped-form-sync-bindings/{binding_id}/runs` | 管理员 | `data_sources.list_mapped_form_sync_runs` |
| `POST` | `/data-sources/{source_id}/mapped-form-sync-bindings/{binding_id}/runs` | 管理员 | `data_sources.run_mapped_form_sync_binding` |
| `GET` | `/data-sources/{source_id}/metadata` | 登录 | `data_sources.get_metadata` |
| `POST` | `/data-sources/{source_id}/metadata-scan` | 登录 | `data_sources.scan_metadata` |
| `GET` | `/data-sources/{source_id}/preview` | 登录 | `data_sources.preview_data` |
| `POST` | `/data-sources/{source_id}/sample` | 登录 | `data_sources.sample_metadata` |
| `GET` | `/data-sources/{source_id}/status` | 登录 | `data_sources.get_sync_status` |
| `POST` | `/data-sources/{source_id}/sync` | 登录 | `data_sources.trigger_sync` |
| `GET` | `/data-sources/{source_id}/sync-status` | 登录 | `data_sources.get_sync_status` |
| `POST` | `/data-sources/{source_id}/test` | 登录 | `data_sources.test_connection` |

### `forms`（57）

| 方法 | 路径 | 访问要求 | 处理函数 |
| --- | --- | --- | --- |
| `GET` | `/forms` | 登录 | `forms.list_forms` |
| `POST` | `/forms` | 管理员 | `forms.create_form` |
| `GET` | `/forms/applications/{application_id}/forms` | 管理员 | `forms.list_application_form_bindings` |
| `PUT` | `/forms/applications/{application_id}/forms` | 管理员 | `forms.upsert_application_form_binding` |
| `DELETE` | `/forms/applications/{application_id}/forms/{form_id}` | 管理员 | `forms.delete_application_form_binding` |
| `GET` | `/forms/applications/{application_id}/menu-nodes` | 管理员 | `forms.list_application_menu_nodes` |
| `POST` | `/forms/applications/{application_id}/menu-nodes` | 管理员 | `forms.create_application_menu_node` |
| `POST` | `/forms/applications/{application_id}/menu-nodes/paste` | 管理员 | `forms.paste_menu_nodes` |
| `PUT` | `/forms/applications/{application_id}/menu-nodes/{node_id}` | 管理员 | `forms.update_application_menu_node` |
| `DELETE` | `/forms/applications/{application_id}/menu-nodes/{node_id}` | 管理员 | `forms.delete_application_menu_node` |
| `PUT` | `/forms/applications/{application_id}/menu-order` | 管理员 | `forms.save_application_menu_order` |
| `GET` | `/forms/code/{form_code}` | 登录 | `forms.get_form_by_code` |
| `GET` | `/forms/reference-sources` | 管理员 | `forms.form_reference_sources` |
| `GET` | `/forms/{form_id}` | 登录 | `forms.get_form` |
| `PUT` | `/forms/{form_id}` | 管理员 | `forms.update_form` |
| `DELETE` | `/forms/{form_id}` | 管理员 | `forms.delete_form` |
| `GET` | `/forms/{form_id}/actions` | 登录 | `forms.list_form_actions` |
| `POST` | `/forms/{form_id}/actions` | 管理员 | `forms.create_form_action` |
| `PUT` | `/forms/{form_id}/actions/{action_id}` | 管理员 | `forms.update_form_action` |
| `DELETE` | `/forms/{form_id}/actions/{action_id}` | 管理员 | `forms.delete_form_action` |
| `GET` | `/forms/{form_id}/approval-settings` | 管理员 | `form_approvals.get_settings` |
| `PUT` | `/forms/{form_id}/approval-settings` | 管理员 | `form_approvals.put_settings` |
| `POST` | `/forms/{form_id}/copy` | 管理员 | `forms.copy_form` |
| `POST` | `/forms/{form_id}/draft/restore` | 管理员 | `forms.restore_form_draft` |
| `POST` | `/forms/{form_id}/fields` | 管理员 | `forms.create_form_field` |
| `PUT` | `/forms/{form_id}/fields/{field_id}` | 管理员 | `forms.update_form_field` |
| `DELETE` | `/forms/{form_id}/fields/{field_id}` | 管理员 | `forms.archive_form_field` |
| `POST` | `/forms/{form_id}/fields/{field_name}/files` | 登录 | `forms.upload_form_file` |
| `GET` | `/forms/{form_id}/fields/{field_name}/files/{file_id}` | 登录 | `forms.download_form_file` |
| `POST` | `/forms/{form_id}/fields/{field_name}/options` | 登录 | `forms.form_reference_options` |
| `POST` | `/forms/{form_id}/fields/{field_name}/options/preview` | 管理员 | `forms.preview_form_reference_options` |
| `POST` | `/forms/{form_id}/fields/{field_name}/options/schema/preview` | 管理员 | `forms.preview_option_search_schema` |
| `POST` | `/forms/{form_id}/imports` | 登录 | `forms.execute_form_import` |
| `POST` | `/forms/{form_id}/imports/preview` | 登录 | `forms.preview_form_import` |
| `GET` | `/forms/{form_id}/layouts` | 登录 | `forms.list_form_layouts` |
| `PUT` | `/forms/{form_id}/layouts/{layout_type}` | 管理员 | `forms.upsert_form_layout` |
| `GET` | `/forms/{form_id}/permissions` | 管理员 | `forms.list_form_permissions` |
| `POST` | `/forms/{form_id}/permissions` | 管理员 | `forms.create_form_permission` |
| `PUT` | `/forms/{form_id}/permissions/{permission_id}` | 管理员 | `forms.update_form_permission` |
| `DELETE` | `/forms/{form_id}/permissions/{permission_id}` | 管理员 | `forms.delete_form_permission` |
| `POST` | `/forms/{form_id}/publish` | 管理员 | `forms.publish_form` |
| `GET` | `/forms/{form_id}/publish/preview` | 管理员 | `forms.preview_form_publish` |
| `GET` | `/forms/{form_id}/records` | 登录 | `forms.list_dynamic_records` |
| `POST` | `/forms/{form_id}/records` | 登录 | `forms.create_dynamic_record` |
| `GET` | `/forms/{form_id}/records-export` | 登录 | `forms.export_records_page` |
| `GET` | `/forms/{form_id}/records/{record_id}` | 登录 | `forms.get_dynamic_record` |
| `PUT` | `/forms/{form_id}/records/{record_id}` | 登录 | `forms.update_dynamic_record` |
| `DELETE` | `/forms/{form_id}/records/{record_id}` | 登录 | `forms.delete_dynamic_record` |
| `POST` | `/forms/{form_id}/records/{record_id}/submit` | 登录 | `forms.submit_form_application` |
| `POST` | `/forms/{form_id}/rules/evaluate` | 登录 | `forms.evaluate_form_rules` |
| `POST` | `/forms/{form_id}/rules/preview` | 管理员 | `forms.preview_designer_rules` |
| `GET` | `/forms/{form_id}/versions` | 登录 | `forms.list_form_versions` |
| `GET` | `/forms/{form_id}/versions/{version_number}` | 登录 | `forms.get_form_version` |
| `GET` | `/forms/{form_id}/workflow-bindings` | 管理员 | `forms.list_workflow_bindings` |
| `POST` | `/forms/{form_id}/workflow-bindings` | 管理员 | `forms.create_workflow_binding` |
| `PUT` | `/forms/{form_id}/workflow-bindings/{binding_id}` | 管理员 | `forms.update_workflow_binding` |
| `DELETE` | `/forms/{form_id}/workflow-bindings/{binding_id}` | 管理员 | `forms.delete_workflow_binding` |

### `graph`（18）

| 方法 | 路径 | 访问要求 | 处理函数 |
| --- | --- | --- | --- |
| `GET` | `/graph/analytics/centrality` | 登录 | `graph.centrality_analysis` |
| `GET` | `/graph/assets/evidence` | 登录 | `graph.graph_asset_evidence` |
| `GET` | `/graph/assets/nodes` | 登录 | `graph.graph_asset_nodes` |
| `GET` | `/graph/assets/nodes/{node_id}` | 登录 | `graph.graph_asset_node_detail` |
| `GET` | `/graph/assets/quality` | 登录 | `graph.graph_asset_quality` |
| `GET` | `/graph/assets/relationships` | 登录 | `graph.graph_asset_relationships` |
| `GET` | `/graph/assets/relationships/{relationship_id}` | 登录 | `graph.graph_asset_relationship_detail` |
| `GET` | `/graph/entity/{label}/{entity_id}` | 登录 | `graph.get_graph_entity` |
| `GET` | `/graph/entity/{label}/{entity_id}/relationships` | 登录 | `graph.get_graph_relationships` |
| `GET` | `/graph/impact-analysis-by-object` | 登录 | `graph.impact_analysis_by_object` |
| `GET` | `/graph/impact-analysis/{entity_id}` | 登录 | `graph.impact_analysis` |
| `GET` | `/graph/neighbors/{entity_id}` | 登录 | `graph.get_neighbors` |
| `GET` | `/graph/path` | 登录 | `graph.shortest_path` |
| `POST` | `/graph/query` | 登录 | `graph.execute_cypher` |
| `GET` | `/graph/stats` | 登录 | `graph.graph_stats` |
| `GET` | `/graph/subgraph/{entity_id}` | 登录 | `graph.get_subgraph` |
| `POST` | `/graph/sync/quality-demo` | 登录 | `graph.sync_quality_demo_graph` |
| `GET` | `/graph/trace/{entity_id}` | 登录 | `graph.trace_chain` |

### `knowledge`（32）

| 方法 | 路径 | 访问要求 | 处理函数 |
| --- | --- | --- | --- |
| `GET` | `/knowledge/agent/conversations` | 登录 | `knowledge.list_agent_conversations` |
| `POST` | `/knowledge/agent/conversations` | 登录 | `knowledge.create_or_resume_agent_conversation` |
| `GET` | `/knowledge/agent/conversations/{conversation_id}/messages` | 登录 | `knowledge.list_agent_messages` |
| `POST` | `/knowledge/agent/conversations/{conversation_id}/messages` | 登录 | `knowledge.send_agent_message` |
| `POST` | `/knowledge/assets/upload` | 登录 | `knowledge.upload_knowledge_asset` |
| `GET` | `/knowledge/cards` | 登录 | `knowledge.list_cards` |
| `GET` | `/knowledge/cards/{card_id}` | 登录 | `knowledge.get_card` |
| `GET` | `/knowledge/directories` | 登录 | `knowledge.list_directories` |
| `POST` | `/knowledge/directories` | 登录 | `knowledge.create_directory` |
| `PUT` | `/knowledge/directories/{directory_id}` | 登录 | `knowledge.update_directory` |
| `POST` | `/knowledge/directories/{directory_id}/move` | 登录 | `knowledge.move_directory` |
| `GET` | `/knowledge/documents` | 登录 | `knowledge.list_documents` |
| `GET` | `/knowledge/documents/{document_id}` | 登录 | `knowledge.get_document` |
| `GET` | `/knowledge/documents/{document_id}/chunks` | 登录 | `knowledge.list_document_chunks` |
| `POST` | `/knowledge/documents/{document_id}/extraction-jobs` | 登录 | `knowledge.create_document_knowledge_extraction_job` |
| `GET` | `/knowledge/documents/{document_id}/markdown` | 登录 | `knowledge.get_document_markdown` |
| `GET` | `/knowledge/documents/{document_id}/ocr` | 登录 | `knowledge.get_document_ocr` |
| `PUT` | `/knowledge/documents/{document_id}/ocr/corrections` | 登录 | `knowledge.save_document_ocr_corrections` |
| `POST` | `/knowledge/documents/{document_id}/ocr/enhance` | 登录 | `knowledge.enhance_document_ocr` |
| `POST` | `/knowledge/documents/{document_id}/ontology-intake` | 登录 | `knowledge.create_document_ontology_intake` |
| `POST` | `/knowledge/extraction-jobs` | 登录 | `knowledge.create_knowledge_extraction_job` |
| `GET` | `/knowledge/extraction-jobs/{job_id}` | 登录 | `knowledge.get_knowledge_extraction_job` |
| `POST` | `/knowledge/extraction-jobs/{job_id}/approve` | 登录 | `knowledge.approve_knowledge_extraction_job` |
| `POST` | `/knowledge/extraction-jobs/{job_id}/commit-to-graph` | 登录 | `knowledge.commit_knowledge_extraction_job_to_graph` |
| `GET` | `/knowledge/extraction-jobs/{job_id}/export` | 登录 | `knowledge.export_knowledge_extraction_job` |
| `GET` | `/knowledge/ingestion-jobs/{job_id}` | 登录 | `knowledge.get_ingestion_job` |
| `GET` | `/knowledge/ocr-pipeline` | 登录 | `knowledge.get_ocr_pipeline` |
| `GET` | `/knowledge/related` | 登录 | `knowledge.get_related_knowledge` |
| `GET` | `/knowledge/related-cards` | 登录 | `knowledge.get_related_cards` |
| `POST` | `/knowledge/search` | 登录 | `knowledge.search_knowledge` |
| `GET` | `/knowledge/sources` | 登录 | `knowledge.list_sources` |
| `GET` | `/knowledge/spaces` | 登录 | `knowledge.list_spaces` |

### `maintenance`（5）

| 方法 | 路径 | 访问要求 | 处理函数 |
| --- | --- | --- | --- |
| `GET` | `/maintenance/equipment-health` | 登录 | `maintenance.equipment_health_overview` |
| `GET` | `/maintenance/equipment/{equipment_id}/health` | 登录 | `maintenance.single_equipment_health` |
| `GET` | `/maintenance/predictions` | 登录 | `maintenance.fault_predictions` |
| `GET` | `/maintenance/work-orders` | 登录 | `maintenance.list_work_orders` |
| `POST` | `/maintenance/work-orders` | 登录 | `maintenance.create_work_order` |

### `material-applications`（7）

| 方法 | 路径 | 访问要求 | 处理函数 |
| --- | --- | --- | --- |
| `GET` | `/material-applications` | 登录 | `material_applications.list_material_applications` |
| `POST` | `/material-applications` | 登录 | `material_applications.create_material_application` |
| `GET` | `/material-applications/{record_id}` | 登录 | `material_applications.get_material_application` |
| `PUT` | `/material-applications/{record_id}` | 登录 | `material_applications.edit_material_application` |
| `POST` | `/material-applications/{record_id}/approve` | 登录 | `material_applications.approve_material_application` |
| `POST` | `/material-applications/{record_id}/reject` | 登录 | `material_applications.reject_material_application` |
| `POST` | `/material-applications/{record_id}/submit` | 登录 | `material_applications.submit_material_application` |

### `model-driven`（23）

| 方法 | 路径 | 访问要求 | 处理函数 |
| --- | --- | --- | --- |
| `GET` | `/model-driven/data/{model_name}` | 读：登录；写：平台管理员 | `model_driven_data.list_data` |
| `POST` | `/model-driven/data/{model_name}` | 读：登录；写：平台管理员 | `model_driven_data.create_data` |
| `GET` | `/model-driven/data/{model_name}/options` | 读：登录；写：平台管理员 | `model_driven_data.get_options` |
| `PUT` | `/model-driven/data/{model_name}/{record_id}` | 读：登录；写：平台管理员 | `model_driven_data.update_data` |
| `DELETE` | `/model-driven/data/{model_name}/{record_id}` | 读：登录；写：平台管理员 | `model_driven_data.delete_data` |
| `GET` | `/model-driven/data/{model_name}/{record_id}/children/{child_table}` | 读：登录；写：平台管理员 | `model_driven_data.get_children` |
| `GET` | `/model-driven/menus` | 读：登录；写：平台管理员 | `model_driven_menus.list_menus` |
| `POST` | `/model-driven/menus` | 读：登录；写：平台管理员 | `model_driven_menus.create_menu` |
| `PUT` | `/model-driven/menus/{menu_id}` | 读：登录；写：平台管理员 | `model_driven_menus.update_menu` |
| `DELETE` | `/model-driven/menus/{menu_id}` | 读：登录；写：平台管理员 | `model_driven_menus.delete_menu` |
| `GET` | `/model-driven/models` | 读：登录；写：平台管理员 | `model_driven_meta.list_models` |
| `POST` | `/model-driven/models` | 读：登录；写：平台管理员 | `model_driven_meta.create_model` |
| `POST` | `/model-driven/models/import-from-ontology` | 读：登录；写：平台管理员 | `model_driven_meta.import_from_ontology` |
| `PUT` | `/model-driven/models/{model_id}` | 读：登录；写：平台管理员 | `model_driven_meta.update_model` |
| `DELETE` | `/model-driven/models/{model_id}` | 读：登录；写：平台管理员 | `model_driven_meta.delete_model` |
| `POST` | `/model-driven/models/{model_id}/fields` | 读：登录；写：平台管理员 | `model_driven_meta.add_field` |
| `GET` | `/model-driven/models/{model_id}/impact` | 读：登录；写：平台管理员 | `model_driven_meta.detect_impact` |
| `POST` | `/model-driven/models/{model_id}/publish` | 读：登录；写：平台管理员 | `model_driven_meta.publish_model` |
| `GET` | `/model-driven/models/{model_id}/versions` | 读：登录；写：平台管理员 | `model_driven_meta.list_model_versions` |
| `GET` | `/model-driven/pages` | 读：登录；写：平台管理员 | `model_driven_meta.list_pages` |
| `POST` | `/model-driven/pages` | 读：登录；写：平台管理员 | `model_driven_meta.create_page` |
| `POST` | `/model-driven/pages/generate` | 读：登录；写：平台管理员 | `model_driven_meta.generate_page` |
| `DELETE` | `/model-driven/pages/{page_id}` | 读：登录；写：平台管理员 | `model_driven_meta.delete_page` |

### `notifications`（6）

| 方法 | 路径 | 访问要求 | 处理函数 |
| --- | --- | --- | --- |
| `GET` | `/notifications` | 登录 | `notifications.list_notifications` |
| `POST` | `/notifications` | 登录 | `notifications.create_notification` |
| `POST` | `/notifications/read-all` | 登录 | `notifications.mark_all_read` |
| `GET` | `/notifications/unread-count` | 登录 | `notifications.get_unread_count` |
| `DELETE` | `/notifications/{notification_id}` | 登录 | `notifications.delete_notification` |
| `POST` | `/notifications/{notification_id}/read` | 登录 | `notifications.mark_notification_read` |

### `ontology`（8）

| 方法 | 路径 | 访问要求 | 处理函数 |
| --- | --- | --- | --- |
| `GET` | `/ontology/entities` | 登录 | `ontology.list_entity_types` |
| `GET` | `/ontology/entities/{entity_type}` | 登录 | `ontology.get_entity_type` |
| `GET` | `/ontology/entities/{entity_type}/instances` | 登录 | `ontology.list_entity_instances` |
| `POST` | `/ontology/entities/{entity_type}/instances` | 登录 | `ontology.create_entity_instance` |
| `GET` | `/ontology/entities/{entity_type}/instances/{entity_id}/relationships` | 登录 | `ontology.get_entity_relationships` |
| `GET` | `/ontology/relations` | 登录 | `ontology.list_relation_types` |
| `POST` | `/ontology/relations` | 登录 | `ontology.create_relation` |
| `GET` | `/ontology/timeline/{entity_id}` | 登录 | `ontology.get_entity_timeline` |

### `pages`（20）

| 方法 | 路径 | 访问要求 | 处理函数 |
| --- | --- | --- | --- |
| `GET` | `/pages` | 登录 | `component_pages.list_pages` |
| `POST` | `/pages` | 管理员 | `component_pages.create_page` |
| `POST` | `/pages/forms/{form_id}/binding` | 管理员 | `component_pages.bind_form_page` |
| `GET` | `/pages/forms/{slug}/binding` | 登录 | `component_pages.resolve_form_page` |
| `GET` | `/pages/permission-audiences` | 管理员 | `component_pages.permission_audiences` |
| `GET` | `/pages/permission-templates` | 管理员 | `component_pages.permission_templates` |
| `POST` | `/pages/permission-templates` | 管理员 | `component_pages.save_permission_template` |
| `DELETE` | `/pages/permission-templates/{template_id}` | 管理员 | `component_pages.delete_permission_template` |
| `GET` | `/pages/workspace/home` | 登录 | `component_pages.workspace_binding` |
| `POST` | `/pages/workspace/home` | 管理员 | `component_pages.initialize_workspace` |
| `GET` | `/pages/{code}` | 登录 | `component_pages.get_page` |
| `POST` | `/pages/{code}/data` | 登录 | `component_pages.page_data` |
| `PUT` | `/pages/{code}/draft` | 管理员 | `component_pages.write_page` |
| `GET` | `/pages/{code}/editor` | 管理员 | `component_pages.get_editor` |
| `POST` | `/pages/{code}/preview` | 管理员 | `component_pages.preview_page` |
| `POST` | `/pages/{code}/publish` | 管理员 | `component_pages.write_page` |
| `GET` | `/pages/{code}/versions` | 管理员 | `component_pages.page_versions` |
| `GET` | `/pages/{code}/versions/{version_number}` | 管理员 | `component_pages.page_version` |
| `POST` | `/pages/{code}/widgets/{widget_id}/{section}/publish` | 管理员 | `component_pages.publish_section` |
| `GET` | `/pages/{code}/widgets/{widget_id}/{section}/versions` | 管理员 | `component_pages.section_versions` |

### `pipelines`（6）

| 方法 | 路径 | 访问要求 | 处理函数 |
| --- | --- | --- | --- |
| `GET` | `/pipelines` | 登录 | `pipeline.list_pipelines` |
| `POST` | `/pipelines` | 登录 | `pipeline.create_pipeline` |
| `GET` | `/pipelines/{pipeline_id}` | 登录 | `pipeline.get_pipeline` |
| `POST` | `/pipelines/{pipeline_id}/run` | 登录 | `pipeline.run_pipeline` |
| `GET` | `/pipelines/{pipeline_id}/runs` | 登录 | `pipeline.list_pipeline_runs` |
| `GET` | `/pipelines/{pipeline_id}/runs/{run_id}` | 登录 | `pipeline.get_pipeline_run` |

### `platform`（11）

| 方法 | 路径 | 访问要求 | 处理函数 |
| --- | --- | --- | --- |
| `GET` | `/platform/tenants` | 平台管理员 | `platform.list_tenants` |
| `POST` | `/platform/tenants` | 平台管理员 | `platform.create_tenant` |
| `GET` | `/platform/tenants/{tenant_id}` | 平台管理员 | `platform.get_tenant_detail` |
| `PUT` | `/platform/tenants/{tenant_id}` | 平台管理员 | `platform.update_tenant` |
| `GET` | `/platform/tenants/{tenant_id}/exports` | 平台管理员 | `platform.list_tenant_exports` |
| `POST` | `/platform/tenants/{tenant_id}/exports` | 平台管理员 | `platform.create_tenant_export` |
| `GET` | `/platform/tenants/{tenant_id}/invites` | 平台管理员 | `platform.list_tenant_invites` |
| `POST` | `/platform/tenants/{tenant_id}/invites` | 平台管理员 | `platform.invite_tenant_user` |
| `POST` | `/platform/tenants/{tenant_id}/invites/{invite_id}/resend` | 平台管理员 | `platform.resend_tenant_invite` |
| `POST` | `/platform/tenants/{tenant_id}/invites/{invite_id}/revoke` | 平台管理员 | `platform.revoke_tenant_invite` |
| `POST` | `/platform/tenants/{tenant_id}/users/{user_id}/password-reset` | 平台管理员 | `platform.create_platform_password_reset` |

### `productization`（1）

| 方法 | 路径 | 访问要求 | 处理函数 |
| --- | --- | --- | --- |
| `GET` | `/productization/readiness` | 公开 | `productization.get_productization_readiness` |

### `quality`（10）

| 方法 | 路径 | 访问要求 | 处理函数 |
| --- | --- | --- | --- |
| `POST` | `/quality/capa` | 登录 | `quality.create_capa` |
| `GET` | `/quality/defects` | 登录 | `quality.list_defects` |
| `GET` | `/quality/defects/pareto` | 登录 | `quality.defect_pareto_analysis` |
| `GET` | `/quality/events` | 登录 | `quality.list_quality_events` |
| `POST` | `/quality/events/{event_id}/actions` | 登录 | `quality.execute_quality_event_action` |
| `POST` | `/quality/events/{event_id}/ai-suggestion` | 登录 | `quality.get_quality_event_ai_suggestion` |
| `GET` | `/quality/events/{event_id}/impact` | 登录 | `quality.get_quality_event_impact` |
| `GET` | `/quality/inspections` | 登录 | `quality.list_inspections` |
| `GET` | `/quality/spc/{parameter}` | 登录 | `quality.get_spc_data` |
| `GET` | `/quality/traceability/{entity_id}` | 登录 | `quality.quality_traceability` |

### `release`（1）

| 方法 | 路径 | 访问要求 | 处理函数 |
| --- | --- | --- | --- |
| `GET` | `/release/current` | 公开 | `release.get_current_release` |

### `reports`（7）

| 方法 | 路径 | 访问要求 | 处理函数 |
| --- | --- | --- | --- |
| `GET` | `/reports/` | 登录 | `reports.list_reports` |
| `POST` | `/reports/` | 登录 | `reports.create_report` |
| `GET` | `/reports/{report_id}` | 登录 | `reports.get_report` |
| `PUT` | `/reports/{report_id}` | 登录 | `reports.update_report` |
| `DELETE` | `/reports/{report_id}` | 登录 | `reports.delete_report` |
| `POST` | `/reports/{report_id}/snapshot` | 登录 | `reports.create_snapshot` |
| `GET` | `/reports/{report_id}/snapshots` | 登录 | `reports.list_snapshots` |

### `rules`（9）

| 方法 | 路径 | 访问要求 | 处理函数 |
| --- | --- | --- | --- |
| `GET` | `/rules/` | 登录 | `rules.list_rules` |
| `POST` | `/rules/` | 登录 | `rules.create_rule` |
| `POST` | `/rules/evaluate-triggers` | 登录 | `rules.evaluate_triggers` |
| `POST` | `/rules/rules/evaluate-triggers` | 登录 | `rules.evaluate_triggers_standalone_compat` |
| `GET` | `/rules/rules/triggers` | 登录 | `rules.list_triggers_standalone_compat` |
| `GET` | `/rules/triggers` | 登录 | `rules.list_triggers` |
| `POST` | `/rules/validate` | 登录 | `rules.validate_data` |
| `PUT` | `/rules/{rule_id}` | 登录 | `rules.update_rule` |
| `DELETE` | `/rules/{rule_id}` | 登录 | `rules.delete_rule` |

### `scheduler`（5）

| 方法 | 路径 | 访问要求 | 处理函数 |
| --- | --- | --- | --- |
| `GET` | `/scheduler/jobs` | 登录 | `scheduler.list_jobs` |
| `POST` | `/scheduler/jobs` | 登录 | `scheduler.create_job` |
| `PUT` | `/scheduler/jobs/{job_id}` | 登录 | `scheduler.update_job` |
| `DELETE` | `/scheduler/jobs/{job_id}` | 登录 | `scheduler.delete_job` |
| `POST` | `/scheduler/jobs/{job_id}/trigger` | 登录 | `scheduler.trigger_job` |

### `search`（1）

| 方法 | 路径 | 访问要求 | 处理函数 |
| --- | --- | --- | --- |
| `GET` | `/search` | 登录 | `search.cross_entity_search` |

### `semantic-assets`（28）

| 方法 | 路径 | 访问要求 | 处理函数 |
| --- | --- | --- | --- |
| `GET` | `/semantic-assets/closed-loop-config` | 登录 | `semantic_assets.get_closed_loop_config` |
| `GET` | `/semantic-assets/data-assets` | 登录 | `semantic_assets.list_data_assets` |
| `POST` | `/semantic-assets/data-assets/{asset_id}/metadata-scan` | 登录 | `semantic_assets.scan_data_asset_metadata` |
| `GET` | `/semantic-assets/ontology-candidates` | 登录 | `semantic_assets.list_ontology_candidates` |
| `POST` | `/semantic-assets/ontology-candidates/generate` | 登录 | `semantic_assets.generate_ontology_candidates` |
| `POST` | `/semantic-assets/ontology-candidates/{candidate_id}/approve` | 登录 | `semantic_assets.approve_ontology_candidate` |
| `POST` | `/semantic-assets/ontology-candidates/{candidate_id}/reject` | 登录 | `semantic_assets.reject_ontology_candidate` |
| `GET` | `/semantic-assets/ontology-mappings` | 登录 | `semantic_assets.list_ontology_mappings` |
| `GET` | `/semantic-assets/ontology-objects` | 登录 | `semantic_assets.list_ontology_objects` |
| `POST` | `/semantic-assets/ontology-objects` | 登录 | `semantic_assets.create_ontology_object` |
| `PUT` | `/semantic-assets/ontology-objects/{object_id}` | 登录 | `semantic_assets.update_ontology_object` |
| `GET` | `/semantic-assets/ontology-objects/{object_id}/record` | 登录 | `semantic_assets.get_ontology_instance` |
| `PUT` | `/semantic-assets/ontology-objects/{object_id}/record-binding` | 管理员 | `semantic_assets.bind_ontology_records` |
| `GET` | `/semantic-assets/ontology-objects/{object_id}/records` | 登录 | `semantic_assets.list_ontology_instances` |
| `GET` | `/semantic-assets/ontology-relations` | 登录 | `semantic_assets.list_ontology_relations` |
| `POST` | `/semantic-assets/ontology-relations` | 登录 | `semantic_assets.create_ontology_relation` |
| `PUT` | `/semantic-assets/ontology-relations/{relation_id}/record-link` | 管理员 | `semantic_assets.bind_ontology_link` |
| `GET` | `/semantic-assets/ontology/impact` | 登录 | `semantic_assets.get_ontology_impact` |
| `POST` | `/semantic-assets/ontology/publish` | 登录 | `semantic_assets.publish_ontology` |
| `GET` | `/semantic-assets/ontology/versions` | 登录 | `semantic_assets.list_ontology_versions` |
| `GET` | `/semantic-assets/page-contracts` | 登录 | `semantic_assets.list_page_contracts` |
| `GET` | `/semantic-assets/page-contracts/by-route` | 登录 | `semantic_assets.get_page_contract_by_route` |
| `POST` | `/semantic-assets/semantic-mapping/candidates` | 登录 | `semantic_assets.create_semantic_mapping_candidate` |
| `PUT` | `/semantic-assets/semantic-mapping/candidates/{candidate_id}` | 登录 | `semantic_assets.update_semantic_mapping_candidate` |
| `POST` | `/semantic-assets/semantic-mapping/candidates/{candidate_id}/approve` | 登录 | `semantic_assets.approve_semantic_mapping_candidate` |
| `POST` | `/semantic-assets/semantic-mapping/candidates/{candidate_id}/reject` | 登录 | `semantic_assets.reject_semantic_mapping_candidate` |
| `PUT` | `/semantic-assets/semantic-mapping/layout` | 登录 | `semantic_assets.put_semantic_mapping_layout` |
| `GET` | `/semantic-assets/semantic-mapping/workbench` | 登录 | `semantic_assets.semantic_mapping_workbench` |

### `supply-chain`（5）

| 方法 | 路径 | 访问要求 | 处理函数 |
| --- | --- | --- | --- |
| `GET` | `/supply-chain/analytics` | 登录 | `supply_chain.supply_chain_analytics` |
| `GET` | `/supply-chain/inventory` | 登录 | `supply_chain.inventory_overview` |
| `GET` | `/supply-chain/risk-assessment` | 登录 | `supply_chain.risk_assessment` |
| `GET` | `/supply-chain/shipments` | 登录 | `supply_chain.list_shipments` |
| `GET` | `/supply-chain/suppliers` | 登录 | `supply_chain.list_suppliers` |

### `system`（2）

| 方法 | 路径 | 访问要求 | 处理函数 |
| --- | --- | --- | --- |
| `GET` | `/system/metrics` | 管理员 | `main.metrics` |
| `GET` | `/system/readiness` | 公开 | `main.readiness` |

### `templates`（6）

| 方法 | 路径 | 访问要求 | 处理函数 |
| --- | --- | --- | --- |
| `GET` | `/templates` | 登录 | `templates.list_templates` |
| `GET` | `/templates/applications` | 管理员 | `templates.list_saved_applications` |
| `POST` | `/templates/applications/{application_id}` | 管理员 | `templates.save_application` |
| `POST` | `/templates/applications/{template_id}/instantiate` | 管理员 | `templates.instantiate_application` |
| `GET` | `/templates/{template_id}` | 登录 | `templates.get_template` |
| `POST` | `/templates/{template_id}/instantiate` | 登录 | `templates.instantiate_template` |

### `tenant`（1）

| 方法 | 路径 | 访问要求 | 处理函数 |
| --- | --- | --- | --- |
| `GET` | `/tenant/profile/public` | 登录 | `tenant.get_public_tenant_profile` |

### `workflow`（20）

| 方法 | 路径 | 访问要求 | 处理函数 |
| --- | --- | --- | --- |
| `GET` | `/workflow/business-items` | 登录 | `workflow.list_business_workflow_items` |
| `GET` | `/workflow/definitions` | 登录 | `workflow.list_definitions` |
| `POST` | `/workflow/definitions` | 管理员 | `workflow.create_definition` |
| `GET` | `/workflow/definitions/{def_id}` | 登录 | `workflow.get_definition` |
| `PUT` | `/workflow/definitions/{def_id}` | 管理员 | `workflow.update_definition` |
| `DELETE` | `/workflow/definitions/{def_id}` | 管理员 | `workflow.delete_definition` |
| `GET` | `/workflow/definitions/{def_id}/dispatches` | 管理员 | `workflow.definition_dispatches` |
| `POST` | `/workflow/definitions/{def_id}/start` | 登录 | `workflow.start_instance` |
| `GET` | `/workflow/instances` | 登录 | `workflow.list_instances` |
| `GET` | `/workflow/instances/{inst_id}` | 登录 | `workflow.get_instance` |
| `POST` | `/workflow/instances/{inst_id}/act` | 登录 | `workflow.approve_or_reject` |
| `POST` | `/workflow/instances/{inst_id}/approve` | 登录 | `workflow.approve_step` |
| `POST` | `/workflow/instances/{inst_id}/cancel` | 登录 | `workflow.cancel_instance` |
| `GET` | `/workflow/instances/{inst_id}/dispatches` | 管理员 | `workflow.list_dispatches` |
| `POST` | `/workflow/instances/{inst_id}/dispatches/{node_id}/retry` | 管理员 | `workflow.retry_dispatch` |
| `POST` | `/workflow/instances/{inst_id}/reject` | 登录 | `workflow.reject_step` |
| `GET` | `/workflow/notifications` | 登录 | `workflow.list_notifications` |
| `POST` | `/workflow/notifications/read-all` | 登录 | `workflow.mark_all_read` |
| `POST` | `/workflow/notifications/{notif_id}/read` | 登录 | `workflow.mark_read` |
| `GET` | `/workflow/stats` | 登录 | `workflow.workflow_stats` |
<!-- api-routes:end -->

## 7. 映射同步与对象记录

映射同步请求提供 `entity_name`、`object_code` 和 `form_id`，可传 `source_key` 限定一个 PostgreSQL 主键值。响应 `data` 中的 `read`、`created`、`updated` 和 `unchanged` 是本次实际数量。配置条件见[数据接入与连接器](../architecture/integration.md#5-外部数据进入业务的现有路径)。

保存绑定提供 `entity_name`、`object_code` 和 `form_id`。执行绑定可传 `source_key`，成功或失败都会生成运行回执。数据源列表的 `last_record_sync` 为最近一次成功执行已保存绑定的时间。`sync-status` 提供元数据扫描状态和用时。

查询对象记录列表和详情时，调用者还需具备来源表单的记录读取权限。响应遵循来源表单的记录范围和字段权限。
