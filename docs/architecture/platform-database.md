# Platform Database Implementation

Last updated: 2026-10-26

This document describes current application/form/menu persistence and storage.
For service ownership, see [Low-Code Platform](low-code-platform.md).

## Core Principle

Configuration metadata and business records have distinct responsibilities.
Metadata lives in the platform tables; business records may use dynamic
JSON/JSONB storage or form-managed physical tables.

The current create-form HTTP path converts a `dynamic` request without a table
name into generated physical storage. AI form creation also uses physical
storage. Existing dynamic forms remain supported by the shared record service.

Creating a physical form and adding its fields can execute `CREATE TABLE` and
`ALTER TABLE`. Field archival changes metadata and does not drop a column.
Physical provisioning is centralized in `api/form_engine/physical.py` and reused
by UI/AI field operations through `services/form_fields.py`. Configuration writes
must not be described as universally metadata-only.

## Tables

| Table | Purpose |
| --- | --- |
| `forms` | Low-code business object / form definition. |
| `application_forms` | Binds forms to applications. |
| `application_menu_nodes` | Application-specific menu tree. |
| `form_fields` | Form field metadata and UI configuration. |
| `form_layouts` | List/detail/edit layout configuration. |
| `form_actions` | Button/action configuration such as create, edit, delete, export, submit. |
| `form_permissions` | Form/action permissions and field permission configuration. |
| `form_versions` | Published snapshots of definitions and configuration. |
| `dynamic_records` | User-defined form records stored as JSON/JSONB. |
| `workflow_bindings` | Connects a form action to a workflow definition. |

## Runtime Flow

```text
Create application
  -> applications

Create form under application
  -> forms
  -> application_forms
  -> default form_layouts
  -> default form_actions
  -> shared engine provisions a table for physical storage

Add field
  -> shared field service validates batch, names, types, and active field limit
  -> form_fields
  -> shared engine adds physical columns when applicable

Configure page
  -> form_layouts
  -> form_actions
  -> form_permissions
  -> workflow_bindings

Assemble application
  -> application_forms
  -> application_menu_nodes

Publish definition
  -> shared version service validates and saves form_versions

Enter business data
  -> shared record service checks actor, rules, and lifecycle
  -> dynamic_records.data JSONB or form-managed physical table
```

## API Surface

The form routes are mounted under `/api/v1/forms`, with application runtime
navigation under `/api/v1/applications`. For the endpoint contract reference,
see [API Reference](../development/api-reference.md). Storage adapters retain the
same record HTTP interface.

## Migration

Relevant migrations include `0006_platform_forms.py`, `0021_form_versions.py`,
`0029_form_physical_tables.py`, and `0035_form_code_sequences.py`. Alembic owns
platform schema evolution; the runtime engine provisions configured business
tables. Registry seed files are a separate concern from schema migrations.

Expected rollout sequence:

```bash
cd backend
alembic upgrade head
```

Seed scripts remain responsible for initial data. Do not duplicate form DDL
inside AI handlers; use the shared form engine.

## Frontend and Runtime Integration

The frontend service layer now exposes typed helpers in
`frontend/src/services/api.ts` for forms, fields, layouts, actions,
permissions, workflow bindings, dynamic records, and application menu nodes.
The form settings page can load a numeric database-backed `form_id` and falls
back to the existing local configuration when it is opened with legacy string
form identifiers. The application menu assembly page now treats
`application_menu_nodes` as the source of truth for loading, creating, editing,
deleting, and reordering menu nodes; local storage is only used as a legacy
fallback when the API cannot return data.
Runtime application menus (`GET /api/v1/applications/{application_id}/menus`)
also prefer `application_menu_nodes`; database-backed form menus route to
`/dynamic/{form_id}`. The dynamic page first attempts to load a platform form
by numeric id or form code and renders the runtime definition. Fields resolve
from the latest published snapshot when available, with metadata fallback for
unversioned forms. Record reads/writes go through `services/records.py` and the
selected adapter. The common boundary applies tenant/row/field authorization,
rules, encoding, and lifecycle protections for JSON and physical records.

## Remaining Boundaries

Application/menu and action/permission CRUD still include route-owned logic.
Further extraction should preserve their tenant and visibility checks. The
current field/version/layout/rule-preview refactor does not imply that every
configuration capability is already exposed as an AI tool.

New inspection tools are defined in both registry seeds and packaged fallback
assets. Existing persisted AI registries require an explicit registry update;
Alembic migration alone does not enable these tools.
