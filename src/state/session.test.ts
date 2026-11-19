import { describe, expect, it } from 'vitest'
import { detect } from '../seal/detectors'
import { initialSession, reducer, type Session } from './session'

const TEXT = 'Jordan Sample, SSN: 000-12-3456. Respond by December 15, 2026.'
const start = (): Session =>
  reducer(initialSession, { type: 'letter', letter: { text: TEXT, origin: 'paste', title: 'Pasted letter' }, spans: detect(TEXT) })

describe('session reducer', () => {
  it('unseals every place a value appears, so the letter stays consistent', () => {
    const text = 'Jordan Sample wrote. Jordan Sample, SSN: 000-12-3456.'
    let s = reducer(initialSession, { type: 'letter', letter: { text, origin: 'paste', title: 't' }, spans: detect(text) })
    s = reducer(s, { type: 'model-spans', chunks: 1, spans: [{ start: 0, end: 13, kind: 'NAME', text: 'Jordan Sample', source: 'model' }] })
    expect(s.spans.filter((x) => x.kind === 'NAME')).toHaveLength(2)
    s = reducer(s, { type: 'unseal', start: 0 })
    expect(s.spans.filter((x) => x.kind === 'NAME')).toHaveLength(0)
    expect(s.keptVisible).toHaveLength(2)
    s = reducer(s, { type: 'reseal', start: 21 })
    expect(s.spans.filter((x) => x.kind === 'NAME')).toHaveLength(2)
  })

  it('starts a letter with pattern bars', () => {
    expect(start().spans.map((s) => s.kind)).toEqual(['SSN'])
  })

  it('merges model bars and counts what was added', () => {
    const s = reducer(start(), { type: 'model-spans', chunks: 1, spans: [{ start: 0, end: 13, kind: 'NAME', text: 'Jordan Sample', source: 'model' }] })
    expect(s.spans.map((x) => x.kind)).toEqual(['NAME', 'SSN'])
    expect(s.scan).toEqual({ status: 'done', value: { added: 1, chunks: 1 } })
  })

  it('unseals and reseals a bar, and model results do not re-add an unsealed bar', () => {
    let s = reducer(start(), { type: 'unseal', start: 20 })
    expect(s.spans).toEqual([])
    expect(s.keptVisible).toHaveLength(1)
    s = reducer(s, { type: 'model-spans', chunks: 1, spans: [{ start: 20, end: 31, kind: 'SSN', text: '000-12-3456', source: 'model' }] })
    expect(s.spans).toEqual([])
    s = reducer(s, { type: 'reseal', start: 20 })
    expect(s.spans).toHaveLength(1)
    expect(s.keptVisible).toEqual([])
  })

  it('adds a hand-made bar', () => {
    const s = reducer(start(), { type: 'add-bar', start: 0, end: 6, kind: 'NAME' })
    expect(s.spans[0]).toMatchObject({ text: 'Jordan', source: 'user' })
  })

  it('totals words sent across calls and keeps the receipt across letters', () => {
    let s = reducer(start(), { type: 'call', call: { label: 'Explain', side: 'in_cloud', ms: 900, wordsSent: 120 } })
    s = reducer(s, { type: 'call', call: { label: 'Glance', side: 'on_device', ms: 7000 } })
    expect(s.wordsSent).toBe(120)
    s = reducer(s, { type: 'letter', letter: { text: 'x', origin: 'paste', title: 't' }, spans: [] })
    expect(s.calls).toHaveLength(2)
    expect(reducer(s, { type: 'reset' }).calls).toEqual([])
  })
})
