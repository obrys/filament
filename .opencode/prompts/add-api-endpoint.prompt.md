# Add a new API endpoint

Use this prompt to add a complete, end-to-end API endpoint for a new operation.

## What to provide

Before running, fill in:
- **Operation**: what the endpoint does (e.g. "mark a spool as finished")
- **Resource**: the domain object (e.g. `Spool`)
- **HTTP method and route**: e.g. `POST /api/spools/{id}/finish`

## Steps OpenCode should follow

1. **Domain model** (`Filament.Core/Domain/`)  
   Add or extend the domain model if needed. Add any new business-logic method to the relevant
   service in `Filament.Core/Services/`. Keep it pure — no EF or HTTP dependencies.

2. **Repository interface** (`Filament.Core/Abstractions/IRepositories.cs`)  
   Add a new method signature if the operation requires a new database query.

3. **Unit test** (`tests/Filament.Core.Tests/`)  
   Write a unit test for the new business logic before implementing the infrastructure layer.

4. **Repository implementation** (`Filament.Infrastructure/Repositories/`)  
   Implement the new repository method using EF Core.

5. **DTO** (`Filament.Api/Dtos/`)  
   Create a request DTO (if needed) and/or a response DTO, both as `record` types.

6. **Mapping** (`Filament.Api/Mapping/`)  
   Add mapping between the DTO and the domain model.

7. **Controller action** (`Filament.Api/Controllers/`)  
   Add the controller action: validate input, call the Core service, map the result to a DTO,
   return an appropriate HTTP status code.

8. **SignalR broadcast** (optional)  
   If the operation mutates shared state, broadcast a named event from the hub after the
   operation succeeds so connected clients can refresh.
