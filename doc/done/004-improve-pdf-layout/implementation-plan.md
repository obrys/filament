# Implementation Plan: Improve the PDF layout (004)

## Approval

Status: approved
Approved by: obrys
Approved on: 2026-08-19

## Summary

Rework `LabelPdfGenerator` (the only code path that builds the `GET /api/labels`
PDF) to tile A4 pages with 3 × 7 = 21 labels of 66 × 35 mm (5 mm left/right
margins, 10 mm top/bottom, 1 mm gaps) instead of 2 × 7 = 14 labels of
70 × 35 mm (10 mm all-round). Redesign the label panel: a 30 × 30 mm QR code
(on the right, vertically centred) next to a 32 mm text column whose four
fields (brand / `material · type` / colour + swatch / spool ID) are
distributed across the full 35 mm panel height in four 7.75 mm bands, with
font shrinking from the current base sizes down to an 8 pt floor, and text
that still does not fit at 8 pt flowing under the QR code's opaque white
rendering instead of shrinking further. Spool ID is rendered last so it is
always fully visible. No endpoint, SPA, QR-payload, or field-set changes;
no new dependencies.

All existing unit and e2e tests that encode the old tiling (14 per page) are
re-targeted to 21; the e2e PDF fixture gains geometry extraction (panel
rectangles, text-run positions/sizes, image boxes and draw order) so the new
layout is asserted numerically through the browser print flow.

## Preconditions And Decisions

- `doc/todo/004-improve-pdf-layout/specification.md` is `Status: approved`
  (obrys, August 17, 2026). All product decisions are recorded in
  `doc/todo/004-improve-pdf-layout/amendment.md` (answered); the original
  `README.md` is unmodified.
- The change is user-visible (PDF output of a browser-driven print flow), so
  per `doc/spec/operations.md` **both** test layers are required. No layer is
  omitted: every acceptance criterion links to at least one test, and every
  user-visible criterion links to a Playwright test (see Test Matrix).
- This is one focused pull request: one application file
  (`src/Filament.Api/Pdf/LabelPdfGenerator.cs`), its unit tests, the e2e
  fixture and one e2e spec. No split.

### Verified QuestPDF 2024.12.0 mechanics (scratch probes, kept in `/tmp/opencode`)

Probed with the exact pinned package (QuestPDF 2024.12.0 + QRCoder 1.6.0,
`LicenseType.Community` as in `src/Filament.Api/Program.cs:11`):

1. `.Canvas(...)` is a **deprecated stub that throws `NotImplementedException`**
   at runtime ("use the .Svg / SkiaSharp integration"). The Canvas/SkiaSharp
   routes are therefore off the table — which also keeps the change free of
   new external libraries (spec D6).
2. There is **no public clip, overlap, or z-order API**, and `page.Margin` is
   **uniform-only** (`Margin(float, Unit)` — verified via reflection).
3. Fixed-size elements keep their exact size and border even with overflowing
   content — **content spills outside the box rather than being clipped**
   (a 35 mm box with 9 lines of 8 pt text keeps its 35 mm border; the extra
   lines are drawn beyond it). Text additionally carries only a clip around
   its own bounding box. Nothing clips to a container width: a word longer
   than the assigned width is drawn extending past it (observed in the
   content stream: clip width grew to the longest line).
4. Row children are painted left-to-right, i.e. **a text cell's glyphs are
   emitted before the following cell's QR image `Do` reference** in the page
   content stream. The QRCoder PNG is opaque (no `/SMask`) with a white
   background → an image painted after text hides any glyphs underneath.
   (The amendment's assessment of the current generator matches: the QR
   already paints over whatever lies beneath it.)
5. Stream format (matches the existing `e2e/tests/fixtures/pdf.ts`
   assumptions): `/MediaBox [0 0 595 842]` pt; page CTM
   `.25 0 0 -.25 0 842 cm` (internal unit = 0.25 pt, y down); each content
   region opens with `4 0 0 4 tx ty cm` so **region-local coordinates are in
   pt with the origin at the region's top-left** (page pt = `(tx/4, ty/4)`).
   Text: `1 0 0 -1 x y Tm` line origins plus `<hex> Td` advances and
   `/Fn <size> Tf`; line height measured at exactly **1.2 × font size**
   (9.6 pt per line at 8 pt). Image: `<w> 0 0 <h> x y cm` followed by one
   `Do` per QR. Borders are four 0.5 pt edge fills around the box origin.
6. Baseline check of the *current* generator (3 labels): font sizes in the
   stream are only 9/11/14 pt, and all text sits in the top ~13 mm of the
   35 mm panel (first line ≈ 3.2 mm below the panel top) — corroborating the
   amendment's "squeezed in the top-left" evaluation and the 2 pt-ID-shrink
   behaviour for long fields. Rendered baseline PNG for human review:
   `/tmp/opencode/baseline-1.png` (the refinement's copy is no longer on
   disk; `pdftoppm` is available in this environment).

### Consequences and design decisions (implementation-level, D1–D6 preserved)

- **D1'** Page build: `page.Size(A4); page.Margin(5, Unit.Millimetre);` then
  5 mm of top/bottom padding on the page content (uniform-margin API) → net
  5 mm left/right, 10 mm top/bottom (spec D1). Rows are `pageLabels.Chunk(3)`;
  each label is a `ConstantItem(66 mm)` with 1 mm spacer items between labels
  in a row and 1 mm spacers between rows. Row width = 3·66 + 2·1 = 200 mm =
  exactly the 210 − 2·5 mm content width; a short final row (1–2 labels) is
  left-aligned. Stack height = 7·35 + 6·1 = 251 mm ≤ 277 mm; the grid is
  top-anchored (top row at 10 mm).
- **D2'** Label panel: `Width(66, mm).Height(35, mm).Border(0.5f).Padding(2, mm)`
  containing a `Row`: [text column `ConstantItem(32, mm)` | QR cell
  `ConstantItem(30, mm)`]. Inner area = 62 × 31 mm = 32 + 30 exactly. The QR
  is `Width(30, mm).Height(30, mm).Image(qr)` with the cell `.AlignMiddle()`
  → QR vertically centred in the panel (D2), right edge 2 mm from the panel
  right. Because the QR cell is the Row's later child, the QR paints after all
  label text in the content stream (verified mechanism 4) → it covers spilled
  glyphs (spec D5, AC-8).
- **D3'** Text layout: the text column is a `Column` of four fixed
  `ConstantItem(7.75, mm)` bands (31 mm / 4 = 7.75): brand (top band),
  `material · type`, colour (+ swatch), spool ID (bottom band). Each band's
  content is one QuestPDF `Text` element joining manually wrapped lines with
  newlines. Manual wrapping is required because the public API cannot clip or
  reflow overflow (mechanisms 2–3), while the spec demands that no glyph
  leaves the panel.
  - Wrapping/fitting are pure, exposed-for-test functions on
    `LabelPdfGenerator`, reusing the existing conservative `AvgCharEm = 0.7`
    character-width estimate and adding the measured `LineHeightFactor = 1.2`:
    - `FitFieldFont(baseSize, text, bandMm, columnMm) → (size, spill)`:
      candidate sizes step down from `baseSize` by 0.5 to the 8 pt floor;
      size `s` fits when every word is ≤ `columnMm` at size `s` and
      `lines(s) · 1.2·s ≤ band` height. Short fields keep their base size.
    - `WrapLines(text, sizePt, widthMm) → string[]`: greedy word wrap at the
      estimate; a word longer than `widthMm` gets its own line and — if that
      still exceeds the *panel* inner width (62 mm ≈ 41 chars at 8 pt) — is
      truncated at the panel's inner right edge. That pathological case is
      outside the spec's listed edge cases (which only cover words longer
      than the 32 mm text column); truncation there is what keeps the
      universal AC-8 guarantee ("no glyph outside the panel") true.
  - Fit mode: wrap at the 32 mm visible column; the lines fit the band by
    construction. Spill mode (no size ≥ 8 pt fits, i.e. too many lines or a
    word longer than 32 mm at 8 pt): size = 8 pt, wrap at the **full 62 mm
    inner width** — lines continue *under the QR* (they start at the column's
    left edge and extend right, as observed in mechanism 4), and lines keep
    being emitted downward from the field's band until a line would cross the
    panel's inner bottom edge, where emission stops (deterministic
    truncation at the panel boundary — no glyph can leave the panel; the
    text that physically cannot fit in 35 mm is not drawn, which the spec's
    ACs do not contradict: the ACs constrain drawn glyphs, font floor, QR
    coverage, and spool-ID visibility).
  - The spool ID goes through the same machinery but is 4 generated chars at
    14 pt (≈ 39 pt < 90.7 pt column, 16.8 pt line < 21.97 pt band): it always
    fits at base size and is never shrunk, wrapped, or spilled
    (spec: "Spool IDs … never need to spill, wrap, or shrink").
- **D4'** Field draw order is brand → `material · type` → colour → spool ID
  (document order = content-stream order, as today). In spill mode a field's
  extra lines flow downward through the later bands and are covered by the
  later fields' text; the spool ID is drawn **last**, in its own bottom band,
  so it is always fully visible, to the left of the QR, at 14 pt (spec D3,
  AC-6) regardless of how badly the other fields overflow.
- **D5'** Geometry verification is asserted *relative to the spec's constants*
  (panel top-left at (5, 10) mm, 66 × 35 mm panels, 1 mm gaps, QR at panel
  offset (34, 2.5) mm, 30 × 30 mm; text bands; 8 pt floor). The e2e fixture
  converts stream coordinates to page-millimetre via the CTM walk described
  in mechanism 5; the C# unit assertions reuse a minimal inflate + regex scan
  (`System.IO.Compression.ZLibStream` only — no new package).
- **D6'** Vision: the skill asks whether vision can be used to review the
  generated page. **Vision is not available in this environment** — image
  reading was attempted and the tool reports image input is not supported by
  this model (the failure case the skill anticipates). Mitigation: (a) the
  verification backbone is the numerical geometry assertions above (which do
  not depend on vision), (b) the implementation must render PDFs to PNG via
  `pdftoppm` (`/tmp/opencode/`) for a **user** visual review of the baseline
  (`/tmp/opencode/baseline-1.png` already exists) and the result, recorded in
  the implementation notes.
- **D7'** e2e label-count scenarios: the print-dialog 21-label test uses
  3 created spools with copies=7 (the PDF observable — 21 labels, one page,
  7 rows of 3 — is identical to "21 spools, copies=1" and keeps the suite
  fast); the `ceil(N/21)` page-count cases (20/21/22/43 labels) use repeated
  references to the single seed spool id in `GET /api/labels` (repeated ids
  are not de-duplicated — proven by the existing duplicate-ids test — so N
  labels need no extra UI spool creation).

### Unresolved decisions

None at the product/architecture level. If the approver disagrees with the
rendering interpretation in D3'/D4' (how spilled lines are truncated and
stacked), only step 1 (label rendering) and the spill-related assertions
change; approved decisions D1–D6 and all acceptance criteria stand.

## Implementation Steps

1. `src/Filament.Api/Pdf/LabelPdfGenerator.cs`:
   - Replace geometry constants: `LabelsPerPage = 21` (doc comment: 7 rows ×
     3); `LabelWidthMm = 66` (was 70); add `LabelPaddingMm = 2`,
     `GapMm = 1`, `PageMarginMm = 5` (left/right), `PageVerticalExtraMm = 5`
     (top/bottom content padding on top of the 5 mm page margin),
     `TextColumnMm = 32`, `InnerWidthMm = 62`, `QrSizeMm = 30` (was 28),
     `FontFloorPt = 8` (replaces the 2 pt floor in `FitFontSize`),
     `LineHeightFactor = 1.2` (measured). Keep `AvgCharEm = 0.7`.
   - `Generate`: `page.Size(PageSizes.A4); page.Margin(5, Unit.Millimetre);`
     then `page.Content().PaddingTop(5, Unit.Millimetre).PaddingBottom(5,
     Unit.Millimetre).Column(col => …)` (D1'); iterate
     `pageLabels.Chunk(3)`; per row emit a `Row` of
     `ConstantItem(66, mm)` label items with `ConstantItem(1, mm)` spacers
     between labels; `ConstantItem(1, mm)` spacer between rows.
   - Rewrite `RenderLabel` per D2'/D3': panel
     `Width(66, mm).Height(35, mm).Border(0.5f).Padding(2, Unit.Millimetre)`;
     `Row`: text column `ConstantItem(32, mm)` → `Column` of four
     `ConstantItem(7.75, mm)` bands (brand bold 11, `material · type` 9,
     colour 9, spool ID bold 14), each band rendered by a new
     `RenderFieldBand` helper that: computes the fit with
     `FitFieldFont`, wraps with `WrapLines` (32 mm in fit mode, 62 mm in
     spill mode), applies the bottom-edge line budget (D3'), and emits one
     `Text` element (newlines between lines, `.Bold()` where today it is
     bold). The colour band keeps the current swatch pattern (8 × 8 pt
     swatch + 4 pt gap before the colour text, only when
     `TryParseColor` succeeds; all colour lines are indented past the
     swatch, as today). QR cell: `ConstantItem(30, mm).AlignMiddle().Element(
     c => c.Width(30, mm).Height(30, mm).Image(GenerateQr(label.Url)))`.
   - Replace `FitFontSize` with the pure, testable functions (D3'):
     `public static (float Size, bool Spill) FitFieldFont(float baseSize,
     string text, float bandMm, float columnMm)`,
     `public static List<string> WrapLines(string text, float sizePt,
     float widthMm)`, and the band/bottom-edge line budget
     `public static List<string> BudgetLines(string text, float sizePt,
     float wrapWidthMm, float bandTopMm, float innerBottomMm)`. Keep
     `ExpandCopies`, `Paginate` (chunk size follows `LabelsPerPage`),
     `GenerateQr` (opaque white-background PNG, 10-module quiet zone as
     today), `TryParseColor`, and the `LabelData` record unchanged.
   - Update class/method XML doc comments to the new tiling (21 per page,
     66 × 35, 5/10 mm margins, 8 pt floor, spill-under-QR behaviour).
   - `src/Filament.Api/Controllers/LabelsController.cs`: **no changes**
     (endpoint semantics are out of scope and must stay bit-compatible).

2. `tests/Filament.Api.Tests/LabelTilingTests.cs`:
   - Re-target `Paginate_SplitsIntoPagesOfAtMostFourteen` to the 21-per-page
     tiling (rename accordingly): `[1, 1]`, `[20, 20]`, `[21, 21]`,
     `[22, 21, 1]`, `[42, 21, 21]`, `[43, 21, 21, 1]`,
     `[100, 21, 21, 21, 21, 14]`; empty → no pages. Keep the
     `ExpandCopies` tests unchanged.

3. `tests/Filament.Api.Tests/LabelPdfGeneratorTests.cs`:
   - Re-target the page-count theory to
     `[1, 1] [20, 1] [21, 1] [22, 2] [42, 2] [43, 3]` (rename to
     `…OnePagePerTwentyOneLabels`); the long-text single-page case stays 1
     page (3 labels) — rename.
   - Add (inflating each page's Flate content stream in C# with
     `ZLibStream`): `Generate_FullPage_HasTwentyOneQrImages` (21 labels → 21
     `Do` invocations on page 1; 43 → 21 + 21 + 1 per page);
     `Generate_PanelFramesAreSixtySixByThirtyFiveMm` (border edge fills in
     mm: horizontal edges ≈ 66 mm, vertical ≈ 35 mm, ±0.5 mm);
     `Generate_QrImagesAreThirtyByThirtyMm` (the `cm` box preceding each `Do`
     is 85.04 pt square ±0.5 mm → 30 mm);
     `Generate_NoFontSmallerThanEightPt` (every `/Fn <size> Tf` size value ≥
     8 − 0.05, including a label whose four text fields are each 200 chars);
     `Generate_Spill_KeepsGlyphsInsidePanelAndPaintsQrAfterText` (single
     200-char-field label: no text run's Tm/Td-accumulated x exceeds the
     panel inner right edge +0.5 mm and no y exceeds the inner bottom +0.5
     mm; the QR `Do` appears after the label's last `Tj` in the page content
     stream).

4. `tests/Filament.Api.Tests/LabelFontFittingTests.cs` (new): pure tests of
   steps' functions — `FitFieldFont`: short text → base size, no spill; text
   needing 2 lines at base size → shrinks but ≥ 8; text fitting the column
   only at 8 pt → 8 pt, no spill; a word longer than the column at 8 pt →
   spill; `WrapLines`: wraps at the estimated width without splitting words,
   oversized single word kept whole (truncated only beyond the panel width
   case), empty text → base size/empty; `BudgetLines`: truncates so no line
   crosses the inner bottom edge, order preserved.

5. `tests/Filament.Api.Tests/LabelsControllerTests.cs`:
   - Existing tests keep passing (≤ 3 labels remain a single page under the
     new tiling). Extend for the new page count (spec lists this file among
     the tests encoding the old tiling): 21 valid ids → single-page PDF
     (`/Count 1`); 22 ids → 2 pages (`/Count 2`).

6. `e2e/tests/fixtures/pdf.ts` (extension only — `pdfPages`,
   `pdfPageCount`, `countOccurrences`, `idOrderInText` stay as they are):
   add `pdfGeoPages(bytes)` returning per page:
   - `mediaBox: [w, h]` in pt (from `/MediaBox`);
   - `rects: { xMm, yTopMm, wMm, hMm, rgb }[]` — filled rectangles (`re f`)
     with fill colour, transformed through a small 3×2 CTM stack
     (`q/Q`, `cm`), converted from pt to mm (top-left page origin);
   - `textRuns: { text, xMm, yTopMm, sizePt, order }[]` — per BT-block per
     line (Tm origin + accumulated Td), glyph text decoded with the existing
     ToUnicode-CMap machinery;
   - `images: { xMm, yTopMm, wMm, hMm, order, opaque }[]` — from the `cm`
     matrix preceding each `Do`; `opaque` = the referenced image XObject
     dictionary has no `/SMask`.
   All coordinates in page millimetres from the top-left corner; `order` is
   the absolute index of the operation in the content stream (used for the
   paint-order assertions).

7. `e2e/tests/labels.spec.ts` (per spec, re-target old-tiling tests + new
   geometry tests). `createSpoolViaUi` / `openPrintDialog` /
   `printViaDialog` helpers are reused unchanged.
   - Re-target old AC-12 test ("16 labels produce a 2-page PDF (14 + 2)…")
     → **"16 labels fit on one page with per-spool pairs"**: 8 UI-created
     spools × copies=2 → 1 page, `labelCount` 16; per-spool pair order
     `[A, A, B, B, …]` in the page text (no second page at all).
   - Re-target old AC-14 test ("copies=10 returns 2 pages (14 + 6)…") →
     **"copies=10 returns 1 page of 20 labels with unchanged label content"**:
     1 page, `labelCount` 20, brand/material/type/color occurrences each = 20.
   - New **"21 labels fit one A4 page in 7 rows of 3"** (AC-1, AC-2, AC-3;
     print flow per D7': create 2 spools via UI, select seed + both,
     dialog copies=7, Print): response 200 `application/pdf`
     `spool-labels.pdf`; 1 page; `mediaBox` [595, 842] pt ±2; 21 images;
     from `pdfGeoPages`: panel frames at top-left (x, y) ∈
     {5, 72, 139} × {10, 46, 82, 118, 154, 190, 226} mm (±0.5) each 66 × 35
     mm (±0.5); QR images at panel offset (34, 2.5) mm, 30 × 30 (±0.5);
     exactly 3 QRs per row and 7 rows; leftmost panel x = 5 mm and rightmost
     panel right edge = 205 mm (±0.5) — 5 mm side margins; top row at
     10 mm (±0.5); horizontal/vertical gaps between adjacent panels =
     1 mm (±0.5).
   - New **"single label panel: distributed text, 30 mm QR, 8 pt floor,
     opaque QR painted last"** (AC-2, AC-4, AC-5, AC-7, AC-8; one seed
     spool via `page.request.get`): panel at (5, 10) mm 66 × 35; the QR
     image at (39, 12.5) mm 30 × 30 and `opaque === true`; the QR's
     `order` is greater than the label's last text run `order`; the brand
     text run starts within the panel's top 8 mm and no text run is
     confined to the top half (ID run bottom is below panel mid-line); the
     spool-ID run is entirely inside the panel, entirely left of the QR, and
     ≥ 8 pt; **no** run smaller than 8 pt − 0.05; **no** run extends outside
     the panel rectangle (±0.5 mm); the swatch appears (seed types get the
     form's default hex `#888888`: rect ≈ 2.8 × 2.8 mm in the #888888 fill
     colour beside the colour row); brand / `material · type` / colour /
     spool-ID strings all present in the page text.
   - New **"long field values: spool ID fully visible, 8 pt floor, spill
     hidden under the QR"** (AC-6, AC-7, AC-8): create one type via the
     `/types` form whose brand, material, type, and colour are each a
     `unique()` string padded to ≥ 128 characters (hex left at default), one
     spool for it, fetch its single label PDF: no run < 8 pt − 0.05; the
     spool-ID run lies entirely inside the panel, entirely left of the QR
     image, and is ≥ 8 pt; at least one text run extends from the text
     column into the QR's x-range (spill-under-QR proven), and every run is
     within the panel rectangle (±0.5 mm); the QR image `order` exceeds the
     label's last text run `order`; the QR image `opaque === true`.
   - New **"page count is ceil(N/21)"** (AC-3; repeated seed id via
     `page.request.get`): N = 20 → 1 page with 20 images; N = 21 → 1 page
     with 21; N = 22 → 2 pages with [21, 1] images; N = 43 → 3 pages with
     [21, 21, 1].
    - New **"label without a valid hex colour has no swatch"** (AC-4 —
      swatch-presence half; other label behaviour unchanged): POST
      `/api/filament-types` with
     `colorHex: "xyz"` (plus a spool via POST `/api/spools`), fetch the
     label: no swatch-sized fill rectangle in the label panel, the colour
     name text is present, and the QR/panel geometry matches the swatch case.
   - Unchanged (must keep passing as-is): the dialog tests (old AC-1, AC-2,
     AC-4, AC-5), old AC-6 (empty copies → 2 labels, 1 page — still true),
     old AC-7 (copies=3 → 3 identical labels), old AC-8 (A, A, B, B order),
     old AC-9 (request order), old AC-10 (invalid copies → 400), old AC-11
     (400/404), old AC-13 (no de-duplication), old AC-15 (no events/state
     changes).

8. No changes to `web/`, `deploy/`, or `doc/spec/*` in this step (spec-text
   updates belong to the `document-change` stage after verification, as in
   003).

## Test Matrix

| Acceptance criterion | Test layer | Test | Expected evidence |
|---|---|---|---|
| AC-1 — 21 labels on one A4 page (print flow), 21 QR images in 7 rows of 3 | Unit + Playwright | Unit: `LabelPdfGeneratorTests` (21 labels → `/Count 1`, 21 `Do` on page 1). Playwright: `labels.spec.ts` "21 labels fit one A4 page in 7 rows of 3" (dialog, copies=7 for 3 spools — D7') | Unit: 1-page PDF, 21 image invocations. Playwright: 1 page, `mediaBox` [595, 842] pt ±2, 21 QR images at the 3×7 grid positions (panel offset (34, 2.5) mm), 3 per row. |
| AC-2 — 5 mm side margins, 10 mm top margin, 1 mm gaps, 66 × 35 mm panels | Unit + Playwright | Unit: `LabelPdfGeneratorTests.Generate_PanelFramesAreSixtySixByThirtyFiveMm`. Playwright: "21 labels…" (grid positions/margins/gaps) and "single label panel…" (panel at (5, 10) mm) | Panel frames 66 × 35 mm (±0.5); panel top-lefts at {5, 72, 139} × {10, 46, …} mm; leftmost 5 mm / rightmost edge 205 mm; adjacent gaps 1 mm (±0.5). |
| AC-3 — page count is ceil(N/21): 22 → [21, 1], 43 → [21, 21, 1], 20 → one page of 20 | Unit + Playwright | Unit: `LabelTilingTests.Paginate` (22 → [21, 1], 43 → [21, 21, 1], 20 → [20], 100 → [21×5, 14]); `LabelPdfGeneratorTests` page counts (22 → 2, 43 → 3, 20/21 → 1) + per-page `Do` counts. Playwright: "page count is ceil(N/21)" (N = 20/21/22/43 via repeated seed id) and re-targeted "16 labels fit on one page with per-spool pairs" | Page counts and per-page label (QR) counts match `ceil(N/21)` in both layers; 16 spool-pairs stay whole on a single page in drawing order. |
| AC-4 — every label shows brand, `material · type`, colour, spool ID and one 30 × 30 mm QR; swatch only with valid hex | Unit + Playwright | Unit: `LabelPdfGeneratorTests.Generate_QrImagesAreThirtyByThirtyMm` (one 30 mm image per label). Playwright: "single label panel…" (all four text fields in page text, one 30 × 30 QR, swatch rect present for the seed type's default hex) and "label without a valid hex colour has no swatch" (no swatch fill, colour text present, layout otherwise unchanged) | All field strings present per label; exactly one 30 × 30 mm (±0.5) image per label; swatch rect (≈2.8 mm, type's hex fill) present iff the hex is valid. |
| AC-5 — brand begins within top 8 mm of panel; spool ID ends within bottom 10 mm; text not confined to the top half | Playwright | `labels.spec.ts` "single label panel…" (also covered on the 21-label page by per-panel run positions) | Brand run `yTop` ≤ panel top + 8 mm; ID run bottom ≥ panel top + 25 mm and ≤ panel bottom; at least one run's extent crosses the panel mid-line. |
| AC-6 — spool ID fully visible for 128+ char fields: inside panel, left of QR, ≥ 8 pt | Unit + Playwright | Unit: `LabelFontFittingTests` (ID at 14 pt always fits; `FitFieldFont` never shrinks a 4-char ID below base) + `LabelPdfGeneratorTests.Generate_Spill_KeepsGlyphsInsidePanel…` (200-char case keeps all glyphs inside the panel). Playwright: "long field values: spool ID fully visible…" (128-char fields) | ID run entirely inside the panel rectangle, entirely left of the QR image's x-range, font size ≥ 8 pt, while the other fields are at the 8 pt floor. |
| AC-7 — no font smaller than 8 pt anywhere, including 200+ char values | Unit + Playwright | Unit: `LabelPdfGeneratorTests.Generate_NoFontSmallerThanEightPt` (200-char fields) + `LabelFontFittingTests` (floor reached, never crossed). Playwright: "single label panel…" and "long field values…" (every decoded run ≥ 8 − 0.05 pt) | Min `Tf`/run size ≥ 8 pt − 0.05 in unit-generated PDFs and in full-stack PDFs with normal and 128+ char field values. |
| AC-8 — spill stays inside the panel; QR (opaque white) painted after the spilled text; no glyph outside its panel | Unit + Playwright | Unit: `LabelFontFittingTests.WrapLines`/`BudgetLines` (lines capped at 62 mm wrap width / panel bottom) + `LabelPdfGeneratorTests.Generate_Spill_KeepsGlyphsInsidePanelAndPaintsQrAfterText` (200-char label: glyph bounds inside panel, `Do` after last `Tj`). Playwright: "single label panel…" (all runs inside panel, QR `opaque`, paint order) and "long field values…" (a run demonstrably extends into the QR's x-range while all runs stay inside the panel; QR painted after the last run) | Spilled glyphs are inside the panel rectangle in both layers; the QR image XObject has no `/SMask` (opaque) and its `Do` occurs after the label's text operations in the content stream. |
| AC-9 — endpoint regression: 400/404 rules, `application/pdf`, `spool-labels.pdf` | Unit + Playwright | Unit: `LabelsControllerTests` (unchanged: `NoIds_400`, `AllIdsUnknown_404`, `InvalidCopies_400`, content-type/download-name assertions; plus new 21/22-id page-count cases). Playwright: unchanged old AC-10/AC-11 tests; "21 labels…" asserts 200 + `application/pdf` + `spool-labels.pdf` on the full-stack flow | 400 for missing ids and each invalid `copies`; 404 for all-unknown ids; valid requests return `application/pdf` named `spool-labels.pdf` with the new tiling. |
| AC-10 — ordering regression: `?id=A&id=B&copies=2` → A, A, B, B, no de-duplication | Unit + Playwright | Unit: `LabelTilingTests.ExpandCopies` (unchanged: [A, B] × 2 → A, A, B, B; [A, A] × 2). Playwright: unchanged old AC-8 test ("copies=2 returns labels in A,A,B,B order") and old AC-13 ("duplicate ids are not de-duplicated") | Expansion order A, A, B, B in unit tests; in-PDF text order `[A, A, B, B]` and 4 non-deduplicated labels in the full stack. |
| AC-11 — dialog flow regression: dialog opens, Print opens the PDF tab with copies=K, Cancel closes without a request | Playwright | `labels.spec.ts` unchanged dialog tests (old AC-1, AC-2, AC-4, AC-5) plus the new "21 labels…" test which exercises the dialog end-to-end (select → copies → Print → PDF) | Dialog shows selection/copies/label count; Print opens the PDF in a new tab with `copies=K`; Cancel causes no request and closes; no popups before Print. |

No test layer is omitted: the changed behaviour is user-visible (PDF produced
by the browser print flow), so Playwright is mandatory per
`doc/spec/operations.md`, and the changed domain logic (pagination, font
fitting, wrapping, line budgeting) is unit-tested directly. The pure internal
detail "which lines are truncated for pathological overflow" is pinned by
unit tests (`BudgetLines`) rather than by an e2e assertion, because its
observable consequence (no glyph outside the panel, QR on top) is asserted
in e2e.

## Test Commands

~~~text
# Backend: build + all unit tests (Core, Infrastructure, Api test projects)
dotnet build
dotnet test

# E2E: typecheck
npm --prefix e2e run typecheck

# E2E: full run (builds images, starts disposable stack, runs the whole
# Playwright suite, tears down)
npm --prefix e2e run e2e

# E2E: re-run only the label tests against an already-running e2e stack
npx --prefix e2e playwright test labels.spec.ts

# Visual review rendering (no vision in this environment — for the user):
# generate a 21-label PDF from the running stack or from a scratch
# generator invocation, then render for manual inspection, e.g.:
#   pdftoppm -png -r 150 out.pdf /tmp/opencode/labels
~~~

## Out Of Scope

- Endpoint semantics: required `id`, `copies` parsing and 1–10 range,
  `400`/`404` responses, `application/pdf`, download name `spool-labels.pdf`
  (regression-tested only, unchanged — `LabelsController.cs` is untouched).
- Label-to-spool mapping/ordering, copies expansion, unknown-id skipping,
  QR payload (absolute spool URL from request scheme/host), and the field
  set (brand, `material · type`, colour, valid-hex swatch, spool ID, QR).
- The `/spools` print dialog and all SPA behaviour (`web/` unchanged).
- Paper format beyond A4 portrait; top/bottom margins remain 10 mm; no
  edge-to-edge printing in the paper-feed direction.
- Any new user setting, UI control, or layout configuration.
- Any new external library (explicitly no SkiaSharp — the deprecated
  QuestPDF Canvas/SkiaSharp integration is unavailable and unnecessary).
- `doc/spec/*` text updates (the "Printable labels" section of
  `doc/spec/interfaces.md` still describes the old 14-per-page tiling; it is
  updated in the `document-change` stage after verification, as in 003).

## Risks And Rollback Notes

- **Risk: e2e fixture and unit geometry assertions couple to QuestPDF's
  exact content-stream format.** Mitigated: the format (page CTM, region
  `cm` pattern, `re f` border edges, `Tm`/`Td`/`Tf` text, `cm` + `Do`
  images, ToUnicode CMaps) was verified against PDFs generated with the
  pinned QuestPDF 2024.12.0 during planning (scratch probes in
  `/tmp/opencode`). A QuestPDF upgrade would break the fixture/assertions
  locally, not the application; the spec's tolerances (±0.5 mm, ±0.05 pt)
  absorb stream-level variation.
- **Risk: the 0.7 em character-width estimate diverges from actual Lato
  advances, so a "fitting" line could be wider than estimated.** Mitigated:
  0.7 em overestimates the Lato average (~0.5 em), so fit-mode lines stay
  near or inside the 32 mm column even at the estimate's bound; a line
  wider than 32 mm simply continues under the QR (painted later, opaque)
  and — bounded by the 62 mm wrap width — never leaves the panel. The AC-8
  e2e assertions (runs inside panel, QR last) fail loudly if this ever
  breaks.
- **Risk: no per-element clipping exists in QuestPDF (verified), so an
  unbounded text could be drawn outside the panel.** Mitigated: text is
  emitted as explicitly wrapped lines with a hard cap (62 mm wrap width,
  panel-bottom line budget) computed by pure functions that are unit-tested;
  the 200-char case is asserted in both unit (glyph bounds) and e2e (run
  bounds) layers.
- **Risk: e2e suite duration grows** (3 extra UI-created spools for the
  21-label dialog test, one long-value type for the spill test). Accepted:
  the suite already creates multiple spools per test, `unique()` seeding
  keeps runs isolated, and the e2e job is non-blocking in CI
  (`doc/spec/operations.md`).
- **Risk: vision-based review of the generated page is unavailable in this
  environment** (image input unsupported by the current model — verified).
  Mitigation: the numerical geometry assertions are the verification
  backbone; the implementation renders PDFs to PNG (`pdftoppm`, available)
  for a user visual check, with the baseline already rendered at
  `/tmp/opencode/baseline-1.png`; the refinement's numerical baseline
  evaluation was independently re-verified by planning probes.
- **Rollback:** the application change is confined to
  `src/Filament.Api/Pdf/LabelPdfGenerator.cs` (plus its tests); the API
  contract, SPA, database, and QR behaviour are untouched, so reverting the
  PR restores the old 14-per-page PDF with no migration or data concern,
  and old and new frontends work against either backend.
