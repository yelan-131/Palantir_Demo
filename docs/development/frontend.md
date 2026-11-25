# 前端开发指南

更新日期：2026-11-17（对应代码版本 0.3.22 草稿）

以代码为准：`frontend/src/App.tsx`（路由与外壳）、`frontend/src/config/navigation.ts`（导航）、`frontend/src/services/api.ts`（接口封装）、`frontend/package.json`（依赖与命令）。
目录说明见[代码框架](../architecture/current-framework.md#3-前端-frontendsrc)。

## 1. 技术栈

| 方面 | 使用 |
| --- | --- |
| 框架与构建 | React 18、TypeScript 5.7、Vite 6 |
| 路由 | React Router 7 |
| 组件库 | Ant Design 5、`@ant-design/pro-components`、`@ant-design/icons`，中文语言包 |
| 状态 | Zustand（仅登录状态），其余为组件内状态与 Context |
| 请求 | axios，统一实例在 `src/services/api.ts` |
| 图表与图 | ECharts（`echarts-for-react`）、Cytoscape（dagre 布局）、React Flow（流程设计器） |

路径别名 `@` 指向 `src/`。

## 2. 命令

```bash
cd frontend
npm ci                          # 按 package-lock.json 安装依赖
npm run dev                     # 开发服务器，端口 3000
npm run type-check              # tsc -b --noEmit
npm run build                   # tsc -b && vite build，输出到 dist/
npm run preview                 # 预览构建产物
node --test tests/*.test.cjs    # 单元测试（需先安装依赖）
```

开发服务器把 `/api` 代理到 `VITE_API_PROXY_TARGET`，默认 `http://localhost:8000`。`docker/docker-compose.yml` 中的前端容器把它设为 `http://backend:8000`。
如果本地环境无法运行 Vite 开发服务器，可以先 `npm run build`，再用 `node local-static-server.mjs` 托管 `dist/` 并把 `/api` 转发到 `127.0.0.1:8000`。

环境变量：

| 变量 | 作用 | 默认 |
| --- | --- | --- |
| `VITE_API_PROXY_TARGET` | 开发服务器的后端代理地址（仅 `vite.config.ts` 使用） | `http://localhost:8000` |
| `VITE_API_BASE_URL` | axios 基础路径 | `/api/v1` |
| `VITE_PUBLIC_PRODUCT_NAME` | 未取得租户信息时显示的产品名 | `ManuFoundry` |
| `VITE_PUBLIC_ASSISTANT_NAME` | 未取得租户信息时显示的助手名 | `<产品名> AI` |

## 3. 应用外壳

`App.tsx` 中：

- 未登录时只渲染 `/login`，其他路径都跳转到登录页；启动时 `authStore.restore()` 用 `/auth/me` 校验本地令牌。
- 登录后渲染外壳：左侧应用栏（`ShellNavigation`）、上下文菜单（应用菜单或设置中心菜单）、页头（页面标题、全局搜索、版本记录、通知中心）、内容区和 AI 助手浮窗。
- 登录后首次进入 `/` 时，会自动打开应用库中的第一个应用（置顶应用优先）的默认入口；点击左侧“首页”则停留在我的工作台。当前应用 ID 保存在 `localStorage` 的 `mf_current_app_id`。
- 通过书签或搜索结果打开某个业务页面时，外壳会查找该页面所属的应用并自动切换。
- 页面路由都是懒加载，外层包了加载骨架和错误边界。
- 有新版本且用户未确认时，在首页页头显示版本提示，确认记录保存在 `mf_acknowledged_release`。

## 4. 路由

### 4.1 主要路由

| 路由 | 页面 |
| --- | --- |
| `/login` | 登录 |
| `/` | 我的工作台 |
| `/workflow` | 流程与待办（待审批、我发起的、我已处理的） |
| `/scheduler` | 日常任务 |
| `/more` | 应用中心 |
| `/plugins` | 插件与扩展 |
| `/account-center` | 账号与安全、工作偏好（`?tab=preferences`） |
| `/dynamic/:slug` | 业务表单页面（见 4.3） |
| `/program/:programId` | 程序页（见 4.3）；`/program/alert-center` 固定为告警中心 |
| `/program/material-application` | 料号申请 |
| `/pages/:code` | 组件页面 |
| `/studio/business-data/:formId/design` | 业务数据与组件属性，包含表单录入和流程设计 |
| `/form-settings/:formId` | 权限管理及其他历史链接重定向 |
| `/studio/*`、`/data-center/*`、`/admin/*` | 由 `pages/NavigationArea` 按路径分发，见 4.2 |

### 4.2 配置、数据与后台入口

入口清单定义在 `config/navigation.ts` 的 `NAVIGATION_ENTRIES`，`adminOnly` 的入口只对管理员显示（后端仍会单独校验）。

| 路由 | 名称 | 页面组件 |
| --- | --- | --- |
| `/studio/applications` | 应用与菜单 | `SystemAdmin/AppMenuManagement` |
| `/studio/business-data` | 业务数据 | `SystemAdmin/AppMenuManagement`（业务数据模式，`?form=` 定位表单） |
| `/studio/page-design` | 页面设计 | `ComponentPages/PageDesignWorkspace` |
| `/studio/templates` | 模板中心 | `TemplateMarket` |
| `/data-center/assets` | 数据资产（资产目录、连接管理、同步任务） | `DataCenterWorkspace workspace="assets"` |
| `/data-center/reference` | 基础数据 | `SystemAdmin/ReferenceDataManagement` |
| `/data-center/objects` | 对象与关系（对象浏览、模型设计、关系探索） | `DataCenterWorkspace workspace="objects"` |
| `/data-center/knowledge` | 知识库 | `SystemAdmin/SemanticAssetCenter` 的 `KnowledgeCenter` |
| `/admin/identity` | 组织、身份与权限 | `SystemAdmin/IdentityAccessManagement` |
| `/admin/ai` | AI 与平台设置 | `AccountCenter` 的 `AIPlatformPanelV2` |
| `/admin/audit` | 审计与日志 | `AccountCenter` 的 `AuditPanel` |
| `/admin/quality-impact` | 质量影响与时间线（实验） | `QualityImpact` |
| `/admin/entity-timeline`、`/admin/graph-tools`、`/admin/model-tools`、`/admin/ai-builder`、`/admin/config-transfer`、`/admin/readiness` | 高级工具 | `BackendSettings` 的对应分区 |

旧的 `/data-center/sources` 和 `/data-center/pipelines` 链接转到「数据资产」中的对应页签。原字段映射链接转到 `/data-center/objects?view=ontology&section=mapping`，并保留来源等筛选参数。旧的后台数据入口也会转到对应页面。

### 4.3 业务页面的解析

`/dynamic/:slug` 和 `/program/:programId` 都由 `pages/ComponentPages/FormPageEntry.tsx` 处理：

1. 请求 `GET /pages/forms/{slug}/binding`。
2. 表单已启用组件页面且有页面编码：渲染 `ComponentPages`。如果是管理员且页面尚未创建，会先调用 `POST /pages/forms/{id}/binding` 创建空白页面并填充原有内容。
3. 已启用但页面未发布：显示“此表单的页面尚未发布”。
4. 未启用组件页面：`/dynamic/*` 回退到 `DynamicPage`，`/program/*` 回退到 `AppPrograms`。
5. 地址带 `?view=records` 时，直接显示该表单的记录列表。

### 4.4 旧地址重定向

| 旧地址 | 跳转到 |
| --- | --- |
| `/dashboard`、`/maintenance`、`/quality`、`/supply-chain` | `/program/production-overview`、`/program/device-health`、`/program/quality-overview`、`/program/supply-overview` |
| `/ai-assistant` | `/`（AI 助手改为浮窗） |
| `/reports`、`/rules`、`/system-admin` 等 | 见 `config/navigation.ts` 的 `LEGACY_ROUTES` |
| `/pages`、`/pages/new` | `/studio/page-design` |
| 其他未知路径 | `/` |

旧的账号中心分区（`/account-center?section=...`）由 `LEGACY_ACCOUNT_SECTIONS` 映射到新入口。

## 5. 应用菜单

运行时菜单来自 `GET /api/v1/applications/{id}/menus`。后端已经按发布状态和权限过滤，前端只再隐藏 `is_visible=false` 的节点，并把料号申请从应用菜单中移到流程中心。
配置菜单使用 `/api/v1/forms/applications/{id}/menu-nodes` 和 `/menu-order`，界面在“应用与菜单”中。
`config/menus.ts`、`config/appAssemblyMenus.ts` 是旧的静态菜单与本地兜底数据，不是运行时菜单的来源。

## 6. 接口调用与登录状态

- 统一使用 `src/services/api.ts` 导出的 axios 实例和封装函数，基础路径 `/api/v1`，超时 30 秒，`withCredentials: true`。
- 请求拦截器从 `localStorage` 读取 `mf_token`，加上 `Authorization: Bearer <token>`。
- 响应拦截器遇到 `401` 时清除 `mf_token`、`mf_user` 并跳转 `/login`。
- `authStore` 保存 `token`、`user`、`isAuthenticated`；`user.is_admin` 只用于决定显示哪些入口，真正的权限由后端判断。
- 告警、表单审批、料号申请有独立的封装文件（`services/alerts.ts`、`formApprovals.ts`、`materialApplications.ts`）。

## 7. AI 助手

- 浮窗组件在 `components/AiChatWidget/`，可在工作偏好中隐藏。
- 浮窗会把当前页面标题和所在应用作为上下文发给后端。
- `AiPageActionRouter`（`pageControls.tsx`）接收 AI 发出的页面操作（例如在设计器中准备字段、调整属性），执行后通过 `POST /ai/page-actions/{action_id}/result` 回报结果。最终的创建或发布仍由用户点击确认。

## 8. 开发约定

- 新的业务页面优先用平台能力搭建：在“业务数据”中建表单并发布，在“页面设计”中组合组件，在“应用与菜单”中挂载，不要为单个业务新写固定页面。
- 确实需要新增固定页面时：在 `src/pages/<名称>/` 新建页面；在 `App.tsx` 中懒加载并注册路由，或者加入 `navigation.ts` 的 `NAVIGATION_ENTRIES` 并在 `NavigationArea` 中分发；需要的接口加到 `services/api.ts`。
- 表单字段的结构来自后端的表单定义，不要在页面中硬编码字段。
- 可复用的纯逻辑放在 `src/utils/` 并补充 `tests/*.test.cjs`。测试用 `typescript` 把源文件即时转译后在 `node:vm` 中执行，不依赖浏览器。
- 写操作的结果用 Ant Design 的 `message` 或 `notification` 提示。表格指定 `rowKey`，大列表使用后端分页和搜索。
- 界面设计规范见仓库根目录的 `DESIGN.md` 和 [UI 系统说明](../archive/ui-system-2026-11-10.md)。

## 9. 提交前检查

```bash
cd frontend
npm run type-check
node --test tests/*.test.cjs
npm run build
```

涉及外壳、路由或菜单的改动，还需要在浏览器中检查：登录、切换应用、菜单跳转、旧地址重定向、通知、全局搜索和 AI 助手浮窗。
