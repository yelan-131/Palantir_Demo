---
name: low-code-suggest-model-or-page
description: "根据业务需求提出数据模型、页面或流程的设计建议。适用于尚在讨论方案，需要明确字段、页面结构或流程节点时。"
compatibility: 需要连接 ManuFoundry，并由平台提供有权使用的业务工具。
metadata:
  version: "1.0.0"
  manufoundry-registry-id: "low_code.suggest_model_or_page"
---

# 提出表单、页面或流程设计建议

1. 明确要解决的业务问题、使用者和预期产出。需要参考现有规范时，用 `knowledge.search` 查找依据。
2. 表单需求可用 `ai.semantic_plan_low_code_form` 整理字段与填写规则。业务页面和看板按通用页面设计，根据需要组合业务列表、筛选、指标与图表，并说明组件如何引用数据表单。图谱影响查询工具当前未接入。
3. 输出方案、关键假设和待确认的业务问题。此技能只生成建议，无需提交写入确认。

## 使用示例

> 给我一份巡检问题闭环的字段和页面设计建议。
