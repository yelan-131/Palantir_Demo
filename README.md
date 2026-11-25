# ManuFoundry

当前 GitHub 版本为 [0.3.26](docs/releases/release-0.3.26.md)，发布于 2026-11-20。

当前开发草稿为 [0.3.27](docs/releases/release-0.3.27.md)。

本版完善 AI 助手的执行轨迹、查询审计与记录确认，补齐全局 AI 设置权限分工，并新增 PostgreSQL 映射入表与对象实例浏览。
版本编号与发布流程见[版本策略](docs/operations/version-policy.md)，历次版本见[文档索引](docs/README.md#6-发布说明历史)。

ManuFoundry 是面向制造业的低代码数据工作台原型。用户可以搭建应用、表单、页面和菜单，在其中录入和审批业务数据，并结合知识库、对象图谱和 AI 助手完成查询与配置。项目仍在开发中，用于演示和产品探索，不建议直接用于商业生产。

## 功能

- **应用与页面**：应用库、应用菜单树、组件画布（业务列表、筛选、指标、图表），页面与表单分别发布。
- **业务表单**：字段、布局、视图页签、默认值、计算、校验、编码规则、导入与附件；数据可存为 JSON 或物理表；发布后生成版本快照。
- **流程审批**：条件路由、会签、自动下发、统一待办；实例启动时固定流程版本。
- **分析看板**：数据集、共享指标库、可编辑看板与版本历史。
- **数据中心**：外部数据源、元数据扫描、数据管道、本体对象与映射、知识库（文档解析、分块检索、实体抽取）。
- **制造业演示模块**：运营总览、设备维护、质量分析与影响图谱、供应链风险。
- **身份与租户**：多租户、组织、角色、资源与字段级权限、会话管理、MFA、OIDC 单点登录、租户导出。
- **AI 助手**：基于 DeepSeek Harness，通过平台工具查询数据、生成表单与页面配置；写操作需要用户确认后才执行。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | React 18、TypeScript 5.7、Vite 6、React Router 7、Ant Design 5、Zustand、ECharts、Cytoscape、React Flow |
| 后端 | Python 3.11、FastAPI、SQLAlchemy 2（异步）、Alembic、Pydantic 2 |
| 数据 | PostgreSQL 16（本地可用 SQLite），Neo4j 5（可选） |
| AI | `deepseek-harness-sdk` / `deepseek-harness-runtime-bin` 0.2.1rc2 |
| 部署 | Docker Compose，nginx 提供前端并代理 `/api/` |
| 测试 | pytest、Node 内置测试运行器、TypeScript 检查；GitHub Actions CI |

## 目录

```text
backend/    FastAPI 应用、模型、迁移、服务、测试和验收脚本
frontend/   React 工作台界面与前端单元测试
data/       种子数据、AI 技能与工具注册表、演示知识资产、行业模板
docker/     Docker Compose 文件
docs/       架构、开发、运维、业务文档与发布说明
scripts/    种子数据、版本发布、部署诊断、冒烟测试、文档生成等脚本
.agent/     Agent 契约与技能、工具说明
```

## 快速开始

最快的方式是用 SQLite 启动后端，但这种方式没有登录账号。需要能登录的完整环境，请按[后端开发指南](docs/development/backend.md#22-方式二postgresql与服务器一致)使用 PostgreSQL。

```bash
# 数据库（仓库根目录）
docker compose -f docker/docker-compose.yml up -d postgres neo4j

# 后端
cd backend
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export PALANTIR_SEED_ADMIN_PASSWORD='<本地管理员密码>'
python -m alembic upgrade head
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

# 前端（另一个终端）
cd frontend
npm install
npm run dev
```

| 地址 | 用途 |
| --- | --- |
| `http://localhost:3000` | 前端，开发服务器把 `/api` 代理到 8000 端口 |
| `http://localhost:8000/docs` | 接口文档（仅演示模式） |
| `http://localhost:8000/health` | 后端健康检查 |

**账号。** 迁移只会用 `PALANTIR_SEED_ADMIN_PASSWORD` 创建 `admin`，仓库中没有默认密码。本地如需演示账号和制造业演示数据，可在仓库根目录运行 `python scripts/seed_data.py`；它会把 `admin` 密码设为 `admin123`，并创建密码为 `123456` 的演示账号，只能用于本地演示，不要在对外环境运行。

也可以用 Docker 启动整套开发环境：`docker compose -f docker/docker-compose.yml up -d --build`。

## 验证

```bash
cd backend && python -m pytest
cd frontend && node --test tests/*.test.cjs && npm run type-check && npm run build
python scripts/docs/generate_api_reference.py --check    # 检查 API 参考是否与路由一致
```

CI（`.github/workflows/ci.yml`）在推送和 Pull Request 时运行后端测试、空库迁移与 PostgreSQL 并发测试、前端单元测试和构建，详见[测试说明](docs/operations/testing.md)。

## 部署

生产服务器使用 `docker/docker-compose.yml` 加 `docker/docker-compose.prod.yml`，对外只开放 80 端口，后端与数据库只绑定本机。更新流程、迁移、验证与回滚见[部署](docs/operations/deployment.md)；客户私有化部署见[私有化部署](docs/operations/private-deployment.md)。仓库中没有自动部署流程。

## 文档

从[文档索引](docs/README.md)开始阅读。常用入口：[架构总览](docs/architecture/overview.md)、[代码框架](docs/architecture/current-framework.md)、[数据模型](docs/architecture/data-model.md)、[API 参考](docs/development/api-reference.md)、[后端开发](docs/development/backend.md)、[前端开发](docs/development/frontend.md)。
