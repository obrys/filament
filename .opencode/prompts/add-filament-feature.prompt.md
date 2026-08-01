# Add a full filament feature end-to-end

Use this prompt to implement a brand-new feature that touches all layers (back-end + front-end).

## What to provide

- **Feature name**: short, descriptive (e.g. "label printing", "spool transfer")
- **User story**: one sentence describing what the user can do and why

## Back-end checklist

- [ ] Domain model changes in `Filament.Core/Domain/`
- [ ] New or updated service method in `Filament.Core/Services/`  
      _(business rules live here — no EF, no HTTP)_
- [ ] Repository interface updated in `Filament.Core/Abstractions/`
- [ ] Unit tests added in `tests/Filament.Core.Tests/`
- [ ] EF entity changes in `Filament.Infrastructure/Entities/`
- [ ] New EF Core migration (see `add-migration.prompt.md`)
- [ ] Repository implementation updated in `Filament.Infrastructure/Repositories/`
- [ ] DTOs added in `Filament.Api/Dtos/`
- [ ] Mappings updated in `Filament.Api/Mapping/`
- [ ] Controller action(s) added in `Filament.Api/Controllers/`
- [ ] SignalR event broadcast if the feature mutates shared state

## Front-end checklist

- [ ] Typed API client function added/updated in `web/src/api/client.ts`
- [ ] New page component added to `web/src/pages/` (if a new route is needed)
- [ ] Route registered in the router (in `main.tsx` or the router config)
- [ ] Shared sub-components added to `web/src/components/` (if reusable)
- [ ] Real-time update wired via `web/src/realtime/` (subscribe to the new SignalR event)
- [ ] Responsive layout verified on mobile viewport

## Definition of done

- All new business logic has unit tests and they pass (`dotnet test`).
- The front end builds without TypeScript errors (`npm run build` in `web/`).
- The feature is reachable via a unique URL that can be bookmarked/shared.
