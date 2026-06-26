using Filament.Core.Faceting;
using Filament.Core.Services;
using Xunit;

namespace Filament.Core.Tests.Faceting;

public class FacetEngineTests
{
    private sealed record Item(string Brand, string Material, string Type, string Color);

    private static FacetAttributes Attrs(Item i) => new(i.Brand, i.Material, i.Type, i.Color);

    // A small universe used by several tests.
    private static IReadOnlyList<Item> Universe() =>
    [
        new("Bambu", "PETG", "Basic", "Red"),
        new("Bambu", "PLA", "Silk", "Red"),
        new("Prusa", "PLA", "Basic", "Blue"),
        new("Prusa", "PETG", "Basic", "Black"),
    ];

    private static FacetOption? Find(IReadOnlyList<FacetOption> options, string value) =>
        options.FirstOrDefault(o => o.Value == value);

    [Fact]
    public void Apply_EmptySelection_ReturnsAllItems()
    {
        var items = Universe();
        var result = FacetEngine.Apply(items, Attrs, FacetSelection.Empty);
        Assert.Equal(items.Count, result.Items.Count);
    }

    [Fact]
    public void Apply_EmptySelection_CountsEqualOccurrences()
    {
        var result = FacetEngine.Apply(Universe(), Attrs, FacetSelection.Empty);
        Assert.Equal(2, Find(result.Facets.Brand, "Bambu")!.Count);
        Assert.Equal(2, Find(result.Facets.Brand, "Prusa")!.Count);
        Assert.Equal(2, Find(result.Facets.Material, "PETG")!.Count);
        Assert.Equal(2, Find(result.Facets.Material, "PLA")!.Count);
        Assert.Equal(2, Find(result.Facets.Color, "Red")!.Count);
    }

    [Fact]
    public void Apply_SingleFacet_FiltersItemsAndAndsAcrossFacets()
    {
        var selection = FacetSelection.From(null, ["PETG"], null, null);
        var result = FacetEngine.Apply(Universe(), Attrs, selection);
        Assert.All(result.Items, i => Assert.Equal("PETG", i.Material));
        Assert.Equal(2, result.Items.Count);
    }

    [Fact]
    public void Apply_WithinFacet_OrsSelectedValues()
    {
        var selection = FacetSelection.From(["Bambu", "Prusa"], null, null, null);
        var result = FacetEngine.Apply(Universe(), Attrs, selection);
        Assert.Equal(4, result.Items.Count);
    }

    [Fact]
    public void Apply_FacetCounts_IgnoreOwnSelection()
    {
        // Selecting one brand must NOT collapse the brand facet to just that brand: its own
        // counts ignore its own selection so the user can switch/extend within it.
        var selection = FacetSelection.From(["Bambu"], null, null, null);
        var result = FacetEngine.Apply(Universe(), Attrs, selection);
        Assert.Equal(2, Find(result.Facets.Brand, "Bambu")!.Count);
        Assert.Equal(2, Find(result.Facets.Brand, "Prusa")!.Count);
    }

    [Fact]
    public void Apply_OtherFacetCounts_ReflectSelection()
    {
        // With Brand=Bambu, the Material facet counts only Bambu rows.
        var selection = FacetSelection.From(["Bambu"], null, null, null);
        var result = FacetEngine.Apply(Universe(), Attrs, selection);
        Assert.Equal(1, Find(result.Facets.Material, "PETG")!.Count);
        Assert.Equal(1, Find(result.Facets.Material, "PLA")!.Count);
    }

    [Fact]
    public void Apply_AnalysisExample_PetgAndRed_TypeFacetHasBasic1AndSilk0()
    {
        // From the change analysis: selecting Material=PETG and Color=Red, the Type facet
        // should show Basic (1) and Silk (0).
        var selection = FacetSelection.From(null, ["PETG"], null, ["Red"]);
        var result = FacetEngine.Apply(Universe(), Attrs, selection);
        Assert.Equal(1, Find(result.Facets.Type, "Basic")!.Count);
        Assert.Equal(0, Find(result.Facets.Type, "Silk")!.Count);
    }

    [Fact]
    public void Apply_ZeroCountValues_AreListedAndSortLast()
    {
        var selection = FacetSelection.From(null, ["PETG"], null, ["Red"]);
        var result = FacetEngine.Apply(Universe(), Attrs, selection);
        var types = result.Facets.Type;
        // Silk has a zero count but is still present.
        Assert.NotNull(Find(types, "Silk"));
        // It sorts after the non-zero Basic.
        Assert.Equal("Basic", types[0].Value);
        Assert.Equal("Silk", types[^1].Value);
    }

    [Fact]
    public void Apply_Options_SortedByCountDescThenValueAsc()
    {
        IReadOnlyList<Item> items =
        [
            new("Bambu", "PLA", "Basic", "Red"),
            new("Creality", "PLA", "Basic", "Red"),
            new("Creality", "PLA", "Basic", "Red"),
            new("Anycubic", "PLA", "Basic", "Red"),
        ];
        var result = FacetEngine.Apply(items, Attrs, FacetSelection.Empty);
        var brands = result.Facets.Brand;
        // Creality (2) first, then Anycubic (1), Bambu (1) alphabetically.
        Assert.Equal("Creality", brands[0].Value);
        Assert.Equal(2, brands[0].Count);
        Assert.Equal("Anycubic", brands[1].Value);
        Assert.Equal("Bambu", brands[2].Value);
    }

    [Fact]
    public void Apply_ColorMatching_IsCaseSensitive()
    {
        IReadOnlyList<Item> items =
        [
            new("Bambu", "PLA", "Basic", "Red"),
            new("Bambu", "PLA", "Basic", "burning red"),
        ];
        var selection = FacetSelection.From(null, null, null, ["Red"]);
        var result = FacetEngine.Apply(items, Attrs, selection);
        Assert.Single(result.Items);
        Assert.Equal("Red", result.Items[0].Color);
    }

    [Fact]
    public void Apply_EmptyUniverse_ReturnsEmptyFacets()
    {
        var result = FacetEngine.Apply(Array.Empty<Item>(), Attrs, FacetSelection.Empty);
        Assert.Empty(result.Items);
        Assert.Empty(result.Facets.Brand);
        Assert.Empty(result.Facets.Color);
    }
}
