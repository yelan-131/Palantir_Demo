---
name: maintenance-create-work-order-draft
description: "根据设备信息和故障现象，在现有工单表单中起草维修记录。适用于巡检发现异常或设备报修后，需要先整理工单的场景。"
compatibility: 需要连接 ManuFoundry，并由平台提供有权使用的业务工具。
metadata:
  version: "1.0.0"
  manufoundry-registry-id: "maintenance.create_work_order_draft"
---

# 起草维修工单

1. 根据用户提供的设备、故障现象和现场信息，确认已有工单表单及其编码。可用 `knowledge.search` 查维修规程。库存查询工具当前未接入，备件数量以用户或业务系统提供的信息为准。
2. 将设备、故障描述、建议处理方式等填入工单字段。用 `forms.create_dynamic_record_draft` 准备确认卡，供用户复核。
3. 确认后按表单权限和规则保存草稿，并返回记录状态。派工或提交审批需后续单独处理。

## 使用示例

> 根据这条设备异常，起草维修工单。
