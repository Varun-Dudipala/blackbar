// Seals free text the reader types (follow-up questions) with the same
// placeholders as the letter, so the cloud model sees one consistent story.

import { detect, resolveOverlaps, type Span } from './detectors'
import { findWholeOccurrences } from './modelSpans'
import { sanitizeInput, sealWith, type SealEntry, type Sealed } from './redact'

/** Spans for every known value that reappears in `text`, ignoring case. */
export function findKnownValues(text: string, entries: readonly SealEntry[]): Span[] {
  // Lower-casing keeps offsets only when it keeps the length; otherwise match exactly.
  const folded = text.toLowerCase()
  const caseless = folded.length === text.length
  const haystack = caseless ? folded : text
  const spans: Span[] = []
  for (const entry of entries) {
    const value = entry.value.trim()
    if (value.length < 2) continue
    for (const at of findWholeOccurrences(haystack, caseless ? value.toLowerCase() : value)) {
      spans.push({ start: at, end: at + value.length, kind: entry.kind, text: text.slice(at, at + value.length), source: 'pattern' })
    }
  }
  return spans
}

export interface SealedQuestion extends Sealed {
  /** How many identifiers were hidden in the question itself. */
  hidden: number
}

export function sealQuestion(question: string, entries: readonly SealEntry[]): SealedQuestion {
  const clean = sanitizeInput(question)
  const spans = resolveOverlaps([...findKnownValues(clean, entries), ...detect(clean)])
  const sealed = sealWith(clean, spans, [...entries])
  return { ...sealed, hidden: spans.length }
}

/** Replaces known values in on-device text (for example the glance card) with their placeholders. */
export function maskKnown(text: string, entries: readonly SealEntry[]): string {
  const clean = sanitizeInput(text)
  return sealWith(clean, resolveOverlaps(findKnownValues(clean, entries)), [...entries]).sealedText
}

/**
 * Replaces known values in text that already contains placeholders (an
 * earlier cloud answer), keeping those placeholders intact.
 */
export function maskValuesKeepingPlaceholders(text: string, entries: readonly SealEntry[]): string {
  const spans = resolveOverlaps(findKnownValues(text, entries))
  let out = ''
  let cursor = 0
  for (const span of spans) {
    const entry = entries.find((e) => e.kind === span.kind && e.value.trim().toLowerCase() === span.text.trim().toLowerCase())
    if (!entry || span.start < cursor) continue
    out += text.slice(cursor, span.start) + entry.placeholder
    cursor = span.end
  }
  return out + text.slice(cursor)
}
