import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router'
import { api, type Spool, type SpoolEvent, type FilamentType } from '../api/client'
import { onChange } from '../realtime/useChangeStream'
import { SpoolViz } from '../components/SpoolViz'
import { LOW_FRACTION, StatusBadge } from '../components/spool-bits'
import { IconAlert, IconArrowLeft, IconCheck, IconHistory, IconPrinter, IconScale } from '../components/icons'

export function SpoolDetail() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [spool, setSpool] = useState<Spool | null>(null)
  const [type, setType] = useState<FilamentType | null>(null)
  const [events, setEvents] = useState<SpoolEvent[]>([])

  const load = async () => {
    try {
      const s = await api.spools.get(id)
      setSpool(s)
      setType(await api.types.get(s.filamentTypeId))
      setEvents(await api.spools.events(id))
    } catch (e) { console.error(e) }
  }
  useEffect(() => {
    load()
    return onChange(m => { if (m.resource === 'spool' && (!m.id || m.id === id)) load() })
  }, [id])

  if (!spool || !type) return <p className="muted">Loading…</p>

  const act = async (fn: () => Promise<unknown>) => {
    try { await fn(); await load() } catch (err: any) { alert(err.message) }
  }

  const lowOnFilament = spool.remainingGrams <= spool.initialNetGrams * LOW_FRACTION
  // The active (enabled) Finish event, if any — undoing it reopens the spool.
  const activeFinish = events.find(e => e.kind === 'Finished' && !e.isDisabled)

  // A spool can be deleted once every non-creation event has been disabled (wound back). The
  // Created event can never be disabled, so it is the only event allowed to stay enabled.
  const canDelete = events.length > 0 && events.every(e => e.kind === 'Created' || e.isDisabled)
  const deleteTitle = canDelete
    ? 'Delete this spool and its entire history'
    : 'A spool can be deleted only when all of its events have been disabled.'

  const doDelete = async () => {
    if (!canDelete) return
    if (!confirm(`Delete spool ${spool.id}? This permanently removes the spool and all of its events.`)) return
    try { await api.spools.delete(spool.id); navigate('/spools') } catch (err: any) { alert(err.message) }
  }

  const finished = spool.status === 'Finished'
  const fraction = spool.initialNetGrams > 0 ? Math.min(1, Math.max(0, spool.remainingGrams / spool.initialNetGrams)) : 0
  const percent = Math.round(fraction * 100)

  return (
    <>
      <Link to="/spools" className="back-link"><IconArrowLeft style={{ width: 15, height: 15 }} /> All spools</Link>

      <section className="spool-hero">
        <div className="spool-hero__art">
          <SpoolViz
            colorHex={type.colorHex}
            fill={finished ? 0 : fraction}
            size={168}
            spin={spool.status === 'Open'}
            dimmed={finished}
          />
          <div className={`spool-hero__pct${lowOnFilament && !finished ? ' is-low' : ''}`}>
            {finished ? 'empty' : `${percent}%`}
          </div>
        </div>
        <div className="spool-hero__body">
          <h1>
            {type.colorHex && <span className="swatch swatch--lg" style={{ background: type.colorHex }} />}
            {type.brand} {type.material} · {type.color} <span className="id-pill">{spool.id}</span>
          </h1>
          <div className="meta-row" style={{ marginTop: '0.35rem' }}>
            <StatusBadge status={spool.status} />
            {lowOnFilament && !finished && <span className="badge badge--low">Running low</span>}
            <span className="muted">{type.type} · type <span className="mono">{type.id}</span></span>
          </div>

          <div className="specs">
            <div className="spec"><strong>Remaining:</strong> {spool.remainingGrams} g (initial {spool.initialNetGrams} g)</div>
            <div className="spec"><strong>Total weight (incl. spool):</strong> {spool.totalWeightGrams} g</div>
            <div className="spec">
              <strong>Empty spool:</strong> {spool.effectiveEmptySpoolGrams} g{' '}
              {spool.emptySpoolWeightGramsOverride && <span className="muted">(override)</span>}
            </div>
            <div className="spec"><strong>Status:</strong> {spool.status}</div>
          </div>

          <div className="meta-row" style={{ marginTop: '0.75rem' }}>
            {spool.openedAt && <span className="muted">Opened {new Date(spool.openedAt).toLocaleString()}</span>}
            {spool.finishedAt && <span className="muted">Finished {new Date(spool.finishedAt).toLocaleString()}</span>}
          </div>
        </div>
      </section>

      {spool.status === 'Sealed' && (
        <div className="card card--accent">
          <h3>Sealed spool</h3>
          <p className="muted">Open it to start recording prints — the clock starts when the bag does.</p>
          <button onClick={() => act(() => api.spools.open(spool.id))}>Open spool</button>
        </div>
      )}

      {spool.status === 'Open' && (
        <>
          <div className="grid grid--forms">
            <ConsumeForm spoolId={spool.id} onDone={load} max={spool.remainingGrams} />
            <AdjustForm spoolId={spool.id} onDone={load} />
          </div>
          <div className={`card${lowOnFilament ? ' card--accent' : ''}`}>
            <h3><IconCheck style={{ width: 16, height: 16, verticalAlign: '-3px', marginRight: '0.35rem' }} />Finish spool</h3>
            <p className="muted">
              {lowOnFilament
                ? 'This spool looks nearly empty — mark it finished when done.'
                : 'Mark this spool as finished. This does not change the remaining weight.'}
            </p>
            <button className={lowOnFilament ? 'nudge' : 'ghost'}
              onClick={() => act(() => api.spools.finish(spool.id))}>Finish spool</button>
          </div>
        </>
      )}

      {spool.status === 'Finished' && activeFinish && (
        <div className="card">
          <h3>This spool is finished</h3>
          <p className="muted">Reopen it if it was retired by mistake — the history stays intact.</p>
          <button className="ghost" onClick={() => act(() => api.spools.disableEvent(spool.id, activeFinish.id))}>
            Reopen spool
          </button>
        </div>
      )}

      <div className="card card--danger">
        <h3>Delete spool</h3>
        <p className="muted">
          A spool can only be deleted once every one of its events has been disabled (undone).
          Deleting removes the spool and all of its events from the totals.
        </p>
        <button className="danger" disabled={!canDelete} title={deleteTitle} onClick={doDelete}
          data-testid="delete-spool">
          Delete spool
        </button>
      </div>

      <div className="section-title">
        <IconHistory style={{ width: 18, height: 18, color: 'var(--accent)' }} />
        <h2>History</h2>
        <span className="section-title__rule" />
        <span className="muted mono">{events.length} events</span>
      </div>

      <div className="card card--flush table-wrap">
        <table>
          <thead><tr><th>When</th><th>Kind</th><th>Δ</th><th>After</th><th>Project</th><th>Notes</th><th></th></tr></thead>
          <tbody>
            {events.map(e => (
              <tr key={e.id} className={e.isDisabled ? 'event-disabled' : undefined}>
                <td data-label="When" className="muted mono">{new Date(e.occurredAt).toLocaleString()}</td>
                <td data-label="Kind"><span className={`ev ev--${e.kind.toLowerCase()}`}>{e.kind}</span></td>
                <td data-label="Δ" className={`num ${e.deltaGrams < 0 ? 'is-neg' : e.deltaGrams > 0 ? 'is-pos' : ''}`}>
                  {e.deltaGrams > 0 ? '+' : ''}{e.deltaGrams} g
                </td>
                <td data-label="After" className="num">{e.remainingAfterGrams === null ? '—' : `${e.remainingAfterGrams} g`}</td>
                <td data-label="Project">
                  {e.projectUrl
                    ? <a href={e.projectUrl} target="_blank" rel="noreferrer">{e.projectName ?? e.projectUrl}</a>
                    : (e.projectName ?? '')}
                </td>
                <td data-label="Notes" className="muted">{e.notes ?? ''}</td>
                <td data-label="">
                  {e.kind !== 'Created' && (
                    e.isDisabled
                      ? <button className="link" onClick={() => act(() => api.spools.enableEvent(spool.id, e.id))}>Redo</button>
                      : <button className="link" onClick={() => act(() => api.spools.disableEvent(spool.id, e.id))}>Undo</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function ConsumeForm({ spoolId, onDone, max }: { spoolId: string; onDone: () => void; max: number }) {
  const [grams, setGrams] = useState(0)
  const [projectName, setProjectName] = useState('')
  const [projectUrl, setProjectUrl] = useState('')
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    try { await api.spools.consume(spoolId, { grams, projectName: projectName || undefined, projectUrl: projectUrl || undefined }); setGrams(0); setProjectName(''); setProjectUrl(''); onDone() }
    catch (err: any) { alert(err.message) }
  }
  return (
    <form className="card" onSubmit={submit}>
      <h3><IconPrinter style={{ width: 16, height: 16, verticalAlign: '-3px', marginRight: '0.35rem' }} />Record a print</h3>
      <label>Grams used (max {max})
        <input type="number" min={1} max={max} required value={grams || ''} onChange={e => setGrams(+e.target.value)} />
      </label>
      <label>Project name<input value={projectName} onChange={e => setProjectName(e.target.value)} placeholder="Benchy v3" /></label>
      <label>Project URL<input value={projectUrl} onChange={e => setProjectUrl(e.target.value)} placeholder="https://…" /></label>
      <button type="submit" disabled={!grams || grams > max} style={{ marginTop: '0.85rem' }}>Consume</button>
    </form>
  )
}

function AdjustForm({ spoolId, onDone }: { spoolId: string; onDone: () => void }) {
  const [grams, setGrams] = useState<number | ''>('')
  const [notes, setNotes] = useState('')
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (grams === '') return
    try { await api.spools.adjust(spoolId, { newRemainingGrams: grams, notes: notes || undefined }); setGrams(''); setNotes(''); onDone() }
    catch (err: any) { alert(err.message) }
  }
  return (
    <form className="card" onSubmit={submit}>
      <h3><IconScale style={{ width: 16, height: 16, verticalAlign: '-3px', marginRight: '0.35rem' }} />Adjust remaining (weighed)</h3>
      <p className="muted" style={{ fontSize: '0.82rem' }}>
        <IconAlert style={{ width: 14, height: 14, verticalAlign: '-2px', marginRight: '0.3rem' }} />
        Put the spool on a scale and subtract the empty-spool weight.
      </p>
      <label>New remaining (g)
        <input type="number" min={0} required value={grams} onChange={e => setGrams(e.target.value === '' ? '' : +e.target.value)} />
      </label>
      <label>Notes<input value={notes} onChange={e => setNotes(e.target.value)} /></label>
      <button type="submit" className="ghost" style={{ marginTop: '0.85rem' }}>Adjust</button>
    </form>
  )
}
