# AIP 风格智能层设计

> 日期：2026-05-20  
> 范围：说明 ManuFoundry 如何体现 Palantir AIP 风格能力，包括 AI 助手、AI Agent、AI Builder、AI 审计与评估。  
> 目标：让 AI 不只是聊天，而是能安全连接业务对象、数据、流程和动作。

## 1. AIP 在这里代表什么

在本项目语境里，AIP 代表：

> 把大模型和企业业务对象、权限、数据、流程、动作连接起来，让 AI 能分析、推荐、生成草稿，并在授权后调用系统动作。

它不是一个单独聊天页面，而是一层横跨业务工作台的智能能力。

## 2. AIP 与普通聊天机器人的区别

| 普通聊天机器人 | AIP 风格智能层 |
| --- | --- |
| 主要回答自然语言问题 | 连接业务对象和操作流程 |
| 只给文字答案 | 给出证据、影响范围和可执行动作 |
| 不理解系统权限 | 继承当前用户权限 |
| 不知道业务对象关系 | 基于 Ontology 和图谱理解对象关系 |
| 很少写入业务系统 | 可在确认后调用 Actions 和 Workflow |
| 难以审计 | 记录输入、上下文、建议、动作和结果 |

一句话：

> AIP 是能进入业务现场工作的 AI，不只是陪聊。

## 3. 能力分层

| 能力层 | 说明 | 示例 |
| --- | --- | --- |
| Q&A AI | 只读问答 | “这个异常影响哪些订单？” |
| Assisted AI | 辅助生成和建议 | 生成 CAPA 草稿、料号申请草稿 |
| Proactive AI | 主动监控和提醒 | 每天检查低库存、异常设备、审批超时 |
| Agentic AI | 授权后调用系统动作 | 创建采购申请、提交审批、通知负责人 |
| AI Builder | 用自然语言生成配置 | “帮我创建一个设备点检应用” |
| AI Evals / Observability | 评估和审计 AI 行为 | 检查 AI 建议是否准确、是否越权 |

## 4. 推荐架构

```text
用户 / 规则 / 定时任务
  -> AI Orchestrator
  -> 意图识别
  -> 权限检查
  -> 上下文组装
  -> 工具选择
  -> LLM / 规则 / 模型
  -> 返回解释、建议或动作计划
  -> 用户确认
  -> 调用 Action / Workflow / Notification
  -> 写入审计和评估数据
```

建议后端结构：

```text
backend/app/services/ai/
  client.py          # LLM provider adapter
  orchestrator.py    # 意图识别、工具路由、动作计划
  prompts.py         # 领域提示词
  tools.py           # 业务工具注册表
  policies.py        # 风险等级、确认策略、权限策略
  schemas.py         # 结构化输入输出
  evals.py           # AI 结果评估和回放
  audit.py           # AI 行为审计
```

## 5. AI 在 UI 中如何出现

AIP 不应只放在“AI 助手”独立页面，还应嵌入各业务页面。

### 5.1 右侧 AI 行动面板

用于质量异常、供应链风险、设备预警等事件详情页。

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

### 5.3 AI Builder

用于平台配置：

```text
用户：帮我创建一个供应商准入应用。
AI：
1. 创建 SupplierOnboarding 模型。
2. 生成供应商基础信息表单。
3. 生成准入审批流程。
4. 生成菜单和权限建议。
是否保存为草稿？
```

## 6. 典型 Agent

| Agent | 角色 | 可读对象 | 可建议动作 | 可执行动作 |
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
| 泄露敏感信息 | Prompt 中屏蔽密钥、密码、Token 和无关原始数据 |

## 8. 第一阶段 MVP

优先实现“质量异常 AI 面板”：

1. 输入：风险事件 ID。
2. 读取：关联工单、物料、设备、质检、缺陷、客户订单。
3. 输出：异常摘要、可能原因、影响范围、建议动作。
4. 动作：生成质量整改任务草稿。
5. 控制：必须用户点击确认后创建任务。
6. 审计：记录 AI 分析内容、用户确认动作和创建结果。

## 9. 与现有代码的映射

| 能力 | 当前模块 | 后续建议 |
| --- | --- | --- |
| AI 聊天 | `backend/app/api/ai_assistant.py`、`frontend/src/pages/AIAssistant` | 接入对象上下文和工具调用 |
| AI Builder | `backend/app/api/ai_builder.py` | 输出可保存的模型/页面/流程草稿 |
| 前端入口 | `frontend/src/components/AiChatWidget` | 在业务页面嵌入上下文面板 |
| 业务工具 | `workflow.py`、`rules.py`、`notifications.py`、`quality.py` | 封装成 AI Tool Registry |
| 审计 | `backend/app/core/audit.py` | 增加 AI action log |

## 10. 参考资料

- Palantir AIP Overview: https://www.palantir.com/docs/foundry/aip/overview/
- Palantir AIP Features: https://www.palantir.com/docs/foundry/aip/aip-features/
- Palantir AIP Agent Studio Overview: https://www.palantir.com/docs/foundry/agent-studio/overview
- Palantir AIP Architecture: https://www.palantir.com/docs/foundry/architecture-center/aip-architecture
- Palantir AIP Observability: https://www.palantir.com/docs/foundry/aip-observability/overview/

