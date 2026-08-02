---
name: implement-change
description: Use when implementing an approved doc/todo change specification and plan, including the planned tests and recorded verification evidence.
---

# Implement Change Request

Use this skill only for the implementation stage of a spec-driven change request.

## Preconditions and boundaries

- Require exactly one request directory: `doc/todo/<id>-<title>/`.
- Require both `specification.md` and `implementation-plan.md` with `Status: approved`.
- Read the original request, amendment, approved specification and plan, relevant `doc/spec/` files, and affected source and tests.
- Preserve unrelated worktree changes. Do not revert user work.
- Do not create Git commits, pull requests, or move the request to `doc/done`.
- Do not make a material change to approved scope, architecture, technology, data model, security, or external dependencies without pausing for the user's decision.

## Workflow

1. Check the current branch and worktree. Report unrelated changes but continue when they do not conflict.
2. Implement the approved scope in small, coherent changes.
3. Add or update every test in the approved test matrix. The project requires **both** test layers for changes with user-visible behavior: unit tests (xUnit, `tests/`) for business logic, and Playwright e2e tests (`e2e/tests/`) for any feature reachable through the browser UI. If the approved plan justified omitting Playwright tests because the change has no browser-observable behavior, honor that justification; otherwise both layers are mandatory.
4. Run the exact planned test commands and any directly relevant build or lint commands.
5. Fix failures caused by this change. If blocked by a decision, environment, or unrelated failure, stop and describe the blocker precisely.
6. Create or update `implementation-notes.md` containing:
   - Implemented behavior mapped to acceptance criteria
   - Files changed and meaningful deviations from the approved plan
   - Exact commands run and their results
   - Test layers deliberately omitted and why
   - Known limitations or follow-up work
7. Do not claim completion unless all applicable acceptance criteria have passing evidence.

## Completion record template

```markdown
# Implementation Notes: <Change title>

## Status

Status: complete | blocked

## Acceptance Criteria Evidence

| Criterion | Evidence |
|---|---|
| AC-1 | ... |

## Changes Made

## Deviations From Plan

## Verification

| Command | Result |
|---|---|
| `...` | passed |

## Limitations And Follow-Up
```
