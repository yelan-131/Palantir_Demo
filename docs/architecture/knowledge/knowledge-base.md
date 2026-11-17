# 知识库架构

更新日期：2026-11-17（对应代码版本 0.3.22 草稿）

本文描述知识库当前的实现：文档与分块的存储、上传解析与 OCR、检索、本体抽取与发布、知识卡片、知识问答会话以及权限边界。
Neo4j 图谱本身见[图谱集成](graph.md)，界面操作步骤见[知识库使用流程](../../guides/knowledge/knowledge-workflow.md)，完整接口清单见 [API 参考](../../development/api-reference.md)中的 `knowledge` 一节。

## 1. 组成与入口

| 层 | 位置 | 说明 |
| --- | --- | --- |
| 前端页面 | `frontend/src/pages/SystemAdmin/KnowledgeCenter.tsx`（导出为 `KnowledgeCenter`） | 路由 `/data-center/knowledge` 与 `/admin/knowledge` 渲染同一个组件；导航中两个入口都标记为仅管理员可见 |
| 文档图谱面板 | `frontend/src/pages/SystemAdmin/KnowledgeGraphCenter.tsx`（`KnowledgeGraphCenterV2`） | 嵌入知识库页面的“图谱”视图，展示已发布的抽取结果 |
| 路由 | `backend/app/api/knowledge.py`，挂载在 `/api/v1/knowledge` | 只依赖 `get_current_user`，即任何登录用户都可以调用 |
| 解析与分块 | `backend/app/services/ai/knowledge_ingestion.py` | 文件转 Markdown、按标题分块、进程内检索 |
| OCR | `backend/app/services/ai/ocr_service.py` | RapidOCR 识别与可选的视觉模型增强 |
| 检索 | `backend/app/services/knowledge_retrieval.py` | 路由与 AI 工具共用的检索和文档上下文读取 |
| 本体抽取 | `backend/app/services/ai/ontology_extraction.py` | 规则抽取、质量报告、审核、发布到图谱、图谱资产查询 |
| 演示数据 | `backend/app/services/ai/demo_knowledge_seed.py` | 生成并写入 6 份演示文档，见[演示知识资产](../../operations/demo-knowledge-assets.md) |

## 2. 存储

### 2.1 数据库表

知识库使用 5 张关系表，全部带 `tenant_id`，字段详见[数据模型](../data-model.md)：

| 表 | 内容 |
| --- | --- |
| `knowledge_documents` | 文档：`document_id`、原始文件名、`source_type`、标题、Markdown 正文、`ocr_result`（JSON）、`permission_scope`、`owner_user_id`、原始文件路径 `source_path`、状态 |
| `knowledge_chunks` | 分块：`chunk_id`、所属文档、标题、正文、`embedding`（JSON 数组）、`source_location`、`permission_scope`、状态 |
| `knowledge_ingestion_jobs` | 上传解析任务：`job_id`、`asset_id`、`document_id`、状态、错误信息 |
| `knowledge_extraction_results` | 本体抽取任务：领域、提示词名、模型名、状态、抽取结果、审核结果、质量报告、发布时间 |
| `knowledge_object_links` | 文档与对象的关联：对象类型、对象 ID、对象名称、置信度、证据位置、状态 |

旧文档中提到的 `knowledge_spaces`、`knowledge_cards`、`knowledge_evidence_refs`、`knowledge_binding_candidates`、`knowledge_permissions`、`knowledge_audit_logs` 等表都不存在。

### 2.2 进程内状态与数据库的关系

上传和抽取的结果先写入进程内字典，再尽力写入数据库：

- `knowledge_ingestion.py` 中的 `ASSETS`、`DOCUMENTS`、`CHUNKS`、`JOBS`。
- `ontology_extraction.py` 中的 `EXTRACTION_JOBS`。

数据库写入失败只记录警告，不会让请求失败。读取时一般先查进程内字典，再查数据库。由此带来两点限制：

- 后端重启后进程内字典清空，只剩数据库中的数据。保存 OCR 修正（`PUT /documents/{id}/ocr/corrections`）和视觉增强（`POST /documents/{id}/ocr/enhance`）只处理进程内的文档，重启后对旧文档调用会返回 404。
- 多个后端进程之间不共享这些字典。

### 2.3 原始文件

上传的原始文件写入 `KNOWLEDGE_STORAGE_DIR`（默认 `storage/knowledge_assets`，相对于后端进程的工作目录）。文件名会去掉非 ASCII 字符并追加 12 位随机后缀。开发环境下后端源码目录挂载到容器的 `/app`，文件落在宿主机的 `backend/storage/knowledge_assets`；`docker-compose.prod.yml` 和 `docker-compose.release.yml` 没有为这个目录挂载卷，容器重建后原始文件会丢失。

### 2.4 代码内置的演示目录

以下内容写在代码常量中，不来自数据库：

| 内容 | 位置 | 行为 |
| --- | --- | --- |
| 知识空间（个人、质量团队、质量部门、企业 4 个） | `api/knowledge.py` 的 `KNOWLEDGE_SPACES` | `GET /spaces` 始终返回，仅用于展示 |
| 知识来源分类（4 个） | `knowledge_retrieval.py` 的 `KNOWLEDGE_SOURCES` | `GET /sources` 始终返回 |
| 知识目录 | `api/knowledge.py` 的 `KNOWLEDGE_DIRECTORIES` | 增删改只修改进程内列表，重启即丢失；列表接口不按租户过滤；前端没有调用 |
| 静态文档 5 篇、分块 7 个、知识卡片 2 张 | `KNOWLEDGE_DOCUMENTS`、`KNOWLEDGE_CHUNKS`、`KNOWLEDGE_CARDS` | 只有设置环境变量 `PALANTIR_ENABLE_STATIC_KNOWLEDGE_RUNTIME` 为 `1`、`true`、`yes` 或 `on` 时才参与文档列表、检索和卡片接口；默认关闭 |

## 3. 上传与解析

`POST /knowledge/assets/upload` 接收一个文件，参数 `permission_scope`（默认 `enterprise`）和 `owner_user_id`（默认 `demo-user`，前端传 `knowledge-admin`）由客户端提供。处理过程如下：

1. 读取持久化的 AI 设置（`strict=True`，凭据存储异常时直接报错）。
2. 保存原始文件，按扩展名识别类型并转为 Markdown。
3. 按标题切分为分块，写入进程内字典，再写入 `knowledge_documents`、`knowledge_chunks`、`knowledge_ingestion_jobs`。
4. 生成“本体抽取准备”建议（文档画像、可用能力、建议动作），随响应返回。

解析在请求内同步完成，任务状态只有 `completed` 或 `failed`。失败时响应的 `ok` 为 `false`，错误写在任务的 `error` 中。

| 扩展名 | 类型 | 转换方式 |
| --- | --- | --- |
| `.md`、`.markdown`、`.txt` | `markdown` | 按 UTF-8 读取；不以 `#` 开头时补一个文件名标题 |
| `.docx` | `word` | 直接解析 `word/document.xml`：Title 样式转一级标题，Heading 样式转二级标题，表格转 Markdown 表格；不支持旧版 `.doc` |
| `.xlsx`、`.xls` | `excel` | pandas 读取每个工作表的前 50 行，输出列名和前 10 行的 Markdown 表格，不是全量内容 |
| `.pdf` | `pdf` | 先用 pypdf 提取文字层；没有文字时转入 OCR |
| `.png`、`.jpg`、`.jpeg`、`.webp`、`.bmp` | `image` | OCR |
| 其他 | `unknown` | 解析失败，任务标记为 `failed` |

分块规则（`markdown_to_chunks`）：在一到四级标题处切分，每块正文最多保留 4000 个字符，块标题取该段的第一个标题，`source_location` 为 `section:<序号>`。没有按页码、工作表或行号定位。每个分块都会写入 `embedding`，但它是对文本做 SHA-256 后取前 16 个字节得到的 16 维数值（`providers._stable_embedding`），不是语义向量。

## 4. OCR

`ocr_service.ocr_extract` 的流程：

1. 图片直接交给 RapidOCR；PDF 先用 PyMuPDF 按 2 倍分辨率逐页渲染成 PNG，再逐页识别。
2. 每个识别块记录页码、文字、边框、置信度和 `corrected_text`。置信度低于 0.72 的块标记为 `low_confidence`。
3. 按页生成 Markdown，每段前写一行置信度说明，低置信度段带 `low-confidence` 标记。
4. 平均置信度低于 0.72，或低置信度块超过 20%，或没有识别出任何文字时，尝试视觉增强：通过 Harness 运行时调用 AI 设置中“文档”用途的视觉模型，把页面图片转写为 Markdown。AI 被关闭、视觉模型为 `disabled` 或没有 API Key 时跳过；图片总量超过 15 MB 时报错。增强结果替换 Markdown 正文，错误写入 `vision_error`。

相关接口：

- `GET /documents/{id}/ocr`：返回 OCR 结果，进程内和数据库中的文档都可读取。
- `PUT /documents/{id}/ocr/corrections`：按块 ID 合并人工修正，重新生成 Markdown 与分块并写回数据库。
- `POST /documents/{id}/ocr/enhance`：对原始文件强制执行一次视觉增强，要求原始文件仍在磁盘上。

前端 `KnowledgeCenter.tsx` 中有 OCR 修正面板的代码，但页面的视图切换只有“阅读、源码、关联、图谱”四项，没有进入 OCR 面板的入口，所以目前只能通过接口查看和修正 OCR 结果。

## 5. 检索

`knowledge_retrieval._search_knowledge_payload_async` 合并三路结果，按 `chunk_id` 去重后截取前 N 条（N 限制在 1 到 10）：

| 来源 | 范围 | 打分 |
| --- | --- | --- |
| 数据库分块 | 当前租户的 `knowledge_chunks` 关联 `knowledge_documents` | 查询与分块的哈希向量余弦值，加上 2 倍的词面得分 |
| 进程内分块 | 本进程中当前租户上传的分块 | 同上 |
| 静态演示分块 | 仅在开启 `PALANTIR_ENABLE_STATIC_KNOWLEDGE_RUNTIME` 时 | scikit-learn `TfidfVectorizer`（字符级 2 到 4 元）加余弦相似度 |

需要注意的打分细节：

- 哈希向量不含语义，余弦值相当于与内容无关的固定扰动。
- 词面得分只取查询中长度不少于 2 的 `[a-z0-9_-]` 词，计算命中比例。中文字符被当作分隔符，所以纯中文查询的词面得分为 0，排序只由哈希余弦决定，不能反映相关性。含编号的查询（如 `MB-7781`、`SMT-03`）能正常命中。
- TF-IDF 只用于静态演示分块；上传和种子导入的文档都不经过 TF-IDF。

过滤条件：

- `document_id`：限定在一篇文档内。
- `object_type`、`object_id`：数据库分块先用 `knowledge_object_links` 筛出文档（`object_id` 对对象 ID 和名称做不区分大小写的模糊匹配）；进程内分块在带对象条件时整体跳过；静态分块按文档的 `linked_objects` 匹配。
- `permission_scope` 只存储，检索时不做过滤。

对外入口：

- `POST /knowledge/search`：返回 `results` 和一段固定的提示文字（有结果时提示复核来源，无结果时提示先上传文档），不调用模型。
- `GET /knowledge/related`：按对象类型和对象 ID 返回关联文档及其第一个分块，数据库结果固定得分 0.9，静态结果固定 0.88 或 0.72。
- AI 工具 `knowledge.search`（`services/ai/tool_handlers.py`）：调用同一个检索函数，再按 AI 设置中 `ragPolicy` 的 `similarityThreshold`（默认 0.15）过滤，按 `maxEvidenceChars`（默认 1200）截断正文；指定文档却没有命中时，退回到读取该文档的全部分块。

## 6. 本体抽取、审核与发布

### 6.1 抽取准备

`POST /documents/{id}/ontology-intake` 根据文档内容生成建议：文档画像（标题、类型、行数、是否含表格和 OCR、可能的领域）、可用能力和建议动作。这一步只做规则判断，不写数据。前端每次选中文档都会调用一次。

### 6.2 抽取任务

两个入口最终都调用规则抽取函数 `deterministic_extract`，不调用任何模型：

- `POST /documents/{id}/extraction-jobs`：对已有文档抽取，前端“开始本体抽取”按钮使用这个接口。
- `POST /extraction-jobs`：上传文件后立即抽取。实际只接受 Markdown 或文本、PDF 和 Excel，Word 和图片会被拒绝。

请求中的 `prompt_name`、`model_name`（默认 `rules-ontology-extractor`）只作为记录保存。规则如下：

- 逐行扫描最多 40 行候选（标题行、含冒号的行、含 `ABC-123` 形式编号的行），跳过表格行。
- 按关键词（如“供应商”“批次”“设备”“工单”“缺陷”“客户”）或编号前缀（`WO`、`MB`、`QE`、`CAPA`）判断实体类型，可能的类型为 `Supplier`、`Material`、`MaterialBatch`、`Equipment`、`WorkOrder`、`Defect`、`QualityEvent`、`CAPA`、`Customer`、`Product`。
- 命中内置别名（如“北辰电子材料”“MB-7781”“SMT-03”）的实体置信度为 0.86，其余为 0.68，证据位置为 `line:<行号>`。
- 相邻两个实体之间生成一条 `RELATED_TO` 关系，置信度不超过 0.76。
- 正文含“必须”“不得”等词时生成一条逻辑规则候选；含“冻结”“复核”“通知”等词时生成一条动作候选。
- 结果同时补充通用类型映射（如 `Supplier` 对应 `Organization`）、领域映射和属性候选。

### 6.3 质量报告

| 级别 | 代码 | 条件 |
| --- | --- | --- |
| `FATAL` | `NO_ENTITIES` | 没有抽出实体 |
| `ERROR` | `LOW_CONFIDENCE_ENTITY`、`LOW_CONFIDENCE_RELATION` | 置信度低于 0.6 |
| `ERROR` | `MISSING_EVIDENCE` | 实体或关系没有证据位置 |
| `WARNING` | `DUPLICATE_ENTITY_CANDIDATE` | 同类型同名实体重复 |
| `WARNING` | `UNBOUND_MASTER_DATA` | 该类型有内置别名，但实体名不含任何别名 |
| `INFO` | `READY_FOR_REVIEW` | 没有其他问题 |

只有 `FATAL` 会阻断（`blocking` 为真）。

### 6.4 审核与发布

- `POST /extraction-jobs/{id}/approve`：可提交修改后的结果，重新生成质量报告；无阻断时状态为 `approved`，否则为 `blocked`。
- `POST /extraction-jobs/{id}/commit-to-graph`：只检查是否存在阻断问题，不要求先审核。执行顺序：
  1. 把每个实体以抽取类型为标签写入 Neo4j，节点 `id` 为候选 ID；把每条关系写为 `RELATED_TO` 边。每次写入超时 3 秒。任何一步失败，图谱写入整体标记为 `degraded`，但继续后面的步骤。
  2. 为每个实体写一条 `knowledge_object_links`（状态 `committed`，对象 ID 为候选 ID）。
  3. 为每个实体和关系写入或更新 `ontology_candidates`（来源类型 `knowledge`），供数据中心的对象与关系审核。
  4. 任务状态改为 `committed`，响应中的 `graph_status` 为 `created`、`degraded` 或 `skipped`。
- `GET /extraction-jobs/{id}/export?format=`：支持 `json`、`yaml`（实际是带注释的 JSON）、`csv`、`ttl`（`turtle`、`rdf` 同义）、`html`。

发布写入的节点以候选 ID 为主键，不会和由种子数据构建的设备、物料等节点合并，在图中形成独立的子图。图谱面板展示的“图谱资产”（`/graph/assets/*`）也不读 Neo4j，而是从所有已发布的抽取任务中重新组装，详见[图谱集成](graph.md#5-知识抽取发布与图谱资产)。

### 6.5 对象关联

文档的关联对象来自 `knowledge_object_links`，目前只有两种写入途径：发布抽取结果，以及演示种子脚本写入的预置关联（状态 `committed`，置信度 0.92）。没有手工选择对象或确认候选的接口和界面。0.3.22 删除了未实现的 `/knowledge/binding-candidates` 接口和前端的 `suggestKnowledgeBindings`。

## 7. 知识卡片

`GET /cards`、`GET /cards/{id}`、`GET /related-cards` 只读取代码中的 2 张静态卡片，并且只在开启 `PALANTIR_ENABLE_STATIC_KNOWLEDGE_RUNTIME` 时返回数据，默认是空列表。卡片没有数据库表，也没有新建、编辑、审核或发布接口。

例外是 `POST /graph/sync/quality-demo`：它直接读取 `KNOWLEDGE_CARDS` 常量，不受环境变量控制，会把这 2 张卡片写成 Neo4j 中的 `KnowledgeCard` 节点。

质量影响页面（`/admin/quality-impact`）选中节点时会调用 `/related-cards` 和 `/cards`，因此在默认配置下右侧知识面板为空。

## 8. 知识问答会话

知识库页面右侧“助手”中的对话使用以下接口：

| 接口 | 行为 |
| --- | --- |
| `POST /agent/conversations` | 按“租户、用户、页面、文档”查找状态为 `active` 的会话，存在则复用并更新标题，否则新建 |
| `GET /agent/conversations` | 列出当前用户在某页面（默认 `knowledge-center`）的会话，最多 100 条 |
| `GET /agent/conversations/{id}/messages` | 读取消息，只允许会话所属用户 |
| `POST /agent/conversations/{id}/messages` | 发送一条消息并得到回答 |

发送消息时的处理顺序：

1. 加载 AI 设置，用 `decide_ai_permission` 校验当前用户是否允许使用问答模式，不允许时返回 403。
2. 读取会话最近 12 条消息作为上下文。
3. 用意图路由判断是否需要检索。属于知识、业务查询或页面帮助的问题，在 `ragPolicy.enabled` 为真时按 `ragPolicy.topK`（默认 5，最大 20）检索当前文档；问题含“文档、内容、总结”等词或没有检索结果时，补充该文档的全部分块。
4. `memoryPolicy.enabled` 为真时召回相关记忆。
5. 调用 Harness 运行时（`harness_runtime.run`，上下文 `surface` 为 `knowledge`）生成回答，模型由 AI 设置决定。旧文档中的本地 `knowledge-agent-v1` 模板回答已不再使用。
6. 在一个事务中写入用户消息、助手消息（带证据）、`ai_agent_runs`（模式 `qa`、风险 `low`）、一条 `knowledge.search` 的 `ai_tool_calls` 记录，以及一条状态为 `candidate` 的记忆。
7. 写审计日志，动作为 `ai_agent_message`。

这里的 `ai_tool_calls` 只是记录检索结果，检索本身由路由直接调用，没有经过 AI 工具边界。

## 9. 与 AI 助手的关系

- 工具注册表（`data/agent_registry/tools.json`）中，`knowledge.search` 有实际处理函数；`knowledge.ingest_document`、`knowledge.convert_to_markdown`、`knowledge.chunk_markdown`、`knowledge.embed_chunks`、`knowledge.extract_ontology_candidates`、`knowledge.approve_ontology_candidates`、`knowledge.commit_ontology_to_graph` 的处理函数都是 `not_implemented`。
- 右下角 AI 助手浮窗支持“知识”上下文（`AiChatWidget` 中的 `knowledgeContext`），但目前没有页面调用 `setKnowledgeContext`，所以浮窗始终按全局模式运行。

AI 运行时的整体说明见 [AI 能力说明](../ai/README.md)。

## 10. 权限与租户隔离

- 后端所有知识接口只要求登录，没有管理员或角色校验。前端只对管理员显示知识库入口。
- 文档、分块、解析任务、抽取任务、对象关联、会话、消息都按当前租户过滤；会话还按用户隔离。
- 文档上的 `permission_scope` 和 `owner_user_id` 只存储和展示，列表和检索都不据此过滤；`owner_user_id` 由客户端参数决定。
- 知识目录接口不按租户过滤。
- `/graph/assets/*` 从所有租户已发布的抽取任务中汇总数据，不按租户过滤，见[图谱集成](graph.md#7-权限与租户)。

## 11. 边界与未实现

以下是保留的设计方向，当前代码中均未实现：

- 语义向量检索（未实现）：没有接入外部向量模型、pgvector 或独立的向量表，`embedding` 列中只有 16 维哈希值。目标是在不改变 `/knowledge/search` 响应结构的前提下，增加由后端统一调用的向量化与相似度检索，并按权限、空间、对象类型和审核状态过滤。
- 知识空间与发布流程（未实现）：个人、团队、部门、企业四级空间只是展示数据，没有审核、发布、退回、归档的状态流转。
- 持久化的知识卡片（未实现）：卡片目前只有两张静态示例，没有从文档编写、审核卡片的能力。
- 对象绑定与主数据匹配（未实现）：没有按名称、编码、别名把抽取实体匹配到 ERP、MES、QMS 主数据的能力，也没有低置信度候选的人工确认队列和别名字典。
- 基于模型的抽取（未实现）：`parse_llm_extraction_json` 已定义解析与校验格式，但抽取流程尚未调用模型。
- 知识权限（未实现）：没有按 `permission_scope` 或所有者过滤文档与检索结果。
- 长任务（未实现）：解析和 OCR 都在请求内同步执行，没有后台队列。
