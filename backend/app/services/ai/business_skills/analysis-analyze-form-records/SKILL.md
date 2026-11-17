---
name: analysis-analyze-form-records
description: "查询有权查看的业务表单记录，归纳趋势、类别分布和异常。适用于按时间、班组或问题类别分析巡检等业务数据。"
compatibility: 需要连接 ManuFoundry，并由平台提供有权使用的业务工具。
metadata:
  version: "1.0.0"
  manufoundry-registry-id: "analysis.analyze_form_records"
---

# 分析业务记录

1. 确定要分析的表单、筛选条件和统计范围。用 `forms.query_records` 读取当前用户可见的记录，必要时用 `forms.get_record` 核实单条详情。
2. 按用户需要归纳趋势、分类或异常。若只取到部分记录，标明实际覆盖范围。涉及业务口径时，可用 `knowledge.search` 补充依据。
3. 在回答中说明筛选条件、统计口径和证据。全程只读，无需提交写入确认。

## 使用示例

> 分析近一周巡检问题，按类别统计并列出高频问题。
