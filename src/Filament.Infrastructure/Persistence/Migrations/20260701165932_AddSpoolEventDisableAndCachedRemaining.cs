using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Filament.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddSpoolEventDisableAndCachedRemaining : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "RemainingGrams",
                table: "spools",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<bool>(
                name: "IsDisabled",
                table: "spool_events",
                type: "tinyint(1)",
                nullable: false,
                defaultValue: false);

            // ---- Legacy data migration (Kind: Created=0, Opened=1, Print=2, Adjustment=3, Finished=4) ----
            // The previous model had no explicit Open event and "auto-finished" a spool by storing the
            // terminal consumption itself as a Finished(4) event carrying the negative delta. The new
            // model treats Open and Finish as pure state markers (delta 0) with consumption always on
            // Print/Adjustment events. We reshape the history so it obeys the new rules with no data loss.

            // 1) Reclassify legacy auto-finish events (a Finished event that actually carried
            //    consumption) back into a Print. Genuine zero-delta finish markers are left intact.
            migrationBuilder.Sql(
                "UPDATE spool_events SET Kind = 2 WHERE Kind = 4 AND DeltaGrams <> 0;");

            // 2) Insert an explicit Open event one second before the first activity (print or
            //    adjustment) of every spool that has any consumption/adjustment history but lacks one.
            //    Anchoring to the earliest Print/Adjustment — not the legacy OpenedAt, which tracked
            //    only the first *print* — guarantees Open precedes an adjustment that happened before
            //    any print, including a spool whose ONLY activity is an adjustment. Such spools were
            //    left Sealed by the old model (Adjust never opened a spool), so we key off the presence
            //    of activity events rather than the cached Status. We also still cover any Open/Finished
            //    spool that somehow has no activity event (fallback: OpenedAt, else creation time).
            migrationBuilder.Sql(@"
                INSERT INTO spool_events (SpoolId, Kind, DeltaGrams, IsDisabled, OccurredAt, Notes)
                SELECT s.Id, 1, 0, 0,
                       COALESCE(
                           (SELECT MIN(e.OccurredAt) - INTERVAL 1 SECOND FROM spool_events e
                            WHERE e.SpoolId = s.Id AND e.Kind IN (2, 3)),
                           s.OpenedAt,
                           s.CreatedAt),
                       'Backfilled by migration: explicit Open event.'
                FROM spools s
                WHERE NOT EXISTS (SELECT 1 FROM spool_events e
                                  WHERE e.SpoolId = s.Id AND e.Kind = 1)
                  AND (s.Status IN (1, 2)
                       OR EXISTS (SELECT 1 FROM spool_events e
                                  WHERE e.SpoolId = s.Id AND e.Kind IN (2, 3)));");

            // 3) Insert an explicit Finish marker at the end of every finished spool that now lacks one
            //    (its former Finished event became a Print in step 1). Timestamp: recorded FinishedAt,
            //    else the latest event, else creation time.
            migrationBuilder.Sql(@"
                INSERT INTO spool_events (SpoolId, Kind, DeltaGrams, IsDisabled, OccurredAt, Notes)
                SELECT s.Id, 4, 0, 0,
                       COALESCE(s.FinishedAt,
                                (SELECT MAX(e.OccurredAt) FROM spool_events e WHERE e.SpoolId = s.Id),
                                s.CreatedAt),
                       'Backfilled by migration: explicit Finish event.'
                FROM spools s
                WHERE s.Status = 2
                  AND NOT EXISTS (SELECT 1 FROM spool_events e
                                  WHERE e.SpoolId = s.Id AND e.Kind = 4);");

            // 4) Correct the cached Status of legacy adjustment-only spools. The old model left a spool
            //    Sealed when it was only ever adjusted (Adjust never opened it), but the new model treats
            //    any activity as implying an Open. Those spools just received an Open event in step 2, so
            //    promote them from Sealed(0) to Open(1). Finished spools (Status 2) are left untouched.
            migrationBuilder.Sql(@"
                UPDATE spools s
                SET s.Status = 1
                WHERE s.Status = 0
                  AND EXISTS (SELECT 1 FROM spool_events e
                              WHERE e.SpoolId = s.Id AND e.Kind = 1 AND e.IsDisabled = 0);");

            // 5) Align each spool's cached OpenedAt with its (enabled) Open event, so the stored value
            //    matches what the app derives from the events. Legacy OpenedAt tracked only the first
            //    print; the Open event now sits one second earlier (and earlier still than a leading
            //    adjustment), so without this the cached timestamp would drift from the derived one.
            migrationBuilder.Sql(@"
                UPDATE spools s
                JOIN (
                    SELECT SpoolId, MIN(OccurredAt) AS OpenAt
                    FROM spool_events WHERE Kind = 1 AND IsDisabled = 0
                    GROUP BY SpoolId
                ) o ON o.SpoolId = s.Id
                SET s.OpenedAt = o.OpenAt;");

            // 6) Seed the cached RemainingGrams from the initial net weight plus the sum of enabled
            //    event deltas (all events are enabled at this point).
            migrationBuilder.Sql(@"
                UPDATE spools s
                LEFT JOIN (
                    SELECT SpoolId, SUM(DeltaGrams) AS DeltaSum
                    FROM spool_events WHERE IsDisabled = 0
                    GROUP BY SpoolId
                ) t ON t.SpoolId = s.Id
                SET s.RemainingGrams = s.InitialNetGrams + COALESCE(t.DeltaSum, 0);");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Remove the synthetic Open/Finish markers this migration added. The step-1 reclassification
            // of legacy auto-finish events is not reversed (the original terminal Finished delta is
            // retained on the Print, so weight history stays intact); the columns are dropped below.
            migrationBuilder.Sql(
                "DELETE FROM spool_events WHERE Kind IN (1, 4) AND DeltaGrams = 0 " +
                "AND Notes IN ('Backfilled by migration: explicit Open event.', " +
                "'Backfilled by migration: explicit Finish event.');");

            migrationBuilder.DropColumn(
                name: "RemainingGrams",
                table: "spools");

            migrationBuilder.DropColumn(
                name: "IsDisabled",
                table: "spool_events");
        }
    }
}
