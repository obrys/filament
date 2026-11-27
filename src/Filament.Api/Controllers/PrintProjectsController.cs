using Filament.Api.Dtos;
using Filament.Api.Mapping;
using Filament.Core.Abstractions;
using Filament.Core.Domain;
using Filament.Core.Identifiers;
using Filament.Core.Services;
using Microsoft.AspNetCore.Mvc;

namespace Filament.Api.Controllers;

[ApiController]
[Route("api/print-projects")]
public sealed class PrintProjectsController : ControllerBase
{
    private readonly IPrintProjectRepository _projects;
    private readonly IFilamentTypeRepository _types;
    private readonly ISpoolRepository _spools;
    private readonly IChangeNotifier _notifier;

    public PrintProjectsController(
        IPrintProjectRepository projects, IFilamentTypeRepository types, ISpoolRepository spools, IChangeNotifier notifier)
    {
        _projects = projects;
        _types = types;
        _spools = spools;
        _notifier = notifier;
    }

    [HttpGet]
    public async Task<PrintProjectListDto> List([FromQuery] bool includeArchived, CancellationToken ct)
    {
        var projects = await _projects.ListAsync(includeArchived, ct);
        var types = await LoadTypesAsync(projects.SelectMany(p => p.Types).Select(t => t.FilamentTypeId), ct);
        // In-memory sort is deliberate: the effective date is a composite (archived / newest
        // enabled print / created) and the application is single-user scale (plan decision 7).
        var sorted = projects.ToList();
        sorted.Sort((a, b) => PrintProjectRules.Compare(a, b));
        return new PrintProjectListDto(sorted.Select(p => p.ToDto(id => types[id], includePrints: false)).ToList());
    }

    [HttpGet("{id}")]
    public async Task<ActionResult<PrintProjectDto>> Get(string id, CancellationToken ct)
    {
        var p = await _projects.GetAsync(id, ct);
        if (p is null) return NotFound();
        var types = await LoadTypesAsync(p.Types.Select(t => t.FilamentTypeId), ct);
        var spoolTypes = await LoadSpoolTypesAsync(p.Prints.SelectMany(pr => pr.Events).Select(e => e.SpoolId), ct);
        return p.ToDto(id => types[id], includePrints: true, id => spoolTypes[id]);
    }

    [HttpPost]
    public async Task<ActionResult<PrintProjectDto>> Create([FromBody] CreatePrintProjectDto dto, CancellationToken ct)
    {
        var shapeError = ValidateShape(dto);
        if (shapeError is not null) return shapeError;
        var types = ToDefinition(dto);
        var guardError = Guard(dto, types);
        if (guardError is not null) return guardError;
        var typesById = await LoadTypesAsync(types.Select(t => t.FilamentTypeId), ct);
        if (types.Any(t => !typesById.ContainsKey(t.FilamentTypeId)))
            return NotFound(new { error = "Unknown filament type." });

        var project = new PrintProject
        {
            Id = IdentifierGenerator.NewProjectId(),
            Title = dto.Title,
            Description = dto.Description,
            Url = dto.Url,
            Types = types,
        };
        var created = await _projects.CreateAsync(project, ct);
        await _notifier.NotifyAsync("print-project", created.Id, ct);
        return CreatedAtAction(nameof(Get), new { id = created.Id }, created.ToDto(id => typesById[id], includePrints: false));
    }

    [HttpPut("{id}")]
    public async Task<ActionResult<PrintProjectDto>> Update(string id, [FromBody] CreatePrintProjectDto dto, CancellationToken ct)
    {
        var existing = await _projects.GetAsync(id, ct);
        if (existing is null) return NotFound();
        var shapeError = ValidateShape(dto);
        if (shapeError is not null) return shapeError;
        var types = ToDefinition(dto);
        var guardError = Guard(dto, types, existing);
        if (guardError is not null) return guardError;
        var typesById = await LoadTypesAsync(types.Select(t => t.FilamentTypeId), ct);
        if (types.Any(t => !typesById.ContainsKey(t.FilamentTypeId)))
            return NotFound(new { error = "Unknown filament type." });

        var project = new PrintProject
        {
            Id = id,
            Title = dto.Title,
            Description = dto.Description,
            Url = dto.Url,
            CreatedAt = existing.CreatedAt,
            Types = types,
        };
        var updated = await _projects.UpdateAsync(project, ct);
        await _notifier.NotifyAsync("print-project", id, ct);
        return updated.ToDto(id => typesById[id], includePrints: false);
    }

    [HttpPost("{id}/archive")]
    public async Task<ActionResult<PrintProjectDto>> Archive(string id, CancellationToken ct)
    {
        var p = await _projects.GetAsync(id, ct);
        if (p is null) return NotFound();
        if (p.IsArchived) return BadRequest(new { error = "Project is already archived." });
        var updated = await _projects.SetArchivedAsync(id, archived: true, DateTimeOffset.UtcNow, ct);
        await _notifier.NotifyAsync("print-project", id, ct);
        return MapProject(updated, await LoadTypesAsync(updated.Types.Select(t => t.FilamentTypeId), ct));
    }

    [HttpPost("{id}/unarchive")]
    public async Task<ActionResult<PrintProjectDto>> Unarchive(string id, CancellationToken ct)
    {
        var p = await _projects.GetAsync(id, ct);
        if (p is null) return NotFound();
        if (!p.IsArchived) return BadRequest(new { error = "Project is not archived." });
        var updated = await _projects.SetArchivedAsync(id, archived: false, DateTimeOffset.UtcNow, ct);
        await _notifier.NotifyAsync("print-project", id, ct);
        return MapProject(updated, await LoadTypesAsync(updated.Types.Select(t => t.FilamentTypeId), ct));
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(string id, CancellationToken ct)
    {
        var p = await _projects.GetAsync(id, ct);
        if (p is null) return NotFound();
        try
        {
            PrintProjectRules.EnsureDeletable(p, p.Prints);
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentOutOfRangeException)
        {
            return BadRequest(new { error = ex.Message });
        }
        await _projects.DeleteAsync(id, ct);
        await _notifier.NotifyAsync("print-project", id, ct);
        await _notifier.NotifyAsync("spool", null, ct);
        return NoContent();
    }

    [HttpPost("{id}/prints")]
    public async Task<ActionResult<ProjectPrintDto>> Print(string id, [FromBody] CreateProjectPrintDto dto, CancellationToken ct)
    {
        var p = await _projects.GetAsync(id, ct);
        if (p is null) return NotFound();
        if (dto.Spools is null || dto.Spools.Any(s => s is null))
            return BadRequest(new { error = "The print needs a spool selection with a spool and grams for every filament type." });
        try
        {
            var selection = dto.Spools
                .Select(s => new PrintSelection(s.SpoolId, s.Grams))
                .ToList();
            var print = await _projects.PrintAsync(id, selection, ct);
            await _notifier.NotifyAsync("print-project", id, ct);
            await _notifier.NotifyAsync("spool", null, ct);
            return MapPrint(print, await LoadSpoolTypesAsync(print.Events.Select(e => e.SpoolId), ct));
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentOutOfRangeException)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpPost("{id}/prints/{printId}/undo")]
    public Task<ActionResult<ProjectPrintDto>> Undo(string id, string printId, CancellationToken ct) =>
        SetPrintEnabled(id, printId, enabled: false, ct);

    [HttpPost("{id}/prints/{printId}/redo")]
    public Task<ActionResult<ProjectPrintDto>> Redo(string id, string printId, CancellationToken ct) =>
        SetPrintEnabled(id, printId, enabled: true, ct);

    private async Task<ActionResult<ProjectPrintDto>> SetPrintEnabled(string id, string printId, bool enabled, CancellationToken ct)
    {
        var p = await _projects.GetAsync(id, ct);
        if (p is null) return NotFound();
        if (p.Prints.All(x => x.Id != printId)) return NotFound();
        try
        {
            var print = await _projects.SetPrintEnabledAsync(id, printId, enabled, ct);
            await _notifier.NotifyAsync("print-project", id, ct);
            await _notifier.NotifyAsync("spool", null, ct);
            return MapPrint(print, await LoadSpoolTypesAsync(print.Events.Select(e => e.SpoolId), ct));
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentOutOfRangeException)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    // ----- helpers -----

    /// <summary>Rejects a body with missing type lines (JSON <c>null</c> entries) before they are dereferenced.</summary>
    private static BadRequestObjectResult? ValidateShape(CreatePrintProjectDto dto) =>
        dto.Types is null || dto.Types.Any(t => t is null)
            ? new BadRequestObjectResult(new { error = "A print project needs at least one valid filament type line." })
            : null;

    private static List<PrintProjectType> ToDefinition(CreatePrintProjectDto dto) =>
        (dto.Types ?? [])
            .Select(t => new PrintProjectType { FilamentTypeId = t.FilamentTypeId, Grams = t.Grams })
            .ToList();

    /// <summary>Definition validation (create and update) plus the archived guard on update.</summary>
    private static ActionResult<PrintProjectDto>? Guard(
        CreatePrintProjectDto dto, List<PrintProjectType> types, PrintProject? existing = null)
    {
        try
        {
            PrintProjectRules.ValidateDefinition(dto.Title, dto.Description, dto.Url, types);
            if (existing is not null)
                PrintProjectRules.EnsureNotArchived(existing, "edited");
            return null;
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentOutOfRangeException)
        {
            return new BadRequestObjectResult(new { error = ex.Message });
        }
    }

    private static PrintProjectDto MapProject(PrintProject p, IReadOnlyDictionary<string, FilamentType> typesById) =>
        p.ToDto(id => typesById[id], includePrints: false);

    private static ProjectPrintDto MapPrint(ProjectPrint print, IReadOnlyDictionary<string, FilamentType> spoolTypesById) =>
        print.ToDto(id => spoolTypesById[id]);

    private async Task<IReadOnlyDictionary<string, FilamentType>> LoadTypesAsync(IEnumerable<string> typeIds, CancellationToken ct)
    {
        var ids = typeIds.Distinct().ToList();
        if (ids.Count == 0) return new Dictionary<string, FilamentType>();
        var all = await _types.ListAsync(ct);
        return all.Where(t => ids.Contains(t.Id)).ToDictionary(t => t.Id);
    }

    private async Task<IReadOnlyDictionary<string, FilamentType>> LoadSpoolTypesAsync(IEnumerable<string> spoolIds, CancellationToken ct)
    {
        var ids = spoolIds.Distinct().ToList();
        if (ids.Count == 0) return new Dictionary<string, FilamentType>();
        var spools = await _spools.ListAsync(includeFinished: true, ct: ct);
        var spoolTypeIds = spools
            .Where(s => ids.Contains(s.Id))
            .ToDictionary(s => s.Id, s => s.FilamentTypeId);
        var types = await LoadTypesAsync(spoolTypeIds.Values, ct);
        return spoolTypeIds.ToDictionary(kv => kv.Key, kv => types[kv.Value]);
    }
}
