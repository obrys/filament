using Filament.Api.Pdf;
using Filament.Core.Abstractions;
using Microsoft.AspNetCore.Mvc;

namespace Filament.Api.Controllers;

[ApiController]
[Route("api/labels")]
public sealed class LabelsController : ControllerBase
{
    private readonly ISpoolRepository _spools;
    private readonly IFilamentTypeRepository _types;
    private readonly LabelPdfGenerator _pdf;

    public LabelsController(ISpoolRepository spools, IFilamentTypeRepository types, LabelPdfGenerator pdf)
    {
        _spools = spools;
        _types = types;
        _pdf = pdf;
    }

    /// <summary>
    /// Returns a PDF of etiquette labels for one or more spools.
    /// Query: <c>?id=ABCD&amp;id=EFGH&amp;copies=3</c>
    /// <para>
    /// <paramref name="copies"/> is an optional whole number between 1 and 10
    /// (default 1 when missing or empty): each resolved spool id produces that
    /// many contiguous labels, so the PDF holds ids.Length x copies labels
    /// across one or more A4 pages.
    /// </para>
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> Generate([FromQuery(Name = "id")] string[] ids, [FromQuery] string? copies, CancellationToken ct)
    {
        if (ids is null || ids.Length == 0)
            return BadRequest(new { error = "At least one spool id required." });

        int copyCount = 1;
        if (!string.IsNullOrWhiteSpace(copies) && !TryParseCopies(copies, out copyCount))
            return BadRequest(new { error = "copies must be a whole number between 1 and 10." });

        var publicBase = $"{Request.Scheme}://{Request.Host}";
        var labels = new List<LabelData>();
        foreach (var id in ids)
        {
            var spool = await _spools.GetAsync(id, ct);
            if (spool is null) continue;
            var type = await _types.GetAsync(spool.FilamentTypeId, ct);
            if (type is null) continue;
            labels.Add(new LabelData(
                SpoolId: spool.Id,
                Brand: type.Brand,
                Material: type.Material,
                Type: type.Type,
                Color: type.Color,
                ColorHex: type.ColorHex,
                Url: $"{publicBase}/spools/{spool.Id}"));
        }
        if (labels.Count == 0) return NotFound();
        var bytes = _pdf.Generate(LabelPdfGenerator.ExpandCopies(labels, copyCount));
        return File(bytes, "application/pdf", "spool-labels.pdf");
    }

    /// <summary>
    /// Parses the <c>copies</c> query value: a whole number in 1..10 (surrounding
    /// whitespace tolerated). Returns false for out-of-range or non-whole values.
    /// </summary>
    public static bool TryParseCopies(string raw, out int copies)
    {
        return int.TryParse(raw.Trim(), System.Globalization.NumberStyles.Integer, null, out copies)
            && copies >= 1 && copies <= 10;
    }
}
