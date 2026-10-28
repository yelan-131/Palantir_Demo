# ManuFoundry Documentation

Last updated: 2026-10-28

This documentation set is organized by responsibility, not by file path. Some
files under `docs/architecture/` describe current implementation, while others
are product design or Palantir-inspired reference material.

## Reading Rules

- **Current implementation** means the document describes the current source;
  deployment/registry enablement status must be checked separately.
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
| [Current Code Framework](architecture/current-framework.md) | Frontend/backend map, shared form services, AI adapters, and remaining extraction boundaries. |
| [Low-Code Platform](architecture/low-code-platform.md) | Shared UI/AI service flow, configuration/runtime split, JSON/physical storage, and tool registry enablement. |
| [API Reference](development/api-reference.md) | Current FastAPI route map and example requests. Keep full endpoint lists here. |
| [Data Model](architecture/data-model.md) | Current relational model groups, platform forms storage, Neo4j notes, and ontology direction boundaries. |
| [Platform Database Implementation](architecture/platform-database.md) | Platform metadata, published versions, physical provisioning, and shared record storage. |
| [Permission System](architecture/permission-system.md) | Current authentication, RBAC, application visibility, admin guards, and platform form permission enforcement. |
| [Knowledge Base](architecture/knowledge-base.md) | Current local knowledge/RAG MVP, persistent document/chunk/runtime rows, and future vector boundary. |
| [Graph Database Integration](architecture/graph-database-integration.md) | Current graph sync and quality impact graph integration. |

## Developer Guides

从空工程独立实现业务表单系统，请阅读
[从零编写业务表单系统：开发规格与实现指南](development/business-form-from-scratch.md)。
这是新系统开发规格，不要求取得现有项目代码；配置人员操作说明见业务表单使用指南。

视觉与交互配套资料：[业务表单定义：现有 UI、架构与交互参考](reference/business-form/README.md)，以及[离线图文版](reference/business-form/index.html)。

| Document | Purpose |
| --- | --- |
| [Frontend Development](development/frontend.md) | React/Vite shell, API client, routes, menus, UI conventions. |
| [Backend Development](development/backend.md) | FastAPI, config, database sessions, security, route/model conventions. |
| [Integration](business/integration.md) | Data-source integration surface and connector status. |

## Operations

| Document | Purpose |
| --- | --- |
| [Deployment](operations/deployment.md) | Local startup, Docker Compose deployment, server update convention, and verification. |
| [Private Deployment](operations/private-deployment.md) | Image-based customer/private deployment, offline install, doctor checks, and rollback. |
| [Testing](operations/testing.md) | Backend/frontend verification strategy and known test gaps. |
| [Release 0.3.3](operations/release-0.3.3.md) | Server application pages switched from static rows to PostgreSQL-backed manufacturing data. |
| [Release 0.3.4](operations/release-0.3.4.md) | SaaS tenant hardening, form versions, platform tenant operations, AI low-code tools, and app assembly menus. |
| [Release 0.3.5](operations/release-0.3.5.md) | AI action drafts, action state, menu-node config, reference data admin, and private deployment tooling. |
| [Release 0.3.6](operations/release-0.3.6.md) | AI workspace history, runtime form permissions, knowledge ontology intake, admin governance, auth hardening, and production deployment. |
| [Release 0.3.7](operations/release-0.3.7.md) | Object and relation center persistence, external metadata scanning, runtime application rendering, workflow worklists, account avatars, and admin UX refresh. |
| [Release 0.3.8](operations/release-0.3.8.md) | Agent tool-use protocol, runtime config, confirmation and budget governance, physical form tables, data quality rules, registry data, and ontology mapping layouts. |
| [Version Policy](operations/version-policy.md) | Project numbering, draft/published states, immutable history, and release script checks. |
| [Release 0.3.18](operations/release-0.3.18.md) | AI configuration cards, editable proposals, native designer integration, and expanded form design tools. |
| [Release 0.3.17](operations/release-0.3.17.md) | Conditional approval routing, access checks, defaults, publish preview recovery, request-scoped read optimization, and local performance tools; updated through 2026-10-27. |
| [Release 0.3.16](operations/release-0.3.16.md) | Unified component canvas, independent page publication, data workspaces, knowledge browsing, shared form services, and option validation. |
| [Release 0.3.15](operations/release-0.3.15.md) | HTTP business form rendering and UUID compatibility fix. |
| [Release 0.3.14](operations/release-0.3.14.md) | Analytics workspace, shared metrics, form imports and attachments, field protection, and designer version management. |
| [Release 0.3.13](operations/release-0.3.13.md) | Harness upgrade, execution progress and confirmation recovery, shared form rules, existing record updates, and assembly improvements. |
| [Release 0.3.12](operations/release-0.3.12.md) | Model catalogs, AI settings, form view tabs, conditional encoding, grouped approvals, assembly persistence, and workspace preferences. |
| [Release 0.3.11](operations/release-0.3.11.md) | Unified business records, official Harness runtime, AI configuration, tool confirmation, and account center updates. |
| [Release 0.3.10](operations/release-0.3.10.md) | Workspace navigation and themes, alert and material application entry points, form approvals, notifications, and release history updates. |
| [Release 0.3.9](operations/release-0.3.9.md) | Workflow definition snapshots, instance version pinning, admin definition governance, token-based approvals, and notification scoping. |
| [Neo4j Beginner Guide](operations/neo4j-beginner-guide.md) | Beginner-friendly Neo4j browser and Cypher walkthrough for this project. |
| [Demo Knowledge Assets](operations/demo-knowledge-assets.md) | Local scripts for generating and seeding demo knowledge-base files. |

## Product And UX Design

For the business form configuration-to-publication walkthrough, see
[业务表单使用指南：从配置到发布](business/business-form-guide.md).

| Document | Purpose |
| --- | --- |
| [User Guide](business/user-guide.md) | Product walkthrough and demo-oriented usage notes. |
| [Application Management](architecture/application-management.md) | Product boundary for application identity, visibility, and entry configuration. |
| [Form Management](architecture/form-management.md) | Current field/version/layout/rule service ownership, shared UI/AI paths, and explicitly labeled UX/lifecycle design guidance. |
| [Configuration Lifecycle](architecture/configuration-lifecycle.md) | Draft/publish/disable/archive rules for configurable assets. |
| [Business Interaction Form Logic](business/business-interaction-form-logic.md) | Business-facing explanation of dynamic interaction tables, runtime forms, permissions, workflow, and record storage. |
| [Knowledge Base Workflow](business/knowledge-base-workflow.md) | User workflow for knowledge upload, review, binding, and workbench use. |
| [Workbench Notification Center](architecture/workbench-notification-center.md) | Workbench and notification center UX boundary. |
| [Recent Code Updates 2026-06-05](development/recent-code-updates-2026-06-05.md) | Current delivery note covering framework, backend, frontend, AI, permissions, tests, and deployment impact. |

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
| AI stack | Prophet/LangChain active | Harness SDK/runtime is active; the platform owns tool permissions, confirmation, and audit |
| Forms platform | "next phase persistence" | `/api/v1/forms`, published versions, and shared business services exist |
| Form storage | all writes are metadata-only; physical tables are future work | JSON and physical storage are implemented; create/add-field paths can provision tables/columns |
| UI/AI form logic | separate field/publication implementations | shared field and publication services, with adapter-specific orchestration |
| New AI tools | seed file changes automatically enable persisted tools | existing database registries need an explicit registry update |
| Permissions | frontend/menu-only visibility | backend admin guards, application access checks, and platform form runtime permission checks exist |
| Knowledge base | frontend-only concept | `/api/v1/knowledge` exists with persistent document/chunk/runtime rows and local TF-IDF retrieval |
| Knowledge Agent | stateless chat only | `/api/v1/knowledge/agent/conversations` persists conversations, messages, runs, tool calls, and memory rows |
| AI provider default | mock/OpenAI-style demo defaults | GLM-compatible defaults are now used unless explicitly overridden |
| Productization boundary | prose-only roadmap | `/api/v1/productization/readiness` exposes the ready path and module maturity contract |
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
