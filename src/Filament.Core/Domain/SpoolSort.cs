namespace Filament.Core.Domain;

/// <summary>
/// The sort key applied to the spool list. Direction is implied by the key: <see cref="LastUsed"/>
/// and <see cref="MostRemaining"/> sort descending, <see cref="LeastRemaining"/> sorts ascending.
/// A fixed secondary order (<see cref="LastUsed"/> desc, then spool id asc) is applied by the
/// repository so identical primary keys produce stable results.
/// </summary>
public enum SpoolSort
{
    /// <summary>Most recent <c>lastUsedAt</c> first (descending). The default.</summary>
    LastUsed = 0,

    /// <summary>Smallest <c>remaining_grams</c> first (ascending).</summary>
    LeastRemaining = 1,

    /// <summary>Largest <c>remaining_grams</c> first (descending).</summary>
    MostRemaining = 2,
}

/// <summary>
/// Parses the <c>sort</c> query parameter of <c>GET /api/spools</c>. Only the exact lowercase
/// values <c>lastUsed</c>, <c>leastRemaining</c>, <c>mostRemaining</c> are recognized; any other
/// value (including <c>null</c> and the empty string) resolves to <see cref="SpoolSort.LastUsed"/>.
/// Matching is case-sensitive by design.
/// </summary>
public static class SpoolSortParser
{
    public static SpoolSort Parse(string? raw) => raw switch
    {
        "lastUsed" => SpoolSort.LastUsed,
        "leastRemaining" => SpoolSort.LeastRemaining,
        "mostRemaining" => SpoolSort.MostRemaining,
        _ => SpoolSort.LastUsed,
    };
}
