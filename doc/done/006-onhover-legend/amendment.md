# Amendment — 006 Onhover legend

Refinement notes for `doc/todo/006-onhover-legend/`. `README.md` remains the immutable original request.

## References consulted

- `README.md` (this directory) — original request: remove the 3-row hover readout box next to the legend and merge its content (both values + date) into the legend as one line.
- `doc/spec/interfaces.md` — dashboard route `/`, the consumption graph paragraph describing the two-entry legend ("Total stock", "Consumed") and the fixed per-day readout next to the legend.
- `doc/spec/operations.md` — testing policy: every user-visible change needs Playwright e2e coverage; unit tests only for changed domain logic.
- `doc/done/005-consumption-graph/specification.md` and `amendment.md` — current behavior: fixed 3-row readout (date, "Total stock: N g", "Consumed: N g") in the chart header right of the legend; show on hover/tap, hide on leave/tap-outside; dashed vertical day highlight in the plot.
- `web/src/components/ConsumptionChart.tsx` — legend markup (lines 228–236), 3-row readout box `data-testid="tooltip"` with `PANEL = { x: 300, y: 6, w: 214, h: 66 }` (lines 27–29, 238–251), `formatMD()` short month-day date format (31, 37–41), raw whole-gram values in the readout, `fmtKg` trailing-zero-free kilogram formatting used by the axes (45–46), hover/tap show/hide logic (129–155, 282–292).
- `web/src/styles.css` — theme tokens (`--cyan`, `--accent`, `--fg`, …) already used by the chart ink.

## Questions asked and answered

1. **One-line layout** (user): keep both swatched entries, append the value to each entry's label, and put the day at the end of the line: `■ Total stock: 14.2 kg  ■ Consumed: 0.5 kg  — Aug 16`. (Alternative single plain line without swatches was offered and rejected.)
2. **Unit and precision** (user): *grams if the value is lower than 1 kg; kilograms if the value is 1 kg or greater, rounded to two decimal places.* The user's worked example "2345 grams → 1.35 kg" is inconsistent with the stated rule (2345 g rounds to **2.35** kg; 1345 g → 1.35 kg). The binding instruction is the stated rule — round to two decimal places; the example is treated as a typo. Displayed kilograms follow the existing axis style: trailing zeros dropped (1000 g → "1 kg", 1500 g → "1.5 kg", 789 g → "789 g").
3. **Hover-off behavior** (user): when the pointer leaves the plot or a tap lands outside it, the legend reverts to the plain two entries without values and date (today's show/hide timing is preserved).
4. **Unchanged parts** (user, confirmed): the dashed vertical day-highlight line, the hover/tap interaction, and the per-day values and date shown all stay exactly as today; only the readout's location and shape change (3-row box removed, content merged into the legend line).

## Assumptions recorded

- The merged line uses the existing short month-day date format ("Aug 16", no year, no leading zero on the day), identical to today's x-axis labels and readout date.
- The per-day values remain the exact whole-gram values from `GET /api/dashboard/usage`; only the client-side formatting changes. No API change.
- "One line" means the enhanced legend occupies a single text line in the chart header (both values visible simultaneously at the same vertical position), replacing the removed 3-row box; the exact swatch/spacing/separator details (e.g., an em-dash before the date) are presentation details for the implementation plan.
- This is a pure frontend presentation change: no domain logic, endpoint, schema, or WebSocket change.

## Post-approval clarification (August 23, 2026)

The user re-confirmed the kilogram rounding at the planning stage: **2 345 g → 2.35 kg**, and gave an explicit ladder — 1 010 g → 1.01 kg, 1 011 g → 1.01 kg, 1 012 g → 1.01 kg, 1 013 g → 1.01 kg, 1 014 g → 1.01 kg, **1 015 g → 1.02 kg**. Fix the tie-break as **half up**: a third decimal of exactly 5 rounds up. Recorded in `specification.md` (approval note, Rule 1, Decision 2, new AC-11); spec status remains approved.

## Open decisions

- None blocking. Left to the implementation plan within the bounds of the specification: exact separators and horizontal spacing on the legend line, font sizes, and how the line reflows at the 375 px viewport width (must not overflow the page — see AC).
