# ManuFoundry / Palantir Demo 0.3.1 发布说明

发布日期：2026-05-27

## 版本定位

`0.3.1` 是一次 AI Agent 与系统设置持久化的小版本更新。当前代码状态从 `0.3.0` 推进到 `0.3.1`，重点不是新增一个独立业务模块，而是让 AI 设置、知识库对话、浮窗 Agent 和服务器数据库状态更接近可持续迭代的开发版本。

## 本次更新

- 新增 `system_settings` 持久化表，AI 平台设置不再只依赖进程内存。
- 新增 Alembic 迁移 `0018_system_settings.py`，服务器部署时需要执行到最新迁移版本。
- AI 设置接口 `/api/v1/ai/settings` 会优先读取持久化配置，并继续保留 GLM 默认配置。
- AI Agent 浮窗接入后端 Agent runtime，后端不可用时仍保留本地兜底回复。
- 知识库 Agent 增强普通聊天和知识任务的意图区分，减少寒暄时误触发知识检索。
- 账号中心 AI 设置面板与后端设置接口保持同一套配置模型。

## 默认 AI 配置

当前默认配置如下，真实模型调用仍需要在服务器配置有效密钥：

| 项目 | 默认值 |
| --- | --- |
| Provider | `glm` |
| Base URL | `https://open.bigmodel.cn/api/paas/v4` |
| Chat model | `glm-5.1` |
| Reasoning model | `glm-5.1` |
| Embedding model | `embedding-3` |
| Vision model | `glm-4v-plus` |

密钥不写入 GitHub。服务器应通过 `.env` 或后端设置接口保存密钥，接口返回时会掩码显示。

## 数据库发布要求

本版本包含数据库结构变化和本地演示数据同步要求：

1. 服务器 PostgreSQL 需要执行 `alembic upgrade head`，目标迁移至少为 `0018_system_settings`。
2. 本地开发库 `backend/manufoundry.db` 中的演示数据需要同步到服务器 PostgreSQL。
3. 当前仍处于开发期，服务器数据库可以按整库覆盖方式同步；覆盖后需要重新验证登录、组织/角色/权限、知识库、AI 设置和核心演示数据。

## 部署后验证

部署完成后至少检查：

- `GET /health` 返回 `{"status":"healthy"}`。
- `GET /api/v1/release/current` 返回版本 `0.3.1`。
- `GET /api/v1/ai/settings` 返回 GLM 默认配置或服务器保存配置。
- 登录接口可用，默认开发账号仍可登录。
- 数据库迁移版本为最新版本。
- Docker Compose 中 `backend`、`frontend`、`postgres`、`redis`、`neo4j` 正常运行。

