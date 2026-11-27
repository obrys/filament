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
    Task<IReadOnlyList<Spool>> ListAsync(SpoolSort sort = SpoolSort.LastUsed, string? filamentTypeId = null, bool includeFinished = false, CancellationToken ct = default);
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

/// <summary>One slot of a project print: the chosen spool and the grams to consume from it.</summary>
public sealed record PrintSelection(string SpoolId, int Grams);

/// <summary>A spool together with its full event history — the planning input for a project print.</summary>
public sealed record SpoolWithEvents(Spool Spool, IReadOnlyList<SpoolEvent> Events);

public interface IPrintProjectRepository
{
    /// <summary>The full graph: types, prints, and each print's spool events.</summary>
    Task<PrintProject?> GetAsync(string id, CancellationToken ct = default);

    /// <summary>Projects with types and prints (no events); archived ones only when included.</summary>
    Task<IReadOnlyList<PrintProject>> ListAsync(bool includeArchived, CancellationToken ct = default);

    Task<PrintProject> CreateAsync(PrintProject project, CancellationToken ct = default);
    Task<PrintProject> UpdateAsync(PrintProject project, CancellationToken ct = default);
    Task<PrintProject> SetArchivedAsync(string id, bool archived, DateTimeOffset at, CancellationToken ct = default);

    /// <summary>
    /// Removes the project, all of its prints (including undone ones) and the linked spool events,
    /// re-evaluating the touched spools so balances and history stay consistent. False when absent.
    /// </summary>
    Task<bool> DeleteAsync(string id, CancellationToken ct = default);

    /// <summary>
    /// Atomically creates a project print plus one Print spool event per selected spool (a sealed
    /// spool is auto-opened by the print). All validation happens before any row is modified, so a
    /// rejected print changes nothing.
    /// </summary>
    Task<ProjectPrint> PrintAsync(string projectId, IReadOnlyList<PrintSelection> selection, CancellationToken ct = default);

    /// <summary>
    /// Atomically disables (undo) or re-enables (redo) a project print and all of its linked spool
    /// events. A guard rejection (e.g. the spool's Open event was undone in the meantime) changes
    /// nothing.
    /// </summary>
    Task<ProjectPrint> SetPrintEnabledAsync(string projectId, string printId, bool enabled, CancellationToken ct = default);

    /// <summary>The owning project of a project print, or null when the id is unresolvable.</summary>
    Task<string?> GetProjectIdByPrintIdAsync(string printId, CancellationToken ct = default);
}

public interface IDashboardRepository
{
    Task<DashboardSummary> GetSummaryAsync(CancellationToken ct = default);
    Task<IReadOnlyList<DailySeries>> GetSeriesAsync(int days, CancellationToken ct = default);
}

public sealed record DashboardSummary(
    int FilamentTypeCount,
    int ActiveSpoolCount,
    int FinishedSpoolCount,
    int TotalRemainingGrams);

/// <summary>One day of the consumption series: grams printed and remaining stock, zero-filled.</summary>
public sealed record DailySeries(DateOnly Day, int ConsumedGrams, int TotalStockGrams);

/// <summary>Broadcasts data-change notifications to connected clients.</summary>
public interface IChangeNotifier
{
    Task NotifyAsync(string resource, string? id, CancellationToken ct = default);
}
