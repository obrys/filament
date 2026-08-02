using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Filament.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddSpoolLastUsedAt : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "LastUsedAt",
                table: "spools",
                type: "datetime(6)",
                nullable: true);

            // Backfill the cached lastUsedAt from each spool's event history: the most recent
            // enabled event's OccurredAt. Every spool has an immutable enabled Created event, so the
            // MAX subquery always returns a row; the COALESCE with CreatedAt is purely defensive.
            // This mirrors what SpoolLifecycle.Evaluate derives, so existing rows become consistent
            // with the cache-writer path (ApplyState) used for all subsequent writes.
            migrationBuilder.Sql(@"
                UPDATE spools s
                LEFT JOIN (
                    SELECT SpoolId, MAX(OccurredAt) AS LastUsed
                    FROM spool_events WHERE IsDisabled = 0
                    GROUP BY SpoolId
                ) t ON t.SpoolId = s.Id
                SET s.LastUsedAt = COALESCE(t.LastUsed, s.CreatedAt);");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "LastUsedAt",
                table: "spools");
        }
    }
}
