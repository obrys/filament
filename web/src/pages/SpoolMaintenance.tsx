import { useState } from 'react'
import { Link } from 'react-router'
import { api, type ReevaluateResult } from '../api/client'

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
      <p><Link to="/spools">← All spools</Link></p>
      <h1>Re-evaluate spool states</h1>
      <div className="card">
        <p style={{ marginTop: 0 }}>
          Every spool's status and remaining weight are derived from its events and cached on the
          record. In rare cases — typically after a manual database intervention — a cached value can
          drift from what the events imply. Running a re-evaluation recomputes every spool from its
          enabled events, saves any corrections, and reports what changed. It is always safe to run.
        </p>
        <button onClick={run} disabled={running}>{running ? 'Re-evaluating…' : 'Re-evaluate all spools'}</button>
      </div>

      {error && <div className="card" style={{ color: 'var(--danger, #b00)' }}>{error}</div>}

      {result && (
        <div className="card">
          <p style={{ marginTop: 0 }}>
            Checked <strong>{result.totalSpools}</strong> spools —{' '}
            <strong>{result.changedSpools}</strong> corrected.
          </p>
          {result.changedSpools === 0
            ? <p className="muted">Everything was already consistent.</p>
            : (
              <div style={{ overflowX: 'auto' }}>
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
                        <td data-label="Remaining">
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
