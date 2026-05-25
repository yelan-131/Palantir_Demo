# Frontend Development Guide

Last updated: 2026-05-25

Source of truth: `frontend/src/App.tsx`, `frontend/src/services/api.ts`,
`frontend/src/config/menus.ts`, and `frontend/package.json`.

This document describes the current React application. Older wording that
described future-only low-code pages has been folded into the current platform
forms implementation.

## Stack

| Area | Current code |
| --- | --- |
| Framework | React 18.3, TypeScript 5.7, Vite 6 |
| Router | `react-router-dom` 7 |
| UI | Ant Design 5, `@ant-design/pro-components`, `@ant-design/icons`, lucide |
| State | Zustand auth store |
| HTTP | axios client in `src/services/api.ts` |
| Charts and graph | ECharts, Cytoscape, React Flow |

Commands:

```bash
cd frontend
npm install
npm run dev
npm run type-check
npm run build
```

The development server listens on port `3000`. Requests under `/api` are
proxied to `VITE_API_PROXY_TARGET`, defaulting to `http://localhost:8000`.
When the local sandbox blocks Vite dependency pre-bundling, use
`node local-static-server.mjs` to serve `frontend/dist` with a lightweight
`/api` proxy to `127.0.0.1:8000`.

## Application Shell

`App.tsx` owns the authenticated shell:

- Login route: `/login`.
- Authenticated entry: `/*`, otherwise redirected to `/login`.
- Workspace home: `/`.
- Floating AI assistant is available in the shell; `/ai-assistant` redirects to
  `/`.
- Header includes application switching, global search, notification polling,
  account access, and admin/workflow shortcuts.
- Route rendering is wrapped in `Suspense` and an error boundary.

Current routes:

| Route | Page |
| --- | --- |
| `/` | Workspace |
| `/dashboard` | Dashboard |
| `/data-sources` | Data source management |
| `/ontology` | Ontology |
| `/graph` | Graph explorer |
| `/pipeline` | Data pipeline |
| `/maintenance` | Predictive maintenance |
| `/quality` | Quality management |
| `/supply-chain` | Supply chain |
| `/account-center` | Account center |
| `/reports` | Report center |
| `/dynamic/:slug` | Dynamic platform form page |
| `/program/:programId` | Application/program assembly |
| `/form-settings/:formId` | Form settings |
| `/system-admin` | System administration |
| `/workflow` | Workflow center |
| `/templates` | Template market |
| `/rules` | Rule engine |

## Menus And Applications

There are two menu sources:

1. Static business/admin metadata in `src/config/menus.ts`.
2. Database-backed application menus from `/api/v1/applications/{id}/menus`
   and `/api/v1/forms/applications/{id}/menu-nodes`.

Runtime menus prefer the backend response. Local/static menus remain as a
fallback for demo resilience and legacy pages.

When adding a fixed product page, update:

1. `src/pages/<PageName>/index.tsx`.
2. Lazy import and `<Route>` in `App.tsx`.
3. `src/config/menus.ts` for menu metadata and breadcrumb labels.
4. `src/services/api.ts` if new backend calls are needed.

When adding a configurable business page, prefer the platform forms route:

1. Create or bind a form through `/api/v1/forms`.
2. Configure fields, layouts, actions, permissions, and workflow bindings.
3. Attach it to an application menu node.
4. Let `/dynamic/:slug` render the form and store records in
   `dynamic_records`.

## API Client

All frontend API calls should go through `src/services/api.ts`.

- Default base URL: `/api/v1`.
- Override: `VITE_API_BASE_URL`.
- Request interceptor reads `mf_token` from `localStorage` and sends
  `Authorization: Bearer <token>`.
- Response interceptor clears local auth and redirects to `/login` on `401`.

Implemented client groups include:

- Auth, dashboard, data sources, ontology, graph, pipelines.
- Analytics, maintenance, quality, supply chain, reports.
- Applications and application admin APIs.
- Platform forms: forms, fields, layouts, actions, permissions, workflow
  bindings, dynamic records, and application menu nodes.
- Workflow, notifications, templates, rules, scheduler, search.
- Knowledge base: spaces, sources, documents, upload simulation, ingestion jobs,
  Markdown, chunks, cards, related evidence, binding candidates, OCR workflow
  metadata, and local RAG search.

The knowledge base API is currently a local MVP backed by static documents and
TF-IDF retrieval on the backend. It is not yet connected to an external vector
database or embedding service.

## Auth And Permissions

`src/stores/authStore.ts` stores:

- `mf_token`
- `mf_user`
- derived `isAuthenticated`

The current frontend permission model is role-based and menu-oriented. The
backend has richer role, permission, form-permission, and audit-log tables; UI
surface should treat those as the long-term authority when adding new
administrative workflows.

## UI Conventions

- Use Ant Design components for forms, tables, modals, cards, tabs, and
  notifications.
- Keep reusable API calls out of page components.
- Use explicit `rowKey="id"` for tables.
- Prefer backend pagination/search for large lists.
- For platform forms, field metadata lives in `form_fields`; do not hard-code
  dynamic form schemas in page components.
- For actions with side effects, surface success/failure via Ant Design
  `message` or `notification`.

## Verification

Run before merging frontend changes:

```bash
cd frontend
npm run type-check
npm run build
```

For route or shell changes, also open the app in a browser and verify login,
application switching, route navigation, notifications, search, and the floating
AI assistant.
