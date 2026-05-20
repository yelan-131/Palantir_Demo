# Foundry 风格业务底座设计

> 日期：2026-05-20  
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
| Data Integration | 接入外部系统和数据文件 | 数据源中心、Pipeline、连接器 |
| Ontology | 业务对象和业务关系模型 | 本体中心、语义资产、对象关系 |
| Object Layer | 可被 UI、AI、流程共同使用的业务对象 | 物料、设备、工单、供应商、客户订单 |
| Links | 对象之间的关系 | 供应商供应物料、物料用于工单、工单影响订单 |
| Actions | 对对象执行的业务动作 | 冻结批次、生成整改任务、创建采购申请 |
| Functions | 业务计算、规则、模型、预测 | 设备健康分、供应商风险分、缺陷率分析 |
| Security | 权限继承和数据访问控制 | 角色权限、菜单权限、对象级权限 |
| Audit / Lineage | 数据和动作可追溯 | 操作日志、流程记录、AI 行为日志 |

## 3. 制造业对象模型

建议把系统中的核心实体抽象成业务对象，而不是只把它们看作数据库表。

| 对象 | 说明 | 典型字段 |
| --- | --- | --- |
| Factory | 工厂 | 名称、位置、负责人 |
| Workshop | 车间 | 所属工厂、负责人 |
| ProductionLine | 产线 | 编码、名称、状态 |
| Equipment | 设备 | 编码、类型、健康分、状态 |
| Sensor | 传感器 | 设备、指标类型、采集频率 |
| Supplier | 供应商 | 名称、风险等级、交付评分 |
| Material | 物料 | 料号、名称、规格、单位 |
| MaterialBatch | 物料批次 | 批次号、供应商、入库时间、库存 |
| WorkOrder | 工单 | 工单号、产品、数量、计划时间 |
| Inspection | 质检记录 | 工单、检验项、结果、时间 |
| Defect | 缺陷 | 缺陷类型、严重度、数量 |
| SalesOrder | 客户订单 | 客户、交期、数量、状态 |
| RiskEvent | 风险事件 | 类型、等级、来源、状态 |
| CorrectiveAction | 整改任务 | 责任人、截止时间、处理状态 |

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

| 对象 | 动作 | 说明 |
| --- | --- | --- |
| MaterialBatch | 冻结批次 | 暂停风险批次继续投产或发货 |
| RiskEvent | 生成整改任务 | 从异常事件创建 CAPA 草稿 |
| Equipment | 创建设备点检 | 对异常设备创建点检或维修工单 |
| SalesOrder | 标记交付风险 | 对受影响客户订单标记风险 |
| Material | 提交料号申请 | 创建或变更物料主数据 |
| Supplier | 发起供应商复核 | 对高风险供应商创建复核任务 |
| WorkOrder | 暂停工单 | 对受影响工单执行暂停或复核 |

动作设计原则：

- 动作必须有业务语义，不只是“新增/编辑/删除”。
- 中高风险动作必须进入审批或二次确认。
- AI 可以生成动作草稿，但默认不直接完成高风险动作。
- 所有动作必须写入审计记录。

## 6. 与低代码平台的关系

低代码平台负责定义和维护 Foundry 风格底座中的配置：

| 低代码能力 | Foundry 风格含义 |
| --- | --- |
| 模型设计 | 定义业务对象类型 |
| 字段配置 | 定义对象属性 |
| 关系配置 | 定义对象 Links |
| 表单设计 | 定义对象创建/编辑界面 |
| 页面设计 | 定义对象列表、详情、图谱、工作台 |
| 流程配置 | 定义 Actions 后的审批链路 |
| 规则引擎 | 定义风险事件和自动触发条件 |
| 权限配置 | 定义谁能看对象、谁能执行动作 |

## 7. 与 AIP 的关系

AIP 智能层必须建立在 Foundry 风格对象层之上。

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

优先构建“质量异常影响分析”所需的最小 Foundry 风格底座：

1. 固化对象：供应商、物料、物料批次、工单、设备、质检、缺陷、客户订单、风险事件、整改任务。
2. 固化关系：供应商到物料、物料到工单、工单到设备、工单到质检、质检到缺陷、工单到客户订单。
3. 固化动作：生成整改任务、冻结物料批次、创建设备点检、通知负责人。
4. 在 Graph Explorer 或新建指挥台中展示影响图谱。
5. 将动作接入 Workflow 和 Notifications。

## 9. 参考资料

- Palantir Architecture Center Overview: https://www.palantir.com/docs/foundry/architecture-center/overview
- Palantir Platform Overview: https://www.palantir.com/docs/foundry/platform-overview
- Palantir Workshop Overview: https://www.palantir.com/docs/foundry/workshop/overview/
- Palantir Actions Overview: https://www.palantir.com/docs/foundry/workshop/actions-overview/

