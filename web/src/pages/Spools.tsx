import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { api, type Spool, type FilamentType, type Facets, type SpoolSort, isSpoolSort } from '../api/client'
import { onChange } from '../realtime/useChangeStream'
import { FilterBar } from '../components/FilterBar'
import { useFacetFilters } from '../hooks/useFacetFilters'

const EMPTY_FACETS: Facets = { brand: [], material: [], type: [], color: [] }

const SORT_OPTIONS: { value: SpoolSort; label: string }[] = [
  { value: 'lastUsed', label: 'Last used' },
  { value: 'leastRemaining', label: 'Least remaining' },
  { value: 'mostRemaining', label: 'Most remaining' },
]

export function Spools() {
  const [params, setParams] = useSearchParams()
  const rawSort = params.get('sort')
  const sort: SpoolSort = isSpoolSort(rawSort) ? rawSort : 'lastUsed'

  const [spools, setSpools] = useState<Spool[]>([])
  const [facets, setFacets] = useState<Facets>(EMPTY_FACETS)
  const [types, setTypes] = useState<Record<string, FilamentType>>({})
  const [includeFinished, setIncludeFinished] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showForm, setShowForm] = useState(false)
  const { selection, toggleOption, removeOption, clearAll } = useFacetFilters()

  const load = () => {
    api.spools.list({ sort, includeFinished, filters: selection })
      .then(r => { setSpools(r.items); setFacets(r.facets) })
      .catch(console.error)
    // The type map must cover every spool regardless of the active filter, so load all types.
    api.types.list().then(r => setTypes(Object.fromEntries(r.items.map(t => [t.id, t])))).catch(console.error)
  }
  useEffect(() => {
    load()
    return onChange(m => { if (m.resource === 'spool' || m.resource === 'filament-type') load() })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort, includeFinished, JSON.stringify(selection)])

  // Normalize the URL to the resolved sort when the value was missing or unrecognized, so the
  // address bar reflects what is displayed. Setting the same value keeps the URL stable otherwise.
  useEffect(() => {
    if (rawSort !== sort) {
      const next = new URLSearchParams(params)
      next.set('sort', sort)
      setParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort])

  const onSortChange = (value: string) => {
    if (!isSpoolSort(value)) return
    const next = new URLSearchParams(params)
    next.set('sort', value)
    setParams(next)
  }

  const toggle = (id: string) => {
    const next = new Set(selected)
    next.has(id) ? next.delete(id) : next.add(id)
    setSelected(next)
  }

  return (
    <>
      <h1>Spools</h1>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={() => setShowForm(s => !s)}>{showForm ? 'Close' : 'New spool'}</button>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', margin: 0, width: 'auto' }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={includeFinished}
            onChange={e => setIncludeFinished(e.target.checked)} /> Show finished
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', margin: 0, width: 'auto' }}>
          Sort
          <select aria-label="Sort" value={sort} onChange={e => onSortChange(e.target.value)}>
            {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <button disabled={selected.size === 0}
          onClick={() => window.open(api.spools.labelPdfUrl([...selected]), '_blank')}>
          Print labels ({selected.size})
        </button>
      </div>

      {showForm && <NewSpoolForm types={Object.values(types)} onCreated={() => { setShowForm(false); load() }} />}

      <FilterBar
        facets={facets}
        selection={selection}
        onToggle={toggleOption}
        onRemove={removeOption}
        onClear={clearAll}
      />

      <div className="card" style={{ marginTop: '1rem', padding: 0, overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th></th><th>ID</th><th>Type</th><th>Remaining</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {spools.map(s => {
              const t = types[s.filamentTypeId]
              return (
                <tr key={s.id}>
                  <td><input type="checkbox" style={{ width: 'auto' }} checked={selected.has(s.id)} onChange={() => toggle(s.id)} /></td>
                  <td data-label="ID"><Link to={`/spools/${s.id}`} className="id-pill">{s.id}</Link></td>
                  <td data-label="Type">
                    {t ? <>{t.colorHex && <span className="swatch" style={{ background: t.colorHex }} />} {t.brand} · {t.material} · {t.type} · {t.color}</> : s.filamentTypeId}
                  </td>
                  <td data-label="Remaining">
                    {s.status === 'Finished'
                      ? <abbr title={`Actually ${s.remainingGrams} g remaining`}>0 g</abbr>
                      : `${s.remainingGrams} g`}
                  </td>
                  <td data-label="Status">{s.status}</td>
                  <td></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="muted" style={{ marginTop: '1rem', fontSize: '0.95rem' }}>
        Something look off? <Link to="/spools/maintenance">Re-evaluate spool states</Link>.
      </p>
    </>
  )
}

function NewSpoolForm({ types, onCreated }: { types: FilamentType[]; onCreated: () => void }) {
  const [filamentTypeId, setFilamentTypeId] = useState(types[0]?.id ?? '')
  const [initialNetGrams, setInitialNetGrams] = useState<number | ''>('')
  const [emptyOverride, setEmptyOverride] = useState<number | ''>('')
  const [notes, setNotes] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await api.spools.create({
        filamentTypeId,
        initialNetGrams: initialNetGrams === '' ? undefined : initialNetGrams,
        emptySpoolWeightGramsOverride: emptyOverride === '' ? undefined : emptyOverride,
        notes: notes || undefined,
      })
      onCreated()
    } catch (err: any) { alert(err.message) }
  }
  return (
    <form className="card" onSubmit={submit} style={{ marginTop: '1rem' }}>
      <div className="grid">
        <label>Filament type
          <select value={filamentTypeId} onChange={e => setFilamentTypeId(e.target.value)}>
            {types.map(t => <option key={t.id} value={t.id}>{t.id} — {t.brand} · {t.material} · {t.type} · {t.color}</option>)}
          </select>
        </label>
        <label>Initial net (g, optional)
          <input type="number" value={initialNetGrams} onChange={e => setInitialNetGrams(e.target.value === '' ? '' : +e.target.value)} />
        </label>
        <label>Empty spool override (g)
          <input type="number" value={emptyOverride} onChange={e => setEmptyOverride(e.target.value === '' ? '' : +e.target.value)} />
        </label>
        <label>Notes
          <input value={notes} onChange={e => setNotes(e.target.value)} />
        </label>
      </div>
      <button type="submit" disabled={!filamentTypeId} style={{ marginTop: '0.5rem' }}>Create</button>
    </form>
  )
}
