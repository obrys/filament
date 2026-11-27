import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, Link, useSearchParams } from 'react-router'
import { api, type PrintProject, type FilamentType, type ProjectPrint } from '../api/client'
import { onChange } from '../realtime/useChangeStream'
import { ProjectForm } from '../components/ProjectForm'
import { TypeLine } from '../components/spool-bits'
import {
  IconArchive, IconArrowLeft, IconHistory, IconPencil, IconPrinter, IconTrash,
} from '../components/icons'

export function PrintProjectDetail() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [project, setProject] = useState<PrintProject | null>(null)
  const [types, setTypes] = useState<Record<string, FilamentType>>({})
  const [showForm, setShowForm] = useState(() => params.get('edit') === '1')
  const highlight = params.get('highlight')
  const highlightRef = useRef<HTMLTableRowElement>(null)

  const load = async () => {
    try {
      const p = await api.printProjects.get(id)
      setProject(p)
      setTypes(Object.fromEntries((await api.types.list()).items.map(t => [t.id, t])))
    } catch (e) { console.error(e) }
  }
  useEffect(() => {
    load()
    return onChange(m => {
      if (m.resource === 'print-project' && (!m.id || m.id === id)) load()
      if (m.resource === 'spool' && !m.id) load()
    })
  }, [id])

  // Row highlight from ?highlight=<printId>: mark the row and scroll it into view on first render.
  useEffect(() => {
    if (highlight && highlightRef.current) {
      highlightRef.current.scrollIntoView({ block: 'center' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlight, project?.prints?.length])

  if (!project) return <p className="muted">Loading…</p>

  const act = async (fn: () => Promise<unknown>) => {
    try { await fn(); await load() } catch (err: any) { alert(err.message) }
  }

  const doArchive = () => {
    if (!project.isArchived) {
      if (!confirm(`Archive "${project.title}"? An archived project cannot be printed or edited.`)) return
      act(() => api.printProjects.archive(project.id))
    } else {
      if (!confirm(`Unarchive "${project.title}"?`)) return
      act(() => api.printProjects.unarchive(project.id))
    }
  }

  const canDelete = project.isArchived && !project.hasEnabledPrints
  const deleteTitle = canDelete
    ? 'Delete this project, all of its prints and the linked spool events'
    : 'A project can be deleted only when it is archived and has no active prints.'
  const doDelete = async () => {
    if (!canDelete) return
    if (!confirm(`Delete project "${project.title}"? This removes the project, all of its prints and the linked spool events.`)) return
    try { await api.printProjects.delete(project.id); navigate('/print-projects') } catch (err: any) { alert(err.message) }
  }

  const togglePrint = (print: ProjectPrint) =>
    act(() => (print.isDisabled
      ? api.printProjects.redoPrint(project.id, print.id)
      : api.printProjects.undoPrint(project.id, print.id)))

  const closeForm = () => {
    setShowForm(false)
    if (params.get('edit') === '1') {
      const next = new URLSearchParams(params)
      next.delete('edit')
      setParams(next, { replace: true })
    }
  }

  return (
    <>
      <Link to="/print-projects" className="back-link"><IconArrowLeft style={{ width: 15, height: 15 }} /> All projects</Link>

      <section className="spool-hero project-hero">
        <div className="spool-hero__body" style={{ flex: 1 }}>
          <h1>
            {project.title}
            {project.isArchived && <span className="badge badge--archived" style={{ marginLeft: '0.5rem' }}>Archived</span>}
          </h1>
          <div className="meta-row" style={{ marginTop: '0.35rem' }}>
            <span className="muted">
              {project.isArchived
                ? `Archived ${new Date(project.archivedAt ?? project.createdAt).toLocaleString()}`
                : `Created ${new Date(project.createdAt).toLocaleString()}`}
            </span>
          </div>
          {project.description && <p className="project-description">{project.description}</p>}
          {project.url && (
            <p style={{ margin: '0.35rem 0 0' }}>
              <a href={project.url} target="_blank" rel="noreferrer">{project.url}</a>
            </p>
          )}

          <div className="specs" style={{ marginTop: '0.75rem' }}>
            {project.types.map(t => {
              const ft = types[t.filamentTypeId]
              return (
                <div className="spec" key={t.filamentTypeId}>
                  <strong>
                    {ft ? <TypeLine type={ft} /> : <span className="mono">{t.filamentTypeId}</span>}
                  </strong>{' '}
                  · {t.grams} g
                </div>
              )
            })}
          </div>

          <div className="meta-row" style={{ marginTop: '0.75rem' }}>
            {!project.isArchived && (
              <Link to={`/print-projects/${project.id}/print`} className="button-link"><IconPrinter style={{ width: 16, height: 16 }} /> Print</Link>
            )}
            {!project.isArchived && (
              <button className="ghost" onClick={() => setShowForm(s => !s)}>
                <IconPencil style={{ width: 16, height: 16 }} /> Edit
              </button>
            )}
            <button className="ghost" onClick={doArchive}>
              <IconArchive style={{ width: 16, height: 16 }} /> {project.isArchived ? 'Unarchive' : 'Archive'}
            </button>
          </div>
        </div>
      </section>

      {showForm && (
        <ProjectForm types={Object.values(types)} project={project} onSaved={closeForm} />
      )}

      <div className="card card--danger">
        <h3>Delete project</h3>
        <p className="muted">
          A project can only be deleted once it is archived and every print has been undone.
          Deleting removes the project, all of its prints and the linked spool events.
        </p>
        <button className="danger" disabled={!canDelete} title={deleteTitle} onClick={doDelete}
          data-testid="delete-project">
          <IconTrash style={{ width: 16, height: 16 }} /> Delete project
        </button>
      </div>

      <div className="section-title">
        <IconHistory style={{ width: 18, height: 18, color: 'var(--accent)' }} />
        <h2>Project prints</h2>
        <span className="section-title__rule" />
        <span className="muted mono">{project.prints?.length ?? 0} prints</span>
      </div>

      <div className="card card--flush table-wrap">
        <table>
          <thead><tr><th>When</th><th>Spools</th><th></th></tr></thead>
          <tbody>
            {(project.prints ?? []).map(pr => (
              <tr key={pr.id}
                ref={pr.id === highlight ? highlightRef : undefined}
                className={[pr.isDisabled ? 'event-disabled' : '', pr.id === highlight ? 'is-highlighted' : ''].join(' ').trim()}
                data-testid={pr.id === highlight ? 'highlighted-print' : undefined}>
                <td data-label="When" className="muted mono">{new Date(pr.occurredAt).toLocaleString()}</td>
                <td data-label="Spools">
                  {pr.events.map(ev => (
                    <div key={ev.spoolEventId}>
                      <Link to={`/spools/${ev.spoolId}?highlight=${ev.spoolEventId}`} className="id-pill">{ev.spoolId}</Link>
                      {ev.brand && (
                        <span className="muted">
                          {' '}{ev.material} {ev.type} · {ev.color}
                        </span>
                      )}
                      <span className="num is-neg"> −{ev.grams} g</span>
                    </div>
                  ))}
                </td>
                <td data-label="">
                  {!project.isArchived && (
                    pr.isDisabled
                      ? <button className="link" onClick={() => togglePrint(pr)}>Redo</button>
                      : <button className="link" onClick={() => togglePrint(pr)}>Undo</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(project.prints ?? []).length === 0 && (
          <div className="empty-state">
            <strong>No prints yet</strong>
            <span>Use the Print action to enter this project's consumption.</span>
          </div>
        )}
      </div>
    </>
  )
}
