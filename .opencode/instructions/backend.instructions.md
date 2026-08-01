---
applyTo: "src/**,tests/**"
---

# Back-end coding instructions

## Architecture — three-layer rule

```
HTTP request
  → DTO  (Filament.Api / Dtos)
  → Domain model  (Filament.Core / Domain)
  → Entity  (Filament.Infrastructure / Entities)
  → Database
```

The same path applies in reverse for responses. **Never expose entities from the API; never let
infrastructure types leak into Core.**

## Project responsibilities

| Project | Allowed dependencies | Must NOT reference |
|---|---|---|
| `Filament.Core` | None (pure domain) | `Filament.Api`, `Filament.Infrastructure` |
| `Filament.Infrastructure` | `Filament.Core` | `Filament.Api` |
| `Filament.Api` | `Filament.Core`, `Filament.Infrastructure` | — |

## Filament.Core conventions

- Domain model classes live under `Domain/`.
- Repository interfaces live under `Abstractions/` (prefix `I`, e.g. `ISpoolRepository`).
- Service interfaces and implementations live under `Services/`.
- Identifier generation lives under `Identifiers/`.
- Every piece of business logic **must** have a unit test in `Filament.Core.Tests`.

## Filament.Infrastructure conventions

- EF Core entity classes live under `Entities/` and are suffixed `Entity` (e.g. `SpoolEntity`).
- Mapping between domain models and entities lives under `Mapping/` using explicit static methods
  (no AutoMapper).
- Repository implementations live under `Repositories/`.
- The `DbContext` lives under `Persistence/`.
- DI registration goes in `ServiceCollectionExtensions.cs`.

## Filament.Api conventions

- Controllers live under `Controllers/`, thin — delegate to Core services.
- DTOs live under `Dtos/` and are suffixed `Dto` (e.g. `SpoolDto`, `CreateSpoolRequestDto`).
- Mapping between DTOs and domain models lives under `Mapping/`.
- SignalR hub(s) live under `Realtime/`.
- PDF generation lives under `Pdf/`.

## Testing

- Test project: `tests/Filament.Core.Tests/`.
- Use xUnit. Arrange / Act / Assert comments are optional but welcome.
- Mock repositories with `Moq` or hand-written fakes; never spin up a real database in unit tests.
- Test class naming: `<SubjectClass>Tests` (e.g. `SpoolServiceTests`).
- Test method naming: `<Method>_<Scenario>_<ExpectedOutcome>` (e.g. `Consume_WhenWeightExceedsRemaining_ThrowsException`).

## General C# style

- C# 13 / .NET 10 idioms (primary constructors, collection expressions, etc.).
- `required` properties on DTOs and domain models instead of constructor overloads where practical.
- `record` types for immutable value objects and DTOs.
- Async all the way: every I/O method returns `Task<T>` / `ValueTask<T>`; suffix `Async`.
- No `var` for non-obvious types; use `var` freely when the right-hand side makes the type obvious.
