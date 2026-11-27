# Implementation Plan: Print Projects (008)

## Approval

Status: approved
Approved by: obrys
Approved on: 2026-11-26

## Summary

Implements the approved `specification.md`: a "Print projects" menu with a list (archive
toggle, effective-date sorting), a detail page (title/description/URL, defined filament types
with grams, project prints section with undo/redo), and a print page that consumes selected
spools one slot per defined type (with an "other spools" filtered dialogue). A project print
links the spool events it creates; undo/redo disables/re-enables the print and all linked
events together. New persistence (three tables plus a nullable project-print reference on
`spool_events`), new API operations, WebSocket notifications for a `print-project` resource,
and spool-history integration (linked rows show the project link, hide undo/redo, support
click-through with row highlighting in both directions).

One focused pull request. A split (CRUD/list first, print flow second) was considered and
rejected: the acceptance criteria cross-cut (undo/redo touches spool history, the print flow
touches list rows, dashboard consumption flows through the same events), and the steps below
are ordered so the first nine steps form a reviewable intermediate state (schema + CRUD +
list/detail) before the print flow is added.

## Preconditions And Decisions

### Confirmed preconditions

- Exactly one request directory: `doc/todo/008-print-project/` with immutable `README.md`,
  `amendment.md`, and `specification.md` (`Status: approved`, obrys, 2026-11-26).
- Durable specs consulted: `doc/spec/domain-rules.md` (spool lifecycle, integer grams,
  legacy sealed-print rule, undo/redo guards), `doc/spec/interfaces.md` (routes, error
  behavior 404/400/409, WebSocket `change` messages), `doc/spec/architecture.md`
  (three-layer backend, DTO mapping, EF migrations at API start), `doc/spec/operations.md`
  (both test layers required).
- Code conventions traced: `src/Filament.Core` (domain + `SpoolLifecycle` planning,
  `IRepositories.cs` abstractions, `IdentifierGenerator`), `src/Filament.Infrastructure`
  (entities, `EntityMapping`, `Repositories.cs` with the atomic
  `ApplyLifecycleAsync` pattern, `FilamentDbContext` + timestamped migrations),
  `src/Filament.Api` (controllers with the `ApplyLifecycle` 404/400 pipeline,
  `Dtos.cs` records, `DtoMapping`, `ChangeBroker` resource-string notifications),
  `web/src` (router in `main.tsx`, `api/client.ts` fetch wrapper, list/detail page
  patterns in `Spools.tsx`/`SpoolDetail.tsx`, `FilterBar` facets,
  `useChangeStream` `onChange` reloads, `version-overlay` dialog pattern),
  `tests/` (xUnit; `SpoolLifecycleTests` planner style; `SpoolsControllerCreateTests`
  fakes style), `e2e/` (Playwright; `fixtures/seed.ts` UI seeding, `fixtures/db.ts`
  SQL seeding + `reevaluate`, `resetInventory` between tests).
- `dotnet-ef` is not in `dotnet-tools.json` (tools empty) and not installed globally;
  the migration in step 7 is generated with the EF Core 9 CLI (`dotnet tool install
  --global dotnet-ef --version 9.*` matching `Microsoft.EntityFrameworkCore` 9.0.0).

### Plan-level decisions (within the bounds left open by the specification)

1. **Routes / highlighting**: `/print-projects` (list), `/print-projects/:id` (detail),
   `/print-projects/:id/print` (print page). Row highlighting uses the query parameter
   `?highlight=<id>`: a project print id on the detail page, a spool event id on the
   spool detail page. Existing `SpoolDetail` gains `?highlight=` support.
2. **API** (JSON, enums as strings, `{ error }` bodies on 400, matching `SpoolsController`):
   - `GET /api/print-projects?includeArchived=` → `{ items: PrintProjectDto[] }`
   - `GET /api/print-projects/{id}` → detail (incl. `prints`)
   - `POST /api/print-projects`, `PUT /api/print-projects/{id}` —
     `{ title, description?, url?, types: [{ filamentTypeId, grams }] }`
   - `POST /api/print-projects/{id}/archive`, `.../unarchive`, `DELETE /api/print-projects/{id}`
   - `POST /api/print-projects/{id}/prints` — `{ spools: [{ spoolId, grams }] }` → `ProjectPrintDto`
   - `POST /api/print-projects/{id}/prints/{printId}/undo` and `.../redo`
   - `GET /api/spools/{id}/events` gains `projectPrintId` / `projectId` on each `SpoolEventDto`.
3. **WebSocket**: mutations broadcast `{"type":"change","resource":"print-project","id":...}`;
   operations that touch spool events (print, undo, redo, delete) additionally broadcast
   `resource:"spool"` with `null` id (the existing all-spool reload convention used by
   `reevaluate`) so open spool pages refresh too.
4. **Identifiers**: UUID v7 via .NET's built-in `Guid.CreateVersion7()` (project net10.0),
   exposed as `IdentifierGenerator.NewProjectId()` / `NewProjectPrintId()`.
5. **Schema**: `print_projects` (Id char(36) PK, Title varchar(256), Description varchar(1024)
   null, Url varchar(1024) null, IsArchived bool default 0, ArchivedAt datetime(6) null,
   CreatedAt datetime(6)); `print_project_types` (Id bigint auto PK, ProjectId char(36) FK
   cascade, FilamentTypeId char(32) FK **cascade**, Grams int, unique (ProjectId,
   FilamentTypeId)); `project_prints` (Id char(36) PK, ProjectId char(36) FK cascade,
   OccurredAt datetime(6), IsDisabled bool default 0, index (ProjectId, OccurredAt));
   `spool_events.ProjectPrintId` char(36) null, FK → `project_prints.Id`
   `DeleteBehavior.Restrict` (a print can never be deleted while events reference it; the
   delete flow removes the events first), index on `ProjectPrintId`.
   `FilamentTypeId` on a type line uses cascade so deleting a type referenced by a project
   definition drops the line instead of 500-ing (edge noted in Risks).
6. **Auto-open of sealed spools**: no new planning logic — `SpoolLifecycle.PlanConsume`
   gains an `allowSealed: false` parameter. With `allowSealed: true` a `Sealed` status is
   accepted (the existing evaluation rule in `SpoolLifecycle.Evaluate`, line 85-93, opens
   the spool at the print's `OccurredAt`); `Finished` still throws. The normal
   `/spools/{id}/consume` endpoint keeps the default (`false`).
7. **Sorting**: computed in the controller from the Core `PrintProjectRules` ordering
   (effective date desc, title A–Z, project id asc). In-memory sort is deliberate: the
   effective date is a composite (archived / newest enabled print / created) and the
   application is single-user scale — the same approach `DashboardRepository.GetSeriesAsync`
   takes for heavier derivations.
8. **Atomicity**: `PrintAsync` and `SetPrintEnabledAsync` each perform their whole write in
   one repository method and one `SaveChanges`; all validation/planning happens before any
   row is modified, so a rejected redo or over-balance print changes nothing.

### Vision usage proposal (advisory only)

Before building the new pages (steps 16–21), capture screenshots of the running
`/spools` and `/spools/:id` pages (e.g. one `npm --prefix e2e run e2e` run leaves per-test
screenshots under `e2e/test-results/`, or a local `npm --prefix web run dev` session) and
review them with the implementer's vision capability to confirm the new pages reuse the
house visual language (cards, toolbar, badges, dialog overlay, table layout). Failure case:
if the vision output is broken or misreads the screenshots, fall back to the existing
components/classes as ground truth (`FilterBar`, `card`/`toolbar`/`control`/`badge`
classes, `version-overlay` dialog, `spool-bits`) — the Playwright assertions in the test
matrix, not the screenshot review, are the verification.

## Implementation Steps

### Core (domain and rules)

1. `src/Filament.Core/Domain/PrintProject.cs` (new): `PrintProject` (string Id, Title,
   Description?, Url?, IsArchived, ArchivedAt?, CreatedAt, `List<PrintProjectType> Types`,
   `List<ProjectPrint> Prints`), `PrintProjectType` (FilamentTypeId, Grams),
   `ProjectPrint` (string Id, ProjectId, OccurredAt, IsDisabled,
   `List<SpoolEvent> Events`).
2. `src/Filament.Core/Domain/SpoolEvent.cs`: add `public string? ProjectPrintId { get; init; }`.
3. `src/Filament.Core/Identifiers/IdentifierGenerator.cs`: add
   `NewProjectId()` / `NewProjectPrintId()` returning `Guid.CreateVersion7().ToString("D")`.
4. `src/Filament.Core/Services/SpoolLifecycle.cs`: extend the `PlanConsume` signature with
   `bool allowSealed = false`; when true, skip `RequireOpen` for `Sealed`
   only (`Finished` still throws). Balance check and event shape unchanged.
5. `src/Filament.Core/Services/PrintProjectRules.cs` (new, static, pure):
   - `EffectiveDate(PrintProject)` → `ArchivedAt ?? newest enabled print's OccurredAt ?? CreatedAt`.
   - `Compare(PrintProject a, PrintProject b)` → effective date desc, then title A–Z
     (ordinal), then Id.
   - `ValidateDefinition(title, description, url, types)` → throws
     `InvalidOperationException`/`ArgumentOutOfRangeException`: blank or >256 title,
     >1024 description/url, zero type lines, duplicate filament type, grams < 1.
   - `EnsureNotArchived(project, action)` → throws for print/edit/undo/redo while archived.
   - `EnsureDeletable(project, prints)` → throws unless archived and no enabled prints.
   - `PlanPrint(project, spools with events, selection)` → validates every slot has a
     spool and grams ≥ 1, spool not finished, per-spool summed grams ≤ remaining balance;
     returns one `LifecyclePlan` per selected spool built with
     `SpoolLifecycle.PlanConsume(allowSealed: true)`, each event stamped
     `ProjectName = project.Title`, `ProjectUrl = project.Url` (the `ProjectPrintId` is
     stamped by the repository once the print id is known).
6. `src/Filament.Core/Abstractions/IRepositories.cs`: add `PrintSelection(string SpoolId,
   int Grams)` record and `IPrintProjectRepository`:
   - `Task<PrintProject?> GetAsync(string id, CancellationToken ct = default)` (full graph:
     types, prints, and each print's spool events)
   - `Task<IReadOnlyList<PrintProject>> ListAsync(bool includeArchived, CancellationToken ct = default)`
     (projects + types + prints, no events)
   - `Task<PrintProject> CreateAsync(PrintProject project, CancellationToken ct = default)`
   - `Task<PrintProject> UpdateAsync(PrintProject project, CancellationToken ct = default)`
   - `Task<PrintProject> SetArchivedAsync(string id, bool archived, DateTimeOffset at, CancellationToken ct = default)`
   - `Task<bool> DeleteAsync(string id, CancellationToken ct = default)`
   - `Task<ProjectPrint> PrintAsync(string projectId, IReadOnlyList<PrintSelection> selection, CancellationToken ct = default)`
   - `Task<ProjectPrint> SetPrintEnabledAsync(string projectId, string printId, bool enabled, CancellationToken ct = default)`
   - `Task<string?> GetProjectIdByPrintIdAsync(string printId, CancellationToken ct = default)`

### Infrastructure (persistence)

7. `src/Filament.Infrastructure/Persistence/Migrations/` (new migration, generated with
   `dotnet ef migrations add AddPrintProjects --project src/Filament.Infrastructure
   --startup-project src/Filament.Api`): create the three tables and add
   `spool_events.ProjectPrintId` per decision 5; additive only, `Down` drops column +
   tables.
8. `src/Filament.Infrastructure/Entities/Entities.cs`: add `PrintProjectEntity`,
   `PrintProjectTypeEntity`, `ProjectPrintEntity`; add `ProjectPrintId` to
   `SpoolEventEntity` (plus the same-shaped navigation collections).
9. `src/Filament.Infrastructure/Persistence/FilamentDbContext.cs`: model the new entities
   and the new FK/index per decision 5.
10. `src/Filament.Infrastructure/Mapping/EntityMapping.cs`: ToDomain/ToEntity for the new
    entities; add `ProjectPrintId` to both `SpoolEvent` mappings.
11. `src/Filament.Infrastructure/Repositories/Repositories.cs` (new `PrintProjectRepository`
    class, same file/style as the existing three):
    - `ListAsync`: query projects (+ type lines, + prints) with tracking disabled, filter
      `IsArchived` when not included.
    - `GetAsync`: the same plus each print's `SpoolEvents` (where `ProjectPrintId == print.Id`).
    - `CreateAsync`/`UpdateAsync`: insert/replace project row and type lines (delete +
      re-insert lines on update); `UpdateAsync` on a missing project throws
      `InvalidOperationException`.
    - `SetArchivedAsync`: set/clear `IsArchived`/`ArchivedAt`.
    - `DeleteAsync`: load the project with prints; delete all `SpoolEventEntity` rows whose
      `ProjectPrintId` is one of the project's print ids; for each touched spool recompute
      state with `SpoolLifecycle.Evaluate` + `ApplyState` (mirroring
      `ApplyLifecycleAsync`) so caches stay consistent; delete prints, type lines, project;
      one `SaveChanges`; return `false` when the project does not exist.
    - `PrintAsync`: load project (throw when missing); `PrintProjectRules.EnsureNotArchived`
      + `PlanPrint` (all validation before any write); generate the print id
      (`IdentifierGenerator.NewProjectPrintId()`), `OccurredAt = DateTimeOffset.UtcNow`;
      insert the `project_prints` row; insert one `SpoolEventEntity` per selection
      (`Kind = Print`, `DeltaGrams = -grams`, `ProjectPrintId`, `ProjectName`, `ProjectUrl`,
      shared `OccurredAt`); `ApplyState` per touched spool from
      `SpoolLifecycle.Evaluate`; one `SaveChanges`; return the print with its events.
    - `SetPrintEnabledAsync`: load project + print (throw when missing);
      `EnsureNotArchived`; group the print's events by spool; per spool load all events and
      build `SpoolLifecycle.PlanSetEnabled` for each of the print's event ids (a guard
      rejection throws before anything is persisted); then toggle `IsDisabled` on the
      events, set the print's `IsDisabled`, `ApplyState` per spool, one `SaveChanges`.

### API (endpoints, DTOs)

12. `src/Filament.Api/Dtos/Dtos.cs`: add `PrintProjectTypeDto(FilamentTypeId, Brand,
    Material, Type, Color, ColorHex, Grams)`,
    `ProjectPrintEventDto(long SpoolEventId, string SpoolId, int Grams, string? Brand,
    string? Material, string? Type, string? Color, string? ColorHex)`,
    `ProjectPrintDto(string Id, DateTimeOffset OccurredAt, bool IsDisabled,
    IReadOnlyList<ProjectPrintEventDto> Events)`,
    `PrintProjectDto(string Id, string Title, string? Description, string? Url, bool
    IsArchived, DateTimeOffset? ArchivedAt, DateTimeOffset CreatedAt, DateTimeOffset
    EffectiveAt, bool HasEnabledPrints, IReadOnlyList<PrintProjectTypeDto> Types,
    IReadOnlyList<ProjectPrintDto>? Prints)`,
    `CreatePrintProjectDto(string Title, string? Description, string? Url,
    IReadOnlyList<PrintProjectTypeLineDto> Types)` with
    `PrintProjectTypeLineDto(string FilamentTypeId, int Grams)` (reused for update),
    `CreateProjectPrintDto(IReadOnlyList<PrintSelectionDto> Spools)` with
    `PrintSelectionDto(string SpoolId, int Grams)`. Extend `SpoolEventDto` with
    `string? ProjectPrintId, string? ProjectId` (inserted after `IsDisabled`).
13. `src/Filament.Api/Mapping/DtoMapping.cs`: `ToDto` for the new types (type display
    fields resolved from a `Dictionary<string, FilamentType>` the controller batch-loads,
    same as `SpoolsController.List`); extend `SpoolEvent.ToDto` with the two new fields.
14. `src/Filament.Api/Controllers/PrintProjectsController.cs` (new, route
    `api/print-projects`, same constructor-injected repositories + `IChangeNotifier`
    pattern as `SpoolsController`):
    - `GET ""` (`[FromQuery] bool includeArchived`): repository list, sort with
      `PrintProjectRules.Compare`, map to DTOs (batch-load referenced filament types;
      `EffectiveAt` from `PrintProjectRules.EffectiveDate`, `HasEnabledPrints` from the
      loaded prints).
    - `GET "{id}"`: detail with prints (404 when unknown).
    - `POST ""` / `PUT "{id}"`: `PrintProjectRules.ValidateDefinition`, 404 for an unknown
      `filamentTypeId`, `EnsureNotArchived` on update; 400 with `{ error }` for
      `InvalidOperationException`/`ArgumentOutOfRangeException` (shared helper mirroring
      `SpoolsController.ApplyLifecycle`'s catch); notify `("print-project", id)`.
    - `POST "{id}/archive"` / `POST "{id}/unarchive"`: idempotency 400 ("already
      archived" / "not archived"); notify.
    - `DELETE "{id}"`: `EnsureDeletable` 400; notify `("print-project", id)` and
      `("spool", null)`.
    - `POST "{id}/prints"`: 404 project, 400 guards from `PrintAsync`; notify
      `("print-project", id)` and `("spool", null)`; return the created `ProjectPrintDto`.
    - `POST "{id}/prints/{printId}/undo"` / `.../redo`: 404 unknown, 400
      `EnsureNotArchived` and rejected-redo guards; notify both resources; return the
      updated `ProjectPrintDto`.
15. `src/Filament.Api/Controllers/SpoolsController.cs` + mapping: `Events` action resolves
    the distinct `ProjectPrintId`s via
    `IPrintProjectRepository.GetProjectIdByPrintIdAsync` and passes them through
    `SpoolEventDto` (spool events of a deleted project already carry the link in the event
    row; an unresolvable id maps to `null`).

### Web (SPA)

16. `web/src/api/client.ts`: add `PrintProjectType`, `ProjectPrintEvent`, `ProjectPrint`,
    `PrintProject` types; add `projectPrintId?: string | null` and
    `projectId?: string | null` to `SpoolEvent`; add
    `api.printProjects = { list(includeArchived), get(id), create(body), update(id, body),
    archive(id), unarchive(id), delete(id), print(id, spools), undoPrint(id, printId),
    redoPrint(id, printId) }` following the existing `http<T>` wrapper.
17. `web/src/components/icons.tsx`: add a `IconProjects` icon (folder/list glyph, same
    24×24 stroke style as the existing icons).
18. `web/src/components/ProjectForm.tsx` (new, shared by create and edit): title (required
    input), description (textarea), URL (input), and type lines (filament-type select +
    grams number input + remove button, with an "Add type" button). Client-side validation
    mirrors `PrintProjectRules.ValidateDefinition` (visible inline error; submit disabled);
    on API failure `alert(err.message)` like every other form.
19. `web/src/pages/PrintProjects.tsx` (new list page):
    - load `api.printProjects.list(showArchived)`; `onChange` reload on
      `m.resource === 'print-project'`.
    - toolbar: "New project" toggle (inline `ProjectForm`, `NewSpoolForm` pattern) and a
      "Show archived" checkbox (`control` class, `includeFinished` pattern).
    - table row: title linked to `/print-projects/{id}`, compact type summary
      (`{type} · {grams} g, …`), `EffectiveAt` formatted, `Archived` badge when archived,
      actions: Print (link to `/print-projects/{id}/print`), Edit (link to detail with
      edit opened; hidden when archived), Archive/Unarchive (`confirm()` dialogue), Delete
      (only when `isArchived && !hasEnabledPrints`, `confirm()` dialogue, `card--danger`
      button style on detail; row icon button here).
    - empty state (`IconInbox` pattern) when no projects.
20. `web/src/pages/PrintProjectDetail.tsx` (new):
    - load `api.printProjects.get(id)`; `onChange` reload on `m.resource ===
      'print-project'` with `!m.id || m.id === id`.
    - hero section: title, description, URL as an external link when present, defined
      types with grams (one `spec` row each).
    - actions: Print, Edit (toggles `ProjectForm` prefilled; hidden when archived),
      Archive/Unarchive with `confirm()`, Delete card (`card--danger`, enabled only when
      `isArchived && !hasEnabledPrints`) — mirroring `SpoolDetail`'s delete card.
    - "Project prints" section: table with `When`, `Spools` (one entry per event:
      spool id linked to `/spools/{spoolId}?highlight={eventId}` + `−grams g` + type
      label), action Undo (enabled prints) / Redo (undone prints); undone rows use the
      `event-disabled` class.
    - reads `?highlight=<printId>` from `useSearchParams`: applies an `is-highlighted`
      class to that row and `scrollIntoView` on load.
21. `web/src/pages/PrintProjectPrint.tsx` (new print page at
    `/print-projects/:id/print`):
    - loads the project plus, per defined type, `api.spools.list({ filamentTypeId,
      includeFinished: false })` (slot spool lists), plus one unfiltered
      `api.spools.list({ includeFinished: false })` with facets for the dialogue.
    - one slot card per defined type: the type's spools as selectable rows (id, remaining
      gauge, status), a grams input prefilled with the type's defined grams (editable),
      and an "Other spools" button.
    - "Other spools" dialogue (`version-overlay` + `card`, `print-dialog` pattern) with the
      four-facet `FilterBar` (`useFacetFilters` does not apply — the dialogue keeps its
      selection in local state, not the URL) and the spool table; selecting a row fills
      the slot with that spool (any type) and keeps the pre-filled grams.
    - the same spool may be selected in several slots (no exclusivity logic).
    - live validation, visible error text + disabled Confirm: every slot has a spool with
      ≥ 1 g; per spool, the sum of grams across all its slots ≤ its remaining balance.
    - Confirm → `api.printProjects.print(id, spools)` → `navigate(
      '/print-projects/{id}?highlight=' + print.id)`; API errors surface via
      `alert(err.message)` (server re-validates everything).
22. `web/src/pages/SpoolDetail.tsx` (change):
    - history rows with `e.projectPrintId`: render the Project cell as a link
      `/print-projects/{e.projectId}?highlight={e.projectPrintId}` (label =
      `e.projectName`), add an `event--project` row class (visually distinguished), and
      render **no** Undo/Redo button for that row.
    - read `?highlight=<eventId>` from `useSearchParams`: `is-highlighted` class +
      `scrollIntoView` on that history row.
23. `web/src/main.tsx`: add the "Print projects" `NavLink` after "Spools" (with
    `IconProjects`) and the three routes `/print-projects`, `/print-projects/:id`,
    `/print-projects/:id/print`.
24. `web/src/styles.css`: add `event--project` (distinguished project-linked spool row,
    e.g. accent-tinted background/link), `is-highlighted` (row highlight used on both the
    project prints table and the spool history), and any slot/dialog classes the new pages
    need, all on existing theme variables.

### Tests

25. `tests/Filament.Core.Tests/PrintProjects/PrintProjectRulesTests.cs` (new; xUnit, same
    pure-input style as `SpoolLifecycleTests`):
    - `EffectiveDate`: archived → `ArchivedAt`; newest enabled print; all prints undone →
      `CreatedAt`; no prints → `CreatedAt`.
    - `Compare`: newest effective date first; ties by title A–Z; ties by id.
    - `ValidateDefinition`: blank title, title > 256, description > 1 024, url > 1 024,
      zero type lines, duplicate type, grams 0/negative — each throws; a valid definition
      passes.
    - `EnsureNotArchived`: print/edit/undo/redo on an archived project throw; unarchived
      passes.
    - `EnsureDeletable`: unarchived throws; archived with an enabled print throws;
      archived with all prints undone passes; archived without prints passes.
    - `PlanPrint`: unfilled slot throws; 0 g throws; over-balance in a single slot throws;
      over-balance only visible when the same spool backs two slots (summed) throws;
      finished spool throws; sealed spool accepted with `allowSealed` (plan carries the
      Print event only — the open comes from evaluation); a valid multi-spool selection
      yields one plan per spool with the right deltas and `ProjectName`/`ProjectUrl`.
26. `tests/Filament.Core.Tests/Services/SpoolLifecycleTests.cs`: add
    `PlanConsume(allowSealed: true)` cases — sealed spool accepted; after applying the
    plan, `Evaluate` reports `Open` with `OpenedAt` equal to the print's `OccurredAt`;
    finished spool still throws; default `allowSealed: false` behavior unchanged (sealed
    throws).
27. `tests/Filament.Api.Tests/PrintProjectsControllerTests.cs` (new; in-memory fakes of
    the repositories in the `Fakes.cs`/`SpoolsControllerCreateTests` style): unknown
    project → 404; printing an archived project → 400; over-balance print → 400 with no
    spool consumed (fake spool store unchanged); delete guard (not archived / enabled
    prints) → 400; rejected redo → 400; successful create returns 201 and notifies
    `("print-project", id)`; a print notifies both `("print-project", id)` and
    `("spool", null)`.
28. `e2e/tests/fixtures/db.ts` (change): extend `resetInventory()` to also delete
    `print_project_types`, `project_prints`, `print_projects` (after `spool_events`, so the
    `ProjectPrintId` restriction never fires); add `seedPrintProject({ id?, title,
    description?, url?, archived?, archivedAt?, createdAt, types: [{ typeId, grams }] })`
    (inserts project + type lines via SQL, creating the type on demand like
    `ensureType`) and `seedProjectPrint({ projectId, spoolId, grams, occurredAt,
    disabled? })` (inserts a `project_prints` row plus the linked `spool_events` Print row
    with `ProjectPrintId`/`ProjectName`, then `reevaluate()`).
29. `e2e/tests/print-projects.spec.ts` (new; `beforeEach`/`afterEach` `resetInventory`
    like `dashboard-consumption.spec.ts`; UI seeding via `seed.ts` where a type/spool must
    be created through the browser, SQL seeding for date-sensitive rows):
    - AC-1: "Print projects" nav item present after "Spools"; `/print-projects` shows the
      empty state.
    - AC-2: create through the list form (title, description, URL, two type lines) → row
      appears with the title; empty title → visible validation error and no request
      accepted; a form with no type line → visible error.
    - AC-3: archive a project (confirmation dialogue) → gone from the default list,
      present with an archived marker when "Show archived" is on.
    - AC-4: seed projects with known creation dates, print dates, and one archived project
      → order is newest effective date first; two projects sharing the effective date
      order by title A–Z; undoing the newest print of a project (via its detail page)
      moves it back to its creation-date position.
    - AC-5: detail page shows title, description, URL as a clickable external link, the
      defined types with grams, and the project prints section.
    - AC-6: edit title/description/URL, add a type, change grams → persisted (re-fetch via
      `page.request`), reflected in list row and detail; an existing project print keeps
      its recorded spools and grams.
    - AC-14: archiving hides Print/Edit/undo-undo actions, removes the project from the
      default list, shows it via the toggle sorted by its archived date; unarchiving
      restores the actions.
    - AC-15: Delete button absent/disabled unless archived with no enabled prints; after
      the confirmation dialogue the project, all its prints (including undone ones), and
      the linked spool history rows are gone and the affected spools' balances equal their
      pre-print values.
    - AC-17: a second `browser.newContext()` on the same URL: a project created (or a
      print confirmed) in the first context appears in the second context's list/detail
      without `page.reload()`.
30. `e2e/tests/print-project-print.spec.ts` (new; same reset pattern):
    - AC-7: Print from the detail page and from a list row both open the print page; one
      slot per defined type; a slot lists that type's open and sealed non-finished spools
      (seed one sealed and one open spool of the type; finish a third and assert it is
      absent) with the defined grams pre-filled.
    - AC-8: "Other spools" opens the dialogue listing all non-finished spools of any type;
      filtering by brand/material/type/color narrows it (seed distinguishable facet
      values); choosing a spool of a different type fills the slot, grams still
      pre-filled and editable.
    - AC-9: select the same spool for two slots with different grams; after confirmation
      the spool's remaining grams drop by the sum of both.
    - AC-10: (a) confirm with an unfilled slot / a slot at 0 g → visible error, Confirm
      blocked, no spool consumed; (b) enter grams for one spool across two slots whose sum
      exceeds its remaining balance → visible error, Confirm blocked, no spool consumed
      (balances unchanged via API read-back).
    - AC-11: confirm a valid print using one open and one sealed spool → both balances
      reduced; each spool history gains a row showing the project title as a link with no
      undo control; the project detail gains a print row at the top with the date/time and
      the spools with grams; the sealed spool's status is now Open.
    - AC-12: undo the print from the project prints section → the row displays as undone
      with a Redo action, the related spool history rows display as undone, balances
      restored; redo reverses everything; then seed the rejected-redo case (undo the
      spool's Opened event from the spool page first) → redo shows an error and the print
      stays undone with balances unchanged.
    - AC-13: from a spool history row of a project print, the project title links to the
      project detail with that print row highlighted; from a project print row, a spool id
      links to the spool detail with the related event row highlighted.
    - AC-16: after confirming a print of N grams today, `GET /api/dashboard/usage?days=30`
      (via `page.request`) reports N in `consumedGrams` for today (and the dashboard
      renders it); after undoing the print, today's `consumedGrams` drops back by N.

## Test Matrix

| Acceptance criterion | Test layer | Test | Expected evidence |
|---|---|---|---|
| AC-1 — "Print projects" nav item; list opens, empty when no projects | e2e | `print-projects.spec.ts` › AC-1 test | Pass + screenshot/video/trace in `e2e/test-results/` |
| AC-2 — create with title/description/URL/type lines; rejected visibly for empty title or no type line | e2e | `print-projects.spec.ts` › AC-2 test | Pass + evidence |
| AC-2 — definition validation rules (limits, duplicates, grams) | Unit | `PrintProjectRulesTests` `ValidateDefinition_*` | Pass |
| AC-3 — "show archived" toggle hides by default, shows archived with marker | e2e | `print-projects.spec.ts` › AC-3 test | Pass + evidence |
| AC-4 — effective-date sorting, title/id tie-break, undone newest print falls back to creation date | e2e | `print-projects.spec.ts` › AC-4 test | Pass + evidence |
| AC-4 — effective date + ordering rules | Unit | `PrintProjectRulesTests` `EffectiveDate_*`, `Compare_*` | Pass |
| AC-5 — detail page shows title, description, URL link, types with grams, prints section | e2e | `print-projects.spec.ts` › AC-5 test | Pass + evidence |
| AC-6 — edits persist, reflect in list/detail, existing prints unchanged | e2e | `print-projects.spec.ts` › AC-6 test | Pass + evidence |
| AC-7 — print page: one slot per type, slot lists open+sealed non-finished spools, grams pre-filled | e2e | `print-project-print.spec.ts` › AC-7 test | Pass + evidence |
| AC-7/AC-10 — slot/balance validation and sealed-spool planning | Unit | `PrintProjectRulesTests` `PlanPrint_*` | Pass |
| AC-8 — "other spools" dialogue, four facet filters, different type fills slot, grams pre-filled + editable | e2e | `print-project-print.spec.ts` › AC-8 test | Pass + evidence |
| AC-9 — same spool in two slots, balance reduced by the sum | e2e | `print-project-print.spec.ts` › AC-9 test | Pass + evidence |
| AC-9/AC-10 — over-balance summed across a spool's slots | Unit | `PrintProjectRulesTests` `PlanPrint_SameSpoolTwoSlots_SumsGrams` | Pass |
| AC-10 — confirmation blocked (empty/0 g slot, over-balance) with visible error, nothing consumed | e2e | `print-project-print.spec.ts` › AC-10a/10b tests | Pass + evidence |
| AC-10 — 400s for over-balance / unfilled slot, no spool consumed | Unit | `PrintProjectsControllerTests` print-guard tests | Pass |
| AC-11 — valid print: balances, project-linked spool history rows without undo, print row on top, sealed→open | e2e | `print-project-print.spec.ts` › AC-11 test | Pass + evidence |
| AC-11 — sealed spool auto-opened at the print's timestamp | Unit | `SpoolLifecycleTests` `PlanConsume(allowSealed: true)` cases | Pass |
| AC-12 — undo displays print + spool rows undone, restores balances; redo reverses; rejected redo keeps print undone | e2e | `print-project-print.spec.ts` › AC-12 test | Pass + evidence |
| AC-12/AC-14 — archived guard (print/edit/undo/redo), rejected redo 400 | Unit | `PrintProjectRulesTests` `EnsureNotArchived_*`; `PrintProjectsControllerTests` redo test | Pass |
| AC-13 — two-way click-through with row highlighting (project print ↔ spool event) | e2e | `print-project-print.spec.ts` › AC-13 test | Pass + evidence |
| AC-14 — archive/unarchive confirmations, action availability, list position by archived date | e2e | `print-projects.spec.ts` › AC-14 test | Pass + evidence |
| AC-15 — delete only for archived + no enabled prints; cascade removes project, all prints, linked rows; balances consistent | e2e | `print-projects.spec.ts` › AC-15 test | Pass + evidence |
| AC-15 — delete guard rules | Unit | `PrintProjectRulesTests` `EnsureDeletable_*`; `PrintProjectsControllerTests` delete tests | Pass |
| AC-16 — dashboard 30-day consumed includes the print, undo removes it | e2e | `print-project-print.spec.ts` › AC-16 test | Pass + evidence |
| AC-17 — change from another browser reflected without manual refresh | e2e | `print-projects.spec.ts` › AC-17 test (second Playwright context) | Pass + evidence |

Both required test layers are present: every user-visible acceptance criterion links to at
least one Playwright test, and the new domain logic (effective date, sorting, validation,
guards, print planning, sealed auto-open) is covered by unit tests. No layer is omitted.

## Test Commands

~~~text
# New/changed unit tests
dotnet test tests/Filament.Core.Tests --filter "FullyQualifiedName~PrintProjectRulesTests|FullyQualifiedName~SpoolLifecycleTests"
dotnet test tests/Filament.Api.Tests --filter "FullyQualifiedName~PrintProjectsControllerTests"

# Full unit suites (regression)
dotnet test tests/Filament.Core.Tests
dotnet test tests/Filament.Api.Tests
dotnet test tests/Filament.Infrastructure.Tests

# Frontend typecheck/build
npm --prefix web run build

# New e2e specs (builds the e2e stack once; evidence in e2e/test-results/)
npm --prefix e2e run e2e -- tests/print-projects.spec.ts tests/print-project-print.spec.ts

# Full e2e regression suite (all specs, including the resetInventory change)
npm --prefix e2e run e2e
~~~

## Out Of Scope

- Authentication/authorization, dashboard widgets, list facet filtering, editing a project
  print, labels/QR codes, partial or multi-project printing (all per the specification).
- Changing the existing per-spool consume/adjust/open/finish flows beyond
  (a) the `SpoolEventDto` gaining `projectPrintId`/`projectId` and (b)
  `SpoolDetail` rendering project-linked rows and `?highlight=` — both mandated by the
  specification's spool-history integration.
- `doc/spec/` updates happen at the document stage, not here.

## Risks And Rollback Notes

- **Schema**: the migration is purely additive (new tables, one nullable column); `Down`
  drops them. Existing data is untouched; `spool_events.ProjectPrintId` is null for all
  pre-existing rows.
- **Multi-spool write window**: `PrintAsync`/`SetPrintEnabledAsync` validate everything
  against loaded state before writing and persist in a single `SaveChanges`; a failure
  mid-save leaves the transaction uncommitted (same exposure class as the existing
  `ApplyLifecycleAsync`).
- **Type deletion cascade** (decision 5): deleting a filament type referenced by a project
  definition drops the type line (the project keeps working for its other types). Edge not
  covered by the specification; flagged here rather than inventing a new guard.
- **Spool deletion with project prints**: deleting a spool cascades to its events
  (existing behavior), which can leave a project print whose events were deleted — the
  print then renders with no spools. Consistent with "spool deletion is only for
  incorrectly created spools"; no new guard invented.
- **WebSocket**: old SPA builds ignore the unknown `print-project` resource (they match on
  resource name); no client breakage.
- **Vision-assisted style review** (Preconditions) is advisory only; if the vision
  capability is broken or misreads a screenshot, the existing components/CSS classes and
  the Playwright assertions are the fallback ground truth.
- **Rollback**: revert the single PR. The migration's `Down` (or deleting the migration
  before first deployment) restores the schema; no other state is introduced.
- **e2e hygiene**: `resetInventory()` is extended in FK-safe order; every new spec resets
  before and after, keeping the suite self-cleaning as today.
