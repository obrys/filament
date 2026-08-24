# Onhover legend

## Approval

Status: approved
Approved by: obrys
Approved on: August 23, 2026
Post-approval clarification (obrys, August 23, 2026): kilogram rounding tie-break is half-up (a third decimal of 5 rounds up: 1 015 g → 1.02 kg, 1 014 g → 1.01 kg, 2 345 g → 2.35 kg). Recorded in Rule 1, Decision 2, and AC-11.

## Purpose

On the dashboard's consumption graph, the per-day hover/tap readout is a 3-row box in the chart header, right of the legend, which forces an empty gap between the legend's "Total stock" and "Consumed" swatches. Remove that box and merge its content — both day values plus the date — into the legend itself: while a day is highlighted, the legend becomes a single enhanced line (e.g. `■ Total stock: 1.5 kg  ■ Consumed: 150 g  — Aug 16`) instead of three rows.

## Scope

- The chart header of the consumption graph on the dashboard route `/` (legend area only).
- Playwright e2e tests in `e2e/tests/` for the changed user-visible behavior.
- No other dashboard element, root, data source, or chart feature is touched.

## Out Of Scope

- No change to data derivation or `GET /api/dashboard/usage`; per-day values remain the exact whole-gram, zero-filled series the endpoint provides. Formatting is client-side only.
- No change to the two lines, the dotted kilogram y-axes, the x-axis labels/gridlines, theme wiring, or WebSocket live-update flow.
- No change to the hover/tap interaction logic: what triggers the highlight, day-by-day updates, and show/hide timing all stay as today.
- No change to the dashed vertical day-highlight line in the plot.
- No charting library or new frontend dependency: the legend stays hand-built inline SVG in the existing React/TS SPA.
- Documentation updates under `doc/spec/` happen in the document stage after verification, not in this change.

## Behavior

### No day highlighted

- The chart header shows the existing plain legend: exactly two entries labeled **"Total stock"** (swatch in `var(--cyan)`) and **"Consumed"** (swatch in `var(--accent)`), with no values and no date.
- The existing fixed 3-row readout box (date, "Total stock: … g", "Consumed: … g") is no longer rendered at all — not even empty.

### Day highlighted (hover or tap)

- The legend changes into one single line, in this order:
  1. `Total stock` swatch, then the text **"Total stock: <total>"**
  2. `Consumed` swatch, then the text **"Consumed: <consumed>"**
  3. the highlighted day's date in the existing short month-day format (**"Aug 16"**, no year, no leading zero on the day, no local-time-zone shift)
- Both values sit on the same single text line as the date (both visible simultaneously, at the same vertical position); nothing wraps to a second line.
- `<total>` and `<consumed>` are that day's exact endpoint values (whole grams) formatted per the unit rule in Rules And Edge Cases.
- The dashed vertical day-highlight in the plot, the day-by-day update as the pointer/tap moves, and the reversion to the plain legend when the pointer leaves the plot (or a tap lands outside it) all behave exactly as today.
- While the dashboard receives WebSocket `change` updates, the enhanced line reflects the current data at the moment of hover (no separate caching of readout values).

## Rules And Edge Cases

1. **Unit rule (per value, independently):** a value **below 1 000 g** is shown in whole grams, "<N> g" (e.g. 789 g → **"789 g"**). A value of **1 000 g or more** is shown in kilograms, the gram value divided by 1000 and **rounded to two decimal places, half up** (a third decimal of exactly 5 rounds up), with trailing zeros dropped (matching the existing axis kilogram style): 1 000 g → **"1 kg"**, 1 010 g → **"1.01 kg"**, 1 014 g → **"1.01 kg"**, 1 015 g → **"1.02 kg"**, 1 500 g → **"1.5 kg"**, 2 345 g → **"2.35 kg"**, 7 890 g → **"7.89 kg"**.
2. A value of **0 g** is shown as **"0 g"** (0 is below 1 kg, so grams apply), e.g. a print-free day reads "Consumed: 0 g".
3. Exactly **1 000 g** crosses the threshold and is shown as **"1 kg"**, never "1000 g".
4. The two values can be in different units simultaneously (e.g. "Total stock: 1.5 kg  Consumed: 150 g").
5. The date is the UTC day of the highlighted day in the existing short month-day format (no year), identical to the x-axis date labels.
6. Only one legend line exists at a time — the enhanced state fully replaces (never is added to) the plain two-entry legend, and the removed 3-row box is never drawn in any state.
7. The enhanced line uses the existing theme tokens (ink `var(--fg)` for labels, `var(--cyan)`/`var(--accent)` for swatches), so it re-themes with light/dark mode exactly like the rest of the chart.

## Acceptance Criteria

All criteria are observable in the browser at `/` (Playwright-verifiable). Seeded fixtures (direct SQL + `POST /api/spools/reevaluate`) may place spools and prints on specific past days to produce known per-day values.

1. With no day highlighted, the chart header shows exactly two plain legend entries labeled "Total stock" and "Consumed" with their two swatches, no numeric values and no date anywhere in the header, and no 3-row readout box is present in the page markup.
2. Hovering the plot at day D changes the legend to a single line that shows, in order, "Total stock: <total>", "Consumed: <consumed>", and D's short month-day date, with both swatches still present and both values vertically aligned on the same line as the date; no 3-row readout box is present in the page markup.
3. With a seeded day D whose total stock is exactly 789 g, hovering D shows "Total stock: 789 g"; with a seeded day D′ whose total stock is exactly 1 000 g, hovering D′ shows "Total stock: 1 kg"; with a seeded day D″ of exactly 1 500 g, hovering D″ shows "Total stock: 1.5 kg".
4. With a seeded print of exactly 150 g on day D (no other prints that day), hovering D shows "Consumed: 150 g"; with a seeded print-free day, hovering it shows "Consumed: 0 g".
5. Moving the pointer from day D to day D′ updates the enhanced legend line to D′'s two values and date (day by day, as today); moving the pointer off the plot reverts the legend to the plain two entries with no values and no date.
6. In a touch-emulated viewport, tapping the plot at day D shows the enhanced single-line legend with D's values and date and the dashed highlight; tapping outside the plot reverts the legend to the plain two entries and hides the highlight — no readout box involved in either direction.
7. The dashed vertical day-highlight line keeps its current behavior throughout: shown for the highlighted day, updated day by day, hidden when the highlight goes away.
8. With the dashboard open in a second browser context, performing a print in the first context changes the consumed value shown by the enhanced legend for that day when the second context hovers it, without a manual reload.
9. In both light and dark theme, the enhanced legend line is legible: its label ink and swatches use the page theme colors (computed fill/stroke follow `var(--fg)`/`var(--cyan)`/`var(--accent)`), not hardcoded black or white.
10. At a 375 px wide viewport, the enhanced legend renders on one line without causing horizontal overflow of the page, with both values and the date fully visible.
11. Kilogram rounding is half up: with seeded days whose exact values are 1 010 g, 1 014 g, 1 015 g, and 2 345 g, hovering each shows "Total stock: 1.01 kg", "Total stock: 1.01 kg", "Total stock: 1.02 kg", and "Total stock: 2.35 kg" respectively — the fifth decimal place of 5 (1 015 g) rounds **up** to 1.02 kg, never down to 1.01 kg.

## Constraints And Dependencies

- Frontend: React 19 + TypeScript + Vite SPA; the legend stays hand-built inline SVG inside `web/src/components/ConsumptionChart.tsx` (or its successor) with no new dependency.
- No API, schema, or domain change: `GET /api/dashboard/usage` still returns exact whole-gram per-day values; the unit/format rule is applied client-side when building the legend line.
- Testing policy (`doc/spec/operations.md`): the change is user-visible behavior, so each acceptance criterion above is linked to a Playwright e2e test in the implementation plan's test matrix. No domain logic changes, so no xUnit unit tests are required explicitly by this change (the `web/` frontend has no unit-test runner).
- Existing behavior that must keep working: hover/tap interaction and show/hide timing, dashed day highlight, two-line plot, dotted kg axes and their tick rules, x-axis labels/gridlines, theme re-skinning, WebSocket live refresh, and the 375 px layout.

## Decisions

1. **Layout** (user): enhanced legend keeps both swatches, appends each entry's value to its label, and ends the single line with the day's date (`■ Total stock: <total>  ■ Consumed: <consumed>  — <date>`). A plain unswatched single line was considered and rejected.
2. **Unit and precision** (user): grams below 1 kg, kilograms at 1 kg and above, rounded to two decimal places **half up** — a third decimal of exactly 5 rounds up (the value is never rounded down at a tie: 1 015 g → **1.02 kg**, never "1.01 kg"; the ladder is 1 010–1 014 g → "1.01 kg", 1 015 g → "1.02 kg", as confirmed by the user, August 23, 2026). The user's original example "2345 g → 1.35 kg" is inconsistent with the rule and is treated as a typo (2345 g → 2.35 kg). Displayed kilograms drop trailing zeros, matching the existing axis kilogram style ("1 kg", "1.5 kg").
3. **Hover-off** (user): the legend reverts to the plain two entries (no values, no date) when the pointer leaves the plot or a tap lands outside, preserving today's show/hide timing.
4. **Unchanged parts** (user, confirmed): dashed vertical highlight, hover/tap interaction, per-day values, and date content all stay exactly as today; only the 3-row box is removed and its content merged into the legend line.
5. **Date format**: the existing short month-day format (no year, no leading zero, no local-time-zone shift), same as the x-axis labels.
6. **No backend change**: values remain exact whole-gram endpoint values; formatting is client-side presentation only.

## Open Questions

- None blocking. Left to the implementation plan within the bounds above: exact separators and horizontal spacing on the legend line (e.g., an em-dash before the date), font sizes, and how the enhanced line fits the header at 375 px width (constrained by AC 2 and AC 10).
