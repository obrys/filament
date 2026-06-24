namespace Filament.Api;

/// <summary>
/// Tracks whether the host has begun a graceful shutdown. Once set, the liveness
/// endpoint (<c>/api/version</c>) reports unavailable so polling clients detect the
/// restart and wait for the new instance to come up.
/// </summary>
public sealed class ShutdownState
{
    private volatile bool _shuttingDown;

    public bool IsShuttingDown => _shuttingDown;

    public void MarkShuttingDown() => _shuttingDown = true;
}
