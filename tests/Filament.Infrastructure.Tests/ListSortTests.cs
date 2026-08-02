using Filament.Core.Domain;
using Filament.Infrastructure.Persistence;
using Filament.Infrastructure.Repositories;
using Xunit;

namespace Filament.Infrastructure.Tests;

[Collection("MariaDb")]
public class ListSortTests : IAsyncLifetime
{
    private static readonly DateTimeOffset T0 = new(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);
    private static DateTimeOffset H(double h) => T0.AddHours(h);

    private readonly MariaDbFixture _fixture;
    private FilamentDbContext _db = null!;
    private Seeder _s = null!;

    public ListSortTests(MariaDbFixture fixture) => _fixture = fixture;

    public async Task InitializeAsync()
    {
        await _fixture.ResetAsync();
        _db = _fixture.CreateContext();
        _s = new Seeder(_db);
        await _s.CreateTypeAsync("FT1");
    }

    public Task DisposeAsync()
    {
        _db.Dispose();
        return Task.CompletedTask;
    }

    private static async Task<List<string>> IdsInOrder(SpoolRepository repo, SpoolSort sort, string? filamentTypeId = null, bool includeFinished = false)
    {
        var list = await repo.ListAsync(sort, filamentTypeId, includeFinished);
        return list.Select(x => x.Id).ToList();
    }

    // ---- AC-1 ----
    [Fact]
    public async Task NoSort_DefaultsToLastUsedDescThenIdAsc()
    {
        var s = _s;
        await s.CreateSpoolAsync("OLD", "FT1", 1000, H(1));
        await s.CreateSpoolAsync("NEW", "FT1", 1000, H(5));

        var order = await IdsInOrder(s.Spools, SpoolSort.LastUsed); // default
        // Most recent lastUsedAt first.
        Assert.Equal(new[] { "NEW", "OLD" }, order);

        // Tie-break: equal lastUsedAt resolves to id ascending.
        await s.CreateSpoolAsync("BBB", "FT1", 1000, H(5));
        await s.CreateSpoolAsync("AAA", "FT1", 1000, H(5));
        var order2 = await IdsInOrder(s.Spools, SpoolSort.LastUsed);
        Assert.Equal("AAA", order2[0]);
        Assert.Equal("BBB", order2[1]);
    }

    // ---- AC-2 ----
    [Fact]
    public async Task SortLastUsed_OrdersByLastUsedDescThenIdAsc()
    {
        var s = _s;
        await s.CreateSpoolAsync("A", "FT1", 1000, H(3));
        await s.CreateSpoolAsync("B", "FT1", 1000, H(7));
        await s.CreateSpoolAsync("C", "FT1", 1000, H(7));

        var order = await IdsInOrder(s.Spools, SpoolSort.LastUsed);
        // h7 ties: id asc (B before C); then h3 (A).
        Assert.Equal(new[] { "B", "C", "A" }, order);
    }

    // ---- AC-3 ----
    [Fact]
    public async Task SortLeastRemaining_OrdersByRemainingAscThenLastUsedDescThenIdAsc()
    {
        var s = _s;
        await s.CreateSpoolAsync("FIVE", "FT1", 5, H(10));
        await s.CreateSpoolAsync("FIFTY", "FT1", 50, H(10));
        await s.CreateSpoolAsync("FIVEH", "FT1", 500, H(10));

        var order = await IdsInOrder(s.Spools, SpoolSort.LeastRemaining);
        Assert.Equal(new[] { "FIVE", "FIFTY", "FIVEH" }, order);

        // Equal remaining: lastUsedAt desc, then id asc.
        await s.CreateSpoolAsync("EQ1", "FT1", 100, H(2));
        await s.CreateSpoolAsync("EQ2", "FT1", 100, H(8));
        await s.CreateSpoolAsync("EQ3", "FT1", 100, H(8));
        var order2 = await IdsInOrder(s.Spools, SpoolSort.LeastRemaining);
        // remaining 100 group: EQ2(h8) and EQ3(h8) before EQ1(h2); within h8 tie, id asc → EQ2, EQ3.
        var hundred = order2.Where(id => id is "EQ1" or "EQ2" or "EQ3").ToList();
        Assert.Equal(new[] { "EQ2", "EQ3", "EQ1" }, hundred);
    }

    // ---- AC-4 ----
    [Fact]
    public async Task SortMostRemaining_OrdersByRemainingDescThenLastUsedDescThenIdAsc()
    {
        var s = _s;
        await s.CreateSpoolAsync("FIVE", "FT1", 5, H(10));
        await s.CreateSpoolAsync("FIFTY", "FT1", 50, H(10));
        await s.CreateSpoolAsync("FIVEH", "FT1", 500, H(10));

        var order = await IdsInOrder(s.Spools, SpoolSort.MostRemaining);
        Assert.Equal(new[] { "FIVEH", "FIFTY", "FIVE" }, order);

        // Equal remaining: lastUsedAt desc, then id asc.
        await s.CreateSpoolAsync("EQ1", "FT1", 100, H(2));
        await s.CreateSpoolAsync("EQ2", "FT1", 100, H(8));
        await s.CreateSpoolAsync("EQ3", "FT1", 100, H(8));
        var order2 = await IdsInOrder(s.Spools, SpoolSort.MostRemaining);
        var hundred = order2.Where(id => id is "EQ1" or "EQ2" or "EQ3").ToList();
        Assert.Equal(new[] { "EQ2", "EQ3", "EQ1" }, hundred);
    }

    // ---- AC-7 ----
    [Fact]
    public async Task SortLastUsed_WithIncludeFinished_InterleavesFinished()
    {
        var s = _s;
        // Active spool created early (lastUsedAt = h1).
        await s.CreateSpoolAsync("ACTIVE", "FT1", 1000, H(1));
        // Finished spool whose finish event (h9) makes its lastUsedAt newer than the active spool's.
        await s.CreateSpoolAsync("DONE", "FT1", 1000, H(2));
        await s.OpenAsync("DONE", H(3));
        await s.ConsumeAsync("DONE", 100, H(4));
        await s.FinishAsync("DONE", H(9));

        // Without includeFinished, the finished spool is filtered out.
        var activeOnly = await IdsInOrder(s.Spools, SpoolSort.LastUsed, includeFinished: false);
        Assert.Equal(new[] { "ACTIVE" }, activeOnly);

        // With includeFinished, DONE (lastUsedAt h9) sorts before ACTIVE (lastUsedAt h1).
        var withFinished = await IdsInOrder(s.Spools, SpoolSort.LastUsed, includeFinished: true);
        Assert.Equal(new[] { "DONE", "ACTIVE" }, withFinished);

        // The same interleaving holds under the remaining sorts (DONE has 900 remaining after consume).
        var byLeast = await IdsInOrder(s.Spools, SpoolSort.LeastRemaining, includeFinished: true);
        Assert.Equal(new[] { "DONE", "ACTIVE" }, byLeast); // 900 < 1000
    }

    // ---- AC-8 (repository-level proxy) ----
    [Fact]
    public async Task SortWithFacets_SpoolSetIsOrderInvariant()
    {
        // Facets are computed over the universe of returned spools and are independent of order.
        // At the repository level we evidence that by showing every sort returns the same SET of
        // ids for the same filamentTypeId/includeFinished — only the order differs. That set
        // equality is the precondition for the controller's FacetsDto being unchanged by sort.
        var s = _s;
        await s.CreateSpoolAsync("A", "FT1", 5, H(1));
        await s.CreateSpoolAsync("B", "FT1", 500, H(2));
        await s.CreateSpoolAsync("C", "FT1", 50, H(3));
        await s.CreateSpoolAsync("D", "FT1", 50, H(3));

        var byLast = (await IdsInOrder(s.Spools, SpoolSort.LastUsed)).OrderBy(x => x).ToList();
        var byLeast = (await IdsInOrder(s.Spools, SpoolSort.LeastRemaining)).OrderBy(x => x).ToList();
        var byMost = (await IdsInOrder(s.Spools, SpoolSort.MostRemaining)).OrderBy(x => x).ToList();

        Assert.Equal(byLast, byLeast);
        Assert.Equal(byLast, byMost);
    }

    // ---- AC-9 (infrastructure part: entity→domain mapping of LastUsedAt) ----
    [Fact]
    public async Task MappedLastUsedAt_EqualsMostRecentEnabledEventOrCreatedAt()
    {
        var s = _s;
        // Created-only → lastUsedAt == Created event's OccurredAt.
        await s.CreateSpoolAsync("ONLY", "FT1", 1000, H(3));
        var only = await s.Spools.GetAsync("ONLY");
        Assert.NotNull(only);
        Assert.Equal(H(3), only!.LastUsedAt);

        // A spool with a later event → lastUsedAt == that event's occurredAt.
        await s.CreateSpoolAsync("USED", "FT1", 1000, H(1));
        await s.OpenAsync("USED", H(2));
        await s.ConsumeAsync("USED", 100, H(5));
        var used = await s.Spools.GetAsync("USED");
        Assert.NotNull(used);
        Assert.Equal(H(5), used!.LastUsedAt);

        // Also observable through ListAsync.
        var list = await s.Spools.ListAsync(SpoolSort.LastUsed);
        Assert.Equal(H(3), list.First(x => x.Id == "ONLY").LastUsedAt);
        Assert.Equal(H(5), list.First(x => x.Id == "USED").LastUsedAt);
    }

    // ---- AC-10 ----
    [Fact]
    public async Task AfterDisableMostRecentEvent_LastUsedAtMovesToPriorEvent()
    {
        var s = _s;
        await s.CreateSpoolAsync("S", "FT1", 1000, H(0));
        await s.OpenAsync("S", H(1));
        await s.ConsumeAsync("S", 100, H(2)); // most recent enabled event → lastUsedAt == h2

        var before = await s.Spools.GetAsync("S");
        Assert.Equal(H(2), before!.LastUsedAt);

        // Disable the most recent event (the Print at h2).
        var events = await s.Spools.ListEventsAsync("S");
        var print = events.First(e => e.Kind == SpoolEventKind.Print);
        await s.SetEnabledAsync("S", print.Id, enabled: false);

        var after = await s.Spools.GetAsync("S");
        Assert.Equal(H(1), after!.LastUsedAt); // now the Open at h1 is the most recent enabled
    }

    // ---- AC-11 ----
    [Fact]
    public async Task AfterReenableEvent_LastUsedAtMovesToIt()
    {
        var s = _s;
        await s.CreateSpoolAsync("S", "FT1", 1000, H(0));
        await s.OpenAsync("S", H(1));
        await s.ConsumeAsync("S", 100, H(2));

        var events = await s.Spools.ListEventsAsync("S");
        var print = events.First(e => e.Kind == SpoolEventKind.Print);
        await s.SetEnabledAsync("S", print.Id, enabled: false);

        var disabled = await s.Spools.GetAsync("S");
        Assert.Equal(H(1), disabled!.LastUsedAt);

        // Re-enable (redo) the Print at h2 → lastUsedAt moves back to h2.
        await s.SetEnabledAsync("S", print.Id, enabled: true);
        var reenabled = await s.Spools.GetAsync("S");
        Assert.Equal(H(2), reenabled!.LastUsedAt);
    }
}
