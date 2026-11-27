import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router'
import {
  api, FACET_FIELDS,
  type PrintProject, type FilamentType, type Spool, type SpoolList, type FacetSelection, type Facets,
} from '../api/client'
import { FilterBar } from '../components/FilterBar'
import { RemainingGauge, StatusBadge, TypeLine } from '../components/spool-bits'
import { IconArrowLeft, IconClose, IconSearch } from '../components/icons'

type Slot = { spoolId: string; grams: number | '' }

const EMPTY_FACETS: Facets = { brand: [], material: [], type: [], color: [] }
const EMPTY_SELECTION: FacetSelection = { brand: [], material: [], type: [], color: [] }

/** OR within a facet, AND across facets — the existing facet semantics, applied client-side to the dialogue's list. */
function matchesFacets(type: FilamentType | undefined, sel: FacetSelection): boolean {
  if (!type) return false
  for (const field of FACET_FIELDS) {
    const chosen = sel[field]
    if (chosen.length === 0) continue
    if (!chosen.includes(type[field])) return false
  }
  return true
}

export function PrintProjectPrint() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [project, setProject] = useState<PrintProject | null>(null)
  const [types, setTypes] = useState<Record<string, FilamentType>>({})
  const [slotSpools, setSlotSpools] = useState<Record<string, Spool[]>>({})
  const [allSpools, setAllSpools] = useState<Spool[]>([])
  const [facets, setFacets] = useState<Facets>(EMPTY_FACETS)
  const [slots, setSlots] = useState<Slot[]>([])
  const [dialogSlot, setDialogSlot] = useState<number | null>(null)
  const [dialogSel, setDialogSel] = useState<FacetSelection>(EMPTY_SELECTION)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    try {
      // Fetch everything before touching state: the awaits yield between updates, so setting
      // `project` first would render with `slots` still empty and crash the slot render.
      const p = await api.printProjects.get(id)
      const typeMap = Object.fromEntries((await api.types.list()).items.map(t => [t.id, t]))
      const perType = await Promise.all(
        p.types.map(t => api.spools.list({ filamentTypeId: t.filamentTypeId, includeFinished: false })),
      )
      const all: SpoolList = await api.spools.list({ includeFinished: false })
      setProject(p)
      setTypes(typeMap)
      setSlotSpools(Object.fromEntries(p.types.map((t, i) => [t.filamentTypeId, perType[i].items])))
      setAllSpools(all.items)
      setFacets(all.facets)
      setSlots(p.types.map(t => ({ spoolId: '', grams: t.grams })))
    } catch (e) { console.error(e) }
  }
  useEffect(() => { load() }, [id])

  const setSlot = (index: number, patch: Partial<Slot>) =>
    setSlots(prev => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)))

  // Live validation: every slot needs a spool with at least 1 g; per spool the grams summed
  // across all of its slots must not exceed its remaining balance.
  const error = useMemo(() => {
    if (!project) return null
    for (const s of slots) {
      if (!s.spoolId) return 'Give a spool to every filament type before printing.'
      const grams = Number(s.grams)
      if (!Number.isInteger(grams) || grams < 1) return 'Every spool must get at least 1 g.'
    }
    const perSpool = new Map<string, number>()
    for (const s of slots) perSpool.set(s.spoolId, (perSpool.get(s.spoolId) ?? 0) + Number(s.grams))
    for (const [spoolId, grams] of perSpool) {
      const spool = allSpools.find(x => x.id === spoolId) ?? Object.values(slotSpools).flat().find(x => x.id === spoolId)
      if (spool && grams > spool.remainingGrams)
        return `Spool ${spoolId}: ${grams} g entered but only ${spool.remainingGrams} g remaining.`
    }
    return null
  }, [project, slots, allSpools, slotSpools])

  const confirm = async () => {
    if (error || !project) return
    setBusy(true)
    try {
      const print = await api.printProjects.print(project.id,
        slots.map(s => ({ spoolId: s.spoolId, grams: Number(s.grams) })))
      navigate(`/print-projects/${project.id}?highlight=${print.id}`)
    } catch (err: any) {
      setBusy(false)
      alert(err.message)
    }
  }

  if (!project) return <p className="muted">Loading…</p>

  const dialogSpools = dialogSlot === null ? [] :
    allSpools.filter(s => matchesFacets(types[s.filamentTypeId], dialogSel))

  const toggleDialogOption = (field: (typeof FACET_FIELDS)[number], value: string) =>
    setDialogSel(prev => ({
      ...prev,
      [field]: prev[field].includes(value) ? prev[field].filter(v => v !== value) : [...prev[field], value],
    }))

  return (
    <>
      <Link to={`/print-projects/${project.id}`} className="back-link">
        <IconArrowLeft style={{ width: 15, height: 15 }} /> {project.title}
      </Link>

      <div className="page-head">
        <div>
          <h1>Print project</h1>
          <p className="page-head__sub">
            Choose a spool for each of the project's {project.types.length} filament type{project.types.length === 1 ? '' : 's'} and confirm.
          </p>
        </div>
      </div>

      {project.types.map((t, i) => {
        const ft = types[t.filamentTypeId]
        const spools = slotSpools[t.filamentTypeId] ?? []
        const slot = slots[i]
        return (
          <div className="card project-slot" key={t.filamentTypeId} data-testid="project-slot">
            <div className="project-slot__head">
              <strong>{ft ? <TypeLine type={ft} /> : <span className="mono">{t.filamentTypeId}</span>}</strong>
              {/* A spool picked through "Other spools" that is not of this type is not in the slot's
                  list, so surface the selection here instead. */}
              {slot.spoolId && !spools.some(s => s.id === slot.spoolId) && (
                <span className="spool-pick spool-pick--selected" aria-label={`Selected spool ${slot.spoolId}`}>
                  <span className="id-pill">{slot.spoolId}</span>
                  <button type="button" className="icon-btn" aria-label="Clear spool" onClick={() => setSlot(i, { spoolId: '' })}>
                    <IconClose style={{ width: 13, height: 13 }} />
                  </button>
                </span>
              )}
              <span className="spacer" />
              <label>Grams
                <input type="number" min={1} step={1} aria-label={`Grams for ${t.filamentTypeId}`}
                  value={slot.grams}
                  onChange={e => setSlot(i, { grams: e.target.value === '' ? '' : +e.target.value })} />
              </label>
              <button className="ghost" onClick={() => setDialogSlot(i)}>
                <IconSearch style={{ width: 15, height: 15 }} /> Other spools
              </button>
            </div>
            <div className="project-slot__spools">
              {spools.map(s => (
                <button key={s.id}
                  className={`spool-pick${slot.spoolId === s.id ? ' spool-pick--selected' : ''}`}
                  onClick={() => setSlot(i, { spoolId: s.id })}
                  aria-label={`Select spool ${s.id}`}>
                  <span className="id-pill">{s.id}</span>
                  <span className="spool-pick__meta">
                    <RemainingGauge remaining={s.remainingGrams} initial={s.initialNetGrams} />
                    <StatusBadge status={s.status} />
                  </span>
                </button>
              ))}
              {spools.length === 0 && <p className="muted">No open or sealed spools of this type — use "Other spools".</p>}
            </div>
          </div>
        )
      })}

      {error && <p className="form-error" role="alert">{error}</p>}

      <div className="toolbar" style={{ marginTop: '1rem' }}>
        <button onClick={confirm} disabled={error !== null || busy} data-testid="confirm-print">
          Confirm print
        </button>
        <button className="ghost" onClick={() => navigate(`/print-projects/${project.id}`)}>Cancel</button>
      </div>

      {dialogSlot !== null && (
        <div className="version-overlay">
          <div className="card print-dialog print-dialog--wide" role="dialog" aria-label="Other spools">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <h2 style={{ margin: 0 }}>Other spools</h2>
              <span className="spacer" />
              <button className="icon-btn" onClick={() => setDialogSlot(null)} aria-label="Close">
                <IconClose />
              </button>
            </div>
            <p style={{ marginBottom: '0.5rem' }}>
              Any non-finished spool can fill the slot — even another type. Grams stay pre-filled.
            </p>
            <FilterBar
              facets={facets}
              selection={dialogSel}
              onToggle={toggleDialogOption}
              onRemove={toggleDialogOption}
              onClear={() => setDialogSel(EMPTY_SELECTION)}
            />
            <div className="table-wrap" style={{ maxHeight: '50vh', overflowY: 'auto' }}>
              <table>
                <thead><tr><th>Spool</th><th>Remaining</th><th>Status</th></tr></thead>
                <tbody>
                  {dialogSpools.map(s => {
                    const t = types[s.filamentTypeId]
                    return (
                      <tr key={s.id} className="clickable-row"
                        onClick={() => { setSlot(dialogSlot, { spoolId: s.id }); setDialogSlot(null) }}>
                        <td>
                          <span className="id-pill">{s.id}</span>{' '}
                          {t && <span className="muted">{t.material} {t.type} · {t.color}</span>}
                        </td>
                        <td><RemainingGauge remaining={s.remainingGrams} initial={s.initialNetGrams} /></td>
                        <td><StatusBadge status={s.status} /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {dialogSpools.length === 0 && <p className="muted" style={{ padding: '0.75rem' }}>No spools match the filters.</p>}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
