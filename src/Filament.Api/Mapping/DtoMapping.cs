using Filament.Api.Dtos;
using Filament.Core.Domain;
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

    public static SpoolEventDto ToDto(this SpoolEvent e) => new(
        e.Id, e.SpoolId, e.Kind.ToString(), e.DeltaGrams, e.RemainingAfterGrams,
        e.ProjectName, e.ProjectUrl, e.Notes, e.OccurredAt);
}
