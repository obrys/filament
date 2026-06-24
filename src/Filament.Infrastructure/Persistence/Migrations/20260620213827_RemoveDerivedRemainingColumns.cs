using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Filament.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class RemoveDerivedRemainingColumns : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // These two columns are fully derivable and therefore redundant:
            //   spools.RemainingGrams        == InitialNetGrams + SUM(spool_events.DeltaGrams)
            //   spool_events.RemainingAfterGrams == InitialNetGrams + running SUM(DeltaGrams)
            // The application maintains this invariant on every write, and the source data
            // (InitialNetGrams + DeltaGrams) is retained, so dropping these columns loses no
            // recoverable information. The Down() method below recomputes them exactly, making
            // this migration losslessly reversible.
            migrationBuilder.DropColumn(
                name: "RemainingGrams",
                table: "spools");

            migrationBuilder.DropColumn(
                name: "RemainingAfterGrams",
                table: "spool_events");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "RemainingGrams",
                table: "spools",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "RemainingAfterGrams",
                table: "spool_events",
                type: "int",
                nullable: false,
                defaultValue: 0);

            // Recompute the restored values from the retained delta history so a rollback
            // restores the exact original numbers instead of zeros (MariaDB 10.2+ window function).
            migrationBuilder.Sql(@"
                UPDATE spool_events se
                JOIN (
                    SELECT e.Id AS Id,
                           s.InitialNetGrams + SUM(e.DeltaGrams) OVER (
                               PARTITION BY e.SpoolId
                               ORDER BY e.OccurredAt, e.Id
                               ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS After
                    FROM spool_events e
                    JOIN spools s ON s.Id = e.SpoolId
                ) calc ON calc.Id = se.Id
                SET se.RemainingAfterGrams = calc.After;");

            migrationBuilder.Sql(@"
                UPDATE spools s
                LEFT JOIN (
                    SELECT SpoolId, SUM(DeltaGrams) AS DeltaSum
                    FROM spool_events
                    GROUP BY SpoolId
                ) t ON t.SpoolId = s.Id
                SET s.RemainingGrams = s.InitialNetGrams + COALESCE(t.DeltaSum, 0);");
        }
    }
}
