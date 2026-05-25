# SaaS Productization Phase 1

Last updated: 2026-05-25

Status: roadmap/productization. This document defines a target SaaS production
boundary; it is not a statement that every production guard is already enforced
in code.

This document defines the first production boundary for ManuFoundry as a public SaaS product. The goal is not to finish every manufacturing module. The first ready path is:

Tenant -> user -> application -> form -> dynamic record -> permission -> workflow -> report -> audit.

## Runtime Modes

| Mode | Purpose | Behavior |
| --- | --- | --- |
| `APP_MODE=demo` | Local demos, investor walkthroughs, internal prototyping | Allows mock fallbacks, guest auth compatibility, SQLite fallback, and seeded demo data. |
| `APP_MODE=production` | Public SaaS runtime | Rejects unsafe startup config, disables demo auth fallback, disables SQLite fallback, and makes core low-code API failures explicit. |

Production startup must fail when:

- `DEMO_AUTH_OPTIONAL=true`
- `SECRET_KEY` is the default demo value or too short
- PostgreSQL/`asyncpg` is unavailable and the app would otherwise fall back to SQLite

## Tenant Model

Phase 1 uses a shared database with `tenant_id` isolation.

The following SaaS-facing tables carry `tenant_id`:

- tenants
- users, roles, user_roles, role_permissions
- applications, application_menus, application_roles, menu_items
- forms, application_forms, application_menu_nodes, form_fields, form_layouts, form_actions, form_permissions, workflow_bindings, dynamic_records
- workflow_defs, workflow_instances
- reports, report_snapshots
- audit_logs

Existing data is migrated into the default tenant. New records are created with the tenant from the authenticated user context.

## Authentication Boundary

The backend supports HttpOnly cookie authentication for the main browser flow. Bearer tokens remain temporarily supported for compatibility, but the production frontend should rely on cookies plus `/auth/me`.

Production rules:

- missing token returns `401`
- invalid token returns `401`
- cross-tenant resource access returns `404` or `403`
- demo guest auth is unavailable

## Ready Path

| Capability | Phase 1 status | Notes |
| --- | --- | --- |
| Runtime mode guard | Ready | `APP_MODE` controls demo vs production behavior. |
| Tenant context | Ready foundation | Shared database `tenant_id` filtering is in place for the low-code core. |
| Cookie auth | Ready foundation | Login sets an HttpOnly cookie; logout clears it. |
| Applications and menus | Ready foundation | Database-backed and tenant-filtered. |
| Forms and fields | Ready foundation | Database-backed and tenant-filtered. |
| Dynamic records | Ready foundation | CRUD is tenant-filtered; no-search listing uses DB pagination. |
| Permissions | Ready foundation | Backend permission checks are the security boundary. |
| Workflow binding and instances | Ready foundation | Tenant-filtered definitions/instances and audit on start/approval/cancel. |
| Reports | Ready foundation | Tenant-filtered report CRUD and snapshots. |
| Audit logs | Ready foundation | Core actions include tenant/user/resource metadata. |

## Module Maturity

| Module | Status | Product note |
| --- | --- | --- |
| Low-code applications | Ready | First public SaaS path. |
| Form builder and dynamic records | Ready | Main data-entry loop. |
| Backend permissions | Ready | Must remain the only security boundary. |
| Workflow | Ready foundation | Good for simple approval flows; advanced routing is later work. |
| Reports | Ready foundation | Basic report configuration and snapshots are ready; advanced analytics is later work. |
| Audit | Ready foundation | Core traceability exists; export and retention policy are later work. |
| Quality | Beta/Demo | Keep visible as a demo module unless explicitly hardened. |
| Equipment and maintenance | Beta/Demo | Keep separate from SaaS ready acceptance. |
| Supply chain | Beta/Demo | Demo data and workflows remain useful, but not phase-1 ready. |
| AI assistant and AI builder | Beta/Demo | Keep as assisted workflow surface; do not rely on it for production correctness. |
| Knowledge base | Demo | Static/local retrieval remains a demonstration path. |
| Graph/ontology | Beta/Demo | Useful architecture direction, not a phase-1 SaaS dependency. |
| Template marketplace | Disabled/Demo | Should not block the ready path. |

## First SaaS Usage Path

1. Create or migrate a tenant.
2. Create tenant users and assign roles.
3. Create an application.
4. Add application menus.
5. Create a form.
6. Add fields, layouts, actions, and permissions.
7. Create dynamic records.
8. Bind a workflow to the form submit action.
9. Start and approve a workflow instance.
10. Create a report against the form data.
11. Review the audit log for the tenant.

## Remaining Product Work

- Enforce unique codes per tenant instead of global uniqueness for applications, forms, and roles.
- Add tenant administration screens for tenant/user/role lifecycle.
- Add PostgreSQL JSONB indexes for common dynamic record search fields.
- Expand E2E coverage around the full ready path.
- Add onboarding, invite flow, password reset, account lockout, and rate limiting.
- Add billing, plans, quotas, and operational observability after the first SaaS loop is stable.

## Large Data Read Strategy

Phase 1 should not promise arbitrary real-time free search over tens or hundreds of millions of dynamic records. The scalable contract is narrower:

- default list queries use tenant/form/deleted/id indexes
- cursor pagination is preferred for deep browsing
- offset pagination remains only for compatibility and shallow pages
- production search/filter requests must use configured queryable fields
- unindexed production search/filter requests must fail explicitly instead of falling back to Python-side filtering
- precise total counts are optional for cursor pages

Recommended scale tiers:

| Data volume per form | Storage/query strategy |
| --- | --- |
| Thousands to low millions | `dynamic_records` JSON storage with tenant/form/id indexes and cursor pagination. |
| Millions to tens of millions | Add generated/expression indexes for declared searchable/sortable fields; avoid deep offset pages and exact counts by default. |
| Tens of millions to hundreds of millions | Physicalize hot forms into dedicated tables or materialized read models; partition by tenant/time; move reports to pre-aggregated tables. |
| Hundreds of millions plus | Split hot tenants, use read replicas, asynchronous export jobs, and OLAP engines such as ClickHouse/Doris for analytics workloads. |

The product UI should reflect this boundary: large tables should favor filters, cursor navigation, async export, saved views, and precomputed reports instead of spreadsheet-style arbitrary full-table search.
