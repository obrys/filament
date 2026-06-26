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
            s.CreatedAt, s.OpenedAt, s.FinishedAt, s.Notes);
    }

    public static SpoolEventDto ToDto(this SpoolEvent e, int remainingAfterGrams) => new(
        e.Id, e.SpoolId, e.Kind.ToString(), e.DeltaGrams, remainingAfterGrams,
        e.ProjectName, e.ProjectUrl, e.Notes, e.OccurredAt);

    public static FacetsDto ToDto(this Facets f) => new(
        f.Brand.Select(ToDto).ToList(),
        f.Material.Select(ToDto).ToList(),
        f.Type.Select(ToDto).ToList(),
        f.Color.Select(ToDto).ToList());

    private static FacetOptionDto ToDto(FacetOption o) => new(o.Value, o.Count);
}
