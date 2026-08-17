# Implementation Plan: Multiple copies of labels

## Approval

Status: accept
Approved by: obrys
Approved on: August 17, 2026

## Summary

Add a copies step to label printing. On `/spools`, "Print labels (N)" opens an
in-page dialog (selected-spool count, copies field 1–10 with the last used
value remembered in browser storage, resulting label count, Print / Cancel)
instead of directly opening a new tab. `GET /api/labels` gains an explicit
`copies` query parameter: K labels per resolved spool id occurrence, grouped
per spool, tiled across `ceil(total / 14)` A4 pages (two 70×35 mm labels per
row, 10 mm margins, rows never split across pages). Missing/empty `copies`
means 1 (today's output); `copies` < 1, > 10, or not a whole number returns
400. Label design, QR payload, download name, and all existing `id` handling
are unchanged.

## Preconditions And Decisions

- `doc/todo/003-multiple-copies-of-labels/specification.md` is
  `Status: approved` (obrys, August 17, 2026). All product decisions are
  recorded in `doc/todo/003-multiple-copies-of-labels/amendment.md`.
- The specification's single Open Question (whether the API rejects
  `copies > 10`) is answered **as written in the approved specification**:
  the API rejects `copies > 10` with HTTP 400 (AC-10 lists `11` → 400).
  Both the UI field (min/max) and the API enforce the 1–10 range. If the
  approver disagrees on review of this plan, only step 3 (validation) and the
  related tests change.
- This change is user-visible (SPA dialog + API endpoint the SPA consumes +
  PDF output), so per `doc/spec/operations.md` **both** test layers are
  required: xUnit unit tests and Playwright e2e tests. No layer is omitted;
  every acceptance criterion links to at least one test, and every
  user-visible criterion (AC-1…AC-7) additionally links to a Playwright test.
- Decision (implementation, not product): **add a new
  `tests/Filament.Api.Tests` project** (xUnit, same package set and csproj
  shape as `tests/Filament.Core.Tests`) registered in `Filament.slnx`.
  Rationale: the changed controller and PDF logic live in `Filament.Api`;
  the spec's test constraint requires unit tests of label count, grouping
  order, page count, and controller `copies` validation. The existing test
  projects (`Filament.Core.Tests`, `Filament.Infrastructure.Tests`) do not
  reference `Filament.Api`. No new NuGet packages are introduced — only the
  xUnit/MSTest-sdk packages already used by the other test projects.
- Decision (implementation, not product): **extract the copies/grouping and
  paginating rules as pure static functions on `LabelPdfGenerator`**
  (`ExpandCopies`, `Paginate`) so they are unit-testable without rendering a
  PDF; `Generate` then renders one QuestPDF page per paged chunk. The
  controller parses `copies` via a small `public static TryParseCopies`
  helper (unit-tested directly). This mirrors the `SpoolSort.Parse` pattern
  from the 001-sorting change.
- Decision (implementation, not product): **the e2e suite verifies PDF
  content with a small self-contained parser** (`e2e/tests/fixtures/pdf.ts`)
  using only Node built-ins (`zlib`) — no new e2e dependency. The approach
  was validated against real QuestPDF 2024.12.0 output generated from this
  codebase before planning:
  - page count: the page tree is plain (uncompressed) —
    `/Type /Pages … /Count N … /Kids [a 0 R b 0 R]` is a regex on the raw
    bytes, and `/Kids` gives the page order;
  - labels per page: each label's QR is an image XObject reference
    (`/X6 Do`, …) in the page's content stream; one reference per label even
    when labels are identical (verified: 4 identical labels → 4 references);
  - per-page label text: content streams are `FlateDecode` without a PNG
    predictor (inflate with `zlib.inflateSync`), text is written as
    `<hex> Tj` in `BT…ET` blocks with `/Fn Tf` selections; each subset font
    (Lato) carries a standard `/ToUnicode` CMap (`beginbfchar` /
    `beginbfrange`) mapping glyph ids to Unicode, which the helper parses.
  - multi-page rendering: repeated `container.Page(...)` calls in
    `Document.Create` produce one PDF page each (verified: `/Count 2` for a
    16-label document).
- Decision: the SPA stores the last used copy count under the
  `localStorage` key `filament.labelCopies` (the same try/catch-guarded
  `localStorage` pattern `web/src/version.ts` uses for `sessionStorage` —
  the spec says "browser storage" and per-profile localStorage satisfies
  "persists across page reloads").
- Backward compatibility: `copies` is an optional query parameter, so
  existing `GET /api/labels?id=…` URLs keep working exactly as before; an
  old SPA simply lacks the dialog on a new backend, and a new SPA against an
  old backend degrades only by sending a `copies` parameter the old backend
  ignores — both directions safe to roll back independently.

## Implementation Steps

1. `tests/Filament.Api.Tests/Filament.Api.Tests.csproj` (new) +
   `Filament.slnx` (add one line under `/tests/`): copy the package set and
   shape of `tests/Filament.Core.Tests/Filament.Core.Tests.csproj`
   (`net10.0`, xunit 2.9.3, xunit.runner.visualstudio 3.1.4,
   Microsoft.NET.Test.Sdk 17.14.1, coverlet.collector 6.0.4,
   `<Using Include="Xunit" />`), with a `ProjectReference` to
   `..\..\src\Filament.Api\Filament.Api.csproj` (the `Microsoft.NET.Sdk.Web`
   project flows its `Microsoft.AspNetCore.App` framework reference to the
   test project). The project will contain the fakes and tests of steps 9–12.

2. `src/Filament.Api/Pdf/LabelPdfGenerator.cs`:
   - Add `public static List<LabelData> ExpandCopies(IReadOnlyList<LabelData> labels, int copies)`:
     for each label in input order, append `copies` contiguously
     (`?id=A&id=B&copies=2` → A, A, B, B; duplicate occurrences each expand).
   - Add `public static IEnumerable<IEnumerable<LabelData>> Paginate(IReadOnlyList<LabelData> labels, int labelsPerPage = 14) => labels.Chunk(labelsPerPage);`
     (A4 holds at most 7 rows × 2 = 14 labels).
   - Change `Generate` from a single `container.Page(...)` to
     ```csharp
     var doc = Document.Create(container =>
     {
         foreach (var pageLabels in Paginate(labels))
         {
             container.Page(page => { /* existing A4 size, 10 mm margin, default text style, and the per-page Column/Row tiling body, unchanged, iterating pageLabels.Chunk(2) */ });
         }
     });
     ```
     `RenderLabel`, `GenerateQr`, and `TryParseColor` are untouched. This
     also fixes the current implicit single-call overflow: pages now have an
     exact `ceil(n/14)` count and no row is ever split across pages.

3. `src/Filament.Api/Controllers/LabelsController.cs`:
   - Action signature: add `[FromQuery] string? copies` between the `ids`
     parameter and `CancellationToken ct`. Update the XML doc summary to
     document the parameter (whole number 1–10, default 1 when missing) —
     the OpenAPI document is generated by `AddOpenApi()`/`MapOpenApi()`
     (`Program.cs`), so the new parameter is exposed at
     `/openapi/v1.json` with no hand-maintained file to edit.
   - Validation at the top of the action, after the existing no-`id` 400:
     ```csharp
     int copyCount = 1;
     if (!string.IsNullOrWhiteSpace(copies) && !TryParseCopies(copies, out copyCount))
         return BadRequest(new { error = "copies must be a whole number between 1 and 10." });
     ```
     Missing/empty `copies` therefore means 1, exactly like today.
   - Add the helper:
     ```csharp
     public static bool TryParseCopies(string raw, out int copies)
     {
         return int.TryParse(raw.Trim(), System.Globalization.NumberStyles.Integer, null, out copies)
             && copies >= 1 && copies <= 10;
     }
     ```
     (`"1.5"`, `"abc"`, `"0"`, `-2`, `"11"` all → false; `" 3 "` → true, 3.)
   - After the existing id-resolution loop (`labels` holds the resolved
     occurrences in request order, unknowns skipped), replace
     `var bytes = _pdf.Generate(labels);` with
     ```csharp
     var bytes = _pdf.Generate(LabelPdfGenerator.ExpandCopies(labels, copyCount));
     ```
     The 404-when-none-resolve check stays in its current place, so it
     applies regardless of `copies`.

4. `web/src/api/client.ts`: change
   `labelPdfUrl: (ids: string[]) => …` to
   ```ts
   labelPdfUrl: (ids: string[], copies?: number) => {
     const p = new URLSearchParams()
     for (const id of ids) p.append('id', id)
     if (copies !== undefined) p.append('copies', String(copies))
     return `/api/labels?${p.toString()}`
   }
   ```
   With no `copies` argument the URL is byte-identical to today's output.

5. `web/src/pages/Spools.tsx`:
   - Replace the Print button's `onClick={() => window.open(api.spools.labelPdfUrl([...selected]), '_blank')}`
     with `onClick={openPrintDialog}`; keep the label `Print labels ({selected.size})`
     and the `disabled={selected.size === 0}` state.
   - New state: `const [printDialogOpen, setPrintDialogOpen] = useState(false)`
     and `const [copiesValue, setCopiesValue] = useState('')` (string, so an
     emptied field is representable).
   - `const LAST_COPIES_KEY = 'filament.labelCopies'` and
     ```ts
     const readLastCopies = () => {
       try {
         const raw = localStorage.getItem(LAST_COPIES_KEY)
         const n = raw === null ? NaN : Number.parseInt(raw, 10)
         return Number.isInteger(n) && n >= 1 && n <= 10 ? n : 1
       } catch { return 1 }
     }
     ```
     `openPrintDialog` sets `setCopiesValue(String(readLastCopies()))` and
     opens the dialog (so the dialog only opens with N ≥ 1, per spec).
   - In the component body:
     `const effectiveCopies = Number.isInteger(Number(copiesValue)) && Number(copiesValue) >= 1 && Number(copiesValue) <= 10 ? Number(copiesValue) : 1`
     (empty, out-of-range, or non-whole field value → 1, per spec).
   - Dialog JSX (rendered when `printDialogOpen`), following the existing
     overlay convention of `web/src/realtime/VersionGate.tsx`
     (`role`-marked overlay above the page content): an overlay `div`
     containing a `.card` with `role="dialog" aria-label="Print labels"`,
     showing: the selected spool count (`{selected.size}`), a copies field
     `<input type="number" min={1} max={10} aria-label="Copies" value={copiesValue} onChange={e => setCopiesValue(e.target.value)} />`,
     the resulting label count (`{selected.size * effectiveCopies}` labels —
     updated on every keystroke via `effectiveCopies`), and Print / Cancel
     buttons. Print handler: store the value
     (`try { localStorage.setItem(LAST_COPIES_KEY, String(effectiveCopies)) } catch {}`),
     then `window.open(api.spools.labelPdfUrl([...selected], effectiveCopies), '_blank')`
     (existing `id` values in existing request order — `Set` iteration order
     — plus `copies=<effective>`), then close the dialog. Cancel handler:
     close the dialog only (no request, no storage write, selection state
     untouched). No other close affordances.

6. `e2e/tests/fixtures/pdf.ts` (new): PDF inspection helper used by
   `labels.spec.ts` (Node built-ins only — `fs`/`zlib`; see validation notes
   under Preconditions):
   - `pdfPages(bytes: Buffer): { text: string; labelCount: number }[]`
     — scans `N 0 obj` blocks on the latin-1 view; inflates every stream via
     `zlib.inflateSync` (FlateDecode, no predictor — verified); finds the
     root `/Type /Pages` object and walks `/Kids` in order; for each `/Type
     /Page` object reads `/Contents N 0 R` (single ref; tolerate an array)
     and `/Resources /Font` name→object mapping;
     `labelCount` = number of `/\w+ Do` XObject invocations in the page
     content stream (one per label's QR image reference — verified,
     including for identical labels);
     `text` = concatenation, in stream order, of all decoded text in the
     page's `BT…ET` blocks: track the current font from `/Fn Tf`, decode
     each `<hex> Tj` as 2-byte glyph ids through that font's `/ToUnicode`
     CMap (parsed from `beginbfchar` pairs and `beginbfrange` triples);
     unknown glyphs decode to empty string (text missing for a glyph can
     never hide a spool id, which is always in the subset because it is
     printed).
   - `pdfPageCount(bytes: Buffer): number` = `pdfPages(bytes).length`.

7. `e2e/tests/labels.spec.ts` (new): Playwright e2e tests for
   `e2e/tests/fixtures/seed.ts` (its `seed` fixture creates one type + one
   spool; spool ids are 4-char codes) plus the local helper
   `createSpoolViaUi(page, typeId)` (a near-copy of the one in
   `e2e/tests/sorting.spec.ts:7`, kept local so existing specs are not
   touched) — all tests use `unique()`-seeded data, so parallel runs do not
   collide. PDF responses are captured with a `page.waitForResponse` on the
   shared `BrowserContext` (captures the popup tab's response too) and
   analyzed with `pdfPages`/`pdfPageCount` against the response body.
   Tests (see Test Matrix for the AC mapping):
   - "Print button opens the copies dialog without opening a tab" — select 2
     seeded spools via row checkboxes; click "Print labels (2)"; assert the
     `role=dialog` appears showing the spool count 2 and initial label count
     2 (copies field `1`); assert `context.pages().length` is unchanged (no
     new tab) and that no request matching `/api/labels` was recorded
     (`context.on('request')` listener).
   - "copies field has min/max, defaults to 1, and label count updates" —
     fresh context has no stored value: assert input `min="1"`, `max="10"`,
     value `"1"` and shown count `2×1`; type `4`; assert shown count updates
     to `8`.
   - "Print opens a new tab with copies=K and loads the label PDF" — with 2
     spools selected (ids A, B in click order), enter `3`, click Print;
     capture the popup via `page.waitForEvent('popup')` and the context
     response; assert response status 200, `content-type: application/pdf`,
     `content-disposition` filename `spool-labels.pdf`; popup URL equals
     `…/api/labels?id=A&id=B&copies=3` (same ids, same order, plus
     `copies=3`); `pdfPageCount` → 2 pages are NOT expected: 6 labels → 1
     page with `labelCount` 6 and the page text containing A×3 and B×3.
   - "last used copy count survives a page reload" — print with `4` (2
     spools); `page.reload()`; reselect one spool; open the dialog; assert
     the copies field value is `4`.
   - "Cancel closes the dialog without a request" — select spool A, open
     dialog, click Cancel; assert dialog gone, `context.pages().length`
     unchanged, no `/api/labels` request recorded, and the A checkbox still
     checked.
   - "Print with an empty copies field sends copies=1" — select spool A,
     open dialog, clear the field (`fill('')`), click Print; assert the
     captured `/api/labels` request URL contains `copies=1` (and not just
     the ids).
   - "copies=3 returns three identical labels for one spool" (AC-7) —
     `page.request.get(/api/labels?id=<A>&copies=3)`; 200 + `application/pdf`;
     1 page, `labelCount` 3; page text contains spool A's id exactly 3 times
     and the seeded brand exactly 3 times (identical per-label content).
   - "copies=2 returns labels in A,A,B,B order" (AC-8) — request
     `id=<A>&id=<B>&copies=2`; 4 labels on one page; the order of id
     occurrences in the page text is `[A, A, B, B]`.
   - "no copies parameter returns one label per spool in request order"
     (AC-9) — request `id=<A>&id=<B>`; 2 labels, one page, id occurrences
     `[A, B]`.
   - "invalid copies values return 400 with no PDF" (AC-10) — for each `v`
     in `0`, `-2`, `1.5`, `abc`, `11`: `page.request.get` with
     `&copies=<v>` → status 400 and `content-type` is not `application/pdf`.
   - "no ids returns 400 and all-unknown ids return 404" (AC-11) —
     `page.request.get('/api/labels')` → 400;
     `page.request.get('/api/labels?id=NOPE&copies=2')` → 404.
   - "16 labels produce a 2-page PDF (14 + 2) with per-spool pairs" (AC-12)
     — create 8 spools for the seeded type (8× `createSpoolViaUi`); request
     with all 8 ids in creation order and `copies=2`; `pdfPageCount` → 2;
     `labelCount` per page `[14, 2]`; page-1 text contains ids 1–7 each
     exactly twice (in order) and not id 8; page-2 text contains id 8
     exactly twice.
   - "duplicate ids are not de-duplicated" (AC-13) — request
     `id=<A>&id=<A>&copies=2`; 4 labels, one page; A's id exactly 4 times.
   - "copies=10 returns 2 pages (14 + 6) with unchanged label content"
     (AC-14) — request `id=<A>&id=<B>&copies=10`; 2 pages with `labelCount`
     `[14, 6]`; every label's text block in the page text contains the
     seeded brand, material, type, color, and one of the spool ids (per-label
     content preserved; swatch absent because the seeded type has no hex —
     the design code path is unchanged and covered by the unit tests).
   - "downloading labels records no spool events and leaves counts
     unchanged" (AC-15) — for a freshly created spool, capture
     `GET /api/spools/{id}/events` (only the `Created` event),
     `GET /api/dashboard/summary`, and `GET /api/spools` before a
     `page.request.get('/api/labels?id=…&copies=2')` download; download;
     re-fetch all three and assert they are unchanged.

8. No changes to `doc/spec/*` are made here — this plan implements the
   approved specification. (Spec updates belong to the `document-change`
   stage after verification.)

9. `tests/Filament.Api.Tests/CopiesParsingTests.cs` (new):
   `LabelsController.TryParseCopies` cases — `"1"`…"`10"` → true with the
   right value; `"0"`, `"-2"`, `"1.5"`, `"abc"`, `"11"` → false; `" 3 "` →
   true with 3 (AC-10 values + valid range).

10. `tests/Filament.Api.Tests/LabelTilingTests.cs` (new):
    - `ExpandCopies`: `[A]×3` → 3×A; `[A,B]×2` → A,A,B,B; `[A,A]×2` → 4×A;
      ×1 is identical to the input list (AC-7, AC-8, AC-13, AC-9).
    - `Paginate`: 1→[1]; 13→[13]; 14→[14]; 15→[14,1]; 16→[14,2]; 20→[14,6];
      28→[14,14]; 100→8 pages of sizes 14×7+2; empty→no pages (AC-12, AC-14,
      page-count rule `ceil(n/14)`).

11. `tests/Filament.Api.Tests/LabelPdfGeneratorTests.cs` (new): generate
    real PDFs with `new LabelPdfGenerator()` for n ∈ {1, 14, 15, 16, 20, 28}
    (labels with distinct ids/URLs) and assert the raw bytes contain exactly
    the page-tree count `/Count <ceil(n/14)>` (regex `/Count\s+(\d+)`, first
    match — verified format) and that `/Type /Page` objects number
    `ceil(n/14)` (AC-12, AC-14).

12. `tests/Filament.Api.Tests/LabelsControllerTests.cs` (new) + fakes
    `tests/Filament.Api.Tests/Fakes.cs` (new): dictionary-backed fake
    `ISpoolRepository`/`IFilamentTypeRepository` (only `GetAsync` meaning-
    ful; other members `throw new NotSupportedException()`), constructing
    minimal `Spool`/`FilamentType` instances. Each test builds
    `new LabelsController(fakeSpools, fakeTypes, new LabelPdfGenerator())`
    with `ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { Request = { Scheme = "http", Host = new HostString("lan.example") } } }`:
    - no ids → `BadRequestObjectResult` (AC-11).
    - all ids unknown (with `copies=2`) → `NotFoundResult` (AC-11).
    - each invalid `copies` (`0`, `-2`, `1.5`, `abc`, `11`) with a valid id
      → `BadRequestObjectResult` (400, not a PDF) (AC-10).
    - missing `copies` with two valid ids → `FileContentResult`,
      `application/pdf`, file name `spool-labels.pdf`, single page
      (`/Count 1`) (AC-9).
    - `copies=3` with one id → `FileContentResult` 200, `spool-labels.pdf`
      (AC-7, controller surface; the 3-label grouping is proven by
      `LabelTilingTests` and the e2e per-page text).

13. `web` has no test framework of its own — SPA behavior is covered by the
    Playwright e2e tests (steps 7) per the project testing policy;
    `npm --prefix web run build` (`tsc -b && vite build`) provides the
    typecheck/build gate.

## Test Matrix

| Acceptance criterion | Test layer | Test | Expected evidence |
|---|---|---|---|
| AC-1 (button opens in-page dialog with counts; no tab, no `/api/labels` request until Print) | Playwright | `labels.spec.ts: "Print button opens the copies dialog without opening a tab"` | Dialog with spool count and initial label count appears; `context.pages().length` unchanged; request listener recorded zero `/api/labels` requests. |
| AC-2 (field min 1 max 10; starts at 1 without stored value; resulting count updates) | Playwright | `labels.spec.ts: "copies field has min/max, defaults to 1, and label count updates"` | Input has `min="1"`, `max="10"`, value `"1"`, shown count 2; after typing 4 the shown count is 8. |
| AC-3 (Print opens new tab: same ids in same order + `copies=K`; PDF 200, `application/pdf`, `spool-labels.pdf`) | Playwright | `labels.spec.ts: "Print opens a new tab with copies=K and loads the label PDF"` | Popup URL `…/api/labels?id=A&id=B&copies=3`; response 200, `application/pdf`, disposition filename `spool-labels.pdf`; PDF has 6 labels (3+3) on one page. |
| AC-4 (reload → dialog reopens with last used K) | Playwright | `labels.spec.ts: "last used copy count survives a page reload"` | After printing with 4, reloading `/spools` and reopening the dialog shows the field value `4`. |
| AC-5 (Cancel: closes dialog, no tab, no request, selection unchanged) | Playwright | `labels.spec.ts: "Cancel closes the dialog without a request"` | Dialog removed; pages unchanged; zero `/api/labels` requests; checkbox still checked. |
| AC-6 (empty/out-of-range field at Print → request uses `copies=1`) | Playwright | `labels.spec.ts: "Print with an empty copies field sends copies=1"` | Captured request URL contains `copies=1`. |
| AC-7 (`id=A&copies=3` → 200 PDF, exactly 3 identical labels for A) | Unit + Playwright | `LabelsControllerTests.ValidCopies…_ReturnsPdf` (200/FileResult/surface) ; `LabelTilingTests.ExpandCopies` ([A]×3); `labels.spec.ts: "copies=3 returns three identical labels for one spool"` | Unit: 200 `FileContentResult` `application/pdf` `spool-labels.pdf`; expansion of one spool ×3 is three A labels. Playwright: 1 page, `labelCount` 3, page text contains A's id 3× and the seeded brand 3×. |
| AC-8 (`id=A&id=B&copies=2` → exactly 4 labels in order A,A,B,B) | Unit + Playwright | `LabelTilingTests.ExpandCopies` ([A,B]×2 → A,A,B,B); `labels.spec.ts: "copies=2 returns labels in A,A,B,B order"` | Unit: expansion order A,A,B,B. Playwright: 4 labels, id-occurrence order in page text `[A, A, B, B]`. |
| AC-9 (no `copies` → today's output: one label per spool, request order) | Unit + Playwright | `LabelsControllerTests.MissingCopies_DefaultsToOne_SinglePagePdf`; `LabelTilingTests.ExpandCopies` (×1 identity); `labels.spec.ts: "no copies parameter returns one label per spool in request order"` | Unit: 200, single page, one label per id. Playwright: 2 labels, ids `[A, B]` in order (layout/content code path unchanged — see AC-14 row). |
| AC-10 (`copies` ∈ `0`, `-2`, `1.5`, `abc`, `11` → 400, no PDF) | Unit + Playwright | `CopiesParsingTests` (each value → false); `LabelsControllerTests.InvalidCopies…_Return400` (each value → `BadRequestObjectResult`); `labels.spec.ts: "invalid copies values return 400 with no PDF"` | Each of the five values yields HTTP 400 with a non-PDF body in both the unit (controller result) and the full-stack (response) evidence. |
| AC-11 (no ids → 400; all ids unknown → 404) | Unit + Playwright | `LabelsControllerTests.NoIds_400`, `AllIdsUnknown_404`; `labels.spec.ts: "no ids returns 400 and all-unknown ids return 404"` | Controller returns `BadRequestObjectResult` / `NotFoundResult`; full stack returns 400 for no `id` and 404 for `?id=NOPE&copies=2`. |
| AC-12 (16 labels → 2 pages: 14 then 2; spool-pair grouping per page; same tiling; no split rows) | Unit + Playwright | `LabelTilingTests.Paginate` (16 → [14,2]); `LabelPdfGeneratorTests` (16 labels → `/Count 2`, two `/Type /Page`); `labels.spec.ts: "16 labels produce a 2-page PDF (14 + 2) with per-spool pairs"` | Unit: page partition sizes [14,2] and real 2-page PDF. Playwright: `pdfPageCount` 2; `labelCount` [14, 2]; page-1 text has spools 1–7 twice each in order and not spool 8; page-2 text has spool 8 twice — proving the 8th spool's pair is whole on page 2 (row not split) with the same tiling. |
| AC-13 (`id=A&id=A&copies=2` → 4 labels, all A) | Unit + Playwright | `LabelTilingTests.ExpandCopies` ([A,A]×2 → 4×A); `labels.spec.ts: "duplicate ids are not de-duplicated"` | Unit: four A labels. Playwright: 4 labels, one page, A's id exactly 4× in page text. |
| AC-14 (`copies=10` for 2 spools → 2 pages 14+6; pre-change design retained) | Unit + Playwright | `LabelTilingTests.Paginate` (20 → [14,6]); `LabelPdfGeneratorTests` (20 labels → `/Count 2`); `labels.spec.ts: "copies=10 returns 2 pages (14 + 6) with unchanged label content"` | Unit: partition [14,6] and 2-page PDF; `RenderLabel`/QR/swatch code untouched (diff-scoped). Playwright: `labelCount` [14, 6]; each label's text shows brand, material, type, color and its spool id. |
| AC-15 (printing with copies records no spool events; list/detail/dashboard unchanged) | Playwright | `labels.spec.ts: "downloading labels records no spool events and leaves counts unchanged"` | Events list before == after (only `Created`); dashboard summary before == after; spool list before == after a `copies=2` download. |

## Test Commands

~~~text
# Backend: build + all unit tests (Core, Infrastructure, and the new Api tests)
dotnet build
dotnet test

# Frontend: typecheck + production build
npm --prefix web run build

# E2E: typecheck
npm --prefix e2e run typecheck

# E2E: full run (builds images, starts disposable stack, runs Playwright, tears down)
npm --prefix e2e run e2e

# E2E: re-run only the label tests against an already-running e2e stack
npx --prefix e2e playwright test labels.spec.ts

# Optional sanity check of the new OpenAPI documentation (dev API only)
curl -fsS http://localhost:18080/openapi/v1.json | grep -A 3 '"copies"'
~~~

## Out Of Scope

- Label design, per-label content, QR payload, and the `spool-labels.pdf`
  download name (explicitly excluded by the request).
- Per-spool copy counts (one copy count applies to all selected spools).
- Editing or reordering the selected spool list from the dialog.
- Any spool-event or inventory state change caused by label printing.
- Authentication/authorization changes and any API change beyond the
  `copies` parameter.
- Cross-browser/cross-device (server-side) persistence of the last used copy
  count.
- A `WebApplicationFactory`-based API integration test layer (the project
  has none; controller behavior is unit-tested with fakes and verified
  full-stack by the Playwright suite).
- Refactoring existing e2e specs (the spool-creation helper is duplicated
  locally in `labels.spec.ts` rather than extracted to a shared fixture).
- `doc/spec/*` updates (handled in the documentation stage after
  verification).

## Risks And Rollback Notes

- **Risk: PDF parsing in the e2e helper is coupled to QuestPDF's output
  format.** Mitigated ahead of time: the exact mechanisms (plain
  `/Count`/`/Kids` page tree, `FlateDecode` without predictor,
  `beginbfchar`/`beginbfrange` ToUnicode CMaps for the Lato subsets, one
  image `Do` reference per label including for identical labels) were
  verified against PDFs generated by the current `LabelPdfGenerator` before
  this plan was written. The parser is isolated in `e2e/tests/fixtures/pdf.ts`;
  a QuestPDF upgrade that changes the format only breaks that file and the
  affected assertions, not the application.
- **Risk: `Do`-reference counting assumes QuestPDF emits only image
  XObjects and one reference per label.** Verified with the current version
  (16 distinct labels → 16 references across 2 pages; 4 identical labels →
  4 references). If a future QuestPDF version introduces form XObjects, the
  helper must filter references to image-named resources; the unit tests of
  `Paginate`/page counts do not depend on this.
- **Risk: spool-id substring collisions in page-text assertions.** Mitigated
  by the seed fixture's `unique()` lowercase brand/material/type/color
  names (4-char spool ids are uppercase+digits and cannot appear as
  substrings) and by asserting occurrence counts rather than containment.
- **Risk: AC-12 e2e test creates 8 spools through the UI (slower).**
  Accepted: the sorting specs already create multiple spools per test, the
  e2e runner is non-blocking in CI, and `unique()` seeding keeps runs
  isolated. The same property is covered at unit level (`Paginate`,
  generator page count) without the UI.
- **Risk: `copies=11` rejection is an extension beyond the original request
  text (the request only fixes the UI field).** Resolved by the approved
  specification (AC-10 includes `11` → 400); recorded above under
  Preconditions so a reviewer can see the provenance.
- **Rollback:** the change is additive on all surfaces — an optional query
  parameter on the API, a new test project, an optional dialog on the SPA,
  and a storage key in `localStorage`. Reverting the PR restores the prior
  single-page `Generate` loop and the direct `window.open`; no database
  migration exists, so there is no data to migrate forward or back. Old and
  new frontends/backends interoperate (unknown query parameters are ignored;
  the `copies` parameter is optional), so web and API can be rolled back
  independently.
