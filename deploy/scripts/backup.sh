#!/usr/bin/env bash
# Backup the filament-db podman volume to stdout as a gzipped tarball.
# Meant to be run on the FCOS server, typically via:
#   ssh filament@host 'bash -s' < deploy/scripts/backup.sh > filament-$(date +%F).tar.gz
set -euo pipefail

podman run --rm \
    -v filament-db:/data:ro \
    docker.io/library/alpine \
    tar czf - -C /data .
