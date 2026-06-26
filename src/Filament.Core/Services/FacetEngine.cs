using Filament.Core.Faceting;

namespace Filament.Core.Services;

/// <summary>
/// Pure faceted-filtering logic shared by filament types and spools.
///
/// Semantics (standard faceted search):
///  - The filtered result keeps items that match every facet that has a selection. Within a
///    facet the selected values are OR-ed; across facets they are AND-ed.
///  - Each facet's option counts are computed while ignoring that facet's own selection, so a
///    user can see how many items each value would yield (this is what makes multi-select
///    within a facet meaningful). The other facets' selections are applied.
///  - Every distinct value present anywhere in the universe is listed, even if its count is 0
///    under the current selection, so the user can always broaden.
///  - Options are sorted by count descending, then value ascending; zero-count values fall to
///    the bottom naturally.
/// </summary>
public static class FacetEngine
{
    public static FacetResult<T> Apply<T>(
        IReadOnlyList<T> items,
        Func<T, FacetAttributes> selector,
        FacetSelection selection)
    {
        var rows = new List<(T Item, FacetAttributes A)>(items.Count);
        foreach (var item in items)
            rows.Add((item, selector(item)));

        var filtered = new List<T>();
        foreach (var row in rows)
            if (Matches(row.A, selection))
                filtered.Add(row.Item);

        var facets = new Facets(
            BuildFacet(rows, a => a.Brand, selection, FacetField.Brand),
            BuildFacet(rows, a => a.Material, selection, FacetField.Material),
            BuildFacet(rows, a => a.Type, selection, FacetField.Type),
            BuildFacet(rows, a => a.Color, selection, FacetField.Color));

        return new FacetResult<T>(filtered, facets);
    }

    private enum FacetField { Brand, Material, Type, Color }

    private static bool Matches(FacetAttributes a, FacetSelection s) =>
        (s.Brands.Count == 0 || s.Brands.Contains(a.Brand)) &&
        (s.Materials.Count == 0 || s.Materials.Contains(a.Material)) &&
        (s.Types.Count == 0 || s.Types.Contains(a.Type)) &&
        (s.Colors.Count == 0 || s.Colors.Contains(a.Color));

    private static List<FacetOption> BuildFacet<T>(
        IReadOnlyList<(T Item, FacetAttributes A)> rows,
        Func<FacetAttributes, string> field,
        FacetSelection selection,
        FacetField self)
    {
        // Count under all OTHER facets' selections; ignore this facet's own selection.
        var counts = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var row in rows)
        {
            var value = field(row.A);
            // Ensure every universe value is represented, even with a zero count.
            counts.TryAdd(value, 0);
            if (MatchesExcept(row.A, selection, self))
                counts[value]++;
        }

        return counts
            .Select(kv => new FacetOption(kv.Key, kv.Value))
            .OrderByDescending(o => o.Count)
            .ThenBy(o => o.Value, StringComparer.Ordinal)
            .ToList();
    }

    private static bool MatchesExcept(FacetAttributes a, FacetSelection s, FacetField except) =>
        (except == FacetField.Brand || s.Brands.Count == 0 || s.Brands.Contains(a.Brand)) &&
        (except == FacetField.Material || s.Materials.Count == 0 || s.Materials.Contains(a.Material)) &&
        (except == FacetField.Type || s.Types.Count == 0 || s.Types.Contains(a.Type)) &&
        (except == FacetField.Color || s.Colors.Count == 0 || s.Colors.Contains(a.Color));
}
