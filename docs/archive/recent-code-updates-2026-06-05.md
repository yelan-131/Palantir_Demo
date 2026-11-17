# 近期代码更新说明

Last updated: 2026-06-05

本文汇总本轮代码更新，从平台框架、后端接口、前端页面、AI 能力、权限安全、测试和部署影响几个层面说明。它用于交付复盘、上线说明和后续研发接手。

## 1. 总体框架变化

本轮更新继续沿着“制造业低代码工作台 + 知识智能 + 可治理权限”的方向推进。核心变化不是单点页面改样式，而是把几个运行闭环补齐：

- AI 工作区从“浮动聊天窗口”增强为可管理的多会话工作台，支持历史、归档、恢复、重命名和删除。
- 平台表单从“字段配置 + 动态记录”进一步补齐运行态权限，表单返回值带上 `permission_design` 和 `runtime_field_permissions`。
- 知识库从“上传后抽取”扩展为“已入库文档 -> 本体 intake 推荐 -> 候选抽取 -> 人工批准 -> 图谱发布”的链路。
- 系统管理补强组织和用户治理，组织 CRUD 写入审计，用户管理支持 CSV 批量导入。
- 应用运行入口和认证逻辑更接近生产边界，角色不可见的应用菜单会被拦截，无效 token 不再降级为匿名用户。
- 新增 GitHub Actions CI 与生产部署 workflow，让 GitHub 侧具备测试、构建、镜像发布和生产部署入口。

## 2. 后端更新

### 2.1 AI 会话管理

文件：

- `backend/app/api/ai_assistant.py`
- `backend/app/services/ai/runtime.py`
- `backend/app/services/ai/dynamic_record_drafts.py`

主要变化：

- 新增 `PATCH /api/v1/ai/agent/conversations/{conversation_id}`，支持更新会话标题和状态。
- 会话状态允许 `active`、`closed`、`deleted`，列表查询在 `include_closed=true` 时排除 `deleted`。
- 前端归档对应后端 `closed`，删除对应 `deleted`，恢复对应重新置为 `active`。
- 与“AI draft”相关的用户可见文案调整为“待确认操作 / 操作预览”，减少用户把 AI 待确认动作误解为普通草稿的风险。
- 恢复待确认动作时，权限检查和待确认状态仍保留，已执行或取消的动作不能继续编辑。

### 2.2 动态表单运行态

文件：

- `backend/app/api/forms.py`
- `backend/app/api/dashboard.py`
- `frontend/src/services/api.ts`

主要变化：

- 表单 payload 新增 `permission_design`，从 `config.permissionDesign` 提取，方便前端在设计器和运行态复用同一权限设计。
- 已发布表单 payload 同样带上 `permission_design`，避免运行态只看到字段而看不到权限设计。
- 运行态表单新增 `runtime_field_permissions`，后端按当前用户、角色和字段配置汇总可见、可编辑、可导出能力。
- 记录列表、记录详情、筛选和排序都会检查字段可见范围，禁止通过不可见字段查询或排序。
- 动态表单 dashboard 返回 `viewConfig`，应用程序页可以按表单配置渲染列、筛选和状态展示。
- 编码字段的存储类型收敛为 `string`，编码业务含义迁移到 `ui_config.businessType = code`、`controlType = code` 和 `encodingRule`。

影响：

- 低代码表单更适合承载真实业务交互表。
- 前端按钮隐藏不再是唯一防线，后端对字段读取和写入也做约束。
- 后续接工作流节点权限时，可以沿用 `runtime_field_permissions` 的结构。

### 2.3 知识文档本体 intake

文件：

- `backend/app/api/knowledge.py`
- `backend/app/services/ai/ontology_extraction.py`
- `.agent/skills.md`
- `.agent/tools.md`
- `backend/tests/test_knowledge_extraction.py`

主要变化：

- 上传知识资产后，返回值新增 `intake_recommendation`，让前端知道该文档可进入哪些 AI 能力。
- 新增 `POST /api/v1/knowledge/documents/{document_id}/ontology-intake`，基于已入库文档生成本体 intake 建议。
- 新增 `POST /api/v1/knowledge/documents/{document_id}/extraction-jobs`，不用重新上传文件即可从已入库文档创建本体抽取任务。
- 抽取结果保留原有 `entities`、`relations`、`logic_rules`、`actions`，并新增：
  - `generic_entities`：平台通用对象视角。
  - `domain_mappings`：制造业领域类型映射。
  - `properties`：实体属性候选和证据位置。
  - `document_profile`：文档画像。
- `.agent` 技能和工具注册新增 `knowledge.intake_document_ontology`，并声明抽取、批准、发布图谱的确认策略和风险等级。
- 新增测试覆盖“上传文档 -> intake 推荐 -> 已入库文档抽取”的路径。

影响：

- 知识库不再只支持一次性文件抽取，已索引文档也能进入本体建模。
- 抽取结果同时兼容制造业模型和平台通用对象模型，便于后续跨行业扩展。
- 图谱发布前保留人工批准和质量报告，符合可治理 AI 写入原则。

### 2.4 系统管理和审计

文件：

- `backend/app/api/admin.py`
- `frontend/src/pages/SystemAdmin/OrganizationManagement.tsx`
- `frontend/src/pages/SystemAdmin/UserManagement.tsx`
- `frontend/src/pages/SystemAdmin/RoleManagement.tsx`
- `frontend/src/pages/SystemAdmin/IdentityAccessManagement.tsx`

主要变化：

- 组织单元列表返回 `created_at` 和 `updated_at`。
- 组织单元新增、更新、删除都会写审计日志，记录 old/new values。
- 组织编码更新时增加租户内唯一性检查。
- 禁止把组织父级设置为自己，并继续检查子组织、成员等删除约束。
- 用户管理支持 CSV 导入，表头为：

```text
username,display_name,email,password,role_names,org_names,is_active
```

- 导入时按角色名称/标签、组织名称匹配角色和组织，支持英文或中文分号分隔多个值。

影响：

- 组织结构调整有审计证据。
- 批量初始化演示租户或真实租户用户更方便。
- IAM 管理页面的数据关系更完整。

### 2.5 应用访问和认证边界

文件：

- `backend/app/api/applications.py`
- `backend/app/api/deps.py`
- `frontend/src/stores/authStore.ts`

主要变化：

- mock fallback 下，非管理员且没有角色的用户不再默认看到所有已发布应用。
- 应用菜单和应用详情接口增加 `_mock_can_access_application` 检查，角色不匹配时返回 403。
- 缺少 token 且处于非生产 demo 模式时，仍允许匿名 guest fallback。
- 但无效 token 或已失效 session 不再 fallback 到 guest，而是返回 401。
- 前端恢复登录态失败时会清理 `mf_token` 和 `mf_user`，不再只凭本地旧用户对象维持已登录状态。

影响：

- demo 访问仍保留，但坏 token 不会伪装成匿名用户继续访问。
- 应用可见性与角色绑定更一致。
- 线上鉴权边界更接近真实 SaaS 要求。

## 3. 前端更新

### 3.1 AI 工作区

文件：

- `frontend/src/components/AiChatWidget/index.tsx`
- `frontend/src/components/AiChatWidget/style.css`
- `frontend/src/index.css`
- `frontend/src/services/api.ts`

主要变化：

- 移除横向 quick prompts，把入口收敛到独立 AI 工作区和历史会话。
- 会话支持按“今天 / 最近 7 天 / 更早”分组。
- 历史窗口支持搜索。
- 新增“最近 / 已归档”分段切换。
- 活跃会话可以归档，归档会话可以恢复或删除。
- 会话标题支持内联重命名，并通过 `PATCH /ai/agent/conversations/{id}` 持久化。
- 会话列表和标签页样式重构，更适合长时间使用。

### 3.2 表单设计器和应用程序页

文件：

- `frontend/src/pages/FormSettings/index.tsx`
- `frontend/src/pages/FormSettings/style.css`
- `frontend/src/pages/AppPrograms/index.tsx`
- `frontend/src/pages/AppPrograms/style.css`
- `frontend/src/pages/AccountCenter/index.tsx`

主要变化：

- 表单配置体验大幅扩展，围绕业务字段、视图配置、权限设计和运行态预览组织。
- 应用程序页开始消费后端返回的 `viewConfig`，减少纯前端硬编码布局。
- 业务表单字段可区分存储类型、业务类型和控件类型，编码字段不再要求独立存储类型。
- 账号中心和系统管理中的语义资产、知识、本体、图谱入口进一步拆分。

### 3.3 语义资产和知识中心

文件：

- `frontend/src/pages/SystemAdmin/SemanticAssetCenter.tsx`
- `frontend/src/services/api.ts`

主要变化：

- 知识中心新增 AI ontology intake 卡片。
- 选择或上传文档后，前端会请求 intake 推荐并展示文档画像、能力标签和建议动作。
- 支持从已入库文档启动本体抽取。
- 抽取后展示 generic/domain/relation 指标、候选实体表格和质量报告状态。
- 支持批准候选和发布到图谱。

## 4. 工程化更新

文件：

- `.github/workflows/ci.yml`
- `.github/workflows/deploy.yml`

CI workflow 覆盖：

- 后端依赖安装和 pytest。
- 前端 `npm run type-check` 与 `npm run build`。
- 后端和前端 Dockerfile 构建检查。
- master push 后构建并推送 GHCR 镜像。
- 生成 release manifest 和离线包。

Deploy workflow 覆盖：

- CI 成功后或手动触发部署。
- 通过 GitHub Secrets SSH 到生产服务器。
- 更新 `/root/Palantir_Demo` 仓库。
- 拉取 release 镜像，启动 postgres、neo4j、redis、backend、frontend。
- 执行 Alembic 迁移。
- 验证公网前端、后端 health、readiness、release 和 productization readiness。

## 5. 文档更新

新增和调整：

- `docs/archive/recent-code-updates-2026-06-05.md`：本轮代码更新说明。
- `docs/guides/low-code/form-interaction-logic.md`：业务交互表运行逻辑说明。
- `docs/README.md`：补充业务交互表文档入口。

## 6. 测试建议

本轮代码触及权限、AI、表单和前端大页面，建议至少执行：

```bash
cd backend
python -m pytest tests/test_knowledge_extraction.py
```

```bash
cd frontend
npm run type-check
npm run build
```

如果时间允许，再补充：

- 组织 CRUD 审计日志检查。
- 非管理员不同角色访问应用菜单检查。
- 动态表单列表按字段权限裁剪检查。
- 知识中心从已上传文档启动本体抽取、批准、发布图谱。
- AI 工作区会话归档、恢复、删除、重命名。

## 7. 上线注意

- 生产环境前端监听宿主机 80，前端容器监听 80。
- 后端健康检查使用 `http://111.229.172.100:8000/health`。
- 部署时要保留服务器本地 `.env` 等部署文件，不要用仓库文件覆盖。
- 如使用 GitHub Actions 部署，需要配置对应 Secrets；手动服务器部署仍可直接 SSH 到 `/root/Palantir_Demo` 执行 git pull、Docker Compose rebuild/restart 和健康检查。
