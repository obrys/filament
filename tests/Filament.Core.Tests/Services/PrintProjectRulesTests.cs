using Filament.Core.Abstractions;
using Filament.Core.Domain;
using Filament.Core.Services;
using Xunit;

namespace Filament.Core.Tests.Services;

public class PrintProjectRulesTests
{
    private const int Initial = 1000;
    private static readonly DateTimeOffset T0 = new(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);

    private static PrintProject Project(
        string id = "P1",
        string title = "Benchy",
        bool archived = false,
        DateTimeOffset? archivedAt = null,
        params (string TypeId, int Grams)[] types) => new()
    {
        Id = id,
        Title = title,
        Url = "https://example.com/benchy",
        IsArchived = archived,
        ArchivedAt = archivedAt,
        CreatedAt = T0,
        Types = types.Select(t => new PrintProjectType { FilamentTypeId = t.TypeId, Grams = t.Grams }).ToList(),
    };

    private static ProjectPrint Print(string id, DateTimeOffset occurredAt, bool disabled = false) => new()
    {
        Id = id,
        ProjectId = "P1",
        OccurredAt = occurredAt,
        IsDisabled = disabled,
    };

    private static SpoolEvent Ev(long id, string spoolId, SpoolEventKind kind, int delta = 0,
        DateTimeOffset? at = null, bool disabled = false) => new()
    {
        Id = id,
        SpoolId = spoolId,
        Kind = kind,
        DeltaGrams = delta,
        IsDisabled = disabled,
        OccurredAt = at ?? T0,
    };

    private static Spool Spool(string id, int initial = Initial, SpoolStatus status = SpoolStatus.Open) => new()
    {
        Id = id,
        FilamentTypeId = "T1",
        InitialNetGrams = initial,
        RemainingGrams = initial,
        Status = status,
    };

    // A spool with its full history, ready to feed PlanPrint.
    private static SpoolWithEvents Context(string id, SpoolStatus status = SpoolStatus.Open)
    {
        var events = new List<SpoolEvent> { Ev(1, id, SpoolEventKind.Created, at: T0) };
        if (status != SpoolStatus.Sealed) events.Add(Ev(2, id, SpoolEventKind.Opened, at: T0.AddHours(1)));
        if (status == SpoolStatus.Finished) events.Add(Ev(3, id, SpoolEventKind.Finished, at: T0.AddHours(2)));
        var spool = Spool(id, status: status);
        Apply(spool, events, null);
        return new SpoolWithEvents(spool, events);
    }

    // Mimics the repository: apply a plan to the spool's event list, then re-evaluate its state.
    private static SpoolState Apply(Spool spool, List<SpoolEvent> events, LifecyclePlan? plan)
    {
        if (plan?.EventToAdd is { } add)
        {
            var nextId = (events.Count == 0 ? 0 : events.Max(e => e.Id)) + 1;
            events.Add(new SpoolEvent
            {
                Id = nextId,
                SpoolId = add.SpoolId,
                Kind = add.Kind,
                DeltaGrams = add.DeltaGrams,
                ProjectName = add.ProjectName,
                ProjectUrl = add.ProjectUrl,
                Notes = add.Notes,
                ProjectPrintId = add.ProjectPrintId,
                OccurredAt = add.OccurredAt,
            });
        }
        if (plan?.EventToEnable is { } en) events.First(e => e.Id == en).IsDisabled = false;
        if (plan?.EventToDisable is { } di) events.First(e => e.Id == di).IsDisabled = true;

        var state = SpoolLifecycle.Evaluate(spool.InitialNetGrams, events);
        spool.Status = state.Status;
        spool.RemainingGrams = state.RemainingGrams;
        spool.OpenedAt = state.OpenedAt;
        spool.FinishedAt = state.FinishedAt;
        spool.LastUsedAt = state.LastUsedAt;
        return state;
    }

    // ---------------- EffectiveDate ----------------

    [Fact]
    public void EffectiveDate_Archived_ReturnsArchivedAt()
    {
        var p = Project(archived: true, archivedAt: T0.AddDays(5), types: ("T1", 100));
        p.Prints.Add(Print("PR1", T0.AddDays(4)));
        Assert.Equal(T0.AddDays(5), PrintProjectRules.EffectiveDate(p));
    }

    [Fact]
    public void EffectiveDate_EnabledPrints_ReturnsNewest()
    {
        var p = Project();
        p.Prints.Add(Print("PR1", T0.AddDays(1)));
        p.Prints.Add(Print("PR2", T0.AddDays(3)));
        p.Prints.Add(Print("PR3", T0.AddDays(2)));
        Assert.Equal(T0.AddDays(3), PrintProjectRules.EffectiveDate(p));
    }

    [Fact]
    public void EffectiveDate_UndonePrints_DoNotCount()
    {
        var p = Project();
        p.Prints.Add(Print("PR1", T0.AddDays(1)));
        p.Prints.Add(Print("PR2", T0.AddDays(9), disabled: true));
        Assert.Equal(T0.AddDays(1), PrintProjectRules.EffectiveDate(p));
    }

    [Fact]
    public void EffectiveDate_NoEnabledPrints_ReturnsCreatedAt()
    {
        var p = Project();
        p.Prints.Add(Print("PR1", T0.AddDays(9), disabled: true));
        Assert.Equal(T0, PrintProjectRules.EffectiveDate(p));
    }

    // ---------------- Compare ----------------

    [Fact]
    public void Compare_NewerEffectiveDateFirst()
    {
        var older = Project(id: "A");
        var newer = Project(id: "B");
        newer.Prints.Add(Print("PR1", T0.AddDays(2)));
        Assert.True(PrintProjectRules.Compare(older, newer) > 0);
        Assert.True(PrintProjectRules.Compare(newer, older) < 0);
    }

    [Fact]
    public void Compare_Tie_TitleAscendingOrdinal()
    {
        var a = Project(id: "A", title: "apple");
        var b = Project(id: "B", title: "Banana");
        // Ordinal: uppercase 'B' (0x42) sorts before lowercase 'a' (0x61).
        Assert.True(PrintProjectRules.Compare(a, b) > 0);
        Assert.True(PrintProjectRules.Compare(b, a) < 0);
    }

    [Fact]
    public void Compare_TieAll_IdAscending()
    {
        var a = Project(id: "A", title: "x");
        var b = Project(id: "B", title: "x");
        Assert.True(PrintProjectRules.Compare(a, b) < 0);
    }

    private static string Repeated(string value, int count) => string.Concat(Enumerable.Repeat(value, count));

    // ---------------- ValidateDefinition ----------------

    [Fact]
    public void ValidateDefinition_Valid_DoesNotThrow()
    {
        PrintProjectRules.ValidateDefinition(
            Repeated("x", 256), Repeated("d", 1024), Repeated("u", 1024),
            [new PrintProjectType { FilamentTypeId = "T1", Grams = 1 }]);
    }

    [Fact]
    public void ValidateDefinition_MissingTitle_Throws()
    {
        foreach (var title in new[] { null, "", "   " })
        {
            var ex = Assert.Throws<InvalidOperationException>(
                () => PrintProjectRules.ValidateDefinition(title, null, null,
                    [new PrintProjectType { FilamentTypeId = "T1", Grams = 1 }]));
            Assert.Equal("Title is required.", ex.Message);
        }
    }

    [Fact]
    public void ValidateDefinition_TitleTooLong_Throws()
    {
        var ex = Assert.Throws<ArgumentOutOfRangeException>(
            () => PrintProjectRules.ValidateDefinition(Repeated("x", 257), null, null,
                [new PrintProjectType { FilamentTypeId = "T1", Grams = 1 }]));
        Assert.Contains("256", ex.Message);
    }

    [Fact]
    public void ValidateDefinition_DescriptionTooLong_Throws()
    {
        var ex = Assert.Throws<ArgumentOutOfRangeException>(
            () => PrintProjectRules.ValidateDefinition("T", Repeated("d", 1025), null,
                [new PrintProjectType { FilamentTypeId = "T1", Grams = 1 }]));
        Assert.Contains("1024", ex.Message);
    }

    [Fact]
    public void ValidateDefinition_UrlTooLong_Throws()
    {
        var ex = Assert.Throws<ArgumentOutOfRangeException>(
            () => PrintProjectRules.ValidateDefinition("T", null, Repeated("u", 1025),
                [new PrintProjectType { FilamentTypeId = "T1", Grams = 1 }]));
        Assert.Contains("1024", ex.Message);
    }

    [Fact]
    public void ValidateDefinition_NoTypes_Throws()
    {
        var ex = Assert.Throws<InvalidOperationException>(
            () => PrintProjectRules.ValidateDefinition("T", null, null, []));
        Assert.Equal("A print project needs at least one filament type.", ex.Message);
    }

    [Fact]
    public void ValidateDefinition_DuplicateType_Throws()
    {
        var ex = Assert.Throws<InvalidOperationException>(
            () => PrintProjectRules.ValidateDefinition("T", null, null,
            [
                new PrintProjectType { FilamentTypeId = "T1", Grams = 1 },
                new PrintProjectType { FilamentTypeId = "T1", Grams = 2 },
            ]));
        Assert.Contains("more than once", ex.Message);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-5)]
    public void ValidateDefinition_NonPositiveGrams_Throws(int grams)
    {
        var ex = Assert.Throws<InvalidOperationException>(
            () => PrintProjectRules.ValidateDefinition("T", null, null,
                [new PrintProjectType { FilamentTypeId = "T1", Grams = grams }]));
        Assert.Contains("positive whole number", ex.Message);
    }

    // ---------------- EnsureNotArchived / EnsureDeletable ----------------

    [Fact]
    public void EnsureNotArchived_Archived_ThrowsWithVerb()
    {
        var p = Project(archived: true, archivedAt: T0.AddDays(1));
        var ex = Assert.Throws<InvalidOperationException>(() => PrintProjectRules.EnsureNotArchived(p, "edited"));
        Assert.Contains("edited", ex.Message);
        Assert.Contains("unarchive", ex.Message);
    }

    [Fact]
    public void EnsureNotArchived_NotArchived_DoesNotThrow()
    {
        PrintProjectRules.EnsureNotArchived(Project(), "edited");
    }

    [Fact]
    public void EnsureDeletable_NotArchived_Throws()
    {
        var ex = Assert.Throws<InvalidOperationException>(
            () => PrintProjectRules.EnsureDeletable(Project(), []));
        Assert.Equal("Only an archived project can be deleted.", ex.Message);
    }

    [Fact]
    public void EnsureDeletable_ArchivedWithEnabledPrint_Throws()
    {
        var p = Project(archived: true, archivedAt: T0.AddDays(1));
        var ex = Assert.Throws<InvalidOperationException>(
            () => PrintProjectRules.EnsureDeletable(p, [Print("PR1", T0)]));
        Assert.Equal("Undo every project print before deleting the project.", ex.Message);
    }

    [Fact]
    public void EnsureDeletable_ArchivedWithOnlyUndonePrints_DoesNotThrow()
    {
        PrintProjectRules.EnsureDeletable(
            Project(archived: true, archivedAt: T0.AddDays(1)),
            [Print("PR1", T0, disabled: true)]);
    }

    // ---------------- PlanPrint ----------------

    [Fact]
    public void PlanPrint_ArchivedProject_Throws()
    {
        var p = Project(archived: true, archivedAt: T0.AddDays(1), types: ("T1", 100));
        var ex = Assert.Throws<InvalidOperationException>(() => PrintProjectRules.PlanPrint(
            p, [new PrintSelection("S1", 100)], [Context("S1")], T0.AddDays(2)));
        Assert.Contains("printed", ex.Message);
    }

    [Fact]
    public void PlanPrint_SelectionCountMismatch_Throws()
    {
        var p = Project(types: [("T1", 100), ("T2", 50)]);
        var ex = Assert.Throws<InvalidOperationException>(() => PrintProjectRules.PlanPrint(
            p, [new PrintSelection("S1", 100)], [Context("S1")], T0));
        Assert.Contains("exactly one spool", ex.Message);
    }

    [Fact]
    public void PlanPrint_EmptySpoolId_Throws()
    {
        var p = Project(types: ("T1", 100));
        var ex = Assert.Throws<InvalidOperationException>(() => PrintProjectRules.PlanPrint(
            p, [new PrintSelection("  ", 100)], [Context("S1")], T0));
        Assert.Contains("every filament type", ex.Message);
    }

    [Fact]
    public void PlanPrint_GramsBelowOne_Throws()
    {
        var p = Project(types: ("T1", 100));
        var ex = Assert.Throws<InvalidOperationException>(() => PrintProjectRules.PlanPrint(
            p, [new PrintSelection("S1", 0)], [Context("S1")], T0));
        Assert.Contains("at least 1 g", ex.Message);
    }

    [Fact]
    public void PlanPrint_UnknownSpool_Throws()
    {
        var p = Project(types: ("T1", 100));
        var ex = Assert.Throws<InvalidOperationException>(() => PrintProjectRules.PlanPrint(
            p, [new PrintSelection("S9", 100)], [Context("S1")], T0));
        Assert.Contains("not found", ex.Message);
    }

    [Fact]
    public void PlanPrint_OpenSpool_RecordsConsumptionWithProjectName()
    {
        var p = Project(types: ("T1", 120));
        var context = Context("S1", SpoolStatus.Open);
        var plans = PrintProjectRules.PlanPrint(p, [new PrintSelection("S1", 120)], [context], T0.AddHours(5));

        var plan = Assert.Single(plans);
        Assert.Equal(SpoolEventKind.Print, plan.EventToAdd!.Kind);
        Assert.Equal(-120, plan.EventToAdd.DeltaGrams);
        Assert.Equal("Benchy", plan.EventToAdd.ProjectName);
        Assert.Equal("https://example.com/benchy", plan.EventToAdd.ProjectUrl);
        Assert.Equal(T0.AddHours(5), plan.EventToAdd.OccurredAt);

        var state = Apply(context.Spool, context.Events.ToList(), plan);
        Assert.Equal(880, state.RemainingGrams);
        Assert.Equal(SpoolStatus.Open, state.Status);
    }

    [Fact]
    public void PlanPrint_SealedSpool_ConsumesAndEvaluationOpensItAtPrintTime()
    {
        var p = Project(types: ("T1", 120));
        var context = Context("S1", SpoolStatus.Sealed);
        var plans = PrintProjectRules.PlanPrint(p, [new PrintSelection("S1", 120)], [context], T0.AddHours(5));

        var plan = Assert.Single(plans);
        Assert.Equal(SpoolEventKind.Print, plan.EventToAdd!.Kind);

        var state = Apply(context.Spool, context.Events.ToList(), plan);
        Assert.Equal(SpoolStatus.Open, state.Status);
        Assert.Equal(T0.AddHours(5), state.OpenedAt);
        Assert.Equal(880, state.RemainingGrams);
    }

    [Fact]
    public void PlanPrint_FinishedSpool_Throws()
    {
        var p = Project(types: ("T1", 120));
        var ex = Assert.Throws<InvalidOperationException>(() => PrintProjectRules.PlanPrint(
            p, [new PrintSelection("S1", 120)], [Context("S1", SpoolStatus.Finished)], T0));
        Assert.Contains("finished", ex.Message);
    }

    [Fact]
    public void PlanPrint_MoreThanRemaining_Throws()
    {
        var p = Project(types: ("T1", 120));
        // Pre-consume 950 g so only 50 g remain, then try to print 120 g.
        var events = new List<SpoolEvent>
        {
            Ev(1, "S1", SpoolEventKind.Created, at: T0),
            Ev(2, "S1", SpoolEventKind.Opened, at: T0.AddHours(1)),
            Ev(3, "S1", SpoolEventKind.Print, -950, at: T0.AddHours(2)),
        };
        var spool = Spool("S1");
        Apply(spool, events, null);
        var context = new SpoolWithEvents(spool, events);

        var ex = Assert.Throws<InvalidOperationException>(() => PrintProjectRules.PlanPrint(
            p, [new PrintSelection("S1", 120)], [context], T0));
        Assert.Contains("only 50g remaining", ex.Message);
    }

    [Fact]
    public void PlanPrint_SameSpoolInTwoSlots_SinglePlanWithSummedGrams()
    {
        var p = Project(types: [("T1", 100), ("T2", 50)]);
        var context = Context("S1");
        var plans = PrintProjectRules.PlanPrint(
            p,
            [new PrintSelection("S1", 100), new PrintSelection("S1", 50)],
            [context], T0);

        var plan = Assert.Single(plans);
        Assert.Equal(-150, plan.EventToAdd!.DeltaGrams);
    }

    [Fact]
    public void PlanPrint_MultipleSpools_PlansInFirstAppearanceOrder()
    {
        var p = Project(types: [("T1", 100), ("T2", 50), ("T3", 10)]);
        var s1 = Context("S1");
        var s2 = Context("S2");
        var s3 = Context("S3");

        var plans = PrintProjectRules.PlanPrint(
            p,
            [new PrintSelection("S3", 10), new PrintSelection("S1", 100), new PrintSelection("S2", 50)],
            [s3, s1, s2], T0);

        Assert.Equal(3, plans.Count);
        Assert.Equal("S3", plans[0].EventToAdd!.SpoolId);
        Assert.Equal("S1", plans[1].EventToAdd!.SpoolId);
        Assert.Equal("S2", plans[2].EventToAdd!.SpoolId);
    }
}
