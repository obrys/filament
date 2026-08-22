using Filament.Core.Domain;
using Filament.Infrastructure.Persistence;
using Filament.Infrastructure.Repositories;
using Xunit;

namespace Filament.Infrastructure.Tests;

/// <summary>
/// Real-SQL evidence for the dashboard series path: the repository fetches every spool (including
/// finished) plus the full enabled-event history against MariaDB and the per-day reconstruction —
/// pre-window baseline, creation-day gating, the print step, cross-spool summation, the consumed
/// line, and the enabled-filter (undo) — all match.
/// </summary>
[Collection("MariaDb")]
public class DashboardSeriesTests : IAsyncLifetime
{
    private readonly MariaDbFixture _fixture;
    private FilamentDbContext _db = null!;
    private Seeder _s = null!;

    public DashboardSeriesTests(MariaDbFixture fixture) => _fixture = fixture;

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

    /// <summary>UTC instant <paramref name="daysAgo"/> days ago (default noon UTC, unambiguous day).</summary>
    private static DateTimeOffset At(int daysAgo, int hourUtc = 12)
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-daysAgo);
        return new DateTimeOffset(today.Year, today.Month, today.Day, hourUtc, 0, 0, TimeSpan.Zero);
    }

    [Fact]
    public async Task GetSeries_Reconstructs_PreWindowAndInWindow_Spools()
    {
        // S1: created + a print entirely before the window => a constant 800 g baseline (1000 - 200).
        await _s.CreateSpoolAsync("S1", "FT1", 1000, At(40));
        await _s.OpenAsync("S1", At(40, 13));
        await _s.ConsumeAsync("S1", 200, At(35));

        // S2: created 15 days ago (1000 g), printed 300 g 10 days ago.
        await _s.CreateSpoolAsync("S2", "FT1", 1000, At(15));
        await _s.OpenAsync("S2", At(15, 13));
        await _s.ConsumeAsync("S2", 300, At(10));

        var repo = new DashboardRepository(_db);
        var series = await repo.GetSeriesAsync(30);

        // Full, zero-filled, consecutive window.
        Assert.Equal(30, series.Count);
        for (var i = 1; i < series.Count; i++)
            Assert.Equal(series[i - 1].Day.AddDays(1), series[i].Day);

        // Index i == (29 - daysAgo). S2 created 15 days ago => i=14; its print 10 days ago => i=19.
        for (var i = 0; i <= 13; i++)
        {
            Assert.Equal(800, series[i].TotalStockGrams); // only S1's baseline
            Assert.Equal(0, series[i].ConsumedGrams);
        }
        for (var i = 14; i <= 18; i++)
        {
            Assert.Equal(1800, series[i].TotalStockGrams); // S1 baseline + S2 1000
            Assert.Equal(0, series[i].ConsumedGrams);
        }
        Assert.Equal(1500, series[19].TotalStockGrams);    // S1 800 + S2 700 after the print
        Assert.Equal(300, series[19].ConsumedGrams);       // S2's print; S1's pre-window print is not counted
        for (var i = 20; i <= 29; i++)
        {
            Assert.Equal(1500, series[i].TotalStockGrams);
            Assert.Equal(0, series[i].ConsumedGrams);
        }
    }

    [Fact]
    public async Task GetSeries_NoData_Is_Thirty_Zeros()
    {
        var repo = new DashboardRepository(_db);
        var series = await repo.GetSeriesAsync(30);

        Assert.Equal(30, series.Count);
        Assert.All(series, p => { Assert.Equal(0, p.TotalStockGrams); Assert.Equal(0, p.ConsumedGrams); });
    }

    [Fact]
    public async Task GetSeries_UndoingAPrint_RemovesItsEffect()
    {
        await _s.CreateSpoolAsync("S3", "FT1", 1000, At(20));
        await _s.OpenAsync("S3", At(20, 13));
        await _s.ConsumeAsync("S3", 250, At(5));

        var repo = new DashboardRepository(_db);
        var withPrint = await repo.GetSeriesAsync(30);
        Assert.Equal(250, withPrint[24].ConsumedGrams); // 5 days ago => index 24
        Assert.Equal(750, withPrint[24].TotalStockGrams);

        var events = await _s.Spools.ListEventsAsync("S3");
        var print = Assert.Single(events, e => e.Kind == SpoolEventKind.Print && !e.IsDisabled);
        await _s.SetEnabledAsync("S3", print.Id, enabled: false);

        var undone = await repo.GetSeriesAsync(30);
        Assert.Equal(0, undone[24].ConsumedGrams);
        Assert.Equal(1000, undone[24].TotalStockGrams);
    }
}
