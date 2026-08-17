using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using Filament.Api.Pdf;

namespace Filament.Api.Tests;

public class LabelPdfGeneratorTests
{
    private static List<LabelData> MakeLabels(int count) =>
        Enumerable.Range(1, count).Select(i => new LabelData(
            SpoolId: i.ToString("D4", CultureInfo.InvariantCulture),
            Brand: "BrandX",
            Material: "PLA",
            Type: "Basic",
            Color: "Red",
            ColorHex: "#FF0000",
            Url: $"http://lan.example/spools/{i.ToString("D4", CultureInfo.InvariantCulture)}")).ToList();

    private static string PdfText(byte[] bytes) => Encoding.Latin1.GetString(bytes);

    [Theory]
    [InlineData(1, 1)]
    [InlineData(14, 1)]
    [InlineData(15, 2)]
    [InlineData(16, 2)]
    [InlineData(20, 2)]
    [InlineData(28, 2)]
    public void Generate_ProducesOnePagePerFourteenLabels(int labelCount, int expectedPages)
    {
        var text = PdfText(new LabelPdfGenerator().Generate(MakeLabels(labelCount)));

        // The (uncompressed) page tree is the only /Count in the document.
        var first = Regex.Match(text, @"/Count\s+(\d+)");
        Assert.True(first.Success, "page tree /Count is missing");
        Assert.Equal(expectedPages, int.Parse(first.Groups[1].Value, CultureInfo.InvariantCulture));

        // One /Type /Page object per rendered page (the tree's /Type /Pages is excluded by (?!s)).
        var pageObjects = Regex.Count(text, @"/Type /Page(?!s)");
        Assert.Equal(expectedPages, pageObjects);
    }

    [Fact]
    public void Generate_LongsThatOverflowTheLabelBox_StillTileOnePagePerFourteenLabels()
    {
        const string longText = "e2e-some-really-long-identifier-0123456789";
        var labels = Enumerable.Range(1, 3).Select(i => new LabelData(
            SpoolId: $"SP{i:D2}",
            Brand: longText,
            Material: longText,
            Type: longText,
            Color: longText,
            ColorHex: "#FF0000",
            Url: $"http://lan.example/spools/{i:D2}")).ToList();

        var text = PdfText(new LabelPdfGenerator().Generate(labels));

        var first = Regex.Match(text, @"/Count\s+(\d+)");
        Assert.True(first.Success, "page tree /Count is missing");
        Assert.Equal(1, int.Parse(first.Groups[1].Value, CultureInfo.InvariantCulture));
        Assert.Equal(1, Regex.Count(text, @"/Type /Page(?!s)"));
    }
}
