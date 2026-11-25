# Foundry 风格业务底座设计

状态：设计（产品构想，参考 Palantir Foundry）

本文描述目标中的对象、关系和动作底座，不是对当前代码的说明；当前实现以 [数据模型](../../architecture/data-model.md) 和 [知识图谱集成](../../architecture/knowledge/graph.md) 为准，第 6、8 节只做对照。总览见[关系图](relationship-map.md)。

> 日期：2026-05-20；与现有模块的对照更新于 2026-11-17（代码版本 0.3.22 草稿）。
> 范围：说明 ManuFoundry 如何体现 Palantir Foundry 风格的数据运营、本体、对象、关系、动作和权限底座。
> 目标：把当前低代码平台升级为“制造业业务对象操作系统”的基础。

## 1. Foundry 在这里代表什么

在本项目语境里，Foundry 不等于一个页面，也不是一个简单数据仓库。

它代表一套底层能力：

> 把分散在 ERP、MES、QMS、WMS、SCADA、IoT、Excel 和 API 中的数据，统一映射成业务对象，并定义对象关系、对象动作、权限和审计。

通俗说：

> Foundry 风格底座让系统知道“工厂世界里有哪些东西、它们之间有什么关系、可以对它们做什么动作”。

## 2. 核心组成

| 组成 | 说明 | ManuFoundry 中的体现 |
| --- | --- | --- |
| 数据集成（Data Integration） | 接入外部系统和数据文件 | 数据源中心、数据管道、连接器 |
| 本体（Ontology） | 业务对象和业务关系模型 | 本体中心、语义资产、对象关系 |
| 对象层（Object Layer） | 可被 UI、AI、流程共同使用的业务对象 | 物料、设备、工单、供应商、客户订单 |
| 关系（Links） | 对象之间的关系 | 供应商供应物料、物料用于工单、工单影响订单 |
| 动作（Actions） | 对对象执行的业务动作 | 冻结批次、生成整改任务、创建采购申请 |
| 函数（Functions） | 业务计算、规则、模型、预测 | 设备健康分、供应商风险分、缺陷率分析 |
| 安全（Security） | 权限继承和数据访问控制 | 角色权限、菜单权限、对象级权限 |
| 审计与血缘（Audit / Lineage） | 数据和动作可追溯 | 操作日志、流程记录、AI 行为日志 |

## 3. 制造业对象模型

建议把系统中的核心实体抽象成业务对象，而不是只把它们看作数据库表。

| 对象 | 说明 | 典型字段 |
| --- | --- | --- |
| `Factory` | 工厂 | 名称、位置、负责人 |
| `Workshop` | 车间 | 所属工厂、负责人 |
| `ProductionLine` | 产线 | 编码、名称、状态 |
| `Equipment` | 设备 | 编码、类型、健康分、状态 |
| `Sensor` | 传感器 | 设备、指标类型、采集频率 |
| `Supplier` | 供应商 | 名称、风险等级、交付评分 |
| `Material` | 物料 | 料号、名称、规格、单位 |
| `MaterialBatch` | 物料批次 | 批次号、供应商、入库时间、库存 |
| `WorkOrder` | 工单 | 工单号、产品、数量、计划时间 |
| `Inspection` | 质检记录 | 工单、检验项、结果、时间 |
| `Defect` | 缺陷 | 缺陷类型、严重度、数量 |
| `SalesOrder` | 客户订单 | 客户、交期、数量、状态 |
| `RiskEvent` | 风险事件 | 类型、等级、来源、状态 |
| `CorrectiveAction` | 整改任务 | 责任人、截止时间、处理状态 |
| `ApprovalTask` | 审批任务 | 审批人、关联事项、状态 |

## 4. 对象关系

建议以图谱方式维护关键关系：

```text
Factory -> has -> Workshop
Workshop -> has -> ProductionLine
ProductionLine -> runs -> WorkOrder
WorkOrder -> uses -> Equipment
Equipment -> has -> Sensor
Supplier -> supplies -> Material
Material -> has_batch -> MaterialBatch
MaterialBatch -> used_by -> WorkOrder
WorkOrder -> produces -> Inspection
Inspection -> finds -> Defect
WorkOrder -> fulfills -> SalesOrder
RiskEvent -> affects -> WorkOrder / MaterialBatch / Equipment / SalesOrder
CorrectiveAction -> resolves -> RiskEvent
```

## 5. 对象动作

Foundry 风格系统的关键不是只展示对象，而是允许用户以业务语言执行动作。

| 对象 | 动作 | 说明 | 权限建议 |
| --- | --- | --- | --- |
| `RiskEvent` | 生成质量整改任务 | 从异常事件创建 CAPA 草稿 | 质量经理 |
| `MaterialBatch` | 冻结物料批次 | 暂停风险批次继续投产或发货 | 质量经理、物料负责人 |
| `MaterialBatch` / `SalesOrder` | 发起复检 | 对受影响物料或订单创建复检任务 | 质量人员 |
| `Equipment` | 创建设备点检工单 | 对异常设备创建点检或维修工单 | 质量经理、设备工程师 |
| `SalesOrder` | 标记交付风险 | 对受影响客户订单标记风险 | 计划员、管理层 |
| `Material` | 提交料号申请 | 创建或变更物料主数据 | 采购/物料人员 |
| `Supplier` | 发起供应商复核 | 对高风险供应商创建复核任务 | 采购人员 |
| `WorkOrder` | 暂停工单 | 对受影响工单执行暂停或复核 | 生产主管 |
| `RiskEvent` | 通知相关负责人 | 按事件关系通知质量、生产、采购、计划人员 | 事件负责人 |
| `ApprovalTask` | 提交审批、审批通过或驳回 | 将整改、采购或料号申请提交给审批人并做决策 | 业务发起人、审批人 |

动作设计原则：

- 动作必须有业务语义，不只是“新增/编辑/删除”。
- 中高风险动作必须进入审批或二次确认。
- AI 可以生成动作草稿，但默认不直接完成高风险动作。
- 所有动作必须写入审计记录。

## 6. 与低代码平台的关系

低代码平台负责定义和维护 Foundry 风格底座中的配置。下表右侧两列是 2026-11-17 对当前代码的核对结果。

| 低代码能力 | Foundry 风格含义 | 状态 | 当前代码位置 |
| --- | --- | --- | --- |
| 模型设计 | 定义业务对象类型 | 部分实现 | 业务表单即业务对象类型：`/studio/business-data`、`api/forms.py`、`services/form_definition.py`。本体对象类型在数据中心 `/data-center/objects` 维护（`pages/SystemAdmin/SemanticAssetCenter.tsx`、`api/ontology.py`、`services/ontology_service.py`）。两套定义尚未统一 |
| 字段配置 | 定义对象属性 | 已实现 | 表单设计 `/form-settings/:formId`（`pages/FormSettings`）、`services/form_fields.py` |
| 关系配置 | 定义对象关系 | 部分实现 | 表单的关联对象字段（`services/form_option_sources.py`）；本体关系 `api/ontology.py` 的 `/relations`；图谱 `services/graph_service.py`。旧版 `MetaRelation` 只在 `/admin/model-tools` 可用 |
| 表单设计 | 定义对象创建/编辑界面 | 已实现 | `pages/FormSettings`、`services/form_layouts.py`、`services/form_versions.py` |
| 页面设计 | 定义对象列表、详情、图谱、工作台 | 部分实现 | `/studio/page-design`（`pages/ComponentPages`）、`api/component_pages.py`；支持列表、筛选、指标和图表组件，没有图谱组件 |
| 流程配置 | 定义动作后的审批链路 | 已实现 | 表单设计中的流程与审批页签、`api/workflow.py`、`services/workflow_routing.py`、`services/workflow_dispatch.py` |
| 规则引擎 | 定义风险事件和自动触发条件 | 部分实现 | 表单内规则 `services/form_rules.py`；校验与触发规则 `api/rules.py`。独立规则页面 `pages/RuleEngine` 未挂路由，`/rules` 重定向到 `/studio`；规则不会生成风险事件 |
| 权限配置 | 定义谁能看对象、谁能执行动作 | 部分实现 | 表单与菜单权限、数据范围、字段策略：`/admin/identity`、`services/iam.py`、`core/permissions.py`、`services/field_policies.py`。没有按本体对象和对象动作配置的权限 |

## 7. 与 AIP 的关系

AIP 智能层必须建立在 Foundry 风格对象层之上，详见 [AIP 风格智能层](aip-intelligence-layer.md)。

AI 不应该直接理解原始数据库表，而应该理解：

- 业务对象是什么。
- 对象之间有什么关系。
- 当前用户能看哪些对象。
- 当前用户能执行哪些动作。
- 某个动作的风险等级和审批要求是什么。

例如用户问：

> 这个质量异常影响哪些客户订单？

AIP 应通过对象和关系查询：

```text
RiskEvent -> WorkOrder -> SalesOrder
RiskEvent -> MaterialBatch -> WorkOrder -> SalesOrder
RiskEvent -> Equipment -> WorkOrder -> SalesOrder
```

然后返回带依据的答案。

## 8. 第一阶段实现建议

优先构建“质量异常影响分析”所需的最小 Foundry 风格底座。状态为 2026-11-17 核对结果。

1. 固化对象：供应商、物料、物料批次、工单、设备、质检、缺陷、客户订单、风险事件、整改任务。
   部分实现。`backend/app/models/relational.py` 中有 `Supplier`、`Material`、`WorkOrder`、`Equipment`、`Inspection`、`Defect`、`SalesOrder`、`CAPA`。物料批次只作为图谱标签 `MaterialBatch` 存在；风险事件没有独立模型，质量事件由 `api/quality.py` 从缺陷和质检记录派生。
2. 固化关系：供应商到物料、物料到工单、工单到设备、工单到质检、质检到缺陷、工单到客户订单。
   部分实现。`services/graph_service.py` 定义了业务图谱标签和关系类型（如 `SUPPLIED_BY`、`USES_BATCH`、`USES_EQUIPMENT`、`AFFECTS_ORDER`），Neo4j 不可用时由 `services/graph_fallback.py` 兜底；关系数据依赖演示种子。
3. 固化动作：生成整改任务、冻结物料批次、创建设备点检、通知负责人。
   部分实现。生成 CAPA 会写入 `CAPA` 表（`api/quality.py` 的 `POST /quality/capa`）；冻结批次、复检、维修工单、通知采购通过 `POST /quality/events/{event_id}/actions` 只返回演示结果，不修改业务数据。
4. 在图谱探索或新建指挥台中展示影响图谱。
   部分实现。质量影响工作台 `/admin/quality-impact`（`pages/QualityImpact`）展示以事件为中心的影响图谱。关系探索 `/data-center/objects?view=graph`（`pages/DataCenterWorkspace/RelationshipExplorer`）展示业务对象记录之间的关系。
5. 将动作接入流程和通知。
   未实现。质量事件动作没有发起审批流程或发送通知。

## 9. 参考资料

- [Palantir 架构中心概览](https://www.palantir.com/docs/foundry/architecture-center/overview)
- [Palantir 平台概览](https://www.palantir.com/docs/foundry/platform-overview)
- [Palantir Workshop 概览](https://www.palantir.com/docs/foundry/workshop/overview/)
- [Palantir Actions 概览](https://www.palantir.com/docs/foundry/workshop/actions-overview/)
