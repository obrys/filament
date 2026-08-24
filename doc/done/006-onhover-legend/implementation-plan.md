# Implementation Plan: Onhover legend (006)

## Approval

Status: approved
Approved by: obrys
Approved on: August 23

## Summary

Remove the fixed 3-row per-day readout box from the dashboard consumption chart and merge its content into the legend: while a day is highlighted (hover or tap), the two legend entries become a single enhanced line — `■ Total stock: <total>  ■ Consumed: <consumed>  — <date>` — and the legend reverts to the plain two entries when the highlight goes away.

Each value is formatted client-side by a new `fmtGrams` helper: whole grams below 1 kg; at 1 kg and above, kilograms rounded to **two decimals, half up** (per the user's August 23, 2026 clarification: 1 015 g → **1.02 kg**, 2 345 g → **2.35 kg**), trailing zeros dropped.

Two files change: `web/src/components/ConsumptionChart.tsx` (presentation only) and `e2e/tests/dashboard-consumption.spec.ts` (rewritten readout helper, adapted regression tests, new per-AC tests). No C#, API, schema, WebSocket, interaction-logic, or dependency change.

## Preconditions And Decisions

### Confirmed preconditions

- Exactly one request directory: `doc/todo/006-onhover-legend/`.
- `specification.md` is `Status: approved` (obrys, August 23, 2026), including the same-day post-approval rounding clarification (half-up tie-break), which is recorded in the spec's approval note, Rule 1, Decision 2, and AC-11.
- Read: `README.md`, `amendment.md`, `specification.md` (this directory); `doc/spec/operations.md` (functional tests, testing policy); `doc/spec/interfaces.md` (dashboard route and chart description); `doc/done/005-consumption-graph/specification.md` (current 3-row readout behavior); `web/src/components/ConsumptionChart.tsx` in full (legend at :228–236, `PANEL` at :27–29, `data-testid="tooltip"` block at :238–251, `fmtKg` at :45–46, `formatMD` at :31–41, hover/tap logic at :129–155 and :282–292); `e2e/tests/dashboard-consumption.spec.ts` in full (helpers at :53–98, tests at :124–584); `e2e/playwright.config.ts`, `e2e/package.json`, `scripts/run-e2e.sh` (arg forwarding at :163), `web/package.json`.
- The request is small and fits one focused pull request (one component + one e2e spec). No split proposed.

### Binding decisions from the approved specification

1. Layout: both swatches kept, value appended to each entry's label, short month-day date at the end of the single line (spec Decision 1).
2. Unit rule per value, independently: whole grams below 1 000 g; kilograms at 1 000 g and above, rounded to two decimals **half up** — 1 010–1 014 g → "1.01 kg", 1 015 g → "1.02 kg", 2 345 g → "2.35 kg" — trailing zeros dropped ("1 kg", "1.5 kg") (spec Rule 1, Decision 2, post-approval clarification).
3. Hover-off/tap-outside: legend reverts to the plain two entries, no values, no date; today's show/hide timing preserved (spec Decision 3).
4. Unchanged: dashed vertical day highlight, hover/tap interaction, per-day whole-gram endpoint values and their date, the plot, axes, x labels/gridlines, theme wiring, WebSocket refresh (spec Decision 4, 6).
5. Date format: existing short month-day (UTC day parts, no year, no leading zero), identical to the x-axis labels (spec Rule 5, Decision 5).
6. Frontend stays hand-built inline SVG in `web/src/components/ConsumptionChart.tsx`; no charting library, no new frontend dependency (spec Constraints).

### Decisions resolved at plan stage (within the specification's Open Questions)

- **P1 — Separator and styling of the date.** The line ends with an em dash and space before the date (`— Aug 16`). All three texts share the existing legend baseline (`y=22`, `fontSize=13`); value/label ink stays `var(--fg)`, swatches stay `var(--cyan)`/`var(--accent)`, the date text uses the existing theme token `var(--muted)` so it de-emphasizes and re-themes like the x-axis labels.
- **P2 — Enhanced-line layout slots.** The plain state is byte-identical to today (swatch1 at `x=PAD_L`, consumed swatch at `x=PAD_L+150`). While a day is highlighted, the consumed swatch moves to `x=300` (the old readout panel's origin — now free) and the date text starts at `x=500`. Worst-case clearance at these slots (13 px / weight 600, ≈7 px/char): "Total stock: 99999.99 kg" ends ≈247 < 300; "Consumed: 99999.99 kg" ends ≈455 < 500; "— Aug 16" ends ≈565 < 720. The implementer verifies with the captured screenshots (Vision below) and may nudge the two x slots, but must keep both swatches, both values, and the date on the one `y=22` line within the 720 viewBox.
- **P3 — Testids.** Add `data-testid="legend-date"` on the date text (rendered only while a day is highlighted). The `data-testid="tooltip"` element disappears with the 3-row box; AC-1's "not even empty" is asserted as zero elements matching that testid. `legend-total`, `legend-consumed`, `hover-highlight`, `plot-hit`, axis, and line testids are unchanged.
- **P4 — Formatter placement.** New `fmtGrams` next to `fmtKg` in `ConsumptionChart.tsx`, used only by the legend. `fmtKg`/`niceTicks` (axis ladder) are untouched: axis ticks are "nice" multiples for which `Math.round(v * 100) / 100` is already safe.
- **P5 — Rounding mechanics (binding from Rule 1; implementation constraint).** Round by reducing to tens of grams first: `Math.round(grams / 10) / 100`. For whole grams, `grams / 10` is exactly representable (an integer or integer + 0.5), so `Math.round`'s half-up tie behavior is exact — 1015 → 102 → "1.02". The naive `Math.round((grams / 1000) * 100) / 100` must NOT be used: 1.015 is 1.01499… in binary and that form renders 1 015 g as "1.01 kg", violating AC-11.

### Unit-test layer — omitted, with justification

The repository policy requires both layers, but the unit layer (xUnit, `tests/Filament.Core.Tests/`) targets C# domain logic; this change touches **no C#, no endpoint, no schema, no domain rule** (spec Constraints: "No API, schema, or domain change"). The only new pure computation is the client-side presentation formatter `fmtGrams`, which lives in `web/`, where **no unit-test runner exists** (`web/package.json` scripts: dev/build/preview only). Introducing vitest/jest would add a dependency and a runner bootstrap, which the spec excludes ("no charting library or new frontend dependency"; Constraints: "the `web/` frontend has no unit-test runner"). The formatter is therefore exercised through the binding e2e layer at its exact boundaries — grams branch (AC-3, AC-4), kilograms branch (AC-3), the half-up tie and 2 345 g case (AC-11) — asserting literal rendered strings, which is the code path users see.

### Vision use — proposed, with failure case

Propose using vision on the harness-captured evidence (the e2e config records screenshot + video + trace per test; `PLAYWRIGHT_CAPTURE_EVIDENCE` default on) to sanity-check the enhanced legend: one visual line with swatch, values, em-dash, date; sensible spacing at default width and 375 px; plain vs. enhanced states; light and dark theme.
**Failure case:** vision can misjudge 1 px gaps, misread the em dash as a hyphen, or wrongly call a line "overflowing". No acceptance criterion is gated on it: every visual rule also has a hard DOM assertion (exact text content, equal `boundingBox().y` of the three texts, `scrollWidth <= clientWidth`, date `right <= svg right`, computed fills equal to the resolved `--fg`/`--muted`/line strokes). If vision is unavailable or disagrees with a DOM assertion, the DOM assertion wins.

## Implementation Steps

All application-side steps touch exactly two files.

1. `web/src/components/ConsumptionChart.tsx` (:45–46 area): add the legend formatter beside `fmtKg`:

   ~~~ts
   const fmtGrams = (grams: number): string =>
     grams < 1000 ? `${grams} g` : `${Math.round(grams / 10) / 100} kg`
   ~~~

   with a comment stating the half-up requirement and the float-noise pitfall (P5).

2. `web/src/components/ConsumptionChart.tsx` (:228–236): make the two existing legend groups state-aware (same `data-testid`s, same swatch rects and text attributes):

   ~~~tsx
   <g data-testid="legend-total">
     <rect x={PAD_L} y={12} width={12} height={12} rx={2} fill={TOTAL_COLOR} />
     <text x={PAD_L + 18} y={22} fontSize={13} fontWeight={600} fill={INK}>
       {hovered ? `Total stock: ${fmtGrams(hovered.totalStockGrams)}` : 'Total stock'}
     </text>
   </g>
   <g data-testid="legend-consumed">
     <rect x={hovered ? 300 : PAD_L + 150} y={12} width={12} height={12} rx={2} fill={CONSUMED_COLOR} />
     <text x={(hovered ? 300 : PAD_L + 150) + 18} y={22} fontSize={13} fontWeight={600} fill={INK}>
       {hovered ? `Consumed: ${fmtGrams(hovered.consumedGrams)}` : 'Consumed'}
     </text>
   </g>
   {hovered && (
     <text data-testid="legend-date" x={500} y={22} fontSize={13} fill="var(--muted)">
       {'— '}{formatMD(hovered.day)}
     </text>
   )}
   ~~~

3. `web/src/components/ConsumptionChart.tsx` (:27–29, :238–251): delete the `PANEL` constant and the entire `{hovered && (<g data-testid="tooltip">…</g>)}` block; no replacement rendering (the box must not exist in any state).

4. `web/src/components/ConsumptionChart.tsx`: fix stale comments referencing the readout box (:16–17 PAD_T comment, :27–28, :95–98 component doc comment, :282 hover-highlight comment). Do **not** touch `formatMD`, `niceTicks`, `fmtKg`, the pointer/tap handlers (:129–155), `hover-highlight` (:283–286), `plot-hit` (:289–292), axis/line/x-axis rendering, or the svg `aria-label`/`onPointerLeave`.

5. `e2e/tests/dashboard-consumption.spec.ts` (:53–98): replace the old readout helpers.
   - Delete `Tip`, `readTooltip`.
   - Add `toGrams(text)` (parse `"1.5 kg"` → 1500, `"789 g"` → 789; seeded values in this file are all display-lossless at two decimals) and `readLegend(page)` returning `{ date, totalGrams, consumedGrams }` from `legend-total`/`legend-consumed`/`legend-date`.
   - Rewrite `hoverAt` to await `page.getByTestId('legend-date')` visible (replacing the `tooltip` wait) and return `readLegend`.

6. `e2e/tests/dashboard-consumption.spec.ts`: adapt the existing 005 value-regression tests to the new readouts, assertions otherwise unchanged (all seeded values — 0, 300, 400, 500, 700, 800, 1 000, 1 250, 1 500, 1 700, 2 000 g — are display-lossless): "with no spools…" (:181), "creating a 1000 g spool…" (:238), "a 300 g print…" (:265), "+250 g adjustment…" (:290), "−200 g adjustment…" (:309), "finishing a spool…" (:343), "undoing then redoing…" (:368), "deleting a spool…" (:406), "axis top values…" (:214) untouched, "no leftover … g total…" (:538) re-verified (the pattern cannot match the enhanced line), 375 px no-overflow test (:555) untouched.

7. `e2e/tests/dashboard-consumption.spec.ts` (:447–496): rewrite the two show/hide tests off the `tooltip` testid — hover test: `hover-highlight` attached while a day is highlighted, and after moving the pointer to the wrapper corner `legend-date` is detached, both legend texts are back to exactly "Total stock"/"Consumed", and `hover-highlight` is detached. Touch test: tap a day → `legend-date` visible with values and `hover-highlight` attached; tap (20, 20) → plain legend, both detached.

8. `e2e/tests/dashboard-consumption.spec.ts` (:499–535): adapt the live-update test to poll `readLegend` in context B and finish by asserting the exact displayed strings.

9. `e2e/tests/dashboard-consumption.spec.ts`: add the new 006 tests T1–T10 listed in the Test Matrix, reusing the existing `seedSpool`/`noonDaysAgo`/`idx`/`openDashboard` helpers, `resetInventory` in `beforeEach`/`afterEach`, and the API window (`page.request.get('/api/dashboard/usage?days=30')`) as the source of truth for the expected date strings.

10. Verify: run the commands below; inspect the evidence screenshots (Vision, with the stated failure case) — default and 375 px, light and dark — and adjust only the P2 slot x-values or P1 spacing if any line element overlaps or the 375 px line is not visually one line. DOM assertions stay as written.

## Test Matrix

Every acceptance criterion links to a Playwright test (the only applicable layer — see the unit-layer justification above). New tests are T1–T10 in `e2e/tests/dashboard-consumption.spec.ts`; the "Adapted 005 test" column lists regression tests updated in steps 6–8 that also re-assert the criterion.

| Acceptance criterion | Test layer | Test | Expected evidence |
|---|---|---|---|
| AC-1 — no highlight: plain two entries, no values/date, no readout box in markup | e2e | T1 `no day highlighted: plain two-entry legend and no readout box in markup`; adapted 005 `legend lists both lines…` | Legend texts exactly `"Total stock"` / `"Consumed"`; `page.locator('[data-testid="tooltip"]').count()` is 0; `legend-date` not attached |
| AC-2 — hover: one enhanced line, order value/value/date, swatches present, same line, no box | e2e | T2 `hovering merges both values and the date into one single legend line` (seed 1 500 g spool + 150 g print) | Exact strings `"Total stock: 1.35 kg"`, `"Consumed: 150 g"`, `"— <Short month-day of the hovered API day>"`; the three texts' `boundingBox().y` equal within 1 px; both swatch rects attached; tooltip count 0 |
| AC-3 — unit rule: 789 g / 1 000 g / 1 500 g | e2e | T3 `unit thresholds: whole grams below 1 kg, kilograms with dropped trailing zeros at 1 kg and above` (three isolated days via create/finish laddering) | `"Total stock: 789 g"`, `"Total stock: 1 kg"`, `"Total stock: 1.5 kg"` on the respective days |
| AC-4 — consumed in grams; print-free day reads 0 g | e2e | T4 `consumed shows whole grams and a print-free day reads 0 g` (1 000 g spool, 150 g print on day D) | Day D: `"Consumed: 150 g"` and `"Total stock: 850 g"`; day D+1: `"Consumed: 0 g"` |
| AC-5 — day-by-day update on pointer move; revert to plain legend on leave | e2e | T5 `the enhanced legend follows the pointer day by day and reverts to plain on leave` (1 000 g spool created mid-window) | Hover pre-creation day → `"Total stock: 0 g"` + that date; hover post-creation day → `"Total stock: 1 kg"` + new date; after pointer leaves: texts back to exactly `"Total stock"`/`"Consumed"`, `legend-date` detached |
| AC-6 — touch: tap shows enhanced line, tap outside reverts | e2e | T6 `on touch: tapping a day shows the enhanced legend line; tapping outside reverts` (adapted 005 AC-12, touch-emulated context) | Tap on plot → `legend-date` visible, values correct, `hover-highlight` attached; tap at (20, 20) → plain legend, both detached — no readout box involved |
| AC-7 — dashed day-highlight behavior unchanged | e2e | T5 and T6 (highlight assertions) | `hover-highlight` attached for the highlighted day, moves day by day with the legend values, detached when the highlight goes away |
| AC-8 — WebSocket: second context's enhanced legend reflects a live consume | e2e | T7 `live update: the enhanced legend reflects a remote consume without reload` (adapted 005 AC-13, two contexts) | After a 200 g consume in context A, `expect.poll` on `readLegend` in context B reaches `"Total stock: 800 g"` / `"Consumed: 200 g"` for today with no reload |
| AC-9 — legibility in light and dark theme via theme tokens | e2e | T8 `the enhanced legend line is legible in light and dark theme` (extends the existing dark-mode test, :141) | In a dark context: computed fills of `legend-total`/`legend-consumed` text equal resolved `--fg` (luminance > 0.5), `legend-date` fill equals resolved `--muted`, swatch fills equal the lines' computed strokes; same equality assertions in a light context; dark-theme screenshot retained as evidence |
| AC-10 — 375 px: one line, no page overflow, everything visible | e2e | T9 `at 375 px the enhanced legend stays on one line without page overflow` (375 px viewport, 1 500 g + 150 g print seed) | `document.documentElement.scrollWidth <= clientWidth`; the three texts share one y (within 1 px); `legend-date` bounding box right ≤ chart svg bounding box right |
| AC-11 — half-up rounding: 1 010/1 014 → 1.01, 1 015 → 1.02, 2 345 → 2.35 | e2e | T10 `kilogram rounding is half up (1015 g becomes 1.02 kg, 2345 g becomes 2.35 kg)` (four isolated days: create/finish ladder 2 345/1 015/1 014/1 010 g) | Exact strings `"Total stock: 2.35 kg"`, `"Total stock: 1.02 kg"`, `"Total stock: 1.01 kg"`, `"Total stock: 1.01 kg"`; the 1 015 g tie rounds up, never to "1.01 kg" |
| (regression) 005 value derivation through the new readout | e2e | Steps 6–8 adapted tests (spool create/print/adjustment/finish/undo/redo/delete, zero window, axis rulers) | All pre-existing numeric assertions hold against the legend-parsed grams |
| (unit layer) — omitted | — | — | See "Unit-test layer — omitted, with justification" |

## Test Commands

~~~text
# This change (builds the e2e stack once, runs the one affected spec; evidence captured in e2e/test-results/)
npm --prefix e2e run e2e -- tests/dashboard-consumption.spec.ts

# Full regression suite (all specs: smoke, spool-lifecycle, sorting, labels, unique, dashboard)
npm --prefix e2e run e2e

# Frontend typecheck + production build (tsc -b && vite build)
npm --prefix web run build

# e2e TypeScript check
npm --prefix e2e run typecheck
~~~

## Out Of Scope

- No C#/API/schema change; `GET /api/dashboard/usage` and the per-day whole-gram series are untouched.
- No change to hover/tap trigger logic, show/hide timing, dashed day highlight, the two data lines, kg axes and `niceTicks`/`fmtKg`, x-axis labels/gridlines, theme wiring, or the WebSocket live-update flow.
- No charting library, no new frontend dependency, no new test runner in `web/`.
- No change to the svg `aria-label` or any other dashboard element.
- `doc/spec/` durable documentation (the consumption-graph paragraph in `doc/spec/interfaces.md`) is updated in the document stage after verification, not here.
- Hypothetical rendered values beyond ≈9 999.99 kg per side (fixed-slot layout bound; see Risks).

## Risks And Rollback Notes

- **Floating-point rounding trap (highest risk).** `Math.round((g / 1000) * 100) / 100` renders 1 015 g as "1.01 kg" (1.015 is 1.01499… in binary). Mitigated by P5 (reduce to tens of grams: `Math.round(grams / 10) / 100`, exact for whole grams) and pinned by T10 (AC-11), which asserts the exact tie behavior.
- **Fixed layout slots (P2).** The consumed swatch at x=300 and the date at x=500 assume per-side values under ≈9 999.99 kg; beyond that, text slots could overlap. Realistic filament stock is a few hundred kg at most; screenshots (Vision) verify spacing, and the 375 px AC-10 test asserts geometry, not pixels. If a screenshot shows overlap, only the two x slots may move.
- **Font metrics vary by platform.** Width estimates use a conservative ≈7 px/char; assertions use same-line y-equality, overflow, and containment — all metric-independent.
- **In-file e2e rewrite.** Steps 5–8 rewrite existing working tests to read from the legend; since the seeded values are display-lossless, their numeric assertions are unchanged. The full suite command guards the remaining specs.
- **Date string source.** Expected dates are read from the API window (`/api/dashboard/usage?days=30`), not re-derived in test JS, avoiding UTC-midnight races (same convention as the existing `windowDays` helper).
- **Rollback.** The change is isolated to `web/src/components/ConsumptionChart.tsx` and `e2e/tests/dashboard-consumption.spec.ts` with no data or config migration; reverting the PR restores the 3-row readout and the previous tests in one step.
