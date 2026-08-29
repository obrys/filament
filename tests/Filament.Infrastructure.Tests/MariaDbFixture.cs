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
///
/// Readiness is detected by retrying the real migration instead of the container runtime's
/// HEALTHCHECK status: podman builds compiled without the systemd tag (as shipped in recent
/// GitHub-hosted Ubuntu 22.04/24.04 runner images, actions/runner-images#14569) silently never
/// run health checks, leaving the status stuck at "starting" forever. The MariaDB image creates
/// the database and user while running with --skip-networking, so the port only opens once the
/// server is fully initialized — a failing migration attempt is always a not-ready state.
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

        // Apply the real migrations so the schema — including the new LastUsedAt column and its
        // backfill SQL — is exercised against real MariaDB. Each failed attempt just means the
        // server is not accepting connections yet (or the connection timed out mid-startup);
        // migrations run inside transactions, so retrying is safe.
        await MigrateUntilReadyAsync(TimeSpan.FromSeconds(120));
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

    private async Task MigrateUntilReadyAsync(TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow + timeout;
        Exception? last = null;
        while (DateTime.UtcNow < deadline)
        {
            try
            {
                using var db = CreateContext();
                await db.Database.MigrateAsync();
                return;
            }
            catch (Exception e)
            {
                last = e;
                await Task.Delay(2000);
            }
        }
        throw new TimeoutException(
            $"MariaDB did not accept migrations within {timeout.TotalSeconds}s. Last error: {last}");
    }
}

[CollectionDefinition("MariaDb")]
public sealed class MariaDbCollection : ICollectionFixture<MariaDbFixture> { }
