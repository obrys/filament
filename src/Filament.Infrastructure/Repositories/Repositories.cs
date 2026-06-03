using Filament.Core.Abstractions;
using Filament.Core.Domain;
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

    public async Task<IReadOnlyList<Spool>> ListAsync(string? filamentTypeId = null, bool includeFinished = false, CancellationToken ct = default)
    {
        var q = _db.Spools.AsNoTracking().AsQueryable();
        if (filamentTypeId is not null) q = q.Where(s => s.FilamentTypeId == filamentTypeId);
        if (!includeFinished) q = q.Where(s => s.Status != (int)SpoolStatus.Finished);
        var list = await q.OrderByDescending(s => s.CreatedAt).ToListAsync(ct);
        return list.Select(EntityMapping.ToDomain).ToList();
    }

    public async Task AddAsync(Spool spool, SpoolEvent createdEvent, CancellationToken ct = default)
    {
        _db.Spools.Add(spool.ToEntity());
        _db.SpoolEvents.Add(createdEvent.ToEntity());
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
        var totalRemaining = await _db.Spools.Where(s => s.Status != (int)SpoolStatus.Finished)
            .SumAsync(s => (int?)s.RemainingGrams, ct) ?? 0;
        return new DashboardSummary(typeCount, active, finished, totalRemaining);
    }

    public async Task<IReadOnlyList<DailyUsage>> GetUsageAsync(int days, CancellationToken ct = default)
    {
        var since = DateTimeOffset.UtcNow.AddDays(-days);
        var raw = await _db.SpoolEvents.AsNoTracking()
            .Where(e => e.OccurredAt >= since && e.DeltaGrams < 0)
            .Select(e => new { e.OccurredAt, e.DeltaGrams })
            .ToListAsync(ct);
        return raw
            .GroupBy(x => DateOnly.FromDateTime(x.OccurredAt.UtcDateTime))
            .Select(g => new DailyUsage(g.Key, -g.Sum(x => x.DeltaGrams)))
            .OrderBy(d => d.Day)
            .ToList();
    }
}
