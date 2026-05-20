# API Reference

Last updated: 2026-05-20

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

## Mounted API Modules

| Module | Prefix | Main endpoints |
| --- | --- | --- |
| Auth | `/auth` | `/login`, `/logout`, `/me` |
| Admin | `/admin` | `/users`, `/roles`, `/audit-logs`, `/applications` |
| Workflow | `/workflow` | `/definitions`, `/instances`, `/notifications`, `/stats` |
| Applications | `/applications` | `/`, `/{app_id}`, `/{app_id}/menus` |
| Forms | `/forms` | `/`, `/{form_id}`, `/{form_id}/fields`, `/{form_id}/layouts`, `/{form_id}/actions`, `/{form_id}/permissions`, `/{form_id}/workflow-bindings`, `/{form_id}/records`, `/applications/{application_id}/forms`, `/applications/{application_id}/menu-nodes` |
| Data sources | `/data-sources` | `/`, `/{source_id}`, `/{source_id}/test`, `/{source_id}/sync`, `/{source_id}/status`, `/{source_id}/preview` |
| Ontology | `/ontology` | `/entities`, `/entities/{entity_type}`, `/relations`, `/timeline/{entity_id}` |
| Graph | `/graph` | `/query`, `/neighbors/{entity_id}`, `/path`, `/subgraph/{entity_id}`, `/stats`, `/impact-analysis/{entity_id}`, `/trace/{entity_id}` |
| Pipelines | `/pipelines` | `/`, `/{pipeline_id}`, `/{pipeline_id}/run`, `/{pipeline_id}/runs` |
| Semantic assets | `/semantic-assets` | `/data-assets`, `/ontology-objects`, `/ontology-relations`, `/page-contracts` |
| Analytics | `/analytics` | `/overview`, `/aggregate`, `/timeseries`, `/distribution` |
| Maintenance | `/maintenance` | `/equipment-health`, `/equipment/{equipment_id}/health`, `/predictions`, `/work-orders` |
| Quality | `/quality` | `/spc/{parameter}`, `/defects`, `/defects/pareto`, `/traceability/{entity_id}`, `/inspections`, `/capa` |
| Supply chain | `/supply-chain` | `/suppliers`, `/inventory`, `/shipments`, `/risk-assessment`, `/analytics` |
| AI assistant | `/ai` | `/chat`, `/sessions`, `/analyze` |
| Dashboard | `/dashboard` | `/overview`, `/oee`, `/production`, `/alerts` |
| Reports | `/reports` | `/`, `/{report_id}`, `/{report_id}/snapshot`, `/{report_id}/snapshots` |
| Model-driven | `/model-driven` | `/models`, `/pages`, `/data/{model_name}`, `/menus` |
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

Add a form field:

```bash
curl -X POST http://localhost:8000/api/v1/forms/1/fields \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d "{\"field_name\":\"customer_name\",\"label\":\"Customer Name\",\"field_type\":\"string\",\"required\":true}"
```

Create a dynamic record:

```bash
curl -X POST http://localhost:8000/api/v1/forms/1/records \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d "{\"data\":{\"customer_name\":\"Acme\",\"priority\":\"high\"}}"
```

List dynamic records with pagination and text search:

```bash
curl "http://localhost:8000/api/v1/forms/1/records?page=1&page_size=20&search=Acme" \
  -H "Authorization: Bearer <token>"
```

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
