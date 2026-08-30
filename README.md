# Filament

Self-hosted filament & spool management for small 3D-print farms.

> **Small-deployment only:** Filament is designed for small, home-like
> deployments (a personal or workshop print farm). It intentionally ships
> without authentication or authorization, so keep it to a trusted network.
> Do not expose it to untrusted or public networks.

## Quick start (everything in containers)

Works with either Podman (or Docker):

```bash
podman compose up --build     # or: docker compose up --build
```

Then open:
- Web UI: http://localhost:5173
- API:    http://localhost:8080/healthz

## Local development

```bash
# 1) Start only the database
podman compose up db

# 2) Backend (auto-runs migrations on startup)
dotnet run --project src/Filament.Api

# 3) Frontend (Vite dev server, proxies /api and /ws to the backend)
cd web && npm install && npm run dev
```

> The dev frontend proxies `/api` and `/ws` to `http://localhost:5113`, matching
> the default `http` profile in `src/Filament.Api/Properties/launchSettings.json`.
> Adjust `web/vite.config.ts` if you run the backend on a different port.
> OpenAPI docs are only served in Development: http://localhost:5113/openapi/v1.json

## Tests

```bash
dotnet test                                            # all
dotnet test --filter "FullyQualifiedName~SpoolWeight"  # one class
```

## Architecture

Three-layer .NET solution with a separate React frontend:

```
src/Filament.Core           # Domain models, identifier generator, pure business rules
src/Filament.Infrastructure # EF Core entities, DbContext (MariaDB / Pomelo), repositories, mappers
src/Filament.Api            # DTOs, controllers, WebSocket hub, PDF labels — composition root
tests/Filament.Core.Tests   # Unit tests against the domain layer
web/                        # React + TypeScript + Vite frontend
```

DTO ↔ Domain ↔ Entity mappings are explicit (see `*/Mapping/`).
Business logic that doesn't need EF lives in `Filament.Core.Services` so it can
be unit-tested in isolation.

## Identifiers

Short, human-friendly IDs using a 32-char alphabet that excludes the
visually-similar `I`, `L`, `O`, `U`:

- Filament type ID: 3 chars (32 768 combinations)
- Spool ID: 4 chars (~1 M combinations)

See `Filament.Core.Identifiers.IdentifierGenerator`.

## Production deployment

See [`deploy/README.md`](deploy/README.md) for a step-by-step guide to deploy
to a modern Linux distro with systemd, using podman + systemd (Quadlet) and a
desktop-to-server deploy script.

## Documentation

- [`.github/copilot-instructions.md`](.github/copilot-instructions.md) — AI assistant context

