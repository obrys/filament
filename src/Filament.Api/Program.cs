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

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<FilamentDbContext>();
    var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();
    try
    {
        await db.Database.MigrateAsync();
    }
    catch (Exception ex)
    {
        logger.LogError(ex, "Database migration failed at startup.");
    }
}

app.Run();

public partial class Program { }
