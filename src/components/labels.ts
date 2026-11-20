import type { DeviceStatus } from '../ai/device'

export function deviceLabel(s: DeviceStatus): { text: string; tone: 'ok' | 'wait' | 'off' } {
  switch (s.state) {
    case 'checking':
      return { text: 'Checking this browser', tone: 'wait' }
    case 'ready':
      return { text: 'On-device model ready', tone: 'ok' }
    case 'downloadable':
      return { text: 'On-device model not downloaded', tone: 'wait' }
    case 'downloading':
      return { text: s.progress === null ? 'Downloading model' : `Downloading model, ${Math.floor(s.progress * 100)}%`, tone: 'wait' }
    case 'stalled':
      return { text: s.reason === 'error' ? 'Model download failed' : 'Model download has not started', tone: 'off' }
    case 'unsupported':
    case 'unavailable':
      return { text: 'No on-device model', tone: 'off' }
  }
}

/** The state of the on-device row in "Where each step runs", for this browser. */
export function deviceRowNote(s: DeviceStatus): string {
  switch (s.state) {
    case 'ready':
      return 'Ready in this browser.'
    case 'checking':
      return 'Checking this browser.'
    case 'downloading':
      return 'Downloading in this browser.'
    case 'downloadable':
    case 'stalled':
      return 'Not downloaded in this browser, so these steps are skipped.'
    case 'unsupported':
    case 'unavailable':
      return 'Not available in this browser, so these steps are skipped.'
  }
}

export const DEMO_VIDEO_URL = 'https://youtu.be/cZWINdaIIVE'
