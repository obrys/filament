using System.Text;
using System.Text.RegularExpressions;
using Filament.Api.Controllers;
using Filament.Api.Pdf;
using Filament.Core.Domain;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace Filament.Api.Tests;

public class LabelsControllerTests
{
    private static readonly string[] TwoSpoolIds = { "AAA0", "BBB0" };
    private static readonly string[] SingleSpoolId = { "AAA0" };
    private static readonly string[] UnknownSpoolIds = { "ZZZZ" };

    private static readonly FilamentType Type = new()
    {
        Id = "T1",
        Brand = "BrandX",
        Material = "PLA",
        Type = "Basic",
        Color = "Red",
        ColorHex = "#FF0000",
        DefaultNetWeightGrams = 1000,
        EmptySpoolWeightGrams = 120,
    };

    private static LabelsController CreateController(params string[] spoolIds)
    {
        var spools = spoolIds
            .Select(id => new Spool { Id = id, FilamentTypeId = "T1", RemainingGrams = 500, InitialNetGrams = 1000 })
            .ToList();
        return new LabelsController(new FakeSpoolRepository(spools), new FakeTypeRepository(Type), new LabelPdfGenerator())
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext { Request = { Scheme = "http", Host = new HostString("lan.example") } },
            },
        };
    }

    private static void AssertSinglePagePdf(FileContentResult file)
    {
        var first = Regex.Match(PdfText(file.FileContents), @"/Count\s+(\d+)");
        Assert.True(first.Success, "page tree /Count is missing");
        Assert.Equal("1", first.Groups[1].Value);
    }

    private static string PdfText(byte[] bytes) => Encoding.Latin1.GetString(bytes);

    [Fact]
    public async Task NoIds_400()
    {
        var controller = CreateController("AAA0");
        var result = await controller.Generate(Array.Empty<string>(), null, CancellationToken.None);
        var bad = Assert.IsType<BadRequestObjectResult>(result);
        Assert.Contains("At least one spool id required", bad.Value!.ToString()!);
    }

    [Fact]
    public async Task AllIdsUnknown_404()
    {
        var controller = CreateController("AAA0");
        var result = await controller.Generate(UnknownSpoolIds, "2", CancellationToken.None);
        Assert.IsType<NotFoundResult>(result);
    }

    [Theory]
    [InlineData("0")]
    [InlineData("-2")]
    [InlineData("1.5")]
    [InlineData("abc")]
    [InlineData("11")]
    public async Task InvalidCopies_400(string copies)
    {
        var controller = CreateController("AAA0");
        var result = await controller.Generate(SingleSpoolId, copies, CancellationToken.None);
        var bad = Assert.IsType<BadRequestObjectResult>(result);
        Assert.Contains("copies must be a whole number between 1 and 10", bad.Value!.ToString()!);
    }

    [Fact]
    public async Task MissingCopies_DefaultsToOne_SinglePagePdf()
    {
        var controller = CreateController("AAA0", "BBB0");
        var result = await controller.Generate(TwoSpoolIds, null, CancellationToken.None);
        var file = Assert.IsType<FileContentResult>(result);
        Assert.Equal("application/pdf", file.ContentType);
        Assert.Equal("spool-labels.pdf", file.FileDownloadName);
        AssertSinglePagePdf(file);
    }

    [Fact]
    public async Task ValidCopies_ReturnsSinglePagePdf()
    {
        var controller = CreateController("AAA0");
        var result = await controller.Generate(SingleSpoolId, "3", CancellationToken.None);
        var file = Assert.IsType<FileContentResult>(result);
        Assert.Equal("application/pdf", file.ContentType);
        Assert.Equal("spool-labels.pdf", file.FileDownloadName);
        AssertSinglePagePdf(file);
    }
}
