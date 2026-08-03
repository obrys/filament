import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { FACET_FIELDS, type FacetField, type FacetSelection } from '../api/client'

const EMPTY: FacetSelection = { brand: [], material: [], type: [], color: [] }

/**
 * Keeps the active facet selection in the URL query string so filtering is bookmarkable and
 * the browser Back button undoes the last filter change. Only the four facet params
 * (brand/material/type/color) are managed here; other params (e.g. includeFinished) are left
 * untouched.
 */
export function useFacetFilters() {
  const [params, setParams] = useSearchParams()

  const selection = useMemo<FacetSelection>(() => {
    const sel: FacetSelection = { brand: [], material: [], type: [], color: [] }
    for (const field of FACET_FIELDS) sel[field] = params.getAll(field)
    return sel
  }, [params])

  const writeField = useCallback(
    (field: FacetField, values: string[]) => {
      setParams(
        prev => {
          const next = new URLSearchParams(prev)
          next.delete(field)
          for (const v of values) next.append(field, v)
          return next
        },
        { replace: false },
      )
    },
    [setParams],
  )

  const toggleOption = useCallback(
    (field: FacetField, value: string) => {
      const current = params.getAll(field)
      const next = current.includes(value)
        ? current.filter(v => v !== value)
        : [...current, value]
      writeField(field, next)
    },
    [params, writeField],
  )

  const removeOption = useCallback(
    (field: FacetField, value: string) => {
      writeField(field, params.getAll(field).filter(v => v !== value))
    },
    [params, writeField],
  )

  const clearAll = useCallback(() => {
    setParams(
      prev => {
        const next = new URLSearchParams(prev)
        for (const field of FACET_FIELDS) next.delete(field)
        return next
      },
      { replace: false },
    )
  }, [setParams])

  const activeCount = FACET_FIELDS.reduce((n, f) => n + selection[f].length, 0)

  return { selection, toggleOption, removeOption, clearAll, activeCount, isEmpty: activeCount === 0 }
}

export { EMPTY as EMPTY_SELECTION }
