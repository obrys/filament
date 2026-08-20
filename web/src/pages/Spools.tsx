import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { api, type Spool, type FilamentType, type Facets, type SpoolSort, isSpoolSort } from '../api/client'
import { onChange } from '../realtime/useChangeStream'
import { FilterBar } from '../components/FilterBar'
import { SpoolViz } from '../components/SpoolViz'
import { StatusBadge, TypeLine, RemainingGauge } from '../components/spool-bits'
import { IconClose, IconInbox, IconPlus, IconPrinter, IconWrench } from '../components/icons'
import { useFacetFilters } from '../hooks/useFacetFilters'

const EMPTY_FACETS: Facets = { brand: [], material: [], type: [], color: [] }

/** Browser-storage key for the last used label print copy count. */
const LAST_COPIES_KEY = 'filament.labelCopies'

const readLastCopies = () => {
  try {
    const raw = localStorage.getItem(LAST_COPIES_KEY)
    const n = raw === null ? NaN : Number.parseInt(raw, 10)
    return Number.isInteger(n) && n >= 1 && n <= 10 ? n : 1
  } catch { return 1 } // storage may be unavailable
}

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
  const [printDialogOpen, setPrintDialogOpen] = useState(false)
  const [copiesValue, setCopiesValue] = useState('')
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

  const openPrintDialog = () => {
    setCopiesValue(String(readLastCopies()))
    setPrintDialogOpen(true)
  }

  // An emptied or out-of-range (1..10) copies field falls back to a single copy.
  const effectiveCopies = Number.isInteger(Number(copiesValue)) && Number(copiesValue) >= 1 && Number(copiesValue) <= 10 ? Number(copiesValue) : 1

  const printLabels = () => {
    try { localStorage.setItem(LAST_COPIES_KEY, String(effectiveCopies)) } catch { /* storage may be unavailable */ }
    window.open(api.spools.labelPdfUrl([...selected], effectiveCopies), '_blank')
    setPrintDialogOpen(false)
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Spools</h1>
          <p className="page-head__sub">
            {spools.length} spool{spools.length === 1 ? '' : 's'} in view
            {selected.size > 0 && ` · ${selected.size} selected`}
          </p>
        </div>
      </div>

      <div className="toolbar">
        <button onClick={() => setShowForm(s => !s)}>
          {showForm ? <><IconClose /> Close</> : <><IconPlus /> New spool</>}
        </button>
        <label className={`control${includeFinished ? ' control--on' : ''}`}>
          <input type="checkbox" checked={includeFinished}
            onChange={e => setIncludeFinished(e.target.checked)} /> Show finished
        </label>
        <label className="control">
          Sort
          <select aria-label="Sort" value={sort} onChange={e => onSortChange(e.target.value)}>
            {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <span className="spacer" />
        <button className="subtle" disabled={selected.size === 0} onClick={openPrintDialog}>
          <IconPrinter /> Print labels ({selected.size})
        </button>
      </div>

      {printDialogOpen && (
        <div className="version-overlay">
          <div className="card print-dialog" role="dialog" aria-label="Print labels">
            <h2>Print labels</h2>
            <p>{selected.size} spool{selected.size === 1 ? '' : 's'} selected</p>
            <label>Copies
              <input type="number" min={1} max={10} aria-label="Copies"
                value={copiesValue} onChange={e => setCopiesValue(e.target.value)} />
            </label>
            <p className="print-dialog__count">
              {selected.size * effectiveCopies} label{selected.size * effectiveCopies === 1 ? '' : 's'}
            </p>
            <div className="print-dialog__actions">
              <button onClick={printLabels}><IconPrinter /> Print</button>
              <button className="ghost" onClick={() => setPrintDialogOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {showForm && <NewSpoolForm types={Object.values(types)} onCreated={() => { setShowForm(false); load() }} />}

      <FilterBar
        facets={facets}
        selection={selection}
        onToggle={toggleOption}
        onRemove={removeOption}
        onClear={clearAll}
      />

      <div className="card card--flush table-wrap" style={{ marginTop: '1rem' }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: '1%' }}></th><th>Spool</th><th>Filament</th><th>Remaining</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {spools.map(s => {
              const t = types[s.filamentTypeId]
              const finished = s.status === 'Finished'
              const fraction = s.initialNetGrams > 0 ? s.remainingGrams / s.initialNetGrams : 0
              return (
                <tr key={s.id}>
                  <td>
                    <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)}
                      aria-label={`Select spool ${s.id}`} />
                  </td>
                  <td data-label="Spool">
                    <span className="spool-cell">
                      <SpoolViz colorHex={t?.colorHex} fill={finished ? 0 : fraction} size={38} dimmed={finished} />
                      <Link to={`/spools/${s.id}`} className="id-pill">{s.id}</Link>
                    </span>
                  </td>
                  <td data-label="Filament">
                    {t ? <TypeLine type={t} /> : <span className="mono muted">{s.filamentTypeId}</span>}
                  </td>
                  <td data-label="Remaining">
                    {finished
                      ? <abbr title={`Actually ${s.remainingGrams} g remaining`} className="muted">0 g</abbr>
                      : <RemainingGauge remaining={s.remainingGrams} initial={s.initialNetGrams} />}
                  </td>
                  <td data-label="Status"><StatusBadge status={s.status} /></td>
                  <td></td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {spools.length === 0 && (
          <div className="empty-state">
            <IconInbox />
            <strong>No spools here</strong>
            <span>Adjust the filters, or add a spool to get started.</span>
          </div>
        )}
      </div>

      <p className="muted" style={{ marginTop: '1.25rem' }}>
        <IconWrench style={{ width: 15, height: 15, verticalAlign: '-2px', marginRight: '0.35rem' }} />
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
    <form className="card card--accent" onSubmit={submit} style={{ marginTop: '1rem' }}>
      <h3>New spool</h3>
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
      <button type="submit" disabled={!filamentTypeId} style={{ marginTop: '0.85rem' }}>Create</button>
    </form>
  )
}
