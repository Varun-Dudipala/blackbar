// Validates the on-device "at a glance" reading against the letter itself.
// The model's dates and amounts are kept only in a form the reader can check:
// each one says whether it appears in the letter as written.

import { daysBetween, dateAppearsIn, parseIsoDate, type CalendarDate } from '../lib/dates'
import { findDeadlineCandidates, isLetterDate } from '../lib/deadlines'

export interface GlanceDeadline {
  date: string
  what: string
  days: number
  /** False when the model's date is not written in the letter (for example a computed "within 30 days"). */
  foundInLetter: boolean
  /** "model" when the on-device model reported it, "letter" when found by a "by <date>" check of the text. */
  from: 'model' | 'letter'
}

export interface GlanceAmount {
  amount: string
  what: string
  foundInLetter: boolean
}

export interface Glance {
  documentType: string
  sender: string
  summary: string
  asks: string[]
  deadlines: GlanceDeadline[]
  amounts: GlanceAmount[]
}

/** Parses model JSON, tolerating a Markdown code fence around it. */
export function parseModelJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    return JSON.parse(trimmed)
  } catch {
    const first = trimmed.indexOf('{')
    const last = trimmed.lastIndexOf('}')
    if (first !== -1 && last > first) {
      try {
        return JSON.parse(trimmed.slice(first, last + 1))
      } catch {
        return null
      }
    }
    return null
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})

const normalizeMoney = (s: string) => s.replace(/[\s,]/g, '').replace(/\.00$/, '')

export function normalizeGlance(raw: unknown, letter: string, today: CalendarDate): Glance | null {
  if (!raw || typeof raw !== 'object') return null
  const r = rec(raw)
  const seenDates = new Set<string>()
  const deadlines: GlanceDeadline[] = []
  for (const d of arr(r.deadlines)) {
    const item = rec(d)
    const date = parseIsoDate(str(item.date))
    if (!date) continue
    const iso = str(item.date)
    if (seenDates.has(iso)) continue
    // The model sometimes reports the letter's own date as a deadline.
    if (isLetterDate(letter, date)) continue
    seenDates.add(iso)
    deadlines.push({ date: iso, what: str(item.what), days: daysBetween(today, date), foundInLetter: dateAppearsIn(letter, date), from: 'model' })
  }
  // Dates the letter itself introduces with "by", "before" or "due" are always listed.
  for (const c of findDeadlineCandidates(letter)) {
    if (seenDates.has(c.date)) continue
    const date = parseIsoDate(c.date)
    if (!date) continue
    seenDates.add(c.date)
    deadlines.push({ date: c.date, what: c.sentence, days: daysBetween(today, date), foundInLetter: true, from: 'letter' })
  }
  deadlines.sort((a, b) => a.date.localeCompare(b.date))

  const flatLetter = normalizeMoney(letter)
  const amounts: GlanceAmount[] = []
  for (const a of arr(r.amounts)) {
    const item = rec(a)
    const amount = str(item.amount)
    if (!amount || !/\d/.test(amount)) continue
    if (amounts.some((x) => normalizeMoney(x.amount) === normalizeMoney(amount))) continue
    amounts.push({ amount, what: str(item.what), foundInLetter: flatLetter.includes(normalizeMoney(amount)) })
  }

  const glance: Glance = {
    documentType: str(r.documentType),
    sender: str(r.sender),
    summary: str(r.summary),
    asks: arr(r.asks).map(str).filter(Boolean).slice(0, 8),
    deadlines,
    amounts,
  }
  if (!glance.documentType && !glance.summary && deadlines.length === 0) return null
  return glance
}

/** The deadline to put first: the nearest one still ahead, else the latest past one. */
export function primaryDeadline(g: Glance): GlanceDeadline | null {
  const ahead = g.deadlines.filter((d) => d.days >= 0)
  if (ahead.length) return ahead[0]
  return g.deadlines[g.deadlines.length - 1] ?? null
}
