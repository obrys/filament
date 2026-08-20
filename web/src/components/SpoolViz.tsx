import { useId } from 'react'

type Props = {
  /** Filament colour as `#rrggbb`. Falls back to the brand orange when unknown. */
  colorHex?: string | null
  /** Remaining fraction of the spool, 0…1. */
  fill?: number
  /** Rendered edge length in pixels. */
  size?: number
  /** Slowly rotate the coil — used for the single large hero illustration. */
  spin?: boolean
  /** Dim the whole spool, e.g. for finished spools. */
  dimmed?: boolean
  className?: string
  title?: string
}

const FALLBACK = '#ff7a18'

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0)

/** Parses `#rgb`/`#rrggbb` into 0–255 channels; returns null for anything else. */
function parseHex(hex: string | null | undefined): [number, number, number] | null {
  if (!hex) return null
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const h = m[1].length === 3 ? m[1].replace(/./g, c => c + c) : m[1]
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

/** Mixes a colour towards white (amount > 0) or black (amount < 0). */
function shade(rgb: [number, number, number], amount: number): string {
  const target = amount > 0 ? 255 : 0
  const t = Math.abs(amount)
  const [r, g, b] = rgb.map(c => Math.round(c + (target - c) * t))
  return `rgb(${r} ${g} ${b})`
}

/**
 * A face-on 3D-printer filament spool drawn as pure SVG.
 *
 * The wound coil shrinks *by area*, not by width: a half-empty spool has a coil whose outer
 * radius is sqrt((rHub² + rMax²) / 2), which is how a real spool looks when it is half used.
 * Everything is derived from the filament's own colour, so a list of spools reads at a glance.
 */
export function SpoolViz({
  colorHex,
  fill = 1,
  size = 64,
  spin = false,
  dimmed = false,
  className,
  title,
}: Props) {
  const uid = useId().replace(/:/g, '')
  const rgb = parseHex(colorHex) ?? parseHex(FALLBACK)!
  const f = clamp01(fill)

  const R_HUB = 17
  const R_MAX = 43
  // Equal-area interpolation between the bare hub and a full spool.
  const rCoil = Math.sqrt(R_HUB * R_HUB + f * (R_MAX * R_MAX - R_HUB * R_HUB))

  const light = shade(rgb, 0.42)
  const base = shade(rgb, 0)
  const dark = shade(rgb, -0.4)

  // Groove rings, drawn only where filament actually remains.
  const grooves: number[] = []
  for (let r = R_MAX - 4; r > R_HUB + 2; r -= 5) if (r < rCoil - 1.5) grooves.push(r)

  return (
    <svg
      className={['spool-viz', spin ? 'spool-viz--spin' : '', className].filter(Boolean).join(' ')}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role={title ? 'img' : 'presentation'}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={dimmed ? { opacity: 0.45, filter: 'saturate(0.35)' } : undefined}
    >
      <defs>
        <linearGradient id={`c${uid}`} x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor={light} />
          <stop offset="0.45" stopColor={base} />
          <stop offset="1" stopColor={dark} />
        </linearGradient>
        <linearGradient id={`f${uid}`} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="rgba(255,255,255,0.30)" />
          <stop offset="0.5" stopColor="rgba(255,255,255,0.06)" />
          <stop offset="1" stopColor="rgba(0,0,0,0.35)" />
        </linearGradient>
        <radialGradient id={`h${uid}`} cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor="rgba(255,255,255,0.85)" />
          <stop offset="1" stopColor="rgba(140,150,168,0.9)" />
        </radialGradient>
      </defs>

      {/* Translucent flange the filament is wound between */}
      <circle cx="50" cy="50" r="46" fill="rgba(148,163,184,0.13)" stroke="rgba(148,163,184,0.32)" strokeWidth="1.5" />
      <circle cx="50" cy="50" r="43.5" fill="none" stroke="rgba(0,0,0,0.18)" strokeWidth="1" />

      {/* Ghost of the missing filament, so the used amount stays visible */}
      {f < 0.995 && (
        <>
          <circle cx="50" cy="50" r={(R_MAX + rCoil) / 2} fill="none" strokeWidth={R_MAX - rCoil}
            stroke="rgba(148,163,184,0.09)" />
          <circle cx="50" cy="50" r={R_MAX} fill="none" strokeWidth="0.8"
            stroke="rgba(148,163,184,0.35)" strokeDasharray="3 3" />
        </>
      )}

      {/* The wound filament */}
      {f > 0.002 && (
        <>
          <circle cx="50" cy="50" r={rCoil} fill={`url(#c${uid})`} />
          <g fill="none" stroke="rgba(0,0,0,0.18)" strokeWidth="1.1">
            {grooves.map(r => <circle key={r} cx="50" cy="50" r={r} />)}
          </g>
          <circle cx="50" cy="50" r={rCoil} fill={`url(#f${uid})`} />
          <circle cx="50" cy="50" r={rCoil} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.2" />
        </>
      )}

      {/* Hub, spokes and centre bore */}
      <circle cx="50" cy="50" r={R_HUB} fill={`url(#h${uid})`} />
      <circle cx="50" cy="50" r={R_HUB} fill="none" stroke="rgba(0,0,0,0.28)" strokeWidth="1" />
      <g stroke="rgba(0,0,0,0.14)" strokeWidth="2.5" strokeLinecap="round">
        {[0, 60, 120].map(a => (
          <line key={a} x1="50" y1="50" x2="50" y2={50 - R_HUB + 3}
            transform={`rotate(${a} 50 50)`} />
        ))}
      </g>
      <circle cx="50" cy="50" r="6.5" fill="rgba(12,15,22,0.85)" />
      <circle cx="50" cy="50" r="6.5" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
    </svg>
  )
}
