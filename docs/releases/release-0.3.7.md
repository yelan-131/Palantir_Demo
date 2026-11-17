# ManuFoundry 0.3.7 Update Notes

Release date: 2026-06-10

## Theme

0.3.7 extends the 0.3.6 production demo into a more complete data-to-ontology
workflow. The focus is governed object and relation modeling, external data
source metadata scanning, runtime application rendering, workflow worklist
visibility, and a cleaner administration experience for long-running demos.

## Highlights

- Object & Relation Center now persists ontology objects, fields, relations,
  mappings, review candidates, published versions, and publish logs in the
  relational database.
- Data sources can refresh metadata profiles, store scanned tables and fields,
  expose sync status, and feed candidate generation for ontology review.
- Semantic asset APIs now combine persisted external assets, application
  database tables, and fallback manufacturing demo assets into one governed
  catalog.
- Dynamic application pages can render configured business forms and configured
  analytics dashboards from server-provided runtime definitions.
- Workflow pages now surface a unified business worklist across applications,
  forms, records, statuses, detail drawers, and source-record navigation.
- Account and identity management now support user avatar URLs and refreshed
  admin table interactions.

## Changes

- Added Alembic migration `0027_ontology_center.py` for ontology objects,
  ontology fields, ontology relations, ontology mappings, ontology candidates,
  ontology versions, ontology publish logs, data-source metadata, and
  data-source sync status.
- Added Alembic migration `0028_user_avatar_url.py` and model/API support for
  storing a user avatar URL.
- Added metadata scanning service support for PostgreSQL, declared/manual table
  profiles, enterprise connector placeholders, sync status updates, sample row
  handling, and restricted-source sample suppression.
- Added ontology services for object/relation upsert, candidate approval and
  rejection, mapping payloads, version publishing, impact analysis, and audit
  logging.
- Expanded `/api/v1/semantic-assets` with persisted data assets, metadata scan,
  ontology object/relation CRUD, candidate generation and review, mappings,
  publishing, version history, and impact endpoints.
- Expanded `/api/v1/data-sources` with metadata scan, metadata list, sample,
  sync status, test, sync, status, and preview behaviors aligned with the new
  metadata service.
- Refined form APIs and form designer behavior around publishing, version
  preview, application form bindings, menu nodes, layout/actions/permissions,
  workflow bindings, and dynamic record runtime behavior.
- Reworked dashboard program data so configured business applications and
  analytics dashboards can render from live form schemas and runtime rows.
- Reworked workflow APIs and frontend pages so business items can be grouped,
  filtered, opened, and traced back to their source form record.
- Refreshed Semantic Asset Center, Form Settings, App Programs, Workflow,
  Account Center, User/Role/Organization/Admin pages, and shared styling for a
  denser enterprise operating-console experience.
- Updated demo knowledge assets and added scripts for demo external sources,
  business form materialization/repair, configuration repair, and WeChat article
  generation assets.
- Synced release metadata across `release.json`, `backend/release.json`,
  backend `APP_VERSION`, frontend package metadata, and the release popup.

## Operational Notes

- Production databases must run migrations through `0028_user_avatar_url.py`
  before the new ontology and avatar fields are used.
- External-source metadata scan requires compatible connection configuration.
  Restricted sources suppress sample rows by setting the effective sample limit
  to zero.
- The public demo can still fall back to built-in manufacturing data assets when
  a tenant has no persisted business rows or scanned external sources.
- Release metadata should report `0.3.7` after the server is rebuilt and the
  frontend/backend containers are restarted.

## Verification Targets

- Backend tests for AI agent services and dashboard program data pass.
- Frontend type-check and production build complete.
- Database migrations apply cleanly on the server.
- Public frontend responds on `http://111.229.172.100`.
- Backend health endpoint responds at `http://111.229.172.100:8000/health`.
- Object & Relation Center can list data assets, generate candidates, approve or
  reject candidates, and publish an ontology version.
- Workflow page can load business items and open source-record details.
