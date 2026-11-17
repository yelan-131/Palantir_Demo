# ManuFoundry 0.3.9 Release Notes

Release date: 2026-06-15

## Theme

0.3.9 hardens workflow execution. The release adds immutable workflow
definition snapshots, pins each running instance to the version it started
with, tightens definition administration and approval identity checks, and
keeps workflow notifications scoped to the authenticated user.

## Highlights

- Workflow definitions now snapshot each created or updated version into
  `workflow_def_versions`.
- Workflow instances now store `workflow_version`, so editing a definition does
  not reshape in-flight approvals.
- Form-created workflow instances pin the same workflow version as manually
  started instances.
- Workflow definition create/update/delete routes require administrator access.
- Approval, rejection, cancellation, notification, and legacy `act` endpoints
  now rely on authenticated token identity and tighter user-scope checks.
- Workflow API tests were rewritten around the database-backed path instead of
  the old in-memory mock store.

## Changes

- Added migration `0037_workflow_def_versions.py` after
  `0036_ontology_mapping_layouts.py`.
- Added `WorkflowDefVersion` and `WorkflowInstance.workflow_version` to the
  relational model.
- Added workflow definition snapshot writes on create/update and batched
  snapshot reads for instance lists and business datasets.
- Updated instance start, detail, approve/reject, countersign, and form trigger
  paths to read pinned configuration snapshots.
- Removed workflow mock fallback behavior so database availability errors are
  explicit.
- Expanded workflow tests for admin gates, version pinning, countersign,
  terminal-state protection, notification scoping, cancellation ownership, and
  token-based legacy actions.
- Synced release metadata across `release.json`, `backend/release.json`,
  backend `APP_VERSION`, frontend package metadata, README, and the
  documentation index.

## Operational Notes

- Production databases must run Alembic through
  `0037_workflow_def_versions.py` before relying on workflow version pinning.
- The migration backfills one snapshot per existing workflow definition at its
  current version.
- Existing workflow instances keep `workflow_version` empty and continue using
  legacy live-definition resolution; newly started instances are pinned.

## Verification Targets

- Frontend production build completes.
- Alembic reports migration head `0037_workflow_def_versions`.
- Workflow tests pass against the database-backed API path.
- Server rebuilds backend and frontend containers successfully.
- Public frontend responds on `http://111.229.172.100`.
- Public `/api/v1/release/current` reports version `0.3.9`.
- Public `/api/v1/system/readiness` reports `ready`.
