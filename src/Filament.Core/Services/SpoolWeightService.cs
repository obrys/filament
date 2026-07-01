using Filament.Core.Domain;

namespace Filament.Core.Services;

/// <summary>
/// Stateless weight helpers. Lifecycle transitions (open/consume/adjust/finish/undo) live in
/// <see cref="SpoolLifecycle"/>; this type only holds pure weight arithmetic reused across layers.
/// </summary>
public static class SpoolWeightService
{
    /// <summary>
    /// Computes a spool's remaining grams from its initial net weight plus the sum of every
    /// <b>enabled</b> event delta. Disabled (undone) events contribute nothing.
    /// </summary>
    public static int ComputeRemaining(int initialNetGrams, IEnumerable<SpoolEvent> events)
    {
        ArgumentNullException.ThrowIfNull(events);
        return initialNetGrams + events.Where(e => !e.IsDisabled).Sum(e => e.DeltaGrams);
    }

    public static int EffectiveEmptySpoolGrams(Spool spool, FilamentType type) =>
        spool.EmptySpoolWeightGramsOverride ?? type.EmptySpoolWeightGrams;
}
