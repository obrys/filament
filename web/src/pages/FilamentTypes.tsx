import { useEffect, useState } from 'react'
import { api, type FilamentType, type Facets } from '../api/client'
import { onChange } from '../realtime/useChangeStream'
import { FilterBar } from '../components/FilterBar'
import { useFacetFilters } from '../hooks/useFacetFilters'

const EMPTY_FACETS: Facets = { brand: [], material: [], type: [], color: [] }

export function FilamentTypes() {
  const [types, setTypes] = useState<FilamentType[]>([])
  const [facets, setFacets] = useState<Facets>(EMPTY_FACETS)
  const [showForm, setShowForm] = useState(false)
  const { selection, toggleOption, removeOption, clearAll } = useFacetFilters()

  const load = () =>
    api.types.list(selection)
      .then(r => { setTypes(r.items); setFacets(r.facets) })
      .catch(console.error)
  useEffect(() => {
    load()
    return onChange(m => { if (m.resource === 'filament-type') load() })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(selection)])

  return (
    <>
      <h1>Filament Types</h1>
      <button onClick={() => setShowForm(s => !s)}>{showForm ? 'Close' : 'New type'}</button>
      {showForm && <NewTypeForm onCreated={() => { setShowForm(false); load() }} />}

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
            <tr><th>ID</th><th>Brand</th><th>Material</th><th>Type</th><th>Color</th><th>Net (g)</th><th>Empty (g)</th><th></th></tr>
          </thead>
          <tbody>
            {types.map(t => (
              <tr key={t.id}>
                <td data-label="ID"><span className="id-pill">{t.id}</span></td>
                <td data-label="Brand">{t.brand}</td>
                <td data-label="Material">{t.material}</td>
                <td data-label="Type">{t.type}</td>
                <td data-label="Color">
                  {t.colorHex && <span className="swatch" style={{ background: t.colorHex }} />} {t.color}
                </td>
                <td data-label="Net">{t.defaultNetWeightGrams}</td>
                <td data-label="Empty">{t.emptySpoolWeightGrams}</td>
                <td>
                  <button className="ghost" onClick={() => deleteType(t.id, load)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

async function deleteType(id: string, reload: () => void) {
  if (!confirm(`Delete filament type ${id}?`)) return
  try {
    await api.types.delete(id)
    reload()
  } catch (e: any) { alert(e.message) }
}

function NewTypeForm({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState({
    brand: '', material: 'PLA', type: 'Basic', color: '',
    colorHex: '#888888', defaultNetWeightGrams: 1000, emptySpoolWeightGrams: 200, notes: '',
  })
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    try { await api.types.create(form); onCreated() } catch (err: any) { alert(err.message) }
  }
  return (
    <form className="card" onSubmit={submit} style={{ marginTop: '1rem' }}>
      <div className="grid">
        <label>Brand<input required value={form.brand} onChange={e => setForm({ ...form, brand: e.target.value })} /></label>
        <label>Material<input required value={form.material} onChange={e => setForm({ ...form, material: e.target.value })} /></label>
        <label>Type<input required value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} /></label>
        <label>Color<input required value={form.color} onChange={e => setForm({ ...form, color: e.target.value })} /></label>
        <label>Hex<input type="color" value={form.colorHex} onChange={e => setForm({ ...form, colorHex: e.target.value })} /></label>
        <label>Net weight (g)<input type="number" value={form.defaultNetWeightGrams} onChange={e => setForm({ ...form, defaultNetWeightGrams: +e.target.value })} /></label>
        <label>Empty spool (g)<input type="number" value={form.emptySpoolWeightGrams} onChange={e => setForm({ ...form, emptySpoolWeightGrams: +e.target.value })} /></label>
      </div>
      <button type="submit" style={{ marginTop: '0.5rem' }}>Create</button>
    </form>
  )
}
