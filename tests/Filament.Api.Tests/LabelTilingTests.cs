using System.Globalization;
using Filament.Api.Pdf;

namespace Filament.Api.Tests;

public class LabelTilingTests
{
    private static LabelData Label(string id) =>
        new(id, "Brand", "PLA", "Basic", "Red", null, $"http://lan/spools/{id}");

    [Fact]
    public void ExpandCopies_SingleLabelThreeCopies_MakesThreeOfIt()
    {
        var a = Label("A");
        var result = LabelPdfGenerator.ExpandCopies(new[] { a }, 3);
        Assert.Equal(new[] { a, a, a }, result);
    }

    [Fact]
    public void ExpandCopies_TwoLabelsTwoCopies_AreGroupedPerLabel()
    {
        var a = Label("A");
        var b = Label("B");
        var result = LabelPdfGenerator.ExpandCopies(new[] { a, b }, 2);
        Assert.Equal(new[] { a, a, b, b }, result);
    }

    [Fact]
    public void ExpandCopies_DuplicateLabels_EachOccurrenceExpands()
    {
        var a = Label("A");
        var result = LabelPdfGenerator.ExpandCopies(new[] { a, a }, 2);
        Assert.Equal(new[] { a, a, a, a }, result);
    }

    [Fact]
    public void ExpandCopies_OneCopy_ReturnsTheSameSequence()
    {
        var a = Label("A");
        var b = Label("B");
        var input = new[] { a, b };
        Assert.Equal(input, LabelPdfGenerator.ExpandCopies(input, 1));
    }

    [Fact]
    public void Paginate_EmptyProducesNoPages() =>
        Assert.Empty(LabelPdfGenerator.Paginate(Array.Empty<LabelData>()));

    [Theory]
    [InlineData(1, 1)]
    [InlineData(20, 20)]
    [InlineData(21, 21)]
    [InlineData(22, 21, 1)]
    [InlineData(42, 21, 21)]
    [InlineData(43, 21, 21, 1)]
    [InlineData(100, 21, 21, 21, 21, 16)]
    public void Paginate_SplitsIntoPagesOfAtMostTwentyOne(int count, params int[] expectedPageSizes)
    {
        var labels = Enumerable.Range(0, count).Select(i => Label(i.ToString("D2", CultureInfo.InvariantCulture))).ToList();
        var pages = LabelPdfGenerator.Paginate(labels)
            .Select(page => page.Select(l => l.SpoolId).ToList())
            .ToList();

        Assert.Equal(expectedPageSizes, pages.Select(p => p.Count).ToArray());
        Assert.Equal(Enumerable.Range(0, count).Select(i => i.ToString("D2", CultureInfo.InvariantCulture)), pages.SelectMany(p => p));
    }
}
