# Backend Development Guide

Last updated: 2026-05-29

Source of truth: `backend/app/main.py`, `backend/app/api/*`,
`backend/app/models/*`, `backend/alembic/versions/*`, and
`backend/requirements.txt`.

## Stack

| Area | Current code |
| --- | --- |
| Web framework | FastAPI 0.115, Uvicorn 0.34 |
| ORM and migrations | SQLAlchemy 2 async, Alembic |
| Database drivers | asyncpg, psycopg2, aiosqlite |
| Graph database | Neo4j async driver |
| Cache/task dependency | Redis client is installed; no Celery worker is active |
| Auth | python-jose JWT, passlib bcrypt |
| Analytics/RAG support | pandas, numpy, scipy, scikit-learn |

`prophet`, `celery`, `langchain`, and `langchain-openai` are currently
commented optional dependencies in `requirements.txt`. Do not document them as
active runtime services unless the code is wired and deployed.

## Run Locally

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Useful endpoints:

| Path | Purpose |
| --- | --- |
| `/` | Service metadata |
| `/health` | Health check |
| `/api/v1/system/readiness` | database/migration/storage/SMTP/production-config readiness |
| `/api/v1/system/metrics` | in-process request counters and route latency snapshot |
| `/docs` | OpenAPI UI |

## Configuration

Configuration lives in `app/config.py`.

Important variables:

| Variable | Current meaning |
| --- | --- |
| `SECRET_KEY` | JWT signing key; must be changed in production |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | token lifetime; default is `480` |
| `DEMO_AUTH_OPTIONAL` | allows guest fallback when true; production should set false |
| `CORS_ORIGINS` | explicit frontend origins |
| `POSTGRES_*` | relational database connection |
| `NEO4J_*` | graph database connection |
| `REDIS_*` | Redis connection parameters |
| `LOG_LEVEL` | application logging level |
| `APP_MODE` | `demo` or `production`; production rejects unsafe fallbacks |
| `AI_PROVIDER` / `AI_BASE_URL` / `AI_*_MODEL` | backend AI provider defaults; current defaults target GLM-compatible APIs |

## Mounted Routers

Routers are mounted in `app/main.py` under `/api/v1`:

| Prefix | Responsibility |
| --- | --- |
| `/auth` | login, logout, current user |
| `/admin` | users, roles, audit/admin surfaces, application admin router |
| `/platform` | platform-admin tenant management, invites, password reset, tenant export |
| `/tenant` | current tenant public profile |
| `/workflow` | workflow definitions, instances, approvals, workflow notifications |
| `/applications` | application list/detail/menu runtime |
| `/forms` | platform forms, fields, layouts, actions, permissions, workflow bindings, dynamic records, app menu nodes |
| `/data-sources` | data-source CRUD, test, sync, status, preview |
| `/ontology` | ontology entities, relations, timeline |
| `/graph` | graph query, neighbors, path, subgraph, stats, impact, trace |
| `/pipelines` | pipelines and pipeline runs |
| `/semantic-assets` | semantic asset workbench APIs |
| `/knowledge` | local knowledge base, TF-IDF RAG MVP, directory demo APIs, and persisted knowledge Agent conversations |
| `/analytics` | aggregate/time-series/distribution APIs |
| `/maintenance` | equipment health, predictions, maintenance work orders |
| `/quality` | SPC, defects, traceability, inspections, CAPA |
| `/supply-chain` | suppliers, inventory, shipments, risk, analytics |
| `/ai` | assistant chat/session/analyze APIs, skill/tool registries, observable agent runs, confirmations, audit |
| `/dashboard` | overview, OEE, production, alerts |
| `/reports` | report definitions and snapshots |
| `/model-driven` | metadata-driven CRUD and pages |
| `/rules` | validation rules and triggers |
| `/notifications` | general notifications |
| `/templates` | template market |
| `/config` | config import/export |
| `/release` | release metadata |
| `/scheduler` | scheduled jobs |
| `/search` | global search |
| `/ai-builder` | AI-assisted model/page suggestions |
| `/productization` | first SaaS ready-path and module maturity contract |

## Database And Fallbacks

The backend uses async SQLAlchemy sessions. Some demo-facing routers use
`app.core.db.safe_db_call` so the UI can keep working with mock data when the
database is unavailable. Interfaces that must fail loudly should use normal
session dependencies or `db_session()` and return proper errors.

Rules:

- Keep relational schema changes in Alembic migrations.
- Keep demo seed data separate from migrations.
- Prefer ORM/query builders over raw SQL.
- For dynamic identifiers, use explicit allowlists.
- Do not add physical tables for every low-code form by default.

## Platform Forms

The low-code layer is implemented and persisted:

- Migration lineage: `0006_platform_forms.py`, `0021_form_versions.py`, and
  `0024_seed_application_assembly.py`.
- Models: `Form`, `ApplicationForm`, `ApplicationMenuNode`, `FormField`,
  `FormLayout`, `FormAction`, `FormPermission`, `DynamicRecord`,
  `FormVersion`, `WorkflowBinding`.
- API: `/api/v1/forms`.

Creating a form or field is metadata-only. Business records are stored in
`dynamic_records.data` as JSON/JSONB. Published forms create immutable
`form_versions.snapshot` records, and dynamic records carry `schema_version`.
Physical table generation is a future admin-controlled capability, not current
behavior.

## Tenant Platform

The SaaS-facing tenant layer is implemented through:

- `backend/app/api/platform.py` for platform-admin operations;
- `backend/app/api/tenant.py` for current-tenant public profile;
- `backend/app/services/tenant_onboarding.py` and `backend/app/services/iam.py`;
- migrations `0019_identity_access_center.py` through `0023_saas_hardening.py`.

Important rules:

- Platform admin operations require a normal admin user in tenant `1`.
- Tenant domains and tenant-scoped uniqueness prevent cross-tenant collisions.
- Tenant exports redact password/token/secret/SMTP/API-key-like fields.
- New durable SaaS-facing tables should define tenant scope explicitly.

## Knowledge Base MVP

`backend/app/api/knowledge.py` exposes:

- `GET /knowledge/sources`
- `GET /knowledge/spaces`
- `GET/POST/PUT /knowledge/directories`
- `GET /knowledge/documents`
- `POST /knowledge/assets/upload`
- `GET /knowledge/ingestion-jobs/{job_id}`
- `GET /knowledge/documents/{document_id}`
- `GET /knowledge/documents/{document_id}/markdown`
- `GET /knowledge/documents/{document_id}/chunks`
- `GET /knowledge/cards`
- `GET /knowledge/cards/{card_id}`
- `GET /knowledge/related-cards`
- `POST /knowledge/binding-candidates`
- `GET /knowledge/ocr-pipeline`
- `GET /knowledge/related`
- `POST /knowledge/search`
- `POST /knowledge/agent/conversations`
- `GET /knowledge/agent/conversations`
- `GET /knowledge/agent/conversations/{conversation_id}/messages`
- `POST /knowledge/agent/conversations/{conversation_id}/messages`

The current implementation uses persistent document/chunk/ingestion/extraction
rows plus in-code/demo catalog concepts where the MVP still needs them. Search
uses scikit-learn TF-IDF/cosine similarity rather than an external vector
database.

The knowledge Agent conversation APIs persist conversation, message, run,
tool-call, and memory rows through the AI runtime tables introduced by
`0015_ai_agent_runtime.py`. This persistence is for chat/runtime observability;
knowledge document/chunk/ingestion rows are also persisted by the current MVP.
The remaining production gap is external embedding generation, vector search,
and a hardened ingestion worker rather than relational knowledge storage itself.

## AI Runtime

The AI assistant currently has two related surfaces:

| Surface | Current behavior |
| --- | --- |
| `/api/v1/ai` | General assistant, provider settings, skill/tool registry, in-memory agent-run scaffold, confirmation tokens, and AI audit list. |
| `/api/v1/knowledge/agent/*` | Knowledge-center conversations persisted in relational AI runtime tables. |

The default provider settings now point at GLM-compatible model names
(`glm-4-flash`, `glm-4-plus`, `embedding-3`, `glm-4v-plus`). Keep secrets in
environment variables or a backend-managed secret store; do not commit API keys.

State-changing AI actions must keep this order:

```text
permission decision -> skill/tool allowlist -> dry-run/draft -> confirmation token -> audit -> durable write
```

The AI layer now also includes deterministic low-code planning and execution
helpers in `backend/app/services/ai/planner.py` and
`backend/app/services/ai/low_code_tools.py`. Low-code writes must stay
admin-only, tenant-scoped, audit logged, and confirmation gated.

## Productization Boundary

`/api/v1/productization/readiness` exposes the first SaaS ready path and module
maturity map. Tests use this endpoint as a contract, so update it together with
`docs/architecture/saas-productization-phase-1.md` when phase-1 scope changes.

In production mode:

- `DEMO_AUTH_OPTIONAL` must be `false`;
- SQLite fallback is rejected;
- rules must not silently fall back to mock rules;
- unindexed dynamic-record search fails instead of scanning arbitrary JSON.
- `/api/v1/system/readiness` should be used with release and productization
  checks before treating a deployment as ready.

## Security Conventions

- JWTs are passed as Bearer tokens.
- `SECRET_KEY`, CORS, and `DEMO_AUTH_OPTIONAL` must be production-hardened.
- Use `require_admin` for admin/configuration-only APIs.
- Use `app.core.permissions.has_permission` or `require_permission` for generic
  resource/action authorization.
- Use `app.core.permissions.has_form_permission` for platform form runtime
  record access.
- Frontend menu or button visibility is never the final security boundary.
- SQL values must be parameterized.
- Model-driven table/column names must pass allowlists and identifier checks.
- Graph free-query endpoints must remain read-only and use Cypher guardrails.
- Do not log secrets, tokens, or connection strings.

## Permission Enforcement

Current implementation details are documented in
`docs/architecture/permission-system.md`.

Backend permission boundaries currently include:

| Surface | Current enforcement |
| --- | --- |
| `/api/v1/admin/*` | `require_admin` |
| `/api/v1/applications` | application list filtered by current user roles |
| `/api/v1/applications/{app_id}` | rejects inaccessible apps |
| `/api/v1/applications/{app_id}/menus` | rejects inaccessible apps |
| Platform form configuration APIs | `require_admin` |
| Platform form runtime records | `view/create/edit/delete` form permission checks |
| `/api/v1/platform/*` | platform admin plus tenant `1` guard |
| Low-code AI writes | admin-only, tenant-scoped, confirmation/audit path |

When adding a new route, decide explicitly whether it is:

```text
public health/info
authenticated runtime
generic RBAC protected
form permission protected
admin-only configuration
```

Do not add a state-changing endpoint with only `get_current_user` unless every
authenticated user is intentionally allowed to perform that action.

## Tests

Run backend tests with:

```bash
cd backend
python -m pytest
```

Current focused tests cover API behavior, model-driven safety, graph Cypher
guardrails, rule engine behavior, scheduler behavior, form persistence, tenant
onboarding, SaaS hardening, business tenant isolation, dashboard program data,
and low-code AI agent tools.
When changing an endpoint contract, update the relevant tests and
`docs/development/api-reference.md`.
