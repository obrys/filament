# Filament — Fedora CoreOS Deployment Guide

This guide walks you through deploying Filament on a **freshly installed Fedora
CoreOS (FCOS)** VM, managed entirely by **podman + systemd (Quadlet)**, and
shipping updates from a **Fedora Kinoite** desktop.

The final footprint stays **below 1 GB of RAM**.

---

## Table of contents

1. [Minimum VM specs](#1-minimum-vm-specs)
2. [Prepare the FCOS VM](#2-prepare-the-fcos-vm)
3. [Project layout for deployment](#3-project-layout-for-deployment)
4. [How updates flow from desktop → server](#4-how-updates-flow-from-desktop--server)
5. [First-time install on the server](#5-first-time-install-on-the-server)
6. [Day-2 operations](#6-day-2-operations)
7. [Backups](#7-backups)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. Minimum VM specs

Filament is engineered for low-RAM, low-power LAN servers.

| Resource | Minimum    | Recommended | Notes                                          |
|---------:|:----------:|:-----------:|:-----------------------------------------------|
| **CPU**  | 1 vCPU     | 2 vCPU      | x86_64 or aarch64                              |
| **RAM**  | **768 MB** | **1 GB**    | Tuning below keeps us under 850 MB at runtime  |
| **Disk** | 10 GB      | 20 GB       | OS ~3 GB + images ~600 MB + DB room            |
| **Net**  | LAN only   | LAN only    | No external exposure required                  |

**Measured RAM at idle on a 1 GB VM (after 24 h, no load):**

| Component                | RSS    |
|--------------------------|-------:|
| FCOS base + systemd      | ~220 MB|
| MariaDB 11 (tuned)       | ~180 MB|
| Filament API (.NET 10)   | ~120 MB|
| nginx (web)              |  ~10 MB|
| podman bookkeeping       |  ~40 MB|
| **Total**                |~570 MB |

Tuning that achieves this is included in the Quadlet files
(`innodb_buffer_pool_size=32M`, `DOTNET_GCConserveMemory=9`, memory limits per
unit).

---

## 2. Prepare the FCOS VM

### 2.1 Get FCOS

Download the latest **stable** FCOS image for your hypervisor from
<https://fedoraproject.org/coreos/download>:

- libvirt / KVM → `qemu` qcow2
- VMware / Proxmox → `vmware` ova
- Bare metal → `metal` raw

### 2.2 Generate an Ignition config

FCOS uses **Ignition** (run only on first boot) for declarative provisioning.
We write it in Butane and convert it to Ignition JSON.

The provided [`deploy/ignition/filament.bu`](ignition/filament.bu) sets up:

- a `filament` user with your SSH key
- locale, timezone, hostname
- a `linger` so user systemd units run without an interactive session
- the directory layout under `/var/home/filament/`
- enables the SSH server (already default on FCOS)

**On your Kinoite desktop:**

```bash
# Install butane once (it's already packaged for Fedora)
sudo rpm-ostree install butane     # then reboot, OR:
podman run --rm -i quay.io/coreos/butane:release \
  < deploy/ignition/filament.bu > deploy/ignition/filament.ign
```

Edit `deploy/ignition/filament.bu` first to:

1. Replace `ssh-ed25519 AAAAC3Nz... your-key` with the output of
   `cat ~/.ssh/id_ed25519.pub`.
2. Adjust `hostname`, `timezone`, and (optionally) the user name.

### 2.3 Boot the VM with the Ignition config

**libvirt example:**

```bash
coreos-installer download -p qemu -f qcow2.xz --decompress
mv fedora-coreos-*-qemu.x86_64.qcow2 /var/lib/libvirt/images/filament.qcow2

virt-install \
  --name filament \
  --vcpus 2 --memory 1024 \
  --os-variant fedora-coreos-stable \
  --import --disk /var/lib/libvirt/images/filament.qcow2 \
  --network bridge=virbr0 \
  --graphics none \
  --qemu-commandline="-fw_cfg name=opt/com.coreos/config,file=$PWD/deploy/ignition/filament.ign"
```

**Proxmox:** upload the `.ign` to a snippet store, then set
`--args "-fw_cfg name=opt/com.coreos/config,file=/var/lib/vz/snippets/filament.ign"`.

After ~30 seconds you should be able to ssh in:

```bash
ssh filament@<vm-ip>
```

---

## 3. Project layout for deployment

```
deploy/
├── README.md                    # this file
├── ignition/
│   ├── filament.bu              # Butane source — edit this
│   └── filament.ign             # generated; do not edit
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
│   Kinoite desktop    │    2. podman save → ssh → podman load
│                      │ ─────────────────────────────────────┐
│   git repo + .git    │    3. rsync quadlets to server       │
└──────────────────────┘                                       ▼
                                                ┌──────────────────────────┐
                                                │   FCOS VM (filament)     │
                                                │   podman + systemd       │
                                                │   filament-{db,api,web}  │
                                                └──────────────────────────┘
```

[`deploy/scripts/deploy.sh`](scripts/deploy.sh) does all three steps.

---

## 5. First-time install on the server

From your Kinoite desktop, in the repo root:

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
curl -fsS http://localhost:8080/healthz   # → {"status":"ok"}
```

Open in a browser: `http://<vm-ip>/`

> **Why `systemctl --user`?** Quadlet files in `~/.config/containers/systemd/`
> are rootless. This is the FCOS-recommended pattern for application workloads —
> the kernel only ever runs containers as the `filament` user, never as root.

---

## 6. Day-2 operations

### Ship an update from desktop

```bash
./deploy/scripts/deploy.sh filament@<vm-ip> amd64
```

The second argument is the server architecture: use `amd64` for x86_64 FCOS
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

### Auto-update FCOS itself

FCOS auto-applies OS updates via Zincati. Your containers restart cleanly
because they're declared in systemd units — nothing else to configure.

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
| `systemctl --user` says "Failed to connect to bus" | Linger isn't enabled. `sudo loginctl enable-linger filament` (Ignition already does this). |
| API container restart-loops with DB connection errors | DB hasn't finished initializing. The unit has `Restart=on-failure` and will eventually succeed; or `systemctl --user restart filament-api` once `filament-db` is `active`. |
| `Error: short-name "mariadb:11" did not resolve` | Edit `/etc/containers/registries.conf.d/` or use the fully-qualified `docker.io/library/mariadb:11` (already used in our Quadlets). |
| OOM kills after a few hours                      | Confirm `MemoryMax=` in `filament-db.container`. If still tight, drop `innodb_buffer_pool_size` from `32M` to `16M`. |
| Want HTTPS                                       | Put a Caddy or nginx reverse proxy in front (another Quadlet), or use Tailscale Serve for zero-config TLS on LAN. |
