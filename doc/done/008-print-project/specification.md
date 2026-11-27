# Print Projects

## Approval

Status: approved
Approved by: obrys
Approved on: 2026-11-26

## Purpose

Add "print projects" — reusable patterns that capture the filament consumption of a known print (a title, description, URL, and one or more filament types with expected grams) so that a real print can be entered into the spool ledger in one flow. Printing a project consumes the selected spools and records a *project print* that links the created spool events; the whole print can later be undone or redone from the project page.

## Scope

- New "Print projects" menu item and pages: a list, a detail page, and a print (consume) page.
- Print project creation, editing, archiving, unarchiving, and guarded deletion.
- The print flow: one spool selection per pre-defined filament type, an "other spools" dialogue, grams editing, and a confirmation that consumes the selected spools.
- A project prints section on the detail page with per-print undo/redo.
- Spool history integration: project-linked rows show the project link, hide undo/redo, and support click-through in both directions.
- New API operations and persistence tables (print projects, project prints, project type lines with grams, and a nullable project-print reference on the spool events table); exact paths, DTOs, and schema details are left to the implementation plan.
- Unit tests and Playwright e2e tests per the project's testing policy.

## Out Of Scope

- Authentication and authorization (none exist application-wide).
- New dashboard widgets — project prints count toward the existing 30-day consumption through their spool events; nothing new is added to the dashboard.
- Facet filtering on the print project list (only the archive toggle).
- Editing a project print after it is created.
- Changes to the existing per-spool consume/adjust flows, other than the spool-history row display for project-linked events.
- Printable labels and QR codes.
- Printing a project partially (skipping defined types) or printing several projects at once.

## Behavior

### List page

- The main navigation gains a "Print projects" item, after "Spools". Selecting it opens the print project list.
- Each row shows the title (linked to the detail page), a compact summary of the defined filament types with their grams, the effective date (archived date when archived, else the last enabled project print, else the creation date), an archived marker for archived projects, and row actions: Print, Edit, Archive/Unarchive, and Delete (only when available).
- A "show archived" toggle, off by default: archived projects are hidden unless it is enabled.
- A "new project" action opens the creation form.
- Rows are sorted by the effective date, newest first; ties break by title A–Z, then project ID.

### Creation and editing

- The form fields are: title (required), description (optional, multi-line), URL (optional), and one or more filament type lines, each with a filament type and grams (positive whole number). A filament type appears at most once per project.
- Creation is started from the list page; editing is started from the detail page and reuses the same form.
- An archived project cannot be edited; it must be unarchived first.
- Changing filament types or grams affects only future prints (the pre-filled values on the print page); existing project prints keep their recorded spools and grams. Changing title, description, or URL is reflected in the list, the detail page, and the spool-history references.

### Detail page

- Shows the title, the description, the URL (as a clickable link when present), the defined filament types with their grams, and the project prints section.
- Actions: Print, Edit, Archive, Unarchive, and Delete (only when available).
- The project prints section lists one row per project print: its date/time, the spools used with the grams consumed from each (each spool links to its spool detail with the related event highlighted), and an Undo action (for enabled prints) or Redo action (for undone prints). Undone prints are displayed as undone.

### Print flow

- The Print action (on the detail page and on list rows) opens the print page for that project.
- The print page shows one selection slot per defined filament type. Each slot lists that type's selectable spools (open and sealed, non-finished) and pre-fills the project's defined grams.
- Each slot has an "other spools" button that opens a dialogue listing all selectable spools (any type, non-finished) filterable by brand, material, type, and colour. Choosing a spool fills the slot with it, even if its type differs from the slot's; the grams stay pre-filled and remain editable.
- The same spool may be selected for several slots, with separate grams per slot.
- Confirming requires: a spool with at least 1 g in every slot, and for each spool the total grams across all of its slots must not exceed its current remaining balance. When violated, an error is shown, confirmation is disabled, and no spool is consumed.
- A sealed spool used in the print is opened by the print.
- On confirmation, a project print is created with the current date/time and one spool print event is created per selected spool with its entered grams; all events share the project print's date/time and reference it. The user returns to the project detail page, where the new print appears at the top of the project prints section, highlighted.

### Archive and unarchive

- Archiving requires a confirmation dialogue. It sets the project to archived with the current date/time. An archived project cannot be printed, edited, or have its prints undone or redone; unarchiving is its only available action.
- Unarchiving requires a confirmation dialogue. It clears the archived flag and the archived date/time, restoring the other actions.

### Delete

- Delete is available only when the project is archived and has no enabled project prints (no prints at all, or all prints undone).
- Deletion requires a confirmation dialogue. It removes the project, all of its project prints (including undone ones), and the linked spool events; spool balances and history remain consistent afterwards.

### Undo and redo of a project print

- Undo disables the project print and all of its linked spool events: the spool history rows appear as undone and the spool balances are restored.
- Redo re-enables the project print and its spool events. If the redo is rejected by a spool lifecycle guard, a clear error is shown and nothing changes (the print stays undone).

### Spool history integration

- A spool event created by a project print displays the print project's title as a link to the project detail page (with the relevant print highlighted), is visually distinguished from regular print rows, and has no undo/redo controls; undo/redo of project prints exists only on the project page.
- Undoing or redoing a project print updates the related spool history rows accordingly (visible vs. displayed as undone).

### API (behavioral level)

- Operations: list print projects (optionally including archived, with the specified sorting), read a print project (defined types with grams and its project prints), create, update, archive, unarchive, and delete (with the stated guards).
- Create a project print from a selection of spools and grams; undo and redo a project print.
- The spool event list exposes the project link for project-linked events.
- Standard error behavior applies: 404 for an unknown project or project print; 400 for rejected operations (printing/editing/undoing an archived project, over-balance, an unfilled slot, the delete guard, a rejected redo).
- Successful mutations broadcast a WebSocket change notification for the print-project resource; connected clients reload the relevant views.

## Rules And Edge Cases

- Effective list date: `ArchivedAt` when archived; otherwise the newest enabled project print; otherwise the creation date. Undone prints do not count; a project whose prints are all undone sorts by its creation date (until archived).
- A project has at least one filament type; a type appears at most once in a definition; grams are positive whole numbers.
- Title is required and limited to 256 characters; description is optional, multi-line, limited to 1,024 characters; URL is optional and limited to 1,024 characters.
- A project print is immutable once created; it can only be undone (and redone), never edited.
- The over-balance check sums all slots that use the same spool and compares against that spool's current remaining balance.
- One spool used in several slots produces several print events with the same date/time on that spool; the existing chronological tie-break order applies.
- Project prints are ordinary enabled print events: they lower remaining grams, update the spool's last-used time, and count toward the dashboard's 30-day consumption; undoing the print removes them from consumption again.
- Both the slot spool lists and the "other spools" dialogue exclude finished spools; the dialogue's facet filters follow the existing semantics (OR within a facet, AND across facets).
- Deleting a project removes its disabled (undone) print events as well; spool derived caches are re-evaluated so history and balances stay consistent.

## Acceptance Criteria

1. The navigation shows a "Print projects" item; selecting it opens the print project list, which is empty when no projects exist.
2. Creating a project with a title, a description, a URL, and one or more type + grams lines from the list page saves it, and the new project appears in the list with its title; creation is rejected with a visible validation error when the title is empty or when no filament type line is present.
3. The "show archived" toggle hides archived projects by default and shows them, marked as archived, when enabled.
4. With projects of known dates, the list shows the newest effective date (archived date when archived, else last enabled print, else creation) first; ties resolve by title A–Z, then project ID; undoing a project's newest print moves the project back to its creation-date position.
5. The detail page shows the title, the description, the URL as a clickable link, the defined filament types with grams, and the project prints section.
6. Editing a project (title, description, URL, adding or removing a type, changing grams) persists and is reflected on the detail page and in the list; existing project prints keep their recorded spools and grams.
7. The Print action, available from the detail page and from a list row, opens the print page with one slot per defined type; each slot lists the type's open and sealed non-finished spools with the defined grams pre-filled.
8. "Other spools" on a slot opens a dialogue listing all non-finished spools of any type, filterable by brand, material, type, and colour; choosing a spool of a different type fills the slot with the grams still pre-filled and editable.
9. The same spool can be selected for two slots with separate grams; after confirmation the spool's remaining grams are reduced by the sum of both amounts.
10. Confirmation is blocked with a visible error and no spool consumed when any slot has no spool or 0 g, or when the entered grams for a spool (summed across its slots) exceed its remaining balance.
11. Confirming a valid print reduces each selected spool's remaining grams by its consumed amount; each spool gains a history row showing the project title as a link with no undo control; the project detail gains a project print row at the top with the date/time and the spools with grams; a sealed spool used in the print becomes open.
12. Undoing a project print from the project prints section displays the print as undone, displays the related spool history rows as undone, and restores the spool balances; redo reverses this; when a redo is rejected by a spool lifecycle guard, an error is shown and the print stays undone.
13. A project-linked row in a spool's history links to the project detail page with the relevant print highlighted; a spool shown in a project print links to the spool detail page with the related event row highlighted.
14. Archiving via its confirmation dialogue marks the project archived, makes Print, Edit, and undo/redo unavailable, and removes the project from the default list (it appears via the toggle and sorts by its archived date); unarchiving via its confirmation dialogue restores the actions.
15. Delete is available only for archived projects with no enabled prints; after its confirmation dialogue, the project, all of its prints (including undone ones), and the linked spool history rows are gone, and the affected spools' balances remain consistent.
16. A project print's consumption is included in the dashboard's 30-day consumed figure; undoing the print removes it again.
17. A print-project change made from another browser (for example, creating a project or confirming a print) is reflected in a connected SPA without a manual refresh.

## Constraints And Dependencies

- Existing spool lifecycle rules apply to project prints, with one deliberate exception: a project print auto-opens a sealed spool at the print's date/time (the application's existing rule for a print encountered while sealed moves into normal flow).
- Print projects and project prints are identified by UUID v7; no short display IDs are introduced.
- Persistence: new tables for print projects, project prints, and project type lines (type + grams), plus a nullable project-print reference on the spool events table; EF Core migrations run at API start as today.
- Testing policy (`doc/spec/operations.md`): unit tests for the new domain logic and Playwright e2e tests for the user-visible behavior above; the implementation plan maps each acceptance criterion to tests.
- The WebSocket change feed gains the print-project resource.

## Decisions

1. List sorting: newest first by one composite key (`ArchivedAt` when archived, else newest enabled project print, else creation date); ties by title A–Z, then project ID; undone prints do not count.
2. Deletion: only for archived projects with no enabled project prints; cascades to all prints (including undone) and their spool events; requires a confirmation dialogue.
3. An archived project is read-only except for unarchiving: no printing, no editing, no undo/redo of its prints.
4. Unarchiving requires a confirmation dialogue, like archiving.
5. Selectable spools in the print flow: all non-finished spools, including sealed ones (auto-opened by the print); finished spools are never selectable.
6. Print flow layout: one slot per pre-defined type; a slot may be filled with a spool of a different type via the "other spools" dialogue (brand/material/type/colour filters); grams stay pre-filled and editable.
7. No skipping: every pre-defined type must be given a spool with at least 1 g before confirming.
8. The same spool may back several slots in one print, with separate grams per slot.
9. Over-balance: an error that blocks confirmation, evaluated per spool across all of its slots.
10. Identifiers: UUID v7, no short user-visible IDs.

## Open Questions

None blocking. Left to the implementation plan within the bounds of this specification: exact route and URL parameter names for row highlighting, exact API paths and DTO shapes, the visual style of the distinguished spool-history row, and confirmation-dialogue wording.
