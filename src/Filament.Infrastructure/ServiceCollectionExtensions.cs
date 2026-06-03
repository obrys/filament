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
            opt.UseMySql(connectionString, ServerVersion.AutoDetect(connectionString)));

        services.AddScoped<IFilamentTypeRepository, FilamentTypeRepository>();
        services.AddScoped<ISpoolRepository, SpoolRepository>();
        services.AddScoped<IDashboardRepository, DashboardRepository>();

        return services;
    }
}
