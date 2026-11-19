import { describe, expect, it } from 'vitest'
import { findDeadlineCandidates, isLetterDate, parseWrittenDate } from './deadlines'
import { buildSamples } from '../letters/samples'

describe('parseWrittenDate', () => {
  it('reads the usual U.S. forms', () => {
    expect(parseWrittenDate('December 15, 2026')).toEqual({ year: 2026, month: 12, day: 15 })
    expect(parseWrittenDate('Dec. 15, 2026')).toEqual({ year: 2026, month: 12, day: 15 })
    expect(parseWrittenDate('12/15/2026')).toEqual({ year: 2026, month: 12, day: 15 })
    expect(parseWrittenDate('15 December 2026')).toEqual({ year: 2026, month: 12, day: 15 })
    expect(parseWrittenDate('02/30/2026')).toBeNull()
  })
})

describe('deadline candidates', () => {
  it('finds dates introduced as deadlines and ignores others', () => {
    const text = 'Notice Date: November 3, 2026\nYour response must be received by December 15, 2026. Pay before 01/04/2027.'
    expect(findDeadlineCandidates(text).map((c) => c.date)).toEqual(['2026-12-15', '2027-01-04'])
  })

  it('finds each sample letter deadline', () => {
    for (const s of buildSamples({ year: 2026, month: 11, day: 18 })) {
      expect(findDeadlineCandidates(s.text).map((c) => c.date)).toContain(s.deadline)
    }
  })
})

describe('isLetterDate', () => {
  it('recognises a dateline', () => {
    expect(isLetterDate('Date: November 17, 2026\nPay by December 8, 2026.', { year: 2026, month: 11, day: 17 })).toBe(true)
    expect(isLetterDate('ACME\n\nNovember 16, 2026\n\nDear', { year: 2026, month: 11, day: 16 })).toBe(true)
    expect(isLetterDate('Pay by December 8, 2026.', { year: 2026, month: 12, day: 8 })).toBe(false)
  })
})
