# AI Capability Map

Last updated: 2026-05-25

Status: roadmap/design. This document defines AI capability direction and risk
levels; implemented API entry points are called out separately.

Version: v0.1

Scope: ManuFoundry AI capabilities for Q&A, assistance, proactive operations,
and agentic execution.

## 1. Purpose

This document defines how AI should be embedded in ManuFoundry as a business capability layer rather than a standalone chat page.

The project already contains the first AI entry points:

- Backend chat and analysis API: `backend/app/api/ai_assistant.py`
- Backend AI Builder API: `backend/app/api/ai_builder.py`
- Frontend AI assistant page: `frontend/src/pages/AIAssistant/index.tsx`
- Frontend API wrappers: `frontend/src/services/api.ts`
- Optional model settings: `OPENAI_API_KEY`, `OPENAI_MODEL`
- GLM-compatible backend settings: `GLM_API_KEY`, `GLM_MODEL`, `GLM_BASE_URL`, and backend-only system prompt / system setting configuration

Current implementation is mostly rule-based and mock-oriented. The long-term direction is to let AI safely read, analyze, recommend, prepare, and, with authorization, execute business actions across model-driven apps, workflow, supply chain, quality, maintenance, graph, reports, and rules.

## 2. Capability Levels

| Category | Core behavior | Permission boundary | Typical user experience |
| --- | --- | --- | --- |
| Q&A AI | Answers questions from knowledge, documents, and business data | Read-only | User asks, AI answers |
| Assisted AI | Helps users prepare content, forms, reports, rules, and decisions | Draft-only by default | User works, AI completes or suggests |
| Proactive AI | Monitors signals and pushes alerts or recommendations | Scheduled read + notification + draft creation | AI notices risk before user asks |
| Agentic AI Agent | Calls system APIs to complete business tasks | Authorized write/action execution | User delegates a task, AI executes with guardrails |

## 3. Detailed Capability Matrix

| Category | Subtype | Scenario | Example | Automation level | Risk level | Recommended control |
| --- | --- | --- | --- | --- | --- | --- |
| Q&A AI | Knowledge base Q&A | Answer questions from manuals, SOPs, project docs, API docs, and user guides | "What is the material number application process?" | Low | Low | Cite source documents and show confidence |
| Q&A AI | System operation guide | Explain how to use screens and workflows | "How do I create an equipment inspection form?" | Low | Low | Link to related page or menu |
| Q&A AI | Business data Q&A | Query inventory, orders, equipment, quality, suppliers, and workflow status | "How much stock does M-0042 have?" | Medium | Low | Read-only tool calls with permission filtering |
| Q&A AI | Metric explanation | Explain OEE, yield, equipment health score, supplier risk score, and trends | "Why did OEE drop this week?" | Medium | Medium | Show data basis and avoid unsupported conclusions |
| Q&A AI | Graph traceability Q&A | Query relationships between material, batch, order, customer, supplier, and equipment | "Which customers are affected by this defective batch?" | Medium | Medium | Use graph/query tools with result limits |
| Q&A AI | Audit explanation | Explain what happened in a workflow or configuration change | "Who changed this rule and when?" | Medium | Low | Read audit logs only within role scope |
| Assisted AI | Business document draft | Generate draft records for business objects | Material number application, purchase request, repair work order, CAPA form | High | Medium | Save as draft, require user review |
| Assisted AI | Field completion | Complete missing fields from context and historical data | Fill unit, category, default supplier, specification, tax rate, lead time | High | Medium | Mark AI-filled fields and allow user edit |
| Assisted AI | Decision recommendation | Recommend options without executing them | Purchase quantity, supplier selection, repair priority, inspection frequency | Medium | Medium | Present reasoning, alternatives, and data inputs |
| Assisted AI | Report generation | Generate business reports, summaries, and dashboard narratives | OEE weekly report, quality monthly report, supply chain risk report | High | Low-Medium | Keep source data attached |
| Assisted AI | Rule generation | Convert natural language into rules | "Notify purchasing when stock falls below safety stock" | Medium-High | Medium | Validate rule syntax and require activation approval |
| Assisted AI | Low-code generation | Generate models, fields, pages, menus, and layouts | "Create a supplier onboarding page" | High | Medium | Generate draft configuration, require publish approval |
| Assisted AI | Workflow design | Suggest approval steps and responsibilities | Material number approval, purchase approval, supplier onboarding | Medium-High | Medium | Require admin confirmation before enabling |
| Assisted AI | Exception diagnosis | Analyze probable causes of abnormal events | Quality defect spike, equipment failure, delayed order, supplier risk | Medium | Medium-High | Display evidence and uncertainty |
| Assisted AI | Search and summarization | Summarize records, documents, and related events | Summarize all open issues for supplier A | High | Low-Medium | Keep links to original records |
| Proactive AI | Proactive alert | Detect threshold or anomaly and notify users | Low inventory, SPC out of control, equipment health drop, approval timeout | High | Medium | Use notification center and configurable thresholds |
| Proactive AI | Proactive recommendation | Suggest next best action after detecting a signal | "Create a purchase request for 200 units" | Medium-High | Medium | Require user confirmation before action |
| Proactive AI | Proactive follow-up | Monitor tasks and remind responsible users | Approval overdue, work order overdue, CAPA due soon | High | Low-Medium | Respect role ownership and escalation rules |
| Proactive AI | Scheduled business patrol | Periodically inspect high-risk areas | Daily high-risk supplier check, abnormal equipment check, open quality issue check | High | Medium | Scheduled jobs with audit trail |
| Proactive AI | Trend prediction | Predict future risks from historical data | Inventory depletion date, equipment failure probability, delivery delay risk | Medium | Medium-High | Separate prediction from confirmed fact |
| Proactive AI | Draft preparation | Create draft actions before users ask | Low stock triggers purchase request draft | High | Medium-High | Draft only, no final submission by default |
| Proactive AI | Risk briefing | Generate daily or weekly role-based briefs | Maintenance manager morning brief, purchasing risk brief | High | Low-Medium | Role-filtered content |
| Agentic AI Agent | Create business record | Call backend APIs to create records | Create material number application, repair order, CAPA, supplier onboarding record | High | Medium | Confirm intent, write audit log |
| Agentic AI Agent | Submit workflow | Start a workflow instance on behalf of a user | Submit material number application or purchase request for approval | High | Medium-High | Human confirmation and permission check |
| Agentic AI Agent | Cross-module orchestration | Chain multiple tools to complete a business process | Check stock -> choose supplier -> create purchase request -> submit workflow | High | High | Step-by-step plan, approval gates |
| Agentic AI Agent | Semi-automatic ordering | Prepare purchase order and submit after user confirmation | Create purchase order draft and ask buyer to confirm | Medium-High | High | Human approval before order commitment |
| Agentic AI Agent | Conditional automatic execution | Execute low-risk actions under predefined rules | Auto replenish low-value consumables from fixed supplier | High | High | Strict policy, amount limits, supplier whitelist |
| Agentic AI Agent | System configuration agent | Modify low-code configuration | Create model, page, menu, rule, permission binding | High | Medium-High | Draft -> review -> publish lifecycle |
| Agentic AI Agent | Closed-loop issue handling | Drive an issue from detection to resolution tracking | Detect quality issue -> create CAPA -> notify owner -> track closure | High | High | Full audit trail and owner accountability |
| Agentic AI Agent | External system operation | Call ERP/MES/SRM/WMS APIs | Create purchase request in ERP, sync supplier confirmation | High | High | Idempotency, reconciliation, rollback plan |

## 4. Manufacturing Scenarios

### 4.1 Material Number Application

| Step | AI role | Expected behavior | Control |
| --- | --- | --- | --- |
| User describes material | Assisted AI | Extract name, category, specification, unit, usage, supplier, and requester | Ask for missing required fields |
| Duplicate check | Q&A AI / Agent tool | Search existing material master data for similar records | Show possible duplicates |
| Code suggestion | Assisted AI | Suggest material number pattern based on category rules | User can override |
| Draft creation | Agentic AI Agent | Create material number application draft | Audit log required |
| Workflow submission | Agentic AI Agent | Submit application to workflow after confirmation | Explicit user confirmation |
| Follow-up | Proactive AI | Remind approvers or notify requester of status | Role-based notification |

Recommended automation: high for draft creation, medium for workflow submission.  
Recommended risk posture: do not auto-publish a final material master record without approval.

### 4.2 Purchase Request and Ordering

| Step | AI role | Expected behavior | Control |
| --- | --- | --- | --- |
| Demand detection | Proactive AI | Detect low inventory or production demand | Configurable thresholds |
| Supplier recommendation | Assisted AI | Compare supplier risk, price, lead time, and past delivery performance | Show alternatives |
| Quantity recommendation | Assisted AI | Recommend purchase quantity based on safety stock, demand, MOQ, and lead time | Show calculation basis |
| Draft purchase request | Agentic AI Agent | Create purchase request draft | Buyer review required |
| Workflow submission | Agentic AI Agent | Submit purchase request after confirmation | Approval workflow |
| Purchase order creation | Agentic AI Agent | Create PO only after approval or policy match | Amount and supplier controls |
| External order sync | Agentic AI Agent | Sync order to ERP/SRM if configured | Idempotency and audit |

Recommended automation: high for draft, medium for submission, low for fully automatic PO creation unless the purchase is low-value and policy-controlled.

### 4.3 Equipment Maintenance

| Capability | Example | Automation level | Risk |
| --- | --- | --- | --- |
| Health Q&A | "Which equipment health score is below 70?" | Medium | Low |
| Predictive alert | Detect abnormal vibration or health score decline | High | Medium |
| Work order draft | Generate repair work order draft | High | Medium |
| Priority recommendation | Rank equipment by downtime impact and failure probability | Medium | Medium |
| Closed-loop tracking | Remind owner until work order is closed | High | Medium |

### 4.4 Quality Management

| Capability | Example | Automation level | Risk |
| --- | --- | --- | --- |
| SPC explanation | "Why is this point out of control?" | Medium | Medium |
| Defect clustering | Group defects by line, material, supplier, or process | Medium | Medium |
| CAPA draft | Generate corrective action draft | High | Medium |
| Traceability | Identify affected orders, batches, suppliers, and customers | Medium | Medium-High |
| Escalation | Notify quality owner when severity is high | High | Medium |

### 4.5 Low-Code Platform

| Capability | Example | Automation level | Risk |
| --- | --- | --- | --- |
| Model generation | "Create an equipment inspection model" | High | Medium |
| Page generation | Generate form, table, detail page, and report layout | High | Medium |
| Rule generation | Generate notification and validation rules | Medium-High | Medium |
| Workflow generation | Draft approval chain and task assignment rules | Medium | Medium |
| Menu and permission suggestion | Suggest app menu structure and role access | Medium | Medium-High |

## 5. Architecture Pattern

Recommended runtime flow:

```text
User / Scheduler / Rule Trigger
  -> AI Orchestrator
  -> Intent classification
  -> Permission and policy check
  -> Tool selection
  -> Backend API / service call
  -> LLM response or action plan
  -> User confirmation when needed
  -> Write action / workflow / notification
  -> Audit log
```

Recommended backend structure:

```text
backend/app/services/ai/
  client.py          # LLM provider adapter
  providers.py       # OpenAI-compatible, GLM, Qwen, DeepSeek, local/mock
  orchestrator.py    # intent, planning, tool routing
  prompts.py         # system and domain prompts
  tools.py           # business tool registry
  policies.py        # risk levels and confirmation requirements
  schemas.py         # structured request/response models
  knowledge_ingestion.py # file -> Markdown -> chunks -> embeddings MVP
```

### 5.1 LLM Provider And System Settings

The AI layer should treat GLM and OpenAI-style providers as backend-hosted
model adapters. Frontend clients must not receive provider API keys, raw system
prompts, or privileged routing configuration.

Recommended GLM configuration:

| Setting | Purpose | Exposure |
| --- | --- | --- |
| `GLM_API_KEY` | Backend credential for GLM requests | Backend secret only |
| `GLM_MODEL` | Default GLM chat model used by the assistant | Backend config, optionally surfaced as a display name |
| `GLM_BASE_URL` | Provider endpoint for OpenAI-compatible GLM APIs | Backend config only |
| AI system setting / system prompt | Defines assistant identity, product boundaries, tool-use rules, and safety posture | Backend config only |

System settings belong in backend configuration or an admin-controlled settings
table, not in browser state. The frontend may select high-level modes such as
"knowledge Q&A" or "business assistant", but the backend must translate those
modes into approved system prompts and tool policies.

Provider adapters should support deterministic fallback behavior. If the GLM
provider is unavailable, the assistant may return rule-based guidance or a
retrieval-only answer, but it must not expose secret values or provider errors
to end users.

Existing routers should remain thin:

- `ai_assistant.py` handles chat and analysis endpoints.
- `ai_builder.py` handles model/page generation endpoints.
- Business execution should go through existing services and APIs instead of raw SQL inside prompts.

Knowledge-backed AI answers should use the ingestion chain described in
[Knowledge Base](knowledge-base.md): raw files are normalized to Markdown,
chunked, embedded, indexed in a pgvector-ready shape, retrieved as RAG evidence,
and then cited in the final answer.

For the detailed Skill/Tool contract, risk policy, confirmation payload, phased Agent roadmap, and migration path from demo mock skills to real backend skills, see [AI Agent Skill/Tool Contract](ai-agent-skill-contract.md).

## 6. Guardrails

| Guardrail | Applies to | Requirement |
| --- | --- | --- |
| Permission inheritance | All AI tools | AI can only access records the current user can access |
| Human confirmation | Medium/high-risk writes | Required before workflow submission, purchase request, PO creation, permission change, or publish action |
| Draft-first behavior | Assisted and agentic actions | AI creates drafts before final business effect |
| Audit logging | All write/action tools | Record user, AI action, inputs, affected records, and result |
| Idempotency | External calls and order creation | Prevent duplicate purchase orders or duplicate workflow submissions |
| Source visibility | Q&A and analysis | Show data source, related records, and uncertainty where relevant |
| Policy limits | Automatic execution | Define amount limits, supplier whitelist, material categories, and exception handling |
| Prompt/data isolation | LLM calls | Do not expose secrets, tokens, passwords, or unrestricted raw database dumps |
| Fallback mode | LLM unavailable | Return deterministic rules/mock response or ask user to retry |

## 7. Implementation Roadmap

| Phase | Goal | Main deliverables |
| --- | --- | --- |
| Phase 1 | Make AI useful and trustworthy | Fix Chinese text/encoding, connect real LLM client, keep current chat API, add source-aware Q&A |
| Phase 2 | Add assisted business work | Material number draft, purchase request draft, report generation, low-code model/page suggestions |
| Phase 3 | Add proactive intelligence | Scheduled checks for inventory, equipment health, quality anomalies, approval timeout, supplier risk |
| Phase 4 | Add controlled agentic execution | Confirmed workflow submission, confirmed purchase request creation, cross-module action plans |
| Phase 5 | Add policy-based automation | Low-risk auto replenishment, auto reminders, auto task creation under strict policy limits |

## 8. Priority Recommendations

Initial high-value use cases:

1. Material number application assistant.
2. Purchase request draft assistant.
3. Inventory risk proactive alert.
4. Equipment health Q&A and work order draft.
5. Quality anomaly analysis and CAPA draft.
6. Low-code model/page generation assistant.

Do not start with fully automatic ordering. Start with AI preparing the order and a human confirming it. This gives the system the feeling of "AI can do things" while keeping financial and supply-chain risk under control.
