# Amendment — 004 Improve the PDF layout

Date: 2026-08-17
Status: answered

## Questions asked and answers received

| # | Question | User answer |
|---|---|---|
| Q1 | New tiling: 3 labels per row — which grid and margins? | **7 rows, 21 per page**: 5 mm left/right margins, 10 mm top/bottom, 1 mm gaps between labels, 66 × 35 mm labels, A4 portrait, rows never split across pages. (The 70 mm label width cannot be kept: 5 + 70 + 1 + 70 + 1 + 70 + 5 = 212 mm > 210 mm. The user's option implicitly accepted the 66 mm width.) |
| Q2 | QR code size on the 66 mm-wide label (was 28 mm)? | **Enlarge to 30 × 30 mm.** |
| Q3 | With long text, which label content must stay fully visible? | **Spool ID always visible.** Brand, material.type, and colour may wrap, shrink, or spill under the QR code's white background; the spool ID is never covered. |
| Q4 | Label layout to "use the space better"? | **Distribute rows vertically**: same fields (brand top, material.type middle, colour + swatch below it, spool ID bottom), rows spread to fill the full 35 mm label height; existing font-shrinking kept, then spill under the QR. |
| Q5 | Minimum font size before text may spill under the QR (code floor today is 2 pt)? | **8 pt**, then spill under the QR instead of shrinking further. |

## Assumptions accepted

- A4 portrait remains the page size.
- The 1 mm inter-label gap applies horizontally **and** vertically.
- Top/bottom margins stay 10 mm (no edge-to-edge printing in the paper-feed direction; only the left/right sides move from 10 mm to 5 mm).
- QR placement stays on the right side of the label, vertically centred.
- The label panel keeps its thin border (0.5 pt) as a cut guide.
- Label content fields are unchanged: brand, `material · type`, colour (+ swatch only when the hex is a valid 6/8-digit hex), spool ID, and the QR code whose payload is the absolute spool page URL.
- Spool IDs are always 4 characters (generated identifier), so the ID never needs to shrink.
- Row filling is row-major, left to right, with spool copies kept adjacent (existing A, A, B, B behaviour); a page holds whole rows only.
- Page count becomes `ceil(label count / 21)` (was `/14`).
- "Spill under the QR" means the spilled glyphs are drawn beneath the QR's opaque white rendering and are hidden on the printed page; they remain in the PDF text layer but are not visible.
- No new external library is required (QuestPDF 2024.12.0 + QRCoder 1.6.0 already in use satisfy the layout and the opaque QR rendering).

## Open decisions

None.

## References consulted

- `doc/todo/004-improve-pdf-layout/README.md` — original request (unmodified).
- `doc/spec/interfaces.md` — "Printable labels" section (current tiling, copies, QR payload behaviour).
- `doc/spec/operations.md` — testing policy (unit + Playwright e2e layers; criteria must be browser-verifiable).
- `doc/spec/application-overview.md` — product context.
- `doc/todo/003-multiple-copies-of-labels/` — completed copies feature (A, A, B, B ordering, dialog flow).
- `src/Filament.Api/Pdf/LabelPdfGenerator.cs` — current generator (70 × 35 mm labels, 2/row, 10 mm margins, 14/page, FitFontSize floor 2 pt, 28 mm QR, QuestPDF layout).
- `src/Filament.Api/Controllers/LabelsController.cs` — endpoint semantics to preserve.
- `src/Filament.Core/Identifiers/IdentifierGenerator.cs` — spool ID = 4 chars.
- `tests/Filament.Api.Tests/LabelPdfGeneratorTests.cs`, `LabelTilingTests.cs`, `LabelsControllerTests.cs` — unit tests asserting the old tiling (to be updated in implementation).
- `e2e/tests/labels.spec.ts`, `e2e/tests/fixtures/pdf.ts` — e2e tests and PDF inspection fixture (text decode, per-label QR count; geometry extraction would be added in implementation).
- `e2e/tests/fixtures/seed.ts` — seed data for e2e.

## Evaluation method

The request asks for a visual evaluation of the current PDF. This environment's model cannot render images, so a PDF page generated from the current code was inspected numerically by extracting element coordinates from the content stream (1 unit = 0.25 pt in QuestPDF's output):

- All label text currently occupies only the top ~19 mm of the 35 mm-tall label; nothing is drawn below ~y = 28 mm inside the panel (confirms "squeezed in the top left corner").
- With long fields the current fitter shrinks the spool ID to ~5 pt (unacceptably small; motivates the 8 pt floor + spill rule).
- The QR image is an opaque `DeviceGray` image placed after the text in content-stream order (paints on top), 28 mm square with a white quiet zone, so text spilled under it would already be hidden — the spill rule is achievable with the existing stack.

A rendered page from the current code was saved for the user at `/tmp/opencode/label-1.png` (100 dpi) in case a human visual review is wanted.
