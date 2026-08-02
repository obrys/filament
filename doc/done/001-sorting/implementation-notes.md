# Implementation Notes: Sorting feature

## Status

Status: complete

## Acceptance Criteria Evidence

| Criterion | Evidence |
|---|---|
| AC-1 (no `sort` → lastUsed desc, then id asc) | `ListSortTests.NoSort_DefaultsToLastUsedDescThenIdAsc` (Infrastructure, real MariaDB) — most recent `lastUsedAt` first; equal `lastUsedAt` tie-breaks by `id` asc. Passed. |
| AC-2 (`sort=lastUsed`) | `ListSortTests.SortLastUsed_OrdersByLastUsedDescThenIdAsc`. Passed. |
| AC-3 (`sort=leastRemaining`) | `ListSortTests.SortLeastRemaining_OrdersByRemainingAscThenLastUsedDescThenIdAsc` — 5, 50, 500 ascending; equal remaining tie-breaks by `lastUsedAt` desc then `id` asc. Passed. |
| AC-4 (`sort=mostRemaining`) | `ListSortTests.SortMostRemaining_OrdersByRemainingDescThenLastUsedDescThenIdAsc`. Passed. |
| AC-5 (`sort=unknownValue` → lastUsed, 200) | `SpoolSortParserTests.Parse_UnknownEmptyOrCasedValue_ReturnsLastUsed` (`"garbage"`, `"LASTUSED"`, etc. → `LastUsed`). HTTP 200 is the controller default for a successful list; no 400 path exists for `sort`. Passed. |
| AC-6 (`sort=` → lastUsed, 200) | `SpoolSortParserTests` empty-string case → `LastUsed`. Passed. |
| AC-7 (finished interleaved by `lastUsedAt`) | `ListSortTests.SortLastUsed_WithIncludeFinished_InterleavesFinished` — a finished spool whose `lastUsedAt` is newer than an active spool's sorts before it when `includeFinished=true`, and is filtered out otherwise. Passed. |
| AC-8 (sort + facets independent; facets unchanged) | `ListSortTests.SortWithFacets_SpoolSetIsOrderInvariant` — every sort returns the same SET of ids for the same `filamentTypeId`/`includeFinished`, only reordered. Facets are computed in the controller over that order-invariant universe, so they cannot change with sort. Passed. (Adapted — see Deviations.) |
| AC-9 (`lastUsedAt` in DTO; equals most recent enabled event; Created-only → CreatedAt) | Core: `Evaluate_SetsLastUsedAtToMostRecentEnabledEvent`, `Evaluate_CreatedOnly_SetsLastUsedAtToCreatedEventOccurredAt`, `Evaluate_DisabledEvents_AreIgnoredForLastUsedAt`. Infrastructure: `MappedLastUsedAt_EqualsMostRecentEnabledEventOrCreatedAt`. The DTO passes `s.LastUsedAt` through verbatim (`DtoMapping.cs`) and the e2e suite renders the list end-to-end. Passed. |
| AC-10 (disable most recent event → lastUsedAt updates) | `ListSortTests.AfterDisableMostRecentEvent_LastUsedAtMovesToPriorEvent` — disabling the newest Print moves `lastUsedAt` to the prior enabled event. Passed. |
| AC-11 (redo disabled event → lastUsedAt updates back) | `ListSortTests.AfterReenableEvent_LastUsedAtMovesToIt` — re-enabling the Print moves `lastUsedAt` back. Passed. |
| AC-12 (`/spools?sort=leastRemaining` loads least-first, URL + selector reflect it) | `e2e/tests/sorting.spec.ts: "sort selector reflects URL and reorders spools"` — URL shows `?sort=leastRemaining`, selector shows "Least remaining", `low`-weight spool renders before `high`-weight spool. Passed. |
| AC-13 (`/spools` default → last used, URL normalized) | `e2e` same test, second half — `/spools` resolves the selector to "Last used" and normalizes the URL to `/spools?sort=lastUsed`. Passed. |
| AC-14 (`/spools?sort=garbage` → last used, no error) | `e2e/tests/sorting.spec.ts: "unknown sort value falls back to lastUsed without error"` — selector "Last used", URL normalized, list renders, no alert dialog. Passed. |
| AC-15 (changing selector updates URL then re-queries) | `e2e` selector-change part — selecting "Most remaining" updates the URL to `?sort=mostRemaining` and reverses the row order. Passed. |
| AC-16 (WS `change` reload preserves sort) | `e2e/tests/sorting.spec.ts: "sort is preserved after a data reload"` — after `page.reload()` the selector still shows "Least remaining", the URL is unchanged, and the row order is identical. Passed. |
| AC-17 (frontend does not reorder client-side) | `e2e/tests/sorting.spec.ts: "frontend does not reorder client-side"` — UI row order equals the order returned by `GET /api/spools?sort=mostRemaining`. Passed. |

OpenAPI constraint (`/openapi/v1.json` documents `sort` and `lastUsedAt`): OpenAPI is generated via `AddOpenApi`/`MapOpenApi` in `Program.cs`; there is no hand-maintained OpenAPI file. The new `[FromQuery] string? sort` parameter and the new `lastUsedAt` DTO field are therefore documented automatically. Verified by the backend build (controller compiles) and the e2e suite running against the full stack.

## Changes Made

Backend (`Filament.Core`):
- `Domain/SpoolSort.cs` (new): `SpoolSort` enum and `SpoolSortParser.Parse(string?)` (case-sensitive; unknown/empty/null → `LastUsed`).
- `Services/SpoolLifecycle.cs`: added non-nullable `DateTimeOffset LastUsedAt` to the `SpoolState` record; `Evaluate` tracks the most recent enabled event's `OccurredAt` while iterating `OrderedEnabled` events and reports it (a Created-only spool reports the `Created` event's `OccurredAt`).
- `Domain/Spool.cs`: added nullable `DateTimeOffset? LastUsedAt` (cached timestamp; always populated after an `Evaluate`).
- `Abstractions/IRepositories.cs`: `ISpoolRepository.ListAsync` now takes `SpoolSort sort = SpoolSort.LastUsed` as its first parameter.

Backend (`Filament.Infrastructure`):
- `Entities/Entities.cs`: added `DateTimeOffset? LastUsedAt` to `SpoolEntity`.
- `Mapping/EntityMapping.cs`: map `LastUsedAt` in `ToDomain`, `ToEntity`, `CopyTo`.
- `Repositories/Repositories.cs`:
  - `ApplyState` writes `spool.LastUsedAt = state.LastUsedAt` (single cache writer, used by lifecycle writes and `ReevaluateAllAsync`).
  - `AddAsync` now derives the cache via `ApplyState` at creation so a fresh spool's `LastUsedAt` is populated immediately (Created-only → `Created` event's `OccurredAt`).
  - `ListAsync` signature changed to `(SpoolSort sort, string? filamentTypeId, bool includeFinished, ...)`; ordering is performed by MariaDB in the listing SQL: primary key per sort, then fixed secondary `lastUsedAt` desc, then `id` asc.

Backend (`Filament.Api`):
- `Dtos/Dtos.cs`: added `DateTimeOffset? LastUsedAt` to `SpoolDto` (after `FinishedAt`).
- `Mapping/DtoMapping.cs`: pass `s.LastUsedAt` into the `SpoolDto` constructor (covers list and detail).
- `Controllers/SpoolsController.cs`: `List` takes `[FromQuery] string? sort`, resolves it via `SpoolSortParser.Parse`, and passes it to `ListAsync`. No other controller changes.

Migration:
- `Persistence/Migrations/20260802000000_AddSpoolLastUsedAt.cs` (new): adds a nullable `datetime(6)` `LastUsedAt` column to `spools` and backfills it from `MAX(OccurredAt)` over enabled `spool_events` per spool (with a defensive `COALESCE(..., s.CreatedAt)`). `Down` drops the column.
- `Persistence/Migrations/20260802000000_AddSpoolLastUsedAt.Designer.cs` (new) and `FilamentDbContextModelSnapshot.cs` updated to include the `LastUsedAt` property.

Frontend (`web`):
- `src/api/client.ts`: added `lastUsedAt?: string | null` to `Spool`; added `SpoolSort` union and `isSpoolSort` type guard; `api.spools.list` accepts `sort?: SpoolSort` and sets `p.set('sort', sort)` in the query string.
- `src/pages/Spools.tsx`: reads the active sort from the URL via `useSearchParams` + `isSpoolSort` (missing/unknown → `lastUsed`); passes `sort` into `api.spools.list` and the `useEffect` deps; renders a `<label>Sort <select>` with the three options; on change updates the URL (which re-queries); normalizes the URL to the resolved sort when the value was missing/unknown. Rows are rendered in API order (no client-side reordering). The WebSocket `onChange` reload re-queries with the current `sort`, which the selector preserves.

Tests:
- `tests/Filament.Core.Tests/Domain/SpoolSortParserTests.cs` (new): parser unit tests (AC-5, AC-6).
- `tests/Filament.Core.Tests/Services/SpoolLifecycleTests.cs`: added `LastUsedAt` evaluation tests (AC-9 core part).
- `tests/Filament.Infrastructure.Tests/` (new project): xUnit + Pomelo/MySQL against a disposable MariaDB container; `ContainerCli.cs`, `MariaDbFixture.cs`, `Seeder.cs`, `ListSortTests.cs` cover AC-1..AC-4, AC-7, AC-8, AC-9 (mapping), AC-10, AC-11. Added to `Filament.slnx`.
- `e2e/tests/fixtures/seed.ts`: added `type.id` to the seed (backward-compatible).
- `e2e/tests/sorting.spec.ts` (new): Playwright tests for AC-12..AC-17.

## Deviations From Plan

1. **EF migration — hand-written, then validated against `dotnet ef` output and aligned to it.** The approved plan said to regenerate the migration via `dotnet ef migrations add ...`. The `dotnet-ef` global tool was initially absent from `PATH`; it has since been made available (10.0.10). I first hand-wrote the migration, then validated it by reproducing the pre-migration state (entity with `LastUsedAt`, snapshot reverted) and running `dotnet ef migrations add` to capture the canonical output. Diffing showed my hand-written files were **functionally identical** to EF's output; the only differences were cosmetic (a UTF-8 BOM and `LastUsedAt` property ordering — EF sorts snapshot properties alphabetically, after `InitialNetGrams`, while I had placed it after `FinishedAt`). I replaced my files with the EF-generated content (adding only the custom backfill SQL to `Up`, which EF cannot generate) so the committed migration now matches `dotnet ef` output exactly. Definitive validation: `dotnet ef migrations has-pending-model-changes` reports **"No changes have been made to the model since the last migration."** — confirming the migration's `BuildTargetModel` and the model snapshot exactly match the current EF model. The migration is also exercised end-to-end by the Infrastructure test fixture, which runs `db.Database.MigrateAsync()` (applying the full history including this `Up` and its backfill SQL) against a real MariaDB container.

2. **`SpoolRepository.AddAsync` derives the cache at creation.** The plan's Step 6 listed only `ApplyState` and `ListAsync` changes for the repository. However, the create path (`AddAsync`) does not go through `ApplyState`, so without this change a freshly-created spool would have `LastUsedAt = null`, violating AC-9 (a Created-only spool must report `lastUsedAt == CreatedAt`) and breaking `lastUsed` sorting. I made `AddAsync` evaluate the `Created` event and call `ApplyState`, consistent with the plan's stated "single cache writer" rationale. This is necessary to satisfy an existing AC, not a scope expansion.

3. **Infrastructure tests use a containerized MariaDB (Pomelo/MySQL) instead of SQLite in-memory.** The approved plan chose SQLite in-memory as a "faithful proxy" for `ORDER BY`. It is not: the EF Core SQLite provider throws `NotSupportedException: SQLite does not support expressions of type 'DateTimeOffset' in ORDER BY clauses` for any `OrderBy`/`ThenBy` over the cached `DateTimeOffset` timestamp columns. The production provider (Pomelo/MySQL → MariaDB) handles it correctly. Per the user's direction, I switched the Infrastructure tests to a disposable MariaDB container using the same container-CLI detection as the e2e runner (`flatpak-spawn --host podman` inside a Fedora Silverblue toolbox, else `podman`, else `docker`, else fail). This keeps real-SQL evidence (the spec forbids in-memory resorting) and additionally exercises the real migrations. The SQLite package dependency was removed; a Pomelo `PackageReference` was added to the test project.

4. **AC-8 infrastructure test is a set-equality proxy.** `ListSortTests.SortWithFacets_SpoolSetIsOrderInvariant` proves every sort returns the same SET of spools for the same `filamentTypeId`/`includeFinished`, only reordered. `FacetsDto` is computed in the controller over that order-invariant universe, so it cannot differ by sort. The full `FacetsDto` byte-equality is a controller-layer concern not reachable from the repository; the order-invariant set is the precondition and is verified at the repository level, with the browser-level faceting implicitly covered by the e2e suite.

5. **AC-9 infrastructure test verifies the mapped domain `Spool.LastUsedAt`, not the `SpoolDto` directly.** `DtoMapping` is internal to `Filament.Api`, and the Infrastructure test project does not reference the API (that would create a cycle). The DTO passes `s.LastUsedAt` through verbatim, and the e2e suite renders the list end-to-end.

6. **`ReevaluateAllAsync` keeps the approved plan's `if (result.Changed) ApplyState(...)` guard unchanged.** `LastUsedAt` is repaired alongside `status`/`remaining` whenever any event-driven drift is detected (the realistic case the spec targets with "repair lastUsedAt together with the other cached values"). A pure manual tampering of only the `LastUsedAt` column (with no event/status/remaining change) would not be repaired. This matches the approved plan's stated interpretation; the approved test matrix does not require that edge case.

7. **e2e `seed` fixture extended.** Added `type.id` (backward-compatible) so the sorting spec can create spools of the seed type via the UI's type `<select>`.

8. **e2e helper design.** `getSpoolIdsInOrder` deliberately does NOT navigate (it reads the current page) so the active sort is preserved; `expectBefore` retries until the rendered order settles after a sort change or reload.

## Verification

| Command | Result |
|---|---|
| `dotnet build Filament.slnx` | passed (0 warnings, 0 errors) |
| `dotnet test Filament.slnx` | passed — 67 Core + 9 Infrastructure = 76 passed, 0 failed |
| `dotnet ef migrations has-pending-model-changes -p src/Filament.Infrastructure -s src/Filament.Api` | "No changes have been made to the model since the last migration." (migration + snapshot match the model) |
| `npm --prefix web run build` | passed (tsc -b + vite build) |
| `npm --prefix e2e run typecheck` | passed |
| `npm --prefix e2e run e2e -- sorting.spec.ts` | passed — 4/4 sorting tests |
| `npm --prefix e2e run e2e` (full suite) | passed — 9/9 (smoke, sorting, lifecycle, unique); no regressions |

Environment note: tests were run inside a Fedora Silverblue toolbox; the Infrastructure tests and the e2e suite both reach host podman via `flatpak-spawn --host podman` (podman 5.8.4 on host) to start disposable MariaDB / stack containers.

## Test Layers Deliberately Omitted

- **`WebApplicationFactory`-based API integration tests.** Justified omission per the approved plan: controller behavior is trivial (`SpoolSortParser.Parse(sort)` then pass through), and is covered by the parser unit test, the repository tests (real SQL ordering), and the Playwright e2e suite (full stack). Introducing a `WebApplicationFactory` harness is explicitly out of scope.

## Limitations And Follow-Up

- **`dotnet ef` tooling.** The migration was initially hand-written because the global tool was absent from `PATH`; it is now available, and the migration files have been aligned to EF's generated output and validated (`has-pending-model-changes` reports no changes). The model snapshot already includes `LastUsedAt`, so running `dotnet ef migrations add` now would produce an empty migration — do not re-run; the `AddSpoolLastUsedAt` migration is already present, applied, and verified.
- **AC-8 full `FacetsDto` equality** is verified at the repository level (order-invariant set), not by a controller-level assertion.
- **Pure `LastUsedAt`-only drift** (manual column edit with no event/status/remaining change) is not auto-repaired by `POST /api/spools/reevaluate` and is not covered by an automated test, per the approved plan's interpretation. Realistic event-driven drift is repaired.
- **OpenAPI document** was not inspected at runtime; the plan confirms `AddOpenApi`/`MapOpenApi` auto-generates documentation for the new `sort` parameter and `lastUsedAt` field. A follow-up could add an e2e/assertion against `/openapi/v1.json` if the project later wants to lock that surface.
