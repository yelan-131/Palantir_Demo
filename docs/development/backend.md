# Backend Development Guide

Last updated: 2026-05-25

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

## Mounted Routers

Routers are mounted in `app/main.py` under `/api/v1`:

| Prefix | Responsibility |
| --- | --- |
| `/auth` | login, logout, current user |
| `/admin` | users, roles, audit/admin surfaces, application admin router |
| `/workflow` | workflow definitions, instances, approvals, workflow notifications |
| `/applications` | application list/detail/menu runtime |
| `/forms` | platform forms, fields, layouts, actions, permissions, workflow bindings, dynamic records, app menu nodes |
| `/data-sources` | data-source CRUD, test, sync, status, preview |
| `/ontology` | ontology entities, relations, timeline |
| `/graph` | graph query, neighbors, path, subgraph, stats, impact, trace |
| `/pipelines` | pipelines and pipeline runs |
| `/semantic-assets` | semantic asset workbench APIs |
| `/knowledge` | local knowledge base and TF-IDF RAG MVP |
| `/analytics` | aggregate/time-series/distribution APIs |
| `/maintenance` | equipment health, predictions, maintenance work orders |
| `/quality` | SPC, defects, traceability, inspections, CAPA |
| `/supply-chain` | suppliers, inventory, shipments, risk, analytics |
| `/ai` | assistant chat/session/analyze APIs |
| `/dashboard` | overview, OEE, production, alerts |
| `/reports` | report definitions and snapshots |
| `/model-driven` | metadata-driven CRUD and pages |
| `/rules` | validation rules and triggers |
| `/notifications` | general notifications |
| `/templates` | template market |
| `/config` | config import/export |
| `/scheduler` | scheduled jobs |
| `/search` | global search |
| `/ai-builder` | AI-assisted model/page suggestions |

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

- Migration: `backend/alembic/versions/0006_platform_forms.py`.
- Models: `Form`, `ApplicationForm`, `ApplicationMenuNode`, `FormField`,
  `FormLayout`, `FormAction`, `FormPermission`, `DynamicRecord`,
  `WorkflowBinding`.
- API: `/api/v1/forms`.

Creating a form or field is metadata-only. Business records are stored in
`dynamic_records.data` as JSON/JSONB. Physical table generation is a future
admin-controlled capability, not current behavior.

## Knowledge Base MVP

`backend/app/api/knowledge.py` exposes:

- `GET /knowledge/sources`
- `GET /knowledge/spaces`
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

The current implementation uses in-code demo documents and scikit-learn
TF-IDF/cosine similarity. It also models spaces, knowledge cards, binding
candidates, upload simulation, ingestion-job status, document Markdown, and
OCR/publishing workflow metadata. It preserves a future RAG API shape but does
not yet use an embedding service, vector database, persisted upload pipeline,
or knowledge tables.

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
guardrails, rule engine behavior, scheduler behavior, and form persistence.
When changing an endpoint contract, update the relevant tests and
`docs/development/api-reference.md`.
