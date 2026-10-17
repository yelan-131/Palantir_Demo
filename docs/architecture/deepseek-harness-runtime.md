# DeepSeek Harness runtime

Updated: 2026-10-17

New application requests use the official `deepseek-harness-sdk==0.1.5rc1`
Python SDK and its matching bundled runtime. The SDK drives the real Node/Cordis
Agent loop. The platform does not emulate that loop or silently fall back to
its historical planner.

## Request and execution boundary

```text
Authenticated UI / API
  → persisted platform AI settings + current role policy
  → owned conversation history / page context
  → official DeepSeek Harness SDK-minimal kernel
  → llm-pi-ai provider adapter
  → request-scoped platform MCP bridge
  → mandatory permission + input validation + confirmation gate
  → existing business service
  → platform run record and tool audit
```

`backend/app/services/ai/runtime.py` is the application facade;
`orchestrator.py` routes to `harness_runtime.py`. The earlier state-machine
implementation is isolated in `legacy_runtime.py` for historical proposal and
pending-operation compatibility tests. No public application route selects it.

The custom Cordis patch reuses the official SDK-minimal kernel. It disables
shell/terminal tools and supplies `dsh-llm-pi-ai`, `dsh-mcp-client`, token
measurement and optional automatic compaction. Model-provider selection is
separate from the Harness engine: a GLM/OpenAI-compatible/DeepSeek endpoint can
be used without changing the business execution boundary.

## Platform responsibilities

The platform keeps identity, tenants, roles, form/record permissions, business
records, workflows, knowledge ingestion, logical conversation ids and
confirmation tokens. A short-lived random MCP capability binds exactly one
backend-authenticated run to its actor; model arguments cannot choose another
user or tenant. The capability expires and is removed when the request ends.
The model only sees implemented tools allowed by current policy.

Every MCP call reloads settings and registry definitions. Read calls may run
immediately; configured `ask` rules produce pending operations even for reads.
All writes stop at a platform confirmation proposal. Confirmation execution
rechecks the latest policy and uses the existing business services; it never
trusts the model to declare that an operation was confirmed. Confirmation
tokens and run state prevent duplicate execution.

`draft` allows draft writes only; `readonly` excludes side-effecting tools and
writes; `confirm` allows authorized writes after confirmation; `off` and the
platform AI switch reject requests. An administrator is also subject to AI
role policy, including a disabled administrator policy.

## Conversation ownership and SDK compatibility

The pinned Python SDK can continue sessions inside one runtime process, but
reopening the same persisted id in a new runtime process fails with “session
already exists”. Therefore a logical platform conversation remains owned by
the platform database. Its permitted recent messages and recalled memory are
assembled before the Harness request. Each SDK invocation gets a separate
physical execution id and durable Harness log, scoped under a hash of tenant
and user in `AI_HARNESS_HOME` (default `storage/ai_harness`). Settings changes
and backend restarts do not depend on a surviving SDK process.

Concurrent requests to the same logical conversation are serialized. Stream
cancellation closes the SDK subprocess. Native Harness logs remain distinct
from the platform's user-facing transcript and tool audit rows.

## Settings semantics

- Saved database settings are the authority; read failures fail closed.
- Environment values supply initial defaults and optional credentials.
- `apiKey=********` preserves the saved credential. Snake-case credential
  aliases normalize to the masked canonical field. The browser cache excludes
  credentials.
- Database credentials use authenticated Fernet encryption, with a key derived
  from `AI_SETTINGS_ENCRYPTION_KEY` or the existing stable `SECRET_KEY`. Keep
  that server secret backed up separately from the database. Changing it without
  re-encrypting credentials prevents decryption. Legacy plaintext is migrated on
  read. An empty key clears the stored credential (an eligible environment key
  can still apply); cross-origin destination changes never reuse a saved key.
- Partial policy updates preserve other saved fields. The source-visibility
  switch controls context-source stream events and recorded response items.
- The UI has four horizontal tabs: model services, model purposes, tools/skills,
  and execution/safety. Services are custom-first; there are no provider preset
  cards or separate platform memory/capability pages.
- `modelServices[]` stores a stable id, display name, base URL, encrypted API key,
  optional organization/project headers, request timeout/retries, and a model
  catalog. Each model declares id, display name, input types, output limit,
  context capacity and optional reasoning effort. The current runtime adapter
  supports OpenAI Chat Completions; unsupported protocols are not advertised.
- `modelAssignments` references `{serviceId, modelId}` for `chat`, `reasoning`,
  and `document`. Reasoning can inherit chat; a null document reference disables
  remote vision. Document selection requires image input. Dangling references
  and duplicate service/model ids are rejected instead of falling back silently.
- `model_catalog.resolve_model_settings` resolves the request before invoking
  the official SDK or OCR client. The existing server context classifier selects
  chat for conversation/page/knowledge questions and reasoning for business
  analysis/action preparation. A service credential never falls back to another
  service or environment key. Changing its URL clears a masked saved credential.
- Legacy single-service settings are presented as a `default` service with
  equivalent purpose assignments, and converted when the catalog is saved.
  Masked updates preserve secrets only for the same service id and URL.
  API descriptors redact every key; browser draft caches exclude the catalog.
- Per-service/per-purpose tests use the current draft without saving. Chat and
  reasoning tests boot the real official SDK; document tests send an image through
  the same OCR client. Successful tests identify the model and destination.
- Per-model output limits/context capacity/reasoning effort and per-service
  retry/idle timeout reach the pinned native adapter. SDK process initialization
  and request deadlines remain global. Blank reasoning effort uses the model's
  own behavior; the provider must support an explicitly selected level.
- Platform memory collection, recall, database summary generation and background
  memory deletion are retired, including callers passing old enabled flags.
  Historical entries remain available for explicit owner-scoped review/deletion.
  Conversation history, knowledge indexes and audit records are retained.
- Native DSH `compaction-basic` remains configurable with enabled,
  `thresholdRatio` and `retainRatio`. Retired `compactionPolicy` flags cannot
  override `harnessPolicy.compaction`; explicit native settings are preserved.
- Tool availability still requires registry activation, current role/business
  authorization and the unified execution rules. Existing restrictions are
  preserved during migration; removing a UI category does not grant permission.
- Input budget uses a conservative UTF-8 estimate rather than a vendor tokenizer;
  oversized fixed inputs are rejected and dynamic context is bounded after
  reserving model output capacity. No native shell/filesystem permissions or
  automatic business writes are exposed.
- Forbidden-action categories are matched to tool/handler names; the
  configuration-write category blocks all `configuration_write` tools.
- Remote embedding selection is disabled because ingestion currently uses
  its local index. OCR enhancement resolves the independent document-purpose service and model,
  respects `aiEnabled`, and supports disabling that purpose.
- RAG enable/top-K/evidence length/threshold are enforced by the real knowledge
  search handler. A disabled RAG policy excludes knowledge search tools.
- Registry changes are transactional and activate after commit. Removed rows
  are deleted; disabled definitions stay out of the active cache. A writing
  handler cannot be registered as a read-only tool or with weaker permission
  metadata. Legacy shorthand parameters normalize to valid JSON Schema.
- Proactive patrol, daily quotas and automatic history cleanup are shown as
  unavailable in settings until they have real execution paths. Sampling
  style is not editable because this SDK does not expose that option.

The selected provider must itself support the configured model and wire API.
Harness installation does not supply a model API key. In Docker, `localhost`
is the backend container; host model services need a reachable host address.
The current MCP capability registry is process-local; run the backend with
one worker. Multi-worker deployments need a shared bridge or dedicated bridge
service before increasing workers. The local backend joins the preview network for outbound model access while
retaining its private database network.

## Deployment and validation

Install `backend/requirements.txt`, which pins both the official SDK and native
runtime to `0.1.5rc1` and a compatible Pydantic version. The Docker build verifies
both installed versions and SDK import; the default index is official PyPI
(`PIP_INDEX_URL` build argument can select an approved mirror). Rebuild the backend image for other environments; installing
only frontend assets is insufficient.

Before a backend-only build, refresh packaged platform instructions and seed
files with `python scripts/sync_ai_assets.py`. For an existing bundled registry,
`python scripts/upgrade_harness_registry.py` upgrades the old placeholder draft
handler only when its original side effect and permission metadata match.
Custom definitions are preserved. New registries are imported explicitly in
settings through the default-registry import action.

`test_harness_integration.py` launches the real official SDK/runtime and uses a
local streamed model fixture to verify MCP discovery, read execution, `ask`
interception, write confirmation, output-limit changes and conversation
context replay. It does not mock the SDK. `test_ai_configuration.py` checks
capability/mode enforcement, save failure, non-mutating tests, registry
persistence, anonymous access and real business writes after confirmation.

Official references:

- [Repository](https://github.com/deepseek-ai/deepseek-harness)
- [Python SDK](https://github.com/deepseek-ai/deepseek-harness/blob/master/python/sdk/README.md)
- [Agent loop](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/agent-loop/README.md)
- [MCP plugin](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/mcp/mcp-client/README.md)
