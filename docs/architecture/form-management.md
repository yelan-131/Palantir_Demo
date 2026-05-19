# Form Management Design Notes

> Updated: 2026-05-19
> Scope: System Admin / Form Management

## 1. Positioning

Form Management is not only a visual form list. In this product it is the structural management entry for business data objects.

The working definition is:

```text
Business form = data table structure + generated CRUD entry + later form designer surface
```

Form Management owns the data structure and field metadata. Form Designer owns layout, interaction, validation, linkage, and detailed user experience.

## 2. Boundary

### Form Management Owns

- Form basic information:
  - form name
  - form code
  - bound business object / ontology object
  - target data source or generated database table
  - status
  - owner
  - description
- Field structure:
  - display name
  - field code
  - database column name
  - data type
  - length / precision
  - allow null
  - unique
  - indexed
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
allow null = database structure rule
required = UI validation rule
```

Form Management may configure `allow null`, because it affects table design. It should not configure `required`, because that belongs to the later form design experience.

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

The field table should prioritize database design and generated CRUD behavior.

Suggested columns:

```text
Field label
Field code
Column name
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
Field label   Field code    Type      Length   Allow null   Unique   Indexed   Component   List   Form   Search
Device name   name          string    100      No           No       Yes       Text        Yes    Yes    Yes
Device code   code          string    64       No           Yes      Yes       Text        Yes    Yes    Yes
Health score  health_score  decimal   5,2      Yes          No       No        Number      Yes    Yes    No
Status        status        enum      -        No           No       Yes       Select      Yes    Yes    Yes
```

## 5. Actions

Recommended actions for Form Management:

- Sync fields: import or refresh field definitions from an existing data source, ontology object, or database table.
- Add field: create a new database-backed field.
- Enter form designer: open the later design surface for layout, validation, linkage, and richer interaction rules.
- Save configuration: persist form basic information and field structure.

The action meanings:

```text
Sync fields        -> structural import / refresh
Add field          -> database field creation
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
Form Management = define data objects
Form Designer = design how users work with those objects
Application Assembly = place those objects into applications
```

## 7. Lifecycle

See also: `docs/architecture/configuration-lifecycle.md`.

Form Management should use the shared configuration lifecycle, but with stricter database-impact rules:

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
has physical table or data -> cannot hard delete
used by application assembly -> cannot delete until unbound, or archive instead
```

For forms, the recommended database rule is:

```text
Save draft = save metadata only
Publish = create or migrate database structure
```

Publishing a form should validate:

- form name
- unique form code
- at least one field
- unique field codes
- valid and unique database column names
- supported field types
- valid generated table name or target table binding
- confirmed database-impacting settings

Before publishing a form, the UI should summarize database impact:

```text
Table to create/update
Fields to add
Fields to modify
Indexes to create
Unique constraints to create
Nullable changes
```
