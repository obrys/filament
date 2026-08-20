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
/// Generates an A4 PDF tiled with spool labels. Each page holds a grid of 7 rows x 3
/// columns of 66x35 mm panels (21 per page) with 1 mm gaps, 5 mm top/bottom margins and
/// 4.95 mm left/right margins (QuestPDF's A4 page is 595 pt wide, which is 0.097 mm
/// shorter than 210 mm, so the side margins cannot be exactly 5 mm at the nominal panel
/// and gap sizes). A label shows a 30 mm QR code on the right and a
/// 32 mm text column on the left holding brand, material/type, color (+ swatch) and
/// spool ID in four bands distributed over the full panel height. Font sizes shrink
/// from their base sizes down to an 8 pt floor; text that still does not fit at 8 pt
/// spills under the QR code's opaque white rendering instead of shrinking further.
/// </summary>
public sealed class LabelPdfGenerator
{
    private const float LabelWidthMm = 66f;
    private const float LabelHeightMm = 35f;
    private const float LabelPaddingMm = 2f;
    private const float InnerWidthMm = LabelWidthMm - 2f * LabelPaddingMm;
    private const float InnerHeightMm = LabelHeightMm - 2f * LabelPaddingMm;
    private const float BandHeightMm = InnerHeightMm / 4f;
    private const float TextColumnMm = 32f;
    private const float QrSizeMm = 30f;
    private const float GapMm = 1f;
    // QuestPDF's A4 page is exactly 595 pt wide (209.903 mm), so a full row of
    // 3 x 66 mm panels + 2 x 1 mm gaps (200 mm) plus two 5 mm margins (210 mm) does
    // not fit. A 4.95 mm side margin leaves 200.003 mm of content width: the row
    // fits with a 0.003 mm tail absorbed by the row's trailing flexible item, keeping
    // the 66 mm panels, 1 mm gaps and the exact 62 mm inner width. 5 mm top/bottom
    // margins come from the vertical padding below.
    private const float PageMarginMm = 4.95f;
    private const float PageVerticalExtraMm = 5f;
    private const float SwatchSizePt = 8f;
    private const float SwatchGapPt = 4f;
    private const float PtToMm = 25.4f / 72f;
    private const float SwatchIndentMm = (SwatchSizePt + SwatchGapPt) * PtToMm;
    private const float FontFloorPt = 8f;
    private const float LineHeightFactor = 1.2f;
    private const float AvgCharEm = 0.7f;
    private const int ColumnsPerPage = 3;

    /// <summary>
    /// An A4 page holds 7 rows of 3 labels at the fixed 66x35 mm size: 21 labels per page.
    /// </summary>
    public const int LabelsPerPage = 21;

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
    /// (A4 holds 7 rows x 3 = 21). Each page holds whole rows: rows are never split
    /// across pages.
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
                    page.Margin(PageMarginMm, Unit.Millimetre);
                    page.DefaultTextStyle(t => t.FontSize(9));

                    page.Content()
                        .PaddingTop(PageVerticalExtraMm, Unit.Millimetre)
                        .PaddingBottom(PageVerticalExtraMm, Unit.Millimetre)
                        .Column(col =>
                        {
                            // Each row is 3 x 66 mm panels with 1 mm gaps between the actual
                            // labels, left-aligned: a full row spans 200 mm, which fits the
                            // 200.003 mm content width (see PageMarginMm) with a tiny tail on
                            // the trailing flexible item. Short rows keep their 1 mm gaps and
                            // leave the rest of the row empty. The column stacks 35 mm rows
                            // with 1 mm gaps between them, top-anchored.
                            var rows = pageLabels.Chunk(ColumnsPerPage).ToList();
                            for (var rowIndex = 0; rowIndex < rows.Count; rowIndex++)
                            {
                                var row = rows[rowIndex];
                                if (rowIndex > 0)
                                    col.Spacing(GapMm, Unit.Millimetre);
                                col.Item().Row(r =>
                                {
                                    for (var i = 0; i < row.Length; i++)
                                    {
                                        if (i > 0)
                                            r.ConstantItem(GapMm, Unit.Millimetre);
                                        r.ConstantItem(LabelWidthMm, Unit.Millimetre).Element(c => RenderLabel(c, row[i]));
                                    }
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
        var hasSwatch = TryParseColor(label.ColorHex, out var swatchColor);
        container
            .Width(LabelWidthMm, Unit.Millimetre)
            .Height(LabelHeightMm, Unit.Millimetre)
            .Border(0.5f)
            .Padding(LabelPaddingMm, Unit.Millimetre)
            .Element(inner => inner.Layers(l =>
            {
                // Primary layer: the four text bands. A spill line may run wider than the
                // 32 mm text column; the QR layer painted below covers that part.
                l.PrimaryLayer().Element(x => x.Column(col =>
                {
                    RenderFieldBand(col, label.Brand, 11f, bold: true, swatch: false, swatchColor: null);
                    RenderFieldBand(col, middleText, 9f, bold: false, swatch: false, swatchColor: null);
                    RenderFieldBand(col, label.Color, 9f, bold: false, swatch: hasSwatch, swatchColor: swatchColor);
                    RenderFieldBand(col, label.SpoolId, 14f, bold: true, swatch: false, swatchColor: null);
                }));

                // Overlay layer: the opaque QR, painted after every text op so spilled
                // glyphs are covered. Right-centred => panel offset (34, 2.5) mm.
                l.Layer().AlignRight().AlignMiddle().Element(q =>
                    q.Width(QrSizeMm, Unit.Millimetre).Height(QrSizeMm, Unit.Millimetre).Image(GenerateQr(label.Url)));
            }));
    }

    private static void RenderFieldBand(ColumnDescriptor col, string text, float baseSizePt, bool bold, bool swatch, string? swatchColor)
    {
        var columnMm = TextColumnMm - (swatch ? SwatchIndentMm : 0f);
        var (sizePt, spill) = FitFieldFont(baseSizePt, text, BandHeightMm, columnMm);
        var wrapMm = spill ? InnerWidthMm - (swatch ? SwatchIndentMm : 0f) : columnMm;
        var lines = BudgetLines(WrapLines(text, sizePt, wrapMm, truncateOversizedWords: spill), sizePt, BandHeightMm);
        var joined = string.Join("\n", lines);

        if (swatch)
            col.Item().Height(BandHeightMm, Unit.Millimetre).Row(r =>
            {
                r.ConstantItem(SwatchSizePt, Unit.Point)
                    .Width(SwatchSizePt)
                    .Height(SwatchSizePt)
                    .Background(swatchColor!)
                    .Border(0.3f);
                r.Spacing(SwatchGapPt, Unit.Point);
                AddText(r.RelativeItem(), joined, sizePt, bold);
            });
        else
            AddText(col.Item().Height(BandHeightMm, Unit.Millimetre), joined, sizePt, bold);
    }

    private static void AddText(IContainer c, string text, float sizePt, bool bold)
    {
        var t = c.Text(text).FontSize(sizePt);
        if (bold)
            t.Bold();
    }

    /// <summary>
    /// Picks the largest font size (stepping from <paramref name="baseSizePt"/> by 0.5 down to
    /// the 8 pt floor) at which every word of <paramref name="text"/> is at most
    /// <paramref name="columnMm"/> wide and the wrapped lines fit the band. When no size at
    /// or above the floor fits, the field spills: it renders at the 8 pt floor and its lines
    /// wrap at the full inner panel width (under the QR code).
    /// </summary>
    public static (float Size, bool Spill) FitFieldFont(float baseSizePt, string text, float bandMm, float columnMm)
    {
        if (string.IsNullOrWhiteSpace(text))
            return (baseSizePt, false);

        for (var size = baseSizePt; size >= FontFloorPt - 0.001f; size -= 0.5f)
        {
            var lines = WrapLines(text, size, columnMm);
            var everyLineFits = lines.All(l => l.Length * AvgCharEm * size * PtToMm <= columnMm + 0.001f);
            if (everyLineFits && lines.Count <= MaxLines(size, bandMm))
                return (size, false);
        }
        return (FontFloorPt, true);
    }

    /// <summary>
    /// The maximum number of lines at <paramref name="sizePt"/> that stay within
    /// <paramref name="bandMm"/>: a band holds at most two lines at 9.5 pt and below (a
    /// third line of 8 pt exceeds a 7.75 mm band and would push page content across a
    /// page break), otherwise one.
    /// </summary>
    public static int MaxLines(float sizePt, float bandMm)
    {
        var bandPt = bandMm / PtToMm;
        var linePt = sizePt * LineHeightFactor;
        var n = (int)Math.Floor((bandPt + 0.2f * sizePt) / linePt);
        return Math.Max(1, n);
    }

    /// <summary>
    /// Greedy word wrap of <paramref name="text"/> at <paramref name="sizePt"/> into lines of at
    /// most <paramref name="widthMm"/> (character width estimated at AvgCharEm x size). Words are
    /// never split: a word wider than <paramref name="widthMm"/> gets its own line; with
    /// <paramref name="truncateOversizedWords"/> the word is additionally cut at
    /// <paramref name="widthMm"/> (spill mode only — the panel's inner right edge is the last
    /// place a glyph may land), otherwise it stays whole so the fit check can reject it. Empty
    /// text yields a single empty line so its band keeps its fixed height.
    /// </summary>
    public static List<string> WrapLines(string text, float sizePt, float widthMm, bool truncateOversizedWords = false)
    {
        var mmPerChar = AvgCharEm * sizePt * PtToMm;
        var lines = new List<string>();
        var current = "";
        foreach (var word in text.Split(' ', StringSplitOptions.RemoveEmptyEntries))
        {
            var wordMm = word.Length * mmPerChar;
            if (wordMm > widthMm)
            {
                if (current.Length > 0)
                {
                    lines.Add(current);
                    current = "";
                }
                var shown = truncateOversizedWords
                    ? word.AsSpan(0, Math.Min(word.Length, (int)Math.Floor(widthMm / mmPerChar))).ToString()
                    : word;
                lines.Add(shown);
                continue;
            }
            var lineMm = current.Length == 0
                ? wordMm
                : wordMm + mmPerChar + current.Length * mmPerChar;
            if (current.Length == 0 || lineMm <= widthMm)
                current = current.Length == 0 ? word : current + " " + word;
            else
            {
                lines.Add(current);
                current = word;
            }
        }
        if (current.Length > 0)
            lines.Add(current);
        if (lines.Count == 0)
            lines.Add("");
        return lines;
    }

    /// <summary>
    /// Keeps at most <see cref="MaxLines"/> lines (the first ones, in order) so a band never
    /// renders more lines than it can hold.
    /// </summary>
    public static List<string> BudgetLines(IReadOnlyList<string> lines, float sizePt, float bandMm)
    {
        var max = MaxLines(sizePt, bandMm);
        return lines.Count <= max ? lines.ToList() : lines.Take(max).ToList();
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
