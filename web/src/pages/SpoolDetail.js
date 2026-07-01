import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import { onChange } from '../realtime/useChangeStream';
/** Below this fraction of the initial net weight, the Finish action is visually promoted. */
const LOW_FRACTION = 0.05;
export function SpoolDetail() {
    const { id = '' } = useParams();
    const [spool, setSpool] = useState(null);
    const [type, setType] = useState(null);
    const [events, setEvents] = useState([]);
    const load = async () => {
        try {
            const s = await api.spools.get(id);
            setSpool(s);
            setType(await api.types.get(s.filamentTypeId));
            setEvents(await api.spools.events(id));
        }
        catch (e) {
            console.error(e);
        }
    };
    useEffect(() => {
        load();
        return onChange(m => { if (m.resource === 'spool' && (!m.id || m.id === id))
            load(); });
    }, [id]);
    if (!spool || !type)
        return _jsx("p", { children: "Loading\u2026" });
    const act = async (fn) => {
        try {
            await fn();
            await load();
        }
        catch (err) {
            alert(err.message);
        }
    };
    const lowOnFilament = spool.remainingGrams <= spool.initialNetGrams * LOW_FRACTION;
    // The active (enabled) Finish event, if any — undoing it reopens the spool.
    const activeFinish = events.find(e => e.kind === 'Finished' && !e.isDisabled);
    return (_jsxs(_Fragment, { children: [_jsx("p", { children: _jsx(Link, { to: "/spools", children: "\u2190 All spools" }) }), _jsxs("h1", { children: [type.colorHex && _jsx("span", { className: "swatch", style: { background: type.colorHex } }), ' ', type.brand, " ", type.material, " \u00B7 ", type.color, " ", _jsx("span", { className: "id-pill", children: spool.id })] }), _jsxs("div", { className: "card", children: [_jsxs("div", { children: [_jsx("strong", { children: "Remaining:" }), " ", spool.remainingGrams, " g (initial ", spool.initialNetGrams, " g)"] }), _jsxs("div", { children: [_jsx("strong", { children: "Total weight (incl. spool):" }), " ", spool.totalWeightGrams, " g"] }), _jsxs("div", { children: [_jsx("strong", { children: "Empty spool:" }), " ", spool.effectiveEmptySpoolGrams, " g ", spool.emptySpoolWeightGramsOverride && _jsx("span", { className: "muted", children: "(override)" })] }), _jsxs("div", { children: [_jsx("strong", { children: "Status:" }), " ", spool.status] }), spool.openedAt && _jsxs("div", { className: "muted", children: ["Opened ", new Date(spool.openedAt).toLocaleString()] }), spool.finishedAt && _jsxs("div", { className: "muted", children: ["Finished ", new Date(spool.finishedAt).toLocaleString()] })] }), spool.status === 'Sealed' && (_jsxs("div", { className: "card", children: [_jsx("p", { style: { marginTop: 0 }, children: "This spool is sealed. Open it to start recording prints." }), _jsx("button", { onClick: () => act(() => api.spools.open(spool.id)), children: "Open spool" })] })), spool.status === 'Open' && (_jsxs(_Fragment, { children: [_jsx(ConsumeForm, { spoolId: spool.id, onDone: load, max: spool.remainingGrams }), _jsx(AdjustForm, { spoolId: spool.id, onDone: load }), _jsxs("div", { className: "card", children: [_jsx("h2", { style: { marginTop: 0 }, children: "Finish spool" }), _jsx("p", { className: "muted", style: { marginTop: 0 }, children: lowOnFilament
                                    ? 'This spool looks nearly empty — mark it finished when done.'
                                    : 'Mark this spool as finished. This does not change the remaining weight.' }), _jsx("button", { className: lowOnFilament ? 'nudge' : 'ghost', onClick: () => act(() => api.spools.finish(spool.id)), children: "Finish spool" })] })] })), spool.status === 'Finished' && activeFinish && (_jsxs("div", { className: "card", children: [_jsx("p", { style: { marginTop: 0 }, children: "This spool is finished." }), _jsx("button", { className: "ghost", onClick: () => act(() => api.spools.disableEvent(spool.id, activeFinish.id)), children: "Reopen spool" })] })), _jsx("h2", { children: "History" }), _jsx("div", { className: "card", style: { padding: 0, overflowX: 'auto' }, children: _jsxs("table", { children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "When" }), _jsx("th", { children: "Kind" }), _jsx("th", { children: "\u0394" }), _jsx("th", { children: "After" }), _jsx("th", { children: "Project" }), _jsx("th", { children: "Notes" }), _jsx("th", {})] }) }), _jsx("tbody", { children: events.map(e => (_jsxs("tr", { className: e.isDisabled ? 'event-disabled' : undefined, children: [_jsx("td", { "data-label": "When", children: new Date(e.occurredAt).toLocaleString() }), _jsx("td", { "data-label": "Kind", children: e.kind }), _jsxs("td", { "data-label": "\u0394", children: [e.deltaGrams > 0 ? '+' : '', e.deltaGrams, " g"] }), _jsx("td", { "data-label": "After", children: e.remainingAfterGrams === null ? '—' : `${e.remainingAfterGrams} g` }), _jsx("td", { "data-label": "Project", children: e.projectUrl
                                            ? _jsx("a", { href: e.projectUrl, target: "_blank", rel: "noreferrer", children: e.projectName ?? e.projectUrl })
                                            : (e.projectName ?? '') }), _jsx("td", { "data-label": "Notes", children: e.notes ?? '' }), _jsx("td", { "data-label": "", children: e.kind !== 'Created' && (e.isDisabled
                                            ? _jsx("button", { className: "link", onClick: () => act(() => api.spools.enableEvent(spool.id, e.id)), children: "Redo" })
                                            : _jsx("button", { className: "link", onClick: () => act(() => api.spools.disableEvent(spool.id, e.id)), children: "Undo" })) })] }, e.id))) })] }) })] }));
}
function ConsumeForm({ spoolId, onDone, max }) {
    const [grams, setGrams] = useState(0);
    const [projectName, setProjectName] = useState('');
    const [projectUrl, setProjectUrl] = useState('');
    const submit = async (e) => {
        e.preventDefault();
        try {
            await api.spools.consume(spoolId, { grams, projectName: projectName || undefined, projectUrl: projectUrl || undefined });
            setGrams(0);
            setProjectName('');
            setProjectUrl('');
            onDone();
        }
        catch (err) {
            alert(err.message);
        }
    };
    return (_jsxs("form", { className: "card", onSubmit: submit, children: [_jsx("h2", { style: { marginTop: 0 }, children: "Record a print" }), _jsxs("div", { className: "grid", children: [_jsxs("label", { children: ["Grams used (max ", max, ")", _jsx("input", { type: "number", min: 1, max: max, required: true, value: grams || '', onChange: e => setGrams(+e.target.value) })] }), _jsxs("label", { children: ["Project name", _jsx("input", { value: projectName, onChange: e => setProjectName(e.target.value) })] }), _jsxs("label", { children: ["Project URL", _jsx("input", { value: projectUrl, onChange: e => setProjectUrl(e.target.value) })] })] }), _jsx("button", { type: "submit", disabled: !grams || grams > max, style: { marginTop: '0.5rem' }, children: "Consume" })] }));
}
function AdjustForm({ spoolId, onDone }) {
    const [grams, setGrams] = useState('');
    const [notes, setNotes] = useState('');
    const submit = async (e) => {
        e.preventDefault();
        if (grams === '')
            return;
        try {
            await api.spools.adjust(spoolId, { newRemainingGrams: grams, notes: notes || undefined });
            setGrams('');
            setNotes('');
            onDone();
        }
        catch (err) {
            alert(err.message);
        }
    };
    return (_jsxs("form", { className: "card", onSubmit: submit, children: [_jsx("h2", { style: { marginTop: 0 }, children: "Adjust remaining (weighed)" }), _jsxs("div", { className: "grid", children: [_jsxs("label", { children: ["New remaining (g)", _jsx("input", { type: "number", min: 0, required: true, value: grams, onChange: e => setGrams(e.target.value === '' ? '' : +e.target.value) })] }), _jsxs("label", { children: ["Notes", _jsx("input", { value: notes, onChange: e => setNotes(e.target.value) })] })] }), _jsx("button", { type: "submit", className: "ghost", style: { marginTop: '0.5rem' }, children: "Adjust" })] }));
}
