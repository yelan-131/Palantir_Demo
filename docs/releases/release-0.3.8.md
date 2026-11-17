# ManuFoundry 0.3.8 Release Notes

Release date: 2026-06-12

## Theme

0.3.8 strengthens the Agent runtime and the low-code platform substrate. The
release focuses on a structured Agent items/tool-use protocol, runtime
configuration, confirmation and budget governance, physical form tables, data
quality rules, Agent registry data, code sequences, and ontology mapping
layouts.

## Highlights

- AI Agent now has a broader items protocol, tool-use loop, tool envelopes,
  events, hooks, context layers, compaction, budget checks, and tool result
  processing.
- Runtime configuration, production error handling, permission resolving,
  tenant context, and confirmation storage make Agent write paths easier to
  audit and test.
- Low-code forms add physical table support, code sequences, platform seed
  configuration, and a clearer `form_engine` API boundary.
- Data quality rules and ontology mapping layouts extend semantic governance
  beyond object/relation persistence.
- AI Agent registry tables and `data/agent_registry` provide versioned sources
  for skills, tools, hooks, and tenant policies.
- Frontend updates cover AI workspace, form designer, semantic asset center,
  workflow, account center, shared styling, and Taobao prototype pages.

## Changes

- Added migrations `0029_form_physical_tables.py`,
  `0030_seed_platform_config.py`, `0031_role_is_active.py`,
  `0032_data_quality_rules.py`, `0033_ai_agent_items_protocol.py`,
  `0034_ai_agent_registry_tables.py`, `0035_form_code_sequences.py`, and
  `0036_ontology_mapping_layouts.py`.
- Added Agent services for items, tool envelopes, tool loading, tool handlers,
  tool-use loops, tool result processing, events, hooks, budgets, compaction,
  context layers, permission resolution, tenant context, and confirmation
  storage.
- Added `form_engine` API modules plus runtime configuration, production error
  helpers, semantic mapping service, and ontology AI candidate service.
- Expanded AI Assistant, knowledge, semantic assets, graph, forms, workflow,
  applications, auth, and administration APIs for the new runtime and
  governance paths.
- Updated backend tests around Agent tool-use, context layers, hooks, budgets,
  confirmation storage, permission resolving, runtime config, tool loading, and
  tool result processing.
- Refreshed frontend pages for App Programs, Dynamic Page, Form Settings,
  Semantic Asset Center, Workflow, Account Center, Login, shared styling, and
  Taobao prototype flows.
- Updated demo knowledge assets and cleaned root-level OGSM generated artifacts
  from the tracked release surface.
- Synced release metadata across `release.json`, `backend/release.json`,
  backend `APP_VERSION`, frontend package metadata, README, and the
  documentation index.

## Operational Notes

- Production databases must run Alembic through
  `0036_ontology_mapping_layouts.py` before the new Agent registry, physical
  form table, data quality, code sequence, and mapping layout capabilities are
  used.
- The production compose overlay must pass `DATABASE_BACKEND=postgresql`; this
  is required for readiness to report a production-ready database mode.
- The new Agent registry data under `data/agent_registry` should be deployed
  with the application code so runtime skill/tool metadata stays in sync.

## Verification Targets

- Frontend production build completes.
- Backend Agent, knowledge, low-code, tenant, workflow, runtime config, and
  tool-use focused tests pass.
- Server rebuilds backend and frontend containers successfully.
- Alembic reports migration head `0036_ontology_mapping_layouts`.
- Public frontend responds on `http://111.229.172.100`.
- Public `/api/v1/release/current` reports version `0.3.8`.
- Public `/api/v1/system/readiness` reports `ready`.
