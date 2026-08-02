# Amendment — 002 Playwright Test Tool

Records the questions raised during refinement of `README.md`, the answers
accepted by the user, the assumptions taken, and references consulted.
The original `README.md` is not modified.

## Answers to clarifying questions

1. **Where Playwright tests and config live.**
   Answer: a new top-level `e2e/` directory at the repository root, with its
   own `package.json`, `tsconfig.json`, and `playwright.config.ts`. E2E
   tooling is kept separate from the SPA's build (`web/`).

2. **Playwright runtime/language.**
   Answer: Node.js + TypeScript, using `@playwright/test`. Matches the SPA
   stack and the frontend coding instructions (strict TS).

3. **How the test stack is brought up.**
   Answer: the runner uses **individual container commands** (not
   `docker compose`). It reuses the existing `src/Filament.Api/Dockerfile`
   and `web/Dockerfile` to build the api and web images, and uses the
   upstream `mariadb:11` image for the database. The three containers share
   a dedicated podman network created by the runner. This avoids the
   nested-container limitation of Fedora Silverblue + toolbox, where
   `docker compose`-style orchestration cannot start containers from inside
   a toolbox.

4. **Database wipe mechanism.**
   Answer: between full runs, the DB container is removed (started with no
   persistent volume, so removal wipes inner state) and re-created empty;
   the API re-runs EF migrations on startup. Within a run, if a test needs a
   clean database, the runner provides a helper that invokes the mariadb
   client via `$CONTAINER_CLI exec` to `DROP DATABASE filament; CREATE
   DATABASE filament;` and then restarts the API container so migrations
   re-run. The initial smoke and lifecycle tests do not require mid-run
   wipes; isolation comes from unique per-test values (see #11).

5. **Browser coverage.**
   Answer: Chromium only. One Playwright project. Keeps CI minutes low and
   matches the trusted-LAN internal-app context.

6. **Runner script shape.**
   Answer: a bash script under `scripts/` (e.g. `scripts/run-e2e.sh`) that
   brings up the containers, waits for readiness, runs `npx playwright
   test`, and tears the containers down on exit (trap). It is invoked via an
   npm script in `e2e/package.json` (e.g. `npm run e2e` →
   `bash ../scripts/run-e2e.sh`).

7. **CI integration.**
   Answer: a new `e2e` job added to `.github/workflows/ci.yml`, with
   `continue-on-error: true` so a test failure does not block the
   backend/frontend jobs or deployment, matching the request wording "The
   failure shouldn't be blocking the deployment."

8. **Seed data approach.**
   Answer: a UI-driven Playwright fixture (`seedFixture`) that creates a
   known baseline (at least one filament type and one spool) through the
   browser. The fixture returns identifying values (brand/material/color
   used, and the generated spool ID seen in the UI). Other tests extend the
   fixture. This makes the seed reusable, as the request requires
   ("initial seeding should be written separately, so it can be reused").

9. **Initial scope.**
   Answer: the change request delivers the framework plus a smoke test plus
   a small lifecycle suite (create type → create spool → open → consume →
   finish, with dashboard/list observations). Additional feature tests are
   deferred to follow-up change requests.

10. **Isolation strategy.**
    Answer: each test generates unique, timestamp- or run-prefixed values
    for brand, material, product type, and colour, so concurrent or
    sequential runs never collide. No wipe is required between tests.

11. **Container CLI mechanism (follow-up).**
    Answer: the runner detects the runtime environment:
    - If it detects it is running inside a container (toolbox / podman
      container), it uses `flatpak-spawn --host podman <cmd>` to reach the
      host's podman.
    - Otherwise, if `podman` is available on PATH, it uses `podman` directly.
    - Otherwise, if `docker` is available on PATH, it uses `docker`.
    - Otherwise, the runner fails with a clear message explaining what it
      looked for.

    Detection of "inside a container" uses the standard
    `/.dockerenv` / `/run/.containerenv` / `flatpak-spawn` presence signals
    (Fedora Silverblue toolboxes expose `/run/.containerenv`). The chosen
    command is used for all `$CONTAINER_CLI run|exec|rm|network|build|stop`
    invocations and is echoed once at the start of the run for clarity.

## Assumptions accepted

- The web container in tests serves the production SPA build (same
  `web/Dockerfile` as deployment), and the API container runs the Release
  build of `Filament.Api`. Tests run against built images, not `vite dev`,
  so they exercise the deployment topology as closely as practical.
- Test ports are fixed and chosen to avoid the dev defaults: API on host
  port `18080`, web on host port `15173` (mapped to the container's
  internal `80`). The DB container is not published to the host (the API
  reaches it over the dedicated podman network).
- The DB container is started with no mounted volume and `--rm`, so its
  removal wipes state. EF Core runs the existing migrations automatically
  at API startup (`doc/spec/architecture.md`), so a freshly created empty
  DB is migrated on first API connect; the runner waits for `/healthz` to
  confirm readiness.
- The container network is named `filament-e2e` and is created and removed
  by the runner. The three containers use stable names within that network:
  `filament-e2e-db`, `filament-e2e-api`, `filament-e2e-web`. The API's
  connection string is overridden via env (`Server=filament-e2e-db;...`).
- Playwright's `baseURL` is `http://localhost:15173`, matching the web
  container's published host port. Tests use relative paths (`/`,
  `/spools`, etc.) against this `baseURL`.
- The smoke and lifecycle tests rely only on existing public UI/API
  behaviour. **No application code or new test-only endpoints are added.**
  Mid-run wipe (if ever needed) uses container-level operations only.
- The e2e package's `npm run e2e` script shells out to the runner; the
  runner is the single entry point for both local and CI use.
- The e2e `package.json` is independent: it does not share `node_modules`
  with `web/`. CI installs it in a separate job step.
- TypeScript strict mode is enabled in `e2e/tsconfig.json`, following
  `.opencode/instructions/frontend.instructions.md`.

## Open decisions

None outstanding. All product and platform decisions required for a
testable spec are resolved above. (Implementation details such as the
exact bash structure of the runner and the Playwright fixture API are left
to the implementation plan.)

## References consulted

- `doc/todo/002-playwright-test-tool/README.md` — the immutable original
  request.
- `doc/spec/application-overview.md` — user capabilities the suite must
  exercise (create types/spools, open/consume/finish, dashboard).
- `doc/spec/interfaces.md` — browser routes (`/`, `/types`, `/spools`,
  `/spools/:id`), `/healthz`, and the JSON API used by the SPA.
- `doc/spec/domain-rules.md` — lifecycle states and the
  `includeFinished` default, used by the lifecycle suite assertions.
- `doc/spec/architecture.md` — three-container topology, EF auto-migration
  at API startup, and the existing Dockerfiles that the runner reuses.
- `docker-compose.yml` — service names, env vars, and the `mariadb:11`
  image the runner mirrors.
- `web/Dockerfile` and `src/Filament.Api/Dockerfile` — images reused by
  the runner.
- `.github/workflows/ci.yml` — existing backend/frontend jobs the new
  non-blocking e2e job is added alongside.
- `.opencode/instructions/frontend.instructions.md` — TypeScript strict
  mode and `web/` conventions applied to `e2e/` as well.
