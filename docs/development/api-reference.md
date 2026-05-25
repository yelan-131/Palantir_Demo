# API Reference

Last updated: 2026-05-25

Source of truth: `backend/app/main.py` and `backend/app/api/*`.

## Base URLs

| Environment | Base URL |
| --- | --- |
| Local backend | `http://localhost:8000/api/v1` |
| Local frontend proxy | `http://localhost:3000/api/v1` |
| Production server | `http://111.229.172.100:8000/api/v1` |

System endpoints outside `/api/v1`:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/` | service metadata |
| `GET` | `/health` | health check |

## Authentication

The frontend stores the login token in `localStorage` under `mf_token` and sends it as:

```http
Authorization: Bearer <token>
```

Default token expiration is controlled by `ACCESS_TOKEN_EXPIRE_MINUTES`; the current code default is `480` minutes.

| Method | Path |
| --- | --- |
| `POST` | `/auth/login` |
| `POST` | `/auth/logout` |
| `GET` | `/auth/me` |

## Authorization

Current backend authorization boundaries:

| Surface | Access rule |
| --- | --- |
| `/admin/*` | admin-only through `require_admin` |
| `/applications` | returns only applications visible to the current user's roles |
| `/applications/{app_id}` | rejects inaccessible or unpublished apps for non-admin users |
| `/applications/{app_id}/menus` | rejects inaccessible apps |
| `/forms` runtime reads | returns/checks forms the current user can view |
| `/forms/{form_id}/records` | checks `view/create/edit/delete` form permissions |
| `/forms` configuration endpoints | admin-only |

Permission implementation notes are in
`docs/architecture/permission-system.md`.

## Mounted API Modules

| Module | Prefix | Main endpoints |
| --- | --- | --- |
| Auth | `/auth` | `/login`, `/logout`, `/me` |
| Admin | `/admin` | `/users`, `/org-units`, `/roles`, `/audit-logs`, `/applications` |
| Workflow | `/workflow` | `/definitions`, `/instances`, `/instances/{inst_id}/act`, `/instances/{inst_id}/cancel`, `/notifications`, `/stats` |
| Applications | `/applications` | `/`, `/{app_id}`, `/{app_id}/menus` |
| Forms | `/forms` | `/`, `/{form_id}`, `/{form_id}/fields`, `/{form_id}/layouts`, `/{form_id}/actions`, `/{form_id}/permissions`, `/{form_id}/workflow-bindings`, `/{form_id}/records`, `/applications/{application_id}/forms`, `/applications/{application_id}/menu-nodes` |
| Data sources | `/data-sources` | `/`, `/{source_id}`, `/{source_id}/test`, `/{source_id}/sync`, `/{source_id}/status`, `/{source_id}/preview` |
| Ontology | `/ontology` | `/entities`, `/entities/{entity_type}`, `/entities/{entity_type}/instances`, `/entities/{entity_type}/instances/{entity_id}/relationships`, `/relations`, `/timeline/{entity_id}` |
| Graph | `/graph` | `/query`, `/neighbors/{entity_id}`, `/path`, `/subgraph/{entity_id}`, `/stats`, `/sync/quality-demo`, `/impact-analysis-by-object`, `/entity/{label}/{entity_id}`, `/entity/{label}/{entity_id}/relationships`, `/impact-analysis/{entity_id}`, `/trace/{entity_id}`, `/analytics/centrality` |
| Pipelines | `/pipelines` | `/`, `/{pipeline_id}`, `/{pipeline_id}/run`, `/{pipeline_id}/runs` |
| Semantic assets | `/semantic-assets` | `/data-assets`, `/ontology-objects`, `/ontology-relations`, `/page-contracts`, `/page-contracts/by-route` |
| Knowledge base | `/knowledge` | `/sources`, `/spaces`, `/documents`, `/assets/upload`, `/ingestion-jobs/{job_id}`, `/documents/{document_id}`, `/documents/{document_id}/markdown`, `/documents/{document_id}/chunks`, `/cards`, `/cards/{card_id}`, `/related-cards`, `/binding-candidates`, `/ocr-pipeline`, `/related`, `/search` |
| Analytics | `/analytics` | `/overview`, `/aggregate`, `/timeseries`, `/distribution` |
| Maintenance | `/maintenance` | `/equipment-health`, `/equipment/{equipment_id}/health`, `/predictions`, `/work-orders` |
| Quality | `/quality` | `/spc/{parameter}`, `/defects`, `/defects/pareto`, `/traceability/{entity_id}`, `/inspections`, `/events`, `/events/{event_id}/impact`, `/events/{event_id}/ai-suggestion`, `/events/{event_id}/actions`, `/capa` |
| Supply chain | `/supply-chain` | `/suppliers`, `/inventory`, `/shipments`, `/risk-assessment`, `/analytics` |
| AI assistant | `/ai` | `/chat`, `/agent`, `/drafts/save`, `/provider/test`, `/settings`, `/settings/test`, `/audit`, `/sessions`, `/analyze` |
| Dashboard | `/dashboard` | `/overview`, `/oee`, `/production`, `/alerts` |
| Reports | `/reports` | `/`, `/{report_id}`, `/{report_id}/snapshot`, `/{report_id}/snapshots` |
| Model-driven | `/model-driven` | `/models`, `/models/{model_id}/fields`, `/models/import-from-ontology`, `/models/{model_id}/versions`, `/models/{model_id}/publish`, `/models/{model_id}/impact`, `/pages`, `/pages/generate`, `/data/{model_name}`, `/data/{model_name}/options`, `/data/{model_name}/{record_id}/children/{child_table}`, `/menus` |
| Rules | `/rules` | `/`, `/{rule_id}`, `/validate`, `/triggers`, `/evaluate-triggers` |
| Notifications | `/notifications` | `/`, `/{notification_id}/read`, `/read-all`, `/unread-count` |
| Templates | `/templates` | `/`, `/{template_id}`, `/{template_id}/instantiate` |
| Config | `/config` | `/export`, `/export/{model_name}`, `/import` |
| Scheduler | `/scheduler` | `/jobs`, `/jobs/{job_id}`, `/jobs/{job_id}/trigger` |
| Search | `/search` | `/` |
| AI builder | `/ai-builder` | `/suggest-model`, `/suggest-page` |

## Important Corrections From Older Docs

- Use `/api/v1/data-sources`, not `/api/v1/datasources`.
- Use `/api/v1/dashboard/*` for dashboard data, not `/api/v1/operations/*`.
- Workflow notifications exist under `/api/v1/workflow/notifications`; there is also a newer general notification module under `/api/v1/notifications`.
- Reports routes are mounted under `/api/v1/reports`; the router uses both `/` and `/{report_id}` paths.
- The AI assistant route is `/api/v1/ai`; the visible UI entry is the floating AI widget, while `/ai-assistant` redirects to `/`.

## Example Requests

Login:

```bash
curl -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"admin\",\"password\":\"admin123\"}"
```

List data sources:

```bash
curl http://localhost:8000/api/v1/data-sources \
  -H "Authorization: Bearer <token>"
```

Get dashboard overview:

```bash
curl http://localhost:8000/api/v1/dashboard/overview \
  -H "Authorization: Bearer <token>"
```

Send AI chat message:

```bash
curl -X POST http://localhost:8000/api/v1/ai/chat \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d "{\"message\":\"Summarize current equipment risk\"}"
```

Create a low-code form:

```bash
curl -X POST http://localhost:8000/api/v1/forms \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Service Ticket\",\"code\":\"service_ticket\",\"application_id\":1}"
```

This is an admin-only configuration API.

Add a form field:

```bash
curl -X POST http://localhost:8000/api/v1/forms/1/fields \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d "{\"field_name\":\"customer_name\",\"label\":\"Customer Name\",\"field_type\":\"string\",\"required\":true}"
```

This is an admin-only configuration API.

Create a dynamic record:

```bash
curl -X POST http://localhost:8000/api/v1/forms/1/records \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d "{\"data\":{\"customer_name\":\"Acme\",\"priority\":\"high\"}}"
```

The caller must have `create` permission for the form.

List dynamic records with pagination and text search:

```bash
curl "http://localhost:8000/api/v1/forms/1/records?page=1&page_size=20&search=Acme" \
  -H "Authorization: Bearer <token>"
```

The caller must have `view` permission for the form.

Search local knowledge base:

```bash
curl -X POST http://localhost:8000/api/v1/knowledge/search \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d "{\"query\":\"焊点虚焊如何处置\",\"limit\":3}"
```

Knowledge API note: the current backend uses static demo sources/documents and
local TF-IDF retrieval. It also exposes knowledge spaces, cards, upload
simulation, ingestion-job status, document detail/Markdown, binding candidate
suggestions, and an OCR pipeline description for the current knowledge-center
workflow. It is a runnable RAG-shaped MVP, not a persistent vector database
integration.

## Frontend API Client

The frontend uses `frontend/src/services/api.ts`.

- Default base URL: `/api/v1`
- Override: `VITE_API_BASE_URL`
- Development proxy target: `VITE_API_PROXY_TARGET`, defaulting to `http://localhost:8000`

## Maintenance Rule

When adding or changing an endpoint:

1. Update the FastAPI router.
2. Update `frontend/src/services/api.ts` if the frontend calls it.
3. Update this document.
4. Add or update backend tests when behavior changes.
