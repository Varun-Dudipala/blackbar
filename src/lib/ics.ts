// Builds a calendar file for a deadline, entirely on the device. Calendar apps
// often sync to a cloud account, so callers scrub identifiers out first.

import { addDays, parseIsoDate, toIso, type CalendarDate } from './dates'
import type { SealEntry } from '../seal/redact'

export interface DeadlineEvent {
  date: string // YYYY-MM-DD
  title: string
  description: string
  /** Stable id so re-downloading updates the same event instead of adding a copy. */
  uid: string
  stamp: Date
  /** Days before the deadline for a reminder. 0 or less means no reminder. */
  remindDaysBefore?: number
}

export function escapeIcsText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

/** Folds a content line to 75 octets, as RFC 5545 requires, without splitting a character. */
export function foldLine(line: string): string {
  const enc = new TextEncoder()
  const parts: string[] = []
  let current = ''
  let size = 0
  for (const ch of line) {
    const n = enc.encode(ch).length
    const limit = parts.length === 0 ? 75 : 74 // continuation lines start with a space
    if (size + n > limit) {
      parts.push(current)
      current = ''
      size = 0
    }
    current += ch
    size += n
  }
  parts.push(current)
  return parts.join('\r\n ')
}

const compact = (d: CalendarDate) => toIso(d).replace(/-/g, '')

const stampUtc = (t: Date) => t.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

export function buildIcs(ev: DeadlineEvent): string {
  const day = parseIsoDate(ev.date)
  if (!day) throw new Error(`not a calendar date: ${ev.date}`)
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Blackbar//Deadline//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${ev.uid}`,
    `DTSTAMP:${stampUtc(ev.stamp)}`,
    `DTSTART;VALUE=DATE:${compact(day)}`,
    `DTEND;VALUE=DATE:${compact(addDays(day, 1))}`,
    `SUMMARY:${escapeIcsText(ev.title)}`,
    `DESCRIPTION:${escapeIcsText(ev.description)}`,
    'TRANSP:TRANSPARENT',
  ]
  const remind = ev.remindDaysBefore ?? 3
  if (remind > 0) {
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeIcsText(ev.title)}`, `TRIGGER:-P${remind}D`, 'END:VALARM')
  }
  lines.push('END:VEVENT', 'END:VCALENDAR')
  return lines.map(foldLine).join('\r\n') + '\r\n'
}

/** Removes every known identifier from text bound for a calendar. */
export function scrubForCalendar(text: string, entries: readonly SealEntry[]): string {
  let out = text
  const byLength = [...entries].sort((a, b) => b.value.length - a.value.length)
  for (const entry of byLength) {
    if (entry.value.trim().length < 2) continue
    out = out.split(entry.value).join('[hidden]')
  }
  return out
}

export function icsFileName(title: string, date: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'deadline'
  return `${slug}-${date}.ics`
}
