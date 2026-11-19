import { describe, expect, it } from 'vitest'
import { detect, resolveOverlaps, type Span } from './detectors'

// Every value below is synthetic and obviously fake.
const LETTER = `U.S. Citizenship and Immigration Services
Notice Date: November 3, 2026
Receipt Number: IOE0912345678

Jordan Sample
123 Example Street, Apt 4B
San Jose, CA 95112

RE: Request for Evidence
A-Number: A123456789    SEVIS ID: N0012345678
Date of Birth: 01/02/1999
Passport No: X1234567
SSN: 000-12-3456

You must respond by December 15, 2026. If we do not receive the requested
evidence by that date, your application may be denied.

Questions? Call (408) 555-0142 or write to jordan.sample@example.com.
Reference code 482913675 appears on your payment stub.`

const kinds = (spans: Span[], kind: string) => spans.filter((s) => s.kind === kind).map((s) => s.text)

describe('detect', () => {
  const spans = detect(LETTER)

  it('reports offsets that match the text', () => {
    for (const s of spans) expect(LETTER.slice(s.start, s.end)).toBe(s.text)
  })

  it('returns sorted, non-overlapping spans', () => {
    for (let i = 1; i < spans.length; i++) expect(spans[i].start).toBeGreaterThanOrEqual(spans[i - 1].end)
  })

  it('finds government identifiers', () => {
    expect(kinds(spans, 'SSN')).toEqual(['000-12-3456'])
    expect(kinds(spans, 'A_NUMBER')).toEqual(['A123456789'])
    expect(kinds(spans, 'SEVIS')).toEqual(['N0012345678'])
    expect(kinds(spans, 'RECEIPT')).toEqual(['IOE0912345678'])
  })

  it('captures only the value for labelled fields', () => {
    expect(kinds(spans, 'PASSPORT')).toEqual(['X1234567'])
    expect(kinds(spans, 'DOB')).toEqual(['01/02/1999'])
  })

  it('finds contact details and address parts', () => {
    expect(kinds(spans, 'PHONE')).toEqual(['(408) 555-0142'])
    expect(kinds(spans, 'EMAIL')).toEqual(['jordan.sample@example.com'])
    expect(kinds(spans, 'ADDRESS')).toEqual(['123 Example Street, Apt 4B'])
    expect(kinds(spans, 'ZIP')).toEqual(['95112'])
  })

  it('leaves deadlines and other unlabelled dates visible', () => {
    for (const date of ['December 15, 2026', 'November 3, 2026']) {
      const at = LETTER.indexOf(date)
      expect(at).toBeGreaterThan(-1)
      const covering = spans.filter((s) => s.start < at + date.length && at < s.end)
      expect(covering).toEqual([])
    }
  })

  it('does not call an unlabelled nine-digit number an SSN', () => {
    const at = LETTER.indexOf('482913675')
    const covering = spans.filter((s) => s.start < at + 9 && at < s.end)
    expect(covering.filter((s) => s.kind === 'SSN')).toEqual([])
  })

  it('treats nine bare digits as an SSN when labelled', () => {
    const found = detect('Social Security Number: 000123456 on file.')
    expect(kinds(found, 'SSN')).toEqual(['000123456'])
  })

  it('prefers the receipt rule over the generic case-number rule', () => {
    const found = detect('Case No: IOE0912345678')
    expect(found).toHaveLength(1)
    expect(found[0].kind).toBe('RECEIPT')
  })

  it('finds labelled reference and ledger numbers, but never a plain word after the label', () => {
    expect(kinds(detect('ledger reference MC2026-0417-12C).'), 'ACCOUNT')).toEqual(['MC2026-0417-12C'])
    expect(kinds(detect('Ref: 88231-B'), 'ACCOUNT')).toEqual(['88231-B'])
    expect(detect('Please reference your lease section 4.')).toEqual([])
    expect(detect('Your file number is on the notice.')).toEqual([])
  })

  it('finds a name after a salutation or label, everywhere it appears', () => {
    const text = 'Jordan Sample\n123 Main St\n\nBeneficiary: Jordan Sample\nDear Jordan Sample:\nDear Sir or Madam,\nTo: Wei Example\nTo whom it may concern,'
    const names = kinds(detect(text), 'NAME')
    expect(names).toEqual(['Jordan Sample', 'Jordan Sample', 'Jordan Sample', 'Wei Example'])
  })

  it('does not take a plain word after "passport" as a passport number', () => {
    expect(kinds(detect('Bring two passport photos.'), 'PASSPORT')).toEqual([])
  })

  it('returns nothing for text without identifiers', () => {
    expect(detect('Please bring two forms of identification to your appointment.')).toEqual([])
  })
})

describe('resolveOverlaps', () => {
  it('keeps the longest of overlapping spans', () => {
    const a: Span = { start: 0, end: 4, kind: 'OTHER', text: 'abcd', source: 'model' }
    const b: Span = { start: 2, end: 10, kind: 'NAME', text: 'cdefghij', source: 'model' }
    expect(resolveOverlaps([a, b])).toEqual([b])
  })
})
