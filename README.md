# ManuFoundry / Palantir Demo

Current version: 0.3.8

ManuFoundry is a manufacturing low-code data workspace prototype. It combines configurable applications, forms, menus, identity access, knowledge assets, graph exploration, quality impact analysis, and an evolving AI Agent layer for assisted business configuration.

This repository is still in active development and is intended for demo and product exploration work, not direct commercial production use.

## What Is Included

- Login, account center, identity access, organization, role, permission, and tenant-oriented administration flows.
- System administration for users, roles, permissions, organizations, applications, menus, semantic assets, and reference data.
- Low-code form configuration for fields, layouts, views, actions, publish states, menu nodes, and dynamic records.
- Manufacturing demo data for factories, workshops, production lines, equipment, sensors, work orders, quality inspection, suppliers, materials, customers, and orders.
- Knowledge asset ingestion for documents, spreadsheets, PDFs, Markdown content, chunks, extraction tasks, and persisted entity or relation results.
- Ontology and graph exploration, including quality event impact analysis and relationship traversal.
- Business workspaces for production, predictive maintenance, quality analytics, supply chain risk, reports, rules, workflows, notifications, and templates.
- AI assistant APIs, provider abstraction, prompt/tool scaffolding, knowledge context, and low-code action guidance.
- AI Agent work in progress, inspired by OpenClaw and Harness Agent style architecture: model invocation boundaries, task planning drafts, tool calls, knowledge context, action review, and safety policies.

## 0.3.8 Focus

- AI Agent items, tool-use loop, events, hooks, context layers, compaction, budget, and tool result processing.
- Runtime configuration, production error handling, permission resolving, tenant context, and confirmation storage for auditable Agent writes.
- Physical low-code form tables, form code sequences, platform configuration seeds, and clearer form engine boundaries.
- Data quality rules and ontology mapping layouts for richer semantic asset governance.
- AI Agent registry tables plus `data/agent_registry` configuration for versioned skills, tools, hooks, and tenant policies.
- Frontend updates across AI workspace, form designer, semantic asset center, workflow, account center, and Taobao prototype pages.

See [docs/operations/release-0.3.8.md](docs/operations/release-0.3.8.md) for the detailed release notes.

## Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | React 18, TypeScript, Vite, Ant Design, ECharts, Cytoscape, ReactFlow, Zustand |
| Backend | FastAPI, SQLAlchemy 2, Alembic, Pydantic |
| Databases | PostgreSQL, SQLite fallback |
| Graph | Neo4j 5 Community |
| Cache | Redis |
| Deployment | Docker Compose |
| Tests | pytest, TypeScript checks, Vite production build |

## Repository Layout

```text
backend/      FastAPI app, models, migrations, services, and tests
frontend/     React workspace UI
data/         Seed data and demo knowledge assets
docker/       Docker Compose, Dockerfiles, and nginx configuration
docs/         Architecture, operations, release, and testing notes
scripts/      Local development, deployment, smoke, and helper scripts
.agent/       Agent contracts, skills, and tool notes
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

Default local URLs:

- Frontend: `http://localhost:3000`
- Backend docs: `http://localhost:8000/docs`
- Backend health: `http://localhost:8000/health`

Default demo account:

- Username: `admin`
- Password: `admin123`

## Docker Development

```bash
docker compose -f docker/docker-compose.yml up -d --build
```

Development ports:

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:8000`
- PostgreSQL: `localhost:5432`
- Neo4j Browser: `http://localhost:7474`
- Redis: `localhost:6379`

Production-style local run:

```bash
docker compose -f docker/docker-compose.yml -f docker/docker-compose.prod.yml up -d --build
```

The production-style frontend is exposed on host port `80`, and the backend remains available on port `8000`.

## Verification

Backend focused tests:

```bash
cd backend
python -m pytest tests/test_ai_agent_services.py tests/test_ai_knowledge_api.py tests/test_ai_low_code_agent.py
```

Frontend build:

```bash
cd frontend
npm run build
```

Production smoke test:

```bash
python scripts/production_smoke.py --base-url http://111.229.172.100
```

## Deployment Notes

Operational notes live in:

- [docs/operations/deployment.md](docs/operations/deployment.md)
- [docs/operations/private-deployment.md](docs/operations/private-deployment.md)
- [docs/operations/testing.md](docs/operations/testing.md)

The configured demo server uses `/root/Palantir_Demo` and Docker Compose. The public frontend listens on host port `80`.
