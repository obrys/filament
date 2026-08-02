---
name: document-change
description: Use when documenting a completed doc/todo change in doc/spec and archiving its request under doc/done after implementation verification passes.
---

# Document And Archive Change Request

Use this skill only after a spec-driven change request has been implemented and verified.

## Preconditions and boundaries

- Require exactly one request directory: `doc/todo/<id>-<title>/`.
- Require approved `specification.md`, approved `implementation-plan.md`, and `implementation-notes.md` with `Status: complete` and passing verification evidence.
- Review the current feature branch diff and relevant existing documentation.
- Do not change application behavior, application code, or tests during this stage. If documentation reveals a defect, stop and create or request a new change request.
- Do not create Git commits or pull requests.

## Workflow

1. Update only durable, current-state documentation under `doc/spec/`: behavior, domain rules, APIs, UI, architecture, operations, or constraints that changed.
2. Do not duplicate the whole request in `doc/spec/`; summarize enduring behavior and link to the completed request when useful.
3. Every request link from `doc/spec/` must target `doc/done/<id>-<title>/`, never `doc/todo/`. Create the link as though the move has already happened.
4. Check links affected by the move, then move the complete directory with `git mv doc/todo/<id>-<title> doc/done/<id>-<title>`.
5. Update documentation indexes if they list requests.
6. Report documentation files changed, the archived path, and any links checked.

## Documentation standards

- `doc/spec/` describes the system as it is after the change.
- Keep text concise and useful to human readers and future agents.
- Use Markdown and Mermaid diagrams where they improve understanding.
- Preserve the original `README.md`, amendment, specification, plan, and implementation notes in the archived request directory.
