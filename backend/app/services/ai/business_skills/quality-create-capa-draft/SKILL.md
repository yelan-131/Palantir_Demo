---
name: quality-create-capa-draft
description: "根据质量问题和已有证据，整理纠正与预防措施并保存为待复核的草稿。适用于处理质量异常、偏差或不合格项。"
compatibility: 需要连接 ManuFoundry，并由平台提供有权使用的业务工具。
metadata:
  version: "1.0.0"
  manufoundry-registry-id: "quality.create_capa_draft"
---

# 起草质量纠正与预防措施

1. 根据用户提供的质量问题或当前页面信息，确认纠正措施要写入的已有表单及其编码。可用 `knowledge.search` 查找质量规程。质量事件查询工具当前未接入，缺少事件事实时请用户补充。
2. 整理问题描述、影响、已知原因和建议措施。待调查的原因应明确标注。通过 `forms.create_dynamic_record_draft` 提交目标表单编码和字段值，准备确认卡。
3. 用户复核并确认后，按表单权限和规则保存草稿。以返回的记录状态为准，草稿需要后续单独提交。

## 使用示例

> 根据这次尺寸超差，起草原因分析和纠正措施。
