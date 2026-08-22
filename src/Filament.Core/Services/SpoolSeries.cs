using Filament.Core.Domain;

namespace Filament.Core.Services;

/// <summary>
/// Everything the per-day series needs to know about one spool: its initial net grams and its
/// full event history. The <see cref="EnabledEvents"/> field holds the spool's events (including
/// any that are currently disabled/undone); only the enabled subset drives the derivation, which
/// is why undo/redo and deletion are reflected automatically.
/// </summary>
public sealed record SpoolSeriesInput(string SpoolId, int InitialNetGrams, IEnumerable<SpoolEvent> EnabledEvents);

/// <summary>One day of the consumption graph: grams printed and remaining stock, in whole grams.</summary>
public sealed record DailySeriesPoint(DateOnly Day, int ConsumedGrams, int TotalStockGrams);

/// <summary>
/// Pure derivation of the dashboard's two-line consumption series. Given every spool's initial net
/// grams and its (enabled) event history, it reconstructs, for each day of a fixed UTC window
/// ending at <paramref name="endDay"/>:
///   - ConsumedGrams: grams from enabled Print events recorded on that day (only, in whole grams);
///   - TotalStockGrams: sum over non-finished spools of their remaining grams at the end of that day.
///
/// Every day in the window is present (zero-filled and consecutive). No I/O, no clock — the clock
/// is supplied by the caller so the result is deterministic and unit-testable.
/// </summary>
public static class SpoolSeries
{
    /// <summary>
    /// Builds the zero-filled, consecutive daily series for the window of <paramref name="days"/>
    /// UTC days ending at <paramref name="endDay"/> (oldest first).
    /// </summary>
    public static IReadOnlyList<DailySeriesPoint> BuildSeries(
        IReadOnlyList<SpoolSeriesInput> spools, DateOnly endDay, int days)
    {
        ArgumentNullException.ThrowIfNull(spools);
        ArgumentOutOfRangeException.ThrowIfLessThan(days, 1);

        var startDay = endDay.AddDays(-(days - 1));
        var consumedByDay = new int[days];
        var totalByDay = new int[days];

        foreach (var input in spools)
        {
            // Same canonical chronological order as SpoolLifecycle.Evaluate: time, then kind rank
            // (Created < Opened < Print/Adjustment < Finished), then id. Disabled events are ignored.
            var ordered = input.EnabledEvents
                .Where(e => !e.IsDisabled)
                .OrderBy(e => e.OccurredAt)
                .ThenBy(e => KindRank(e.Kind))
                .ThenBy(e => e.Id)
                .ToList();

            if (ordered.Count == 0) continue;

            var running = input.InitialNetGrams;
            var finished = false;
            // A spool's contribution starts on the day of its earliest enabled event (its Created).
            var creationDay = DateOnly.FromDateTime(ordered[0].OccurredAt.UtcDateTime);

            var ptr = 0;
            for (var i = 0; i < days; i++)
            {
                var day = startDay.AddDays(i);

                // Apply every enabled event whose UTC day has arrived (pre-window events land on the
                // first window day and set the starting balance/finish state).
                while (ptr < ordered.Count &&
                       DateOnly.FromDateTime(ordered[ptr].OccurredAt.UtcDateTime) <= day)
                {
                    var e = ordered[ptr++];
                    running += e.DeltaGrams;
                    if (e.Kind == SpoolEventKind.Finished) finished = true;

                    // Only enabled prints count as consumed — and only for days inside the window.
                    // An in-window event is first applied exactly at the iteration whose day equals
                    // the event's own UTC day, so `i` is that day's index.
                    var eventDay = DateOnly.FromDateTime(e.OccurredAt.UtcDateTime);
                    if (e.Kind == SpoolEventKind.Print && eventDay >= startDay)
                        consumedByDay[i] += -e.DeltaGrams;
                }

                // Finished spools contribute 0 from their finish day on (D2); a spool contributes
                // nothing before its creation day (Rule 9 for pre-window finishes).
                var contribution = finished || day < creationDay
                    ? 0
                    : Math.Max(0, running);
                totalByDay[i] += contribution;
            }
        }

        var result = new DailySeriesPoint[days];
        for (var i = 0; i < days; i++)
            result[i] = new DailySeriesPoint(startDay.AddDays(i), consumedByDay[i], totalByDay[i]);
        return result;
    }

    private static int KindRank(SpoolEventKind kind) => kind switch
    {
        SpoolEventKind.Created => 0,
        SpoolEventKind.Opened => 1,
        SpoolEventKind.Print => 2,
        SpoolEventKind.Adjustment => 2,
        SpoolEventKind.Finished => 3,
        _ => 2,
    };
}
