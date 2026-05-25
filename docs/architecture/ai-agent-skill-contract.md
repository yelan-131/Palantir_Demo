# AI Agent Skill/Tool Contract

Last updated: 2026-05-25

Status: roadmap/design. This document defines the intended AI skill/tool
contract and staged migration path. Current API entry points are listed in the
baseline section.

Version: v0.1

Scope: ManuFoundry system AI Agent architecture, skill/tool contracts, staged
delivery path, risk policy, confirmation strategy, and migration from demo mock
skills to real backend skills.

## 1. Purpose

This document turns the AI capability direction into an engineering contract.

`AI Capability Map` answers **what AI should eventually do**. This document answers **how an AI Agent is allowed to do it safely**:

- A **Skill** is a user-facing business capability, such as "create a material number application draft" or "analyze a quality event".
- A **Tool** is a backend callable operation used by a skill, such as searching knowledge, querying inventory, creating a dynamic record, starting workflow, or sending a notification.
- A **Policy** decides whether a tool call is read-only, draft-only, confirmed-write, admin-gated, or disallowed.
- A **Confirmation** records what the user reviewed before the system performs a business-effecting action.

The current implementation is mostly rule-based and mock-oriented. The target architecture keeps that demo surface useful while gradually replacing mock skills with permissioned backend skills.

## 2. Current Baseline

Current AI entry points:

| Area | Current module | Current behavior |
| --- | --- | --- |
| Chat assistant | `backend/app/api/ai_assistant.py` | Intent-like keyword routing with DB/mock fallback for OEE, equipment, production, quality, and supply-chain answers. |
| AI Builder | `backend/app/api/ai_builder.py` | Keyword-based model and page suggestions. |
| Knowledge base | `backend/app/api/knowledge.py` | Local TF-IDF retrieval over demo spaces, sources, documents, Markdown, chunks, cards, upload simulation, and binding candidates. |
| Frontend assistant | `frontend/src/pages/AIAssistant/index.tsx`, `frontend/src/components/AiChatWidget` | UI entry points for asking AI questions. |

Near-term work should preserve these APIs where possible and move orchestration behind them. Routers should remain thin; business logic belongs in `backend/app/services/ai/*` and existing domain services.

Current AI system settings are backend-owned. The frontend Account Center can
edit provider settings, but runtime provider selection and tests go through
`/api/v1/ai/settings`, `/api/v1/ai/settings/test`, and
`/api/v1/ai/provider/test`.

GLM is treated as an explicit provider (`provider = "glm"`) rather than a
generic OpenAI-compatible label. The first implementation can reuse the
OpenAI-compatible request shape, while keeping a separate provider name for
future GLM-specific authentication, model naming, embedding, and vision
behavior.

## 3. Core Concepts

### 3.1 Skill

A skill is the contract the product exposes to users and agents. It describes intent, inputs, allowed tools, risk level, confirmation requirement, output shape, and audit needs.

Skill examples:

- `knowledge.answer_question`
- `quality.analyze_event`
- `quality.prepare_capa_draft`
- `supply_chain.prepare_purchase_request`
- `maintenance.prepare_work_order`
- `low_code.suggest_model`
- `low_code.save_model_draft`
- `workflow.submit_instance`

### 3.2 Tool

A tool is a backend operation callable by the AI orchestrator. A tool must be deterministic enough to validate and audit.

Tool examples:

- `knowledge.search`
- `knowledge.ingest_document`
- `knowledge.embed_chunks`
- `graph.query_impact`
- `inventory.get_stock`
- `quality.get_event`
- `forms.create_dynamic_record_draft`
- `workflow.start`
- `notifications.create`
- `rules.validate`
- `ai_builder.suggest_model`

The Agent never writes directly to the database from a prompt. It calls registered tools that enforce schemas, permissions, validation, idempotency, and audit.

### 3.3 Agent

An Agent is an orchestrated runtime that can classify intent, choose skills, call tools, prepare a plan, ask for confirmation, and execute approved actions.

Recommended runtime flow:

```text
User / Scheduler / Rule Trigger
  -> AI Orchestrator
  -> Intent classification
  -> Skill selection
  -> Context assembly
  -> Policy and permission check
  -> Tool call plan
  -> Dry run / draft result
  -> Confirmation gate when needed
  -> Tool execution
  -> Audit log
  -> User-visible result with evidence
```

LLM provider settings, including GLM system configuration, are backend-owned.
The Agent may request a model capability such as "chat", "summarize", or
"embed", but it must not accept a raw API key, arbitrary base URL, or unreviewed
system prompt from the browser.

## 4. Skill Contract

Each skill should be registered with a structured definition.

```json
{
  "name": "quality.prepare_capa_draft",
  "version": "0.1.0",
  "description": "Prepare a CAPA draft from a quality event, evidence, and related objects.",
  "capability_level": "agentic",
  "risk_level": "medium",
  "default_mode": "draft",
  "allowed_triggers": ["user"],
  "required_permissions": [
    {"resource": "quality_event", "action": "view"},
    {"resource": "capa", "action": "create_draft"}
  ],
  "input_schema": "PrepareCapaDraftInput",
  "output_schema": "PrepareCapaDraftOutput",
  "allowed_tools": [
    "quality.get_event",
    "knowledge.search",
    "graph.query_impact",
    "forms.create_dynamic_record_draft"
  ],
  "confirmation": "required_before_write",
  "audit": "write_intent_and_result",
  "idempotency": {
    "required": true,
    "key_fields": ["skill_name", "quality_event_id", "target_form", "user_id"]
  }
}
```

Required skill fields:

| Field | Requirement |
| --- | --- |
| `name` | Stable dot-separated identifier. |
| `version` | Increment when input/output behavior changes. |
| `capability_level` | `qa`, `assisted`, `proactive`, or `agentic`. |
| `risk_level` | `low`, `medium`, `high`, or `critical`. |
| `default_mode` | `read`, `recommend`, `draft`, `confirmed_write`, or `admin_publish`. |
| `allowed_triggers` | `user`, `scheduler`, `rule`, or `system`. |
| `required_permissions` | Permissions checked against the current user or service principal. |
| `input_schema` | Pydantic model or equivalent JSON schema. |
| `output_schema` | Structured result returned to frontend and audit. |
| `allowed_tools` | Tool allowlist. The Agent cannot call tools outside this list for the skill. |
| `confirmation` | Confirmation policy before write or high-risk action. |
| `audit` | Audit level. All writes require intent and result logging. |
| `idempotency` | Required for writes, workflow submission, external sync, and notifications. |

## 5. Tool Contract

Every tool should be registered with a strict backend contract.

```json
{
  "name": "forms.create_dynamic_record_draft",
  "version": "0.1.0",
  "description": "Create a draft dynamic record for a configured form.",
  "side_effect": "draft_write",
  "risk_level": "medium",
  "permission_check": "current_user",
  "input_schema": "CreateDynamicRecordDraftInput",
  "output_schema": "CreateDynamicRecordDraftOutput",
  "timeout_ms": 3000,
  "result_limit": 1,
  "idempotency_required": true,
  "audit_required": true,
  "dry_run_supported": true
}
```

Tool side-effect classes:

| Class | Meaning | Example |
| --- | --- | --- |
| `read` | Reads data only. | Search knowledge, read inventory, read workflow status. |
| `analyze` | Computes derived insight without write. | Quality trend explanation, supplier risk summary. |
| `index_write` | Writes internal retrieval artifacts but not business records. | Store parsed Markdown, chunks, embeddings, vector index rows. |
| `draft_write` | Creates or updates a draft with no final business commitment. | CAPA draft, purchase request draft, low-code config draft. |
| `workflow_action` | Starts, approves, rejects, or advances workflow. | Submit material number application. |
| `notification` | Sends or schedules user-visible messages. | Notify quality owner. |
| `configuration_write` | Changes model, page, rule, permission, or app configuration. | Save generated form definition. |
| `external_write` | Calls ERP/MES/SRM/WMS or other external system. | Create ERP purchase request. |

Tool implementation rules:

- Validate input with a schema before calling domain code.
- Enforce current user permissions before reading or writing.
- Support `dry_run` for any write-like tool whenever practical.
- Return structured results with affected object IDs, warnings, and source references.
- Use idempotency keys for repeated writes and workflow/external calls.
- Never accept raw SQL, raw Python, or arbitrary endpoint names from an LLM.
- Keep sensitive values out of prompts, tool logs, and frontend responses.
- Keep provider credentials and system prompts on the backend. GLM settings such
  as `GLM_API_KEY`, `GLM_MODEL`, `GLM_BASE_URL`, and approved system settings
  are configuration inputs to the provider adapter, not user-provided tool
  arguments.

### 5.1 Knowledge Ingestion Tools

Knowledge ingestion is a controlled internal write path. It prepares retrieval
evidence but does not by itself publish enterprise knowledge or execute business
actions.

Recommended ingestion tools:

| Tool | Side effect | Purpose |
| --- | --- | --- |
| `knowledge.ingest_document` | `index_write` | Accept uploaded or synchronized source files, persist source metadata, and start parsing. |
| `knowledge.convert_to_markdown` | `index_write` | Normalize PDF, Word, spreadsheet, image OCR, or plain text into reviewable Markdown. |
| `knowledge.chunk_markdown` | `index_write` | Split Markdown into stable chunks with source offsets, headings, and evidence metadata. |
| `knowledge.embed_chunks` | `index_write` | Generate embeddings through the backend provider adapter and write pgvector-ready rows. |
| `knowledge.search` | `read` | Retrieve chunks/cards as RAG evidence with permission filtering and source references. |

The canonical retrieval path is:

```text
raw file
  -> Markdown normalization
  -> chunking with document/page/heading metadata
  -> embedding
  -> pgvector-ready index
  -> RAG retrieval
  -> cited assistant answer or draft skill context
```

Ingestion tools must be idempotent by document version and chunk hash so that a
re-ingest updates changed chunks without duplicating unchanged vectors. Parsed
Markdown and embedding rows should keep links back to the original source file,
document version, page or section, uploader, permission scope, and review state.

## 6. Risk Levels

Risk is assigned by business impact, reversibility, data sensitivity, and whether the action leaves the system boundary.

| Level | Definition | Examples | Default control |
| --- | --- | --- | --- |
| Low | Read-only or reversible suggestion with limited data scope. | Knowledge Q&A, page usage help, read workflow status. | No confirmation; show sources when available. |
| Medium | Draft creation, retrieval-index writes, or recommendation that may influence business decisions. | CAPA draft, repair order draft, purchase request draft, model suggestion, document ingestion. | User review before save/publish/submit; audit write if saved or indexed. |
| High | Write action, workflow submission, operational commitment, or broad data impact. | Submit workflow, send notifications to many users, publish generated config, create purchase request. | Explicit confirmation with reviewed payload; audit required. |
| Critical | Financial/legal/external system commitment, permission/security change, irreversible action. | Create purchase order in ERP, change role permissions, delete data, auto-order goods. | Admin or role-owner approval; policy limits; idempotency; reconciliation plan. |

Default posture:

- Read tools can run after permission checks.
- Draft tools can prepare content, but the user must review what will be saved.
- Workflow and external writes require explicit confirmation.
- Permission changes and publish actions require admin-level confirmation.
- Fully automatic critical actions are out of scope until policy, audit, reconciliation, and rollback are proven.

## 7. Confirmation Strategy

Confirmation is not just a yes/no modal. It is a reviewable contract between the Agent and the user.

### 7.1 Confirmation Levels

| Confirmation | Applies to | Required user-visible content |
| --- | --- | --- |
| `none` | Low-risk read-only answers. | Answer, sources, confidence when available. |
| `review_recommended` | Medium-risk recommendations that are not saved. | Reasoning, assumptions, source data, alternatives. |
| `required_before_draft_save` | Medium-risk draft writes. | Draft fields, source records, missing fields, validation warnings. |
| `required_before_submit` | High-risk workflow or business action. | Action summary, affected records, workflow target, assignee/owner, irreversible effects. |
| `admin_required` | Critical configuration, permission, or external commitment. | Full payload diff, policy checks, approver identity, idempotency key, rollback/reconciliation note. |

### 7.2 Confirmation Payload

Any write-like skill should produce a `confirmation_payload` before execution.

```json
{
  "skill_name": "supply_chain.prepare_purchase_request",
  "risk_level": "high",
  "mode": "confirmed_write",
  "summary": "Create a purchase request draft for SKF bearing 6205.",
  "affected_objects": [
    {"type": "Material", "id": "material-5", "name": "SKF bearing 6205"},
    {"type": "Supplier", "id": "supplier-2", "name": "Preferred supplier"}
  ],
  "proposed_changes": {
    "target": "purchase_request",
    "fields": {
      "material_id": "material-5",
      "quantity": 300,
      "reason": "Available inventory below safety stock"
    }
  },
  "evidence": [
    {"type": "inventory", "id": "inventory-material-5", "label": "Available 700 units"},
    {"type": "policy", "id": "safety-stock", "label": "Safety stock threshold"}
  ],
  "warnings": [],
  "idempotency_key": "supply_chain.prepare_purchase_request:material-5:user-123:20260522"
}
```

The frontend can display this payload in a business-specific review panel. The backend must still enforce the confirmation token or equivalent server-side state before executing the final action.

## 8. Agent Phased Roadmap

| Phase | Goal | Skill/tool scope | Engineering deliverables | Exit criteria |
| --- | --- | --- | --- | --- |
| Phase 0 | Preserve demo usefulness | Existing chat, AI Builder, knowledge search | Document contracts, identify mock boundaries, keep current endpoints stable | Demo behavior remains unchanged. |
| Phase 1 | Source-aware read skills | Q&A, knowledge, graph, business data reads | `services/ai` scaffolding, skill registry, read tool registry, structured evidence output | AI answers can cite local knowledge/business sources. |
| Phase 2 | Assisted draft skills | CAPA draft, repair order draft, purchase request draft, model/page suggestions | Draft-first tools, validation, confirmation payloads, audit for saved drafts, pgvector-ready ingestion | Users can review and save drafts without final workflow submission; knowledge files can flow raw file -> Markdown -> embedding -> RAG. |
| Phase 3 | Confirmed workflow actions | Submit workflow, notify owner, create follow-up task | Confirmation token, idempotency, workflow tool wrappers, audit result records | AI can execute selected actions only after explicit confirmation. |
| Phase 4 | Proactive agent runs | Scheduled risk patrol, overdue approval reminders, inventory alerts | Scheduler-triggered skills, service principal policy, notification rules, result review queue | AI can prepare alerts/drafts from scheduled checks. |
| Phase 5 | Policy-based automation | Low-risk auto reminders and narrow auto-drafts | Policy engine, allowlists, amount/category limits, reconciliation reports | Automation is limited, observable, and reversible. |
| Phase 6 | External system actions | ERP/MES/SRM/WMS sync and external commits | External tool contracts, idempotency, reconciliation, rollback playbooks | External writes are confirmed, auditable, and reconciled. |

## 9. Demo Mock Skill To Real Backend Skill Migration

The migration path should avoid a big rewrite. Keep the user-facing skill stable and replace internals in layers.

### 9.1 Migration Pattern

```text
Demo/mock handler
  -> Skill wrapper with stable input/output
  -> Tool registry entry
  -> Read-only real backend tool
  -> Draft-write backend tool
  -> Confirmed execution backend tool
  -> Proactive/scheduled skill
```

### 9.2 Example: Quality Event To CAPA Draft

| Stage | Implementation | Behavior |
| --- | --- | --- |
| Mock | Hardcoded quality answer in `ai_assistant.py`. | Returns generic quality summary. |
| Skill wrapper | `quality.analyze_event` returns structured insight and evidence fields. | Same UI can render sources and recommendations. |
| Read tools | `quality.get_event`, `knowledge.search`, `graph.query_impact`. | Reads real event, SOP/CAPA evidence, affected objects. |
| Draft tool | `forms.create_dynamic_record_draft` for CAPA form. | Creates CAPA draft only after review. |
| Workflow tool | `workflow.start` after confirmation. | Submits CAPA workflow with audit and idempotency. |
| Proactive | Scheduler runs quality patrol. | Creates review queue item or notification, not final action by default. |

### 9.3 Example: AI Builder Mock To Real Low-Code Skill

| Stage | Implementation | Behavior |
| --- | --- | --- |
| Mock | `ai_builder.suggest_model` keyword templates. | Suggests fields and page layout. |
| Skill wrapper | `low_code.suggest_model` normalizes output into model/page/rule draft schema. | Frontend receives stable structured draft. |
| Validation tool | `forms.validate_definition`, `rules.validate`. | Checks field names, required fields, enum values, action bindings. |
| Draft save tool | `forms.save_definition_draft`. | Saves metadata draft without publishing. |
| Publish tool | `forms.publish_definition` with `admin_required`. | Admin reviews diff and publishes configuration. |

### 9.4 Example: Supply Chain Recommendation To Purchase Request Draft

| Stage | Implementation | Behavior |
| --- | --- | --- |
| Mock | Supply-chain intent returns inventory alert text. | User sees generic risk summary. |
| Read tools | `inventory.get_stock`, `supplier.list_candidates`, `knowledge.search`. | Agent uses real inventory and supplier evidence. |
| Recommendation skill | `supply_chain.recommend_replenishment`. | Returns quantity, supplier alternatives, assumptions. |
| Draft tool | `forms.create_dynamic_record_draft` for purchase request. | Buyer reviews draft fields. |
| Workflow tool | `workflow.start` after confirmation. | Purchase request enters approval workflow. |
| External tool | ERP/SRM sync in later phase. | Requires critical-risk policy and reconciliation. |

## 10. Recommended Backend Shape

Target service layout:

```text
backend/app/services/ai/
  __init__.py
  client.py             # LLM provider adapter; optional in early phases
  config.py             # backend-owned provider/system settings resolver
  orchestrator.py       # intent, planning, skill routing
  skills.py             # skill registry and skill contracts
  tools.py              # tool registry and tool contracts
  policies.py           # risk, permission, and confirmation policy
  schemas.py            # shared Pydantic input/output schemas
  confirmations.py      # confirmation payloads/tokens
  audit.py              # AI action log helpers
  evidence.py           # source/result normalization
```

Router responsibilities:

- `/api/v1/ai/chat` should call the orchestrator for conversational read/assist skills.
- `/api/v1/ai/analyze` should call analysis skills with structured context.
- `/api/v1/ai-builder/*` should become low-code skills behind the same endpoint contract.
- `/api/v1/knowledge/*` can remain a direct local RAG API and also be registered as tools.

Backend provider configuration must be centralized behind the AI service layer.
GLM credentials and system settings should be loaded from environment variables
or backend-managed settings, then passed to `client.py` by the orchestrator. The
frontend should only send user intent, conversation context, selected business
mode, and uploaded document references.

Domain services remain the source of truth for business behavior. The AI layer composes them; it does not replace them.

## 11. Initial Skill Backlog

| Priority | Skill | Risk | First real tool dependencies |
| --- | --- | --- | --- |
| P0 | `knowledge.answer_question` | Low | `knowledge.search` |
| P0 | `knowledge.ingest_for_rag` | Medium | `knowledge.ingest_document`, `knowledge.convert_to_markdown`, `knowledge.embed_chunks` |
| P0 | `quality.analyze_event` | Medium | `quality.get_event`, `knowledge.search`, `graph.query_impact` |
| P1 | `quality.prepare_capa_draft` | Medium | `forms.create_dynamic_record_draft`, `rules.validate` |
| P1 | `low_code.suggest_model` | Medium | Existing AI Builder logic behind skill wrapper |
| P1 | `maintenance.prepare_work_order` | Medium | `maintenance.get_equipment`, `forms.create_dynamic_record_draft` |
| P2 | `supply_chain.prepare_purchase_request` | High | `inventory.get_stock`, `supplier.list_candidates`, `forms.create_dynamic_record_draft` |
| P2 | `workflow.submit_instance` | High | `workflow.start`, confirmation token, idempotency |
| P3 | `notifications.notify_owner` | High | `notifications.create`, audience limit policy |
| P3 | `low_code.publish_configuration` | Critical | Admin confirmation, config diff, rollback/export |
| P4 | `external.sync_purchase_request` | Critical | ERP/SRM connector, reconciliation, retry and idempotency |

## 12. Non-Goals For The Next Phase

- Do not let prompts issue raw SQL or arbitrary backend endpoint calls.
- Do not auto-create purchase orders or external commitments.
- Do not auto-change role permissions.
- Do not publish low-code configuration without admin review.
- Do not remove mock fallbacks until real tools are tested and documented.
- Do not make frontend code changes as part of this document-only task.

## 13. Related Documents

- [AI Capability Map](ai-capability-map.md)
- [AIP-Style Intelligence Layer](aip-style-intelligence-layer.md)
- [Knowledge Base](knowledge-base.md)
- [Architecture Overview](overview.md)
