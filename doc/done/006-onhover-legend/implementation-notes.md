# Implementation Notes: Onhover legend (006)

## Status

Status: complete

## Acceptance Criteria Evidence

All evidence from the final runs (after the post-completion refinement, see "Post-Implementation Refinement"): `npm --prefix e2e run e2e -- tests/dashboard-consumption.spec.ts` (25/25 passed, log `/tmp/opencode/e2e-006-fixed-spec.log`) and the full regression run `npm --prefix e2e run e2e` (54/54 passed, log `/tmp/opencode/e2e-006-fixed-full.log`), evidence captured per test under `e2e/test-results/` (screenshots, video, trace). Per-day values and expected date strings were always taken from the API window (`GET /api/dashboard/usage?days=30`), never re-derived in test JS.

| Criterion | Evidence |
|---|---|
| AC-1 | T1 `no day highlighted: plain two-entry legend and no readout box in markup` — legend texts exactly `"Total stock"` / `"Consumed"`, `legend-date` not attached, `page.locator('[data-testid="tooltip"]').count()` is 0; plus the adapted 005 `legend lists both lines…` regression. Passed. |
| AC-2 | T2 `hovering merges both values and the date into one single legend line` — exact strings `"Total stock: 1.35 kg"`, `"Consumed: 150 g"`, `"— <hovered API day>"`; the three texts' `boundingBox().y` equal within 1 px; both swatch rects attached; tooltip count 0. Screenshot: `e2e/test-results/dashboard-consumption-hove-34db1-*/test-finished-1.png`. Passed. |
| AC-3 | T3 `unit thresholds: whole grams below 1 kg, kilograms with dropped trailing zeros at 1 kg and above` — create/finish ladder of three isolated days; exact strings `"Total stock: 789 g"`, `"Total stock: 1 kg"`, `"Total stock: 1.5 kg"`. Passed. |
| AC-4 | T4 `consumed shows whole grams and a print-free day reads 0 g` — day D: `"Total stock: 850 g"`, `"Consumed: 150 g"`; day D+1: `"Consumed: 0 g"`. Passed. |
| AC-5 | T5 `the enhanced legend follows the pointer day by day and reverts to plain on leave` — pre-creation day: `"Total stock: 0 g"` + its API date; post-creation day: `"Total stock: 1 kg"` + new date; after pointer leaves: `legend-date` detached, texts back to exactly `"Total stock"` / `"Consumed"`. Passed. |
| AC-6 | T6 `on touch: tapping a day shows the enhanced legend line; tapping outside reverts` (touch-emulated context) — tap: `legend-date` visible, `"Total stock: 500 g"` / `"Consumed: 0 g"`, `hover-highlight` attached; tap at (20, 20): plain legend, both detached. Passed. |
| AC-7 | T5 and T6 — `hover-highlight` attached for the highlighted day, moves day by day with the legend values, detached when the highlight goes away. Passed. |
| AC-8 | T7 `live update: the enhanced legend reflects a remote consume without reload` — after a 200 g consume in context A, `expect.poll` on `hoverAt`/`readLegend` in context B reaches 800 / 200 for today without a reload; test ends by asserting the exact displayed strings `"Total stock: 800 g"`, `"Consumed: 200 g"`, `"— <today>"`. Passed. |
| AC-9 | T8 `the enhanced legend line is legible in light and dark theme` — in a dark context the computed fills of `legend-total` / `legend-consumed` text equal the resolved `--fg` (luminance > 0.5) and `legend-date` equals the resolved `--muted`; swatch fills equal the lines' computed strokes; the same equalities hold in a light context (luminance < 0.5). Dark-theme screenshot retained: `e2e/test-results/dashboard-consumption-the--9a96f-*/dark-mode-enhanced-legend.png`. Passed. |
| AC-10 | T9 `at 375 px the enhanced legend stays on one line without page overflow` — `scrollWidth <= clientWidth`; the three texts share one y (within 1 px); `legend-date` bounding box right ≤ chart bounding box right; swatch/value/date fully visible. Screenshot: `e2e/test-results/dashboard-consumption-at-3-3e112-*/test-finished-1.png`. Passed. |
| AC-11 | T10 `kilogram rounding is half up (1015 g becomes 1.02 kg, 2345 g becomes 2.35 kg)` — four isolated days (2 345 / 1 015 / 1 014 / 1 010 g ladder); exact strings `"Total stock: 2.35 kg"`, `"Total stock: 1.02 kg"`, `"Total stock: 1.01 kg"`, `"Total stock: 1.01 kg"` — the 1 015 g tie rounds up, never down. Passed. |
| Regression (005 values) | All adapted value-derivation tests (zero window, spool create, print, ±adjustment, finish, undo/redo, delete, axis rulers, leftover-text, 375 px plain) pass against the legend-parsed grams; the full suite (smoke, spool-lifecycle, sorting, labels, unique, dashboard-consumption) is 54/54. Passed. |
| Unit layer | Omitted per the approved plan's justification: no C#/domain change, and `web/` has no unit-test runner (adding one is excluded scope). `fmtGrams` is exercised at its exact boundaries through T3, T4 and T10. |

## Changes Made

Exactly the two files named in the approved plan:

- `web/src/components/ConsumptionChart.tsx` (presentation only)
  - Added `fmtGrams` next to `fmtKg`: whole grams below 1 000 g; at 1 000 g and above, kilograms via `Math.round(grams / 10) / 100` (the plan's P5 reduction-to-tens rounding that makes the half-up tie exact for whole grams), with a comment stating the requirement and the `Math.round((g/1000)*100)/100` float-noise trap.
  - Legend groups made state-aware (same testids, same swatch rects/attributes): both entries sit in **fixed slots that never move** between plain and enhanced states (total at x=56/74 as before; consumed fixed at `LEGEND_CONSUMED_X` = 241, text at 259; per the post-implementation refinement). While a day is highlighted only the values are appended to each label (`Total stock: <total>`, `Consumed: <consumed>`) and a new `data-testid="legend-date"` text at `LEGEND_DATE_X` = 424 renders `— <short month-day>` in `var(--muted)`; all on the single y=22 line.
  - Deleted the `PANEL` constant and the entire `data-testid="tooltip"` 3-row readout block — the box is not rendered in any state.
  - Fixed the stale comments referencing the removed readout box (PAD_T note, component doc comment, hover-highlight note). Untouched, as required: `formatMD`, `niceTicks`, `fmtKg`, pointer/tap handlers, `hover-highlight`, `plot-hit`, axes/lines/x-axis, `aria-label`.
- `e2e/tests/dashboard-consumption.spec.ts`
  - Removed `Tip` / `readTooltip`; added `toGrams`, `LegendReadout` / `readLegend`, and `hoverAt` now gates on `legend-date` visibility.
  - Added `usageDays(page)` (API window as ISO day strings; `windowDays` became a thin wrapper over it) as the source of truth for expected date strings.
  - Adapted the 005 value-regression tests to the legend-parsed readouts (assertions otherwise unchanged; all seeded values display-lossless).
  - Rewrote the two show/hide tests off the `tooltip` testid (hover: enhanced line + `hover-highlight` while highlighted, plain legend + both detached on leave; touch: tap shows enhanced line + highlight, tap-outside reverts).
  - Adapted the live-update test (T7) to poll `readLegend` and finish on the exact displayed strings.
  - Added the ten new tests T1–T10 from the approved test matrix, reusing `seedSpool` / `noonDaysAgo` / `idx` / `openDashboard` / `plotXY` / `readLegend` / `usageDays`.
  - T5 additionally pins the refinement: it records both swatch positions in the plain state and asserts they are unchanged (≤ 0.5 px) once a day is highlighted — the legend must never jump on hover.

No C#, API, schema, WebSocket, interaction-logic, or dependency change. No commits were created by this implementation; the working tree contains only the two files above.

## Post-Implementation Refinement (user, August 23, 2026)

After the initial verification the user accepted the result but reported one issue: on hover the "Consumed" entry **jumped** (the approved plan's P2 slot moved the consumed swatch from x=206 to x=300 while highlighted). Request: make the legend a **fixed position** so that **only the values and the date appear** when a day is highlighted.

Implemented as a presentation-only change to the same two files:

- `ConsumptionChart.tsx`: the hover-conditional slot move was removed. Both legend entries now render at fixed positions in every state — total at x=56/74 (unchanged), consumed at `LEGEND_CONSUMED_X` = 241 (text at 259), date at `LEGEND_DATE_X` = 424. Only the appended value strings and the `legend-date` text appear/disappear on hover; no existing glyph ever moves.
- Slot choice is measurement-based, not estimated: a throwaway probe (deleted after the run) read `getComputedTextLength()` inside the real chart SVG for the worst-case strings at the real font — `"Total stock: 99999.99 kg"` = 152.7 units (from x=74 → ends 226.7), `"Consumed: 99999.99 kg"` = 150.9 (from x=259 → ends 409.9), `"— Dec 31"` = 57.6 (from x=424 → ends 481.6 < 720). Each slot clears the longest possible predecessor label by ≥ 14 units, preserving the plan's ≈9 999.99 kg per-side bound.
- Consequence (accepted side effect): in the plain state the consumed swatch sits at x=241 instead of the pre-006 x=206 — the two plain entries are slightly more spread than before, but identical in both states (nothing moves).
- `dashboard-consumption.spec.ts`: the no-jump behavior is pinned in T5 (swatch x positions recorded in the plain state and asserted unchanged after highlighting). No existing text/color/geometry assertion was affected by the slot move.

Re-verified after the refinement (see Verification): 25/25 on the spec, 54/54 on the full suite, `web` build and e2e typecheck clean.

## Deviations From Plan

1. **Vision inspection substituted by measurement (plan's stated failure case).** The implementation environment's model has no image input, so the plan step 10 screenshot review was replaced by programmatic checks: (a) a temporary spec measured the actual rendered extents of the three enhanced-legend texts (seeded with the T2 values plus a stress value of 123 456 g stock) at default and 375 px widths — no overlap, date right ≤ chart right (date box 272.8 vs chart right 342 at 375 px), identical y; and (b) a throwaway `getComputedTextLength()` probe of the exact worst-case strings used to size the final fixed slots (see Post-Implementation Refinement). Both temp specs were deleted after their runs.
2. **P2 x slots superseded by the user's refinement.** The initial implementation used the plan's approved slots as written (consumed swatch x=206 plain / x=300 hovered, date x=500). The user's post-completion request (fixed legend, no jump) replaced the hover-conditional move with the fixed slots x=241 / x=424; this is recorded as a user-directed change, not an implementer discretion.
3. **T8 added as a new test rather than mutating the 005 dark-mode test.** The plan said T8 "extends the existing dark-mode test"; the 005 test (`legend ink is legible in dark mode and kg labels match their line color`) was left byte-identical as its regression and T8 covers the enhanced line in both themes, including the dark-theme screenshot it mandates.
4. **Test titles.** T5 / T6 / T7 use the matrix's T-titles for the show/hide, touch, and live-update tests (the latter replacing the old 005 AC-13 title), as the matrix requires.
5. **`usageDays` helper** is a thin new superset of the existing `windowDays` helper (the plan named the API window as the expected-date source of truth but did not name this helper).

## Verification

Two rounds — the initial implementation and the final state after the post-implementation refinement (the "final" rows are the binding evidence):

| Command | Initial result | Final result (after refinement) |
|---|---|---|
| `npm --prefix e2e run e2e -- tests/dashboard-consumption.spec.ts` | passed — 25 passed (15.7 s), log `/tmp/opencode/e2e-006-spec.log` | passed — 25 passed (15.8 s), log `/tmp/opencode/e2e-006-fixed-spec.log` |
| `npm --prefix e2e run e2e` | passed — 54 passed (46.5 s), log `/tmp/opencode/e2e-006-full.log` | passed — 54 passed (47.3 s), log `/tmp/opencode/e2e-006-fixed-full.log` |
| `npm --prefix web run build` (`tsc -b && vite build`) | passed | passed |
| `npm --prefix e2e run typecheck` (`tsc --noEmit`) | passed | passed |
| Temp. clearance spec (`tests/tmp-legend-overlap-check.spec.ts`, deleted after run) | passed — 1 passed (2.0 s); bounds logged in Deviation 1 | — |
| Temp. `getComputedTextLength()` probe (`tests/tmp-legend-measure.spec.ts`, deleted after run) | — | passed; worst-case widths logged in Post-Implementation Refinement |

## Limitations And Follow-Up

- Fixed layout slots (final, post-refinement): the consumed entry at x=241 and the date at x=424 are sized off the measured worst-case strings (`"Total stock: 99999.99 kg"` = 152.7, `"Consumed: 99999.99 kg"` = 150.9, `"— Dec 31"` = 57.6 units), so each slot clears the longest possible predecessor label by ≥ 14 units — the plan's ≈9 999.99 kg per-side bound is preserved. Beyond that bound the labels could overlap (recorded in the plan's Risks); realistic filament stock is far below it.
- The post-refinement plain-state legend has its consumed entry at x=241 instead of the pre-006 x=206 (slightly wider entry spacing, constant in both states) — the accepted consequence of the fixed-legend request.
- `doc/spec/interfaces.md` (the consumption-graph paragraph) is updated in the document stage after verification, not in this change (spec Out of Scope).
- The e2e harness tears down its containers after each run; per-test evidence (screenshots/video/trace) persists under `e2e/test-results/` but individual directories are overwritten on re-runs with the same test names.
