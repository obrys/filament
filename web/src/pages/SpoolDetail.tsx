import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api, type Spool, type SpoolEvent, type FilamentType } from '../api/client'
import { onChange } from '../realtime/useChangeStream'

export function SpoolDetail() {
  const { id = '' } = useParams()
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

  if (!spool || !type) return <p>Loading…</p>

  return (
    <>
      <p><Link to="/spools">← All spools</Link></p>
      <h1>
        {type.colorHex && <span className="swatch" style={{ background: type.colorHex }} />}{' '}
        {type.brand} {type.material} · {type.color} <span className="id-pill">{spool.id}</span>
      </h1>
      <div className="card">
        <div><strong>Remaining:</strong> {spool.remainingGrams} g (initial {spool.initialNetGrams} g)</div>
        <div><strong>Total weight (incl. spool):</strong> {spool.totalWeightGrams} g</div>
        <div><strong>Empty spool:</strong> {spool.effectiveEmptySpoolGrams} g {spool.emptySpoolWeightGramsOverride && <span className="muted">(override)</span>}</div>
        <div><strong>Status:</strong> {spool.status}</div>
        {spool.openedAt && <div className="muted">Opened {new Date(spool.openedAt).toLocaleString()}</div>}
        {spool.finishedAt && <div className="muted">Finished {new Date(spool.finishedAt).toLocaleString()}</div>}
      </div>

      {spool.status !== 'Finished' && <ConsumeForm spoolId={spool.id} onDone={load} max={spool.remainingGrams} />}
      {spool.status !== 'Finished' && <AdjustForm spoolId={spool.id} onDone={load} />}

      <h2>History</h2>
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead><tr><th>When</th><th>Kind</th><th>Δ</th><th>After</th><th>Project</th><th>Notes</th></tr></thead>
          <tbody>
            {events.map(e => (
              <tr key={e.id}>
                <td data-label="When">{new Date(e.occurredAt).toLocaleString()}</td>
                <td data-label="Kind">{e.kind}</td>
                <td data-label="Δ">{e.deltaGrams > 0 ? '+' : ''}{e.deltaGrams} g</td>
                <td data-label="After">{e.remainingAfterGrams} g</td>
                <td data-label="Project">
                  {e.projectUrl
                    ? <a href={e.projectUrl} target="_blank" rel="noreferrer">{e.projectName ?? e.projectUrl}</a>
                    : (e.projectName ?? '')}
                </td>
                <td data-label="Notes">{e.notes ?? ''}</td>
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
      <h2 style={{ marginTop: 0 }}>Record a print</h2>
      <div className="grid">
        <label>Grams used (max {max})<input type="number" min={1} max={max} required value={grams || ''} onChange={e => setGrams(+e.target.value)} /></label>
        <label>Project name<input value={projectName} onChange={e => setProjectName(e.target.value)} /></label>
        <label>Project URL<input value={projectUrl} onChange={e => setProjectUrl(e.target.value)} /></label>
      </div>
      <button type="submit" disabled={!grams || grams > max} style={{ marginTop: '0.5rem' }}>Consume</button>
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
      <h2 style={{ marginTop: 0 }}>Adjust remaining (weighed)</h2>
      <div className="grid">
        <label>New remaining (g)<input type="number" min={0} required value={grams} onChange={e => setGrams(e.target.value === '' ? '' : +e.target.value)} /></label>
        <label>Notes<input value={notes} onChange={e => setNotes(e.target.value)} /></label>
      </div>
      <button type="submit" className="ghost" style={{ marginTop: '0.5rem' }}>Adjust</button>
    </form>
  )
}
