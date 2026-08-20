import type { FilamentType, Spool } from '../api/client'

/** Below this fraction of the initial net weight a spool is treated as running low. */
export const LOW_FRACTION = 0.05

export function StatusBadge({ status }: { status: Spool['status'] }) {
  return <span className={`badge badge--${status.toLowerCase()}`}>{status}</span>
}

/** Brand · material · type · colour, with the colour swatch in front. */
export function TypeLine({ type, showId = false }: { type: FilamentType; showId?: boolean }) {
  return (
    <span className="type-line">
      {type.colorHex && <span className="swatch" style={{ background: type.colorHex }} />}
      <span className="type-line__brand">{type.brand}</span>
      <span className="type-line__rest">
        {type.material} <span className="type-line__sep">·</span> {type.type}{' '}
        <span className="type-line__sep">·</span> {type.color}
      </span>
      {showId && <span className="id-pill">{type.id}</span>}
    </span>
  )
}

/** Horizontal fill bar plus the exact gram figure. */
export function RemainingGauge({ remaining, initial }: { remaining: number; initial: number }) {
  const fraction = initial > 0 ? Math.min(1, Math.max(0, remaining / initial)) : 0
  const tone = remaining <= 0 ? ' gauge__fill--empty' : fraction <= LOW_FRACTION ? ' gauge__fill--low' : ''
  return (
    <span className="gauge" title={`${remaining} g of ${initial} g`}>
      <span className="gauge__track">
        <span className={`gauge__fill${tone}`} style={{ width: `${fraction * 100}%` }} />
      </span>
      <span className="gauge__value">{remaining} g <small>/ {initial}</small></span>
    </span>
  )
}
