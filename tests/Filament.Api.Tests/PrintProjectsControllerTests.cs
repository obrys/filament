using Filament.Api.Controllers;
using Filament.Api.Dtos;
using Filament.Core.Abstractions;
using Filament.Core.Domain;
using Filament.Core.Identifiers;
using Filament.Core.Services;
using Microsoft.AspNetCore.Mvc;

namespace Filament.Api.Tests;

/// <summary>Records the ("resource", id) pairs it was notified with, for notification assertions.</summary>
public sealed class RecordingChangeNotifier : IChangeNotifier
{
    public List<(string Resource, string? Id)> Notifications { get; } = [];

    public Task NotifyAsync(string resource, string? id, CancellationToken ct = default)
    {
        Notifications.Add((resource, id));
        return Task.CompletedTask;
    }
}

/// <summary>
/// In-memory spool view over <see cref="FakePrintProjectStore"/>: the read paths the
/// controllers use (list/get spools, list events).
/// </summary>
public sealed class FakeSpoolView : ISpoolRepository
{
    private readonly FakePrintProjectStore _store;
    public FakeSpoolView(FakePrintProjectStore store) => _store = store;

    public Task<Spool?> GetAsync(string id, CancellationToken ct = default) =>
        Task.FromResult(_store.SpoolOrNull(id));

    public Task<IReadOnlyList<Spool>> ListAsync(
        SpoolSort sort = SpoolSort.LastUsed, string? filamentTypeId = null, bool includeFinished = false, CancellationToken ct = default) =>
        Task.FromResult<IReadOnlyList<Spool>>(_store.ListSpools(filamentTypeId, includeFinished));

    public Task<IReadOnlyList<SpoolEvent>> ListEventsAsync(string spoolId, CancellationToken ct = default) =>
        Task.FromResult<IReadOnlyList<SpoolEvent>>(_store.Events(spoolId));

    public Task AddAsync(Spool spool, SpoolEvent createdEvent, CancellationToken ct = default) =>
        throw new NotSupportedException();

    public Task UpdateAsync(Spool spool, SpoolEvent? newEvent = null, CancellationToken ct = default) =>
        throw new NotSupportedException();

    public Task<bool> DeleteAsync(string id, CancellationToken ct = default) =>
        throw new NotSupportedException();

    public Task<Spool?> ApplyLifecycleAsync(string spoolId, LifecyclePlan plan, CancellationToken ct = default) =>
        throw new NotSupportedException();

    public Task<IReadOnlyList<SpoolReevaluation>> ReevaluateAllAsync(CancellationToken ct = default) =>
        throw new NotSupportedException();
}

/// <summary>
/// In-memory print-project + spool store mirroring <c>PrintProjectRepository</c>: prints are
/// planned through <see cref="PrintProjectRules.PlanPrint"/> (sealed spools auto-open via
/// evaluation), undo/redo toggles every linked event through the
/// <see cref="SpoolLifecycle.PlanSetEnabled"/> guards (all planned before anything mutates),
/// and every change re-evaluates the touched spools' cached state. Exposes the spool side to
/// controllers via <see cref="SpoolRepository"/> (<see cref="FakeSpoolView"/>).
/// </summary>
public sealed class FakePrintProjectStore : IPrintProjectRepository
{
    private readonly Dictionary<string, PrintProject> _projects = [];
    private readonly Dictionary<string, Spool> _spools = [];
    private readonly Dictionary<string, List<SpoolEvent>> _events = [];

    public FakeSpoolView SpoolRepository { get; }
    public FakePrintProjectStore() => SpoolRepository = new(this);

    // ----- seeding / inspection helpers -----

    public void AddProject(PrintProject project) => _projects[project.Id] = project;

    public void AddSpool(Spool spool, params SpoolEvent[] events)
    {
        _spools[spool.Id] = spool;
        _events[spool.Id] = events.ToList();
        Rerun(spool.Id);
    }

    public void AddEvent(string spoolId, SpoolEvent ev)
    {
        _events[spoolId].Add(ev);
        Rerun(spoolId);
    }

    public PrintProject? Project(string id) => _projects.TryGetValue(id, out var p) ? p : null;
    public IReadOnlyCollection<PrintProject> Projects => _projects.Values;
    public Spool Spool(string id) => _spools[id];
    public Spool? SpoolOrNull(string id) => _spools.TryGetValue(id, out var s) ? s : null;
    public IReadOnlyList<SpoolEvent> Events(string spoolId) => _events[spoolId];

    public IReadOnlyList<Spool> ListSpools(string? filamentTypeId, bool includeFinished) =>
        _spools.Values
            .Where(s => filamentTypeId is null || s.FilamentTypeId == filamentTypeId)
            .Where(s => includeFinished || s.Status != SpoolStatus.Finished)
            .ToList();

    public long NextEventId() =>
        _events.Values.SelectMany(e => e).Select(e => e.Id).DefaultIfEmpty(0).Max() + 1;

    private void Rerun(string spoolId)
    {
        var spool = _spools[spoolId];
        var state = SpoolLifecycle.Evaluate(spool.InitialNetGrams, _events[spoolId]);
        spool.Status = state.Status;
        spool.RemainingGrams = state.RemainingGrams;
        spool.OpenedAt = state.OpenedAt;
        spool.FinishedAt = state.FinishedAt;
        spool.LastUsedAt = state.LastUsedAt;
    }

    // ----- IPrintProjectRepository -----

    public Task<PrintProject?> GetAsync(string id, CancellationToken ct = default) =>
        Task.FromResult(Project(id));

    public Task<IReadOnlyList<PrintProject>> ListAsync(bool includeArchived, CancellationToken ct = default) =>
        Task.FromResult<IReadOnlyList<PrintProject>>(
            _projects.Values.Where(p => includeArchived || !p.IsArchived).ToList());

    public Task<PrintProject> CreateAsync(PrintProject project, CancellationToken ct = default)
    {
        _projects[project.Id] = project;
        return Task.FromResult(project);
    }

    public Task<PrintProject> UpdateAsync(PrintProject project, CancellationToken ct = default)
    {
        var existing = Project(project.Id)
            ?? throw new InvalidOperationException($"PrintProject '{project.Id}' not found.");
        existing.Title = project.Title;
        existing.Description = project.Description;
        existing.Url = project.Url;
        existing.Types = project.Types;
        return Task.FromResult(existing);
    }

    public Task<PrintProject> SetArchivedAsync(string id, bool archived, DateTimeOffset at, CancellationToken ct = default)
    {
        var p = Project(id) ?? throw new InvalidOperationException($"PrintProject '{id}' not found.");
        p.IsArchived = archived;
        p.ArchivedAt = archived ? at : null;
        return Task.FromResult(p);
    }

    public Task<bool> DeleteAsync(string id, CancellationToken ct = default)
    {
        var project = Project(id);
        if (project is null) return Task.FromResult(false);

        var printIds = project.Prints.Select(p => p.Id).ToHashSet();
        var spoolIds = _events
            .Where(kv => kv.Value.Any(e => e.ProjectPrintId is not null && printIds.Contains(e.ProjectPrintId)))
            .Select(kv => kv.Key)
            .ToList();
        foreach (var spoolId in spoolIds)
            _events[spoolId] = _events[spoolId].Where(e => e.ProjectPrintId is null || !printIds.Contains(e.ProjectPrintId)).ToList();
        foreach (var spoolId in spoolIds)
            Rerun(spoolId);

        _projects.Remove(id);
        return Task.FromResult(true);
    }

    public Task<ProjectPrint> PrintAsync(string projectId, IReadOnlyList<PrintSelection> selection, CancellationToken ct = default)
    {
        var project = Project(projectId)
            ?? throw new InvalidOperationException($"PrintProject '{projectId}' not found.");
        var contexts = selection.Select(s => s.SpoolId).Distinct()
            .Select(id => new SpoolWithEvents(Spool(id), _events[id]))
            .ToList();
        var occurredAt = DateTimeOffset.UtcNow;
        var plans = PrintProjectRules.PlanPrint(project, selection, contexts, occurredAt);

        var print = new ProjectPrint { Id = IdentifierGenerator.NewProjectPrintId(), ProjectId = projectId, OccurredAt = occurredAt };
        foreach (var plan in plans)
        {
            var template = plan.EventToAdd!;
            var ev = new SpoolEvent
            {
                Id = NextEventId(),
                SpoolId = template.SpoolId,
                Kind = template.Kind,
                DeltaGrams = template.DeltaGrams,
                ProjectName = template.ProjectName,
                ProjectUrl = template.ProjectUrl,
                Notes = template.Notes,
                ProjectPrintId = print.Id,
                OccurredAt = template.OccurredAt,
            };
            _events[ev.SpoolId].Add(ev);
            print.Events.Add(ev);
            Rerun(ev.SpoolId);
        }
        project.Prints.Add(print);
        return Task.FromResult(print);
    }

    public Task<ProjectPrint> SetPrintEnabledAsync(string projectId, string printId, bool enabled, CancellationToken ct = default)
    {
        var project = Project(projectId)
            ?? throw new InvalidOperationException($"PrintProject '{projectId}' not found.");
        PrintProjectRules.EnsureNotArchived(project, enabled ? "redone" : "undone");
        var print = project.Prints.FirstOrDefault(p => p.Id == printId)
            ?? throw new InvalidOperationException($"ProjectPrint '{printId}' not found.");

        // Plan every event's toggle against the current state before mutating anything, so a
        // rejected redo changes nothing.
        foreach (var ev in print.Events)
            SpoolLifecycle.PlanSetEnabled(_events[ev.SpoolId], ev.Id, enabled);

        foreach (var ev in print.Events)
        {
            ev.IsDisabled = !enabled;
            Rerun(ev.SpoolId);
        }
        print.IsDisabled = !enabled;
        return Task.FromResult(print);
    }

    public Task<string?> GetProjectIdByPrintIdAsync(string printId, CancellationToken ct = default) =>
        Task.FromResult<string?>(
            _projects.Values
                .SelectMany(p => p.Prints)
                .FirstOrDefault(pr => pr.Id == printId)?.ProjectId);
}

public class PrintProjectsControllerTests
{
    private static readonly DateTimeOffset T0 = new(2026, 6, 1, 12, 0, 0, TimeSpan.Zero);

    private static readonly FilamentType T1 = new()
    {
        Id = "T1", Brand = "BrandA", Material = "PLA", Type = "Basic", Color = "Red",
    };
    private static readonly FilamentType T2 = new()
    {
        Id = "T2", Brand = "BrandB", Material = "PETG", Type = "Basic", Color = "Blue",
    };

    /// <summary>P1 "Benchy" (T1 100 g + T2 50 g); S1 open 1000 g, S2 sealed 1000 g.</summary>
    private static (PrintProjectsController Controller, FakePrintProjectStore Store, RecordingChangeNotifier Notifier) Create()
    {
        var store = new FakePrintProjectStore();
        store.AddSpool(
            new Spool { Id = "S1", FilamentTypeId = "T1", InitialNetGrams = 1000, RemainingGrams = 1000 },
            new SpoolEvent { Id = 1, SpoolId = "S1", Kind = SpoolEventKind.Created, OccurredAt = T0 },
            new SpoolEvent { Id = 2, SpoolId = "S1", Kind = SpoolEventKind.Opened, OccurredAt = T0 });
        store.AddSpool(
            new Spool { Id = "S2", FilamentTypeId = "T2", InitialNetGrams = 1000, RemainingGrams = 1000 },
            new SpoolEvent { Id = 3, SpoolId = "S2", Kind = SpoolEventKind.Created, OccurredAt = T0 });
        store.AddProject(new PrintProject
        {
            Id = "P1",
            Title = "Benchy",
            Url = "https://example.com/benchy",
            CreatedAt = T0,
            Types =
            [
                new PrintProjectType { FilamentTypeId = "T1", Grams = 100 },
                new PrintProjectType { FilamentTypeId = "T2", Grams = 50 },
            ],
        });
        var notifier = new RecordingChangeNotifier();
        var controller = new PrintProjectsController(store, new FakeTypeRepository(T1, T2), store.SpoolRepository, notifier);
        return (controller, store, notifier);
    }

    private static string Error(BadRequestObjectResult result) =>
        (string)result.Value.GetType().GetProperty("error")!.GetValue(result.Value)!;

    /// <summary>ActionResult&lt;T&gt; wraps NotFound()/BadRequest() in its <c>Result</c> slot; unwrap it.</summary>
    private static IActionResult Unwrap(ActionResult<PrintProjectDto> result) =>
        Unwrap(result.Result);

    private static IActionResult Unwrap(ActionResult<ProjectPrintDto> result) =>
        Unwrap(result.Result);

    private static IActionResult Unwrap(ActionResult? result)
    {
        if (result is { } r) return r;
        Assert.Fail("expected an error result, got a value");
        return new ObjectResult(null);
    }

    // Bare IActionResult actions (Delete) pass through unchanged.
    private static IActionResult Unwrap(IActionResult result) => result;

    private static async Task<ProjectPrintDto> PrintAsync(
        PrintProjectsController c, string id, params (string Spool, int Grams)[] slots)
    {
        var dto = await c.Print(id, new CreateProjectPrintDto(
            slots.Select(s => new PrintSelectionDto(s.Spool, s.Grams)).ToList()), CancellationToken.None);
        return dto.Value!;
    }

    // ---------------- Create ----------------

    [Fact]
    public async Task Create_Valid_Returns201AndNotifiesProject()
    {
        var (controller, store, notifier) = Create();

        var result = await controller.Create(new CreatePrintProjectDto(
            "Boltzmann", "desc", "https://example.com/boltzmann",
            [new PrintProjectTypeLineDto("T1", 250)]), CancellationToken.None);

        var created = Assert.IsType<CreatedAtActionResult>(Unwrap(result));
        var body = (PrintProjectDto)created.Value!;
        Assert.False(string.IsNullOrEmpty(body.Id));
        Assert.Equal("Boltzmann", body.Title);
        Assert.Single(body.Types);
        Assert.False(body.IsArchived);
        Assert.Null(body.Prints);

        var stored = store.Project(body.Id);
        Assert.NotNull(stored);
        Assert.Equal(250, stored!.Types[0].Grams);

        Assert.Contains(("print-project", body.Id), notifier.Notifications);
    }

    [Fact]
    public async Task Create_BlankTitle_BadRequest()
    {
        var (controller, store, _) = Create();
        var result = await controller.Create(new CreatePrintProjectDto(
            "  ", null, null, [new PrintProjectTypeLineDto("T1", 100)]), CancellationToken.None);
        var bad = Assert.IsType<BadRequestObjectResult>(Unwrap(result));
        Assert.Equal("Title is required.", Error(bad));
        Assert.Single(store.Projects);
    }

    [Fact]
    public async Task Create_DuplicateType_BadRequest()
    {
        var (controller, _, _) = Create();
        var result = await controller.Create(new CreatePrintProjectDto(
            "X", null, null,
            [new PrintProjectTypeLineDto("T1", 100), new PrintProjectTypeLineDto("T1", 50)]), CancellationToken.None);
        var bad = Assert.IsType<BadRequestObjectResult>(Unwrap(result));
        Assert.Contains("more than once", Error(bad));
    }

    [Fact]
    public async Task Create_UnknownType_NotFound()
    {
        var (controller, _, _) = Create();
        var result = await controller.Create(new CreatePrintProjectDto(
            "X", null, null, [new PrintProjectTypeLineDto("T9", 100)]), CancellationToken.None);
        Assert.IsType<NotFoundObjectResult>(Unwrap(result));
    }

    // ---------------- Get / Update ----------------

    [Fact]
    public async Task Get_Unknown_NotFound()
    {
        var (controller, _, _) = Create();
        var result = await controller.Get("nope", CancellationToken.None);
        Assert.IsType<NotFoundResult>(Unwrap(result));
    }

    [Fact]
    public async Task Get_Valid_IncludesPrintsWithSpoolTypes()
    {
        var (controller, store, _) = Create();
        var print = await PrintAsync(controller, "P1", ("S1", 100), ("S2", 50));

        var dto = (await controller.Get("P1", CancellationToken.None)).Value!;
        var listed = Assert.Single(dto.Prints!);
        Assert.Equal(print.Id, listed.Id);
        Assert.Equal(2, listed.Events.Count);
        var s2 = Assert.Single(listed.Events, e => e.SpoolId == "S2");
        Assert.Equal(50, s2.Grams);
        Assert.Equal("BrandB", s2.Brand);
        Assert.Equal("PETG", s2.Material);
        Assert.Equal("Blue", s2.Color);

        // The store really holds one linked event per spool.
        Assert.Equal(1, store.Events("S1").Count(e => e.ProjectPrintId == print.Id));
        Assert.Equal(1, store.Events("S2").Count(e => e.ProjectPrintId == print.Id));
    }

    [Fact]
    public async Task Update_Valid_ReplacesDefinitionAndKeepsIdentity()
    {
        var (controller, store, notifier) = Create();

        var dto = (await controller.Update("P1", new CreatePrintProjectDto(
            "Benchy v2", null, null, [new PrintProjectTypeLineDto("T2", 75)]), CancellationToken.None)).Value!;

        Assert.Equal("Benchy v2", dto.Title);
        Assert.Single(dto.Types);
        var stored = store.Project("P1")!;
        Assert.Equal(T0, stored.CreatedAt);
        Assert.False(stored.IsArchived);
        Assert.Contains(("print-project", "P1"), notifier.Notifications);
    }

    [Fact]
    public async Task Update_Archived_BadRequest()
    {
        var (controller, store, _) = Create();
        await controller.Archive("P1", CancellationToken.None);
        var result = await controller.Update("P1", new CreatePrintProjectDto(
            "X", null, null, [new PrintProjectTypeLineDto("T1", 100)]), CancellationToken.None);
        var bad = Assert.IsType<BadRequestObjectResult>(Unwrap(result));
        Assert.Contains("edited", Error(bad));
        Assert.Equal("Benchy", store.Project("P1")!.Title);
    }

    // ---------------- Archive / unarchive ----------------

    [Fact]
    public async Task Archive_SetsArchivedAndDate()
    {
        var (controller, store, notifier) = Create();
        var dto = (await controller.Archive("P1", CancellationToken.None)).Value!;
        Assert.True(dto.IsArchived);
        Assert.NotNull(dto.ArchivedAt);
        Assert.Contains(("print-project", "P1"), notifier.Notifications);

        // The default list no longer returns it; the archived-inclusive list does.
        var def = await controller.List(false, CancellationToken.None);
        Assert.DoesNotContain(def.Items, p => p.Id == "P1");
        var withArchived = await controller.List(true, CancellationToken.None);
        Assert.Contains(withArchived.Items, p => p.Id == "P1");
    }

    [Fact]
    public async Task Archive_AlreadyArchived_BadRequest()
    {
        var (controller, _, _) = Create();
        await controller.Archive("P1", CancellationToken.None);
        var result = await controller.Archive("P1", CancellationToken.None);
        Assert.IsType<BadRequestObjectResult>(Unwrap(result));
    }

    [Fact]
    public async Task Unarchive_ClearsArchivedDate()
    {
        var (controller, store, _) = Create();
        await controller.Archive("P1", CancellationToken.None);
        var dto = (await controller.Unarchive("P1", CancellationToken.None)).Value!;
        Assert.False(dto.IsArchived);
        Assert.Null(dto.ArchivedAt);
        Assert.Null(store.Project("P1")!.ArchivedAt);
    }

    // ---------------- Delete ----------------

    [Fact]
    public async Task Delete_NotArchived_BadRequest()
    {
        var (controller, store, _) = Create();
        var result = await controller.Delete("P1", CancellationToken.None);
        var bad = Assert.IsType<BadRequestObjectResult>(Unwrap(result));
        Assert.Equal("Only an archived project can be deleted.", Error(bad));
        Assert.NotNull(store.Project("P1"));
    }

    [Fact]
    public async Task Delete_ArchivedWithEnabledPrint_BadRequest()
    {
        var (controller, store, _) = Create();
        await PrintAsync(controller, "P1", ("S1", 100), ("S2", 50));
        await controller.Archive("P1", CancellationToken.None);
        var result = await controller.Delete("P1", CancellationToken.None);
        var bad = Assert.IsType<BadRequestObjectResult>(Unwrap(result));
        Assert.Contains("Undo every project print", Error(bad));
        Assert.NotNull(store.Project("P1"));
    }

    [Fact]
    public async Task Delete_ArchivedWithoutEnabledPrints_RemovesProjectPrintsAndEvents()
    {
        var (controller, store, notifier) = Create();
        var print = await PrintAsync(controller, "P1", ("S1", 100), ("S2", 50));
        await controller.Undo("P1", print.Id, CancellationToken.None);
        await controller.Archive("P1", CancellationToken.None);

        var result = await controller.Delete("P1", CancellationToken.None);
        Assert.IsType<NoContentResult>(result);

        Assert.Null(store.Project("P1"));
        Assert.DoesNotContain(store.Events("S1"), e => e.ProjectPrintId == print.Id);
        Assert.DoesNotContain(store.Events("S2"), e => e.ProjectPrintId == print.Id);
        // Balances re-evaluated back to full.
        Assert.Equal(1000, store.Spool("S1").RemainingGrams);
        Assert.Equal(1000, store.Spool("S2").RemainingGrams);
        Assert.Contains(("spool", null), notifier.Notifications);
    }

    // ---------------- Print ----------------

    [Fact]
    public async Task Print_Valid_ConsumesSpoolsAutoOpensSealedAndNotifiesBoth()
    {
        var (controller, store, notifier) = Create();

        var print = await PrintAsync(controller, "P1", ("S1", 100), ("S2", 50));

        Assert.False(print.IsDisabled);
        var s1Event = Assert.Single(print.Events, e => e.SpoolId == "S1");
        var s2Event = Assert.Single(print.Events, e => e.SpoolId == "S2");
        Assert.Equal(100, s1Event.Grams);
        Assert.Equal(50, s2Event.Grams);

        Assert.Equal(900, store.Spool("S1").RemainingGrams);
        // S2 was sealed: the print consumed 50 g and opened it at the print's timestamp.
        var s2 = store.Spool("S2");
        Assert.Equal(950, s2.RemainingGrams);
        Assert.Equal(SpoolStatus.Open, s2.Status);
        Assert.Equal(print.OccurredAt, s2.OpenedAt);

        var s2PrintEvent = store.Events("S2").First(e => e.ProjectPrintId == print.Id);
        Assert.Equal("Benchy", s2PrintEvent.ProjectName);
        Assert.Equal("https://example.com/benchy", s2PrintEvent.ProjectUrl);
        Assert.Equal(-50, s2PrintEvent.DeltaGrams);

        Assert.Contains(("print-project", "P1"), notifier.Notifications);
        Assert.Contains(("spool", null), notifier.Notifications);
    }

    [Fact]
    public async Task Print_Archived_BadRequest()
    {
        var (controller, store, _) = Create();
        await controller.Archive("P1", CancellationToken.None);
        var result = await controller.Print("P1", new CreateProjectPrintDto(
        [new PrintSelectionDto("S1", 100), new PrintSelectionDto("S2", 50)]), CancellationToken.None);
        var bad = Assert.IsType<BadRequestObjectResult>(Unwrap(result));
        Assert.Contains("printed", Error(bad));
        Assert.Empty(store.Project("P1")!.Prints);
    }

    [Fact]
    public async Task Print_OverBalance_BadRequestAndChangesNothing()
    {
        var (controller, store, _) = Create();
        var result = await controller.Print("P1", new CreateProjectPrintDto(
        [new PrintSelectionDto("S1", 1500), new PrintSelectionDto("S2", 50)]), CancellationToken.None);
        var bad = Assert.IsType<BadRequestObjectResult>(Unwrap(result));
        Assert.Contains("only 1000g remaining", Error(bad));
        Assert.Equal(1000, store.Spool("S1").RemainingGrams);
        Assert.Empty(store.Project("P1")!.Prints);
    }

    [Fact]
    public async Task Print_UnknownProject_NotFound()
    {
        var (controller, _, _) = Create();
        var result = await controller.Print("nope", new CreateProjectPrintDto(
        [new PrintSelectionDto("S1", 100)]), CancellationToken.None);
        Assert.IsType<NotFoundResult>(Unwrap(result));
    }

    // ---------------- Undo / redo ----------------

    [Fact]
    public async Task Undo_RestoresBalancesAndMarksPrintDisabled()
    {
        var (controller, store, _) = Create();
        var print = await PrintAsync(controller, "P1", ("S1", 100), ("S2", 50));

        var dto = (await controller.Undo("P1", print.Id, CancellationToken.None)).Value!;
        Assert.True(dto.IsDisabled);
        Assert.Equal(1000, store.Spool("S1").RemainingGrams);
        var s2 = store.Spool("S2");
        Assert.Equal(1000, s2.RemainingGrams);
        Assert.Equal(SpoolStatus.Sealed, s2.Status); // its only opening was the (now undone) print
        Assert.True(store.Events("S1").All(e => e.ProjectPrintId != print.Id || e.IsDisabled));
    }

    [Fact]
    public async Task Redo_AfterUndo_ReappliesConsumption()
    {
        var (controller, store, _) = Create();
        // Open S2 with its own Open event so it stays open after the undo and the redo
        // (re-enabling a print on a sealed spool is rejected by the lifecycle guard).
        store.AddEvent("S2", new SpoolEvent { Id = 4, SpoolId = "S2", Kind = SpoolEventKind.Opened, OccurredAt = T0 });
        var print = await PrintAsync(controller, "P1", ("S1", 100), ("S2", 50));
        await controller.Undo("P1", print.Id, CancellationToken.None);

        var dto = (await controller.Redo("P1", print.Id, CancellationToken.None)).Value!;
        Assert.False(dto.IsDisabled);
        Assert.Equal(900, store.Spool("S1").RemainingGrams);
        var s2 = store.Spool("S2");
        Assert.Equal(950, s2.RemainingGrams);
        Assert.Equal(SpoolStatus.Open, s2.Status);
        Assert.Equal(T0, s2.OpenedAt);
    }

    [Fact]
    public async Task Redo_AutoOpenedSpoolSealedAgain_Rejected400AndStaysUndone()
    {
        // The project prints only the sealed S2 (backed by a selection covering both types):
        // undoing it returns S2 to sealed, so re-enabling the print is rejected by the
        // "Open the spool before re-enabling prints" lifecycle guard.
        var (controller, store, _) = Create();
        store.AddProject(new PrintProject
        {
            Id = "P2",
            Title = "Sealed only",
            CreatedAt = T0,
            Types = [new PrintProjectType { FilamentTypeId = "T2", Grams = 50 }],
        });
        var print = await PrintAsync(controller, "P2", ("S2", 50));
        Assert.Equal(SpoolStatus.Open, store.Spool("S2").Status);
        await controller.Undo("P2", print.Id, CancellationToken.None);
        Assert.Equal(SpoolStatus.Sealed, store.Spool("S2").Status);

        var result = await controller.Redo("P2", print.Id, CancellationToken.None);
        var bad = Assert.IsType<BadRequestObjectResult>(Unwrap(result));
        Assert.Contains("Open the spool", Error(bad));

        // Nothing changed: the print stays undone and the spool stays sealed and full.
        Assert.True(store.Project("P2")!.Prints[0].IsDisabled);
        var s2 = store.Spool("S2");
        Assert.Equal(1000, s2.RemainingGrams);
        Assert.Equal(SpoolStatus.Sealed, s2.Status);
    }

    [Fact]
    public async Task Undo_Archived_BadRequest()
    {
        var (controller, store, _) = Create();
        var print = await PrintAsync(controller, "P1", ("S1", 100), ("S2", 50));
        await controller.Archive("P1", CancellationToken.None);
        var result = await controller.Undo("P1", print.Id, CancellationToken.None);
        var bad = Assert.IsType<BadRequestObjectResult>(Unwrap(result));
        Assert.Contains("undone", Error(bad));
        Assert.False(store.Project("P1")!.Prints[0].IsDisabled);
    }

    [Fact]
    public async Task Undo_UnknownPrint_NotFound()
    {
        var (controller, _, _) = Create();
        var result = await controller.Undo("P1", "nope", CancellationToken.None);
        Assert.IsType<NotFoundResult>(Unwrap(result));
    }
}

/// <summary>
/// <c>SpoolsController.Events</c> project-link resolution: project-created events carry the
/// owning project id, manual events do not, and an unresolvable print id maps to null.
/// </summary>
public class SpoolEventsProjectLinkTests
{
    private static readonly DateTimeOffset T0 = new(2026, 6, 1, 12, 0, 0, TimeSpan.Zero);

    private static readonly FilamentType T1 = new()
    {
        Id = "T1", Brand = "BrandA", Material = "PLA", Type = "Basic", Color = "Red",
    };

    private static (SpoolsController Controller, FakePrintProjectStore Store) Create()
    {
        var store = new FakePrintProjectStore();
        var manual = new SpoolEvent { Id = 1, SpoolId = "S1", Kind = SpoolEventKind.Print, DeltaGrams = -20, OccurredAt = T0 };
        var projectEvent = new SpoolEvent
        {
            Id = 2, SpoolId = "S1", Kind = SpoolEventKind.Print, DeltaGrams = -50,
            ProjectName = "Benchy", ProjectPrintId = "PR1", OccurredAt = T0,
        };
        store.AddSpool(
            new Spool { Id = "S1", FilamentTypeId = "T1", InitialNetGrams = 1000, RemainingGrams = 1000 },
            new SpoolEvent { Id = 0, SpoolId = "S1", Kind = SpoolEventKind.Created, OccurredAt = T0 },
            manual, projectEvent);
        store.AddProject(new PrintProject
        {
            Id = "P1",
            Title = "Benchy",
            CreatedAt = T0,
            Types = [new PrintProjectType { FilamentTypeId = "T1", Grams = 50 }],
            Prints =
            [
                new ProjectPrint
                {
                    Id = "PR1",
                    ProjectId = "P1",
                    OccurredAt = T0,
                    Events = [projectEvent],
                },
            ],
        });
        return (new SpoolsController(store.SpoolRepository, new FakeTypeRepository(T1), store, new FakeChangeNotifier()), store);
    }

    [Fact]
    public async Task Events_ResolveProjectIdForProjectCreatedEventsOnly()
    {
        var (controller, _) = Create();

        var result = await controller.Events("S1", CancellationToken.None);
        var events = (IReadOnlyList<SpoolEventDto>)Assert.IsType<OkObjectResult>(result.Result).Value!;

        var manual = Assert.Single(events, e => e.Id == 1);
        Assert.Null(manual.ProjectPrintId);
        Assert.Null(manual.ProjectId);

        var projectEvent = Assert.Single(events, e => e.Id == 2);
        Assert.Equal("PR1", projectEvent.ProjectPrintId);
        Assert.Equal("P1", projectEvent.ProjectId);
        Assert.Equal("Benchy", projectEvent.ProjectName);
    }
}
