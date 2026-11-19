// What the app may do in each on-device model state. Kept pure so every
// combination is unit-tested.

import type { DeviceStatus } from '../ai/device'
import type { Session } from './session'

export type DeviceState = DeviceStatus['state']
export type ScanStatus = Session['scan']['status']

export interface Policy {
  /** The on-device model may be called (scan, glance, photo, on-device answer). */
  modelRuns: boolean
  /** Cloud sends are paused. Only while the model is actually checking the letter. */
  sendPaused: boolean
  /** The current letter is sealed by pattern checks only. */
  patternsOnly: boolean
  /** Offer the Download button. */
  offerDownload: boolean
}

export function policy(device: DeviceState, scan: ScanStatus): Policy {
  const ready = device === 'ready'
  return {
    modelRuns: ready,
    sendPaused: scan === 'running',
    patternsOnly: scan !== 'done',
    offerDownload: device === 'downloadable' || device === 'stalled',
  }
}

/** How long a download may sit at 0% (or report no progress) before we call it stalled. */
export const STALL_MS = 20_000

export interface DownloadWatch {
  /** When the download was started by the reader, or first seen in progress. */
  since: number
  /** Last progress reported (0 to 1), or null when Chrome reported none. */
  progress: number | null
}

/** True when a download has shown no progress for STALL_MS. Any progress above 0% counts as moving. */
export function isStalled(watch: DownloadWatch, now: number, stallMs = STALL_MS): boolean {
  return now - watch.since >= stallMs && (watch.progress === null || watch.progress <= 0)
}
