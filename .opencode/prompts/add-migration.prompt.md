# Add an EF Core migration

Use this prompt whenever you need to evolve the database schema.

## Prerequisites

- You have already updated the entity class(es) in `Filament.Infrastructure/Entities/`.
- The `DbContext` in `Filament.Infrastructure/Persistence/` reflects the new schema.

## Steps

1. **Generate the migration**  
   Run from the repo root (requires the `dotnet-ef` tool):
   ```bash
   dotnet ef migrations add <MigrationName> \
     --project src/Filament.Infrastructure \
     --startup-project src/Filament.Api \
     --output-dir Persistence/Migrations
   ```
   Use PascalCase, descriptive migration names (e.g. `AddSpoolColorColumn`, `CreateSpoolEventTable`).

2. **Review the generated migration**  
   Open the generated `.cs` file under `Persistence/Migrations/`. Verify:
   - `Up()` applies the intended schema change.
   - `Down()` fully reverses it.
   - No accidental table drops or data-loss operations.

3. **Update the snapshot**  
   The `ModelSnapshot` file is updated automatically — commit it alongside the migration.

4. **Apply locally**  
   ```bash
   dotnet ef database update \
     --project src/Filament.Infrastructure \
     --startup-project src/Filament.Api
   ```

5. **Update seed data** (if applicable)  
   If the migration adds a required column with no default, update any seed/test data accordingly.
