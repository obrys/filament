using Filament.Infrastructure.Entities;
using Microsoft.EntityFrameworkCore;

namespace Filament.Infrastructure.Persistence;

public sealed class FilamentDbContext : DbContext
{
    public FilamentDbContext(DbContextOptions<FilamentDbContext> options) : base(options) { }

    internal DbSet<FilamentTypeEntity> FilamentTypes => Set<FilamentTypeEntity>();
    internal DbSet<SpoolEntity> Spools => Set<SpoolEntity>();
    internal DbSet<SpoolEventEntity> SpoolEvents => Set<SpoolEventEntity>();
    internal DbSet<PrintProjectEntity> PrintProjects => Set<PrintProjectEntity>();
    internal DbSet<PrintProjectTypeEntity> PrintProjectTypes => Set<PrintProjectTypeEntity>();
    internal DbSet<ProjectPrintEntity> ProjectPrints => Set<ProjectPrintEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<FilamentTypeEntity>(e =>
        {
            e.ToTable("filament_types");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasMaxLength(8);
            e.Property(x => x.Brand).HasMaxLength(64).IsRequired();
            e.Property(x => x.Material).HasMaxLength(32).IsRequired();
            e.Property(x => x.Type).HasMaxLength(32).IsRequired();
            e.Property(x => x.Color).HasMaxLength(64).IsRequired();
            e.Property(x => x.ColorHex).HasMaxLength(9);
            e.Property(x => x.Notes).HasMaxLength(1024);
            e.HasIndex(x => new { x.Brand, x.Material, x.Type, x.Color });
        });

        modelBuilder.Entity<SpoolEntity>(e =>
        {
            e.ToTable("spools");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasMaxLength(8);
            e.Property(x => x.FilamentTypeId).HasMaxLength(8).IsRequired();
            e.Property(x => x.Notes).HasMaxLength(1024);
            e.HasOne(x => x.FilamentType)
             .WithMany(t => t.Spools)
             .HasForeignKey(x => x.FilamentTypeId)
             .OnDelete(DeleteBehavior.Restrict);
            e.HasIndex(x => x.Status);
            e.HasIndex(x => x.FilamentTypeId);
        });
        modelBuilder.Entity<SpoolEventEntity>(e =>
        {
            e.ToTable("spool_events");
            e.HasKey(x => x.Id);
            e.Property(x => x.SpoolId).HasMaxLength(8).IsRequired();
            e.Property(x => x.ProjectName).HasMaxLength(256);
            e.Property(x => x.ProjectUrl).HasMaxLength(1024);
            e.Property(x => x.Notes).HasMaxLength(1024);
            e.Property(x => x.IsDisabled).HasDefaultValue(false);
            e.Property(x => x.ProjectPrintId).HasMaxLength(36);
            e.HasOne(x => x.Spool)
             .WithMany(s => s.Events)
             .HasForeignKey(x => x.SpoolId)
             .OnDelete(DeleteBehavior.Cascade);
            // Restrict: a project print can never be deleted while events still reference it —
            // the project delete flow removes the events first.
            e.HasOne(x => x.ProjectPrint)
             .WithMany(p => p.Events)
             .HasForeignKey(x => x.ProjectPrintId)
             .OnDelete(DeleteBehavior.Restrict);
            e.HasIndex(x => new { x.SpoolId, x.OccurredAt });
            e.HasIndex(x => x.OccurredAt);
            e.HasIndex(x => x.ProjectPrintId);
        });
        modelBuilder.Entity<PrintProjectEntity>(e =>
        {
            e.ToTable("print_projects");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasMaxLength(36);
            e.Property(x => x.Title).HasMaxLength(256).IsRequired();
            e.Property(x => x.Description).HasMaxLength(1024);
            e.Property(x => x.Url).HasMaxLength(1024);
            e.Property(x => x.IsArchived).HasDefaultValue(false);
        });
        modelBuilder.Entity<PrintProjectTypeEntity>(e =>
        {
            e.ToTable("print_project_types");
            e.HasKey(x => x.Id);
            e.Property(x => x.ProjectId).HasMaxLength(36).IsRequired();
            e.Property(x => x.FilamentTypeId).HasMaxLength(8).IsRequired();
            e.HasOne(x => x.Project)
             .WithMany(p => p.Types)
             .HasForeignKey(x => x.ProjectId)
             .OnDelete(DeleteBehavior.Cascade);
            // Restrict: a filament type used by a project definition cannot be deleted — the
            // project must be archived and deleted first (the types repository rejects it with 409).
            e.HasOne(x => x.FilamentType)
             .WithMany()
             .HasForeignKey(x => x.FilamentTypeId)
             .OnDelete(DeleteBehavior.Restrict);
            e.HasIndex(x => new { x.ProjectId, x.FilamentTypeId }).IsUnique();
        });
        modelBuilder.Entity<ProjectPrintEntity>(e =>
        {
            e.ToTable("project_prints");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasMaxLength(36);
            e.Property(x => x.ProjectId).HasMaxLength(36).IsRequired();
            e.Property(x => x.IsDisabled).HasDefaultValue(false);
            e.HasOne(x => x.Project)
             .WithMany(p => p.Prints)
             .HasForeignKey(x => x.ProjectId)
             .OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(x => new { x.ProjectId, x.OccurredAt });
        });
    }
}
