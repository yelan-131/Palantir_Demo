# ManuFoundry / Palantir Demo 0.3.2 发布说明

发布日期：2026-05-27

## 版本定位

`0.3.2` 聚焦 AI Agent 的上下文组织、知识库演示资产和前端浮窗体验。这个版本继续沿着 0.3.x 的 AI 平台化方向推进，把页面上下文、会话历史、长期记忆、RAG 证据和制造业知识文档更清晰地接到同一套 Agent runtime。

## 本次更新

- 新增 AI 上下文构建器，统一整理页面、用户、会话、记忆和知识证据。
- 新增制造业知识库演示资产，覆盖 SOP、CAPA、供应商 8D、工艺控制、设备复核和客户风险沟通等场景。
- 新增知识库资产种子脚本，可将 Word、Excel、PDF 风格资料写入本地演示库。
- 增强 AI 记忆与知识库接口，为后续多轮对话和可追溯回答打基础。
- 优化 AI 浮窗交互、上下文入口和样式表现。
- 账号中心 AI 设置增加上下文、记忆、RAG 等策略配置项。
- 语义资产中心与相关 API 增强，以便承载知识资产与 Agent 工作流。

## 数据库发布要求

本版本包含新的知识库演示数据。部署时需要：

1. 运行本地 `scripts/seed_demo_knowledge.py`，确保 `backend/manufoundry.db` 包含 0.3.2 知识资产。
2. 上传代码和 `data/knowledge_assets` 到服务器。
3. 将本地 SQLite 演示库整库覆盖同步到服务器 PostgreSQL。
4. 验证服务器 `knowledge_documents`、`knowledge_chunks`、`system_settings` 等关键表数据量。

## 部署后验证

- `GET /api/v1/release/current` 返回 `0.3.2`。
- `GET /api/v1/ai/settings` 返回上下文、记忆、RAG 策略配置。
- 默认账号可登录。
- 知识库文档和 chunks 数量与本地演示库一致。
- Docker Compose 中 `backend`、`frontend`、`postgres`、`redis`、`neo4j` 正常运行。

