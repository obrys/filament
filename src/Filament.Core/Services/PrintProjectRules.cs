using Filament.Core.Abstractions;
using Filament.Core.Domain;

namespace Filament.Core.Services;

/// <summary>
/// Pure domain rules for print projects: the effective list date, the list ordering, definition
/// validation, the archive/delete guards, and the planning of a project print (one print event per
/// slot, built on <see cref="SpoolLifecycle.PlanConsume"/>, plus an explicit Open event for every
/// spool that is still sealed).
/// </summary>
public static class PrintProjectRules
{
    public const int MaxTitleLength = 256;
    public const int MaxDescriptionLength = 1024;
    public const int MaxUrlLength = 1024;

    /// <summary>
    /// The date a project sorts by: its archived date when archived, else the newest enabled
    /// project print, else its creation date. Undone prints do not count.
    /// </summary>
    public static DateTimeOffset EffectiveDate(PrintProject project)
    {
        ArgumentNullException.ThrowIfNull(project);
        if (project.ArchivedAt is { } archived) return archived;
        var enabledPrints = project.Prints.Where(p => !p.IsDisabled).Select(p => p.OccurredAt).ToList();
        return enabledPrints.Count > 0 ? enabledPrints.Max() : project.CreatedAt;
    }

    /// <summary>
    /// List order: newest effective date first; ties break by title A–Z (ordinal), then project id.
    /// </summary>
    public static int Compare(PrintProject a, PrintProject b)
    {
        ArgumentNullException.ThrowIfNull(a);
        ArgumentNullException.ThrowIfNull(b);
        var cmp = EffectiveDate(b).CompareTo(EffectiveDate(a));
        if (cmp != 0) return cmp;
        cmp = string.CompareOrdinal(a.Title, b.Title);
        if (cmp != 0) return cmp;
        return string.CompareOrdinal(a.Id, b.Id);
    }

    /// <summary>
    /// Validates a project definition (create or update). Throws
    /// <see cref="InvalidOperationException"/>/<see cref="ArgumentOutOfRangeException"/> with a
    /// user-presentable message on the first violation.
    /// </summary>
    public static void ValidateDefinition(
        string? title, string? description, string? url, IReadOnlyList<PrintProjectType> types)
    {
        ArgumentNullException.ThrowIfNull(types);
        if (string.IsNullOrWhiteSpace(title))
            throw new InvalidOperationException("Title is required.");
        if (title.Length > MaxTitleLength)
            throw new ArgumentOutOfRangeException(nameof(title), $"Title must be at most {MaxTitleLength} characters.");
        if (description is not null && description.Length > MaxDescriptionLength)
            throw new ArgumentOutOfRangeException(nameof(description), $"Description must be at most {MaxDescriptionLength} characters.");
        if (url is not null && url.Length > MaxUrlLength)
            throw new ArgumentOutOfRangeException(nameof(url), $"URL must be at most {MaxUrlLength} characters.");
        if (types.Count == 0)
            throw new InvalidOperationException("A print project needs at least one filament type.");
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var line in types)
        {
            if (string.IsNullOrWhiteSpace(line.FilamentTypeId))
                throw new InvalidOperationException("Every line needs a filament type.");
            if (!seen.Add(line.FilamentTypeId))
                throw new InvalidOperationException($"Filament type '{line.FilamentTypeId}' is defined more than once.");
            if (line.Grams < 1)
                throw new InvalidOperationException($"Grams for type '{line.FilamentTypeId}' must be a positive whole number.");
        }
    }

    /// <summary>Archived projects are read-only except for unarchiving. <paramref name="action"/> is a verb phrase like "printed".</summary>
    public static void EnsureNotArchived(PrintProject project, string action)
    {
        ArgumentNullException.ThrowIfNull(project);
        if (project.IsArchived)
            throw new InvalidOperationException($"An archived project cannot be {action} — unarchive it first.");
    }

    /// <summary>A project is deletable only when archived and without any enabled print.</summary>
    public static void EnsureDeletable(PrintProject project, IReadOnlyList<ProjectPrint> prints)
    {
        ArgumentNullException.ThrowIfNull(project);
        ArgumentNullException.ThrowIfNull(prints);
        if (!project.IsArchived)
            throw new InvalidOperationException("Only an archived project can be deleted.");
        if (prints.Any(p => !p.IsDisabled))
            throw new InvalidOperationException("Undo every project print before deleting the project.");
    }

    /// <summary>
    /// Validates the shape of a print selection (independent of spool state): one slot per defined
    /// type, a spool in every slot, at least 1 g per slot.
    /// </summary>
    public static void ValidateSelection(PrintProject project, IReadOnlyList<PrintSelection> selection)
    {
        ArgumentNullException.ThrowIfNull(project);
        ArgumentNullException.ThrowIfNull(selection);
        if (selection.Count != project.Types.Count)
            throw new InvalidOperationException(
                "Every defined filament type needs exactly one spool in the print selection.");
        if (selection.Any(s => string.IsNullOrWhiteSpace(s.SpoolId)))
            throw new InvalidOperationException("Give a spool to every filament type before printing.");
        if (selection.Any(s => s.Grams < 1))
            throw new InvalidOperationException("Every spool in the print must get at least 1 g.");
    }

    /// <summary>
    /// Plans a project print: one <c>Print</c> event per slot (a spool used by several slots gets
    /// one event per slot), plus an explicit, independent <c>Opened</c> event for every spool that
    /// is still sealed (so the opening is an ordinary spool event that survives undo/redo of the
    /// print and can be undone on its own). Every pre-defined type must be backed by a slot (no
    /// skipping); the grams summed per spool must fit its remaining balance; finished spools are
    /// rejected. All validation happens before any plan is returned, so a violation changes nothing.
    /// </summary>
    public static ProjectPrintPlan PlanPrint(
        PrintProject project,
        IReadOnlyList<PrintSelection> selection,
        IReadOnlyList<SpoolWithEvents> spools,
        DateTimeOffset occurredAt)
    {
        ArgumentNullException.ThrowIfNull(project);
        ArgumentNullException.ThrowIfNull(selection);
        ArgumentNullException.ThrowIfNull(spools);

        EnsureNotArchived(project, "printed");
        ValidateSelection(project, selection);

        var spoolById = spools.ToDictionary(s => s.Spool.Id, StringComparer.Ordinal);
        var openEvents = new List<SpoolEvent>();
        var printEvents = new List<SpoolEvent>(selection.Count);

        // Spool by spool, in first-appearance order; each slot is planned against the history
        // extended with the events already planned for the same spool, so the per-spool total is
        // checked against its remaining balance.
        foreach (var spoolId in selection.Select(s => s.SpoolId).Distinct(StringComparer.Ordinal))
        {
            if (!spoolById.TryGetValue(spoolId, out var context))
                throw new InvalidOperationException($"Spool '{spoolId}' not found.");

            var working = context.Events.ToList();
            var state = SpoolLifecycle.Evaluate(context.Spool.InitialNetGrams, working);
            if (state.Status == SpoolStatus.Finished)
                throw new InvalidOperationException("Spool is already finished.");
            if (state.Status == SpoolStatus.Sealed)
            {
                var open = new SpoolEvent
                {
                    SpoolId = spoolId,
                    Kind = SpoolEventKind.Opened,
                    DeltaGrams = 0,
                    OccurredAt = occurredAt,
                };
                openEvents.Add(open);
                working.Add(open);
            }

            foreach (var slot in selection.Where(s => string.Equals(s.SpoolId, spoolId, StringComparison.Ordinal)))
            {
                var plan = SpoolLifecycle.PlanConsume(
                    spoolId,
                    context.Spool.InitialNetGrams,
                    working,
                    slot.Grams,
                    projectName: project.Title,
                    projectUrl: project.Url,
                    at: occurredAt);
                working.Add(plan.EventToAdd!);
                printEvents.Add(plan.EventToAdd!);
            }
        }
        return new ProjectPrintPlan(openEvents, printEvents);
    }
}

/// <summary>The spool events a project print creates: independent Open events and the linked Print events.</summary>
public sealed record ProjectPrintPlan(
    IReadOnlyList<SpoolEvent> OpenEvents,
    IReadOnlyList<SpoolEvent> PrintEvents);
