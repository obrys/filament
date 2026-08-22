using Filament.Core.Domain;
using Filament.Core.Services;
using Xunit;

namespace Filament.Core.Tests.Services;

public class SpoolSeriesTests
{
    // Fixed window Jan 1..Jan 30 2026 ending at Jan 30 (so index i == Jan (i+1)).
    private static readonly DateOnly EndDay = new(2026, 1, 30);
    private const int Days = 30;

    private static DateOnly D(int janDay) => new DateOnly(2026, 1, janDay);
    private static DateOnly Dec(int day) => new DateOnly(2025, 12, day);

    private static SpoolEvent Ev(long id, SpoolEventKind kind, int delta, DateOnly day, bool disabled = false) => new()
    {
        Id = id,
        SpoolId = "S1",
        Kind = kind,
        DeltaGrams = delta,
        IsDisabled = disabled,
        // Noon UTC: unambiguous calendar day regardless of the machine's local offset.
        OccurredAt = new DateTimeOffset(new DateTime(day.Year, day.Month, day.Day, 12, 0, 0), TimeSpan.Zero),
    };

    private static IReadOnlyList<DailySeriesPoint> Build(int initial, params SpoolEvent[] events) =>
        SpoolSeries.BuildSeries(new[] { new SpoolSeriesInput("S1", initial, events.ToList()) }, EndDay, Days);

    private static DailySeriesPoint At(IReadOnlyList<DailySeriesPoint> series, int janDay) =>
        series.Single(x => x.Day == D(janDay));

    // ---- window shape / zero-fill ----

    [Fact]
    public void Window_Is_Thirty_Consecutive_ZeroFilled_Days()
    {
        var series = Build(initial: 1000, Ev(1, SpoolEventKind.Created, 0, D(1)));

        Assert.Equal(Days, series.Count);
        Assert.Equal(D(1), series[0].Day);
        Assert.Equal(EndDay, series[Days - 1].Day);
        for (var i = 1; i < Days; i++)
            Assert.Equal(series[i - 1].Day.AddDays(1), series[i].Day);

        for (var i = 0; i < Days; i++)
        {
            Assert.Equal(0, series[i].ConsumedGrams);
            Assert.Equal(1000, series[i].TotalStockGrams);
        }
    }

    [Fact]
    public void No_Spools_Is_FlatZero_With_FullWindow()
    {
        var series = SpoolSeries.BuildSeries(Array.Empty<SpoolSeriesInput>(), EndDay, Days);
        Assert.Equal(Days, series.Count);
        Assert.Equal(D(1), series[0].Day);
        Assert.Equal(EndDay, series[Days - 1].Day);
        Assert.All(series, p => { Assert.Equal(0, p.ConsumedGrams); Assert.Equal(0, p.TotalStockGrams); });
    }

    // ---- consumed = prints only ----

    [Fact]
    public void Consumed_Counts_Prints_Only_Not_Adjustments()
    {
        var series = Build(initial: 1000,
            Ev(1, SpoolEventKind.Created, 0, D(1)),
            Ev(2, SpoolEventKind.Opened, 0, D(2)),
            Ev(3, SpoolEventKind.Print, -50, D(10)),
            Ev(4, SpoolEventKind.Adjustment, -30, D(11)),
            Ev(5, SpoolEventKind.Adjustment, +70, D(12)));

        Assert.Equal(50, At(series, 10).ConsumedGrams);
        Assert.Equal(0, At(series, 11).ConsumedGrams); // a negative adjustment never raises consumed
        Assert.Equal(0, At(series, 12).ConsumedGrams); // a positive adjustment also never counts
        Assert.Equal(0, At(series, 9).ConsumedGrams);
    }

    [Fact]
    public void Consumed_Multiple_Prints_OneDay_Sum()
    {
        var series = Build(initial: 1000,
            Ev(1, SpoolEventKind.Created, 0, D(1)),
            Ev(2, SpoolEventKind.Opened, 0, D(1)),
            Ev(3, SpoolEventKind.Print, -40, D(5)),
            Ev(4, SpoolEventKind.Print, -60, D(5)));

        Assert.Equal(100, At(series, 5).ConsumedGrams);
        Assert.Equal(1000, At(series, 4).TotalStockGrams);
        Assert.Equal(900, At(series, 5).TotalStockGrams);
        Assert.Equal(900, At(series, 6).TotalStockGrams);
    }

    // ---- print effect ----

    [Fact]
    public void Print_RaisesConsumedOnDay_LowersStockFromThatDayOnward()
    {
        var series = Build(initial: 1000,
            Ev(1, SpoolEventKind.Created, 0, D(1)),
            Ev(2, SpoolEventKind.Opened, 0, D(2)),
            Ev(3, SpoolEventKind.Print, -300, D(8)));

        Assert.Equal(0, At(series, 7).ConsumedGrams);
        Assert.Equal(300, At(series, 8).ConsumedGrams);
        Assert.Equal(0, At(series, 9).ConsumedGrams);
        Assert.Equal(1000, At(series, 7).TotalStockGrams);
        Assert.Equal(700, At(series, 8).TotalStockGrams);
        Assert.Equal(700, At(series, 29).TotalStockGrams);
    }

    // ---- adjustments ----

    [Fact]
    public void Positive_Adjustment_ShiftsStockUp_UnaffectedConsumed()
    {
        var series = Build(initial: 1000,
            Ev(1, SpoolEventKind.Created, 0, D(1)),
            Ev(2, SpoolEventKind.Opened, 0, D(2)),
            Ev(3, SpoolEventKind.Adjustment, +250, D(6)));

        Assert.Equal(0, At(series, 6).ConsumedGrams);
        Assert.Equal(1000, At(series, 5).TotalStockGrams);
        Assert.Equal(1250, At(series, 6).TotalStockGrams);
        Assert.Equal(1250, At(series, 29).TotalStockGrams);
    }

    [Fact]
    public void Negative_Adjustment_ShiftsStockDown_UnaffectedConsumed()
    {
        var series = Build(initial: 1000,
            Ev(1, SpoolEventKind.Created, 0, D(1)),
            Ev(2, SpoolEventKind.Opened, 0, D(2)),
            Ev(3, SpoolEventKind.Adjustment, -200, D(6)));

        Assert.Equal(0, At(series, 6).ConsumedGrams);
        Assert.Equal(1000, At(series, 5).TotalStockGrams);
        Assert.Equal(800, At(series, 6).TotalStockGrams);
        Assert.Equal(800, At(series, 29).TotalStockGrams);
    }

    // ---- finish ----

    [Fact]
    public void Finish_ExcludesRemainingFromStock_FromFinishDayOnward()
    {
        var series = Build(initial: 1000,
            Ev(1, SpoolEventKind.Created, 0, D(1)),
            Ev(2, SpoolEventKind.Opened, 0, D(2)),
            Ev(3, SpoolEventKind.Finished, 0, D(7)));

        Assert.Equal(1000, At(series, 6).TotalStockGrams);
        Assert.Equal(0, At(series, 7).TotalStockGrams);
        Assert.Equal(0, At(series, 29).TotalStockGrams);
        Assert.Equal(0, At(series, 7).ConsumedGrams);
    }

    [Fact]
    public void Finish_AtZeroGrams_ChangesNeitherLine()
    {
        var series = Build(initial: 500,
            Ev(1, SpoolEventKind.Created, 0, D(1)),
            Ev(2, SpoolEventKind.Opened, 0, D(2)),
            Ev(3, SpoolEventKind.Print, -500, D(3)),
            Ev(4, SpoolEventKind.Finished, 0, D(5)));

        Assert.Equal(500, At(series, 1).TotalStockGrams);
        Assert.Equal(500, At(series, 2).TotalStockGrams);
        Assert.Equal(0, At(series, 3).TotalStockGrams);
        Assert.Equal(0, At(series, 5).TotalStockGrams); // finish added no further reduction
        Assert.Equal(500, At(series, 3).ConsumedGrams);
        Assert.Equal(0, At(series, 5).ConsumedGrams); // finish never touches consumed
    }

    // ---- creation day ----

    [Fact]
    public void Spool_CreatedOnDayC_ContributesZeroBefore_WeightFromThenOn()
    {
        var series = Build(initial: 1000, Ev(1, SpoolEventKind.Created, 0, D(9)));

        Assert.Equal(0, At(series, 8).TotalStockGrams);
        Assert.Equal(1000, At(series, 9).TotalStockGrams);
        Assert.Equal(1000, At(series, 30).TotalStockGrams);
    }

    // ---- pre-window baseline ----

    [Fact]
    public void PreWindow_Finish_ContributesZeroForWholeWindow()
    {
        var events = new[]
        {
            Ev(1, SpoolEventKind.Created, 0, Dec(20)),
            Ev(2, SpoolEventKind.Opened, 0, Dec(22)),
            Ev(3, SpoolEventKind.Print, -300, Dec(24)),
            Ev(4, SpoolEventKind.Finished, 0, Dec(28)),
        };
        var series = Build(initial: 1000, events);
        Assert.All(series, p =>
        {
            Assert.Equal(0, p.TotalStockGrams); // thrown away before the window starts
            Assert.Equal(0, p.ConsumedGrams);   // pre-window prints are not in-window
        });
    }

    [Fact]
    public void PreWindow_Events_SetStartingBalance()
    {
        var events = new[]
        {
            Ev(1, SpoolEventKind.Created, 0, Dec(25)),
            Ev(2, SpoolEventKind.Opened, 0, Dec(26)),
            Ev(3, SpoolEventKind.Print, -400, Dec(28)),
        };
        var series = Build(initial: 1000, events);
        // Baseline at window start is 600; a flat, exact reconstruction with no in-window events.
        Assert.All(series, p =>
        {
            Assert.Equal(600, p.TotalStockGrams);
            Assert.Equal(0, p.ConsumedGrams);
        });
    }

    // ---- undo / redo ----

    [Fact]
    public void UndoRedo_Print_RemovesAndRestoresEffect_FromThatDayOnward()
    {
        var on = Build(initial: 1000,
            Ev(1, SpoolEventKind.Created, 0, D(1)),
            Ev(2, SpoolEventKind.Opened, 0, D(2)),
            Ev(3, SpoolEventKind.Print, -300, D(8)));
        var off = Build(initial: 1000,
            Ev(1, SpoolEventKind.Created, 0, D(1)),
            Ev(2, SpoolEventKind.Opened, 0, D(2)),
            Ev(3, SpoolEventKind.Print, -300, D(8), disabled: true));

        Assert.Equal(300, At(on, 8).ConsumedGrams);
        Assert.Equal(700, At(on, 8).TotalStockGrams);
        Assert.Equal(700, At(on, 15).TotalStockGrams);

        Assert.Equal(0, At(off, 8).ConsumedGrams);
        Assert.Equal(1000, At(off, 8).TotalStockGrams);
        Assert.Equal(1000, At(off, 15).TotalStockGrams);
    }

    [Fact]
    public void UndoRedo_Finish_RemovesAndRestoresStockContributedBefore()
    {
        var on = Build(initial: 1000,
            Ev(1, SpoolEventKind.Created, 0, D(1)),
            Ev(2, SpoolEventKind.Opened, 0, D(2)),
            Ev(3, SpoolEventKind.Finished, 0, D(7)));
        var off = Build(initial: 1000,
            Ev(1, SpoolEventKind.Created, 0, D(1)),
            Ev(2, SpoolEventKind.Opened, 0, D(2)),
            Ev(3, SpoolEventKind.Finished, 0, D(7), disabled: true));

        Assert.Equal(0, At(on, 7).TotalStockGrams);
        Assert.Equal(0, At(on, 20).TotalStockGrams);
        Assert.Equal(1000, At(off, 7).TotalStockGrams);  // finishing is undone: stock restored
        Assert.Equal(1000, At(off, 20).TotalStockGrams);
    }

    // ---- clamping ----

    [Fact]
    public void Stock_Is_NonNegative_Clamped()
    {
        var series = Build(initial: 200,
            Ev(1, SpoolEventKind.Created, 0, D(1)),
            Ev(2, SpoolEventKind.Opened, 0, D(2)),
            Ev(3, SpoolEventKind.Print, -500, D(3)));

        Assert.Equal(500, At(series, 3).ConsumedGrams);
        Assert.Equal(0, At(series, 3).TotalStockGrams);  // -300 clamped to 0, never negative
        Assert.Equal(0, At(series, 10).TotalStockGrams);
    }

    // ---- cross-spool summation ----

    [Fact]
    public void TotalStock_and_Consumed_SumAcrossSpools()
    {
        var inputs = new[]
        {
            new SpoolSeriesInput("A", 1000, new List<SpoolEvent>
            {
                Ev(1, SpoolEventKind.Created, 0, D(1)),
                Ev(2, SpoolEventKind.Opened, 0, D(1)),
                Ev(3, SpoolEventKind.Print, -100, D(5)),
            }),
            new SpoolSeriesInput("B", 2000, new List<SpoolEvent>
            {
                Ev(11, SpoolEventKind.Created, 0, D(3)),
            }),
        };
        var series = SpoolSeries.BuildSeries(inputs, EndDay, Days);

        Assert.Equal(1000, At(series, 2).TotalStockGrams); // A only (B not yet created)
        Assert.Equal(3000, At(series, 3).TotalStockGrams); // A + B
        Assert.Equal(2900, At(series, 5).TotalStockGrams); // A printed 100
        Assert.Equal(100, At(series, 5).ConsumedGrams);
    }
}
