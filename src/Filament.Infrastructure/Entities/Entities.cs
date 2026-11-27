namespace Filament.Infrastructure.Entities;

internal sealed class FilamentTypeEntity
{
    public string Id { get; set; } = default!;
    public string Brand { get; set; } = default!;
    public string Material { get; set; } = default!;
    public string Type { get; set; } = default!;
    public string Color { get; set; } = default!;
    public string? ColorHex { get; set; }
    public int DefaultNetWeightGrams { get; set; }
    public int EmptySpoolWeightGrams { get; set; }
    public string? Notes { get; set; }
    public DateTimeOffset CreatedAt { get; set; }

    public List<SpoolEntity> Spools { get; set; } = new();
}

internal sealed class SpoolEntity
{
    public string Id { get; set; } = default!;
    public string FilamentTypeId { get; set; } = default!;
    public FilamentTypeEntity? FilamentType { get; set; }

    public int InitialNetGrams { get; set; }
    public int? EmptySpoolWeightGramsOverride { get; set; }
    public int Status { get; set; }

    /// <summary>Cached remaining grams, recomputed from enabled events on every change.</summary>
    public int RemainingGrams { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? OpenedAt { get; set; }
    public DateTimeOffset? FinishedAt { get; set; }

    /// <summary>Cached lastUsedAt, recomputed from enabled events on every change. Sort key for the spool list.</summary>
    public DateTimeOffset? LastUsedAt { get; set; }

    public string? Notes { get; set; }

    public List<SpoolEventEntity> Events { get; set; } = new();
}

internal sealed class SpoolEventEntity
{
    public long Id { get; set; }
    public string SpoolId { get; set; } = default!;
    public SpoolEntity? Spool { get; set; }
    public int Kind { get; set; }
    public int DeltaGrams { get; set; }
    public string? ProjectName { get; set; }
    public string? ProjectUrl { get; set; }
    public string? Notes { get; set; }

    /// <summary>When true the event is undone: shown struck-through but excluded from derivations.</summary>
    public bool IsDisabled { get; set; }

    /// <summary>Set when the event was created by printing a print project (see ProjectPrintEntity).</summary>
    public string? ProjectPrintId { get; set; }
    public ProjectPrintEntity? ProjectPrint { get; set; }

    public DateTimeOffset OccurredAt { get; set; }
}

internal sealed class PrintProjectEntity
{
    public string Id { get; set; } = default!;
    public string Title { get; set; } = default!;
    public string? Description { get; set; }
    public string? Url { get; set; }
    public bool IsArchived { get; set; }
    public DateTimeOffset? ArchivedAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }

    public List<PrintProjectTypeEntity> Types { get; set; } = new();
    public List<ProjectPrintEntity> Prints { get; set; } = new();
}

internal sealed class PrintProjectTypeEntity
{
    public long Id { get; set; }
    public string ProjectId { get; set; } = default!;
    public PrintProjectEntity? Project { get; set; }
    public string FilamentTypeId { get; set; } = default!;
    public FilamentTypeEntity? FilamentType { get; set; }
    public int Grams { get; set; }
}

internal sealed class ProjectPrintEntity
{
    public string Id { get; set; } = default!;
    public string ProjectId { get; set; } = default!;
    public PrintProjectEntity? Project { get; set; }
    public DateTimeOffset OccurredAt { get; set; }
    public bool IsDisabled { get; set; }

    public List<SpoolEventEntity> Events { get; set; } = new();
}
