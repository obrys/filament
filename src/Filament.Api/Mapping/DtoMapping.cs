using Filament.Api.Dtos;
using Filament.Core.Domain;
using Filament.Core.Faceting;
using Filament.Core.Services;

namespace Filament.Api.Mapping;

internal static class DtoMapping
{
    public static FilamentTypeDto ToDto(this FilamentType d) => new(
        d.Id, d.Brand, d.Material, d.Type, d.Color, d.ColorHex,
        d.DefaultNetWeightGrams, d.EmptySpoolWeightGrams, d.Notes, d.CreatedAt);

    public static SpoolDto ToDto(this Spool s, FilamentType type)
    {
        var empty = SpoolWeightService.EffectiveEmptySpoolGrams(s, type);
        return new SpoolDto(
            s.Id, s.FilamentTypeId, s.RemainingGrams, s.InitialNetGrams,
            s.EmptySpoolWeightGramsOverride, empty,
            s.RemainingGrams + empty,
            s.Status.ToString(),
            s.CreatedAt, s.OpenedAt, s.FinishedAt, s.LastUsedAt, s.Notes);
    }

    public static SpoolEventDto ToDto(this SpoolEvent e, int? remainingAfterGrams, string? projectId = null) => new(
        e.Id, e.SpoolId, e.Kind.ToString(), e.DeltaGrams, remainingAfterGrams, e.IsDisabled,
        e.ProjectPrintId, projectId, e.ProjectName, e.ProjectUrl, e.Notes, e.OccurredAt);

    public static FacetsDto ToDto(this Facets f) => new(
        f.Brand.Select(ToDto).ToList(),
        f.Material.Select(ToDto).ToList(),
        f.Type.Select(ToDto).ToList(),
        f.Color.Select(ToDto).ToList());

    private static FacetOptionDto ToDto(FacetOption o) => new(o.Value, o.Count);

    // --- Print projects ---

    public static PrintProjectTypeDto ToDto(this PrintProjectType t, FilamentType type) => new(
        t.FilamentTypeId, type.Brand, type.Material, type.Type, type.Color, type.ColorHex, t.Grams);

    public static ProjectPrintEventDto ToDto(this SpoolEvent e, FilamentType? spoolType) => new(
        e.Id, e.SpoolId, -e.DeltaGrams,
        spoolType?.Brand, spoolType?.Material, spoolType?.Type, spoolType?.Color, spoolType?.ColorHex);

    public static ProjectPrintDto ToDto(this ProjectPrint p, Func<string, FilamentType?> spoolTypeOf) => new(
        p.Id, p.OccurredAt, p.IsDisabled,
        p.Events
            .OrderBy(e => e.OccurredAt)
            .ThenBy(e => e.Id)
            .Select(e => e.ToDto(spoolTypeOf(e.SpoolId)))
            .ToList());

    public static PrintProjectDto ToDto(
        this PrintProject p, Func<string, FilamentType?> typeOf, bool includePrints,
        Func<string, FilamentType?>? spoolTypeOf = null)
    {
        spoolTypeOf ??= _ => null;
        return new PrintProjectDto(
            p.Id, p.Title, p.Description, p.Url, p.IsArchived, p.ArchivedAt, p.CreatedAt,
            PrintProjectRules.EffectiveDate(p),
            p.Prints.Any(x => !x.IsDisabled),
            p.Types.Select(t => t.ToDto(typeOf(t.FilamentTypeId))).ToList(),
            includePrints
                ? p.Prints
                    .OrderByDescending(pr => pr.OccurredAt)
                    .ThenByDescending(pr => pr.Id)
                    .Select(pr => pr.ToDto(spoolTypeOf))
                    .ToList()
                : null);
    }
}
