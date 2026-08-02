#!/usr/bin/env bash
set -euo pipefail

# Drops and recreates the filament database in a running e2e stack,
# restarts the API so EF migrations re-run, and waits for /healthz.
# Not invoked by the smoke or lifecycle tests; provided for reuse by
# follow-up change requests that need a clean DB mid-suite.

NETWORK="filament-e2e"
DB="filament-e2e-db"
API="filament-e2e-api"
API_PORT="${E2E_API_PORT:-18080}"
READY_TIMEOUT="${E2E_READY_TIMEOUT:-90}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/e2e-cli.sh"
detect_cli

echo "Dropping and recreating database..."
"${E2E_CLI[@]}" exec "$DB" mariadb -ufilament -pfilament \
  -e 'DROP DATABASE IF EXISTS filament; CREATE DATABASE filament;'

echo "Restarting API container..."
"${E2E_CLI[@]}" restart "$API" >/dev/null

echo "Waiting for API readiness at http://localhost:$API_PORT/healthz ..."
elapsed=0
while [ "$elapsed" -lt "$READY_TIMEOUT" ]; do
  if curl -fs "http://localhost:$API_PORT/healthz" 2>/dev/null | grep -q '"ok"'; then
    echo "API is ready."
    exit 0
  fi
  sleep 2
  elapsed=$((elapsed + 2))
done

echo "ERROR: API did not become ready within ${READY_TIMEOUT}s." >&2
exit 1
