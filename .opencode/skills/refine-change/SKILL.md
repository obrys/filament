---
name: refine-change
description: Use when refining a change request in doc/todo into an approved, testable specification before planning or implementation.
---

# Refine Change Request

Use this skill only for the specification-refinement stage of a spec-driven change request.

## Input and boundaries

- Require exactly one request directory: `doc/todo/<id>-<title>/`.
- Treat `README.md` as the user's immutable original request. Never modify it.
- Read the relevant parts of `doc/spec/` and only enough source code to clarify existing behavior or terminology.
- Do not change application code, tests, architecture, technology choices, or the request's location.
- Do not infer product, architecture, platform, security, schema-migration, data-retention, or external-dependency decisions. Ask the user to decide them.

## Workflow

1. Confirm the request directory and read its `README.md`.
2. Identify missing information required to describe user-visible behavior, API or UI behavior, edge cases, constraints, acceptance criteria, and decisions.
3. Ask one concise batch of questions. Include options and a recommendation where a decision is needed, but do not make the decision.
4. After the user answers, create or update `amendment.md`. Record answered questions, explicit assumptions accepted by the user, open decisions, and references consulted.
5. Create or update `specification.md` as a self-contained proposed specification. It must contain:
   - Purpose and scope
   - Out-of-scope behavior
   - User, API, or UI behavior as applicable
   - Rules and edge cases
   - Testable acceptance criteria
   - Dependencies and constraints
   - Decisions and unresolved questions
   - An approval section
6. Set the approval status to `proposed`; only the user may change it to `approved`.
7. Stop. Direct the user to review `specification.md` and explicitly approve or revise it.

## Acceptance criteria rules

- Each criterion must be observable and independently verifiable.
- State the expected outcome, not an implementation detail, unless the implementation detail is an explicit constraint.
- Use precise conditions, inputs, outputs, errors, or visible UI outcomes.
- Do not use subjective criteria such as "easy to use" as a completion test. Keep them as product context and add measurable criteria where possible.
- Write criteria describing user-visible behavior so they are verifiable through the browser (page navigation, element visibility, text content, form interactions). This ensures the Playwright e2e test layer can cover them, as required by the project's testing policy (see `doc/spec/operations.md`).

## Specification template

```markdown
# <Change title>

## Approval

Status: proposed
Approved by:
Approved on:

## Purpose

## Scope

## Out Of Scope

## Behavior

## Rules And Edge Cases

## Acceptance Criteria

1. ...

## Constraints And Dependencies

## Decisions

## Open Questions
```
