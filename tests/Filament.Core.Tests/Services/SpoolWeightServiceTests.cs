using Filament.Core.Domain;
using Filament.Core.Services;
using Xunit;

namespace Filament.Core.Tests.Services;

public class SpoolWeightServiceTests
{
    private static Spool NewSpool(int remaining = 1000, SpoolStatus status = SpoolStatus.Sealed) => new()
    {
        Id = "AAAA",
        FilamentTypeId = "AAA",
        RemainingGrams = remaining,
        InitialNetGrams = 1000,
        Status = status,
    };

    [Fact]
    public void Consume_DecreasesRemainingAndTransitionsToOpen()
    {
        var s = NewSpool();
        var result = SpoolWeightService.Consume(s, 50, "Test", null);
        Assert.Equal(950, s.RemainingGrams);
        Assert.Equal(SpoolStatus.Open, s.Status);
        Assert.NotNull(s.OpenedAt);
        Assert.Equal(SpoolEventKind.Print, result.Event.Kind);
        Assert.Equal(-50, result.Event.DeltaGrams);
    }

    [Fact]
    public void Consume_AllRemaining_FinishesSpool()
    {
        var s = NewSpool(100);
        var result = SpoolWeightService.Consume(s, 100);
        Assert.Equal(0, s.RemainingGrams);
        Assert.Equal(SpoolStatus.Finished, s.Status);
        Assert.NotNull(s.FinishedAt);
        Assert.Equal(SpoolEventKind.Finished, result.Event.Kind);
    }

    [Fact]
    public void Consume_MoreThanRemaining_Throws()
    {
        var s = NewSpool(50);
        Assert.Throws<InvalidOperationException>(() => SpoolWeightService.Consume(s, 100));
    }

    [Fact]
    public void Consume_NonPositive_Throws()
    {
        var s = NewSpool();
        Assert.Throws<ArgumentOutOfRangeException>(() => SpoolWeightService.Consume(s, 0));
        Assert.Throws<ArgumentOutOfRangeException>(() => SpoolWeightService.Consume(s, -5));
    }

    [Fact]
    public void Consume_FinishedSpool_Throws()
    {
        var s = NewSpool(0, SpoolStatus.Finished);
        Assert.Throws<InvalidOperationException>(() => SpoolWeightService.Consume(s, 10));
    }

    [Fact]
    public void Adjust_SetsRemainingAndRecordsDelta()
    {
        var s = NewSpool(800, SpoolStatus.Open);
        var result = SpoolWeightService.Adjust(s, 750);
        Assert.Equal(750, s.RemainingGrams);
        Assert.Equal(-50, result.Event.DeltaGrams);
        Assert.Equal(SpoolEventKind.Adjustment, result.Event.Kind);
    }

    [Fact]
    public void Adjust_ToZero_FinishesSpool()
    {
        var s = NewSpool(50, SpoolStatus.Open);
        var result = SpoolWeightService.Adjust(s, 0);
        Assert.Equal(SpoolStatus.Finished, s.Status);
        Assert.Equal(SpoolEventKind.Finished, result.Event.Kind);
    }

    [Fact]
    public void EffectiveEmptySpoolGrams_UsesOverrideWhenSet()
    {
        var type = new FilamentType
        {
            Id = "AAA", Brand = "B", Material = "PLA", Type = "Basic",
            Color = "Red", EmptySpoolWeightGrams = 200,
        };
        var s = NewSpool();
        Assert.Equal(200, SpoolWeightService.EffectiveEmptySpoolGrams(s, type));
        s.EmptySpoolWeightGramsOverride = 150;
        Assert.Equal(150, SpoolWeightService.EffectiveEmptySpoolGrams(s, type));
    }

    [Fact]
    public void ComputeRemaining_SumsInitialAndDeltas()
    {
        var events = new[]
        {
            new SpoolEvent { Id = 1, SpoolId = "AAAA", Kind = SpoolEventKind.Created, DeltaGrams = 0 },
            new SpoolEvent { Id = 2, SpoolId = "AAAA", Kind = SpoolEventKind.Print, DeltaGrams = -50 },
            new SpoolEvent { Id = 3, SpoolId = "AAAA", Kind = SpoolEventKind.Adjustment, DeltaGrams = -30 },
        };
        Assert.Equal(920, SpoolWeightService.ComputeRemaining(1000, events));
    }

    [Fact]
    public void ComputeRemaining_NoEvents_ReturnsInitial()
    {
        Assert.Equal(1000, SpoolWeightService.ComputeRemaining(1000, Array.Empty<SpoolEvent>()));
    }

    [Fact]
    public void ComputeRemainingAfter_FoldsInChronologicalOrder()
    {
        var t0 = new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);
        // Provided out of order; helper must fold by (OccurredAt, Id).
        var events = new[]
        {
            new SpoolEvent { Id = 3, SpoolId = "AAAA", Kind = SpoolEventKind.Print, DeltaGrams = -30, OccurredAt = t0.AddHours(2) },
            new SpoolEvent { Id = 1, SpoolId = "AAAA", Kind = SpoolEventKind.Created, DeltaGrams = 0, OccurredAt = t0 },
            new SpoolEvent { Id = 2, SpoolId = "AAAA", Kind = SpoolEventKind.Print, DeltaGrams = -50, OccurredAt = t0.AddHours(1) },
        };
        var after = SpoolWeightService.ComputeRemainingAfter(1000, events);
        Assert.Equal(1000, after[1]);
        Assert.Equal(950, after[2]);
        Assert.Equal(920, after[3]);
    }

    [Fact]
    public void ComputeRemaining_MatchesConsumeAndAdjustSequence()
    {
        // The stored value the old schema kept must equal the recomputed value.
        var s = NewSpool(1000, SpoolStatus.Open);
        var e1 = SpoolWeightService.Consume(s, 200).Event;
        var e2 = SpoolWeightService.Adjust(s, 750).Event;
        var e3 = SpoolWeightService.Consume(s, 50).Event;
        var recomputed = SpoolWeightService.ComputeRemaining(s.InitialNetGrams, new[] { e1, e2, e3 });
        Assert.Equal(s.RemainingGrams, recomputed);
        Assert.Equal(700, recomputed);
    }
}
