---
name: plan-change
description: Use when creating a detailed, test-oriented implementation plan for an approved doc/todo change specification before coding.
---

# Plan Change Request

Use this skill only for the implementation-planning stage of a spec-driven change request.

## Preconditions and boundaries

- Require exactly one request directory: `doc/todo/<id>-<title>/`.
- Require `specification.md` with `Status: approved`. Stop and ask for approval if it is absent or proposed.
- Read the original request, amendment, approved specification, relevant `doc/spec/` files, and the minimum relevant code and tests.
- Do not edit application code, tests, or durable system documentation.
- Do not choose unresolved product or architecture decisions. Surface them as blockers for the user.

## Workflow

1. Trace each acceptance criterion to the relevant code paths and test layers.
2. Keep the request small. If it cannot be implemented and verified as one focused pull request, propose a split and stop for a user decision.
3. Write `implementation-plan.md`. Make each step ordered, concrete, and file-oriented without inventing unnecessary abstractions.
4. Include a test matrix that links every acceptance criterion to one or more planned tests.
5. State why any otherwise applicable test layer is omitted.
6. Set the approval status to `proposed`; only the user may change it to `approved`.
7. Stop and request approval before implementation starts.

## Test layers

The project requires **both** test layers for every change that introduces or modifies user-visible behavior:

- **Unit tests** (xUnit, `tests/`): for changed domain logic, business rules, and pure computations.
- **Playwright e2e tests** (`e2e/tests/`): for changed user-visible behavior — any feature reachable through the browser UI, including API endpoints the SPA consumes, lifecycle actions, dashboard counts, list views, filtering, and forms.

Each user-visible acceptance criterion in the test matrix must link to at least one Playwright test. A change that genuinely has no browser-observable behavior (for example, a pure internal refactor or a database migration with no UI impact) may omit Playwright tests, but the plan must state this explicitly and justify the omission.

## Plan template

```markdown
# Implementation Plan: <Change title>

## Approval

Status: proposed
Approved by:
Approved on:

## Summary

## Preconditions And Decisions

## Implementation Steps

1. `<path>`: ...

## Test Matrix

| Acceptance criterion | Test layer | Test | Expected evidence |
|---|---|---|---|
| AC-1 | Unit | ... | ... |

## Test Commands

~~~text
<exact commands to run>
~~~

## Out Of Scope

## Risks And Rollback Notes
```
