# AI Static Data Inventory

Last updated: 2026-06-10

Phase 1 keeps demo/static business data in place, but new Agent Runtime code
must not introduce additional business static data. The following sources should
be migrated or externalized in a later phase.

| Source | Current role | Recommended target |
| --- | --- | --- |
| `backend/app/services/ai/demo_knowledge_seed.py` | Bundled demo knowledge documents and generated sample assets. | `data/demo` assets plus explicit seed scripts. |
| `backend/app/api/knowledge.py` | Demo knowledge spaces, directories, sources, and document ordering. | Database-backed knowledge catalog with seeded defaults. |
| `backend/app/api/ai_builder.py` | Keyword templates and generated field suggestions. | Low-code skill/tool configuration or tenant template tables. |
| `frontend/src/pages/SystemAdmin/SemanticAssetCenter.tsx` | Default demo source connection values, including sample password text. | Empty UI defaults plus backend-provided demo presets when demo mode is enabled. |
| `backend/app/services/ai/settings.py` | AI runtime defaults for role, risk, context, RAG, memory, compaction, and provider fallback. | Keep as engineering defaults, overridden by `system_settings` and environment variables. |
| `.agent/*.md` | Agent skill/tool/system contracts. | Keep as engineering metadata; later split into progressive skill/tool files. |

Engineering defaults are acceptable in runtime code when they describe behavior,
limits, or safe fallback policy. Business records, demo credentials, sample
documents, and domain examples should live in seed data, fixtures, or backend
configuration rather than Runtime modules.
