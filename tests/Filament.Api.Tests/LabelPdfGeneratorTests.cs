using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using Filament.Api.Pdf;

namespace Filament.Api.Tests;

public class LabelPdfGeneratorTests
{
    private static string LongText(int i) => $"{i:D2}-{new string('a', 200)}";

    private static List<LabelData> MakeLabels(int count, bool longFields = false) =>
        Enumerable.Range(1, count).Select(i => new LabelData(
            SpoolId: i.ToString("D4", CultureInfo.InvariantCulture),
            Brand: longFields ? LongText(i) : "BrandX",
            Material: longFields ? LongText(i) : "PLA",
            Type: longFields ? LongText(i) : "Basic",
            Color: longFields ? LongText(i) : "Red",
            ColorHex: "#FF0000",
            Url: $"http://lan.example/spools/{i.ToString("D4", CultureInfo.InvariantCulture)}")).ToList();

    private static string PdfText(byte[] bytes) => Encoding.Latin1.GetString(bytes);

    private static PdfProbe.Page SingleLabelPage(List<LabelData>? labels = null) =>
        PdfProbe.Pages(new LabelPdfGenerator().Generate(labels ?? MakeLabels(1)))[0];

    private static (float Left, float Top, float Right, float Bottom) PanelBounds(PdfProbe.Page page)
    {
        // The six panel border edges: two long horizontal and two long thin-thick strips.
        var horizontal = page.Rects.Where(r => r.W >= 65.5 && r.H <= 0.5).ToList();
        var vertical = page.Rects.Where(r => r.W <= 0.5 && r.H >= 34.5).ToList();
        Assert.True(horizontal.Count >= 2, "expected the two horizontal panel border edges");
        Assert.True(vertical.Count >= 2, "expected the two vertical panel border edges");
        var left = vertical.Min(r => r.X);
        var top = horizontal.Min(r => r.Y);
        var right = horizontal.Max(r => r.X + r.W);
        var bottom = vertical.Max(r => r.Y + r.H);
        return (left, top, right, bottom);
    }

    [Theory]
    [InlineData(1, 1)]
    [InlineData(20, 1)]
    [InlineData(21, 1)]
    [InlineData(22, 2)]
    [InlineData(28, 2)]
    [InlineData(42, 2)]
    [InlineData(43, 3)]
    [InlineData(100, 5)]
    public void Generate_ProducesOnePagePerTwentyOneLabels(int labelCount, int expectedPages)
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
    public void Generate_FullPageDrawsOneQrImagePerLabel()
    {
        var pages = PdfProbe.Pages(new LabelPdfGenerator().Generate(MakeLabels(43)));

        Assert.Equal(new[] { 21, 21, 1 }, pages.Select(p => p.DoCount).ToArray());
    }

    [Fact]
    public void Generate_PanelFramesMeasureSixtySixByThirtyFiveMm()
    {
        var page = SingleLabelPage();

        var horizontal = page.Rects.Where(r => r.W >= 65.5 && r.H <= 0.5).ToList();
        var vertical = page.Rects.Where(r => r.W <= 0.5 && r.H >= 34.5).ToList();
        Assert.All(horizontal, r => Assert.InRange(r.W, 65.5f, 66.5f));
        Assert.All(vertical, r => Assert.InRange(r.H, 34.5f, 35.5f));

        var (left, top, right, bottom) = PanelBounds(page);
        Assert.InRange(right - left, 65.5f, 66.5f);
        Assert.InRange(bottom - top, 34.5f, 35.5f);
    }

    [Fact]
    public void Generate_QrImagesMeasureThirtyByThirtyMmAtTheSpecifiedOffset()
    {
        var page = SingleLabelPage();
        var (left, top, _, _) = PanelBounds(page);

        Assert.Single(page.Images);
        var qr = page.Images[0];
        Assert.InRange(qr.W, 29.5f, 30.5f);
        Assert.InRange(qr.H, 29.5f, 30.5f);
        Assert.InRange(qr.X - left, 33.5f, 34.5f);
        Assert.InRange(qr.Y - top, 2.0f, 3.0f);
    }

    [Fact]
    public void Generate_NoFontSmallerThanEightPt()
    {
        var page = SingleLabelPage(MakeLabels(1, longFields: true));

        Assert.NotNull(page.TextRuns);
        Assert.NotEmpty(page.TextRuns);
        Assert.All(page.TextRuns, run => Assert.InRange(run.SizePt, 7.95f, 20f));
    }

    [Fact]
    public void Generate_Spill_KeepsGlyphsInsideThePanel()
    {
        var page = SingleLabelPage(MakeLabels(1, longFields: true));
        var (left, top, right, bottom) = PanelBounds(page);

        // Inner frame = panel border offset by the 2 mm padding.
        var innerRight = left + 66 - 2;
        var innerBottom = top + 35 - 2;

        Assert.All(page.TextRuns, run =>
        {
            Assert.InRange(run.Right, left + 2 - 2f, innerRight + 0.5f);
            Assert.InRange(run.Y, top + 2 - 2f, innerBottom + 0.5f);
        });
    }

    [Fact]
    public void Generate_QrPaintedAfterTextLabel()
    {
        var page = SingleLabelPage(MakeLabels(1, longFields: true));

        Assert.True(page.LastTjIndex >= 0, "page has no text");
        Assert.True(page.LastDoIndex > page.LastTjIndex,
            $"QR image (offset {page.LastDoIndex}) must be painted after the last text run (offset {page.LastTjIndex})");
    }

    [Fact]
    public void Generate_LongsThatOverflowTheLabelBox_StillTileOnePagePerTwentyOneLabels()
    {
        var labels = MakeLabels(3, longFields: true);
        var text = PdfText(new LabelPdfGenerator().Generate(labels));

        var first = Regex.Match(text, @"/Count\s+(\d+)");
        Assert.True(first.Success, "page tree /Count is missing");
        Assert.Equal(1, int.Parse(first.Groups[1].Value, CultureInfo.InvariantCulture));
        Assert.Equal(1, Regex.Count(text, @"/Type /Page(?!s)"));
    }
}
