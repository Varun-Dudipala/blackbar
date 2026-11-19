// Page furniture: wordmark, device chip, theme switch, stage rail.

import type { DeviceStatus } from '../ai/device'
import { deviceLabel } from './labels'
import type { ThemeChoice } from '../state/hooks'

export function Wordmark() {
  return (
    <a className="wordmark" href="#top" aria-label="Blackbar, home">
      <span className="wm-black" aria-hidden="true">
        Black
      </span>
      <span className="wm-bar" aria-hidden="true">
        bar
      </span>
    </a>
  )
}

export function DeviceChip({ status, onPrepare }: { status: DeviceStatus; onPrepare: () => void }) {
  const { text, tone } = deviceLabel(status)
  const progress = status.state === 'downloading' && status.progress !== null ? status.progress : null
  const content = (
    <>
      <span className={`dot dot-${tone}`} aria-hidden="true" />
      <span>{text}</span>
      {progress !== null && (
        <span className="chip-meter" aria-hidden="true">
          <span style={{ width: `${Math.round(progress * 100)}%` }} />
        </span>
      )}
    </>
  )
  if (status.state === 'downloadable') {
    return (
      <button type="button" className="device-chip is-action" onClick={onPrepare} title="Chrome downloads its built-in model once: about 2.5 GB, and it needs about 22 GB of free disk space.">
        {content}
        <span className="chip-cta">Download</span>
      </button>
    )
  }
  return (
    <span className="device-chip" role="status" aria-live="polite">
      {content}
    </span>
  )
}

const NEXT: Record<ThemeChoice, ThemeChoice> = { system: 'light', light: 'dark', dark: 'system' }
const THEME_NAME: Record<ThemeChoice, string> = { system: 'Auto', light: 'Light', dark: 'Dark' }

export function ThemeSwitch({ theme, onChange }: { theme: ThemeChoice; onChange: (t: ThemeChoice) => void }) {
  return (
    <button type="button" className="theme-switch" onClick={() => onChange(NEXT[theme])} aria-label={`Theme: ${THEME_NAME[theme]}. Press for ${THEME_NAME[NEXT[theme]]}.`}>
      <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
        <circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        {theme === 'system' && <path d="M10 2.5a7.5 7.5 0 0 1 0 15z" fill="currentColor" />}
        {theme === 'dark' && <circle cx="10" cy="10" r="7.5" fill="currentColor" />}
      </svg>
      <span>{THEME_NAME[theme]}</span>
    </button>
  )
}

export type StageState = 'current' | 'done' | 'waiting'

export function StageRail({ stages }: { stages: { id: string; n: number; title: string; note: string; state: StageState }[] }) {
  return (
    <nav className="rail" aria-label="Progress">
      <ol>
        {stages.map((s) => (
          <li key={s.id} className={`rail-step is-${s.state}`}>
            <a href={`#${s.id}`} aria-current={s.state === 'current' ? 'step' : undefined}>
              <span className="rail-n" aria-hidden="true">
                {s.state === 'done' ? (
                  <svg viewBox="0 0 16 16" width="12" height="12">
                    <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" />
                  </svg>
                ) : (
                  s.n
                )}
              </span>
              <span className="rail-text">
                <span className="rail-title">{s.title}</span>
                <span className="rail-note">{s.note}</span>
              </span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  )
}
