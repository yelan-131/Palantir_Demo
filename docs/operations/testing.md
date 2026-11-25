# 测试说明

更新日期：2026-11-17（对应代码版本 0.3.22 草稿）

本文说明本地如何运行测试、CI 实际执行哪些检查、各测试文件覆盖什么，以及目前没有覆盖的部分。

## 1. 后端测试

```bash
cd backend
python -m pytest                     # 全部 110 个 test_*.py
python -m pytest tests/test_route_auth_coverage.py tests/test_layering.py
python -m pytest -k "workflow"
```

- `pytest.ini` 指定 `testpaths = tests`。`tests/conftest.py` 默认设置 `DATABASE_BACKEND=sqlite`，把数据库放在系统临时目录（`manufoundry_pytest_<进程号>.db`），并清空 AI 密钥、把 AI 超时设为 2 秒，所以测试不需要外部数据库，也不会调用真实模型。
- `tests/legacy_agent/` 不是测试文件，而是部分测试使用的旧版 Agent 运行时辅助代码。
- 依赖要与 `requirements.txt` 一致，包括 `deepseek-harness-sdk==0.2.1rc2` 和 `deepseek-harness-runtime-bin==0.2.1rc2`，否则 Harness 相关测试会失败。

### 1.1 PostgreSQL 专项测试

以下 4 个文件默认在 SQLite 上运行，依赖 PostgreSQL 行锁的用例会跳过。设置环境变量后改用真实 PostgreSQL：

| 文件 | 环境变量 | 数据库名要求 |
| --- | --- | --- |
| `test_record_service.py` | `RECORD_TEST_DATABASE_URL` | 以 `record_service_verify_` 开头 |
| `test_assembly_persistence.py`、`test_application_menu_integrity.py`、`test_settings_concurrency.py` | `ASSEMBLY_TEST_DATABASE_URL` | 以 `assembly_verify_` 开头 |

数据库名前缀检查用来防止误连正式库。`test_record_service.py` 会先删除再重建它用到的表；另外 3 个文件共用一个库，每次开始前会清空整个 `public` schema。

还必须设置 `DATABASE_BACKEND=postgresql`。`conftest.py` 默认使用 SQLite，物理表单代码会据此选用 SQLite 语法，在 PostgreSQL 上执行就会失败。设置后，应用自身的数据库连接会指向 `POSTGRES_*` 配置的库，这个库也应该是一次性的、已执行过迁移的库，不要指向开发库。示例：

```bash
docker compose -f docker/docker-compose.yml up -d postgres
for db in manufoundry_test record_service_verify_local assembly_verify_local; do
  psql -h 127.0.0.1 -U manufoundry -c "CREATE DATABASE $db"
done
cd backend
export POSTGRES_DB=manufoundry_test PALANTIR_SEED_ADMIN_PASSWORD='<一次性密码>'
python -m alembic upgrade head
DATABASE_BACKEND=postgresql \
RECORD_TEST_DATABASE_URL=postgresql+asyncpg://manufoundry:<密码>@127.0.0.1:5432/record_service_verify_local \
ASSEMBLY_TEST_DATABASE_URL=postgresql+asyncpg://manufoundry:<密码>@127.0.0.1:5432/assembly_verify_local \
python -m pytest tests/test_record_service.py tests/test_assembly_persistence.py \
  tests/test_application_menu_integrity.py tests/test_settings_concurrency.py
```

## 2. 前端测试

```bash
cd frontend
node --test tests/*.test.cjs         # 42 个文件，212 个用例
npm run type-check                   # tsc -b --noEmit
npm run build                        # tsc -b && vite build
```

- 前端单元测试使用 Node 内置测试运行器，测试纯函数和状态逻辑（表单布局、字段计算、组件页面、分析编辑器、菜单、权限预览等），不渲染 React 组件。
- 必须写成 `tests/*.test.cjs`。Node 22 下 `node --test tests/` 会把目录当作模块加载而报错。
- 没有组件渲染测试（如 React Testing Library），也没有浏览器端到端测试。

## 3. CI

`.github/workflows/ci.yml` 在推送到 `master` 或 `main`、任意 Pull Request 以及手动触发时运行，同一分支的新运行会取消旧运行。共 3 个任务：

| 任务 | 内容 |
| --- | --- |
| 后端测试（SQLite，4 个分片） | Python 3.11 安装 `requirements.txt`；把 `tests/test_*.py` 排序后按序号分成 4 份并行运行 |
| 后端迁移与锁测试（PostgreSQL） | 启动 PostgreSQL 16 服务；用一次性的 `PALANTIR_SEED_ADMIN_PASSWORD` 在空库上执行 `alembic upgrade head`；创建 `record_service_verify_ci` 和 `assembly_verify_ci` 两个库，设置 `DATABASE_BACKEND=postgresql` 后运行第 1.1 节的 4 个文件 |
| 前端单元测试、类型检查与构建 | Node 20，`npm ci` 后执行 `node --test tests/*.test.cjs` 和 `npm run build`（其中包含 `tsc -b`） |

CI 目前不包括：

- Docker 镜像构建、镜像发布和自动部署。
- `scripts/doctor.py`、`scripts/production_smoke.py`。

空库迁移这一步同时检验了“`0001_initial` 按当前模型建出全部表后，后续迁移都能跳过已存在的表、列、索引”这一约定，见[后端开发指南](../development/backend.md#6-数据库与迁移)。

## 4. 提交前建议

```bash
cd backend && python -m pytest
cd ../frontend && node --test tests/*.test.cjs && npm run type-check && npm run build
cd .. && python scripts/docs/generate_api_reference.py --check   # 改了路由时
```

产品化相关改动至少运行：

```bash
cd backend
python -m pytest tests/test_ready_path_smoke.py tests/test_productization_boundaries.py \
  tests/test_tenant_onboarding.py tests/test_saas_hardening.py tests/test_business_tenant_isolation.py
```

## 5. 后端测试覆盖

| 领域 | 测试文件 |
| --- | --- |
| 安全与鉴权 | `test_security`、`test_auth_hardening`、`test_route_auth_coverage`（公开路由白名单）、`test_permission_resolver`、`test_field_policies`、`test_identity_access_center`、`test_model_driven_safety` |
| 架构约束 | `test_layering`（`core`、`models`、`services` 不得导入 `api`）、`test_logging_setup` |
| 租户与产品化 | `test_tenant_onboarding`、`test_saas_hardening`、`test_business_tenant_isolation`、`test_productization_boundaries`、`test_ready_path_smoke`、`test_release_api`、`test_bump_release` |
| 表单平台 | `test_forms_platform`、`test_form_lifecycle_integration`、`test_form_shared_services`、`test_form_control_validation`、`test_form_defaults`、`test_form_calculations`、`test_form_rules`、`test_form_view_tabs`、`test_form_sources_imports`、`test_conditional_encoding_rules`、`test_static_options`、`test_option_search`、`test_multiselect_limits`、`test_date_range_boundaries`、`test_reference_data_defaults`、`test_designer_execution`、`test_publish_cache_recovery`、`test_version` |
| 业务记录 | `test_record_service`、`test_record_domains`、`test_record_read_performance`（查询次数预算）、`test_assembly_persistence`、`test_settings_concurrency` |
| 应用、菜单与页面 | `test_application_menu_integrity`、`test_component_pages`、`test_page_content_migration`、`test_backend_demo_workbenches`、`test_dashboard_programs`、`test_templates`、`test_config_io` |
| 流程与审批 | `test_workflow`、`test_workflow_routing`、`test_workflow_dispatch`、`test_workflow_start_source`、`test_unified_workflow_inbox`、`test_approval_assignment_guards`、`test_approval_group_policies`、`test_approval_notification_flow`、`test_form_approval_config`、`test_business_form_approvals`、`test_material_workflow`、`test_material_approval_config`、`test_multi_user_business_acceptance` |
| 分析与告警 | `test_analytics_editor`、`test_analytics_runtime`、`test_analytics_sources`、`test_analytics_versions`、`test_analytics_metric_library`、`test_analytics_dataset_range`、`test_alerts`、`test_alert_migration`、`test_quality_timeseries_graph`、`test_retired_graph_routes` |
| 规则、通知与其他 | `test_rules`、`test_rules_trigger`、`test_notifications`、`test_audit`、`test_phase4_small`（定时任务、搜索、AI 搭建建议） |
| 知识库 | `test_knowledge_ingestion`、`test_knowledge_extraction`、`test_ai_knowledge_api` |
| AI 运行时与 Harness | `test_events`、`test_hooks`（Agent 事件总线与内置钩子）、`test_harness_integration`、`test_harness_updates`、`test_dsh_upgrade`、`test_ai_tool_use_loop`、`test_tool_loader`、`test_tool_result_processor`、`test_confirmation_store`、`test_context_layers`、`test_compactor`、`test_budget`、`test_ai_context_headroom`、`test_ai_agent_services`、`test_ai_assistant`、`test_ai_settings_effectiveness`、`test_ai_model_catalog` |
| AI 注册表与技能 | `test_ai_registry_lifecycle`、`test_ai_registry_tenants`、`test_ai_skill_loading` |
| AI 配置工具 | `test_ai_low_code_agent`、`test_ai_configuration`、`test_ai_configuration_completion`、`test_ai_configuration_review`、`test_ai_form_design_tools`、`test_ai_form_menu_tools`、`test_ai_menu_admin_tools`、`test_ai_application_admin_tools`、`test_ai_application_menu_integration`、`test_ai_dashboard_tools`、`test_ai_component_page_lifecycle`、`test_ai_component_page_controls`、`test_ai_page_controls` |

## 6. 验收与诊断脚本

这些脚本不在 CI 中运行，用于针对已有环境的人工验收。运行前先阅读文件开头的说明，确认目标库和是否会写数据。

| 脚本 | 用途 |
| --- | --- |
| `backend/scripts/verify_record_postgres.py`、`verify_component_pages.py` | 在临时 PostgreSQL 库上验证记录读写与组件页面（在后端容器内运行） |
| `backend/scripts/verify_complex_acceptance.py`、`verify_multi_user_acceptance.py`、`verify_acceptance_followup.py`、`verify_routing_acceptance.py`、`verify_permission_fixes.py` | 通过 HTTP 对专用验收应用做审批、多用户、路由、权限检查 |
| `backend/scripts/load_test_acceptance.py`、`profile_acceptance.py` | 有限压力测试与只读性能分析 |
| `scripts/doctor.py` | 检查部署 `.env` 与 release compose，`--skip-runtime` 时只做静态检查 |
| `scripts/production_smoke.py` | 以平台管理员登录并真实创建一个租户和一次导出，用法与注意事项见[部署](deployment.md#8-验证) |

## 7. 尚未覆盖

| 方面 | 现状 |
| --- | --- |
| 浏览器端到端测试 | 没有 Playwright 等端到端流程；登录到业务页面的主流程由后端 `test_ready_path_smoke.py` 在接口层覆盖 |
| 前端组件测试 | 只有纯逻辑测试，没有组件渲染测试 |
| 镜像与部署 | CI 不构建 Docker 镜像，也没有部署后的自动冒烟 |
| Neo4j 集成 | 测试不连接真实 Neo4j |
| 性能基准 | 只有 `test_record_read_performance.py` 和手动的验收压测，没有持续的性能基准 |

## 8. 编写测试的约定

- 测试放在被保护的行为附近：纯校验逻辑写单元测试，跨模块的接口或数据库约定写集成测试。
- 不依赖外部网络和真实模型；AI 行为需要确定性时，模拟模型输出。
- 新增公开接口时同步更新 `test_route_auth_coverage.py` 的 `PUBLIC_ROUTES`。
- 需要 PostgreSQL 语义（行锁、并发唯一性）的用例，在 SQLite 下显式 `pytest.skip`，并接入第 1.1 节的环境变量。
- 异步测试优先用 `@pytest.mark.asyncio`。同步包装时不要用 `asyncio.get_event_loop()`：同一进程中别的测试调用 `asyncio.run()` 后当前事件循环会被清空，测试结果会随分片顺序变化。可参考 `test_rules_trigger.py` 中模块自有事件循环的写法。
