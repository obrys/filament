#!/usr/bin/env bash
set -euo pipefail

# --- Configuration ---
REMOTE_HOST="web.lan"
REMOTE_USER="filament"
CONTAINER="filament-db"
DB_NAME="filament"
DB_USER="filament"
DB_PASS="filament"

# --- Pick backup file ---
if [[ $# -eq 1 ]]; then
    BACKUP_FILE="$1"
else
    BACKUP_DIR="$(dirname "$(realpath "$0")")"
    BACKUP_FILE="$(ls -1t "${BACKUP_DIR}/${DB_NAME}"_*.sql 2>/dev/null | head -n1)"
    if [[ -z "${BACKUP_FILE}" ]]; then
        echo "No backup file found in ${BACKUP_DIR} and none given as argument." >&2
        exit 1
    fi
fi

if [[ ! -f "${BACKUP_FILE}" ]]; then
    echo "Backup file not found: ${BACKUP_FILE}" >&2
    exit 1
fi

echo "About to restore '${DB_NAME}' on ${CONTAINER}@${REMOTE_HOST} from:"
echo "  ${BACKUP_FILE}"
read -rp "This will overwrite the current database. Continue? [y/N] " confirm
[[ "${confirm}" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 1; }

# --- Restore ---
echo "Restoring ..."
ssh "${REMOTE_USER}@${REMOTE_HOST}" \
    "podman exec -i ${CONTAINER} mariadb \
        -u ${DB_USER} -p'${DB_PASS}'" \
    < "${BACKUP_FILE}"

echo "Done."
