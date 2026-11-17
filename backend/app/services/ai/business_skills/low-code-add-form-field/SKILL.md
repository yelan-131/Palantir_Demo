---
name: low-code-add-form-field
description: "为现有业务表单准备新增字段，经确认后写入字段配置并同步相关布局。适用于补充字段、控件或字段规则。"
compatibility: 需要连接 ManuFoundry，并由平台提供有权使用的业务工具。
metadata:
  version: "1.0.0"
  manufoundry-registry-id: "low_code.add_form_field"
---

# 给现有表单添加字段

1. 确认现有表单的 ID 或编码，以及字段名称、类型和规则。需求需要整理时，可用 `ai.semantic_plan_low_code_form` 生成计划。
2. 用 `forms.add_form_field` 提交表单标识和新增字段，准备确认卡。让用户核对目标表单、字段定义和规则。
3. 确认后，平台校验管理员权限和字段规则，写入字段并同步相关布局。根据回执说明新增字段及受影响的布局。发布是后续操作。

## 使用示例

> 给整改跟踪表添加一个必填的整改期限字段。
