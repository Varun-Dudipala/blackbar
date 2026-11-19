// Turns the strings the on-device model reported as personal into spans on the
// letter. The model only names strings; offsets always come from searching the
// letter itself, so a value the model made up or reworded is simply ignored.

import { findDates, isDateLike, type Kind, type Span } from './detectors'
import { toKind } from './kinds'

export interface ModelItem {
  kind: string
  value: string
}

// Words that often precede or sit inside a name but are not personal.
const NAME_STOPWORDS = new Set([
  'dear', 'mr', 'mrs', 'ms', 'mx', 'dr', 'prof', 'the', 'and', 'for', 'student', 'tenant', 'resident',
  'applicant', 'beneficiary', 'member', 'office', 'university', 'services', 'department', 'state', 'city',
  'county', 'united', 'states', 'national', 'american',
])

// A "name" containing one of these is an organisation; its words are not barred one by one.
const ORGANISATION = /\b(?:university|college|school|apartments?|services?|department|office|center|centre|bank|insurance|plan|inc|llc|ltd|company|management|agency|bureau|court|hospital|clinic|state of)\b/i

const isWordChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c)

/** All start offsets of `needle` in `text` that do not cut through a word. */
export function findWholeOccurrences(text: string, needle: string): number[] {
  const out: number[] = []
  if (!needle) return out
  let from = 0
  for (;;) {
    const at = text.indexOf(needle, from)
    if (at === -1) return out
    const startsInWord = isWordChar(needle[0]) && isWordChar(text[at - 1])
    const endsInWord = isWordChar(needle[needle.length - 1]) && isWordChar(text[at + needle.length])
    if (!startsInWord && !endsInWord) out.push(at)
    from = at + 1
  }
}

const tidy = (value: string) => value.trim().replace(/^["'“”‘’(]+|["'“”‘’),.;:]+$/g, '').trim()

/** Looks like a label or ordinary wording rather than an identifier. */
function looksOrdinary(value: string): boolean {
  return !/[0-9]/.test(value) && !/\p{Lu}/u.test(value)
}

/**
 * A part of a name ("Jordan" of "Jordan Sample") is barred on its own only if,
 * wherever it appears outside the full name, it looks like a name: written the
 * same way and not part of a longer proper noun such as "Example State
 * University". Occurrences inside an email address are ignored; the address is
 * barred as a whole.
 */
function partStandsAlone(text: string, full: string, part: string): boolean {
  const lower = text.toLowerCase()
  const fullHits = findWholeOccurrences(text, full).map((at) => [at, at + full.length] as const)
  for (const at of findWholeOccurrences(lower, part.toLowerCase())) {
    const end = at + part.length
    if (fullHits.some(([s, e]) => s <= at && end <= e)) continue
    const tokenStart = Math.max(text.lastIndexOf(' ', at), text.lastIndexOf('\n', at)) + 1
    const nextSpace = text.slice(end).search(/\s/)
    const token = text.slice(tokenStart, nextSpace === -1 ? text.length : end + nextSpace)
    if (token.includes('@')) continue
    if (text.slice(at, end) !== part) return false
    const before = /(\p{Lu}[\p{L}'-]*)[ \t]$/u.exec(text.slice(Math.max(0, at - 30), at))
    const after = /^[ \t](\p{Lu}[\p{L}'-]*)/u.exec(text.slice(end, end + 30))
    if ((before && !NAME_STOPWORDS.has(before[1].toLowerCase())) || after) return false
  }
  return true
}

/**
 * Maps model output to spans. Rules:
 * - a value must occur verbatim (whole-word) in the text, or it is dropped;
 * - dates are never barred unless the text labels them as a date of birth,
 *   so deadlines always stay readable;
 * - every occurrence of an accepted value is barred;
 * - for names, each part of the name (3+ letters, capitalised) is barred too,
 *   so "Dear Jordan," is covered when the model reported "Jordan Sample".
 */
export function mapModelStrings(text: string, items: readonly ModelItem[]): Span[] {
  const dates = findDates(text)
  const protectedDates = dates.filter((d) => !d.birth)
  const overlapsProtected = (s: number, e: number) => protectedDates.some((d) => s < d.end && d.start < e)
  const isBirthDate = (s: number, e: number) => dates.some((d) => d.birth && d.start === s && d.end === e)

  const spans: Span[] = []
  const seen = new Set<string>()
  const add = (start: number, end: number, kind: Kind) => {
    const id = `${start}:${end}`
    if (seen.has(id)) return
    seen.add(id)
    spans.push({ start, end, kind, text: text.slice(start, end), source: 'model' })
  }

  for (const item of items) {
    const value = tidy(item.value)
    const kind = toKind(item.kind)
    if (value.length < 2 || value.length > Math.max(80, text.length / 2)) continue
    if (looksOrdinary(value)) continue
    const dateValue = isDateLike(value)
    for (const at of findWholeOccurrences(text, value)) {
      const end = at + value.length
      if (dateValue) {
        if (isBirthDate(at, end)) add(at, end, 'DOB')
        continue
      }
      if (overlapsProtected(at, end)) continue
      add(at, end, kind)
    }
    if (kind === 'NAME' && !ORGANISATION.test(value)) {
      for (const part of value.split(/[\s,]+/)) {
        if (part.length < 3 || !/^\p{Lu}/u.test(part) || NAME_STOPWORDS.has(part.toLowerCase())) continue
        if (!partStandsAlone(text, value, part)) continue
        for (const at of findWholeOccurrences(text, part)) {
          if (spans.some((x) => at < x.end && x.start < at + part.length)) continue
          add(at, at + part.length, 'NAME')
        }
      }
    }
  }
  return spans.sort((a, b) => a.start - b.start)
}

/**
 * Adds new spans without disturbing what is already decided: anything that
 * overlaps an existing bar, or a stretch the reader chose to keep visible, is
 * skipped. Overlapping new spans resolve to the longest.
 */
export function mergeSpans(existing: readonly Span[], added: readonly Span[], keptVisible: readonly Span[] = []): Span[] {
  const blocked = [...existing, ...keptVisible]
  const fresh = added.filter((a) => !blocked.some((b) => a.start < b.end && b.start < a.end))
  // Longest first so a full name wins over a part of it.
  const ordered = [...fresh].sort((a, b) => b.end - b.start - (a.end - a.start))
  const kept: Span[] = []
  for (const span of ordered) if (!kept.some((k) => span.start < k.end && k.start < span.end)) kept.push(span)
  return [...existing, ...kept].sort((a, b) => a.start - b.start)
}

const fold = (v: string) => v.trim().toLowerCase()

/**
 * Makes the bars consistent: if a value is hidden once, every other place it
 * appears (in any letter case) is hidden too, unless the reader chose to keep
 * that value visible. Without this, "EXAMPLE STATE UNIVERSITY" in a header
 * would still show a value that is hidden elsewhere, and the leak check would
 * rightly refuse to send the letter.
 */
export function completeSpans(text: string, spans: readonly Span[], keptVisible: readonly Span[] = []): Span[] {
  const keptValues = new Set(keptVisible.map((k) => fold(k.text)))
  const folded = text.toLowerCase()
  const caseless = folded.length === text.length
  const out = [...spans]
  const seen = new Set<string>()
  for (const span of spans) {
    const value = fold(text.slice(span.start, span.end))
    if (value.length < 2 || seen.has(value) || keptValues.has(value)) continue
    seen.add(value)
    const hits = caseless ? findWholeOccurrences(folded, value) : findWholeOccurrences(text, text.slice(span.start, span.end).trim())
    for (const at of hits) {
      const end = at + value.length
      if (out.some((o) => at < o.end && o.start < end)) continue
      if (keptVisible.some((k) => at < k.end && k.start < end)) continue
      out.push({ start: at, end, kind: span.kind, text: text.slice(at, end), source: span.source })
    }
  }
  return out.sort((a, b) => a.start - b.start)
}
