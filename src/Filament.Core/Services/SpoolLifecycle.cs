using Filament.Core.Domain;

namespace Filament.Core.Services;

/// <summary>
/// A single, indivisible change to a spool's event history. Exactly one of the three
/// operations is populated. Applying it (in the repository) is followed by a full re-evaluation
/// so the spool's cached <see cref="Spool.Status"/>/<see cref="Spool.RemainingGrams"/> stay correct.
/// </summary>
public sealed record LifecyclePlan(
    SpoolEvent? EventToAdd = null,
    long? EventToEnable = null,
    long? EventToDisable = null);

/// <summary>The recomputed lifecycle state of a spool, derived purely from its enabled events.</summary>
public sealed record SpoolState(
    SpoolStatus Status,
    int RemainingGrams,
    DateTimeOffset? OpenedAt,
    DateTimeOffset? FinishedAt,
    DateTimeOffset LastUsedAt);

/// <summary>
/// The spool state machine. State is derived exclusively from the <b>enabled</b> events; weight is
/// only a property and never drives state. Nothing auto-finishes — dropping to (or below) zero is
/// allowed and merely promotes the manual Finish action in the UI.
///
/// Lifecycle:
///   Sealed  -> Open      via Open (or re-enabling the original Open event)
///   Open    -> Sealed    via undoing (disabling) the Open event (only when no active work remains)
///   Open    -> Finished  via Finish (delta 0, pure marker)
///   Finished-> Open      via undoing (disabling) the Finish event
///   Open supports Print / Adjustment and their undo/redo.
/// </summary>
public static class SpoolLifecycle
{
    // Tie-break rank for events sharing an OccurredAt. Guarantees Open sorts before a Print that
    // legacy data may have stamped at the exact same instant (old auto-open behaviour).
    private static int KindRank(SpoolEventKind kind) => kind switch
    {
        SpoolEventKind.Created => 0,
        SpoolEventKind.Opened => 1,
        SpoolEventKind.Print => 2,
        SpoolEventKind.Adjustment => 2,
        SpoolEventKind.Finished => 3,
        _ => 2,
    };

    private static IEnumerable<SpoolEvent> OrderedEnabled(IEnumerable<SpoolEvent> events) =>
        events.Where(e => !e.IsDisabled)
              .OrderBy(e => e.OccurredAt)
              .ThenBy(e => KindRank(e.Kind))
              .ThenBy(e => e.Id);

    /// <summary>
    /// Derives a spool's state from its events. Disabled events are ignored entirely.
    /// </summary>
    public static SpoolState Evaluate(int initialNetGrams, IEnumerable<SpoolEvent> events)
    {
        ArgumentNullException.ThrowIfNull(events);

        var status = SpoolStatus.Sealed;
        DateTimeOffset? openedAt = null;
        DateTimeOffset? finishedAt = null;
        var remaining = initialNetGrams;
        // The most recent enabled event's OccurredAt, in the canonical chronological order applied
        // by OrderedEnabled below. Because every spool has an immutable enabled Created event, the
        // loop always yields at least one event, so this ends non-null — a Created-only spool reports
        // its Created event's OccurredAt as lastUsedAt.
        DateTimeOffset? lastUsedAt = null;

        foreach (var e in OrderedEnabled(events))
        {
            lastUsedAt = e.OccurredAt;
            remaining += e.DeltaGrams;
            switch (e.Kind)
            {
                case SpoolEventKind.Opened:
                    if (status == SpoolStatus.Sealed)
                    {
                        status = SpoolStatus.Open;
                        openedAt = e.OccurredAt;
                    }
                    break;
                case SpoolEventKind.Print:
                case SpoolEventKind.Adjustment:
                    // A print/adjustment implies the spool is open (covers legacy data with no
                    // explicit Open event; the migration backfills one, but stay defensive).
                    if (status == SpoolStatus.Sealed)
                    {
                        status = SpoolStatus.Open;
                        openedAt = e.OccurredAt;
                    }
                    break;
                case SpoolEventKind.Finished:
                    status = SpoolStatus.Finished;
                    finishedAt = e.OccurredAt;
                    break;
                case SpoolEventKind.Created:
                    break;
            }
        }

        if (status != SpoolStatus.Finished) finishedAt = null;
        if (status == SpoolStatus.Sealed) openedAt = null;

        return new SpoolState(status, remaining, openedAt, finishedAt, lastUsedAt ?? DateTimeOffset.UtcNow);
    }

    /// <summary>
    /// Remaining grams *after* each event, keyed by event id, folded over enabled events only in
    /// evaluation order. Disabled events map to <c>null</c> (they contribute nothing).
    /// </summary>
    public static IReadOnlyDictionary<long, int?> RunningRemaining(
        int initialNetGrams, IEnumerable<SpoolEvent> events)
    {
        ArgumentNullException.ThrowIfNull(events);
        var result = new Dictionary<long, int?>();
        foreach (var e in events)
            result[e.Id] = null;

        var running = initialNetGrams;
        foreach (var e in OrderedEnabled(events))
        {
            running += e.DeltaGrams;
            result[e.Id] = running;
        }
        return result;
    }

    // ----- Action planning (validated against the current derived state) -----

    /// <summary>Opens a sealed spool, re-enabling the original Open event if one was undone.</summary>
    public static LifecyclePlan PlanOpen(
        string spoolId, int initialNetGrams, IEnumerable<SpoolEvent> events, DateTimeOffset? at = null)
    {
        var list = Materialize(events);
        var state = Evaluate(initialNetGrams, list);
        if (state.Status != SpoolStatus.Sealed)
            throw new InvalidOperationException("Only a sealed spool can be opened.");

        // Re-open by re-enabling the most recent previously-undone Open event, if any.
        var disabledOpen = list.Where(e => e.Kind == SpoolEventKind.Opened && e.IsDisabled)
                               .OrderByDescending(e => e.Id)
                               .FirstOrDefault();
        if (disabledOpen is not null)
            return new LifecyclePlan(EventToEnable: disabledOpen.Id);

        return new LifecyclePlan(EventToAdd: new SpoolEvent
        {
            SpoolId = spoolId,
            Kind = SpoolEventKind.Opened,
            DeltaGrams = 0,
            OccurredAt = at ?? DateTimeOffset.UtcNow,
        });
    }

    /// <summary>Records a print (consumption). Requires the spool to be open.</summary>
    public static LifecyclePlan PlanConsume(
        string spoolId,
        int initialNetGrams,
        IEnumerable<SpoolEvent> events,
        int grams,
        string? projectName = null,
        string? projectUrl = null,
        string? notes = null,
        DateTimeOffset? at = null)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(grams);
        var list = Materialize(events);
        var state = Evaluate(initialNetGrams, list);
        RequireOpen(state.Status);
        if (grams > state.RemainingGrams)
            throw new InvalidOperationException(
                $"Cannot consume {grams}g — only {state.RemainingGrams}g remaining.");

        return new LifecyclePlan(EventToAdd: new SpoolEvent
        {
            SpoolId = spoolId,
            Kind = SpoolEventKind.Print,
            DeltaGrams = -grams,
            ProjectName = projectName,
            ProjectUrl = projectUrl,
            Notes = notes,
            OccurredAt = at ?? DateTimeOffset.UtcNow,
        });
    }

    /// <summary>Adjusts the remaining weight to an exact value. Requires the spool to be open.</summary>
    public static LifecyclePlan PlanAdjust(
        string spoolId,
        int initialNetGrams,
        IEnumerable<SpoolEvent> events,
        int newRemainingGrams,
        string? notes = null,
        DateTimeOffset? at = null)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(newRemainingGrams);
        var list = Materialize(events);
        var state = Evaluate(initialNetGrams, list);
        RequireOpen(state.Status);

        return new LifecyclePlan(EventToAdd: new SpoolEvent
        {
            SpoolId = spoolId,
            Kind = SpoolEventKind.Adjustment,
            DeltaGrams = newRemainingGrams - state.RemainingGrams,
            Notes = notes,
            OccurredAt = at ?? DateTimeOffset.UtcNow,
        });
    }

    /// <summary>Finishes an open spool — a pure state marker with a zero delta.</summary>
    public static LifecyclePlan PlanFinish(
        string spoolId, int initialNetGrams, IEnumerable<SpoolEvent> events, DateTimeOffset? at = null)
    {
        var list = Materialize(events);
        var state = Evaluate(initialNetGrams, list);
        if (state.Status != SpoolStatus.Open)
            throw new InvalidOperationException("Only an open spool can be finished.");

        var disabledFinish = list.Where(e => e.Kind == SpoolEventKind.Finished && e.IsDisabled)
                                 .OrderByDescending(e => e.Id)
                                 .FirstOrDefault();
        if (disabledFinish is not null)
            return new LifecyclePlan(EventToEnable: disabledFinish.Id);

        return new LifecyclePlan(EventToAdd: new SpoolEvent
        {
            SpoolId = spoolId,
            Kind = SpoolEventKind.Finished,
            DeltaGrams = 0,
            OccurredAt = at ?? DateTimeOffset.UtcNow,
        });
    }

    /// <summary>
    /// Enables or disables a single existing event (redo/undo), enforcing the workflow guards.
    /// </summary>
    public static LifecyclePlan PlanSetEnabled(IEnumerable<SpoolEvent> events, long eventId, bool enabled)
    {
        var list = Materialize(events);
        var target = list.FirstOrDefault(e => e.Id == eventId)
            ?? throw new InvalidOperationException("Event not found.");

        if (target.Kind == SpoolEventKind.Created)
            throw new InvalidOperationException("The creation event cannot be undone.");

        if (enabled)
        {
            if (!target.IsDisabled)
                throw new InvalidOperationException("Event is already active.");

            // A print/adjustment/finish only makes sense on an opened spool.
            if (target.Kind is SpoolEventKind.Print or SpoolEventKind.Adjustment or SpoolEventKind.Finished)
            {
                var hasOpen = list.Any(e => !e.IsDisabled && e.Kind == SpoolEventKind.Opened);
                if (!hasOpen)
                    throw new InvalidOperationException(
                        "Open the spool before re-enabling prints, adjustments or the finish.");
            }
            return new LifecyclePlan(EventToEnable: eventId);
        }
        else
        {
            if (target.IsDisabled)
                throw new InvalidOperationException("Event is already undone.");

            // Undoing Open would orphan any active work — block it until that work is undone first.
            if (target.Kind == SpoolEventKind.Opened)
            {
                var hasActiveWork = list.Any(e => !e.IsDisabled && e.Id != eventId &&
                    e.Kind is SpoolEventKind.Print or SpoolEventKind.Adjustment or SpoolEventKind.Finished);
                if (hasActiveWork)
                    throw new InvalidOperationException(
                        "Undo the prints, adjustments and finish before undoing Open.");
            }
            return new LifecyclePlan(EventToDisable: eventId);
        }
    }

    private static void RequireOpen(SpoolStatus status)
    {
        switch (status)
        {
            case SpoolStatus.Sealed:
                throw new InvalidOperationException("Open the spool first.");
            case SpoolStatus.Finished:
                throw new InvalidOperationException("Spool is already finished.");
        }
    }

    private static List<SpoolEvent> Materialize(IEnumerable<SpoolEvent> events)
    {
        ArgumentNullException.ThrowIfNull(events);
        return events as List<SpoolEvent> ?? events.ToList();
    }
}
