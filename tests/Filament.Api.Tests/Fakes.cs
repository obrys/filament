using System.Runtime.CompilerServices;
using Filament.Core.Abstractions;
using Filament.Core.Domain;
using Filament.Core.Services;
using QuestPDF.Infrastructure;

namespace Filament.Api.Tests;

/// <summary>
/// QuestPDF requires a license setting before the first render; the unit tests use the free
/// Community license (the application itself sets it in Program.cs).
/// </summary>
static class QuestPdfTestLicense
{
    [ModuleInitializer]
    internal static void Init() => QuestPDF.Settings.License = LicenseType.Community;
}

/// <summary>
/// Dictionary-backed fake. Only <see cref="GetAsync"/> is exercised by the label tests; the
/// remaining members throw so any accidental use fails loudly.
/// </summary>
public sealed class FakeSpoolRepository : ISpoolRepository
{
    private readonly Dictionary<string, Spool> _spools;

    public FakeSpoolRepository(IEnumerable<Spool> spools) => _spools = spools.ToDictionary(s => s.Id);

    public Task<Spool?> GetAsync(string id, CancellationToken ct = default) =>
        Task.FromResult(_spools.TryGetValue(id, out var spool) ? spool : null);

    public Task<IReadOnlyList<Spool>> ListAsync(SpoolSort sort = SpoolSort.LastUsed, string? filamentTypeId = null, bool includeFinished = false, CancellationToken ct = default) =>
        throw new NotSupportedException();

    public Task AddAsync(Spool spool, SpoolEvent createdEvent, CancellationToken ct = default) =>
        throw new NotSupportedException();

    public Task UpdateAsync(Spool spool, SpoolEvent? newEvent = null, CancellationToken ct = default) =>
        throw new NotSupportedException();

    public Task<bool> DeleteAsync(string id, CancellationToken ct = default) =>
        throw new NotSupportedException();

    public Task<IReadOnlyList<SpoolEvent>> ListEventsAsync(string spoolId, CancellationToken ct = default) =>
        throw new NotSupportedException();

    public Task<Spool?> ApplyLifecycleAsync(string spoolId, LifecyclePlan plan, CancellationToken ct = default) =>
        throw new NotSupportedException();

    public Task<IReadOnlyList<SpoolReevaluation>> ReevaluateAllAsync(CancellationToken ct = default) =>
        throw new NotSupportedException();
}

/// <summary>
/// Dictionary-backed fake. Only <see cref="GetAsync"/> is exercised by the label tests; the
/// remaining members throw so any accidental use fails loudly.
/// </summary>
public sealed class FakeTypeRepository : IFilamentTypeRepository
{
    private readonly Dictionary<string, FilamentType> _types;

    public FakeTypeRepository(params FilamentType[] types) => _types = types.ToDictionary(t => t.Id);

    public Task<FilamentType?> GetAsync(string id, CancellationToken ct = default) =>
        Task.FromResult(_types.TryGetValue(id, out var type) ? type : null);

    public Task<IReadOnlyList<FilamentType>> ListAsync(CancellationToken ct = default) =>
        Task.FromResult<IReadOnlyList<FilamentType>>(_types.Values.ToList());

    public Task AddAsync(FilamentType type, CancellationToken ct = default) =>
        throw new NotSupportedException();

    public Task UpdateAsync(FilamentType type, CancellationToken ct = default) =>
        throw new NotSupportedException();

    public Task<bool> DeleteAsync(string id, CancellationToken ct = default) =>
        throw new NotSupportedException();

    public Task<bool> HasSpoolsAsync(string id, CancellationToken ct = default) =>
        throw new NotSupportedException();
}

/// <summary>
/// Minimal print-project fake: a print-id → project-id map for the spool-event project-link
/// resolution in <c>SpoolsController.Events</c>. The remaining members throw so any accidental
/// use fails loudly.
/// </summary>
public sealed class FakePrintProjectRepository : IPrintProjectRepository
{
    private readonly Dictionary<string, string> _printToProject;

    public FakePrintProjectRepository(IEnumerable<(string PrintId, string ProjectId)> links) =>
        _printToProject = links.ToDictionary(l => l.PrintId, l => l.ProjectId);

    public Task<string?> GetProjectIdByPrintIdAsync(string printId, CancellationToken ct = default) =>
        Task.FromResult<string?>(_printToProject.TryGetValue(printId, out var project) ? project : null);

    public Task<PrintProject?> GetAsync(string id, CancellationToken ct = default) =>
        throw new NotSupportedException();

    public Task<IReadOnlyList<PrintProject>> ListAsync(bool includeArchived, CancellationToken ct = default) =>
        throw new NotSupportedException();

    public Task<PrintProject> CreateAsync(PrintProject project, CancellationToken ct = default) =>
        throw new NotSupportedException();

    public Task<PrintProject> UpdateAsync(PrintProject project, CancellationToken ct = default) =>
        throw new NotSupportedException();

    public Task<PrintProject> SetArchivedAsync(string id, bool archived, DateTimeOffset at, CancellationToken ct = default) =>
        throw new NotSupportedException();

    public Task<bool> DeleteAsync(string id, CancellationToken ct = default) =>
        throw new NotSupportedException();

    public Task<ProjectPrint> PrintAsync(string projectId, IReadOnlyList<PrintSelection> selection, CancellationToken ct = default) =>
        throw new NotSupportedException();

    public Task<ProjectPrint> SetPrintEnabledAsync(string projectId, string printId, bool enabled, CancellationToken ct = default) =>
        throw new NotSupportedException();
}
