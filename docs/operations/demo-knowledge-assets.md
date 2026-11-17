# 演示知识资产

更新日期：2026-11-17（对应代码版本 0.3.22 草稿）

本文说明仓库中用于知识库演示的数据与脚本：6 份内置演示文档如何生成和写入数据库，以及采购风险 PDF 样例脚本的用法和限制。
知识库本身的解析、检索与发布机制见[知识库架构](../architecture/knowledge/knowledge-base.md)，这些脚本不是生产数据接入方式。

## 1. 脚本一览

| 脚本 | 作用 | 写入位置 |
| --- | --- | --- |
| `scripts/seed_demo_knowledge.py` | 生成 6 份演示文档并写入知识库 | `data/knowledge_assets/` 下的文件；数据库中租户 1 的知识文档、分块和对象关联 |
| `scripts/seed_data.py` | 初始化整套演示数据，第二步中调用同一个演示知识写入函数 | 同上，另外还写入业务表和 Neo4j |
| `scripts/generate_purchase_pdf.py` | 生成一份用于手工上传的采购与供应商风险 PDF | 当前 Windows 用户的桌面，不写数据库 |

后端启动时不会写入演示知识。SQLite 演示模式的启动种子（`ENABLE_MANUFACTURING_DEMO_SEED=1`）只写入制造业业务数据和图谱，不包含知识文档。

## 2. 内置演示文档

文档内容定义在 `backend/app/services/ai/demo_knowledge_seed.py` 的 `DEMO_ASSETS` 中，围绕同一个质量场景：SMT-03 回流焊温区 5 波动叠加锡膏批次 MB-7781 冷链记录缺失，导致质量事件 QE-20260521-001 并影响客户订单 SO-8821。

| 文档 ID | 文件 | 标题 | 范围 | 预置关联对象 |
| --- | --- | --- | --- | --- |
| `kb-doc-quality-sop-docx` | `SOP-QA-014-solder-void-recheck.docx` | SOP-QA-014 焊点虚焊复检与批次冻结流程 | `department` | QualityEvent、WorkOrder、Equipment、MaterialBatch |
| `kb-doc-capa-072-docx` | `CAPA-072-solder-void-closure-report.docx` | CAPA-072 焊点虚焊闭环报告 | `department` | CAPA、QualityEvent、Equipment |
| `kb-doc-supplier-8d-xlsx` | `supplier-8d-MB-7781-risk-ledger.xlsx` | 北辰电子材料 MB-7781 供应商 8D 风险台账 | `team` | Supplier、MaterialBatch、CAPA |
| `kb-doc-process-control-xlsx` | `SMT-BGA-process-control-plan.xlsx` | SMT BGA 工艺控制计划 | `enterprise` | Equipment、Sensor、ProcessParameter |
| `kb-doc-maintenance-log-pdf` | `SMT-03-zone5-temperature-review.pdf` | SMT-03 回流焊温区 5 波动复核报告 | `enterprise` | Equipment、Sensor、WorkOrder |
| `kb-doc-customer-risk-pdf` | `SO-8821-customer-risk-communication-standard.pdf` | SO-8821 客户交付风险沟通标准 | `enterprise` | CustomerOrder、QualityEvent、CAPA |

关于内容的几点说明：

- 两份 Word 文档由脚本直接拼装 `.docx` 的 XML，包含标题、段落和表格。
- 两份 Excel 文档用 openpyxl 生成，包含多个工作表（如风险台账、温度记录、8D 状态、控制计划、SPC 趋势）。导入时每个工作表只取列名和前 10 行，所以较长的表在知识库中不完整。
- 两份 PDF 的正文是英文。脚本优先用 PyMuPDF 生成带文字层的 PDF，没有安装 PyMuPDF 时退回到手写的最简 PDF 结构；两种情况都有文字层，导入时不经过 OCR。
- 文档上的范围（`permission_scope`）和所有者只是演示字段，目前不影响可见性。
- 预置关联对象的对象 ID 是原始编号（如 `MB-7781`、`SMT-03`、`SUP-BEICHEN`），与 Neo4j 业务对象图中的 ID（如 `material-batch-mb-7781`）不是同一套约定。

## 3. 写入行为

`seed_demo_knowledge_assets()` 对每份文档依次执行：

1. 重新生成文件内容并覆盖写入 `data/knowledge_assets/<文件名>`。
2. 用与上传相同的解析函数转换为 Markdown 并分块，分块 ID 固定为 `<文档 ID>-chunk-<两位序号>`。
3. 在租户 1 中按文档 ID 更新或新增 `knowledge_documents`，状态为 `indexed`。
4. 删除该文档原有的分块和对象关联，再写入新的分块，以及状态为 `committed`、置信度 0.92、证据位置为 `seeded-demo-link` 的关联对象。
5. 同时写入当前进程内的文档、分块和任务字典。

因此脚本可以重复运行，数据库中不会产生重复文档。需要注意：

- 只写入租户 1，其他租户看不到这些文档。
- 删除并重写对象关联时，会一并删除该文档通过“发布到图谱”写入的关联。
- `data/knowledge_assets/` 下的 6 个文件已纳入版本控制，每次运行都会重新生成。Word 和 Excel 文件内含生成时间，运行后这些文件会出现在未提交的改动中，不需要时可以丢弃这些改动。
- 文件路径按脚本所在位置向上推算仓库根目录，所以应在完整的仓库检出中运行，不能在只包含 `backend/` 的后端镜像里直接运行。

在仓库根目录运行：

```bash
python scripts/seed_demo_knowledge.py
```

脚本会先执行数据库初始化（`init_db`），再写入演示文档。数据库连接使用后端的配置（`backend/.env` 或环境变量）。运行完成后，用租户 1 的管理员账号打开知识库页面即可看到这 6 份文档。

## 4. 采购风险 PDF 样例

`scripts/generate_purchase_pdf.py` 生成一份 3 页的 PDF，文件名为 `PUR-SQE-2026-0527_procurement_supplier_risk_review.pdf`，用来手工上传到知识库测试 OCR 和抽取流程。

内容包括采购订单与来料批次台账、供应商交付与证据完整性表现、SQE 与采购跟进动作、受影响的工单和客户订单，以及一张建议对象表和一张建议关系表：

| 对象类型 | 编号 |
| --- | --- |
| `Supplier` | `SUP-BEICHEN` |
| `MaterialBatch` | `MB-7781` |
| `PurchaseOrder` | `PO-260519-014` |
| `WorkOrder` | `WO-260521-017` |
| `CustomerOrder` | `SO-8821` |
| `QualityEvent` | `QE-20260521-001` |

建议关系为 `SUPPLIES`、`CONTAINS_BATCH`、`MAY_CAUSE`、`AFFECTS`、`AFFECTS_ORDER`。这些只是 PDF 中印出的文字。知识库的规则抽取只会生成 `RELATED_TO` 关系，`PurchaseOrder` 类型、`CONTAINS_BATCH` 和 `AFFECTS` 关系也不在 Neo4j 业务对象图的白名单中。

使用限制：

- 脚本没有命令行参数，输出目录固定为 `%USERPROFILE%\Desktop`。它直接读取环境变量 `USERPROFILE`，在 macOS 和 Linux 上默认没有这个变量，会直接报错退出；可以临时设置 `USERPROFILE` 指向一个包含 `Desktop` 子目录的目录来运行。
- 中文字体从 Windows 字体目录加载（Noto Sans SC、微软雅黑、黑体）。找不到时退回 Pillow 的默认字体，中文无法正常显示。
- 每一页都是用 Pillow 绘制的图片，PDF 没有文字层，上传后会走 OCR，识别效果取决于 OCR 引擎和是否配置了视觉模型增强。
- Pillow 已包含在 `backend/requirements.txt` 中，需要先安装后端依赖。
- 脚本不写数据库、Neo4j 或后端接口。生成的 PDF 是本地文件，不要提交到仓库。
