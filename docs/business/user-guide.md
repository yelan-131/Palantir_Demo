# User Guide And Demo Walkthrough

Last updated: 2026-05-25

This guide reflects the current application shell and implemented product
surfaces. Palantir-inspired future ideas live in `docs/architecture/*` reference
documents.

## What The Product Does Today

ManuFoundry is a manufacturing operations platform with:

- Workspace and operational dashboard.
- Data-source, ontology, graph, pipeline, and semantic asset workbenches.
- Predictive maintenance, quality, supply-chain, and report pages.
- Application/program assembly and database-backed low-code forms.
- Workflow, rules, notifications, global search, and a floating AI assistant.
- A local knowledge base/RAG MVP for SOP, CAPA, supplier report, and equipment
  log evidence.

## Login And Navigation

1. Open the frontend.
2. Log in through `/login`.
3. The default authenticated page is the workspace at `/`.
4. Use the left navigation for business modules.
5. Use the top application switcher to move between configured applications.
6. Use global search for cross-module lookup.
7. Use the notification entry for pending messages and workflow items.
8. Use the floating AI assistant for operational questions and summaries.

## Main Modules

| Module | What to demonstrate |
| --- | --- |
| Workspace | Role-oriented entry, active applications, quick operational context |
| Dashboard | OEE, production, alert, and overview metrics |
| Data Sources | Source list, source detail, test/sync/status/preview flows |
| Ontology | Business object and relationship definitions |
| Graph | Graph exploration, path, impact, and traceability views |
| Pipeline | Pipeline list, manual run, run history |
| Maintenance | Equipment health, predictions, maintenance work orders |
| Quality | SPC, defects, Pareto, inspections, CAPA, traceability |
| Supply Chain | Suppliers, inventory, shipments, risk assessment |
| Reports | Report definitions and snapshots |
| Workflow | Workflow definitions, instances, approvals, stats |
| Rules | Validation rules, triggers, trigger evaluation |
| Templates | Template market and instantiation |
| System Admin | Users, roles, semantic assets, knowledge center, platform operations |

## Low-Code Application And Form Flow

The current low-code platform is database-backed.

Demo path:

1. Enter application/program management with `/program/:programId`.
2. Create or manage application menu nodes.
3. Open `/form-settings/:formId` for a platform form.
4. Configure fields, layouts, actions, permissions, and workflow bindings.
5. Open the runtime page under `/dynamic/:slug`.
6. Create, edit, search, and delete dynamic records.

Important behavior:

- Form configuration is stored as metadata.
- Records are stored in `dynamic_records.data`.
- Creating a field does not create or alter a physical database table.
- Application menus prefer backend `application_menu_nodes`; local fallback only
  exists for older demo data or unavailable APIs.

## Knowledge Base And AI Demo

The knowledge center is available from the semantic/system administration
surface. It currently demonstrates local RAG behavior:

- Browse knowledge sources.
- Browse documents and chunks.
- Inspect linked business objects.
- Run a retrieval test through `/api/v1/knowledge/search`.
- Use quality impact workflows to show evidence cards from SOP/CAPA/supplier
  reports/equipment logs.

Current boundary: the knowledge base uses static demo documents, upload
simulation, Markdown/card metadata, and local TF-IDF retrieval. It is not yet a
persistent document management system or external vector-store integration.

## Recommended Demo Scenarios

### 1. Quality Exception With Evidence

1. Open Quality.
2. Review defects, SPC, or traceability.
3. Use related knowledge evidence to cite SOP, historical CAPA, supplier 8D, or
   equipment log context.
4. Create or discuss a CAPA/workflow follow-up.

### 2. Equipment Risk To Maintenance Action

1. Open Dashboard for alert context.
2. Switch to Maintenance.
3. Review equipment health and predictions.
4. Open graph or traceability views to explain affected lines/orders.
5. Create or review maintenance work-order data.

### 3. Supplier Risk To Production Impact

1. Open Supply Chain.
2. Review supplier, inventory, shipment, and risk data.
3. Use Graph to trace supplier/material/product/order relationships.
4. Use AI assistant for a short risk summary.

### 4. Low-Code Form Build

1. Create or select an application.
2. Create a form and attach it to the application menu.
3. Add fields and configure list/detail/edit layouts.
4. Open the runtime dynamic page.
5. Enter test records and verify search/pagination.

## Current Product Boundaries

- ERP, IoT, PLC, WMS, and SCADA sources appear in demo/mock data, but only the
  MES simulator connector has a concrete connector module today.
- Knowledge/RAG is local MVP retrieval, not external LLM/vector infrastructure.
- Celery, Prophet, LangChain, Prometheus, Grafana, and TimescaleDB are not
  active runtime services in the current codebase.
- Some routers intentionally fall back to mock data when the database is
  unavailable so demos remain usable.
