# AIP 风格智能层设计

状态：设计（产品构想，参考 Palantir AIP）

本文描述目标中的 AI 能力和交互方式，不是对当前代码的说明；当前实现以 [AI 能力地图](../../architecture/ai/README.md) 和 [DeepSeek Harness 运行说明](../../architecture/ai/harness-runtime.md) 为准，第 4、8、9 节只做对照。总览见[关系图](relationship-map.md)。

> 日期：2026-05-20；与现有模块的对照更新于 2026-11-17（代码版本 0.3.22 草稿）。
> 范围：说明 ManuFoundry 如何体现 Palantir AIP 风格能力，包括 AI 助手、AI Agent、AI 辅助搭建、AI 审计与评估。
> 目标：让 AI 不只是聊天，而是能安全连接业务对象、数据、流程和动作。

## 1. AIP 在这里代表什么

在本项目语境里，AIP 代表：

> 把大模型和企业业务对象、权限、数据、流程、动作连接起来，让 AI 能分析、推荐、生成草稿，并在授权后调用系统动作。

它不是一个单独聊天页面，而是一层横跨业务工作台的智能能力。AI 读取的对象和关系来自 [Foundry 风格业务底座](foundry-foundation.md)。

## 2. AIP 与普通聊天机器人的区别

| 普通聊天机器人 | AIP 风格智能层 |
| --- | --- |
| 主要回答自然语言问题 | 连接业务对象和操作流程 |
| 只给文字答案 | 给出证据、影响范围和可执行动作 |
| 不理解系统权限 | 继承当前用户权限 |
| 不知道业务对象关系 | 基于本体和图谱理解对象关系 |
| 很少写入业务系统 | 可在确认后调用业务动作和审批流程 |
| 难以审计 | 记录输入、上下文、建议、动作和结果 |

一句话：

> AIP 是能进入业务现场工作的 AI，不只是陪聊。

## 3. 能力分层

| 能力层 | 说明 | 示例 |
| --- | --- | --- |
| 问答型 | 只读问答 | “这个异常影响哪些订单？” |
| 辅助型 | 辅助生成和建议 | 生成 CAPA 草稿、料号申请草稿 |
| 主动型 | 主动监控和提醒 | 每天检查低库存、异常设备、审批超时 |
| 代理型 | 授权后调用系统动作 | 创建采购申请、提交审批、通知负责人 |
| 辅助搭建 | 用自然语言生成配置 | “帮我创建一个设备点检应用” |
| 评估与可观测性 | 评估和审计 AI 行为 | 检查 AI 建议是否准确、是否越权 |

## 4. 推荐架构

```text
用户 / 规则 / 定时任务
  -> AI 编排器
  -> 意图识别
  -> 权限检查
  -> 上下文组装
  -> 工具选择
  -> 大模型 / 规则 / 模型
  -> 返回解释、建议或动作计划
  -> 用户确认
  -> 调用业务动作 / 审批流程 / 通知
  -> 写入审计和评估数据
```

原设计建议的后端结构如下。右侧注释为 2026-11-17 对 `backend/app/services/ai/` 的核对结果。

```text
backend/app/services/ai/
  client.py          # 大模型供应商适配。已实现：client.py、providers.py
  orchestrator.py    # 意图识别、工具路由、动作计划。已实现：orchestrator.py、intent_router.py、planner.py；运行时由 harness_runtime.py 承载
  prompts.py         # 领域提示词。未按此文件实现：0.3.22 删除了旧版提示词模块，技能说明放在 skill_instructions/*.md
  tools.py           # 业务工具注册表。已实现：tool_registry.py、tool_handlers.py、tool_executor.py，定义在 assets/tools.json
  policies.py        # 风险等级、确认策略、权限策略。已实现：policies.py、permission_resolver.py、confirmations.py
  schemas.py         # 结构化输入输出。已实现：schemas.py
  evals.py           # AI 结果评估和回放。未实现
  audit.py           # AI 行为审计。部分实现：audit.py 为内存环形缓冲，进程重启后丢失；运行与工具调用记录持久化在 AIAgentRun、AIToolCall 表
```

## 5. AI 在 UI 中如何出现

AIP 不应只放在“AI 助手”独立页面，还应嵌入各业务页面。

### 5.1 右侧 AI 行动面板

用于质量异常、供应链风险、设备预警等事件详情页，也是 [Gotham 风格指挥台](gotham-command-ui.md) 右侧行动栏的内容来源。

```text
AI 分析
├─ 发生了什么
├─ 可能原因
├─ 影响范围
├─ 建议动作
├─ 证据来源
└─ 可执行按钮
```

示例按钮：

- 生成质量整改任务
- 冻结物料批次
- 创建设备点检
- 生成采购申请草稿
- 通知相关负责人

### 5.2 浮动 AI 助手

用于跨页面问答：

```text
用户：这个异常为什么是高风险？
AI：因为它关联 1 个客户订单、1 个高风险物料批次和 1 台异常设备。以下是证据...
```

### 5.3 AI 辅助搭建

用于平台配置：

```text
用户：帮我创建一个供应商准入应用。
AI：
1. 创建供应商准入模型。
2. 生成供应商基础信息表单。
3. 生成准入审批流程。
4. 生成菜单和权限建议。
是否保存为草稿？
```

## 6. 典型 Agent

| Agent | 职责 | 可读对象 | 可建议动作 | 可执行动作 |
| --- | --- | --- | --- | --- |
| 质量异常 Agent | 分析质量异常和影响范围 | 工单、设备、物料、质检、缺陷、订单 | CAPA、复检、冻结批次 | 经确认后创建 CAPA、通知负责人 |
| 采购补货 Agent | 分析库存和供应商风险 | 物料、库存、供应商、采购记录 | 采购数量、供应商选择 | 经确认后创建采购申请 |
| 设备维护 Agent | 分析设备健康和维修优先级 | 设备、传感器、维修记录、工单 | 点检、维修、备件申请 | 经确认后创建维修工单 |
| 料号申请 Agent | 辅助创建物料主数据 | 物料、分类、历史料号、供应商 | 字段补全、重复检查 | 创建料号申请草稿 |
| 配置生成 Agent | 辅助管理员搭应用 | 模型、页面、流程、菜单、权限 | 低代码配置方案 | 保存草稿，管理员发布 |

## 7. 风险控制

| 风险 | 控制方式 |
| --- | --- |
| AI 越权读取数据 | AI 工具继承当前用户权限 |
| AI 直接执行高风险动作 | 中高风险动作必须人工确认 |
| AI 建议没有依据 | 返回证据对象、数据来源和置信度 |
| 重复创建任务或订单 | 使用幂等键和重复检查 |
| AI 输出错误 | 加入评估集、回放、人工反馈和审计 |
| 泄露敏感信息 | 提示词中屏蔽密钥、密码、令牌和无关原始数据 |

## 8. 第一阶段 MVP

优先实现“质量异常 AI 面板”。状态为 2026-11-17 核对结果，对应页面为质量影响工作台 `/admin/quality-impact`（`frontend/src/pages/QualityImpact`，实验功能，仅管理员可见）。

1. 输入：风险事件 ID。
   已实现。质量事件由 `GET /api/v1/quality/events` 从缺陷与质检记录派生（`backend/app/api/quality.py`）。
2. 读取：关联工单、物料、设备、质检、缺陷、客户订单。
   部分实现。`GET /quality/events/{event_id}/impact` 通过 `services/graph_service.py` 查询以事件为中心的图谱；图谱不可用或事件未关联图谱时返回演示数据。
3. 输出：异常摘要、可能原因、影响范围、建议动作。
   部分实现。`POST /quality/events/{event_id}/ai-suggestion` 返回 `draft_only` 建议，内容由事件字段拼接或为固定演示文本，不调用大模型。
4. 动作：生成质量整改任务草稿。
   部分实现。页面上的“生成 CAPA”直接调用 `POST /quality/capa` 写入 `CAPA` 表；AI 技能 `quality.create_capa_draft`（`services/ai/assets/skills.json`）可在全局 AI 面板中起草 CAPA 表单记录。两条路径没有接通。
5. 控制：必须用户点击确认后创建任务。
   部分实现。页面在创建 CAPA 前弹出确认框；AI 技能走确认令牌（`services/ai/confirmations.py`）。
6. 审计：记录 AI 分析内容、用户确认动作和创建结果。
   部分实现。AI 运行和工具调用记录在 `AIAgentRun`、`AIToolCall` 表；质量工作台的建议与动作没有写入 AI 审计。

## 9. 与现有代码的对照

核对日期 2026-11-17。

| 能力 | 状态 | 当前代码位置 | 后续建议 |
| --- | --- | --- | --- |
| AI 对话 | 已实现 | 全局浮动面板 `frontend/src/components/AiChatWidget`；后端 `backend/app/api/ai_assistant.py`（`/api/v1/ai/agent`、`/agent/stream` 等）、`services/ai/harness_runtime.py`。独立页面 `pages/AIAssistant` 未挂路由 | 接入业务对象上下文 |
| 页面上下文感知 | 部分实现 | `components/AiChatWidget/pageControls.tsx`、`context.tsx`、`services/ai/page_controls.py`；目前用于表单设计器、组件页面等配置页面 | 扩展到质量事件等业务详情页 |
| AI 辅助搭建 | 部分实现 | 低代码技能 `low_code.*`、`analysis.manage_dashboard`（`services/ai/assets/skills.json`）可在确认后创建表单、页面、看板、应用和菜单；`/admin/ai-builder`（`api/ai_builder.py`）只用规则模板生成模型和页面建议，不调用大模型 | 补充流程配置生成 |
| 业务草稿 Agent | 部分实现 | 技能 `quality.create_capa_draft`、`maintenance.create_work_order_draft`、`supply.create_purchase_request_draft`、`material.create_material_application_draft` 通过确认令牌写入表单记录草稿。`workflow.submit_after_confirmation` 已定义，但技能说明注明审批和通知工具尚未接通，目前需从业务表单提交审批 | 接入图谱证据与影响范围 |
| 工具注册与权限 | 已实现 | `services/ai/tool_registry.py`、`policies.py`、`permission_resolver.py`；技能与工具按租户维护（0.3.21） | 无 |
| 主动监控 | 未实现 | 无。定时任务（`api/scheduler.py`）不调用 AI | 按规则或定时触发 AI 巡检 |
| 评估与回放 | 未实现 | 无 | 建立评估集与回放 |
| AI 审计 | 部分实现 | `services/ai/audit.py`（内存）、`GET /api/v1/ai/audit`；通用审计 `core/audit.py` 与 `/admin/audit` | 将 AI 行为审计持久化并在界面展示 |

## 10. 参考资料

- [Palantir AIP 概览](https://www.palantir.com/docs/foundry/aip/overview/)
- [Palantir AIP 功能](https://www.palantir.com/docs/foundry/aip/aip-features/)
- [Palantir AIP Agent Studio 概览](https://www.palantir.com/docs/foundry/agent-studio/overview)
- [Palantir AIP 架构](https://www.palantir.com/docs/foundry/architecture-center/aip-architecture)
- [Palantir AIP 可观测性](https://www.palantir.com/docs/foundry/aip-observability/overview/)
