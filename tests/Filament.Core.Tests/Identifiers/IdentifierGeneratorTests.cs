using Filament.Core.Identifiers;
using Xunit;

namespace Filament.Core.Tests.Identifiers;

public class IdentifierGeneratorTests
{
    [Fact]
    public void NewTypeId_HasExpectedLength()
    {
        var id = IdentifierGenerator.NewTypeId();
        Assert.Equal(IdentifierGenerator.TypeIdLength, id.Length);
        Assert.True(IdentifierGenerator.IsValid(id));
    }

    [Fact]
    public void NewSpoolId_HasExpectedLength()
    {
        var id = IdentifierGenerator.NewSpoolId();
        Assert.Equal(IdentifierGenerator.SpoolIdLength, id.Length);
        Assert.True(IdentifierGenerator.IsValid(id));
    }

    [Fact]
    public void Alphabet_ExcludesAmbiguousCharacters()
    {
        var alphabet = IdentifierGenerator.Alphabet;
        Assert.DoesNotContain('I', alphabet);
        Assert.DoesNotContain('L', alphabet);
        Assert.DoesNotContain('O', alphabet);
        Assert.DoesNotContain('U', alphabet);
        Assert.Equal(32, alphabet.Length);
        Assert.Equal(alphabet.Length, alphabet.Distinct().Count());
    }

    [Theory]
    [InlineData("abc", "ABC")]
    [InlineData("io1", "101")]
    [InlineData("OL", "01")]
    [InlineData("u", "V")]
    [InlineData(" a b-c_d ", "ABCD")]
    public void Normalize_HandlesAmbiguousChars(string input, string expected)
    {
        Assert.Equal(expected, IdentifierGenerator.Normalize(input));
    }

    [Fact]
    public void Generate_ProducesOnlyAlphabetChars()
    {
        for (int i = 0; i < 200; i++)
        {
            var id = IdentifierGenerator.Generate(6);
            foreach (var c in id)
                Assert.Contains(c, IdentifierGenerator.Alphabet);
        }
    }
}
