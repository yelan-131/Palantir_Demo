# ManuFoundry Documentation

Last updated: 2026-05-20

This directory contains the software documentation for the ManuFoundry manufacturing low-code analytics platform prototype.

## Read This First

1. [Architecture Overview](architecture/overview.md)
2. [Current Framework](architecture/current-framework.md)
3. [Low-Code Platform Design](architecture/low-code-platform.md)
4. [Palantir-Style Role Workbench](architecture/palantir-style-role-workbench.md)
5. [AIP / Foundry / Gotham Relationship Map](architecture/palantir-platform-relationship-map.md)
6. [Foundry-Style Foundation](architecture/foundry-style-foundation.md)
7. [AIP-Style Intelligence Layer](architecture/aip-style-intelligence-layer.md)
8. [Gotham-Style Command UI](architecture/gotham-style-command-ui.md)
9. [Data Model](architecture/data-model.md)
10. [Platform Database Landing Plan](architecture/platform-database.md)
11. [Frontend Development](development/frontend.md)
12. [Backend Development](development/backend.md)
13. [API Reference](development/api-reference.md)
14. [Deployment](operations/deployment.md)
15. [Testing](operations/testing.md)

## Current Product Shape

The current codebase implements a Foundry-style application workbench:

- Login-protected React shell.
- Workspace home at `/`.
- Top application switcher.
- Current-application side menu.
- Configurable business pages under `/program/:programId`.
- Model-driven pages under `/dynamic/:slug`.
- System administration for applications, forms/menu assembly, semantic assets, users, roles, and permissions.
- Backend API modules for auth, admin, workflow, applications, data sources, ontology, graph, pipelines, analytics, maintenance, quality, supply chain, AI, reports, model-driven data, rules, notifications, templates, config import/export, scheduler, search, and AI builder.

## Code And Documentation Differences Found

The following mismatches were found during the review and should guide future document maintenance:

| Area | Old or stale documentation | Current code/config |
| --- | --- | --- |
| Data source API | `/api/v1/datasources` | `/api/v1/data-sources` |
| Operations API | `/api/v1/operations/*` | split across `/dashboard`, `/analytics`, `/maintenance`, `/quality`, `/supply-chain` |
| Production compose file | `docker/docker-compose.prod-full.yml` | `docker/docker-compose.yml` plus `docker/docker-compose.prod.yml` |
| Production nginx config | `frontend/nginx-prod.conf` | `frontend/nginx.conf` |
| Production frontend port | unclear or inherited dev port | host `80` to container `80` |
| AI stack | Prophet/LangChain described as active | currently commented as optional/future in `backend/requirements.txt`; active AI assistant API is implemented directly |
| Auth token lifetime | some docs say 2 hours | code default is `ACCESS_TOKEN_EXPIRE_MINUTES=480`, or 8 hours |

## Documentation Structure

```text
docs/
  README.md
  architecture/
    overview.md
    current-framework.md
    low-code-platform.md
    platform-database.md
    data-model.md
    application-management.md
    configuration-lifecycle.md
    form-management.md
    workbench-notification-center.md
    ai-capability-map.md
    palantir-style-role-workbench.md
    palantir-platform-relationship-map.md
    foundry-style-foundation.md
    aip-style-intelligence-layer.md
    gotham-style-command-ui.md
  development/
    frontend.md
    backend.md
    api-reference.md
  operations/
    deployment.md
    testing.md
  business/
    user-guide.md
    integration.md
  archive/
    historical documents
```

## Documentation Maintenance Rules

- Update API docs from `backend/app/main.py` and files under `backend/app/api/`.
- Update frontend route docs from `frontend/src/App.tsx`.
- Update local development docs from `frontend/package.json`, `frontend/vite.config.ts`, `backend/requirements.txt`, and `backend/app/config.py`.
- Update deployment docs from `docker/docker-compose.yml`, `docker/docker-compose.prod.yml`, `frontend/Dockerfile`, `frontend/nginx.conf`, and `backend/Dockerfile`.
- Keep archived documents for history, but do not treat them as the source of truth.

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
