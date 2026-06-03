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
    /// Query: <c>?id=ABCD&amp;id=EFGH</c>
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> Generate([FromQuery(Name = "id")] string[] ids, CancellationToken ct)
    {
        if (ids is null || ids.Length == 0)
            return BadRequest(new { error = "At least one spool id required." });

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
        var bytes = _pdf.Generate(labels);
        return File(bytes, "application/pdf", "spool-labels.pdf");
    }
}
