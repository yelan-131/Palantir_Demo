# Data Model And Ontology Notes

Last updated: 2026-05-29

Source of truth: `backend/app/models/relational.py`,
`backend/app/models/graph_models.py`, and `backend/alembic/versions/*`.

This document separates current storage from ontology/reference design. Older
versions described TimescaleDB and full event-sourced ontology storage as if
they were implemented; those are not active in the current code.

## Current Storage Shape

The project uses:

- PostgreSQL-compatible relational storage through SQLAlchemy.
- SQLite-compatible fallback behavior for local/demo paths where applicable.
- Neo4j for manufacturing graph queries and seeded graph relationships.
- JSON/JSONB columns for flexible configuration and dynamic form records.

Not currently active as deployed/runtime storage:

- TimescaleDB hypertables.
- Event-sourced ontology change-log tables.
- Persistent vector database for knowledge/RAG.

## Relational Model Groups

Current ORM tables in `relational.py` are grouped below.

| Group | Tables |
| --- | --- |
| Factory hierarchy | `factories`, `workshops`, `production_lines`, `equipment`, `sensors`, `sensor_readings` |
| Product and process | `products`, `materials`, `bom`, `process_routes` |
| Orders and execution | `customers`, `sales_orders`, `work_orders`, `operations`, `workers` |
| Supply chain | `suppliers`, `warehouses`, `inventory`, `shipments` |
| Quality | `inspections`, `defects`, `spc_points`, `capa` |
| Integration | `data_sources`, `pipelines`, `pipeline_runs` |
| System settings | `system_settings` |
| Reporting | `reports`, `report_snapshots` |
| Model-driven platform | `meta_models`, `meta_fields`, `meta_relations`, `page_configs`, `menu_items`, `model_versions` |
| Application platform | `applications`, `application_menus`, `application_roles` |
| Forms platform | `forms`, `application_forms`, `application_menu_nodes`, `form_fields`, `form_layouts`, `form_actions`, `form_permissions`, `form_versions`, `dynamic_records`, `workflow_bindings` |
| Tenant operations | `tenants`, `tenant_domains`, `tenant_invites`, `tenant_exports`, `password_reset_tokens` |
| Identity and permissions | `users`, `roles`, `user_roles`, `role_permissions`, `org_units`, `user_org_memberships`, `user_sessions`, `password_history`, `oidc_states` |
| Workflow and notifications | `workflow_defs`, `workflow_instances`, `workflow_approvals`, `notifications` |
| Rules and operations | `rules`, `audit_logs`, `scheduled_jobs` |
| Knowledge storage | `knowledge_documents`, `knowledge_chunks`, `knowledge_ingestion_jobs`, `knowledge_extraction_results`, `knowledge_object_links` |
| AI runtime | `ai_conversations`, `ai_messages`, `ai_agent_runs`, `ai_tool_calls`, `ai_memory_entries` |

## Manufacturing Core

The manufacturing core follows a conventional ISA-95-inspired shape:

```text
Factory
  -> Workshop
    -> ProductionLine
      -> Equipment
        -> Sensor
          -> SensorReading
```

Production and quality entities connect around work execution:

```text
Product
  -> BOM
  -> ProcessRoute

SalesOrder
  -> WorkOrder
    -> Operation
      -> Inspection
        -> Defect
          -> CAPA
```

Supply-chain data connects suppliers, inventory, warehouses, and shipments.
These tables are physical core tables, not low-code dynamic records.

## Sensor And Time-Series Data

`sensor_readings` is currently a normal relational table with timestamped rows.
The docs should not claim TimescaleDB manages this data unless a TimescaleDB
migration and deployment configuration are added.

If the project later adopts TimescaleDB, add an explicit migration plan for:

- hypertable creation;
- retention/compression policies;
- aggregation/materialized views;
- fallback behavior for SQLite/local demo runs.

## Platform Forms Model

The forms platform started with migration `0006_platform_forms.py` and now also
uses `0021_form_versions.py` and `0024_seed_application_assembly.py`.

Core principle: creating an application form is a metadata operation. It does
not create or alter a physical business table.

```text
Application
  -> ApplicationForm
    -> Form
      -> FormField
      -> FormLayout
      -> FormAction
      -> FormPermission
      -> FormVersion(snapshot)
      -> WorkflowBinding
      -> DynamicRecord(data, schema_version)

Application
  -> ApplicationMenuNode
```

Current behavior:

- Form fields define validation/UI metadata.
- Layouts define list/detail/edit presentation.
- Actions define create/edit/delete/export/submit-style buttons.
- Permissions define form/action-level access rules.
- Workflow bindings connect form actions to workflow definitions.
- Publishing creates immutable `form_versions.snapshot` records.
- Records are stored in `dynamic_records.data` as JSON/JSONB and carry
  `schema_version` so older records remain tied to the schema used at write
  time.

Application assembly is now seeded into `application_forms` and
`application_menu_nodes` for the default tenant. Frontend `/program/*` pages can
still own layout, but the application menus and form bindings are database
backed.

Future physical table generation should be treated as a separate, audited admin
operation with migrations, rollback, and data-migration rules.

## Model-Driven Platform Model

The older model-driven surface remains available through:

- `meta_models`
- `meta_fields`
- `meta_relations`
- `page_configs`
- `menu_items`
- `model_versions`

`/api/v1/model-driven` uses explicit table/column allowlists for dynamic CRUD.
Do not bypass those allowlists when adding new metadata-driven models.

## Tenant And SaaS Boundary Model

Recent SaaS hardening migrations added explicit tenant operations and tenant
scoping:

| Migration | Purpose |
| --- | --- |
| `0019_identity_access_center.py` | Session tracking, password history, OIDC state placeholders, login lock fields, richer role-permission fields. |
| `0020_tenant_onboarding.py` | Tenant domains, tenant invites, password reset tokens, tenant-scoped uniqueness for users/roles/apps/forms. |
| `0021_tenant_operations.py` | Invite revoke/resend replacement metadata. |
| `0022_business_tenant_isolation.py` | `tenant_id` columns, tenant-aware indexes, and tenant-scoped unique constraints for core business tables. |
| `0023_saas_hardening.py` | Tenant scope for notifications, rules, scheduled jobs, knowledge, AI runtime, plus tenant export records. |

The platform-admin tenant management surface is backed by:

```text
Tenant
  -> TenantDomain
  -> TenantInvite
  -> TenantExport

User
  -> UserSession
  -> PasswordHistory
  -> PasswordResetToken
```

Production code should treat `tenant_id` as part of every SaaS-facing data
contract. Adding a new durable table now requires an explicit tenant-scope
decision and an index strategy.

## Knowledge Base And AI Runtime Model

The knowledge base now has persistent document/chunk/ingestion/extraction/link
tables, while several UI-facing catalog concepts still use demo/static data for
MVP behavior.

Persistent knowledge tables:

| Table | Purpose |
| --- | --- |
| `knowledge_documents` | Uploaded or seeded document metadata and Markdown content. |
| `knowledge_chunks` | Source-linked retrieval chunks. |
| `knowledge_ingestion_jobs` | Ingestion status and normalized document pipeline state. |
| `knowledge_extraction_results` | AI/object extraction results for review and graph publishing. |
| `knowledge_object_links` | Reviewed links between knowledge artifacts and business objects. |

The knowledge Agent chat path now has runtime persistence through migration
`0015_ai_agent_runtime.py`, later tenant-scoped by `0023_saas_hardening.py`:

```text
AIConversation
  -> AIMessage
  -> AIAgentRun
    -> AIToolCall

AIConversation
  -> AIMemoryEntry
```

Current AI runtime table responsibilities:

| Table | Purpose |
| --- | --- |
| `ai_conversations` | User/page/document scoped active conversations. |
| `ai_messages` | User and assistant messages with evidence, model, usage, status, and error fields. |
| `ai_agent_runs` | Observable run records with input, answer, steps, evidence, actions, risk, and confirmation payload. |
| `ai_tool_calls` | Tool-call audit trail for a run, including tool/skill names, input/output, status, and duration. |
| `ai_memory_entries` | Conversation-scoped memory summaries and structured values. |

This runtime persistence is separate from any transient in-process state used
for fallback or draft behavior. Knowledge Agent APIs write database rows and are
tenant-scoped in the current schema.

Current API concepts:

- knowledge space;
- knowledge source;
- document;
- upload/ingestion job status;
- normalized Markdown;
- chunk;
- card;
- binding candidate;
- linked business object;
- related evidence;
- search result.
- knowledge Agent conversation;
- knowledge Agent message;
- AI run steps/tool calls/memory entries for knowledge chat.

Current retrieval method:

- scikit-learn `TfidfVectorizer`;
- cosine similarity;
- no external embedding model;
- no external vector database;
- upload/indexing has persistent metadata/chunks, but retrieval remains local
  TF-IDF/vector-shaped MVP rather than pgvector production search;
- knowledge and AI runtime records are tenant-scoped after `0023_saas_hardening.py`.

When pgvector or another vector store is added, document the exact table/index
shape and migration path here.

## Neo4j Graph Model

Neo4j is used for manufacturing relationship exploration. Graph definitions and
seed logic live in `backend/app/models/graph_models.py` and
`backend/app/services/graph_service.py`.

Typical graph concepts:

- physical hierarchy: factory, workshop, line, equipment, sensor;
- production relationships: line/product/work order;
- supply relationships: supplier/material;
- quality relationships: inspection, defect, CAPA;
- traceability and impact-analysis relationships.

Graph APIs should remain guarded:

- user-provided Cypher must be read-only;
- labels and templates should come from server-side allowlists;
- business writes should prefer service functions over arbitrary Cypher.

## Ontology Direction

The Palantir-inspired ontology direction is still important, but it should be
read as product/architecture direction unless backed by models and migrations.

Target concepts:

- business objects as first-class entities;
- object relationships as first-class queryable links;
- object actions tied to permissions and workflow;
- role-aware workbenches;
- AI assistance grounded in object context and knowledge evidence.

Current implementation partially supports this through:

- relational manufacturing entities;
- model-driven metadata;
- persisted applications, menus, forms, and dynamic records;
- workflow, rules, notification, and audit-log tables;
- Neo4j graph relationships;
- local knowledge/RAG evidence APIs.

## Documentation Rule

When updating data-model documentation:

1. Verify physical schema against `backend/app/models/relational.py`.
2. Verify migrations under `backend/alembic/versions`.
3. Verify graph concepts against `backend/app/models/graph_models.py`.
4. Mark unimplemented storage services as planned/reference design.
5. Do not document optional dependencies as active infrastructure.
