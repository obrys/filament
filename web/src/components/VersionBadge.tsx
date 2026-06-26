import { useState, useCallback } from 'react'
import { APP_VERSION } from '../version'

type State =
  | { kind: 'collapsed' }
  | { kind: 'loading' }
  | { kind: 'expanded'; serverVersion: string }
  | { kind: 'error' }

export function VersionBadge(): React.ReactElement {
  const [state, setState] = useState<State>({ kind: 'collapsed' })

  const handleClick = useCallback(async () => {
    if (state.kind !== 'collapsed') {
      setState({ kind: 'collapsed' })
      return
    }
    setState({ kind: 'loading' })
    try {
      const res = await fetch('/api/version', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = await res.json()
      const serverVersion: string = body?.version ?? 'unknown'
      setState({ kind: 'expanded', serverVersion })
    } catch {
      setState({ kind: 'error' })
    }
  }, [state.kind])

  let label: string
  if (state.kind === 'collapsed') {
    label = `ver: ${APP_VERSION}`
  } else if (state.kind === 'loading') {
    label = `Client version: ${APP_VERSION}; Server version: …`
  } else if (state.kind === 'expanded') {
    label = `Client version: ${APP_VERSION}; Server version: ${state.serverVersion}`
  } else {
    label = `Client version: ${APP_VERSION}; Server version: unavailable`
  }

  return (
    <button
      type="button"
      className="version-badge"
      onClick={handleClick}
      title={state.kind === 'collapsed' ? 'Click to show server version' : 'Click to collapse'}
      aria-label="Application version"
    >
      {label}
    </button>
  )
}
