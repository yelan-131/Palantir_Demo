---
name: low-code-inspect-form
description: "按应用或当前表单查询业务表单配置，包括字段、布局、历史版本、规则预演和发布影响。"
compatibility: 需要连接 ManuFoundry，并由平台提供有权使用的业务工具。
metadata:
  version: "1.0.0"
  manufoundry-registry-id: "low_code.inspect_form"
---

# 检查表单配置和发布影响

1. 按用户指定应用查询，未指定时使用已核实的当前应用及设计器或页面上下文。用 `platform.form_settings.query` 按应用列出表单，或按真实 ID、编码查看字段。用户明确需要租户级目录时按该范围查询。目标不明确且现有证据无法判定时，询问应用和表单。用 `forms.get_layouts` 读布局，用 `forms.list_versions` 和 `forms.get_version` 查历史版本及快照。
2. 要核对字段规则时，用 `forms.evaluate_rules` 传入测试值预演。要检查发布影响时，用 `forms.preview_publish` 查看阻塞项。
3. 说明实际应用或租户范围、表单及所查配置状态、结果和待处理项。以上调用均为只读，无需提交写入确认。

## 使用示例

> 检查整改期限改为必填后，现有记录是否会影响发布。
