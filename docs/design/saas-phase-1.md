# SaaS 产品化第一阶段

状态：设计

本文定义 ManuFoundry 作为公有 SaaS 交付时的第一个生产边界：租户隔离、生产启动校验、就绪检查和核心低代码链路的守卫已经实现（见第 3 节），计费、浏览器端到端测试、登录限流和大数据量检索等仍未实现（见第 7 节）。

## 1. 目标与就绪路径

第一阶段不追求把所有制造业模块做到生产级，只保证一条可验收的主链路：

```text
租户 → 用户 → 角色 → 应用 → 表单 → 业务记录 → 权限 → 流程 → 报表 → 审计
```

这条路径与 `GET /api/v1/productization/readiness` 返回的 `ready_path` 一致（`backend/app/api/productization.py` 的 `READY_PATH`）。该接口同时返回模块成熟度和验收规则：只有 `ready_foundation` 模块属于首次生产验收范围，`beta_demo`、`demo`、`roadmap` 模块必须以有限能力的形式呈现。范围变化时，需要同时修改该接口和本文。

## 2. 运行模式

`APP_MODE=demo` 用于本地演示和内部原型，允许显式选择 SQLite、使用种子演示数据；`APP_MODE=production` 用于对外运行，启动时拒绝不安全的配置。两种模式都没有游客访问，受保护接口都要求登录。两种模式的配置差异见[系统架构总览](../architecture/overview.md)第 8 节。

## 3. 已实现的守卫

| 守卫 | 实现位置 | 说明 |
| --- | --- | --- |
| 生产启动校验 | `backend/app/config.py` 的 `Settings.validate_runtime`，在 `app/main.py` 导入时执行 | `DEMO_AUTH_OPTIONAL=true`、`SECRET_KEY` 为默认值或不足 32 位、`CORS_ORIGINS` 含 `*`、未配置 `SMTP_HOST` 时启动失败 |
| 禁止 SQLite | `backend/app/database.py` | 生产模式下 `DATABASE_BACKEND=sqlite` 直接抛错 |
| 生产模式关闭接口文档 | `app/main.py` | `/docs`、`/redoc`、`/openapi.json` 关闭 |
| 数据库故障显式报错 | `app/core/production_errors.py` 的 `database_unavailable` | 认证、应用、后台管理等核心接口在数据库不可用时返回 `503`，不回退到模拟数据（`tests/test_ready_path_smoke.py`） |
| 规则引擎不回退模拟数据 | `app/api/rules.py` | 生产模式下数据库不可用时返回 `503`，不使用模拟规则或模拟触发写入；演示模式仍可回退（`tests/test_productization_boundaries.py`） |
| 无游客访问 | `app/api/deps.py` 的 `get_current_user` | 缺少或无效令牌返回 `401`；非公开接口必须依赖它（`tests/test_route_auth_coverage.py`） |
| 账号、租户、会话实时校验 | 同上 | 停用账号、暂停租户、撤销会话后，已签发令牌立即失效 |
| 租户模型 | `app/models/relational.py` | 共享数据库加 `tenant_id`；租户 1 为平台租户；租户状态 `active`、`suspended`、`archived` |
| 租户配额 | `services/tenant_onboarding.py` 的 `assert_tenant_quota` | 默认用户 50、应用 20、业务记录 100000，可在 `tenants.limits` 覆盖；物理表记录也计入 |
| 租户运营 | `app/api/platform.py`，依赖 `require_platform_admin` | 租户列表、详情、创建、修改，邀请的创建、重发、撤销，重置密码令牌，脱敏导出 |
| 邀请与找回密码邮件 | `services/tenant_onboarding.py` | 通过 SMTP 发送；未配置 SMTP 时只写日志；演示模式响应中带回链接，生产模式只返回是否已发送 |
| 账号安全 | `services/iam.py`、`app/api/auth.py` | 密码策略与历史、失败锁定、TOTP 多因素、OIDC、会话记录与撤销 |
| 生产模式查询限制 | `services/records.py`、`services/form_engine/physical.py` | 搜索要求有可见的 `searchable` 字段，筛选要求字段为 `searchable` 或 `sortable`，否则返回 `400` |
| 就绪检查接口 | `app/main.py`、`app/api/release.py`、`app/api/productization.py` | 见 3.1 |

身份、租户和权限的完整说明见[身份与权限体系](../architecture/permissions.md)。

带 `tenant_id` 的表覆盖了第一阶段涉及的全部业务对象：租户运营（域名、邀请、导出）、身份（用户、角色、授权、会话、密码历史、重置令牌、OIDC 状态）、应用与菜单、表单及其字段、布局、动作、权限、流程绑定、发布版本和业务记录、流程定义与实例、报表与快照、审计日志、通知、规则、定时任务、知识库和 AI 运行记录。不带 `tenant_id` 的平台级表见[数据模型](../architecture/data-model.md)。旧数据由迁移归入默认租户；新记录使用当前登录用户的租户。

### 3.1 就绪检查接口

| 接口 | 是否公开 | 内容 |
| --- | --- | --- |
| `GET /health` | 是 | 只表示进程存活 |
| `GET /api/v1/system/readiness` | 是 | `database`（能否执行 `SELECT 1`）、`migrations`（`alembic_version` 中的版本）、`smtp`、`storage`（`backend/storage` 目录可写）、`productionConfig`（`appMode`、`demoAuthOptionalDisabled`、`explicitCors`、`strongSecret`、`postgresRequired`）；任一项 `not_ready` 时整体为 `not_ready` |
| `GET /api/v1/release/current` | 是 | 当前发布版本信息 |
| `GET /api/v1/productization/readiness` | 是 | 就绪路径、模块成熟度、验收规则 |
| `GET /api/v1/system/metrics` | 需管理员 | 进程内请求计数 |

`productionConfig.postgresRequired` 在生产模式下要求 `DATABASE_BACKEND` 显式为 `postgresql`，默认值 `auto` 会被判为未就绪；`docker/docker-compose.prod.yml` 已设置为 `postgresql`。

## 4. 模块成熟度

下表的状态取自 `GET /api/v1/productization/readiness`（`MODULE_MATURITY`），“说明”一栏补充了代码现状与接口描述不一致的地方。

| 模块 | 接口中的状态 | 边界 | 说明 |
| --- | --- | --- | --- |
| 低代码核心（租户、应用、表单、业务记录、权限、流程、报表、审计） | `ready_foundation` | 首次 SaaS 验收路径 | 后端权限判定是唯一安全边界 |
| 规则引擎 | `ready_foundation` | 生产模式不得静默使用模拟规则或模拟触发写入 | |
| 质量 | `beta_demo` | 除非专门加固，不纳入首次验收 | 相关接口只要求登录，没有资源级授权 |
| 设备维护 | `beta_demo` | 同上 | 同上 |
| 供应链 | `beta_demo` | 在接入真实连接器前只使用模拟数据 | |
| AI 助手 | `beta_demo` | 不能作为生产正确性的唯一来源 | 已有会话、记忆、审计和确认令牌；写操作需用户确认，并复用页面同一套业务服务和权限判定 |
| 知识库 | `demo` | 接口描述为“静态或本地检索与上传模拟”，要求先具备持久化文档、分片、索引、证据、审核与回滚 | 文档、分片、入库任务、抽取结果已持久化到数据库；检索仍是本地哈希伪向量加英文词面打分，不具备语义检索能力，也没有向量数据库。接口中的描述已落后于代码 |
| 图谱、本体与语义资产 | `beta_demo` | 不是首次验收的依赖 | |
| 数据集成连接器 | `roadmap` | 接口描述为 MES、ERP、IoT、PLC 代码只是模拟器 | 数据源管理已支持 PostgreSQL 等数据库的连接测试、元数据扫描和同步；专门的 ERP、MES、IoT、PLC 连接器仍未实现 |

模板市场不在接口的模块列表中，不应阻塞就绪路径。

## 5. 首个 SaaS 使用路径

1. 平台管理员创建租户，登记邮箱域名，并为租户管理员发出邀请。
2. 租户管理员接受邀请，维护组织、角色，邀请成员并分配角色和组织。
3. 创建应用并配置应用菜单。
4. 创建表单，添加字段、布局、动作和权限。
5. 结构稳定后发布表单版本，运行期使用发布快照。
6. 录入业务记录。
7. 把流程绑定到表单的提交动作，提交后发起审批并逐级处理。
8. 基于表单数据创建报表并生成快照。
9. 查看审计日志；需要时由平台管理员创建脱敏的租户导出。

回归测试：

```bash
cd backend
python -m pytest tests/test_ready_path_smoke.py tests/test_productization_boundaries.py \
  tests/test_tenant_onboarding.py tests/test_saas_hardening.py tests/test_route_auth_coverage.py
```

`test_ready_path_smoke.py` 用平台管理员令牌走一遍接口层的主链路：创建角色和应用、创建表单与字段、配置表单权限并发布、装配应用表单和菜单节点、写入和搜索记录、提交记录并启动绑定的流程、发起和审批流程实例、生成报表快照、检查审计日志和就绪接口；另外验证生产模式下缺少令牌被拒绝、禁止 SQLite、数据库故障返回 `503`、未建索引的搜索被拒绝。目前没有浏览器端到端测试。

## 6. 大数据量读取策略

第一阶段不承诺对数千万乃至上亿条业务记录做任意实时全文检索。可扩展的约定更窄：

- 默认列表查询使用租户、表单、删除标记和 ID 上的索引（迁移 `0009_scale_indexes` 已为 `dynamic_records` 建立 `tenant_id, form_id, deleted_at, id` 和 `tenant_id, form_id, status, id` 索引）。
- 深度翻页优先使用游标分页（接口支持 `cursor_after_id`、`cursor_before_id`），偏移分页只用于兼容和浅层页面；游标分页时不返回精确总数。
- 生产环境的搜索和筛选只能使用声明为可查询的字段，未建索引的请求明确失败，不退化为 Python 端过滤（已实现，见第 3 节）。

目前的限制：非管理员的记录列表仍在 Python 中按每批 200 行读取并逐行鉴权后再分页，权限条件没有下推到 SQL；JSON 存储的表单还没有针对字段的表达式索引。

建议的分层：

| 单表单数据量 | 存储与查询策略 |
| --- | --- |
| 数千到数百万 | `dynamic_records` JSON 存储，配合租户、表单、ID 索引和游标分页 |
| 数百万到数千万 | 为声明的可搜索、可排序字段建立生成列或表达式索引；默认避免深度偏移翻页和精确计数（未实现） |
| 数千万到数亿 | 热点表单使用独立物理表或物化读模型，按租户和时间分区，报表改用预聚合表。表单物理表存储已实现，新建表单默认使用物理表；分区和预聚合未实现 |
| 数亿以上 | 拆分热点租户，使用只读副本、异步导出，分析负载交给 ClickHouse、Doris 等 OLAP 引擎（未实现） |

产品界面应体现这一边界：大表优先提供筛选、游标翻页、异步导出、保存的视图和预计算报表，而不是电子表格式的任意全表搜索。

## 7. 待完成工作（未实现）

- 浏览器端到端测试，覆盖完整就绪路径。
- 前端改为只依赖 HttpOnly Cookie 和 `/auth/me` 维持登录状态。目前前端仍把令牌保存在 `localStorage` 并发送 Bearer 头。
- 登录与敏感接口的请求频率限制、账号锁定的运维看板、可疑会话审查。
- 身份安全设置按租户隔离（目前保存在平台级 `system_settings`，任一租户管理员都能修改），以及按配置强制平台账号 MFA。
- 仅在演示模式接受 `demo:` 形式的 OIDC 授权码。
- 为 JSON 存储表单的常用查询字段建立 JSONB 或表达式索引，并把行级权限条件下推到 SQL。
- 修正 `/api/v1/system/readiness` 中 `strongSecret` 的判定：它使用的弱密钥列表与 `validate_runtime` 不一致，默认演示密钥会被判为强密钥。
- 修正或删除 `frontend/src/config/readyPathSmoke.ts`：它没有被任何模块或测试导入，不会运行；其中的 `/system-admin`、`/reports` 已不是 `frontend/src/App.tsx` 中的路由。
- 更新 `GET /api/v1/productization/readiness` 中知识库和数据集成的描述，使其与代码现状一致。
- 计费、套餐、配额运营和运维可观测性，在第一条 SaaS 链路稳定后再做。
- 生产级知识检索所需的外部向量与嵌入基础设施。

## 8. 交付前检查清单

- 后端全量测试通过，其中包括第 5 节的回归测试。
- 前端 `npm run type-check` 和 `npm run build` 通过。
- `GET /api/v1/productization/readiness` 与本文第 1、4 节一致。
- `GET /api/v1/system/readiness` 的整体状态为 `ready`，各项依赖状态符合预期。
- `GET /api/v1/release/current` 返回的是本次部署的版本。
- 数据库已执行 `alembic upgrade head`，`migrations.version` 是 `backend/alembic/versions/` 中的最新版本。
- 设置了 `APP_MODE=production`、`DATABASE_BACKEND=postgresql`、`DEMO_AUTH_OPTIONAL=false`、明确的 `CORS_ORIGINS`、`SMTP_HOST` 和 32 位以上的随机 `SECRET_KEY`。
- 没有在对外环境运行 `scripts/seed_data.py`，真实用户不使用演示账号和默认密码。
- `runtime-logs/`、`.db` 文件、`.tar` 导出等本地运行产物没有提交到仓库。
- 部署后的冒烟检查覆盖前端首页、`/health`、`/api/v1/system/readiness` 和 `/api/v1/release/current`，具体命令见[部署说明](../operations/deployment.md)。
