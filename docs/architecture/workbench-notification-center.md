# 我的工作台与通知中心设计

Last updated: 2026-05-25

Status: design. This document defines the intended boundary between the
workspace and notification center; verify current implementation against
`frontend/src/pages/Workspace`, `frontend/src/components/GlobalSearch`, and
notification APIs.

目标：明确“我的工作台”和“小铃铛通知中心”的边界，先完成前端 demo，再逐步接入后端数据模型。

## 1. 产品定位

我的工作台是用户进入系统后的个人首页，聚合当前用户相关的审批、收藏入口、关注指标和最近状态。

小铃铛通知中心是系统主动提醒用户的轻量入口，只展示摘要和快速动作，不承载完整业务页面。点击通知后跳转到最准确的主工作区页面。

## 2. 工作台结构

### 2.1 待办与审批

待办与审批使用卡片形式展示与当前用户相关的流程数据。

第一版包含五类：

| 卡片 | 含义 | 数据范围 |
| --- | --- | --- |
| 待审批 | 已流转到当前用户，需要当前用户审批 | assignee = current_user，status = pending |
| 审批中 | 当前用户发起、参与或关注，流程仍未结束 | related_user includes current_user，status = running |
| 已审批 | 当前用户处理过或发起过，流程已经结束 | related_user includes current_user，status in approved/rejected/completed |
| 草稿 | 当前用户创建但尚未提交的表单或流程 | creator = current_user，status = draft |
| 退回待修改 | 被审批退回，需要当前用户修改后重新提交 | owner = current_user，status = returned |

卡片建议展示：数量、最近 3 条、状态标签、业务对象、更新时间、查看全部入口。

跳转建议：待审批 /workflow?tab=pending，审批中 /workflow?tab=running，已审批 /workflow?tab=done，草稿 /workflow?tab=draft，退回待修改 /workflow?tab=returned。

### 2.2 常用入口

常用入口来源于用户收藏，只有收藏后的表单、应用、报表才出现在工作台。卡片展示名称、类型、所属应用、最近访问时间，点击后直接进入对应页面。

### 2.3 关注指标

关注指标先作为预留区域，用于展示用户订阅或关注的业务指标，例如设备健康率、质量异常数、供应风险数、数据同步成功率。

### 2.4 最近状态

最近状态先作为预留区域，用于展示用户相关动态，例如流程状态变化、收藏表单更新、数据任务完成、AI 分析结果生成。

## 3. 小铃铛通知中心结构

小铃铛第一版分三组：待处理、系统提醒、AI 与分析。

| 分组 | 内容 | 点击跳转 |
| --- | --- | --- |
| 待处理 | 待审批、退回待修改、需要确认的异常 | /workflow?tab=pending 或 /workflow?tab=returned |
| 系统提醒 | 应用发布、权限变更、配置变更、数据任务完成或失败 | 对应系统管理、数据资产、角色权限页面 |
| AI 与分析 | AI 分析完成、报表生成、风险洞察 | /ai-assistant 或 /reports |

点击规则：能定位到具体事项时跳到具体 tab 和 itemId；不能定位时跳到对应主页面；点击后标记为已读。

## 4. 后端数据建议

建议新增聚合接口：GET /workspace/summary?user_id=xxx，返回 approvalBuckets、favorites、watchedMetrics、recentActivities。

通知接口建议补充字段：category、target_path、target_id、severity、actions。这样小铃铛不需要写死跳转逻辑，后端可以直接告诉前端该去哪里。
