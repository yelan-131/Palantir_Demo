# ManuFoundry 0.3.6 Release Notes

Release date: 2026-06-05

## Theme

0.3.6 turns the recent workspace, permissions, knowledge, and operations work into a coherent production demo release. The focus is a more durable AI workspace, runtime-safe low-code forms, governed knowledge ontology intake, stronger administration boundaries, and a GitHub-to-server release path.

## Highlights

- AI workspace conversations support history grouping, search, archive, restore, delete, and inline rename flows.
- Dynamic forms now return `permission_design` and `runtime_field_permissions`, and the backend enforces field visibility for records, filters, sorting, and details.
- Knowledge Center can start ontology intake and extraction from already-indexed documents, then route candidates through manual approval before graph publishing.
- System administration strengthens organization audit logging, organization code uniqueness checks, user CSV import, and role or organization binding.
- Application access and authentication are tighter: invalid tokens return explicit errors, and role-hidden applications are blocked by backend menu and detail APIs.
- Production deployment notes now cover local checks, Docker rebuilds, migrations, release metadata, and public endpoint verification.

## Changes

- Expanded AI runtime, planner, tool executor, low-code tools, and action guidance so pending actions keep safer state across restore, review, and execution flows.
- Refined form APIs and frontend consumers around published schemas, `viewConfig`, permission design, runtime field permissions, and dynamic record drafts.
- Added Knowledge Center intake behavior for stored documents, including generic entities, domain mappings, property candidates, document profiles, and quality-oriented approval data.
- Improved organization CRUD behavior with audit writes, parent validation, child/member delete guards, and tenant-scoped code uniqueness.
- Added user CSV import support with role and organization matching by names or labels.
- Refreshed frontend surfaces for the AI workspace, form designer, application programs, account center, and system administration pages.
- Updated demo knowledge assets for CAPA, SMT, supplier 8D, and customer communication scenarios.
- Updated production deployment documentation for backend tests, frontend checks, Docker rebuilds, server update, migrations, and health checks.
- Synced release metadata across `release.json`, `backend/release.json`, backend `APP_VERSION`, frontend package metadata, README, and documentation index.

## Verification Targets

- Backend focused tests for AI, knowledge, forms, and authorization pass.
- Frontend type-check and production build complete.
- Release branch or mainline has the verified release commit pushed to GitHub.
- Server Docker Compose rebuilds and restarts backend and frontend.
- Public frontend responds on `http://111.229.172.100`.
- Backend health endpoint returns healthy at `http://111.229.172.100:8000/health`.
- Release endpoint returns version `0.3.6`.
