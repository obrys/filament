import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api, type PrintProject, type FilamentType } from '../api/client'
import { onChange } from '../realtime/useChangeStream'
import { ProjectForm } from '../components/ProjectForm'
import { TypeLine } from '../components/spool-bits'
import { IconArchive, IconClose, IconInbox, IconPencil, IconPlus, IconPrinter, IconTrash } from '../components/icons'

export function PrintProjects() {
  const [projects, setProjects] = useState<PrintProject[]>([])
  const [types, setTypes] = useState<Record<string, FilamentType>>({})
  const [showArchived, setShowArchived] = useState(false)
  const [showForm, setShowForm] = useState(false)

  const load = () => {
    api.printProjects.list(showArchived).then(r => setProjects(r.items)).catch(console.error)
    api.types.list().then(r => setTypes(Object.fromEntries(r.items.map(t => [t.id, t])))).catch(console.error)
  }
  useEffect(() => {
    load()
    return onChange(m => { if (m.resource === 'print-project') load() })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchived])

  const act = async (fn: () => Promise<unknown>) => {
    try { await fn(); load() } catch (err: any) { alert(err.message) }
  }

  const archive = async (p: PrintProject) => {
    if (p.isArchived) {
      if (!confirm(`Unarchive "${p.title}"?`)) return
      await act(() => api.printProjects.unarchive(p.id))
    } else {
      if (!confirm(`Archive "${p.title}"? An archived project cannot be printed or edited.`)) return
      await act(() => api.printProjects.archive(p.id))
    }
  }

  const remove = async (p: PrintProject) => {
    if (!confirm(`Delete project "${p.title}"? This removes the project, all of its prints and the linked spool events.`)) return
    await act(() => api.printProjects.delete(p.id))
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Print projects</h1>
          <p className="page-head__sub">
            {projects.length} project{projects.length === 1 ? '' : 's'} in view — reusable patterns for entering prints.
          </p>
        </div>
      </div>

      <div className="toolbar">
        <button onClick={() => setShowForm(s => !s)}>
          {showForm ? <><IconClose /> Close</> : <><IconPlus /> New project</>}
        </button>
        <label className={`control${showArchived ? ' control--on' : ''}`}>
          <input type="checkbox" checked={showArchived}
            onChange={e => setShowArchived(e.target.checked)} /> Show archived
        </label>
      </div>

      {showForm && (
        <ProjectForm
          types={Object.values(types)}
          onSaved={() => { setShowForm(false); load() }}
        />
      )}

      <div className="card card--flush table-wrap" style={{ marginTop: '1rem' }}>
        <table>
          <thead>
            <tr><th>Project</th><th>Types</th><th>Last activity</th><th></th></tr>
          </thead>
          <tbody>
            {projects.map(p => (
              <tr key={p.id}>
                <td data-label="Project">
                  <Link to={`/print-projects/${p.id}`} className="project-title">{p.title}</Link>{' '}
                  {p.isArchived && <span className="badge badge--archived">Archived</span>}
                </td>
                <td data-label="Types">
                  {p.types.map(t => {
                    const ft = types[t.filamentTypeId]
                    return (
                      <div key={t.filamentTypeId}>
                        {ft ? <TypeLine type={ft} /> : <span className="mono muted">{t.filamentTypeId}</span>}
                        <span className="muted"> · {t.grams} g</span>
                      </div>
                    )
                  })}
                </td>
                <td data-label="Last activity" className="muted mono">{new Date(p.effectiveAt).toLocaleString()}</td>
                <td data-label="">
                  <span className="row-actions">
                    {!p.isArchived && (
                      <Link to={`/print-projects/${p.id}/print`} className="link" title="Print">
                        <IconPrinter style={{ width: 15, height: 15 }} /> Print
                      </Link>
                    )}
                    {!p.isArchived && (
                      <Link to={`/print-projects/${p.id}?edit=1`} className="link" title="Edit">
                        <IconPencil style={{ width: 15, height: 15 }} /> Edit
                      </Link>
                    )}
                    <button className="link" onClick={() => archive(p)} title={p.isArchived ? 'Unarchive' : 'Archive'}>
                      <IconArchive style={{ width: 15, height: 15 }} /> {p.isArchived ? 'Unarchive' : 'Archive'}
                    </button>
                    {p.isArchived && !p.hasEnabledPrints && (
                      <button className="link link--danger" onClick={() => remove(p)} title="Delete">
                        <IconTrash style={{ width: 15, height: 15 }} /> Delete
                      </button>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {projects.length === 0 && (
          <div className="empty-state">
            <IconInbox />
            <strong>No print projects here</strong>
            <span>{showArchived ? 'No projects at all — create the first one to get started.' : 'Create a project, or enable "Show archived".'}</span>
          </div>
        )}
      </div>
    </>
  )
}
