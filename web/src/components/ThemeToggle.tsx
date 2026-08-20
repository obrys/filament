import { useCallback, useEffect, useState } from 'react'
import { IconMoon, IconSun } from './icons'

type Theme = 'dark' | 'light'

const KEY = 'filament.theme'

const stored = (): Theme | null => {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'dark' || v === 'light' ? v : null
  } catch { return null } // storage may be unavailable
}

const systemTheme = (): Theme =>
  window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'

/**
 * Light/dark switch. The chosen theme is pinned on `<html data-theme>` (the same attribute the
 * inline script in index.html sets before first paint, which avoids a flash on reload). With no
 * stored choice the OS preference wins and keeps winning if it changes.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => stored() ?? systemTheme())
  const [pinned, setPinned] = useState<boolean>(() => stored() !== null)

  useEffect(() => {
    if (pinned) document.documentElement.dataset.theme = theme
    else delete document.documentElement.dataset.theme
  }, [theme, pinned])

  useEffect(() => {
    if (pinned) return
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = () => setTheme(mq.matches ? 'light' : 'dark')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [pinned])

  const toggle = useCallback(() => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    setPinned(true)
    try { localStorage.setItem(KEY, next) } catch { /* storage may be unavailable */ }
  }, [theme])

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
    >
      {theme === 'dark' ? <IconSun /> : <IconMoon />}
    </button>
  )
}
