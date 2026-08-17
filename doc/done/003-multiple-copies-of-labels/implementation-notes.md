# Implementation Notes: 003 Multiple Copies of Labels

## Status

Status: complete

## Acceptance Criteria Evidence

| Criterion | Evidence |
|---|---|
| AC-1 | `labels.spec.ts:89` "print button opens the copies dialog without opening a tab": clicking "Print labels (2)" shows the `Print labels` dialog with the spool count and initial label count; `context.pages().length` is unchanged and a context-level request listener records zero `/api/labels` requests. Passes. |
| AC-2 | `labels.spec.ts:112` "copies field has min/max, defaults to 1, and label count updates": on a fresh context the input has `min="1"`, `max="10"`, value `"1"` and the shown count is `2`; typing `4` updates the shown count to `8`. Passes. |
| AC-3 | `labels.spec.ts:131` "print opens a new tab with copies=K and loads the label PDF": printing with `3` for spools A,B opens a popup and the captured response URL is exactly `…/api/labels?id=A&id=B&copies=3` with status 200, `content-type: application/pdf`, disposition filename `spool-labels.pdf`; the body contains 6 labels (3 per spool) on one page in A,A,A,B,B,B order. Passes. (URL asserted on the captured response rather than the popup document — see Deviations 3 and 4.) |
| AC-4 | `labels.spec.ts:158` "last used copy count survives a page reload": printing with `4`, reloading `/spools` and reopening the dialog shows the copies field value `4` (stored under `localStorage` key `filament.labelCopies` in `web/src/pages/Spools.tsx`). Passes. |
| AC-5 | `labels.spec.ts:173` "cancel closes the dialog without a request": Cancel removes the dialog, no popup opens, no `/api/labels` request is recorded, and the selected spool's checkbox stays checked. Passes. |
| AC-6 | `labels.spec.ts:196` "print with an empty copies field sends copies=1": clearing the field and printing yields a response URL containing `copies=1` and a 2-label PDF. Passes. |
| AC-7 | Unit: `LabelsControllerTests.ValidCopies_ReturnsSinglePagePdf` (200 `FileContentResult`, `application/pdf`, `spool-labels.pdf`) + `LabelTilingTests.ExpandCopies_SingleLabelThreeCopies_MakesThreeOfIt`. Playwright `labels.spec.ts:215`: `?id=A&copies=3` → 1 page, `labelCount` 3, A's needle (color+id) exactly 3× in page text. Passes. |
| AC-8 | Unit: `LabelTilingTests.ExpandCopies_TwoLabelsTwoCopies_AreGroupedPerLabel` ([A,B]×2 → A,A,B,B). Playwright `labels.spec.ts:228`: `?id=A&id=B&copies=2` → 4 labels, id-occurrence order in page text `[A, A, B, B]`. Passes. |
| AC-9 | Unit: `LabelsControllerTests.MissingCopies_DefaultsToOne_SinglePagePdf` (no `copies` → single-page PDF, one label per id) + `LabelTilingTests.ExpandCopies_OneCopy_ReturnsTheSameSequence`. Playwright `labels.spec.ts:241`: `?id=A&id=B` → 2 labels, order `[A, B]`. Passes. |
| AC-10 | Unit: `CopiesParsingTests.OutOfRangeOrNotWhole_AreRejected` (`0`, `-2`, `1.5`, `abc`, `11` all rejected; `WholeNumbersFromOneToTen_Parse` accepts 1–10; `SurroundingWhitespace_IsTolerated`) + `LabelsControllerTests.InvalidCopies_400` (each value → `BadRequestObjectResult`). Playwright `labels.spec.ts:254`: all five values return HTTP 400 with a non-PDF body. Passes. |
| AC-11 | Unit: `LabelsControllerTests.NoIds_400` (`BadRequestObjectResult`) and `AllIdsUnknown_404` (`NotFoundResult`). Playwright `labels.spec.ts:263`: `/api/labels` → 400 and `?id=NOPE&copies=2` → 404. Passes. |
| AC-12 | Unit: `LabelTilingTests.Paginate_SplitsIntoPagesOfAtMostFourteen` (16 → [14,2]) + `LabelPdfGeneratorTests.Generate_ProducesOnePagePerFourteenLabels` (16 labels → real PDF with page tree `/Count 2`). Playwright `labels.spec.ts:272`: 8 spools × `copies=2` → `pdfPageCount` 2, `labelCount` per page `[14, 2]`, page-1 text has spools 1–7 each exactly twice in order and not spool 8, page-2 has spool 8 twice — the 8th spool's pair is whole on page 2 (no split row). Passes. |
| AC-13 | Unit: `LabelTilingTests.ExpandCopies_DuplicateLabels_EachOccurrenceExpands` ([A,A]×2 → 4×A). Playwright `labels.spec.ts:298`: `?id=A&id=A&copies=2` → 4 labels on one page, A's needle exactly 4×. Passes. |
| AC-14 | Unit: `LabelTilingTests.Paginate_SplitsIntoPagesOfAtMostFourteen` (20 → [14,6]) + `LabelPdfGeneratorTests.Generate_ProducesOnePagePerFourteenLabels` (20 labels → `/Count 2`). `RenderLabel`/QR/swatch code is untouched apart from the font auto-fit (Deviations 1). Playwright `labels.spec.ts:311`: `?id=A&id=B&copies=10` → 2 pages with `labelCount` `[14, 6]` and every label's text contains the seeded brand, material, type, color and its spool id. Passes. |
| AC-15 | `labels.spec.ts:340` "downloading labels records no spool events and leaves counts unchanged": for a fresh spool, `GET /api/spools/{id}/events` (only `Created`), `GET /api/dashboard/summary`, and `GET /api/spools` before and after `?id=A&copies=2` are all byte-equal. Passes. |

## Changes Made

- `src/Filament.Api/Controllers/LabelsController.cs`: added `[FromQuery] string? copies`, `public static TryParseCopies` (whole number 1–10, trims, `NumberStyles.Integer`, invariant culture), 400 for invalid values, and `Generate(LabelPdfGenerator.ExpandCopies(labels, copyCount))`.
- `src/Filament.Api/Pdf/LabelPdfGenerator.cs`: added `ExpandCopies(labels, copies)` (contiguous per-occurrence expansion) and `Paginate(labels, labelsPerPage = 14)`; `Generate` now renders one `container.Page` per paged chunk (A4 size, margins, and the 7-row × 2-label tiling body iterate the page's chunk).
- `web/src/api/client.ts`: `labelPdfUrl(ids, copies?)` appends `copies` only when provided (byte-identical to before when omitted).
- `web/src/pages/Spools.tsx`: Print button now opens the in-page dialog (selected count, copies field 1–10 defaulted from `localStorage` key `filament.labelCopies`, live resulting label count, Print / Cancel); Print stores the effective value and opens the PDF URL with `copies`; Cancel only closes.
- `web/src/styles.css`: dialog/overlay styling following the existing overlay convention.
- `Filament.slnx`: registered `tests/Filament.Api.Tests/`.
- `tests/Filament.Api.Tests/` (new project, same shape as `Filament.Core.Tests`): `Filament.Api.Tests.csproj`, `Fakes.cs` (dictionary-backed `ISpoolRepository`/`IFilamentTypeRepository`, `NotSupportedException` elsewhere), `CopiesParsingTests.cs`, `LabelTilingTests.cs`, `LabelPdfGeneratorTests.cs`, `LabelsControllerTests.cs`.
- `e2e/tests/fixtures/pdf.ts` (new): self-contained QuestPDF output parser (Node built-ins only — `fs`/`zlib`): `pdfPages` (page tree via `/Count`/`/Kids`, per-page label count via image `Do` references, per-page text via inflated content streams + `/ToUnicode` CMaps), `pdfPageCount`, `countOccurrences`, `idOrderInText`.
- `e2e/tests/labels.spec.ts` (new): 15 tests covering AC-1…AC-15 (see matrix above) plus `test.afterAll` DB cleanup (Deviations 5).
- `e2e/tests/fixtures/seed.ts`: the seed fixture's spool id now comes from the `POST /api/spools` response instead of the first table row (Deviations 2).

## Deviations From Plan

1. **Font auto-fit in `RenderLabel` (pre-existing overflow bug, not in the plan).** Against the e2e `unique()`-seeded names (~33 characters) the pre-change single-page `Generate` overflowed the 70×35 mm label box: QuestPDF carried the overflowed text onto extra pages (3 labels produced 3 PDF pages; 16 produced 10 page objects). QuestPDF 2024.12.0 has no public clip API, so the fix keeps the full text but auto-fits each field's font size to its box: `FitFontSize(baseSize, maxLines, text, widthPt)` = `max(min(baseSize, (widthPt × maxLines) / (0.7 × len)), 2pt)` with a text-column width of 108 pt (reduced by 12 pt when the color swatch is present). Short strings keep their base sizes exactly (the fit width is only binding for long text), so normal label appearance and all e2e text needles are unchanged, and worst case (extreme names) the text shrinks to a 2 pt floor instead of leaking onto extra pages. Covered by `LabelPdfGeneratorTests.Generate_LongsThatOverflowTheLabelBox_StillTileOnePagePerFourteenLabels` and the full e2e suite, which seeds long names in every test.
2. **Seed fixture id capture (test correctness, not product).** The seed fixture read the created spool's id from the first spool-table row, but the list is sorted by last-used desc / id asc, so with several spools created in the same second `.first()` resolved to a different (older) spool; the label needles were then computed with the wrong id and failed ("needle missing for the first spool"). The id now comes from the `POST /api/spools` response, the same way `createSpoolViaUi` already did.
3. **PDF response capture in `printViaDialog`.** The plan described capturing the PDF with `waitForResponse` on the shared `BrowserContext`; Playwright 1.62.1's `BrowserContext` has no `waitForResponse` method, so the helper uses `Promise.all([page.waitForEvent('popup'), page.context().waitForEvent('response', …), click])`.
4. **Popup URL asserted on the captured response, and the body re-fetched.** In headless Chromium the PDF loads as a download rather than an inline document, so the popup never settles on a document URL (`popup.url()` stays `""` and `waitForURL` never resolves) and the navigation response's body is discarded once the page settles. The test therefore asserts the exact URL on the captured response (`response.url()` — the same request the popup issued) and re-fetches the bytes through `page.context().request.get(response.url())`. All AC-3 assertions (exact URL, 200, content types, filename, PDF content) are otherwise unchanged.
5. **`afterAll` cleanup in `labels.spec.ts`.** `labels.spec.ts` runs before `smoke.spec.ts` (alphabetical file order) and its tests create many spools and types, so the smoke test's "dashboard starts empty on a fresh database" would otherwise see accumulated data. `test.afterAll` (worker-scoped `browser` fixture — `page` is not usable in `afterAll`) creates a fresh context with `baseURL` and deletes every spool then every filament type via the API before the context closes, restoring the fresh-database state for the remaining suite. On the disposable per-run DB this is equivalent to the runner's pre-clean.
6. **Analyzer compliance in the new test project.** `LabelsControllerTests` pre-computes spool-id arrays in `static readonly` fields (CA1861) and `LabelPdfGeneratorTests` formats numbers with an explicit invariant culture (CA1305), so the new project builds warning-free.

## Verification

| Command | Result |
|---|---|
| `dotnet build Filament.slnx --no-incremental` | Build succeeded; the only warning is the pre-existing CA1711 in the unmodified `tests/Filament.Infrastructure.Tests/MariaDbFixture.cs` (surfaced by the clean rebuild, not introduced by this change). |
| `dotnet test Filament.slnx` | Passed — 67/67 `Filament.Core.Tests`, 45/45 `Filament.Api.Tests`, 9/9 `Filament.Infrastructure.Tests` (121 total, 0 failed). |
| `npm --prefix web run build` | Passed (`tsc -b && vite build`). |
| `npm --prefix e2e run typecheck` | Passed (`tsc --noEmit`, exit 0). |
| `npm --prefix e2e run e2e` | Passed — 24/24 tests (15 label, 2 smoke, 4 sorting, 1 spool-lifecycle, 2 unique), 22.2 s; all `filament-e2e-*` containers and the `filament-e2e` network torn down afterwards. |
| Standalone sanity check (manual stack, identical code) | `GET /api/labels?id=<spool>&copies=3` with e2e-shaped 30–33 character names returns 1 page / 3 labels / 3× needle via both the API port and the web proxy. |

## Test Layers Deliberately Omitted

- **`web`-level unit tests:** `web` has no test framework; per the project testing policy the SPA behavior is covered by the Playwright suite and `npm --prefix web run build` (typecheck + production build) is the SPA gate.
- **`WebApplicationFactory` integration layer:** the project has none; controller behavior is unit-tested with fakes and verified full-stack by the Playwright suite (plan decision).
- **OpenAPI surface check** (`curl /openapi/v1.json | grep copies`): the parameter is emitted automatically by `AddOpenApi()` from the action signature; the endpoint's `copies` behavior is exercised end-to-end by AC-3/AC-6/AC-10 and unit-tested at the controller, so the optional curl sanity check was not run separately.

## Limitations And Follow-Up

- **PDF text assertions go through the `pdf.ts` parser**, which is coupled to QuestPDF's current output format (verified against this QuestPDF version, and isolated in one fixture file). A QuestPDF upgrade that changes pagination/stream/CMap output would need `e2e/tests/fixtures/pdf.ts` adjusted first; the unit-level page-count tests guard the pagination independently.
- **Label font auto-fit uses an average glyph-width estimate (0.7 em).** It is conservative for the Lato subsets used here (it only ever shrinks below the base size, and the base size is kept for short text), but a future change to a much wider font or label layout should re-check the per-field `maxLines`/width constants.
- **The 2 pt font floor** means absurdly long names render legibly-shrunken text rather than being cut; there is no server-side length limit on the type name fields (pre-existing behavior, out of scope for this change).
- **E2E `afterAll` deletes all spools and types** (the per-run DB is disposable), which also makes manual `e2e` re-runs on a long-lived stack destructive — expected, and consistent with the runner's pre-clean.
- **Pre-existing CA1711 warning** in `tests/Filament.Infrastructure.Tests/MariaDbFixture.cs` (type name ends in `Collection`) is untouched, per the preserve-unrelated-changes rule; a follow-up rename can fix it.
