# Implementation Plan: 002 Playwright Test Tool

## Approval

Status: approved

Approved by: obrys

Approved on: 2026-08-02

## Summary

Add a self-contained Playwright functional test framework in a new top-level
`e2e/` directory, driven by a bash runner (`scripts/run-e2e.sh`) that brings up
a clean DB + API + web stack in containers (using individual container-CLI
commands, auto-detecting `flatpak-spawn --host podman` / `podman` / `docker`),
waits for readiness, runs Chromium tests, and tears down on exit. Deliver an
initial suite: a smoke test plus a spool-lifecycle suite, both seeded through
the UI via a reusable `seedFixture`. Add a non-blocking `e2e` job to CI.

No application code, Dockerfile, nginx config, or `docker-compose.yml` change
is required. The one critical wiring detail — making the baked-in nginx
upstream `http://api:8080` resolve inside the test network — is handled by a
network alias on the API container, not by editing config.

## Preconditions And Decisions

- `doc/todo/002-playwright-test-tool/specification.md` is `Status: approved`.
- All product/platform decisions are in `doc/todo/002-playwright-test-tool/amendment.md`.
- **Network alias decision (implementation, not product):** the web image's
  `nginx.conf` hardcodes `proxy_pass http://api:8080` (verified in
  `web/nginx.conf:9`). Because the spec forbids modifying app config and the
  web image bakes the config in, the runner starts the API container with
  `--network-alias api` on the `filament-e2e` network. Docker/Podman user-defined
  networks resolve both the container name and any `--network-alias` values, so
  `http://api:8080` resolves to the API container with no image or config change.
- **DB host decision:** the API's connection string is overridden by the
  runner to `Server=filament-e2e-db;...`. The DB container is started with the
  name `filament-e2e-db`, which is itself a network alias on the `filament-e2e`
  network, so the API resolves it. No volume is mounted; `--rm` wipes state on
  removal.
- **Readiness probe decision:** poll `GET http://localhost:18080/healthz`
  (returns `{"status":"ok"}`) for the API, then `GET http://localhost:15173/`
  for the SPA shell (any 200 with a `<div id="root">`). The existing
  `Program.cs` exposes `/healthz`; the existing `index.html` provides the shell.
- **Selectors decision:** the SPA uses plain labelled `<input>`/`<button>`
  elements with no `data-testid`. Tests use Playwright's `getByLabel` and
  `getByRole('button', { name })` locators, which are stable against the
  current markup (verified against `web/src/pages/{FilamentTypes,Spools,
  SpoolDetail,Dashboard}.tsx`). No `data-testid` attributes are added to the
  SPA in this change (out of scope).
- **Test layer decisions:**
  - **Playwright e2e** for all UI behaviour ACs (AC-11, AC-14..AC-18,
    AC-21 is structural). This is the primary layer.
  - **`@playwright/test` "unit" tests** (tests that don't open a page) for
    pure-logic coverage of the `unique()` helper (AC-18). Reusing the same
    test runner avoids adding a second framework.
  - **TypeScript typecheck** (`tsc --noEmit`) for AC-13.
  - **No automated bash tests** for the runner script (AC-1..AC-10). The
    repo has no bash test harness (no bats/shellcheck config). The runner is
    exercised end-to-end by the CI `e2e` job and by manual local runs per
    AC-1..AC-4. This omission is justified by the plan-change skill.
  - **No .NET test changes** (AC-22 explicitly forbids touching
    `tests/Filament.Core.Tests/`).
- **CI runner CLI:** GitHub-hosted `ubuntu-latest` provides `docker` on PATH
  and no `/run/.containerenv`, so the runner's detection selects `docker`
  there. The `e2e` job installs Playwright's Chromium via
  `npx playwright install --with-deps chromium`.

## Implementation Steps

1. `e2e/package.json` (new): `private: true`, `type: "module"`. Dev dependency
   `@playwright/test` (pin to the latest stable, e.g. `^1.48.0`). Scripts:
   - `"e2e": "bash ../scripts/run-e2e.sh"`
   - `"test": "playwright test"`
   - `"report": "playwright show-report"`
   - `"typecheck": "tsc --noEmit"`
   Add `package-lock.json` via `npm install` during implementation (committed).

2. `e2e/tsconfig.json` (new): `strict: true`, `module: "ESNext"`,
   `moduleResolution: "Bundler"`, `target: "ES2022"`, `types: ["node"]`,
   `include: ["tests/**/*.ts", "playwright.config.ts"]`. Needs
   `@types/node` as a dev dependency.

3. `e2e/playwright.config.ts` (new): per the spec's Behavior section.
   - `testDir: './tests'`
   - One project: `{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }`,
     headless.
   - `use: { baseURL: 'http://localhost:15173', trace: 'on-first-retry' }`
   - `workers: Number(process.env.PLAYWRIGHT_WORKERS ?? 1)`
   - `retries: process.env.CI ? 0 : 1`
   - `reporter: process.env.CI ? [['github'], ['html']] : 'list'`
   - **No `webServer`** (the runner manages containers).

4. `e2e/tests/fixtures/ids.ts` (new): `export function unique(prefix: string): string`
   returning `` `${prefix}-${process.pid}-${Date.now()}-${counter++}` `` where
   `counter` is a module-level let incremented each call. The combination of
  pid + timestamp + per-process counter guarantees uniqueness across parallel
   runs and within a run.

5. `e2e/tests/fixtures/seed.ts` (new): export a Playwright fixture via
   `test.extend`:
   ```ts
   import { test as base } from '@playwright/test'
   import { unique } from './ids'

   export type Seed = {
     type: { brand: string; material: string; type: string; color: string }
     spool: { id: string }
   }

   export const test = base.extend<{ seed: Seed }>({
     seed: async ({ page }, use) => {
       const brand = unique('e2e-brand')
       const material = unique('e2e-mat')
       const productType = unique('e2e-type')
       const color = unique('e2e-color')
       // 1. Create filament type via /types UI
       await page.goto('/types')
       await page.getByRole('button', { name: 'New type' }).click()
       await page.getByLabel('Brand').fill(brand)
       await page.getByLabel('Material').fill(material)
       await page.getByLabel('Type').fill(productType)
       await page.getByLabel('Color').fill(color)
       await page.getByRole('button', { name: 'Create', exact: true }).click()
       // 2. Create a spool via /spools UI, selecting the just-created type
       await page.goto('/spools')
       await page.getByRole('button', { name: 'New spool' }).click()
       // The New spool form's <select> lists types as "<id> — <brand> · <material> · <type> · <color>"
       await page.getByLabel('Filament type').selectOption({ label: new RegExp(brand) })
       await page.getByRole('button', { name: 'Create', exact: true }).click()
       // 3. Read the created spool's id from the first row's id-pill link
       const spoolId = await page.locator('tbody tr td a.id-pill').first().innerText()
       await use({ type: { brand, material, type: productType, color }, spool: { id: spoolId } })
     },
   })
   export { expect } from '@playwright/test'
   ```
   Note the spool form does not submit a custom initial weight, so the spool
   inherits the type's `defaultNetWeightGrams` (1000 in the form default), which
   the lifecycle suite relies on for its consume assertion.

6. `e2e/tests/smoke.spec.ts` (new): import `test, expect` from
   `./fixtures/seed`. Test "dashboard and lists reflect UI seeding":
   - `await page.goto('/')`; assert `Filament types`, `Active spools`,
     `Finished spools` all show `0` before seeding. Use
     `expect(page.getByText('Filament types').locator('..')).toContainText('0')`
     (the `Stat` renders label and value in the same `.card`).
   - Use the `seed` fixture (the test signature takes `{ seed }`).
   - `await page.goto('/types')`; assert a row contains `seed.type.brand`
     (`await expect(page.locator('tbody')).toContainText(seed.type.brand)`).
   - `await page.goto('/spools')`; assert a row contains `seed.spool.id`
     and `seed.type.brand`.
   - `await page.goto('/')`; assert `Filament types` shows `1` and
     `Active spools` shows `1`.

7. `e2e/tests/spool-lifecycle.spec.ts` (new): import `test, expect` from
   `./fixtures/seed`. Test "spool open → consume → adjust → finish → dashboard":
   - Use `seed` fixture. Capture `initial` from the spool detail page's
     "Remaining: X g (initial Y g)" line before any action.
   - `await page.goto(`/spools/${seed.spool.id}`)`; wait for the heading
     containing `seed.spool.id` (the page renders `Loading…` until loaded —
     `await expect(page.getByRole('heading', { level: 1 })).toContainText(seed.spool.id)`).
   - **Open:** assert status text is `Sealed` (the `Status:` line). Click
     `Open spool`. Assert status becomes `Open` and a `Opened` muted line
     appears.
   - **Consume:** in the "Record a print" form, fill `Grams used` with
     `100` (less than initial 1000), click `Consume`. Parse the new remaining
     from the "Remaining:" line and assert it equals `initial - 100`.
   - **Adjust:** in the "Adjust remaining (weighed)" form, fill
     `New remaining (g)` with `500`, click `Adjust`. Assert the displayed
     remaining equals `500`.
   - **Finish:** click `Finish spool`. Assert status becomes `Finished` and
     a `Finished` muted line appears.
   - **Dashboard:** `await page.goto('/')`; assert `Active spools` shows `0`
     and `Finished spools` shows `1`.
   - The spec's optional undo step (lifecycle step 7) is included as a
     follow-on assertion in the same test: click `Reopen spool`, assert status
     returns to `Open`. (If flaky, it can be split out, but the page already
     exposes the `Reopen spool` button when finished with an active finish
     event — verified in `SpoolDetail.tsx:78-85`.)

8. `e2e/tests/unique.spec.ts` (new): a pure-logic Playwright test (no page)
   for AC-18:
   - Generate 1000 values via `unique('x')`; assert all are distinct and
     each matches `/^x-\d+-\d+-\d+$/`.
   - Assert two values generated in the same millisecond still differ (the
     counter guarantees this).

9. `scripts/run-e2e.sh` (new, executable bash script). Structure:
   - `set -euo pipefail`.
   - Constants: `NETWORK=filament-e2e`, `DB=filament-e2e-db`,
     `API=filament-e2e-api`, `WEB=filament-e2e-web`,
     `API_PORT=${E2E_API_PORT:-18080}`, `WEB_PORT=${E2E_WEB_PORT:-15173}`,
     `READY_TIMEOUT=${E2E_READY_TIMEOUT:-90}`.
   - **detect_cli()**: implement the spec's order:
     - If `[[ -f /run/.containerenv || -f /.dockerenv ]]` OR `command -v flatpak-spawn >/dev/null`,
       set `CLI=(flatpak-spawn --host podman)`.
     - Else if `command -v podman >/dev/null`, `CLI=(podman)`.
     - Else if `command -v docker >/dev/null`, `CLI=(docker)`.
     - Else `echo` a clear error and `exit 1`.
     - Echo `Using container CLI: ${CLI[*]}`.
   - **teardown()**: best-effort, never fails the script:
     `"${CLI[@]}" rm -f "$DB" "$API" "$WEB" >/dev/null 2>&1 || true`
     then `"${CLI[@]}" network rm "$NETWORK" >/dev/null 2>&1 || true`.
     Registered via `trap teardown EXIT`.
   - **Pre-clean**: run `teardown` logic once before starting (so a previous
     failed run's leftovers don't break this one), then recreate.
   - **Network**: `"${CLI[@]}" network create "$NETWORK" >/dev/null`.
   - **Build**:
     `"${CLI[@]}" build -f src/Filament.Api/Dockerfile -t filament-e2e-api .`
     and `"${CLI[@]}" build -f web/Dockerfile -t filament-e2e-web web`
     (context for the web build is the `web/` dir, matching the existing
     compose `context: ./web`).
   - **Start DB**:
     `"${CLI[@]}" run -d --rm --name "$DB" --network "$NETWORK" \
       -e MARIADB_DATABASE=filament -e MARIADB_USER=filament \
       -e MARIADB_PASSWORD=filament -e MARIADB_ROOT_PASSWORD=rootpw \
       --health-cmd='healthcheck.sh --connect --innodb_initialized' \
       --health-interval=3s --health-retries=30 mariadb:11`
   - **Wait DB healthy**: loop on `"${CLI[@]}" inspect --format '{{.State.Health.Status}}' "$DB"`
     until `healthy`, up to `$READY_TIMEOUT` seconds; else fail.
   - **Start API**:
     `"${CLI[@]}" run -d --name "$API" --network "$NETWORK" --network-alias api \
       -p "$API_PORT:8080" \
       -e ConnectionStrings__Filament="Server=$DB;Port=3306;Database=filament;User=filament;Password=filament" \
       -e ASPNETCORE_ENVIRONMENT=Production filament-e2e-api`
     The `--network-alias api` is the key wiring that lets the baked-in
     nginx upstream `http://api:8080` resolve.
   - **Start Web**:
     `"${CLI[@]}" run -d --name "$WEB" --network "$NETWORK" -p "$WEB_PORT:8080" filament-e2e-web`
     (web Dockerfile `EXPOSE 8080`).
   - **Wait API ready**: poll `curl -fs http://localhost:$API_PORT/healthz`
     (or `wget -qO-`) up to `$READY_TIMEOUT`; expect `{"status":"ok"}`.
   - **Wait Web ready**: poll `curl -fsI http://localhost:$WEB_PORT/` for 200.
   - **Run tests**: `cd e2e && npx playwright test "$@"` (forward extra
     args). Capture the exit code, run teardown, then exit with that code.
   - **Port-in-use guard**: before starting, check `ss -ltn` (or a curl to
     the port) and fail with a named message if `$API_PORT` or `$WEB_PORT` is
     already in use. (Kept simple; if `ss` is unavailable, skip the check.)

10. `scripts/e2e-reset-db.sh` (new, executable): standalone helper for
    AC-21. Reuses the same CLI detection (factor into a small sourced
    `scripts/e2e-cli.sh` so both scripts share `detect_cli`). Then:
    - `"${CLI[@]}" exec "$DB" mariadb -ufilament -pfilament -e \
      'DROP DATABASE IF EXISTS filament; CREATE DATABASE filament;'`
    - `"${CLI[@]}" restart "$API"`
    - Poll `http://localhost:${E2E_API_PORT:-18080}/healthz` until OK, then
      exit 0.
    The smoke/lifecycle tests do not call this; it exists for reuse.

11. `.github/workflows/ci.yml`: add a new job alongside `backend` and
    `frontend`:
    ```yaml
      e2e:
        runs-on: ubuntu-latest
        continue-on-error: true
        steps:
          - uses: actions/checkout@v4
          - uses: actions/setup-node@v4
            with:
              node-version: '22'
              cache: 'npm'
              cache-dependency-path: e2e/package-lock.json
          - run: npm ci
            working-directory: e2e
          - run: npx playwright install --with-deps chromium
            working-directory: e2e
          - run: bash scripts/run-e2e.sh
      ```
    The `continue-on-error: true` makes the job non-blocking (AC-20). The
    existing `backend` and `frontend` jobs are untouched.

12. `e2e/.gitignore` (new): ignore `node_modules/`, `test-results/`,
    `playwright-report/`, `package-lock.json` is **not** ignored (it is
    committed for reproducible CI installs).

13. No changes to `web/`, `src/`, `tests/`, `docker-compose.yml`, the Quadlet
    files, the Dockerfiles, or `web/nginx.conf`. The only files added live
    under `e2e/`, `scripts/`, plus the `ci.yml` edit (AC-22).

## Test Matrix

| Acceptance criterion | Test layer | Test | Expected evidence |
|---|---|---|---|
| AC-1 (clean checkout run builds + starts + waits + tests, exits 0) | Manual + CI run | Run `npm --prefix e2e run e2e` locally and observe the CI `e2e` job | Script prints build/start/readiness lines, then Playwright runs and exits 0. |
| AC-2 (no leftover containers/network after run) | Manual | `docker ps -a \| grep filament-e2e` (and `docker network ls \| grep filament-e2e`) after a successful run | No output. |
| AC-3 (two consecutive runs both succeed) | Manual | Run `npm --prefix e2e run e2e` twice back-to-back | Both exit 0; second unaffected by the first. |
| AC-4 (Ctrl-C tears down) | Manual | Ctrl-C during tests; then `docker ps -a \| grep filament-e2e` | No `filament-e2e-*` containers or network remain. |
| AC-5 (prints resolved CLI) | Manual | Capture script stdout | First non-error line is `Using container CLI: ...`. |
| AC-6 (toolbox → flatpak-spawn --host podman) | Manual (user's Fedora Silverblue toolbox) | Run inside the user's toolbox | Script prints `Using container CLI: flatpak-spawn --host podman` and suite passes. |
| AC-7 (host with podman → podman) | Manual | Run on a host with `podman` on PATH and no toolbox markers | Script prints `Using container CLI: podman`. |
| AC-8 (docker fallback) | CI (GitHub runner uses docker) | The CI `e2e` job | Script prints `Using container CLI: docker` and tests run. |
| AC-9 (no CLI found → fail, no ops) | Manual (synthetic) | Temporarily hide `podman`/`docker` and unset toolbox markers | Script prints the named-CLI error and exits 1 without any `run`/`network` call. |
| AC-10 (polls /healthz, 90s timeout) | Code review + manual | Inspect `scripts/run-e2e.sh` readiness loop | Loop polls `http://localhost:18080/healthz` until `{"status":"ok"}`, fails and tears down after 90s. |
| AC-11 (one chromium project, headless, baseURL 15173) | Playwright config review | `e2e/playwright.config.ts` inspection | Exactly one project named `chromium`; `use.baseURL === 'http://localhost:15173'`. Verified by `npx playwright config` listing projects. |
| AC-12 (e2e package.json + standalone npm ci) | Manual | `npm ci` in `e2e/` with `web/node_modules` absent | Install succeeds; `web/node_modules` untouched; `@playwright/test` present in `e2e/node_modules`. |
| AC-13 (strict TS typechecks) | Typecheck | `npm --prefix e2e run typecheck` (`tsc --noEmit`) | Exits 0. |
| AC-14 (seedFixture creates via UI, returns type+spool) | Playwright | The smoke and lifecycle tests both consume the `seed` fixture and the suite passes | Fixture's returned object is used by both tests to locate the seeded type/spool; tests pass. Structural: `e2e/tests/fixtures/seed.ts` uses only `page.goto/ByLabel/ByRole` (no direct API). |
| AC-15 (smoke: zero counts → seed → type+spool appear → counts become 1) | Playwright | `smoke.spec.ts` "dashboard and lists reflect UI seeding" | All five assertions in step 6 pass. |
| AC-16 (lifecycle: open → consume → adjust → finish) | Playwright | `spool-lifecycle.spec.ts` "spool open → consume → adjust → finish → dashboard" | Status transitions and remaining-grams assertions in step 7 pass. |
| AC-17 (finished spool counted in Finished, not Active) | Playwright | Same lifecycle test, dashboard assertions | `Active spools` shows `0` and `Finished spools` shows `1`. |
| AC-18 (unique per-test values, parallel-safe) | Playwright "unit" test | `unique.spec.ts` | 1000 generated values are distinct and match the format; two same-millisecond values differ. Structural guarantee of pid+timestamp+counter format covers parallel-run non-collision. |
| AC-19 (CI e2e job) | CI | `.github/workflows/ci.yml` inspection + a triggered run | The `e2e` job runs on push/PR, installs Node 22 + e2e deps + Chromium, runs `bash scripts/run-e2e.sh`. |
| AC-20 (non-blocking) | CI | Workflow run where e2e fails (synthetic) | The overall workflow run conclusion is `success`; backend/frontend jobs pass independently; e2e job shows `neutral`/`failure` with `continue-on-error: true`. |
| AC-21 (e2e-reset-db.sh helper) | Manual | Run `bash scripts/e2e-reset-db.sh` against a running stack, then `curl localhost:18080/healthz` | DB dropped/recreated, API restarted, `/healthz` returns `{"status":"ok"}`, helper exits 0. Not invoked by smoke/lifecycle. |
| AC-22 (no app/compose/Quadlet changes) | Code review | `git diff --stat` of the PR | Only files under `e2e/`, `scripts/`, and `.github/workflows/ci.yml` are modified. |

## Test Commands

~~~text
# Install e2e deps (one-time, creates e2e/package-lock.json)
npm --prefix e2e ci

# Install the Chromium browser binary (one-time, and in CI)
npx --prefix e2e playwright install --with-deps chromium

# Typecheck the e2e TS (AC-13)
npm --prefix e2e run typecheck

# Run only the Playwright tests against an already-running stack (dev loop)
npm --prefix e2e run test

# Full local run: build images, bring up stack, run tests, tear down (AC-1..AC-5)
npm --prefix e2e run e2e

# CI-equivalent: same as above (the CI job just runs `bash scripts/run-e2e.sh`)
bash scripts/run-e2e.sh

# Mid-run DB reset helper (AC-21), only against a running stack
bash scripts/e2e-reset-db.sh
~~~

## Out Of Scope

- Any change to `web/`, `src/`, `tests/Filament.Core.Tests/`,
  `docker-compose.yml`, the Quadlet files, the Dockerfiles, or
  `web/nginx.conf`.
- Adding `data-testid` attributes to the SPA (tests use label/role
  locators against the current markup).
- Browser projects beyond Chromium; the `webServer` Playwright option;
  parallel workers > 1 by default.
- The last-used-ordering lifecycle assertion (gated on 001-sorting, per
  the spec's Constraints).
- HTML report artifact upload in CI; Playwright trace/retry tuning beyond
  the defaults.
- A bash unit-test framework (bats/shellcheck); the runner is verified
  end-to-end via CI and manual runs.

## Risks And Rollback Notes

- **Risk: nginx upstream `http://api:8080` not resolving in tests.**
  Mitigated by `--network-alias api` on the API container in the
  `filament-e2e` network. Verified by the smoke test (the SPA's `/api/` calls
  must succeed for any seeded data to appear). No image/config change.
- **Risk: host ports 18080/15173 in use.** Mitigated by a startup port-in-use
  guard and `E2E_API_PORT`/`E2E_WEB_PORT` env overrides. CI runners are clean.
- **Risk: flaky UI locators after SPA changes.** Tests use semantic locators
  (`getByLabel`, `getByRole('button', { name })`) that are stable against the
  current markup. A future SPA refactor that renames labels/buttons would
  surface as a clear test failure rather than a silent skip; that is the
  intended behaviour of a functional regression suite.
- **Risk: DB healthcheck timing on slow CI.** `--health-interval=3s` with 30
  retries gives ~90s headroom; matches the readiness timeout. The readiness
  loop separately waits for `/healthz`, so a slow MariaDB init is tolerated.
- **Risk: `--rm` containers not removed on `kill` (SIGKILL).** A normal
  Ctrl-C (SIGINT) triggers the `trap`. A `kill -9` of the script could leave
  containers; the pre-clean step at the top of the next run removes leftovers,
  so recovery is automatic (AC-3).
- **Risk: nested-container limitation on Silverblue.** The CLI auto-detection
  routes through `flatpak-spawn --host podman` inside a toolbox. If the host
  lacks podman, the script fails clearly. No fallback to `docker` inside a
  toolbox (docker is not typically present there).
- **Rollback:** the entire change is additive. Reverting the commit removes
  the `e2e/` and `scripts/` files and the one CI job; no migration, no schema,
  no app behaviour change to undo. The `filament-e2e-api`/`filament-e2e-web`
  images and any leftover test containers can be removed with
  `docker/podman rm -f` and `network rm filament-e2e`.
