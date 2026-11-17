# Neo4j 入门

更新日期：2026-11-17（对应代码版本 0.3.22 草稿）

本文面向第一次接触 Neo4j 的人，说明如何在本地开发环境打开 Neo4j Browser、查看项目中的制造业对象关系图，以及常用的 Cypher 查询。
图模型的完整定义、数据写入途径和后端接口行为见[图谱集成](../../architecture/knowledge/graph.md)，本文不重复。

## 1. 基本概念

Neo4j 是图数据库，适合回答“一个对象和哪些对象有关、影响范围有多大”这类问题。它的数据由三部分组成：

- 节点：一个对象，例如设备、工单、供应商。节点上的“标签”表示类型，如 `Equipment`、`WorkOrder`。
- 关系：两个节点之间有方向的连线，例如“产线 `CONTAINS` 设备”。
- 属性：节点或关系上的字段，例如 `name`、`status`。

查询语言叫 Cypher，作用类似 SQL。圆括号 `()` 表示节点，方括号 `[]` 表示关系，箭头 `->` 表示方向，`LIMIT` 限制返回条数。

在本项目中，Neo4j 是可选组件，业务数据以 PostgreSQL 为准。Neo4j 里的数据可以从种子数据重建。

## 2. 启动并登录

以下命令都在仓库根目录执行。

确认容器在运行：

```bash
docker compose -f docker/docker-compose.yml ps
```

列表中 `manufoundry-neo4j` 的状态为 `running`（或 `healthy`）即可。没有运行时启动它：

```bash
docker compose -f docker/docker-compose.yml up -d neo4j
```

镜像首次启动会联网下载 APOC 插件，离线环境下可能启动失败。

然后在浏览器打开 `http://127.0.0.1:7474`，连接地址使用 `bolt://127.0.0.1:7687`，用户名为 `neo4j`。

密码在以下位置配置，本文不写出具体值：

- 开发 Compose：`docker/docker-compose.yml` 中 `neo4j` 服务的 `NEO4J_AUTH` 环境变量（格式为“用户名/密码”）。它只在数据卷 `neo4j_data` 第一次初始化时生效，之后修改不会改变已有数据库的密码。
- 后端连接 Neo4j 用的是 `NEO4J_USER`、`NEO4J_PASSWORD`，在 `backend/.env` 或环境变量中设置，默认值见 `backend/app/config.py` 与 `.env.example`。它必须与 Neo4j 中的实际密码一致。
- 发布版 Compose（`docker/docker-compose.release.yml`）要求通过环境变量 `NEO4J_PASSWORD` 提供密码，没有默认值。

## 3. 图里有什么数据

新启动的 Neo4j 是空的，需要先写入数据：

| 方式 | 写入内容 |
| --- | --- |
| 在仓库根目录运行 `python scripts/seed_data.py` | 制造业主数据图：工厂、车间、产线、设备、传感器、产品、物料、供应商、客户、工人、销售订单、工单、检验、缺陷。该脚本还会重置演示账号密码，只能在本地使用，见[后端开发](../../development/backend.md) |
| 使用 SQLite 演示模式并设置 `ENABLE_MANUFACTURING_DEMO_SEED=1` | 后端每次启动时写入同一份主数据图 |
| 登录后调用 `POST /api/v1/graph/sync/quality-demo`（开发环境可在后端的 `/docs` 页面调用） | 质量演示事件 `QE-20260521-001` 相关的业务对象图 |
| 在知识库页面发布抽取结果 | 抽取出的实体和 `RELATED_TO` 关系 |

主数据图与业务对象图使用不同的主键，节点属性也不同：

| 节点来源 | 主键属性 | 常用属性 |
| --- | --- | --- |
| 主数据图 | `pg_id`（关系表中的行 ID，数字） | 设备、物料、供应商、产品、工厂等有 `name`；工单和销售订单没有 `name`，编号在 `order_no`；产品另有 `sku` |
| 业务对象图、知识发布节点 | `id`（字符串，如 `material-batch-mb-7781`） | `name`、`type`、`source_id`（原始编号，如 `MB-7781`） |

## 4. 第一批查询

先看有哪些节点类型和关系类型：

```cypher
CALL db.labels();
```

```cypher
CALL db.relationshipTypes();
```

各类型的节点数量：

```cypher
MATCH (n)
RETURN labels(n)[0] AS label, count(*) AS total
ORDER BY total DESC;
```

随便看一部分有关系的节点：

```cypher
MATCH (a)-[r]->(b)
RETURN a, r, b
LIMIT 50;
```

结果出来后可以在 Graph、Table、Text 等视图之间切换。图视图中可以拖动节点、点击查看属性、双击展开相邻节点。

## 5. 查看主数据

工厂到设备的层级：

```cypher
MATCH path = (:Factory)-[:CONTAINS]->(:Workshop)-[:CONTAINS]->(:ProductionLine)-[:CONTAINS]->(:Equipment)
RETURN path
LIMIT 20;
```

某台设备的传感器和维护人员：

```cypher
MATCH (e:Equipment {pg_id: 1})-[r]-(x)
RETURN e, r, x;
```

工单关联的产线、销售订单和工人：

```cypher
MATCH (w:WorkOrder)-[r]-(x)
WHERE w.order_no = "WO-2026-00001"
RETURN w, r, x;
```

供应商与物料：

```cypher
MATCH (s:Supplier)-[r:SUPPLIES]->(m:Material)
RETURN s, r, m
LIMIT 40;
```

供应关系是按顺序给每个供应商分配几种物料得到的，用来演示查询，不代表真实的供货关系。

## 6. 查看质量演示图

执行过质量演示同步之后，可以从质量事件出发看影响范围：

```cypher
MATCH path = (q:QualityEvent {id: "quality-event-qe-20260521-001"})-[*1..3]-(x)
RETURN path
LIMIT 100;
```

按原始编号查找对象：

```cypher
MATCH (n)
WHERE n.source_id = "MB-7781"
RETURN n;
```

## 7. 按关键词搜索

按名称搜索：

```cypher
MATCH (n)
WHERE toString(n.name) CONTAINS "焊接"
RETURN n
LIMIT 30;
```

按编号搜索时，主数据和业务对象的字段不同，需要同时查几个属性：

```cypher
MATCH (n)
WHERE toString(n.order_no) CONTAINS "WO-2026"
   OR toString(n.source_id) CONTAINS "WO"
   OR toString(n.sku) CONTAINS "SKU-1000"
RETURN n
LIMIT 30;
```

节点没有某个属性时，该条件为空，不会报错，只是匹配不到。

## 8. 两层影响范围

```cypher
MATCH path = (e:Equipment {pg_id: 1})-[*1..2]-(m)
RETURN path
LIMIT 100;
```

`[*1..2]` 表示经过 1 到 2 条关系。层数越大结果越多，建议先从小的 `LIMIT` 开始。

## 9. 在应用内查询

数据中心“对象与关系”的图谱视图（`/data-center/objects?view=graph`）也提供 Cypher 输入框，但它只允许只读查询：含 `CREATE`、`MERGE`、`DELETE`、`SET`、`REMOVE`、`DROP`、`CALL`、`LOAD` 等关键字的语句会被拒绝。所以 `CALL db.labels()` 只能在 Neo4j Browser 中执行。应用内查询使用的是 `pg_id` 作为节点 ID。

## 10. 常见问题

| 现象 | 原因与处理 |
| --- | --- |
| 打不开 7474 | 容器没有运行，或首次启动下载 APOC 失败；查看 `docker compose -f docker/docker-compose.yml logs neo4j` |
| 登录提示密码错误 | 数据卷已经用其他密码初始化过；按第 2 节确认配置，必要时在确认数据可重建后删除 `neo4j_data` 卷重新初始化 |
| 查询没有结果 | 图还没有写入数据，或标签、属性名写错；先执行 `CALL db.labels()` 确认 |
| 同一对关系出现多条 | 主数据图的关系用 `CREATE` 写入，重复运行种子脚本或在 SQLite 演示模式下重启后端都会追加重复的边；需要干净的图时先清空再重建 |
| 应用里的图谱页面加载失败 | 后端连不上 Neo4j（返回 503），或图中没有数据（返回 409）；见[图谱集成](../../architecture/knowledge/graph.md#6-查询接口与-neo4j-不可用时的行为) |

## 11. 清空图数据

下面的语句会删除整个图，只在确认需要重建、且数据可以从种子数据和同步接口恢复时使用：

```cypher
MATCH (n) DETACH DELETE n;
```

清空后，按第 3 节重新写入数据。知识库发布的节点无法从种子数据恢复，需要在知识库页面重新发布。
