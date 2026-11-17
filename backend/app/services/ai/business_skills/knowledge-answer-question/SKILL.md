---
name: knowledge-answer-question
description: "从有权访问的知识库中检索资料，结合来源证据回答问题。适用于查询制度、操作规程、设备手册等已有文档中的信息。"
compatibility: 需要连接 ManuFoundry，并由平台提供有权使用的业务工具。
metadata:
  version: "1.0.0"
  manufoundry-registry-id: "knowledge.answer_question"
---

# 根据知识库回答问题

1. 将问题整理为检索词，用 `knowledge.search` 查找相关知识片段。用户指定了文档时，限定到该文档。
2. 根据返回的片段回答，并标明文档出处。证据不足时说明哪些内容无法确认。
3. 全程只读，无需提交写入确认。

## 使用示例

> 查设备巡检规程，告诉我异常上报时限。
