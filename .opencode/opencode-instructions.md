# OpenCode Instructions

## Project Overview

This project is an application for filament management. It helps individuals or a small teams to manage their 3D print farms in terms of resources.

The basic idea is that the application manages a filament storage. 

* There are multiple filament types, like brand (Bambu, Prusa, Creality), material (PET, PLA, ASA, ...), type (basic, matte, glow, silk, ...), color, weight of the spool.
* There are each individual spool of such a filament type (there can be more spools of the same filament type). Each filament spool has weight of the filament. There must be the ability to override filament type's spool weight (for case when a refill kit has been used and the filament is on a different spool).
* Each spool has properties, like remaining filament in grams.
* There must be an easy way for the user to decrease the weight of the spool. Optionally, it can be entered a note (like the model), and URL of the model.
* For each spool, there can be tracked its history, when it was opened, when and what models has been printed, and when it was finally finished.
* The application will be hosted privately in LAN. There isn't any authentication/authorization necessary at this time of the development.
* It is expected to manage 50-150 filament types
* It is expected to manage 50-300 spools
* It is expected to host up to five concurrent users
* There should be a system of identifiers (identifier for filament types and identifiers for spools)
  * Identifiers should be short
  * Identifier for filament types should hold at least 1000 types
  * Identifier for spools should hold at least 100000 spools
  * It can be a combination of numbers and letters, case insensitive, there shouldn't be used similar letters, like 0 and O, 1 and I and so on.
* There should be a basic overview on the filament types and spools.
* There should be some usage graphs over time.
* There should be URL of each individual spool and each individual filament type.
* There should be a way to print a small label of a selected spool (one or more spools), which will generate a PDF of one or more labels, which can be printed and glued to each individual spool. There should be graphically visible their brand, material, type, color, identifier, and QR code which is the unique page of the spool.


## Tech Stack back-end

- **Runtime**: .NET 10
- **Language**: C# (latest available version for .NET 10)
- **Database**: MariaDB
- **Database layer**: EF Core
- **OS**: Linux-based containers (with ability to run on memory constrained device, like 256-512MB RAM)

Try to externalize the business logic if possible. Always use unit tests for business logic. Always use DTOs for API calls, the DTOs should be mapped to domain model objects, for the call the database, always use mapping to entities and then back from entities to domain model. Try to keep this three-layer architecture.

**Testing policy:** Every implemented change must be covered by both unit tests (xUnit, `tests/`) and Playwright e2e tests (`e2e/tests/`). Unit tests cover business logic; Playwright tests cover user-visible behavior through the browser. A change with no browser-observable behavior may omit Playwright tests but must justify the omission in the implementation plan. See `doc/spec/operations.md` for details.

## Tech Stack front-end

- React-based front end
- The design should be minimalistic and usable for mobile, tablet and desktop use.
- It can use technology like WebSockets to get events about changes in the data so the front-end can request the new data. This way instant updates on other devices can be achieved, but it has to be implemented carefully not to produce any memory leaks. It is also important to implement some kind of keep-alive request/response to server know when client is disconnected, and to client know when server is disconnected to retry connections. 


## Solution Structure

```
.opencode/
  opencode-instructions.md          # Repo-wide OpenCode context (this file)
  instructions/
    backend.instructions.md        # Path-scoped instructions for src/ and tests/
    frontend.instructions.md       # Path-scoped instructions for web/
  prompts/
    add-api-endpoint.prompt.md     # Reusable prompt: add a new API endpoint
    add-filament-feature.prompt.md # Reusable prompt: add a full feature end-to-end
    add-migration.prompt.md        # Reusable prompt: add an EF Core migration
src/          # Back-end production projects  (<ProjectName>/<ProjectName>.csproj)
tests/        # Back-end test projects        (<ProjectName>.Tests/<ProjectName>.Tests.csproj)
web/          # React front-end application
e2e/          # Playwright functional test suite (Node + TypeScript, own package.json)
scripts/      # E2e runner and helper scripts (run-e2e.sh, e2e-reset-db.sh)
deploy/       # Deployment artifacts (docker-compose, env templates, etc.)
```

### Back-end projects (current)

| Project | Purpose |
|---|---|
| `Filament.Core` | Domain model, business logic, service abstractions, identifier generation |
| `Filament.Api` | ASP.NET HTTP host: controllers, DTOs, mapping, PDF generation, WebSocket hub |
| `Filament.Infrastructure` | EF Core entities, migrations, repository implementations, DI registration |
| `Filament.Core.Tests` | Unit tests for `Filament.Core` business logic |
| `e2e/` | Playwright functional tests (Node + TypeScript); runs the full stack in containers |

### AI artifacts

| Path | Purpose |
|---|---|
| `.opencode/opencode-instructions.md` | Repository-wide OpenCode context loaded automatically by OpenCode in every session |
| `.opencode/instructions/*.instructions.md` | Granular, path-scoped instructions — use `applyTo` front-matter to target specific directories or file globs |
| `.opencode/prompts/*.prompt.md` | Reusable prompt files for common, repeatable tasks. Invoke in OpenCode Chat via `#` or the prompt picker |

**Rule of thumb:**
- Keep *project overview, tech stack, and use cases* in `opencode-instructions.md`.
- Keep *layer-specific coding patterns* (naming, testing style, architecture rules) in the matching `instructions/` file.
- Keep *step-by-step task workflows* (e.g. "add a new endpoint") as `prompts/` files so any team member can reuse them.


## Expected use cases (not all are listed)

* Create filament type
* Delete filament type (if no spools are present)
* Display filament type, including spools, with already finished spools displayable by a toggle "display also finished".
* Create a spool based on a filament type
* Delete a spool (this should be used in rare case when the spool is created by a mistake)
* Display a spool with detail - weight, weight including spool, projects printed by this spool, the ability to add another project and lower the filament weight by that.
* Display a dashboard with number of spools, recent changes into the stock, there can be graphs used to display that.

Keep in mind that all display and edit operations must be also usable from a desktop as well as from the cellphone.

