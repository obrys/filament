#!/usr/bin/env bash
set -euo pipefail

# --- Configuration -----------------------------------------------------------
NETWORK="filament-e2e"
DB="filament-e2e-db"
API="filament-e2e-api"
WEB="filament-e2e-web"
API_PORT="${E2E_API_PORT:-18080}"
WEB_PORT="${E2E_WEB_PORT:-15173}"
READY_TIMEOUT="${E2E_READY_TIMEOUT:-90}"

# Resolve repo root (parent of scripts/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# --- Container CLI detection ------------------------------------------------
source "$SCRIPT_DIR/e2e-cli.sh"
detect_cli

# --- Teardown (best-effort, never fails the script) -------------------------
teardown() {
  "${E2E_CLI[@]}" rm -f "$DB" "$API" "$WEB" >/dev/null 2>&1 || true
  "${E2E_CLI[@]}" network rm "$NETWORK" >/dev/null 2>&1 || true
}
trap teardown EXIT

# Pre-clean any leftovers from a previous failed run
teardown

# --- Port-in-use guard -------------------------------------------------------
port_in_use() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltn "sport = :$port" 2>/dev/null | grep -q ":$port" && return 0
  fi
  curl -fs "http://localhost:$port/" >/dev/null 2>&1 && return 0
  return 1
}
if port_in_use "$API_PORT"; then
  echo "ERROR: Port $API_PORT is already in use. Set E2E_API_PORT to override." >&2
  exit 1
fi
if port_in_use "$WEB_PORT"; then
  echo "ERROR: Port $WEB_PORT is already in use. Set E2E_WEB_PORT to override." >&2
  exit 1
fi

# --- Build images ------------------------------------------------------------
echo "Building API image..."
"${E2E_CLI[@]}" build -f src/Filament.Api/Dockerfile -t filament-e2e-api .
echo "Building Web image..."
"${E2E_CLI[@]}" build -f web/Dockerfile -t filament-e2e-web web

# --- Create network ----------------------------------------------------------
echo "Creating network $NETWORK..."
"${E2E_CLI[@]}" network create "$NETWORK" >/dev/null

# --- Start DB ----------------------------------------------------------------
echo "Starting DB container..."
"${E2E_CLI[@]}" run -d --rm --name "$DB" --network "$NETWORK" \
  -e MARIADB_DATABASE=filament \
  -e MARIADB_USER=filament \
  -e MARIADB_PASSWORD=filament \
  -e MARIADB_ROOT_PASSWORD=rootpw \
  --health-cmd='healthcheck.sh --connect --innodb_initialized' \
  --health-interval=3s \
  --health-timeout=5s \
  --health-retries=30 \
  mariadb:11 >/dev/null

# --- Wait for DB health ------------------------------------------------------
echo "Waiting for DB to be healthy..."
elapsed=0
while [ "$elapsed" -lt "$READY_TIMEOUT" ]; do
  status="$("${E2E_CLI[@]}" inspect --format '{{.State.Health.Status}}' "$DB" 2>/dev/null || echo "unknown")"
  if [ "$status" = "healthy" ]; then break; fi
  sleep 3
  elapsed=$((elapsed + 3))
done
if [ "$status" != "healthy" ]; then
  echo "ERROR: DB did not become healthy within ${READY_TIMEOUT}s (last status: $status)." >&2
  echo "Inspect with: ${E2E_CLI[*]} logs $DB" >&2
  exit 1
fi
echo "DB is healthy."

# --- Start API ---------------------------------------------------------------
echo "Starting API container..."
"${E2E_CLI[@]}" run -d --name "$API" --network "$NETWORK" --network-alias api \
  -p "$API_PORT:8080" \
  -e "ConnectionStrings__Filament=Server=$DB;Port=3306;Database=filament;User=filament;Password=filament" \
  -e ASPNETCORE_ENVIRONMENT=Production \
  filament-e2e-api >/dev/null

# --- Start Web ---------------------------------------------------------------
echo "Starting Web container..."
"${E2E_CLI[@]}" run -d --name "$WEB" --network "$NETWORK" \
  -p "$WEB_PORT:8080" \
  filament-e2e-web >/dev/null

# --- Wait for API readiness --------------------------------------------------
echo "Waiting for API readiness at http://localhost:$API_PORT/healthz ..."
elapsed=0
while [ "$elapsed" -lt "$READY_TIMEOUT" ]; do
  if curl -fs "http://localhost:$API_PORT/healthz" 2>/dev/null | grep -q '"ok"'; then
    break
  fi
  sleep 2
  elapsed=$((elapsed + 2))
done
if [ "$elapsed" -ge "$READY_TIMEOUT" ]; then
  echo "ERROR: API did not become ready within ${READY_TIMEOUT}s." >&2
  echo "Inspect with: ${E2E_CLI[*]} logs $API" >&2
  exit 1
fi
echo "API is ready."

# --- Wait for Web readiness --------------------------------------------------
echo "Waiting for Web readiness at http://localhost:$WEB_PORT/ ..."
elapsed=0
while [ "$elapsed" -lt "$READY_TIMEOUT" ]; do
  if curl -fsI "http://localhost:$WEB_PORT/" 2>/dev/null | grep -q '^HTTP.*200'; then
    break
  fi
  sleep 2
  elapsed=$((elapsed + 2))
done
if [ "$elapsed" -ge "$READY_TIMEOUT" ]; then
  echo "ERROR: Web did not become ready within ${READY_TIMEOUT}s." >&2
  echo "Inspect with: ${E2E_CLI[*]} logs $WEB" >&2
  exit 1
fi
echo "Web is ready."

# --- Run Playwright ----------------------------------------------------------
echo "Running Playwright tests..."
cd "$REPO_ROOT/e2e"
TEST_EXIT=0
npx playwright test "$@" || TEST_EXIT=$?

cd "$REPO_ROOT"
if [ "$TEST_EXIT" -eq 0 ]; then
  echo "All e2e tests passed."
else
  echo "e2e tests failed (exit code $TEST_EXIT)." >&2
  echo "Container logs: ${E2E_CLI[*]} logs $API | ${E2E_CLI[*]} logs $WEB | ${E2E_CLI[*]} logs $DB" >&2
fi

exit "$TEST_EXIT"
