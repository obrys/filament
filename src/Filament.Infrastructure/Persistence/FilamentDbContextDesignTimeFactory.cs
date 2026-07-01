using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Filament.Infrastructure.Persistence;

/// <summary>
/// Lets <c>dotnet ef</c> create a DbContext at design time without contacting MariaDB.
/// Uses a fixed ServerVersion so migrations can be generated offline.
/// </summary>
public sealed class FilamentDbContextDesignTimeFactory : IDesignTimeDbContextFactory<FilamentDbContext>
{
    public FilamentDbContext CreateDbContext(string[] args)
    {
        var conn = Environment.GetEnvironmentVariable("ConnectionStrings__Filament")
            ?? "Server=localhost;Port=3306;Database=filament;User=filament;Password=filament";
        var options = new DbContextOptionsBuilder<FilamentDbContext>()
            .UseMySql(
                conn,
                new MariaDbServerVersion(new Version(10, 11, 0)))
            .Options;
        return new FilamentDbContext(options);
    }
}
