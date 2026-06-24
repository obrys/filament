using Filament.Core.Abstractions;
using Filament.Infrastructure.Persistence;
using Filament.Infrastructure.Repositories;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Filament.Infrastructure;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddFilamentInfrastructure(
        this IServiceCollection services, string connectionString)
    {
        services.AddDbContext<FilamentDbContext>(opt =>
            opt.UseMySql(
                connectionString,
                // Fixed server version avoids a blocking DB round-trip at startup
                // (ServerVersion.AutoDetect connects eagerly and fails if the DB is not yet ready).
                new MariaDbServerVersion(new Version(11, 4, 0)),
                mysql => mysql.EnableRetryOnFailure(
                    maxRetryCount: 5,
                    maxRetryDelay: TimeSpan.FromSeconds(5),
                    errorNumbersToAdd: null)));

        services.AddScoped<IFilamentTypeRepository, FilamentTypeRepository>();
        services.AddScoped<ISpoolRepository, SpoolRepository>();
        services.AddScoped<IDashboardRepository, DashboardRepository>();

        return services;
    }
}
