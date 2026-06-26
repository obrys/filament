import { useEffect, useRef, useState } from 'react'
import { FACET_FIELDS, type FacetField, type Facets, type FacetSelection } from '../api/client'

const LABELS: Record<FacetField, string> = {
  brand: 'Brand',
  material: 'Material',
  type: 'Type',
  color: 'Color',
}

type Props = {
  facets: Facets
  selection: FacetSelection
  onToggle: (field: FacetField, value: string) => void
  onRemove: (field: FacetField, value: string) => void
  onClear: () => void
}

/**
 * Server-driven faceted filter UI. Renders one collapsible dropdown per facet (native
 * <details> so it works on touch without extra JS) plus a row of removable chips for the
 * active selection. All counts come from the server; the client performs no filtering.
 *
 * The dropdowns' open state is controlled so only one is open at a time, and clicking outside
 * (or pressing Escape) closes the open one. Selecting options keeps the menu open so several
 * values can be chosen in a row.
 */
export function FilterBar({ facets, selection, onToggle, onRemove, onClear }: Props) {
  const [open, setOpen] = useState<FacetField | null>(null)
  const facetsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open === null) return
    const onPointerDown = (e: PointerEvent) => {
      if (!facetsRef.current?.contains(e.target as Node)) setOpen(null)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const activeChips = FACET_FIELDS.flatMap(field =>
    selection[field].map(value => ({ field, value })),
  )

  return (
    <div className="filterbar">
      <div className="filterbar__facets" ref={facetsRef}>
        {FACET_FIELDS.map(field => {
          const options = facets[field]
          const selectedCount = selection[field].length
          return (
            <details key={field} className="facet" open={open === field}>
              <summary
                onClick={e => {
                  e.preventDefault()
                  setOpen(prev => (prev === field ? null : field))
                }}
              >
                {LABELS[field]}
                {selectedCount > 0 && <span className="facet__badge">{selectedCount}</span>}
              </summary>
              <div className="facet__menu">
                {options.length === 0 && <p className="facet__empty">No values</p>}
                {options.map(opt => {
                  const checked = selection[field].includes(opt.value)
                  return (
                    <label
                      key={opt.value}
                      className={`facet__option${opt.count === 0 && !checked ? ' facet__option--empty' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onToggle(field, opt.value)}
                      />
                      <span className="facet__value">{opt.value || '(none)'}</span>
                      <span className="facet__count">{opt.count}</span>
                    </label>
                  )
                })}
              </div>
            </details>
          )
        })}
      </div>

      {activeChips.length > 0 && (
        <div className="filterbar__chips">
          {activeChips.map(({ field, value }) => (
            <button
              key={`${field}:${value}`}
              type="button"
              className="chip"
              onClick={() => onRemove(field, value)}
              title={`Remove ${LABELS[field]}: ${value}`}
            >
              <span className="chip__field">{LABELS[field]}:</span> {value || '(none)'}
              <span className="chip__x" aria-hidden>×</span>
            </button>
          ))}
          <button type="button" className="chip chip--clear" onClick={onClear}>
            Clear all
          </button>
        </div>
      )}
    </div>
  )
}
