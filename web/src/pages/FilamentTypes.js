import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { onChange } from '../realtime/useChangeStream';
import { FilterBar } from '../components/FilterBar';
import { useFacetFilters } from '../hooks/useFacetFilters';
const EMPTY_FACETS = { brand: [], material: [], type: [], color: [] };
export function FilamentTypes() {
    const [types, setTypes] = useState([]);
    const [facets, setFacets] = useState(EMPTY_FACETS);
    const [showForm, setShowForm] = useState(false);
    const { selection, toggleOption, removeOption, clearAll } = useFacetFilters();
    const load = () => api.types.list(selection)
        .then(r => { setTypes(r.items); setFacets(r.facets); })
        .catch(console.error);
    useEffect(() => {
        load();
        return onChange(m => { if (m.resource === 'filament-type')
            load(); });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [JSON.stringify(selection)]);
    return (_jsxs(_Fragment, { children: [_jsx("h1", { children: "Filament Types" }), _jsx("button", { onClick: () => setShowForm(s => !s), children: showForm ? 'Close' : 'New type' }), showForm && _jsx(NewTypeForm, { onCreated: () => { setShowForm(false); load(); } }), _jsx(FilterBar, { facets: facets, selection: selection, onToggle: toggleOption, onRemove: removeOption, onClear: clearAll }), _jsx("div", { className: "card", style: { marginTop: '1rem', padding: 0, overflowX: 'auto' }, children: _jsxs("table", { children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "ID" }), _jsx("th", { children: "Brand" }), _jsx("th", { children: "Material" }), _jsx("th", { children: "Type" }), _jsx("th", { children: "Color" }), _jsx("th", { children: "Net (g)" }), _jsx("th", { children: "Empty (g)" }), _jsx("th", {})] }) }), _jsx("tbody", { children: types.map(t => (_jsxs("tr", { children: [_jsx("td", { "data-label": "ID", children: _jsx("span", { className: "id-pill", children: t.id }) }), _jsx("td", { "data-label": "Brand", children: t.brand }), _jsx("td", { "data-label": "Material", children: t.material }), _jsx("td", { "data-label": "Type", children: t.type }), _jsxs("td", { "data-label": "Color", children: [t.colorHex && _jsx("span", { className: "swatch", style: { background: t.colorHex } }), " ", t.color] }), _jsx("td", { "data-label": "Net", children: t.defaultNetWeightGrams }), _jsx("td", { "data-label": "Empty", children: t.emptySpoolWeightGrams }), _jsx("td", { children: _jsx("button", { className: "ghost", onClick: () => deleteType(t.id, load), children: "Delete" }) })] }, t.id))) })] }) })] }));
}
async function deleteType(id, reload) {
    if (!confirm(`Delete filament type ${id}?`))
        return;
    try {
        await api.types.delete(id);
        reload();
    }
    catch (e) {
        alert(e.message);
    }
}
function NewTypeForm({ onCreated }) {
    const [form, setForm] = useState({
        brand: '', material: 'PLA', type: 'Basic', color: '',
        colorHex: '#888888', defaultNetWeightGrams: 1000, emptySpoolWeightGrams: 200, notes: '',
    });
    const submit = async (e) => {
        e.preventDefault();
        try {
            await api.types.create(form);
            onCreated();
        }
        catch (err) {
            alert(err.message);
        }
    };
    return (_jsxs("form", { className: "card", onSubmit: submit, style: { marginTop: '1rem' }, children: [_jsxs("div", { className: "grid", children: [_jsxs("label", { children: ["Brand", _jsx("input", { required: true, value: form.brand, onChange: e => setForm({ ...form, brand: e.target.value }) })] }), _jsxs("label", { children: ["Material", _jsx("input", { required: true, value: form.material, onChange: e => setForm({ ...form, material: e.target.value }) })] }), _jsxs("label", { children: ["Type", _jsx("input", { required: true, value: form.type, onChange: e => setForm({ ...form, type: e.target.value }) })] }), _jsxs("label", { children: ["Color", _jsx("input", { required: true, value: form.color, onChange: e => setForm({ ...form, color: e.target.value }) })] }), _jsxs("label", { children: ["Hex", _jsx("input", { type: "color", value: form.colorHex, onChange: e => setForm({ ...form, colorHex: e.target.value }) })] }), _jsxs("label", { children: ["Net weight (g)", _jsx("input", { type: "number", value: form.defaultNetWeightGrams, onChange: e => setForm({ ...form, defaultNetWeightGrams: +e.target.value }) })] }), _jsxs("label", { children: ["Empty spool (g)", _jsx("input", { type: "number", value: form.emptySpoolWeightGrams, onChange: e => setForm({ ...form, emptySpoolWeightGrams: +e.target.value }) })] })] }), _jsx("button", { type: "submit", style: { marginTop: '0.5rem' }, children: "Create" })] }));
}
