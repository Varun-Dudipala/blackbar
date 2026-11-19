import { describe, expect, it } from 'vitest'
import { isStalled, policy, type DeviceState, type ScanStatus } from './policy'

const devices: DeviceState[] = ['checking', 'unsupported', 'unavailable', 'downloadable', 'downloading', 'stalled', 'ready']
const scans: ScanStatus[] = ['idle', 'running', 'done', 'error']

describe('policy', () => {
  it('lets the model run only when it is ready', () => {
    for (const d of devices) for (const s of scans) expect(policy(d, s).modelRuns).toBe(d === 'ready')
  })

  it('pauses sending only while a scan is running, in every device state', () => {
    for (const d of devices) for (const s of scans) expect(policy(d, s).sendPaused).toBe(s === 'running')
  })

  it('never blocks sending because the model is missing, downloading or stalled', () => {
    for (const d of ['downloadable', 'downloading', 'stalled', 'unavailable', 'unsupported'] as DeviceState[]) {
      expect(policy(d, 'idle')).toMatchObject({ sendPaused: false, patternsOnly: true })
    }
  })

  it('counts a letter as model-checked only after the scan finished', () => {
    expect(policy('ready', 'done').patternsOnly).toBe(false)
    expect(policy('ready', 'error').patternsOnly).toBe(true)
  })

  it('offers the download when the model is not downloaded or the download stalled', () => {
    expect(devices.filter((d) => policy(d, 'idle').offerDownload)).toEqual(['downloadable', 'stalled'])
  })
})

describe('isStalled', () => {
  it('calls a download stalled after 20 s at 0% or with no progress', () => {
    expect(isStalled({ since: 0, progress: 0 }, 19_999)).toBe(false)
    expect(isStalled({ since: 0, progress: 0 }, 20_000)).toBe(true)
    expect(isStalled({ since: 0, progress: null }, 25_000)).toBe(true)
  })

  it('does not call a moving download stalled', () => {
    expect(isStalled({ since: 0, progress: 0.01 }, 60_000)).toBe(false)
  })
})
