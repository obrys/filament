namespace Filament.Core.Domain;

/// <summary>
/// A category of filament identified by brand, material, type, color and spool weight.
/// </summary>
public sealed class FilamentType
{
    public required string Id { get; init; }
    public required string Brand { get; set; }
    public required string Material { get; set; }
    public required string Type { get; set; }
    public required string Color { get; set; }

    /// <summary>Hex color (e.g. "#FF8800") used for the etiquette swatch.</summary>
    public string? ColorHex { get; set; }

    /// <summary>Net filament weight of a full spool in grams (default for new spools).</summary>
    public int DefaultNetWeightGrams { get; set; }

    /// <summary>Empty spool weight in grams (for "weight including spool" math).</summary>
    public int EmptySpoolWeightGrams { get; set; }

    public string? Notes { get; set; }
    public DateTimeOffset CreatedAt { get; init; } = DateTimeOffset.UtcNow;
}
