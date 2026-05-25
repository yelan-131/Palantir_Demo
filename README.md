# ManuFoundry

ManuFoundry is a manufacturing low-code workbench for building operational applications on top of factory data, semantic assets, workflow, graph exploration, and AI-assisted knowledge operations.

This repository is currently a full-stack product prototype rather than a static demo. It includes a React workbench, FastAPI service layer, PostgreSQL relational model, Neo4j graph capabilities, Redis-backed infrastructure, Alembic migrations, seed data, and product documentation.

Last aligned for the active development branch on 2026-05-25.

## What It Does

- Manufacturing application workspace with login, account center, application switching, and role-aware navigation.
- Low-code application and menu management for composing business workspaces.
- Dynamic forms, form permissions, workflow bindings, list/form layouts, and configurable actions.
- Identity and access management with users, roles, role permissions, organization units, and user-organization memberships.
- Semantic asset center for models, fields, relationships, aliases, business terms, and knowledge-base metadata.
- Knowledge base APIs for document ingestion, extraction jobs, extracted entities, chunk search, and AI-ready context.
- Ontology and graph exploration backed by Neo4j-aware services, with graceful degradation when graph services are unavailable.
- Manufacturing demo domains for production, maintenance, quality, supply chain, reports, rules, notifications, and analytics.
- AI service layer with provider abstraction, safety policies, prompt contracts, memory scaffolding, tools, and knowledge ingestion helpers.

## Current Product Areas

| Area | Highlights |
| --- | --- |
| Workspace | Authenticated shell, app switcher, account center, global navigation |
| System Admin | Users, roles, permissions, organizations, apps, menus, semantic assets |
| Low-Code Forms | Dynamic form metadata, fields, layouts, actions, permissions, records |
| Knowledge Base | Upload/ingest flows, extraction persistence, entity review, chunk search |
| Ontology | Model/field/relation visualization and graph-driven exploration |
| Manufacturing Demo | Production, equipment, quality, materials, orders, inspections, SPC |
| AI Platform | Assistant APIs, ingestion, orchestration contracts, provider abstraction |

For the full documentation index, see [docs/README.md](docs/README.md).

## Tech Stack

- Frontend: React 18, TypeScript, Vite, Ant Design, Zustand, ECharts, Cytoscape, ReactFlow.
- Backend: FastAPI, SQLAlchemy 2, Alembic, Pydantic, async PostgreSQL access.
- Data stores: PostgreSQL, Neo4j, Redis, and SQLite for local demo fallback/bootstrap.
- Deployment: Docker Compose base stack plus production overlay.
- Testing: pytest for backend service/API behavior, TypeScript build checks for frontend.

## Repository Layout

```text
backend/              FastAPI app, migrations, models, tests, service layer
frontend/             React workbench and Vite build
data/seed/            Manufacturing seed data
docker/               Compose files, Dockerfiles, nginx config
docs/                 Architecture, business, development, and operations docs
scripts/              Seed and operational helper scripts
```

## Local Development

Backend:

```bash
cd backend
pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Local URLs:

- Frontend: `http://localhost:3000`
- Backend API docs: `http://localhost:8000/docs`
- Health check: `http://localhost:8000/health`

Default demo login:

- Username: `admin`
- Password: `admin123`

## Docker Development Stack

```bash
docker compose -f docker/docker-compose.yml up -d --build
```

Development ports:

- Frontend Vite server: `http://localhost:3000`
- Backend: `http://localhost:8000`
- PostgreSQL: `localhost:5432`
- Neo4j Browser: `http://localhost:7474`
- Redis: `localhost:6379`

## Production-Style Stack

```bash
docker compose -f docker/docker-compose.yml -f docker/docker-compose.prod.yml up -d --build
```

Production-style ports:

- Frontend: host port `80`, served by nginx from the frontend container.
- Backend: host port `8000`.

The production overlay builds the static frontend with `frontend/Dockerfile`, serves it with nginx, and proxies `/api/` to the backend service.

## Database And Migrations

Run migrations from the backend environment:

```bash
cd backend
alembic upgrade head
```

The current migration stream includes SaaS tenant isolation, large-list indexes, identity seed data, demo organization units, application-role bindings, and knowledge extraction persistence.

Important data families:

- `users`, `roles`, `user_roles`, `role_permissions`
- `org_units`, `user_org_memberships`
- `applications`, `application_roles`, `application_menu_nodes`
- `forms`, `form_fields`, `form_layouts`, `form_actions`, `form_permissions`, `dynamic_records`
- knowledge extraction and semantic asset tables
- manufacturing seed tables such as equipment, sensors, inspections, SPC points, orders, materials, suppliers, and work orders

## API Prefixes

All business APIs are mounted under `/api/v1`.

| Area | Prefix |
| --- | --- |
| Auth | `/api/v1/auth` |
| Admin | `/api/v1/admin` |
| Applications | `/api/v1/applications` |
| Data sources | `/api/v1/data-sources` |
| Knowledge | `/api/v1/knowledge` |
| Ontology | `/api/v1/ontology` |
| Graph | `/api/v1/graph` |
| Pipelines | `/api/v1/pipelines` |
| Analytics | `/api/v1/analytics` |
| Maintenance | `/api/v1/maintenance` |
| Quality | `/api/v1/quality` |
| Supply chain | `/api/v1/supply-chain` |
| AI assistant | `/api/v1/ai` |
| Reports | `/api/v1/reports` |
| Model-driven | `/api/v1/model-driven` |
| Rules | `/api/v1/rules` |
| Notifications | `/api/v1/notifications` |
| Templates | `/api/v1/templates` |
| Config import/export | `/api/v1/config` |
| Scheduler | `/api/v1/scheduler` |
| Search | `/api/v1/search` |
| AI builder | `/api/v1/ai-builder` |

## Verification

Frontend:

```bash
cd frontend
npm run build
```

Backend:

```bash
cd backend
python -m pytest
```

Focused checks used frequently during active development:

```bash
cd backend
python -m pytest tests/test_ai_agent_services.py tests/test_ai_knowledge_api.py tests/test_knowledge_ingestion.py tests/test_knowledge_extraction.py tests/test_security.py tests/test_forms_platform.py
```

## Notes For Active Development

- Production mode requires a real `SECRET_KEY` and `DEMO_AUTH_OPTIONAL=false`.
- The production frontend should listen on host port `80`; the frontend container serves nginx on container port `80`.
- Neo4j-backed graph features should degrade safely when Neo4j is unavailable.
- Local runtime artifacts such as archives and `runtime-logs/` are not part of the repository.
- This branch is still evolving quickly; prefer migrations and seed scripts over manual database edits whenever a dataset needs to survive redeploys.
