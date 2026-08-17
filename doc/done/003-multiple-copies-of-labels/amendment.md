# Amendment — 003 Multiple copies of labels

Records the questions raised during refinement of `README.md`, the answers
accepted by the user, the assumptions taken, and the references consulted.
The original `README.md` is not modified.

## Answers to clarifying questions

1. **Copies selection UI.** How should the user choose the number of copies
   after clicking "Print labels (N)"?
   Answer: an in-page dialog on the `/spools` page with a copies field and
   Print / Cancel buttons. Print opens the label PDF in a new tab; Cancel
   closes the dialog with no request and the selection unchanged.

2. **Copies field default, maximum, and persistence.**
   Answer: the field starts at 1, minimum 1, maximum 10; the last used value
   is remembered and may be stored in browser storage, so the next time the
   dialog opens the field defaults to the last copy count used.

3. **API parameter shape.** How the copy count is passed to the API.
   Answer: an explicit `copies` query parameter on `GET /api/labels`
   (e.g. `?id=A&id=B&copies=3`).

4. **Invalid `copies` values.** How the API treats `copies=0`, negative, or
   non-integer values.
   Answer: missing or empty `copies` means 1; values below 1 or not a whole
   number (e.g. `1.5`, `abc`) return HTTP 400.

5. **Page overflow.** What the PDF contains when `selected spools x copies`
   exceeds what fits on one A4 page (~14 labels at 2 per row).
   Answer: the PDF continues on additional A4 pages with the same tiling
   (multi-page PDF). This also fixes the current single-page overflow when
   requesting labels for more than 14 spools with 1 copy.

## Assumptions accepted

- Last-used value: the initial fallback is 1; the value is stored when
  Print is used; a stored value that cannot be read as a whole number in
  1..10 falls back to 1. The value persists per browser profile across page
  reloads.
- The maximum of 10 is enforced by the UI field (input min/max) and the
  specification also rejects `copies > 10` on the API with 400. This
  extension of the maximum to the API is flagged in the specification's
  Open Questions for the approver to confirm.
- If the field value at Print time is not a whole number in 1..10 (e.g.
  cleared or out of range), the request uses `copies=1`.
- Grouping: labels of a same spool are contiguous; spools appear in the
  order their `id` values occur in the request; duplicate `id` occurrences
  are not de-duplicated and each occurrence produces `copies` labels
  (consistent with the current per-occurrence behavior).
- The dialog displays the resulting label count (selected spools × copies)
  and updates it as the copies value changes.
- Rows of labels are not split across PDF pages; labels are numbered
  sequentially across pages (up to 14 per page, following the existing
  2-per-row tiling).
- Label design, per-label content, QR payload, and the download file name
  (`spool-labels.pdf`) are unchanged, per the request's explicit note.
- The "Print labels (N)" button keeps its label and disabled state (disabled
  when no spool is selected) but now opens the dialog instead of directly
  opening a new tab; the dialog therefore cannot be opened with 0 spools.
- Printing labels with copies records no spool events and has no database
  impact.

## Open decisions

- Whether the API rejects `copies > 10` (specification assumption: yes, 400)
  or only the UI enforces the maximum. See the specification's Open
  Questions.

## References consulted

- `doc/todo/003-multiple-copies-of-labels/README.md` — the immutable original
  request.
- `doc/spec/interfaces.md` — `GET /api/labels` contract, the "Printable
  labels" layout (70×35 mm, two per row, A4, 10 mm margins, QR payload,
  `spool-labels.pdf`), and the `/spools` web route.
- `doc/spec/operations.md` — testing policy (unit tests plus Playwright e2e
  for user-visible behavior).
- `doc/spec/domain-rules.md` — spool/type model context.
- `src/Filament.Api/Controllers/LabelsController.cs` — current endpoint:
  one label per resolved `id` in request order, unknown ids skipped, 404
  when none resolve, 400 when no `id` is supplied.
- `src/Filament.Api/Pdf/LabelPdfGenerator.cs` — current single-page A4
  generator: 70×35 mm labels, 2 per row, 10 mm page margin, 2 mm padding,
  one page total (at most 14 labels fit).
- `web/src/pages/Spools.tsx` — the "Print labels (N)" button (disabled with
  an empty selection) opening `labelPdfUrl` in a new tab via `window.open`.
- `web/src/api/client.ts` — `labelPdfUrl` building `/api/labels?id=...`.
