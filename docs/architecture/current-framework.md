# Current Code Framework

Last updated: 2026-05-25

This document describes the current code framework at a practical level. For the broader system architecture, read [overview.md](overview.md).

## Current Product Shape

ManuFoundry is currently a manufacturing low-code analytics workbench:

- Users log in and enter the workspace at `/`.
- The top bar switches between business applications.
- The left side menu shows "Workspace + current application menu".
- Business pages are rendered through fixed modules, `/program/:programId`, or `/dynamic/:slug`.
- System administration manages applications, menu assembly, forms, semantic assets, users, roles, and permissions.
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
- platform tables for forms, fields, layouts, actions, permissions, workflow bindings, dynamic records, application-form bindings, and application menu nodes

Current important rule:

Creating a form field is a metadata operation. It does not execute physical `ALTER TABLE` DDL. Dynamic business records are stored through `dynamic_records.data`.

Still mixed/fallback:

- Some frontend application assembly behavior can still fall back to local demo state when the API is unavailable or legacy identifiers are used.
- Some older model-driven pages still coexist with the newer forms platform.

## Data Categories

| Data category | Current status |
| --- | --- |
| Core manufacturing seed data | Loaded from `data/seed/*.json`; used by dashboard, quality, maintenance, supply chain, graph, etc. |
| Applications and admin APIs | Backend models/APIs exist. |
| Forms platform metadata | Database migration and `/api/v1/forms` API exist. |
| Dynamic form records | Stored in JSON/JSONB through `dynamic_records`. |
| Graph data | Neo4j driver exists; graph features degrade when Neo4j is unavailable. |
| Knowledge base | `/api/v1/knowledge` exists as a static-document TF-IDF RAG MVP with spaces, cards, upload simulation, ingestion status, Markdown, binding candidates, and OCR workflow metadata. |
| AI | Current assistant API is implemented directly; external LLM orchestration is future/optional. |

## Documentation Notes

- Palantir-inspired documents are reference design and should not be interpreted as completed implementation.
- The codebase still has both model-driven and forms-platform concepts; documentation should be explicit about which surface is being discussed.
- The knowledge base is API-backed but not yet persistent or connected to an external vector store.

## Where To Update Docs After Code Changes

| Code change | Update document |
| --- | --- |
| New or changed router | `docs/development/api-reference.md` |
| New route/page/menu behavior | `docs/development/frontend.md` and this file |
| New table/migration | `docs/architecture/platform-database.md` or `data-model.md` |
| Deployment change | `docs/operations/deployment.md` |
| Test coverage change | `docs/operations/testing.md` |
