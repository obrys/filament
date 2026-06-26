import { jsx as _jsx } from "react/jsx-runtime";
import { useState, useCallback } from 'react';
import { APP_VERSION } from '../version';
export function VersionBadge() {
    const [state, setState] = useState({ kind: 'collapsed' });
    const handleClick = useCallback(async () => {
        if (state.kind !== 'collapsed') {
            setState({ kind: 'collapsed' });
            return;
        }
        setState({ kind: 'loading' });
        try {
            const res = await fetch('/api/version', { cache: 'no-store' });
            if (!res.ok)
                throw new Error(`HTTP ${res.status}`);
            const body = await res.json();
            const serverVersion = body?.version ?? 'unknown';
            setState({ kind: 'expanded', serverVersion });
        }
        catch {
            setState({ kind: 'error' });
        }
    }, [state.kind]);
    let label;
    if (state.kind === 'collapsed') {
        label = `ver: ${APP_VERSION}`;
    }
    else if (state.kind === 'loading') {
        label = `Client version: ${APP_VERSION}; Server version: …`;
    }
    else if (state.kind === 'expanded') {
        label = `Client version: ${APP_VERSION}; Server version: ${state.serverVersion}`;
    }
    else {
        label = `Client version: ${APP_VERSION}; Server version: unavailable`;
    }
    return (_jsx("button", { type: "button", className: "version-badge", onClick: handleClick, title: state.kind === 'collapsed' ? 'Click to show server version' : 'Click to collapse', "aria-label": "Application version", children: label }));
}
