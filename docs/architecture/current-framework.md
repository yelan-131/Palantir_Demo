# Current Code Framework

Last updated: 2026-05-29

This document describes the current code framework at a practical level. For the broader system architecture, read [overview.md](overview.md).

## Current Product Shape

ManuFoundry is currently a manufacturing low-code analytics workbench:

- Users log in and enter the workspace at `/`.
- The top bar switches between business applications.
- The left side menu shows "Workspace + current application menu".
- Business pages are rendered through fixed modules, `/program/:programId`, or `/dynamic/:slug`.
- Generated `/program/*` pages keep their frontend layout definitions, but key production pages now load metrics and rows from `/api/v1/dashboard/programs/{program_id}` before falling back to local demo rows.
- System administration manages applications, menu assembly, forms, semantic assets, users, roles, permissions, and tenant administration.
- AI assistance is exposed through a floating widget rather than a normal side-menu page.

## Frontend Structure

```text
frontend/src/
  App.tsx                         # shell, routes, app switcher, menu, notifications, AI widget
  main.tsx                        # React entry
  index.css                       # global workbench styles
  services/api.ts                 # axios client and typed-ish API helpers
  stores/authStore.ts             # token/user store
  config/
    menus.ts                      # legacy/static menu config
    appAssemblyMenus.ts           # local fallback for application assembly menus
    readyPathSmoke.ts             # phase-1 route/menu metadata guard
  components/
    AiChatWidget/
    GlobalSearch/
    AccountMenu/
    ReportWidgets/
    FormWidgets/
  pages/
    Workspace/
    Dashboard/
    Maintenance/
    Quality/
    SupplyChain/
    DataSource/
    Ontology/
    GraphExplorer/
    Pipeline/
    ReportCenter/
    Workflow/
    RuleEngine/
    TemplateMarket/
    SystemAdmin/
    FormSettings/
    DynamicPage/
    AppPrograms/
```

## Backend Structure

```text
backend/app/
  main.py                         # FastAPI app and router mounting
  config.py                       # pydantic-settings configuration
  database.py                     # async DB engine, SQLite fallback, Neo4j driver
  api/
    auth.py
    admin.py
    platform.py
    tenant.py
    applications.py
    forms.py
    workflow.py
    data_sources.py
    ontology.py
    graph.py
    pipeline.py
    semantic_assets.py
    knowledge.py
    analytics.py
    maintenance.py
    quality.py
    supply_chain.py
    ai_assistant.py
    reports.py
    model_driven*.py
    rules.py
    notifications.py
    templates.py
    config_io.py
    release.py
    productization.py
    scheduler.py
    search.py
    ai_builder.py
  models/
    relational.py
    graph_models.py
  services/
  core/
```

## Low-Code Platform State

The forms/application/menu persistence layer is now partially implemented.

Already present:

- `/api/v1/applications`
- `/api/v1/admin/applications`
- `/api/v1/forms`
- migration `backend/alembic/versions/0006_platform_forms.py`
- migrations through `0024_seed_application_assembly.py`
- platform tables for forms, fields, layouts, actions, permissions, published versions, workflow bindings, dynamic records, application-form bindings, and application menu nodes

Current important rule:

Creating a form field is a metadata operation. It does not execute physical `ALTER TABLE` DDL. Dynamic business records are stored through `dynamic_records.data`.

Still mixed/fallback:

- Some frontend application assembly behavior can still fall back to local demo state when the API is unavailable or legacy identifiers are used.
- Some older model-driven pages still coexist with the newer forms platform.

## SaaS And Tenant State

Recent code moves the project closer to a SaaS-shaped demo:

- `tenant_id` is present on core manufacturing, platform, workflow, knowledge,
  notification, rules, scheduler, and AI runtime tables.
- `/api/v1/platform` exposes platform-admin tenant management, invites,
  password reset, and tenant export operations.
- `/api/v1/tenant/profile/public` exposes the current tenant's display profile
  for frontend branding and AI identity.
- `/api/v1/system/readiness` performs operational readiness checks beyond the
  simple `/health` process check.
- `/api/v1/release/current` returns release metadata from `release.json`.

## Data Categories

| Data category | Current status |
| --- | --- |
| Core manufacturing seed data | Loaded from `data/seed/*.json`; used by dashboard, quality, maintenance, supply chain, graph, etc. |
| Applications and admin APIs | Backend models/APIs exist. |
| Forms platform metadata | Database migration and `/api/v1/forms` API exist. |
| Form versions | Publishing creates `form_versions` snapshots; records carry `schema_version`. |
| Dynamic form records | Stored in JSON/JSONB through `dynamic_records`. |
| Graph data | Neo4j driver exists; graph features degrade when Neo4j is unavailable. |
| Knowledge base | `/api/v1/knowledge` has persistent documents/chunks/ingestion/extraction/link rows plus demo spaces/directories/cards and TF-IDF retrieval. |
| AI | Current assistant API is implemented directly with GLM-compatible defaults, skill/tool registry endpoints, conversation/memory APIs, confirmation-token scaffold, low-code planning tools, and persisted Agent runtime rows. |
| Tenant platform | `/api/v1/platform` manages tenants, domains, invites, password resets, exports, and usage summaries for platform admins. |
| Productization | `/api/v1/productization/readiness` exposes the current ready path and module maturity contract. |

## Documentation Notes

- Palantir-inspired documents are reference design and should not be interpreted as completed implementation.
- The codebase still has both model-driven and forms-platform concepts; documentation should be explicit about which surface is being discussed.
- The knowledge base now has persistent document/chunk/runtime tables, but it is
  still not connected to an external vector store.

## Where To Update Docs After Code Changes

| Code change | Update document |
| --- | --- |
| New or changed router | `docs/development/api-reference.md` |
| New route/page/menu behavior | `docs/development/frontend.md` and this file |
| New table/migration | `docs/architecture/platform-database.md` or `data-model.md` |
| Deployment change | `docs/operations/deployment.md` |
| Test coverage change | `docs/operations/testing.md` |
