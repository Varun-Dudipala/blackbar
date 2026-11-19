import { describe, expect, it } from 'vitest'
import { detect, type Span } from './detectors'
import { CLOSE, OPEN, addUserSpan, leakCheck, rehydrate, removeSpan, sanitizeInput, seal } from './redact'

// Every value below is synthetic and obviously fake.
const LETTER = `Receipt Number: IOE0912345678
Jordan Sample, 123 Example Street, Apt 4B, San Jose, CA 95112
A-Number: A123456789. Please quote A123456789 in all correspondence.
SSN: 000-12-3456   Date of Birth: 01/02/1999
Respond by December 15, 2026. Call (408) 555-0142 or email Jordan.Sample@example.com.`

describe('seal and rehydrate', () => {
  const spans = detect(LETTER)
  const sealed = seal(LETTER, spans)

  it('round-trips back to the original text', () => {
    expect(rehydrate(sealed.sealedText, sealed.entries)).toBe(LETTER)
  })

  it('leaves no original value in the sealed text', () => {
    for (const entry of sealed.entries) expect(sealed.sealedText).not.toContain(entry.value)
    expect(leakCheck(sealed.sealedText, sealed.entries)).toEqual([])
  })

  it('keeps the deadline readable', () => {
    expect(sealed.sealedText).toContain('December 15, 2026')
  })

  it('gives a repeated value one placeholder', () => {
    const aNumbers = sealed.entries.filter((e) => e.kind === 'A_NUMBER')
    expect(aNumbers).toHaveLength(1)
    expect(sealed.sealedText.split(aNumbers[0].placeholder)).toHaveLength(3)
  })

  it('leaves unknown placeholders untouched', () => {
    const text = `Ask ${OPEN}NAME_9${CLOSE} about it.`
    expect(rehydrate(text, sealed.entries)).toBe(text)
  })
})

describe('leakCheck', () => {
  const sealed = seal(LETTER, detect(LETTER))

  it('catches an exact value', () => {
    const leaks = leakCheck('Your number A123456789 is on file.', sealed.entries)
    expect(leaks.map((l) => [l.kind, l.how])).toEqual([['A_NUMBER', 'exact']])
  })

  it('catches a value whose case changed', () => {
    const leaks = leakCheck('write to JORDAN.SAMPLE@EXAMPLE.COM', sealed.entries)
    expect(leaks.map((l) => l.kind)).toEqual(['EMAIL'])
  })

  it('catches an identifier with its punctuation removed', () => {
    const leaks = leakCheck('ssn 000123456 confirmed', sealed.entries)
    expect(leaks.map((l) => [l.kind, l.how])).toEqual([['SSN', 'reformatted']])
  })

  it('matches whole words only, so a hidden name is not found inside a longer word', () => {
    const entries = [{ placeholder: '⟦NAME_1⟧', kind: 'NAME' as const, value: 'State' }]
    expect(leakCheck('Students in the United States', entries)).toEqual([])
    expect(leakCheck('Ask State about it', entries).map((l) => l.how)).toEqual(['exact'])
  })

  it('does not flag short values that only match after squashing', () => {
    expect(leakCheck('Room 951-12 is on the third floor.', sealed.entries)).toEqual([])
  })
})

describe('input hardening', () => {
  it('neutralises placeholder brackets in untrusted input', () => {
    const hostile = `Note ${OPEN}SSN_1${CLOSE} here. SSN: 000-12-3456`
    const clean = sanitizeInput(hostile)
    expect(clean).not.toContain(OPEN)
    expect(clean).not.toContain(CLOSE)
    const sealed = seal(clean, detect(clean))
    const restored = rehydrate(sealed.sealedText, sealed.entries)
    expect(restored).toBe(clean)
    expect(restored).toContain('[SSN_1]')
  })

  it('refuses unsanitized input', () => {
    expect(() => seal(`x ${OPEN}SSN_1${CLOSE}`, [])).toThrow()
  })
})

describe('reader edits', () => {
  const text = 'Tenant Jordan Sample owes rent for unit 4B.'

  it('adds a hand-selected span and replaces what it overlaps', () => {
    const existing: Span[] = [{ start: 7, end: 13, kind: 'NAME', text: 'Jordan', source: 'model' }]
    const next = addUserSpan(existing, text, 7, 20, 'NAME')
    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({ text: 'Jordan Sample', source: 'user' })
  })

  it('clamps out-of-range selections and ignores empty ones', () => {
    expect(addUserSpan([], text, 40, 999)[0].text).toBe('4B.')
    expect(addUserSpan([], text, 5, 5)).toEqual([])
  })

  it('removes a span by its start', () => {
    const spans: Span[] = [{ start: 7, end: 13, kind: 'NAME', text: 'Jordan', source: 'model' }]
    expect(removeSpan(spans, 7)).toEqual([])
  })
})
