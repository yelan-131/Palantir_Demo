1. 确认目标表单。用 `forms.get_layouts` 读布局，用 `forms.list_versions` 和 `forms.get_version` 查历史版本及快照。
2. 要核对字段规则时，用 `forms.evaluate_rules` 传入测试值预演。要检查发布影响时，用 `forms.preview_publish` 查看阻塞项。
3. 说明检查对象、结果和待处理项。以上调用均为只读，无需提交写入确认。

## 使用示例

> 检查整改期限改为必填后，现有记录是否会影响发布。
