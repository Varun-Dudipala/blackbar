import { useCallback, useEffect, useRef, useState } from 'react'
import { checkDevice as realCheck, prepareDevice as realPrepare, type DeviceStatus } from '../ai/device'
import { deviceSeam } from '../ai/deviceSeam'
import { isStalled, type DownloadWatch } from './policy'

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
  /**
   * Starts Chrome's model download. Only the reader's Download button calls
   * this; nothing else in the app starts a download.
   */
  download: () => void
  refresh: () => void
}

const POLL_MS = 1000

export function useDevice(): DeviceHandle {
  const [status, setStatus] = useState<DeviceStatus>({ state: 'checking' })
  const watch = useRef<DownloadWatch | null>(null)

  const refresh = useCallback(() => {
    void checkDevice().then((s) => {
      if (s.state === 'downloading' && !watch.current) watch.current = { since: Date.now(), progress: null }
      setStatus(s)
    })
  }, [])

  useEffect(refresh, [refresh])

  // While a download is in progress, availability says when it is done; the
  // watch says when it has not moved for long enough to call it stalled.
  useEffect(() => {
    if (status.state !== 'downloading') return
    const t = window.setInterval(() => {
      void checkDevice().then((s) => {
        const w = watch.current
        if (s.state === 'ready' || s.state === 'unavailable' || s.state === 'unsupported') {
          watch.current = null
          setStatus(s)
        } else if (w && s.state === 'downloadable' && Date.now() - w.since > 3 * POLL_MS) {
          // Chrome went back to "downloadable": the download failed.
          watch.current = null
          setStatus({ state: 'stalled', reason: 'error' })
        } else if (w && isStalled(w, Date.now())) {
          watch.current = null
          setStatus({ state: 'stalled', reason: 'no-progress' })
        }
      })
    }, POLL_MS)
    return () => window.clearInterval(t)
  }, [status.state])

  const download = useCallback(() => {
    watch.current = { since: Date.now(), progress: null }
    setStatus({ state: 'downloading', progress: null })
    void prepareDevice((p) => {
      if (watch.current) watch.current.progress = p
      setStatus((prev) => (prev.state === 'downloading' ? { state: 'downloading', progress: p } : prev))
    }).catch(() => {
      watch.current = null
      setStatus({ state: 'stalled', reason: 'error' })
    })
  }, [])

  return { status, download, refresh }
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
