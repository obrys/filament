# 002 Playwright Test Tool

## Approval

Status: approved
Approved by: obrys
Approved on: 2026-08-02

## Purpose

Introduce a Playwright-based functional test framework integrated into the
repository, runnable locally and in CI, that exercises the deployed
Filament application (frontend + backend + database) in containers. The
framework brings up a clean application stack, seeds baseline data through
the UI, and runs a smoke test plus a small spool-lifecycle suite. Test
failures do not block deployment.

## Scope

- Adds a new top-level `e2e/` directory with its own `package.json`,
  `tsconfig.json` (strict), `playwright.config.ts`, and TypeScript test
  files.
- Adds a bash runner script under `scripts/` (e.g. `scripts/run-e2e.sh`)
  that builds and starts the DB, API, and web containers with individual
  container-CLI commands; waits for readiness; runs Playwright; tears
  everything down on exit.
- Adds a `seedFixture` (Playwright fixture) that creates baseline filament
  types and spools through the UI and returns their identifying values.
- Adds a smoke test and a spool-lifecycle suite.
- Adds a new non-blocking `e2e` job to `.github/workflows/ci.yml`.
- Reuses the existing `web/Dockerfile` and `src/Filament.Api/Dockerfile`
  and the upstream `mariadb:11` image.

## Out Of Scope

- New application code or new test-only HTTP endpoints. All test actions go
  through the existing public UI and API.
- Changes to the existing `docker-compose.yml` or the production Quadlet
  deployment files.
- Browser projects other than Chromium.
- A `WebApplicationFactory`-style in-process .NET harness.
- Performance, load, accessibility (a11y), or visual-regression testing.
- Tests for the dashboard usage chart, label PDF generation, WebSocket
  reconnect, or maintenance re-evaluate beyond any assertion the lifecycle
  suite naturally makes.
- Modifying the existing backend or frontend unit tests.

## Behavior

### Runner script (`scripts/run-e2e.sh`)

1. **Detect the container CLI**, in this order:
   - If `/run/.containerenv` or `/.dockerenv` exists, or `flatpak-spawn` is
     on PATH (signals a Fedora Silverblue toolbox), use
     `flatpak-spawn --host podman` as the CLI.
   - Else if `podman` is on PATH, use `podman`.
   - Else if `docker` is on PATH, use `docker`.
   - Else print a clear error listing what was looked for and exit non-zero.
   The resolved CLI is echoed once at the start of the run.
2. **Build images** for API and web using the resolved CLI and the existing
   Dockerfiles, tagging them `filament-e2e-api` and `filament-e2e-web`. If
   the images already exist with matching tags, the build is still run
   (ensures fresh code); the script does not skip on tag presence.
3. **Create a dedicated container network** named `filament-e2e` (removed
   on exit).
4. **Start the DB container** `filament-e2e-db` from `mariadb:11` with:
   - `MARIADB_DATABASE=filament`, `MARIADB_USER=filament`,
     `MARIADB_PASSWORD=filament`, `MARIADB_ROOT_PASSWORD=rootpw`
     (mirroring `docker-compose.yml`).
   - No mounted volume, `--rm` so removal wipes state.
   - Not published to the host; reachable only on the `filament-e2e`
     network.
5. **Start the API container** `filament-e2e-api` from `filament-e2e-api`
   with `ConnectionStrings__Filament` pointing at `filament-e2e-db` over
   the network, `ASPNETCORE_ENVIRONMENT=Production`, and host port
   `18080:8080`. It depends on the DB being healthy; the script polls the
   DB healthcheck before starting the API.
6. **Start the web container** `filament-e2e-web` from `filament-e2e-web`
   with host port `15173:80`, on the `filament-e2e` network.
7. **Wait for readiness**: poll `http://localhost:18080/healthz` until it
   returns `{"status":"ok"}` (up to a configurable timeout, default 90s),
   then poll `http://localhost:15173/` until it returns the SPA shell. If
   either times out, the script fails and tears down.
8. **Run the tests**: `npx playwright test` from the `e2e/` directory,
   passing through `--project=chromium` (the only project). The script
   forwards any extra arguments it receives to `npx playwright test`.
9. **Tear down** on exit (including errors and Ctrl-C) via a bash `trap`:
   stop and `rm` the three containers, remove the `filament-e2e` network.
   The `--rm` flag on the DB container ensures its ephemeral state is
   wiped. API and web containers are stateless images.
10. **Exit code**: non-zero if any step (build, start, readiness, tests)
    fails; zero only if tests pass. The script never leaves containers
    running on success or failure.
11. **Logging**: each major step prints a labelled line (CLI resolved,
    building, starting each container, readiness OK, running tests,
    teardown). Container logs are not streamed during the run but the
    script prints the command to retrieve them on failure.

### Mid-run database wipe helper

A separate helper script `scripts/e2e-reset-db.sh` (or a function inside
the runner invokable on demand) is provided for tests that need a clean
DB mid-suite:

- It runs `mariadb -e 'DROP DATABASE filament; CREATE DATABASE filament;'`
  inside the DB container via `$CONTAINER_CLI exec`.
- It then restarts the API container (e.g. `$CONTAINER_CLI restart
  filament-e2e-api`) so EF Core re-runs migrations against the empty DB.
- It waits for `/healthz` again before returning.
- The initial smoke and lifecycle tests do **not** call this helper;
  isolation comes from unique per-test values. The helper exists so
  follow-up change requests can reuse it without rebuilding the framework.

### Playwright configuration (`e2e/playwright.config.ts`)

- `testDir` points at `e2e/tests`.
- A single project named `chromium` using the bundled Chromium channel,
  headless.
- `baseURL`: `http://localhost:15173`.
- `webServer`: **not** used — the runner starts the containers, not
  Playwright. (`webServer` would conflict with the containerized stack.)
- `workers`: 1 by default (the lifecycle suite shares a single seeded
  spool and asserts ordered UI state). Configurable via `PLAYWRIGHT_WORKERS`
  for parallel runs in follow-up changes.
- `retries`: 0 in CI, 1 locally (overridable via `--retries`).
- `reporter`: `list` locally; `html` and `github` in CI (selected via the
  `CI` env var, following Playwright defaults).
- `use.traceURL` enabled so failed runs record a trace under
  `e2e/test-results/`.

### Seed fixture (`e2e/tests/fixtures/seed.ts`)

- Exports a Playwright `test.extend` fixture named `seedFixture` (or a
  shared `seed` object exposed via `fixtures.ts`).
- When a test depends on the fixture, it:
  1. Navigates to `/types` and creates one filament type through the "New
     type" form using unique, run-prefixed values for brand, material,
     product type, and colour (e.g. `e2e-<timestamp>-brand`).
  2. Navigates to `/spools` and creates one spool from that type through
     the "New spool" form.
  3. Returns an object `{ type: {brand, material, type, color, id?},
     spool: {id} }` capturing the values used and the spool ID read from
     the UI after creation.
- The fixture runs once per test that requests it (not shared across
  tests), so each test gets its own seeded type and spool. Tests that need
  more than one spool create additional spools inline using the same
  unique-value helper.

### Unique-value helper (`e2e/tests/fixtures/ids.ts`)

- Exports `unique(prefix: string)` returning `prefix + '-' + process.pid +
  '-' + Date.now()` (or a per-test counter) so brand/material/colour and
  project names never collide across tests or concurrent runs.

### Smoke test (`e2e/tests/smoke.spec.ts`)

1. Navigate to `/` and assert the dashboard heading and zero-state counts
   render (Filament types: 0, Active spools: 0, Finished spools: 0) before
   seeding.
2. Use `seedFixture` to create one type and one spool via the UI.
3. Navigate to `/types` and assert the seeded type appears in the list
   (matched by its unique brand value).
4. Navigate to `/spools` and assert the seeded spool appears in the list
   (matched by its ID and the type's brand value).
5. Navigate to `/` and assert the dashboard counts now read Filament types:
   1, Active spools: 1.

### Lifecycle suite (`e2e/tests/spool-lifecycle.spec.ts`)

Uses `seedFixture` and then performs, all through the UI on
`/spools/:id` (the spool detail page):

1. **Open**: assert the spool's status is `Sealed`, trigger the Open
   action, assert the status becomes `Open` and the "Opened ..." line
   appears.
2. **Consume**: record a print of a positive whole number of grams less
   than the initial net weight, then assert the remaining-grams display
   decreased by exactly that amount.
3. **Adjust**: set a new remaining value via the Adjust form, then assert
   the displayed remaining grams equals the new value.
4. **Finish**: trigger Finish, assert the status becomes `Finished` and the
   "Finished ..." line appears.
5. **Dashboard**: navigate to `/` and assert the spool no longer counts as
   active (Active spools excludes it; Finished spools includes it).
6. **Last-used ordering**: from step 2's consumption, the spool's
   `lastUsedAt` (AC-9 of 001-sorting, once that change is implemented)
   moves forward. This assertion is gated on the sorting feature being
   merged; until then the lifecycle suite asserts only the per-spool
   lifecycle transitions and dashboard counts. (See "Constraints And
   Dependencies".)
7. **Undo** (optional in the initial suite): disable the Finish event via
   the spool's event history UI and assert the spool returns to `Open`.

### CI integration (`.github/workflows/ci.yml`)

- A new job `e2e` runs on `ubuntu-latest`, on `push` to `main` and on
  `pull_request`, matching the existing trigger.
- Steps: checkout, setup Node 22, `npm ci` inside `e2e/`,
  `npx playwright install --with-deps chromium`, then
  `bash scripts/run-e2e.sh`.
- The job sets `continue-on-error: true` so a failure does not block the
  backend/frontend jobs or any deployment pipeline that consumes the
  workflow run status. The job's own conclusion shows as `neutral`/`failure`
  but the workflow run is not marked failed by it.
- The job does not upload the Playwright HTML report as an artifact in the
  initial change; follow-up change requests may add it.

## Rules And Edge Cases

- The runner never leaves containers running. A Ctrl-C or unexpected exit
  triggers the teardown trap.
- Re-running `npm run e2e` succeeds from any prior state: the teardown
  removes leftovers, and the build step rebuilds images. A previous failed
  run with leftover containers does not break the next run.
- The runner fails fast and clearly if no supported container CLI is found.
- Image builds use the existing Dockerfiles and the repo root as context;
  no new Dockerfiles are added.
- The DB container has no persistent volume; its removal fully wipes the
  database. No host directory is mounted for data.
- Tests do not assume any pre-existing data; the only shared assumption is
  the empty migrated database the API starts against.
- Each test's seeded values are unique across runs (process id + timestamp
  + counter), so two CI runs or a local+CI run cannot collide on
  brand/material/colour or spool identity.
- Tests do not modify the database outside the UI/API. No direct SQL is
  run by tests; the only direct DB access is the optional mid-run reset
  helper, which the initial tests do not call.
- Browser: only Chromium. Running the suite requires only the Chromium
  browser binary installed by `npx playwright install --with-deps chromium`.
- The runner uses host ports `18080` (API) and `15173` (web). If those are
  already in use, the runner fails with a message naming the conflicting
  port; it does not silently pick another port. (Overridable via env vars
  `E2E_API_PORT` and `E2E_WEB_PORT` for environments where the defaults
  clash.)
- The e2e `package.json` scripts include `e2e` (full run via the bash
  script), `test` (just `playwright test`, for re-running against an
  already-running stack during development), and `report` (opens the last
  HTML report).

## Acceptance Criteria

1. Running `npm --prefix e2e run e2e` from a clean checkout, with no
   containers running, builds the API and web images, starts the DB, API,
   and web containers, waits for `/healthz` and the SPA shell, runs the
   Playwright suite, and exits 0 when all tests pass.
2. After the run from AC-1, `podman ps -a` (or `docker ps -a`) shows no
   `filament-e2e-*` containers and no `filament-e2e` network remain.
3. Running `npm --prefix e2e run e2e` twice in succession both succeeds;
   the second run is not affected by containers or data left from the
   first.
4. Interrupting the run with Ctrl-C during the tests removes all
   `filament-e2e-*` containers and the `filament-e2e` network before the
   shell returns.
5. The runner prints the resolved container CLI at the start of the run
   (e.g. `Using container CLI: flatpak-spawn --host podman`).
6. When executed inside a Fedora Silverblue toolbox (detected via
   `/run/.containerenv` or `flatpak-spawn` on PATH), the runner uses
   `flatpak-spawn --host podman` for every container operation and the
   suite passes.
7. When executed on a host where `podman` is on PATH and no toolbox is
   detected, the runner uses `podman` directly.
8. When `podman` is absent but `docker` is on PATH and no toolbox is
   detected, the runner uses `docker` and the suite passes.
9. When neither `podman` nor `docker` is available and no toolbox is
   detected, the runner exits non-zero with a message naming both CLIs it
   looked for and performs no container operations.
10. The runner polls `http://localhost:18080/healthz` and does not start
    the test suite until it returns `{"status":"ok"}`. If `/healthz` does
    not become healthy within 90 seconds, the runner fails and tears down.
11. The Playwright config defines exactly one project named `chromium` that
    uses the Chromium browser, headless, against `baseURL
    http://localhost:15173`.
12. The `e2e/` directory contains its own `package.json` listing
    `@playwright/test` as a dev dependency and a `playwright.config.ts`
    that references `e2e/tests`. Running `npm ci` inside `e2e/` succeeds
    without touching `web/node_modules`.
13. `e2e/tsconfig.json` enables `strict: true`; the TypeScript test files
    type-check under `tsc --noEmit` from `e2e/`.
14. A `seedFixture` is exported from `e2e/tests/fixtures/seed.ts`. A test
    that depends on it receives an object describing the created filament
    type (brand, material, type, color) and spool (id). The fixture
    creates both via the UI (the `/types` and `/spools` "New ..." forms),
    not via direct API calls.
15. The smoke test (`e2e/tests/smoke.spec.ts`) navigates to `/`, asserts
    zero dashboard counts before seeding, uses `seedFixture`, and then
    asserts the seeded type appears on `/types` and the seeded spool
    appears on `/spools`, and that the dashboard counts became types: 1
    and active spools: 1.
16. The lifecycle suite (`e2e/tests/spool-lifecycle.spec.ts`) uses
    `seedFixture` and, through the spool detail UI, opens a sealed spool
    and asserts status `Open`; records a print and asserts remaining grams
    decreases by the consumed amount; adjusts the remaining value and
    asserts the displayed remaining matches; finishes the spool and
    asserts status `Finished`.
17. After finishing the spool in AC-16, the lifecycle suite navigates to
    `/` and asserts the spool is counted in Finished spools and not in
    Active spools.
18. Each test in the smoke and lifecycle suites uses unique, run-prefixed
    values (via the `unique()` helper) for brand, material, product type,
    and colour, so the same suite run twice in parallel against the same
    clean DB does not produce conflicting rows.
19. `.github/workflows/ci.yml` contains an `e2e` job that runs on push to
    `main` and on pull requests, installs Node 22 and the e2e
    dependencies, runs `npx playwright install --with-deps chromium`, and
    then runs `bash scripts/run-e2e.sh`.
20. The `e2e` CI job has `continue-on-error: true`. A failing e2e run does
    not cause the overall workflow run to be marked failed, and the
    backend and frontend jobs are unaffected by the e2e job's result.
21. A helper `scripts/e2e-reset-db.sh` exists that, against a running
    `filament-e2e` stack, drops and recreates the `filament` database via
    `$CONTAINER_CLI exec` on the DB container, restarts the API container,
    waits for `/healthz`, and exits 0. It is callable standalone but is
    not invoked by the smoke or lifecycle tests.
22. No file under `src/`, `tests/Filament.Core.Tests/`, or the existing
    `docker-compose.yml` or Quadlet files is modified by this change. The
    only files added live under `e2e/`, `scripts/`, and the one-line
    addition to `.github/workflows/ci.yml`.

## Constraints And Dependencies

- Depends on the existing `web/Dockerfile` and
  `src/Filament.Api/Dockerfile` building successfully; these are not
  modified.
- Depends on EF Core auto-running migrations at API startup (documented in
  `doc/spec/architecture.md`) to make the empty DB usable with no extra
  seeding step.
- The lifecycle suite's last-used ordering assertion is gated on the
  sorting feature (change request 001-sorting). Until 001-sorting is merged
  and exposes `lastUsedAt`, the lifecycle suite asserts only lifecycle
  transitions and dashboard counts (AC-16 and AC-17). When 001-sorting
  lands, a follow-up may add an ordering assertion; this change does not
  block on it.
- Requires Node 22 (matches `web/`) and the Playwright Chromium browser
  binary, installed via `npx playwright install --with-deps chromium`.
- Requires one of: a Fedora Silverblue toolbox with `flatpak-spawn` and
  host podman available; `podman` on PATH; or `docker` on PATH.
- Host ports `18080` and `15173` must be free (overridable via
  `E2E_API_PORT` and `E2E_WEB_PORT`).
- CI runs on `ubuntu-latest`; the GitHub Actions runner image provides
  `podman` or `docker` (the runner's detection picks whichever is
  available; on GitHub runners `docker` is present).
- The e2e suite is independent of the SPA's `vite` dev server; it always
  runs against the containerized production build.

## Decisions

- E2E lives in a top-level `e2e/` with its own `package.json`. See
  `amendment.md` Q1.
- Node + TypeScript using `@playwright/test`. See `amendment.md` Q2.
- Individual container commands (no `docker compose`); reuse existing
  Dockerfiles and `mariadb:11`. See `amendment.md` Q3.
- DB wipe via container removal (no volume, `--rm`); optional mid-run wipe
  via `mariadb` `DROP/CREATE DATABASE` + API container restart. See
  `amendment.md` Q4.
- Chromium only. See `amendment.md` Q5.
- Bash runner script + `npm run e2e` task. See `amendment.md` Q6.
- New non-blocking `e2e` CI job (`continue-on-error: true`). See
  `amendment.md` Q7.
- UI-driven `seedFixture`. See `amendment.md` Q8.
- Initial scope: framework + smoke + lifecycle suite. See `amendment.md`
  Q9.
- Isolation via unique per-test values, no wipe between tests. See
  `amendment.md` Q10.
- Container CLI auto-detection: toolbox → `flatpak-spawn --host podman`;
  else `podman`; else `docker`; else fail. See `amendment.md` Q11.
- Test ports: API `18080`, web `15173`, DB unpublished; overridable via
  env vars. Recorded as an assumption in `amendment.md`.
- No application code or new endpoints are added; wipe uses container-level
  operations only. Recorded as an assumption in `amendment.md`.

## Open Questions

None. All decisions are resolved in `amendment.md`. The only deferred item
is the optional last-used-ordering assertion in the lifecycle suite, which
is explicitly gated on the 001-sorting change and does not block this
specification.
