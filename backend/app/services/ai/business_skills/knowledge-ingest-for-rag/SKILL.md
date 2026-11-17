---
name: knowledge-ingest-for-rag
description: "用于把上传的文档导入知识库，供后续检索和问答。适用于添加设备手册、制度文件等资料。目前请从知识库页面发起导入。"
compatibility: 需要连接 ManuFoundry，并由平台提供有权使用的业务工具。
metadata:
  version: "1.0.0"
  manufoundry-registry-id: "knowledge.ingest_for_rag"
---

# 导入文档供知识检索

1. 确认需要导入的文件和目标知识库。
2. 当前技能的 `knowledge.ingest_document` 未接入，转换、分段和索引工具也不可调用。请到知识库页面使用「导入文档」。
3. 此技能不会生成导入确认卡，也不能返回导入或索引完成结果。导入进度以知识库页面为准。

## 使用示例

> 把上传的设备手册导入知识库，供后续问答检索。
