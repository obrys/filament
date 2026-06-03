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

    public byte[] Generate(IReadOnlyList<LabelData> labels)
    {
        var doc = Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(10, Unit.Millimetre);
                page.DefaultTextStyle(t => t.FontSize(9));

                page.Content().Column(col =>
                {
                    foreach (var row in labels.Chunk(2))
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
        });
        return doc.GeneratePdf();
    }

    private static void RenderLabel(IContainer container, LabelData label)
    {
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
                    col.Item().Text(label.Brand).Bold().FontSize(11);
                    col.Item().Text($"{label.Material} · {label.Type}").FontSize(9);
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
                        r.RelativeItem().Text(label.Color).FontSize(9);
                    });
                    col.Item().PaddingTop(2).Text(label.SpoolId).Bold().FontSize(14);
                });

                // Right: QR code
                row.ConstantItem(80).AlignRight().AlignMiddle().Element(c =>
                {
                    var qr = GenerateQr(label.Url);
                    c.Width(28, Unit.Millimetre).Height(28, Unit.Millimetre).Image(qr);
                });
            });
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
