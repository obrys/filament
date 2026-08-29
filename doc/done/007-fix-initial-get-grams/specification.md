# Fix `InitialNetGrams` of spools — investigation result: NOT REPRODUCIBLE

## Approval

Status: approved
Approved by: obrys
Approved on: 2026-08-29

## Bug Summary

The report describes a spool created with an initial net weight different from its filament
type's default (type default 1000 g, spool recorded as 250 g). The reporter asks the application
to be checked for:

1. correct population of the spool's `InitialNetGrams`, and
2. correct display of the remaining value.

**The described defect was not reproduced.** Every code path was traced and exercised with new
unit and Playwright tests; all of them pass and show the requested 250 g everywhere — in the
created row, the API response, the spool list gauge, the spool detail, and after recording a
print. The application already behaves exactly as `doc/spec/domain-rules.md` prescribes ("A new
spool's `initialNetGrams` is its requested initial net weight, or the owning type's default net
weight when omitted" and "Remaining grams are initialized from `initialNetGrams`…").

## Reproduction Evidence

New tests added by this investigation (they remain in the repository as standing regression
coverage):

- Test: `Filament.Api.Tests.SpoolsControllerCreateTests.Create_WithRequestedInitialNetGrams_PersistsRequestedValue`
  (`tests/Filament.Api.Tests/SpoolsControllerCreateTests.cs`)
- Test: `Filament.Api.Tests.SpoolsControllerCreateTests.Create_WithoutInitialNetGrams_FallsBackToTypeDefault`
  (`tests/Filament.Api.Tests/SpoolsControllerCreateTests.cs`)
- Command: `dotnet test tests/Filament.Api.Tests/Filament.Api.Tests.csproj --filter "FullyQualifiedName~SpoolsControllerCreateTests"`
- Observed: `Passed!  - Failed: 0, Passed: 2` — the spool persisted for the repository carries
  `InitialNetGrams = 250` / `RemainingGrams = 250` (not the 1000 g type default), with a
  zero-delta `Created` event; the omitted case falls back to 1000 g.
- Expected (if the bug existed): `InitialNetGrams = 1000` — did not occur.

- Test: `e2e/tests/initial-net-grams.spec.ts` › `a spool created with a custom initial net weight stores and displays that value`
- Test: `e2e/tests/initial-net-grams.spec.ts` › `a spool created without an initial net weight uses the type default`
- Command: `npm --prefix e2e run e2e -- tests/initial-net-grams.spec.ts`
- Observed: `2 passed (3.3s)` — via the browser UI (seeded type at the form default 1000 g net):
  - POST `/api/spools` response and subsequent GET: `initialNetGrams = 250`, `remainingGrams = 250`
  - Spool list gauge for the new spool: `250 g / 250`
  - Spool detail: `Remaining: 250 g (initial 250 g)`
  - After opening and consuming 100 g: detail `Remaining: 150 g (initial 250 g)`, list gauge `150 g / 250`
  - A spool created without an override: `1000` / `1000`, list gauge `1000 g / 1000`
- Expected (if the bug existed): 1000 g shown as the initial weight or remaining seed — did not occur.
- Retained evidence: `e2e/test-results/initial-net-grams-a-spool--2ad9e-res-and-displays-that-value-chromium/`
  and `e2e/test-results/initial-net-grams-a-spool--f97e4-eight-uses-the-type-default-chromium/`
  (screenshot, video, trace per test).

Full-suite baselines from the same run (no regressions):
`dotnet test tests/Filament.Core.Tests` → 83 passed;
`dotnet test tests/Filament.Api.Tests` → 66 passed;
`dotnet test tests/Filament.Infrastructure.Tests` → 12 passed.

## Root Cause

**No root cause — no defect found.** The whole path is consistent with the specification:

- `src/Filament.Api/Controllers/SpoolsController.cs:96` — `var initial = dto.InitialNetGrams ?? type.DefaultNetWeightGrams;` the requested value wins; the type default applies only when omitted. `InitialNetGrams` and `RemainingGrams` are both seeded from it (lines 101–102).
- `src/Filament.Infrastructure/Repositories/Repositories.cs:93-104` — `AddAsync` persists the spool as handed to it (`spool.ToEntity()` at `src/Filament.Infrastructure/Mapping/EntityMapping.cs:63-76` copies `InitialNetGrams`) and derives the cached state from `spool.InitialNetGrams` (line 101).
- `src/Filament.Api/Mapping/DtoMapping.cs:14-23` — the API response maps `s.InitialNetGrams` / `s.RemainingGrams` 1:1.
- `web/src/pages/Spools.tsx:225,242` — the form sends the entered value; `Spools.tsx:169,188` — the list gauge renders `remaining / initial` from the response.
- `web/src/pages/SpoolDetail.tsx:85` — the detail renders `remainingGrams g (initial initialNetGrams g)` from the response.

Uncertainty: none within this codebase. If the reporter still saw a wrong value, it cannot be
attributed to a code path found here; see Open Questions.

## Purpose

Close request 007 as *verified, no fix required*: the reported behaviour is already correct, and
the new unit and Playwright tests lock in that behaviour against regression, as the report asked
("Please cover that with tests (unit and Playwright tests). If discrepancies found, fix the
problem" — no discrepancies were found).

## Scope

- No application code changes (server, client, or database).
- Retain the new reproduction/regression tests:
  - `tests/Filament.Api.Tests/SpoolsControllerCreateTests.cs` (new file; includes two in-memory fakes used only by it)
  - `e2e/tests/initial-net-grams.spec.ts` (new file)

## Out Of Scope

- Any change to spool creation defaults, validation, or display.
- The `reevaluate` repair endpoint (not implicated; existing behaviour is already correct).

## Behavior (After Fix)

Behaves as it does today, with the correct behaviour now covered by tests:

1. Creating a spool with an explicit initial net weight stores exactly that value as
   `InitialNetGrams` and seeds `RemainingGrams` with it, regardless of the type default.
2. Creating a spool without an initial net weight uses the type's `DefaultNetWeightGrams`.
3. The spool list gauge and the spool detail `Remaining: … g (initial … g)` line always show the
   spool's own initial weight (not the type default), including after prints consume from it.

## Rules And Edge Cases

- Omitted value → type default (per `doc/spec/domain-rules.md`, Weight rules).
- All weights are integer grams; the creation form sends whole numbers.
- Post-print remaining = custom initial weight − consumed grams (verified for 250 − 100 = 150).

## Acceptance Criteria

1. `SpoolsControllerCreateTests.Create_WithRequestedInitialNetGrams_PersistsRequestedValue` passes
   (requested 250 g beats the 1000 g type default, both in the persisted spool and the created
   event's zero delta).
2. `SpoolsControllerCreateTests.Create_WithoutInitialNetGrams_FallsBackToTypeDefault` passes.
3. `e2e/tests/initial-net-grams.spec.ts` passes: the created 250 g spool reports and displays
   250 g (list + detail), shows 150 g of 250 g after a 100 g print, and the no-override spool
   reports and displays 1000 g.
4. No application source file is modified by the resolution of this request.
5. The full unit suites (`tests/Filament.Core.Tests`, `tests/Filament.Api.Tests`,
   `tests/Filament.Infrastructure.Tests`) pass unchanged.

## Constraints And Dependencies

- e2e execution requires the standard harness (`npm --prefix e2e run e2e — podman/docker) per
  `doc/spec/operations.md` (Functional tests).

## Decisions

- The reporter re-tested from their side (2026-08-29), retracted the defect ("it was my fault"),
  approved the *not reproducible* outcome, and asked that request 007 be closed with the
  regression tests retained. The request is documented and archived under
  `doc/done/007-fix-initial-get-grams/`.
- No product, architecture, security, or data decisions are implied by this outcome.

## Open Questions

None — the reporter confirmed on 2026-08-29 that no discrepancy is observed from their side.
