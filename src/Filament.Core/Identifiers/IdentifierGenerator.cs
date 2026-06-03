using System.Security.Cryptography;

namespace Filament.Core.Identifiers;

/// <summary>
/// Generates short, human-friendly identifiers using a reduced alphabet that avoids
/// visually similar characters (0/O, 1/I/L, U/V) — based on Crockford's Base32.
/// </summary>
public static class IdentifierGenerator
{
    public const string Alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

    public const int TypeIdLength = 3;
    public const int SpoolIdLength = 4;

    public static string NewTypeId() => Generate(TypeIdLength);
    public static string NewSpoolId() => Generate(SpoolIdLength);

    public static string Generate(int length)
    {
        if (length <= 0) throw new ArgumentOutOfRangeException(nameof(length));
        Span<char> buffer = stackalloc char[length];
        Span<byte> bytes = stackalloc byte[length];
        RandomNumberGenerator.Fill(bytes);
        for (int i = 0; i < length; i++)
        {
            buffer[i] = Alphabet[bytes[i] & 0x1F];
        }
        return new string(buffer);
    }

    public static string Normalize(string input)
    {
        ArgumentNullException.ThrowIfNull(input);
        Span<char> buffer = stackalloc char[input.Length];
        int j = 0;
        foreach (var raw in input)
        {
            if (char.IsWhiteSpace(raw) || raw == '-' || raw == '_') continue;
            var c = char.ToUpperInvariant(raw);
            c = c switch
            {
                'I' or 'L' => '1',
                'O' => '0',
                'U' => 'V',
                _ => c,
            };
            buffer[j++] = c;
        }
        return new string(buffer[..j]);
    }

    public static bool IsValid(string id)
    {
        if (string.IsNullOrEmpty(id)) return false;
        foreach (var c in id)
        {
            if (Alphabet.IndexOf(c) < 0) return false;
        }
        return true;
    }
}
