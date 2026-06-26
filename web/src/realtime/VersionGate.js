import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { APP_VERSION, consumeReloadNotice, isDifferentVersion, onServerRestarting, reloadForNewVersion, } from '../version';
/**
 * Coordinates the version-consistency UX:
 *  - When the server announces a restart (WebSocket "server-shutdown"), shows a blocking
 *    overlay and polls /api/version every 5s.
 *  - When the server answers again: a different version forces a reload (with a notice);
 *    the same version simply resumes operation.
 *  - After a version-triggered reload, shows a brief "new version deployed" banner.
 */
export function VersionGate() {
    const [restarting, setRestarting] = useState(false);
    const [notice, setNotice] = useState(false);
    useEffect(() => {
        if (consumeReloadNotice()) {
            setNotice(true);
            const t = window.setTimeout(() => setNotice(false), 6000);
            return () => window.clearTimeout(t);
        }
    }, []);
    useEffect(() => onServerRestarting(() => setRestarting(true)), []);
    useEffect(() => {
        if (!restarting)
            return;
        let cancelled = false;
        const poll = async () => {
            try {
                const res = await fetch('/api/version', { cache: 'no-store' });
                if (!res.ok)
                    return; // still shutting down or not back yet
                const body = await res.json();
                const version = body?.version;
                if (cancelled)
                    return;
                if (isDifferentVersion(version)) {
                    reloadForNewVersion(version);
                }
                else {
                    setRestarting(false); // same version is back online — resume
                }
            }
            catch {
                // Server not reachable yet; keep polling.
            }
        };
        poll();
        const id = window.setInterval(poll, 5000);
        return () => { cancelled = true; window.clearInterval(id); };
    }, [restarting]);
    return (_jsxs(_Fragment, { children: [restarting && (_jsx("div", { className: "version-overlay", role: "alertdialog", "aria-live": "assertive", children: _jsxs("div", { className: "version-overlay__card", children: [_jsx("div", { className: "version-spinner" }), _jsx("h2", { children: "Server is restarting\u2026" }), _jsx("p", { children: "Waiting for the application to come back online." })] }) })), notice && (_jsxs("div", { className: "version-banner", role: "status", children: [_jsxs("span", { children: ["A new version has been deployed", APP_VERSION !== 'dev' ? ` (${APP_VERSION})` : '', "."] }), _jsx("button", { type: "button", onClick: () => setNotice(false), "aria-label": "Dismiss", children: "\u00D7" })] }))] }));
}
