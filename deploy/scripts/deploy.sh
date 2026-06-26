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

# Version stamp baked into both images so the running client can detect a redeploy
# and reload itself. Uses the current commit; if there are uncommitted changes the
# stamp gets a "-dirty-<hash>" suffix where <hash> is the first 6 characters of the
# SHA-256 of `git diff HEAD`. This makes every dirty build uniquely and repeatably
# identifiable — the suffix changes whenever the uncommitted diff changes.
_base_commit="$(git describe --always --dirty --abbrev=8 2>/dev/null || echo dev)"
if [[ "$_base_commit" == *-dirty ]]; then
  _dirty_hash="$(git diff HEAD | sha256sum | cut -c1-6)"
  GIT_COMMIT="${_base_commit}-${_dirty_hash}"
else
  GIT_COMMIT="$_base_commit"
fi
unset _base_commit _dirty_hash
echo "==> Build version: $GIT_COMMIT"

echo "==> Building API image"
"$ENGINE" build --build-arg "GIT_COMMIT=$GIT_COMMIT" -t "$API_TAG" -f src/Filament.Api/Dockerfile .

echo "==> Building Web image"
"$ENGINE" build --build-arg "GIT_COMMIT=$GIT_COMMIT" -t "$WEB_TAG" -f web/Dockerfile web

echo "==> Streaming API image to $TARGET"
"$ENGINE" save "$API_TAG" | ssh "$TARGET" "podman load"

echo "==> Streaming Web image to $TARGET"
"$ENGINE" save "$WEB_TAG" | ssh "$TARGET" "podman load"

echo "==> Syncing Quadlet units"
rsync -av --delete deploy/quadlets/ "$TARGET":~/.config/containers/systemd/

echo "==> Reloading systemd and restarting services"
# IMPORTANT: do not pipe the heredoc straight into `bash`. With `ssh host bash`,
# the remote bash reads this script from stdin, and any command in the body that
# touches stdin (podman/systemctl interacting with conmon/sdnotify on the server)
# can swallow the remaining script lines — bash then hits EOF and exits 0, silently
# skipping everything after it while still reporting success. Slurp the whole script
# into a temp file first, then run it with stdin detached from /dev/null so no inner
# command can ever consume the script.
ssh "$TARGET" 'tmp="$(mktemp)"; cat >"$tmp"; bash "$tmp" </dev/null; rc=$?; rm -f "$tmp"; exit "$rc"' <<'REMOTE'
set -euo pipefail

# A non-interactive SSH command ("ssh host bash") does NOT export the variables that
# `systemctl --user` needs to find the per-user systemd manager. Without these the
# command connects to nothing and silently no-ops — which is why restarts work from an
# interactive console but not from this script. Set them explicitly.
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=${XDG_RUNTIME_DIR}/bus}"

# Fail loudly (instead of silently no-op'ing) if the user manager is unreachable. The
# usual cause is that lingering is not enabled, so the manager isn't running when no
# interactive session is open. Fix once on the server: loginctl enable-linger "$USER"
if ! systemctl --user show-environment >/dev/null 2>&1; then
    echo "ERROR: cannot reach the per-user systemd manager over SSH." >&2
    echo "       XDG_RUNTIME_DIR=$XDG_RUNTIME_DIR" >&2
    echo "       Enable lingering once on the server, then re-run the deploy:" >&2
    echo "         loginctl enable-linger \"\$USER\"" >&2
    exit 1
fi

echo "Reloading daemon"
systemctl --user daemon-reload
echo "Daemon reloaded"

# Ensure db is up first; start everything if this is the first run.
systemctl --user start filament-db.service
# Wait briefly for DB to be healthy before (re)starting the API.
for i in {1..30}; do
    if podman healthcheck run filament-db >/dev/null 2>&1; then break; fi
    sleep 2
done

echo "Restarting filament-api service"
systemctl --user restart filament-api.service
echo "Restarted filament-api service"
echo "Restarting filament-web service"
systemctl --user restart filament-web.service
echo "Restarted filament-web service"

# Confirm the containers were actually recreated (the restart really took effect).
# If an ID is unchanged the restart silently did nothing — surface it instead of
# reporting a successful deploy.
for svc in filament-api filament-web; do
    cid="$(podman inspect -f '{{.Id}}' "$svc" 2>/dev/null | cut -c1-12 || true)"
    echo "==> $svc container: ${cid:-<not running>}"
done

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
    filament-web.service || true

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
