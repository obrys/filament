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
        // Notify + close every client in PARALLEL with a tight per-socket bound. Doing this
        // sequentially meant a few slow or stuck sockets (e.g. proxied through nginx, or a
        // backgrounded browser tab whose TCP window is closed) could each block for up to a
        // couple of seconds and add up to the host's shutdown timeout. In parallel, the whole
        // teardown is bounded by a single timeout regardless of how many clients are connected.
        var sockets = _sockets.Values.ToArray();
        await Task.WhenAll(Array.ConvertAll(sockets, NotifyAndCloseAsync));

        // Unblock every receive loop so the in-flight WebSocket requests complete immediately
        // and the host doesn't wait on them. This is what actually lets the process exit fast.
        await _shutdownCts.CancelAsync();
    }

    private static async Task NotifyAndCloseAsync(WebSocket sock)
    {
        try
        {
            if (sock.State != WebSocketState.Open)
                return;

            // Tell the client we're going down (so it can show a notice and start polling for
            // the new instance), then send a close frame so well-behaved clients close cleanly.
            using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(750));
            await SendAsync(sock, """{"type":"server-shutdown"}""", cts.Token);
            await sock.CloseOutputAsync(
                WebSocketCloseStatus.EndpointUnavailable, "Server restarting", cts.Token);
        }
        catch
        {
            // Best effort — the client may already be gone or too slow to drain. The
            // receive-loop cancellation in ShutdownAsync guarantees the request still ends.
        }
    }

    public void Dispose() => _shutdownCts.Dispose();
}
