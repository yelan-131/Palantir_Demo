---
name: workflow-submit-after-confirmation
description: "用于在用户复核草稿后发起审批。适用于业务记录已准备好、需要进入审批流程时。目前请从对应业务表单提交，审批和通知工具尚未接通。"
compatibility: 需要连接 ManuFoundry，并由平台提供有权使用的业务工具。
metadata:
  version: "1.0.0"
  manufoundry-registry-id: "workflow.submit_after_confirmation"
---

# 确认后发起审批

1. 先确认要提交的业务记录和目标审批流程。
2. 当前 `workflow.start` 和 `notifications.create` 都未接入。请从对应业务表单提交审批，并在流程页面查看结果。
3. 此技能当前不会生成发起审批的确认卡，也不会发送通知。

## 使用示例

> 复核采购申请后发起审批，并通知申请人。
