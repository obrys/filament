#!/usr/bin/env bash
# Build the API + web images locally, ship them to the FCOS server via SSH,
# sync Quadlet units, and restart affected services.
#
# Usage:   ./deploy/scripts/deploy.sh user@host
# Example: ./deploy/scripts/deploy.sh filament@192.168.1.50
set -euo pipefail

if [[ $# -ne 1 ]]; then
    echo "Usage: $0 user@host" >&2
    exit 64
fi
TARGET="$1"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

# Use podman if available (Kinoite default), else docker.
ENGINE="${ENGINE:-$(command -v podman || command -v docker)}"
if [[ -z "$ENGINE" ]]; then
    echo "Neither podman nor docker found on PATH." >&2
    exit 1
fi
echo "==> Using container engine: $ENGINE"

API_TAG="localhost/filament-api:latest"
WEB_TAG="localhost/filament-web:latest"

echo "==> Building API image"
"$ENGINE" build -t "$API_TAG" -f src/Filament.Api/Dockerfile .

echo "==> Building Web image"
"$ENGINE" build -t "$WEB_TAG" -f web/Dockerfile web

echo "==> Streaming API image to $TARGET"
"$ENGINE" save "$API_TAG" | ssh "$TARGET" "podman load"

echo "==> Streaming Web image to $TARGET"
"$ENGINE" save "$WEB_TAG" | ssh "$TARGET" "podman load"

echo "==> Syncing Quadlet units"
rsync -av --delete deploy/quadlets/ "$TARGET":~/.config/containers/systemd/

echo "==> Reloading systemd and restarting services"
ssh "$TARGET" bash <<'REMOTE'
set -euo pipefail
systemctl --user daemon-reload

# Ensure db is up first; start everything if this is the first run.
systemctl --user start filament-db.service
# Wait briefly for DB to be healthy before (re)starting the API.
for i in {1..30}; do
    if podman healthcheck run filament-db >/dev/null 2>&1; then break; fi
    sleep 2
done

systemctl --user restart filament-api.service
systemctl --user restart filament-web.service

# Verify the API actually came up healthy. With migration fail-fast, a failed
# migration crashes the container (Restart=on-failure), so a crash-loop would
# otherwise be reported as a successful deploy. Poll /healthz until it responds.
echo "==> Waiting for API to report healthy"
healthy=0
for i in {1..30}; do
    if curl -fsS --max-time 3 http://localhost:8080/healthz >/dev/null 2>&1; then
        healthy=1
        break
    fi
    sleep 2
done

systemctl --user --no-pager status \
    filament-db.service \
    filament-api.service \
    filament-web.service | head -40

if [[ "$healthy" -ne 1 ]]; then
    echo "ERROR: API did not become healthy within ~60s. Recent API logs:" >&2
    journalctl --user -u filament-api.service --no-pager -n 50 >&2 || true
    exit 1
fi
echo "==> API healthy."
REMOTE

echo "==> Deployment complete."
echo "    Web UI:  http://${TARGET#*@}:8081/"
echo "    Health:  http://${TARGET#*@}:8080/healthz"
