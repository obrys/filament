namespace Filament.Core.Domain;

/// <summary>
/// A reusable pattern for a known print: a title, optional description and URL, and one or more
/// filament types with the expected consumption in grams. Printing the project consumes the
/// selected spools and records a <see cref="ProjectPrint"/> that links the created spool events.
/// </summary>
public sealed class PrintProject
{
    public required string Id { get; init; }
    public required string Title { get; set; }
    public string? Description { get; set; }
    public string? Url { get; set; }
    public bool IsArchived { get; set; }
    public DateTimeOffset? ArchivedAt { get; set; }
    public DateTimeOffset CreatedAt { get; init; } = DateTimeOffset.UtcNow;

    public List<PrintProjectType> Types { get; set; } = [];
    public List<ProjectPrint> Prints { get; set; } = [];
}

/// <summary>One line of a project's definition: the filament type and the expected grams.</summary>
public sealed class PrintProjectType
{
    public required string FilamentTypeId { get; set; }
    public int Grams { get; set; }
}

/// <summary>
/// A single use of a print project at a point in time, linked to the spool events it created.
/// Immutable once created — it can only be disabled (undone) and re-enabled (redone).
/// </summary>
public sealed class ProjectPrint
{
    public required string Id { get; init; }
    public required string ProjectId { get; init; }
    public DateTimeOffset OccurredAt { get; init; } = DateTimeOffset.UtcNow;
    public bool IsDisabled { get; set; }

    public List<SpoolEvent> Events { get; set; } = [];
}
