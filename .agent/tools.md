# Tool Registry

```json
{
  "knowledge.search": {
    "name": "knowledge.search",
    "title": "Search knowledge",
    "description": "Search Markdown and vector chunks with permission filtering.",
    "side_effect": "read",
    "risk_level": "low",
    "input_schema": {"query": "string", "limit": "integer"},
    "output_schema": {"results": "array", "evidence": "array"},
    "permission_check": "rag"
  },
  "knowledge.ingest_document": {
    "name": "knowledge.ingest_document",
    "title": "Ingest knowledge document",
    "description": "Create an ingestion job from an uploaded source file.",
    "side_effect": "draft_write",
    "risk_level": "medium",
    "input_schema": {"asset_id": "string", "permission_scope": "string"},
    "output_schema": {"job_id": "string", "status": "string"},
    "permission_check": "rag",
    "audit_required": true
  },
  "knowledge.convert_to_markdown": {
    "name": "knowledge.convert_to_markdown",
    "title": "Convert to Markdown",
    "description": "Normalize documents, tables, PDFs, and images into Markdown.",
    "input_schema": {"asset_id": "string"},
    "output_schema": {"markdown_content": "string"},
    "permission_check": "rag"
  },
  "knowledge.chunk_markdown": {
    "name": "knowledge.chunk_markdown",
    "title": "Chunk Markdown",
    "description": "Split Markdown into source-linked retrieval chunks.",
    "input_schema": {"document_id": "string"},
    "output_schema": {"chunks": "array"},
    "permission_check": "rag"
  },
  "knowledge.embed_chunks": {
    "name": "knowledge.embed_chunks",
    "title": "Embed chunks",
    "description": "Generate embeddings for searchable chunks.",
    "input_schema": {"chunk_ids": "array"},
    "output_schema": {"embedding_count": "integer"},
    "permission_check": "rag"
  },
  "knowledge.extract_ontology_candidates": {
    "name": "knowledge.extract_ontology_candidates",
    "title": "Extract ontology candidates",
    "description": "Read an indexed document and extract generic objects, domain mappings, relationships, properties, and source evidence.",
    "side_effect": "draft_write",
    "risk_level": "medium",
    "input_schema": {"document_id": "string", "domain": "string", "prompt_name": "string"},
    "output_schema": {"job": "object", "generic_entities": "array", "domain_mappings": "array", "relations": "array", "quality_report": "object"},
    "permission_check": "rag",
    "audit_required": true
  },
  "knowledge.approve_ontology_candidates": {
    "name": "knowledge.approve_ontology_candidates",
    "title": "Approve ontology candidates",
    "description": "Mark reviewed ontology candidates as approved before graph publication.",
    "side_effect": "draft_write",
    "risk_level": "medium",
    "input_schema": {"job_id": "string", "approved_result": "object"},
    "output_schema": {"job": "object", "status": "string"},
    "permission_check": "config",
    "audit_required": true
  },
  "knowledge.commit_ontology_to_graph": {
    "name": "knowledge.commit_ontology_to_graph",
    "title": "Commit ontology candidates to graph",
    "description": "Publish approved ontology candidates to graph assets and create document-object evidence links.",
    "side_effect": "configuration_write",
    "risk_level": "high",
    "input_schema": {"job_id": "string"},
    "output_schema": {"job": "object", "commit": "object"},
    "permission_check": "config",
    "audit_required": true
  },
  "forms.create_dynamic_record_draft": {
    "name": "forms.create_dynamic_record_draft",
    "title": "Create form draft",
    "description": "Create an internal business record draft without submitting workflow. Must check target form create permission before writing.",
    "side_effect": "draft_write",
    "risk_level": "medium",
    "input_schema": {"form_id": "integer", "form_code": "string", "record.data": "object", "payload": "object"},
    "output_schema": {"record_id": "integer", "form_id": "integer", "form_code": "string", "status": "draft"},
    "permission_check": "save_draft",
    "audit_required": true
  },
  "forms.query_records": {
    "name": "forms.query_records",
    "title": "Query form records",
    "description": "Read dynamic form records through tenant, form, record, and field-level permissions.",
    "side_effect": "read",
    "risk_level": "low",
    "input_schema": {
      "form_id": "integer",
      "form_code": "string",
      "limit": "integer",
      "status": "string",
      "filters": "array"
    },
    "output_schema": {
      "form": "object",
      "records": "array",
      "record_count": "integer",
      "visible_fields": "array"
    },
    "permission_check": "business_query",
    "dry_run_supported": true
  },
  "forms.get_record": {
    "name": "forms.get_record",
    "title": "Get form record",
    "description": "Read one dynamic form record through tenant, form, record, and field-level permissions.",
    "side_effect": "read",
    "risk_level": "low",
    "input_schema": {
      "form_id": "integer",
      "form_code": "string",
      "record_id": "integer"
    },
    "output_schema": {
      "form": "object",
      "record": "object",
      "visible_fields": "array"
    },
    "permission_check": "business_query",
    "dry_run_supported": true
  },
  "platform.identity_settings.query": {
    "name": "platform.identity_settings.query",
    "title": "Query identity settings",
    "description": "Read tenant identity configuration such as users, roles, and account status through admin permissions.",
    "side_effect": "read",
    "risk_level": "low",
    "input_schema": {"subject": "users|roles|org_units", "limit": "integer"},
    "output_schema": {"items": "array", "count": "integer"},
    "permission_check": "config",
    "dry_run_supported": true
  },
  "platform.application_settings.query": {
    "name": "platform.application_settings.query",
    "title": "Query application settings",
    "description": "Read tenant application configuration such as apps, menus, routes, and publish status through admin permissions.",
    "side_effect": "read",
    "risk_level": "low",
    "input_schema": {"subject": "applications|menus|routes", "limit": "integer"},
    "output_schema": {"items": "array", "count": "integer"},
    "permission_check": "config",
    "dry_run_supported": true
  },
  "platform.form_settings.query": {
    "name": "platform.form_settings.query",
    "title": "Query form settings",
    "description": "Find form definitions, fields, or saved layouts. Prefer published fields when a version exists. Application scope includes direct form bindings, legacy form menus, and data sources of published component pages mounted in the application.",
    "side_effect": "read",
    "risk_level": "low",
    "input_schema": {"subject": "forms|fields|layouts", "application_id": "integer", "form_name": "string", "form_id": "integer", "form_code": "string", "limit": "integer"},
    "output_schema": {"items": "array", "count": "integer", "has_more": "boolean", "subject": "forms|fields|layouts", "application_id": "integer"},
    "permission_check": "config",
    "dry_run_supported": true
  },
  "ai.semantic_plan_low_code_form": {
    "name": "ai.semantic_plan_low_code_form",
    "title": "Semantic low-code form planner",
    "description": "Convert a conversational low-code form request or adjustment into structured form operations before any configuration write.",
    "side_effect": "read",
    "risk_level": "low",
    "input_schema": {
      "message": "string",
      "recent_messages": "array",
      "pending_slots": "object",
      "supported_operations": ["create_form", "rename_form", "add_field", "update_field", "remove_field", "confirm", "qa"]
    },
    "output_schema": {
      "intent": "qa|action",
      "skill": "low_code.create_form_definition|null",
      "operation": "create_form|rename_form|add_field|update_field|remove_field|confirm|qa",
      "formName": "string",
      "formCode": "string",
      "fields": "array",
      "menu": "object",
      "confidence": "number",
      "reason": "string"
    },
    "permission_check": "qa",
    "dry_run_supported": true,
    "audit_required": false
  },
  "forms.create_form_definition": {
    "name": "forms.create_form_definition",
    "title": "Create form definition",
    "description": "Save a low-code form draft, fields, and layouts, with an optional app association and approval workflow draft. Publishing or adding a menu entry requires a separate tool.",
    "side_effect": "configuration_write",
    "risk_level": "high",
    "input_schema": {"form": "object", "fields": "array", "workflow": "object"},
    "output_schema": {"form": "object", "fields": "array", "application_binding": "object|null", "workflow_draft_id": "integer|null", "route_path": "string"},
    "permission_check": "config",
    "audit_required": true
  },
  "forms.add_form_field": {
    "name": "forms.add_form_field",
    "title": "Add form field",
    "description": "Add one or more fields through the shared form engine and synchronize the associated layouts.",
    "side_effect": "configuration_write",
    "risk_level": "high",
    "input_schema": {
      "form_id": "integer",
      "form_code": "string",
      "fields": "array"
    },
    "output_schema": {
      "form": "object",
      "fields": "array",
      "changed_layouts": "array"
    },
    "permission_check": "config",
    "audit_required": true
  },
  "workflow.start": {
    "name": "workflow.start",
    "title": "Start workflow",
    "description": "Start an approval workflow from a confirmed draft.",
    "side_effect": "workflow_action",
    "risk_level": "high",
    "input_schema": {"draft_id": "string", "workflow_key": "string"},
    "output_schema": {"workflow_id": "string", "status": "string"},
    "permission_check": "workflow",
    "audit_required": true
  },
  "notifications.create": {
    "name": "notifications.create",
    "title": "Create notification",
    "description": "Notify users about AI-generated drafts or workflow status.",
    "side_effect": "draft_write",
    "risk_level": "medium",
    "input_schema": {"target_user_ids": "array", "message": "string"},
    "output_schema": {"notification_id": "string"},
    "permission_check": "workflow",
    "audit_required": true
  },
  "inventory.get_stock": {
    "name": "inventory.get_stock",
    "title": "Get stock",
    "description": "Read inventory availability and safety stock signals.",
    "input_schema": {"material_code": "string"},
    "output_schema": {"stock": "object"},
    "permission_check": "business_query"
  },
  "quality.get_event": {
    "name": "quality.get_event",
    "title": "Get quality event",
    "description": "Read quality event details for action draft preparation.",
    "input_schema": {"event_id": "string"},
    "output_schema": {"quality_event": "object"},
    "permission_check": "business_query"
  },
  "graph.query_impact": {
    "name": "graph.query_impact",
    "title": "Query impact graph",
    "description": "Analyze affected objects before suggesting configuration changes.",
    "input_schema": {"object_type": "string", "object_id": "string"},
    "output_schema": {"impacts": "array"},
    "permission_check": "business_query"
  }
}
```
