# Configuration Lifecycle Design Notes

Last updated: 2026-05-25

Status: design. This document defines recommended lifecycle rules for
configurable assets. Current implementation details should be verified against
the relevant API and UI modules.

Scope: Application Management, Form Management, Application Assembly

## 1. Positioning

Applications and forms are configurable product assets. They should not be treated like ordinary records that can always be overwritten or hard-deleted.

The lifecycle model should make these operations explicit:

- create
- save
- publish
- disable
- archive / delete

The core principle:

```text
Create = create a draft
Save = persist draft/configuration changes
Publish = make the asset effective
Disable = stop runtime usage while preserving history
Delete = only for unused drafts or otherwise safe cases
```

## 2. Status Model

Recommended statuses:

```text
draft
published
disabled
archived
```

Status meanings:

- `draft`: editable configuration that is not yet effective for end users.
- `published`: active configuration visible in runtime surfaces.
- `disabled`: published asset is no longer available for normal use, but history and bindings are preserved.
- `archived`: hidden from normal management flows; retained for audit or recovery.

`archived` can be introduced later if the product does not need it immediately.

## 3. Create

Creating a new application or form should create a draft, not a published asset.

```text
Click New
-> create local draft / server draft
-> edit basic information
-> save draft
-> publish when ready
```

For forms, creating a draft should not create a physical business table. The current implementation stores form definitions as metadata and runtime data in `dynamic_records.data`.

## 4. Save

Save means persisting configuration changes.

Recommended behavior:

```text
draft       -> Save draft
published   -> Save change draft or save non-structural configuration, depending on versioning support
disabled    -> Save configuration
archived    -> read-only by default
```

For the first implementation, published assets may allow direct save for low-risk metadata. Structural form changes should still be treated carefully.

Low-risk examples:

- application description
- icon
- sort order
- pinned state
- owner

High-risk examples:

- form field code
- storage key / future database column name
- field type
- allow null
- unique
- indexed

High-risk changes should require a stronger confirmation or a later versioning/migration workflow.

## 5. Publish

Publishing moves a draft into runtime use.

```text
draft -> published
```

Application publish checks:

- application name is present
- application code is present and unique
- icon is valid
- default route is valid
- visible roles are configured, or the application is explicitly public to authenticated users

Form publish checks:

- form name is present
- form code is present and unique
- at least one field exists
- field codes are unique
- storage keys are valid and unique
- field types are supported
- layout/action/permission metadata is valid
- existing dynamic-record impact is understood when changing published forms

For forms, publish currently makes metadata available to runtime pages. Physical table creation or migration is a future separate, reviewed workflow.

## 6. Disable

Disable stops normal runtime usage while preserving configuration and history.

```text
published -> disabled
```

Application disable behavior:

- remove from app switcher and workbench by default
- keep application configuration
- keep menu structure
- keep form bindings
- keep audit history

Form disable behavior:

- prevent new runtime entries by default
- preserve existing data
- preserve application bindings but show disabled warnings
- allow read-only historical access if the business needs it

## 7. Delete And Archive

Hard delete should be conservative.

Application delete rules:

```text
draft with no dependent runtime usage -> can delete
published -> cannot hard delete directly
disabled -> can archive
with menu/form bindings -> require cleanup or archive
```

Form delete rules:

```text
draft with no physical table and no app binding -> can delete
published -> cannot hard delete directly
has dynamic records or future physical table -> cannot hard delete
used by application assembly -> cannot delete until unbound, or archive instead
```

For forms, hard delete should never silently drop business tables or data.

## 8. Recommended Actions By Status

Draft:

```text
Save draft
Publish
Delete draft
```

Published:

```text
Save low-risk changes
Create change draft, when versioning exists
Disable
Copy as new draft
```

Disabled:

```text
Enable
Archive
Save metadata
```

Archived:

```text
Restore, optional
View audit/history
```

## 9. Form Storage Impact

Form Management has stronger lifecycle rules than Application Management because it can affect runtime data capture and existing dynamic records.

Current rule:

```text
Save draft = save metadata only
Publish = make metadata available to runtime pages
```

Before publishing a form, the UI should summarize storage/metadata impact:

```text
Fields to add
Fields to modify
Fields to remove or hide
Validation changes
Potential effect on existing dynamic records
```

If a future physicalization feature is added, it must introduce a separate
database-impact review that lists tables, columns, indexes, constraints,
migrations, rollback, and data-retention behavior.

## 10. Button Model

Recommended primary actions:

Draft:

```text
[Save draft] [Publish] [Delete draft]
```

Published:

```text
[Save changes] [Disable] [Copy as draft]
```

Disabled:

```text
[Enable] [Archive]
```

For high-risk form structure changes:

```text
[Save draft] [Review database impact] [Publish]
```

