# Operations

## Supported deployment

This is the supported production path: Fedora CoreOS (FCOS), rootless Podman, and systemd Quadlets under the `filament` service account. The files in `deploy/quadlets/` define one named network, persistent MariaDB volume, database container, API container, and web container. Docker Compose exists for local all-container development, not as the documented production deployment.

Minimum target: one x86_64 or aarch64 vCPU, 768 MB RAM, and 10 GB disk. The repository recommends 2 vCPUs, 1 GB RAM, and 20 GB disk. Container tuning limits MariaDB to 420 MB, API to 512 MB, and web to 32 MB; measured idle use in the existing deployment guide is roughly 570 MB total.

## Before installation

1. Create an FCOS VM with LAN connectivity and SSH access. Do not expose this unauthenticated application to the public internet.
2. Edit `deploy/ignition/filament.bu` before first boot. Replace the included SSH keys and password hashes, choose the hostname/timezone, and use the account name consistently if changing `filament`.
3. Render Butane to Ignition, for example:

```bash
podman run --rm -i quay.io/coreos/butane:release \
  < deploy/ignition/filament.bu > deploy/ignition/filament.ign
```

4. Boot the VM with the rendered Ignition. It creates the Quadlet directory and enables systemd lingering, allowing rootless user services to start at boot without a login session.

The checked-in Quadlets currently contain the MariaDB application password and API connection string. Change these together before deployment if the host is not strictly disposable/trusted; credentials committed in source control are not a secret-management solution.

## First installation

Run these from a workstation clone, substituting the SSH destination and target architecture:

```bash
rsync -av --delete deploy/quadlets/ \
  filament@SERVER:~/.config/containers/systemd/
./deploy/scripts/deploy.sh filament@SERVER amd64
```

`deploy/scripts/deploy.sh` requires exactly two arguments: SSH target and `amd64` or `arm64`. It passes the selected `linux/<architecture>` platform to both image builds, so use `arm64` for a Raspberry Pi 5 and `amd64` for the existing x86_64 deployment. The local container engine must support building the selected platform; cross-architecture builds may require registered binfmt/QEMU emulation. The script chooses Podman when available (otherwise Docker) to build `localhost/filament-api:latest` and `localhost/filament-web:latest`, transfers both images through SSH, synchronizes Quadlets, reloads the remote user manager, waits for MariaDB health, restarts API and web, and polls `http://localhost:8080/healthz` on the server for up to about 60 seconds.

For a manual first start, connect as the deployment user and run:

```bash
systemctl --user daemon-reload
systemctl --user start filament-db.service
systemctl --user start filament-api.service filament-web.service
systemctl --user status filament-db filament-api filament-web
curl -fsS http://localhost:8080/healthz
```

Open `http://SERVER:8081/` for the web UI. Port 8080 exposes the API directly. A separate nginx TLS reverse-proxy example is in `deploy/reverse-proxy/`; it proxies both normal requests and `/ws/` WebSocket upgrades to `web.lan:8081`. Restrict port 8081 to the proxy if that topology is used.

## Routine operation

```bash
# Deploy a new version from the workstation
./deploy/scripts/deploy.sh filament@SERVER amd64

# Follow logs on the server
journalctl --user -u filament-api.service -f
journalctl --user -u filament-db.service -f

# Stop/start stack in dependency order
systemctl --user stop filament-web filament-api filament-db
systemctl --user start filament-db filament-api filament-web
```

If `systemctl --user` cannot connect during a non-interactive SSH command, set `XDG_RUNTIME_DIR=/run/user/$(id -u)` and `DBUS_SESSION_BUS_ADDRESS=unix:path=$XDG_RUNTIME_DIR/bus`, or verify lingering with `loginctl enable-linger filament`. The deploy script does this setup and fails explicitly if the user manager is unavailable.

The API applies migrations on every start. Investigate a failing deployment with `journalctl --user -u filament-api.service -n 100 --no-pager`; do not repeatedly restart blindly when a migration is failing.

## Database administration

MariaDB is intentionally not published to the LAN. Connect remotely over SSH without opening a database port:

```bash
ssh -t filament@SERVER \
  'podman exec -it filament-db mariadb -u filament -p filament'
```

This is the supported remote administration method. It executes the MariaDB client inside the database container and keeps the database port private. The supplied Quadlet does not provide a TCP listener suitable for a graphical database client. If one is required, create a time-limited, firewall-restricted host listener and SSH tunnel as a separate operational change; never publish MariaDB broadly just for administration.

After direct data correction, use the web maintenance page or call the repair endpoint so cached spool status and remaining weights match enabled events:

```bash
curl -X POST http://localhost:8080/api/spools/reevaluate
```

## Backups and restore

Two backup mechanisms are present. Prefer the logical SQL dump for routine backup because it can be restored while MariaDB is running and is portable across the same MariaDB-compatible schema.

### Logical SQL backup

`deploy/scripts/backup-filament.sh` runs `mariadb-dump --single-transaction --routines --events` remotely and saves a timestamped SQL file beside the script. Its `REMOTE_HOST`, account, container, database, user, and password constants must match the deployment before use.

```bash
./deploy/scripts/backup-filament.sh
./deploy/scripts/restore-filament.sh path/to/filament_YYYY-MM-DD_HH-MM-SS.sql
```

The restore script prompts for confirmation, then streams the selected dump into the running MariaDB container. It overwrites objects contained in the dump. Stop the API first for a controlled restore and start it afterwards so migrations and normal writes do not overlap the import:

```bash
ssh filament@SERVER 'systemctl --user stop filament-api.service'
./deploy/scripts/restore-filament.sh path/to/backup.sql
ssh filament@SERVER 'systemctl --user start filament-api.service'
```

### Physical volume snapshot

`deploy/scripts/backup.sh` streams a gzip-compressed tar archive of the named `filament-db` volume. This is a filesystem-level snapshot, not a MariaDB logical dump. For database consistency, stop the database before taking this backup unless the storage layer itself provides a coordinated snapshot.

```bash
ssh filament@SERVER 'systemctl --user stop filament-web filament-api filament-db'
ssh filament@SERVER 'bash -s' < deploy/scripts/backup.sh > filament-YYYY-MM-DD.tar.gz
ssh filament@SERVER 'systemctl --user start filament-db filament-api filament-web'
```

Restore a physical archive only onto a stopped stack and a newly created volume:

```bash
ssh filament@SERVER
systemctl --user stop filament-web filament-api filament-db
podman volume rm filament-db
podman volume create filament-db
podman run --rm -v filament-db:/restore -i docker.io/library/alpine \
  sh -c 'cd /restore && tar xzf -' < filament-YYYY-MM-DD.tar.gz
systemctl --user start filament-db filament-api filament-web
```

Keep backups off the server and test restore procedures periodically. A volume archive ties recovery to MariaDB's on-disk format and is less portable than SQL; do not use it as the only backup.
