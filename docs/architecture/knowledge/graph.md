# 图谱集成（Neo4j）

更新日期：2026-11-17（对应代码版本 0.3.22 草稿）

本文描述 Neo4j 在当前代码中的用法：连接配置、两套图模型、数据写入途径、查询接口、Neo4j 不可用时的行为，以及知识抽取结果如何进入图谱。
关系表中的本体对象与映射（`/semantic-assets`）不在本文范围内，见[数据模型](../data-model.md)；在 Neo4j Browser 中动手查询的方法见 [Neo4j 入门](../../guides/knowledge/neo4j-beginner.md)。

## 1. 职责划分

- PostgreSQL 是业务数据的唯一来源。Neo4j 是可选组件，只保存关系索引，可以由种子数据和同步接口重建。
- 前端不直接连接 Neo4j，所有图查询都经过后端的 `/api/v1/graph`、`/api/v1/quality`、`/api/v1/ontology` 等接口。
- 知识库保存文档和证据，抽取结果审核后可以写入 Neo4j，见第 5 节。

## 2. 连接与配置

| 配置 | 默认值或位置 |
| --- | --- |
| `NEO4J_URI` | `bolt://localhost:7687`；Compose 中的后端使用 `bolt://neo4j:7687` |
| `NEO4J_USER` | `neo4j` |
| `NEO4J_PASSWORD` | 后端默认值写在 `backend/app/config.py` 与 `.env.example`；开发 Compose 的 Neo4j 初始密码由 `docker/docker-compose.yml` 的 `NEO4J_AUTH` 设定；`docker-compose.release.yml` 要求必须通过环境变量提供 |

`backend/app/database.py` 在导入时创建异步驱动 `neo4j_driver`，创建时不验证连接，第一次查询时才会发现服务不可用。没有安装 `neo4j` 包或驱动创建失败时，`neo4j_driver` 为 `None`，图谱功能整体禁用。`/api/v1/system/readiness` 不检查 Neo4j。

Compose 中的镜像为 `neo4j:5-community`，配置了 APOC 插件，但后端代码没有使用 APOC。端口分配：

| 场景 | 浏览器端口 7474 / Bolt 端口 7687 |
| --- | --- |
| `docker/docker-compose.yml`（开发） | 对所有地址开放 |
| 叠加 `docker/docker-compose.prod.yml` | 只绑定 `127.0.0.1` |
| `docker/docker-compose.release.yml` | 只绑定 `127.0.0.1`，端口可用 `NEO4J_HTTP_PORT`、`NEO4J_BOLT_PORT` 修改 |

## 3. 图模型

Neo4j 中同时存在两套互不连通的节点，它们的主键不同。

### 3.1 制造业主数据图

定义在 `backend/app/models/graph_models.py`，节点以关系表的行 ID 作为 `pg_id`：

- 节点标签（`NodeLabel`，15 个）：`Factory`、`Workshop`、`ProductionLine`、`Equipment`、`Sensor`、`Product`、`Material`、`SalesOrder`、`WorkOrder`、`Supplier`、`Customer`、`Warehouse`、`Inspection`、`Defect`、`Worker`。每个标签都有 `pg_id` 唯一约束。
- 关系类型（`RelType`，12 个）：`CONTAINS`、`PRODUCES`、`REQUIRES`、`SUPPLIES`、`INSPECTS`、`MAINTAINS`、`FEEDS`、`ASSIGNED_TO`、`STORED_IN`、`SHIPS_TO`、`FULFILLS`、`FOUND_IN`。
- `ENTITY_SCHEMAS` 为每个标签定义中文名、属性和允许的出边，供 `/ontology/entities` 返回。

`GraphService.build_from_seed` 从 `data/seed/*.json` 构建这张图。节点属性是种子记录去掉 `id` 后的全部字段，所以工单、销售订单节点只有 `order_no` 没有 `name`。实际创建的关系如下：

| 关系 | 方向 | 依据 |
| --- | --- | --- |
| `CONTAINS` | 工厂 → 车间 → 产线 → 设备 | 外键 `factory_id`、`workshop_id`、`line_id` |
| `FEEDS` | 设备 → 传感器 | `sensors.equipment_id` |
| `PRODUCES` | 销售订单 → 产品 | `sales_orders.product_id` |
| `ASSIGNED_TO` | 销售订单 → 客户；工单 → 产线；工人 → 工单 | 外键；工人按工单 ID 轮询分配 |
| `FULFILLS` | 工单 → 销售订单 | `work_orders.sales_order_id` |
| `FOUND_IN` | 缺陷 → 检验 | `defects.inspection_id` |
| `INSPECTS` | 检验 → 产品、物料或设备；工人 → 检验 | `inspections.target_type`、`inspector_id` |
| `SUPPLIES` | 供应商 → 物料 | 按顺序每个供应商分配 2 到 3 种物料，不是真实供货关系 |
| `MAINTAINS` | 工人 → 设备 | 角色含“维修”“维护”的工人各分配 3 台设备 |

`REQUIRES`、`STORED_IN`、`SHIPS_TO` 以及“产线 → 产品”的 `PRODUCES` 虽然有定义，但种子构建不会创建。`data/seed/` 中没有仓库数据，所以也不会有 `Warehouse` 节点。

节点和关系都用 `CREATE` 写入。节点受 `pg_id` 唯一约束保护，重复构建时会跳过；关系没有唯一约束，重复构建会产生重复的边。

### 3.2 业务对象图

定义在 `backend/app/services/graph_service.py`，节点以稳定的字符串 `id` 为主键，用 `MERGE` 写入（`upsert_business_node`、`upsert_business_edge`）：

- 允许的标签（`BUSINESS_GRAPH_LABELS`，18 个）：`QualityEvent`、`Defect`、`InspectionBatch`、`MaterialBatch`、`Supplier`、`WorkOrder`、`Equipment`、`CustomerOrder`、`CAPA`、`KnowledgeCard`、`Operation`、`ProductBatch`、`InventoryLot`、`Sensor`、`TimeSeriesWindow`、`Material`、`Product`、`Customer`。
- 允许的关系（`BUSINESS_GRAPH_RELS`，18 个）：`HAS_DEFECT`、`FOUND_IN`、`INSPECTS`、`SUPPLIED_BY`、`USES_BATCH`、`USES_EQUIPMENT`、`AFFECTS_ORDER`、`TRIGGERS`、`EVIDENCE_FOR`、`RUNS_OPERATION`、`PRODUCES_BATCH`、`STORED_AS`、`REINSPECTS`、`MAY_CAUSE`、`MEASURED_BY`、`HAS_TS_ANOMALY`、`CORRELATES_WITH`、`RELATED_TO`。

不在白名单中的标签或关系会被拒绝。对象 ID 约定为“类型前缀加业务编号”的小写形式，例如 `quality-event-qe-20260521-001`、`material-batch-mb-7781`、`supplier-s-023`、`workorder-260521-017`、`equipment-smt-03`、`customer-order-so-8821`、`capa-072`。节点还会带上 `object_id`、`type`、`source_id`（原始编号）和 `source_system`。

这套图目前只由两个途径写入：质量演示同步（第 4 节）和知识抽取发布（第 5 节）。

## 4. 数据写入途径

| 途径 | 写入内容 | 触发方式 |
| --- | --- | --- |
| `scripts/seed_data.py` | 制造业主数据图（不含 `sensor_readings`、`spc_points`） | 手动运行，同时初始化 PostgreSQL；Neo4j 连接失败时跳过 |
| SQLite 演示启动 | 制造业主数据图 | `DATABASE_BACKEND=sqlite` 且 `ENABLE_MANUFACTURING_DEMO_SEED=1` 时每次启动都会构建，测试环境跳过 |
| `POST /api/v1/graph/sync/quality-demo` | 质量演示事件 `QE-20260521-001` 的 15 个对象、20 条关系，以及 2 张静态知识卡片和它们的 `EVIDENCE_FOR` 边 | 手动调用接口，前端没有调用入口；整体超时 8 秒 |
| `POST /api/v1/knowledge/extraction-jobs/{id}/commit-to-graph` | 抽取出的实体节点与 `RELATED_TO` 边 | 知识库页面“发布到图谱” |
| `POST /api/v1/ontology/entities/{type}/instances` | 一个主数据节点，`pg_id` 取当前该标签节点数加 1 | 先写 Neo4j，失败时改为插入关系表 |
| `POST /api/v1/ontology/relations` | 一条主数据关系 | 尽力写入，失败只记录日志，仍返回成功 |
| 旧版模型驱动数据接口（`api/model_driven_data.py`） | 记录增删改时同步创建、更新、删除对应节点 | 尽力同步，超时 3 秒 |

质量演示同步写入的关系包括：质量事件 `HAS_DEFECT` 缺陷、缺陷 `FOUND_IN` 检验批、检验批 `INSPECTS` 物料批次、物料批次 `SUPPLIED_BY` 供应商、工单 `USES_BATCH`/`USES_EQUIPMENT`/`AFFECTS_ORDER`/`RUNS_OPERATION`/`PRODUCES_BATCH`、产品批次 `AFFECTS_ORDER` 客户订单、质量事件 `TRIGGERS` CAPA、工序 `MAY_CAUSE` 缺陷、物料批次 `STORED_AS` 库存批、CAPA `REINSPECTS` 复检批、设备 `MEASURED_BY` 传感器、传感器 `HAS_TS_ANOMALY` 时序窗口、时序窗口 `CORRELATES_WITH` 工序与缺陷。映射表见 `backend/app/api/graph.py` 的 `QUALITY_EDGE_REL_MAP`。

## 5. 知识抽取发布与图谱资产

知识库的“发布到图谱”把抽取任务中的每个实体以其类型为标签写入业务对象图，节点 `id` 是抽取时生成的候选 ID（形如 `ent-xxxxxxxxxxxx`），并带上来源文档、证据位置、置信度和 `review_status`、`publish_status`。每条关系写为 `RELATED_TO` 边。每次写入超时 3 秒，任何一次失败都会让本次发布的图谱状态标记为 `degraded`，但对象关联和本体候选仍会写入关系库。完整流程见[知识库架构](knowledge-base.md#64-审核与发布)。

由于节点以候选 ID 为主键，发布结果不会与主数据图或质量演示图中的同名对象合并。

“图谱资产”接口（`/graph/assets/nodes`、`/assets/relationships`、`/assets/evidence`、`/assets/quality` 及详情）不查询 Neo4j，而是从进程内和 `knowledge_extraction_results` 中所有状态为 `committed` 的抽取任务重新组装节点、关系和证据，并给出低置信度、缺少证据、未绑定主数据的统计。因此即使 Neo4j 不可用，知识库页面的“图谱”视图仍能显示已发布的抽取结果。

## 6. 查询接口与 Neo4j 不可用时的行为

自 0.3.x 起，图谱接口不再在 Neo4j 不可用时返回模拟数据，而是返回明确的错误（`backend/app/core/production_errors.py`）：

- Neo4j 未配置、超时或查询失败：HTTP 503，`code` 为 `GRAPH_UNAVAILABLE`。
- 查询成功但没有数据：HTTP 409，`code` 为 `SEED_DATA_REQUIRED`。

`backend/app/api/graph.py` 中仍保留 `MOCK_NODES`、`MOCK_RELATIONSHIPS` 和 `raise` 之后的模拟分支代码，这些代码不会被执行。

| 接口 | 行为 |
| --- | --- |
| `POST /graph/query` | 优先使用白名单模板（`stats`、`all_factories`、`neighbors`）；也可传自由 Cypher，但含 `CREATE`、`MERGE`、`DELETE`、`DETACH`、`SET`、`REMOVE`、`DROP`、`CALL`、`LOAD`、`FOREACH`、`USING`、`GRANT`、`REVOKE` 的语句会被拒绝（400），因此 `CALL db.labels()` 这类过程调用也不能通过本接口执行 |
| `GET /graph/neighbors/{id}`、`/path`、`/subgraph/{id}`、`/stats` | 按 `pg_id` 查询主数据图；演示模式下超时 0.8 秒，生产模式 5 秒 |
| `GET /graph/entity/{label}/{id}`、`/graph/entity/{label}/{id}/relationships`、`/graph/impact-analysis/{id}`、`/graph/trace/{id}`、`/graph/analytics/centrality` | 按 `pg_id` 查询，超时固定 5 秒 |
| `GET /graph/impact-analysis-by-object` | 按业务对象查询 1 到 3 跳子图（最多 120 个节点），超时演示模式 0.8 秒、生产模式 3 秒；见下文 |
| `GET /quality/events/{id}/impact` | 质量影响页面使用；见下文 |

`impact-analysis-by-object` 接受业务对象图或主数据图中的标签，并会同时尝试别名标签（例如 `MaterialBatch` 也查 `Material`，`CustomerOrder` 也查 `SalesOrder`，`QualityEvent` 也查 `Defect` 和 `Inspection`）。根节点按 `id`、`object_id`、`source_id`、`name`、`pg_id`、`sku` 任一字段匹配，遍历时排除 `VERSION_OF` 关系。返回体包含 `root`、`nodes`、`edges`、`summary` 和 `source: "neo4j"`。

`/quality/events/{id}/impact` 先以 `quality-event-<小写事件编号>` 为根查询 Neo4j（最多 5 跳、200 个节点，超时 5 秒）：

- 查到时返回图数据，`source` 为 `graph`。
- 查不到且事件来自数据库（编号形如 `QD-<缺陷ID>`）时返回 404。
- 查不到且是代码内置的演示事件（如 `QE-20260521-001`）时，返回内置的静态图，`source` 为 `backend-demo`。

`GET /quality/events` 只返回由当前租户的缺陷和检验记录生成的 `QD-` 事件，所以在没有执行质量演示同步的情况下，这些事件都查不到影响图。

其他使用 Neo4j 的位置：

- 设备健康详情（`api/maintenance.py`）尝试用邻居和影响分析补充位置路径、传感器数量和级联风险，失败时静默忽略。
- `/ontology/entities/{type}/instances` 依次尝试 Neo4j、关系表、代码内的模拟数据；`/ontology/timeline/{id}` 和 `/ontology/entities/{type}/instances/{id}/relationships` 在 Neo4j 失败时仍会返回固定的模拟记录。
- 质量追溯 `/quality/traceability/{id}` 为了保证租户隔离，在代码中直接跳过 Neo4j，只查关系库。
- `services/graph_fallback.py` 提供 `try_graph_then_db`（先图后库）和 `try_graph_or_mock`（图失败即报 503，名称中的 mock 参数已不再使用）。

## 7. 权限与租户

- 所有图谱接口只要求登录，没有管理员或角色校验。
- Neo4j 节点没有 `tenant_id`。任何登录用户都可以通过只读 Cypher、邻居、路径等接口读取整张图，包括其他租户发布的知识抽取节点。
- 图谱资产接口汇总所有租户的已发布抽取任务，不按租户过滤。
- `/ontology/entities/{type}/instances` 回退到关系表时直接 `SELECT * FROM <表>`，没有租户条件。

## 8. 前端入口

| 入口 | 组件 | 使用的接口 |
| --- | --- | --- |
| 数据中心“对象与关系”的图谱视图（`/data-center/objects?view=graph`） | `pages/GraphExplorer` | 统计、邻居、子图、最短路径、Cypher 查询 |
| 后台“质量影响与时间线”（`/admin/quality-impact`，标注为实验功能） | `pages/QualityImpact` | 先调 `impact-analysis-by-object`，失败时对质量事件再调 `/quality/events/{id}/impact`；选中节点时读取关联知识卡片 |
| 后台“图谱分析与追溯”（`/admin/graph-tools`） | `pages/BackendSettings` | 影响分析、追溯链、中心度 |
| 后台“实体时间旅行”（`/admin/entity-timeline`） | `pages/BackendSettings` | `/ontology/timeline/{id}`，页面已提示结果含演示回退数据 |
| 知识库页面的“图谱”视图 | `KnowledgeGraphCenterV2` | `/graph/assets/*` |

已知问题：`GraphExplorer` 读取统计接口的 `node_count`、`edge_count`、`entity_types`、`relation_types` 字段，而 `/graph/stats` 返回的是 `total_nodes`、`total_relationships`、`nodes_by_label`、`rels_by_type`，所以页面顶部的统计卡片始终显示 0。

## 9. 边界与未实现

- 从业务表批量或增量同步业务对象图（未实现）：业务对象图只有质量演示数据和知识发布数据，没有从 MES、ERP、QMS、WMS 读取并规范化对象 ID 的同步任务。
- 主数据别名与对象合并（未实现）：知识发布节点、主数据节点、业务对象节点之间没有按编码或别名合并的机制。
- 图谱租户隔离与按角色过滤（未实现）。
- 时序版本：`entity_timeline` 模板依赖 `VERSION_OF` 关系和 `EntityVersion` 节点，但当前没有任何代码写入这类数据（未实现）。
- 种子重建去重（未实现）：重复运行种子构建会产生重复关系，需要先清空图再重建。
