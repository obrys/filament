using Filament.Core.Domain;
using Filament.Core.Services;
using Xunit;

namespace Filament.Core.Tests.Services;

public class SpoolLifecycleTests
{
    private const int Initial = 1000;
    private static readonly DateTimeOffset T0 = new(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);

    private static SpoolEvent Ev(long id, SpoolEventKind kind, int delta = 0, double hours = 0, bool disabled = false) => new()
    {
        Id = id,
        SpoolId = "AAAA",
        Kind = kind,
        DeltaGrams = delta,
        IsDisabled = disabled,
        OccurredAt = T0.AddHours(hours),
    };

    // Mimics the repository: apply a plan to the event list, then re-evaluate.
    private static (List<SpoolEvent> Events, SpoolState State) Apply(List<SpoolEvent> events, LifecyclePlan plan)
    {
        var list = events.Select(e => Copy(e)).ToList();
        if (plan.EventToAdd is { } add)
        {
            var nextId = (list.Count == 0 ? 0 : list.Max(e => e.Id)) + 1;
            list.Add(Copy(add, nextId));
        }
        if (plan.EventToEnable is { } en) list.First(e => e.Id == en).IsDisabled = false;
        if (plan.EventToDisable is { } di) list.First(e => e.Id == di).IsDisabled = true;
        return (list, SpoolLifecycle.Evaluate(Initial, list));
    }

    private static SpoolEvent Copy(SpoolEvent e) => Copy(e, e.Id);
    private static SpoolEvent Copy(SpoolEvent e, long id) => new()
    {
        Id = id,
        SpoolId = e.SpoolId,
        Kind = e.Kind,
        DeltaGrams = e.DeltaGrams,
        ProjectName = e.ProjectName,
        ProjectUrl = e.ProjectUrl,
        Notes = e.Notes,
        IsDisabled = e.IsDisabled,
        OccurredAt = e.OccurredAt,
    };

    // ---------------- Evaluate ----------------

    [Fact]
    public void Evaluate_OnlyCreated_IsSealed()
    {
        var state = SpoolLifecycle.Evaluate(Initial, new[] { Ev(1, SpoolEventKind.Created) });
        Assert.Equal(SpoolStatus.Sealed, state.Status);
        Assert.Equal(1000, state.RemainingGrams);
        Assert.Null(state.OpenedAt);
        Assert.Null(state.FinishedAt);
    }

    [Fact]
    public void Evaluate_OpenedEvent_TransitionsToOpenAndSetsOpenedAt()
    {
        var state = SpoolLifecycle.Evaluate(Initial, new[]
        {
            Ev(1, SpoolEventKind.Created),
            Ev(2, SpoolEventKind.Opened, hours: 1),
        });
        Assert.Equal(SpoolStatus.Open, state.Status);
        Assert.Equal(T0.AddHours(1), state.OpenedAt);
    }

    [Fact]
    public void Evaluate_PrintWithoutOpen_ImpliesOpen()
    {
        var state = SpoolLifecycle.Evaluate(Initial, new[]
        {
            Ev(1, SpoolEventKind.Created),
            Ev(2, SpoolEventKind.Print, -50, hours: 1),
        });
        Assert.Equal(SpoolStatus.Open, state.Status);
        Assert.Equal(950, state.RemainingGrams);
    }

    [Fact]
    public void Evaluate_SameInstantOpenAndPrint_OrdersOpenFirst()
    {
        // Legacy auto-open stamped OpenedAt == first print time. Kind tie-break must sort Open first.
        var state = SpoolLifecycle.Evaluate(Initial, new[]
        {
            Ev(5, SpoolEventKind.Print, -50, hours: 1),
            Ev(6, SpoolEventKind.Opened, hours: 1),
        });
        Assert.Equal(SpoolStatus.Open, state.Status);
        Assert.Equal(T0.AddHours(1), state.OpenedAt);
        Assert.Equal(950, state.RemainingGrams);
    }

    [Fact]
    public void Evaluate_FinishedEvent_IsFinished()
    {
        var state = SpoolLifecycle.Evaluate(Initial, new[]
        {
            Ev(1, SpoolEventKind.Opened, hours: 0),
            Ev(2, SpoolEventKind.Print, -50, hours: 1),
            Ev(3, SpoolEventKind.Finished, hours: 2),
        });
        Assert.Equal(SpoolStatus.Finished, state.Status);
        Assert.Equal(T0.AddHours(2), state.FinishedAt);
        Assert.Equal(950, state.RemainingGrams);
    }

    [Fact]
    public void Evaluate_DisabledEvents_AreIgnored()
    {
        var state = SpoolLifecycle.Evaluate(Initial, new[]
        {
            Ev(1, SpoolEventKind.Opened, hours: 0),
            Ev(2, SpoolEventKind.Print, -50, hours: 1, disabled: true),
        });
        Assert.Equal(SpoolStatus.Open, state.Status);
        Assert.Equal(1000, state.RemainingGrams);
    }

    [Fact]
    public void Evaluate_BelowZero_IsAllowedAndDoesNotAutoFinish()
    {
        var state = SpoolLifecycle.Evaluate(Initial, new[]
        {
            Ev(1, SpoolEventKind.Opened, hours: 0),
            Ev(2, SpoolEventKind.Print, -1200, hours: 1),
        });
        Assert.Equal(SpoolStatus.Open, state.Status);
        Assert.Equal(-200, state.RemainingGrams);
    }

    // ---------------- Open ----------------

    [Fact]
    public void PlanOpen_FromSealed_OpensSpool()
    {
        var events = new List<SpoolEvent> { Ev(1, SpoolEventKind.Created) };
        var plan = SpoolLifecycle.PlanOpen("AAAA", Initial, events);
        Assert.NotNull(plan.EventToAdd);
        Assert.Equal(SpoolEventKind.Opened, plan.EventToAdd!.Kind);
        var (_, state) = Apply(events, plan);
        Assert.Equal(SpoolStatus.Open, state.Status);
    }

    [Fact]
    public void PlanOpen_AlreadyOpen_Throws()
    {
        var events = new List<SpoolEvent> { Ev(1, SpoolEventKind.Opened) };
        Assert.Throws<InvalidOperationException>(() => SpoolLifecycle.PlanOpen("AAAA", Initial, events));
    }

    [Fact]
    public void PlanOpen_WithUndoneOpenEvent_ReenablesItInsteadOfAdding()
    {
        var events = new List<SpoolEvent>
        {
            Ev(1, SpoolEventKind.Created),
            Ev(2, SpoolEventKind.Opened, hours: 1, disabled: true),
        };
        var plan = SpoolLifecycle.PlanOpen("AAAA", Initial, events);
        Assert.Null(plan.EventToAdd);
        Assert.Equal(2, plan.EventToEnable);
        var (_, state) = Apply(events, plan);
        Assert.Equal(SpoolStatus.Open, state.Status);
    }

    // ---------------- Consume ----------------

    [Fact]
    public void PlanConsume_WhenSealed_Throws()
    {
        var events = new List<SpoolEvent> { Ev(1, SpoolEventKind.Created) };
        var ex = Assert.Throws<InvalidOperationException>(
            () => SpoolLifecycle.PlanConsume("AAAA", Initial, events, 50));
        Assert.Contains("Open the spool", ex.Message);
    }

    [Fact]
    public void PlanConsume_WhenOpen_RecordsNegativePrint()
    {
        var events = new List<SpoolEvent> { Ev(1, SpoolEventKind.Opened) };
        var plan = SpoolLifecycle.PlanConsume("AAAA", Initial, events, 50, "Bracket");
        Assert.Equal(SpoolEventKind.Print, plan.EventToAdd!.Kind);
        Assert.Equal(-50, plan.EventToAdd.DeltaGrams);
        var (_, state) = Apply(events, plan);
        Assert.Equal(950, state.RemainingGrams);
    }

    [Fact]
    public void PlanConsume_MoreThanRemaining_Throws()
    {
        var events = new List<SpoolEvent>
        {
            Ev(1, SpoolEventKind.Opened),
            Ev(2, SpoolEventKind.Print, -970, hours: 1),
        };
        Assert.Throws<InvalidOperationException>(() => SpoolLifecycle.PlanConsume("AAAA", Initial, events, 50));
    }

    [Fact]
    public void PlanConsume_NonPositive_Throws()
    {
        var events = new List<SpoolEvent> { Ev(1, SpoolEventKind.Opened) };
        Assert.Throws<ArgumentOutOfRangeException>(() => SpoolLifecycle.PlanConsume("AAAA", Initial, events, 0));
        Assert.Throws<ArgumentOutOfRangeException>(() => SpoolLifecycle.PlanConsume("AAAA", Initial, events, -5));
    }

    [Fact]
    public void PlanConsume_WhenFinished_Throws()
    {
        var events = new List<SpoolEvent>
        {
            Ev(1, SpoolEventKind.Opened),
            Ev(2, SpoolEventKind.Finished, hours: 1),
        };
        var ex = Assert.Throws<InvalidOperationException>(
            () => SpoolLifecycle.PlanConsume("AAAA", Initial, events, 10));
        Assert.Contains("finished", ex.Message);
    }

    // ---------------- Adjust ----------------

    [Fact]
    public void PlanAdjust_WhenOpen_RecordsDeltaToTarget()
    {
        var events = new List<SpoolEvent>
        {
            Ev(1, SpoolEventKind.Opened),
            Ev(2, SpoolEventKind.Print, -200, hours: 1),
        };
        var plan = SpoolLifecycle.PlanAdjust("AAAA", Initial, events, 750);
        Assert.Equal(SpoolEventKind.Adjustment, plan.EventToAdd!.Kind);
        Assert.Equal(-50, plan.EventToAdd.DeltaGrams);
        var (_, state) = Apply(events, plan);
        Assert.Equal(750, state.RemainingGrams);
    }

    [Fact]
    public void PlanAdjust_Negative_Throws()
    {
        var events = new List<SpoolEvent> { Ev(1, SpoolEventKind.Opened) };
        Assert.Throws<ArgumentOutOfRangeException>(() => SpoolLifecycle.PlanAdjust("AAAA", Initial, events, -1));
    }

    [Fact]
    public void PlanAdjust_WhenSealed_Throws()
    {
        var events = new List<SpoolEvent> { Ev(1, SpoolEventKind.Created) };
        Assert.Throws<InvalidOperationException>(() => SpoolLifecycle.PlanAdjust("AAAA", Initial, events, 500));
    }

    // ---------------- Finish ----------------

    [Fact]
    public void PlanFinish_WhenOpen_AddsZeroDeltaMarkerAndKeepsWeight()
    {
        var events = new List<SpoolEvent>
        {
            Ev(1, SpoolEventKind.Opened),
            Ev(2, SpoolEventKind.Print, -300, hours: 1),
        };
        var plan = SpoolLifecycle.PlanFinish("AAAA", Initial, events);
        Assert.Equal(SpoolEventKind.Finished, plan.EventToAdd!.Kind);
        Assert.Equal(0, plan.EventToAdd.DeltaGrams);
        var (_, state) = Apply(events, plan);
        Assert.Equal(SpoolStatus.Finished, state.Status);
        Assert.Equal(700, state.RemainingGrams);
    }

    [Fact]
    public void PlanFinish_WhenSealed_Throws()
    {
        var events = new List<SpoolEvent> { Ev(1, SpoolEventKind.Created) };
        Assert.Throws<InvalidOperationException>(() => SpoolLifecycle.PlanFinish("AAAA", Initial, events));
    }

    [Fact]
    public void PlanFinish_WithUndoneFinish_ReenablesIt()
    {
        var events = new List<SpoolEvent>
        {
            Ev(1, SpoolEventKind.Opened),
            Ev(2, SpoolEventKind.Finished, hours: 1, disabled: true),
        };
        var plan = SpoolLifecycle.PlanFinish("AAAA", Initial, events);
        Assert.Null(plan.EventToAdd);
        Assert.Equal(2, plan.EventToEnable);
    }

    // ---------------- Undo / redo (SetEnabled) ----------------

    [Fact]
    public void PlanSetEnabled_DisableCreated_Throws()
    {
        var events = new List<SpoolEvent> { Ev(1, SpoolEventKind.Created) };
        Assert.Throws<InvalidOperationException>(() => SpoolLifecycle.PlanSetEnabled(events, 1, enabled: false));
    }

    [Fact]
    public void PlanSetEnabled_DisablePrint_RestoresWeight()
    {
        var events = new List<SpoolEvent>
        {
            Ev(1, SpoolEventKind.Opened),
            Ev(2, SpoolEventKind.Print, -50, hours: 1),
        };
        var plan = SpoolLifecycle.PlanSetEnabled(events, 2, enabled: false);
        Assert.Equal(2, plan.EventToDisable);
        var (_, state) = Apply(events, plan);
        Assert.Equal(1000, state.RemainingGrams);
        Assert.Equal(SpoolStatus.Open, state.Status);
    }

    [Fact]
    public void PlanSetEnabled_DisableOpen_WithActiveWork_Throws()
    {
        var events = new List<SpoolEvent>
        {
            Ev(1, SpoolEventKind.Opened),
            Ev(2, SpoolEventKind.Print, -50, hours: 1),
        };
        Assert.Throws<InvalidOperationException>(() => SpoolLifecycle.PlanSetEnabled(events, 1, enabled: false));
    }

    [Fact]
    public void PlanSetEnabled_DisableOpen_WithNoWork_ReturnsToSealed()
    {
        var events = new List<SpoolEvent>
        {
            Ev(1, SpoolEventKind.Created),
            Ev(2, SpoolEventKind.Opened, hours: 1),
        };
        var plan = SpoolLifecycle.PlanSetEnabled(events, 2, enabled: false);
        var (_, state) = Apply(events, plan);
        Assert.Equal(SpoolStatus.Sealed, state.Status);
    }

    [Fact]
    public void PlanSetEnabled_EnablePrint_WhileOpenDisabled_Throws()
    {
        var events = new List<SpoolEvent>
        {
            Ev(1, SpoolEventKind.Opened, disabled: true),
            Ev(2, SpoolEventKind.Print, -50, hours: 1, disabled: true),
        };
        var ex = Assert.Throws<InvalidOperationException>(
            () => SpoolLifecycle.PlanSetEnabled(events, 2, enabled: true));
        Assert.Contains("Open the spool", ex.Message);
    }

    [Fact]
    public void PlanSetEnabled_ReenablePrint_AfterUndo_ReappliesEffect()
    {
        var events = new List<SpoolEvent>
        {
            Ev(1, SpoolEventKind.Opened),
            Ev(2, SpoolEventKind.Print, -50, hours: 1, disabled: true),
        };
        var plan = SpoolLifecycle.PlanSetEnabled(events, 2, enabled: true);
        Assert.Equal(2, plan.EventToEnable);
        var (_, state) = Apply(events, plan);
        Assert.Equal(950, state.RemainingGrams);
    }

    [Fact]
    public void PlanSetEnabled_UndoFinish_ReturnsToOpen()
    {
        var events = new List<SpoolEvent>
        {
            Ev(1, SpoolEventKind.Opened),
            Ev(2, SpoolEventKind.Finished, hours: 1),
        };
        var plan = SpoolLifecycle.PlanSetEnabled(events, 2, enabled: false);
        var (_, state) = Apply(events, plan);
        Assert.Equal(SpoolStatus.Open, state.Status);
        Assert.Null(state.FinishedAt);
    }

    // ---------------- LastUsedAt (AC-9, AC-10, AC-11) ----------------

    [Fact]
    public void Evaluate_SetsLastUsedAtToMostRecentEnabledEvent()
    {
        var state = SpoolLifecycle.Evaluate(Initial, new[]
        {
            Ev(1, SpoolEventKind.Created, hours: 0),
            Ev(2, SpoolEventKind.Opened, hours: 1),
            Ev(3, SpoolEventKind.Print, -50, hours: 2),
        });
        Assert.Equal(T0.AddHours(2), state.LastUsedAt);
    }

    [Fact]
    public void Evaluate_CreatedOnly_SetsLastUsedAtToCreatedEventOccurredAt()
    {
        var state = SpoolLifecycle.Evaluate(Initial, new[] { Ev(1, SpoolEventKind.Created, hours: 3) });
        Assert.Equal(T0.AddHours(3), state.LastUsedAt);
    }

    [Fact]
    public void Evaluate_DisabledEvents_AreIgnoredForLastUsedAt()
    {
        // The most recent enabled event is the Open at h=1; the disabled Print at h=2 is ignored.
        var state = SpoolLifecycle.Evaluate(Initial, new[]
        {
            Ev(1, SpoolEventKind.Created, hours: 0),
            Ev(2, SpoolEventKind.Opened, hours: 1),
            Ev(3, SpoolEventKind.Print, -50, hours: 2, disabled: true),
        });
        Assert.Equal(T0.AddHours(1), state.LastUsedAt);
    }

    [Fact]
    public void Evaluate_SameInstantOpenAndPrint_LastUsedAtIsThatInstant()
    {
        var state = SpoolLifecycle.Evaluate(Initial, new[]
        {
            Ev(5, SpoolEventKind.Print, -50, hours: 1),
            Ev(6, SpoolEventKind.Opened, hours: 1),
        });
        Assert.Equal(T0.AddHours(1), state.LastUsedAt);
    }

    // ---------------- RunningRemaining ----------------

    [Fact]
    public void RunningRemaining_FoldsEnabledInOrder_DisabledAreNull()
    {
        var events = new List<SpoolEvent>
        {
            Ev(1, SpoolEventKind.Created, hours: 0),
            Ev(2, SpoolEventKind.Opened, hours: 1),
            Ev(3, SpoolEventKind.Print, -50, hours: 2),
            Ev(4, SpoolEventKind.Print, -30, hours: 3, disabled: true),
            Ev(5, SpoolEventKind.Print, -20, hours: 4),
        };
        var running = SpoolLifecycle.RunningRemaining(Initial, events);
        Assert.Equal(1000, running[1]);
        Assert.Equal(1000, running[2]);
        Assert.Equal(950, running[3]);
        Assert.Null(running[4]);
        Assert.Equal(930, running[5]);
    }
}
