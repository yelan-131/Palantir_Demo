# 错误码与排查手册

更新日期 2026-11-20，对应代码版本 0.3.26。

## 拿到错误码后

1. 记录错误码、请求编号和发生时间。浏览器「开发者工具 → 网络 → 失败请求 → 响应标头」可查看 `X-Error-Code` 和 `X-Request-ID`。共用 API 客户端遇到服务端错误、网络故障或超时时，页面也会显示错误码。AI 流式请求在建立连接前收到 HTTP 错误时，会在原错误提示中带上这些信息。
2. 在仓库根目录按码离线查询。即使业务数据库或后端不可用，也可以使用该命令。

   ```powershell
   python backend/app/core/error_catalog.py DATABASE_UNAVAILABLE
   python backend/app/core/error_catalog.py 422
   python backend/app/core/error_catalog.py
   ```

3. 有请求编号时优先用它定位单次请求。后端在接口返回错误时会自动查目录，写入 `request_diagnosis`，其中包含错误码、请求编号、路由、HTTP 状态及排查步骤。意外异常还会记录异常类型和调用位置。普通 4xx 诊断使用 INFO，5xx 或响应发送中断使用 ERROR。

   生产 Compose 日志示例，将 `REQUEST_ID` 换成实际编号。

   ```bash
   docker compose --env-file .env -f docker/docker-compose.yml -f docker/docker-compose.prod.yml logs --since 30m backend | grep -F 'request_id=REQUEST_ID'
   ```

   请求由网关直接拒绝或浏览器没有收到响应时，可能只有 HTTP 状态或客户端错误码。用发生时间、请求方法和路径关联代理日志。本地开发可查看后端终端或项目的 `runtime-logs/`。

## 常见场景

| 遇到的情况 | 可以查的错误码 |
| --- | --- |
| 登录失效、没权限、找不到页面或数据 | `HTTP_401`、`HTTP_403`、`HTTP_404` |
| 表单校验、版本冲突、附件过大、频率受限 | `HTTP_400`、`HTTP_422`、`HTTP_409`、`HTTP_413`、`HTTP_429` |
| 后端异常、上游故障、服务不可用 | `HTTP_500`、`HTTP_502`、`HTTP_503`、`HTTP_504` |
| Windows 本地后端启动时提示 Python 文件含空字节 | `BACKEND_SOURCE_NULL_BYTES`，见下方启动排查。 |
| 业务数据库、Neo4j 或初始化数据 | `DATABASE_UNAVAILABLE`、`GRAPH_UNAVAILABLE`、`SEED_DATA_REQUIRED` |
| 保存对象后页面报错，或字段映射画布无法打开 | `ONTOLOGY_OBJECT_WRITE_FAILED`、`SEMANTIC_MAPPING_LOAD_FAILED`，见下方排查。 |
| PostgreSQL 来源读不到，或映射同步到表单失败 | `MAPPED_FORM_SYNC_SOURCE_FAILED`、`MAPPED_FORM_SYNC_FAILED`，见下方排查。 |
| AI 移动字段时找不到唯一目标 | `AI_FORM_LAYOUT_TARGET_INVALID`。核对字段库编码、画布控件和页签，字段已存在于字段库时可按编码放入。 |
| AI 更新检查或凭据存储 | `AI_HARNESS_UPDATE_FAILED`、`AI_CREDENTIAL_STORE_UNAVAILABLE` |
| 保存全局 AI 设置或测试模型连接时被拒绝 | `HTTP_403`。核对登录账号是否为租户 1 的管理员。租户管理员从「工具与技能」管理本租户注册表。 |
| AI 助手运行时无法准备临时技能目录 | `AI_HARNESS_SKILL_DIR_UNAVAILABLE`，见下方 Harness 排查。 |
| AI 业务查询被拦截 | `AI_QUERY_POLICY_DENIED` 表示 AI 角色策略拒绝，`AI_QUERY_ACCESS_DENIED` 表示业务数据权限拒绝。在「审计与日志」的「AI 助手」资源中查看发起人和原因。 |
| 新增应用出现程序异常、应用编码重复或权限组角色无效 | `APPLICATION_CREATE_FAILED`、`APPLICATION_CODE_CONFLICT`、`APPLICATION_ROLES_INVALID` |
| 应用菜单加载异常 | `APPLICATION_MENU_LOAD_FAILED` |
| 应用状态不允许操作、编辑期间配置被更新或租户资源达到配额 | `APPLICATION_STATE_CONFLICT`、`CONFIG_EDIT_CONFLICT`、`TENANT_RESOURCE_QUOTA_EXCEEDED` |
| 应用菜单层级无效或目标页面未发布 | `APPLICATION_MENU_TREE_INVALID`、`APPLICATION_MENU_TARGET_UNPUBLISHED` |
| 组件页面读取、数据调用或保存发布出现程序异常 | `COMPONENT_PAGE_LOAD_FAILED`、`COMPONENT_DATA_LOAD_FAILED`、`COMPONENT_PAGE_WRITE_FAILED` |
| 组件页面未发布或编辑版本冲突 | `COMPONENT_PAGE_UNPUBLISHED`、`COMPONENT_PAGE_VERSION_CONFLICT` |
| 组件筛选或图表联动参数无效 | `COMPONENT_QUERY_INVALID` |
| 页面能打开，某些组件或数据集取数失败 | `COMPONENT_DATA_PARTIAL_FAILURE`。组件取数与预览仍返回 HTTP 200，保留可用的数据。故障组件提示或网络响应可查看错误码，后端按请求编号记录受影响组件数 |
| 流程提交后自动下发失败，或下发后台任务异常 | `WORKFLOW_DISPATCH_FAILED`、`WORKFLOW_DISPATCH_WORKER_FAILED`。单次下发故障通过流程实例编号和节点查下发记录或 `workflow_diagnosis` 日志 |
| 审批结果连线无效，或驳回时无法选出后续路径 | `WORKFLOW_APPROVAL_ROUTE_INVALID`。检查通过线、驳回线、结束事件和后续网关条件。使用自定义驳回时，确认目标和当前审批节点仍然直接相连 |
| 浏览器渲染组件时出错 | `CLIENT_RENDER_ERROR`，在页面的「错误详情」中查看 |
| 浏览器断网、等待超时或后端响应发送中断 | `CLIENT_NETWORK_ERROR`、`CLIENT_TIMEOUT`、`RESPONSE_INTERRUPTED` |

`/health` 检查进程能否响应，`/api/v1/system/readiness` 用来查看数据库、迁移等依赖状态。写入操作出现超时或断连时，先查询原操作结果，再决定是否重新提交。

### 本地数据资产目录读取失败

如果 `GET /api/v1/semantic-assets/data-assets` 返回 `DATABASE_UNAVAILABLE`，先用请求编号查后端日志。如果 readiness 的 `database` 为 `ready`、`backend` 为 `sqlite`，日志却出现 `no such table: information_schema.tables`，说明运行中的后端仍用 PostgreSQL 的表目录查询 SQLite。重启本地后端以加载数据库方言兼容修复，再打开「数据中心 → 数据资产 → 资产目录」确认查询返回 200。

### 对象保存、映射画布与同步排查

- 新建对象返回 `DATABASE_UNAVAILABLE` 且日志中有 `MissingGreenlet` 时，先按对象编码确认对象和字段是否已保存，因为该旧故障可发生在提交后的响应生成阶段。加载修复后，从「对象与关系」新建对象并检查响应中的字段。
- 映射画布读取失败时，用请求编号检查 `/api/v1/semantic-assets/semantic-mapping/workbench` 日志。旧版的 `OntologyField` 缺少 `label` 错误发生在对象字段节点组装阶段。加载修复后，选择已扫描的来源表与带字段的对象，确认两侧节点都出现。
- 「同步到表单」返回来源错误时，核对只读连接、数据库 schema 和来源列，表结构变更后重新扫描。写入失败时，核对来源主键的已审核映射、目标表单已发布版本的单字段唯一规则及审批设置。使用该操作的读取、新增、更新、无变化计数核对目标表单。

### 本地后端源码含空字节

Windows 的 `scripts/run-backend-local.cmd` 在 Uvicorn 导入应用前检查 `backend/app` 下的 Python 源码。发现空字节时会停止启动，并将错误码与文件路径写入 `runtime-logs/backend.err.log`。直接运行 Uvicorn 遇到 `source code string cannot contain null bytes` 时，可以在仓库根目录执行同一检查。

```powershell
.\.venv\Scripts\python.exe backend/app/core/error_catalog.py --check-python-source backend/app
```

先备份列出的文件，再核对 Git 索引或可用备份中的版本，确认后恢复受影响的源码。重新运行启动脚本后，访问 `http://127.0.0.1:8000/health` 验证后端响应。

### Harness 临时技能目录不可访问

如果 AI 助手报告 `AI_HARNESS_SKILL_DIR_UNAVAILABLE`，核对正在运行后端的账户是否能在 `AI_HARNESS_HOME` 对应的用户目录下创建子目录、读写文件并清理。默认根目录是后端工作目录下的 `storage/ai_harness`。Windows 上的新临时技能目录继承该用户目录的 ACL。修复父目录访问权限并重启本地后端后，发起一条只读业务查询，在「执行过程」核对工具调用。模型连接测试跳过临时技能目录准备，需用实际对话核验。

## 目录维护与覆盖范围

[错误码目录](../../backend/app/core/error_catalog.json) 是运行时日志与离线命令共用的数据源。每个键对应一个稳定的错误码，值由简短标题和排查步骤组成。先在目录注册新码，再通过 `app.core.production_errors.coded_error()` 发出有明确原因的 HTTP 错误，或用 `@diagnose_operation(...)` 为路由和数据库调用声明未预期程序异常的默认码。已识别的数据库错误和业务错误优先使用各自的错误码。后端启动时加载目录，修改后随代码发布或重启后端。其他 4xx 或 5xx 归入 `HTTP_4XX` 或 `HTTP_5XX`，离线命令也接受具体 HTTP 状态查询。

诊断模块由应用入口注册，覆盖到达 API 的 HTTP 错误，并保留既有业务接口的 `detail` 结构。组件取数和预览的局部失败通过 `mark_partial_failure()` 接入，在日志中记为 WARNING。表单导入失败可在响应里核对出错行，流程下发可按实例和节点排查。后端响应已发送时，后续异常通过日志里的 `RESPONSE_INTERRUPTED` 定位。其他业务事件、后台任务及进程启动通过相应的事件或日志排查。自动排查匹配排查步骤并记录上下文，健康探测由操作人员按需运行。

## CI 测试初始化

- 创建应用返回 HTTP_422 且提示状态只能为 draft 时，核对测试是否仍传入 published。应先创建草稿，再通过应用更新接口发布。配额测试应使用有效的草稿请求，确保失败来自配额校验。
- PostgreSQL 隔离测试提示 relation "system_settings" does not exist 时，核对测试选建表清单是否包含 SystemSetting。菜单空状态标记依赖该表。业务环境的 DATABASE_UNAVAILABLE 继续按迁移与数据库检查流程排查。
