import { describe, expect, it } from 'vitest'
import { chunkText, estimateTokens } from './chunk'
import { addDays, dateAppearsIn, daysBetween, describeDays, parseIsoDate } from './dates'
import { buildIcs, escapeIcsText, foldLine, icsFileName, scrubForCalendar } from './ics'
import { fixOcrConfusions } from './ocr'
import { parseMarkdown, splitPlaceholders } from './markdown'

describe('chunkText', () => {
  const para = 'This is a sentence about rent. '.repeat(20).trim()
  const text = Array.from({ length: 12 }, () => para).join('\n\n')

  it('returns pieces that rejoin to the original', () => {
    const chunks = chunkText(text, 1500)
    expect(chunks.map((c) => c.text).join('')).toBe(text)
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(1500)
      expect(text.slice(c.start, c.start + c.text.length)).toBe(c.text)
    }
  })

  it('cuts at paragraph breaks when it can', () => {
    const chunks = chunkText(text, 1500)
    for (const c of chunks.slice(0, -1)) expect(c.text.endsWith('\n\n')).toBe(true)
  })

  it('hard-cuts text with no break', () => {
    const chunks = chunkText('x'.repeat(25), 10)
    expect(chunks.map((c) => c.text.length)).toEqual([10, 10, 5])
  })

  it('keeps short text whole', () => {
    expect(chunkText('short', 100)).toEqual([{ start: 0, text: 'short' }])
  })

  it('estimates tokens at about 3.8 characters each', () => {
    expect(estimateTokens('x'.repeat(380))).toBe(100)
  })
})

describe('dates', () => {
  it('rejects impossible dates', () => {
    expect(parseIsoDate('2026-02-30')).toBeNull()
    expect(parseIsoDate('2026-12-15')).toEqual({ year: 2026, month: 12, day: 15 })
  })

  it('counts days across month and year ends', () => {
    expect(daysBetween({ year: 2026, month: 11, day: 18 }, { year: 2026, month: 12, day: 15 })).toBe(27)
    expect(addDays({ year: 2026, month: 12, day: 30 }, 5)).toEqual({ year: 2027, month: 1, day: 4 })
  })

  it('describes days in words', () => {
    expect([0, 1, -1, 27, -3].map(describeDays)).toEqual(['today', 'tomorrow', 'yesterday', 'in 27 days', '3 days ago'])
  })

  it('finds a date in the forms letters use', () => {
    const d = { year: 2026, month: 12, day: 15 }
    expect(dateAppearsIn('must be received by December 15, 2026.', d)).toBe(true)
    expect(dateAppearsIn('due 12/15/2026', d)).toBe(true)
    expect(dateAppearsIn('due Dec. 15, 2026', d)).toBe(true)
    expect(dateAppearsIn('due 12/15/20265', d)).toBe(false)
    expect(dateAppearsIn('due December 16, 2026', d)).toBe(false)
  })
})

describe('ics', () => {
  const ev = {
    date: '2026-12-15',
    title: 'Reply to USCIS: request for evidence',
    description: 'Send the I-20, passport page; photos.\nKeep a copy.',
    uid: 'deadline-2026-12-15@blackbar',
    stamp: new Date('2026-11-18T10:00:00Z'),
  }
  const ics = buildIcs(ev)

  it('creates an all-day event with a reminder', () => {
    expect(ics).toContain('DTSTART;VALUE=DATE:20261215\r\n')
    expect(ics).toContain('DTEND;VALUE=DATE:20261216\r\n')
    expect(ics).toContain('DTSTAMP:20261118T100000Z\r\n')
    expect(ics).toContain('TRIGGER:-P3D')
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
  })

  it('escapes text values', () => {
    expect(escapeIcsText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne')
    expect(ics).toContain('passport page\\; photos.\\nKeep a copy.')
  })

  it('folds long lines at 75 octets', () => {
    const folded = foldLine('DESCRIPTION:' + 'é'.repeat(60))
    for (const line of folded.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
    expect(folded.split('\r\n').map((l, i) => (i ? l.slice(1) : l)).join('')).toBe('DESCRIPTION:' + 'é'.repeat(60))
  })

  it('rejects a bad date', () => {
    expect(() => buildIcs({ ...ev, date: '2026-13-01' })).toThrow()
  })

  it('scrubs identifiers before they reach a calendar', () => {
    const entries = [{ placeholder: '⟦NAME_1⟧', kind: 'NAME' as const, value: 'Jordan Sample' }]
    expect(scrubForCalendar('Reply for Jordan Sample', entries)).toBe('Reply for [hidden]')
  })

  it('makes a safe file name', () => {
    expect(icsFileName('Reply to USCIS: request for evidence', '2026-12-15')).toBe('reply-to-uscis-request-for-evidence-2026-12-15.ics')
  })
})

describe('fixOcrConfusions', () => {
  it('repairs a SEVIS ID read with the letter o', () => {
    expect(fixOcrConfusions('SEVIS ID: Noo12345678').text).toBe('SEVIS ID: N0012345678')
    expect(fixOcrConfusions('SEVIS ID: No0012345678').text).toBe('SEVIS ID: N0012345678')
  })

  it('reports each fix and leaves correct IDs alone', () => {
    const r = fixOcrConfusions('N0012345678 and No0012345678')
    expect(r.fixes).toHaveLength(1)
    expect(r.fixes[0]).toMatchObject({ from: 'No0012345678', to: 'N0012345678' })
    expect(fixOcrConfusions('Not 12345 Notice').fixes).toEqual([])
  })
})

describe('markdown', () => {
  it('parses headings, task lists and emphasis', () => {
    const blocks = parseMarkdown('## Next steps\n\n- [ ] Gather the **I-20**\n- [x] Read the letter\n\nThen *wait*.')
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'list', 'paragraph'])
    const list = blocks[1]
    if (list.type !== 'list') throw new Error('expected list')
    expect(list.items.map((i) => i.checked)).toEqual([false, true])
    expect(list.items[0].inline).toEqual([{ type: 'text', text: 'Gather the ' }, { type: 'strong', text: 'I-20' }])
  })

  it('never produces raw HTML', () => {
    const blocks = parseMarkdown('<img src=x onerror=alert(1)>')
    expect(blocks).toEqual([{ type: 'paragraph', inline: [{ type: 'text', text: '<img src=x onerror=alert(1)>' }] }])
  })

  it('splits placeholders and holds back one still arriving', () => {
    expect(splitPlaceholders('Dear ⟦NAME_1⟧, your ⟦SS')).toEqual([
      { type: 'text', text: 'Dear ' },
      { type: 'placeholder', placeholder: '⟦NAME_1⟧', kind: 'NAME' },
      { type: 'text', text: ', your ' },
    ])
    expect(splitPlaceholders('⟦A_NUMBER_2⟧')).toEqual([{ type: 'placeholder', placeholder: '⟦A_NUMBER_2⟧', kind: 'A_NUMBER' }])
  })
})
