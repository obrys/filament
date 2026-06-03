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
        if (grams <= 0) throw new ArgumentOutOfRangeException(nameof(grams), "Must be positive.");
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
            RemainingAfterGrams = spool.RemainingGrams,
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
        if (newRemainingGrams < 0) throw new ArgumentOutOfRangeException(nameof(newRemainingGrams));
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
            RemainingAfterGrams = newRemainingGrams,
            Notes = notes,
            OccurredAt = now,
        };
        return new ConsumeResult(spool, ev);
    }

    public static int EffectiveEmptySpoolGrams(Spool spool, FilamentType type) =>
        spool.EmptySpoolWeightGramsOverride ?? type.EmptySpoolWeightGrams;
}
