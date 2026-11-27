using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Filament.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class RestrictPrintProjectTypeFilamentTypeDelete : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_print_project_types_filament_types_FilamentTypeId",
                table: "print_project_types");

            migrationBuilder.AddForeignKey(
                name: "FK_print_project_types_filament_types_FilamentTypeId",
                table: "print_project_types",
                column: "FilamentTypeId",
                principalTable: "filament_types",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_print_project_types_filament_types_FilamentTypeId",
                table: "print_project_types");

            migrationBuilder.AddForeignKey(
                name: "FK_print_project_types_filament_types_FilamentTypeId",
                table: "print_project_types",
                column: "FilamentTypeId",
                principalTable: "filament_types",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }
    }
}
