using Filament.Api.Dtos;
using Filament.Core.Abstractions;
using Microsoft.AspNetCore.Mvc;

namespace Filament.Api.Controllers;

[ApiController]
[Route("api/dashboard")]
public sealed class DashboardController : ControllerBase
{
    private readonly IDashboardRepository _repo;
    public DashboardController(IDashboardRepository repo) => _repo = repo;

    [HttpGet("summary")]
    public async Task<DashboardSummaryDto> Summary(CancellationToken ct)
    {
        var s = await _repo.GetSummaryAsync(ct);
        return new DashboardSummaryDto(
            s.FilamentTypeCount, s.ActiveSpoolCount, s.FinishedSpoolCount, s.TotalRemainingGrams);
    }

    [HttpGet("usage")]
    public async Task<IReadOnlyList<DailyUsageDto>> Usage([FromQuery] int days = 30, CancellationToken ct = default)
    {
        var u = await _repo.GetUsageAsync(Math.Clamp(days, 1, 365), ct);
        return u.Select(x => new DailyUsageDto(x.Day, x.ConsumedGrams)).ToList();
    }
}
