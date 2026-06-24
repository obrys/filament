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
    /// Remaining filament weight in grams. Derived, not persisted: computed as
    /// <see cref="InitialNetGrams"/> plus the sum of all spool-event deltas. The repository
    /// populates this when loading a spool; mutating it in memory does not write a column.
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

    public string? Notes { get; set; }
}
