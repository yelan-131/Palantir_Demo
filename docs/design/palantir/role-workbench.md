# Palantir 风格角色工作台设计

状态：设计（产品构想，参考 Palantir Foundry、Gotham）

本文描述目标中的角色化工作台，不是对当前代码的说明；当前工作台实现以 [我的工作台与通知中心](../../architecture/low-code/workbench.md) 为准，第 6、7 节只做对照。总览见[关系图](relationship-map.md)。

> 日期：2026-05-20；与现有模块的对照更新于 2026-11-17（代码版本 0.3.22 草稿）。
> 范围：记录 ManuFoundry 从“低代码开发平台”升级为“角色化智能运营工作台”的产品结构、工作流和 UI 设计方向。
> 参考方向：Palantir Foundry / Gotham 的公开产品理念，重点借鉴“对象中心、事件驱动、关系态势、可执行动作、角色权限”这几类交互思想，而不是复刻其军事或专有界面。

## 1. 核心定位

系统已经具备表单、页面、菜单、流程、数据源、看板和 AI 助手等低代码能力。

后续产品表达不应只强调“可以搭页面”，而应升级为：

> 用低代码构建业务对象，用本体和图谱连接业务关系，用 AI 分析问题，用流程和动作推动业务闭环。

一句话定位：

> ManuFoundry 是面向制造业的智能运营平台。超级管理员配置系统，业务人员处理业务，管理层看风险和决策，同一套数据通过角色权限呈现为不同工作台。

## 2. 低代码平台放在哪里

低代码平台不是前台主角，而是后台配置能力。完整的目标菜单见[关系图](relationship-map.md)第 6 节。

### 2.1 前台：角色工作台

前台面向日常业务用户，回答：

- 今天发生了什么风险？
- 这件事影响了谁？
- 我需要做什么？
- 谁正在处理？
- 处理是否闭环？

典型前台入口：管理驾驶舱、质量工作台、采购与物料工作台、设备维护工作台、我的审批、智能运营指挥台。

### 2.2 后台：平台配置中心

后台面向超级管理员、实施人员、平台管理员，回答：

- 业务对象怎么定义？
- 页面和表单怎么搭？
- 菜单和权限怎么分配？
- 流程和规则怎么配置？
- 数据源和对象关系怎么维护？

典型后台入口：应用管理、模型设计、表单设计、页面设计、菜单配置、权限配置、流程配置、规则引擎、数据源管理、本体关系配置、模板市场。

## 3. 角色视角

系统应按角色展示不同首页、菜单、数据范围和动作权限。

| 角色 | 默认入口 | 主要关注 | 可执行动作 |
| --- | --- | --- | --- |
| 超级管理员 | 平台配置中心 | 系统搭建、对象建模、权限、流程、规则 | 配置应用、发布页面、配置流程、管理权限 |
| 管理层 | 管理驾驶舱 | 整体风险、交付影响、部门协同、待决策事项 | 查看影响范围、批示、追踪闭环 |
| 质量经理 | 质量工作台 | 质量异常、缺陷原因、CAPA、受影响订单 | 创建整改任务、发起复检、通知负责人 |
| 采购/物料人员 | 采购与料号工作台 | 料号申请、低库存、供应商风险、采购申请 | 提交料号申请、创建采购申请、冻结供应商风险项 |
| 设备工程师 | 设备维护工作台 | 设备健康、预测性维护、维修工单、点检任务 | 创建设备点检、接单、提交维修结果 |
| 审批人 | 我的审批 | 待审批事项、驳回补充、审批记录 | 同意、驳回、转交、评论 |

关键原则：

> 同一个业务事实，不同角色看到不同视图。

例如同一个“3 号产线质量异常”：

- 管理层看到客户交付风险和处理进度。
- 质量经理看到缺陷分布、质检记录和 CAPA。
- 生产主管看到产线、工单和停线建议。
- 采购人员看到供应商和物料批次风险。
- 审批人只看到需要自己处理的审批事项。
- 超级管理员看到该异常规则、流程和页面配置。

在指挥台上的角色裁剪方式见 [Gotham 风格智能运营指挥台](gotham-command-ui.md)第 4 节。

## 4. 页面结构与视觉风格

前台工作台采用“左侧事件队列、中央态势画布、右侧行动面板、底部时间轴”的事件驱动骨架，取代“左侧菜单、中间表格、新增/编辑表单”的传统后台结构。页面骨架、区域职责、节点配色和深浅两种视觉模式统一在 [Gotham 风格智能运营指挥台](gotham-command-ui.md)第 2、3、5 节说明，本文不再重复。

业务对象、对象关系和动作的定义（含各动作的权限建议）统一在 [Foundry 风格业务底座](foundry-foundation.md)第 3 至 5 节说明。

## 5. 示例场景：质量异常影响分析与处置

这是第一阶段最适合演示 Palantir 风格的场景。

### 5.1 演示故事

> 今天 3 号产线缺陷率突然升高。系统自动发现风险，关联物料、设备、工单、供应商和客户订单，AI 给出处置建议，质量经理一键生成整改任务，相关负责人收到通知并完成闭环。

### 5.2 页面流程

```text
运营首页
  -> 点击“3 号产线质量异常”
  -> 进入异常详情
  -> 查看影响关系图
  -> 查看 AI 原因分析和建议动作
  -> 点击“生成整改任务”
  -> 自动带出 CAPA 表单
  -> 提交流程并通知负责人
  -> 在时间轴追踪处理状态
```

### 5.3 事件详情页内容

事件摘要：

```text
异常事件：3 号产线缺陷率异常升高
发现时间：2026-05-20 09:18
异常表现：外观划痕缺陷占比上升
关联工单：WO-20260520-003
风险等级：高
```

影响图谱：

```text
供应商 SUP-06
   -> 供应
物料 MAT-21
   -> 用于
工单 WO-20260520-003
   -> 生产于
3 号产线 / 设备 EQ-03
   -> 产生
质检记录 QC-8891
   -> 发现
缺陷 D-102 外观划痕
   -> 影响
客户订单 SO-7788
```

AI 分析：

```text
可能原因：
1. EQ-03 设备振动值连续 3 小时高于正常范围。
2. MAT-21 物料在昨日切换了新批次。
3. 缺陷集中出现在同一工单和同一产线。

影响范围：
1. 影响工单 WO-20260520-003。
2. 可能影响客户订单 SO-7788。
3. 同批物料还有 360 件库存未使用。

建议动作：
1. 暂停 MAT-21 当前批次继续投产。
2. 对 EQ-03 执行设备点检。
3. 创建质量整改任务，由质量经理跟进。
4. 通知生产计划员复核交付风险。
```

业务动作按钮：

- 生成质量整改任务
- 冻结物料批次
- 创建设备点检工单
- 通知相关负责人
- 导出影响分析报告

### 5.4 整改任务表单自动带出

点击“生成质量整改任务”后，系统应弹出任务表单，并自动填入上下文：

| 字段 | 自动值 |
| --- | --- |
| 任务类型 | 质量整改 CAPA |
| 异常来源 | 3 号产线缺陷率异常 |
| 关联工单 | WO-20260520-003 |
| 关联物料 | MAT-21 |
| 关联设备 | EQ-03 |
| 责任人 | 质量经理 |
| 优先级 | 高 |
| 整改建议 | 暂停批次、设备点检、客户订单复检 |

## 6. 与现有项目模块的对照

核对日期 2026-11-17，依据 `frontend/src/App.tsx`、`frontend/src/config/navigation.ts`、`frontend/src/pages/NavigationArea/index.tsx` 和 `backend/app`。

| 设计能力 | 状态 | 当前代码位置 |
| --- | --- | --- |
| 我的工作台与审批 | 已实现 | 我的工作台 `/`（`pages/Workspace`）、流程与待办 `/workflow`（`pages/Workflow`）；后端 `api/workflow.py`、`services/workflow_views.py` |
| 角色菜单和应用入口 | 部分实现 | 应用菜单由后端维护：`api/applications.py`、`services/application_menus.py`、`services/application_menu_nodes.py`（菜单节点可限定可见角色）；管理界面 `/studio/applications`（`pages/SystemAdmin/AppMenuManagement.tsx`，使用 `config/appAssemblyMenus.ts`）；壳层导航 `config/navigation.ts`。`config/menus.ts` 只供冒烟检查 `config/readyPathSmoke.ts` 使用。没有按角色区分的默认首页 |
| 平台配置中心 | 已实现 | 应用配置区 `/studio/*`（应用与菜单、业务数据、页面设计、模板中心）与后台设置区 `/admin/*`，由 `pages/NavigationArea` 分发；表单设计 `/form-settings/:formId`（`pages/FormSettings`）。旧版模型驱动工具 `pages/ModelDriven` 只在 `/admin/model-tools`；`/system-admin` 重定向到 `/studio/applications` |
| 业务对象建模 | 部分实现 | 业务表单 `api/forms.py`、`services/form_definition.py`；本体与语义资产 `/data-center/objects`、`api/ontology.py`、`api/semantic_assets.py`、`services/ontology_service.py`。两套定义尚未统一，详见 [Foundry 风格业务底座](foundry-foundation.md)第 6 节 |
| 影响关系图 | 部分实现 | 图谱探索 `/data-center/objects?view=graph`（`pages/GraphExplorer`）；质量影响工作台 `/admin/quality-impact`（`pages/QualityImpact`）；后端 `api/graph.py`、`services/graph_service.py`，Neo4j 不可用时由 `services/graph_fallback.py` 兜底 |
| 质量异常 | 部分实现 | 质量业务页面以运行时页面提供，如 `/program/quality-overview`、`/program/quality-event`（`pages/ComponentPages/FormPageEntry.tsx` 分发到组件页面或 `pages/AppPrograms`），`/quality` 重定向到 `/program/quality-overview`；后端 `api/quality.py`。旧页面 `pages/Quality` 未挂路由。质量事件由缺陷和质检记录派生，影响图谱可回退为演示数据 |
| AI 建议 | 部分实现 | 全局 AI 面板 `components/AiChatWidget`、`api/ai_assistant.py`；质量事件 AI 建议 `POST /quality/events/{event_id}/ai-suggestion` 不调用大模型。旧页面 `pages/AIAssistant` 未挂路由，`/ai-assistant` 重定向到首页。详见 [AIP 风格智能层](aip-intelligence-layer.md)第 9 节 |
| 通知 | 已实现 | 顶栏 `components/NotificationCenter`；后端 `api/notifications.py`、`services/approval_notifications.py`。没有按事件关系自动通知相关负责人 |
| 规则触发 | 部分实现 | `api/rules.py`（校验与触发规则）、表单内规则 `services/form_rules.py`。独立页面 `pages/RuleEngine` 未挂路由，`/rules` 重定向到 `/studio` |
| 报表与看板 | 部分实现 | 看板在页面设计 `/studio/page-design` 中搭建，运行时由 `pages/AppPrograms` 与 `pages/ComponentPages` 渲染；后端 `api/analytics.py`、`api/reports.py`。旧页面 `pages/ReportCenter` 未挂路由，`/reports` 重定向到 `/studio`。影响分析报告导出未实现 |

## 7. MVP 实现顺序

第一阶段不要做大而全，先完成一个能讲清楚的闭环。状态为 2026-11-17 核对结果，现有原型为质量影响工作台 `/admin/quality-impact`（`frontend/src/pages/QualityImpact`，实验功能，仅管理员可见）。

1. 新增“智能运营指挥台”页面。
   部分实现。质量影响工作台已提供原型，但只对管理员开放，未进入业务工作台。
2. 左侧显示风险事件队列，先固定展示 3 到 5 个风险事件，包括“3 号产线质量异常”。
   部分实现。事件来自 `GET /quality/events`，由缺陷与质检记录派生，在页面顶部下拉切换；左栏是料号快捷入口，不是事件队列。
3. 中间展示制造业影响图谱，点击节点时右侧显示对象详情。
   已实现。数据来自 `GET /quality/events/{event_id}/impact`，图谱不可用或事件未关联图谱时使用演示数据。
4. 右侧展示 AI 分析、建议动作和业务按钮。
   部分实现。业务按钮按节点类型显示；AI 分析在“AI 影响分析草稿”抽屉中，内容为事件字段拼接或固定演示文本。
5. 底部展示处理时间轴，提交动作后新增一条处理记录。
   部分实现。底部时间轴按节点和关系的时间戳展示追溯过程，不随处置动作新增记录。
6. 点击“生成整改任务”后，弹出 CAPA 表单并自动填入上下文。
   部分实现。确认后直接调用 `POST /quality/capa` 写入 `CAPA` 表，描述和截止日期自动生成，没有可编辑的任务表单。
7. 提交后创建流程和通知记录。
   未实现。其余处置动作调用 `POST /quality/events/{event_id}/actions`，只返回演示结果。
8. 管理员后台保留低代码配置入口，用于解释这些对象、页面、规则和流程可以配置生成。
   已实现。见第 6 节“平台配置中心”。

演示讲法见[关系图](relationship-map.md)第 8 节。

## 8. 外部参考

- Palantir Workshop 强调基于对象层构建交互应用，并通过动作（Actions）和函数（Functions）支持业务交互。
- Palantir Actions 的公开文档强调用业务动作创建、编辑、删除、链接对象数据，并可在 Workshop 等应用里作为按钮或表单暴露给用户。
