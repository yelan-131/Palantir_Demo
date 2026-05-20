# ManuFoundry

ManuFoundry is a manufacturing low-code analytics prototype inspired by a Foundry-style workbench. The current product shape is no longer only an analytics demo: it combines application switching, configurable menus, forms, semantic assets, ontology/graph exploration, workflow, rules, reports, notifications, and an AI assistant entry point.

For the full documentation index, see [docs/README.md](docs/README.md).

## Current System Snapshot

- Frontend: React 18, TypeScript, Vite, Ant Design, Zustand, ECharts, Cytoscape, ReactFlow.
- Backend: FastAPI, SQLAlchemy 2, Alembic, PostgreSQL-first configuration with SQLite demo bootstrap fallback.
- Graph and cache: Neo4j and Redis are available through Docker Compose; graph features degrade when Neo4j is unavailable.
- Deployment: Docker Compose with a development stack and a production overlay.
- Production frontend port: host `80` maps to frontend container port `80`.
- Backend health endpoint: `GET /health`.

## Main Capabilities

- Login and authenticated shell.
- Workspace home page.
- Top application switcher.
- Application-specific side menu.
- Dynamic business pages under `/program/:programId` and `/dynamic/:slug`.
- System administration for applications, menu assembly, semantic assets, users, roles, and permissions.
- Data sources, ontology, graph explorer, pipelines, analytics, reports, rules, workflows, notifications, templates, scheduler, search, and AI builder APIs.
- Floating AI chat widget that uses `/api/v1/ai`.

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

- Frontend: `http://localhost` through host port `80`
- Backend: `http://localhost:8000`

The production overlay builds the static frontend with `frontend/Dockerfile`, serves it with nginx, and proxies `/api/` to the backend service.

## Important API Prefixes

All business APIs are mounted under `/api/v1`.

| Area | Prefix |
| --- | --- |
| Auth | `/api/v1/auth` |
| Admin | `/api/v1/admin` |
| Applications | `/api/v1/applications` |
| Data sources | `/api/v1/data-sources` |
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

## Documentation Consistency Notes

The documentation has been aligned to the current codebase on 2026-05-20. Historical documents that still mention `/api/v1/datasources`, `/api/v1/operations`, `docker-compose.prod-full.yml`, or `frontend/nginx-prod.conf` should be treated as archived or stale unless they have been updated.

## Verification

```bash
cd frontend
npm run type-check
npm run build

cd ../backend
python -m pytest
```
