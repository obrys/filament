using Filament.Core.Domain;
using Filament.Core.Services;
using Xunit;

namespace Filament.Core.Tests.Services;

public class SpoolWeightServiceTests
{
    private static Spool NewSpool(int remaining = 1000) => new()
    {
        Id = "AAAA",
        FilamentTypeId = "AAA",
        RemainingGrams = remaining,
        InitialNetGrams = 1000,
    };

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
    public void ComputeRemaining_SumsInitialAndEnabledDeltas()
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
    public void ComputeRemaining_IgnoresDisabledEvents()
    {
        var events = new[]
        {
            new SpoolEvent { Id = 1, SpoolId = "AAAA", Kind = SpoolEventKind.Print, DeltaGrams = -50 },
            new SpoolEvent { Id = 2, SpoolId = "AAAA", Kind = SpoolEventKind.Print, DeltaGrams = -30, IsDisabled = true },
        };
        Assert.Equal(950, SpoolWeightService.ComputeRemaining(1000, events));
    }

    [Fact]
    public void ComputeRemaining_NoEvents_ReturnsInitial()
    {
        Assert.Equal(1000, SpoolWeightService.ComputeRemaining(1000, Array.Empty<SpoolEvent>()));
    }
}
