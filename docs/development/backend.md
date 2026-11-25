# 后端开发指南

更新日期：2026-11-17（对应代码版本 0.3.22 草稿）

以代码为准：`backend/app/main.py`、`backend/app/config.py`、`backend/app/api/`、`backend/app/services/`、`backend/app/models/`、`backend/alembic/versions/`、`backend/requirements.txt`。
目录与模块职责见[代码框架](../architecture/current-framework.md)，接口清单见 [API 参考](api-reference.md)。

## 1. 环境要求

- Python 3.11（与 `backend/Dockerfile`、CI 一致）。
- `deepseek-harness-sdk` 和 `deepseek-harness-runtime-bin` 必须是同一版本（当前 0.2.1rc2），生产镜像构建时会校验。
- 可选：PostgreSQL 16、Neo4j 5。使用 SQLite 时两者都不需要；Neo4j 不可用时图谱相关接口降级。

## 2. 本地运行

```bash
cd backend
python3.11 -m venv .venv
source .venv/bin/activate            # Windows：.venv\Scripts\activate
pip install -r requirements.txt
```

### 2.1 方式一：SQLite（最快）

```bash
export DATABASE_BACKEND=sqlite
export ENABLE_MANUFACTURING_DEMO_SEED=1   # 可选：导入 data/seed 下的制造业演示数据
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

- 数据库文件默认是 `backend/manufoundry.db`，可用 `SQLITE_DB_PATH` 指定。
- 启动时 `init_db()` 直接按模型建表，并为旧库补齐新增的列；不运行 Alembic。
- 演示数据只包含工厂、产线、设备、物料、订单、检验等业务表，不包含登录账号；SQLite 模式下没有现成的管理员。需要可登录的完整环境时，请使用下面的 PostgreSQL 方式。

### 2.2 方式二：PostgreSQL（与服务器一致）

```bash
docker compose -f docker/docker-compose.yml up -d postgres neo4j   # 在仓库根目录执行

cd backend
export PALANTIR_SEED_ADMIN_PASSWORD='<本地管理员密码>'   # 空库迁移时创建 admin 账号所需
python -m alembic upgrade head
cd .. && python scripts/seed_data.py      # 可选：演示数据、演示账号、演示知识资产、Neo4j 图
cd backend && python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

- 迁移 `0010_seed_super_admin` 在库中没有 `admin` 时才创建账号，且必须读取 `PALANTIR_SEED_ADMIN_PASSWORD`，未设置会直接报错退出。`0011_seed_demo_users` 对演示账号使用 `PALANTIR_SEED_DEMO_PASSWORD`。这些变量只在创建账号时使用，不会修改已有账号的密码。
- `scripts/seed_data.py` 会把 `admin` 的密码写成 `admin123`，并创建若干演示角色和演示账号（密码 `123456`）。这是演示用的弱密码，不要在对外环境运行。

启动后可访问：

| 地址 | 用途 |
| --- | --- |
| `http://127.0.0.1:8000/` | 服务名称与版本 |
| `http://127.0.0.1:8000/health` | 进程存活检查 |
| `http://127.0.0.1:8000/api/v1/system/readiness` | 数据库、迁移、SMTP、存储、生产配置就绪检查 |
| `http://127.0.0.1:8000/docs` | Swagger（仅演示模式） |

## 3. 配置

配置由 `app/config.py` 的 `Settings` 读取，来源是环境变量和 `backend/.env`（仓库根目录有 `.env.example` 可参考）。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `APP_MODE` | `demo` | `demo` 或 `production`；生产模式启动时校验下方的安全项 |
| `APP_VERSION` | `0.3.22` | 由 `scripts/bump_release.py` 维护 |
| `DATABASE_BACKEND` | `auto` | `sqlite` 时使用 SQLite；其他值都使用 PostgreSQL |
| `POSTGRES_HOST` / `PORT` / `USER` / `PASSWORD` / `DB` | `127.0.0.1` / `5432` / `manufoundry` / `manufoundry123` / `manufoundry` | PostgreSQL 连接 |
| `SQLITE_DB_PATH` | 空（即 `backend/manufoundry.db`） | SQLite 文件位置 |
| `SQL_ECHO` | `false` | 输出 SQL 日志，与 `DEBUG` 无关 |
| `NEO4J_URI` / `USER` / `PASSWORD` | `bolt://localhost:7687` / `neo4j` / `manufoundry123` | Neo4j 连接 |
| `SECRET_KEY` | 演示默认值 | JWT 签名密钥；生产必须是 32 位以上的非默认值 |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `480` | 令牌有效期 |
| `CORS_ORIGINS` | 本机 3000、5173 端口 | JSON 数组；含 `*` 时不允许携带凭据，生产禁止 `*` |
| `DEMO_AUTH_OPTIONAL` | `false` | 已不再提供游客访问，此项不影响鉴权；生产模式下设为 `true` 会拒绝启动 |
| `APP_PUBLIC_URL` | `http://localhost:5173` | 邀请、重置密码邮件中的链接地址 |
| `SMTP_*` | 空 | 邮件发送；生产模式必须配置 `SMTP_HOST` |
| `AI_PROVIDER` / `AI_BASE_URL` / `AI_API_KEY` | `glm` / 智谱接口 / 空 | 后端 AI 默认配置；管理员在“AI 与平台设置”中保存的配置优先 |
| `AI_CHAT_MODEL` / `AI_REASONING_MODEL` / `AI_EMBEDDING_MODEL` / `AI_VISION_MODEL` | `glm-5.1` / `glm-5.1` / `embedding-3` / `glm-4v-plus` | 默认模型；AI 设置切换为 DeepSeek 时默认使用 `deepseek-flash`（对话）与 `deepseek-v4-pro`（推理） |
| `AI_SETTINGS_ENCRYPTION_KEY` | 空 | 加密保存模型凭据的密钥 |
| `AI_TIMEOUT_SECONDS` | `30` | 模型调用超时 |
| `FORM_FILE_STORAGE_DIR` | `/data/form_files` | 表单附件目录 |
| `KNOWLEDGE_STORAGE_DIR` | `storage/knowledge_assets` | 知识资产目录 |
| `PASSWORD_*`、`LOGIN_LOCK_*` | 最少 10 位、需复杂度、记住 3 次历史；失败 5 次锁定 15 分钟 | 密码与登录锁定策略 |
| `OIDC_*` | 关闭 | 单点登录 |
| `LOG_LEVEL` | `INFO` | 日志级别 |

生产模式（`APP_MODE=production`）下，以下任一情况都会在启动时报错：`DEMO_AUTH_OPTIONAL=true`、`SECRET_KEY` 为默认值或不足 32 位、`CORS_ORIGINS` 含 `*`、未配置 `SMTP_HOST`、选择了 SQLite。

## 4. 分层规则

```text
app/api       → 只做参数解析、依赖注入和响应格式
app/services  → 业务规则、权限过滤、事务
app/core      → 数据库会话、安全、权限判定、审计、日志
app/models    → 表结构
```

- `core`、`models`、`services` 不得导入 `app.api`，`tests/test_layering.py` 会检查。服务层需要管理员判定时用 `app.core.principal.ensure_admin`，不要导入 `app.api.deps`。
- 新的业务校验写在服务层。页面接口和 AI 工具都调用同一个服务函数，不要在 AI 处理器或 React 组件里再复制一份校验。
- 路由模块中为兼容而再导出的服务函数，新代码不要再依赖。

## 5. 新增接口的检查项

1. 在 `app/api/<模块>.py` 中添加路由；新模块需要在 `app/main.py` 中 `include_router`。
2. 选择访问级别：

   | 场景 | 依赖 |
   | --- | --- |
   | 所有登录用户都可调用 | `Depends(get_current_user)` |
   | 当前租户管理员 | `Depends(require_admin)` |
   | 平台管理员（租户 1） | `Depends(require_platform_admin)` |
   | 通用资源权限 | `Depends(require_permission(resource_type, resource_key, action))` |
   | 表单运行时权限 | `Depends(require_form_permission(action))`，或在服务层调用 `has_form_permission` |

   只依赖 `get_current_user` 的写接口，意味着所有登录用户都能调用，请确认这是预期。
3. 真正不需要登录的接口，要同时加入 `tests/test_route_auth_coverage.py` 的 `PUBLIC_ROUTES`，否则测试失败。
4. 运行 `python scripts/docs/generate_api_reference.py` 更新 API 参考。

## 6. 数据库与迁移

- 结构变更只写在 Alembic 迁移中（`backend/alembic/versions/`），文件名用四位序号加说明，当前最新为 `0044_component_page_ai_tools`。
- `0001_initial` 用**当前**模型执行 `create_all`，并把非空列上的 Python 常量默认值同步设为数据库默认值。所以在空库上，后续迁移执行时表、列、索引往往已经存在。新迁移用 `op.add_column`、`op.create_table` 等显式操作，并先检查对象是否已存在（参考 `0023_saas_hardening.py` 的 `_has_table`、`_columns`）。用原生 SQL 插入种子数据时，不要假定表结构停留在写迁移时的样子。
- 外键只能指向主键或单列唯一的列。CI 会在空 PostgreSQL 上执行一次完整迁移来检验以上几点。
- 同时支持 SQLite：如果新列需要在旧的 SQLite 演示库中出现，在 `app/database.py` 的 `_ensure_sqlite_*` 函数中补列。
- 演示数据放在 `data/seed/` 和种子脚本中，不要写进迁移；迁移中创建账号必须从环境变量读取密码。
- 新的业务表必须带 `tenant_id`，查询按当前租户过滤。
- SQL 值一律参数化。动态表名、列名必须经过 `app/core/identifiers.py` 的校验或白名单。

## 7. 表单存储

表单有两种存储方式，由 `forms.storage_mode` 决定：

- JSON 存储：记录写在 `dynamic_records.data`，带 `schema_version`、`status`、软删除时间。
- 物理表存储（`physical_table` 或 `business_table`）：由 `services/form_engine/physical.py` 建表和加列，表名记录在 `forms.table_name`。新建表单的表名带租户前缀，例如 `t3_business_material`；已有表单保持原表名。归档字段不会删除物理列。

两种方式都通过 `services/records.py` 读写，统一执行租户边界、数据范围、行条件、字段投影、编码、校验与审计。运行期字段来自最新发布版本（`form_versions.snapshot`），没有发布版本时才使用草稿字段。

## 8. AI 相关约定

- AI 通过 DeepSeek Harness 运行，运行时经请求级 MCP 桥（`/api/v1/ai/harness/mcp`）回调平台工具，入口在 `services/ai/harness_runtime.py`。
- 工具调用统一经过 `services/ai/tool_envelope.py`。写操作只生成待确认卡片，用户确认后才执行，确认令牌防止重复执行。
- 可用的技能和工具来自数据库中按租户管理的注册表。种子定义在 `data/agent_registry/`，打包副本在 `services/ai/assets/`（用 `scripts/sync_ai_assets.py` 刷新）。**修改种子文件不会自动更新已有数据库**，需要运行对应的注册或升级脚本，例如 `scripts/register_form_design_tools.py`、`scripts/register_form_menu_tools.py`、`scripts/upgrade_harness_registry.py`、`backend/scripts/upgrade_dashboard_ai_registry.py`。
- 模型密钥不要写进代码或提交到仓库，使用环境变量或界面中的加密存储。

更完整的契约见 [AI Agent 技能与工具契约](../architecture/ai/skill-contract.md) 和 [DeepSeek Harness 运行时](../architecture/ai/harness-runtime.md)。

## 9. 安全约定

- 前端隐藏菜单或按钮不是安全边界，后端必须自行校验。
- 日志中不要输出密钥、令牌、连接串。
- 租户导出会脱敏密码、令牌、密钥、SMTP 与 API Key 类字段。

## 10. 测试

```bash
cd backend
python -m pytest                      # 全部测试，默认使用临时 SQLite
python -m pytest tests/test_route_auth_coverage.py tests/test_layering.py   # 鉴权覆盖与分层
```

测试说明、PostgreSQL 专项测试和 CI 见[测试说明](../operations/testing.md)。
