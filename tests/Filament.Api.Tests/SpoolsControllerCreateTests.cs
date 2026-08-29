using Filament.Api.Controllers;
using Filament.Api.Dtos;
using Filament.Core.Abstractions;
using Filament.Core.Domain;
using Filament.Core.Services;

namespace Filament.Api.Tests;

/// <summary>
/// No-op notifier: the creation tests are only interested in the spool that was persisted.
/// </summary>
public sealed class FakeChangeNotifier : IChangeNotifier
{
    public Task NotifyAsync(string resource, string? id, CancellationToken ct = default) => Task.CompletedTask;
}

/// <summary>
/// In-memory spool store supporting the read + create path used by <c>SpoolsController.Create</c>.
/// </summary>
public sealed class FakeSpoolStore : ISpoolRepository
{
    private readonly Dictionary<string, Spool> _spools;

    public List<Spool> AddedSpools { get; } = [];
    public List<SpoolEvent> CreatedEvents { get; } = [];

    public FakeSpoolStore(params Spool[] spools) => _spools = spools.ToDictionary(s => s.Id);

    public Task<Spool?> GetAsync(string id, CancellationToken ct = default) =>
        Task.FromResult(_spools.TryGetValue(id, out var spool) ? spool : null);

    public Task<IReadOnlyList<Spool>> ListAsync(SpoolSort sort = SpoolSort.LastUsed, string? filamentTypeId = null, bool includeFinished = false, CancellationToken ct = default) =>
        throw new NotSupportedException();

    public Task AddAsync(Spool spool, SpoolEvent createdEvent, CancellationToken ct = default)
    {
        _spools[spool.Id] = spool;
        AddedSpools.Add(spool);
        CreatedEvents.Add(createdEvent);
        return Task.CompletedTask;
    }

    public Task UpdateAsync(Spool spool, SpoolEvent? newEvent = null, CancellationToken ct = default) =>
        throw new NotSupportedException();

    public Task<bool> DeleteAsync(string id, CancellationToken ct = default) =>
        throw new NotSupportedException();

    public Task<IReadOnlyList<SpoolEvent>> ListEventsAsync(string spoolId, CancellationToken ct = default) =>
        throw new NotSupportedException();

    public Task<Spool?> ApplyLifecycleAsync(string spoolId, LifecyclePlan plan, CancellationToken ct = default) =>
        throw new NotSupportedException();

    public Task<IReadOnlyList<SpoolReevaluation>> ReevaluateAllAsync(CancellationToken ct = default) =>
        throw new NotSupportedException();
}

public class SpoolsControllerCreateTests
{
    // The bug report scenario: the type says a standard spool is 1000 g, but the user bought a
    // spool with less filament and records it as 250 g.
    private static readonly FilamentType DefaultType = new()
    {
        Id = "T1",
        Brand = "BrandX",
        Material = "PLA",
        Type = "Basic",
        Color = "Red",
        DefaultNetWeightGrams = 1000,
        EmptySpoolWeightGrams = 200,
    };

    private static (SpoolsController controller, FakeSpoolStore store) CreateController()
    {
        var store = new FakeSpoolStore();
        return (new SpoolsController(store, new FakeTypeRepository(DefaultType), new FakeChangeNotifier()), store);
    }

    [Fact]
    public async Task Create_WithRequestedInitialNetGrams_PersistsRequestedValue()
    {
        var (controller, store) = CreateController();

        var result = await controller.Create(
            new CreateSpoolDto("T1", 250, null, null), CancellationToken.None);

        Assert.NotNull(result);

        // The spool handed to the repository is what gets persisted: the requested initial net
        // weight must win over the type default (1000 g) and seed the remaining balance.
        var stored = Assert.Single(store.AddedSpools);
        Assert.Equal(250, stored.InitialNetGrams);
        Assert.Equal(250, stored.RemainingGrams);

        // A zero-delta Created event, so the balance stays exactly the initial net weight.
        var createdEvent = Assert.Single(store.CreatedEvents);
        Assert.Equal(SpoolEventKind.Created, createdEvent.Kind);
        Assert.Equal(0, createdEvent.DeltaGrams);
    }

    [Fact]
    public async Task Create_WithoutInitialNetGrams_FallsBackToTypeDefault()
    {
        var (controller, store) = CreateController();

        var result = await controller.Create(
            new CreateSpoolDto("T1", null, null, null), CancellationToken.None);

        Assert.NotNull(result);
        var stored = Assert.Single(store.AddedSpools);

        Assert.Equal(1000, stored.InitialNetGrams);
        Assert.Equal(1000, stored.RemainingGrams);
    }
}
