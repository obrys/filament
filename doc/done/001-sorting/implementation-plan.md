# Implementation Plan: Sorting feature

## Approval

Status: approved
Approved by: obrys
Approved on: 2026-08-02

## Summary

Add server-side spool sorting with three keys (`lastUsed`, `leastRemaining`,
`mostRemaining`), default `lastUsed`, driven by a new `sort` query parameter on
`GET /api/spools` and a sort selector on the SPA `/spools` page. "Last used" is
the most recent enabled event's `OccurredAt` on each spool, exposed as a new
nullable `lastUsedAt` field on `SpoolDto` and persisted as a denormalized cache
column on `spools`, maintained by the same code path that already maintains
`remaining_grams`, `openedAt`, and `finishedAt` (and repaired by
`POST /api/spools/reevaluate`). The SPA reflects the active sort in the URL.

The design follows the existing cached-column pattern in
`doc/spec/architecture.md` so that sorting is performed entirely in the SQL
query against the `spools` table, as the request requires ("the SQL query
should be modified to return the spools in the correct order").

## Preconditions And Decisions

- `doc/todo/001-sorting/specification.md` is `Status: approved`.
- All product decisions are recorded in `doc/todo/001-sorting/amendment.md`.
- **Playwright e2e framework is now integrated** (`e2e/`, `scripts/run-e2e.sh`).
  Per the project's testing policy (`doc/spec/operations.md`), every change
  with user-visible behavior must be covered by both unit tests and Playwright
  e2e tests. This change introduces user-visible sorting behavior, so Playwright
  tests are mandatory for AC-12 through AC-17 (the browser-visible criteria).
- Decision (implementation, not product): **persist `lastUsedAt` as a cached
  column on `spools`** rather than computing it per-list via a `spool_events`
  aggregate. Rationale:
  - Matches the established pattern for `remaining_grams`, `openedAt`,
    `finishedAt` (`SpoolRepository.ApplyState` is the single cache writer, used
    by both `ApplyLifecycleAsync` and `ReevaluateAllAsync`).
  - Keeps the listing SQL a simple `ORDER BY` on `spools`, satisfying the
    spec's constraint that sorting is done in SQL, not in application memory.
  - `Evaluate` already iterates events in the canonical order, so deriving
    `LastUsedAt` there is free and guarantees consistency with the other caches.
- Decision: introduce a `SpoolSort` enum in `Filament.Core` with a pure
  `SpoolSort.Parse(string?)` helper (unknown/empty/null → `LastUsed`). The
  controller calls this helper; parsing is unit-tested without a web host.
- Decision: add a new `tests/Filament.Infrastructure.Tests` project (xunit +
  EF Core SQLite in-memory) to verify `SpoolRepository.ListAsync` ordering
  against a real EF provider. The repo currently has zero persistence tests,
  and the spec explicitly forbids in-memory resorting, so SQL-level verification
  is the only way to evidence AC-1..AC-8. This is a focused, self-contained
  addition (one project, one test file).
- Decision: no API integration test layer (no `WebApplicationFactory` harness
  exists and none is being introduced in this PR). Controller behavior is
  trivial — parse `sort` and pass it through — and is covered by the unit test
  of `SpoolSort.Parse` plus the repository tests and the Playwright e2e tests.
  Justified omission per the plan-change skill.
- Decision: do not modify existing migrations. Add a new additive migration.

## Implementation Steps

1. `src/Filament.Core/Domain/SpoolSort.cs` (new): define `public enum SpoolSort { LastUsed, LeastRemaining, MostRemaining }` and `public static class SpoolSortParser { public static SpoolSort Parse(string? raw) => raw switch { "lastUsed" => SpoolSort.LastUsed, "leastRemaining" => SpoolSort.LeastRemaining, "mostRemaining" => SpoolSort.MostRemaining, _ => SpoolSort.LastUsed }; }`. The switch is case-sensitive (matches spec: only exact lowercase values are recognized).

2. `src/Filament.Core/Services/SpoolLifecycle.cs`: add `DateTimeOffset LastUsedAt` (non-nullable) to the `SpoolState` record. In `Evaluate`, track the last event seen while iterating `OrderedEnabled(events)` (the iteration is already in chronological + tie-break order) and set `LastUsedAt` to that event's `OccurredAt`. Because every spool has an enabled `Created` event, the iteration always yields at least one event, so `LastUsedAt` is never null. Update the final `return new SpoolState(...)` to include it.

3. `src/Filament.Core/Domain/Spool.cs`: add `public DateTimeOffset? LastUsedAt { get; set; }`. Nullable in the domain to mirror the other cached timestamps; in practice always populated after an `Evaluate`.

4. `src/Filament.Infrastructure/Entities/Entities.cs`: add `public DateTimeOffset? LastUsedAt { get; set; }` to `SpoolEntity` (next to `FinishedAt`).

5. `src/Filament.Infrastructure/Mapping/EntityMapping.cs`: map `LastUsedAt` in `ToDomain`, `ToEntity`, and `CopyTo` (the three `Spool` mappings), next to `FinishedAt`.

6. `src/Filament.Infrastructure/Repositories/Repositories.cs`:
   - `ApplyState(SpoolEntity spool, SpoolState state)`: add `spool.LastUsedAt = state.LastUsedAt;` (this single change covers both `ApplyLifecycleAsync` and `ReevaluateAllAsync`, satisfying the spec's reevaluate-repair requirement automatically).
   - `SpoolRepository.ListAsync`: change signature to `Task<IReadOnlyList<Spool>> ListAsync(SpoolSort sort = SpoolSort.LastUsed, string? filamentTypeId = null, bool includeFinished = false, CancellationToken ct = default)`. Replace `OrderByDescending(s => s.CreatedAt)` with the sort switch:
     ```csharp
     IOrderedIQueryable<SpoolEntity> ordered = sort switch
     {
         SpoolSort.LeastRemaining => q.OrderBy(s => s.RemainingGrams),
         SpoolSort.MostRemaining => q.OrderByDescending(s => s.RemainingGrams),
         _ => q.OrderByDescending(s => s.LastUsedAt),
     };
     var entities = await ordered.ThenByDescending(s => s.LastUsedAt).ThenBy(s => s.Id).ToListAsync(ct);
     ```
     (The `ThenByDescending(s => s.LastUsedAt)` is redundant for the `LastUsed` primary but harmless; it keeps one code path for the fixed secondary order required by the spec.)

7. `src/Filament.Core/Abstractions/IRepositories.cs`: update `ISpoolRepository.ListAsync` signature to match (add `SpoolSort sort = SpoolSort.LastUsed` as the first parameter, before `filamentTypeId`).

8. `src/Filament.Api/Dtos/Dtos.cs`: add `DateTimeOffset? LastUsedAt,` to the `SpoolDto` record, immediately after `FinishedAt` (keeps the DTO diff minimal and grouped with the other cached timestamps).

9. `src/Filament.Api/Mapping/DtoMapping.cs`: in `ToDto(this Spool s, FilamentType type)`, add `s.LastUsedAt` to the `SpoolDto` constructor call (after `s.FinishedAt`). This covers both `GET /api/spools` (list) and `GET /api/spools/{id}` (detail), since both call this `ToDto` overload (verified in `SpoolsController.cs:71` and `:57`).

10. `src/Filament.Api/Controllers/SpoolsController.cs`: in `List`, add `[FromQuery] string? sort,` to the action signature (before `CancellationToken ct`). Resolve via `var sortKey = SpoolSort.Parse(sort);` then call `_spools.ListAsync(sortKey, filamentTypeId, includeFinished, ct)`. No other controller changes. Because OpenAPI is generated via `AddOpenApi`/`MapOpenApi` (`Program.cs`), the new `sort` parameter and the new `lastUsedAt` DTO field are documented automatically — no hand-maintained OpenAPI file to edit.

11. Migration `src/Filament.Infrastructure/Persistence/Migrations/20260802000000_AddSpoolLastUsedAt.cs` (new, timestamp after the latest migration): `Up` adds a nullable `datetime(6)` column `LastUsedAt` to `spools` and backfills it:
    ```sql
    UPDATE spools s
    LEFT JOIN (
        SELECT SpoolId, MAX(OccurredAt) AS LastUsed
        FROM spool_events WHERE IsDisabled = 0
        GROUP BY SpoolId
    ) t ON t.SpoolId = s.Id
    SET s.LastUsedAt = COALESCE(t.LastUsed, s.CreatedAt);
    ```
    `COALESCE` with `s.CreatedAt` is defensive only — every spool has an enabled `Created` event, so the subquery always returns a row. `Down` drops the column.

12. Update the EF model snapshot `src/Filament.Infrastructure/Persistence/Migrations/FilamentDbContextModelSnapshot.cs`: add `b.Property<DateTimeOffset?>("LastUsedAt").HasColumnType("datetime(6)");` to the `SpoolEntity` block (next to `FinishedAt`). Regenerate via `dotnet ef migrations add AddSpoolLastUsedAt -p src/Filament.Infrastructure -s src/Filament.Api` rather than hand-editing, then verify the generated `.Designer.cs` + snapshot match the existing pattern.

13. `web/src/api/client.ts`: add `lastUsedAt?: string | null` to the `Spool` type (after `finishedAt`). Add a `SpoolSort` union type `export type SpoolSort = 'lastUsed' | 'leastRemaining' | 'mostRemaining'` and update `api.spools.list` to accept an optional `sort?: SpoolSort` and, when present, set `p.set('sort', sort)` in the query string. Export a type guard `isSpoolSort(v: string | null): v is SpoolSort`.

14. `web/src/pages/Spools.tsx`:
    - Read the active sort from the URL on mount: `const [params, setParams] = useSearchParams(); const rawSort = params.get('sort'); const sort: SpoolSort = isSpoolSort(rawSort) ? rawSort : 'lastUsed';` using the type guard from `client.ts`.
    - Pass `sort` into `api.spools.list({ sort, includeFinished, filters: selection })`.
    - Add `sort` to the `useEffect` dependency array alongside `includeFinished` and `JSON.stringify(selection)` so a URL sort change re-queries.
    - Add a `<label>Sort <select ...>` next to the existing toolbar controls with three options ("Last used", "Least remaining", "Most remaining") bound to `sort`. On change, call `setParams(prev => { const next = new URLSearchParams(prev); next.set('sort', value); return next })` so the URL updates before the effect re-runs. Normalize the URL when the resolved sort came from an unknown/missing value (set `sort=lastUsed`) so the address bar reflects what is displayed.
    - The WebSocket `onChange` reload calls `load()` (already present), which re-queries with the current `sort` from state/URL; the sort selector is not changed by a reload. No new logic needed beyond ensuring `load` reads the current `sort` (capture via the effect closure, already the case).
    - Do not reorder rows client-side: render `spools` in the order returned by the API (already the case in the existing `.map`).

15. No changes to `FilamentTypesController`, `DashboardRepository`, faceting, or any other endpoint. The `FacetsDto` payload is unchanged because facet computation happens after `ListAsync` and is independent of ordering.

16. `e2e/tests/sorting.spec.ts` (new): Playwright e2e tests for the browser-visible sorting acceptance criteria (AC-12 through AC-17). The test file uses the existing `seedFixture` from `e2e/tests/fixtures/seed.ts` to create baseline data, then creates additional spools with different remaining weights and lifecycle states to verify ordering. Details:
    - Imports `test, expect` from `./fixtures/seed` and `unique` from `./fixtures/ids`.
    - A helper `createSpoolViaUi(page, typeId, initialNetGrams?)` that navigates to `/spools`, opens the "New spool" form, selects the given type, optionally sets an initial net weight, and returns the spool ID from the created row.
    - A helper `consumeViaUi(page, spoolId, grams)` that navigates to the spool detail page, opens it if sealed, records a print, and returns.
    - A helper `getSpoolIdsInOrder(page)` that navigates to `/spools`, reads all `tbody tr td a.id-pill` texts, and returns them as an array (top to bottom = first to last).
    - Tests:
      - **"sort selector reflects URL and reorders spools"** (AC-12, AC-13, AC-15): uses `seedFixture`, creates two additional spools with different initial weights, navigates to `/spools?sort=leastRemaining`, asserts the URL bar shows `?sort=leastRemaining`, the selector shows "Least remaining", and the spool IDs are ordered by ascending remaining grams. Then changes the selector to "Most remaining", asserts the URL becomes `/spools?sort=mostRemaining` and the order reverses. Then navigates to `/spools` (no sort) and asserts the selector shows "Last used".
      - **"unknown sort value falls back to lastUsed without error"** (AC-14): navigates to `/spools?sort=garbage`, asserts the selector shows "Last used", no error dialog is visible, and the spool list renders.
      - **"sort is preserved after WebSocket reload"** (AC-16): navigates to `/spools?sort=leastRemaining`, then triggers a spool change by consuming filament on a spool via the UI in a way that causes a WebSocket `change` notification (e.g. opening a new tab or using `page.evaluate` to trigger a reload). Asserts the selector still shows "Least remaining" and the URL still has `?sort=leastRemaining`. (This test may use `page.reload()` to simulate a WebSocket-driven reload if the change-broadcast mechanism is hard to trigger from a second context; the spec's intent is that the sort survives a data reload.)
      - **"frontend does not reorder client-side"** (AC-17): navigates to `/spools?sort=mostRemaining`, reads the spool IDs in order, then reads the same spools via `page.evaluate(() => fetch('/api/spools?sort=mostRemaining').then(r => r.json()))` and asserts the UI order matches the API response order.

## Test Matrix

| Acceptance criterion | Test layer | Test | Expected evidence |
|---|---|---|---|
| AC-1 (no `sort` → lastUsed desc, then id asc) | Infrastructure (SQLite in-memory) | `ListSortTests.NoSort_DefaultsToLastUsedDescThenIdAsc` | Two spools with different `LastUsedAt` returned most-recent first; two spools with equal `LastUsedAt` returned in `id` asc order. |
| AC-2 (`sort=lastUsed`) | Infrastructure | `ListSortTests.SortLastUsed_OrdersByLastUsedDescThenIdAsc` | Same ordering as AC-1, explicitly. |
| AC-3 (`sort=leastRemaining`) | Infrastructure | `ListSortTests.SortLeastRemaining_OrdersByRemainingAscThenLastUsedDescThenIdAsc` | Spools with `remaining_grams` 5, 50, 500 returned in that order; equal remaining ordered by `lastUsedAt` desc then `id` asc. |
| AC-4 (`sort=mostRemaining`) | Infrastructure | `ListSortTests.SortMostRemaining_OrdersByRemainingDescThenLastUsedDescThenIdAsc` | Reverse of AC-3. |
| AC-5 (`sort=unknownValue` → lastUsed, 200) | Unit | `SpoolSortParserTests.Parse_UnknownValue_ReturnsLastUsed` | `"garbage"` → `SpoolSort.LastUsed`. (HTTP 200 is the controller default for a successful list; no 400 path exists for this parameter.) |
| AC-6 (`sort=` → lastUsed, 200) | Unit | `SpoolSortParserTests.Parse_EmptyString_ReturnsLastUsed` | `""` → `SpoolSort.LastUsed`. |
| AC-7 (finished interleaved by `lastUsedAt`) | Infrastructure | `ListSortTests.SortLastUsed_WithIncludeFinished_InterleavesFinished` | With `includeFinished=true`, a finished spool whose `LastUsedAt` is newer than an active spool's appears before it. |
| AC-8 (sort + facets independent; facets unchanged) | Infrastructure | `ListSortTests.SortWithFacets_FacetPayloadUnchanged` | The `FacetsDto` returned with `sort=leastRemaining` equals the facets returned without `sort` for the same facet selection. |
| AC-9 (`lastUsedAt` in DTO; equals most recent enabled event; `Created`-only → `CreatedAt`) | Unit (Core) + Infrastructure | `SpoolLifecycleTests.Evaluate_SetsLastUsedAtToMostRecentEnabledEvent` (Core) and `ListSortTests.Dto_LastUsedAt_EqualsMostRecentEnabledEventOrCreatedAt` (Infrastructure) | Core: a spool with `Created`+`Opened`+`Print` reports `LastUsedAt == Print.OccurredAt`; disabling the print makes `LastUsedAt == Opened.OccurredAt`. Infrastructure: a `Created`-only spool's mapped DTO has `lastUsedAt == createdAt`; a spool with a later event has `lastUsedAt == that event's occurredAt`. |
| AC-10 (disable most recent event → lastUsedAt updates) | Infrastructure | `ListSortTests.AfterDisableMostRecentEvent_LastUsedAtMovesToPriorEvent` | Apply lifecycle to disable the newest Print; subsequent `ListAsync` returns the spool with `LastUsedAt == previous enabled event's occurredAt`. |
| AC-11 (redo disabled event → lastUsedAt updates back) | Infrastructure | `ListSortTests.AfterReenableEvent_LastUsedAtMovesToIt` | Re-enable the disabled Print; `ListAsync` returns `LastUsedAt == that event's occurredAt`. |
| AC-12 (`/spools?sort=leastRemaining` loads least-first, URL + selector reflect it) | Playwright | `sorting.spec.ts: "sort selector reflects URL and reorders spools"` | Navigate to `/spools?sort=leastRemaining`; assert URL bar shows `?sort=leastRemaining`, selector shows "Least remaining", and rows are ordered by remaining grams ascending. |
| AC-13 (`/spools` default → last used, URL normalized) | Playwright | `sorting.spec.ts: "sort selector reflects URL and reorders spools"` (second half) | Navigate to `/spools` (no sort); assert selector shows "Last used". |
| AC-14 (`/spools?sort=garbage` → last used, no error) | Playwright | `sorting.spec.ts: "unknown sort value falls back to lastUsed without error"` | Navigate to `/spools?sort=garbage`; assert selector shows "Last used", no error dialog, list renders. |
| AC-15 (changing selector updates URL then re-queries) | Playwright | `sorting.spec.ts: "sort selector reflects URL and reorders spools"` (selector change part) | Change selector to "Most remaining"; assert URL becomes `/spools?sort=mostRemaining` and rows reorder. |
| AC-16 (WS `change` reload preserves sort) | Playwright | `sorting.spec.ts: "sort is preserved after WebSocket reload"` | On `/spools?sort=leastRemaining`, trigger a data reload; assert selector still "Least remaining", URL unchanged, order preserved. |
| AC-17 (frontend does not reorder client-side) | Playwright | `sorting.spec.ts: "frontend does not reorder client-side"` | Compare UI row order against `/api/spools?sort=mostRemaining` response order; assert they match. |

## Test Commands

~~~text
# Backend: build + all unit and infrastructure tests
dotnet build Filament.sln
dotnet test Filament.sln

# Regenerate the migration after editing entities (run before committing the migration files)
dotnet ef migrations add AddSpoolLastUsedAt \
  -p src/Filament.Infrastructure -s src/Filament.Api \
  -o Persistence/Migrations

# Frontend: typecheck + production build
npm --prefix web run build

# E2E typecheck
npm --prefix e2e run typecheck

# E2E: full run (builds images, starts stack, runs Playwright, tears down)
npm --prefix e2e run e2e

# E2E: re-run only sorting tests against an already-running stack
npx --prefix e2e playwright test sorting.spec.ts
~~~

## Out Of Scope

- Filament-type sorting (`GET /api/filament-types`).
- Dashboard endpoint sorting.
- Pagination.
- New sort keys beyond the three specified.
- Persisting the sort choice in localStorage.
- Modifying any existing migration.
- Introducing a `WebApplicationFactory`-based API integration test project.
- Changes to the WebSocket protocol or `ChangeBroker`.

## Risks And Rollback Notes

- **Risk: `LastUsedAt` cache drift.** Mitigated by deriving it in the single
  `SpoolLifecycle.Evaluate` path that also derives `remaining_grams`,
  `openedAt`, `finishedAt`, and by writing it through the single
  `ApplyState` used by both lifecycle writes and `reevaluate`. The existing
  `POST /api/spools/reevaluate` endpoint repairs it after manual DB work, as
  the spec requires.
- **Risk: migration backfill correctness on legacy rows.** The backfill SQL
  uses `MAX(OccurredAt)` over enabled events per spool, which is exactly what
  `Evaluate` computes; `COALESCE(..., s.CreatedAt)` is a defensive fallback
  that should never trigger because every spool has an enabled `Created`
  event. Verified by the `Created`-only spool infrastructure test (AC-9).
- **Risk: SQLite vs MariaDB ordering differences in tests.** EF Core
  translates `OrderBy`/`ThenBy` consistently across providers; the sort
  expressions use only simple column comparisons (no MariaDB-specific SQL), so
  SQLite in-memory is a faithful proxy for the `ORDER BY` semantics. The
  production provider remains Pomelo/MySQL.
- **Risk: case-sensitivity of `sort` param.** Spec mandates exact lowercase
  values; the `SpoolSort.Parse` switch is case-sensitive by design. A
  casing mismatch is intentionally treated as unknown → default.
- **Risk: Playwright sorting tests depend on multiple spools with known
  weights.** Mitigated by the `seedFixture` + helper functions that create
  spools with explicit `initialNetGrams` and consume known amounts. Each test
  uses unique values via the `unique()` helper, so parallel runs don't collide.
- **Risk: AC-16 WebSocket test may be flaky** if the change-broadcast timing
  is hard to control from a single browser context. Mitigated by using
  `page.reload()` as a fallback to simulate a data reload (the spec's intent
  is that the sort survives a data reload, not that a real WebSocket frame is
  required).
- **Rollback:** the migration is additive and reversible (`Down` drops the
  column). Reverting the code changes and running `dotnet ef database update
  <previous-migration>` restores the prior schema. The DTO change is
  additive (new nullable field), so older frontends continue to work against a
  new backend and vice versa.
- **Rollback for frontend:** the URL `sort` parameter is ignored by older
  backends (unknown query params are not validated), so a newer frontend can
  be rolled back independently without breaking an older backend; the sort
  selector simply stops affecting order until the backend is also rolled
  forward.
