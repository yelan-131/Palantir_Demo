# Testing

Last updated: 2026-05-26

This document describes the current verification strategy and known test coverage.

## 1. Commands

Backend:

```bash
cd backend
python -m pytest
```

Useful focused runs:

```bash
python -m pytest tests/test_security.py
python -m pytest tests/test_forms_platform.py
python -m pytest tests/test_workflow.py
python -m pytest tests/test_ai_knowledge_api.py tests/test_ai_agent_services.py
python -m pytest -k "rules"
python -m pytest -k "graph"
```

Frontend:

```bash
cd frontend
npm run type-check
npm run build
```

There is currently no dedicated frontend unit-test runner configured. Frontend verification is type-check plus production build.

## 2. Backend Test Coverage Map

Current backend tests are under `backend/tests`.

| Test file | Main coverage |
| --- | --- |
| `test_security.py` | JWT encode/decode, invalid/tampered tokens, password hash behavior |
| `test_graph_cypher_safety.py` | read-only Cypher guardrails and template whitelist consistency |
| `test_model_driven_safety.py` | safe identifiers, model-driven table resolution, injection rejection |
| `test_logging_setup.py` | logging setup idempotency and namespace behavior |
| `test_audit.py` | seed conversion helpers, insert SQL generation, audit logging |
| `test_config_io.py` | configuration export/import, merge/replace behavior, single model export |
| `test_forms_platform.py` | forms metadata rules, field validation, dynamic record schema, application-form config |
| `test_notifications.py` | notification list/create/read/read-all/unread/delete/helper behavior |
| `test_phase4_small.py` | scheduler jobs, search, AI builder suggestions |
| `test_rules.py` | rule CRUD and rule validation |
| `test_rules_trigger.py` | trigger condition evaluation, interpolation, action execution fallback, trigger endpoints |
| `test_templates.py` | template list/detail/instantiate and template schema checks |
| `test_version.py` | model versioning, publish behavior, impact analysis |
| `test_workflow.py` | workflow definition CRUD, instance lifecycle, approvals/rejections, notifications, stats |
| `test_ai_agent_services.py` | provider config defaults, policy decisions, Agent response shape, confirmation/audit helpers |
| `test_ai_knowledge_api.py` | knowledge APIs, extraction flow, and persisted knowledge Agent conversation/runtime records |
| `test_productization_boundaries.py` | readiness contract and production rule fallback boundary |
| `test_ready_path_smoke.py` | first SaaS ready path smoke and production-mode guardrails |

## 3. What Tests Protect

High-risk areas currently covered:

- Auth token safety.
- Cypher injection prevention.
- Model-driven identifier safety.
- Rule validation and trigger evaluation.
- Workflow lifecycle behavior.
- Notifications.
- Forms platform metadata and dynamic record validation.
- Config import/export.
- Scheduler/search/AI builder small module behavior.
- Knowledge Agent persistence for conversations, messages, runs, tool calls, memory, and audit rows.
- Productization readiness endpoint and production-mode fallback guards.

## 4. Known Gaps

| Gap | Notes |
| --- | --- |
| Frontend unit/component tests | No Vitest/React Testing Library setup yet. |
| Browser E2E | No Playwright flow yet; the backend ready-path smoke now covers the first SaaS flow contract. |
| Full DB integration tests | Many tests are function/router-level; production PostgreSQL + Neo4j integration coverage is limited. |
| Docker smoke tests | Compose config is validated manually, but no automated container smoke pipeline is documented. |
| Performance tests | No benchmark for graph queries, dynamic record filtering, or report rendering. |
| Frontend ready-path test runner | `readyPathSmoke.ts` fails at import time if metadata is wrong, but there is no dedicated frontend test command that imports it yet. |

## 5. Recommended Test Additions

Priority order:

1. Keep the ready-path smoke green: login -> application -> form -> dynamic record -> workflow -> report -> audit.
2. Expand knowledge API tests for directory CRUD/move behavior and frontend-facing edge cases.
3. Add Playwright E2E for login -> workspace -> app switch -> dynamic form open.
4. Add Docker Compose smoke verification for production overlay.
5. Add performance checks for graph queries, dynamic record filtering, and report rendering.

## 6. Test Writing Rules

- Keep tests close to the behavior being protected.
- Prefer unit tests for pure validation and guardrail logic.
- Use integration tests for route/database contracts that can break across modules.
- Do not rely on external network services.
- Keep AI behavior deterministic unless an external LLM integration is explicitly mocked.

## 7. CI Baseline

Minimum CI should run:

```bash
cd backend
python -m pytest

cd ../frontend
npm run type-check
npm run build
```

Production-readiness focused runs:

```bash
cd backend
python -m pytest tests/test_ready_path_smoke.py tests/test_productization_boundaries.py

cd ../frontend
npm run type-check
```
