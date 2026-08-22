# Consumption graph

## Approval

Status: approved
Approved by: obrys
Approved on: August 21, 2026

## Purpose

The dashboard's consumption visualization currently draws a bar per day that had any consumption, which hides days of no use and shows no stock level. Replace it with a two-line graph over a fixed 30-day window: a **total stock** line (filament remaining on non-finished spools, left axis) and a **consumed** line (grams printed per day, right axis), with hover/tap inspection of exact daily values. Cover the behavior with Playwright e2e tests.

## Scope

- The "Consumption · last 30 days" section of the dashboard route `/`.
- A data source (dashboard API) providing, for every day of the window, both values zero-filled and consecutive.
- Playwright e2e tests in `e2e/tests/` for all user-visible behavior, plus xUnit unit tests for the changed domain logic (see Constraints).
- No change to any other dashboard element (stat tiles), other routes, the WebSocket protocol, or the label/sort/facet features.

## Out Of Scope

- No charting library: the graph stays hand-built inline SVG in the existing React/TS SPA.
- No new database tables, columns, or migrations; per-day values are derived from spool events and current spool state.
- No change to time-zone bucketing (UTC calendar days, as today).
- No change to spool lifecycle rules, undo/redo guards, weights, or event semantics.
- No change to the meaning of the dashboard stat tiles (active remaining stock, counts).
- Documentation updates under `doc/spec/` happen in the document stage after verification, not in this change.

## Behavior

### Data

- The graph covers a fixed window of 30 consecutive UTC calendar days ending today. Every day of the window is present, including days with no events (zero-filled).
- Each day has two values, in whole grams:
  - **Total stock**: sum of remaining grams over all spools that are *not finished* at the end of that day. A finished spool contributes 0; its remaining grams are treated as thrown away.
  - **Consumed**: grams from enabled print events recorded on that day. Adjustments, openings, finishes, and creations never count as consumed.

### Chart

- One plot with two lines:
  - Total stock line, bound to the **left** y-axis (in **kilograms**).
  - Consumed line, bound to the **right** y-axis (in **kilograms**).
   - **(amended 2026-08-21, see amendment.md)** Each axis is drawn as a set of dotted horizontal gridlines in the same color as its line, with "nice" kilogram labels **also drawn in that same line color** — the top snaps up to a meaningful multiple of a nice step (from {0.25, 0.5, 1, 2, 2.5, 5, 10, …} kg), floored at 1 kg, with 3–6 ticks; the two axes use different tick counts so the dotted grids never alias. This supersedes the earlier "0 to window-max × 1.05, whole grams" rule.
- The two lines use visually distinct colors drawn from the design-system palette (`var(--cyan)` for total stock, `var(--accent)` for consumed), so they re-theme with the light/dark mode.
- X-axis: 6–8 date labels spread across the window, always including the window's first day and today, rendered from the UTC day value in a short month-day format (no local-time-zone shift); a grey dotted vertical gridline is drawn at each labeled date.
- Legend: exactly two entries, labeled **"Total stock"** and **"Consumed"**, each with a swatch in its line's color; the legend/axis text uses the theme ink (`var(--fg)`) so it stays legible in both light and dark.
- The previous 30-day sum text (currently "N g total") is no longer shown.

### Hover and touch

- Pointer over the plot: the nearest day is highlighted with a vertical line, and a readout with that day's date and both exact values (whole grams, " g" suffix) is shown. **(amended 2026-08-21, see amendment.md)** the readout is a fixed panel in the chart header, next to the legend (not a box that floats near the pointer); it updates day by day as the pointer moves, and both the highlight and the readout hide when the pointer leaves the plot.
- Touch: a tap on the plot shows the same highlight and readout for the tapped day; a tap elsewhere hides them.

### Updates

- The dashboard refetches its data on WebSocket `change` messages for `spool` or `filament-type`, exactly as today, and on the initial load; the new graph updates live in every open dashboard without a manual reload.

## Rules And Edge Cases

1. A day is a UTC calendar day (existing backend bucketing, unchanged). A day's values include every event whose `occurredAt` falls in that day; they are the values at the end of the day.
2. Total stock(day) = Σ over spools of (remaining grams at end of day, where remaining = initial net grams plus the deltas of all enabled events up to and including that day) if the spool is not finished at end of day, else 0. A spool is finished at end of day when its enabled events up to that day resolve to the Finished state under the standard domain chronological order.
3. Creating a spool with initial net weight I grams raises total stock by I grams from its creation day onward; it does not touch the consumed line.
4. A print of g grams on day D lowers total stock by g grams from day D onward and raises the consumed line by g grams on day D.
5. A weighed adjustment changing the balance by d grams on day D (d may be negative) shifts total stock by d grams from day D onward; the consumed line is unaffected, in both directions.
6. Finishing a spool that still has R grams remaining on day D lowers total stock by R grams from day D onward; the consumed line is unaffected. Finishing a spool at 0 g changes neither line.
7. Undoing an event removes its effect from both lines for its day and every later day; redo reapplies it. Undoing a finish restores the spool's contribution to total stock for the whole window as if it had not been finished.
8. Deleting a spool removes its entire contribution from both lines, for all 30 days.
9. Spools finished before the window starts contribute nothing (their remaining is already thrown away).
10. With no spools at all, both lines are flat at 0 and both axes span 0 to 1 000 g.
11. Only today's total-stock point is directly cross-checkable against the summary's active-remaining value; earlier days are derived from event history, so flat segments where nothing happened are exact reconstructions, not estimates.
12. All graph values are whole, non-negative grams of net filament (empty-spool weight excluded).

## Acceptance Criteria

All criteria are observable in the browser at `/` (Playwright-verifiable). Seeded fixtures may place events on specific past days; UI actions (create, print, adjust, finish, undo, delete) may be performed through the UI.

1. The consumption section renders a legend with exactly two entries labeled "Total stock" and "Consumed"; each entry's swatch color equals the color of its line; the two line colors differ. **(amended 2026-08-21, see amendment.md)** the colors follow the page theme (legible on both light and dark backgrounds), and each y-axis kilogram label is drawn in the same color as its line.
2. On a system with zero spools, the window is still full: the leftmost x-axis label equals UTC today−29, the rightmost equals UTC today, hovering a day without events (e.g., the middle day) shows a readout with 0 g total stock and 0 g consumed, and both axes read 0 at the bottom and **1 kg** at the top, each with 3–6 dotted kg ticks whose two counts differ.
3. With seeded history, each y-axis top is the smallest "nice" kilogram value (a multiple of a step from {0.25, 0.5, 1, 2, 2.5, 5, 10, …} kg) that is at least the window maximum per-day value for that axis (floored at 1 kg) — a meaningful multiple, not max × 1.05; the two axes use different tick counts.
4. Creating a new spool with initial net weight of exactly 1 000 g via the UI raises today's tooltip total stock by 1 000 g (and leaves earlier days unchanged); the consumed line is unchanged on every day.
5. A seeded print of exactly 300 g on day D (D before today): day D's tooltip consumed value is 300 g; days earlier than D show the previous consumed values; total stock from day D onward is 300 g lower than on day D−1 (all else equal).
6. A seeded positive adjustment of exactly +250 g on day D: total stock is 250 g higher from day D onward; the tooltip consumed value on day D is unchanged.
7. A seeded negative adjustment of exactly −200 g on day D: total stock is 200 g lower from day D onward; the tooltip consumed value on day D is unchanged — a negative adjustment never raises the consumed line.
8. A spool finished on day D with exactly 400 g remaining (seeded): total stock from day D onward is 400 g lower than before the finish; the tooltip consumed value on the finish day is unchanged (0 g if there was no print that day).
9. Undoing (through the UI) a 300 g print recorded on day X lowers day X's tooltip consumed value by 300 g and raises total stock by 300 g from day X onward; redoing restores both.
10. Deleting, through the UI, a spool that has seeded prints and stock in the window removes all of its consumed-line values and its stock contribution from every day.
11. Hovering the plot at day D shows a vertical highlight on day D and a fixed readout with D's date and the exact values "… g" for total stock and consumed; moving to day D′ updates the readout to D′'s values; moving the pointer off the plot hides the highlight and the readout.
12. In a touch-emulated viewport, tapping the plot at day D shows the highlight and tooltip with both exact values; tapping outside the plot hides them.
13. With the dashboard open in a second browser context, performing a print in a first context updates the second context's chart (tooltip consumed and total stock values change) without a manual reload.
14. After seeding prints, no 30-day consumption sum text (e.g., "… g total") is displayed in the consumption section.
15. At a 375 px wide viewport the chart renders without causing horizontal overflow of the page; the legend remains visible and the x-axis still shows 6–8 labels.

## Constraints And Dependencies

- Frontend: React 19 + TypeScript + Vite SPA; the graph is hand-built inline SVG with no new dependency.
- The per-day derivation (stock reconstruction incl. finish exclusion, consumed = prints only, zero-fill) is server-side domain logic exposed through the dashboard API (a new or extended endpoint) as a zero-filled consecutive day series in whole grams; the client renders the provided values. The `days` 1–365 clamping of the usage endpoint, if reused or extended, is preserved.
- Testing policy: both layers required —
  1. Unit tests (xUnit, the relevant `.Tests` project) for the derivation logic: zero-fill over the window; consumed counts prints only (negative adjustment excluded); finish excludes remaining from stock; adjustment of either sign shifts stock; undo/redo effects; state resolution per day.
  2. Playwright e2e tests (`e2e/tests/`) covering every user-visible acceptance criterion above, linked criterion-by-criterion in the implementation plan's test matrix.
- No schema change; values are reconstructed from `spool_events` and spool state on every request.
- Existing behavior that must keep working: dashboard stat tiles, WebSocket refresh flow, version-gate resume, all other routes.

## Decisions

1. **Total line data** (user): per-day stock for the full 30-day window, reconstructed from event history — not just today's value.
2. **Finished spools** (user): remaining grams of a finished spool are excluded from total stock from the finish day onward; a finish never affects the consumed line. This resolves README line 12 per the user's explicit clarification.
3. **Consumed-line definition amended** (user): the consumed line counts enabled *print* events only. Spool creation, adjustments (both signs), and finishes affect only the total line. This supersedes the current documented "daily consumption includes negative adjustments" rule; `doc/spec/domain-rules.md` is updated in the document stage.
4. **Undo/redo and deletion** (user): fully reflected in both lines.
5. **Scales** (user; **amended 2026-08-21**): each axis is a dotted "nice" kilogram ruler — ticks in {0.25, 0.5, 1, 2, 2.5, 5, 10, …} kg snapping the top up to a meaningful multiple, floored at 1 kg, 3–6 ticks, and the two axes use different tick counts so the grids don't alias. (Originally: 0 to per-day maximum × 1.05 in whole grams; superseded — see amendment.md.)
6. **Hover** (user; **amended 2026-08-21**): vertical day highlight plus a fixed header readout (next to the legend, not floating) with both exact values.
7. **X-axis** (user): roughly 7 evenly spaced labels (6–8), including first day and today.
8. **Scenarios confirmed** (user): fixed 30-day window with zero-filled days; WebSocket live updates unchanged; the "N g total" text is removed; responsive with tap as the hover replacement on phones.
9. **Time-zone display**: labels and tooltip show the UTC day value as-is (no local-time shift), fixing the current axis off-by-one west of UTC.
10. **Legend labels**: "Total stock" and "Consumed".
11. **Rendering**: inline SVG, no new frontend dependency (consistent with the existing codebase).
12. **Computation**: server-side, unit-testable per the project testing policy; the client renders provided values.

## Open Questions

- None blocking. Left to the implementation plan within the bounds above: exact axis tick count and label rounding, tooltip date format, exact line colors (constrained by AC 1, 3, 12, 15).
