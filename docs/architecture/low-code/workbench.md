# 我的工作台、流程与待办、通知中心

更新日期：2026-11-17（对应代码版本 0.3.22 草稿）

本文描述“业务工作台”区域中面向个人的三个入口在当前代码中的实现：我的工作台（`/`）、流程与待办（`/workflow`）和页头的通知中心。流程定义、审批人解析、条件路由和自动下发属于流程模块，本文只在需要时引用；应用和应用菜单见[应用与应用菜单](applications.md)，完整接口清单见 [API 参考](../../development/api-reference.md)。

以代码为准：`frontend/src/pages/Workspace/`、`frontend/src/pages/Workflow/index.tsx`、`frontend/src/components/NotificationCenter/index.tsx`、`backend/app/services/workflow_views.py`、`backend/app/api/workflow.py`、`backend/app/api/notifications.py`、`backend/app/services/approval_notifications.py`、`backend/app/api/component_pages.py`（工作台画布）。

## 1. 入口与分工

业务工作台区域的固定入口在左侧应用栏（`components/ShellNavigation` 的 `fixedShellApps`）：

| 入口 | 路由 | 内容 |
| --- | --- | --- |
| 工作台 | `/` | 个人首页：继续未完成的申请、待我处理、最近工作、业务表单目录 |
| 流程与待办 | `/workflow` | 审批收件箱：待审批、我发起的、我已处理的 |
| 日常任务 | `/scheduler` | 定时任务，不在本文范围 |
| 更多 | `/more` | 应用中心，见[应用与应用菜单](applications.md)第 8 节 |

登录后首次进入 `/` 时，外壳会自动打开排在最前的应用；点击应用栏的“工作台”按钮才会停留在我的工作台。

工作台和流程与待办共用同一个后端数据集 `GET /api/v1/workflow/business-items`（第 2 节），通知中心使用独立的 `/api/v1/notifications` 接口（第 4 节）。三者通过浏览器事件 `approval-notifications-changed` 联动：审批、料号申请操作完成后派发该事件，工作台和通知中心收到后重新加载。

## 2. 个人业务数据集

`GET /workflow/business-items` 由 `services/workflow_views.py` 的 `_workflow_business_dataset` 计算，所有登录用户都可调用，结果只包含当前用户有权看到的内容。

### 2.1 表单范围

- 取当前租户的全部表单，排除分析类表单（`config.assemblyKind` 为 `analysis`、`dashboard`、`bi`）。
- 普通用户只保留有 `view` 权限的表单；管理员不过滤。
- 返回的 `forms` 列表只含状态为 `published` 或 `active` 的表单，每项带 `can_create`（是否有新增权限）、`approval_configured`（是否绑定了启用中的已发布流程）、所属应用和记录数。

### 2.2 事项范围

`items` 由两类来源合并而成：

1. 表单记录：当前用户创建的、状态能映射到视图状态的记录。记录经过与业务页面相同的记录级鉴权和字段投影（`records.authorized_records`）。
2. 流程实例：当前租户的流程实例中，与当前用户有个人关系的实例。关联了表单记录的实例会再做一次记录级鉴权和字段投影，没有权限的实例被跳过。同一条记录多次提交时，最新一次实例替换记录项，较早的实例单独保留。

每个事项带 `views`，表示它出现在哪个个人视图中：

| 视图 | 条件 |
| --- | --- |
| `pending` | 实例在途（`pending`、`running`、`in_progress`、`processing`），且当前节点上有一条分配给当前用户、尚未处理的审批记录 |
| `initiated` | 当前用户是实例发起人，或是所关联记录的创建人；当前用户自己创建的表单记录也属于此视图 |
| `processed` | 当前用户在该实例上有已完成的通过或驳回记录 |

管理员身份不会让事项进入个人视图，只有真实的审批任务才算。`view_counts` 返回三个视图的数量。

每个事项还带一个归一化的 `status`：`draft`、`pending`、`running`、`done`、`returned`、`rejected`。映射表是 `RECORD_STATUS_TO_VIEW_TAB`，同时识别英文状态和 `待提交`、`待审批`、`已通过`、`已驳回` 等中文状态；无法映射的记录不进入数据集。

### 2.3 查询参数

| 参数 | 作用 |
| --- | --- |
| `view` | 只返回某个个人视图的事项，取值 `pending`、`initiated`、`processed` |
| `status` | 按归一化状态过滤 |
| `source_form_id` + `source_record_id` | 只返回某条来源记录的流程，即使当前用户与该流程没有个人关系（仍需记录查看权限） |

## 3. 我的工作台

### 3.1 页面结构

`pages/Workspace/index.tsx` 由五个模块组成：

| 模块 | 内容 |
| --- | --- |
| 工作概览（`overview`） | 近 7 日更新数（同一记录只计一次）、最久未更新的在途申请、最近一次工作 |
| 未完成工作（`continuation`） | 主卡片显示一条需要继续的申请（草稿或已退回），带阶段条和已填写字段摘要；其余未完成项列在下方，点击可切换主卡片 |
| 待办与申请（`support`） | 需要我处理（`pending`）的前两条、我发起的在途申请、我已处理的数量，均可跳到流程与待办的对应页签 |
| 最近工作（`recent`） | 按更新时间排列，可筛选“我发起的”“我已处理的” |
| 业务表单（`forms`） | 可填报的表单目录，按“申请审批”“普通填报”“仅查看”和“常用”筛选，支持搜索 |

“未完成”的判定在 `workspaceData.ts`：我发起的事项中状态为 `returned`，或状态为 `draft` 且属于流程实例或已配置审批的表单。普通填报表单保存的记录状态显示为“已保存”，不算未完成。

### 3.2 工作台画布

工作台本身是一个组件页面，编码固定为 `system-workspace-home`：

- 管理员打开工作台时调用 `POST /pages/workspace/home`。页面不存在时，后端创建一个已发布的组件页面（版本 1），包含上表五个 `workspace` 类型组件，并写审计日志。
- 普通用户调用 `GET /pages/workspace/home`，页面存在且已发布时返回编码，否则返回空。
- 拿到编码时用组件页面画布渲染五个模块，布局和宽度来自页面定义；没有编码时使用内置的固定两列布局。

因此管理员可以像编辑其他组件页面一样调整工作台模块的排列，版本与发布规则同组件页面（见[表单管理](forms.md)）。各模块的数据仍然来自第 2 节的数据集，画布不改变数据范围。

### 3.3 个人偏好

- 常用表单：点击星标收藏，保存在浏览器 `localStorage` 的 `mf_workspace_favorites_<租户ID>:<用户ID>`，最多 500 项。
- 主卡片选择：保存在 `mf_workspace_focus_<租户ID>:<用户ID>`。
- 两者都不写回后端，换浏览器不会同步。多个标签页之间通过 `storage` 事件同步。

### 3.4 跳转规则

`workspaceItemRoute` 决定点击事项后去哪里：

1. 从“需要我处理”打开流程实例：`/workflow?tab=pending&instance_id=<实例ID>`。
2. 事项关联了表单记录：`/dynamic/<表单ID>?view=records&recordId=<记录ID>`，直接打开记录。
3. 事项带同应用内的 `route_path`：使用该路由，必要时补上 `recordId`。
4. 其他流程实例：`/workflow?tab=<视图>&instance_id=<实例ID>`。

表单目录卡片打开表单的 `route_path`（`/program/<表单编码>`）。

## 4. 流程与待办

`pages/Workflow/index.tsx` 是审批收件箱，数据同样来自 `GET /workflow/business-items`。

- 页签固定为“待审批”“我发起的”“我已处理的”（`config/navigation.ts` 的 `WORKFLOW_VIEWS`）。旧地址中的 `tab=done`、`tab=rejected` 归入“我已处理的”，其他未知值归入“我发起的”，`?section=materials` 改写为“我发起的”。
- 地址带 `instance_id` 时自动打开该实例的详情抽屉；如果实例不在当前页签，会切换到它所在的页签。
- 地址带 `source_form_id` 和 `source_record_id` 时进入“来源记录”模式，只显示该记录的流程，并隐藏页签。
- 列表可按关键字和来源表单筛选。详情抽屉显示字段、审批时间线和当前处理人，“打开表单”跳到来源记录。
- 审批在详情中完成，前端调用 `POST /workflow/instances/{id}/act`，`action` 只能是 `approve` 或 `reject`。该接口在后端标注为兼容旧调用方的入口，内部与按节点审批的接口共用同一处理逻辑。

## 5. 通知中心

### 5.1 数据模型

通知保存在 `notifications` 表：`tenant_id`、`user_id`、`title`、`content`、`type`、`is_read`、`resource_type`、`resource_id`、`link`，以及创建时间。`(tenant_id, user_id, is_read)` 上有联合索引。

### 5.2 通知的产生

当前只有审批流程会自动产生通知，由 `services/approval_notifications.py` 在业务事务内写入，不单独提交：

| 时机 | 类型 | 接收人 | 链接 |
| --- | --- | --- | --- |
| 流程启动或进入新节点 | `approval` | 当前节点的审批人（同租户、启用中的账号） | `/workflow?tab=pending&instance_id=<ID>&node_id=<节点>` |
| 实例审批通过或驳回 | `approval_result` | 发起人 | `/workflow?tab=initiated&instance_id=<ID>` |

写入前对流程实例加锁并去重：同一实例同一节点不会给同一个人重复发待办提醒，同一实例只给发起人发一次结果通知。

`POST /api/v1/notifications` 也可以创建通知，但 `type` 只接受 `info`、`warning`、`error`、`success`，接收人必须在同一租户。`api/notifications.py` 中的 `send_notification` 辅助函数目前没有调用方。

### 5.3 读取与跳转

`GET /notifications` 返回当前用户的通知（分页，默认每页 20 条），同时返回 `unread_count`。只能读取自己的通知，传入他人的 `user_id` 返回 403。对每条通知，后端补充以下字段：

- `category`：`approval` 为 `todo`（待办提醒），`approval_result` 为 `result`（审批结果），其他为 `other`。
- `actionable` / `can_approve`：重新计算当前用户此刻是否仍需处理。计算复用第 2 节的数据集，所以流程已结束、已被他人处理、或提醒针对的是更早的节点时，都会返回 `false`。
- `target_url`：根据当前用户与实例的关系指向 `/workflow?tab=pending|initiated|processed&instance_id=<ID>`；用户已无权查看时为空。
- `workflow_status`：实例的原始状态，用于显示“流程已结束”或结果标签颜色。

前端组件 `NotificationCenter`：

- 页头铃铛显示未读数（`GET /notifications/unread-count`），每 30 秒、窗口获得焦点、收到 `approval-notifications-changed` 事件时刷新。
- 点击通知先标记已读（`POST /notifications/{id}/read`），再跳转 `target_url`。只接受以 `/` 开头的站内路径；`target_url` 为空的审批通知提示“该流程已不可查看或当前账号没有访问权限”。
- “全部已读”调用 `POST /notifications/read-all`。

### 5.4 两套通知接口

`/api/v1/workflow/notifications`、`/workflow/notifications/{id}/read`、`/workflow/notifications/read-all` 是另一套更早的通知接口，允许管理员读取或标记其他用户的通知，返回字段中有 `link`、`target_path`，但不计算 `actionable` 和 `target_url`。前端 `services/api.ts` 中保留了对应的封装函数（`wfListNotifications` 等），没有组件调用。新代码应使用 `/notifications`。

`GET /workflow/stats` 中的 `unread_notifications` 是整个租户的未读通知总数，不是当前用户的。

## 6. 已知限制

- `GET /workflow/business-items` 每次请求都会遍历当前用户可见的全部业务表单并读取授权记录，再加载租户内全部流程实例。数据量增大后，工作台、流程与待办都会变慢；通知列表中含审批通知时也要计算这个数据集，同样受影响。
- 前端识别 `returned`（已退回）状态，但后端审批接口目前只提供通过和驳回，没有“退回修改”动作；`returned` 只会来自记录自身写入的状态。
- `POST /notifications` 只要求登录，任何用户都可以给同租户的其他用户发送通知。
- `api/notifications.py` 中保留了内存中的示例通知（`MOCK_NOTIFICATIONS`）作为回退。由于 `safe_db_call` 在数据库不可用时直接返回 503，这些回退分支只在测试替换 `_try_db` 时才会执行，正常运行不会返回示例数据。
- `pages/Workflow/` 下的 `MyApprovals.tsx`、`MyApplications.tsx`、`WorkflowList.tsx`、`DispatchLog.tsx` 没有被任何路由或组件引用。

## 7. 尚未实现

以下内容在早期产品设计中提出，当前代码没有实现：

- 工作台的“关注指标”和“最近状态”区域（订阅设备健康率、质量异常数等指标，展示流程变化、数据任务完成、AI 分析结果等动态）。
- 收藏应用和报表；当前只能收藏业务表单，且只存在浏览器本地。
- 后端聚合接口 `GET /workspace/summary`；当前由 `GET /workflow/business-items` 承担。
- 通知分组“系统提醒”（应用发布、权限变更、数据任务完成或失败）和“AI 与分析”（分析完成、报表生成、风险洞察）。当前只有审批类通知会自动产生。
- 通知中的快捷操作（例如在铃铛中直接审批）和 `severity` 等级字段。
