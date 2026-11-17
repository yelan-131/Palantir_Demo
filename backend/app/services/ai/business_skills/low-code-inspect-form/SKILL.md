---
name: low-code-inspect-form
description: "查看表单布局、历史版本，预演字段规则并检查发布影响。适用于排查表单配置问题，或在发布前确认阻塞项。"
compatibility: 需要连接 ManuFoundry，并由平台提供有权使用的业务工具。
metadata:
  version: "1.0.0"
  manufoundry-registry-id: "low_code.inspect_form"
---

# 检查表单配置和发布影响

1. 确认目标表单。用 `forms.get_layouts` 读布局，用 `forms.list_versions` 和 `forms.get_version` 查历史版本及快照。
2. 要核对字段规则时，用 `forms.evaluate_rules` 传入测试值预演。要检查发布影响时，用 `forms.preview_publish` 查看阻塞项。
3. 说明检查对象、结果和待处理项。以上调用均为只读，无需提交写入确认。

## 使用示例

> 检查整改期限改为必填后，现有记录是否会影响发布。
