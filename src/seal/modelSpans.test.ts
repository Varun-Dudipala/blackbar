import { describe, expect, it } from 'vitest'
import type { Span } from './detectors'
import { completeSpans, findWholeOccurrences, mapModelStrings, mergeSpans } from './modelSpans'

// Synthetic text, fake values only.
const TEXT = `Dear Jordan Sample,
Jordan, your case MSC-00-1234 is open. Ledger ref MC2026-0417-12C.
Date of Birth: 01/02/1999. Respond by December 15, 2026.
Your sponsor Jordanna Lee wrote on November 3, 2026.`

const texts = (spans: Span[]) => spans.map((s) => s.text)

describe('findWholeOccurrences', () => {
  it('skips matches inside longer words', () => {
    expect(findWholeOccurrences('Jordan Jordanna Jordan.', 'Jordan')).toEqual([0, 16])
  })
})

describe('mapModelStrings', () => {
  it('maps every verbatim occurrence to offsets', () => {
    const spans = mapModelStrings(TEXT, [{ kind: 'ACCOUNT', value: 'MSC-00-1234' }])
    expect(spans).toHaveLength(1)
    expect(TEXT.slice(spans[0].start, spans[0].end)).toBe('MSC-00-1234')
    expect(spans[0].source).toBe('model')
  })

  it('ignores strings that are not in the text', () => {
    expect(mapModelStrings(TEXT, [{ kind: 'SSN', value: '000-99-0000' }])).toEqual([])
  })

  it('ignores reworded values', () => {
    expect(mapModelStrings(TEXT, [{ kind: 'ACCOUNT', value: 'MC 2026 0417 12C' }])).toEqual([])
  })

  it('never bars a deadline or other unlabelled date', () => {
    const spans = mapModelStrings(TEXT, [
      { kind: 'OTHER', value: 'December 15, 2026' },
      { kind: 'DOB', value: 'November 3, 2026' },
    ])
    expect(spans).toEqual([])
  })

  it('bars a date the text labels as a date of birth', () => {
    const spans = mapModelStrings(TEXT, [{ kind: 'OTHER', value: '01/02/1999' }])
    expect(spans.map((s) => [s.kind, s.text])).toEqual([['DOB', '01/02/1999']])
  })

  it('bars the parts of a name wherever they stand alone, but not inside other words', () => {
    const spans = mapModelStrings(TEXT, [{ kind: 'NAME', value: 'Jordan Sample' }])
    const at = (s: string, from = 0) => TEXT.indexOf(s, from)
    const starts = spans.map((s) => s.start)
    expect(starts).toContain(at('Jordan Sample'))
    expect(starts).toContain(at('Jordan,'))
    expect(spans.some((s) => s.start === at('Jordanna'))).toBe(false)
  })

  it('does not bar the single words of an organisation reported as a name', () => {
    const text = 'Example State University. Wei Example. The State of Ohio.'
    const spans = mapModelStrings(text, [{ kind: 'NAME', value: 'Example State University' }])
    expect(spans.map((s) => s.text)).toEqual(['Example State University'])
  })

  it('does not bar a name part that is also part of another proper noun', () => {
    const text = 'EXAMPLE STATE UNIVERSITY\nTo: Wei Example\nExample State University charges a fee. Dear Wei,'
    const spans = mapModelStrings(text, [{ kind: 'NAME', value: 'Wei Example' }])
    expect(spans.map((s) => s.text)).toEqual(['Wei Example', 'Wei'])
  })

  it('maps model kind labels to known kinds', () => {
    const spans = mapModelStrings(TEXT, [{ kind: 'case number', value: 'MSC-00-1234' }])
    expect(spans[0].kind).toBe('ACCOUNT')
  })

  it('drops lowercase wording that is not an identifier', () => {
    expect(mapModelStrings(TEXT, [{ kind: 'OTHER', value: 'your case' }])).toEqual([])
  })

  it('strips quotes and trailing punctuation the model adds', () => {
    const spans = mapModelStrings(TEXT, [{ kind: 'ACCOUNT', value: '"MC2026-0417-12C."' }])
    expect(texts(spans)).toEqual(['MC2026-0417-12C'])
  })
})

describe('mergeSpans', () => {
  const pattern: Span = { start: 0, end: 5, kind: 'SSN', text: 'xxxxx', source: 'pattern' }

  it('keeps existing bars and skips overlapping additions', () => {
    const added: Span[] = [
      { start: 3, end: 8, kind: 'NAME', text: 'y', source: 'model' },
      { start: 10, end: 12, kind: 'NAME', text: 'z', source: 'model' },
    ]
    expect(mergeSpans([pattern], added).map((s) => s.start)).toEqual([0, 10])
  })

  it('does not re-add a stretch the reader chose to keep visible', () => {
    const kept: Span = { start: 10, end: 12, kind: 'NAME', text: 'z', source: 'model' }
    expect(mergeSpans([], [kept], [kept])).toEqual([])
  })

  it('prefers the longer of two overlapping additions', () => {
    const a: Span = { start: 0, end: 6, kind: 'NAME', text: 'Jordan', source: 'model' }
    const b: Span = { start: 0, end: 13, kind: 'NAME', text: 'Jordan Sample', source: 'model' }
    expect(mergeSpans([], [a, b])).toEqual([b])
  })
})

describe('completeSpans', () => {
  const text = 'EXAMPLE STATE UNIVERSITY\nDear Wei Example, Example State University writes.'
  const at = text.indexOf('Wei Example') + 4
  const one: Span = { start: at, end: at + 7, kind: 'NAME', text: 'Example', source: 'model' }

  it('hides every other occurrence of a hidden value, in any case', () => {
    const spans = completeSpans(text, [one])
    expect(spans.map((s) => text.slice(s.start, s.end))).toEqual(['EXAMPLE', 'Example', 'Example'])
  })

  it('leaves values the reader kept visible alone', () => {
    const kept: Span = { ...one }
    expect(completeSpans(text, [], [kept])).toEqual([])
  })
})
