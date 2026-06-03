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
public sealed class ChangeBroker : IChangeNotifier
{
    private readonly ConcurrentDictionary<Guid, WebSocket> _sockets = new();
    private readonly ILogger<ChangeBroker> _logger;

    public ChangeBroker(ILogger<ChangeBroker> logger) => _logger = logger;

    public async Task HandleAsync(WebSocket socket, CancellationToken ct)
    {
        var id = Guid.NewGuid();
        _sockets[id] = socket;
        _logger.LogInformation("WS client connected: {Id} ({Count} total)", id, _sockets.Count);
        try
        {
            var buf = new byte[1024];
            while (socket.State == WebSocketState.Open && !ct.IsCancellationRequested)
            {
                var result = await socket.ReceiveAsync(buf, ct);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, null, ct);
                    break;
                }
                // Treat any text frame as a keep-alive ping; reply with pong.
                if (result.MessageType == WebSocketMessageType.Text)
                {
                    var msg = Encoding.UTF8.GetString(buf, 0, result.Count);
                    if (msg.Contains("ping", StringComparison.OrdinalIgnoreCase))
                        await SendAsync(socket, """{"type":"pong"}""", ct);
                }
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "WS client {Id} error", id);
        }
        finally
        {
            _sockets.TryRemove(id, out _);
            _logger.LogInformation("WS client disconnected: {Id} ({Count} total)", id, _sockets.Count);
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
}
