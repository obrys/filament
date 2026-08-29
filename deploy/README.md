# Filament — Deployment Guide

This guide walks you through deploying Filament on a **server VM running a
modern Linux distro with systemd**, managed entirely by **podman + systemd
(Quadlet)**, and shipping updates from a **desktop** machine.

---

## Table of contents

1. [Minimum VM specs](#1-minimum-vm-specs)
2. [Prepare the server](#2-prepare-the-server)
3. [Project layout for deployment](#3-project-layout-for-deployment)
4. [How updates flow from desktop → server](#4-how-updates-flow-from-desktop--server)
5. [First-time install on the server](#5-first-time-install-on-the-server)
6. [Day-2 operations](#6-day-2-operations)
7. [Backups](#7-backups)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. Minimum VM specs

The very minimum for the whole stack is **1 GB of RAM**. The current
production VM has **2 GB** to maintain a headroom.

| Resource | Minimum | Notes                                          |
|---------:|:-------:|:-----------------------------------------------|
| **CPU**  | 1 vCPU  | x86_64 or aarch64                              |
| **RAM**  | **1 GB**| Production runs on 2 GB for a headroom         |
| **Disk** | 10 GB   | OS + images ~600 MB + DB room                  |
| **Net**  | LAN only| No external exposure required                  |

Per-container memory limits (`MemoryHigh`/`MemoryMax`) are set in the Quadlet
units under [`quadlets/`](quadlets/) and keep total usage bounded.

---

## 2. Prepare the server

On a freshly provisioned VM with a modern Linux distro with systemd:

1. Install `podman` and `rsync` with the distro's package manager.
2. Create a dedicated `filament` user with subordinate UID/GID ranges
   (required for rootless podman), e.g. `sudo useradd -m -U -s /bin/bash filament`.
3. Add your SSH public key for the `filament` user.
4. Enable systemd lingering so per-user units run without an interactive
   session: `sudo loginctl enable-linger filament`.

---

## 3. Project layout for deployment

```
deploy/
├── README.md                    # this file
├── quadlets/                    # systemd-managed podman units (Quadlet)
│   ├── filament.network         # internal pod network
│   ├── filament-db.volume       # persistent MariaDB volume
│   ├── filament-db.container    # MariaDB 11 (tuned)
│   ├── filament-api.container   # .NET 10 API
│   └── filament-web.container   # nginx + built SPA
└── scripts/
    ├── deploy.sh                # build & ship from desktop → server
    └── backup.sh                # snapshot DB volume
```

The Quadlet files live on the **server** at `~/.config/containers/systemd/`
where the systemd Quadlet generator picks them up automatically.

---

## 4. How updates flow from desktop → server

There's no external container registry. We use the **`podman save | ssh podman load`**
pattern — simple, secure (over SSH), no extra infra.

```
┌──────────────────────┐    1. podman build api & web
│   Desktop (builder)  │    2. podman save → ssh → podman load
│                      │ ─────────────────────────────────────┐
│   git repo + .git    │    3. rsync quadlets to server       │
└──────────────────────┘                                       ▼
                                                 ┌──────────────────────────┐
                                                 │   Server VM (filament)   │
                                                 │   podman + systemd       │
                                                 │   filament-{db,api,web}  │
                                                 └──────────────────────────┘
```

[`deploy/scripts/deploy.sh`](scripts/deploy.sh) does all three steps.

---

## 5. First-time install on the server

From your desktop, in the repo root:

```bash
# 1) Bootstrap: copy Quadlet units to the server
rsync -av --delete deploy/quadlets/ filament@<vm-ip>:~/.config/containers/systemd/

# 2) Build and ship the images
./deploy/scripts/deploy.sh filament@<vm-ip> amd64
```

On the **server** (one-time):

```bash
ssh filament@<vm-ip>

# Tell systemd to (re)generate units from the Quadlet files
systemctl --user daemon-reload

# Start the database first (so the API's migration succeeds on first start)
systemctl --user start filament-db.service

# Start API and web
systemctl --user start filament-api.service filament-web.service

# Verify
systemctl --user status filament-db filament-api filament-web
curl -fsS http://localhost:18080/healthz   # → {"status":"ok"}
```

Open in a browser: `http://<vm-ip>:8081/`

> **Why `systemctl --user`?** Quadlet files in `~/.config/containers/systemd/`
> are rootless. The kernel only ever runs containers as the `filament` user,
> never as root.

---

## 6. Day-2 operations

### Ship an update from desktop

```bash
./deploy/scripts/deploy.sh filament@<vm-ip> amd64
```

The second argument is the server architecture: use `amd64` for an x86_64 host
and `arm64` for an ARM64 host such as a Raspberry Pi 5. The local container
engine must be able to build the selected platform; cross-architecture builds
may require binfmt/QEMU emulation.

The script:
1. Builds `filament-api` and `filament-web` locally
2. Streams them over SSH (`podman save | ssh podman load`)
3. Rsyncs any updated Quadlet files
4. Calls `systemctl --user daemon-reload` and `restart` on the changed services

EF Core migrations apply automatically on API startup.

### Logs

```bash
# Live logs (server side)
journalctl --user -u filament-api.service -f
journalctl --user -u filament-db.service -f

# From the desktop
ssh filament@<vm-ip> 'journalctl --user -u filament-api.service -n 200 --no-pager'
```

### Stop / start the whole stack

```bash
systemctl --user stop  filament-web filament-api filament-db
systemctl --user start filament-db filament-api filament-web
```

### OS updates

Update the operating system with the distro's normal mechanism. The containers
are declared in systemd units, so they come back cleanly after a reboot —
nothing else to configure.

---

## 7. Backups

The DB volume is a podman named volume. Snapshot it with:

```bash
ssh filament@<vm-ip> 'bash -s' < deploy/scripts/backup.sh > filament-$(date +%F).tar.gz
```

Restore (server side, with services stopped):

```bash
systemctl --user stop filament-api filament-db
podman volume rm filament-db
podman volume create filament-db
podman run --rm -v filament-db:/restore -i docker.io/library/alpine \
  sh -c 'cd /restore && tar xzf -' < filament-YYYY-MM-DD.tar.gz
systemctl --user start filament-db filament-api
```

---

## 8. Troubleshooting

| Symptom                                          | Fix |
|--------------------------------------------------|-----|
| `rootlessport cannot expose privileged port 80`  | Rootless podman can't bind to ports <1024. Use a high port (we use **8081**) and front it with a reverse proxy, or run `sudo sysctl net.ipv4.ip_unprivileged_port_start=80`. |
| `systemctl --user` says "Failed to connect to bus" | Linger isn't enabled. `sudo loginctl enable-linger filament`. |
| API container restart-loops with DB connection errors | DB hasn't finished initializing. The unit has `Restart=on-failure` and will eventually succeed; or `systemctl --user restart filament-api` once `filament-db` is `active`. |
| `Error: short-name "mariadb:11" did not resolve` | Edit `/etc/containers/registries.conf.d/` or use the fully-qualified `docker.io/library/mariadb:11` (already used in our Quadlets). |
| OOM kills after a few hours                      | Confirm `MemoryMax=` in `filament-db.container`. If still tight, drop `innodb_buffer_pool_size` from `32M` to `16M`. |
| Want HTTPS                                       | Put a Caddy or nginx reverse proxy in front (another Quadlet), or use Tailscale Serve for zero-config TLS on LAN. |
