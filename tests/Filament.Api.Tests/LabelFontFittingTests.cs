using Filament.Api.Pdf;

namespace Filament.Api.Tests;

/// <summary>
/// Contract tests for the label font fitting helpers. Character widths are estimated at
/// <c>AvgCharEm (0.7)</c> times the font size, the band is 7.75 mm and the text column 32 mm;
/// at 8 pt that is 1.976 mm per character (≈16 per column line) and the floor.
/// </summary>
public class LabelFontFittingTests
{
    private const float Band = 7.75f;
    private const float Column = 32f;

    [Fact]
    public void FitFieldFont_ShortField_KeepsBaseSizeWithoutSpilling()
    {
        Assert.Equal((11f, false), LabelPdfGenerator.FitFieldFont(11, "Acme", Band, Column));
        Assert.Equal((9f, false), LabelPdfGenerator.FitFieldFont(9, "PetG UltraBright", Band, Column));
    }

    [Fact]
    public void FitFieldFont_EmptyField_KeepsBaseSizeWithoutSpilling()
    {
        Assert.Equal((11f, false), LabelPdfGenerator.FitFieldFont(11, "", Band, Column));
        Assert.Equal((11f, false), LabelPdfGenerator.FitFieldFont(11, "   ", Band, Column));
    }

    [Fact]
    public void FitFieldFont_TwoLineFieldShrink_StaysAboveTheFloorWithoutSpilling()
    {
        // 11 pt and 10 pt allow one line in the band, 9.5 pt allows two and the field
        // ("Alpha" + "BetaGamma") wraps to exactly two lines there.
        Assert.Equal((9.5f, false), LabelPdfGenerator.FitFieldFont(11, "Alpha BetaGamma", Band, Column));
    }

    [Fact]
    public void FitFieldFont_WordWiderThanColumnAtTheFloor_SpillsAtTheFloor()
    {
        const string word = "abcdefghijklmnopq"; // 17 chars, > 32 mm at 8 pt
        Assert.Equal((8f, true), LabelPdfGenerator.FitFieldFont(11, word, Band, Column));
        Assert.Equal((8f, true), LabelPdfGenerator.FitFieldFont(9, word, Band, Column));
    }

    [Fact]
    public void MaxLines_TwoLinesAtNinePointFiveOrLess_OneLineAbove()
    {
        Assert.Equal(2, LabelPdfGenerator.MaxLines(8f, Band));
        Assert.Equal(2, LabelPdfGenerator.MaxLines(9f, Band));
        Assert.Equal(2, LabelPdfGenerator.MaxLines(9.5f, Band));
        Assert.Equal(1, LabelPdfGenerator.MaxLines(10f, Band));
        Assert.Equal(1, LabelPdfGenerator.MaxLines(11f, Band));
    }

    [Fact]
    public void WrapLines_NeverSplitsAWord()
    {
        const string text = "alpha beta gamma delta epsilon zeta eta theta";
        var words = text.Split(' ').ToHashSet(StringComparer.Ordinal);
        var lines = LabelPdfGenerator.WrapLines(text, 11f, Column);

        Assert.NotEmpty(lines);
        foreach (var line in lines)
            Assert.All(line.Split(' '), word => Assert.Contains(word, words));
        Assert.Equal(text.Split(' ').OrderBy(w => w, StringComparer.Ordinal),
            lines.SelectMany(l => l.Split(' ')).OrderBy(w => w, StringComparer.Ordinal));
    }

    [Fact]
    public void WrapLines_OversizedWord_WholeInFitMode_TruncatedOnlyInSpillMode()
    {
        var word = new string('z', 60);
        var fit = LabelPdfGenerator.WrapLines(word, 8f, Column)[0];
        Assert.Equal(word, fit); // whole, so the fit check can reject it

        var spill = LabelPdfGenerator.WrapLines(word, 8f, 62f, truncateOversizedWords: true)[0];
        Assert.True(spill.Length < word.Length);
        Assert.True(spill.Length >= 30 && spill.Length <= 32, $"spilled a 60-char word to {spill.Length} chars");
        Assert.Equal(word[..spill.Length], spill);
    }

    [Fact]
    public void WrapLines_EmptyText_YieldsASingleEmptyLine()
    {
        Assert.Equal(new[] { "" }, LabelPdfGenerator.WrapLines("", 11f, Column));
        Assert.Equal(new[] { "" }, LabelPdfGenerator.WrapLines("   ", 11f, Column));
    }

    [Fact]
    public void BudgetLines_KeepsOnlyAsManyLinesAsTheBandHolds()
    {
        Assert.Equal(new[] { "a", "b" },
            LabelPdfGenerator.BudgetLines(new[] { "a", "b", "c" }, 8f, Band));
        Assert.Equal(new[] { "a" },
            LabelPdfGenerator.BudgetLines(new[] { "a", "b", "c" }, 11f, Band));
        Assert.Equal(new[] { "a", "b" },
            LabelPdfGenerator.BudgetLines(new[] { "a", "b" }, 8f, Band));
    }
}
