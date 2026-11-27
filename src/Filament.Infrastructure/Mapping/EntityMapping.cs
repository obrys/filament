using Filament.Core.Domain;
using Filament.Infrastructure.Entities;

namespace Filament.Infrastructure.Mapping;

internal static class EntityMapping
{
    public static FilamentType ToDomain(this FilamentTypeEntity e) => new()
    {
        Id = e.Id,
        Brand = e.Brand,
        Material = e.Material,
        Type = e.Type,
        Color = e.Color,
        ColorHex = e.ColorHex,
        DefaultNetWeightGrams = e.DefaultNetWeightGrams,
        EmptySpoolWeightGrams = e.EmptySpoolWeightGrams,
        Notes = e.Notes,
        CreatedAt = e.CreatedAt,
    };

    public static FilamentTypeEntity ToEntity(this FilamentType d) => new()
    {
        Id = d.Id,
        Brand = d.Brand,
        Material = d.Material,
        Type = d.Type,
        Color = d.Color,
        ColorHex = d.ColorHex,
        DefaultNetWeightGrams = d.DefaultNetWeightGrams,
        EmptySpoolWeightGrams = d.EmptySpoolWeightGrams,
        Notes = d.Notes,
        CreatedAt = d.CreatedAt,
    };

    public static void CopyTo(this FilamentType d, FilamentTypeEntity e)
    {
        e.Brand = d.Brand;
        e.Material = d.Material;
        e.Type = d.Type;
        e.Color = d.Color;
        e.ColorHex = d.ColorHex;
        e.DefaultNetWeightGrams = d.DefaultNetWeightGrams;
        e.EmptySpoolWeightGrams = d.EmptySpoolWeightGrams;
        e.Notes = d.Notes;
    }

    public static Spool ToDomain(this SpoolEntity e) => new()
    {
        Id = e.Id,
        FilamentTypeId = e.FilamentTypeId,
        InitialNetGrams = e.InitialNetGrams,
        EmptySpoolWeightGramsOverride = e.EmptySpoolWeightGramsOverride,
        Status = (SpoolStatus)e.Status,
        RemainingGrams = e.RemainingGrams,
        CreatedAt = e.CreatedAt,
        OpenedAt = e.OpenedAt,
        FinishedAt = e.FinishedAt,
        LastUsedAt = e.LastUsedAt,
        Notes = e.Notes,
    };

    public static SpoolEntity ToEntity(this Spool d) => new()
    {
        Id = d.Id,
        FilamentTypeId = d.FilamentTypeId,
        InitialNetGrams = d.InitialNetGrams,
        EmptySpoolWeightGramsOverride = d.EmptySpoolWeightGramsOverride,
        Status = (int)d.Status,
        RemainingGrams = d.RemainingGrams,
        CreatedAt = d.CreatedAt,
        OpenedAt = d.OpenedAt,
        FinishedAt = d.FinishedAt,
        LastUsedAt = d.LastUsedAt,
        Notes = d.Notes,
    };

    public static void CopyTo(this Spool d, SpoolEntity e)
    {
        e.FilamentTypeId = d.FilamentTypeId;
        e.InitialNetGrams = d.InitialNetGrams;
        e.EmptySpoolWeightGramsOverride = d.EmptySpoolWeightGramsOverride;
        e.Status = (int)d.Status;
        e.RemainingGrams = d.RemainingGrams;
        e.OpenedAt = d.OpenedAt;
        e.FinishedAt = d.FinishedAt;
        e.LastUsedAt = d.LastUsedAt;
        e.Notes = d.Notes;
    }

    public static SpoolEvent ToDomain(this SpoolEventEntity e) => new()
    {
        Id = e.Id,
        SpoolId = e.SpoolId,
        Kind = (SpoolEventKind)e.Kind,
        DeltaGrams = e.DeltaGrams,
        ProjectName = e.ProjectName,
        ProjectUrl = e.ProjectUrl,
        Notes = e.Notes,
        IsDisabled = e.IsDisabled,
        ProjectPrintId = e.ProjectPrintId,
        OccurredAt = e.OccurredAt,
    };

    public static SpoolEventEntity ToEntity(this SpoolEvent d) => new()
    {
        SpoolId = d.SpoolId,
        Kind = (int)d.Kind,
        DeltaGrams = d.DeltaGrams,
        ProjectName = d.ProjectName,
        ProjectUrl = d.ProjectUrl,
        Notes = d.Notes,
        IsDisabled = d.IsDisabled,
        ProjectPrintId = d.ProjectPrintId,
        OccurredAt = d.OccurredAt,
    };

    public static PrintProject ToDomain(this PrintProjectEntity e) => new()
    {
        Id = e.Id,
        Title = e.Title,
        Description = e.Description,
        Url = e.Url,
        IsArchived = e.IsArchived,
        ArchivedAt = e.ArchivedAt,
        CreatedAt = e.CreatedAt,
        Types = e.Types.Select(t => t.ToDomain()).ToList(),
        Prints = e.Prints.Select(p => p.ToDomain()).ToList(),
    };

    public static PrintProjectEntity ToEntity(this PrintProject d) => new()
    {
        Id = d.Id,
        Title = d.Title,
        Description = d.Description,
        Url = d.Url,
        IsArchived = d.IsArchived,
        ArchivedAt = d.ArchivedAt,
        CreatedAt = d.CreatedAt,
        Types = d.Types.Select(t => t.ToEntity(d.Id)).ToList(),
        Prints = d.Prints.Select(p => p.ToEntity(d.Id)).ToList(),
    };

    public static PrintProjectType ToDomain(this PrintProjectTypeEntity e) => new()
    {
        FilamentTypeId = e.FilamentTypeId,
        Grams = e.Grams,
    };

    public static PrintProjectTypeEntity ToEntity(this PrintProjectType t, string projectId) => new()
    {
        ProjectId = projectId,
        FilamentTypeId = t.FilamentTypeId,
        Grams = t.Grams,
    };

    public static ProjectPrint ToDomain(this ProjectPrintEntity e) => new()
    {
        Id = e.Id,
        ProjectId = e.ProjectId,
        OccurredAt = e.OccurredAt,
        IsDisabled = e.IsDisabled,
        Events = e.Events.Select(ev => ev.ToDomain()).ToList(),
    };

    public static ProjectPrintEntity ToEntity(this ProjectPrint p, string projectId) => new()
    {
        Id = p.Id,
        ProjectId = projectId,
        OccurredAt = p.OccurredAt,
        IsDisabled = p.IsDisabled,
        Events = p.Events.Select(ev => ev.ToEntity()).ToList(),
    };
}
