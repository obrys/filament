using System.Text.Json.Serialization;
using Filament.Api.Pdf;
using Filament.Api.Realtime;
using Filament.Core.Abstractions;
using Filament.Infrastructure;
using Filament.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using QuestPDF.Infrastructure;

QuestPDF.Settings.License = LicenseType.Community;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers()
    .AddJsonOptions(o => o.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter()));

builder.Services.AddOpenApi();
builder.Services.AddEndpointsApiExplorer();

builder.Services.AddCors(o => o.AddDefaultPolicy(p => p
    .AllowAnyHeader()
    .AllowAnyMethod()
    .SetIsOriginAllowed(_ => true)
    .AllowCredentials()));

var connection = builder.Configuration.GetConnectionString("Filament")
    ?? "Server=localhost;Port=3306;Database=filament;User=filament;Password=filament";
builder.Services.AddFilamentInfrastructure(connection);

builder.Services.AddSingleton<ChangeBroker>();
builder.Services.AddSingleton<IChangeNotifier>(sp => sp.GetRequiredService<ChangeBroker>());
builder.Services.AddSingleton<LabelPdfGenerator>();

// Safety net: if anything stalls on shutdown, give up well before the Quadlet's
// TimeoutStopSec (20s) SIGKILLs us, so restarts stay fast and clean.
builder.Services.Configure<HostOptions>(o => o.ShutdownTimeout = TimeSpan.FromSeconds(10));

var app = builder.Build();

if (app.Environment.IsDevelopment())
    app.MapOpenApi();

app.UseCors();

app.UseWebSockets(new WebSocketOptions
{
    KeepAliveInterval = TimeSpan.FromSeconds(20),
});

app.Map("/ws/changes", async (HttpContext ctx, ChangeBroker broker) =>
{
    if (!ctx.WebSockets.IsWebSocketRequest)
    {
        ctx.Response.StatusCode = StatusCodes.Status400BadRequest;
        return;
    }
    using var socket = await ctx.WebSockets.AcceptWebSocketAsync();
    await broker.HandleAsync(socket, ctx.RequestAborted);
});

app.MapControllers();
app.MapGet("/healthz", () => Results.Ok(new { status = "ok" }));

// On graceful shutdown, promptly close all WebSocket connections. Otherwise the host
// blocks waiting for these long-lived, idle requests to drain, which is what made
// restarts take dozens of seconds. Clients reconnect automatically.
var lifetime = app.Services.GetRequiredService<IHostApplicationLifetime>();
var broker = app.Services.GetRequiredService<ChangeBroker>();
lifetime.ApplicationStopping.Register(() => broker.ShutdownAsync().GetAwaiter().GetResult());

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<FilamentDbContext>();
    var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();

    const int maxAttempts = 10;
    for (var attempt = 1; ; attempt++)
    {
        try
        {
            await db.Database.MigrateAsync();
            StartupLog.DatabaseMigrated(logger);
            break;
        }
        catch (Exception ex) when (attempt < maxAttempts)
        {
            StartupLog.DatabaseMigrationRetry(logger, attempt, maxAttempts, ex);
            await Task.Delay(TimeSpan.FromSeconds(3));
        }
        catch (Exception ex)
        {
            StartupLog.DatabaseMigrationFailed(logger, ex);
            // Fail fast: crash so the container restarts (Restart=on-failure) instead of
            // silently serving traffic against an un-migrated schema.
            throw;
        }
    }
}

app.Run();

public partial class Program { }

internal static partial class StartupLog
{
    [LoggerMessage(
        EventId = 1100,
        Level = LogLevel.Error,
        Message = "Database migration failed at startup; aborting.")]
    public static partial void DatabaseMigrationFailed(ILogger logger, Exception exception);

    [LoggerMessage(
        EventId = 1101,
        Level = LogLevel.Warning,
        Message = "Database migration attempt {Attempt}/{MaxAttempts} failed; retrying.")]
    public static partial void DatabaseMigrationRetry(ILogger logger, int attempt, int maxAttempts, Exception exception);

    [LoggerMessage(
        EventId = 1102,
        Level = LogLevel.Information,
        Message = "Database migrations applied successfully.")]
    public static partial void DatabaseMigrated(ILogger logger);
}
