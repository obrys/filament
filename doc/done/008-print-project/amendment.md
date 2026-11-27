# Amendment — 008 Print Project

Refinement notes for `doc/todo/008-print-project/`. `README.md` remains the immutable original request.

## References consulted

- `README.md` (this directory) — original request: a "print projects" menu with a list (archive filter, last-printed sorting), detail page with title/description/URL and a "printed projects" section, print flow that selects a spool per pre-defined filament type (with an "other spools" filterable dialogue), project prints with undo/redo, archive/unarchive, and changes; plus expected technical details (new tables, nullable print-link on spool events, undo/redo disables/re-enables the linked spool events).
- `doc/spec/application-overview.md` — what the application manages, intended scale, trusted-LAN boundary.
- `doc/spec/domain-rules.md` — spool/event lifecycle, the legacy rule that a print found while sealed opens the spool at that event's timestamp, integer-gram weights, identifier conventions, undo/redo lifecycle guards, list sorting and filtering semantics.
- `doc/spec/interfaces.md` — browser routes and menu, spool event list (`projectName`/`projectUrl` on events), standard error behavior (404/400/409), WebSocket change notifications, label PDF behavior (unchanged).
- `doc/spec/architecture.md` — three-layer .NET backend, React SPA, EF Core migrations at API start.
- `doc/spec/operations.md` — testing policy: unit tests plus Playwright e2e for user-visible behavior; acceptance criteria must be browser-verifiable.
- `web/src/main.tsx` — current navigation items (Dashboard, Types, Spools) and SPA routes.
- `doc/done/006-onhover-legend/amendment.md` and `specification.md` — documentation conventions for refinement-stage documents.

## Questions asked and answered

1. **List sorting** (user): newest first, single descending key — `ArchivedAt` when archived, else the newest *enabled* project print, else creation date; undone prints do not count. Ties break by title A–Z, then project ID.
2. **Deletion** (user): a print project is deletable only when it **has no prints or all its prints are undone, and the project is archived** ("All prints are undone (or without prints) and print project is archived. Only then the print project can be deleted."). Deletion removes the project, all of its project prints (including undone ones), and the related spool events. A confirmation dialogue is required (follow-up question, answered "yes").
3. **Undo/redo while archived** (user): blocked — an archived project is read-only except for unarchiving (no printing, no editing, no undo/redo of its prints).
4. **Unarchive confirmation** (user): yes, a confirmation dialogue, same pattern as archiving.
5. **Selectable spools in the print flow** (user): any non-finished spool, **including sealed** — the print auto-opens a sealed spool. Finished spools are never selectable.
6. **Print flow layout** (user, confirmed): the print page shows one selection slot per pre-defined filament type; each slot lists that type's selectable spools with the defined grams pre-filled; "other spools" opens a dialogue filterable by brand, material, type, and colour, and may fill the slot with a spool of a **different** type (grams stay pre-filled and editable).
7. **Skipping a type** (user): no — every pre-defined filament type must be given a spool with at least 1 g before a print can be confirmed.
8. **Same spool for two types** (user): yes, the same physical spool may be selected for two slots in one print, with separate grams per slot.
9. **Over-balance** (user): an entered amount above the spool's remaining balance is an error and blocks confirmation. Because one spool may back multiple slots, the check applies to the **total grams across all of the spool's slots** versus its remaining balance.
10. **Identifiers** (user): no short display IDs. Print projects use a **GUID (UUID v7)** as the internal identifier.
11. **Delete confirmation** (user, follow-up): yes, a confirmation dialogue, like archiving.
12. **Delete while archived** (user, follow-up): refinement of the delete condition — the project must be archived *and* have no enabled prints (see 2).

## Assumptions recorded

- Project prints also get UUID v7 identifiers.
- A project print's date/time is the confirmation time (UTC, "now"); all spool events created by that print share the same `occurredAt` as the project print.
- Undoing a project print disables the print record **and** all its linked spool events together; redo re-enables them. If a redo is rejected by a spool lifecycle guard (e.g., the spool's `Opened` event was undone in the meantime), a clear error is shown and nothing changes (the print stays undone).
- Spool history: an event created by a project print displays the print project's title as a link (to the project detail with the relevant print highlighted), is visually distinguished from regular print rows, and has no undo/redo controls (undo/redo lives only on the project page).
- The print project list has only the "show archived" toggle (no facets); a list row shows the title, a compact summary of the defined types with grams, the effective date (archived date / last enabled print / creation date), an archived marker, and the row actions.
- The detail page also shows the defined filament types with grams (required for the edit form and the print pre-fill).
- After confirming a print, the user returns to the project detail page, where the new print appears at the top of the project prints section, highlighted.
- Project prints are ordinary enabled `Print` events: they lower remaining grams, update the spool's `lastUsedAt`, and count toward the dashboard's 30-day consumption; undoing the print removes them from consumption again. No new dashboard element.
- WebSocket change notifications are broadcast for print-project mutations, and connected SPA clients reload the relevant views, consistent with existing behavior.
- Field limits follow existing conventions: title required and ≤ 256 characters; description optional, multi-line, ≤ 1,024 characters; URL optional, ≤ 1,024 characters.
- All grams are positive whole numbers. A project defines at least one filament type; a type appears at most once in a project's definition.
- The "other spools" dialogue lists non-finished spools of any type and excludes finished ones; its facet filters follow the existing semantics (OR within a facet, AND across facets).
- New routes: `/print-projects` (list), `/print-projects/{id}` (detail), and a print page under the project; the menu item label is "Print projects", placed after "Spools".
- Deleting a project also removes its disabled (undone) print events; spool derived caches remain consistent afterwards.

## Open decisions

- None blocking. Left to the implementation plan within the bounds of the specification: exact route/URL parameter names for row highlighting, exact API paths and DTO shapes, the visual style of the distinguished spool-history row, and confirmation-dialogue wording.
