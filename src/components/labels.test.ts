import { describe, expect, it } from 'vitest'
import { deviceRowNote } from './labels'

describe('where each step runs', () => {
  it('says plainly when the on-device steps are skipped in this browser', () => {
    expect(deviceRowNote({ state: 'ready', images: true })).toBe('Ready in this browser.')
    expect(deviceRowNote({ state: 'downloadable' })).toContain('skipped')
    expect(deviceRowNote({ state: 'stalled', reason: 'no-progress' })).toContain('Not downloaded')
    expect(deviceRowNote({ state: 'unavailable', reason: 'x' })).toContain('Not available')
    expect(deviceRowNote({ state: 'unsupported', reason: 'x' })).toContain('Not available')
    expect(deviceRowNote({ state: 'downloading', progress: 0.5 })).toBe('Downloading in this browser.')
  })
})
