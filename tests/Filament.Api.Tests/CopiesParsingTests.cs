using Filament.Api.Controllers;

namespace Filament.Api.Tests;

public class CopiesParsingTests
{
    [Theory]
    [InlineData("1", 1)]
    [InlineData("2", 2)]
    [InlineData("3", 3)]
    [InlineData("4", 4)]
    [InlineData("5", 5)]
    [InlineData("6", 6)]
    [InlineData("7", 7)]
    [InlineData("8", 8)]
    [InlineData("9", 9)]
    [InlineData("10", 10)]
    public void WholeNumbersFromOneToTen_Parse(string raw, int expected)
    {
        Assert.True(LabelsController.TryParseCopies(raw, out var copies));
        Assert.Equal(expected, copies);
    }

    [Theory]
    [InlineData("0")]
    [InlineData("-2")]
    [InlineData("1.5")]
    [InlineData("abc")]
    [InlineData("11")]
    public void OutOfRangeOrNotWhole_AreRejected(string raw) =>
        Assert.False(LabelsController.TryParseCopies(raw, out _));

    [Fact]
    public void SurroundingWhitespace_IsTolerated()
    {
        Assert.True(LabelsController.TryParseCopies(" 3 ", out var copies));
        Assert.Equal(3, copies);
    }
}
