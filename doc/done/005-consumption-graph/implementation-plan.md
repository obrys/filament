# Implementation Plan: Consumption graph (005)

## Approval

Status: approved
Approved by: obrys
Approved on: August 21, 2026

## Summary

Replace the dashboard's "Consumption · last 30 days" bar chart with a two-line inline-SVG graph over a fixed 30-day UTC window:

- **Total stock** line (left axis) — remaining grams on non-finished spools, reconstructed per-day from full enabled-event history.
- **Consumed** line (right axis) — grams from *enabled print events only* per day.

Per-day values are computed **server-side** as a pure, unit-testable derivation (Core), exposed through the existing `GET /api/dashboard/usage` endpoint (extended, zero-filled, consecutive, in whole grams). The client renders the provided values; hover/tap reveals exact per-day values. Coverage: xUnit unit tests for the derivation and Playwright e2e tests for every user-visible acceptance criterion.

No charting library, no schema change, no change to the summary endpoint or the four bottom stat cards.

## Preconditions And Decisions

### Confirmed preconditions
- Exactly one request directory: `doc/todo/005-consumption-graph/`.
- `specification.md` is `Status: approved` (obrys, 2026-08-21).
- `doc/spec/domain-rules.md` (events, weight rules, lifecycle, current "daily consumption" definition) and `doc/spec/interfaces.md` (dashboard endpoints, WebSocket flow) were read.
- Minimum relevant code read: `Repositories.cs` (`DashboardRepository`), `DashboardController.cs`, `Dtos.cs` (`DailyUsageDto`), `SpoolLifecycle.cs`, `IRepositories.cs` (`DailyUsage`), `Domain/SpoolEvent.cs`, `Domain/Spool.cs`, `web/src/pages/Dashboard.tsx`, `web/src/api/client.ts`, e2e fixtures (`seed.ts`, `ids.ts`), `scripts/run-e2e.sh`, `tests/Filament.Infrastructure.Tests/{MariaDbFixture,Seeder}.cs`, `tests/Filament.Core.Tests/Services/SpoolLifecycleTests.cs`.
- The request fits one focused pull request (one PR touching Core, Infrastructure, Api, `web/`, and an e2e spec). No split proposed.

### Binding decisions already made in the approved specification
- D1 — Per-day stock reconstruction over the full window (not just today).
- D2 — Finished spool's remaining is excluded from stock from the finish day onward; a finish never touches the consumed line.
- D3 — Consumed line = enabled **print events only**; creation / adjustments (both signs) / finishes affect only the total line. (Supersedes the current "consumption includes negative adjustments" rule.)
- D4 — Undo/redo/deletion fully reflected in both lines.
- D5 — Each axis = 0 … (max per-day value in window × 1.05), floored at 1000 g.
- D6 — Hover = vertical day highlight + floating tooltip with both exact values; tap is the touch replacement.
- D7 — 6–8 x-axis labels, always including first day and today, short month-day, UTC (no local-time shift).
- D8 — Window is fixed 30 days, zero-filled; WebSocket live-refresh unchanged; the "… g total" sum text is removed; responsive at 375 px.
- D9 — Labels/tooltip show the UTC day value as-is (fixes the current west-of-UTC off-by-one).
- D10 — Legend labels "Total stock" and "Consumed".

### Decisions resolved at plan stage (confirmed by user)
The specification leaves these to the plan. The user confirmed each below (obrys, 2026-08-21); they are no longer blocking.

- **B1 — e2e past-day seeding mechanism (confirmed — recommended option).** Affects `scripts/run-e2e.sh`, `e2e/package.json`.
  Several acceptance criteria require events on days strictly *before* today (AC-5, AC-6, AC-7, AC-8, and the multi-day case of AC-10). The UI/lifecycle endpoints stamp `UtcNow` and offer no `occurredAt`, so past-day rows cannot be created through the UI, and the Playwright runner (not in the app's container network) cannot reach MariaDB today.
  - **Chosen:** Seed past-dated `filament_types` / `spools` / `spool_events` rows **directly via SQL** from the e2e harness (all `is_disabled=0`, correct `delta_grams`, past `occurred_at`), then call the **existing** `POST /api/spools/reevaluate` endpoint to reconcile the derived caches (`status`, `remaining_grams`, `opened_at`, `finished_at`, `last_used_at`) — the documented, already-tested repair operation. Adds **no** C# seeding endpoint.
  - Enabling changes (test-harness only, not application code): (a) publish the e2e DB to a host port in `scripts/run-e2e.sh` (mirrors the infra fixture's published-port pattern) and export `E2E_DB_HOST_PORT`, and (b) add a Node MariaDB/MySQL client (`mysql2`) as an e2e **devDependency**.

- **B2 — Dashboard endpoint shape (confirmed — recommended option).**
  - **Chosen:** **Extend the existing** `GET /api/dashboard/usage?days=N` so its per-day item carries both `consumedGrams` and `totalStockGrams`, zero-filled and consecutive, preserving the `days` 1–365 clamp and 30-day default. Single round-trip, minimal surface change, no new route. No other consumer of this endpoint exists.

- **B3 — Hero stat tiles "Used (30 d)" and "Busiest day" (confirmed — recommended option).**
  - **Chosen:** Adopt the **prints-only** values for the two hero tiles (consistent with D3; no extra query). The four bottom `.stats` cards come from `/summary` and are **unchanged**.

### Non-implementation choices left open within the approved bounds
Exact axis tick count / label rounding, exact tooltip date format, and the two line colors (must be visually distinct and legible at 375 px; AC 1, 3, 15 constrain them). Resolved during implementation; not a blocker.

### Vision use — proposed, with failure case
Propose using vision on Playwright-captured screenshots (the e2e config already records screenshot + video + trace) to *sanity-check* the rendered chart: distinct line colors, legend swatch matching its line, no horizontal overflow at 375 px, and the hover tooltip layout.
**Failure case:** vision can misread exact colors, pixel positions, or a 1 px overflow. Therefore no acceptance criterion is gated on vision. Every visual rule is also encoded as a hard, deterministic assertion on the rendered DOM/SVG (legend `stroke`/`fill` color equality, axis label text, label count 6–8, `tooltip` text content, `element.getBoundingClientRect().right <= viewport width`). Vision is a supplement, not the source of truth; if vision is unavailable or disagrees with a DOM assertion, the DOM assertion wins.

## Implementation Steps

Ordered; each step is file-oriented. No unnecessary abstractions are introduced (one new pure Core service, one new React component, one new e2e fixture, one new e2e spec).

### Backend

1. `src/Filament.Core/Services/SpoolSeries.cs` (**NEW**, pure — no DB, no I/O):
   - `public sealed record SpoolSeriesInput(string SpoolId, int InitialNetGrams, IEnumerable<SpoolEvent> EnabledEvents)`.
   - `public sealed record DailySeriesPoint(DateOnly Day, int ConsumedGrams, int TotalStockGrams)`.
   - `public static IReadOnlyList<DailySeriesPoint> BuildSeries(IReadOnlyList<SpoolSeriesInput> spools, DateOnly endDay, int days)`.
   - Window = `days` consecutive UTC days ending at `endDay` (oldest = `endDay.AddDays(-(days-1))` → `endDay`), zero-filled.
   - Per spool, sort enabled events chronologically `(OccurredAt, KindRank, Id)` — same ordering rule as `SpoolLifecycle.Evaluate` (Created<Opened<Print/Adjustment<Finished, then Id).
   - **Consumed(day)** = sum of `(-DeltaGrams)` over *enabled `Print`* events whose UTC day == that day. Opened/Finished/Created/Adjustment contribute nothing.
   - **TotalStock(day)** for a spool: walk the window ascending applying all enabled events with `OccurredAt <= end-of-day` to a running balance (start `InitialNetGrams`) and a `finished` flag (`finished` set on `Finished`);
     - contribution on day D = `0` if `finished` at end of D, else `max(0, running)` at end of D;
     - contribution is `0` on any window day strictly before the spool's **creation day** (the earliest enabled event, i.e. its `Created`);
     - spools finished before the window start therefore contribute `0` for the whole window (D2/Rule 9) because pre-window events flip `finished` during the first window-day pass.
   - Sum contributions across spools per day; both series in whole, non-negative grams (`TotalStock` clamped to `>= 0`).
   - Day bucketing uses `DateOnly.FromDateTime(e.OccurredAt.UtcDateTime)` (existing convention).

2. `src/Filament.Core/Abstractions/IRepositories.cs` (**EDIT**):
   - Add `public sealed record DailySeries(DateOnly Day, int ConsumedGrams, int TotalStockGrams);`.
   - On `IDashboardRepository`, **replace** `Task<IReadOnlyList<DailyUsage>> GetUsageAsync(int days, CT)` with `Task<IReadOnlyList<DailySeries>> GetSeriesAsync(int days, CT)`. Remove the now-unused `DailyUsage` record (line 62) — it has no other consumers.

3. `src/Filament.Infrastructure/Repositories/Repositories.cs` (**EDIT**, `DashboardRepository`):
   - Implement `GetSeriesAsync(int days, CT)`:
     - `var endDay = DateOnly.FromDateTime(DateTimeOffset.UtcNow.UtcDateTime);` (UTC today).
     - Load **all** spools (`Id`, `InitialNetGrams`) including finished, and **all enabled** `spool_events` (`Kind`, `DeltaGrams`, `OccurredAt`, `SpoolId`), grouped by spool. Full history is required so the running balance and finish state at the window start are correct (pre-window events matter for the baseline, not just the window).
     - Build `SpoolSeriesInput`s, call `SpoolSeries.BuildSeries(inputs, endDay, days)`, map to `IReadOnlyList<DailySeries>`.
     - Delete the old `GetUsageAsync` implementation.
   - Note: load-bounded by intended single-user scale (see Risks). No SQL grouping by date is done here — all per-day math is in Core so it stays unit-testable without a DB.

4. `src/Filament.Api/Dtos/Dtos.cs` (**EDIT**): `record DailyUsageDto(DateOnly Day, int ConsumedGrams, int TotalStockGrams)` (add the field).

5. `src/Filament.Api/Controllers/DashboardController.cs` (**EDIT**): `Usage` action calls `_repo.GetSeriesAsync(Math.Clamp(days, 1, 365), ct)` and maps to `DailyUsageDto(x.Day, x.ConsumedGrams, x.TotalStockGrams)`. Keep the `[HttpGet("usage")]` route and default `days = 30`. (The `/summary` action is untouched.)

### Frontend

6. `web/src/api/client.ts` (**EDIT**): update the type consumed by the dashboard to `{ day: string; consumedGrams: number; totalStockGrams: number }` (rename `DailyUsage` → `DailySeries` for clarity); `api.dashboard.usage(days)` still hits `/api/dashboard/usage?days=${days}`.

7. `web/src/components/ConsumptionChart.tsx` (**NEW**): a hand-built inline-SVG component `ConsumptionChart({ series }: { series: DailySeries[] })`. Responsibilities (all computed client-side from the provided zero-filled series):
    - Left/right axes in **kilograms** as dotted "nice" rulers (dotted in the line's color, and the kg labels also in that line's color), top snapped to a meaningful multiple of {0.25, 0.5, 1, 2, 2.5, 5, 10, …} kg, floored at 1 kg, 3–6 ticks, differing counts per axis; a grey dotted vertical gridline at each labeled date. Colors/ink are design-system variables (`--cyan`, `--accent`, `--faint`, `--fg`) so the chart re-themes with light/dark — the legend text must be `var(--fg)`, not the SVG default black (invisible on dark). (Amended 2026-08-21 — see `amendment.md`; supersedes the original `max*1.05` whole-gram axes.)
   - X-axis: 6–8 date labels spread across the window, always including index 0 (first day) and the last index (today); short month-day formatted from the **UTC** day parts (split `day` on `-` → `[y,m,d]`; do **not** use `new Date(day)`/`toLocaleDateString`, which shifts the day west of UTC — see D9).
    - Two `<polyline>`s: Total stock (left scale) and Consumed (right scale), stroked `var(--cyan)` / `var(--accent)` from the design system (distinct, and re-themed by light/dark), legible at 375 px.
   - Legend: exactly two entries "Total stock" and "Consumed", each with a swatch `fill`/`stroke` equal to its line's color; the two line colors differ.
    - Hover: `pointermove` over the plot maps x → nearest day → a vertical highlight line + a **fixed** readout panel (chart header, next to the legend — not floating) showing that day's date and both values as `"<n> g"`. Moving updates day-by-day; leaving the plot removes the highlight and readout. (Amended 2026-08-21 — see `amendment.md`.)
   - Touch: a tap on the plot shows the same highlight+tooltip for the tapped day; a tap outside the plot hides them (works under Playwright touch emulation).
   - Responsive: render into a `viewBox` at 100% container width so the chart fits without causing horizontal page overflow at 375 px; legend and 6–8 x-labels remain visible.
   - Deterministic query hooks for e2e (e.g., `data-testid`/`aria-label` on legend entries, axis labels, highlight, and tooltip) so visual criteria can be asserted on DOM/SVG rather than pixels.

8. `web/src/pages/Dashboard.tsx` (**EDIT**):
   - Remove the bar chart block, the empty-state bars, `maxUsage`, and the `muted mono` "… g total" span (line 76).
   - Render `<div className="card"><ConsumptionChart series={usage} /></div>` (always render — a zero-spool window shows flat 0 lines and 0–1000 axes, not an empty state, per AC-2).
   - Keep `api.dashboard.usage(30)` in `load()` and the `onChange` WebSocket refetch exactly as today (AC-13).
   - Update `totalUsage`/`busiest` to reflect `consumedGrams` (prints-only per B3): "Used (30 d)" = sum of `consumedGrams`; "Busiest day" = max `consumedGrams`. The four bottom `.stats` cards (from `summary`) are left untouched.

### Test harness (e2e only — not application code)

9. `scripts/run-e2e.sh` (**EDIT**): add a host port publish for the e2e DB (e.g. `DB_PORT="${E2E_DB_PORT:-13307}"`, `-p "$DB_PORT:3306"`, export `E2E_DB_HOST_PORT="$DB_PORT"` and add a port-in-use guard) so the Playwright harness can seed via SQL. (Mirrors the infra fixture's published-port approach.)

10. `e2e/package.json` (**EDIT**): add `mysql2` (devDependency). Run `npm i` in `e2e` to update the lockfile.

11. `e2e/tests/fixtures/db.ts` (**NEW**): a small helper using `mysql2/promise` against `E2E_DB_HOST_PORT` (host `127.0.0.1`, db/user/pass `filament`, matching the API's connection string):
    - `resetInventory()` — `DELETE` from `spool_events`, `spools`, `filament_types` (FK order) for per-test isolation.
    - `seedSpool({ typeId?, id, initialNetGrams, createdAt, events: [{ kind, deltaGrams, occurredAt }] })` — inserts a `filament_types` row when `typeId` is omitted, a `spools` row, and the given `spool_events` rows (all `is_disabled=0`).
    - After seeding, `await fetch(`${baseURL}/api/spools/reevaluate`, { method: 'POST' })` to reconcile derived caches via the existing repair endpoint (B1).

12. `e2e/tests/dashboard-consumption.spec.ts` (**NEW**): Playwright e2e for AC-1 … AC-15. Mixed data strategy:
    - **Past-dated data** → `db.ts` `seedSpool` (e.g., a 300 g print on `endDay−5`, a +250 g adjustment on a day, a −200 g adjustment on a day, a spool finished 400 g remaining on a day, a spool created 1 day ago for the create-step), then reevaluate.
    - **Zero-spool** case → `resetInventory()` then navigate to `/`.
    - **Live UI actions** → create (AC-4), undo/redo a print (AC-9), delete a spool (AC-10), a print for the live-refresh test (AC-13).
    - **Reading values** → drive hover/tap via `page.mouse.move` / `page.touchscreen.tap` at computed x positions and read the tooltip/axis/legend DOM; cross-check "today's total stock" against `/api/dashboard/summary` `totalRemainingGrams` where the AC allows (Rule 11).
    - Touch (AC-12) and 375 px (AC-15) via a dedicated context (`hasTouch: true`, `viewport: { width: 375 }`).
    - Live refresh (AC-13) via a second `browser.newContext()`: perform a print in context A, assert context B's tooltip values change without reload.

### Unit tests (xUnit)

13. `tests/Filament.Core.Tests/Services/SpoolSeriesTests.cs` (**NEW**): cover the derivation logic directly (mirror `SpoolLifecycleTests` style — build `SpoolEvent` lists with chosen `OccurredAt`, call `SpoolSeries.BuildSeries`):
    - zero-fill across the full window incl. days with no events;
    - consumed counts **prints only** — a negative adjustment on a day does not raise consumed;
    - a print on day D lowers stock from D onward and raises consumed on D only;
    - positive and negative adjustments shift stock by the delta from D onward, consumed unaffected;
    - finish excludes the spool's remaining from stock from the finish day onward; finish with 0 g changes neither line;
    - a spool created on day C contributes 0 before C and its weight from C onward;
    - a spool finished before the window start contributes 0 for the whole window;
    - pre-window events correctly set the starting balance/finish state (baseline reconstruction);
    - undo/redo: an enabled↔disabled toggle on a print/adjustment/finish removes/restores its effect for its day and every later day;
    - non-negative clamp and whole-gram output; flat (no-event) days are exact constant levels.

14. `tests/Filament.Infrastructure.Tests/DashboardSeriesTests.cs` (**NEW**, recommended; reuses `MariaDbFixture` + `Seeder`): seed spools and past-dated events against real MariaDB, call `DashboardRepository.GetSeriesAsync(30)`, and assert the zero-filled consecutive series — real-SQL evidence that the repo fetches all spools + enabled events and that the per-day reconstruction (incl. pre-window baseline) matches. (The pure derivation is already covered by step 13; this proves the fetch/mapping path. If the user wants the plan minimal, this file may be omitted without changing the mandated unit-test layer.)

## Test Matrix

Both layers are used. Every user-visible AC links to ≥1 Playwright test (mandated). "Expected evidence" states the concrete, deterministic assertion that makes the AC pass independently of vision.

| AC | Test layer | Test | Expected evidence |
|---|---|---|---|
| AC-1 legend, swatch=color, colors differ (theme-adaptive, axis labels match line) | Playwright e2e | `dashboard-consumption.spec.ts › legend` + `› legend ink is legible in dark mode and kg labels match their line color` | "Total stock"/"Consumed" text; each swatch `fill` == its line `stroke`; the two `stroke` colors differ; in a `colorScheme:'dark'` context the legend ink luminance > 0.5 (not the SVG default black) and each y-axis kg label's **computed** `fill` == its line's computed `stroke` |
| AC-2 zero spools: full window, 0/0 readout, 0…1 kg axes | Playwright e2e (+ Core unit) | `… › empty system` (reset inventory → `/`); Core `SpoolSeriesTests` empty/zero-fill | leftmost x-label == UTC today−29, rightmost == UTC today; hover middle day → readout "0 g"/"0 g"; both axes read 0 and top "1 kg"; each axis has 3–6 dotted kg ticks and the two counts differ |
| AC-3 nice kg rulers | Playwright e2e | `… › axis top values snap to meaningful kilogram rulers` (seed 3.8 kg stock, 1.5 kg consumed) | left top "4 kg" (0,1,2,3,4), right top "1.5 kg" (0,0.5,1,1.5); 5 vs 4 ticks (counts differ) — a meaningful multiple ≥ the window max, not max×1.05 |
| AC-4 create 1000 g today → today's total +1000, consumed unchanged | Playwright e2e (+ Core unit) | `… › create spool` (UI); Core `SpoolSeriesTests` creation-day gating | today's tooltip total stock +1000 g vs before; every earlier day unchanged; consumed line identical on all days |
| AC-5 seeded 300 g print on day D | Playwright e2e (+ Core unit) | `… › seeded print` (db seed print@D); Core print-step test | day-D tooltip consumed == 300 g; earlier days keep prior consumed; stock from D onward 300 g lower than day D−1 |
| AC-6 seeded +250 g adjustment on day D | Playwright e2e (+ Core unit) | `… › seeded +adjustment`; Core positive-adjustment test | stock 250 g higher from D onward; day-D tooltip consumed unchanged |
| AC-7 seeded −200 g adjustment on day D | Playwright e2e (+ Core unit) | `… › seeded −adjustment`; Core negative-adjustment test | stock 200 g lower from D onward; day-D consumed unchanged (never raised by a negative adjustment) |
| AC-8 spool finished on day D with 400 g remaining | Playwright e2e (+ Core unit) | `… › seeded finish`; Core finish-exclusion test | stock 400 g lower from D onward; day-D consumed unchanged (0 g if no print that day) |
| AC-9 undo/redo 300 g print on day X | Playwright e2e (+ Core unit) | `… › undo/redo print` (UI undo/redo); Core undo/redo test | undo: day-X consumed −300 g and stock +300 g from X onward; redo restores both |
| AC-10 delete a spool with seeded prints + stock | Playwright e2e | `… › delete spool` (UI delete) | all the spool's consumed-line values and stock contribution removed from every day |
| AC-11 hover highlight + tooltip, move updates, leave hides | Playwright e2e | `… › hover` (mouse.move across plot) | vertical highlight on hovered day; tooltip shows date + both "<n> g" values; moving to D′ updates values; mouseleave removes highlight + tooltip |
| AC-12 touch tap show/hide | Playwright e2e | `… › touch` (context hasTouch, `touchscreen.tap`) | tap at day D → highlight + tooltip with both values; tap outside plot hides them |
| AC-13 live refresh in second context | Playwright e2e | `… › live refresh` (two contexts) | print in context A → context B tooltip consumed + total stock change without manual reload |
| AC-14 no "… g total" sum text | Playwright e2e | `… › no sum text` | no element in the consumption section matches `/g total$/` |
| AC-15 375 px: no h-overflow, legend visible, 6–8 labels | Playwright e2e | `… › responsive@375` (viewport 375) | chart element `getBoundingClientRect().right <= viewport width`; body not horizontally scrollable; legend visible; x-label count within [6, 8] |

Unit tests (step 13) provide the domain-logic evidence backing AC-4/5/6/7/8/9 and the zero-fill/finish/adjustment/consumed-definition/undo-redo behavior; step 14 provides real-SQL evidence for the fetch path. The Playwright layer covers all 15 ACs as user-visible behavior, per the project testing policy.

## Test Commands

Exact commands (run from the repo root unless noted). CI runs these same paths.

~~~text
# Backend build + unit tests (full suite; Core.Tests has the new SpoolSeries tests, Infra tests the new series fetch)
dotnet restore
dotnet build --no-restore --configuration Release
dotnet test --no-build --configuration Release --verbosity normal

# Focused unit-test runs (optional, faster iteration)
dotnet test tests/Filament.Core.Tests/Filament.Core.Tests.csproj --filter FullyQualifiedName~SpoolSeriesTests
dotnet test tests/Filament.Infrastructure.Tests/Filament.Infrastructure.Tests.csproj --filter FullyQualifiedName~DashboardSeriesTests   # optional (step 14)

# Frontend typecheck/build (tsc -b typechecks the new component + client change)
cd web && npm ci && npm run build && cd ..

# e2e harness dependency (new mysql2)
cd e2e && npm i && npx playwright install --with-deps chromium && cd ..

# Full e2e (builds API+Web+DB containers, runs Playwright)
bash scripts/run-e2e.sh tests/dashboard-consumption.spec.ts
~~~

## Out Of Scope

- No charting library; the graph is hand-built inline SVG (no new frontend dependency).
- No database tables, columns, or migrations; per-day values are derived from `spool_events` + spool state on every request.
- No change to `/api/dashboard/summary` or the four bottom stat cards, the WebSocket protocol, label/sort/facet features, or any other route.
- No change to time-zone bucketing (UTC calendar days), spool lifecycle rules, weights, or event semantics.
- `doc/spec/` updates (notably `domain-rules.md` line 103 and the "daily consumption" definition under Decision 3) happen in the **document stage after verification**, not in this change.
- Adding a Node MySQL client (`mysql2`) and publishing an e2e DB port are **test-harness** changes supporting the mandated e2e coverage; they do not alter the shipped application.
- Optional real-SQL integration test (step 14) is a recommended extra; omitting it does not change the mandated unit-test layer.

## Risks And Rollback Notes

- **Full-history event load in `GetSeriesAsync`:** the reconstruction needs every spool plus all enabled events so the window-start baseline is correct. At the intended single-user scale this is negligible; if spool/event counts ever grow large, restrict to spools that existed within a bounded horizon. Tracked as a follow-up, not in scope.
- **Axis scaling + colors live in the frontend** (no unit runner in `web/`): verified only by Playwright assertions (AC-2/AC-3 axis labels; AC-1 swatch/line/label color + the dark-theme legibility test). The nice-kg ladder is a pure function (`niceTicks`) and the colors are the design-system variables (`--cyan`/`--accent`/`--faint`/`--fg`), so it stays deterministic and text/computed-assertable.
- **UTC label formatting (D9):** must avoid `new Date(day)`/`toLocaleDateString` (shifts the day west of UTC). Split the ISO date into parts; covered by AC-2 (leftmost/rightmost) and AC-11.
- **Negative balances:** domain rules keep remaining ≥ 0 (prints capped at remaining; adjustments target ≥ 0); `BuildSeries` also clamps `TotalStock` to ≥ 0 defensively (Rule 12). Asserted in unit tests.
- **e2e DB seeding (B1):** seeding raw rows then calling the existing `/api/spools/reevaluate` keeps caches consistent using already-tested behavior; reevaluate is global but the e2e DB is isolated per run. The published DB port is a fixed, guarded host port added only to the e2e script.
- **Endpoint shape change (B2):** `DailyUsageDto` gains a field and becomes zero-filled/consecutive. No other consumer exists; the SPA bundle is versioned (`X-App-Version`), so a deploy loads a matching client.
- **Rollback:** revert the single PR. The old bar chart, `GetUsageAsync`, `DailyUsage`/`DailyUsageDto`, and `run-e2e.sh`/`e2e` harness changes all revert together; no schema change means nothing to migrate.
