using Filament.Core.Domain;

namespace Filament.Core.Services;

public static class SpoolWeightService
{
    public sealed record ConsumeResult(Spool Spool, SpoolEvent Event);

    public static ConsumeResult Consume(
        Spool spool,
        int grams,
        string? projectName = null,
        string? projectUrl = null,
        string? notes = null,
        DateTimeOffset? at = null)
    {
        ArgumentNullException.ThrowIfNull(spool);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(grams);
        if (spool.Status == SpoolStatus.Finished)
            throw new InvalidOperationException("Spool is already finished.");
        if (grams > spool.RemainingGrams)
            throw new InvalidOperationException(
                $"Cannot consume {grams}g — only {spool.RemainingGrams}g remaining.");

        var now = at ?? DateTimeOffset.UtcNow;

        if (spool.Status == SpoolStatus.Sealed)
        {
            spool.Status = SpoolStatus.Open;
            spool.OpenedAt = now;
        }

        spool.RemainingGrams -= grams;

        if (spool.RemainingGrams == 0)
        {
            spool.Status = SpoolStatus.Finished;
            spool.FinishedAt = now;
        }

        var ev = new SpoolEvent
        {
            SpoolId = spool.Id,
            Kind = spool.Status == SpoolStatus.Finished ? SpoolEventKind.Finished : SpoolEventKind.Print,
            DeltaGrams = -grams,
            ProjectName = projectName,
            ProjectUrl = projectUrl,
            Notes = notes,
            OccurredAt = now,
        };
        return new ConsumeResult(spool, ev);
    }

    public static ConsumeResult Adjust(Spool spool, int newRemainingGrams, string? notes = null, DateTimeOffset? at = null)
    {
        ArgumentNullException.ThrowIfNull(spool);
        ArgumentOutOfRangeException.ThrowIfNegative(newRemainingGrams);
        if (spool.Status == SpoolStatus.Finished)
            throw new InvalidOperationException("Spool is already finished.");

        var now = at ?? DateTimeOffset.UtcNow;
        var delta = newRemainingGrams - spool.RemainingGrams;
        spool.RemainingGrams = newRemainingGrams;
        if (newRemainingGrams == 0)
        {
            spool.Status = SpoolStatus.Finished;
            spool.FinishedAt = now;
        }

        var ev = new SpoolEvent
        {
            SpoolId = spool.Id,
            Kind = newRemainingGrams == 0 ? SpoolEventKind.Finished : SpoolEventKind.Adjustment,
            DeltaGrams = delta,
            Notes = notes,
            OccurredAt = now,
        };
        return new ConsumeResult(spool, ev);
    }

    /// <summary>
    /// Computes a spool's remaining grams from its initial net weight plus the sum of all
    /// event deltas. This is the single source of truth now that the value is no longer stored.
    /// </summary>
    public static int ComputeRemaining(int initialNetGrams, IEnumerable<SpoolEvent> events)
    {
        ArgumentNullException.ThrowIfNull(events);
        return initialNetGrams + events.Sum(e => e.DeltaGrams);
    }

    /// <summary>
    /// Computes the remaining grams *after* each event, returned keyed by event id. Events are
    /// folded in chronological order (OccurredAt, then Id) starting from the initial net weight.
    /// </summary>
    public static IReadOnlyDictionary<long, int> ComputeRemainingAfter(
        int initialNetGrams, IEnumerable<SpoolEvent> events)
    {
        ArgumentNullException.ThrowIfNull(events);
        var running = initialNetGrams;
        var result = new Dictionary<long, int>();
        foreach (var e in events.OrderBy(e => e.OccurredAt).ThenBy(e => e.Id))
        {
            running += e.DeltaGrams;
            result[e.Id] = running;
        }
        return result;
    }

    public static int EffectiveEmptySpoolGrams(Spool spool, FilamentType type) =>
        spool.EmptySpoolWeightGramsOverride ?? type.EmptySpoolWeightGrams;
}
