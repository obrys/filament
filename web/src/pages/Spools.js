import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, isSpoolSort } from '../api/client';
import { onChange } from '../realtime/useChangeStream';
import { FilterBar } from '../components/FilterBar';
import { useFacetFilters } from '../hooks/useFacetFilters';
const EMPTY_FACETS = { brand: [], material: [], type: [], color: [] };
const SORT_OPTIONS = [
    { value: 'lastUsed', label: 'Last used' },
    { value: 'leastRemaining', label: 'Least remaining' },
    { value: 'mostRemaining', label: 'Most remaining' },
];
export function Spools() {
    const [params, setParams] = useSearchParams();
    const rawSort = params.get('sort');
    const sort = isSpoolSort(rawSort) ? rawSort : 'lastUsed';
    const [spools, setSpools] = useState([]);
    const [facets, setFacets] = useState(EMPTY_FACETS);
    const [types, setTypes] = useState({});
    const [includeFinished, setIncludeFinished] = useState(false);
    const [selected, setSelected] = useState(new Set());
    const [showForm, setShowForm] = useState(false);
    const { selection, toggleOption, removeOption, clearAll } = useFacetFilters();
    const load = () => {
        api.spools.list({ sort, includeFinished, filters: selection })
            .then(r => { setSpools(r.items); setFacets(r.facets); })
            .catch(console.error);
        // The type map must cover every spool regardless of the active filter, so load all types.
        api.types.list().then(r => setTypes(Object.fromEntries(r.items.map(t => [t.id, t])))).catch(console.error);
    };
    useEffect(() => {
        load();
        return onChange(m => { if (m.resource === 'spool' || m.resource === 'filament-type')
            load(); });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sort, includeFinished, JSON.stringify(selection)]);
    // Normalize the URL to the resolved sort when the value was missing or unrecognized, so the
    // address bar reflects what is displayed. Setting the same value keeps the URL stable otherwise.
    useEffect(() => {
        if (rawSort !== sort) {
            const next = new URLSearchParams(params);
            next.set('sort', sort);
            setParams(next, { replace: true });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sort]);
    const onSortChange = (value) => {
        if (!isSpoolSort(value))
            return;
        const next = new URLSearchParams(params);
        next.set('sort', value);
        setParams(next);
    };
    const toggle = (id) => {
        const next = new Set(selected);
        next.has(id) ? next.delete(id) : next.add(id);
        setSelected(next);
    };
    return (_jsxs(_Fragment, { children: [_jsx("h1", { children: "Spools" }), _jsxs("div", { style: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }, children: [_jsx("button", { onClick: () => setShowForm(s => !s), children: showForm ? 'Close' : 'New spool' }), _jsxs("label", { style: { display: 'flex', alignItems: 'center', gap: '0.25rem', margin: 0, width: 'auto' }, children: [_jsx("input", { type: "checkbox", style: { width: 'auto' }, checked: includeFinished, onChange: e => setIncludeFinished(e.target.checked) }), " Show finished"] }), _jsxs("label", { style: { display: 'flex', alignItems: 'center', gap: '0.25rem', margin: 0, width: 'auto' }, children: ["Sort", _jsx("select", { "aria-label": "Sort", value: sort, onChange: e => onSortChange(e.target.value), children: SORT_OPTIONS.map(o => _jsx("option", { value: o.value, children: o.label }, o.value)) })] }), _jsxs("button", { disabled: selected.size === 0, onClick: () => window.open(api.spools.labelPdfUrl([...selected]), '_blank'), children: ["Print labels (", selected.size, ")"] })] }), showForm && _jsx(NewSpoolForm, { types: Object.values(types), onCreated: () => { setShowForm(false); load(); } }), _jsx(FilterBar, { facets: facets, selection: selection, onToggle: toggleOption, onRemove: removeOption, onClear: clearAll }), _jsx("div", { className: "card", style: { marginTop: '1rem', padding: 0, overflowX: 'auto' }, children: _jsxs("table", { children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", {}), _jsx("th", { children: "ID" }), _jsx("th", { children: "Type" }), _jsx("th", { children: "Remaining" }), _jsx("th", { children: "Status" }), _jsx("th", {})] }) }), _jsx("tbody", { children: spools.map(s => {
                                const t = types[s.filamentTypeId];
                                return (_jsxs("tr", { children: [_jsx("td", { children: _jsx("input", { type: "checkbox", style: { width: 'auto' }, checked: selected.has(s.id), onChange: () => toggle(s.id) }) }), _jsx("td", { "data-label": "ID", children: _jsx(Link, { to: `/spools/${s.id}`, className: "id-pill", children: s.id }) }), _jsx("td", { "data-label": "Type", children: t ? _jsxs(_Fragment, { children: [t.colorHex && _jsx("span", { className: "swatch", style: { background: t.colorHex } }), " ", t.brand, " \u00B7 ", t.material, " \u00B7 ", t.type, " \u00B7 ", t.color] }) : s.filamentTypeId }), _jsx("td", { "data-label": "Remaining", children: s.status === 'Finished'
                                                ? _jsx("abbr", { title: `Actually ${s.remainingGrams} g remaining`, children: "0 g" })
                                                : `${s.remainingGrams} g` }), _jsx("td", { "data-label": "Status", children: s.status }), _jsx("td", {})] }, s.id));
                            }) })] }) }), _jsxs("p", { className: "muted", style: { marginTop: '1rem', fontSize: '0.95rem' }, children: ["Something look off? ", _jsx(Link, { to: "/spools/maintenance", children: "Re-evaluate spool states" }), "."] })] }));
}
function NewSpoolForm({ types, onCreated }) {
    const [filamentTypeId, setFilamentTypeId] = useState(types[0]?.id ?? '');
    const [initialNetGrams, setInitialNetGrams] = useState('');
    const [emptyOverride, setEmptyOverride] = useState('');
    const [notes, setNotes] = useState('');
    const submit = async (e) => {
        e.preventDefault();
        try {
            await api.spools.create({
                filamentTypeId,
                initialNetGrams: initialNetGrams === '' ? undefined : initialNetGrams,
                emptySpoolWeightGramsOverride: emptyOverride === '' ? undefined : emptyOverride,
                notes: notes || undefined,
            });
            onCreated();
        }
        catch (err) {
            alert(err.message);
        }
    };
    return (_jsxs("form", { className: "card", onSubmit: submit, style: { marginTop: '1rem' }, children: [_jsxs("div", { className: "grid", children: [_jsxs("label", { children: ["Filament type", _jsx("select", { value: filamentTypeId, onChange: e => setFilamentTypeId(e.target.value), children: types.map(t => _jsxs("option", { value: t.id, children: [t.id, " \u2014 ", t.brand, " \u00B7 ", t.material, " \u00B7 ", t.type, " \u00B7 ", t.color] }, t.id)) })] }), _jsxs("label", { children: ["Initial net (g, optional)", _jsx("input", { type: "number", value: initialNetGrams, onChange: e => setInitialNetGrams(e.target.value === '' ? '' : +e.target.value) })] }), _jsxs("label", { children: ["Empty spool override (g)", _jsx("input", { type: "number", value: emptyOverride, onChange: e => setEmptyOverride(e.target.value === '' ? '' : +e.target.value) })] }), _jsxs("label", { children: ["Notes", _jsx("input", { value: notes, onChange: e => setNotes(e.target.value) })] })] }), _jsx("button", { type: "submit", disabled: !filamentTypeId, style: { marginTop: '0.5rem' }, children: "Create" })] }));
}
