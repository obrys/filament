import { useState } from 'react'
import { Link } from 'react-router'
import { api, type ReevaluateResult } from '../api/client'
import { IconAlert, IconArrowLeft, IconCheck, IconWrench } from '../components/icons'

export function SpoolMaintenance() {
  const [result, setResult] = useState<ReevaluateResult | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    setRunning(true)
    setError(null)
    try { setResult(await api.spools.reevaluate()) }
    catch (err: any) { setError(err.message) }
    finally { setRunning(false) }
  }

  return (
    <>
      <Link to="/spools" className="back-link"><IconArrowLeft style={{ width: 15, height: 15 }} /> All spools</Link>
      <h1><IconWrench style={{ width: 24, height: 24, color: 'var(--accent)' }} /> Re-evaluate spool states</h1>

      <div className="card">
        <p className="muted">
          Every spool's status and remaining weight are derived from its events and cached on the
          record. In rare cases — typically after a manual database intervention — a cached value can
          drift from what the events imply. Running a re-evaluation recomputes every spool from its
          enabled events, saves any corrections, and reports what changed. It is always safe to run.
        </p>
        <button onClick={run} disabled={running} style={{ marginTop: '0.5rem' }}>
          {running ? <><span className="btn-spinner" /> Re-evaluating…</> : <><IconWrench /> Re-evaluate all spools</>}
        </button>
      </div>

      {error && (
        <div className="card card--danger">
          <strong><IconAlert style={{ width: 16, height: 16, verticalAlign: '-3px', marginRight: '0.35rem' }} />Failed</strong>
          <p style={{ marginTop: '0.35rem' }}>{error}</p>
        </div>
      )}

      {result && (
        <div className="card">
          <p>
            Checked <strong className="num">{result.totalSpools}</strong> spools —{' '}
            <strong className="num">{result.changedSpools}</strong> corrected.
          </p>
          {result.changedSpools === 0
            ? (
              <div className="empty-state">
                <IconCheck />
                <strong>Everything was already consistent</strong>
                <span>No cached value had drifted from its event history.</span>
              </div>
            )
            : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Spool</th><th>Status (was → now)</th><th>Remaining (was → now)</th></tr>
                  </thead>
                  <tbody>
                    {result.differences.map(d => (
                      <tr key={d.spoolId}>
                        <td data-label="Spool"><Link to={`/spools/${d.spoolId}`} className="id-pill">{d.spoolId}</Link></td>
                        <td data-label="Status">
                          {d.oldStatus === d.newStatus ? d.oldStatus : <>{d.oldStatus} → <strong>{d.newStatus}</strong></>}
                        </td>
                        <td data-label="Remaining" className="num">
                          {d.oldRemainingGrams === d.newRemainingGrams
                            ? `${d.oldRemainingGrams} g`
                            : <>{d.oldRemainingGrams} g → <strong>{d.newRemainingGrams} g</strong></>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </div>
      )}
    </>
  )
}
