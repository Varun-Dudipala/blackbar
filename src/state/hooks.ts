import { useCallback, useEffect, useRef, useState } from 'react'
import { checkDevice as realCheck, prepareDevice as realPrepare, type DeviceStatus } from '../ai/device'
import { deviceSeam } from '../ai/deviceSeam'

// In development an e2e test may replace these with a test double (see deviceSeam.ts).
const checkDevice = () => deviceSeam()?.check() ?? realCheck()
const prepareDevice = (onProgress: (p: number) => void) => deviceSeam()?.prepare(onProgress) ?? realPrepare(onProgress)

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}

export interface DeviceHandle {
  status: DeviceStatus
  /** Call from a click: starts the download if needed and warms the model. Resolves when it is usable. */
  prepare: () => Promise<boolean>
  refresh: () => void
}

export function useDevice(): DeviceHandle {
  const [status, setStatus] = useState<DeviceStatus>({ state: 'checking' })
  const preparing = useRef<Promise<boolean> | null>(null)

  const refresh = useCallback(() => {
    void checkDevice().then(setStatus)
  }, [])

  useEffect(refresh, [refresh])

  // While Chrome downloads, availability is the source of truth for "done".
  useEffect(() => {
    if (status.state !== 'downloading') return
    const t = window.setInterval(() => {
      void checkDevice().then((s) => {
        if (s.state !== 'downloading') setStatus(s)
      })
    }, 3000)
    return () => window.clearInterval(t)
  }, [status.state])

  const prepare = useCallback(async () => {
    if (status.state === 'unsupported' || status.state === 'unavailable') return false
    if (!preparing.current) {
      preparing.current = (async () => {
        try {
          if (status.state === 'downloadable') setStatus({ state: 'downloading', progress: 0 })
          await prepareDevice((p) => setStatus({ state: 'downloading', progress: p }))
          const now = await checkDevice()
          setStatus(now)
          return now.state === 'ready' || now.state === 'downloading'
        } catch {
          const now = await checkDevice()
          setStatus(now)
          return now.state === 'ready'
        } finally {
          preparing.current = null
        }
      })()
    }
    return preparing.current
  }, [status.state])

  return { status, prepare, refresh }
}

export type ThemeChoice = 'system' | 'light' | 'dark'
const THEME_KEY = 'blackbar.theme'

function readTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

export function useTheme(): [ThemeChoice, (t: ThemeChoice) => void] {
  const [theme, setTheme] = useState<ThemeChoice>(readTheme)
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
    try {
      if (theme === 'system') localStorage.removeItem(THEME_KEY)
      else localStorage.setItem(THEME_KEY, theme)
    } catch {
      /* storage blocked: the choice lasts for this visit */
    }
  }, [theme])
  return [theme, setTheme]
}

export const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

export function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' })
}
