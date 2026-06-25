using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Filament.Core.Abstractions;

namespace Filament.Api.Realtime;

/// <summary>
/// Tracks connected WebSocket clients and broadcasts JSON change notifications.
/// Uses application-level ping/pong (every 20 s) so both ends detect dropped connections.
/// </summary>
public sealed class ChangeBroker : IChangeNotifier, IDisposable
{
    private readonly ConcurrentDictionary<Guid, WebSocket> _sockets = new();
    private readonly ILogger<ChangeBroker> _logger;
    private readonly CancellationTokenSource _shutdownCts = new();

    public ChangeBroker(ILogger<ChangeBroker> logger) => _logger = logger;

    public async Task HandleAsync(WebSocket socket, CancellationToken ct)
    {
        var id = Guid.NewGuid();
        _sockets[id] = socket;
        ChangeBrokerLog.ClientConnected(_logger, id, _sockets.Count);
        // Cancel the receive loop either when the client aborts or when the server shuts down.
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, _shutdownCts.Token);
        var token = linked.Token;
        try
        {
            var buf = new byte[1024];
            while (socket.State == WebSocketState.Open && !token.IsCancellationRequested)
            {
                var result = await socket.ReceiveAsync(buf, token);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, null, token);
                    break;
                }
                // Treat any text frame as a keep-alive ping; reply with pong.
                if (result.MessageType == WebSocketMessageType.Text)
                {
                    var msg = Encoding.UTF8.GetString(buf, 0, result.Count);
                    if (msg.Contains("ping", StringComparison.OrdinalIgnoreCase))
                        await SendAsync(socket, """{"type":"pong"}""", token);
                }
            }
        }
        catch (OperationCanceledException) { }
        catch (WebSocketException ex)
        {
            // Clients routinely vanish without a close handshake (tab closed, network
            // drop, server restart). That's expected — log it quietly without a stack trace.
            ChangeBrokerLog.ClientClosedAbruptly(_logger, id, ex.Message);
        }
        catch (Exception ex)
        {
            ChangeBrokerLog.ClientError(_logger, id, ex);
        }
        finally
        {
            _sockets.TryRemove(id, out _);
            ChangeBrokerLog.ClientDisconnected(_logger, id, _sockets.Count);
        }
    }

    public async Task NotifyAsync(string resource, string? id, CancellationToken ct = default)
    {
        var payload = JsonSerializer.Serialize(new { type = "change", resource, id });
        var dead = new List<Guid>();
        foreach (var (key, sock) in _sockets)
        {
            try
            {
                if (sock.State == WebSocketState.Open)
                    await SendAsync(sock, payload, ct);
                else
                    dead.Add(key);
            }
            catch
            {
                dead.Add(key);
            }
        }
        foreach (var d in dead) _sockets.TryRemove(d, out _);
    }

    private static Task SendAsync(WebSocket s, string text, CancellationToken ct) =>
        s.SendAsync(Encoding.UTF8.GetBytes(text), WebSocketMessageType.Text, true, ct);

    /// <summary>
    /// Closes all WebSocket connections so the host can shut down promptly instead of
    /// waiting for idle WebSocket requests to drain. Each client is sent a clean close frame
    /// (so it can reconnect) and the receive loops are cancelled.
    /// </summary>
    public async Task ShutdownAsync()
    {
        // Tell every client we're going down so they can show a notice and start polling
        // for the new instance, before we close the sockets out from under them.
        await NotifyShutdownAsync();

        foreach (var (_, sock) in _sockets)
        {
            try
            {
                if (sock.State == WebSocketState.Open)
                {
                    using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(2));
                    await sock.CloseOutputAsync(
                        WebSocketCloseStatus.EndpointUnavailable, "Server restarting", cts.Token);
                }
            }
            catch
            {
                // Best effort — the connection may already be gone.
            }
        }

        // Unblock every receive loop so the in-flight requests complete immediately.
        await _shutdownCts.CancelAsync();
    }

    private async Task NotifyShutdownAsync()
    {
        const string payload = """{"type":"server-shutdown"}""";
        foreach (var (_, sock) in _sockets)
        {
            try
            {
                if (sock.State == WebSocketState.Open)
                {
                    using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(1));
                    await SendAsync(sock, payload, cts.Token);
                }
            }
            catch
            {
                // Best effort — the client may already be gone.
            }
        }
    }

    public void Dispose() => _shutdownCts.Dispose();
}
