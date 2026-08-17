using QRCoder;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace Filament.Api.Pdf;

public sealed record LabelData(
    string SpoolId,
    string Brand,
    string Material,
    string Type,
    string Color,
    string? ColorHex,
    string Url);

/// <summary>
/// Generates an A4 PDF tiled with small etiquettes for spools. Each etiquette shows
/// brand / material / type / color, identifier, color swatch, and a QR code linking
/// to the spool's web page.
/// </summary>
public sealed class LabelPdfGenerator
{
    private const float LabelWidthMm = 70f;
    private const float LabelHeightMm = 35f;
    private const float TextColumnWidthPt = 108f;
    private const float SwatchRowExtraPt = 12f;
    private const float AvgCharEm = 0.7f;

    /// <summary>
    /// An A4 page holds 7 rows of 2 labels at the fixed 70x35 mm size with 10 mm margins.
    /// </summary>
    public const int LabelsPerPage = 14;

    /// <summary>
    /// Expands each label into <paramref name="copies"/> contiguous duplicates, keeping the input
    /// order: for [A, B] with 2 copies the result is A, A, B, B.
    /// </summary>
    public static List<LabelData> ExpandCopies(IReadOnlyList<LabelData> labels, int copies)
    {
        var expanded = new List<LabelData>(labels.Count * copies);
        foreach (var label in labels)
            for (var i = 0; i < copies; i++)
                expanded.Add(label);
        return expanded;
    }

    /// <summary>
    /// Splits the labels into pages of at most <paramref name="labelsPerPage"/> labels
    /// (A4 holds at most 7 rows x 2 = 14). Each page holds whole rows: rows are never
    /// split across pages.
    /// </summary>
    public static IEnumerable<IEnumerable<LabelData>> Paginate(IReadOnlyList<LabelData> labels, int labelsPerPage = LabelsPerPage) =>
        labels.Chunk(labelsPerPage);

    public byte[] Generate(IReadOnlyList<LabelData> labels)
    {
        var doc = Document.Create(container =>
        {
            foreach (var pageLabels in Paginate(labels))
            {
                container.Page(page =>
                {
                    page.Size(PageSizes.A4);
                    page.Margin(10, Unit.Millimetre);
                    page.DefaultTextStyle(t => t.FontSize(9));

                    page.Content().Column(col =>
                    {
                        foreach (var row in pageLabels.Chunk(2))
                        {
                            col.Item().Row(r =>
                            {
                                foreach (var label in row)
                                {
                                    r.RelativeItem().Padding(2).Element(c => RenderLabel(c, label));
                                }
                                if (row.Length == 1)
                                    r.RelativeItem();
                            });
                        }
                    });
                });
            }
        });
        return doc.GeneratePdf();
    }

    private static void RenderLabel(IContainer container, LabelData label)
    {
        var middleText = $"{label.Material} · {label.Type}";
        var hasSwatch = TryParseColor(label.ColorHex, out _);
        var colorWidthPt = hasSwatch ? TextColumnWidthPt - SwatchRowExtraPt : TextColumnWidthPt;
        container
            .Width(LabelWidthMm, Unit.Millimetre)
            .Height(LabelHeightMm, Unit.Millimetre)
            .Border(0.5f)
            .Padding(4)
            .Row(row =>
            {
                // Left: text + color swatch
                row.RelativeItem().Column(col =>
                {
                    col.Item().Text(label.Brand).Bold().FontSize(FitFontSize(11, 2, label.Brand));
                    col.Item().Text(middleText).FontSize(FitFontSize(9, 2, middleText));
                    col.Item().Row(r =>
                    {
                        if (TryParseColor(label.ColorHex, out var rgb))
                        {
                            r.AutoItem()
                                .Width(8).Height(8)
                                .Background(rgb)
                                .Border(0.3f);
                            r.ConstantItem(4);
                        }
                        r.RelativeItem().Text(label.Color).FontSize(FitFontSize(9, 2, label.Color, colorWidthPt));
                    });
                    col.Item().PaddingTop(2).Text(label.SpoolId).Bold().FontSize(FitFontSize(14, 1, label.SpoolId));
                });

                // Right: QR code
                row.ConstantItem(80).AlignRight().AlignMiddle().Element(c =>
                {
                    var qr = GenerateQr(label.Url);
                    c.Width(28, Unit.Millimetre).Height(28, Unit.Millimetre).Image(qr);
                });
            });
    }

    /// <summary>
    /// Shrinks a field's font so its text fits within <paramref name="maxLines"/> lines of
    /// <paramref name="widthPt"/> points, using a conservative per-character em width.
    /// Returns the base size unchanged when the text already fits at base size.
    /// </summary>
    private static float FitFontSize(float baseSize, int maxLines, string text, float widthPt = TextColumnWidthPt)
    {
        if (text.Length == 0) return baseSize;
        var maxByLines = (widthPt * maxLines) / (AvgCharEm * text.Length);
        return Math.Max(Math.Min(baseSize, maxByLines), 2f);
    }

    private static byte[] GenerateQr(string text)
    {
        using var gen = new QRCodeGenerator();
        using var data = gen.CreateQrCode(text, QRCodeGenerator.ECCLevel.M);
        var png = new PngByteQRCode(data);
        return png.GetGraphic(10);
    }

    private static bool TryParseColor(string? hex, out string normalized)
    {
        normalized = "";
        if (string.IsNullOrWhiteSpace(hex)) return false;
        var h = hex.Trim().TrimStart('#');
        if (h.Length is not (6 or 8)) return false;
        foreach (var c in h)
            if (!Uri.IsHexDigit(c)) return false;
        normalized = "#" + h.ToUpperInvariant();
        return true;
    }
}
