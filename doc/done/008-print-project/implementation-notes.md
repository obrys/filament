# Implementation Notes: Print Projects (008)

## Status

Status: complete

## Outcome

Print projects are implemented end to end: a "Print projects" menu (after "Spools") with a
list page (create form, show-archived toggle, effective-date ordering, archive/delete row
actions), a detail page (description/URL/types/prints section, print-edit-archive controls,
two-way highlighting), and a print page (one slot per defined type, "Other spools" dialogue
with the four facet filters, live validation, confirm). Project prints consume spools through
the existing lifecycle (a still-sealed spool is opened by an explicit, unlinked `Opened`
event at the print's timestamp), appear in spool history as distinguished project-linked rows
without undo controls, support undo/redo from the project page, feed the dashboard
consumption figure, and broadcast over the WebSocket change feed as the `print-project`
resource.

During the e2e stage one implementation defect was found and fixed: `PrintProjectPrint`'s
`load()` set `project` and then awaited further fetches before setting `slots`, so React
flushed the project early and rendered `slots[i].spoolId` against an empty array, crashing
the whole app on the print route. `load()` now fetches everything first and applies all
state in one batched update (see Deviations).

After the implementation was reviewed, several reported issues were fixed in a follow-up
round on the same branch:

1. **Sealed-spool opening is its own event.** A project print no longer relies on the
   legacy sealed-print evaluation rule; `PrintProjectRules.PlanPrint` now emits an explicit,
   ordinary `Opened` event (0 g, unlinked) for every spool that is still sealed. Undoing or
   redoing the print never touches the opening, and the user can undo the opening
   separately on the spool page. `SpoolLifecycle.PlanConsume` lost its `allowSealed`
   parameter entirely.
2. **One print event per slot.** A spool used by several slots gets one `Print` event per
   slot (same date/time) instead of one summed event.
3. **Project-linked events cannot be toggled individually.** The spool
   `disable`/`enable` endpoints reject project-linked events with `400`; undo/redo of a
   project print exists only on the project page.
4. **Type deletion is restricted, not cascading.** The `print_project_types.FilamentTypeId`
   FK changed from cascade to restrict (new migration); deleting a filament type used by a
   project definition is rejected with `409` — the project must be archived and deleted
   first.
5. **Spool deletion is guarded.** `DELETE /api/spools/{id}` is rejected with `409` while
   the spool has any active event other than `Created` (the rule the UI already applied);
   when allowed, deleting the spool also removes its undone project prints as a whole —
   including their undone events on other spools, which are re-evaluated — and notifies
   both the `spool` and `print-project` resources.
6. **Malformed bodies.** Print-project create/update bodies with missing type lines and
   print bodies with a missing/null spool selection are rejected with `400` before
   dereferencing.

New e2e coverage for the round lives in `e2e/tests/print-project-integrity.spec.ts` (6
tests), plus one more `AC-12` test in `print-project-print.spec.ts` (the opening is its
own event; undo keeps it, redo works).

## Acceptance Criteria Evidence

All evidence below is from the final runs of 2026-11-27 on the branch tip (after the
follow-up fix round); the 2026-11-26 runs listed in Verification were superseded when the
fix round changed behavior. The full e2e run captured screenshots, videos, and traces
under `e2e/test-results/` (per-test directories, e.g. `print-projects-AC-1-...-chromium/`,
`print-project-print-AC-7-...-chromium/`, `print-project-integrity-...-chromium/`).

| Criterion | Evidence |
|---|---|
| AC-1 — "Print projects" nav item after Spools; empty list state | e2e `print-projects.spec.ts` › "AC-1: Print projects nav item after Spools, empty list state" — asserts the nav order (`Print projects` immediately after `Spools`) and the "No print projects here" empty state with zero rows. Passed. |
| AC-2 — create via the form; visible rejection of empty title / no type line | e2e "AC-2: create via the form; empty title and no type line are rejected visibly" — with the type line filled, an empty title shows "Title is required." and disables submit; removing the only line shows "Add at least one filament type." and disables submit, and no project is created; a valid create lands the "Benchy v3" row. Unit `PrintProjectRulesTests.ValidateDefinition_*` covers limits, duplicates, and grams. Passed. |
| AC-3 — show-archived toggle | e2e "AC-3: archive hides the project by default, shows it archived via the toggle" — archiving removes the row from the default list; enabling the toggle shows it with the "Archived" marker. Passed. |
| AC-4 — effective-date ordering, title tie-break, undo falls back to creation date | e2e "AC-4: effective-date order with title tie-break; undo falls back to creation date" — five projects with known dates render `PC, PB, Alpha, Beta, PA` (tied Alpha/Beta by title); undoing PB's only print re-sorts to `PC, Alpha, Beta, PA, PB`. Unit `PrintProjectRulesTests.EffectiveDate_*` / `Compare_*` cover the composite key. Passed. |
| AC-5 — detail page content | e2e "AC-5: detail shows title, description, external URL link, types with grams, prints section" — h1 title, description, the URL as an external (`target=_blank`) link, both types with `120 g` / `80 g`, and the "Project prints" section with the seeded print. Passed. |
| AC-6 — edits persist and reflect; existing prints unchanged | e2e "AC-6: edit persists, reflects in list and detail, existing prints unchanged" — after the edit the API reports the new title/description/URL and both type lines (60 g / 25 g), the pre-existing print keeps its 100 g, and the list shows the new title. Passed. |
| AC-7 — print page slots from detail and list | e2e "AC-7: print page has one slot per type with that type open+sealed spools and pre-filled grams" — one slot per defined type (AlphaBrand / BetaBrand headers); the TA slot lists exactly the open `SA` and sealed `SB` (finished `SC` absent), the TB slot only `SD`; grams pre-filled `100` / `50`; reachable both from the detail page and a list row. Passed. |
| AC-8 — "Other spools" dialogue with facet filters | e2e "AC-8: other-spools dialogue lists all non-finished spools, facet-filters, fills a different-type slot" — the dialogue lists `SA, SB, SD` (finished excluded); the Brand filter narrows to `SD`; picking it fills the TA slot (out-of-list selection chip), grams still pre-filled (`100`) and editable (`80`). Passed. |
| AC-9 — same spool in two slots sums grams | e2e "AC-9: same spool in two slots consumes the sum of both slots" — `SA` backs both slots (100 g + 50 g); after confirmation `SA` drops to 850 g, `SD` is untouched, and the project has one print. Unit `PrintProjectRulesTests.PlanPrint_SameSpoolTwoSlots_SumsGrams`. Passed. |
| AC-10 — blocked confirmation, nothing consumed | e2e "AC-10a: unfilled slot and 0 g slot block confirmation visibly, nothing consumed" ("Give a spool to every filament type before printing." / "Every spool must get at least 1 g.", confirm disabled, balances unchanged) and "AC-10b: summed over-balance across a spool slots blocks confirmation, nothing consumed" (1100 g entered vs "only 1000 g remaining", nothing consumed). Unit `PrintProjectsControllerTests` print-guard 400s. Passed. |
| AC-11 — valid print consumes, links rows, sealed spool opens | e2e "AC-11: valid print consumes both spools, links history rows, sealed spool opens" — `SB` 900 g / `SD` 950 g, sealed `SB` reports status `Open`; the detail gains the print row on top with both spools and grams; each spool's history gains one `event--project` row linking the title with no undo/redo control. Unit `PrintProjectRulesTests.PlanPrint_*` sealed-open cases. Passed. |
| AC-12 — undo/redo; rejected redo keeps the print undone | e2e "AC-12: undo/redo of a project print; a rejected redo keeps the print undone" — undo marks the print and the spool rows undone and restores 1000 g balances; redo reverses (900/950 g); after undoing the spool's Opened event, redo is rejected with the "Open the spool…" error, the print stays undone, and balances are unchanged. e2e "AC-12: the opening of a sealed spool is its own event; undo keeps it, redo works" — the print's undo/redo never touches the independent `Opened` event, and a separately undone opening blocks the redo with a clear error. Unit `PrintProjectRulesTests.EnsureNotArchived_*` and `PrintProjectsControllerTests` rejected-redo test. Passed. |
| AC-13 — two-way click-through with highlighting | e2e "AC-13: two-way click-through with row highlighting" — the spool history's project link carries `?highlight=<printId>` and the project detail highlights that print row; the project print's spool link carries `?highlight=<eventId>` and the spool detail highlights that event row. Passed. |
| AC-14 — archive hides actions, sorts by archived date; unarchive restores | e2e "AC-14: archive hides actions and re-sorts by archived date; unarchive restores" — after the confirm, Print/Edit/Undo are gone (Unarchive remains); the project leaves the default list and, via the toggle, sorts first by its archived date; unarchiving restores the actions. Passed. |
| AC-15 — delete only for archived without enabled prints; cascade consistent | e2e "AC-15: delete only for archived without enabled prints; cascade keeps balances consistent" — the delete control is disabled with an explanatory title while not archived and while a print is enabled; after undo + archive it enables, and on confirm the project 404s, the linked spool row is removed, and the spool's balance is back to 1000 g. Unit `PrintProjectRulesTests.EnsureDeletable_*` and `PrintProjectsControllerTests` delete tests. Passed. |
| AC-16 — dashboard consumption includes the print; undo removes it | e2e "AC-16: a print is in the current-day dashboard consumption; undo removes it" — after confirming a 100 g + 50 g print, `/api/dashboard/usage?days=30`'s current day reports 150 g consumed; undoing the print brings it back to 0. Passed. |
| AC-17 — change feed across browsers | e2e "AC-17: a create in one context appears in another without reload" — a project created in one Playwright context appears in a second context's list within the change-stream window without any manual refresh. Passed. |
| Fix round — follow-up issues (not spec ACs) | e2e `print-project-integrity.spec.ts` (6 tests): project-linked events rejected by the spool disable/enable APIs; spool deletion blocked while active events exist and enabled after undoing them; spool deletion blocked with an enabled project print; deleting a spool removes its undone project prints and their events on other spools; type deletion blocked while a project lists the type; malformed print/project bodies rejected with 400. All passed. |

## Changes Made

New files:

- `src/Filament.Core/Domain/PrintProject.cs` — `PrintProject`, `PrintProjectType`, `ProjectPrint` domain types.
- `src/Filament.Core/Services/PrintProjectRules.cs` — pure rules: `EffectiveDate`, `Compare`, `ValidateDefinition`, `EnsureNotArchived`, `EnsureDeletable`, `ValidateSelection`, `PlanPrint` (returns a `ProjectPrintPlan` with independent `OpenEvents` and linked `PrintEvents`).
- `src/Filament.Api/Controllers/PrintProjectsController.cs` — list/get/create/update/archive/unarchive/delete + print/undo/redo endpoints; `print-project` change-feed notifications (plus `spool` notifications on print-affecting operations); `400` guards for malformed bodies.
- `src/Filament.Infrastructure/Persistence/Migrations/20261126110848_AddPrintProjects.cs` (+ `.Designer.cs`) — `print_projects`, `print_project_types`, `project_prints`, and `spool_events.ProjectPrintId` (nullable, restrict) with index.
- `src/Filament.Infrastructure/Persistence/Migrations/20261127093836_RestrictPrintProjectTypeFilamentTypeDelete.cs` (+ `.Designer.cs`) — `print_project_types.FilamentTypeId` FK from cascade to restrict (fix round).
- `tests/Filament.Core.Tests/Services/PrintProjectRulesTests.cs` — 35 unit tests over the rules above.
- `tests/Filament.Api.Tests/PrintProjectsControllerTests.cs` — 28 controller tests with in-memory fakes, including the guard 400s, the malformed-body 400s, and spool-event project-link resolution.
- `web/src/components/ProjectForm.tsx` — shared create/edit form with client-side mirror of the validation.
- `web/src/pages/PrintProjects.tsx`, `web/src/pages/PrintProjectDetail.tsx`, `web/src/pages/PrintProjectPrint.tsx` — the three pages.
- `e2e/tests/print-projects.spec.ts` (9 tests), `e2e/tests/print-project-print.spec.ts` (10 tests), and `e2e/tests/print-project-integrity.spec.ts` (6 tests, fix round) — the Playwright coverage mapped in the plan's test matrix plus the follow-up integrity tests.

Modified files:

- `src/Filament.Core/Domain/SpoolEvent.cs` — `ProjectPrintId`.
- `src/Filament.Core/Identifiers/IdentifierGenerator.cs` — `NewProjectId()` / `NewProjectPrintId()` (UUIDv7).
- `src/Filament.Core/Services/SpoolLifecycle.cs` — unchanged consume semantics for regular events; the fix round removed the `allowSealed` parameter from `PlanConsume` (a sealed spool must be opened first; the project print flow adds the `Opened` event itself).
- `src/Filament.Core/Abstractions/IRepositories.cs` — `PrintSelection`, `SpoolWithEvents`, `IPrintProjectRepository`.
- `src/Filament.Infrastructure/{Entities/Entities.cs, Persistence/FilamentDbContext.cs, Mapping/EntityMapping.cs, Repositories/Repositories.cs, ServiceCollectionExtensions.cs}` and the model snapshot — entities, EF modeling (unique project/type, cascade project→prints, restrict events→print, restrict type-line→filament-type), `PrintProjectRepository`, DI registration.
- `src/Filament.Infrastructure/Repositories/Repositories.cs` (fix round) — `FilamentTypeRepository.DeleteAsync` rejects types used by a project definition; `SpoolRepository.DeleteAsync` rejects spools with active non-creation events and removes the spool's undone project prints (with their events on other spools, re-evaluated).
- `src/Filament.Api/{Dtos/Dtos.cs, Mapping/DtoMapping.cs, Controllers/SpoolsController.cs}` — print-project DTOs/mapping; spool events expose `ProjectPrintId` + resolved `ProjectId`; spool disable/enable reject project-linked events with `400`; spool delete maps the guard to `409` and notifies `print-project` too.
- `web/src/{api/client.ts, components/icons.tsx, main.tsx, pages/SpoolDetail.tsx, styles.css}` — API surface and icons, nav item + three routes, spool-history project rows (distinguished, no undo control, click-through) and `?highlight=` support, styles.
- `tests/Filament.Core.Tests/Services/SpoolLifecycleTests.cs` — 33 tests (the fix round replaced the `allowSealed` cases with the plain open-required cases).
- `tests/Filament.Api.Tests/{Fakes.cs, SpoolsControllerCreateTests.cs}` — fake updates for the new constructor dependencies.
- `e2e/tests/fixtures/db.ts` — `resetInventory` clears the new tables (in FK order); `seedType` accepts facet overrides; `seedPrintProject` / `seedProjectPrint` insert projects, type lines, and project-linked print events directly, then re-evaluate.

Durable documentation was updated alongside the implementation and the fix round:
`doc/spec/application-overview.md`, `doc/spec/architecture.md`, `doc/spec/domain-rules.md`,
and `doc/spec/interfaces.md` describe the print-project behavior, routes, API operations,
and the guarded deletion rules. The request directory was archived to
`doc/done/008-print-project/` as part of this work's commits.

## Deviations From Plan

- **`PrintProjectPrint.load()` ordering (web):** the plan specified the print page's data
  loading but not the update sequencing. The first implementation set `project` before the
  subsequent awaited fetches resolved `slots`; React flushed the intermediate state and the
  slot render crashed the app (`Cannot read properties of undefined (reading 'spoolId')`),
  which the e2e AC-7…AC-16 tests caught. The fix batches all state updates after all
  fetches resolve. No behavior change; no plan step altered.
- **Sealed-spool opening (fix round, user-reported):** the plan (and the specification's
  constraints section) relied on the legacy sealed-print evaluation rule, with the print
  consuming the sealed spool directly. The fix round replaces that with an explicit,
  ordinary, unlinked `Opened` event emitted by `PlanPrint`, and removes `allowSealed` from
  `SpoolLifecycle.PlanConsume`. User-visible effect: the opening is a normal row in the
  spool history that survives undo/redo of the print and can be undone on its own; a redo
  after a separately undone opening is still rejected with the same clear error.
- **One print event per slot (fix round, user-reported):** the plan summed a spool's slots
  into one consume plan per spool; the fix round creates one `Print` event per slot (same
  date/time) instead. Balances, ordering, and undo/redo behavior are unchanged.
- **Individual toggle of project-linked events (fix round, user-reported):** the plan
  left the spool disable/enable endpoints untouched; the fix round rejects
  project-linked events there with `400`, since toggling one event alone would desynchronise
  the print from its events.
- **Type deletion (fix round, user-reported):** the plan risk section expected deleting a
  type referenced by a project to drop the definition line (cascade). The fix round
  restricts the FK and rejects the deletion with `409` until the project is archived and
  deleted.
- **Spool deletion (fix round, user-reported):** the plan risk section accepted that
  deleting a spool could leave a project print with deleted events. The fix round rejects
  spool deletion with `409` while any active event other than `Created` exists, and — when
  allowed — removes the spool's undone project prints as a whole (including their undone
  events on other spools, re-evaluated).
- No other deviations: every planned file, test, and command was carried out as specified.

## Verification

Final runs (2026-11-27, branch tip including the fix round):

| Command | Result |
|---|---|
| `dotnet test tests/Filament.Core.Tests` | passed — `Failed: 0, Passed: 118, Skipped: 0, Total: 118` (incl. 35 `PrintProjectRulesTests`, 33 `SpoolLifecycleTests`) |
| `dotnet test tests/Filament.Api.Tests` | passed — `Failed: 0, Passed: 96, Skipped: 0, Total: 96` (incl. 28 `PrintProjectsControllerTests` and spool-event project-link / guard tests) |
| `dotnet test tests/Filament.Infrastructure.Tests` | passed — `Failed: 0, Passed: 12, Skipped: 0, Total: 12` |
| `npm --prefix web run build` | passed — clean production build |
| `npm --prefix e2e run typecheck` | passed — clean |
| `npm --prefix e2e run e2e` (full suite: smoke, sorting, labels, unique, spool-lifecycle, dashboard-consumption, print-projects, print-project-print, print-project-integrity) | passed — `81 passed (1.1m)`; evidence (screenshots, videos, traces) under `e2e/test-results/` |

The 2026-11-26 runs (119 Core / 90 Api unit tests, 18 + 36 repeated new-spec e2e, 74-pass
full suite) verified the initial implementation and were superseded by the fix round,
which changed print planning, the spool/type deletion guards, and the event-toggle rules.

## Limitations And Follow-Up

- The list page sorts in memory (single-user scale, plan decision 7); fine at the expected
  size, would need a DB-side composite sort if the catalog ever grows large.
- "Other spools" applies the facet filters client-side to the already-fetched non-finished
  spool list (the dialogue's data source), matching the existing list endpoint's semantics.
- No follow-up work identified within this request's scope.
