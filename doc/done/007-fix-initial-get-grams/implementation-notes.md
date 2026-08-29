# Implementation Notes: Fix `InitialNetGrams` of spools (007)

## Status

Status: complete

## Outcome

Not reproducible — no defect found. The application already populates a spool's
`InitialNetGrams` from the requested value (falling back to the type default when omitted) and
displays the remaining value against that initial weight, exactly as `doc/spec/domain-rules.md`
prescribes. Per the approved specification, **no application code was changed**; the
implementation consists of keeping the two regression test files created during the
`investigate-bug` stage in the repository. The reporter re-tested from their side on 2026-08-29
(retracted the defect — "it was my fault") and approved the not-reproducible outcome.

## Acceptance Criteria Evidence

All evidence below is from the final runs of 2026-08-29; no file changed after them.

| Criterion | Evidence |
|---|---|
| AC-1 — requested 250 g beats the 1000 g type default | `SpoolsControllerCreateTests.Create_WithRequestedInitialNetGrams_PersistsRequestedValue` — the spool handed to the repository carries `InitialNetGrams = 250` / `RemainingGrams = 250` with a zero-delta `Created` event. Passed. |
| AC-2 — omitted value falls back to the type default | `SpoolsControllerCreateTests.Create_WithoutInitialNetGrams_FallsBackToTypeDefault` — persisted `InitialNetGrams = 1000` / `RemainingGrams = 1000`. Passed. |
| AC-3 — custom value reported and displayed | e2e `a spool created with a custom initial net weight stores and displays that value` — via the UI (seeded type at the form default 1000 g net): POST response and subsequent GET `/api/spools/{id}` report `initialNetGrams = 250`, `remainingGrams = 250`; the spool list gauge renders `250 g / 250`; the detail renders `Remaining: 250 g (initial 250 g)`; after opening and consuming 100 g the detail renders `Remaining: 150 g (initial 250 g)` and the list gauge `150 g / 250`. Passed; evidence in `e2e/test-results/initial-net-grams-a-spool--2ad9e-res-and-displays-that-value-chromium/` (screenshot, video, trace). |
| AC-3 — no-override default reported and displayed | e2e `a spool created without an initial net weight uses the type default` — the UI-created, un-override spool reports `initialNetGrams = 1000`, `remainingGrams = 1000`; list gauge `1000 g / 1000`. Passed; evidence in `e2e/test-results/initial-net-grams-a-spool--f97e4-eight-uses-the-type-default-chromium/` (screenshot, video, trace). |
| AC-4 — no application source file modified | `git status --porcelain` lists only the two new test files and this request's documents; `git diff --stat` is empty (no tracked application file modified). |
| AC-5 — full unit suites pass | `dotnet test tests/Filament.Core.Tests` → 83 passed; `dotnet test tests/Filament.Api.Tests` → 66 passed (incl. the 2 new); `dotnet test tests/Filament.Infrastructure.Tests` → 12 passed. |

## Changes Made

Exactly the two test files named in the approved plan (both new, both retained as requested):

- `tests/Filament.Api.Tests/SpoolsControllerCreateTests.cs` (new) — the two creation tests plus
  the `FakeChangeNotifier` and `FakeSpoolStore` in-memory fakes used only by them.
- `e2e/tests/initial-net-grams.spec.ts` (new) — the two browser-UI tests described in AC-3.

No application code, configuration, or documentation under `doc/spec/` was changed. No commits
were created by this work.

## Deviations From Plan

- None. The two test files were written during the `investigate-bug` stage, whose workflow
  requires reproduction tests to exist (and fail or pass) before the specification is approved;
  the plan stage reviewed and adopted them unchanged.

## Verification

Final runs (2026-08-29):

| Command | Result |
|---|---|
| `dotnet test tests/Filament.Api.Tests/Filament.Api.Tests.csproj --filter "FullyQualifiedName~SpoolsControllerCreateTests"` | passed — `Failed: 0, Passed: 2, Skipped: 0, Total: 2` |
| `dotnet test tests/Filament.Core.Tests` | passed — 83 passed |
| `dotnet test tests/Filament.Api.Tests` | passed — 66 passed |
| `dotnet test tests/Filament.Infrastructure.Tests` | passed — 12 passed |
| `npm --prefix e2e run e2e -- tests/initial-net-grams.spec.ts` | passed — `2 passed (3.2s)`, evidence captured in `e2e/test-results/` |
| `npm --prefix e2e run e2e` (full suite: smoke, spool-lifecycle, sorting, labels, unique, dashboard-consumption, initial-net-grams) | passed — `56 passed (55.1s)` |

## Limitations And Follow-Up

- No durable `doc/spec/` update is required: the Weight rules in `doc/spec/domain-rules.md`
  already describe the verified behaviour exactly (requested value wins, type default on
  omission, remaining derived from `initialNetGrams` plus enabled event deltas). The document
  stage checks this and only archives the request.
- Per-test e2e evidence under `e2e/test-results/` is overwritten on re-runs with the same test
  names; the paths above reference the final run of this request.
