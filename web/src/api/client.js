import { observeVersion } from '../version';
/** The four shared facet fields, in display order. */
export const FACET_FIELDS = ['brand', 'material', 'type', 'color'];
async function http(url, init) {
    const r = await fetch(url, {
        ...init,
        headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
    observeVersion(r.headers.get('X-App-Version'));
    if (!r.ok) {
        let msg = `${r.status} ${r.statusText}`;
        try {
            const body = await r.json();
            if (body?.error)
                msg = body.error;
        }
        catch { /* */ }
        throw new Error(msg);
    }
    if (r.status === 204)
        return undefined;
    return r.json();
}
function appendFacets(p, sel) {
    if (!sel)
        return;
    for (const field of FACET_FIELDS) {
        for (const value of sel[field] ?? [])
            p.append(field, value);
    }
}
export const api = {
    types: {
        list: (filters) => {
            const p = new URLSearchParams();
            appendFacets(p, filters);
            const qs = p.toString();
            return http(`/api/filament-types${qs ? `?${qs}` : ''}`);
        },
        get: (id) => http(`/api/filament-types/${id}`),
        create: (body) => http('/api/filament-types', { method: 'POST', body: JSON.stringify(body) }),
        update: (id, body) => http(`/api/filament-types/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
        delete: (id) => http(`/api/filament-types/${id}`, { method: 'DELETE' }),
    },
    spools: {
        list: (opts) => {
            const p = new URLSearchParams();
            if (opts?.filamentTypeId)
                p.set('filamentTypeId', opts.filamentTypeId);
            if (opts?.includeFinished)
                p.set('includeFinished', 'true');
            appendFacets(p, opts?.filters);
            const qs = p.toString();
            return http(`/api/spools${qs ? `?${qs}` : ''}`);
        },
        get: (id) => http(`/api/spools/${id}`),
        events: (id) => http(`/api/spools/${id}/events`),
        create: (body) => http('/api/spools', { method: 'POST', body: JSON.stringify(body) }),
        consume: (id, body) => http(`/api/spools/${id}/consume`, { method: 'POST', body: JSON.stringify(body) }),
        adjust: (id, body) => http(`/api/spools/${id}/adjust`, { method: 'POST', body: JSON.stringify(body) }),
        delete: (id) => http(`/api/spools/${id}`, { method: 'DELETE' }),
        labelPdfUrl: (ids) => `/api/labels?${ids.map(i => `id=${encodeURIComponent(i)}`).join('&')}`,
    },
    dashboard: {
        summary: () => http('/api/dashboard/summary'),
        usage: (days = 30) => http(`/api/dashboard/usage?days=${days}`),
    },
};
