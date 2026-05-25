# Neo4j 小白使用指南

这份文档给第一次接触 Neo4j 的人使用。你不用先理解图数据库理论，照着做就能看到项目里的制造业对象关系图。

## 1. Neo4j 是什么

Neo4j 是图数据库。它最擅长回答这种问题：

- 一个质量异常影响了哪些工单、物料、供应商、客户？
- 一台设备和哪些产线、传感器、工单有关？
- 某个供应商的物料批次最终影响到了哪些订单？
- 从一个对象出发，往外扩展一层、两层关系，会看到什么影响范围？

传统数据库像表格，Neo4j 更像关系网：

```text
设备 --属于--> 产线
工单 --生产--> 产品
物料批次 --来自--> 供应商
质量异常 --影响--> 工单 / 物料 / 订单
```

在 Neo4j 里：

- 节点：一个对象，例如设备、工单、供应商、物料。
- 关系：两个对象之间的连线，例如属于、影响、生产、供应。
- 属性：节点或关系上的字段，例如名称、编号、状态。

## 2. 打开 Neo4j

先确认 Docker 数据库容器已经运行：

```powershell
cd C:\Users\12938\Desktop\Software_Plugin\Palantir_Demo
docker compose -f .\docker\docker-compose.yml ps
```

看到 `manufoundry-neo4j` 是 `Running` 就可以。

然后打开浏览器：

```text
http://127.0.0.1:7474
```

登录信息：

```text
Username: neo4j
Password: manufoundry123
```

如果浏览器问你是否保存连接，直接确认即可。

## 3. Neo4j Browser 怎么看

登录后，你会看到一个输入框。这里输入的是 Cypher 查询语句。

Cypher 可以理解成 Neo4j 版 SQL。

最简单的查询：

```cypher
MATCH (n)
RETURN n
LIMIT 25;
```

这句话的意思是：

```text
找一些节点，返回给我，最多 25 个。
```

执行后，Neo4j 会显示一张图。你可以：

- 拖动节点
- 点击节点看属性
- 点击连线看关系类型
- 双击节点展开更多关联
- 在左侧切换 Graph / Table / Text 视图

## 4. 最常用的入门查询

查看有哪些节点类型：

```cypher
CALL db.labels();
```

查看有哪些关系类型：

```cypher
CALL db.relationshipTypes();
```

查看所有节点的一小部分：

```cypher
MATCH (n)
RETURN n
LIMIT 50;
```

查看有关系的对象图：

```cypher
MATCH (a)-[r]->(b)
RETURN a, r, b
LIMIT 80;
```

如果你只想先看图，就从这一句开始：

```cypher
MATCH (a)-[r]->(b)
RETURN a, r, b
LIMIT 80;
```

## 5. 看制造业对象

查看设备：

```cypher
MATCH (e:Equipment)
RETURN e
LIMIT 20;
```

查看工单：

```cypher
MATCH (w:WorkOrder)
RETURN w
LIMIT 20;
```

查看供应商：

```cypher
MATCH (s:Supplier)
RETURN s
LIMIT 20;
```

查看物料：

```cypher
MATCH (m:Material)
RETURN m
LIMIT 20;
```

查看产品：

```cypher
MATCH (p:Product)
RETURN p
LIMIT 20;
```

## 6. 查看一个对象周围的关系

查看设备关联了什么：

```cypher
MATCH (e:Equipment)-[r]-(x)
RETURN e, r, x
LIMIT 50;
```

查看工单关联了什么：

```cypher
MATCH (w:WorkOrder)-[r]-(x)
RETURN w, r, x
LIMIT 50;
```

查看供应商关联了什么：

```cypher
MATCH (s:Supplier)-[r]-(x)
RETURN s, r, x
LIMIT 50;
```

这里的写法：

```cypher
(a)-[r]-(b)
```

意思是：

```text
找 a 和 b 之间的任何关系，不管方向。
```

如果写成：

```cypher
(a)-[r]->(b)
```

意思是：

```text
只找从 a 指向 b 的关系。
```

## 7. 看两层影响范围

如果你想看“从一个对象出发，周围两层都有什么”，用这个：

```cypher
MATCH path = (n)-[*1..2]-(m)
RETURN path
LIMIT 100;
```

解释：

- `[*1..2]` 表示关系深度 1 到 2 层。
- 一层就是直接相连。
- 两层就是通过一个中间对象再连出去。

这个很适合看影响范围。

## 8. 按名称搜索对象

如果你知道对象名称里有某个关键词，可以这样查。

例如查名称里包含 `SMT` 的设备：

```cypher
MATCH (n)
WHERE toString(n.name) CONTAINS "SMT"
RETURN n
LIMIT 30;
```

查名称里包含 `供应商` 的对象：

```cypher
MATCH (n)
WHERE toString(n.name) CONTAINS "供应商"
RETURN n
LIMIT 30;
```

查编号里包含 `WO` 的对象：

```cypher
MATCH (n)
WHERE toString(n.id) CONTAINS "WO" OR toString(n.code) CONTAINS "WO"
RETURN n
LIMIT 30;
```

如果某些节点没有 `name`、`id` 或 `code` 字段，Neo4j 可能返回空，不代表数据库坏了。

## 9. 查看某类对象之间的关系

查看设备和产线关系：

```cypher
MATCH (e:Equipment)-[r]-(x)
RETURN e, r, x
LIMIT 80;
```

查看工单和产品、物料、设备等关系：

```cypher
MATCH (w:WorkOrder)-[r]-(x)
RETURN w, r, x
LIMIT 80;
```

查看供应商到物料的关系：

```cypher
MATCH (s:Supplier)-[r]-(m:Material)
RETURN s, r, m
LIMIT 80;
```

## 10. 表格视图和图视图

查询结果出来后，Neo4j Browser 上方通常可以切换：

- Graph：图形视图，适合看关系。
- Table：表格视图，适合看字段。
- Text：文本视图，适合复制结果。
- Code：原始数据结构。

初学时建议先用 Graph，看懂关系后再切 Table。

## 11. 常见问题

### 打不开 7474

先检查容器：

```powershell
docker compose -f .\docker\docker-compose.yml ps
```

如果 Neo4j 没有运行，启动：

```powershell
docker compose -f .\docker\docker-compose.yml up -d neo4j
```

### 密码不对

默认是：

```text
neo4j / manufoundry123
```

如果你删过 Docker volume，第一次启动时密码会重新初始化。

### 图上节点太多很乱

减少 `LIMIT`：

```cypher
MATCH (a)-[r]->(b)
RETURN a, r, b
LIMIT 20;
```

或者只查某一类对象：

```cypher
MATCH (e:Equipment)-[r]-(x)
RETURN e, r, x
LIMIT 30;
```

### 查询没有结果

可能是：

- 节点类型写错了。
- 数据里没有这种关系。
- 属性名不是 `name`、`id` 或 `code`。

可以先看所有节点类型：

```cypher
CALL db.labels();
```

再看所有关系类型：

```cypher
CALL db.relationshipTypes();
```

## 12. 危险操作：千万别随便执行

下面这句会清空整个图数据库。它只适合在明确要重建测试图数据时使用，不属于日常学习步骤：

```cypher
MATCH (n) DETACH DELETE n;
```

现在先不要执行它。

如果以后真的要重建图数据，应先确认：

- 当前 Neo4j 里是否只有测试数据；
- 是否已经备份或可以从种子数据重建；
- 是否有正在使用的业务演示依赖这份图数据。

如果需要执行这类清库动作，请先单独确认。

## 13. 推荐学习顺序

第一次学习可以按这个顺序：

1. 登录 `http://127.0.0.1:7474`
2. 执行 `CALL db.labels();`
3. 执行 `CALL db.relationshipTypes();`
4. 执行 `MATCH (a)-[r]->(b) RETURN a, r, b LIMIT 50;`
5. 点击节点，看属性。
6. 双击一个节点，展开周边关系。
7. 用 `MATCH (e:Equipment)-[r]-(x) RETURN e, r, x LIMIT 50;` 看设备关系。
8. 用 `MATCH path = (n)-[*1..2]-(m) RETURN path LIMIT 100;` 看两层关系。

先不用背语法。你只要记住：

```text
圆括号 () 表示节点
方括号 [] 表示关系
箭头 -> 表示方向
LIMIT 表示最多返回多少条
```

这就够开始用了。
