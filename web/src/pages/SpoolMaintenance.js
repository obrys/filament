import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
export function SpoolMaintenance() {
    const [result, setResult] = useState(null);
    const [running, setRunning] = useState(false);
    const [error, setError] = useState(null);
    const run = async () => {
        setRunning(true);
        setError(null);
        try {
            setResult(await api.spools.reevaluate());
        }
        catch (err) {
            setError(err.message);
        }
        finally {
            setRunning(false);
        }
    };
    return (_jsxs(_Fragment, { children: [_jsx("p", { children: _jsx(Link, { to: "/spools", children: "\u2190 All spools" }) }), _jsx("h1", { children: "Re-evaluate spool states" }), _jsxs("div", { className: "card", children: [_jsx("p", { style: { marginTop: 0 }, children: "Every spool's status and remaining weight are derived from its events and cached on the record. In rare cases \u2014 typically after a manual database intervention \u2014 a cached value can drift from what the events imply. Running a re-evaluation recomputes every spool from its enabled events, saves any corrections, and reports what changed. It is always safe to run." }), _jsx("button", { onClick: run, disabled: running, children: running ? 'Re-evaluating…' : 'Re-evaluate all spools' })] }), error && _jsx("div", { className: "card", style: { color: 'var(--danger, #b00)' }, children: error }), result && (_jsxs("div", { className: "card", children: [_jsxs("p", { style: { marginTop: 0 }, children: ["Checked ", _jsx("strong", { children: result.totalSpools }), " spools \u2014", ' ', _jsx("strong", { children: result.changedSpools }), " corrected."] }), result.changedSpools === 0
                        ? _jsx("p", { className: "muted", children: "Everything was already consistent." })
                        : (_jsx("div", { style: { overflowX: 'auto' }, children: _jsxs("table", { children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Spool" }), _jsx("th", { children: "Status (was \u2192 now)" }), _jsx("th", { children: "Remaining (was \u2192 now)" })] }) }), _jsx("tbody", { children: result.differences.map(d => (_jsxs("tr", { children: [_jsx("td", { "data-label": "Spool", children: _jsx(Link, { to: `/spools/${d.spoolId}`, className: "id-pill", children: d.spoolId }) }), _jsx("td", { "data-label": "Status", children: d.oldStatus === d.newStatus ? d.oldStatus : _jsxs(_Fragment, { children: [d.oldStatus, " \u2192 ", _jsx("strong", { children: d.newStatus })] }) }), _jsx("td", { "data-label": "Remaining", children: d.oldRemainingGrams === d.newRemainingGrams
                                                        ? `${d.oldRemainingGrams} g`
                                                        : _jsxs(_Fragment, { children: [d.oldRemainingGrams, " g \u2192 ", _jsxs("strong", { children: [d.newRemainingGrams, " g"] })] }) })] }, d.spoolId))) })] }) }))] }))] }));
}
