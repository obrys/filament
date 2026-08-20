# Improve the PDF layout (004)

## Approval

Status: approved
Approved by: obrys
Approved on: August 17, 2026

## Purpose

Make the printable spool-label PDF more paper-efficient and more legible. Today the
A4 page tiles two 70 × 35 mm labels per row (14 per page) with 10 mm margins, and the
label's text is squeezed into the top-left corner of the panel. The change retiles the
page to three labels per row (21 per page) with 5 mm left/right margins for
edge-to-side printing and 1 mm gaps, and redistributes the label content across the full
label area: a larger 30 mm QR code, text rows spread over the whole label height, a
legible 8 pt font floor, and long text that spills harmlessly under the QR code's white
background instead of shrinking to illegibility.

## Scope

- Page tiling of the `GET /api/labels` PDF: margins, rows per page, labels per page, label panel size, inter-label gaps, page count.
- Label panel design: vertical distribution of the text rows, QR code size (30 mm), font sizing with an 8 pt floor, and overflow behaviour under the QR code for long field values.
- Updates to the existing unit and Playwright e2e tests that assert the old tiling (14 per page, 2 per row) so they assert the new tiling.

## Out Of Scope

- `GET /api/labels` request semantics: required `id` values, `copies` parsing and 1–10 range, `400`/`404` responses, `application/pdf` content, download name `spool-labels.pdf`.
- Label-to-spool mapping and ordering: spools in request order, copies contiguous per spool (A, A, B, B), unknown IDs skipped.
- QR code payload: absolute spool page URL built from the request scheme/host.
- The set of label content fields: brand, `material · type`, colour name, colour swatch (only when the hex is a valid 6/8-digit hex), spool ID.
- The `/spools` print-copies dialog and all SPA behaviour.
- Paper format beyond A4 portrait; top/bottom margins stay 10 mm (no edge-to-edge in the paper-feed direction).
- Any new user setting, UI control, or configuration of the layout.

## Behavior

### Page tiling

- The document is A4 portrait, 5 mm left/right page margin, 10 mm top/bottom page margin.
- Each page holds a grid of three columns and seven rows of 66 × 35 mm label panels,
  with a 1 mm gap between adjacent panels, horizontally and vertically. A full page holds
  exactly 21 labels.
- Labels fill the grid row-major, left to right. A page holds whole rows only; rows are
  never split across pages. For N labels the document has exactly `ceil(N / 21)` pages;
  the last page holds the remaining labels in the first rows of its grid.
- N = number of resolved spools × copies, with copies expanded per spool (A, A, B, B)
  exactly as today.

### Label panel

- Each label is a bordered 66 × 35 mm panel (thin 0.5 pt border as cut guide).
- A 30 × 30 mm QR code sits in the right part of the panel, vertically centred, with its
  opaque white rendering. Its payload is the spool's absolute page URL as today.
- The text occupies a left column spanning the panel width minus the QR code area.
  From top to bottom it contains: the brand (bold), `material · type`, the colour name
  (with the colour swatch inline when the hex colour is valid), and the spool ID
  (bold). The rows are distributed across the full panel height — the brand sits in the
  top of the panel and the spool ID in the bottom — instead of being stacked at the top.
- Font sizes start from the current base sizes (brand 11 pt, `material · type` 9 pt,
  colour 9 pt, spool ID 14 pt) and shrink per field as needed for the text to fit the
  visible text column with line wrapping. Shrinking stops at 8 pt; text that still does
  not fit at 8 pt continues under the QR code instead of shrinking further.
- The QR code's opaque white rendering is painted over any spilled text, so on the
  printed page the QR appears clean, with no text visible over or through it.
- No text of any label is drawn outside its panel.

### Preserved behaviour

- Endpoint responses, content type, download name, copies semantics, and ordering are
  unchanged.
- The swatch is rendered only for a valid hex colour, as today.
- One QR image per label; every label shows all of its fields (possibly wrapped,
  shrunk to the floor, or partially spilled under the QR).

## Rules And Edge Cases

- N between 1 and 20: a single page; labels fill rows of three (the last row may hold
  one or two labels, left-aligned).
- N = 21: one full page. N = 22: two pages, 21 + 1. N = 42: two full pages.
- A single label with very long values (each of brand, material, type, colour at least
  64 characters): still one label, one QR, spool ID fully visible, other fields wrapped
  and shrinking but never below 8 pt, remainder spilled under the QR.
- A value containing one word longer than the text column at 8 pt spills under the QR
  rather than being broken mid-word or shrunk below 8 pt.
- Spool IDs are always 4 generated characters and never need to spill, wrap, or shrink.
- Missing or invalid hex: no swatch, layout otherwise unchanged. An empty field value
  leaves its row in place (the grid of text rows in a label is fixed).
- QR module count varies with URL length; the displayed QR size stays 30 mm.
- Zero resolved spools: `404` before any PDF is produced (unchanged).

## Acceptance Criteria

Layout geometry and content assertions are made on the PDF returned by
`GET /api/labels` as captured through the browser print flow (dialog → Print → PDF
response) or directly by the e2e/http client; tolerances are ±0.5 mm for geometry and
±0.05 pt for font sizes.

1. **21 labels print on one A4 page.** Printing labels for 21 spools (dialog, copies=1)
   returns a PDF with one page whose media box is A4 portrait (595 × 842 pt ±0.5), with
   exactly 21 QR images on that page, arranged in 7 rows of 3.
2. **Margins and gaps.** On any generated PDF: the leftmost panel starts at 5 mm from
   the page's left edge and the rightmost ends at 5 mm from the right edge (±0.5 mm);
   the top row starts at 10 mm from the top (±0.5 mm); the horizontal gap between
   adjacent panels in a row and the vertical gap between adjacent rows are each 1 mm
   (±0.5 mm); each panel measures 66 × 35 mm (±0.5 mm).
3. **Page count is ceil(N/21).** 22 spools return a 2-page PDF with 21 labels on page 1
   and 1 on page 2 (in the first grid row); 43 spools return a 3-page PDF (21 + 21 + 1);
   20    spools return a 1-page PDF with 20 labels (six full rows of 3 plus a final row of 2,
   left-aligned).
4. **Panel content.** Every label contains, in the PDF text: the brand, the
   `material · type` line, the colour name, the spool ID, and exactly one QR image of
   30 × 30 mm (±0.5 mm). Labels with a valid hex colour contain the swatch; labels
   without a valid hex contain no swatch (unchanged behaviour).
5. **Vertical distribution.** For every label, the brand text begins within the top
   8 mm of the panel and the spool ID text ends within the bottom 10 mm of the panel;
   no label's visible text is confined to the top half of the panel.
6. **Spool ID always visible.** For a label whose brand, material, type, and colour
   values are each at least 128 characters, the spool ID text lies entirely inside the
   panel, entirely to the left of the panel's QR image, and at a font size of at least
   8 pt.
7. **8 pt floor.** No font used by any label text in any generated PDF (including
   labels with 200+ character field values) is smaller than 8 pt.
8. **Spill under the QR is hidden.** For a label where a field overflows the visible
   text column at 8 pt, the spilled glyphs are drawn within the panel and the label's
   QR image (opaque, with white rendering) is painted after them in the page content,
   so the printed page shows no text over the QR; no text glyph of any label extends
   outside its panel rectangle.
9. **Endpoint regression.** All existing endpoint behaviours hold unchanged: missing
   `id` → `400`; only-unknown ids → `404`; `copies` of `0`, `-2`, `1.5`, `abc`, `11` →
   `400` with no PDF; a valid request returns `application/pdf` named
   `spool-labels.pdf`.
10. **Ordering regression.** With `?id=A&id=B&copies=2` the six labels appear in
    A, A, B, B order on the page (verified by in-PDF text order); repeated ids are not
    de-duplicated.
11. **Dialog flow regression.** On `/spools`, selecting spools and pressing
    "Print labels (N)" still opens the in-page dialog; Print opens the PDF in a new tab
    with `copies=K`; Cancel closes without a request (existing dialog behaviour is
    unchanged).

## Constraints And Dependencies

- Existing dependencies only: QuestPDF 2024.12.0 and QRCoder 1.6.0 (already referenced
  by the API project). No new external library is introduced.
- A4 portrait paper; the left/right 5 mm margin must be printable edge-to-side on the
  target printer (a user statement, not verified in software).
- Testing policy (see `doc/spec/operations.md`): the change is covered by both unit
  tests (xUnit: pagination at 21 per page, copies expansion, 8 pt / no-overflow rules
  via the generator's output) and Playwright e2e tests (dialog-driven print flow
  asserting the new page content). The e2e PDF inspection fixture
  (`e2e/tests/fixtures/pdf.ts`) must be extended to expose panel and text geometry
  (positions, panel rectangles, per-font sizes) for these assertions.
- Existing tests that encode the old tiling — `LabelPdfGeneratorTests`
  (14-per-page theory cases), `LabelsControllerTests`, `e2e/tests/labels.spec.ts`
  (AC-3/6/7/12/13/14 page-count and label-count expectations) — are updated as part of
  this change to the new tiling; their other assertions (order, copies semantics,
  dialog) must keep passing.

## Decisions

- **D1** — Grid: 3 × 7 (21 labels per A4 page), 5 mm left/right margins, 10 mm
  top/bottom margins, 1 mm gaps in both directions, 66 × 35 mm panels, A4 portrait,
  rows never split across pages, `ceil(N / 21)` pages. (User, 2026-08-17.)
- **D2** — QR code enlarged from 28 mm to 30 × 30 mm, kept on the right of the panel,
  vertically centred. (User, 2026-08-17.)
- **D3** — The spool ID must always be fully visible; brand, `material · type`, and
  colour may wrap, shrink, or spill under the QR. (User, 2026-08-17.)
- **D4** — Label layout: same fields as today (brand / `material · type` /
  colour + swatch / spool ID), rows distributed vertically across the full 35 mm
  height. (User, 2026-08-17.)
- **D5** — Font floor 8 pt; text that still overflows at 8 pt spills under the QR
  code's white background instead of shrinking further. (User, 2026-08-17.)
- **D6** — Assumption, accepted: no new external library; no change to endpoint
  semantics, QR payload, label fields, or the print dialog. (Recorded in
  `amendment.md`.)

## Open Questions

None — all questions from the refinement batch were answered. Pending only the user's
approval of this specification.
