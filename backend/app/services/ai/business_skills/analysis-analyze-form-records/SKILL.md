---
name: analysis-analyze-form-records
description: "按指定或当前应用查询有权查看的业务表单记录，归纳趋势、类别分布和异常。"
compatibility: 需要连接 ManuFoundry，并由平台提供有权使用的业务工具。
metadata:
  version: "1.0.0"
  manufoundry-registry-id: "analysis.analyze_form_records"
---

# 分析业务记录

1. 先确定用户指定的应用，未指定时从已核实的当前应用和页面定位业务表单。用实际表单 ID 或编码查询。用户明确要跨应用或租户范围时按该范围定位获准访问的表单。目标或范围仍有实质歧义时请用户澄清。用 `forms.query_records` 读取符合筛选条件的可见记录，必要时用 `forms.get_record` 核实单条详情。
2. 按用户需要归纳趋势、分类或异常。若只取到部分记录，标明实际覆盖范围。涉及业务口径时，可用 `knowledge.search` 补充依据。
3. 在回答中说明实际应用和表单范围、筛选条件、统计口径和证据。全程只读，无需提交写入确认。

## 使用示例

> 分析近一周巡检问题，按类别统计并列出高频问题。
