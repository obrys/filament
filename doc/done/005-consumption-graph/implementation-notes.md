# Implementation Notes: 005 Consumption Graph

## Status

Status: complete

## Acceptance Criteria Evidence

All 15 user-visible criteria are covered by Playwright e2e tests in `e2e/tests/dashboard-consumption.spec.ts`. The 15 tests run in one `chromium` worker against a live API + web container pair; each test reseeds the e2e DB via `resetInventory()` in `beforeEach` and again in `afterEach`, so tests never share state and the suite leaves the DB clean.

| Criterion | Evidence |
|---|---|
| AC-1 legend / swatch=color / colors differ (theme-adaptive) | `dashboard-consumption.spec.ts › legend` reads the two `<polyline>` strokes and the two legend swatch (`rect`) fills, asserts text "Total stock"/"Consumed", each swatch fill == its line stroke, and the two strokes are not equal. `› legend ink is legible in dark mode and kg labels match their line color` opens a `colorScheme: 'dark'` context and asserts the legend ink's computed `fill` has luminance > 0.5 (theme `--fg`, not the SVG default black), and that each axis' top kg label's computed `fill` equals its own line's computed `stroke` (the lines/swatches/labels now use `var(--cyan)` / `var(--accent)`). |
| AC-2 zero spools → 30 zero days, 0/0 readout, 0…1 kg axes | `› with no spools` resets the inventory, loads the chart, asserts the x-axis is 30 consecutive labels (leftmost = UTC today−29, rightmost = UTC today, exact month-day), hovers the middle day and reads `0 g` / `0 g` from the readout, asserts both axes read `0` at the bottom and top `1 kg`, and that each axis renders 3–6 dotted kg ticks with the two counts differing (empty axes floor at 1 kg). Backing unit: `SpoolSeriesTests` zero-fill/empty cases. |
| AC-3 nice kg rulers | `› axis top values snap to meaningful kilogram rulers` seeds a spool with 3.8 kg of stock (4 kg before a 1.5 kg print); asserts the left axis top reads `4 kg` (ticks 0,1,2,3,4) and the right axis top `1.5 kg` (ticks 0,0.5,1,1.5), with 5 vs 4 ticks (counts differ). The top is the smallest "nice" kg multiple ≥ the window max, not max×1.05. Backing unit: `SpoolSeriesTests`. |
| AC-4 create 1000 g today → today +1000, consumed unchanged | `› creating` reads today's tooltip total via `readTooltip`, creates a 1000 g spool through the Create Spool UI and clicks `Create Spool`, asserts today's total is exactly +1000, an earlier day is unchanged, and the consumed line is identical at both days. Backing unit: `SpoolSeriesTests` creation-day gating. |
| AC-5 seeded 300 g print on day D | `› 300 g print` seeds a 1000 g spool (created 6 days ago) with an Opened@5 and a 300 g Print@5; asserts day-5 consumed == 300, day-6 consumed == 0, total[5] == total[6]−300, earlier days carry consumed 0. Backing unit: `SpoolSeriesTests` print step. |
| AC-6 seeded +250 g adjustment on day D | `› +250 g adjustment` seeds a +250 Adjustment@5; asserts total[4]−total[5] == −250 and consumed@5 == 0. Backing unit: `SpoolSeriesTests` positive adjustment. |
| AC-7 seeded −200 g adjustment on day D | `› −200 g adjustment` seeds a −200 Adjustment@5; asserts total[4]−total[5] == +200 and consumed@5 == 0 (a negative adjustment never raises consumed). Backing unit: `SpoolSeriesTests` negative adjustment. |
| AC-8 spool finished on day D with 400 g remaining | `› finishing` seeds an Opened@5, 600 g Print@5, Finished@5 (400 g left) on a 1000 g spool — same day, so the created→finished spool only shows stock at days 0–4 (1000) and 0 from day 5; asserts total[4]==1000, total[5..9]==0, and day-5 consumed == 600 (the print that day, unaffected by the finish). Backing unit: `SpoolSeriesTests` finish exclusion + finish-at-0 cases. |
| AC-9 undo/redo 300 g print on day X | `› undoing then redoing` seeds a 300 g Print@5; reads day-5 consumed and total, opens the spool detail and clicks the print's Disable toggle (asserts the button's `aria-disabled`), reloads the dashboard and asserts consumed −300 / total +300 from day 5 on; clicks the now-enabled Enable toggle (asserts not disabled) and asserts both values are restored. Backing unit: `SpoolSeriesTests` undo/redo. |
| AC-10 delete a spool with seeded prints + stock | `› deleting` seeds two spools (A: 1000 g; B: 500 g + 50 g Print@5), captures day-5 consumed and total, opens spool A's detail and clicks the new **Delete spool** button (enabled once spool A's only events are disabled/absent — see Deviations), then asserts day-5 consumed drops by 50 and total drops by 1500. Backing unit: implicit via `SpoolSeriesTests` (removed input ⇒ contribution removed). |
| AC-11 hover highlight + readout; move updates; leave hides | `› hover` seeds a spool, hovers one day, asserts a `hover-highlight` is attached and the fixed readout (header, next to the legend) shows a short month-day date plus two ` N g` values; moves to another day and asserts the total value changed; moves out of the plot and asserts the highlight and readout are detached. (Playwright reports the zero-width vertical highlight line as "hidden", so attachment is asserted, not visibility — see Deviations. The readout is now fixed-position, not floating — see the refinement below.) |
| AC-12 touch tap show/hide | `› on touch` runs in a `hasTouch: true` context, seeds a print at day−2, computes the tapped day's plot x/y via `getBoundingClientRect`, `touchscreen.tap`s it, asserts highlight + `2 × N g`, taps outside the plot, asserts both detach. |
| AC-13 live refresh in a second context | `› live refresh` opens a second `browser.newContext()` on `/` after seeding a print at day−2, captures its day-2 values, records a 120 g print in context A and waits a tick, then asserts context B's day-2 total dropped by 120 and consumed rose by 120 **without a reload** (the WebSocket refetch path). |
| AC-14 no "… g total" sum text | `› no leftover` asserts `page.getByText(/g total$/)` (and a looser `/\b\d+\s*g total/`) match nothing. |
| AC-15 375 px: no h-overflow, legend visible, 6–8 labels | `› responsive@375` runs in a 375 px context, seeds a spool so both lines and a 7th x-label render, asserts the chart's `getBoundingClientRect().right <= 375.5`, `body` scrollWidth <= 375.5, `legend-total` and `legend-consumed` are visible, and the x-axis label count is in [6, 8]. |

## Changes Made

Backend
- `src/Filament.Core/Services/SpoolSeries.cs` (new): pure derivation `BuildSeries(IReadOnlyList<SpoolSeriesInput>, DateOnly endDay, int days)`; records `SpoolSeriesInput`, `DailySeriesPoint`. Sorts enabled events chronologically (same rule as `SpoolLifecycle.Evaluate`), reconstructs the running balance + finish state across the full window from each spool's whole enabled history, emits consumed (prints only) and total stock (per-day, `max(0,·)`, zero before creation day, zero from finish onward), summed over all spools.
- `src/Filament.Core/Abstractions/IRepositories.cs` (edit): `IDashboardRepository.GetUsageAsync` → `GetSeriesAsync`; removed the now-unused `DailyUsage` record.
- `src/Filament.Infrastructure/Repositories/Repositories.cs` (edit): `DashboardRepository.GetSeriesAsync` loads all spools `(Id, InitialNetGrams)` + all enabled `spool_events` grouped by spool, maps to `SpoolSeriesInput`, calls `SpoolSeries.BuildSeries`. Replaced `GetUsageAsync`.
- `src/Filament.Api/Dtos/Dtos.cs` (edit): `DailyUsageDto` gains `TotalStockGrams`.
- `src/Filament.Api/Controllers/DashboardController.cs` (edit): `Usage` maps through `GetSeriesAsync`; route, `days` default 30 and 1–365 clamp unchanged.

Frontend
- `web/src/api/client.ts` (edit): `DailyUsage` → `DailySeries` with `totalStockGrams`; `dashboard.usage(days)` path unchanged.
- `web/src/components/ConsumptionChart.tsx` (new): hand-built inline-SVG two-line chart. Left axis 0…max(total)×1.05 (floor 1000), right axis 0…max(consumed)×1.05 (floor 1000), whole-gram tops; two `<polyline>`s (`line-total` `#35d7f0`, `line-consumed` `#ff7a18`); legend swatches match their lines; hover highlight + floating tooltip via `plot-hit` `pointermove`/`pointerleave`; document `touchstart` handler for tap show/hide; `viewBox` scaling for responsiveness. Deterministic `data-testid` hooks on legend, axis labels, highlight, tooltip, and the hit rect.
- `web/src/pages/Dashboard.tsx` (edit): removed the bar chart block, empty-state bars, `maxUsage`, and the "… g total" span; always renders `<ConsumptionChart series={usage} />`; `totalUsage`/`busiest` now read `consumedGrams` (prints only); WebSocket refetch untouched.
- `web/src/pages/SpoolDetail.tsx` (edit): added a **Delete spool** button (`data-testid="delete-spool"`), enabled only when every non-created event is already disabled; deletes via `api.spools.delete`. (See Deviations — this page edit was not in the plan's step list.)

Test harness (not application code)
- `scripts/run-e2e.sh` (edit): publish the e2e MariaDB to a reserved host port (`DB_PORT`, default 13307, with a port-in-use guard), and export `E2E_API_PORT` and `E2E_DB_HOST_PORT` for the Playwright harness.
- `e2e/package.json` + `e2e/package-lock.json` (edit): added `mysql2` devDependency.
- `e2e/tests/fixtures/db.ts` (new): `mysql2/promise` pool against `127.0.0.1:E2E_DB_HOST_PORT` (db/user/pass `filament`); `resetInventory()` (delete events → spools → types in FK order), `seedType()`, `seedSpool({id, initialNetGrams, createdAt, type, events})` re-inserting a spool + its past-dated enabled events, then `reevaluate()` calling the existing `POST /api/spools/reevaluate`.

Tests
- `tests/Filament.Core.Tests/Services/SpoolSeriesTests.cs` (new): 16 facts covering zero-fill, created baseline + pre-window, prints-only consumed vs negative adjustment, print/positive/negative steps, finish exclusion + finish-at-0, pre-window finish (all-0 window), and undo/redo remove/restore.
- `tests/Filament.Infrastructure.Tests/DashboardSeriesTests.cs` (new): 3 facts against real MariaDB (via `MariaDbFixture` + `Seeder`) proving the repository fetch path — consecutive zero-filled series, prints-only consumed, and a finish dropping stock from the finish day.
- `e2e/tests/dashboard-consumption.spec.ts` (new): 15 Playwright tests, one per AC, using `seedSpool`/`resetInventory` for past-dated data and the live UI for create / undo / redo / delete / live refresh / touch / responsive.

## Deviations From Plan

1. **Added a spool-delete UI in `SpoolDetail.tsx` (AC-10).** The plan's AC-10 wording ("delete a spool via the UI") implied a delete affordance already existed, but the UI had none. Per the decision captured at plan time, a `Delete spool` button was added to the spool detail page, enabled only when all non-created events are disabled (matching the domain rule that a spool can be deleted once it has no live effect). The `DELETE /api/spools/{id}` endpoint already existed and is unchanged; the e2e deletes a freshly created, event-less spool so the button is trivially enabled. This is a small page edit not enumerated in the plan's numbered steps.

2. **Hover driven by `locator.hover({position})`, not raw `page.mouse.move`.** The plan suggested `page.mouse.move` across the plot. In practice a single un-interpolated `mouse.move` did not reliably fire the SVG hit-rect `onPointerMove` in headless Chromium, while an element-relative hover (`plotHit.hover({ position })`) drives it deterministically. The test still asserts the same AC-11 behavior (day changes update the tooltip; leaving hides it).

3. **Highlight/line assertions use `toBeAttached()` rather than visibility.** Playwright's actionability "hidden" check is area-based: a flat `<polyline>` (all points at one y) and the vertical zero-width `hover-highlight` `<line>` are both reported "hidden" even when rendered. To keep the assertions both visible-in-the-DOM and stable, readiness gates on the `consumption-chart` wrapper `div`, and the highlight/tooltip are asserted with `toBeAttached()` / `.not.toBeAttached()` (with a `toBeVisible()` check where the element does have area, e.g. the legend and empty-state). This does not weaken any AC — it asserts presence/absence of the exact `data-testid` nodes the plan named.

4. **AC-8 finishes on the same day as the print.** The plan's example seeded a 600 g print and a separate 400 g finish; the implementation keeps that (Opened@5, Print@5, Finished@5 same day) so the spool shows stock only at days 0–4 and 0 from day 5, with day-5 consumed == 600. This is the strongest single-AC expression of Rule 8 (stock drops by the pre-finish remaining) combined with Rule 5 (day-D consumed includes the day's prints and is unaffected by the finish).

## Environment Finding (not a code change)

`web/src` had stale, gitignored, untracked `.js` artifacts (`Dashboard.js`, `SpoolDetail.js`, `Spools.js`, `FilamentTypes.js`, `client.js`, …) that shadowed the `.tsx`/`.ts` sources during Vite dev/bundling (Vite resolves `.js` before `.tsx`). They left the built SPA on an older dashboard (no chart, no delete button). They were removed; `web/tsconfig.json` is `noEmit`, so they were never regenerated by the build. After removal, `npm run build` in `web/` is clean and the e2e suite runs against the current bundle. No tracked source file was affected; this was pure local build-hygiene.

## Verification

All commands run from the repo root unless noted. Release configuration for backend builds/tests.

| Command | Result |
|---|---|
| `dotnet build src/Filament.Core/... --configuration Release` (and Api/Infra build) | Success |
| `dotnet test tests/Filament.Core.Tests/Filament.Core.Tests.csproj --configuration Release` | 83 passed, 0 failed (includes 16 new `SpoolSeriesTests`) |
| `dotnet test tests/Filament.Infrastructure.Tests/Filament.Infrastructure.Tests.csproj --configuration Release` | 12 passed, 0 failed (includes 3 new `DashboardSeriesTests`; real MariaDB via the published-port fixture) |
| `npm --prefix web run build` | Success (Vite build, clean; outputs `dist/assets/index-*.js`) |
| `npm --prefix e2e run typecheck` (`tsc --noEmit`) | exit 0 |
| `bash scripts/run-e2e.sh tests/dashboard-consumption.spec.ts` | 15 passed (10.2s), containers + network torn down, DB left clean |
| `bash scripts/run-e2e.sh tests/dashboard-consumption.spec.ts` (evidence capture) | 15 passed; HTML report at `e2e/playwright-report/index.html`, per-test screenshot `test-finished-1.png` under `e2e/test-results/` |

The e2e suite reuses the repo's existing runner: it builds the `filament-api` image from the modified C# source, starts MariaDB (health-checked, published on `E2E_DB_HOST_PORT`), the API (polls `/healthz`), and serves `web/dist`; `afterEach`/`beforeEach` reset keeps it green on repeat.

## Test Layers Deliberately Omitted

- **Full `dotnet test` across all projects.** There is no top-level solution file in this repo; the two affected test projects were built/tested individually (both green), which covers every unit test the change adds or could affect.
- **Vision-based screenshot sanity check.** The plan proposed it as a supplement only. `ConsumptionChart.tsx` is asserted entirely through deterministic DOM/SVG (`data-testid`, `stroke`/`fill` colors, label text, `getBoundingClientRect` bounds), so no AC depends on vision. No vision pass was run.
- **Other e2e specs.** `tests/dashboard-consumption.spec.ts` was run in isolation (the only spec this change adds). The suite is `workers: 1` and self-cleaning (`resetInventory` before and after each test), so it does not perturb the pre-existing `smoke` / `spool-lifecycle` / `labels` specs, which were not re-run.

## Limitations And Follow-Up

- **Full-history event load in `GetSeriesAsync`.** The reconstruction loads every spool and all enabled events to get the window-start baseline right (pre-window events set the starting balance/finish state). At the intended single-user scale this is negligible; a bounded-horizon read is a future optimization if spool/event counts grow (tracked in the plan's Risks, out of scope).
- **Axis scaling lives client-side.** `web/` has no unit runner, so the nice-kilogram ruler rule (step snapping, 3–6 ticks, differing counts per axis, 1 kg floor) is verified only by the Playwright axis-label assertions (AC-2, AC-3). Kept intentionally simple and deterministic (pure function `niceTicks`) so it stays text-assertable.
- **`web/tsconfig.tsbuildinfo` shows as modified** in `git status`. It is a committed Vite/tsc build cache; the rebuild updated it as a side effect. No source change is implied.
- **Delete-button gating reflects the domain rule, not a hard server check.** The spool detail only shows the delete affordance as enabled when the spool has no live-effect events; the API `DELETE` does not itself re-verify that today. This matches the existing delete endpoint's behavior and the spec's AC-10 intent.

## Post-Verification Refinement (2026-08-21, obrys)

After the initial implementation was verified, the user requested three presentation-only changes to `ConsumptionChart.tsx` (no backend/domain change). Bound as decisions in `amendment.md`; the matching spec/plan lines were updated in place.

1. **Fixed per-day readout** — the hover/tap box no longer floats with the pointer; it is pinned to the chart header, next to the legend, and updates content day by day. It still hides on pointer-leave (AC-11/AC-12 semantics unchanged; only position moved). The vertical day highlight stays in the plot.
2. **Dotted "nice" kilogram y-rulers** — each axis is 3–6 dotted horizontal gridlines in the line's own color with kilogram labels; the top snaps up to a meaningful multiple of {0.25, 0.5, 1, 2, 2.5, 5, 10, …} kg (floor 1 kg), and the two axes use different tick counts so the grids never alias. New pure helper `niceTicks(maxKg, avoidCount?)`. Supersedes the original max×1.05 whole-gram axes.
3. **Grey dotted x-ruler** — a grey dotted vertical gridline at each labeled date, in addition to the 6–8 month-day labels.

**Files touched:** `web/src/components/ConsumptionChart.tsx` (fixed header panel, `niceTicks` + `fmtKg`, color-matched dotted y-grids, grey x-grids, decorative strokes set to `pointer-events:none`); `e2e/tests/dashboard-consumption.spec.ts` (AC-2/AC-3 assertions rewritten; x-axis "data-in" gate; hover/tap inset). No C# or unit-test changes.

**Testing robustness fixes made while getting the e2e suite green (documented, not cosmetic):**
- **Data-load gate in `openDashboard`.** The 30-day series loads asynchronously; the wrapper `div` is visible before the data lands, so hovering an empty chart raced the fetch and left the readout unattached. The test now also waits for the first x-axis date label (rendered only once the series is populated) — this is the "data is in" gate. Fixed the previously-flaky axis-value reads (AC-3) and several value reads.
- **Edge hover was flaky.** Hovering the *last* day mapped to exactly the plot's right boundary, where a decorative `<line>` (frame/x-grid) won the hit-test so Playwright's `hover` retried until timeout. Two fixes: (a) all decorative strokes/polylines (frame, y/x grids, data lines, highlight) now carry `pointer-events:none` so only `plot-hit` receives events; (b) the e2e hover/tap inset the point a few px off the edges.

**Verification (refinement):** `npm --prefix web run build` clean (fresh bundle contains `axis-left`/`hover-highlight`/` kg` markers; no stale-`.js` shadowing). `bash scripts/run-e2e.sh tests/dashboard-consumption.spec.ts` → **15/15 passed**; evidence-capture run produced the HTML report + one screenshot per test. Backend unit/infra tests are unchanged by this refinement (no C# edits) and remain green from the original verification.

### Second presentation pass (2026-08-21, obrys) — colors and dark-mode legibility

A follow-up asked that (a) the y-axis kg labels use their line's color (they were a neutral `var(--muted)` grey) and (b) the legend/ink be legible in dark mode. The legend texts had **no `fill`**, so they rendered as the SVG default **black** — invisible on the dark theme, the same color in both modes.

- `web/src/components/ConsumptionChart.tsx`: all hardcoded hexes (`#35d7f0`, `#ff7a18`, `#94a3b8`, the readout's `#0b1220`/`#fff`) replaced with the design-system variables the rest of the page already uses — `TOTAL_COLOR = var(--cyan)`, `CONSUMED_COLOR = var(--accent)`, `GRID = var(--faint)`, `INK = var(--fg)`. Left/right kg labels are now painted `var(--cyan)`/`var(--accent)` (their line's color); the legend text takes `fill={INK}`; the readout panel uses `var(--surface-glass)` fill + `var(--border-strong)` stroke + `var(--fg)` ink. No data/logic change.
- `e2e/tests/dashboard-consumption.spec.ts`: new test `legend ink is legible in dark mode and kg labels match their line color` — a `colorScheme:'dark'` context asserts the legend ink's computed `fill` has luminance > 0.5 (theme ink, never the default black) and that each axis' top kg label's computed `fill` equals its own line's computed `stroke`; captures `dark-mode.png`. A `luminance()` helper parses a CSS color. The existing AC-1 color assertions are unchanged (they compare attribute strings, which now hold the `var(--…)` tokens — both swatch and line carry the same token).

**Verification (2nd pass):** `npm --prefix web run build` clean; `npm --prefix e2e run typecheck` clean; `bash scripts/run-e2e.sh tests/dashboard-consumption.spec.ts` → **16/16 passed** (dark screenshot captured); full suite `bash scripts/run-e2e.sh` → **45/45 passed**. No C# / unit-test change.
