using Filament.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Pomelo.EntityFrameworkCore.MySql;
using Xunit;

namespace Filament.Infrastructure.Tests;

/// <summary>
/// xUnit collection fixture that starts a disposable MariaDB 11 container (via the detected
/// container CLI), applies the full EF migration history — including the new AddSpoolLastUsedAt
/// migration and its backfill SQL — and exposes fresh <see cref="FilamentDbContext"/> instances
/// to tests. Tables are cleared between tests via <see cref="ResetAsync"/>. The container is
/// stopped and removed on disposal. This gives real-SQL evidence for spool-list ordering against
/// the same provider used in production (Pomelo/MySQL → MariaDB).
/// </summary>
public sealed class MariaDbFixture : IAsyncLifetime
{
    private static readonly MariaDbServerVersion ServerVersion = new(new Version(11, 0, 0));
    private const int HostPort = 13306;
    private const string ContainerName = "filament-infra-test-db";
    private const string DbName = "filament";
    private const string DbUser = "filament";
    private const string DbPass = "filament";

    private ContainerCli? _cli;
    private string _connectionString = "";

    public async Task InitializeAsync()
    {
        _cli = ContainerCli.Detect();

        // Best-effort cleanup of any leftover container from a previous crashed run.
        _cli.Run("rm", "-f", ContainerName);

        var (out_, err, exit) = _cli.Run(
            "run", "-d", "--rm",
            "--name", ContainerName,
            "-p", $"{HostPort}:3306",
            "-e", $"MARIADB_DATABASE={DbName}",
            "-e", $"MARIADB_USER={DbUser}",
            "-e", $"MARIADB_PASSWORD={DbPass}",
            "-e", "MARIADB_ROOT_PASSWORD=rootpw",
            "--health-cmd=healthcheck.sh --connect --innodb_initialized",
            "--health-interval=3s",
            "--health-timeout=5s",
            "--health-retries=40",
            "mariadb:11");
        if (exit != 0)
            throw new InvalidOperationException(
                $"Failed to start MariaDB container (exit {exit}).\nstdout: {out_}\nstderr: {err}");

        _connectionString =
            $"Server=127.0.0.1;Port={HostPort};Database={DbName};User={DbUser};Password={DbPass};" +
            "AllowPublicKeyRetrieval=True";

        await WaitUntilHealthyAsync(TimeSpan.FromSeconds(120));

        // Apply the real migrations so the schema — including the new LastUsedAt column and its
        // backfill SQL — is exercised against real MariaDB.
        using (var db = CreateContext())
        {
            await db.Database.MigrateAsync();
        }
    }

    public Task DisposeAsync()
    {
        _cli?.Run("stop", ContainerName);
        return Task.CompletedTask;
    }

    public FilamentDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<FilamentDbContext>()
            .UseMySql(_connectionString, ServerVersion)
            .Options;
        return new FilamentDbContext(options);
    }

    /// <summary>Clears all rows so each test starts from an empty database. Respects FK order.</summary>
    public async Task ResetAsync()
    {
        using var db = CreateContext();
        await db.Database.ExecuteSqlRawAsync("DELETE FROM spool_events");
        await db.Database.ExecuteSqlRawAsync("DELETE FROM spools");
        await db.Database.ExecuteSqlRawAsync("DELETE FROM filament_types");
    }

    private async Task WaitUntilHealthyAsync(TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            var (out_, _, _) = _cli!.Run("inspect", "--format", "{{.State.Health.Status}}", ContainerName);
            if (out_.Trim() == "healthy") return;
            await Task.Delay(2000);
        }
        throw new TimeoutException($"MariaDB container did not become healthy within {timeout.TotalSeconds}s.");
    }
}

[CollectionDefinition("MariaDb")]
public sealed class MariaDbCollection : ICollectionFixture<MariaDbFixture> { }
