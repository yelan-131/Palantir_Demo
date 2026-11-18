# ManuFoundry 文档索引

更新日期：2026-11-18

当前发布版本为 [0.3.24](releases/release-0.3.24.md)，发布于 2026-11-18。
版本编号与发布流程见[版本策略](operations/version-policy.md)。

## 1. 目录结构

文档先按“讲的是什么、能信多少”分目录，目录内再按业务模块分子目录：

| 目录 | 内容 | 可信程度 |
| --- | --- | --- |
| `architecture/` | 现状：当前代码如何实现 | 已按 0.3.22 的代码核对，开头标注对应版本 |
| `guides/` | 使用说明：配置人员和业务人员怎么操作 | 已按当前界面核对 |
| `development/` | 开发指南、API 参考、从零实现规格 | 开发指南与 API 参考对应当前代码；规格文档注明了自己的核对基线 |
| `operations/` | 部署、私有化部署、测试、版本策略 | 对应当前代码与脚本 |
| `design/` | 设计与规划：产品意图、阶段方案、Palantir 构想 | 开头标注“状态：设计”或“状态：规划”，可能包含未实现的内容 |
| `releases/` | 每个版本的发布说明 | 历史记录，只描述当时的情况 |
| `archive/` | 旧指南、交付记录、UI 优化记录与截图 | 历史记录，不再维护 |

文档与代码不一致时，以代码为准：

| 方面 | 依据 |
| --- | --- |
| 接口 | `backend/app/main.py`、`backend/app/api/*`；`python scripts/docs/generate_api_reference.py --check` 可检查 API 参考是否过期 |
| 前端路由 | `frontend/src/App.tsx` |
| 表结构 | `backend/app/models/relational.py`、`backend/alembic/versions/*` |
| 部署 | `docker/*.yml`、`backend/Dockerfile`、`frontend/Dockerfile`、`frontend/nginx.conf`、`scripts/deploy-private.*` |
| 版本 | `release.json`、`backend/app/config.py` 的 `APP_VERSION` |

## 2. 从这里开始

| 文档 | 内容 |
| --- | --- |
| [系统架构总览](architecture/overview.md) | 系统定位、技术栈、分层、主要数据流、运行模式、当前边界 |
| [代码框架](architecture/current-framework.md) | 前后端目录与模块清单、页面与路由对应、改代码后该更新哪份文档 |
| [数据模型](architecture/data-model.md) | 99 张表的分组、表单的两种存储方式与配置写入链路、Neo4j 图模型、迁移历史、种子数据 |
| [身份与权限体系](architecture/permissions.md) | 认证与会话、租户、管理员与平台管理员、应用与菜单可见性、表单权限、记录范围与字段限制 |
| [后端开发指南](development/backend.md) | 本地运行、配置项、分层规则、新增接口检查项、迁移与 AI 约定 |
| [前端开发指南](development/frontend.md) | 命令、环境变量、路由与页面解析、菜单、接口调用、页面约定 |
| [API 参考](development/api-reference.md) | 鉴权方式、访问级别、公开接口、全部路由表（由脚本生成） |
| [演示走查](guides/demo-walkthrough.md) | 按业务工作台、应用配置、数据中心、后台设置、AI 助手的顺序演示产品 |

## 3. 按模块查找

| 模块 | 现状（`architecture/`） | 使用说明（`guides/`） | 设计与规划（`design/`） |
| --- | --- | --- | --- |
| 低代码平台 | [低代码平台架构](architecture/low-code/platform.md)：界面与 AI 共用的服务、配置与运行分离、存储方式、组件页面、工具注册表 | — | [配置资产生命周期](design/low-code/configuration-lifecycle.md) |
| 表单 | [表单](architecture/low-code/forms.md)：字段、布局、规则、编码、发布与版本、流程绑定、记录运行时、已知限制 | [业务表单配置指南](guides/low-code/business-form-guide.md)、[表单运行逻辑](guides/low-code/form-interaction-logic.md) | [表单管理交互设计](design/low-code/form-designer-interaction.md) |
| 应用与菜单 | [应用与应用菜单](architecture/low-code/applications.md)：可见性、菜单节点、默认入口、状态与并发保护 | 见业务表单配置指南中的菜单挂载 | 见配置资产生命周期 |
| 工作台与通知 | [我的工作台、流程与待办、通知中心](architecture/low-code/workbench.md) | — | — |
| 权限 | [身份与权限体系](architecture/permissions.md) | — | [SaaS 产品化第一阶段](design/saas-phase-1.md)（租户边界与上线检查） |
| 知识库与图谱 | [知识库架构](architecture/knowledge/knowledge-base.md)、[图谱集成（Neo4j）](architecture/knowledge/graph.md) | [知识库使用流程](guides/knowledge/knowledge-workflow.md)、[Neo4j 入门](guides/knowledge/neo4j-beginner.md) | — |
| AI | [AI 能力概览](architecture/ai/README.md)、[DeepSeek Harness 运行时](architecture/ai/harness-runtime.md)、[AI 技能与工具契约](architecture/ai/skill-contract.md) | — | [AIP 风格智能层设计](design/palantir/aip-intelligence-layer.md) |
| 数据接入 | [数据接入与连接器](architecture/integration.md)：哪些是真实实现、哪些是模拟、哪些未实现 | — | — |

## 4. 开发、运维与发布

| 文档 | 内容 |
| --- | --- |
| [部署](operations/deployment.md) | Compose 文件、端口、生产服务器更新流程、迁移、验证、回滚 |
| [私有化部署](operations/private-deployment.md) | 预构建镜像的在线与离线安装、诊断、备份与回滚，以及全新安装需要手动补充的配置 |
| [测试说明](operations/testing.md) | 后端与前端测试命令、PostgreSQL 专项测试、CI、覆盖范围与缺口 |
| [已知问题](operations/known-issues.md) | 核对文档时发现、尚未修复的安全、部署与功能问题，以及未使用的代码 |
| [项目版本与发布规则](operations/version-policy.md) | 版本号规则、草稿与发布状态、`scripts/bump_release.py` 的用法 |
| [演示知识资产](operations/demo-knowledge-assets.md) | 生成与导入演示知识文件的脚本，以及它们会覆盖或删除哪些数据 |
| [业务表单定义：现有 UI、架构与交互参考](development/business-form-spec/README.md) | 面向从零编写表单系统的开发者，核对基线为 0.3.18；另有[离线图文版](development/business-form-spec/index.html)和[从零编写业务表单系统](development/business-form-spec/from-scratch.md)（不依赖本项目代码的开发规格） |

## 5. 设计与规划

这些文档描述产品或工程意图，不代表已经实现。每篇开头注明状态，涉及现有模块的条目标注了已实现、部分实现或未实现。

| 文档 | 内容 |
| --- | --- |
| [0.4.0 阶段规划](design/roadmap-0.4.0.md) | 建议方案与截至 0.3.22 的进展对照，不是发布承诺 |
| [SaaS 产品化第一阶段](design/saas-phase-1.md) | 首个 SaaS 边界、已实现的守卫、模块成熟度、上线检查清单 |
| [配置资产生命周期](design/low-code/configuration-lifecycle.md) | 应用、表单等可配置资产的草稿、发布、停用、归档规则 |
| [表单管理交互设计](design/low-code/form-designer-interaction.md) | 表单设计器尚未实现的交互构想 |
| [AIP、Foundry、Gotham 与低代码平台关系图](design/palantir/relationship-map.md) | Palantir 参考构想的总览，链接到 [Foundry 风格业务底座](design/palantir/foundry-foundation.md)、[AIP 风格智能层](design/palantir/aip-intelligence-layer.md)、[Gotham 风格指挥台](design/palantir/gotham-command-ui.md)、[角色工作台](design/palantir/role-workbench.md) |
| [界面规范](../DESIGN.md)、[产品说明](../PRODUCT.md) | 视觉与产品约定（仓库根目录） |

## 6. 发布说明（历史）

每个版本的发布说明记录当时的范围、验证结果和部署状态，发布后不再修改正文。版本清单以 `release.json` 为准。

| 版本 | 日期 | 标题 |
| --- | --- | --- |
| [0.3.24](releases/release-0.3.24.md) | 2026-11-18 | AI 确认续接、设计入口统一与工作流修复 |
| [0.3.23](releases/release-0.3.23.md) | 2026-11-18 | 应用菜单页面编辑与属性面板统一 |
| [0.3.22](releases/release-0.3.22.md) | 2026-11-18 | 应用发布与表单版本、AI 业务技能及工作台更新 |
| [0.3.21](releases/release-0.3.21.md) | 2026-11-14 | AI 技能、应用页面与数据中心 |
| [0.3.20](releases/release-0.3.20.md) | 2026-11-05 | 业务数据、页面设计与应用菜单 |
| [0.3.19](releases/release-0.3.19.md) | 2026-11-03 | AI 看板、组件页面与流程下发增强 |
| [0.3.18](releases/release-0.3.18.md) | 2026-10-28 | AI 配置与原生设计器联动 |
| [0.3.17](releases/release-0.3.17.md) | 2026-10-27 | 审批路由、访问权限与性能优化 |
| [0.3.16](releases/release-0.3.16.md) | 2026-10-26 | 统一组件画布与数据工作区增强 |
| [0.3.15](releases/release-0.3.15.md) | 2026-10-23 | 修复 HTTP 环境业务表单无法打开 |
| [0.3.14](releases/release-0.3.14.md) | 2026-10-23 | 分析工作台与表单设计增强 |
| [0.3.13](releases/release-0.3.13.md) | 2026-10-19 | AI 执行与表单规则增强 |
| [0.3.12](releases/release-0.3.12.md) | 2026-10-17 | AI 配置与低代码工作台增强 |
| [0.3.11](releases/release-0.3.11.md) | 2026-10-15 | 业务记录统一与 Harness AI 运行时升级 |
| [0.3.10](releases/release-0.3.10.md) | 2026-10-14 | 工作台重构与业务审批流程 |
| [0.3.9](releases/release-0.3.9.md) | 2026-06-15 | 工作流定义快照与审批治理增强 |
| [0.3.8](releases/release-0.3.8.md) | 2026-06-12 | Agent 工具协议、物理表单与本体映射增强 |
| [0.3.7](releases/release-0.3.7.md) | 2026-06-10 | 对象关系中心、应用运行态与流程待办增强 |
| [0.3.6](releases/release-0.3.6.md) | 2026-06-06 | AI 工作区会话与低代码执行链路增强 |
| [0.3.5](releases/release-0.3.5.md) | 2026-06-03 | Agent 技能、权限与系统管理体验增强 |

更早的 [0.3.1](releases/release-0.3.1.md)–[0.3.4](releases/release-0.3.4.md) 发布说明也在 `releases/` 目录中。

## 7. 归档

只作历史记录，内容可能与当前代码不符：

- 旧指南：[旧部署指南](archive/05-部署指南.md)、[旧开发者指南](archive/06-开发者指南.md)、[审计变更记录](archive/17-审计变更记录.md)
- 交付与验证记录：[近期代码更新说明 2026-06-05](archive/recent-code-updates-2026-06-05.md)、[页面与组件第一批验证](archive/component-pages-pilot.md)
- UI 优化记录：[Impeccable 接入与业务列表优化](archive/impeccable-ui.md)、[全站 UI 优化与验收记录](archive/ui-system-2026-11-10.md)；相关截图在 `archive/screenshots/`

## 8. 维护规则

- 新文档按第 1 节的目录放置：描述当前代码的放 `architecture/`（属于某个模块就放进对应子目录），操作说明放 `guides/`，尚未实现的意图放 `design/`。
- `architecture/`、`guides/`、`operations/` 下的文档开头写“更新日期：YYYY-MM-DD（对应代码版本 X.Y.Z）”；`design/` 下的文档开头写“状态：设计”或“状态：规划”，并说明哪些已经实现。
- 尚未实现的行为不要写成现状；现状文档中保留的意图放在“边界与未实现”一类的小节，并标注“（未实现）”。
- 完整的路由表只放在 [API 参考](development/api-reference.md) 中，由 `python scripts/docs/generate_api_reference.py` 生成，不要手工编辑标记之间的内容。其他文档描述能力，并链接到 API 参考。
- 修改 `development/business-form-spec/README.md` 后运行 `node scripts/docs/render-business-form-reference.mjs` 重新生成离线图文版。
- 改代码后更新对应的现状文档，对照表见[代码框架](architecture/current-framework.md)末尾。
- 每个事实只写在一篇文档中，其他文档链接过去。
- 危险的运维命令（清空数据、重置密码、恢复备份）放在带警告的段落中。
- 只改文档不升级版本号；发布说明发布后不再修改正文。
- 文档使用简体中文，代码标识符、路径、环境变量保留英文。
- 不在文档中写入生产管理员账号密码或其他密钥。
