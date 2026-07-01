namespace Filament.Api.Dtos;

public sealed record FilamentTypeDto(
    string Id,
    string Brand,
    string Material,
    string Type,
    string Color,
    string? ColorHex,
    int DefaultNetWeightGrams,
    int EmptySpoolWeightGrams,
    string? Notes,
    DateTimeOffset CreatedAt);

public sealed record CreateFilamentTypeDto(
    string Brand,
    string Material,
    string Type,
    string Color,
    string? ColorHex,
    int DefaultNetWeightGrams,
    int EmptySpoolWeightGrams,
    string? Notes);

public sealed record UpdateFilamentTypeDto(
    string Brand,
    string Material,
    string Type,
    string Color,
    string? ColorHex,
    int DefaultNetWeightGrams,
    int EmptySpoolWeightGrams,
    string? Notes);

public sealed record SpoolDto(
    string Id,
    string FilamentTypeId,
    int RemainingGrams,
    int InitialNetGrams,
    int? EmptySpoolWeightGramsOverride,
    int EffectiveEmptySpoolGrams,
    int TotalWeightGrams,
    string Status,
    DateTimeOffset CreatedAt,
    DateTimeOffset? OpenedAt,
    DateTimeOffset? FinishedAt,
    string? Notes);

public sealed record CreateSpoolDto(
    string FilamentTypeId,
    int? InitialNetGrams,
    int? EmptySpoolWeightGramsOverride,
    string? Notes);

public sealed record ConsumeSpoolDto(
    int Grams,
    string? ProjectName,
    string? ProjectUrl,
    string? Notes);

public sealed record AdjustSpoolDto(int NewRemainingGrams, string? Notes);

public sealed record SpoolEventDto(
    long Id,
    string SpoolId,
    string Kind,
    int DeltaGrams,
    int? RemainingAfterGrams,
    bool IsDisabled,
    string? ProjectName,
    string? ProjectUrl,
    string? Notes,
    DateTimeOffset OccurredAt);

/// <summary>A single spool's before/after state from a re-evaluation run.</summary>
public sealed record SpoolReevalDiffDto(
    string SpoolId,
    string OldStatus,
    string NewStatus,
    int OldRemainingGrams,
    int NewRemainingGrams);

/// <summary>Summary of a manual re-evaluation: totals plus every spool that changed.</summary>
public sealed record ReevaluateResultDto(
    int TotalSpools,
    int ChangedSpools,
    IReadOnlyList<SpoolReevalDiffDto> Differences);

public sealed record DashboardSummaryDto(
    int FilamentTypeCount,
    int ActiveSpoolCount,
    int FinishedSpoolCount,
    int TotalRemainingGrams);

public sealed record DailyUsageDto(DateOnly Day, int ConsumedGrams);

// --- Faceted filtering ---

/// <summary>A facet value plus how many items it would yield under the other active facets.</summary>
public sealed record FacetOptionDto(string Value, int Count);

/// <summary>The option breakdown for all four shared facets.</summary>
public sealed record FacetsDto(
    IReadOnlyList<FacetOptionDto> Brand,
    IReadOnlyList<FacetOptionDto> Material,
    IReadOnlyList<FacetOptionDto> Type,
    IReadOnlyList<FacetOptionDto> Color);

/// <summary>Filtered filament types together with their facet breakdown.</summary>
public sealed record FilamentTypeListDto(IReadOnlyList<FilamentTypeDto> Items, FacetsDto Facets);

/// <summary>Filtered spools together with their facet breakdown.</summary>
public sealed record SpoolListDto(IReadOnlyList<SpoolDto> Items, FacetsDto Facets);
