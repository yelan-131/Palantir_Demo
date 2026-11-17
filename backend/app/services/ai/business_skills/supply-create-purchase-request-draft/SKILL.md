---
name: supply-create-purchase-request-draft
description: "根据物料、数量、用途和需求时间起草采购申请。适用于补货或新增采购需求，草稿供复核后提交。"
compatibility: 需要连接 ManuFoundry，并由平台提供有权使用的业务工具。
metadata:
  version: "1.0.0"
  manufoundry-registry-id: "supply.create_purchase_request_draft"
---

# 起草采购申请

1. 确认已有采购申请表单及其编码，收集物料、数量、单位、用途和需求时间。可用 `knowledge.search` 查采购规范。库存工具当前未接入，无法核实库存时说明缺口。
2. 将已确认的信息映射到表单字段，用 `forms.create_dynamic_record_draft` 准备确认卡。价格和供应商等信息以用户提供的事实为准。
3. 确认后保存申请草稿，报告实际记录状态。下单和提交审批需后续单独处理。

## 使用示例

> 为车间补充 20 个轴承，先起草采购申请。
