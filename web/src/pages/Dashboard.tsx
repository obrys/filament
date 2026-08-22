import { useEffect, useState } from 'react'
import { api, type DashboardSummary, type DailySeries } from '../api/client'
import { onChange } from '../realtime/useChangeStream'
import { SpoolViz } from '../components/SpoolViz'
import { ConsumptionChart } from '../components/ConsumptionChart'
import { IconChart, IconCheck, IconScale, IconSpool, IconTypes } from '../components/icons'

/** Decorative spools in the header — a shelf of stock, not real data. */
const SHELF = [
  { colorHex: '#ff7a18', fill: 0.92 },
  { colorHex: '#35d7f0', fill: 0.55 },
  { colorHex: '#c084fc', fill: 0.28 },
]

export function Dashboard() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [usage, setUsage] = useState<DailySeries[]>([])

  const load = () => {
    api.dashboard.summary().then(setSummary).catch(console.error)
    api.dashboard.usage(30).then(setUsage).catch(console.error)
  }
  useEffect(() => {
    load()
    return onChange(m => { if (m.resource === 'spool' || m.resource === 'filament-type') load() })
  }, [])

  // Prints-only hero figures (the consumed line), consistent with the chart (B3).
  const totalUsage = usage.reduce((sum, u) => sum + u.consumedGrams, 0)
  const busiest = usage.reduce<DailySeries | null>((best, u) => (best && best.consumedGrams >= u.consumedGrams ? best : u), null)

  return (
    <>
      <section className="spool-hero">
        <div className="spool-hero__art hero-shelf">
          {SHELF.map((s, i) => (
            <SpoolViz key={i} colorHex={s.colorHex} fill={s.fill} size={i === 0 ? 104 : 74} spin={i === 0} />
          ))}
        </div>
        <div className="spool-hero__body">
          <h1>Workshop overview</h1>
          <p className="page-head__sub">
            Every spool, every gram — tracked from the sealed bag to the last centimetre of filament.
          </p>
          {summary && (
            <div className="spool-hero__stats">
              <div className="spool-hero__stat">
                <div className="muted">On the shelf</div>
                <div>{(summary.totalRemainingGrams / 1000).toFixed(2)} kg</div>
              </div>
              <div className="spool-hero__stat">
                <div className="muted">Used (30 d)</div>
                <div>{(totalUsage / 1000).toFixed(2)} kg</div>
              </div>
              <div className="spool-hero__stat">
                <div className="muted">Busiest day</div>
                <div>{busiest && busiest.consumedGrams > 0 ? `${busiest.consumedGrams} g` : '—'}</div>
              </div>
            </div>
          )}
        </div>
      </section>

      {summary && (
        <div className="stats">
          <Stat label="Filament types" value={summary.filamentTypeCount} icon={<IconTypes />} tone="cyan" />
          <Stat label="Active spools" value={summary.activeSpoolCount} icon={<IconSpool />} tone="accent" />
          <Stat label="Finished spools" value={summary.finishedSpoolCount} icon={<IconCheck />} tone="muted" />
          <Stat label="Total remaining" value={`${(summary.totalRemainingGrams / 1000).toFixed(2)} kg`} icon={<IconScale />} tone="ok" />
        </div>
      )}

      <div className="section-title">
        <IconChart style={{ width: 18, height: 18, color: 'var(--accent)' }} />
        <h2>Consumption · last 30 days</h2>
        <span className="section-title__rule" />
      </div>

      <div className="card">
        <ConsumptionChart series={usage} />
      </div>
    </>
  )
}

type StatProps = {
  label: string
  value: string | number
  icon: React.ReactNode
  tone: 'accent' | 'cyan' | 'ok' | 'muted'
}

function Stat({ label, value, icon, tone }: StatProps) {
  return (
    <div className="card stat">
      <div className={`stat__icon${tone === 'accent' ? '' : ` stat__icon--${tone}`}`}>{icon}</div>
      <div className="stat__body">
        <div className="muted">{label}</div>
        <div>{value}</div>
      </div>
    </div>
  )
}
