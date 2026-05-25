# Application Management Design Notes

Last updated: 2026-05-25

Status: design. This document defines product boundaries and recommended UI
behavior for application management; verify implemented behavior against
`frontend/src/pages/SystemAdmin`, `frontend/src/pages/AppPrograms`, and
`backend/app/api/applications.py`.

Scope: System Admin / Application Management

## 1. Positioning

Application Management configures the application itself. It should answer:

- What is this application?
- How does it appear in the product shell and application switcher?
- Who can see it?
- Where does the user land after entering it?

Application Management should not configure menu trees, form fields, form layout, workflow nodes, or report widgets. Those belong to adjacent configuration surfaces.

## 2. Boundary

### Application Management Owns

- Application identity:
  - application name
  - application code
  - icon
  - description
  - status
  - owner / team
  - sort order
  - pinned state
- Application entry:
  - default route
  - default entry, when menu-node-level defaults are supported
- Application visibility:
  - visible roles
  - optional organization / factory scope
- Application shell presentation:
  - how the application appears in the app list
  - how it appears in the application switcher

### Application Assembly Owns

- Which forms are available inside the application
- How those forms are organized into menu groups
- Menu node ordering
- Menu node visibility
- Form menu entries
- Application-form binding aliases and runtime data scopes

### Other Surfaces Own

- Form field structure: Form Management
- Form layout, validation, linkage, and interaction: Form Designer
- Workflow stages and approval rules: Workflow Configuration
- Role definitions and permission primitives: Role Management
- Report and dashboard widgets: Report Center / Page Designer

## 3. Recommended Two-Column Layout

Application Management should stay as a two-column management page.

```text
+---------------------------+-----------------------------------------+
| Application list          | Application basic information           |
| narrow selector           | --------------------------------------- |
| icon + name + summary     | Access, entry, and shell presentation   |
+---------------------------+-----------------------------------------+
```

### Left Column

The left column is only for selecting an application. Keep it narrow, roughly 260-300px.

Each item should use the same compact visual language as the form list and application assembly list:

```text
[icon] Supply Chain Risk
       supply-chain-risk
       Published    Pinned
```

The list should answer:

- What application is this?
- What is its internal code?
- What is its status?
- Is it pinned or otherwise emphasized?

Avoid detailed configuration controls in the list itself.

### Right Column

The right column should contain two stacked sections.

```text
Top: application basic information
Bottom: access and entry configuration
```

The top section defines the identity of the application. The bottom section defines how users enter and access it.

## 4. Application Basic Information

Recommended fields:

```text
Application name
Application code
Icon
Description
Status
Owner / team
Sort order
Pinned
```

Field meanings:

- `name`: user-facing application name.
- `code`: stable internal identifier.
- `icon`: visual identity used in the sidebar, app switcher, and workbench cards.
- `description`: short explanation shown in the app switcher or app card.
- `status`: draft, published, or disabled.
- `owner / team`: business or platform owner.
- `sort_order`: ordering in application lists.
- `is_pinned`: whether the application is emphasized in the workbench or app switcher.

The icon field should be visual, not a plain string input. The user should see both icon and label:

```text
[icon] Dashboard
[icon] Tool
[icon] Quality
[icon] Supply Chain
[icon] Application
```

## 5. Access And Entry

Recommended fields:

```text
Visible roles
Default route
Default menu entry, when supported
Application scope
```

Field meanings:

- `visible_roles`: roles that can see or enter this application.
- `default_route`: route opened when the user enters the application.
- `default_menu_entry`: menu node opened or highlighted by default, if the menu model supports it.
- `application_scope`: optional business scope such as all factories, current factory, or selected organization.

The distinction between route and menu entry matters:

```text
default_route = navigation target
default_menu_entry = preferred node inside the assembled application menu
```

If the current data model only supports `default_route`, keep `default_menu_entry` as a future design note.

## 6. Preview

The right panel should include a small application preview, so users can immediately understand the effect of changing name, icon, description, status, or pinned state.

Example:

```text
[icon] Supply Chain Risk
Supplier, material, and delivery risk monitoring
Status: Published
Pinned: Yes
```

This preview should resemble how the application appears in the left list, app switcher, or workbench card.

## 7. Relationship With Other Modules

The intended product boundary is:

```text
Application Management = define application identity, entry, and visibility
Application Assembly = bind forms to applications and organize menus
Form Management = define data objects and database-backed fields
Form Designer = design how users enter and edit those objects
Role Management = define roles and permission primitives
```

This keeps Application Management focused. It defines the shell and access surface, while Application Assembly defines the application's internal content.

## 8. Lifecycle

See also: `docs/architecture/configuration-lifecycle.md`.

Application Management should use the shared configuration lifecycle:

```text
draft -> published -> disabled -> archived
```

Recommended application actions:

Draft:

```text
Save draft
Publish
Delete draft
```

Published:

```text
Save low-risk changes
Disable
Copy as new draft
```

Disabled:

```text
Enable
Archive
Save metadata
```

Application delete should be conservative:

```text
draft with no dependent runtime usage -> can delete
published -> cannot hard delete directly
disabled -> can archive
with menu/form bindings -> require cleanup or archive
```

Publishing an application should validate:

- application name
- unique application code
- valid icon
- valid default route
- visible roles, or explicit authenticated-user visibility

Disabling an application should remove it from normal runtime entry points, while preserving menu structure, form bindings, and audit history.
