# Multiple copies of labels

## Approval

Status: approved
Approved by: obrys
Approved on: August 17, 2026

## Purpose

Allow operators to print multiple identical copies of each selected spool's
label in a single PDF download. After clicking "Print labels (N)" on the
`/spools` page, the user chooses a copy count (1–10) in a dialog; the API
then produces `selected spools × copies` labels, grouped per spool, tiled
across one or more A4 pages with the existing label layout.

## Scope

- An in-page copies dialog on `/spools`, opened by "Print labels (N)".
- A new `copies` query parameter on `GET /api/labels`.
- Copies-aware label generation: per-spool grouping and multi-page A4
  output in the PDF generator.
- `labelPdfUrl` in `web/src/api/client.ts` accepting a copy count.
- Remembering the last used copy count in browser storage.
- OpenAPI documentation for the new `copies` parameter.

## Out Of Scope

- Label design or per-label content changes (explicitly excluded by the
  request).
- Per-spool copy counts (every selected spool receives the same copy count).
- Editing or reordering the selected spool list from the dialog.
- Recording spool events or any inventory state change when printing labels.
- Authentication, authorization, or any other interface changes beyond the
  `copies` parameter.
- Cross-browser or cross-device persistence of the last used copy count.

## Behavior

### Copies dialog on /spools

- The "Print labels (N)" button keeps its label and stays disabled while no
  spool is selected. Clicking it with N ≥ 1 now opens an in-page dialog
  instead of directly opening a new tab.
- The dialog shows: the selected spool count (N), a copies field, the
  resulting label count (N × copies), and Print and Cancel buttons.
- The copies field is an integer input with minimum 1 and maximum 10. Its
  initial value is the last used copy count kept in browser storage; when
  none is stored or the stored value is invalid, it starts at 1.
- The displayed resulting label count updates as the copies field changes.
- **Print**: opens a new tab at the labels URL for the selected spools (the
  existing `id` values in their existing request order) with `&copies=K`,
  where K is the field value (see Rules if the value is invalid). The new
  tab loads the PDF (HTTP 200, `application/pdf`, download name
  `spool-labels.pdf`). K is then stored as the last used copy count.
- **Cancel**: closes the dialog. No new tab is opened, no `/api/labels`
  request is made, and the spool selection is unchanged.
- The last used copy count persists in the browser profile across page
  reloads.

### API: `copies` parameter on `GET /api/labels`

- `GET /api/labels?id=A&id=B&copies=K` returns a PDF with K labels for every
  resolved `id` (resolvable ids × K labels total).
- `copies` missing or empty means 1, producing exactly today's output.
- `copies` below 1, above 10, or not a whole number (`1.5`, `abc`) returns
  HTTP 400 with an error body and no PDF.
- Existing `id` handling is unchanged: at least one `id` is required
  (otherwise 400); unknown ids are skipped; if no id resolves, the request
  returns 404 regardless of `copies`.
- Each label's content and design are unchanged (brand, material, type,
  colour, colour swatch only for a valid hex, spool ID, 28 mm QR code with
  the spool page URL payload). The download name stays `spool-labels.pdf`.

### PDF layout: grouping and pages

- Copies of the same spool are contiguous. For `?id=A&id=B&copies=2` the
  label order is A, A, B, B.
- Spools appear in the order their `id` values occur in the request. Each
  `id` occurrence produces its own K labels (duplicates are not
  de-duplicated).
- The tiling is unchanged: 70×35 mm labels, two per row, 10 mm page
  margins, A4 pages — at most 14 labels per page (7 rows × 2).
- When the total exceeds 14 labels, the PDF continues on additional A4
  pages using the same tiling. Rows are never split across pages. A 16-label
  PDF is 2 pages: the first 14 labels on page 1, the last 2 on page 2.
- The PDF has exactly `ceil(labelCount / 14)` pages; labels are numbered
  sequentially across pages (page p holds labels (p−1)·14+1 … min(p·14, n)).

## Rules And Edge Cases

- `copies=1` (or missing `copies`) with S resolvable spools returns S
  labels, identical in content, order, and layout to the pre-change output.
- A single selected spool with K copies produces K identical labels.
- `copies` invalid values: `0`, any negative value, `1.5`, `abc`, and `11`
  all return 400.
- Unknown ids are skipped: `?id=A&id=NOPE&copies=3` yields 3 labels for A.
- All ids unknown: 404, unchanged.
- No `id` values: 400, unchanged.
- Duplicate ids: `?id=A&id=A&copies=2` yields 4 labels, all for A.
- Invalid stored last-used copy count (or none) → the field initial value is
  1.
- Field value at Print time that is not a whole number in 1..10 → the
  request is sent with `copies=1`.
- The dialog is only reachable with N ≥ 1, so 0 spools can never be
  combined with a copy count.
- Printing labels never records spool events and never mutates inventory
  data.
- The QR payload remains the absolute spool page URL assembled from the
  request scheme and host.

## Acceptance Criteria

1. On `/spools` with at least one spool selected, clicking "Print labels
   (N)" opens an in-page dialog showing the selected spool count and the
   resulting label count; until Print is clicked, no new tab opens and no
   `/api/labels` request is made.
2. The dialog's copies field is a numeric input with minimum 1 and maximum
   10, starts at 1 when no last-used value is stored, and the resulting
   label count shown in the dialog updates as the field value changes.
3. Entering a value K (1–10) and clicking Print opens a new tab whose URL
   contains the same `id` values in the same order as the previous direct
   behavior plus `copies=K`, and the tab loads the PDF (HTTP 200,
   `application/pdf`, download name `spool-labels.pdf`).
4. After step 3, reloading `/spools` and reopening the dialog shows K as
   the copies field initial value.
5. Clicking Cancel closes the dialog; no new tab opens, no `/api/labels`
   request is made, and the spool selection is unchanged.
6. With the copies field empty (or holding a value outside 1–10), clicking
   Print sends the request with `copies=1`.
7. `GET /api/labels?id=A&copies=3` for an existing spool A returns a PDF
   (HTTP 200, `application/pdf`) containing exactly 3 labels, all for spool
   A, with identical per-label content (same brand, material, type, colour,
   spool ID text, and QR payload).
8. `GET /api/labels?id=A&id=B&copies=2` for existing spools A and B returns
   a PDF containing exactly 4 labels whose spool IDs appear in the order A,
   A, B, B.
9. `GET /api/labels?id=A&id=B` without `copies` returns a PDF identical in
   per-label content, order, and layout to the pre-change behavior (one
   label per resolved spool, request order).
10. `GET /api/labels?id=A&copies=<v>` returns HTTP 400 with no PDF body for
    each `<v>` in `0`, `-2`, `1.5`, `abc`, `11`.
11. `GET /api/labels` with no `id` values still returns 400, and
    `GET /api/labels?id=NOPE&copies=2` (all ids unknown) still returns 404.
12. `GET /api/labels` for 8 existing spools with `copies=2` (16 labels in
    total) returns a 2-page PDF: page 1 contains the first 14 labels (the
    first 7 spools' copy pairs in request order) and page 2 contains the
    remaining 2 labels (the 8th spool's copy pair); both pages use the same
    tiling (two labels per row, 10 mm margins) and no row is split across
    pages.
13. `GET /api/labels?id=A&id=A&copies=2` returns a PDF containing exactly 4
    labels, all for spool A.
14. `GET /api/labels?id=A&id=B&copies=10` (20 labels) returns a 2-page PDF
    with 14 labels on page 1 and 6 labels on page 2; in all produced PDFs,
    every label retains the pre-change design (brand, material, type,
    colour, swatch only for a valid hex, spool ID, 28 mm QR code pointing at
    the spool page URL).
15. Printing labels with any copy count creates no spool events: the spool
    list, spool detail history, and dashboard counts are unchanged after a
    label download with `copies > 1`.

## Constraints And Dependencies

- Implementation stays within the existing three-layer .NET backend and the
  React SPA per `doc/spec/architecture.md`; no new external dependency is
  introduced (multi-page output continues to use the existing PDF library).
- Label layout constants remain as specified in the "Printable labels"
  section of `doc/spec/interfaces.md`: 70×35 mm labels, two per row, 10 mm
  page margins, A4 pages (14 labels per page maximum).
- No database schema change; label generation records no spool events.
- The OpenAPI document at `/openapi/v1.json` documents `copies` (whole
  number, 1–10, default 1 when missing).
- Testing policy per `doc/spec/operations.md`: unit tests cover label
  count, grouping order, page count, and controller `copies` validation;
  Playwright e2e tests cover the dialog, the print request, the stored
  copy-count persistence, and the resulting PDF (verified via the
  downloaded PDF's per-page text content). The implementation plan's test
  matrix must link each acceptance criterion above to its test(s).
- Backward compatibility: existing `GET /api/labels` URLs without `copies`
  must keep working exactly as before.

## Decisions

- Copies selection is an in-page dialog with Print / Cancel, replacing the
  direct new-tab open (amendment Q1).
- Copies: initial value 1, minimum 1, maximum 10, last used value stored in
  browser storage (amendment Q2).
- The copy count is passed via an explicit `copies` query parameter
  (amendment Q3).
- Missing/empty `copies` means 1; `copies` below 1, above 10, or not a
  whole number returns 400 (amendment Q4).
- The PDF is multi-page when the total exceeds one A4 page, continuing the
  existing tiling (amendment Q5).
- The dialog displays the resulting label count (selected spools × copies).
- Copies of a spool are contiguous; spool order follows the request `id`
  occurrence order; duplicate occurrences each produce `copies` labels.
- Rows are not split across pages; pages are sequential (page p holds
  labels (p−1)·14+1 … min(p·14, n)).
- An invalid field value at Print time sends `copies=1`.

## Open Questions

- Should the API reject `copies > 10` (this specification: yes, HTTP 400),
  or is the maximum of 10 intended as a UI constraint only? Recorded from
  the amendment assumption; needs approver confirmation.
