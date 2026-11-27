using System;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Filament.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddPrintProjects : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ProjectPrintId",
                table: "spool_events",
                type: "varchar(36)",
                maxLength: 36,
                nullable: true)
                .Annotation("MySql:CharSet", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "print_projects",
                columns: table => new
                {
                    Id = table.Column<string>(type: "varchar(36)", maxLength: 36, nullable: false)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    Title = table.Column<string>(type: "varchar(256)", maxLength: 256, nullable: false)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    Description = table.Column<string>(type: "varchar(1024)", maxLength: 1024, nullable: true)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    Url = table.Column<string>(type: "varchar(1024)", maxLength: 1024, nullable: true)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    IsArchived = table.Column<bool>(type: "tinyint(1)", nullable: false, defaultValue: false),
                    ArchivedAt = table.Column<DateTimeOffset>(type: "datetime(6)", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetime(6)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_print_projects", x => x.Id);
                })
                .Annotation("MySql:CharSet", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "print_project_types",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("MySql:ValueGenerationStrategy", MySqlValueGenerationStrategy.IdentityColumn),
                    ProjectId = table.Column<string>(type: "varchar(36)", maxLength: 36, nullable: false)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    FilamentTypeId = table.Column<string>(type: "varchar(8)", maxLength: 8, nullable: false)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    Grams = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_print_project_types", x => x.Id);
                    table.ForeignKey(
                        name: "FK_print_project_types_filament_types_FilamentTypeId",
                        column: x => x.FilamentTypeId,
                        principalTable: "filament_types",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_print_project_types_print_projects_ProjectId",
                        column: x => x.ProjectId,
                        principalTable: "print_projects",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                })
                .Annotation("MySql:CharSet", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "project_prints",
                columns: table => new
                {
                    Id = table.Column<string>(type: "varchar(36)", maxLength: 36, nullable: false)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    ProjectId = table.Column<string>(type: "varchar(36)", maxLength: 36, nullable: false)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    OccurredAt = table.Column<DateTimeOffset>(type: "datetime(6)", nullable: false),
                    IsDisabled = table.Column<bool>(type: "tinyint(1)", nullable: false, defaultValue: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_project_prints", x => x.Id);
                    table.ForeignKey(
                        name: "FK_project_prints_print_projects_ProjectId",
                        column: x => x.ProjectId,
                        principalTable: "print_projects",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                })
                .Annotation("MySql:CharSet", "utf8mb4");

            migrationBuilder.CreateIndex(
                name: "IX_spool_events_ProjectPrintId",
                table: "spool_events",
                column: "ProjectPrintId");

            migrationBuilder.CreateIndex(
                name: "IX_print_project_types_FilamentTypeId",
                table: "print_project_types",
                column: "FilamentTypeId");

            migrationBuilder.CreateIndex(
                name: "IX_print_project_types_ProjectId_FilamentTypeId",
                table: "print_project_types",
                columns: new[] { "ProjectId", "FilamentTypeId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_project_prints_ProjectId_OccurredAt",
                table: "project_prints",
                columns: new[] { "ProjectId", "OccurredAt" });

            migrationBuilder.AddForeignKey(
                name: "FK_spool_events_project_prints_ProjectPrintId",
                table: "spool_events",
                column: "ProjectPrintId",
                principalTable: "project_prints",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_spool_events_project_prints_ProjectPrintId",
                table: "spool_events");

            migrationBuilder.DropTable(
                name: "print_project_types");

            migrationBuilder.DropTable(
                name: "project_prints");

            migrationBuilder.DropTable(
                name: "print_projects");

            migrationBuilder.DropIndex(
                name: "IX_spool_events_ProjectPrintId",
                table: "spool_events");

            migrationBuilder.DropColumn(
                name: "ProjectPrintId",
                table: "spool_events");
        }
    }
}
