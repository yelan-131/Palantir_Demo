---
name: forms-create-record-draft
description: "按现有业务表单的字段整理用户提供的信息，经确认后保存一条记录草稿。适用于需要先填写、再复核或提交的登记和申请。"
compatibility: 需要连接 ManuFoundry，并由平台提供有权使用的业务工具。
metadata:
  version: "1.0.0"
  manufoundry-registry-id: "forms.create_record_draft"
---

# 填写一条业务记录草稿

1. 确认已有目标表单及其编码、用户要填写的字段。需要参考旧记录时，用 `forms.query_records` 和 `forms.get_record` 读取有权查看的数据。
2. 将用户提供的值映射到目标表单字段，用 `forms.create_dynamic_record_draft` 准备确认卡。关键值缺失时先补齐。
3. 用户核对表单和字段并确认后，平台按权限和表单规则保存草稿。以返回的记录 ID 和状态为准，提交审批需另行操作。

## 使用示例

> 在巡检记录里起草一条 A 线交接班巡检。
