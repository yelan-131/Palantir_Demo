---
name: forms-create-record-draft
description: "按指定或当前应用定位业务表单，整理业务记录、登记或申请的字段，经确认后保存记录草稿。"
compatibility: 需要连接 ManuFoundry，并由平台提供有权使用的业务工具。
metadata:
  version: "1.0.0"
  manufoundry-registry-id: "forms.create_record_draft"
---

# 填写一条业务记录草稿

1. 优先按用户指定的应用定位目标表单，未指定时使用已核实的当前应用和页面。用上下文中的表单 ID、编码或组件数据源定位，必要时通过有权限的应用、菜单及表单工具核实。关键目标无法确认或有多个候选时，请用户一次选定。需要参考旧记录时，用 `forms.query_records` 和 `forms.get_record` 读取目标表单中有权查看的数据。
2. 将用户提供的值映射到目标表单字段，用 `forms.create_dynamic_record_draft` 准备确认卡。关键值缺失时先补齐。
3. 用户核对表单和字段并确认后，平台按权限和表单规则保存草稿。回复时说明实际应用、表单、记录 ID 和保存状态。未核实的应用归属如实说明，提交审批需另行操作。

## 使用示例

> 在巡检记录里起草一条 A 线交接班巡检。
