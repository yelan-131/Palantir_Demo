# 部署

更新日期：2026-11-17（对应代码版本 0.3.22 草稿）

本文按仓库中的 `docker/` 目录、两个 Dockerfile、`frontend/nginx.conf` 和 `AGENTS.md` 的部署约定编写。客户私有化部署（预构建镜像、离线包、Windows 脚本）见[私有化部署](private-deployment.md)。

## 1. 本地开发

不使用 Docker 时，后端和前端分别启动，详见[后端开发指南](../development/backend.md)和[前端开发指南](../development/frontend.md)：

```bash
# 终端 1
cd backend && python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
# 终端 2
cd frontend && npm run dev -- --host 127.0.0.1 --port 3000
```

Windows 下可用 `scripts/start-local-dev.cmd`、`run-backend-local.cmd`、`run-frontend-local.cmd`。Vite 依赖预构建在受限环境下失败时，可先 `npm run build`，再运行 `node local-static-server.mjs` 提供静态页面并代理 `/api`。

本地检查：

```bash
curl -fsS http://127.0.0.1:8000/health
curl -fsS http://127.0.0.1:8000/api/v1/system/readiness
curl -fsS http://127.0.0.1:8000/api/v1/release/current
curl -fsS http://127.0.0.1:8000/api/v1/productization/readiness
curl -I http://127.0.0.1:3000
```

## 2. Compose 文件

| 文件 | 用途 | 用法 |
| --- | --- | --- |
| `docker/docker-compose.yml` | 开发：后端 `Dockerfile.dev`（热重载）、前端 `Dockerfile.dev`（Vite），挂载源码 | 单独使用 |
| `docker/docker-compose.prod.yml` | 生产覆盖层：改用生产 Dockerfile，去掉源码挂载，端口收紧 | 与上一个文件叠加 |
| `docker/docker-compose.release.yml` | 私有化部署：从镜像仓库拉取预构建镜像，不在主机上构建 | 单独使用，配合 `.env` |
| `docker/docker-compose.external-sources.yml` | 6 个演示外部系统库（MES、ERP、QMS、WMS、SCM、CRM 的 PostgreSQL，端口 15432–15437） | 按需单独启动 |

当前生产服务器使用开发文件加生产覆盖层：

```bash
docker compose --env-file .env -f docker/docker-compose.yml -f docker/docker-compose.prod.yml up -d --build --remove-orphans
```

## 3. 服务与端口

| 服务 | 容器名 | 镜像或构建 | 开发端口 | 生产覆盖层与 release 端口 |
| --- | --- | --- | --- | --- |
| `frontend` | `manufoundry-frontend` | `frontend/Dockerfile`（Node 20 构建，nginx 提供静态文件） | `3000` | `80`，对外 |
| `backend` | `manufoundry-backend` | `backend/Dockerfile`（Python 3.11） | `8000` | `127.0.0.1:8000` |
| `postgres` | `manufoundry-postgres` | `postgres:16-alpine` | `5432` | `127.0.0.1:5432` |
| `neo4j` | `manufoundry-neo4j` | `neo4j:5-community`（带 APOC） | `7474`、`7687` | 仅绑定 `127.0.0.1` |

- 对外只有 80 端口。前端 nginx 把 `/api/` 转发到 `http://backend:8000/api/`，把 `/health` 转发到 `http://backend:8000/health`，其余路径回退到 `index.html`。
- 后端镜像构建时会检查 `deepseek-harness-sdk` 与 `deepseek-harness-runtime-bin` 都是 `0.2.1rc2`，版本不符则构建失败。
- 表单附件保存在数据卷 `form_files`（挂载到 `/data/form_files`）。PostgreSQL 与 Neo4j 数据分别在 `postgres_data`、`neo4j_data`。
- 生产覆盖层沿用 `docker-compose.yml` 中固定的 PostgreSQL 与 Neo4j 密码（这两个端口只绑定本机回环地址）；release 文件则要求在 `.env` 中提供 `POSTGRES_PASSWORD`、`NEO4J_PASSWORD`。
- 0.3.22 起不再包含 Redis。从旧版本升级的服务器上会残留 `manufoundry-redis` 容器，`up -d --remove-orphans` 会移除它，之后可按需删除 `redis_data` 数据卷。

## 4. 运行模式

生产覆盖层为后端设置：

```env
APP_MODE=production
DATABASE_BACKEND=postgresql
DEMO_AUTH_OPTIONAL=false
SECRET_KEY=${SECRET_KEY}          # 必须在服务器 .env 中提供，否则 compose 直接报错
APP_PUBLIC_URL=${APP_PUBLIC_URL:-http://111.229.172.100}
SMTP_HOST=${SMTP_HOST:-localhost}
```

生产模式下后端启动时会检查：`SECRET_KEY` 不是默认值且不少于 32 位、`DEMO_AUTH_OPTIONAL` 不是 `true`、`CORS_ORIGINS` 不含 `*`、已配置 `SMTP_HOST`、没有使用 SQLite。任一项不满足都会拒绝启动。此外 `/docs`、`/redoc`、`/openapi.json` 关闭，`/api/v1/system/metrics` 需要管理员令牌。

AI 模型的地址与密钥既可以用环境变量提供，也可以由管理员在“AI 与平台设置”中保存（加密存储，优先于环境变量）。

## 5. 生产服务器

| 项 | 值 |
| --- | --- |
| SSH | `root@111.229.172.100`，使用已配置的私钥 |
| 项目目录 | `/root/Palantir_Demo` |
| 对外入口 | `http://111.229.172.100`（80 端口） |
| 后端 | 仅服务器本机可访问 `http://127.0.0.1:8000` |
| 服务器配置 | `/root/Palantir_Demo/.env`，只保存在服务器上，不提交到仓库 |

仓库中没有自动部署（CD）流程，更新服务器都是按下面的步骤手动完成。

## 6. 更新服务器

用户要求“更新服务器”“同步到服务器”时按以下流程执行（与 `AGENTS.md` 一致）：

1. 在本地提交并推送到 GitHub。
2. 登录服务器：`ssh -i <私钥文件> root@111.229.172.100`。
3. 更新代码，保留服务器本地的部署文件（如 `.env`），除非用户明确要求覆盖：

   ```bash
   cd /root/Palantir_Demo
   git status --short          # 先确认服务器本地改动
   git pull --ff-only
   ```

4. 重新构建并重启：

   ```bash
   docker compose --env-file .env -f docker/docker-compose.yml -f docker/docker-compose.prod.yml up -d --build --remove-orphans
   ```

5. 执行迁移（本次更新包含新迁移时必须执行）：

   ```bash
   docker exec manufoundry-backend alembic upgrade head
   docker exec manufoundry-backend alembic current
   ```

6. 如果本次更新改了 `data/agent_registry/` 中的技能或工具定义，需要运行对应的注册或升级脚本，否则已有数据库不会变化（见[后端开发指南](../development/backend.md#8-ai-相关约定)）。
7. 按第 8 节验证。只有看到验证结果后，才能说部署成功。

## 7. 数据库初始化与演示数据

**空库迁移。** 迁移 `0010_seed_super_admin` 在没有 `admin` 账号时会创建它，并要求环境变量 `PALANTIR_SEED_ADMIN_PASSWORD`，未设置会报错退出。只在部署环境中临时提供，不要提交或写进文档：

```bash
docker exec -e PALANTIR_SEED_ADMIN_PASSWORD='<管理员初始密码>' manufoundry-backend alembic upgrade head
```

这类变量只在创建账号时使用，不会修改已有账号的密码。

**演示数据脚本。** `scripts/seed_data.py` 和 `scripts/reseed_business_data.py` 在仓库根目录，依赖同级的 `backend/` 和 `data/seed/`。后端镜像只包含 `backend/` 目录，所以不能直接在 `manufoundry-backend` 容器里运行这两个脚本。可以用后端镜像临时挂载整个仓库来运行：

```bash
cd /root/Palantir_Demo
docker compose --env-file .env -f docker/docker-compose.yml -f docker/docker-compose.prod.yml \
  run --rm -v "$PWD:/repo" -w /repo backend python scripts/reseed_business_data.py
```

使用前注意：

- `reseed_business_data.py` 会先 `TRUNCATE ... CASCADE` 清空 16 张制造业主数据表，再从 `data/seed/` 重新导入。
- `seed_data.py` 会把 `admin` 的密码重置为 `admin123`，并创建密码为 `123456` 的演示账号。**不要在对外开放的服务器上运行。**
- 上面的 `compose run` 命令是根据目录结构给出的，执行前请先在测试环境确认。

## 8. 验证

在本地或服务器上执行：

```bash
curl -I http://111.229.172.100
curl -fsS http://111.229.172.100/health                       # 期望 {"status":"healthy"}
curl -fsS http://111.229.172.100/api/v1/system/readiness
curl -fsS http://111.229.172.100/api/v1/release/current
curl -fsS http://111.229.172.100/api/v1/productization/readiness
```

服务器本机还可以检查 `curl -fsS http://127.0.0.1:8000/health`、`docker compose ... ps` 和日志：

```bash
docker compose --env-file .env -f docker/docker-compose.yml -f docker/docker-compose.prod.yml ps
docker logs --tail 100 manufoundry-backend
docker logs --tail 100 manufoundry-frontend
```

其他业务接口都需要登录令牌。

**SaaS 冒烟脚本。** `scripts/production_smoke.py` 依次检查就绪状态、用平台管理员登录、**真实创建**一个租户并发起一次租户导出，最后带令牌读取运行指标。租户 slug 默认为 `smoke-<时间戳>`，域名为 `<slug>.local`，每次运行都不同；用完后在平台租户管理中处理这些租户。账号通过参数或环境变量提供，不要写进脚本：

```bash
SMOKE_USERNAME=<平台管理员> SMOKE_PASSWORD=<密码> \
  python scripts/production_smoke.py --base-url http://111.229.172.100
```

**部署前诊断。** `scripts/doctor.py` 检查 `.env` 和 release compose 配置，`--skip-runtime` 时只做静态检查：

```bash
python scripts/doctor.py --env .env --compose docker/docker-compose.release.yml --skip-runtime
```

## 9. 回滚

```bash
cd /root/Palantir_Demo
git log --oneline -5
git checkout <上一个正常的提交>
docker compose --env-file .env -f docker/docker-compose.yml -f docker/docker-compose.prod.yml up -d --build
curl -fsS http://111.229.172.100/health
```

- 回滚代码不会回滚数据库迁移。迁移一般只新增表或列，旧代码通常仍可运行；如需 `alembic downgrade`，先检查对应迁移的 `downgrade` 实现和数据影响，并备份数据库。
- 问题处理完后切回正常分支，避免服务器停留在游离提交上。

## 10. 部署注意事项

- 生效的 nginx 配置是 `frontend/nginx.conf`。
- 后端的 `/health` 在 `/api/v1` 之外，只表示进程存活；数据库和迁移状态看 `/api/v1/system/readiness`。
- 生产环境的 `CORS_ORIGINS` 应列出实际访问域名，不能用 `*`。
- 不要在仓库文件、脚本或工作流中写入生产管理员账号密码。
