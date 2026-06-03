import { useEffect, useState } from 'react'
import { api, type DashboardSummary, type DailyUsage } from '../api/client'
import { onChange } from '../realtime/useChangeStream'

export function Dashboard() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [usage, setUsage] = useState<DailyUsage[]>([])

  const load = () => {
    api.dashboard.summary().then(setSummary).catch(console.error)
    api.dashboard.usage(30).then(setUsage).catch(console.error)
  }
  useEffect(() => {
    load()
    return onChange(m => { if (m.resource === 'spool' || m.resource === 'filament-type') load() })
  }, [])

  const maxUsage = Math.max(1, ...usage.map(u => u.consumedGrams))

  return (
    <>
      <h1>Dashboard</h1>
      {summary && (
        <div className="grid">
          <Stat label="Filament types" value={summary.filamentTypeCount} />
          <Stat label="Active spools" value={summary.activeSpoolCount} />
          <Stat label="Finished spools" value={summary.finishedSpoolCount} />
          <Stat label="Total remaining" value={`${(summary.totalRemainingGrams / 1000).toFixed(2)} kg`} />
        </div>
      )}
      <h2>Consumption (last 30 days)</h2>
      <div className="card">
        {usage.length === 0 ? (
          <p className="muted">No usage recorded yet.</p>
        ) : (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 120 }}>
            {usage.map(u => (
              <div key={u.day} title={`${u.day}: ${u.consumedGrams}g`}
                style={{
                  flex: 1,
                  background: '#2563eb',
                  height: `${(u.consumedGrams / maxUsage) * 100}%`,
                  minHeight: 2,
                  borderRadius: '2px 2px 0 0',
                }} />
            ))}
          </div>
        )}
      </div>
    </>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card">
      <div className="muted">{label}</div>
      <div style={{ fontSize: '1.6rem', fontWeight: 700 }}>{value}</div>
    </div>
  )
}
