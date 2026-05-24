# ManuFoundry Documentation

Last updated: 2026-05-24

This directory is split into three kinds of documents:

- **Current implementation**: documents that must match the running code.
- **Development and operations**: how to build, test, deploy, and extend the project.
- **Reference design**: Palantir-inspired product and architecture thinking. These guide direction, but they are not always implemented yet.

## Start Here

Read these first when you want the current system truth:

1. [Architecture Overview](architecture/overview.md)
2. [API Reference](development/api-reference.md)
3. [Deployment](operations/deployment.md)
4. [Testing](operations/testing.md)
5. [Platform Database Landing Plan](architecture/platform-database.md)
6. [Knowledge Base](architecture/knowledge-base.md)
7. [Permission System](architecture/permission-system.md)

## Current Implementation Docs

| Document | Purpose |
| --- | --- |
| [Architecture Overview](architecture/overview.md) | Current full-system architecture, Palantir mapping, module layout, data flow, deployment shape. |
| [API Reference](development/api-reference.md) | Current FastAPI route map and example requests. |
| [SaaS Productization Phase 1](architecture/saas-productization-phase-1.md) | First public SaaS boundary, runtime modes, tenant model, ready path, and module maturity. |
| [Platform Database Landing Plan](architecture/platform-database.md) | Current low-code forms/application/menu persistence design and rollout notes. |
| [Permission System](architecture/permission-system.md) | Current authentication, RBAC, application visibility, admin guards, and platform form permission enforcement. |
| [Knowledge Base](architecture/knowledge-base.md) | Current local knowledge/RAG MVP and future persistence boundary. |
| [Graph Database Integration](architecture/graph-database-integration.md) | Current graph sync and quality impact graph integration. |
| [Knowledge Base Workflow](business/knowledge-base-workflow.md) | User workflow for knowledge upload, review, binding, and workbench use. |
| [Deployment](operations/deployment.md) | Current Docker Compose deployment flow and server update convention. |
| [Testing](operations/testing.md) | Current backend/frontend verification strategy and test coverage map. |

## Development Docs

| Document | Purpose |
| --- | --- |
| [Frontend Development](development/frontend.md) | React/Vite shell, API client, routes, menus, UI conventions. |
| [Backend Development](development/backend.md) | FastAPI, config, database sessions, security, route/model conventions. |
| [Data Model](architecture/data-model.md) | Current relational model groups, platform forms storage, Neo4j notes, and ontology direction boundaries. |
| [Integration](business/integration.md) | Data-source integration surface and connector status. |
| [User Guide](business/user-guide.md) | Product walkthrough and demo-oriented usage notes. |
| [AI Agent Skill/Tool Contract](architecture/ai-agent-skill-contract.md) | AI skill/tool safety contract and phased backend migration path. |

## Palantir-Inspired Reference Docs

These documents explain the product direction inspired by Palantir Foundry, AIP, and Gotham. They should be read as reference design, not as a guarantee that every capability already exists.

| Document | Purpose |
| --- | --- |
| [Palantir Platform Relationship Map](architecture/palantir-platform-relationship-map.md) | How AIP, Foundry, Gotham-style concepts map to ManuFoundry. |
| [Foundry-Style Foundation](architecture/foundry-style-foundation.md) | Ontology-first and object-action platform direction. |
| [AIP-Style Intelligence Layer](architecture/aip-style-intelligence-layer.md) | AI assistant, assisted work, proactive intelligence, and agentic roadmap. |
| [Gotham-Style Command UI](architecture/gotham-style-command-ui.md) | Command-center UI and event-driven operations ideas. |
| [Palantir-Style Role Workbench](architecture/palantir-style-role-workbench.md) | Role-based operational workbench design. |
| [AI Capability Map](architecture/ai-capability-map.md) | AI capability taxonomy and guardrails. |

## Documentation Rules

- If it describes current API behavior, verify against `backend/app/main.py` and `backend/app/api/*`.
- If it describes frontend routes, verify against `frontend/src/App.tsx`.
- If it describes deployment, verify against `docker/docker-compose.yml`, `docker/docker-compose.prod.yml`, `frontend/nginx.conf`, `frontend/Dockerfile`, and `backend/Dockerfile`.
- If it describes database schema, verify against `backend/app/models/*` and `backend/alembic/versions/*`.
- If a feature is not wired in code yet, mark it as **planned** or **reference design**.
- Archived documents are historical records and are not source of truth.

## Known Recently Fixed Mismatches

| Area | Stale wording | Current wording |
| --- | --- | --- |
| Data source API | `/api/v1/datasources` | `/api/v1/data-sources` |
| Operations API | `/api/v1/operations/*` | split across `/dashboard`, `/analytics`, `/maintenance`, `/quality`, `/supply-chain` |
| Production compose | `docker/docker-compose.prod-full.yml` | `docker/docker-compose.yml` plus `docker/docker-compose.prod.yml` |
| Production nginx config | `frontend/nginx-prod.conf` | `frontend/nginx.conf` |
| Production frontend port | inherited development port | host `80` to container `80` |
| AI stack | Prophet/LangChain active | currently optional/future; active AI APIs are implemented directly |
| Forms platform | "next phase persistence" | `/api/v1/forms` and migration `0006_platform_forms.py` exist |
| Permissions | frontend/menu-only visibility | backend admin guards, application access checks, and platform form runtime permission checks exist |
| Knowledge base | frontend-only concept | `/api/v1/knowledge` exists as a local TF-IDF RAG MVP |
| Time-series storage | TimescaleDB active | `sensor_readings` is currently a normal relational table |

## Verification Commands

Frontend:

```bash
cd frontend
npm run type-check
npm run build
```

Backend:

```bash
cd backend
python -m pytest
```
