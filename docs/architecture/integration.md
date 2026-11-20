# 数据接入与连接器

更新日期 2026-11-20，对应代码版本 0.3.26。

本文面向需要了解或扩展数据接入能力的开发者和实施人员，说明数据中心“数据接入”背后哪些能力已经真实实现、哪些仍是模拟或未实现，以及外部数据进入表单、流程和数据资产的现有路径。接口的完整清单见 [API 参考](../development/api-reference.md)。

## 1. 现状概览

当前仓库没有独立的连接器执行层。原先位于 `backend/app/services/data_integration/` 的 MES、ERP、IoT、PLC 演示数据生成器已在 0.3.22 中删除，它们从未被任何路由、管线或脚本调用。真实可用的外部数据访问集中在以下几处：

| 能力 | 实现位置 | 状态 |
| --- | --- | --- |
| PostgreSQL 连接测试与表清单 | `backend/app/api/data_sources.py` 的 `test-config` | 真实连接 |
| 元数据扫描（表、字段、主外键、行数、样例） | `backend/app/services/metadata_scan_service.py` | PostgreSQL 真实扫描，其余类型见第 3 节 |
| HTTP JSON 接口读取 | `backend/app/services/form_option_sources.py` | 真实请求，只读 GET |
| 表单选项来自外部接口 | 同上 | 真实请求 |
| 流程自动任务向 API 或 Webhook 推送数据 | `backend/app/services/workflow_dispatch.py` | 真实请求 |
| 表单 CSV/XLSX 导入 | `backend/app/services/form_imports.py` | 真实导入 |
| PostgreSQL 已审核映射同步到表单 | `backend/app/services/mapped_form_sync.py` | 复用已保存绑定手动入表，记录真实执行回执 |
| 数据源测试、同步、同步状态、数据预览（数据库类型） | `backend/app/api/data_sources.py` | 模拟 |
| 同步管线运行 | `backend/app/api/pipeline.py` | 模拟 |
| 定时任务执行 | `backend/app/api/scheduler.py` | 只有任务登记，没有执行器（未实现） |

以下连接器类别目前都没有实现：ERP、MES、IoT、PLC 的生产级连接器，OPC UA、Modbus，MQTT、Kafka 等流式接入，SCADA、LIMS，以及 MySQL、SQL Server、Oracle 的真实连接。旧文档或界面中出现这些名称时，以本节为准。

## 2. 数据源登记

数据源保存在 `data_sources` 表中，按租户隔离，接口前缀为 `/api/v1/data-sources`。

后端接受的类型（`SUPPORTED_SOURCE_TYPES`）为 `postgresql`、`mysql`、`sqlserver`、`oracle`、`database`、`api`、`rest_api`、`mes`、`erp`、`qms`、`wms`、`crm`、`iot`、`plc`。保存时会规范化类型：如果类型无法识别，但连接配置中带有 `host` 或 `database`，会被存为 `postgresql`。数据库类型保存时要求填写 `host`、`database` 和 `username`。

`api` 和 `rest_api` 类型只能由管理员创建、修改和查看，配置必须是不含用户名密码的 HTTP(S) 地址，请求方法只能是 `GET`，认证信息放在 `headers` 中。

连接配置以 JSON 文本原样存入 `connection_config`，其中的数据库密码没有加密；数据源列表只返回脱敏后的连接地址，但详情接口会返回完整的 `connection_config`。因此登记数据源时应使用只读账号。

数据库不可用时，数据源列表和详情接口会返回内置的模拟数据，并在响应中带 `source: fallback` 标记。

## 3. 连接测试与元数据扫描

### 3.1 新建连接时的测试

`POST /api/v1/data-sources/test-config` 仅限管理员，按类型处理：

- `api`、`rest_api`：通过 `form_option_sources` 真实请求接口并解析 JSON。
- `postgresql`、`mysql`、`sqlserver`、`oracle`：都使用 psycopg2 连接，所以实际上只有 PostgreSQL 能连通。连通后列出指定 schema 下的表，并统计前 12 张表的行数。
- 其他类型：直接返回模拟的成功结果。

### 3.2 已登记数据源的操作

针对已登记数据源的操作中，只有部分是真实实现：

- 测试连接（`/{id}/test`）：`api` 类型会真实请求；其他类型固定返回成功（延迟 45 ms、1250 条记录）。
- 同步（`/{id}/sync`）：只把状态改为 `syncing` 并更新最后同步时间，不读取任何数据。
- 映射同步（`/{id}/mapped-form-sync`）：按已审核字段映射读取 PostgreSQL，并在同一事务中新增或更新业务表单记录。响应包含实际读入、新增、更新和无变化条数。
- 同步绑定（`/{id}/mapped-form-sync-bindings`）：保存来源表、对象和目标表单。`/{binding_id}/runs` 复用配置执行实际读写并记录回执。连接管理的「最近入表」按成功回执计算，扫描时间从元数据扫描状态读取。
- 同步状态（`/{id}/status`）：固定返回 1250 条已同步记录。
- 预览（`/{id}/preview`）：`api` 类型返回真实数据（仅管理员）；其他类型返回模拟行。
- 元数据扫描（`/{id}/metadata-scan`）及扫描结果、样例、扫描状态的查询接口：真实实现，见下文。

### 3.3 元数据扫描

`scan_data_source_metadata` 是元数据扫描的唯一实现，数据源接口 `/{id}/metadata-scan` 和语义资产接口 `POST /api/v1/semantic-assets/data-assets/{id}/metadata-scan` 都调用它。界面上的入口是数据资产页面（`frontend/src/pages/SystemAdmin/SemanticAssetCenter.tsx`）的“扫描元数据”按钮；连接向导保存连接时不会自动扫描。扫描结果写入字段画像和样例表，供数据资产、字段与语义映射使用。各类型的行为如下：

| 类型 | 扫描方式 |
| --- | --- |
| `postgresql` | 真实读取 `information_schema`：表、字段、主键、外键、行数和样例行。可指定 `selected_tables`，未写 schema 时默认 `public` |
| 配置中声明了 `metadata_tables` 的任意类型 | 使用声明的表结构 |
| `mysql`、`sqlserver`、`oracle` | 只能使用手工提供的表清单，否则报错 |
| `api` | 根据配置中的 OpenAPI 文档或 `endpoints` 生成 |
| `mes`、`erp`、`qms`、`wms`、`crm`、`iot`、`plc` | 按模板生成占位表，不连接真实系统 |
| `internal_form`、`internal_workflow` | 读取 `internal_data_assets` 中登记的站内资产 |

数据分级为 `restricted` 时不采集样例行。`internal_data_assets.register_internal_asset` 目前没有调用方，站内表单和流程不会自动登记为内部资产。

## 4. 数据中心界面

数据中心的“数据接入”分为“连接管理”和“同步任务”两个页签（定义在 `frontend/src/config/dataCenter.ts`）。

在“连接管理”中，管理员使用“新建 PostgreSQL 连接”打开“接入数据源”向导（`frontend/src/pages/DataSource/ConnectionWizard.tsx`），步骤为“连接 / 采集范围 / 治理使用”：

1. 连接：只有 PostgreSQL 可选，MySQL、SQL Server、Oracle、REST API、Excel/CSV、OPC UA 标为“待开发”。填写连接信息后必须先“测试连接”并读出表清单，才能进入下一步。
2. 采集范围：选择采集内容（表结构、字段画像、样例数据、全量数据、增量数据）、采集方式（仅元数据扫描、定时批量同步、增量同步、CDC）、频率和纳入资产目录的表。其中只有元数据扫描是真实执行的；批量、增量同步和 CDC 只作为配置保存。
3. 治理使用：填写业务域、负责人、数据分级，以及是否允许 AI、对象建模和图谱使用，最后“保存连接”。保存只写入数据源记录，要生成表和字段信息，需要再到数据资产页面执行“扫描元数据”。

“新建 PostgreSQL 连接”的下拉菜单中还有“其他数据源”入口，非管理员看到的是“新建数据源”。这个表单的类型下拉列出了 MongoDB、Redis、Kafka、MQTT、OPC UA、Modbus、CSV 等后端不支持的类型；这些类型只要填写了主机地址，保存后都会被规范化为 `postgresql`。表格中每行提供编辑、测试、同步任务（跳转到“同步任务”页签）、预览和删除操作，测试与预览的真实程度见第 3.2 节。

“同步任务”页签（`frontend/src/pages/Pipeline/index.tsx`）顶部提示“当前为模拟运行，运行记录不代表源数据已同步。”运行管线后提示“已记录模拟运行”。后端运行接口只写入一条运行记录，处理条数是随机数；数据库不可用时返回模拟数据。

“日常任务”（`/scheduler`）页面可以增删改查定时任务，数据保存在 `scheduled_jobs` 表中。手动触发只写入日志，系统中没有按 cron 表达式执行任务的调度器（未实现）。

## 5. 外部数据进入业务的现有路径

下列路径是真实可用的，适合在交付中使用：

- **表单选项来源。** 已登记、状态为 `active` 或 `connected` 的 `api` 数据源可以作为表单选择控件的“外部接口”选项来源。请求默认拒绝内网地址，管理员可以在数据源配置中用 `allow_private_network` 放开。
- **表单批量导入。** 业务列表的“批量导入”支持 CSV 和 XLSX，单个文件不超过 5 MB、500 行、100 列，导入前需要预览并确认列映射，写入时与手工录入使用相同的校验和权限规则。
- **流程数据下发。** 流程中的“自动任务”节点可以把表单字段映射后推送到站内另一张表单（创建草稿）、外部 API 或 Webhook。推送在流程经过节点后异步执行，使用 `POST` 并携带幂等键，不跟随重定向，失败后可在流程实例的下发记录中重试。
- **元数据进入数据资产。** PostgreSQL 数据源在数据资产页面扫描后，表和字段进入“数据资产”，可在“字段与语义映射”中关联到对象模型。这条路径只同步元数据和样例，不同步业务数据。
- **已审核映射同步到业务表单。** 扫描 PostgreSQL 表并审核字段映射后，管理员在连接管理或选中资产表后打开「同步绑定」，选择对象和已发布、无需提交审批的目标表单。来源表需要单列主键，映射到目标表单中有无条件单字段唯一规则的字段。配置可以保存复用。同步按该键定位记录，第一次新增，来源值变更时更新，相同值再次同步时跳过。每次最多 500 条，也可指定一个来源主键同步。
- **从对象浏览查看真实记录和关系。** 在「对象与关系 → 对象浏览 → 实例配置」中，为已发布对象配置该表单、主键和属性映射，再为已发布关系指定来源属性和目标对象主键。浏览按来源表单的记录与字段权限返回实例。关系两端可互相跳转。例如 QMS 缺陷按工单号匹配到 MES 工单，工单也可以反向找到多个缺陷。

## 6. 外部数据源演示环境

仓库提供了一套模拟外部系统的 PostgreSQL 环境，用于演示连接和元数据扫描：

- `docker/docker-compose.external-sources.yml` 启动 6 个 PostgreSQL 实例（MES、ERP、QMS、WMS、SCM、CRM），本机端口为 15432 到 15437。
- `scripts/create_demo_source_databases.py` 在指定实例中创建演示库、表、数据和只读角色，支持 `--host`、`--port`、`--user`、`--password` 和 `--only`。只读角色的密码是脚本中的常量，只能用于本地演示。
- `scripts/start_isolated_demo_sources.ps1` 在 Windows 上启动隔离的演示数据源。
- `scripts/register_demo_external_sources.py` 调用后端接口登记这些数据源并触发扫描（支持 `--api-base`、`--isolated`、`--no-scan` 等参数）。该脚本发送请求时不带登录令牌，而当前所有数据源接口都要求登录，因此直接运行会得到 401；需要先补充认证后才能使用。在补充之前，可以用管理员账号在“接入数据源”向导中手工登记。

## 7. 扩展连接器时的约束

新增真实连接器时，应遵守以下约束：

- 不要把连接凭据写入提交的文件；凭据应来自环境变量或加密存储。
- 把外部系统视为不可靠：每次同步都需要超时、重试、状态和错误记录。
- 原始数据与规范化后的记录分开保存，所有业务数据都通过明确的映射步骤进入表单或对象。
- 不要根据外部数据自动创建物理表；物理表只由表单引擎创建（见[表单引擎](low-code/forms.md)）。
- 同步操作应当幂等，重复运行不能产生重复记录。
- 新连接器应当替换第 3.2 节中对应类型的模拟分支，同时保持连接测试、扫描、同步状态的接口形态不变，避免前端再次区分真假结果。
