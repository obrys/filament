# Implementation Plan: Fix `InitialNetGrams` of spools (007)

## Approval

Status: approved
Approved by: obrys
Approved on: August 29, 2026

## Summary

The approved investigation result is **not reproducible — no defect found**, so there is no
application-side fix to implement. The specification directs that the request be closed with the
two regression tests created during the `investigate-bug` stage kept in place and **zero changes
to application code**. This plan therefore covers only: adopting those two test files, reviewing
them against the approved acceptance criteria, and running the verification commands below.

## Preconditions And Decisions

### Confirmed preconditions

- Exactly one request directory: `doc/todo/007-fix-initial-get-grams/` containing the immutable
  `README.md`, `amendment.md`, and `specification.md` (`Status: approved`, obrys, 2026-08-29).
- The specification's Scope: "No application code changes (server, client, or database)" and
  "Retain the new reproduction/regression tests".
- The two test files the Scope names already exist in the working tree, added during the
  `investigate-bug` stage:
  - `tests/Filament.Api.Tests/SpoolsControllerCreateTests.cs`
  - `e2e/tests/initial-net-grams.spec.ts`
- `doc/spec/domain-rules.md` (Weight rules) already describes the behaviour exactly as the
  tests verify it; no durable spec update is required (checked at the document stage).

### Binding decisions from the approved specification

1. No application source file is modified by the resolution (spec Scope, AC-4).
2. Both named regression test files remain in the repository (spec Scope, AC-1..AC-3).
3. Both test layers are present as the testing policy
   (`doc/spec/operations.md`, Testing policy) requires: xUnit unit tests for the creation business
   rule (requested value vs type default) and Playwright e2e tests for the user-visible
   display through the browser.

## Implementation Steps

1. Make no edits to any file under `src/`, `web/`, or the database/migrations.
2. Confirm the two test files match the specification's Scope (done during plan review; they were
   written ahead of this plan by the investigate-bug stage's workflow, which requires
   reproduction tests before the specification exists):
   - `tests/Filament.Api.Tests/SpoolsControllerCreateTests.cs` — `SpoolsControllerCreateTests`
     (two tests) plus the `FakeChangeNotifier` and `FakeSpoolStore` in-memory fakes used only by
     it.
   - `e2e/tests/initial-net-grams.spec.ts` — two tests: custom 250 g initial weight (API
     read-back, list gauge, spec line, and post-print remaining) and the no-override default
     fallback, both driven through the browser UI against the full containerized stack.
3. Run the verification commands below and record the results as evidence in
   `implementation-notes.md`.

## Test Matrix

| Acceptance criterion | Test layer | Test | Expected evidence |
|---|---|---|---|
| AC-1 — requested 250 g beats the 1000 g type default (persisted spool and zero-delta `Created` event) | Unit | `SpoolsControllerCreateTests.Create_WithRequestedInitialNetGrams_PersistsRequestedValue` | Pass |
| AC-2 — omitted value falls back to the type default (1000 g) | Unit | `SpoolsControllerCreateTests.Create_WithoutInitialNetGrams_FallsBackToTypeDefault` | Pass |
| AC-3 — a custom 250 g spool reports and displays 250 g (API, list gauge `250 g / 250`, detail `Remaining: 250 g (initial 250 g)`); after a 100 g print, 150 of 250 | e2e | `initial-net-grams.spec.ts` › `a spool created with a custom initial net weight stores and displays that value` | Pass + screenshot/video/trace under `e2e/test-results/` |
| AC-3 — a spool created without an override reports and displays 1000 g | e2e | `initial-net-grams.spec.ts` › `a spool created without an initial net weight uses the type default` | Pass + evidence |
| AC-4 — no application source file modified | Diff check | `git status --porcelain` / `git diff --stat` | Only the two new untracked test files (plus this request's documents); no modifications under `src/` or `web/` |
| AC-5 — full unit suites pass unchanged | Unit | The three `dotnet test` runs below | Core 83, Api 66 (incl. the 2 new), Infrastructure 12 — all pass |

## Test Commands

~~~text
# The new unit tests
dotnet test tests/Filament.Api.Tests/Filament.Api.Tests.csproj --filter "FullyQualifiedName~SpoolsControllerCreateTests"

# Full unit suites (regression)
dotnet test tests/Filament.Core.Tests
dotnet test tests/Filament.Api.Tests
dotnet test tests/Filament.Infrastructure.Tests

# The new e2e spec (builds the e2e stack once; evidence captured in e2e/test-results/)
npm --prefix e2e run e2e -- tests/initial-net-grams.spec.ts

# Full e2e regression suite (all specs)
npm --prefix e2e run e2e
~~~

## Out Of Scope

- Any application code, schema, configuration, or API change.
- Durable `doc/spec/` behaviour documentation: the current spec (`doc/spec/domain-rules.md`,
  Weight rules) already describes the verified behaviour exactly; the document stage confirms
  this and only archives the request.

## Risks And Rollback Notes

- Risk is minimal: the change is two additive test files; no production code path is touched.
- Rollback, if ever needed, is deleting the two test files — a one-step revert with no data or
  configuration impact.
- The e2e harness containers are disposable and torn down after each run; per-test evidence
  persists under `e2e/test-results/` (individual directories are overwritten on re-runs with the
  same test names).
