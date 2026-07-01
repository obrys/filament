using Filament.Core.Domain;
using Filament.Core.Services;

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

    /// <summary>
    /// Atomically applies a lifecycle plan (add/enable/disable an event), recomputes the spool's
    /// cached state and remaining weight from its enabled events, and persists everything.
    /// Returns the updated spool, or null if the spool does not exist.
    /// </summary>
    Task<Spool?> ApplyLifecycleAsync(string spoolId, LifecyclePlan plan, CancellationToken ct = default);

    /// <summary>
    /// Recomputes every spool's cached state and remaining weight from its enabled events, persists
    /// any differences, and returns a per-spool report (differences flagged).
    /// </summary>
    Task<IReadOnlyList<SpoolReevaluation>> ReevaluateAllAsync(CancellationToken ct = default);
}

/// <summary>Result of re-evaluating a single spool: stored vs. recomputed state and weight.</summary>
public sealed record SpoolReevaluation(
    string SpoolId,
    SpoolStatus OldStatus,
    SpoolStatus NewStatus,
    int OldRemainingGrams,
    int NewRemainingGrams)
{
    public bool Changed => OldStatus != NewStatus || OldRemainingGrams != NewRemainingGrams;
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
