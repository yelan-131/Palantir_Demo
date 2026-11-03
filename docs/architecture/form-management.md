# Form Management Architecture and Design Notes

Last updated: 2026-10-28

Status: design plus current implementation notes. Form metadata and runtime
records are implemented under `/api/v1/forms`. Storage supports both dynamic
JSON records and form-managed physical tables through the shared form engine.

Scope: System Admin / Form Management

## 1. Positioning

Form Management is not only a visual form list. In this product it is the structural management entry for configurable business data objects.

The working definition is:

```text
Business form = metadata + published definition + runtime UI + business record storage
```

Form Management owns the data structure and field metadata. Form Designer owns layout, interaction, validation, linkage, and detailed user experience.

Current implementation note: forms and fields are persisted as metadata under
`/api/v1/forms`. Dynamic storage uses `dynamic_records.data`; physical storage
uses the shared form engine to provision and extend form-managed tables.

### Architecture flow

```mermaid
flowchart LR
  UI["Designer / business page"] --> API["HTTP adapter"]
  AI["Agent"] --> Guard["Tool permissions / confirmation"]
  Guard --> Tool["Tool adapter"]
  API --> Services["Shared configuration and record services"]
  Tool --> Services
  Services --> Version["Metadata / published snapshots"]
  Services --> Engine["Shared storage engine"]
  Engine --> JSON["JSON records"]
  Engine --> Physical["Physical business tables"]
```

This is a service boundary inside the existing modular monolith. It does not
introduce independent microservices or fully remove remaining route-owned logic.

### Shared service boundary (2026-10-26)

HTTP endpoints and AI handlers share business services. Routes retain request
dependency injection and their existing response shapes. AI adapters translate
payloads and preserve their existing authorization and confirmation flow.

- `backend/app/services/form_schemas.py`: shared request models, also re-exported
  by `app.api.forms` for compatibility with existing callers.
- `form_definition.py`: canonical field normalization, serialization, designer
  settings, publication snapshots, and impact checks.
- `form_fields.py`: field creation, batch creation, updates, and archival.
  UI creation and AI creation/addition share name checks, type normalization,
  active field limits, and physical table provisioning. Batch input is fully
  validated before metadata or layouts change. AI addition retains its layout
  synchronization; ordinary UI addition retains its existing layout behavior.
- `form_versions.py`: publication preview, publishing, draft restoration, and
  version reads. AI business-form creation uses the same publication validation
  and permission synchronization as the designer. Composition can defer commit
  so form metadata, fields, layouts, and initial version commit together.
- `form_layouts.py`: layout reads, saves, and field insertion into layouts.
- `form_rule_preview.py`: runtime/designer evaluation and option previews.
- `records.py`: existing shared record reads/writes, authorization, and storage.

The `low_code.inspect_form` AI skill exposes five read tools:
`forms.preview_publish`, `forms.list_versions`, `forms.get_version`,
`forms.get_layouts`, and `forms.evaluate_rules`. These call the same services as
HTTP routes and require administrator/configuration access. Definitions are
included in both the repository registry seed and the packaged fallback assets.
Existing installations with a persisted AI registry must import the updated
registry seed through their normal registry administration flow to enable new
tool definitions; existing tools use the shared services immediately after the
code update.

As of 0.3.18, this five-tool list describes inspection only, not the full AI
surface. `form_configuration_tools.py` also maps field update/archive, layout
save, publication/restore, definition update/copy/delete, and action/permission/
workflow-binding management to fixed services or existing routes. Writes retain
administrator and platform confirmation controls. Register missing tools with
`scripts/register_form_design_tools.py`, preserving existing definitions and
disabled states. Native designer page control is separate: it edits local
designer state and requires confirmation to create a new draft; creation does
not publish it.

As of 0.3.17, conditional workflow routing pins the execution path at start;
parallel/join gateways are rejected by validation. Current-node field policies
restrict record visibility and workflow snapshots, without implying in-node
business field editing. See the [current capability audit](../reference/business-form/README.md).

New form logic should be implemented in the relevant service and called by
adapters. Do not copy business validation or physical DDL into an AI handler,
and import shared schemas/serializers from services rather than `app.api.forms`.
Compatibility exports are retained for older callers. This change covers the
field, version, layout, and rule-preview paths; application navigation,
action/permission CRUD, and workflow-start compatibility helpers still live in
the HTTP module.

Regression coverage: `backend/tests/test_form_shared_services.py` exercises
real SQLite databases for dynamic and physical storage, HTTP/AI parity, batch
validation, field limits, tenant boundaries, registry dispatch, and AI creation.
PostgreSQL row-lock concurrency remains covered by the existing optional
`RECORD_TEST_DATABASE_URL` test environment.

## 2. Boundary

### Form Management Owns

- Form basic information:
  - form name
  - form code
  - bound business object / ontology object
  - target data source and form-managed storage configuration
  - status
  - owner
  - description
- Field structure:
  - display name
  - field code
  - storage key / physical column mapping
  - data type
  - length / precision
  - allow null
  - unique
  - indexing intent (general per-field index automation is not implied)
  - default value
  - relation target, when the field is a relation
  - base component type
  - field description
- Field usage flags:
  - list display
  - form entry
  - searchable

### Form Designer Owns

- Required-state configuration and immediate UI feedback; backend enforcement remains authoritative
- Placeholder text
- Field width and layout
- Form sections and grouping
- Conditional visibility
- Field linkage
- Advanced validation rules
- Option source details
- Button layout
- Field-level interaction details
- Fine-grained field permission behavior

Important distinction:

```text
allow null = storage/schema intent
required = runtime input constraint, checked by the backend as well as the UI
```

Form Management may configure structural intent such as field code, data type,
and whether a value may be empty. The current runtime validation is enforced by
shared services before writing JSON or physical-table records. Managed drafts
can use partial validation; submission and other lifecycle operations enforce
their corresponding requirements.

## 3. Recommended Two-Column Layout (UX Design)

Form Management should stay as a two-column management page.

```text
+----------------------+--------------------------------------------+
| Form list            | Form basic information                     |
| narrow selector      | ------------------------------------------ |
| icon + name + summary| Field structure / database field metadata  |
+----------------------+--------------------------------------------+
```

### Left Column

The left column is only for selecting a form. Keep it narrow, roughly 260-300px.

Each item should use the same compact visual language as the application assembly list:

```text
[icon] Device Health Form
       Device / equipment
       8 fields    Published
```

The list should avoid heavy actions and detailed configuration. It should answer:

- What form is this?
- What business object or data source does it map to?
- How many fields does it have?
- What is its status?

### Right Column

The right column contains two stacked sections.

```text
Top: form basic information
Bottom: fields
```

The top section is the current form's identity and binding. The bottom section is the current form's data structure.

## 4. Field Table (UX Design)

The field table should prioritize metadata design and generated CRUD behavior.

Suggested columns:

```text
Field label
Field code
Storage key
Data type
Length / precision
Allow null
Unique
Indexed
Component
List
Form
Search
```

Example:

```text
Field label   Field code    Type      Length   Allow empty   Unique intent   Indexed intent   Component   List   Form   Search
Device name   name          string    100      No            No              Yes              Text        Yes    Yes    Yes
Device code   code          string    64       No            Yes             Yes              Text        Yes    Yes    Yes
Health score  health_score  decimal   5,2      Yes           No              No               Number      Yes    Yes    No
Status        status        enum      -        No            No              Yes              Select      Yes    Yes    Yes
```

## 5. Actions (UX Design)

Recommended actions for Form Management:

- Sync fields: import or refresh field definitions from an existing data source, ontology object, or supported physical table bindings.
- Add field: create a new metadata-backed field.
- Enter form designer: open the later design surface for layout, validation, linkage, and richer interaction rules.
- Save configuration: persist form basic information and field structure.

The action meanings:

```text
Sync fields        -> structural metadata import / refresh
Add field          -> field metadata creation
Enter form designer -> UI layout and interaction design
Save configuration -> persist structure metadata
```

## 6. Relationship With Application Assembly

Form Management creates and maintains reusable business forms.

Application Assembly decides which forms are available in an application and how they appear in that application's navigation.

```text
Form Management    -> defines the form and its data structure
Application Management -> defines the application identity and access surface
Application Assembly   -> binds forms to applications and organizes menu entries
Form Designer      -> configures form layout and interaction details
```

This keeps the mental model clean:

```text
Form Management = define configurable business objects
Form Designer = design how users work with those objects
Application Assembly = place those objects into applications
```

## 7. Lifecycle

See also: `docs/architecture/configuration-lifecycle.md`.

Current implementation:

- `form_versions.py` owns preview, publication, draft restoration, and version
  reads; `form_runtime.py` resolves the latest published field snapshot.
- Publication checks existing record compatibility and design errors, promotes
  configuration, synchronizes published permissions, and saves a new version.
- Draft restoration restores design configuration and saved defaults; it does
  not delete business records or recreate the entire schema.
- Physical form creation and field additions may execute DDL before publication.
  Archiving a field does not drop its physical column.
- AI business-form creation uses the same publication operation with deferred
  commit; analysis-form creation retains its draft path.

The following state/action model is **product design guidance**, not a guarantee
that every transition or deletion guard is implemented:

```text
draft -> published -> disabled -> archived
```

Recommended form actions:

Draft:

```text
Save draft
Publish
Delete draft
```

Published:

```text
Save low-risk metadata changes
Create change draft using the existing published version
Disable
Copy as new draft
```

Disabled:

```text
Enable
Archive
Save metadata
```

Form delete should be stricter than application delete:

```text
draft with no physical table and no app binding -> can delete
published -> cannot hard delete directly
has business records or physical table -> intended deletion restriction
used by application assembly -> cannot delete until unbound, or archive instead
```

For the current implementation, the rule is:

```text
Save design draft = persist draft configuration without publishing it
Publish = validate and save a runtime snapshot with published permissions
Add physical field = persist field metadata and provision its physical column
```

Physical table provisioning already exists. The current create/add-field paths
can perform DDL; do not describe every configuration write as metadata-only.
A future separate provisioning/review workflow would be a behavior change.

Product validation checklist (design guidance; current enforced checks live in
`form_definition.py` and its delegated validators):

- form name
- unique form code
- at least one field
- unique field codes
- valid and unique database column names
- supported field types
- valid form code and storage keys
- impact on existing records in either storage mode, when applicable

Before publishing a form, the UI should summarize metadata impact:

```text
Fields to add
Fields to modify
Fields to remove or hide
Required/empty-value behavior
Potential effect on existing dynamic records
```


## Independent component pages (2026-11-03, phase 1)

- Component canvases are integrated into existing business-form and dashboard
  creation and menu entries. New enabled forms initialize a blank canvas through
  `/pages/forms/:id/binding` with `blank=true`; existing bindings are never reset.
  `/pages` redirects to application/form assembly, with no separate page-library
  product entry. Internal `/pages/:code` links remain compatible. Existing
  `/dynamic/:id` entries and host visibility checks remain unchanged.
- Page definitions accept `widgets=[]` and an optional `sourceFormId`. Components
  can declare `dataBinding: {formId: ...}`. Missing bindings inherit the legacy
  page source. `schemaVersion` supports 1 and 2; historical snapshots remain
  readable without rewriting or migrating business record IDs.
- Unbound components may be saved in a draft but must be bound before publication.
  Blank pages can be published. Every bound source is checked for tenant ownership
  and publication; field references are validated against its own published schema.
- Runtime statistics are grouped by source and use the existing authorized record
  service. Global filters apply only to the default source. Current explicit
  interactions require matching sources; cross-source mappings are deferred.
- The component inspector binds sources individually and resets stale field
  references on a source switch. Removing components, including the last one,
  only updates the page definition and never removes business data.
- Definitions continue to use existing page JSON and immutable publication
  snapshots. This phase requires no SQL schema migration. Rollback to an old
  binary does not support newly created empty/multi-source definitions: retain
  the new reader or restore an older page snapshot, without deleting records.
- Page permissions do not grant data access. Each source and original record API
  still performs its own authorization. Shared data configuration editors, new
  permission models and workflow record links remain later phases.

- Embedded list components place authorized create/import/export actions in the
  component card header through a React portal. Their operation column, refresh
  button and duplicate count toolbar are omitted. Existing standalone record
  pages retain their controls; row-click detail/edit follows the source view.

- The component inspector exposes field entry and workflow configuration as a
  dedicated business tab. List, filter and permission configuration is accessed
  through page/component properties; embedded source tabs and context menus
  omit these duplicate entries. Standalone legacy editors retain their tabs.
  Embedded source navigation uses `requestedTab` and retains a stable
  `initialTab`, so tab changes do not reinitialize unsaved source drafts.
- `ensureListFilter` creates a source-bound, submit-mode filter immediately
  before its list and targets that list only; an existing matching filter is
  reused. Component count and source binding are validated before insertion.
- Embedded source editors measure available viewport height and resize the
  flow canvas with the inspector. This update changes no database schema.


### Component interaction and permission boundaries (phase 2)

- Filter `targetWidgetIds` may reference same-source record lists, metrics and
  charts. The frontend sends `filter_queries` keyed by filter component ID and
  `chart_values` keyed by the originating chart ID. The server derives targets
  from the published definition; arbitrary component IDs are rejected.
- Incoming filter predicates and chart selections intersect. Sources retain
  independent contributions, so clearing one chart never removes another
  chart's condition, even for the same field. Required filters gate lists and
  aggregates; keyword and field predicates reuse record-query matching over
  permission-projected rows before aggregation, without truncating the input.
- Page `roleIds` control entry. Optional widget `roleIds` further restrict
  component visibility; the server omits unauthorized component definitions,
  removes dangling links and excludes their statistics. Admins may preview all
  components. Widget roles do not grant source view/statistics/record access.
- Source policies remain authoritative for row scope, field read/write and
  workflow operations. Component list columns and actions may only narrow the
  published source view. These are presentation restrictions, not a replacement
  for source authorization on direct record endpoints.
- Queries are applied after one authorized read per source, sharing projected
  rows across its widgets. Forbidden filter fields fail the affected aggregate
  without exposing hidden values or blocking unrelated widgets.
- Storage stays in existing page JSON drafts and version snapshots. No SQL
  migration or business-record rewrite is needed. Older snapshots without widget
  roles remain readable; rolling back to a binary unaware of widget role policy
  requires restoring compatible page snapshots or retaining the new reader.
- Cross-source field mapping and list-selection broadcasts are not included in
  this phase; explicit interaction targets must use the same business source.

- Embedded source editors accept workspace portal targets for properties, header
  actions, footer actions and status. Form and workflow controls retain their
  original React ownership, draft state and authorization paths; only their DOM
  placement changes. The source toolbar and inner property grid column are omitted
  in this mode. Standalone source editors keep their existing controls.

### 页面与组件版本入口范围

页面配置标题栏的“页面版本管理”查询 `/pages/{code}/versions`，由服务端执行管理员与租户校验，返回整个页面的已发布配置快照。恢复操作将完整 definition 置入编辑草稿，可撤销，沿用保存时 revision 与发布校验；业务记录及共享来源表单和流程不随页面恢复。组件基本/数据页签继续提供各自的组件版本，录入/流程入口管理共享数据源版本。

### 筛选按钮权限组

`filterSettings.toolbarGroups` 保存查询和重置按钮权限组，适用对象沿用列表的角色、用户与组织匹配逻辑。运行页由服务端裁剪不匹配组，多个匹配组 actions 取并集；null 兼容旧页面的 query/reset，空数组隐藏两按钮。自动查询与回车同步遵守 query 开关，reset 独立控制。此处管理界面操作可用性，不替代来源行、字段及统计访问校验。筛选模板使用 filter 作用域隔离，发布时校验对象与角色归属。按钮组、按钮文字及行为属于组件基本版本，字段、必填与高级筛选归入数据版本。

### 筛选字段方案

`filterSettings.schemes` 保存方案 id、name、showKeyword、groups，组使用 columns 指定字段并沿用角色、用户和组织匹配逻辑。单方案最多 30 个字段，服务端投影可访问方案及其组，无可用方案时隐藏组件；多个可用方案通过页签切换。`filter_queries.schemeId` 指定方案，服务端校验字段范围，切换清空旧条件。null 兼容旧 filterFields 并以默认方案展示。方案属于数据页签版本，字段权限模板使用 filter-fields 范围，切换来源清理 schemes。
