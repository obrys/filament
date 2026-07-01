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

    public DateTimeOffset OccurredAt { get; set; }
}
