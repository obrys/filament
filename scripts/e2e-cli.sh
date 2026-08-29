#!/usr/bin/env bash
# Shared container-CLI detection for e2e scripts.
# Sets E2E_CLI as an array usable with "${E2E_CLI[@]}".
# Fails (exits 1) with a clear message if no supported CLI is found.
detect_cli() {
  if [[ -f /run/.containerenv || -f /.dockerenv ]] || command -v flatpak-spawn >/dev/null 2>&1; then
    E2E_CLI=(flatpak-spawn --host podman)
  elif command -v podman >/dev/null 2>&1; then
    E2E_CLI=(podman)
  elif command -v docker >/dev/null 2>&1; then
    E2E_CLI=(docker)
  else
    echo "ERROR: No supported container CLI found." >&2
    echo "Looked for: flatpak-spawn (toolbox), podman, docker." >&2
    echo "On an immutable desktop, run this inside a toolbox where flatpak-spawn can reach host podman." >&2
    exit 1
  fi
  echo "Using container CLI: ${E2E_CLI[*]}"
}
