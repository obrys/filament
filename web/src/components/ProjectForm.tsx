import { useMemo, useState } from 'react'
import { api, type FilamentType, type PrintProject, type PrintProjectBody } from '../api/client'
import { IconClose, IconPlus } from './icons'

type Line = { filamentTypeId: string; grams: number | '' }

const MAX_TITLE = 256
const MAX_DESCRIPTION = 1024
const MAX_URL = 1024

/** Mirrors the server's PrintProjectRules.ValidateDefinition (visible inline error + disabled submit). */
function validate(title: string, description: string, url: string, lines: Line[]): string | null {
  if (!title.trim()) return 'Title is required.'
  if (title.length > MAX_TITLE) return `Title must be at most ${MAX_TITLE} characters.`
  if (description.length > MAX_DESCRIPTION) return `Description must be at most ${MAX_DESCRIPTION} characters.`
  if (url.length > MAX_URL) return `URL must be at most ${MAX_URL} characters.`
  if (lines.length === 0) return 'Add at least one filament type.'
  const seen = new Set<string>()
  for (const line of lines) {
    if (!line.filamentTypeId) return 'Pick a filament type for every line.'
    if (seen.has(line.filamentTypeId)) return `Filament type ${line.filamentTypeId} is defined more than once.`
    seen.add(line.filamentTypeId)
    const grams = Number(line.grams)
    if (!Number.isInteger(grams) || grams < 1) return `Grams for ${line.filamentTypeId} must be a positive whole number.`
  }
  return null
}

/**
 * Shared create/edit form for print projects. Without `project` it creates; with `project` it
 * prefills and updates. Server-side validation re-checks everything; API errors surface via alert.
 */
export function ProjectForm({ types, project, onSaved }: {
  types: FilamentType[]
  project?: PrintProject
  onSaved: () => void
}) {
  const [title, setTitle] = useState(project?.title ?? '')
  const [description, setDescription] = useState(project?.description ?? '')
  const [url, setUrl] = useState(project?.url ?? '')
  const [lines, setLines] = useState<Line[]>(
    project
      ? project.types.map(t => ({ filamentTypeId: t.filamentTypeId, grams: t.grams }))
      : [{ filamentTypeId: types[0]?.id ?? '', grams: '' }],
  )

  const error = useMemo(() => validate(title, description, url, lines), [title, description, url, lines])

  const setLine = (index: number, patch: Partial<Line>) =>
    setLines(prev => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (error) return
    const body: PrintProjectBody = {
      title,
      description: description || null,
      url: url || null,
      types: lines.map(l => ({ filamentTypeId: l.filamentTypeId, grams: Number(l.grams) })),
    }
    try {
      if (project) await api.printProjects.update(project.id, body)
      else await api.printProjects.create(body)
      onSaved()
    } catch (err: any) { alert(err.message) }
  }

  return (
    <form className="card card--accent" onSubmit={submit} style={{ marginTop: '1rem' }} data-testid="project-form">
      <h3>{project ? 'Edit project' : 'New project'}</h3>
      <div className="grid">
        <label>Title
          <input value={title} onChange={e => setTitle(e.target.value)} maxLength={MAX_TITLE} placeholder="Benchy v3" />
        </label>
        <label>URL
          <input value={url} onChange={e => setUrl(e.target.value)} maxLength={MAX_URL} placeholder="https://…" />
        </label>
      </div>
      <label style={{ display: 'block' }}>Description
        <textarea value={description} onChange={e => setDescription(e.target.value)} maxLength={MAX_DESCRIPTION} rows={3} />
      </label>

      <h4 style={{ marginBottom: '0.35rem' }}>Filament types</h4>
      {lines.map((line, i) => (
        <div className="grid grid--type-line" key={i} data-testid="project-type-line">
          <label>Filament type
            <select value={line.filamentTypeId} onChange={e => setLine(i, { filamentTypeId: e.target.value })}>
              {types.map(t => <option key={t.id} value={t.id}>{t.id} — {t.brand} · {t.material} · {t.type} · {t.color}</option>)}
            </select>
          </label>
          <label>Grams
            <input type="number" min={1} step={1} aria-label={`Grams for type ${i + 1}`}
              value={line.grams} onChange={e => setLine(i, { grams: e.target.value === '' ? '' : +e.target.value })} />
          </label>
          <button type="button" className="icon-btn" title="Remove line" aria-label="Remove line"
            onClick={() => setLines(prev => prev.filter((_, j) => j !== i))}>
            <IconClose />
          </button>
        </div>
      ))}
      <button type="button" className="ghost" onClick={() => setLines(prev => [...prev, { filamentTypeId: types[0]?.id ?? '', grams: '' }])}>
        <IconPlus /> Add type
      </button>

      {error && <p className="form-error" role="alert">{error}</p>}
      <button type="submit" disabled={error !== null} style={{ marginTop: '0.85rem' }}>
        {project ? 'Save changes' : 'Create'}
      </button>
    </form>
  )
}
