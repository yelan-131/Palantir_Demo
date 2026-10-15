# Action Contracts

The application loads this file as deployment-level Agent configuration. The Python runtime should treat these as data, not hard-coded product logic.

```json
{
  "maintenance.create_work_order_draft": {
    "tool": "forms.create_dynamic_record_draft",
    "required": ["asset", "problem_or_risk", "priority_or_window"],
    "questions": [
      "涉及哪个设备、资产、产线或业务对象？",
      "触发原因、问题或风险是什么？",
      "优先级、时间窗口、截止时间或负责人是否明确？"
    ],
    "slot_terms": {
      "asset": ["设备", "资产", "对象", "产线", "机器", "equipment", "asset", "machine", "line"],
      "problem_or_risk": ["问题", "风险", "故障", "异常", "报警", "problem", "risk", "failure", "issue", "alarm"],
      "priority_or_window": ["优先级", "紧急", "时间", "截止", "小时", "天", "负责人", "priority", "urgent", "due", "window", "owner"]
    },
    "example": "设备：SMT-03；问题：温区 5 曲线漂移；优先级：高，8 小时内处理。"
  },
  "supply.create_purchase_request_draft": {
    "tool": "forms.create_dynamic_record_draft",
    "required": ["item", "quantity", "reason"],
    "questions": [
      "申请或采购什么物料、零件或对象？",
      "数量是多少？",
      "申请原因、业务需求或库存风险是什么？"
    ],
    "slot_terms": {
      "item": ["物料", "零件", "对象", "料号", "项目", "item", "material", "part"],
      "quantity": ["数量", "个", "件", "套", "pcs", "qty", "quantity"],
      "reason": ["原因", "需求", "库存", "项目", "短缺", "reason", "need", "stock", "shortage"]
    },
    "example": "物料：焊锡膏 S12；数量：200 件；原因：预计库存不足。"
  },
  "material.create_material_application_draft": {
    "tool": "forms.create_dynamic_record_draft",
    "required": ["item", "quantity", "usage"],
    "questions": [
      "申请或领用什么物料、料号或对象？",
      "数量是多少？",
      "用途、工单、产线或关联事项是什么？"
    ],
    "slot_terms": {
      "item": ["物料", "料号", "对象", "零件", "item", "material", "part"],
      "quantity": ["数量", "个", "件", "套", "pcs", "qty", "quantity"],
      "usage": ["用途", "业务", "工单", "产线", "补料", "usage", "line", "purpose", "work order"]
    },
    "example": "物料：电控模块外壳；数量：36 套；用途：WO-260521-017 补料。"
  },
  "quality.create_capa_draft": {
    "tool": "forms.create_dynamic_record_draft",
    "required": ["problem", "containment", "owner_or_due_date"],
    "questions": [
      "问题、缺陷或异常是什么？",
      "临时处理、遏制或隔离措施是什么？",
      "责任人、截止时间或完成窗口是否明确？"
    ],
    "slot_terms": {
      "problem": ["问题", "缺陷", "异常", "不良", "风险", "problem", "defect", "issue", "risk", "quality", "capa", "category"],
      "containment": ["临时措施", "遏制", "隔离", "整改", "处理", "containment", "corrective", "action"],
      "owner_or_due_date": ["责任人", "负责人", "截止", "到期", "今天", "本周", "owner", "due"]
    },
    "example": "问题：BGA 虚焊缺陷率上升；临时措施：隔离受影响批次；责任人：QE 王工，今天完成。"
  },
  "analysis.analyze_form_records": {
    "tool": "forms.query_records",
    "required": ["form.id|form.code"],
    "optional": ["limit", "status", "filters", "analysis_question"],
    "questions": [
      "要分析哪个表单或当前页面数据？",
      "要分析什么问题，例如趋势、异常、风险、缺口还是对比？",
      "是否需要限定状态、时间范围、字段或记录数量？"
    ],
    "example": "表单：supplier_risk；分析最近 50 条记录中高风险供应商的主要原因。"
  },
  "forms.create_record_draft": {
    "tool": "forms.create_dynamic_record_draft",
    "required": ["form.id|form.code", "record.data"],
    "optional": ["source_message", "evidence", "target_form_code"],
    "questions": [
      "要在哪个表单中新增记录？请提供当前表单、表单 ID 或表单编码。",
      "这条记录的关键字段分别是什么？",
      "是否有来源证据、分析结论或后续流程需要挂到草稿上？"
    ],
    "slot_terms": {
      "form.id|form.code": ["form", "form_id", "form_code", "表单", "当前表单"],
      "record.data": ["data", "record", "字段", "内容", "值", "新增数据", "创建记录"]
    },
    "example": "表单：quality_event；记录：标题=SMT-03 温区异常，等级=高，负责人=李明。"
  },
  "low_code.create_form_definition": {
    "planner_tool": "ai.semantic_plan_low_code_form",
    "tool": "forms.create_form_definition",
    "required": ["form.name", "form.code", "fields"],
    "optional": ["form.description", "menu.create", "menu.title", "menu.icon"],
    "field_schema": ["field_name", "label", "field_type", "required", "searchable", "sortable", "enum_values"],
    "supported_field_types": ["boolean", "date", "datetime", "decimal", "enum", "integer", "json", "number", "relation", "string", "text"],
    "semantic_operations": ["create_form", "rename_form", "add_field", "update_field", "remove_field", "confirm", "qa"],
    "delta_schema": {
      "create_form": {"writes": ["form", "fields", "menu"], "requires_confirmation": true},
      "rename_form": {"writes": ["form.name"], "requires_confirmation": true},
      "add_field": {"writes": ["fields"], "requires_confirmation": true},
      "update_field": {"writes": ["fields"], "requires_confirmation": true},
      "remove_field": {"writes": ["fields"], "requires_confirmation": true},
      "confirm": {"writes": [], "requires_existing_draft": true},
      "qa": {"writes": []}
    },
    "questions": [
      "表单名称和用途是什么？",
      "需要哪些字段？哪些字段必填？",
      "是否创建菜单入口？如果创建，菜单名称是什么？",
      "是否有枚举字段、关联字段或特殊字段类型？"
    ],
    "example": "表单名称：物料主数据；字段：物料编码、物料名称、物料类型、安全库存；物料编码和物料名称必填；创建菜单入口。"
  },
  "low_code.add_form_field": {
    "planner_tool": "ai.semantic_plan_low_code_form",
    "tool": "forms.add_form_field",
    "required": ["form.id|form.code", "fields"],
    "optional": ["field.required", "field.searchable", "field.sortable", "field.enum_values", "field.ui_config"],
    "field_schema": ["field_name", "label", "field_type", "required", "searchable", "sortable", "enum_values"],
    "supported_field_types": ["boolean", "date", "datetime", "decimal", "enum", "integer", "json", "number", "relation", "string", "text"],
    "semantic_operations": ["add_field", "update_field", "qa"],
    "delta_schema": {
      "add_field": {"writes": ["fields"], "requires_existing_form": true, "requires_confirmation": true},
      "update_field": {"writes": ["fields"], "requires_existing_form": true, "requires_confirmation": true},
      "qa": {"writes": []}
    },
    "questions": [
      "要修改哪个已有表单？请提供表单 ID、表单编码，或在当前表单详情页操作。",
      "要新增哪些字段？字段名称、类型、是否必填分别是什么？",
      "这些字段是否需要出现在列表、搜索、排序或表单编辑区？"
    ],
    "example": "表单：material_master；新增字段：供应商等级，类型 string，非必填，显示在列表。"
  }
}
```
