// Small date helpers. All dates here are calendar dates (YYYY-MM-DD) with no
// time zone: "December 15" means the reader's December 15.

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export interface CalendarDate {
  year: number
  month: number // 1-12
  day: number
}

export function parseIsoDate(iso: string): CalendarDate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim())
  if (!m) return null
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const check = new Date(Date.UTC(year, month - 1, day))
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null
  return { year, month, day }
}

export function toIso(d: CalendarDate): string {
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`
}

/** The reader's local calendar date. */
export function localToday(now: Date = new Date()): CalendarDate {
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() }
}

export function addDays(d: CalendarDate, days: number): CalendarDate {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + days))
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() }
}

export function daysBetween(from: CalendarDate, to: CalendarDate): number {
  const a = Date.UTC(from.year, from.month - 1, from.day)
  const b = Date.UTC(to.year, to.month - 1, to.day)
  return Math.round((b - a) / 86_400_000)
}

/** "today", "tomorrow", "in 27 days", "yesterday", "12 days ago". */
export function describeDays(days: number): string {
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days === -1) return 'yesterday'
  return days > 0 ? `in ${days} days` : `${-days} days ago`
}

export function formatLong(d: CalendarDate): string {
  return `${MONTHS[d.month - 1]} ${d.day}, ${d.year}`
}

export function formatWeekday(d: CalendarDate): string {
  return new Date(Date.UTC(d.year, d.month - 1, d.day)).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
}

/** The ways a letter may write this date, used to check the model's reading against the text. */
export function writtenForms(d: CalendarDate): string[] {
  const month = MONTHS[d.month - 1]
  const short = month.slice(0, 3)
  const mm = String(d.month).padStart(2, '0')
  const dd = String(d.day).padStart(2, '0')
  const yy = String(d.year).slice(2)
  return [
    `${month} ${d.day}, ${d.year}`, `${month} ${d.day} ${d.year}`,
    `${short} ${d.day}, ${d.year}`, `${short}. ${d.day}, ${d.year}`, `${short} ${d.day} ${d.year}`,
    `${d.day} ${month} ${d.year}`, `${d.day} ${short} ${d.year}`,
    `${d.month}/${d.day}/${d.year}`, `${mm}/${dd}/${d.year}`, `${mm}/${dd}/${yy}`, `${d.month}/${d.day}/${yy}`,
    `${d.month}-${d.day}-${d.year}`, `${mm}-${dd}-${d.year}`,
    toIso(d),
  ]
}

/** True when the letter itself contains this date in a common written form. */
export function dateAppearsIn(text: string, d: CalendarDate): boolean {
  const flat = text.replace(/\s+/g, ' ').toLowerCase()
  return writtenForms(d).some((form) => {
    const f = form.toLowerCase()
    let at = flat.indexOf(f)
    while (at !== -1) {
      const before = flat[at - 1]
      const after = flat[at + f.length]
      if (!/[0-9]/.test(before ?? '') && !/[0-9]/.test(after ?? '')) return true
      at = flat.indexOf(f, at + 1)
    }
    return false
  })
}
