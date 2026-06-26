import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { FACET_FIELDS } from '../api/client';
const LABELS = {
    brand: 'Brand',
    material: 'Material',
    type: 'Type',
    color: 'Color',
};
/**
 * Server-driven faceted filter UI. Renders one collapsible dropdown per facet (native
 * <details> so it works on touch without extra JS) plus a row of removable chips for the
 * active selection. All counts come from the server; the client performs no filtering.
 *
 * The dropdowns' open state is controlled so only one is open at a time, and clicking outside
 * (or pressing Escape) closes the open one. Selecting options keeps the menu open so several
 * values can be chosen in a row.
 */
export function FilterBar({ facets, selection, onToggle, onRemove, onClear }) {
    const [open, setOpen] = useState(null);
    const facetsRef = useRef(null);
    useEffect(() => {
        if (open === null)
            return;
        const onPointerDown = (e) => {
            if (!facetsRef.current?.contains(e.target))
                setOpen(null);
        };
        const onKeyDown = (e) => {
            if (e.key === 'Escape')
                setOpen(null);
        };
        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open]);
    const activeChips = FACET_FIELDS.flatMap(field => selection[field].map(value => ({ field, value })));
    return (_jsxs("div", { className: "filterbar", children: [_jsx("div", { className: "filterbar__facets", ref: facetsRef, children: FACET_FIELDS.map(field => {
                    const options = facets[field];
                    const selectedCount = selection[field].length;
                    return (_jsxs("details", { className: "facet", open: open === field, children: [_jsxs("summary", { onClick: e => {
                                    e.preventDefault();
                                    setOpen(prev => (prev === field ? null : field));
                                }, children: [LABELS[field], selectedCount > 0 && _jsx("span", { className: "facet__badge", children: selectedCount })] }), _jsxs("div", { className: "facet__menu", children: [options.length === 0 && _jsx("p", { className: "facet__empty", children: "No values" }), options.map(opt => {
                                        const checked = selection[field].includes(opt.value);
                                        return (_jsxs("label", { className: `facet__option${opt.count === 0 && !checked ? ' facet__option--empty' : ''}`, children: [_jsx("input", { type: "checkbox", checked: checked, onChange: () => onToggle(field, opt.value) }), _jsx("span", { className: "facet__value", children: opt.value || '(none)' }), _jsx("span", { className: "facet__count", children: opt.count })] }, opt.value));
                                    })] })] }, field));
                }) }), activeChips.length > 0 && (_jsxs("div", { className: "filterbar__chips", children: [activeChips.map(({ field, value }) => (_jsxs("button", { type: "button", className: "chip", onClick: () => onRemove(field, value), title: `Remove ${LABELS[field]}: ${value}`, children: [_jsxs("span", { className: "chip__field", children: [LABELS[field], ":"] }), " ", value || '(none)', _jsx("span", { className: "chip__x", "aria-hidden": true, children: "\u00D7" })] }, `${field}:${value}`))), _jsx("button", { type: "button", className: "chip chip--clear", onClick: onClear, children: "Clear all" })] }))] }));
}
