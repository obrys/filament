using Filament.Api.Dtos;
using Filament.Api.Mapping;
using Filament.Core.Abstractions;
using Filament.Core.Domain;
using Filament.Core.Faceting;
using Filament.Core.Identifiers;
using Filament.Core.Services;
using Microsoft.AspNetCore.Mvc;

namespace Filament.Api.Controllers;

[ApiController]
[Route("api/spools")]
public sealed class SpoolsController : ControllerBase
{
    private readonly ISpoolRepository _spools;
    private readonly IFilamentTypeRepository _types;
    private readonly IChangeNotifier _notifier;

    public SpoolsController(ISpoolRepository spools, IFilamentTypeRepository types, IChangeNotifier notifier)
    {
        _spools = spools;
        _types = types;
        _notifier = notifier;
    }

    [HttpGet]
    public async Task<SpoolListDto> List(
        [FromQuery] string? filamentTypeId,
        [FromQuery] bool includeFinished,
        [FromQuery] string[]? brand,
        [FromQuery] string[]? material,
        [FromQuery] string[]? type,
        [FromQuery] string[]? color,
        CancellationToken ct)
    {
        var items = await _spools.ListAsync(filamentTypeId, includeFinished, ct);
        // Batch load types referenced by the spool list.
        var typeIds = items.Select(s => s.FilamentTypeId).Distinct().ToList();
        var types = new Dictionary<string, FilamentType>();
        foreach (var tid in typeIds)
        {
            var t = await _types.GetAsync(tid, ct);
            if (t is not null) types[tid] = t;
        }

        // The facet universe is every spool whose filament type resolves; a spool inherits the
        // facet attributes of its type. Faceting happens on the server — the client only renders.
        var universe = items.Where(s => types.ContainsKey(s.FilamentTypeId)).ToList();
        var selection = FacetSelection.From(brand, material, type, color);
        var result = FacetEngine.Apply(
            universe,
            s => Attrs(types[s.FilamentTypeId]),
            selection);

        return new SpoolListDto(
            result.Items.Select(s => s.ToDto(types[s.FilamentTypeId])).ToList(),
            result.Facets.ToDto());
    }

    private static FacetAttributes Attrs(FilamentType t) =>
        new(t.Brand, t.Material, t.Type, t.Color);

    [HttpGet("{id}")]
    public async Task<ActionResult<SpoolDto>> Get(string id, CancellationToken ct)
    {
        var s = await _spools.GetAsync(id, ct);
        if (s is null) return NotFound();
        var t = await _types.GetAsync(s.FilamentTypeId, ct);
        if (t is null) return NotFound();
        return s.ToDto(t);
    }

    [HttpGet("{id}/events")]
    public async Task<ActionResult<IReadOnlyList<SpoolEventDto>>> Events(string id, CancellationToken ct)
    {
        var spool = await _spools.GetAsync(id, ct);
        if (spool is null) return NotFound();
        var events = await _spools.ListEventsAsync(id, ct);
        var remainingAfter = SpoolWeightService.ComputeRemainingAfter(spool.InitialNetGrams, events);
        return Ok(events.Select(e => e.ToDto(remainingAfter[e.Id])).ToList());
    }

    [HttpPost]
    public async Task<ActionResult<SpoolDto>> Create([FromBody] CreateSpoolDto dto, CancellationToken ct)
    {
        var type = await _types.GetAsync(dto.FilamentTypeId, ct);
        if (type is null) return BadRequest(new { error = "Unknown filament type." });

        string id;
        do { id = IdentifierGenerator.NewSpoolId(); }
        while (await _spools.GetAsync(id, ct) is not null);

        var initial = dto.InitialNetGrams ?? type.DefaultNetWeightGrams;
        var spool = new Spool
        {
            Id = id,
            FilamentTypeId = type.Id,
            RemainingGrams = initial,
            InitialNetGrams = initial,
            EmptySpoolWeightGramsOverride = dto.EmptySpoolWeightGramsOverride,
            Notes = dto.Notes,
        };
        var created = new SpoolEvent
        {
            SpoolId = id,
            Kind = SpoolEventKind.Created,
            DeltaGrams = 0,
        };
        await _spools.AddAsync(spool, created, ct);
        await _notifier.NotifyAsync("spool", id, ct);
        return CreatedAtAction(nameof(Get), new { id }, spool.ToDto(type));
    }

    [HttpPost("{id}/consume")]
    public async Task<ActionResult<SpoolDto>> Consume(string id, [FromBody] ConsumeSpoolDto dto, CancellationToken ct)
    {
        var spool = await _spools.GetAsync(id, ct);
        if (spool is null) return NotFound();
        var type = await _types.GetAsync(spool.FilamentTypeId, ct);
        if (type is null) return NotFound();
        try
        {
            var result = SpoolWeightService.Consume(spool, dto.Grams, dto.ProjectName, dto.ProjectUrl, dto.Notes);
            await _spools.UpdateAsync(result.Spool, result.Event, ct);
            await _notifier.NotifyAsync("spool", id, ct);
            return result.Spool.ToDto(type);
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentOutOfRangeException)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpPost("{id}/adjust")]
    public async Task<ActionResult<SpoolDto>> Adjust(string id, [FromBody] AdjustSpoolDto dto, CancellationToken ct)
    {
        var spool = await _spools.GetAsync(id, ct);
        if (spool is null) return NotFound();
        var type = await _types.GetAsync(spool.FilamentTypeId, ct);
        if (type is null) return NotFound();
        try
        {
            var result = SpoolWeightService.Adjust(spool, dto.NewRemainingGrams, dto.Notes);
            await _spools.UpdateAsync(result.Spool, result.Event, ct);
            await _notifier.NotifyAsync("spool", id, ct);
            return result.Spool.ToDto(type);
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentOutOfRangeException)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(string id, CancellationToken ct)
    {
        var removed = await _spools.DeleteAsync(id, ct);
        if (!removed) return NotFound();
        await _notifier.NotifyAsync("spool", id, ct);
        return NoContent();
    }
}
