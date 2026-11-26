---
name: low-code-add-form-field
description: "根据指定或当前应用定位现有业务表单，准备新增字段、控件或规则，经确认后写入字段配置并同步相关布局。"
compatibility: 需要连接 ManuFoundry，并由平台提供有权使用的业务工具。
metadata:
  version: "1.0.0"
  manufoundry-registry-id: "low_code.add_form_field"
---

# 给现有表单添加字段

1. 先按用户指定的应用定位表单，未指定时使用已核实的当前应用和设计器上下文。用 `platform.form_settings.query` 核对实际表单 ID 或编码，再确认要新增的字段名称、类型和规则。明确是租户级独立表单时按真实 ID 或编码定位。若应用或表单仍有多个合理候选，请用户选定。需要整理字段方案时，可用 `ai.semantic_plan_low_code_form`。
2. 用 `forms.add_form_field` 提交表单标识和新增字段，准备确认卡。让用户核对目标表单、字段定义和规则。
3. 确认后，平台校验管理员权限和字段规则，写入字段并同步相关布局。根据回执说明实际应用、目标表单、新增字段、受影响的布局以及草稿或发布状态。发布是后续操作。

## 使用示例

> 给整改跟踪表添加一个必填的整改期限字段。
