namespace Filament.Core.Domain;

public enum SpoolStatus
{
    Sealed = 0,
    Open = 1,
    Finished = 2,
}

/// <summary>
/// A physical spool of filament. Multiple spools may share a FilamentType.
/// </summary>
public sealed class Spool
{
    public required string Id { get; init; }
    public required string FilamentTypeId { get; set; }

    /// <summary>
    /// Remaining filament weight in grams. A cached value derived from <see cref="InitialNetGrams"/>
    /// plus the sum of the deltas of every *enabled* spool event. It is persisted for cheap reads
    /// and recomputed on every event change (and by the manual re-evaluation tool), so it must be
    /// treated as authoritative-but-recoverable — never the source of truth for state.
    /// </summary>
    public int RemainingGrams { get; set; }

    /// <summary>Initial net weight in grams when the spool was created.</summary>
    public int InitialNetGrams { get; set; }

    /// <summary>
    /// Empty spool weight override (grams). When null, the FilamentType's default is used.
    /// Allows a refill kit to use a different physical spool than the type's default.
    /// </summary>
    public int? EmptySpoolWeightGramsOverride { get; set; }

    public SpoolStatus Status { get; set; } = SpoolStatus.Sealed;

    public DateTimeOffset CreatedAt { get; init; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? OpenedAt { get; set; }
    public DateTimeOffset? FinishedAt { get; set; }

    /// <summary>
    /// Cached <c>lastUsedAt</c> timestamp: the <c>OccurredAt</c> of the most recent enabled spool
    /// event, derived in <see cref="Services.SpoolLifecycle.Evaluate"/> and persisted for cheap
    /// sorted reads. Like <see cref="RemainingGrams"/>, <see cref="OpenedAt"/> and
    /// <see cref="FinishedAt"/> it is recomputed on every event change (and by the manual
    /// re-evaluation tool), so treat it as authoritative-but-recoverable. In practice always
    /// populated after an Evaluate (every spool has an immutable enabled Created event); nullable
    /// here only to mirror the other cached timestamps.
    /// </summary>
    public DateTimeOffset? LastUsedAt { get; set; }

    public string? Notes { get; set; }
}
