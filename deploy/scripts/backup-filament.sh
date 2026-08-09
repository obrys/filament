#!/usr/bin/env bash
set -euo pipefail
 
# --- Configuration ---
REMOTE_HOST="${FILAMENT_REMOTE_HOST:-192.168.88.241}"
REMOTE_USER="${FILAMENT_REMOTE_USER:-filament}"
CONTAINER="filament-db"
DB_NAME="filament"
DB_USER="filament"
DB_PASS="filament"
 
BACKUP_DIR="$(dirname "$(realpath "$0")")"
BACKUP_FILE="${BACKUP_DIR}/${DB_NAME}_$(date +%F_%H-%M-%S).sql"
 
# --- Backup ---
echo "Backing up '${DB_NAME}' from ${CONTAINER}@${REMOTE_HOST} ..."
 
ssh "${REMOTE_USER}@${REMOTE_HOST}" \
    "podman exec ${CONTAINER} mariadb-dump \
        -u ${DB_USER} -p'${DB_PASS}' \
        --databases ${DB_NAME} \
        --single-transaction \
        --routines \
        --events" \
    > "${BACKUP_FILE}"
 
echo "Done: ${BACKUP_FILE} ($(du -h "${BACKUP_FILE}" | cut -f1))"
 
