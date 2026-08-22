# Amendment — 005 Consumption graph

Refinement notes for `doc/todo/005-consumption-graph/`. `README.md` remains the immutable original request.

## References consulted

- `README.md` (this directory) — original request
- `doc/spec/application-overview.md` — dashboard capability, intended scale
- `doc/spec/domain-rules.md` — events, weight rules, lifecycle, current "daily consumption" definition
- `doc/spec/interfaces.md` — browser routes, `GET /api/dashboard/summary`, `GET /api/dashboard/usage?days=30`
- `doc/spec/operations.md` — testing policy (xUnit unit tests + Playwright e2e for user-visible behavior)
- `web/src/pages/Dashboard.tsx` — current bar chart (hand-rolled CSS), 30-day consumption, "N g total" text, refetch on WebSocket `change`
- `web/src/api/client.ts`, `web/package.json` — API client types, frontend stack (React 19 + TS + Vite; no charting library)
- `src/Filament.Api/Controllers/DashboardController.cs`, `src/Filament.Api/Dtos/Dtos.cs` — summary/usage endpoint shapes, `days` clamped 1–365
- `src/Filament.Infrastructure/Repositories/Repositories.cs` — UTC daily bucketing, sparse usage response, active-remaining total excluding finished spools
- `e2e/tests/`, `e2e/tests/fixtures/` — no existing graph coverage; DB-seeded fixtures available

## Questions asked and answered

1. **Total line data** → full 30-day per-day history reconstructed from event history (flat segments where nothing happened; only today's point is directly verifiable against the current summary value).
2. **Finished spools** → a finished spool's remaining grams are subtracted from the total line (it no longer counts as stock); a finish does **not** affect the consumed line — the remaining was thrown away, not consumed.
3. **Undo/redo and spool deletion** → both lines fully reflect enabled events; deleting a spool removes its whole contribution from both lines.
4. **Scale details** → left axis: maximum per-day total over the 30-day window × 1.05; right axis: maximum per-day consumption over the window × 1.05; 1 kg floor per axis.
5. **Hover display** → vertical day highlight plus a floating tooltip with the date and the exact values for both lines.
6. **X-axis labels** → roughly 7 evenly spaced day labels (spec range: 6–8), always including the first day and today.
7. **Missing scenarios** → (a) fixed full 30-day window including zero-consumption days: yes; (b) refetch on WebSocket change messages like today: yes; (c) the "N g total" 30-day sum text: **removed**; (d) responsive: yes, with limited functionality on phones — tap replaces hover where hovering is not feasible.
8. **Negative adjustments vs consumed line (follow-up)** → user amended the rule: *Prints* mean consumption and decrease the total; adding a spool, adjustments, and finishing a non-empty spool affect only the total line. The consumed line counts print events only. This supersedes the documented rule that daily consumption includes negative adjustments.

## Assumptions flagged for approval

- **Domain rule amendment**: "daily consumption" for the dashboard metric becomes *enabled print events only*; positive and negative weighed adjustments no longer count as consumption. `doc/spec/domain-rules.md` (and dependent descriptions) will be updated during the document stage, not here.
- Day labels and the tooltip show the UTC day value as-is (no shift into the browser's local time zone), which also fixes the existing off-by-one axis label in the current bar chart for timezones west of UTC.
- The chart is rendered with hand-built inline SVG in the existing React/TS SPA, without adding a new frontend dependency (consistent with the current codebase, which has no charting library).
- Per-day values are computed server-side and served by the dashboard API (new or extended endpoint) as a zero-filled consecutive day series, so the changed domain logic lives in the layer covered by xUnit tests (the `web/` frontend has no unit-test runner; testing policy requires unit tests for changed domain logic).
- "Total amount of filament" means net filament grams on non-finished spools; empty-spool weight is excluded.

## Open decisions

- None blocking. Presentation details left to the implementation plan within the bounds of the specification: exact axis tick count and label rounding, tooltip date format, exact line colors (must be visually distinct and legible at 375 px width).

## Resolved conflict

- README line 12 ("If I finish a spool which isn't completely empty, it will affect both the consumed and the total line") conflicts with the user's direct clarification (Q2: remaining is subtracted from the total, not added to consumption). The clarification is binding: a finish affects only the total line, by the remaining amount at the finish.

## Refinement (2026-08-21, obrys) — chart presentation

After the initial implementation, the user asked for three presentation changes. These are binding and **amend the presentation-level parts of the approved spec** (the data derivation, endpoint, unit tests, and all 15 ACs' data behavior are unchanged). Where they conflict with earlier decisions, this refinement wins.

1. **Per-day readout is fixed, not floating (amends Decision 6 / D6 and AC-11's "floating … near the pointer").** The on-hover/tap day readout (date + both values) is pinned to a fixed position in the chart's header, next to the legend, and never follows the pointer. It still appears on hover/tap and hides when the pointer leaves (so AC-11/AC-12 show/hide semantics are preserved) — only its *position* changes. The vertical day highlight stays in the plot.
2. **Y-axes are dotted "nice" kilogram rulers (amends Decision 5 / D5 and AC-2, AC-3).** Each axis is a set of dotted horizontal gridlines (dotted in the **same color as that axis' line**) with labels in **kilograms** ("4 kg", "0.75 kg", …). Counts and values:
   - 3–6 ticks per axis, and the two axes always get **different** counts so their grids never overlap on the same rows (the grids must not alias).
   - The top snaps up to a *meaningful* multiple of a "nice" step (steps from {0.25, 0.5, 1, 2, 2.5, 5, 10, …} kg), floored at 1 kg (an empty axis reads 0…1 kg).
   - Worked examples: 3 kg → 0,1,2,3 · 4 kg → 0,1,2,3,4 · 5 kg → 0…5 · 1 kg → 0,0.25,0.5,0.75,1 · 39.8 kg → 0,10,20,30,40.
   - The old "axis tops at window-max × 1.05, in whole grams" is superseded by this nice-kilogram rule.
3. **Grey dotted X-ruler (new).** A grey dotted vertical gridline is drawn at each labeled date position, in addition to the existing 6–8 x-axis month-day labels.
4. **Labels match their line, and everything follows the theme (amends the "legible colors" intent and the presentation of the left/right axis labels).**
   - The left-axis kilogram labels are painted in the **total-stock line's** color and the right-axis labels in the **consumed line's** color (previously a neutral grey) — so each axis reads as an extension of its line.
   - All chart colors use the design-system variables already on the page — `var(--cyan)` (total stock), `var(--accent)` (consumed), `var(--faint)` (frames/date columns) and `var(--fg)` (legend/label ink) — instead of hardcoded hexes, so the chart re-themes with the rest of the app.
   - The legend text (and the readout) uses the theme ink `var(--fg)`. The legend previously had **no** `fill`, so it rendered as the SVG default **black**, which is invisible on the dark theme; the theme ink keeps it legible in both light and dark.

**Unit judgment call (flagged, not blocking):** the fixed per-day readout keeps **exact whole grams** ("1234 g"): a kilogram there would lose the per-gram precision the "exact values" ACs require, and the user scoped "kilograms" to the y-axis rulers. If the user wants the readout in kg too, that's a one-line follow-up.
