using Filament.Core.Abstractions;
using Filament.Core.Domain;
using Filament.Core.Services;
using Filament.Infrastructure.Entities;
using Filament.Infrastructure.Mapping;
using Filament.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Filament.Infrastructure.Repositories;

public sealed class FilamentTypeRepository : IFilamentTypeRepository
{
    private readonly FilamentDbContext _db;
    public FilamentTypeRepository(FilamentDbContext db) => _db = db;

    public async Task<FilamentType?> GetAsync(string id, CancellationToken ct = default)
    {
        var e = await _db.FilamentTypes.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        return e?.ToDomain();
    }

    public async Task<IReadOnlyList<FilamentType>> ListAsync(CancellationToken ct = default)
    {
        var list = await _db.FilamentTypes.AsNoTracking()
            .OrderBy(x => x.Brand).ThenBy(x => x.Material).ThenBy(x => x.Color)
            .ToListAsync(ct);
        return list.Select(EntityMapping.ToDomain).ToList();
    }

    public async Task AddAsync(FilamentType type, CancellationToken ct = default)
    {
        _db.FilamentTypes.Add(type.ToEntity());
        await _db.SaveChangesAsync(ct);
    }

    public async Task UpdateAsync(FilamentType type, CancellationToken ct = default)
    {
        var e = await _db.FilamentTypes.FirstOrDefaultAsync(x => x.Id == type.Id, ct)
            ?? throw new InvalidOperationException($"FilamentType '{type.Id}' not found.");
        type.CopyTo(e);
        await _db.SaveChangesAsync(ct);
    }

    public async Task<bool> DeleteAsync(string id, CancellationToken ct = default)
    {
        if (await HasSpoolsAsync(id, ct))
            throw new InvalidOperationException("Cannot delete a filament type that still has spools.");
        var e = await _db.FilamentTypes.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (e is null) return false;
        _db.FilamentTypes.Remove(e);
        await _db.SaveChangesAsync(ct);
        return true;
    }

    public Task<bool> HasSpoolsAsync(string id, CancellationToken ct = default) =>
        _db.Spools.AnyAsync(s => s.FilamentTypeId == id, ct);
}

public sealed class SpoolRepository : ISpoolRepository
{
    private readonly FilamentDbContext _db;
    public SpoolRepository(FilamentDbContext db) => _db = db;

    public async Task<Spool?> GetAsync(string id, CancellationToken ct = default)
    {
        var e = await _db.Spools.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        return e?.ToDomain();
    }

    public async Task<IReadOnlyList<Spool>> ListAsync(SpoolSort sort = SpoolSort.LastUsed, string? filamentTypeId = null, bool includeFinished = false, CancellationToken ct = default)
    {
        var q = _db.Spools.AsNoTracking().AsQueryable();
        if (filamentTypeId is not null) q = q.Where(s => s.FilamentTypeId == filamentTypeId);
        if (!includeFinished) q = q.Where(s => s.Status != (int)SpoolStatus.Finished);

        // Sorting is performed by the database in the listing query, not in application memory.
        // The fixed secondary order (lastUsedAt desc, then id asc) keeps results stable across
        // equal primary keys. ThenByDescending(LastUsedAt) is redundant under the LastUsed primary
        // but harmless and keeps one code path for the mandated secondary order.
        IOrderedQueryable<SpoolEntity> ordered = sort switch
        {
            SpoolSort.LeastRemaining => q.OrderBy(s => s.RemainingGrams),
            SpoolSort.MostRemaining => q.OrderByDescending(s => s.RemainingGrams),
            _ => q.OrderByDescending(s => s.LastUsedAt),
        };
        var entities = await ordered
            .ThenByDescending(s => s.LastUsedAt)
            .ThenBy(s => s.Id)
            .ToListAsync(ct);
        return entities.Select(EntityMapping.ToDomain).ToList();
    }

    public async Task AddAsync(Spool spool, SpoolEvent createdEvent, CancellationToken ct = default)
    {
        var entity = spool.ToEntity();
        _db.Spools.Add(entity);
        _db.SpoolEvents.Add(createdEvent.ToEntity());
        // Derive the cached state (including LastUsedAt) at creation so a fresh spool is immediately
        // consistent with the cache-writer path used by lifecycle writes and re-evaluation. A
        // Created-only spool ends up with LastUsedAt == the Created event's OccurredAt.
        var state = SpoolLifecycle.Evaluate(spool.InitialNetGrams, new[] { createdEvent });
        ApplyState(entity, state);
        await _db.SaveChangesAsync(ct);
    }

    public async Task UpdateAsync(Spool spool, SpoolEvent? newEvent = null, CancellationToken ct = default)
    {
        var e = await _db.Spools.FirstOrDefaultAsync(x => x.Id == spool.Id, ct)
            ?? throw new InvalidOperationException($"Spool '{spool.Id}' not found.");
        spool.CopyTo(e);
        if (newEvent is not null)
            _db.SpoolEvents.Add(newEvent.ToEntity());
        await _db.SaveChangesAsync(ct);
    }

    public async Task<bool> DeleteAsync(string id, CancellationToken ct = default)
    {
        var e = await _db.Spools.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (e is null) return false;
        _db.Spools.Remove(e);
        await _db.SaveChangesAsync(ct);
        return true;
    }

    public async Task<IReadOnlyList<SpoolEvent>> ListEventsAsync(string spoolId, CancellationToken ct = default)
    {
        var list = await _db.SpoolEvents.AsNoTracking()
            .Where(e => e.SpoolId == spoolId)
            .OrderByDescending(e => e.OccurredAt)
            .ToListAsync(ct);
        return list.Select(EntityMapping.ToDomain).ToList();
    }

    public async Task<Spool?> ApplyLifecycleAsync(string spoolId, LifecyclePlan plan, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(plan);
        var spool = await _db.Spools.FirstOrDefaultAsync(x => x.Id == spoolId, ct);
        if (spool is null) return null;

        var events = await _db.SpoolEvents.Where(e => e.SpoolId == spoolId).ToListAsync(ct);

        if (plan.EventToAdd is not null)
        {
            var entity = plan.EventToAdd.ToEntity();
            _db.SpoolEvents.Add(entity);
            events.Add(entity);
        }
        if (plan.EventToEnable is { } enableId)
        {
            var target = events.FirstOrDefault(e => e.Id == enableId)
                ?? throw new InvalidOperationException("Event not found.");
            target.IsDisabled = false;
        }
        if (plan.EventToDisable is { } disableId)
        {
            var target = events.FirstOrDefault(e => e.Id == disableId)
                ?? throw new InvalidOperationException("Event not found.");
            target.IsDisabled = true;
        }

        var domainEvents = events.Select(EntityMapping.ToDomain).ToList();
        var state = SpoolLifecycle.Evaluate(spool.InitialNetGrams, domainEvents);
        ApplyState(spool, state);

        await _db.SaveChangesAsync(ct);
        return spool.ToDomain();
    }

    public async Task<IReadOnlyList<SpoolReevaluation>> ReevaluateAllAsync(CancellationToken ct = default)
    {
        var spools = await _db.Spools.ToListAsync(ct);
        var allEvents = await _db.SpoolEvents.ToListAsync(ct);
        var bySpool = allEvents.GroupBy(e => e.SpoolId)
            .ToDictionary(g => g.Key, g => g.Select(EntityMapping.ToDomain).ToList());

        var report = new List<SpoolReevaluation>(spools.Count);
        foreach (var spool in spools)
        {
            var events = bySpool.TryGetValue(spool.Id, out var evs) ? evs : new List<SpoolEvent>();
            var state = SpoolLifecycle.Evaluate(spool.InitialNetGrams, events);
            var result = new SpoolReevaluation(
                spool.Id, (SpoolStatus)spool.Status, state.Status, spool.RemainingGrams, state.RemainingGrams);
            if (result.Changed)
                ApplyState(spool, state);
            report.Add(result);
        }

        await _db.SaveChangesAsync(ct);
        return report;
    }

    private static void ApplyState(SpoolEntity spool, SpoolState state)
    {
        spool.Status = (int)state.Status;
        spool.RemainingGrams = state.RemainingGrams;
        spool.OpenedAt = state.OpenedAt;
        spool.FinishedAt = state.FinishedAt;
        spool.LastUsedAt = state.LastUsedAt;
    }
}

public sealed class DashboardRepository : IDashboardRepository
{
    private readonly FilamentDbContext _db;
    public DashboardRepository(FilamentDbContext db) => _db = db;

    public async Task<DashboardSummary> GetSummaryAsync(CancellationToken ct = default)
    {
        var typeCount = await _db.FilamentTypes.CountAsync(ct);
        var active = await _db.Spools.Where(s => s.Status != (int)SpoolStatus.Finished).CountAsync(ct);
        var finished = await _db.Spools.Where(s => s.Status == (int)SpoolStatus.Finished).CountAsync(ct);

        // Remaining is the sum of the cached per-spool RemainingGrams of the active spools.
        var totalRemaining = await _db.Spools.Where(s => s.Status != (int)SpoolStatus.Finished)
            .SumAsync(s => (int?)s.RemainingGrams, ct) ?? 0;

        return new DashboardSummary(typeCount, active, finished, totalRemaining);
    }

    public async Task<IReadOnlyList<DailyUsage>> GetUsageAsync(int days, CancellationToken ct = default)
    {
        var since = DateTimeOffset.UtcNow.AddDays(-days);
        var raw = await _db.SpoolEvents.AsNoTracking()
            .Where(e => e.OccurredAt >= since && e.DeltaGrams < 0 && !e.IsDisabled)
            .Select(e => new { e.OccurredAt, e.DeltaGrams })
            .ToListAsync(ct);
        return raw
            .GroupBy(x => DateOnly.FromDateTime(x.OccurredAt.UtcDateTime))
            .Select(g => new DailyUsage(g.Key, -g.Sum(x => x.DeltaGrams)))
            .OrderBy(d => d.Day)
            .ToList();
    }
}
