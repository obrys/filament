using Filament.Infrastructure.Entities;
using Microsoft.EntityFrameworkCore;

namespace Filament.Infrastructure.Persistence;

public sealed class FilamentDbContext : DbContext
{
    public FilamentDbContext(DbContextOptions<FilamentDbContext> options) : base(options) { }

    internal DbSet<FilamentTypeEntity> FilamentTypes => Set<FilamentTypeEntity>();
    internal DbSet<SpoolEntity> Spools => Set<SpoolEntity>();
    internal DbSet<SpoolEventEntity> SpoolEvents => Set<SpoolEventEntity>();

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
            e.HasOne(x => x.Spool)
             .WithMany(s => s.Events)
             .HasForeignKey(x => x.SpoolId)
             .OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(x => new { x.SpoolId, x.OccurredAt });
            e.HasIndex(x => x.OccurredAt);
        });
    }
}
