// Single source of truth for the running front-end version. Baked at build time from
// the Git commit SHA via Vite `define` (Docker build-arg GIT_COMMIT). Falls back to
// "dev" locally so development never triggers forced reloads.
declare const __APP_VERSION__: string

export const APP_VERSION: string =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'

const RELOAD_FLAG = 'filament:reloaded-for-version'
// Records which server version we last reloaded toward, so we never reload more than
// once for the same target. If a reload doesn't actually pick up the new bundle (stale
// cache, or a genuine version skew between the web and api images), this stops what
// would otherwise be an infinite reload loop and leaves the app usable.
const RELOAD_TARGET = 'filament:reload-target'

type Listener = () => void
const restartListeners = new Set<Listener>()

/** Subscribe to the "server is restarting" signal. Returns an unsubscribe function. */
export function onServerRestarting(cb: Listener): () => void {
  restartListeners.add(cb)
  return () => { restartListeners.delete(cb) }
}

/** Emitted when the backend tells us (over the WebSocket) that it is shutting down. */
export function emitServerRestarting(): void {
  for (const cb of restartListeners) cb()
}

let reloading = false

/**
 * Reload the app to pick up a freshly deployed version, leaving a one-shot banner flag.
 * Reloads at most once per distinct target version (loop guard): if we already reloaded
 * toward this version and still don't match, we stop instead of looping forever.
 */
export function reloadForNewVersion(targetServerVersion?: string | null): void {
  if (reloading) return
  if (targetServerVersion) {
    let last: string | null = null
    try { last = sessionStorage.getItem(RELOAD_TARGET) } catch { /* storage may be unavailable */ }
    if (last === targetServerVersion) return // already tried to reach this version — don't loop
  }
  reloading = true
  try {
    sessionStorage.setItem(RELOAD_FLAG, '1')
    if (targetServerVersion) sessionStorage.setItem(RELOAD_TARGET, targetServerVersion)
  } catch { /* storage may be unavailable */ }
  location.reload()
}

/** True if a server version is meaningfully different from the one we are running. */
export function isDifferentVersion(serverVersion: string | null | undefined): boolean {
  if (!serverVersion) return false
  if (APP_VERSION === 'dev' || serverVersion === 'dev') return false
  return serverVersion !== APP_VERSION
}

/** Inspect a server-reported version (e.g. the X-App-Version header) and reload on mismatch. */
export function observeVersion(serverVersion: string | null | undefined): void {
  if (!serverVersion) return
  if (isDifferentVersion(serverVersion)) {
    reloadForNewVersion(serverVersion)
  } else {
    // Versions agree — clear the loop guard so the next genuine deploy reloads again.
    try { sessionStorage.removeItem(RELOAD_TARGET) } catch { /* storage may be unavailable */ }
  }
}

/** Returns true exactly once after a version-triggered reload, so the UI can show a notice. */
export function consumeReloadNotice(): boolean {
  try {
    if (sessionStorage.getItem(RELOAD_FLAG) === '1') {
      sessionStorage.removeItem(RELOAD_FLAG)
      return true
    }
  } catch { /* storage may be unavailable */ }
  return false
}
