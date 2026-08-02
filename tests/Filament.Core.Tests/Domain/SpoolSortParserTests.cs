using Filament.Core.Domain;
using Xunit;

namespace Filament.Core.Tests.Domain;

public class SpoolSortParserTests
{
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("garbage")]
    [InlineData("LASTUSED")]
    [InlineData("LastUsed")]
    [InlineData(" leastRemaining")]
    [InlineData("mostremaining")]
    public void Parse_UnknownEmptyOrCasedValue_ReturnsLastUsed(string? raw)
    {
        Assert.Equal(SpoolSort.LastUsed, SpoolSortParser.Parse(raw));
    }

    [Fact]
    public void Parse_LastUsed_ReturnsLastUsed()
    {
        Assert.Equal(SpoolSort.LastUsed, SpoolSortParser.Parse("lastUsed"));
    }

    [Fact]
    public void Parse_LeastRemaining_ReturnsLeastRemaining()
    {
        Assert.Equal(SpoolSort.LeastRemaining, SpoolSortParser.Parse("leastRemaining"));
    }

    [Fact]
    public void Parse_MostRemaining_ReturnsMostRemaining()
    {
        Assert.Equal(SpoolSort.MostRemaining, SpoolSortParser.Parse("mostRemaining"));
    }
}
