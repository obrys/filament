import { observeVersion } from '../version'

export type FilamentType = {
  id: string
  brand: string
  material: string
  type: string
  color: string
  colorHex?: string | null
  defaultNetWeightGrams: number
  emptySpoolWeightGrams: number
  notes?: string | null
  createdAt: string
}

export type Spool = {
  id: string
  filamentTypeId: string
  remainingGrams: number
  initialNetGrams: number
  emptySpoolWeightGramsOverride?: number | null
  effectiveEmptySpoolGrams: number
  totalWeightGrams: number
  status: 'Sealed' | 'Open' | 'Finished'
  createdAt: string
  openedAt?: string | null
  finishedAt?: string | null
  notes?: string | null
}

export type SpoolEvent = {
  id: number
  spoolId: string
  kind: 'Created' | 'Opened' | 'Print' | 'Adjustment' | 'Finished'
  deltaGrams: number
  remainingAfterGrams: number | null
  isDisabled: boolean
  projectName?: string | null
  projectUrl?: string | null
  notes?: string | null
  occurredAt: string
}

export type SpoolReevalDiff = {
  spoolId: string
  oldStatus: string
  newStatus: string
  oldRemainingGrams: number
  newRemainingGrams: number
}

export type ReevaluateResult = {
  totalSpools: number
  changedSpools: number
  differences: SpoolReevalDiff[]
}

export type DashboardSummary = {
  filamentTypeCount: number
  activeSpoolCount: number
  finishedSpoolCount: number
  totalRemainingGrams: number
}

export type DailyUsage = { day: string; consumedGrams: number }

export type FacetOption = { value: string; count: number }
export type Facets = {
  brand: FacetOption[]
  material: FacetOption[]
  type: FacetOption[]
  color: FacetOption[]
}
/** The four shared facet fields, in display order. */
export const FACET_FIELDS = ['brand', 'material', 'type', 'color'] as const
export type FacetField = (typeof FACET_FIELDS)[number]
/** A selection is a list of chosen values per facet field. */
export type FacetSelection = Record<FacetField, string[]>

export type FilamentTypeList = { items: FilamentType[]; facets: Facets }
export type SpoolList = { items: Spool[]; facets: Facets }

async function http<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  observeVersion(r.headers.get('X-App-Version'))
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`
    try { const body = await r.json(); if (body?.error) msg = body.error } catch { /* */ }
    throw new Error(msg)
  }
  if (r.status === 204) return undefined as unknown as T
  return r.json() as Promise<T>
}

function appendFacets(p: URLSearchParams, sel?: Partial<FacetSelection>) {
  if (!sel) return
  for (const field of FACET_FIELDS) {
    for (const value of sel[field] ?? []) p.append(field, value)
  }
}

export const api = {
  types: {
    list: (filters?: Partial<FacetSelection>) => {
      const p = new URLSearchParams()
      appendFacets(p, filters)
      const qs = p.toString()
      return http<FilamentTypeList>(`/api/filament-types${qs ? `?${qs}` : ''}`)
    },
    get: (id: string) => http<FilamentType>(`/api/filament-types/${id}`),
    create: (body: Partial<FilamentType>) =>
      http<FilamentType>('/api/filament-types', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: Partial<FilamentType>) =>
      http<FilamentType>(`/api/filament-types/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    delete: (id: string) => http<void>(`/api/filament-types/${id}`, { method: 'DELETE' }),
  },
  spools: {
    list: (opts?: { filamentTypeId?: string; includeFinished?: boolean; filters?: Partial<FacetSelection> }) => {
      const p = new URLSearchParams()
      if (opts?.filamentTypeId) p.set('filamentTypeId', opts.filamentTypeId)
      if (opts?.includeFinished) p.set('includeFinished', 'true')
      appendFacets(p, opts?.filters)
      const qs = p.toString()
      return http<SpoolList>(`/api/spools${qs ? `?${qs}` : ''}`)
    },
    get: (id: string) => http<Spool>(`/api/spools/${id}`),
    events: (id: string) => http<SpoolEvent[]>(`/api/spools/${id}/events`),
    create: (body: { filamentTypeId: string; initialNetGrams?: number; emptySpoolWeightGramsOverride?: number; notes?: string }) =>
      http<Spool>('/api/spools', { method: 'POST', body: JSON.stringify(body) }),
    open: (id: string) => http<Spool>(`/api/spools/${id}/open`, { method: 'POST' }),
    finish: (id: string) => http<Spool>(`/api/spools/${id}/finish`, { method: 'POST' }),
    consume: (id: string, body: { grams: number; projectName?: string; projectUrl?: string; notes?: string }) =>
      http<Spool>(`/api/spools/${id}/consume`, { method: 'POST', body: JSON.stringify(body) }),
    adjust: (id: string, body: { newRemainingGrams: number; notes?: string }) =>
      http<Spool>(`/api/spools/${id}/adjust`, { method: 'POST', body: JSON.stringify(body) }),
    enableEvent: (id: string, eventId: number) =>
      http<Spool>(`/api/spools/${id}/events/${eventId}/enable`, { method: 'POST' }),
    disableEvent: (id: string, eventId: number) =>
      http<Spool>(`/api/spools/${id}/events/${eventId}/disable`, { method: 'POST' }),
    reevaluate: () => http<ReevaluateResult>('/api/spools/reevaluate', { method: 'POST' }),
    delete: (id: string) => http<void>(`/api/spools/${id}`, { method: 'DELETE' }),
    labelPdfUrl: (ids: string[]) => `/api/labels?${ids.map(i => `id=${encodeURIComponent(i)}`).join('&')}`,
  },
  dashboard: {
    summary: () => http<DashboardSummary>('/api/dashboard/summary'),
    usage: (days = 30) => http<DailyUsage[]>(`/api/dashboard/usage?days=${days}`),
  },
}
