using Filament.Api.Dtos;
using Filament.Api.Mapping;
using Filament.Core.Abstractions;
using Filament.Core.Domain;
using Filament.Core.Identifiers;
using Microsoft.AspNetCore.Mvc;

namespace Filament.Api.Controllers;

[ApiController]
[Route("api/filament-types")]
public sealed class FilamentTypesController : ControllerBase
{
    private readonly IFilamentTypeRepository _repo;
    private readonly IChangeNotifier _notifier;

    public FilamentTypesController(IFilamentTypeRepository repo, IChangeNotifier notifier)
    {
        _repo = repo;
        _notifier = notifier;
    }

    [HttpGet]
    public async Task<IReadOnlyList<FilamentTypeDto>> List(CancellationToken ct)
    {
        var items = await _repo.ListAsync(ct);
        return items.Select(t => t.ToDto()).ToList();
    }

    [HttpGet("{id}")]
    public async Task<ActionResult<FilamentTypeDto>> Get(string id, CancellationToken ct)
    {
        var t = await _repo.GetAsync(id, ct);
        return t is null ? NotFound() : t.ToDto();
    }

    [HttpPost]
    public async Task<ActionResult<FilamentTypeDto>> Create([FromBody] CreateFilamentTypeDto dto, CancellationToken ct)
    {
        string id;
        do { id = IdentifierGenerator.NewTypeId(); }
        while (await _repo.GetAsync(id, ct) is not null);

        var type = new FilamentType
        {
            Id = id,
            Brand = dto.Brand,
            Material = dto.Material,
            Type = dto.Type,
            Color = dto.Color,
            ColorHex = dto.ColorHex,
            DefaultNetWeightGrams = dto.DefaultNetWeightGrams,
            EmptySpoolWeightGrams = dto.EmptySpoolWeightGrams,
            Notes = dto.Notes,
        };
        await _repo.AddAsync(type, ct);
        await _notifier.NotifyAsync("filament-type", id, ct);
        return CreatedAtAction(nameof(Get), new { id }, type.ToDto());
    }

    [HttpPut("{id}")]
    public async Task<ActionResult<FilamentTypeDto>> Update(string id, [FromBody] UpdateFilamentTypeDto dto, CancellationToken ct)
    {
        var existing = await _repo.GetAsync(id, ct);
        if (existing is null) return NotFound();
        existing.Brand = dto.Brand;
        existing.Material = dto.Material;
        existing.Type = dto.Type;
        existing.Color = dto.Color;
        existing.ColorHex = dto.ColorHex;
        existing.DefaultNetWeightGrams = dto.DefaultNetWeightGrams;
        existing.EmptySpoolWeightGrams = dto.EmptySpoolWeightGrams;
        existing.Notes = dto.Notes;
        await _repo.UpdateAsync(existing, ct);
        await _notifier.NotifyAsync("filament-type", id, ct);
        return existing.ToDto();
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(string id, CancellationToken ct)
    {
        try
        {
            var removed = await _repo.DeleteAsync(id, ct);
            if (!removed) return NotFound();
            await _notifier.NotifyAsync("filament-type", id, ct);
            return NoContent();
        }
        catch (InvalidOperationException ex)
        {
            return Conflict(new { error = ex.Message });
        }
    }
}
