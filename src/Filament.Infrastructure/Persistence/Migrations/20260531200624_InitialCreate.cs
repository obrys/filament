using System;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Filament.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterDatabase()
                .Annotation("MySql:CharSet", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "filament_types",
                columns: table => new
                {
                    Id = table.Column<string>(type: "varchar(8)", maxLength: 8, nullable: false)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    Brand = table.Column<string>(type: "varchar(64)", maxLength: 64, nullable: false)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    Material = table.Column<string>(type: "varchar(32)", maxLength: 32, nullable: false)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    Type = table.Column<string>(type: "varchar(32)", maxLength: 32, nullable: false)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    Color = table.Column<string>(type: "varchar(64)", maxLength: 64, nullable: false)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    ColorHex = table.Column<string>(type: "varchar(9)", maxLength: 9, nullable: true)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    DefaultNetWeightGrams = table.Column<int>(type: "int", nullable: false),
                    EmptySpoolWeightGrams = table.Column<int>(type: "int", nullable: false),
                    Notes = table.Column<string>(type: "varchar(1024)", maxLength: 1024, nullable: true)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetime(6)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_filament_types", x => x.Id);
                })
                .Annotation("MySql:CharSet", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "spools",
                columns: table => new
                {
                    Id = table.Column<string>(type: "varchar(8)", maxLength: 8, nullable: false)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    FilamentTypeId = table.Column<string>(type: "varchar(8)", maxLength: 8, nullable: false)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    RemainingGrams = table.Column<int>(type: "int", nullable: false),
                    InitialNetGrams = table.Column<int>(type: "int", nullable: false),
                    EmptySpoolWeightGramsOverride = table.Column<int>(type: "int", nullable: true),
                    Status = table.Column<int>(type: "int", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetime(6)", nullable: false),
                    OpenedAt = table.Column<DateTimeOffset>(type: "datetime(6)", nullable: true),
                    FinishedAt = table.Column<DateTimeOffset>(type: "datetime(6)", nullable: true),
                    Notes = table.Column<string>(type: "varchar(1024)", maxLength: 1024, nullable: true)
                        .Annotation("MySql:CharSet", "utf8mb4")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_spools", x => x.Id);
                    table.ForeignKey(
                        name: "FK_spools_filament_types_FilamentTypeId",
                        column: x => x.FilamentTypeId,
                        principalTable: "filament_types",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                })
                .Annotation("MySql:CharSet", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "spool_events",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("MySql:ValueGenerationStrategy", MySqlValueGenerationStrategy.IdentityColumn),
                    SpoolId = table.Column<string>(type: "varchar(8)", maxLength: 8, nullable: false)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    Kind = table.Column<int>(type: "int", nullable: false),
                    DeltaGrams = table.Column<int>(type: "int", nullable: false),
                    RemainingAfterGrams = table.Column<int>(type: "int", nullable: false),
                    ProjectName = table.Column<string>(type: "varchar(256)", maxLength: 256, nullable: true)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    ProjectUrl = table.Column<string>(type: "varchar(1024)", maxLength: 1024, nullable: true)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    Notes = table.Column<string>(type: "varchar(1024)", maxLength: 1024, nullable: true)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    OccurredAt = table.Column<DateTimeOffset>(type: "datetime(6)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_spool_events", x => x.Id);
                    table.ForeignKey(
                        name: "FK_spool_events_spools_SpoolId",
                        column: x => x.SpoolId,
                        principalTable: "spools",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                })
                .Annotation("MySql:CharSet", "utf8mb4");

            migrationBuilder.CreateIndex(
                name: "IX_filament_types_Brand_Material_Type_Color",
                table: "filament_types",
                columns: new[] { "Brand", "Material", "Type", "Color" });

            migrationBuilder.CreateIndex(
                name: "IX_spool_events_OccurredAt",
                table: "spool_events",
                column: "OccurredAt");

            migrationBuilder.CreateIndex(
                name: "IX_spool_events_SpoolId_OccurredAt",
                table: "spool_events",
                columns: new[] { "SpoolId", "OccurredAt" });

            migrationBuilder.CreateIndex(
                name: "IX_spools_FilamentTypeId",
                table: "spools",
                column: "FilamentTypeId");

            migrationBuilder.CreateIndex(
                name: "IX_spools_Status",
                table: "spools",
                column: "Status");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "spool_events");

            migrationBuilder.DropTable(
                name: "spools");

            migrationBuilder.DropTable(
                name: "filament_types");
        }
    }
}
