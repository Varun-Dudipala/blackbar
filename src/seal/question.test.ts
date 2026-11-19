import { describe, expect, it } from 'vitest'
import { detect } from './detectors'
import { seal } from './redact'
import { maskKnown, maskValuesKeepingPlaceholders, sealQuestion } from './question'
import { guessKind } from './kinds'
import { hiddenSummary, outboundStats, placeholderCount, wordCount } from './stats'

// Synthetic values only.
const LETTER = 'Jordan Sample, A-Number: A123456789, SSN: 000-12-3456. Respond by December 15, 2026.'
const base = seal(LETTER, [...detect(LETTER), { start: 0, end: 13, kind: 'NAME', text: 'Jordan Sample', source: 'model' }])

describe('sealQuestion', () => {
  it('reuses the letter placeholders for known values, ignoring case', () => {
    const q = sealQuestion('Does jordan sample need to send a123456789 again?', base.entries)
    const name = base.entries.find((e) => e.kind === 'NAME')!
    const anum = base.entries.find((e) => e.kind === 'A_NUMBER')!
    expect(q.sealedText).toBe(`Does ${name.placeholder} need to send ${anum.placeholder} again?`)
    expect(q.entries).toHaveLength(base.entries.length)
    expect(q.hidden).toBe(2)
  })

  it('seals new identifiers with fresh numbers after the existing ones', () => {
    const q = sealQuestion('My other SSN is 000-98-7654, call (408) 555-0142.', base.entries)
    expect(q.sealedText).toContain('⟦SSN_2⟧')
    expect(q.sealedText).toContain('⟦PHONE_1⟧')
    expect(q.sealedText).not.toContain('000-98-7654')
    expect(q.entries.length).toBe(base.entries.length + 2)
  })

  it('leaves a question without identifiers unchanged', () => {
    const q = sealQuestion('What happens if I am late?', base.entries)
    expect(q.sealedText).toBe('What happens if I am late?')
    expect(q.hidden).toBe(0)
  })

  it('neutralises placeholder brackets typed by the reader', () => {
    const q = sealQuestion('What is ⟦SSN_1⟧?', base.entries)
    expect(q.sealedText).toBe('What is [SSN_1]?')
  })
})

describe('maskKnown', () => {
  it('replaces known values in on-device text', () => {
    const name = base.entries.find((e) => e.kind === 'NAME')!
    expect(maskKnown('Letter for Jordan Sample', base.entries)).toBe(`Letter for ${name.placeholder}`)
  })
})

describe('maskValuesKeepingPlaceholders', () => {
  it('hides values added after an answer arrived and keeps its placeholders', () => {
    const name = base.entries.find((e) => e.kind === 'NAME')!
    const extra = [...base.entries, { placeholder: '⟦OTHER_1⟧', kind: 'OTHER' as const, value: 'Potomac Service Center' }]
    expect(maskValuesKeepingPlaceholders(`${name.placeholder} wrote to the potomac service center.`, extra)).toBe(`${name.placeholder} wrote to the ⟦OTHER_1⟧.`)
  })
})

describe('counts', () => {
  it('counts a placeholder as one word', () => {
    expect(wordCount('Dear ⟦NAME_1⟧, your number ⟦A_NUMBER_1⟧ is on file.')).toBe(8)
    expect(wordCount('   ')).toBe(0)
  })

  it('words counts the same way everywhere', () => {
    expect(hiddenSummary(11, 13)).toBe('11 details hidden (13 bars)')
    expect(hiddenSummary(5, 5)).toBe('5 details hidden')
    expect(hiddenSummary(1, 2)).toBe('1 detail hidden (2 bars)')
    expect(hiddenSummary(0, 0)).toBe('No details hidden')
  })

  it('reports distinct identifiers and total bars in a payload', () => {
    const text = `${base.sealedText} Again: ${base.entries[0].placeholder}`
    const stats = outboundStats(text, base.entries)
    expect(stats.sealed).toBe(base.entries.length)
    expect(stats.bars).toBe(placeholderCount(text))
    expect(stats.bars).toBe(base.entries.length + 1)
  })
})

describe('guessKind', () => {
  it('guesses a kind for a hand-made bar', () => {
    expect(guessKind('Riley Sample')).toBe('NAME')
    expect(guessKind('Potomac Service Center')).toBe('OTHER')
    expect(guessKind('MC-88')).toBe('ACCOUNT')
    expect(guessKind('a@example.com')).toBe('EMAIL')
  })
})
