# ManuFoundry Documentation

Last updated: 2026-05-25

This documentation set is organized by responsibility, not by file path. Some
files under `docs/architecture/` describe current implementation, while others
are product design or Palantir-inspired reference material.

## Reading Rules

- **Current implementation** means the document should match the running code.
- **Design** means the document defines product or engineering intent, but may
  include future behavior.
- **Roadmap** means phased delivery direction, not a guarantee that every item
  exists today.
- **Reference** means Palantir-inspired thinking used to guide product shape.
- **Archive** means historical record only.

When in doubt:

- API truth comes from `backend/app/main.py` and `backend/app/api/*`.
- Frontend route truth comes from `frontend/src/App.tsx`.
- Schema truth comes from `backend/app/models/*` and
  `backend/alembic/versions/*`.
- Deployment truth comes from Docker files, compose files, and nginx config.

## Start Here

Read these first when you want the current system truth:

1. [Architecture Overview](architecture/overview.md)
2. [Current Code Framework](architecture/current-framework.md)
3. [API Reference](development/api-reference.md)
4. [Frontend Development](development/frontend.md)
5. [Backend Development](development/backend.md)
6. [Deployment](operations/deployment.md)
7. [Testing](operations/testing.md)

## Current Implementation

| Document | Purpose |
| --- | --- |
| [Architecture Overview](architecture/overview.md) | Current full-system architecture, Palantir mapping, module layout, data flow, deployment shape. |
| [Current Code Framework](architecture/current-framework.md) | Practical frontend/backend folder map and current module state. |
| [API Reference](development/api-reference.md) | Current FastAPI route map and example requests. Keep full endpoint lists here. |
| [Data Model](architecture/data-model.md) | Current relational model groups, platform forms storage, Neo4j notes, and ontology direction boundaries. |
| [Platform Database Landing Plan](architecture/platform-database.md) | Current low-code forms/application/menu persistence design and rollout notes. |
| [Permission System](architecture/permission-system.md) | Current authentication, RBAC, application visibility, admin guards, and platform form permission enforcement. |
| [Knowledge Base](architecture/knowledge-base.md) | Current local knowledge/RAG MVP and future persistence boundary. |
| [Graph Database Integration](architecture/graph-database-integration.md) | Current graph sync and quality impact graph integration. |

## Developer Guides

| Document | Purpose |
| --- | --- |
| [Frontend Development](development/frontend.md) | React/Vite shell, API client, routes, menus, UI conventions. |
| [Backend Development](development/backend.md) | FastAPI, config, database sessions, security, route/model conventions. |
| [Integration](business/integration.md) | Data-source integration surface and connector status. |

## Operations

| Document | Purpose |
| --- | --- |
| [Deployment](operations/deployment.md) | Local startup, Docker Compose deployment, server update convention, and verification. |
| [Testing](operations/testing.md) | Backend/frontend verification strategy and known test gaps. |
| [Neo4j Beginner Guide](operations/neo4j-beginner-guide.md) | Beginner-friendly Neo4j browser and Cypher walkthrough for this project. |

## Product And UX Design

| Document | Purpose |
| --- | --- |
| [User Guide](business/user-guide.md) | Product walkthrough and demo-oriented usage notes. |
| [Application Management](architecture/application-management.md) | Product boundary for application identity, visibility, and entry configuration. |
| [Form Management](architecture/form-management.md) | Product boundary for configurable business forms and metadata-backed fields. |
| [Configuration Lifecycle](architecture/configuration-lifecycle.md) | Draft/publish/disable/archive rules for configurable assets. |
| [Knowledge Base Workflow](business/knowledge-base-workflow.md) | User workflow for knowledge upload, review, binding, and workbench use. |
| [Workbench Notification Center](architecture/workbench-notification-center.md) | Workbench and notification center UX boundary. |
| [Low-Code Platform](architecture/low-code-platform.md) | Low-code platform shape and relation to application/form/runtime surfaces. |

## Roadmap And Productization

| Document | Purpose |
| --- | --- |
| [SaaS Productization Phase 1](architecture/saas-productization-phase-1.md) | First public SaaS boundary, runtime modes, tenant model, ready path, and module maturity. |
| [AI Capability Map](architecture/ai-capability-map.md) | AI capability taxonomy and guardrails. |
| [AI Agent Skill/Tool Contract](architecture/ai-agent-skill-contract.md) | AI skill/tool safety contract and phased backend migration path. |

## Palantir-Inspired Reference

These documents explain the product direction inspired by Palantir Foundry, AIP,
and Gotham. They should be read as reference design, not as a guarantee that
every capability already exists.

| Document | Purpose |
| --- | --- |
| [Palantir Platform Relationship Map](architecture/palantir-platform-relationship-map.md) | How AIP, Foundry, Gotham-style concepts map to ManuFoundry. |
| [Foundry-Style Foundation](architecture/foundry-style-foundation.md) | Ontology-first and object-action platform direction. |
| [AIP-Style Intelligence Layer](architecture/aip-style-intelligence-layer.md) | AI assistant, assisted work, proactive intelligence, and agentic roadmap. |
| [Gotham-Style Command UI](architecture/gotham-style-command-ui.md) | Command-center UI and event-driven operations ideas. |
| [Palantir-Style Role Workbench](architecture/palantir-style-role-workbench.md) | Role-based operational workbench design. |

## Archive

Archived documents are historical records and are not source of truth:

| Document | Purpose |
| --- | --- |
| [Old Deployment Guide](archive/05-部署指南.md) | Historical deployment guide. |
| [Old Developer Guide](archive/06-开发者指南.md) | Historical developer guide. |
| [Audit Change Log](archive/17-审计变更记录.md) | Historical audit/change record. |

## Maintenance Rules

- Put full endpoint tables only in [API Reference](development/api-reference.md).
- In domain documents, describe capability and link to the API reference instead
  of duplicating every route.
- Mark future behavior as **Design**, **Roadmap**, or **Target**, never as
  current implementation.
- Keep dangerous operational commands in clearly labeled warning sections.
- When code changes, update the closest current-implementation document and the
  API reference when endpoint contracts change.

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
