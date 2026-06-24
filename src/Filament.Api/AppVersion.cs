namespace Filament.Api;

/// <summary>
/// The version identifier of the running backend, baked in at build time from the
/// Git commit SHA (Docker build-arg GIT_COMMIT -> APP_VERSION env). Falls back to
/// "dev" for local runs so development never triggers forced client reloads.
/// </summary>
public static class AppVersion
{
    public static string Current { get; } =
        Environment.GetEnvironmentVariable("APP_VERSION") is { Length: > 0 } v ? v : "dev";
}
