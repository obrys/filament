namespace Filament.Core.Domain;

public enum SpoolEventKind
{
    Created = 0,
    Opened = 1,
    Print = 2,
    Adjustment = 3,
    Finished = 4,
}

/// <summary>
/// An event in the life of a spool — opening, a print, a manual adjustment, finishing.
/// </summary>
public sealed class SpoolEvent
{
    public long Id { get; init; }
    public required string SpoolId { get; init; }
    public SpoolEventKind Kind { get; init; }

    /// <summary>Delta in grams (negative for consumption, positive for adjustments up).</summary>
    public int DeltaGrams { get; init; }

    public string? ProjectName { get; init; }
    public string? ProjectUrl { get; init; }
    public string? Notes { get; init; }

    public DateTimeOffset OccurredAt { get; init; } = DateTimeOffset.UtcNow;
}
