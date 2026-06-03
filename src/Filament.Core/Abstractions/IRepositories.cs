using Filament.Core.Domain;

namespace Filament.Core.Abstractions;

public interface IFilamentTypeRepository
{
    Task<FilamentType?> GetAsync(string id, CancellationToken ct = default);
    Task<IReadOnlyList<FilamentType>> ListAsync(CancellationToken ct = default);
    Task AddAsync(FilamentType type, CancellationToken ct = default);
    Task UpdateAsync(FilamentType type, CancellationToken ct = default);
    Task<bool> DeleteAsync(string id, CancellationToken ct = default);
    Task<bool> HasSpoolsAsync(string id, CancellationToken ct = default);
}

public interface ISpoolRepository
{
    Task<Spool?> GetAsync(string id, CancellationToken ct = default);
    Task<IReadOnlyList<Spool>> ListAsync(string? filamentTypeId = null, bool includeFinished = false, CancellationToken ct = default);
    Task AddAsync(Spool spool, SpoolEvent createdEvent, CancellationToken ct = default);
    Task UpdateAsync(Spool spool, SpoolEvent? newEvent = null, CancellationToken ct = default);
    Task<bool> DeleteAsync(string id, CancellationToken ct = default);
    Task<IReadOnlyList<SpoolEvent>> ListEventsAsync(string spoolId, CancellationToken ct = default);
}

public interface IDashboardRepository
{
    Task<DashboardSummary> GetSummaryAsync(CancellationToken ct = default);
    Task<IReadOnlyList<DailyUsage>> GetUsageAsync(int days, CancellationToken ct = default);
}

public sealed record DashboardSummary(
    int FilamentTypeCount,
    int ActiveSpoolCount,
    int FinishedSpoolCount,
    int TotalRemainingGrams);

public sealed record DailyUsage(DateOnly Day, int ConsumedGrams);

/// <summary>Broadcasts data-change notifications to connected clients.</summary>
public interface IChangeNotifier
{
    Task NotifyAsync(string resource, string? id, CancellationToken ct = default);
}
