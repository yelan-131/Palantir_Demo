# Data Model And Ontology Notes

Last updated: 2026-05-25

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
| Reporting | `reports`, `report_snapshots` |
| Model-driven platform | `meta_models`, `meta_fields`, `meta_relations`, `page_configs`, `menu_items`, `model_versions` |
| Application platform | `applications`, `application_menus`, `application_roles` |
| Forms platform | `forms`, `application_forms`, `application_menu_nodes`, `form_fields`, `form_layouts`, `form_actions`, `form_permissions`, `dynamic_records`, `workflow_bindings` |
| Identity and permissions | `users`, `roles`, `user_roles`, `role_permissions` |
| Workflow and notifications | `workflow_defs`, `workflow_instances`, `workflow_approvals`, `notifications` |
| Rules and operations | `rules`, `audit_logs`, `scheduled_jobs` |

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

The forms platform is implemented through migration
`0006_platform_forms.py`.

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
      -> WorkflowBinding
      -> DynamicRecord(data)

Application
  -> ApplicationMenuNode
```

Current behavior:

- Form fields define validation/UI metadata.
- Layouts define list/detail/edit presentation.
- Actions define create/edit/delete/export/submit-style buttons.
- Permissions define form/action-level access rules.
- Workflow bindings connect form actions to workflow definitions.
- Records are stored in `dynamic_records.data` as JSON/JSONB.

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

## Knowledge Base Model

The current knowledge base does not have persistent knowledge tables. It is an
API MVP backed by in-code demo arrays in `backend/app/api/knowledge.py`.

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

Current retrieval method:

- scikit-learn `TfidfVectorizer`;
- cosine similarity;
- no external embedding model;
- no vector database;
- upload/indexing is currently a demo/API simulation, not durable storage.

When persistent knowledge storage is added, introduce explicit tables or a
document store and update this section.

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
