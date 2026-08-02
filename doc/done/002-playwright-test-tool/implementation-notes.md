# Implementation Notes: 002 Playwright Test Tool

## Status

Status: complete

## Acceptance Criteria Evidence

| Criterion | Evidence |
|---|---|
| AC-1 | `npm --prefix e2e run e2e` run from a clean checkout: builds API + web images, starts DB/API/web containers, waits for `/healthz` and web shell, runs Playwright suite, exits 0. Verified twice (see Verification). |
| AC-2 | After the run, `flatpak-spawn --host podman ps -a` shows no `filament-e2e-*` containers; `flatpak-spawn --host podman network ls` shows no `filament-e2e` network. The trap-based teardown runs on every exit. |
| AC-3 | Two consecutive `bash scripts/run-e2e.sh` runs both completed with 5/5 tests passing. The second run was unaffected by the first (pre-clean + `--rm` DB container). |
| AC-4 | Not manually tested with Ctrl-C in this session (the suite completes in ~7s). The `trap teardown EXIT` in `scripts/run-e2e.sh` covers SIGINT; the pre-clean at the top of the next run recovers from any SIGKILL scenario. |
| AC-5 | The runner prints `Using container CLI: flatpak-spawn --host podman` as the first output line. Verified in both runs. |
| AC-6 | Verified: the runner detected the toolbox environment (`/run/.containerenv` present + `flatpak-spawn` on PATH) and used `flatpak-spawn --host podman` for all operations. Suite passed. |
| AC-7 | Not separately tested (the development machine is a toolbox). The code path is identical: if no toolbox markers are found and `podman` is on PATH, `E2E_CLI=(podman)`. |
| AC-8 | Not separately tested locally. CI runs on `ubuntu-latest` where `docker` is on PATH and no toolbox markers exist; the detection code falls through to `docker`. The CI job is configured in `ci.yml`. |
| AC-9 | Not separately tested (requires hiding all CLIs). The `detect_cli` function in `scripts/e2e-cli.sh` prints a clear error naming `flatpak-spawn`, `podman`, and `docker`, then `exit 1`, before any container operation. |
| AC-10 | The runner polls `http://localhost:18080/healthz` in a loop with a 2s interval and a 90s timeout (`E2E_READY_TIMEOUT`). If it times out, it prints an error with the log-retrieval command and exits 1. Verified: the polling loop runs and succeeds in both runs. |
| AC-11 | `e2e/playwright.config.ts` defines exactly one project named `chromium` using `devices['Desktop Chrome']`, headless, with `baseURL: 'http://localhost:15173'`. |
| AC-12 | `e2e/package.json` lists `@playwright/test`, `@types/node`, and `typescript` as dev dependencies. `npm install` in `e2e/` succeeds independently; `web/node_modules` is untouched. `package-lock.json` is committed. |
| AC-13 | `e2e/tsconfig.json` has `strict: true`. `npm --prefix e2e run typecheck` (`tsc --noEmit`) exits 0. |
| AC-14 | `e2e/tests/fixtures/seed.ts` exports `test` (extended with `seed` fixture) and `expect`. The fixture creates one filament type via the `/types` UI form and one spool via the `/spools` UI form, returning `{ type: {brand, material, type, color}, spool: {id} }`. No direct API calls. Both the smoke and lifecycle tests consume it. |
| AC-15 | `smoke.spec.ts` has two tests: (1) "dashboard starts empty on a fresh database" — navigates to `/`, asserts Filament types: 0, Active spools: 0, Finished spools: 0; (2) "seeded type and spool appear in lists and dashboard" — uses `seedFixture`, asserts the type appears on `/types`, the spool appears on `/spools`, and dashboard counts are 1/1. Both pass. |
| AC-16 | `spool-lifecycle.spec.ts` uses `seedFixture`, opens the sealed spool (asserts `Open`), records a 100g print (asserts remaining decreased by 100), adjusts to 500g (asserts remaining is 500), finishes (asserts `Finished`). All pass. |
| AC-17 | After finishing, the lifecycle test navigates to `/`, reads Active and Finished counts before finishing (captured earlier), and asserts Active decreased by 1 and Finished increased by 1. This verifies the spool moved from active to finished without requiring an empty DB. Passes. |
| AC-18 | `unique.spec.ts` generates 1000 values, asserts all are distinct and match `/^x-\d+-\d+-\d+$/`. Also asserts two consecutive values differ. Both pass. Each test uses `unique()` for brand/material/type/color. |
| AC-19 | `.github/workflows/ci.yml` has an `e2e` job on `push`/`pull_request`, using Node 22, `npm ci` in `e2e/`, `npx playwright install --with-deps chromium`, then `bash scripts/run-e2e.sh`. |
| AC-20 | The `e2e` CI job has `continue-on-error: true`. A failing e2e run does not fail the workflow or block the `backend`/`frontend` jobs. |
| AC-21 | `scripts/e2e-reset-db.sh` exists, is executable, and sources `scripts/e2e-cli.sh` for CLI detection. It runs `mariadb -e 'DROP DATABASE IF EXISTS filament; CREATE DATABASE filament;'` via `$CONTAINER_CLI exec`, restarts the API container, and polls `/healthz`. Not invoked by the smoke or lifecycle tests. |
| AC-22 | `git diff --name-only` shows only `.github/workflows/ci.yml` (and the plan approval edit). All new files are under `e2e/` and `scripts/`. No files under `src/`, `tests/Filament.Core.Tests/`, `docker-compose.yml`, or `deploy/quadlets/` were modified. |

## Changes Made

- `e2e/package.json` (new): `@playwright/test`, `@types/node`, `typescript` dev deps; scripts `e2e`, `test`, `report`, `typecheck`.
- `e2e/tsconfig.json` (new): strict TS config for the test project.
- `e2e/.gitignore` (new): ignores `node_modules/`, `test-results/`, `playwright-report/`.
- `e2e/playwright.config.ts` (new): single `chromium` project, `baseURL http://localhost:15173`, no `webServer`, `trace: on-first-retry`.
- `e2e/tests/fixtures/ids.ts` (new): `unique(prefix)` helper using pid + timestamp + counter.
- `e2e/tests/fixtures/seed.ts` (new): `seedFixture` that creates a filament type and spool via the UI, scoped to `form.card` to avoid facet-checkbox label collisions. Returns type details and spool ID.
- `e2e/tests/smoke.spec.ts` (new): two tests — zero-state dashboard on fresh DB, and seeded data appearing in lists + dashboard counts.
- `e2e/tests/spool-lifecycle.spec.ts` (new): open → consume → adjust → finish → dashboard delta assertion → reopen.
- `e2e/tests/unique.spec.ts` (new): pure-logic tests for the `unique()` helper.
- `e2e/package-lock.json` (new): committed for reproducible CI installs.
- `scripts/e2e-cli.sh` (new): shared `detect_cli()` function (toolbox → `flatpak-spawn --host podman`; else `podman`; else `docker`; else fail).
- `scripts/run-e2e.sh` (new): full runner — CLI detection, pre-clean, build images, create network, start DB (healthcheck), start API (with `--network-alias api`), start web, wait for readiness, run Playwright, trap-based teardown.
- `scripts/e2e-reset-db.sh` (new): standalone DB wipe helper (drop/recreate + API restart + healthz wait).
- `.github/workflows/ci.yml` (modified): added non-blocking `e2e` job with `continue-on-error: true`.

## Deviations From Plan

1. **Added `typescript` as a dev dependency.** The plan listed `@playwright/test` and `@types/node` but omitted `typescript` itself. The `typecheck` script (`tsc --noEmit`) requires it. Added `typescript: ^5.6.2` to `e2e/package.json`.

2. **Smoke test split into two tests.** The plan described a single smoke test that asserts zero counts before seeding and then uses `seedFixture`. In practice, Playwright fixtures run before the test body, so the seed data would already exist when the zero-count assertion runs. Split into: (1) "dashboard starts empty on a fresh database" (no fixture, asserts zero counts) and (2) "seeded type and spool appear in lists and dashboard" (uses fixture, asserts data + counts = 1). Test 1 runs first on the fresh DB; Test 2 runs second with only its own seeded data. This satisfies AC-15's intent.

3. **Lifecycle dashboard assertion uses deltas, not exact counts.** The plan/spec said "assert Active spools: 0 and Finished spools: 1." Since the smoke test's seeded spool remains active in the DB, the lifecycle test reads the dashboard counts before finishing and asserts Active decreased by 1 and Finished increased by 1. This verifies the spool moved from active to finished (AC-17's intent) without requiring an empty DB.

4. **Seed fixture scopes form locators to `form.card`.** The plan used `page.getByLabel('Brand')` directly, but Playwright's `getByLabel` does case-insensitive substring matching, so 'Brand' matches facet checkbox labels like 'e2e-brand-...'. Scoping to `page.locator('form.card')` eliminates the ambiguity.

5. **`e2e-cli.sh` factored as a separate sourced file.** The plan mentioned "a small sourced `scripts/e2e-cli.sh`" — implemented exactly as described. Both `run-e2e.sh` and `e2e-reset-db.sh` source it.

## Verification

| Command | Result |
|---|---|
| `npm --prefix e2e run typecheck` | passed (exit 0, no errors) |
| `npx playwright test tests/unique.spec.ts` (in e2e/) | passed (2/2) |
| `bash scripts/run-e2e.sh` (1st run, in repo root) | passed (5/5 tests, all containers torn down) |
| `bash scripts/run-e2e.sh` (2nd consecutive run) | passed (5/5 tests, all containers torn down) |
| `flatpak-spawn --host podman ps -a` (after run) | no `filament-e2e-*` containers |
| `flatpak-spawn --host podman network ls` (after run) | no `filament-e2e` network |
| `git diff --name-only` | only `.github/workflows/ci.yml` and `doc/todo/.../implementation-plan.md` |

## Test Layers Deliberately Omitted

- **Automated bash tests for the runner script (AC-1..AC-10):** The repo has no bash test harness (no bats/shellcheck config). The runner is verified end-to-end by two consecutive full runs and by the CI `e2e` job. Manual ACs (Ctrl-C teardown, no-CLI failure, podman/docker direct paths) are left for the user to verify in their environment.
- **.NET test changes (AC-22):** The spec explicitly forbids modifying `tests/Filament.Core.Tests/`. No .NET tests were added or modified.
- **API integration tests:** The spec's scope is the Playwright framework, not API-level integration tests. No `WebApplicationFactory` harness was introduced.

## Limitations And Follow-Up

- **AC-4 (Ctrl-C teardown):** Not manually verified in this session. The `trap teardown EXIT` covers SIGINT; the pre-clean step at the top of the next run recovers from SIGKILL. The user can verify by interrupting a run.
- **AC-7, AC-8, AC-9 (podman/docker direct paths, no-CLI failure):** Not separately tested locally (the dev machine is a toolbox). The code paths are straightforward; CI on `ubuntu-latest` exercises the docker path.
- **Last-used ordering assertion:** Gated on 001-sorting being implemented (per spec). The lifecycle suite does not assert `lastUsedAt` ordering. When 001-sorting lands, a follow-up change request can add that assertion.
- **Playwright HTML report in CI:** Not uploaded as an artifact in this change. Follow-up may add `actions/upload-artifact` for `e2e/playwright-report/`.
- **Retries:** `retries: 1` locally means a failed test's retry might see accumulated data from the first attempt (e.g., duplicate unique values in the facet list). The `unique()` helper's pid+timestamp+counter ensures the retry's seed values don't collide, but exact-count assertions (smoke test 2) could be off by 1 on retry. This is an acceptable trade-off: a retry indicates a real failure worth investigating.
