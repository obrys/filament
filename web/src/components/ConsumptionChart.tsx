import { useEffect, useRef, useState } from 'react'
import type { DailySeries } from '../api/client'

// Line + axis colors are the design-system variables --cyan (total stock) and --accent (consumed),
// so each polyline, its dotted y-ruler and its kg labels all share the same color, and everything
// follows the page theme (light/dark): the legend ink, axis labels and grid are theme-driven, which
// keeps them legible on both backgrounds (the SVG default black fill is invisible on the dark theme).
// Written to both the <polyline> stroke and the matching legend swatch so the visual rule can be
// asserted from the DOM (AC-1). GRID is a faint neutral for frames/date columns; INK is page text.
const TOTAL_COLOR = 'var(--cyan)'
const CONSUMED_COLOR = 'var(--accent)'
const GRID = 'var(--faint)'
const INK = 'var(--fg)'

// Nominal coordinate space; the SVG scales to 100% of the card width (no horizontal overflow).
// PAD_T is a header band that holds the legend and the fixed per-day readout (which no longer
// floats over the plot).
const W = 720
const H = 344
const PAD_L = 56
const PAD_R = 56
const PAD_T = 80
const PAD_B = 40
const PLOT_W = W - PAD_L - PAD_R
const PLOT_H = H - PAD_T - PAD_B

// The per-day readout is pinned to a fixed header position (right of the legend) instead of
// following the pointer — it only changes content as you hover/tap.
const PANEL = { x: 300, y: 6, w: 214, h: 66 }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Short month-day straight from the UTC day parts. Deliberately NOT `new Date(...)` /
 * `toLocaleDateString`, which would shift the day west of UTC (spec decision D9).
 */
function formatMD(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  if (!y || !m || !d || m < 1 || m > 12) return day
  return `${MONTHS[m - 1]} ${d}`
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** A kilogram value rendered without float noise and without a trailing ".00" (4 -> "4", 0.75 -> "0.75"). */
const fmtKg = (v: number): string => String(Math.round(v * 100) / 100)

// Candidate "nice" step sizes, in kilograms (1, 2, 2.5, 5 times a power of ten).
const NICE = [1, 2, 2.5, 5]

/**
 * A "nice" tick ladder for an axis measured in kilograms: always starts at 0, spans 3–6 values
 * (so the two axes can use different counts and their dotted rules never overlap), and rounds the
 * top up to a meaningful multiple (floor 1 kg, so an empty axis still reads 0…1 kg). Picks the
 * smallest top that fits, then the count closest to 5, then the sparser step.
 */
function niceTicks(maxKg: number, avoidCount?: number): number[] {
  const maxVal = Math.max(1, maxKg)
  const steps: number[] = []
  for (let e = -2; e <= 3; e++) for (const m of NICE) steps.push(m * Math.pow(10, e))
  const uniq = [...new Set(steps.map(s => Math.round(s * 1000) / 1000))].filter(s => s > 0).sort((a, b) => a - b)

  type C = { step: number; top: number; count: number }
  const cands: C[] = []
  for (const step of uniq) {
    const intervals = Math.ceil(maxVal / step - 1e-9)
    const top = Math.round(step * intervals * 100) / 100
    const count = intervals + 1
    if (count < 3 || count > 6) continue
    if (count === avoidCount) continue
    cands.push({ step, top, count })
  }
  if (!cands.length) { // fall back to "any 3–6" if the count constraint removed every option
    for (const step of uniq) {
      const intervals = Math.ceil(maxVal / step - 1e-9)
      const top = Math.round(step * intervals * 100) / 100
      const count = intervals + 1
      if (count >= 3 && count <= 6) cands.push({ step, top, count })
    }
  }
  cands.sort((A, B) => {
    const oA = A.top - maxVal, oB = B.top - maxVal
    if (oA !== oB) return oA - oB
    const sA = Math.abs(A.count - 5), sB = Math.abs(B.count - 5)
    if (sA !== sB) return sA - sB
    return B.step - A.step
  })
  const best = cands[0] ?? { step: maxVal / 4, top: maxVal, count: 5 }
  const ticks: number[] = []
  for (let i = 0; i < best.count; i++) ticks.push(Math.round(best.step * i * 100) / 100)
  return ticks
}

/**
 * A hand-built inline-SVG two-line graph over the provided zero-filled day series: a total-stock
 * line on the left axis and a consumed line on the right axis, both in kilograms. Hover (pointer)
 * and touch (tap) highlight the nearest day and show its exact values in a fixed readout box.
 * The client only renders what the API provides.
 */
export function ConsumptionChart({ series }: { series: DailySeries[] }) {
  const n = series.length

  const hitRef = useRef<SVGRectElement>(null)
  const [hover, setHover] = useState<number | null>(null)

  const maxStockKg = n ? Math.max(...series.map(s => s.totalStockGrams)) / 1000 : 0
  const maxConsumedKg = n ? Math.max(...series.map(s => s.consumedGrams)) / 1000 : 0

  // Nice kilogram ladders per axis. The right axis avoids the left axis' tick count so the two
  // dotted grids land at different heights and never alias (amendment: dotted kg rulers).
  const leftTicks = niceTicks(maxStockKg)
  const rightTicks = niceTicks(maxConsumedKg, leftTicks.length)
  const topStockKg = leftTicks[leftTicks.length - 1]
  const topConsumedKg = rightTicks[rightTicks.length - 1]

  const x = (i: number) => (n <= 1 ? PAD_L + PLOT_W / 2 : PAD_L + (PLOT_W * i) / (n - 1))
  const yStock = (vGrams: number) => clamp(PAD_T + PLOT_H * (1 - vGrams / 1000 / topStockKg), PAD_T, PAD_T + PLOT_H)
  const yCons = (vGrams: number) => clamp(PAD_T + PLOT_H * (1 - vGrams / 1000 / topConsumedKg), PAD_T, PAD_T + PLOT_H)

  const totalPoints = series.map((s, i) => `${x(i).toFixed(1)},${yStock(s.totalStockGrams).toFixed(1)}`).join(' ')
  const consumedPoints = series.map((s, i) => `${x(i).toFixed(1)},${yCons(s.consumedGrams).toFixed(1)}`).join(' ')

  // 7 evenly spaced x labels, always including the first day and today (6–8 required, AC-15).
  const labelCount = 7
  const labelIdx = Array.from(
    new Set(range(labelCount).map(k => Math.round((n - 1) * k / (labelCount - 1)))),
  ).filter(i => i >= 0 && i < n)

  function idxFromClient(clientX: number): number {
    const r = hitRef.current?.getBoundingClientRect()
    if (!r || r.width <= 0) return 0
    const f = (clientX - r.left) / r.width
    return clamp(Math.round(f * (n - 1)), 0, n - 1)
  }

  // A tap (touch) or click anywhere: over the plot selects that day, elsewhere hides the readout.
  useEffect(() => {
    function handle(clientX: number, clientY: number) {
      const r = hitRef.current?.getBoundingClientRect()
      if (!r) return
      const within = clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom
      setHover(within ? clamp(Math.round(((clientX - r.left) / r.width) * (n - 1)), 0, n - 1) : null)
    }
    function onPointerDown(ev: PointerEvent) { handle(ev.clientX, ev.clientY) }
    function onTouchStart(ev: TouchEvent) {
      const t = ev.touches[0]
      if (t) handle(t.clientX, t.clientY)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('touchstart', onTouchStart, { passive: true })
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('touchstart', onTouchStart)
    }
  }, [n])

  const hovered = hover !== null && series[hover] ? series[hover] : null

  const renderTicks = (
    ticks: number[], topId: string | null, zeroId: string | null, side: 'left' | 'right',
  ) => (
    <g fontSize={11}>
      {ticks
        .filter(t => t > 0)
        .map(t => {
          const y = side === 'left' ? yStock(t * 1000) : yCons(t * 1000)
          return (
            <line
              key={t}
              x1={PAD_L}
              x2={W - PAD_R}
              y1={y}
              y2={y}
              stroke={side === 'left' ? TOTAL_COLOR : CONSUMED_COLOR}
              strokeOpacity={0.32}
              strokeDasharray="3 4"
              pointerEvents="none"
            />
          )
        })}
      {ticks.map(t => {
        const y = side === 'left' ? yStock(t * 1000) : yCons(t * 1000)
        const isTop = t === ticks[ticks.length - 1]
        const isZero = t === 0
        return (
          <text
            key={t}
            data-testid={isTop ? topId : isZero ? zeroId : undefined}
            x={side === 'left' ? PAD_L - 8 : W - PAD_R + 8}
            y={y + 4}
            textAnchor={side === 'left' ? 'end' : 'start'}
            fill={side === 'left' ? TOTAL_COLOR : CONSUMED_COLOR}
          >
            {fmtKg(t)}{' kg'}
          </text>
        )
      })}
    </g>
  )

  const renderXGrid = () => labelIdx.map(i => {
    const gx = x(i)
    return (
      <line
        key={i}
        x1={gx} // Grey dotted column at each labeled date (amendment).
        x2={gx}
        y1={PAD_T}
        y2={PAD_T + PLOT_H}
        stroke={GRID}
        strokeOpacity={0.28}
        strokeDasharray="3 4"
        pointerEvents="none"
      />
    )
  })

  return (
    <div data-testid="consumption-chart" style={{ position: 'relative', width: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label="Consumption over the last 30 days: total stock and consumed per day, in kilograms"
        style={{ display: 'block', width: '100%', height: 'auto', aspectRatio: `${W} / ${H}`, fontFamily: 'inherit' }}
        onPointerLeave={() => setHover(null)}
      >
        {/* Legend: exactly two entries, each swatch matching its line's color (AC-1). */}
        <g data-testid="legend-total">
          <rect x={PAD_L} y={12} width={12} height={12} rx={2} fill={TOTAL_COLOR} />
          <text x={PAD_L + 18} y={22} fontSize={13} fontWeight={600} fill={INK}>{'Total stock'}</text>
        </g>
        <g data-testid="legend-consumed">
          <rect x={PAD_L + 150} y={12} width={12} height={12} rx={2} fill={CONSUMED_COLOR} />
          <text x={PAD_L + 168} y={22} fontSize={13} fontWeight={600} fill={INK}>{'Consumed'}</text>
        </g>

        {/* Fixed per-day readout — pinned next to the legend (not floating). Shown only while a
            day is hovered/tapped; content updates day by day. */}
        {hovered && (
          <g data-testid="tooltip" transform={`translate(${PANEL.x}, ${PANEL.y})`}>
            <rect width={PANEL.w} height={PANEL.h} rx={7} fill="var(--surface-glass)" stroke="var(--border-strong)" />
            <text x={12} y={22} fontSize={13} fontWeight={700} fill={INK}>{formatMD(hovered.day)}</text>
            <text x={12} y={42} fontSize={13} fill={TOTAL_COLOR}>
              {'Total stock: '}{hovered.totalStockGrams}{' g'}
            </text>
            <text x={12} y={60} fontSize={13} fill={CONSUMED_COLOR}>
              {'Consumed: '}{hovered.consumedGrams}{' g'}
            </text>
          </g>
        )}

        {/* Frame: left/right edges and the shared baseline (the 0 gridline). */}
        <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={PAD_T + PLOT_H} stroke={GRID} strokeOpacity={0.35} pointerEvents="none" />
        <line x1={W - PAD_R} y1={PAD_T} x2={W - PAD_R} y2={PAD_T + PLOT_H} stroke={GRID} strokeOpacity={0.35} pointerEvents="none" />
        <line x1={PAD_L} y1={PAD_T + PLOT_H} x2={W - PAD_R} y2={PAD_T + PLOT_H} stroke={GRID} strokeOpacity={0.5} pointerEvents="none" />

        {/* Dotted kg rulers: left in the total line's color, right in the consumed line's. */}
        <g data-testid="axis-left">{renderTicks(leftTicks, 'axis-left-top', 'axis-left-zero', 'left')}</g>
        <g data-testid="axis-right">{renderTicks(rightTicks, 'axis-right-top', 'axis-right-zero', 'right')}</g>

        {/* Grey dotted columns at the actual labeled date positions. */}
        {renderXGrid()}

        {/* X-axis: short month-day from UTC day parts (AC-2, AC-11, AC-15). */}
        <g data-testid="x-axis" fontSize={11} fill="var(--muted)">
          {labelIdx.map(i => (
            <text key={i} x={x(i)} y={PAD_T + PLOT_H + 20} textAnchor="middle">{formatMD(series[i].day)}</text>
          ))}
        </g>

        {/* The two data lines. */}
        {n > 0 && (
          <>
            <polyline data-testid="line-total" points={totalPoints} fill="none"
              stroke={TOTAL_COLOR} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" pointerEvents="none" />
            <polyline data-testid="line-consumed" points={consumedPoints} fill="none"
              stroke={CONSUMED_COLOR} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" pointerEvents="none" />
          </>
        )}

        {/* Hover / touch: vertical day highlight (the readout box stays in its fixed header spot). */}
        {hovered && (
          <line data-testid="hover-highlight" x1={x(hover!)} x2={x(hover!)} y1={PAD_T} y2={PAD_T + PLOT_H}
            stroke={GRID} strokeWidth={1.2} strokeDasharray="4 3" pointerEvents="none" />
        )}

        {/* Transparent hit area exactly covering the plot, for hover/tap detection. */}
        <rect ref={hitRef} data-testid="plot-hit" x={PAD_L} y={PAD_T} width={PLOT_W} height={PLOT_H}
          fill="transparent" style={{ cursor: 'crosshair' }}
          onPointerMove={e => setHover(idxFromClient(e.clientX))}
          onPointerLeave={() => setHover(null)} />
      </svg>
    </div>
  )
}

function range(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i)
}
