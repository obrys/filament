import { useEffect, useRef } from 'react';
import { emitServerRestarting } from '../version';
const listeners = new Set();
export function onChange(cb) {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
}
/**
 * Maintains a single WebSocket connection to /ws/changes with:
 *  - automatic reconnect with exponential backoff
 *  - 20s application-level ping so the server knows we're alive (and we know it is)
 *  - cleanup on unmount; no leaked timers or sockets
 */
export function useChangeStream() {
    const ref = useRef({ stopped: false });
    useEffect(() => {
        const state = ref.current;
        state.stopped = false;
        let backoffMs = 1000;
        const connect = () => {
            if (state.stopped)
                return;
            const proto = location.protocol === 'https:' ? 'wss' : 'ws';
            const ws = new WebSocket(`${proto}://${location.host}/ws/changes`);
            state.socket = ws;
            ws.onopen = () => {
                backoffMs = 1000;
                state.pingTimer = window.setInterval(() => {
                    if (ws.readyState === WebSocket.OPEN)
                        ws.send(JSON.stringify({ type: 'ping' }));
                }, 20000);
            };
            ws.onmessage = (ev) => {
                try {
                    const msg = JSON.parse(ev.data);
                    if (msg.type === 'change') {
                        for (const cb of listeners)
                            cb(msg);
                    }
                    else if (msg.type === 'server-shutdown') {
                        // Backend is going down for a redeploy/restart. Let the VersionGate take over:
                        // it polls /api/version and reloads if the returned version changed.
                        emitServerRestarting();
                    }
                }
                catch { /* ignore */ }
            };
            const cleanup = () => {
                if (state.pingTimer) {
                    clearInterval(state.pingTimer);
                    state.pingTimer = undefined;
                }
            };
            ws.onclose = () => {
                cleanup();
                if (state.stopped)
                    return;
                backoffMs = Math.min(backoffMs * 2, 30000);
                state.reconnectTimer = window.setTimeout(connect, backoffMs);
            };
            ws.onerror = () => { try {
                ws.close();
            }
            catch { /* */ } };
        };
        connect();
        return () => {
            state.stopped = true;
            if (state.pingTimer)
                clearInterval(state.pingTimer);
            if (state.reconnectTimer)
                clearTimeout(state.reconnectTimer);
            try {
                state.socket?.close();
            }
            catch { /* */ }
        };
    }, []);
}
