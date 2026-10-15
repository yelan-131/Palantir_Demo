# DeepSeek Harness runtime

Updated: 2026-10-14

New application requests use the official `deepseek-harness-sdk==0.1.5rc1`
Python SDK and its matching bundled runtime. The SDK drives the real Node/Cordis
Agent loop. The platform does not emulate that loop or silently fall back to
its historical planner.

## Request and execution boundary

```text
Authenticated UI / API
  → persisted platform AI settings + current role policy
  → owned conversation history / memory / page context
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
- Connection tests boot the same official SDK/profile/provider used by the
  Agent, but test the current form
  and both distinct chat/Agent models without saving it. A missing key returns a
  failed test, not a successful “local check”.
- Chat model is used for knowledge chat. Reasoning model
  is used for business Agent runs; connection tests cover both. Output limit, provider idle timeout and
  retry count are passed to the real Harness adapter.
- Context-window policy is passed to the model adapter and Harness automatic
  compaction. Platform memory/summary policies continue to apply to the
  database transcript.
- Remote embedding selection is disabled because ingestion currently uses
  its local index. OCR enhancement reads the same saved provider/vision-model
  settings, respects `aiEnabled`, and supports `visionModel=disabled`.
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

Install `backend/requirements.txt`, which pins the official SDK and compatible
Pydantic version. Rebuild the backend image for other environments; installing
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
