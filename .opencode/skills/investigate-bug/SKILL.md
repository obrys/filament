---
name: investigate-bug
description: Use when a doc/todo request is a bug report instead of a change request. Investigates the reported defect, proves it with failing unit and/or Playwright tests, records findings in amendment.md, and produces the same specification.md consumed by plan-change, implement-change, and document-change.
---

# Investigate Bug Report

Use this skill for the first stage of a spec-driven bug fix. It replaces `refine-change` when the `README.md` in the request directory describes a defect instead of a desired change. The output is identical to `refine-change`: an approved `specification.md` that `plan-change`, `implement-change`, and `document-change` consume unchanged.

## Input and boundaries

- Require exactly one request directory: `doc/todo/<id>-<title>/`.
- Treat `README.md` as the user's immutable original bug report. Never modify it.
- Read the relevant parts of `doc/spec/` and enough source code and existing tests to locate the suspected defect.
- Do not fix the bug in this stage. Do not change application code or existing tests.
- You may add new reproduction tests (unit and/or Playwright, see Test layers) that currently FAIL. A passing reproduction test or an inconclusive investigation is a blocker: report it, do not proceed with a specification that claims a proven defect.
- Do not infer product, architecture, platform, security, schema-migration, data-retention, or external-dependency decisions. Ask the user to decide them.

## Workflow

1. Confirm the request directory and read its `README.md`.
2. Identify missing information required to reproduce the bug: exact reproduction steps, expected vs actual behavior, affected entities and data (for example spool weights, event history), error messages, environments, and screenshots or console output.
3. If the bug report is incomplete, ask one concise batch of questions. Include options and a recommendation where a decision is needed, but do not make the decision. Record the answers in `amendment.md` (answered questions, assumptions accepted by the user, open items).
4. Reproduce the bug:
   - Trace the reported behavior through the relevant code paths.
   - Write a minimal failing unit test in the relevant `tests/*` xUnit project when the defect is in domain logic, business rules, or pure computation.
   - Write a failing Playwright test in `e2e/tests/` when the defect is user-visible through the browser UI, as required by the project's testing policy (see `doc/spec/operations.md`).
   - Run each new test and record the exact command and the observed failure output as evidence.
5. Locate the root cause: identify the specific file(s) and code path responsible for the wrong behavior. Cite them as `path:line` references. If there are multiple plausible causes, state the evidence for each and mark uncertainty.
6. Create or update `specification.md` as a self-contained proposed specification for the fix. Use the standard refine-change structure, extended with:
   - A `Bug Summary` section: the reported symptom, confirmed reproduction, and the evidence (test names and commands, observed vs expected output).
   - A `Root Cause` section: the code path analysis and `path:line` references, or an explicit note that the root cause is unconfirmed.
   - The standard `Acceptance Criteria` section describing the correctly working behavior (the flipped version of what the reproduction tests verify).
7. Set the approval status to `proposed`; only the user may change it to `approved`.
8. Stop. Direct the user to review `specification.md` and the reproduction tests, and explicitly approve or revise them. The reproduction tests remain in the repository; `implement-change` will make them pass and `plan-change` must account for them in its test matrix.

## Test layers

Match the project testing policy (see `doc/spec/operations.md`):

- **Unit tests** (xUnit, `tests/`): for defects in domain logic, business rules, and pure computations. Run with the project's standard test command for the relevant solution/project.
- **Playwright e2e tests** (`e2e/tests/`): for defects in user-visible behavior — any feature reachable through the browser UI. Run with `npm --prefix e2e run e2e` (or a targeted single-spec invocation) and rely on the retained evidence in `e2e/test-results/` (screenshot, video, trace) as proof.

A bug with no browser-observable behavior may use unit tests only, but state this justification in the specification.

## Specification template

```markdown
# <Bug title>

## Approval

Status: proposed
Approved by:
Approved on:

## Bug Summary

## Reproduction Evidence

- Test: ...
- Command: ...
- Observed: ...
- Expected: ...

## Root Cause

## Purpose

## Scope

## Out Of Scope

## Behavior (After Fix)

## Rules And Edge Cases

## Acceptance Criteria

1. ...

## Constraints And Dependencies

## Decisions

## Open Questions
```
