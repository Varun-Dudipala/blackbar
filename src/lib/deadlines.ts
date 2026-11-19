// Deterministic help for the glance card: finds dates the letter itself frames
// as deadlines ("by December 15, 2026"), and recognises the letter's own date,
// which the model sometimes reports as a deadline.

import { findDates } from '../seal/detectors'
import { toIso, type CalendarDate } from './dates'

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

function valid(year: number, month: number, day: number): CalendarDate | null {
  if (year < 100) year += 2000
  const t = new Date(Date.UTC(year, month - 1, day))
  return t.getUTCFullYear() === year && t.getUTCMonth() === month - 1 && t.getUTCDate() === day ? { year, month, day } : null
}

/** Parses a date as U.S. letters write it. Numeric dates are month/day/year. */
export function parseWrittenDate(s: string): CalendarDate | null {
  const t = s.trim()
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t)
  if (m) return valid(+m[1], +m[2], +m[3])
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(t)
  if (m) return valid(+m[3], +m[1], +m[2])
  m = /^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(t)
  if (m) {
    const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1
    return month ? valid(+m[3], month, +m[2]) : null
  }
  m = /^(\d{1,2})\s+([A-Za-z]+)\.?,?\s+(\d{4})$/.exec(t)
  if (m) {
    const month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1
    return month ? valid(+m[3], month, +m[1]) : null
  }
  return null
}

const CUE = /\b(?:by|before|no later than|on or before|due(?: on| by)?|deadline(?: is)?|until|must be received(?: by)?)\s*[:,]?\s*$/i

export interface DeadlineCandidate {
  date: string
  /** The sentence around the date, as written. */
  sentence: string
}

function sentenceAround(text: string, start: number, end: number): string {
  const before = text.slice(0, start)
  const from = Math.max(before.lastIndexOf('. '), before.lastIndexOf('\n')) + 1
  const afterDot = text.indexOf('.', end)
  const afterLine = text.indexOf('\n', end)
  const ends = [afterDot === -1 ? text.length : afterDot + 1, afterLine === -1 ? text.length : afterLine].sort((a, b) => a - b)
  return text.slice(from, ends[0]).replace(/\s+/g, ' ').trim()
}

/** Dates the letter introduces with "by", "before", "due" and similar words. */
export function findDeadlineCandidates(text: string): DeadlineCandidate[] {
  const out: DeadlineCandidate[] = []
  for (const d of findDates(text)) {
    if (d.birth) continue
    const lead = text.slice(Math.max(0, d.start - 40), d.start).split(/\n|\.\s/).pop() ?? ''
    if (!CUE.test(lead)) continue
    const parsed = parseWrittenDate(d.text)
    if (!parsed) continue
    const iso = toIso(parsed)
    if (out.some((c) => c.date === iso)) continue
    out.push({ date: iso, sentence: sentenceAround(text, d.start, d.end) })
  }
  return out
}

/**
 * True when every place this date is written is a dateline: a line holding only
 * the date, or "Date:" / "Notice Date:" and the date.
 */
export function isLetterDate(text: string, date: CalendarDate): boolean {
  const iso = toIso(date)
  const hits = findDates(text).filter((d) => {
    const p = parseWrittenDate(d.text)
    return p !== null && toIso(p) === iso
  })
  if (hits.length === 0) return false
  return hits.every((h) => {
    const lineStart = text.lastIndexOf('\n', h.start - 1) + 1
    const lineEnd = text.indexOf('\n', h.end)
    const rest = (text.slice(lineStart, h.start) + text.slice(h.end, lineEnd === -1 ? text.length : lineEnd)).trim()
    return rest === '' || /^(?:notice\s+|letter\s+)?date[d]?\s*:?$/i.test(rest)
  })
}
