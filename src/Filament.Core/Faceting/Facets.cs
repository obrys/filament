namespace Filament.Core.Faceting;

/// <summary>
/// The four facetable attributes shared by filament types and spools. For a spool these
/// are taken from its filament type.
/// </summary>
public sealed record FacetAttributes(string Brand, string Material, string Type, string Color);

/// <summary>
/// A single value within a facet together with how many items would be listed if it were
/// selected (given the other active facets).
/// </summary>
public sealed record FacetOption(string Value, int Count);

/// <summary>
/// The user's current selection per facet. An empty set means "no constraint" for that
/// facet. Within a facet the selected values are OR-ed; across facets they are AND-ed.
/// Matching is case-sensitive (ordinal) so "red" and "Red" are distinct.
/// </summary>
public sealed record FacetSelection(
    IReadOnlySet<string> Brands,
    IReadOnlySet<string> Materials,
    IReadOnlySet<string> Types,
    IReadOnlySet<string> Colors)
{
    public static FacetSelection Empty { get; } = new(
        new HashSet<string>(StringComparer.Ordinal),
        new HashSet<string>(StringComparer.Ordinal),
        new HashSet<string>(StringComparer.Ordinal),
        new HashSet<string>(StringComparer.Ordinal));

    public static FacetSelection From(
        IEnumerable<string>? brands,
        IEnumerable<string>? materials,
        IEnumerable<string>? types,
        IEnumerable<string>? colors) => new(
            new HashSet<string>(brands ?? [], StringComparer.Ordinal),
            new HashSet<string>(materials ?? [], StringComparer.Ordinal),
            new HashSet<string>(types ?? [], StringComparer.Ordinal),
            new HashSet<string>(colors ?? [], StringComparer.Ordinal));

    public bool IsEmpty =>
        Brands.Count == 0 && Materials.Count == 0 && Types.Count == 0 && Colors.Count == 0;
}

/// <summary>The computed options for every facet, each already sorted for display.</summary>
public sealed record Facets(
    IReadOnlyList<FacetOption> Brand,
    IReadOnlyList<FacetOption> Material,
    IReadOnlyList<FacetOption> Type,
    IReadOnlyList<FacetOption> Color);

/// <summary>The filtered items plus the facet breakdown computed from the whole universe.</summary>
public sealed record FacetResult<T>(IReadOnlyList<T> Items, Facets Facets);
