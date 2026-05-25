# Platform Database Landing Plan

Last updated: 2026-05-20

This document records the first database-backed implementation for the
application/form/menu platform layer. It intentionally separates low-code
metadata changes from physical database DDL.

## Core Principle

Creating an application, form, or field is a metadata operation by default.
It writes platform configuration tables and does not run `CREATE TABLE`,
`ALTER TABLE`, or `DROP COLUMN`.

Physical tables remain reserved for core manufacturing entities such as
`equipment`, `work_orders`, `inspections`, and `suppliers`. User-defined
forms store records in `dynamic_records.data` as JSON/JSONB until a future
admin-controlled physicalization flow is added.

## Tables

| Table | Purpose |
| --- | --- |
| `forms` | Low-code business object / form definition. |
| `application_forms` | Binds forms to applications. |
| `application_menu_nodes` | Application-specific menu tree. |
| `form_fields` | Form field metadata and UI configuration. |
| `form_layouts` | List/detail/edit layout configuration. |
| `form_actions` | Button/action configuration such as create, edit, delete, export, submit. |
| `form_permissions` | Form, action, and future field-level permission rules. |
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

Add field
  -> form_fields
  -> no physical ALTER TABLE

Configure page
  -> form_layouts
  -> form_actions
  -> form_permissions
  -> workflow_bindings

Assemble application
  -> application_forms
  -> application_menu_nodes

Enter business data
  -> dynamic_records.data JSONB
```

## API Surface

All endpoints are mounted under `/api/v1/forms`.

| Capability | Endpoints |
| --- | --- |
| Forms | `GET /`, `POST /`, `GET /{form_id}`, `PUT /{form_id}` |
| Application form bindings | `GET /applications/{application_id}/forms`, `PUT /applications/{application_id}/forms`, `DELETE /applications/{application_id}/forms/{form_id}` |
| Fields | `POST /{form_id}/fields`, `PUT /{form_id}/fields/{field_id}`, `DELETE /{form_id}/fields/{field_id}` |
| Layouts | `GET /{form_id}/layouts`, `PUT /{form_id}/layouts/{layout_type}` |
| Actions | `GET /{form_id}/actions`, `POST /{form_id}/actions`, `PUT /{form_id}/actions/{action_id}`, `DELETE /{form_id}/actions/{action_id}` |
| Permissions | `GET /{form_id}/permissions`, `POST /{form_id}/permissions`, `PUT /{form_id}/permissions/{permission_id}`, `DELETE /{form_id}/permissions/{permission_id}` |
| Workflow bindings | `GET /{form_id}/workflow-bindings`, `POST /{form_id}/workflow-bindings`, `PUT /{form_id}/workflow-bindings/{binding_id}`, `DELETE /{form_id}/workflow-bindings/{binding_id}` |
| Dynamic records | `GET /{form_id}/records`, `POST /{form_id}/records`, `PUT /{form_id}/records/{record_id}`, `DELETE /{form_id}/records/{record_id}` |
| Application menu nodes | `GET /applications/{application_id}/menu-nodes`, `POST /applications/{application_id}/menu-nodes`, `PUT /applications/{application_id}/menu-nodes/{node_id}`, `DELETE /applications/{application_id}/menu-nodes/{node_id}` |

## Migration

Schema migration: `backend/alembic/versions/0006_platform_forms.py`.

Expected rollout sequence:

```bash
cd backend
alembic upgrade head
```

The seed script should remain responsible for data only. It should not create
tables once the migration path is in use.

## Next Frontend Integration

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
by numeric id or form code, renders `form_fields`, and reads/writes records via
`dynamic_records`. Record listing supports `page`, `page_size`, and `search`;
record create/update validates known fields, required fields, primitive types,
and enum values before storing JSON.

The next implementation slice should wire the existing UI workflows to those
helpers:

1. Application management creates an app through the existing application API.
2. Form settings creates forms through `/api/v1/forms`.
3. Field designer writes to `/api/v1/forms/{form_id}/fields`.
4. Add advanced filter operators and database indexes for high-volume dynamic records.
