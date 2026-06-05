import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type Spool, type FilamentType } from '../api/client'
import { onChange } from '../realtime/useChangeStream'

export function Spools() {
  const [spools, setSpools] = useState<Spool[]>([])
  const [types, setTypes] = useState<Record<string, FilamentType>>({})
  const [includeFinished, setIncludeFinished] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showForm, setShowForm] = useState(false)

  const load = () => {
    api.spools.list({ includeFinished }).then(setSpools).catch(console.error)
    api.types.list().then(list => setTypes(Object.fromEntries(list.map(t => [t.id, t])))).catch(console.error)
  }
  useEffect(() => {
    load()
    return onChange(m => { if (m.resource === 'spool' || m.resource === 'filament-type') load() })
  }, [includeFinished])

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
        <button disabled={selected.size === 0}
          onClick={() => window.open(api.spools.labelPdfUrl([...selected]), '_blank')}>
          Print labels ({selected.size})
        </button>
      </div>

      {showForm && <NewSpoolForm types={Object.values(types)} onCreated={() => { setShowForm(false); load() }} />}

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
                  <td data-label="Remaining">{s.remainingGrams} g</td>
                  <td data-label="Status">{s.status}</td>
                  <td></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
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
