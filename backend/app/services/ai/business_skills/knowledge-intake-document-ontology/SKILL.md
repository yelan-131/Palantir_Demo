---
name: knowledge-intake-document-ontology
description: "从文档中梳理业务对象及其关系，供人工复核。适用于整理设备、部件等对象之间的关联。目前可检索知识库片段，候选提取和图谱写入工具尚未接通。"
compatibility: 需要连接 ManuFoundry，并由平台提供有权使用的业务工具。
metadata:
  version: "1.0.0"
  manufoundry-registry-id: "knowledge.intake_document_ontology"
---

# 从文档提取图谱对象

1. 确认来源文档和要识别的对象、关系。若文档已进入知识库，可用 `knowledge.search` 查找相关片段并标明出处。
2. 可以根据片段列出供人工复核的建议。提取候选、审批候选和写入图谱的工具当前均未接入。
3. 本技能只支持上述只读检索，不会生成写入图谱的确认卡。

## 使用示例

> 从设备手册中提取设备、部件及其关系。
