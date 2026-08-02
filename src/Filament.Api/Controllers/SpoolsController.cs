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
        [FromQuery] string? sort,
        [FromQuery] string? filamentTypeId,
        [FromQuery] bool includeFinished,
        [FromQuery] string[]? brand,
        [FromQuery] string[]? material,
        [FromQuery] string[]? type,
        [FromQuery] string[]? color,
        CancellationToken ct)
    {
        var sortKey = SpoolSortParser.Parse(sort);
        var items = await _spools.ListAsync(sortKey, filamentTypeId, includeFinished, ct);
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
        var remainingAfter = SpoolLifecycle.RunningRemaining(spool.InitialNetGrams, events);
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

    [HttpPost("{id}/open")]
    public Task<ActionResult<SpoolDto>> Open(string id, CancellationToken ct) =>
        ApplyLifecycle(id, (spool, events) =>
            SpoolLifecycle.PlanOpen(spool.Id, spool.InitialNetGrams, events), ct);

    [HttpPost("{id}/finish")]
    public Task<ActionResult<SpoolDto>> Finish(string id, CancellationToken ct) =>
        ApplyLifecycle(id, (spool, events) =>
            SpoolLifecycle.PlanFinish(spool.Id, spool.InitialNetGrams, events), ct);

    [HttpPost("{id}/consume")]
    public Task<ActionResult<SpoolDto>> Consume(string id, [FromBody] ConsumeSpoolDto dto, CancellationToken ct) =>
        ApplyLifecycle(id, (spool, events) =>
            SpoolLifecycle.PlanConsume(spool.Id, spool.InitialNetGrams, events,
                dto.Grams, dto.ProjectName, dto.ProjectUrl, dto.Notes), ct);

    [HttpPost("{id}/adjust")]
    public Task<ActionResult<SpoolDto>> Adjust(string id, [FromBody] AdjustSpoolDto dto, CancellationToken ct) =>
        ApplyLifecycle(id, (spool, events) =>
            SpoolLifecycle.PlanAdjust(spool.Id, spool.InitialNetGrams, events, dto.NewRemainingGrams, dto.Notes), ct);

    [HttpPost("{id}/events/{eventId:long}/disable")]
    public Task<ActionResult<SpoolDto>> DisableEvent(string id, long eventId, CancellationToken ct) =>
        ApplyLifecycle(id, (_, events) => SpoolLifecycle.PlanSetEnabled(events, eventId, enabled: false), ct);

    [HttpPost("{id}/events/{eventId:long}/enable")]
    public Task<ActionResult<SpoolDto>> EnableEvent(string id, long eventId, CancellationToken ct) =>
        ApplyLifecycle(id, (_, events) => SpoolLifecycle.PlanSetEnabled(events, eventId, enabled: true), ct);

    /// <summary>
    /// Recomputes every spool's cached state and remaining weight from its enabled events, persists
    /// any differences and reports them. Used to repair drift after a manual database intervention.
    /// </summary>
    [HttpPost("reevaluate")]
    public async Task<ActionResult<ReevaluateResultDto>> Reevaluate(CancellationToken ct)
    {
        var report = await _spools.ReevaluateAllAsync(ct);
        var changed = report.Where(r => r.Changed)
            .Select(r => new SpoolReevalDiffDto(
                r.SpoolId, r.OldStatus.ToString(), r.NewStatus.ToString(),
                r.OldRemainingGrams, r.NewRemainingGrams))
            .ToList();

        if (changed.Count > 0)
            await _notifier.NotifyAsync("spool", null, ct);

        return new ReevaluateResultDto(report.Count, changed.Count, changed);
    }

    // Shared pipeline for every lifecycle mutation: load the spool + its type + events, build the
    // (validated) plan, apply it atomically (repository recomputes cached state), broadcast, respond.
    private async Task<ActionResult<SpoolDto>> ApplyLifecycle(
        string id, Func<Spool, IReadOnlyList<SpoolEvent>, LifecyclePlan> planner, CancellationToken ct)
    {
        var spool = await _spools.GetAsync(id, ct);
        if (spool is null) return NotFound();
        var type = await _types.GetAsync(spool.FilamentTypeId, ct);
        if (type is null) return NotFound();
        try
        {
            var events = await _spools.ListEventsAsync(id, ct);
            var plan = planner(spool, events);
            var updated = await _spools.ApplyLifecycleAsync(id, plan, ct);
            if (updated is null) return NotFound();
            await _notifier.NotifyAsync("spool", id, ct);
            return updated.ToDto(type);
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
