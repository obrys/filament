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
  remainingAfterGrams: number
  projectName?: string | null
  projectUrl?: string | null
  notes?: string | null
  occurredAt: string
}

export type DashboardSummary = {
  filamentTypeCount: number
  activeSpoolCount: number
  finishedSpoolCount: number
  totalRemainingGrams: number
}

export type DailyUsage = { day: string; consumedGrams: number }

async function http<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`
    try { const body = await r.json(); if (body?.error) msg = body.error } catch { /* */ }
    throw new Error(msg)
  }
  if (r.status === 204) return undefined as unknown as T
  return r.json() as Promise<T>
}

export const api = {
  types: {
    list: () => http<FilamentType[]>('/api/filament-types'),
    get: (id: string) => http<FilamentType>(`/api/filament-types/${id}`),
    create: (body: Partial<FilamentType>) =>
      http<FilamentType>('/api/filament-types', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: Partial<FilamentType>) =>
      http<FilamentType>(`/api/filament-types/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    delete: (id: string) => http<void>(`/api/filament-types/${id}`, { method: 'DELETE' }),
  },
  spools: {
    list: (opts?: { filamentTypeId?: string; includeFinished?: boolean }) => {
      const p = new URLSearchParams()
      if (opts?.filamentTypeId) p.set('filamentTypeId', opts.filamentTypeId)
      if (opts?.includeFinished) p.set('includeFinished', 'true')
      const qs = p.toString()
      return http<Spool[]>(`/api/spools${qs ? `?${qs}` : ''}`)
    },
    get: (id: string) => http<Spool>(`/api/spools/${id}`),
    events: (id: string) => http<SpoolEvent[]>(`/api/spools/${id}/events`),
    create: (body: { filamentTypeId: string; initialNetGrams?: number; emptySpoolWeightGramsOverride?: number; notes?: string }) =>
      http<Spool>('/api/spools', { method: 'POST', body: JSON.stringify(body) }),
    consume: (id: string, body: { grams: number; projectName?: string; projectUrl?: string; notes?: string }) =>
      http<Spool>(`/api/spools/${id}/consume`, { method: 'POST', body: JSON.stringify(body) }),
    adjust: (id: string, body: { newRemainingGrams: number; notes?: string }) =>
      http<Spool>(`/api/spools/${id}/adjust`, { method: 'POST', body: JSON.stringify(body) }),
    delete: (id: string) => http<void>(`/api/spools/${id}`, { method: 'DELETE' }),
    labelPdfUrl: (ids: string[]) => `/api/labels?${ids.map(i => `id=${encodeURIComponent(i)}`).join('&')}`,
  },
  dashboard: {
    summary: () => http<DashboardSummary>('/api/dashboard/summary'),
    usage: (days = 30) => http<DailyUsage[]>(`/api/dashboard/usage?days=${days}`),
  },
}
