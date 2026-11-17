# AIP、Foundry、Gotham 与低代码平台关系图

状态：设计（产品构想，参考 Palantir Foundry、AIP、Gotham）

本文描述产品定位和目标结构，不是对当前代码的说明；当前实现以 [系统架构总览](../../architecture/overview.md) 为准，本文第 7 节只做对照。

> 日期：2026-05-20；与现有模块的对照更新于 2026-11-17（代码版本 0.3.22 草稿）。
> 范围：解释 ManuFoundry 中 AIP、Foundry、Gotham 风格 UI、低代码平台、工作流、权限和审计之间的关系。
> 目的：让产品讲解、UI 设计和后续开发拆分有统一语言。

## 文档导航

本文是 Palantir 风格设计文档的总览，其余四篇各负责一个方面：

| 文档 | 负责内容 |
| --- | --- |
| [Foundry 风格业务底座](foundry-foundation.md) | 业务对象、对象关系、对象动作、与低代码平台的关系 |
| [AIP 风格智能层](aip-intelligence-layer.md) | AI 能力分层、编排架构、典型 Agent、风险控制 |
| [Gotham 风格智能运营指挥台](gotham-command-ui.md) | 指挥台页面骨架、区域职责、视觉风格、角色裁剪 |
| [角色工作台](role-workbench.md) | 前台与后台的划分、角色视角、质量异常示例场景、整体 MVP 顺序 |

## 1. 一句话说明

ManuFoundry 不应只被描述成“低代码平台”，而应描述成：

> 面向制造业的智能运营平台：低代码负责搭建业务对象和流程，Foundry 风格底座负责统一数据和业务关系，AIP 风格智能层负责分析、推荐和受控执行，Gotham 风格指挥台负责把风险事件、影响关系、处置方案和时间线展示给不同角色。

## 2. 各层分别是什么

| 层 | 在 Palantir 体系中的含义 | 在 ManuFoundry 中的体现 | 面向用户 |
| --- | --- | --- | --- |
| 低代码平台 | 快速构建应用、表单、页面和流程的工具 | 平台配置中心、模型设计、页面设计、表单设计、流程配置、规则引擎 | 超级管理员、实施人员 |
| Foundry 风格底座 | 数据运营平台，围绕本体（Ontology）统一对象、关系、动作、权限 | 数据源中心、业务本体中心、关系图谱、对象动作、权限审计 | 平台管理员、数据/业务建模人员 |
| AIP 风格智能层 | 将大模型连接到企业数据、对象、工具和业务动作 | AI 助手、AI 分析面板、AI Agent、AI 辅助搭建、AI 审计 | 业务用户、管理层、管理员 |
| Gotham 风格指挥台 | 事件驱动的态势感知和行动调度界面 | 智能运营指挥台、风险事件队列、中央影响图谱、右侧行动方案、底部时间轴 | 管理层、质量、生产、采购、设备 |
| 流程与动作 | 将对象变化变成可审批、可追踪、可审计的业务动作 | 生成整改任务、冻结批次、提交料号申请、创建采购申请、审批流 | 业务人员、审批人 |
| 权限与审计 | 控制谁能看、谁能做、谁做过什么 | 基于角色的权限、操作日志、AI 行为日志、流程记录 | 全部角色 |

## 3. 总体关系图

```text
角色工作台 / 指挥台 UI
管理层     质量经理     采购人员     设备工程师     审批人
   │          │          │           │           │
   └──────────┴──────────┴───────────┴───────────┘
                        │
                  AIP 风格智能层
        AI 总结 / AI 问答 / AI 推荐 / AI Agent / AI 评估
                        │
                 Foundry 风格业务对象层
      物料 / 设备 / 工单 / 供应商 / 质检 / 客户订单 / 风险事件
                        │
                 图谱关系 + 业务动作
       影响分析 / 冻结批次 / 生成整改 / 创建采购申请 / 提交审批
                        │
                  数据融合层
          ERP / MES / QMS / WMS / SCADA / IoT / Excel / API
                        │
                低代码配置中心
      模型 / 表单 / 页面 / 菜单 / 流程 / 规则 / 权限 / 模板
```

## 4. 通俗解释

可以把系统理解成一家公司里的四类能力：

| 能力 | 通俗比喻 | 说明 |
| --- | --- | --- |
| 低代码平台 | 搭积木的工具箱 | 用来搭表单、页面、流程、规则 |
| Foundry | 企业业务世界的地图和字典 | 告诉系统什么是物料、设备、工单，它们之间是什么关系 |
| AIP | 会读业务、会建议、能执行的智能助手 | 帮人总结问题、分析原因、生成任务草稿、调用业务动作 |
| Gotham 风格 UI | 指挥中心大屏和调度台 | 把风险、影响范围、资源、方案和处理进度放到一个界面 |

## 5. 一个完整业务闭环

以“质量异常影响分析”为例：

```text
1. 数据融合层接入质检、设备、工单、物料、订单数据。
2. Foundry 风格对象层把这些数据映射成业务对象。
3. 图谱关系层知道物料、设备、工单、供应商、客户订单之间的关系。
4. 规则引擎发现 3 号产线缺陷率异常，生成风险事件。
5. Gotham 风格指挥台把风险事件推给质量经理和管理层。
6. AIP 智能层读取事件上下文，生成原因分析、影响范围和处置建议。
7. 用户点击“生成质量整改任务”。
8. 业务动作创建 CAPA 草稿并进入审批流程。
9. 通知中心提醒质量、生产、采购、设备等负责人。
10. 审计层记录用户和 AI 的所有关键动作。
```

这个场景的页面流程和数据示例见[角色工作台](role-workbench.md)第 5 节。

## 6. 产品菜单建议

下面是目标菜单结构。当前代码的实际导航分为“业务工作台”“应用配置”“数据中心”“后台设置”“插件与扩展”五个区域，定义在 `frontend/src/config/navigation.ts`，与此建议不一一对应。

```text
智能运营
  ├─ 智能运营指挥台
  ├─ 管理驾驶舱
  ├─ 风险事件中心
  └─ 我的任务

业务工作台
  ├─ 质量工作台
  ├─ 采购与料号工作台
  ├─ 设备维护工作台
  ├─ 供应链工作台
  └─ 我的审批

AI 能力
  ├─ AI 运营助手
  ├─ AI Agent 编排
  ├─ AI 辅助搭建
  └─ AI 审计与评估

业务本体
  ├─ 本体对象
  ├─ 对象关系
  ├─ 业务动作
  └─ 关系图谱

平台配置中心
  ├─ 应用管理
  ├─ 模型设计
  ├─ 表单设计
  ├─ 页面设计
  ├─ 菜单配置
  ├─ 流程配置
  ├─ 规则引擎
  ├─ 权限管理
  └─ 数据源管理
```

## 7. 与现有代码的对照

核对日期 2026-11-17，依据 `frontend/src/App.tsx`、`frontend/src/config/navigation.ts`、`frontend/src/pages/NavigationArea/index.tsx` 和 `backend/app`。这里只按层给出概况，逐项对照见各分篇。

| 产品层 | 状态 | 当前代码位置 |
| --- | --- | --- |
| 低代码平台 | 已实现 | 应用与菜单 `/studio/applications`（`pages/SystemAdmin/AppMenuManagement.tsx`）、业务数据 `/studio/business-data`、表单设计 `/form-settings/:formId`（`pages/FormSettings`）、页面设计 `/studio/page-design`（`pages/ComponentPages`）；后端 `api/forms.py`、`api/applications.py`、`api/component_pages.py`、`services/form_*`。旧版模型驱动工具（`pages/ModelDriven`、`api/model_driven*.py`）只保留在 `/admin/model-tools` |
| Foundry 风格底座 | 部分实现 | 数据中心 `/data-center/sources`、`/data-center/assets`、`/data-center/objects`（`pages/DataCenterWorkspace`、`pages/SystemAdmin/SemanticAssetCenter.tsx`、`pages/GraphExplorer`）；后端 `api/data_sources.py`、`api/pipeline.py`、`api/ontology.py`、`api/semantic_assets.py`、`api/graph.py`、`services/graph_service.py`、`services/ontology_service.py`。对象动作层未统一建模 |
| AIP 风格智能层 | 部分实现 | 全局 AI 面板 `components/AiChatWidget`；后端 `api/ai_assistant.py`、`services/ai/`（编排、工具注册、权限策略、确认令牌）。独立页面 `pages/AIAssistant` 未挂路由，`/ai-assistant` 重定向到首页 |
| Gotham 风格指挥台 | 部分实现 | 质量影响与时间线 `/admin/quality-impact`（`pages/QualityImpact`，标注为实验功能，仅管理员可见）；后端 `api/quality.py` 的质量事件接口。面向业务角色的指挥台未实现 |
| 流程与动作 | 部分实现 | 流程与待办 `/workflow`（`pages/Workflow`）、`api/workflow.py`、`services/workflow_*.py`、`api/notifications.py`、`api/rules.py`。质量事件处置动作多为演示返回 |
| 权限与审计 | 已实现 | `api/auth.py`、`api/admin.py`、`services/iam.py`、`core/permissions.py`、`core/audit.py`；界面在 `/admin/identity` 与 `/admin/audit` |

## 8. 对外讲解顺序

讲解时不要按技术层从下往上讲，而是按业务故事讲：

1. 先讲一个真实事件：质量异常、低库存、设备风险或交付延误。
2. 展示智能运营指挥台：左侧事件、中间影响图、右侧 AI 建议、底部时间线。
3. 展示一键动作：生成整改任务、冻结物料批次、创建采购申请。
4. 再解释背后：这些对象、关系、动作、流程和页面都由低代码平台和 Foundry 风格底座配置。
5. 最后解释 AIP：AI 可以安全读取这些对象，并在权限和审计约束下提供建议或执行动作。

开场可以这样讲：

> 假设今天 3 号产线产品缺陷率突然升高。传统方式需要质量、生产、采购、仓库几个部门分别查表、问人、拉群确认。现在系统自动把相关数据连起来，告诉我们问题可能来自哪里，影响了哪些工单、物料、设备和客户订单，并且可以一键生成整改任务。

在指挥台页面可以补充：

> 普通报表只能告诉我们缺陷率升高了。这个指挥台会告诉我们问题来自哪里，影响了哪些物料、设备、工单和客户订单，AI 建议怎么处理，以及能不能一键把处理任务派出去并持续追踪闭环。

演示结束再说明：

> 这些业务对象、页面、关系、流程和规则，背后都可以通过平台配置中心低代码配置出来。

这样用户先看到业务价值，再理解平台能力。

## 9. 参考资料

- [Palantir AIP 概览](https://www.palantir.com/docs/foundry/aip/overview/)
- [Palantir AIP 架构](https://www.palantir.com/docs/foundry/architecture-center/aip-architecture)
- [Palantir AIP、Foundry 与 Apollo 平台关系](https://www.palantir.com/docs/foundry/architecture-center/platforms/)
- [Palantir 架构中心概览](https://www.palantir.com/docs/foundry/architecture-center/overview)
- [Palantir Workshop 概览](https://www.palantir.com/docs/foundry/workshop/overview/)
- [Palantir Actions 概览](https://www.palantir.com/docs/foundry/workshop/actions-overview/)
