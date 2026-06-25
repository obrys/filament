namespace Filament.Api.Realtime;

internal static partial class ChangeBrokerLog
{
    [LoggerMessage(
        EventId = 1000,
        Level = LogLevel.Information,
        Message = "WS client connected: {Id} ({Count} total)")]
    public static partial void ClientConnected(ILogger logger, Guid id, int count);

    [LoggerMessage(
        EventId = 1001,
        Level = LogLevel.Warning,
        Message = "WS client {Id} error")]
    public static partial void ClientError(ILogger logger, Guid id, Exception exception);

    [LoggerMessage(
        EventId = 1003,
        Level = LogLevel.Debug,
        Message = "WS client {Id} closed abruptly: {Reason}")]
    public static partial void ClientClosedAbruptly(ILogger logger, Guid id, string reason);

    [LoggerMessage(
        EventId = 1002,
        Level = LogLevel.Information,
        Message = "WS client disconnected: {Id} ({Count} total)")]
    public static partial void ClientDisconnected(ILogger logger, Guid id, int count);
}
