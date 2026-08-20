using System.Globalization;
using System.IO.Compression;
using System.Text;
using System.Text.RegularExpressions;

namespace Filament.Api.Tests;

/// <summary>
/// Minimal reader for the PDFs produced by <see cref="Filament.Api.Pdf.LabelPdfGenerator"/>:
/// inflates the Flate streams with <see cref="ZLibStream"/> (no external package) and walks
/// the page content's CTM stack (q/cm/Q) to recover panel rectangles, text runs and image
/// boxes in page millimetres from the top-left corner. The stream format (page CTM
/// ".25 0 0 -.25 0 842 cm", one q/Q region per drawn element headed either by
/// "4 0 0 4 tx ty cm" for vector content or by a single image cm before "Do") was verified
/// against QuestPDF 2024.12.0 output.
/// </summary>
public static class PdfProbe
{
    public sealed record Rect(float X, float Y, float W, float H);
    public sealed record TextRun(float X, float Y, float Width, float SizePt, int Glyphs)
    {
        /// <summary>Right edge in page mm; the Td sum underestimates by the last glyph's advance.</summary>
        public float Right => X + Width;
    }
    public sealed record Page(int Index, List<Rect> Rects, List<TextRun> TextRuns, List<Rect> Images)
    {
        /// <summary>Raw page content stream (for draw-order assertions on Tj/Do offsets).</summary>
        public required string Raw { get; init; }

        public int DoCount => Regex.Count(Raw, @"^[ \t]*/\S+ Do$", RegexOptions.Multiline);
        public int LastTjIndex => Raw.LastIndexOf(" Tj", StringComparison.Ordinal);
        public int LastDoIndex => Raw.LastIndexOf(" Do", StringComparison.Ordinal);
    }

    private static readonly CultureInfo N = CultureInfo.InvariantCulture;

    public static List<Page> Pages(byte[] pdf)
    {
        var text = Encoding.Latin1.GetString(pdf);
        return Streams(text)
            .Where(stream => stream.StartsWith(".25 0 0 -", StringComparison.Ordinal))
            .Select((stream, i) => ParsePage(i + 1, stream)).ToList();
    }

    private static List<string> Streams(string text)
    {
        var result = new List<string>();
        var i = 0;
        while (true)
        {
            var s = text.IndexOf("stream", i, StringComparison.Ordinal);
            if (s < 0) break;
            var e = text.IndexOf("endstream", s, StringComparison.Ordinal);
            if (e < 0) break;
            var d = s + 6;
            if (d < text.Length && text[d] == '\r') d++;
            if (d < text.Length && text[d] == '\n') d++;
            try
            {
                using var raw = new MemoryStream(Encoding.Latin1.GetBytes(text.AsSpan(d, e - d).ToString()));
                using var zlib = new ZLibStream(raw, CompressionMode.Decompress);
                using var inflated = new MemoryStream();
                zlib.CopyTo(inflated);
                result.Add(Encoding.Latin1.GetString(inflated.ToArray()));
            }
            catch
            {
                // non-Flate stream (raw image data, font binaries) — skip
            }
            i = e + 9;
        }
        return result;
    }

    private static Page ParsePage(int index, string content)
    {
        const float MmPerPt = 25.4f / 72f;
        const float PageH = 842f;
        var page = new Page(index, new List<Rect>(), new List<TextRun>(), new List<Rect>()) { Raw = content };

        // CTM stack; the stream opens with the page CTM ".25 0 0 -.25 0 842 cm".
        var stack = new List<float[]> { ArrayIds() };

        float[] Compose(float[] a, float[] b) => new[]
        {
            a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
            a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
            a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
        };
        (float X, float Y) Apply(float[] m, float x, float y) =>
            (m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]);
        (float X, float Y) ToMm((float x, float y) p) => (p.x * MmPerPt, (PageH - p.y) * MmPerPt);
        Rect Box(params (float x, float y)[] corners)
        {
            var mm = corners.Select(ToMm).ToList();
            return new Rect(mm.Min(c => c.X), mm.Min(c => c.Y),
                            mm.Max(c => c.X) - mm.Min(c => c.X), mm.Max(c => c.Y) - mm.Min(c => c.Y));
        }

        // per-text-line state
        float[]? textM = null;
        float beforeFirst = 0f;
        float tdxSum = 0f;
        bool seenFirst = false;
        int glyphs = 0;
        float fontPt = 0f;
        (float, float, float, float)? rectCand = null;

        void FlushTextLine()
        {
            if (textM is not null)
            {
                var m = Compose(stack[^1], textM);
                var origin = ToMm(Apply(m, beforeFirst, 0));
                var end = ToMm(Apply(m, beforeFirst + tdxSum, 0));
                page.TextRuns.Add(new TextRun(origin.X, origin.Y, Math.Abs(end.X - origin.X), fontPt, glyphs));
            }
            textM = null;
            beforeFirst = 0f;
            tdxSum = 0f;
            seenFirst = false;
            glyphs = 0;
        }

        foreach (var rawLine in content.Split('\n'))
        {
            var line = rawLine.Trim();
            if (line.Length == 0) continue;

            if (line == "q")
            {
                stack.Add(stack[^1].ToArray());
                continue;
            }
            if (line == "Q")
            {
                FlushTextLine();
                stack.RemoveAt(stack.Count - 1);
                continue;
            }

            if (TryParseCm(line, out var cm))
            {
                stack[^1] = Compose(stack[^1], cm!);
                continue;
            }

            if (stack.Count == 1)
            {
                continue; // nothing else happens at page level in these PDFs
            }

            if (line == "BT") continue;
            if (line == "ET") { FlushTextLine(); continue; }

            var tmi = Regex.Match(line, @"^1 0 0 -1 (-?\d*\.?\d+) (-?\d*\.?\d+) Tm$");
            if (tmi.Success)
            {
                FlushTextLine();
                textM = new[]
                {
                    1f, 0f, 0f, -1f,
                    float.Parse(tmi.Groups[1].Value, N),
                    float.Parse(tmi.Groups[2].Value, N),
                };
                continue;
            }

            var tdTj = Regex.Match(line, @"^(-?\d*\.?\d+) -?\d*\.?\d+ Td <[0-9A-F]*> Tj$");
            var tdi = Regex.Match(line, @"^(-?\d*\.?\d+) -?\d*\.?\d+ Td$");
            if (tdTj.Success || tdi.Success)
            {
                var dx = Math.Abs(float.Parse((tdTj.Success ? tdTj : tdi).Groups[1].Value, N));
                if (seenFirst) tdxSum += dx; else beforeFirst += dx;
                if (tdTj.Success) { glyphs++; seenFirst = true; }
                continue;
            }

            if (line.EndsWith("Tj", StringComparison.Ordinal))
            {
                glyphs++;
                seenFirst = true;
                continue;
            }

            var tf = Regex.Match(line, @"^/\w+ (\d*\.?\d+) Tf$");
            if (tf.Success)
            {
                fontPt = float.Parse(tf.Groups[1].Value, N);
                continue;
            }

            var re = Regex.Match(line, @"^(-?\d*\.?\d+) (-?\d*\.?\d+) (-?\d*\.?\d+) (-?\d*\.?\d+) re$");
            if (re.Success)
            {
                rectCand = (
                    float.Parse(re.Groups[1].Value, N), float.Parse(re.Groups[2].Value, N),
                    float.Parse(re.Groups[3].Value, N), float.Parse(re.Groups[4].Value, N));
                continue;
            }

            if (line == "f" || line == "f*")
            {
                if (rectCand is { } r)
                {
                    var m = stack[^1];
                    page.Rects.Add(Box(
                        Apply(m, r.Item1, r.Item2), Apply(m, r.Item1 + r.Item3, r.Item2),
                        Apply(m, r.Item1 + r.Item3, r.Item2 + r.Item4), Apply(m, r.Item1, r.Item2 + r.Item4)));
                    rectCand = null;
                }
                continue;
            }

            if (Regex.IsMatch(line, @"^/\S+ Do$"))
            {
                var m = stack[^1];
                page.Images.Add(Box(Apply(m, 0, 0), Apply(m, 1, 0), Apply(m, 1, 1), Apply(m, 0, 1)));
                continue;
            }
        }
        FlushTextLine();
        return page;
    }

    private static readonly float[] Id = { 1f, 0f, 0f, 1f, 0f, 0f };

    private static float[] ArrayIds() => Id.ToArray();

    private static bool TryParseCm(string line, out float[]? m)
    {
        m = null;
        var match = Regex.Match(line, @"^(-?\d*\.?\d+) (-?\d*\.?\d+) (-?\d*\.?\d+) (-?\d*\.?\d+) (-?\d*\.?\d+) (-?\d*\.?\d+) cm$");
        if (!match.Success) return false;
        m = new[]
        {
            float.Parse(match.Groups[1].Value, N), float.Parse(match.Groups[2].Value, N),
            float.Parse(match.Groups[3].Value, N), float.Parse(match.Groups[4].Value, N),
            float.Parse(match.Groups[5].Value, N), float.Parse(match.Groups[6].Value, N),
        };
        return true;
    }
}
