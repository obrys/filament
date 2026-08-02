using Filament.Core.Domain;
using Filament.Core.Services;
using Filament.Infrastructure.Persistence;
using Filament.Infrastructure.Repositories;

namespace Filament.Infrastructure.Tests;

/// <summary>
/// Wraps a <see cref="FilamentDbContext"/> (against the fixture's real MariaDB) and seeds filament
/// types, spools and lifecycle events via the public repository surface. Sorting is performed by
/// MariaDB in the listing SQL, exactly as in production, so ordering tests are real-SQL evidence.
/// </summary>
internal sealed class Seeder
{
    private readonly FilamentDbContext _db;
    private readonly FilamentTypeRepository _types;
    private readonly SpoolRepository _spools;

    public Seeder(FilamentDbContext db)
    {
        _db = db;
        _types = new FilamentTypeRepository(db);
        _spools = new SpoolRepository(db);
    }

    public FilamentTypeRepository Types => _types;
    public SpoolRepository Spools => _spools;
    public FilamentDbContext Db => _db;

    public Task CreateTypeAsync(string id, string brand = "B", string material = "M", string type = "T", string color = "C")
    {
        return _types.AddAsync(new FilamentType
        {
            Id = id,
            Brand = brand,
            Material = material,
            Type = type,
            Color = color,
            DefaultNetWeightGrams = 1000,
            EmptySpoolWeightGrams = 200,
        });
    }

    // Creates a Created-only spool whose LastUsedAt equals createdAt (the Created event's OccurredAt).
    public Task CreateSpoolAsync(string id, string typeId, int initialNetGrams, DateTimeOffset createdAt)
    {
        return _spools.AddAsync(
            new Spool
            {
                Id = id,
                FilamentTypeId = typeId,
                InitialNetGrams = initialNetGrams,
                RemainingGrams = initialNetGrams,
                CreatedAt = createdAt,
            },
            new SpoolEvent
            {
                SpoolId = id,
                Kind = SpoolEventKind.Created,
                DeltaGrams = 0,
                OccurredAt = createdAt,
            });
    }

    public Task<Spool?> OpenAsync(string id, DateTimeOffset at) =>
        _spools.ApplyLifecycleAsync(id, SpoolLifecycle.PlanOpen(id, Initial(id), Events(id), at: at));

    public Task<Spool?> ConsumeAsync(string id, int grams, DateTimeOffset at) =>
        _spools.ApplyLifecycleAsync(id, SpoolLifecycle.PlanConsume(id, Initial(id), Events(id), grams, at: at));

    public Task<Spool?> FinishAsync(string id, DateTimeOffset at) =>
        _spools.ApplyLifecycleAsync(id, SpoolLifecycle.PlanFinish(id, Initial(id), Events(id), at: at));

    public Task<Spool?> SetEnabledAsync(string id, long eventId, bool enabled) =>
        _spools.ApplyLifecycleAsync(id, SpoolLifecycle.PlanSetEnabled(Events(id), eventId, enabled));

    // Loads the spool's current InitialNetGrams via the public repository (needed by the planners).
    private int Initial(string id) =>
        _spools.GetAsync(id).GetAwaiter().GetResult()?.InitialNetGrams
            ?? throw new InvalidOperationException($"Spool '{id}' not found.");

    // Loads the spool's events as domain objects via the public repository.
    private List<SpoolEvent> Events(string id) =>
        _spools.ListEventsAsync(id).GetAwaiter().GetResult().ToList();
}

