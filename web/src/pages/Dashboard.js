import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { onChange } from '../realtime/useChangeStream';
export function Dashboard() {
    const [summary, setSummary] = useState(null);
    const [usage, setUsage] = useState([]);
    const load = () => {
        api.dashboard.summary().then(setSummary).catch(console.error);
        api.dashboard.usage(30).then(setUsage).catch(console.error);
    };
    useEffect(() => {
        load();
        return onChange(m => { if (m.resource === 'spool' || m.resource === 'filament-type')
            load(); });
    }, []);
    const maxUsage = Math.max(1, ...usage.map(u => u.consumedGrams));
    return (_jsxs(_Fragment, { children: [_jsx("h1", { children: "Dashboard" }), summary && (_jsxs("div", { className: "grid", children: [_jsx(Stat, { label: "Filament types", value: summary.filamentTypeCount }), _jsx(Stat, { label: "Active spools", value: summary.activeSpoolCount }), _jsx(Stat, { label: "Finished spools", value: summary.finishedSpoolCount }), _jsx(Stat, { label: "Total remaining", value: `${(summary.totalRemainingGrams / 1000).toFixed(2)} kg` })] })), _jsx("h2", { children: "Consumption (last 30 days)" }), _jsx("div", { className: "card", children: usage.length === 0 ? (_jsx("p", { className: "muted", children: "No usage recorded yet." })) : (_jsx("div", { style: { display: 'flex', alignItems: 'flex-end', gap: 4, height: 120 }, children: usage.map(u => (_jsx("div", { title: `${u.day}: ${u.consumedGrams}g`, style: {
                            flex: 1,
                            background: '#2563eb',
                            height: `${(u.consumedGrams / maxUsage) * 100}%`,
                            minHeight: 2,
                            borderRadius: '2px 2px 0 0',
                        } }, u.day))) })) })] }));
}
function Stat({ label, value }) {
    return (_jsxs("div", { className: "card", children: [_jsx("div", { className: "muted", children: label }), _jsx("div", { style: { fontSize: '1.6rem', fontWeight: 700 }, children: value })] }));
}
