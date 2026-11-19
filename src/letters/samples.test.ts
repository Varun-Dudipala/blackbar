import { describe, expect, it } from 'vitest'
import { detect, findDates } from '../seal/detectors'
import { buildSamples } from './samples'
import { dateAppearsIn, parseIsoDate } from '../lib/dates'

const samples = buildSamples({ year: 2026, month: 11, day: 18 })

describe('sample letters', () => {
  it('use only obviously fake values', () => {
    for (const s of samples) {
      expect(s.text).not.toMatch(/\b(?!000)\d{3}-\d{2}-\d{4}\b/) // no SSN outside the 000 range
      for (const email of s.text.match(/\S+@\S+/g) ?? []) expect(email).toMatch(/@example\.(com|edu)/)
    }
  })

  it('write the deadline into the letter', () => {
    for (const s of samples) expect(dateAppearsIn(s.text, parseIsoDate(s.deadline)!)).toBe(true)
  })

  it('leave every deadline date readable after pattern sealing', () => {
    for (const s of samples) {
      const spans = detect(s.text)
      for (const d of findDates(s.text).filter((x) => !x.birth)) {
        expect(spans.some((sp) => sp.start < d.end && d.start < sp.end)).toBe(false)
      }
    }
  })

  it('have pattern coverage for every listed identifier, names included', () => {
    for (const s of samples) {
      const barred = detect(s.text).map((sp) => sp.text)
      const structured = s.identifiers.filter((v) => !s.modelOnly.includes(v))
      for (const v of structured) expect(barred.some((b) => b.includes(v) || v.includes(b))).toBe(true)
    }
  })
})

describe('pattern names in samples', () => {
  it('bars only real names', () => {
    for (const s of samples) {
      const names = [...new Set(detect(s.text).filter((x) => x.kind === 'NAME').map((x) => x.text))]
      expect(names).toEqual(s.identifiers.filter((v) => /^[A-Z][a-z]+ [A-Z][a-z]+$/.test(v) && !s.modelOnly.includes(v)))
    }
  })
})
