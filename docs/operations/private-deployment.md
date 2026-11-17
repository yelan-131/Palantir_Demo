# 私有化部署

更新日期：2026-11-17（对应代码版本 0.3.22 草稿）

本文面向在客户或私有环境中安装、升级和回滚 ManuFoundry 的运维人员，覆盖预构建镜像的在线安装、离线安装、部署诊断、备份与回滚。开发环境和当前生产服务器的 Compose 用法见[部署](deployment.md)。

## 1. 部署形态

私有化部署使用预构建的后端和前端镜像，在单台 Docker 主机上用 Docker Compose 运行，不在目标主机上构建源码。支持以下方式：

- 在线安装：从镜像仓库（默认 `ghcr.io`）拉取镜像。
- 离线安装：从离线包中的镜像 tar 文件执行 `docker load`。
- Linux 使用 bash 脚本，Windows Server 或 Docker Desktop 使用 PowerShell 脚本。

当前版本不提供 Kubernetes 部署和集群高可用。

一次部署包含四个容器：`manufoundry-postgres`（PostgreSQL 16）、`manufoundry-neo4j`（Neo4j 5 社区版，含 APOC）、`manufoundry-backend` 和 `manufoundry-frontend`。PostgreSQL、Neo4j 和后端端口只绑定到 `127.0.0.1`，对外只暴露前端端口（`FRONTEND_PORT`，默认 80）。数据保存在三个命名卷中：`postgres_data`、`neo4j_data` 和表单附件卷 `form_files`。

## 2. 所需文件

部署主机上需要以下文件（保持仓库中的相对目录结构，脚本按此定位）：

| 文件 | 用途 |
| --- | --- |
| `docker/docker-compose.release.yml` | 私有化部署的 Compose 定义 |
| `.env.private.example` | 环境变量模板，复制为 `.env` 后填写 |
| `scripts/deploy-private.sh`、`scripts/deploy-private.ps1` | 安装与升级 |
| `scripts/rollback-private.sh`、`scripts/rollback-private.ps1` | 切换回指定镜像版本 |
| `scripts/doctor.py` | 部署前后的诊断（需要主机上有 Python 3） |

镜像名为 `${IMAGE_REGISTRY}/${IMAGE_NAMESPACE}/palantir-demo-backend:${IMAGE_TAG}` 和对应的 `palantir-demo-frontend`。仓库当前只有 `.github/workflows/ci.yml` 一个测试流水线，没有构建和推送这两个镜像、生成离线包或发布清单（`release-manifest.json`）的流水线（未实现）。镜像和离线包需要由发布方用 `backend/Dockerfile` 与 `frontend/Dockerfile` 另行构建并提供。

## 3. 配置 `.env`

在部署主机上把 `.env.private.example` 复制为 `.env`，替换所有占位值。`.env` 包含数据库密码和签名密钥，应只对运维人员可读，不要提交到版本库。

| 变量 | 说明 |
| --- | --- |
| `IMAGE_REGISTRY` | 镜像仓库地址，默认 `ghcr.io` |
| `IMAGE_NAMESPACE` | 镜像命名空间 |
| `IMAGE_TAG` | 要安装的镜像标签，格式由发布方决定（模板示例为 `0.3.5-a1b2c3d`） |
| `APP_PUBLIC_URL` | 用户访问前端的完整地址，用于邀请和密码重置邮件中的链接 |
| `CORS_ORIGINS` | 明确列出的前端来源，JSON 数组格式，不能包含 `*` |
| `SECRET_KEY` | JWT 签名密钥，至少 32 个字符，不能是模板占位值 |
| `POSTGRES_PASSWORD`、`NEO4J_PASSWORD` | 数据库密码 |
| `SMTP_HOST` 等 `SMTP_*` | 邮件服务，用于邀请和密码重置 |
| `FRONTEND_PORT`、`BACKEND_PORT` | 前端对外端口和后端本机端口 |
| `GHCR_USERNAME`、`GHCR_TOKEN` | 可选，仅在线安装且镜像为私有时需要 |

除上表外，还有两项要求需要特别注意：

- **`SMTP_HOST` 必须填写。** 后端镜像以 `APP_MODE=production` 运行，启动时会检查 `SECRET_KEY`、`CORS_ORIGINS` 和 `SMTP_HOST`（见 `backend/app/config.py` 中的 `validate_runtime`）。模板中 `SMTP_HOST` 为空，`scripts/doctor.py` 也不检查这一项；不填写时后端进程会在启动时退出，表现为后端容器反复重启、健康检查失败。
- **全新安装需要 `PALANTIR_SEED_ADMIN_PASSWORD`。** 首次对空库执行迁移时，迁移 `0010` 会创建 `admin` 账号，并从该环境变量读取初始密码；变量缺失时迁移报错退出。这个变量不在 `.env.private.example` 中，release compose 也不会把它传给后端容器，因此需要按第 4 节的方式在执行迁移时单独提供。请使用强密码，并通过安全渠道交给客户管理员。

可选变量 `PALANTIR_SEED_DEMO_PASSWORD` 只在迁移 `0011` 中用于创建演示账号；生产环境通常不设置它，此时迁移只输出警告并跳过演示账号。私有化部署也不会导入制造业演示数据（未设置 `ENABLE_MANUFACTURING_DEMO_SEED`），安装后是一个空的租户。

AI 相关变量中，release compose 只向后端传入 `AI_PROVIDER`、`AI_BASE_URL`、`OPENAI_API_KEY` 和 `OPENAI_MODEL`。模板默认的 `AI_PROVIDER=mock` 不在后端支持的提供方列表中，会按 `glm` 处理；没有提供密钥时 AI 功能不可用。更直接的做法是部署完成后，由管理员在“后台设置 → AI 与平台设置”中配置模型服务。

## 4. 在线安装

1. 准备 `.env`（见第 3 节）。
2. 运行部署脚本。

   Linux：

   ```bash
   cp .env.private.example .env
   vim .env
   ./scripts/deploy-private.sh
   ```

   Windows PowerShell：

   ```powershell
   Copy-Item .env.private.example .env
   notepad .env
   .\scripts\deploy-private.ps1
   ```

   bash 脚本支持 `--env <文件>` 和 `--compose <文件>`；PowerShell 脚本对应 `-EnvFile` 和 `-ComposeFile`。

3. 如果这是对空数据库的首次安装，脚本会在迁移步骤失败（原因见第 3 节）。此时容器已经启动，在主机上手动执行迁移并传入初始管理员密码：

   ```bash
   docker exec -e PALANTIR_SEED_ADMIN_PASSWORD='<初始管理员密码>' manufoundry-backend alembic upgrade head
   ```

   不要把密码写进脚本或命令历史可被他人读取的位置；可以先在当前 shell 中 `read -s` 读入变量再引用。迁移成功后，运行 `python scripts/doctor.py --env .env --compose docker/docker-compose.release.yml --wait 60` 完成部署后检查。

4. 用 `admin` 和上一步设置的密码登录，立即修改密码，并按需开启多因素认证。

部署脚本依次执行以下操作：

1. 在线模式下，如果 `.env` 中配置了 `GHCR_USERNAME` 和 `GHCR_TOKEN`，先执行 `docker login`，再拉取 `backend` 和 `frontend` 镜像。
2. 运行 `doctor.py --skip-runtime` 做部署前检查。
3. 启动 `postgres` 和 `neo4j`，再启动 `backend` 和 `frontend`（Compose 会等待依赖服务健康）。
4. 在后端容器内执行 `alembic upgrade head`。全新空库从第一个迁移建到最新迁移，0.3.22 已修复此前对空库执行迁移失败的问题。
5. 运行 `doctor.py --wait 60` 做部署后检查。

bash 脚本使用 `set -e`，任何一步失败都会中止。PowerShell 脚本不会因为 `docker` 等外部命令返回非零而中止，需要逐步查看输出，确认迁移和诊断都成功。

升级到新版本时，修改 `.env` 中的 `IMAGE_TAG` 后重新运行部署脚本即可。已有数据库中 `admin` 已经存在，迁移不再需要初始管理员密码。升级前先按第 7 节备份，并阅读对应版本的[版本说明](../releases)，确认是否有需要额外执行的升级步骤。

## 5. 离线安装

离线包是一个 zip 文件，其中包含后端和前端镜像的 `*.tar` 文件。部署脚本会解压它，对每个 tar 执行 `docker load`，之后流程与在线安装相同（不访问镜像仓库）。PostgreSQL 和 Neo4j 的基础镜像（`postgres:16-alpine`、`neo4j:5-community`）也必须在主机上可用，如果离线包中没有，需要另外导入。

Linux：

```bash
./scripts/deploy-private.sh --offline ./palantir-demo-offline-<IMAGE_TAG>.zip
```

Windows PowerShell：

```powershell
.\scripts\deploy-private.ps1 -Offline .\palantir-demo-offline-<IMAGE_TAG>.zip
```

`.env` 中的 `IMAGE_NAMESPACE` 和 `IMAGE_TAG` 必须与离线包中镜像的名称和标签一致，否则 Compose 找不到已加载的镜像。首次安装同样需要按第 4 节第 3 步单独执行迁移。

## 6. 诊断

部署前后都可以运行诊断脚本：

```bash
python scripts/doctor.py --env .env --compose docker/docker-compose.release.yml
```

只做静态检查、不访问运行中的服务时加 `--skip-runtime`；需要等待服务启动时加 `--wait <秒数>`。

`doctor.py` 的检查内容如下：

- `docker` 和 `docker compose` 是否可用，Compose 配置能否解析。
- `.env` 中的必填项：`IMAGE_NAMESPACE`、`IMAGE_TAG`、`APP_PUBLIC_URL`、`CORS_ORIGINS`、`SECRET_KEY`、`POSTGRES_PASSWORD`、`NEO4J_PASSWORD`。`SECRET_KEY` 必须至少 32 位，且不能包含 `change-me` 或 `replace`。
- 前端、后端、PostgreSQL、Neo4j 端口是否在监听。这一项只做报告，不会判定失败。
- 运行时检查：后端 `http://127.0.0.1:<BACKEND_PORT>/health`，以及通过前端反向代理访问 `/api/v1/release/current`。
- 后端运行时执行 `alembic current` 并显示当前迁移版本。这一项只做提示，不会判定失败；确认迁移是否到最新版本需要人工比对。

`doctor.py` 不检查 `SMTP_HOST` 和 `PALANTIR_SEED_ADMIN_PASSWORD`。后端容器反复重启时，先查看 `docker logs manufoundry-backend` 中的启动错误。

## 7. 备份

升级前必须备份数据库和数据卷。最小的 PostgreSQL 备份：

```bash
docker exec manufoundry-postgres pg_dump -U manufoundry manufoundry > backup-$(date +%Y%m%d%H%M).sql
```

如果在 `.env` 中修改过 `POSTGRES_USER` 或 `POSTGRES_DB`，替换命令中对应的值。

表单附件保存在 `form_files` 卷中，Neo4j 数据保存在 `neo4j_data` 卷中，也需要一并备份。卷的实际名称带有 Compose 项目名前缀，用 `docker volume ls` 查看。知识库上传的原始文件默认写入后端容器内的 `/app/storage/knowledge_assets`，release compose 没有为它挂载卷，容器重建后这些文件会丢失；如果要在私有化环境中使用知识库文件上传，需要先解决持久化问题。

**警告：恢复操作会覆盖现有数据。** 恢复数据库或数据卷前，先在独立环境中演练恢复流程并核对数据，再在生产环境执行；执行前停止 `backend` 和 `frontend`，避免恢复过程中有新写入。

## 8. 回滚

回滚脚本只切换应用镜像版本：它把 `.env` 中的 `IMAGE_TAG` 改为指定值，拉取镜像，重新启动 `backend` 和 `frontend`，再运行 `doctor.py --wait 60`。

Linux：

```bash
./scripts/rollback-private.sh <IMAGE_TAG>
```

Windows PowerShell：

```powershell
.\scripts\rollback-private.ps1 -ImageTag <IMAGE_TAG>
```

bash 脚本同样支持 `--env` 和 `--compose`，PowerShell 脚本支持 `-EnvFile` 和 `-ComposeFile`。

使用回滚前需要了解以下限制：

- **回滚不会降级数据库。** 新版本执行过的迁移仍然保留。如果新版本包含不兼容的结构变更，旧版本代码可能无法正常运行。这类问题应先检查迁移内容和数据状态，必要时从第 7 节的备份恢复，而不是只切换镜像。
- 回滚脚本先改写 `.env`，再执行 `docker compose pull`。离线环境无法访问镜像仓库时，bash 脚本会在拉取步骤中止，但 `.env` 中的 `IMAGE_TAG` 已经是目标值。此时确认旧版本镜像仍在本机（`docker images`），然后执行：

  ```bash
  docker compose --env-file .env -f docker/docker-compose.release.yml up -d backend frontend
  python scripts/doctor.py --env .env --compose docker/docker-compose.release.yml --wait 60
  ```

回滚完成后，可以在前端页头的“版本记录”或 `/api/v1/release/current` 中确认当前运行的版本。
