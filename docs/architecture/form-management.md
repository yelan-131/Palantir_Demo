# Form Management Design Notes

Last updated: 2026-05-25

Status: design plus current implementation notes. Form metadata and runtime
records are implemented under `/api/v1/forms`; physical table generation is a
future reviewed workflow.

Scope: System Admin / Form Management

## 1. Positioning

Form Management is not only a visual form list. In this product it is the structural management entry for configurable business data objects.

The working definition is:

```text
Business form = form metadata + generated CRUD entry + dynamic record storage
```

Form Management owns the data structure and field metadata. Form Designer owns layout, interaction, validation, linkage, and detailed user experience.

Current implementation note: forms and fields are persisted as metadata under
`/api/v1/forms`. Records are stored in `dynamic_records.data` as JSON/JSONB.
Creating or publishing a form does not currently create or alter a physical
business table.

## 2. Boundary

### Form Management Owns

- Form basic information:
  - form name
  - form code
  - bound business object / ontology object
  - target data source or future physicalization target, if supported
  - status
  - owner
  - description
- Field structure:
  - display name
  - field code
  - storage key / future database column name
  - data type
  - length / precision
  - allow null
  - unique
  - indexed intent, when future physicalization supports it
  - default value
  - relation target, when the field is a relation
  - base component type
  - field description
- Field usage flags:
  - list display
  - form entry
  - searchable

### Form Designer Owns

- Required validation in the UI
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
required = UI validation rule
```

Form Management may configure structural intent such as field code, data type,
and whether a value may be empty. The current runtime validation is enforced by
the forms API before writing JSON records.

## 3. Recommended Two-Column Layout

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

## 4. Field Table

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

## 5. Actions

Recommended actions for Form Management:

- Sync fields: import or refresh field definitions from an existing data source, ontology object, or future physical table binding.
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

Form Management should use the shared configuration lifecycle. Database-impact rules apply only when a future physicalization workflow exists:

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

Form delete should be stricter than application delete:

```text
draft with no physical table and no app binding -> can delete
published -> cannot hard delete directly
has dynamic records or future physical table -> cannot hard delete
used by application assembly -> cannot delete until unbound, or archive instead
```

For the current implementation, the rule is:

```text
Save draft = save metadata only
Publish = make metadata available to runtime pages
```

Future physical table generation should be a separate reviewed action, not an
implicit side effect of saving or publishing a form.

Publishing a form should validate:

- form name
- unique form code
- at least one field
- unique field codes
- valid and unique database column names
- supported field types
- valid form code and storage keys
- confirmed impact on existing dynamic records, when applicable

Before publishing a form, the UI should summarize metadata impact:

```text
Fields to add
Fields to modify
Fields to remove or hide
Required/empty-value behavior
Potential effect on existing dynamic records
```
